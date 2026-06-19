// Tiptap WYSIWYG Editor with Yjs collaboration + IndexedDB persistence + LRU page cache.
//
// Why an LRU cache? When the user clicks between pages we want navigation to feel
// like switching browser tabs: the editor for a previously visited page is kept
// alive (DOM + Tiptap + Yjs) and re-shown on revisit, so cursor and scroll
// position survive without round-tripping Firestore. y-indexeddb hydrates fresh
// editors locally so even cache-miss pages paint before the network responds.

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
import { joinBackward } from '@tiptap/pm/commands';
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
const cache = new Map();         // pageId -> CacheEntry
const cacheOrder = [];           // pageIds, most-recently-used last
const MAX_CACHED_EDITORS = 3;
let currentPageId = null;
let formatToolbarRef = null;     // single toolbar shared across pages

let turndownInstance = null;
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
let _bubbleMenuGlobalListenersInstalled = false;
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

function _active() { return currentPageId ? cache.get(currentPageId) : null; }

function bumpLRU(pageId) {
  const i = cacheOrder.indexOf(pageId);
  if (i >= 0) cacheOrder.splice(i, 1);
  cacheOrder.push(pageId);
}

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

  let onReadyFired = false;
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

  let formatTippy = null;
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
  const toolbarBindUpdate = () => {
    if (formatToolbarRef && currentPageId === pageId) updateToolbarState(formatToolbarRef, editor);
  };
  editor.on('selectionUpdate', toolbarBindUpdate);
  editor.on('transaction', toolbarBindUpdate);

  const onSelectionChange = () => updateBubbleMenus();
  document.addEventListener('selectionchange', onSelectionChange);
  entry.detachSelectionListener = () => document.removeEventListener('selectionchange', onSelectionChange);

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
  entry.voiceAssistant.onStateChange = (isRecording) => {
    if (formatToolbarRef && currentPageId === pageId) {
      updateToolbarState(formatToolbarRef, editor);
    }
    // Clear ghost text on state change (start/stop)
    editor.commands.setVoiceTranscript('');
  };
  entry.voiceAssistant.onInterim = (transcript) => {
    // Show ghost text at cursor position
    editor.commands.setVoiceTranscript(transcript);
  };
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

export function setContent(markdown) {
  const e = _active()?.editor;
  if (e) setContentInternal(e, markdown);
}

export function getMarkdown() {
  const e = _active()?.editor;
  if (!e) return '';
  return getTurndown().turndown(e.getHTML());
}

export function getHTML() {
  const e = _active()?.editor;
  if (!e) return '';
  return e.getHTML();
}

export function setEditable(editable) {
  const e = _active()?.editor;
  if (e) e.setEditable(editable);
}

/**
 * Park the active editor (used by showEmptyState). The cache stays alive so a
 * subsequent navigation back is still instant.
 */
export function destroyEditor() {
  if (currentPageId) parkActive();
}

/**
 * Clear all cached editors and their providers (used for E2E testing isolation).
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

export function getProvider() { return _active()?.provider || null; }
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

export function getEditor() { return _active()?.editor || null; }

/**
 * True if there's a live editor for this page in the LRU cache. The page
 * controller uses this to decide whether to show the loading overlay — cache
 * hits paint instantly (no need to flash the skeleton), but cache misses must
 * cover the placeholder text "Beginne hier zu schreiben…" that Tiptap shows
 * for the empty document during the brief window before IDB or Firestore
 * content arrives.
 */
export function hasCachedEditor(pageId) {
  return cache.has(pageId);
}

// --- Format toolbar (single shared instance, retargets per active editor) ---

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

