/**
 * @module editor/editor
 * @description
 * Tiptap WYSIWYG Editor with Yjs collaboration + IndexedDB persistence + LRU page cache.
 *
 * Why an LRU cache? When the user clicks between pages we want navigation to feel
 * like switching browser tabs: the editor for a previously visited page is kept
 * alive (DOM + Tiptap + Yjs) and re-shown on revisit, so cursor and scroll
 * position survive without round-tripping Firestore. y-indexeddb hydrates fresh
 * editors locally so even cache-miss pages paint before the network responds.
 *
 * ### Lifecycle Of A Page
 * `createEditor()` → cache hit? {@link activateEntry} : {@link _createNewEditor} → …editing… →
 * navigate away → {@link parkActive} → (later) {@link evictIfNeeded} → {@link destroyEntry}. Parking
 * is deliberately *not* destruction: the DOM node is only hidden and the provider suspended, so a
 * return visit is a `display:block` away. Destruction happens only on eviction (more than
 * {@link MAX_CACHED_EDITORS} pages parked) or on an explicit {@link clearEditorCache}.
 *
 * ### Single-Active Invariant
 * Exactly one entry is "active" at a time, tracked by {@link currentPageId}; everything else in the
 * cache is parked. Several pieces of state are process-wide and therefore have to be re-targeted at
 * the active editor rather than duplicated per page:
 * - **Bubble menus** (`#link-bubble-menu`, `#format-bubble-menu`) — shared DOM, wired exactly once
 *   by {@link ensureBubbleMenuGlobalListeners}; every handler re-checks `currentPageId === pageId`
 *   so a click can never reach a parked editor.
 * - **Format toolbar** ({@link formatToolbarRef}) — one instance for the whole app, repainted
 *   against the active editor by {@link updateToolbarState}.
 * - **`window.editor`** — the debug/E2E handle, always pointing at the active editor or `null`.
 *
 * ### Persistence Model
 * Edits are never written to the Firestore `content` field from here. They flow into Yjs (via the
 * `Collaboration` extension) and are persisted by {@link module:editor/FirestoreYjsProvider}; the
 * markdown `content` field is projected from Yjs server-side (`functions/projectYjsToMarkdown`).
 * That is why Ctrl+S only calls `provider.flushPending()` and why there is no `onUpdate` handler.
 * {@link getMarkdown} exists for export/preview and converts the *current HTML* through Turndown —
 * it is not the storage path.
 *
 * ### E2E Escape Hatch
 * `window.__E2E_DISABLE_COLLAB__` swaps the collaboration extensions for Tiptap's local history, so
 * tests can drive a deterministic single-user editor without a Yjs/Firestore round trip.
 */

import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import tippy from 'tippy.js';
import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCursor } from '@tiptap/extension-collaboration-cursor';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Image } from '@tiptap/extension-image';
import { Link } from '@tiptap/extension-link';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { CodeBlock } from '@tiptap/extension-code-block';
import { CharacterCount } from '@tiptap/extension-character-count';
import { Comment } from './Comment.js';
import { DateNode } from './DateNode.js';
import { Mention } from '@tiptap/extension-mention';
import { mergeAttributes } from '@tiptap/core';
import suggestion from './suggestions.js';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { FirestoreYjsProvider } from './FirestoreYjsProvider.js';
import { Selection } from '@tiptap/pm/state';

import TurndownService from 'turndown';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

import { promptModal, linkModal } from '../components/modal.js';
import { getAllPages } from '../components/sidebar.js';
import { showToast } from '../components/toast.js';
import { navigateTo } from '../controllers/page.js';
import { uploadImageFile } from '../firebase/storage.js';
import { isSpellCheckEnabled } from '../firebase/auth.js';
import { SpellCheckerBot } from './SpellCheckerBot.js';
import { VoiceAssistant } from './VoiceAssistant.js';
import { VoiceGhost } from './VoiceGhost.js';
import i18next from '../i18n.js';

// --- LRU cache of page editors ---

/**
 * Everything that has to be created, kept alive, and torn down together for one page's editor.
 *
 * The whole object is deliberately mutable and created *before* the Tiptap editor exists, because
 * several callbacks wired during construction (`fireReady`, the provider load callback, the bubble
 * menu handlers) need to close over the entry and read `entry.editor` later.
 *
 * @typedef {Object} CacheEntry
 * @property {string} pageId Firestore page id — the cache key and the provider's document id.
 * @property {import('@tiptap/core').Editor|null} editor The Tiptap instance; `null` for the brief
 *   window between entry creation and `new Editor(...)`.
 * @property {import('yjs').Doc} ydoc CRDT document backing the editor; the actual source of truth.
 * @property {import('./FirestoreYjsProvider.js').FirestoreYjsProvider} provider Firestore sync +
 *   awareness provider. Suspended while parked, resumed on activation.
 * @property {import('y-indexeddb').IndexeddbPersistence|null} persistence Local Yjs cache; `null`
 *   when IndexedDB is unavailable (private mode, blocked storage) — sync then still works, it is
 *   just slower to first paint.
 * @property {HTMLElement} container The `.editor-pane` div; hidden (`display:none`) while parked
 *   and removed from the DOM on destroy.
 * @property {number} scrollTop Scroll offset of the pane's scroll parent, captured on park.
 * @property {{anchor: number, head: number}|null} selection Last known caret/selection, mirrored
 *   into `localStorage` so it also survives a full page reload.
 * @property {import('./SpellCheckerBot.js').SpellCheckerBot|null} spellCheckerBot Autocorrect bot;
 *   only present while the feature flag is on (see {@link reevaluateSpellCheck}).
 * @property {import('./VoiceAssistant.js').VoiceAssistant|null} voiceAssistant Dictation controller
 *   driving the 🎤 toolbar button and the ghost-text overlay.
 * @property {Object|null} formatTippy tippy popup hosting the shared format bubble menu.
 * @property {Object|null} linkTippy tippy popup hosting the shared link bubble menu.
 * @property {Function|null} detachSelectionListener Removes this entry's document-level
 *   `selectionchange` listener; called on destroy so parked/dead entries stop reacting.
 */

/**
 * Live editors keyed by page id — the LRU cache itself.
 * @type {Map<string, CacheEntry>}
 */
const cache = new Map();         // pageId -> CacheEntry
/**
 * Recency list mirroring {@link cache}: page ids with the most-recently-used one last.
 * Kept as a plain array because it never holds more than a handful of ids.
 * @type {string[]}
 */
const cacheOrder = [];           // pageIds, most-recently-used last
/**
 * How many page editors may stay resident. Each one keeps a Tiptap instance, a Yjs doc, and a DOM
 * subtree alive, so this trades memory for instant back-navigation.
 * @type {number}
 */
const MAX_CACHED_EDITORS = 3;
/**
 * Page id of the single active (visible) editor, or `null` when everything is parked.
 * Every shared-DOM handler guards on this value.
 * @type {string|null}
 */
let currentPageId = null;
/**
 * The one format toolbar element, created once by {@link createFormatToolbar} and re-pointed at
 * whichever editor is active.
 * @type {HTMLElement|null}
 */
let formatToolbarRef = null;     // single toolbar shared across pages

/**
 * Lazily created Turndown singleton; see {@link getTurndown}.
 * @type {import('turndown')|null}
 */
let turndownInstance = null;
/**
 * Returns the shared HTML→Markdown converter, constructing it on first use.
 *
 * Built lazily and cached because Turndown is only needed for export/preview, not for editing, and
 * its custom rules are stateless. Two project-specific rules are registered:
 * - **`taskItems`** — Tiptap emits task list items as `<li data-type="taskItem" data-checked>`,
 *   which Turndown would otherwise flatten into a plain bullet; this restores GFM `- [x]` / `- [ ]`.
 * - **`dateNode`** — a {@link module:editor/DateNode} pill serialises to
 *   `<span data-type="date">`; emitting its inner HTML keeps the bare ISO date in the markdown so a
 *   later import can turn it back into a pill.
 *
 * @returns {import('turndown')} The configured singleton (ATX headings, fenced code blocks).
 */
function getTurndown() {
  if (!turndownInstance) {
    turndownInstance = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    });
    turndownInstance.addRule('taskItems', {
      filter: function (node) {
        return node.nodeName === 'LI' && (node.getAttribute('data-type') === 'taskItem' || node.hasAttribute('data-checked'));
      },
      replacement: function (content, node) {
        const checked = node.getAttribute('data-checked') === 'true';
        return (checked ? '- [x] ' : '- [ ] ') + content.trim() + '\n';
      }
    });
    turndownInstance.addRule('dateNode', {
      filter: function (node) {
        return node.nodeName === 'SPAN' && node.getAttribute('data-type') === 'date';
      },
      replacement: function (content, node) {
        return node.innerHTML;
      }
    });
  }
  return turndownInstance;
}

// Bubble-menu DOM elements (`#link-bubble-menu`, `#format-bubble-menu`) are
// shared across editors. The blur-prevention and click handlers must therefore
// route to the *currently active* editor — otherwise a click would also fire
// against parked editors and mark their content dirty.

/**
 * Guard flag ensuring the shared bubble-menu listeners are installed exactly once per session.
 * @type {boolean}
 */
let _bubbleMenuGlobalListenersInstalled = false;

/**
 * Installs the once-per-session `mousedown`/`touchstart` handlers on the shared bubble menus.
 *
 * Their only job is to call `preventDefault()` for presses on a button inside the menu. Without it
 * the press would blur the editor, ProseMirror would drop the selection, and the formatting command
 * fired a moment later would have nothing to apply to. `touchstart` is registered non-passive
 * precisely because it must be able to cancel the default action.
 *
 * The listeners stay attached for the lifetime of the app — the menus are shared DOM, so binding
 * them per editor would stack duplicate handlers with every page visit.
 *
 * @param {HTMLElement|null} linkMenuEl The `#link-bubble-menu` element, if present in the page.
 * @param {HTMLElement|null} formatMenuEl The `#format-bubble-menu` element, if present.
 * @returns {void} No-op on every call after the first.
 */
function ensureBubbleMenuGlobalListeners(linkMenuEl, formatMenuEl) {
  if (_bubbleMenuGlobalListenersInstalled) return;
  _bubbleMenuGlobalListenersInstalled = true;
  const preventBlur = (e) => { if (e.target.closest('button')) e.preventDefault(); };
  if (linkMenuEl) {
    linkMenuEl.style.display = 'flex';
    linkMenuEl.addEventListener('mousedown', preventBlur);
    linkMenuEl.addEventListener('touchstart', preventBlur, { passive: false });
  }
  if (formatMenuEl) {
    formatMenuEl.style.display = 'flex';
    formatMenuEl.addEventListener('mousedown', preventBlur);
    formatMenuEl.addEventListener('touchstart', preventBlur, { passive: false });
  }
}

// --- Cache helpers ---

/**
 * Resolves the currently active cache entry.
 *
 * The accessor used by every public getter, so a call while nothing is open degrades to `null`
 * instead of throwing.
 *
 * @returns {CacheEntry|null|undefined} The active entry, or a falsy value when no page is open.
 */
function _active() { return currentPageId ? cache.get(currentPageId) : null; }

/**
 * Marks a page as most-recently-used by moving its id to the end of {@link cacheOrder}.
 *
 * @param {string} pageId Page that was just activated or created.
 * @returns {void}
 */
function bumpLRU(pageId) {
  const i = cacheOrder.indexOf(pageId);
  if (i >= 0) cacheOrder.splice(i, 1);
  cacheOrder.push(pageId);
}

/**
 * Trims the cache back down to {@link MAX_CACHED_EDITORS} entries.
 *
 * Evicts from the least-recently-used end, but skips the active page: the user is looking at it, so
 * tearing it down would blank the screen. The inner scan is what implements that skip — if the only
 * remaining candidate *is* the active page the loop breaks and the cache is briefly allowed to sit
 * one entry over budget until the next navigation.
 *
 * @returns {void}
 */
function evictIfNeeded() {
  while (cacheOrder.length > MAX_CACHED_EDITORS) {
    let evictId = null;
    for (let i = 0; i < cacheOrder.length; i++) {
      if (cacheOrder[i] !== currentPageId) {
        evictId = cacheOrder.splice(i, 1)[0];
        break;
      }
    }
    if (!evictId) break;
    const entry = cache.get(evictId);
    if (entry) destroyEntry(entry);
    cache.delete(evictId);
  }
}

/**
 * Fully tears down one cache entry: bots, popups, listeners, editor, provider, persistence, Yjs doc,
 * and finally the DOM node.
 *
 * The order matters — consumers (bots, tippy popups, DOM listeners) go before the editor, and the
 * editor before the Yjs layer it is bound to, so nothing fires against a half-disposed object.
 * Every step is individually wrapped in an empty `catch`: teardown runs during eviction and page
 * transitions, and one library throwing on an already-disposed handle must not strand the remaining
 * resources (most importantly the Firestore listeners inside the provider) as leaks.
 *
 * @param {CacheEntry|null|undefined} entry Entry to dispose; falsy input is a no-op.
 * @returns {void}
 */
function destroyEntry(entry) {
  if (!entry) return;
  if (entry.spellCheckerBot) { try { entry.spellCheckerBot.destroy(); } catch (e) {} entry.spellCheckerBot = null; }
  if (entry.voiceAssistant) { try { entry.voiceAssistant.destroy(); } catch (e) {} entry.voiceAssistant = null; }
  if (entry.formatTippy) { try { entry.formatTippy.destroy(); } catch (e) {} entry.formatTippy = null; }
  if (entry.linkTippy) { try { entry.linkTippy.destroy(); } catch (e) {} entry.linkTippy = null; }
  if (entry.detachSelectionListener) { try { entry.detachSelectionListener(); } catch (e) {} }
  if (entry.editor && !entry.editor.isDestroyed) { try { entry.editor.destroy(); } catch (e) {} }
  if (entry.provider) { try { entry.provider.destroy(); } catch (e) {} }
  if (entry.persistence) { try { entry.persistence.destroy(); } catch (e) {} }
  if (entry.ydoc) { try { entry.ydoc.destroy(); } catch (e) {} }
  if (entry.container && entry.container.parentElement) {
    entry.container.parentElement.removeChild(entry.container);
  }
}

/**
 * Snapshots the caret/selection onto the entry and mirrors it into `localStorage`.
 *
 * The in-memory copy covers navigation inside the session; the `insel-wiki-cursor-<pageId>` key
 * covers a full reload, where the whole cache is gone. Storage failures are swallowed — losing the
 * caret position is a cosmetic regression, never a reason to block a navigation.
 *
 * @param {CacheEntry} entry Entry being parked; ignored if its editor is missing or destroyed.
 * @returns {void}
 */
function persistSelection(entry) {
  if (!entry?.editor || entry.editor.isDestroyed) return;
  try {
    entry.selection = {
      anchor: entry.editor.state.selection.anchor,
      head: entry.editor.state.selection.head,
    };
    localStorage.setItem(`insel-wiki-cursor-${entry.pageId}`, JSON.stringify(entry.selection));
  } catch (e) {}
}

/**
 * Puts the caret back where {@link persistSelection} found it and focuses the editor.
 *
 * Positions are clamped to the current document size on purpose: the stored offsets may come from a
 * previous session or from before collaborators shortened the document, and an out-of-range
 * position would make ProseMirror throw. Clamping degrades to "somewhere sensible" instead.
 *
 * @param {CacheEntry} entry Entry being activated; ignored when no selection was recorded.
 * @returns {void}
 */
function restoreSelection(entry) {
  if (!entry?.editor || entry.editor.isDestroyed || !entry.selection) return;
  try {
    const docSize = entry.editor.state.doc.content.size;
    const anchor = Math.min(Math.max(0, entry.selection.anchor || 0), docSize);
    const head = Math.min(Math.max(0, (entry.selection.head ?? entry.selection.anchor) || 0), docSize);
    entry.editor.commands.setTextSelection({ from: anchor, to: head });
    entry.editor.commands.focus();
  } catch (e) {}
}

/**
 * Hides the active editor and puts it into standby, without destroying anything.
 *
 * Parking captures scroll offset and selection, hides the pane and both bubble popups, and suspends
 * the provider — which detaches the Firestore watchers and drops this user from the page's awareness
 * state. The Yjs doc and the IndexedDB persistence stay alive, so reactivation is instant; what is
 * given up is only the snapshot bandwidth and the misleading "is viewing this page" presence for a
 * page nobody is looking at.
 *
 * Clears {@link currentPageId} (and `window.editor`), so from here until the next
 * {@link activateEntry} no page counts as active.
 *
 * @returns {void} No-op when nothing is active.
 */
function parkActive() {
  const entry = _active();
  if (!entry) return;

  const scrollEl = entry.container.parentElement;
  entry.scrollTop = scrollEl ? scrollEl.scrollTop : 0;

  persistSelection(entry);

  entry.container.style.display = 'none';
  if (entry.formatTippy) entry.formatTippy.hide();
  if (entry.linkTippy) entry.linkTippy.hide();

  // The markdown `content` field is projected from Yjs server-side
  // (functions/projectYjsToMarkdown). Parking only needs to flush the Yjs
  // updates buffer, which the provider.suspend() call below handles.

  // Detach Firestore watchers + drop awareness doc. The ydoc and the IDB
  // persistence stay alive, so reactivation is still instant; we just stop
  // showing this user as "viewing" the parked page and stop paying for
  // snapshot bandwidth on hidden editors.
  if (entry.provider && typeof entry.provider.suspend === 'function') {
    try { entry.provider.suspend(); } catch (e) {}
  }

  if (window.editor === entry.editor) window.editor = null;
  currentPageId = null;
}

/**
 * Brings a parked entry back on screen — the inverse of {@link parkActive}.
 *
 * Shows the pane, makes it the active/most-recently-used page, resumes the provider, and repaints
 * the shared toolbar against this editor. Scroll and selection are restored in a
 * `requestAnimationFrame` because both need the pane's layout to have settled after the
 * `display:block`; doing it synchronously would scroll against a zero-height element.
 *
 * The provider catch-up is asynchronous and intentionally does not gate the UI: the pane already
 * shows IndexedDB-hydrated content, and remote updates merge in through the CRDT as they land.
 *
 * @param {CacheEntry} entry Cached entry to show.
 * @returns {void}
 */
function activateEntry(entry) {
  entry.container.style.display = 'block';
  bumpLRU(entry.pageId);
  currentPageId = entry.pageId;
  window.editor = entry.editor;

  // Re-attach Firestore listeners and republish awareness. Catchup is async
  // but doesn't gate the UI — the editor is already showing IDB-hydrated
  // content; remote updates merge in via CRDT as they arrive.
  if (entry.provider && typeof entry.provider.resume === 'function') {
    try { entry.provider.resume(); } catch (e) {}
  }

  // Restore scroll & selection on next frame so layout has settled.
  requestAnimationFrame(() => {
    const scrollEl = entry.container.parentElement;
    if (scrollEl && entry.scrollTop) scrollEl.scrollTop = entry.scrollTop;
    restoreSelection(entry);
  });

  if (formatToolbarRef && entry.editor) updateToolbarState(formatToolbarRef, entry.editor);
}

// --- Public API ---

/**
 * Activate (or create) the editor for a given page. Idempotent: if the page is
 * already cached, this re-shows the existing editor instead of rebuilding it.
 *
 * Three paths, cheapest first:
 * 1. **Already active** — returns immediately; `onReady` fires synchronously because there is
 *    nothing to wait for.
 * 2. **Cached but parked** — {@link parkActive} on the outgoing page, {@link activateEntry} on this
 *    one, and `onReady` on the next frame so the caller's overlay is removed after the pane paints.
 * 3. **Cache miss** — delegates to {@link _createNewEditor}, which builds the whole stack and fires
 *    `onReady` once Yjs/IndexedDB have settled (or after a 3 s safety timeout).
 *
 * @param {HTMLElement} parentEl Container the editor pane is appended to (only used on a miss).
 * @param {string} pageId Firestore page id to open.
 * @param {{uid?: string, name?: string, color?: string}} user Signed-in user; supplies the
 *   collaboration cursor label/colour and the uploader id for pasted images.
 * @param {string} [initialContent] Markdown from Firestore, applied only as a fallback if the Yjs
 *   document is still empty once loading finishes.
 * @param {Function} [onReady] Called once the editor is usable — the page controller uses it to
 *   drop the loading overlay.
 * @returns {import('@tiptap/core').Editor} The editor for `pageId`, cached or freshly built.
 */
export function createEditor(parentEl, pageId, user, initialContent, onReady) {
  if (currentPageId === pageId && cache.has(pageId)) {
    if (onReady) onReady();
    return cache.get(pageId).editor;
  }

  if (currentPageId) parkActive();

  if (cache.has(pageId)) {
    activateEntry(cache.get(pageId));
    if (onReady) requestAnimationFrame(onReady);
    return cache.get(pageId).editor;
  }

  return _createNewEditor(parentEl, pageId, user, initialContent, onReady);
}

/**
 * Builds a complete editor stack for a page on a cache miss and registers it as the active entry.
 *
 * Assembly order, and why:
 * 1. **Pane + Yjs doc + IndexedDB persistence + provider** — local persistence is attached to the
 *    provider before `init()` so the provider knows it may skip a cold Firestore read.
 * 2. **{@link CacheEntry}** — created up front so the callbacks below can close over it.
 * 3. **Ready gating** — `fireReady` is idempotent and reachable from three racing sources: the
 *    provider's load callback, the IndexedDB `whenSynced` promise, and a 3 s timeout. Whichever wins
 *    reveals the editor; the timeout exists so a slow or unreachable Firebase (notably in CI) can
 *    never leave the UI stuck behind a loading overlay.
 * 4. **Extensions** (see the array below), **the Tiptap `Editor`** with its DOM/paste/drop handlers,
 *    then **bubble menus**, **event wiring**, and finally the optional **spell-check** and
 *    **voice** helpers.
 * 5. **Cache registration** — the entry is stored, marked most-recently-used, made active, and the
 *    cache is trimmed via {@link evictIfNeeded}.
 *
 * @param {HTMLElement} parentEl Container the new `.editor-pane` is appended to.
 * @param {string} pageId Firestore page id being opened.
 * @param {{uid?: string, name?: string, color?: string}} user Signed-in user (cursor identity +
 *   image-upload owner).
 * @param {string} [initialContent] Markdown fallback, applied by `fireReady` only when the Yjs
 *   document turned out empty.
 * @param {Function} [onReady] Invoked once, when the editor is ready to show.
 * @returns {import('@tiptap/core').Editor} The freshly created editor.
 */
function _createNewEditor(parentEl, pageId, user, initialContent, onReady) {
  const pane = document.createElement('div');
  pane.className = 'editor-pane';
  pane.dataset.pid = pageId;
  parentEl.appendChild(pane);

  const ydoc = new Y.Doc();

  // Local Yjs persistence — hydrates the doc instantly from past sessions so
  // the first paint doesn't wait on Firestore.
  let persistence = null;
  try {
    persistence = new IndexeddbPersistence(`insel-wiki-page-${pageId}`, ydoc);
  } catch (e) {
    console.warn('[Insel-Wiki] IndexedDB persistence unavailable:', e);
  }

  const provider = new FirestoreYjsProvider(pageId, ydoc, user);
  if (persistence) provider.setLocalPersistence(persistence);

  /** @type {CacheEntry} Mutable bundle for this page; `editor` is filled in a few lines below. */
  const entry = {
    pageId,
    editor: null,
    ydoc,
    provider,
    persistence,
    container: pane,
    scrollTop: 0,
    selection: null,
    spellCheckerBot: null,
    voiceAssistant: null,
    formatTippy: null,
    linkTippy: null,
    detachSelectionListener: null,
  };

  // Restore selection from a prior browser session (cold reloads benefit too).
  try {
    const saved = localStorage.getItem(`insel-wiki-cursor-${pageId}`);
    if (saved) entry.selection = JSON.parse(saved);
  } catch (e) {}

  /** @type {boolean} Latch making `fireReady` idempotent across its three racing callers. */
  let onReadyFired = false;
  /**
   * Reveals the editor: marks the pane synced, applies the markdown fallback if needed, notifies the
   * caller, and restores the caret.
   *
   * Races between the provider load callback, IndexedDB hydration, and the 3 s timeout are resolved
   * by the `onReadyFired` latch — first one wins, the rest are no-ops. The fallback content is only
   * applied when the editor is *still* empty and this page is *still* the active one, so a slow
   * Firestore markdown read can never overwrite Yjs content or bleed into a page the user has
   * meanwhile navigated to.
   *
   * @returns {void}
   */
  const fireReady = () => {
    if (onReadyFired) return;
    onReadyFired = true;
    pane.dataset.synced = 'true';

    // Apply fallback content if the editor is still empty after loading or timeout.
    // This ensures we show the Firestore Markdown content if Yjs is empty or slow.
    if (initialContent && entry.editor && entry.editor.isEmpty && currentPageId === pageId) {
      console.log(`[Insel-Wiki] Applying fallback content for ${pageId}`);
      setContentInternal(entry.editor, initialContent);
    }

    if (onReady) onReady();
    restoreSelection(entry);
  };

  provider.setLoadCallback(() => {
    // Allow Yjs binary state to settle and Tiptap extensions to sync before
    // hiding the loading overlay. 100ms is a safe buffer for CI stability.
    setTimeout(fireReady, 100);
  });

  // If IDB has prior state, surface it the moment hydrate completes — no waiting on Firestore.
  if (persistence) {
    persistence.whenSynced.then(() => {
      if (entry.editor && !entry.editor.isDestroyed && !entry.editor.isEmpty && currentPageId === pageId) {
        fireReady();
      }
    }).catch(() => {});
  }

  const linkMenuEl = document.getElementById('link-bubble-menu');
  const formatMenuEl = document.getElementById('format-bubble-menu');
  // Bubble menus are shared DOM. Wire global listeners exactly once.
  ensureBubbleMenuGlobalListeners(linkMenuEl, formatMenuEl);

  /**
   * Tiptap extension set for this editor.
   *
   * The non-obvious parts:
   * - **StarterKit** has `history`/`undoRedo` bound to `window.__E2E_DISABLE_COLLAB__`. Under
   *   collaboration the undo stack *must* come from Yjs, otherwise local history would undo remote
   *   edits; the flag flips it back on for single-user E2E runs. `codeBlock` and `link` are disabled
   *   here only so the standalone {@link CodeBlock} and the configured {@link Link} below can
   *   replace them without a duplicate-extension warning.
   * - **Mention** is extended (not just configured) so both the plain-text and HTML serialisations
   *   render `@Label` instead of the raw id — that is what makes mentions survive a markdown
   *   round trip and read correctly in notifications.
   * - **Link** is `inclusive: false` so typing right after a link does not extend the link mark,
   *   and `openOnClick: false` because navigation is handled by the click/dblclick handlers below
   *   (Ctrl+click for external, in-app routing for `#/` targets).
   * - **Collaboration/CollaborationCursor** are appended only when collaboration is enabled; the
   *   cursor `render` builds the caret + name label DOM, falling back to a translated "guest"
   *   label for users without a display name.
   *
   * @type {Array<import('@tiptap/core').Extension|import('@tiptap/core').Node|import('@tiptap/core').Mark>}
   */
  const extensions = [
    StarterKit.configure({
      history: !!window.__E2E_DISABLE_COLLAB__,
      undoRedo: !!window.__E2E_DISABLE_COLLAB__,
      codeBlock: false,
      link: false,
    }),
    CodeBlock,
    Comment,
    DateNode,
    Mention.extend({
      renderText({ node }) {
        return `@${node.attrs.label ?? node.attrs.id}`;
      },
      renderHTML({ node, HTMLAttributes }) {
        return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), `@${node.attrs.label ?? node.attrs.id}`];
      },
    }).configure({
      HTMLAttributes: { class: 'mention' },
      suggestion,
    }),
    Placeholder.configure({ placeholder: i18next.t('editor.placeholder') }),
    Image.configure({ inline: true }),
    Link.configure({
      autolink: true,
      openOnClick: false,
      HTMLAttributes: { class: 'editable-link' },
    }).extend({ inclusive: false }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: true }),
    TableRow,
    TableCell,
    TableHeader,
    VoiceGhost,
    CharacterCount.configure({ limit: 100000 }),
    ...(window.__E2E_DISABLE_COLLAB__ ? [] : [
      Collaboration.configure({ document: ydoc }),
      CollaborationCursor.configure({
        provider,
        user: { name: user.name, color: user.color },
        render(cursorUser) {
          const cursor = document.createElement('span');
          cursor.classList.add('collaboration-cursor__caret');
          cursor.setAttribute('style', `border-color: ${cursorUser.color}`);
          const label = document.createElement('div');
          label.classList.add('collaboration-cursor__label');
          label.setAttribute('style', `background-color: ${cursorUser.color}`);
          const displayName = cursorUser.name || i18next.t('common.guest');
          label.insertBefore(document.createTextNode(displayName), null);
          cursor.insertBefore(label, null);
          return cursor;
        },
      }),
    ]),
  ];

  /**
   * The Tiptap editor for this page.
   *
   * `window.editor` is kept pointing at the live instance (`onCreate`) and cleared on destroy, but
   * only when it still refers to *this* editor — a later page may already own the handle.
   *
   * @type {import('@tiptap/core').Editor}
   */
  const editor = new Editor({
    element: pane,
    extensions,
    autofocus: 'end',
    onCreate: ({ editor: ed }) => {
      window.editor = ed;
    },
    onDestroy: () => {
      if (window.editor === entry.editor) window.editor = null;
    },
    editorProps: {
      attributes: { class: 'tiptap' },
      handleDOMEvents: {
        /**
         * Ctrl/Cmd+click on a link follows it: `#…` targets route in-app via
         * {@link module:controllers/page.navigateTo}, everything else opens in a new tab.
         *
         * A plain click is deliberately *not* handled (the `Link` extension runs with
         * `openOnClick: false`) so clicking a link inside the editor places the caret for editing
         * instead of navigating away mid-sentence.
         *
         * @param {import('@tiptap/pm/view').EditorView} view Active ProseMirror view.
         * @param {MouseEvent} event The click.
         * @returns {boolean} `true` when the click was consumed as navigation.
         */
        click: (view, event) => {
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          if (pos === undefined) return false;
          const { schema } = view.state;
          const marks = view.state.doc.resolve(pos).marks();
          const linkMark = marks.find(mark => mark.type === schema.marks.link);
          const href = linkMark?.attrs?.href;
          if (href && (event.ctrlKey || event.metaKey)) {
            console.log('[Insel-Wiki] Link Ctrl+clicked:', href);
            if (href.startsWith('#')) {
              const parts = href.replace('#/', '').replace('#', '').split('/');
              navigateTo(parts[0]);
            } else {
              window.open(href, '_blank');
            }
            return true;
          }
          return false;
        },
        /**
         * The editor's keymap: custom list-outdent on Backspace plus the app-level shortcuts.
         *
         * **Backspace at the start of the first list item.** ProseMirror's default `joinBackward`
         * lifts the item but tends to leave nested sublists orphaned or re-wrapped oddly. This
         * handler instead performs the merge explicitly: it copies the item's inline content to the
         * end of the preceding block, re-inserts the item's *remaining* children after it — nested
         * lists spliced in as their own content, anything else re-wrapped in the original item type
         * so it stays schema-valid — deletes the now-empty item, and finally drops the caret at the
         * join point so typing continues where the text visually landed. Every insert shifts later
         * positions, which is what the running `shift` offset accounts for; the delete range is
         * computed with that same offset rather than from the stale original positions.
         *
         * **Shortcuts.** `Ctrl/Cmd+Alt+1/2/3` toggle headings and `+C` a code block (`event.code` is
         * used so the digits work on non-US layouts); `Ctrl/Cmd+K` opens the link modal, pre-filled
         * with the current href and selected text; `Ctrl/Cmd+Enter` inserts a horizontal rule.
         *
         * **`Ctrl/Cmd+S`** does *not* save markdown — edits already live in Yjs and the `content`
         * field is projected server-side — it only flushes the provider's buffered updates so the
         * user's habitual save gesture has an immediate, meaningful effect.
         *
         * @param {import('@tiptap/pm/view').EditorView} view Active ProseMirror view.
         * @param {KeyboardEvent} event The key press.
         * @returns {boolean} `true` when the key was handled here; `false` lets Tiptap's own keymap
         *   (bold, italic, list toggles, …) take over.
         */
        keydown: (view, event) => {
          const { ctrlKey, metaKey, altKey, shiftKey, code, key } = event;
          const isMod = ctrlKey || metaKey;
          
          if (key === 'Backspace') {
            const { state } = view;
            const { selection } = state;
            if (selection.empty && selection.$from.parentOffset === 0) {
              const depth = selection.$from.depth;
              const isInsideList = depth >= 1 && (
                selection.$from.node(depth - 1).type.name === 'listItem' || 
                selection.$from.node(depth - 1).type.name === 'taskItem'
              );
              if (isInsideList && selection.$from.index(depth - 1) === 0) {
                const listStart = selection.$from.before(depth - 1);
                if (listStart > 0) {
                  const prevSelection = Selection.near(state.doc.resolve(listStart - 1), -1);
                  if (prevSelection && prevSelection.$to && prevSelection.$to.pos < listStart) {
                    const prevEndPos = prevSelection.$to.pos;
                    const content = selection.$from.parent.content;
                    
                    const tr = state.tr;
                    tr.insert(prevEndPos, content);
                    
                    let shift = content.size;
                    
                    const listItemNode = selection.$from.node(depth - 1);
                    const nestedNodes = [];
                    for (let i = 1; i < listItemNode.childCount; i++) {
                      nestedNodes.push(listItemNode.child(i));
                    }
                    
                    for (const nestedNode of nestedNodes) {
                      const insertPos = selection.$from.before(depth - 1) + shift;
                      if (nestedNode.type.name === 'bulletList' || nestedNode.type.name === 'orderedList' || nestedNode.type.name === 'taskList') {
                        tr.insert(insertPos, nestedNode.content);
                        shift += nestedNode.content.size;
                      } else {
                        const wrapperType = selection.$from.node(depth - 1).type;
                        const wrappedNode = wrapperType.createAndFill(null, nestedNode);
                        if (wrappedNode) {
                          tr.insert(insertPos, wrappedNode);
                          shift += wrappedNode.nodeSize;
                        } else {
                          tr.insert(insertPos, nestedNode);
                          shift += nestedNode.nodeSize;
                        }
                      }
                    }
                    
                    const deleteStart = selection.$from.before(depth - 1) + shift;
                    const deleteEnd = selection.$from.after(depth - 1) + shift;
                    tr.delete(deleteStart, deleteEnd);
                    
                    tr.setSelection(Selection.near(tr.doc.resolve(prevEndPos)));
                    view.dispatch(tr);
                    event.preventDefault();
                    return true;
                  }
                }
              }
            }
          }
          
          if (isMod && altKey && !shiftKey) {
            if (code === 'Digit1') { editor.chain().focus().toggleHeading({ level: 1 }).run(); return true; }
            if (code === 'Digit2') { editor.chain().focus().toggleHeading({ level: 2 }).run(); return true; }
            if (code === 'Digit3') { editor.chain().focus().toggleHeading({ level: 3 }).run(); return true; }
            if (code === 'KeyC')   { editor.chain().focus().toggleCodeBlock().run(); return true; }
          }
          if (isMod && key === 'k') {
            event.preventDefault();
            (async () => {
              const { href } = editor.getAttributes('link');
              if (editor.isActive('link')) editor.chain().focus().extendMarkRange('link').run();
              const { state } = editor;
              const { from, to } = state.selection;
              const selectedText = state.doc.textBetween(from, to, ' ');
              const linkData = await linkModal(href || '', selectedText || '');
              if (linkData) {
                editor.chain().focus()
                  .extendMarkRange('link')
                  .insertContent({
                    type: 'text',
                    text: linkData.text,
                    marks: [{ type: 'link', attrs: { href: linkData.url } }]
                  })
                  .run();
              }
            })();
            return true;
          }
          if (isMod && key === 's') {
            event.preventDefault();
            // Edits live in Yjs (the source of truth); the markdown `content`
            // field is projected server-side. A manual save just flushes the
            // buffered Yjs updates to Firestore immediately.
            if (entry.provider) entry.provider.flushPending();
            return true;
          }
          if (isMod && key === 'Enter') {
            editor.chain().focus().setHorizontalRule().run();
            return true;
          }
          return false;
        },
        /**
         * Double-click on a link follows it without any modifier — the discoverable counterpart to
         * the Ctrl+click path, using the same in-app vs. new-tab split.
         *
         * @param {import('@tiptap/pm/view').EditorView} view Active ProseMirror view.
         * @param {MouseEvent} event The double click.
         * @returns {boolean} `true` when a link was followed, `false` to fall back to word select.
         */
        dblclick: (view, event) => {
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          if (pos === undefined) return false;
          const { schema } = view.state;
          const marks = view.state.doc.resolve(pos).marks();
          const linkMark = marks.find(mark => mark.type === schema.marks.link);
          const href = linkMark?.attrs?.href;
          if (href) {
            console.log('[Insel-Wiki] Link double-clicked:', href);
            if (href.startsWith('#')) {
              const parts = href.replace('#/', '').replace('#', '').split('/');
              navigateTo(parts[0]);
            } else {
              window.open(href, '_blank');
            }
            return true;
          }
          return false;
        }
      },
      /**
       * Intercepts pasted images (screenshots, copied pictures) and uploads them to Storage.
       *
       * Returning `true` synchronously claims the paste, while the upload runs in the background —
       * ProseMirror's paste hook cannot await. The image node is therefore inserted only once the
       * URL resolves; a failed upload surfaces as a toast and simply inserts nothing rather than
       * leaving a broken `blob:` reference in a document other people also see. Non-image payloads
       * return `false` and take Tiptap's normal HTML/text paste path.
       *
       * @param {import('@tiptap/pm/view').EditorView} view Active ProseMirror view.
       * @param {ClipboardEvent} event The paste event carrying the clipboard items.
       * @param {import('@tiptap/pm/model').Slice} slice Parsed slice Tiptap would otherwise insert.
       * @returns {boolean} `true` when at least one image item was taken over.
       */
      handlePaste: (view, event, slice) => {
        const items = Array.from(event.clipboardData?.items || []);
        const imageItems = items.filter(item => item.type.startsWith('image/'));
        if (imageItems.length > 0) {
          event.preventDefault();
          imageItems.forEach(async item => {
            const file = item.getAsFile();
            if (!file) return;
            try {
              const url = await uploadImageFile(file, user?.uid || 'guest');
              if (editor && url) editor.chain().focus().setImage({ src: url }).run();
            } catch (err) {
              console.error('Image upload failed', err);
              showToast(i18next.t('messages.imageUploadError') + err.message, 'error');
            }
          });
          return true;
        }
        return false;
      },
      /**
       * Uploads image files dropped onto the editor, mirroring {@link handlePaste}'s behaviour.
       *
       * `moved` is checked first: a truthy value means the user dragged content *within* the
       * document, which must keep ProseMirror's move semantics instead of being treated as a file
       * import. Non-image files fall through untouched.
       *
       * @param {import('@tiptap/pm/view').EditorView} view Active ProseMirror view.
       * @param {DragEvent} event The drop event.
       * @param {import('@tiptap/pm/model').Slice} slice Slice being dropped.
       * @param {boolean} moved `true` for an internal drag-move.
       * @returns {boolean} `true` when at least one dropped image was taken over.
       */
      handleDrop: (view, event, slice, moved) => {
        if (!moved && event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length > 0) {
          const files = Array.from(event.dataTransfer.files).filter(file => file.type.startsWith('image/'));
          if (files.length > 0) {
            event.preventDefault();
            files.forEach(async file => {
              try {
                const url = await uploadImageFile(file, user?.uid || 'guest');
                if (editor && url) editor.chain().focus().setImage({ src: url }).run();
              } catch (err) {
                console.error('Image upload failed', err);
                showToast(i18next.t('messages.imageUploadError') + err.message, 'error');
              }
            });
            return true;
          }
        }
        return false;
      }
    },
    // No onUpdate markdown projection: edits flow into Yjs (Collaboration
    // extension) and are persisted by FirestoreYjsProvider; the markdown
    // `content` field is projected from Yjs server-side
    // (functions/projectYjsToMarkdown).
  });

  entry.editor = editor;

  /**
   * Anchor rect for both bubble popups: where the current selection is on screen.
   *
   * Prefers the live DOM range, which hugs the actual highlighted text across line wraps. When the
   * selection is collapsed (or the browser reports no range) it falls back to a zero-width rect at
   * the caret, so the popup still has something sane to point at.
   *
   * Passed to tippy as `getReferenceClientRect`, i.e. re-evaluated on every show/reposition.
   *
   * @returns {DOMRect} Viewport-relative rect of the selection or caret.
   */
  function getSelectionBoundingRect() {
    const { view, state } = editor;
    const { selection } = state;
    const domSelection = window.getSelection();
    if (domSelection && domSelection.rangeCount > 0 && !domSelection.isCollapsed) {
      return domSelection.getRangeAt(0).getBoundingClientRect();
    }
    const coords = view.coordsAtPos(selection.from);
    return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
  }

  /** @type {Object|null} Popup showing the format bubble menu over a non-empty selection. */
  let formatTippy = null;
  /** @type {Object|null} Popup showing the link bubble menu while the caret sits inside a link. */
  let linkTippy = null;

  if (formatMenuEl) {
    formatTippy = tippy(pane, {
      content: formatMenuEl,
      interactive: true,
      trigger: 'manual',
      placement: 'top',
      appendTo: document.body,
      zIndex: 1000,
      getReferenceClientRect: getSelectionBoundingRect
    });

    /**
     * Applies a format bubble action (bold, italic, H1/H2, bullet list, date pill, link) to this
     * editor.
     *
     * Bound to the *shared* menu element, so the `currentPageId !== pageId` guard is essential: one
     * handler per live editor is attached to the same DOM node, and without the check a single
     * click would fan out to every parked editor and dirty their documents.
     *
     * `pointerdown` rather than `click` keeps the interaction on the same gesture that already
     * suppressed the blur, so the selection is still intact when the command runs. The trailing
     * timeout hides the popup only after the command has been applied — hiding immediately would
     * race the async link flow. The `link` case reuses the selected text as the default label and
     * expands to the full mark first, so editing an existing link replaces it wholesale instead of
     * nesting a second one.
     *
     * @param {PointerEvent} e Pointer event from the shared format menu.
     * @returns {Promise<void>} Resolves once the command (and any modal) has completed.
     */
    const handleFormatClick = async (e) => {
      const btn = e.target.closest('.format-bubble-action');
      if (!btn) return;
      // Shared bubble menu — only the active editor should react.
      if (currentPageId !== pageId) return;
      e.preventDefault(); e.stopPropagation();
      const action = btn.dataset.action;
      const chain = editor.chain().focus();
      switch (action) {
        case 'bold': chain.toggleBold().run(); break;
        case 'italic': chain.toggleItalic().run(); break;
        case 'h1': chain.toggleHeading({ level: 1 }).run(); break;
        case 'h2': chain.toggleHeading({ level: 2 }).run(); break;
        case 'bulletList': chain.toggleBulletList().run(); break;
        case 'date': chain.insertContent({ type: 'dateNode' }).run(); break;
        case 'link': {
          if (editor.isActive('link')) editor.chain().focus().extendMarkRange('link').run();
          const { from, to } = editor.state.selection;
          const selectedText = editor.state.doc.textBetween(from, to, ' ');
          const linkData = await linkModal('', selectedText);
          if (linkData) {
            editor.chain().focus()
              .extendMarkRange('link')
              .insertContent({
                type: 'text',
                text: linkData.text,
                marks: [{ type: 'link', attrs: { href: linkData.url } }]
              })
              .run();
          }
          break;
        }
      }
      setTimeout(() => { if (formatTippy) formatTippy.hide(); }, 100);
    };

    formatMenuEl.addEventListener('pointerdown', handleFormatClick);
  }

  if (linkMenuEl) {
    linkTippy = tippy(pane, {
      content: linkMenuEl,
      interactive: true,
      trigger: 'manual',
      placement: 'top',
      appendTo: document.body,
      zIndex: 1000,
      getReferenceClientRect: getSelectionBoundingRect,
      /**
       * Fills the link preview just before the popup appears.
       *
       * Internal `#/<pageId>/…` targets are resolved against the sidebar's page list and shown as
       * `📄 <Title>` — a raw hash URL tells the reader nothing. Internal links also drop
       * `target`/`rel` so they stay in the SPA, while external ones get
       * `target="_blank" rel="noopener noreferrer"`. Attributes are cleared rather than overwritten
       * because the same DOM element is reused for every link in every editor.
       *
       * @param {Object} instance The tippy instance being shown.
       * @returns {void}
       */
      onShow(instance) {
        const attrs = editor.getAttributes('link');
        const urlEl = instance.popper.querySelector('#bubble-link-url');
        if (urlEl && attrs.href) {
          urlEl.href = attrs.href;
          let displayText = attrs.href;
          let isInternal = false;
          if (attrs.href.startsWith('#/')) {
            isInternal = true;
            const parts = attrs.href.split('/');
            const pid = parts[1];
            const allPages = getAllPages();
            const page = allPages.find(p => p.id === pid);
            if (page) displayText = `📄 ${page.title}`;
          }
          urlEl.textContent = displayText;
          if (isInternal) {
            urlEl.removeAttribute('target');
            urlEl.removeAttribute('rel');
          } else {
            urlEl.target = '_blank';
            urlEl.rel = 'noopener noreferrer';
          }
        }
      }
    });

    /**
     * Handles the three link bubble actions: edit, unlink, and following the previewed URL.
     *
     * Carries the same `currentPageId !== pageId` guard as the format menu — the element is shared
     * across editors. Propagation is stopped for recognised targets so the click does not reach the
     * document-level handlers that would immediately dismiss the popup.
     *
     * Only internal (`#…`) previews are intercepted and routed through
     * {@link module:controllers/page.navigateTo}; external hrefs are left to the browser's native
     * `target="_blank"` handling.
     *
     * @param {MouseEvent} e Click event from the shared link menu.
     * @returns {Promise<void>} Resolves once the edit modal (if any) has been handled.
     */
    const handleLinkClick = async (e) => {
      const editBtn = e.target.closest('#bubble-link-edit');
      const unlinkBtn = e.target.closest('#bubble-link-unlink');
      const urlLink = e.target.closest('#bubble-link-url');
      // Shared bubble menu — only the active editor should react.
      if (currentPageId !== pageId) return;
      if (editBtn || unlinkBtn || urlLink) e.stopPropagation();
      if (editBtn) {
        e.preventDefault();
        const { href } = editor.getAttributes('link');
        editor.chain().focus().extendMarkRange('link').run();
        const { state } = editor;
        const { from, to } = state.selection;
        const selectedText = state.doc.textBetween(from, to, ' ');
        const linkData = await linkModal(href || '', selectedText);
        if (linkData) {
          editor.chain().focus()
            .extendMarkRange('link')
            .insertContent({
              type: 'text',
              text: linkData.text,
              marks: [{ type: 'link', attrs: { href: linkData.url } }]
            })
            .run();
          if (linkTippy) linkTippy.hide();
        }
      } else if (unlinkBtn) {
        e.preventDefault();
        editor.chain().focus().unsetLink().run();
        if (linkTippy) linkTippy.hide();
      } else if (urlLink) {
        const href = urlLink.getAttribute('href');
        if (href) {
          if (href.startsWith('#')) {
            e.preventDefault();
            const parts = href.replace('#/', '').replace('#', '').split('/');
            navigateTo(parts[0]);
            if (linkTippy) linkTippy.hide();
          }
        }
      }
    };

    linkMenuEl.addEventListener('click', handleLinkClick);
  }

  /**
   * Decides which bubble popup (if either) should currently be visible, and repositions it.
   *
   * Rules: the format menu shows for a focused, non-empty, non-link selection; the link menu shows
   * whenever the caret is inside a link. They are mutually exclusive by construction — the format
   * menu explicitly bows out on links so the two never overlap.
   *
   * "Focused" deliberately includes focus living inside one of the menus, otherwise interacting with
   * a menu button would hide the very menu being used. The `currentPageId !== pageId` early return
   * keeps parked editors from popping menus over the page the user is actually looking at.
   *
   * Runs on `selectionUpdate`, `transaction`, `focus`, and the document-level `selectionchange`
   * event — the last one catches selection changes the editor itself does not report.
   *
   * @returns {void}
   */
  function updateBubbleMenus() {
    if (!editor || editor.isDestroyed) return;
    if (currentPageId !== pageId) return; // parked editor — bubbles must stay hidden
    const { state, view } = editor;
    const { selection } = state;
    const isFocused = view.hasFocus() ||
                     (document.activeElement && (formatMenuEl?.contains(document.activeElement) || linkMenuEl?.contains(document.activeElement)));
    const isLink = editor.isActive('link');
    if (formatTippy) {
      if (isFocused && !selection.empty && !isLink) {
        formatTippy.setProps({ getReferenceClientRect: getSelectionBoundingRect });
        formatTippy.show();
      } else {
        formatTippy.hide();
      }
    }
    if (linkTippy) {
      if (isLink) {
        linkTippy.setProps({ getReferenceClientRect: getSelectionBoundingRect });
        linkTippy.show();
      } else {
        linkTippy.hide();
      }
    }
  }

  editor.on('selectionUpdate', updateBubbleMenus);
  editor.on('transaction', updateBubbleMenus);
  editor.on('focus', updateBubbleMenus);

  // Toolbar state must follow whichever editor is currently active.
  /**
   * Repaints the shared format toolbar's active-button states from this editor.
   *
   * Guarded on the active page for the same reason as the bubble handlers: every cached editor
   * fires transactions, but only the visible one may drive the single toolbar.
   *
   * @returns {void}
   */
  const toolbarBindUpdate = () => {
    if (formatToolbarRef && currentPageId === pageId) updateToolbarState(formatToolbarRef, editor);
  };
  editor.on('selectionUpdate', toolbarBindUpdate);
  editor.on('transaction', toolbarBindUpdate);

  /**
   * Document-level `selectionchange` bridge — catches caret moves the editor does not emit an event
   * for (native double-click word selection, drag-select release, mobile handles).
   *
   * Removed both by {@link CacheEntry.detachSelectionListener} on eviction and by the editor's own
   * `destroy` hook, so no listener survives its editor.
   *
   * @returns {void}
   */
  const onSelectionChange = () => updateBubbleMenus();
  document.addEventListener('selectionchange', onSelectionChange);
  entry.detachSelectionListener = () => document.removeEventListener('selectionchange', onSelectionChange);

  // Hide both popups when focus really left the editing surface. The 250ms delay is what makes
  // clicking a bubble button work at all: blur fires before the button receives focus, so an
  // immediate hide would destroy the menu mid-click. After the delay we re-check where focus
  // actually landed and keep the menus open if it is inside one of them.
  editor.on('blur', () => {
    setTimeout(() => {
      if (!pane.contains(document.activeElement) &&
          (!formatMenuEl || !formatMenuEl.contains(document.activeElement)) &&
          (!linkMenuEl || !linkMenuEl.contains(document.activeElement))) {
        if (formatTippy) formatTippy.hide();
        if (linkTippy) linkTippy.hide();
      }
    }, 250);
  });

  editor.on('destroy', () => {
    document.removeEventListener('selectionchange', onSelectionChange);
  });

  entry.formatTippy = formatTippy;
  entry.linkTippy = linkTippy;

  provider.init();

  // Fallback: if provider or IDB take too long, fire ready anyway so the UI doesn't hang.
  // This is especially important for CI/testing environments where Firebase might be slow.
  setTimeout(fireReady, 3000);

  if (isSpellCheckEnabled()) {
    entry.spellCheckerBot = new SpellCheckerBot(editor, provider);
    entry.spellCheckerBot.start();
  }

  entry.voiceAssistant = new VoiceAssistant(editor);
  /**
   * Reflects a dictation start/stop in the UI: refreshes the toolbar so the 🎤 button picks up its
   * recording state, and clears any leftover ghost text from the previous session.
   *
   * @param {boolean} isRecording Whether dictation is now running.
   * @returns {void}
   */
  entry.voiceAssistant.onStateChange = (isRecording) => {
    if (formatToolbarRef && currentPageId === pageId) {
      updateToolbarState(formatToolbarRef, editor);
    }
    // Clear ghost text on state change (start/stop)
    editor.commands.setVoiceTranscript('');
  };
  /**
   * Previews a not-yet-final transcript as {@link module:editor/VoiceGhost} ghost text at the
   * caret. It is a decoration only, so nothing enters the document (or Yjs) until the recogniser
   * commits the phrase.
   *
   * @param {string} transcript Interim recognition result.
   * @returns {void}
   */
  entry.voiceAssistant.onInterim = (transcript) => {
    // Show ghost text at cursor position
    editor.commands.setVoiceTranscript(transcript);
  };
  /**
   * Surfaces a dictation failure as a toast, preferring a translated message for the known error
   * code and falling back to the raw message when no translation exists (i18next echoes the key
   * back when it is missing, which is what the equality check detects).
   *
   * @param {string} code Machine-readable error code from the voice service.
   * @param {string} message Human-readable fallback message.
   * @returns {void}
   */
  entry.voiceAssistant.onError = (code, message) => {
    const key = `editor.voiceErrors.${code}`;
    const translated = i18next.t(key);
    if (translated && translated !== key) {
      showToast(translated, 'error');
    } else {
      showToast(message, 'error');
    }
  };

  cache.set(pageId, entry);
  bumpLRU(pageId);
  currentPageId = pageId;
  window.editor = editor;
  evictIfNeeded();

  if (formatToolbarRef) updateToolbarState(formatToolbarRef, editor);

  return editor;
}

// --- setContent / getMarkdown / etc. ---

/**
 * Replaces an editor's document with content given as Markdown (or raw HTML).
 *
 * Three normalisation steps stand between the input and Tiptap's schema:
 * 1. **Format sniffing** — a value that both starts with `<` and ends with `>` is treated as HTML
 *    and passed through; everything else goes through `marked` (GFM + hard breaks).
 * 2. **Task list rewiring** — GFM checkboxes render as `<ul><li><input type="checkbox">`, which
 *    Tiptap's `TaskList`/`TaskItem` do not recognise. The two regex passes re-tag them as
 *    `data-type="taskList"` / `data-type="taskItem"` with the checked state preserved.
 * 3. **Date pill revival** — the DOM is walked for bare `YYYY-MM-DD` text and each match is swapped
 *    for a `<span data-type="date">` so it parses back into a {@link module:editor/DateNode} pill.
 *    Text inside `CODE`, `PRE`, `A`, or an existing pill is skipped, matching the node's own rule
 *    that dates in code and URLs stay literal. Matches are collected first and replaced afterwards
 *    because mutating the tree while the `TreeWalker` is traversing it would invalidate the walk.
 *    The whole step is guarded on `window.DOMParser`, so a non-DOM environment simply gets the
 *    unenriched HTML.
 *
 * @param {import('@tiptap/core').Editor|null} editor Target editor; falsy input is a no-op.
 * @param {string} markdown Markdown (or HTML) to load; nullish is treated as empty.
 * @returns {void}
 */
function setContentInternal(editor, markdown) {
  if (!editor) return;

  let html = (markdown?.trim().startsWith('<') && markdown?.trim().endsWith('>'))
    ? markdown
    : marked.parse(markdown || '');

  if (typeof html === 'string') {
    html = html.replace(/<ul>\s*(<li[^>]*><input[^>]*type="checkbox"[^>]*>[\s\S]*?)<\/ul>/gi, '<ul data-type="taskList">$1</ul>');
    html = html.replace(/<li><input([^>]*)type="checkbox"([^>]*)>(.*?)<\/li>/gi, (match, p1, p2, text) => {
      const isChecked = p1.includes('checked') || p2.includes('checked');
      return `<li data-type="taskItem" data-checked="${isChecked}">${text}</li>`;
    });

    if (typeof window !== 'undefined' && window.DOMParser) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const walker = document.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null, false);
      const nodesToReplace = [];
      let n;
      while ((n = walker.nextNode())) {
        const parent = n.parentElement || (n.parentNode instanceof Element ? n.parentNode : null);
        if (parent && parent.closest && parent.closest('CODE, PRE, A, [data-type="date"], .date-pill')) continue;
        if (/\b\d{4}-\d{2}-\d{2}\b/.test(n.nodeValue)) nodesToReplace.push(n);
      }
      nodesToReplace.forEach(textNode => {
        const frag = document.createDocumentFragment();
        const parts = textNode.nodeValue.split(/(\b\d{4}-\d{2}-\d{2}\b)/);
        parts.forEach(part => {
          if (/^\d{4}-\d{2}-\d{2}$/.test(part)) {
            const span = document.createElement('span');
            span.setAttribute('data-type', 'date');
            span.setAttribute('data-date', part);
            span.textContent = part;
            frag.appendChild(span);
          } else if (part) {
            frag.appendChild(document.createTextNode(part));
          }
        });
        if (textNode.parentNode) {
          textNode.parentNode.replaceChild(frag, textNode);
        }
      });
      html = doc.body.innerHTML;
    }
  }

  editor.commands.setContent(html, true);
}

/**
 * Overwrites the active editor's document with the given Markdown.
 *
 * Under collaboration this is a *shared* mutation — it replaces the content for everyone on the
 * page — so it is reserved for deliberate loads (history restore, template insertion) rather than
 * routine saving.
 *
 * @param {string} markdown Markdown (or HTML) to load.
 * @returns {void} No-op when no editor is active.
 */
export function setContent(markdown) {
  const e = _active()?.editor;
  if (e) setContentInternal(e, markdown);
}

/**
 * Serialises the active document to Markdown via the shared Turndown instance.
 *
 * Used for export, diffing, and previews — not for persistence, which goes through Yjs and the
 * server-side projection.
 *
 * @returns {string} Markdown for the active page, or `''` when nothing is open.
 */
export function getMarkdown() {
  const e = _active()?.editor;
  if (!e) return '';
  return getTurndown().turndown(e.getHTML());
}

/**
 * Returns the active document as HTML, exactly as Tiptap renders it.
 *
 * @returns {string} HTML for the active page, or `''` when nothing is open.
 */
export function getHTML() {
  const e = _active()?.editor;
  if (!e) return '';
  return e.getHTML();
}

/**
 * Toggles the active editor between editable and read-only.
 *
 * Applies to the active editor only; parked editors keep whatever mode they were left in and are
 * re-evaluated by the page controller when they are reopened.
 *
 * @param {boolean} editable `true` for editing, `false` for read-only viewing.
 * @returns {void} No-op when no editor is active.
 */
export function setEditable(editable) {
  const e = _active()?.editor;
  if (e) e.setEditable(editable);
}

/**
 * Park the active editor (used by showEmptyState). The cache stays alive so a
 * subsequent navigation back is still instant.
 *
 * Named `destroyEditor` for historical reasons — it does not destroy anything. Actual teardown only
 * happens on LRU eviction or via {@link clearEditorCache}.
 *
 * @returns {void} No-op when nothing is active.
 */
export function destroyEditor() {
  if (currentPageId) parkActive();
}

/**
 * Clear all cached editors and their providers (used for E2E testing isolation).
 *
 * The hard reset: every entry is run through {@link destroyEntry}, the cache and its LRU order are
 * emptied, and the active-page/`window.editor` handles are cleared. Also exposed as
 * `window.clearEditorCache` so a Playwright spec can guarantee a clean slate between tests.
 *
 * @returns {void}
 */
export function clearEditorCache() {
  for (const entry of cache.values()) {
    destroyEntry(entry);
  }
  cache.clear();
  cacheOrder.length = 0;
  currentPageId = null;
  window.editor = null;
}
window.clearEditorCache = clearEditorCache;

/**
 * Returns the collaboration provider of the active page — the handle used for presence, manual
 * flushes, and sync status.
 *
 * @returns {import('./FirestoreYjsProvider.js').FirestoreYjsProvider|null} Active provider, or
 *   `null` when no page is open.
 */
export function getProvider() { return _active()?.provider || null; }
/**
 * Re-applies the spell-check setting to every cached editor, not just the visible one.
 *
 * Called when the user flips the preference: bots are started on entries that lack one and
 * destroyed on entries that have one, so a parked page does not come back with a stale bot still
 * rewriting words after the feature was switched off.
 *
 * @returns {void}
 */
export function reevaluateSpellCheck() {
  const enabled = isSpellCheckEnabled();
  cache.forEach((entry) => {
    if (enabled && !entry.spellCheckerBot) {
      entry.spellCheckerBot = new SpellCheckerBot(entry.editor, entry.provider);
      entry.spellCheckerBot.start();
    } else if (!enabled && entry.spellCheckerBot) {
      entry.spellCheckerBot.destroy();
      entry.spellCheckerBot = null;
    }
  });
}

/**
 * Returns the active Tiptap editor instance for callers that need direct command access.
 *
 * @returns {import('@tiptap/core').Editor|null} Active editor, or `null` when no page is open.
 */
export function getEditor() { return _active()?.editor || null; }

/**
 * True if there's a live editor for this page in the LRU cache. The page
 * controller uses this to decide whether to show the loading overlay — cache
 * hits paint instantly (no need to flash the skeleton), but cache misses must
 * cover the placeholder text "Beginne hier zu schreiben…" that Tiptap shows
 * for the empty document during the brief window before IDB or Firestore
 * content arrives.
 *
 * @param {string} pageId Page the controller is about to open.
 * @returns {boolean} `true` when the page can be shown instantly from cache.
 */
export function hasCachedEditor(pageId) {
  return cache.has(pageId);
}

// --- Format toolbar (single shared instance, retargets per active editor) ---

/**
 * Builds the single format toolbar and installs it at the top of `container`.
 *
 * One instance serves every page: the click handler resolves `_active().editor` at call time rather
 * than capturing an editor, which is what lets the toolbar keep working across navigations without
 * being rebuilt. The resulting element is stored in {@link formatToolbarRef} so
 * {@link activateEntry} and the per-editor transaction hooks can repaint its button states.
 *
 * Button labels and tooltips come from i18next, so the toolbar is built *after* translations are
 * loaded. Most actions are plain Tiptap command toggles; the interesting ones are `link` and
 * `image` (async, driven by a modal), `voice` (delegates to the entry's
 * {@link module:editor/VoiceAssistant}), and `comment`, which applies a `comment` mark with a
 * timestamp-derived id and then dispatches a window-level `add-comment` CustomEvent carrying that
 * id — the comments sidebar listens for it and opens the composer, keeping this module free of any
 * dependency on the comment UI.
 *
 * @param {HTMLElement} container Element the toolbar is inserted into as the first child.
 * @returns {HTMLElement} The created toolbar element.
 */
export function createFormatToolbar(container) {
  const toolbar = document.createElement('div');
  toolbar.className = 'format-toolbar';
  toolbar.innerHTML = `
    <button class="format-btn" data-action="bold" title="${i18next.t('editor.bold')} (Ctrl+B)"><b>B</b></button>
    <button class="format-btn" data-action="italic" title="${i18next.t('editor.italic')} (Ctrl+I)"><i>I</i></button>
    <button class="format-btn" data-action="strike" title="${i18next.t('editor.strike')} (Ctrl+Shift+X)">S̶</button>
    <button class="format-btn" data-action="code" title="${i18next.t('editor.code')} (Ctrl+E)">&lt;&gt;</button>
    <div class="divider"></div>
    <button class="format-btn" data-action="h1" title="${i18next.t('editor.h1')} (Ctrl+Alt+1)">H1</button>
    <button class="format-btn" data-action="h2" title="${i18next.t('editor.h2')} (Ctrl+Alt+2)">H2</button>
    <button class="format-btn" data-action="h3" title="${i18next.t('editor.h3')} (Ctrl+Alt+3)">H3</button>
    <div class="divider"></div>
    <button class="format-btn" data-action="bulletList" title="${i18next.t('editor.bulletList')} (Ctrl+Shift+8)">•</button>
    <button class="format-btn" data-action="orderedList" title="${i18next.t('editor.orderedList')} (Ctrl+Shift+7)">1.</button>
    <button class="format-btn" data-action="taskList" title="${i18next.t('editor.taskList')} (Ctrl+Shift+9)">☑</button>
    <div class="divider"></div>
    <button class="format-btn" data-action="blockquote" title="${i18next.t('editor.blockquote')} (Ctrl+Shift+B)">❝</button>
    <button class="format-btn" data-action="codeBlock" title="${i18next.t('editor.codeBlock')} (Ctrl+Alt+C)">▤</button>
    <button class="format-btn" data-action="horizontalRule" title="${i18next.t('editor.horizontalRule')} (Ctrl+Enter)">—</button>
    <div class="divider"></div>
    <button class="format-btn" data-action="link" title="${i18next.t('editor.link')} (Ctrl+K)">🔗</button>
    <button class="format-btn" data-action="image" title="${i18next.t('editor.image')}">🖼</button>
    <button class="format-btn" data-action="voice" title="${i18next.t('editor.voice')}">🎤</button>
    <button class="format-btn" data-action="comment" title="${i18next.t('editor.comment')}">💬</button>
  `;
  container.insertBefore(toolbar, container.firstChild);
  toolbar.addEventListener('click', async (e) => {
    const btn = e.target.closest('.format-btn');
    if (!btn) return;
    const editor = _active()?.editor;
    if (!editor) return;
    const action = btn.dataset.action;
    const chain = editor.chain().focus();
    switch (action) {
      case 'bold': chain.toggleBold().run(); break;
      case 'italic': chain.toggleItalic().run(); break;
      case 'strike': chain.toggleStrike().run(); break;
      case 'code': chain.toggleCode().run(); break;
      case 'h1': chain.toggleHeading({ level: 1 }).run(); break;
      case 'h2': chain.toggleHeading({ level: 2 }).run(); break;
      case 'h3': chain.toggleHeading({ level: 3 }).run(); break;
      case 'bulletList': chain.toggleBulletList().run(); break;
      case 'orderedList': chain.toggleOrderedList().run(); break;
      case 'taskList': chain.toggleTaskList().run(); break;
      case 'blockquote': chain.toggleBlockquote().run(); break;
      case 'codeBlock': chain.toggleCodeBlock().run(); break;
      case 'horizontalRule': chain.setHorizontalRule().run(); break;
      case 'date': chain.insertContent({ type: 'dateNode' }).run(); break;
      case 'link': {
        if (editor.isActive('link')) editor.chain().focus().extendMarkRange('link').run();
        const { from, to } = editor.state.selection;
        const selectedText = editor.state.doc.textBetween(from, to, ' ');
        const linkData = await linkModal('', selectedText);
        if (linkData) {
          editor.chain().focus()
            .extendMarkRange('link')
            .insertContent({
              type: 'text',
              text: linkData.text,
              marks: [{ type: 'link', attrs: { href: linkData.url } }]
            })
            .run();
        }
        break;
      }
      case 'image': {
        const src = await promptModal(i18next.t('editor.imageUrlPrompt'), 'https://...');
        if (src) chain.setImage({ src }).run();
        break;
      }
      case 'voice': {
        const entry = _active();
        if (entry && entry.voiceAssistant) {
          entry.voiceAssistant.toggle();
        }
        break;
      }
      case 'comment': {
        const commentId = `comment-${Date.now()}`;
        chain.setComment(commentId).run();
        const event = new CustomEvent('add-comment', { detail: { commentId } });
        window.dispatchEvent(event);
        break;
      }
    }
    updateToolbarState(toolbar, editor);
  });
  formatToolbarRef = toolbar;
  const ed = _active()?.editor;
  if (ed) updateToolbarState(toolbar, ed);
  return toolbar;
}

/**
 * Syncs the toolbar's `is-active` highlighting with the editor's current marks and node types.
 *
 * Driven from every transaction and selection change of the active editor, plus on
 * activation/creation, so the buttons always describe the caret's context. The `voice` case is the
 * exception: it reflects the {@link module:editor/VoiceAssistant} recording flag rather than a
 * document state, and toggles an extra `is-recording` class for its own pulse animation. Actions
 * with no case (link, image, comment, horizontal rule, date) have no persistent state and simply
 * end up unhighlighted.
 *
 * @param {HTMLElement|null} toolbar Toolbar to repaint.
 * @param {import('@tiptap/core').Editor|null} editor Editor to read state from.
 * @returns {void} No-op if either argument is missing.
 */
function updateToolbarState(toolbar, editor) {
  if (!toolbar || !editor) return;
  toolbar.querySelectorAll('.format-btn').forEach((btn) => {
    const action = btn.dataset.action;
    let isActive = false;
    switch (action) {
      case 'bold': isActive = editor.isActive('bold'); break;
      case 'italic': isActive = editor.isActive('italic'); break;
      case 'strike': isActive = editor.isActive('strike'); break;
      case 'code': isActive = editor.isActive('code'); break;
      case 'h1': isActive = editor.isActive('heading', { level: 1 }); break;
      case 'h2': isActive = editor.isActive('heading', { level: 2 }); break;
      case 'h3': isActive = editor.isActive('heading', { level: 3 }); break;
      case 'bulletList': isActive = editor.isActive('bulletList'); break;
      case 'orderedList': isActive = editor.isActive('orderedList'); break;
      case 'taskList': isActive = editor.isActive('taskList'); break;
      case 'blockquote': isActive = editor.isActive('blockquote'); break;
      case 'codeBlock': isActive = editor.isActive('codeBlock'); break;
      case 'voice': {
        const entry = _active();
        isActive = entry && entry.voiceAssistant && entry.voiceAssistant.isRecording;
        btn.classList.toggle('is-recording', isActive);
        break;
      }
    }
    btn.classList.toggle('is-active', isActive);
  });
}

