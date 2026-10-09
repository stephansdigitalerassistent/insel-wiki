/**
 * @module controllers/page
 * @description
 * Page Controller managing page lifecycle, navigation, auto-saving, snapshots,
 * local-first UI optimizations, and coordinating with the editor cache.
 *
 * ### Navigation & Editor Parking Contract
 * This module is the primary consumer of {@link createEditor} and coordinates the client-side
 * page navigation flow. Because the editor module maintaining an LRU cache keeps editor instances
 * (including Tiptap, Yjs, and IndexedDB providers) alive for previously visited pages, navigation
 * follows a cooperative lifecycle to achieve instantaneous transitions while minimizing Firestore
 * bandwidth:
 *
 * 1. **Leave / Deactivation**:
 *    - When moving away from `currentPageId`, we flush any pending debounced title updates
 *      ({@link debouncedUpdateTitle}) or markdown edits ({@link debouncedSyncMarkdownToEditor}).
 *    - We fire off a history snapshot ({@link snapshotCurrentPage}) to persist a checkpoint.
 *    - We synchronously unsubscribe from active page updates (`currentPageUnsub`) and presence
 *      updates (`currentPresenceUnsub`), and empty active collab cursor avatars.
 *
 * 2. **Optimistic Pre-load**:
 *    - We immediately update the active page ID (`currentPageId`), set the sidebar active state
 *      (via {@link setActivePage}), and load the page metadata (title) from `localStorage`
 *      (`cache_page_${pageId}`) to make header updates feel instant.
 *    - If the editor is not yet loaded in the cache (verified via {@link hasCachedEditor}), we show a
 *      skeleton loading overlay (`loadingOverlay`) to prevent flashing Tiptap placeholder text.
 *    - A Firestore fetch for fresh page data is initiated in parallel.
 *
 * 3. **Editor Handshake**:
 *    - We call {@link createEditor}, which handles editor retrieval/setup. Internally, `createEditor`
 *      automatically invokes {@link parkActive} on the outgoing editor (suspending its Yjs provider and
 *      hiding its DOM container) and either brings the incoming cached editor on-screen (via {@link activateEntry})
 *      or initializes a new one.
 *    - When the editor is ready, its callback runs, hiding the loading overlay and displaying the editor element.
 *
 * 4. **Post-load Hooking**:
 *    - We subscribe to the new editor's Yjs provider status to track and show live collaborative save status,
 *      and listen for presence/awareness updates (re-rendering collaborator avatars in the header).
 *    - We schedule a deferred, non-blocking link healing routine ({@link selfHealLinks}) to resolve internal links.
 *    - We re-subscribe to Firestore page updates to catch remote changes (e.g. from the DevOps-Bot).
 *
 * ### Save Status & Read-only Mode
 * The save status aggregation consolidates rapid Yjs synchronization events and debounced title updates into
 * a single user-facing indicator ("Speichern...", "Gespeichert", or "Offline"). Additionally, permissions are
 * verified via `canEdit()` to lock/unlock fields (title inputs, formatting toolbars, markdown mode toggles).
 */
import { createPage, getPage, createHistorySnapshot, getLatestHistorySnapshot, getFullHistoryContent, updatePageTitle, deletePage, getChildren, formatTimestamp, setBotAction } from '../firebase/firestore.js';
import { renderBotBanner } from '../components/bot-banner.js';
import { createEditor, setContent, getMarkdown, getHTML, setEditable, destroyEditor, createFormatToolbar, getProvider, getEditor, hasCachedEditor } from '../editor/editor.js';
import { initSidebar, setActivePage, getBreadcrumb, getAllPages } from '../components/sidebar.js';
import { loadHistory, toggleHistoryPanel, closeHistoryPanel } from '../components/history.js';
import { loadCommentsForPage } from '../components/comments.js';
import { promptModal, newPageModal, confirmModal, markdownWarningModal, translateModal, followupMeetingModal } from '../components/modal.js';
import { generateFollowupMeetingMarkdown } from '../utils/series-helper.js';
import { showToast } from '../components/toast.js';
import { canEdit, getCurrentUser, isLoggedIn } from '../firebase/auth.js';
import { formatDefaultName, slugify, getColorForEmail, getInitials } from '../utils/string.js';
import { resolveSnapshotAttribution } from '../utils/attribution.js';
import { subscribeToPage } from '../firebase/firestore.js';
import { auth } from '../firebase/config.js';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import i18next from '../i18n.js';
import { initTranslationView, enterTranslationMode, exitTranslationMode, getIsTranslationMode } from './translation-view.js';
import { initUsersView, enterUsersView, exitUsersView, getIsUsersViewActive } from './users-view.js';
import { openPresentation, closePresentation, isPresentationOpen, updatePresentation } from '../components/presentation.js';

export { enterTranslationMode, exitTranslationMode, getIsTranslationMode, enterUsersView, exitUsersView, getIsUsersViewActive };

// --- State ---

/**
 * The Firestore ID of the currently loaded page.
 * @type {string|null}
 */
let currentPageId = null;

/**
 * Cached Firestore document data of the currently loaded page.
 * @type {Object|null}
 */
let currentPageData = null;

/**
 * Unsubscribe function for the active Firestore page document listener.
 * @type {Function|null}
 */
let currentPageUnsub = null;

/**
 * Unsubscribe function for the active page's Yjs provider presence/awareness listener.
 * @type {Function|null}
 */
let currentPresenceUnsub = null;

/**
 * DOM reference to the global formatting toolbar container.
 * @type {HTMLElement|null}
 */
let formatToolbar = null;

/**
 * Markdown source content of the last captured history snapshot, used to skip redundant saves.
 * History optimization: Snapshots are gated purely by content comparison
 * against the last snapshot (see {@link snapshotCurrentPage}) now that the client no
 * longer has a markdown-save hook to flag dirtiness.
 * @type {string}
 */
let lastSnapshotContent = '';
let lastSnapshotTitle = '';

/**
 * Whether *this* client's user typed in the title input since the last snapshot.
 *
 * `pageTitleInput.value` is also written by the page subscription when a remote user renames
 * the page, so a plain `title !== lastSnapshotTitle` comparison cannot tell a local rename
 * from a remote one — and treating a remote rename as local work is exactly how a passive
 * viewer ends up signing someone else's snapshot.
 * @type {boolean}
 */
let titleEditedLocally = false;

/**
 * In-flight snapshot write, if any. `lastSnapshotContent` only advances once the write
 * resolves, so two overlapping calls would both pass the content guard and store the same
 * version twice.
 * @type {Promise<void>|null}
 */
let snapshotInFlight = null;

/**
 * Whether a snapshot was requested while one was already being written. The content may have
 * moved on since that write was prepared, so one more run is scheduled when it resolves.
 * @type {boolean}
 */
let snapshotQueued = false;

// --- Utilities ---
/**
 * Debounces execution of a callback function.
 *
 * @param {Function} callback - Function to run.
 * @param {number} delayMs - Delay in milliseconds.
 * @returns {Function} Debounced function wrapper.
 */
function debounce(callback, delayMs) {
  let timer;
  let lastArgs;
  const debounced = (...args) => {
    lastArgs = args;
    clearTimeout(timer);
    timer = setTimeout(() => {
      callback(...args);
      timer = null;
    }, delayMs);
  };
  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer);
      callback(...lastArgs);
      timer = null;
    }
  };
  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  debounced.isPending = () => {
    return !!timer;
  };
  return debounced;
}

function setDocumentTitle(pageTitle) {
  document.title = `Insel-Wiki - ${pageTitle || i18next.t('common.untitled', { defaultValue: 'Ohne Titel' })}`;
}

/**
 * Debounced Firestore title update to merge rapid user keypresses.
 *
 * @type {Function}
 */
const debouncedUpdateTitle = debounce(async (id, title) => {
  if (!id || !canEdit() || getIsTranslationMode()) return;
  pendingTitleSaves++;
  recomputeSaveStatus();
  try {
    await updatePageTitle(id, title);
    saveErrored = false;
  } catch (err) {
    console.error('Title save error:', err);
    saveErrored = true;
  } finally {
    pendingTitleSaves--;
    recomputeSaveStatus();
  }
}, 800);

// --- Save status aggregator ---
// The visible "Gespeichert / Speichern…" indicator reflects the union of
// two concurrent write streams: live Yjs updates (every keystroke during
// editing) and debounced title saves. The markdown `content` field is no longer
// written by the client — it is projected from Yjs server-side
// (functions/projectYjsToMarkdown) — so it is not part of this aggregate. We
// coalesce rapid bursts so the label doesn't flicker on every keystroke.
let pendingTitleSaves = 0;
let saveErrored = false;
let savedSettleTimer = null;
let yjsStatusUnsub = null;

/**
 * Determines whether there are any pending content or title updates in-flight.
 * Checks debounced local updates and the Yjs provider's unsaved buffers.
 *
 * @returns {boolean} True if any save is pending.
 */
export function anySavePending() {
  if (pendingTitleSaves > 0) return true;
  const provider = getProvider();
  if (provider && provider.hasUnsavedChanges) return true;
  if (debouncedSyncMarkdownToEditor && debouncedSyncMarkdownToEditor.isPending() && !isMarkdownReadOnly) return true;
  return false;
}

/**
 * Flushes any pending changes in the raw markdown text editor into the Tiptap editor instance.
 *
 * @returns {void}
 */
export function flushMarkdownEditor() {
  if (isMarkdownMode && markdownEditor && !isMarkdownReadOnly) {
    debouncedSyncMarkdownToEditor.flush();
  }
}

/**
 * Recomputes and updates the aggregate save status UI element.
 * Coalesces in-flight title updates, active Yjs sync states, and offline status.
 *
 * @returns {void}
 */
function recomputeSaveStatus() {
  if (getIsUsersViewActive()) {
    if (saveStatus) {
      saveStatus.classList.remove('saving', 'error', 'offline');
      saveStatus.className = 'save-status read-only-live-badge';
      saveStatus.innerHTML = '<span class="status-dot-pulse"></span> ' + i18next.t('editor.readOnlyLive', { defaultValue: 'Live synchronisiert (Schreibgeschützt)' });
    }
    return;
  }
  if (getIsTranslationMode()) {
    if (saveStatus) {
      saveStatus.classList.remove('saving', 'error', 'offline');
      saveStatus.textContent = i18next.t('editor.translationStatus', { defaultValue: 'KI-Übersetzung (Nur Leseansicht)' });
    }
    return;
  }
  if (saveErrored) {
    clearTimeout(savedSettleTimer);
    savedSettleTimer = null;
    setSaveStatus('error');
    return;
  }
  if (anySavePending()) {
    clearTimeout(savedSettleTimer);
    savedSettleTimer = null;
    setSaveStatus('saving');
    return;
  }
  // All clear — wait briefly so a fresh keystroke doesn't make the label
  // bounce from "Speichern…" → "Gespeichert" → "Speichern…" mid-typing.
  if (savedSettleTimer) return;
  savedSettleTimer = setTimeout(() => {
    savedSettleTimer = null;
    if (!anySavePending() && !saveErrored) setSaveStatus('saved');
  }, 500);
}

// --- DOM References (set during init) ---
let editorContainer, editorEl, pageTitleInput, saveStatus, breadcrumbEl;
let collabCursorsEl, emptyState, lastEditedBadge, loadingOverlay;
let historyBtn, printBtn, presentationBtn, addChildBtn, deletePageBtn, toolbarNewPageBtn, copyLinkBtn;
let markdownEditor, markdownToggleBtn;
let translatePageBtn, translationBanner, translationBannerText, exitTranslationBtn, translationPreviewEl, usersPreviewEl;
let isMarkdownMode = false;
let isMarkdownReadOnly = false;
let originalMarkdownValue = '';
let lastSyncedMarkdown = '';

const debouncedSyncMarkdownToEditor = debounce((markdown) => {
  if (currentPageId && canEdit() && !isMarkdownReadOnly) {
    setContent(markdown);
    lastSyncedMarkdown = markdown;
  }
}, 500);

let navigateCallback = null;

/**
 * Navigates to a page by updating the location hash or calling a custom callback.
 *
 * @param {string} pageId - Target page ID.
 * @param {string} [title] - Title used for slug-generation.
 * @returns {void}
 */
export function navigateTo(pageId, title = '') {
  if (navigateCallback) {
    navigateCallback(pageId, title);
  } else {
    window.location.hash = title ? `#/${pageId}/${slugify(title)}` : `#/${pageId}`;
  }
}

// --- Yjs Presence Helper ---
/**
 * Subscribes to awareness updates from the Yjs provider to track online users on the page.
 *
 * @param {Object} provider - The Yjs provider.
 * @param {Function} callback - Triggered with the current list of online users.
 * @returns {Function} Unsubscribe clean-up function.
 */
function subscribeToYjsPresence(provider, callback) {
  const handler = () => {
    const states = provider.awareness.getStates();
    const users = [];
    const seenEmails = new Set();
    
    states.forEach((state, clientId) => {
      if (state.user) {
        const u = state.user;
        const email = u.email || 'Gast';
        if (!seenEmails.has(email)) {
          seenEmails.add(email);
          users.push({
            id: clientId.toString(),
            email: email,
            name: u.name,
            photoURL: u.photoURL,
            color: u.color || getColorForEmail(email),
            initials: getInitials(u.name || email)
          });
        }
      }
    });
    callback(users);
  };
  
  provider.awareness.on('change', handler);
  handler();
  
  return () => {
    provider.awareness.off('change', handler);
  };
}

/**
 * Initializes DOM references and hooks global events (unload, visibility changes, key shortcuts).
 *
 * @param {Object} opts - Setup options.
 * @param {Function} opts.navigateTo - Router callback to execute navigation.
 * @returns {void}
 */
export function initPageController(opts) {
  editorContainer = document.getElementById('editor-container');
  editorEl = document.getElementById('editor');
  pageTitleInput = document.getElementById('page-title');
  saveStatus = document.getElementById('save-status');
  breadcrumbEl = document.getElementById('breadcrumb');
  collabCursorsEl = document.getElementById('collab-cursors');
  emptyState = document.getElementById('empty-state');
  lastEditedBadge = document.getElementById('last-edited-badge');
  loadingOverlay = document.getElementById('editor-loading-overlay');
  historyBtn = document.getElementById('history-btn');
  printBtn = document.getElementById('print-page-btn');
  presentationBtn = document.getElementById('presentation-btn');
  addChildBtn = document.getElementById('add-child-btn');
  deletePageBtn = document.getElementById('delete-page-btn');
  toolbarNewPageBtn = document.getElementById('toolbar-new-page-btn');
  copyLinkBtn = document.getElementById('copy-link-btn');
  markdownEditor = document.getElementById('markdown-editor');
  markdownToggleBtn = document.getElementById('markdown-toggle-btn');
  translatePageBtn = document.getElementById('translate-page-btn');
  translationBanner = document.getElementById('translation-banner');
  translationBannerText = document.getElementById('translation-banner-text');
  exitTranslationBtn = document.getElementById('exit-translation-btn');
  translationPreviewEl = document.getElementById('translation-preview');
  usersPreviewEl = document.getElementById('users-preview');

  navigateCallback = opts.navigateTo;

  // Setup action buttons
  document.getElementById('new-page-btn').addEventListener('click', () => handleNewPage());
  if (toolbarNewPageBtn) toolbarNewPageBtn.addEventListener('click', () => handleNewPage());
  const followupBtn = document.getElementById('toolbar-followup-btn');
  if (followupBtn) followupBtn.addEventListener('click', () => handleFollowupMeeting());
  // Fired by the `/` command palette in the editor.
  window.addEventListener('wiki:create-followup-meeting', () => handleFollowupMeeting());
  if (addChildBtn) addChildBtn.addEventListener('click', () => handleNewPage());
  if (deletePageBtn) deletePageBtn.addEventListener('click', handleDeletePage);
  if (historyBtn) historyBtn.addEventListener('click', handleHistoryToggle);
  if (printBtn) printBtn.addEventListener('click', () => window.print());
  if (presentationBtn) presentationBtn.addEventListener('click', handlePresentation);
  if (copyLinkBtn) copyLinkBtn.addEventListener('click', handleCopyLink);
  if (markdownToggleBtn) markdownToggleBtn.addEventListener('click', toggleMarkdownMode);
  if (translatePageBtn) translatePageBtn.addEventListener('click', handleTranslatePage);
  if (exitTranslationBtn) exitTranslationBtn.addEventListener('click', exitTranslationMode);

  initTranslationView({
    editorEl,
    markdownEditor,
    translationPreviewEl,
    pageTitleInput,
    markdownToggleBtn,
    translationBanner,
    translationBannerText,
    translatePageBtn,
    saveStatus,
    canEdit,
    recomputeSaveStatus,
    getCurrentPageData: () => currentPageData,
    getIsMarkdownMode: () => isMarkdownMode,
    getFormatToolbar: () => formatToolbar,
    sanitizeHtml: (dirty) => DOMPurify.sanitize(dirty)
  });

  initUsersView({
    editorEl,
    markdownEditor,
    translationPreviewEl,
    translationBanner,
    usersPreviewEl,
    pageTitleInput,
    markdownToggleBtn,
    translatePageBtn,
    saveStatus,
    getFormatToolbar: () => formatToolbar,
    recomputeSaveStatus
  });

  if (markdownEditor) {
    markdownEditor.addEventListener('input', () => {
      if (currentPageId && canEdit() && !isMarkdownReadOnly && !getIsTranslationMode()) {
        debouncedSyncMarkdownToEditor(markdownEditor.value);
        recomputeSaveStatus();
        if (isPresentationOpen()) debouncedUpdatePresentation();
        debouncedSnapshot();
      }
    });
  }

  document.getElementById('close-history').addEventListener('click', closeHistoryPanel);
  document.getElementById('empty-new-page').addEventListener('click', () => handleNewPage());

  pageTitleInput.addEventListener('input', () => {
    if (currentPageId && canEdit() && !getIsTranslationMode()) {
      titleEditedLocally = true;
      debouncedUpdateTitle(currentPageId, pageTitleInput.value);
      setDocumentTitle(pageTitleInput.value);
      if (isPresentationOpen()) debouncedUpdatePresentation();
      debouncedSnapshot();
    }
  });

  window.addEventListener('page-content-updated', (e) => {
    if (isPresentationOpen() && (!e.detail?.pageId || e.detail.pageId === currentPageId)) {
      debouncedUpdatePresentation();
    }
    const provider = getProvider();
    if (provider?.hasLocalEdits && (!e.detail?.pageId || e.detail.pageId === currentPageId)) {
      debouncedSnapshot();
    }
  });

  // Ctrl+S — edits live in Yjs (source of truth); a manual save just flushes
  // the buffered Yjs updates. The markdown `content` field is projected
  // server-side, so there is nothing to write from the client here.
  window.addEventListener('keydown', async (e) => {
    // Alt+P: Toggle Presentation Mode. Matched on `e.code`, not `e.key`:
    // macOS turns Option+P into 'π', which made the advertised shortcut dead
    // there, and Windows reports AltGr as Ctrl+Alt, so AltGr+P used to open the
    // presentation.
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyP') {
      e.preventDefault();
      if (isPresentationOpen()) {
        closePresentation();
      } else {
        handlePresentation();
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      if (currentPageId) {
        if (isMarkdownMode && markdownEditor && !isMarkdownReadOnly) {
          debouncedSyncMarkdownToEditor.flush();
        }
        debouncedUpdateTitle.flush();
        debouncedSnapshot.cancel();
        const provider = getProvider();
        if (provider) {
          await provider.flushPending();
          provider.compact().catch(err => {
            console.warn('[PageController] Compact failed:', err);
          });
        }
        snapshotCurrentPage();
      }
    }
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('online', recomputeSaveStatus);
    window.addEventListener('offline', recomputeSaveStatus);
  }

  // Flush pending writes whenever the tab is being closed or backgrounded.
  // Firestore's IndexedDB persistence queues these writes if the network is
  // unavailable, and replays them on next load.
  const flushAll = () => {
    if (isMarkdownMode && markdownEditor) {
      debouncedSyncMarkdownToEditor.flush();
    }
    debouncedUpdateTitle.flush();
    debouncedSnapshot.cancel();
    const provider = getProvider();
    if (provider) provider.flushPending();
    snapshotCurrentPage();
  };
  window.addEventListener('beforeunload', () => {
    if (!currentPageId) return;
    flushAll();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden' || !currentPageId) return;
    flushAll();
  });
}

/**
 * Returns the formatting toolbar DOM element reference.
 *
 * @returns {HTMLElement|null} The formatting toolbar.
 */
export function getFormatToolbar() { return formatToolbar; }

/**
 * Returns the page title input DOM element reference.
 *
 * @returns {HTMLInputElement|null} The page title input.
 */
export function getPageTitleInput() { return pageTitleInput; }

/**
 * Returns the current page ID.
 *
 * @returns {string|null} The current page ID.
 */
export function getCurrentPageId() { return currentPageId; }

/**
 * Initiates the page-loading and editor coordination lifecycle.
 * Coordinates with the editor cache to park/unpark editors, resolves optimistic metadata,
 * and sets up local and remote update listeners.
 *
 * @param {string} pageId - Target page ID to load.
 * @returns {Promise<void>}
 */
export async function loadPage(pageId) {
  if (isPresentationOpen()) {
    closePresentation();
  }
  if (getIsTranslationMode()) {
    exitTranslationMode();
  }

  // Skip if we're already on this page
  if (pageId === currentPageId) return;

  if (isMarkdownMode && markdownEditor) {
    if (!isMarkdownReadOnly) {
      debouncedSyncMarkdownToEditor.flush();
    }
    isMarkdownMode = false;
    isMarkdownReadOnly = false;
    markdownEditor.readOnly = false;
    markdownEditor.classList.add('hidden');
    if (editorEl) editorEl.style.display = 'block';
    if (markdownToggleBtn) markdownToggleBtn.classList.remove('active');
  } else {
    debouncedSyncMarkdownToEditor.cancel();
  }

  if (debouncedUpdateTitle) debouncedUpdateTitle.flush();
  debouncedSnapshot.cancel();

  // Fire-and-forget cleanup (don't block the new page load)
  const oldPageId = currentPageId;
  if (oldPageId) {
    snapshotCurrentPage().catch(() => {});
  }

  // Cleanup subscriptions synchronously (instant, no network)
  if (currentPageUnsub) { currentPageUnsub(); currentPageUnsub = null; }
  if (currentPresenceUnsub) { currentPresenceUnsub(); currentPresenceUnsub = null; }
  closeHistoryPanel();
  collabCursorsEl.innerHTML = '';

  // Show loading state immediately to improve perceived speed
  currentPageId = pageId;
  setActivePage(pageId);
  editorContainer.classList.remove('hidden');
  emptyState.classList.add('hidden');
  pageTitleInput.value = ''; // Clear title during load

  // Clean up any old static preview
  let staticPreview = document.getElementById('static-editor-preview');
  if (staticPreview) staticPreview.remove();

  // Optimistic UI: read page metadata from localStorage so the title appears
  // instantly. Yjs is the source of truth for content (hydrated from
  // IndexedDB by the editor itself), so the cached markdown content is only a
  // fallback for first-time loads on a new device.
  let page = null;
  try {
    const cachedJson = localStorage.getItem(`cache_page_${pageId}`);
    if (cachedJson) {
      page = JSON.parse(cachedJson);
      pageTitleInput.value = page.title || '';
      document.title = `Insel-Wiki - ${page.title || 'Ohne Titel'}`;
      currentPageData = page;
      updateBreadcrumb(pageId);
    }
  } catch (e) {}

  // Show the skeleton overlay whenever the editor isn't already in our LRU
  // cache. Cache hits paint with content immediately, but a fresh editor
  // mounts empty and would briefly flash the Tiptap placeholder text
  // "Beginne hier zu schreiben…" before IDB / Firestore content arrives.
  const editorIsCached = hasCachedEditor(pageId);
  if (!editorIsCached && loadingOverlay) loadingOverlay.classList.remove('hidden');

  // Fetch fresh page data
  const fetchPromise = getPage(pageId).then(freshPage => {
    if (!freshPage) {
      if (!page) showEmptyState();
      return null;
    }
    
    // Update cache for next time
    try {
      localStorage.setItem(`cache_page_${pageId}`, JSON.stringify(freshPage));
    } catch(e) {}
    
    currentPageData = freshPage;

    if (!page) {
      // No cache was used, update UI now
      document.title = `Insel-Wiki - ${freshPage.title || 'Ohne Titel'}`;
      pageTitleInput.value = freshPage.title || '';
      updateBreadcrumb(pageId);
    }
    return freshPage;
  });

  // If no cache, block until fetch completes
  if (!page) {
    page = await fetchPromise;
    if (!page) return;
  } else {
    // If we used cache, just let fetch complete in background
    fetchPromise.catch(console.error);
    currentPageData = page; // Set temporarily until fetch completes
    updateBreadcrumb(pageId);
  }

  // Track recently visited pages
  try {
    const recentJson = localStorage.getItem('recent_pages') || '[]';
    let recent = JSON.parse(recentJson);
    recent = recent.filter(p => p.id !== pageId);
    recent.unshift({ id: pageId, title: page.title, timestamp: Date.now() });
    if (recent.length > 10) recent = recent.slice(0, 10);
    localStorage.setItem('recent_pages', JSON.stringify(recent));
  } catch (e) {}

  // Reset aggregate save state for the new page; show "Gespeichert" on entry.
  pendingTitleSaves = 0;
  saveErrored = false;
  clearTimeout(savedSettleTimer);
  savedSettleTimer = null;
  setSaveStatus('saved');

  const user = getCurrentUser();
  const userName = user?.displayName || formatDefaultName(user?.email);
  const fullUser = {
    uid: user?.uid || null,
    name: userName,
    email: user?.email || '',
    photoURL: user?.photoURL || null,
    color: getColorForEmail(user?.email || 'Gast')
  };

  showBotBanner(page);

  // Create editor (Yjs provider.init() runs internally)
  createEditor(editorEl, pageId, fullUser, page.content || '', () => {
    if (loadingOverlay) loadingOverlay.classList.add('hidden');
    // Swap out static preview for real editor
    const staticPreview = document.getElementById('static-editor-preview');
    if (staticPreview) staticPreview.remove();
    if (!getIsUsersViewActive()) editorEl.style.display = 'block';
    if (isPresentationOpen()) syncPresentation(true);
  });

  // Subscribe to Yjs pending-write status so the indicator reflects in-flight
  // collaborative updates, not just explicit saves.
  if (yjsStatusUnsub) yjsStatusUnsub();
  const newProvider = getProvider();
  yjsStatusUnsub = newProvider ? newProvider.onStatusChange(recomputeSaveStatus) : null;

  // --- Defer Heavy Tasks (Link Healing) ---
  setTimeout(() => {
    // Only heal if we fetched fresh data and we are still on this page
    fetchPromise.then(freshPage => {
       if (freshPage && currentPageId === pageId) {
          // Cosmetic, session-local link healing of the cached fallback markdown.
          // We no longer write `content` here — it is projected from Yjs
          // server-side. Persisting healed link slugs would require editing the
          // Yjs doc (where the link marks actually live); see follow-up note.
          const { markdown: healedMarkdown, changed } = selfHealLinks(freshPage.content || '');
          if (changed) {
            freshPage.content = healedMarkdown;
            try { localStorage.setItem(`cache_page_${pageId}`, JSON.stringify(freshPage)); } catch (e) {}
          }
       }
    });
  }, 1000); // Defer by 1s to allow editor to fully render and idle

  const isUsersPage = pageId === 'hanspecathon-teilnehmende' || pageId === 'teilnehmende' || pageId === 'users' || page?.isUsersPage === true;

  if (isUsersPage) {
    if (getIsTranslationMode()) exitTranslationMode();
    enterUsersView(page);
    setEditable(false);
    pageTitleInput.readOnly = true;
    if (formatToolbar) formatToolbar.style.display = 'none';
    if (markdownToggleBtn) markdownToggleBtn.style.display = 'none';
    if (translatePageBtn) translatePageBtn.style.display = 'none';
    if (deletePageBtn) deletePageBtn.style.display = 'none';
    if (markdownEditor) markdownEditor.readOnly = true;
  } else {
    if (getIsUsersViewActive()) exitUsersView();
    if (deletePageBtn) deletePageBtn.style.display = canEdit() ? 'inline-flex' : 'none';
    if (translatePageBtn) translatePageBtn.style.display = 'inline-flex';
    if (!formatToolbar) {
      formatToolbar = createFormatToolbar(editorContainer);
    }
    if (formatToolbar) {
      formatToolbar.style.display = canEdit() ? 'flex' : 'none';
    }

    setEditable(canEdit());
    pageTitleInput.readOnly = !canEdit();
    if (markdownToggleBtn) {
      markdownToggleBtn.style.display = canEdit() ? 'inline-flex' : 'none';
    }
    if (markdownEditor) {
      markdownEditor.readOnly = !canEdit();
    }
  }

  // No periodic snapshot timer: snapshots are driven by editing (debouncedSnapshot, 30s
  // after a pause), by Ctrl+S, and by leaving the page. A timer only added a second copy
  // of the same version from every client that happened to have the page open.

  // Unload/visibilitychange handlers are registered once at controller init
  // (see initPageController). They read module-level state, so a single
  // registration covers every navigation.

  // --- Non-blocking parallel work (doesn't delay page render) ---
  // Subscribe to page updates
  currentPageUnsub = subscribeToPage(pageId, (updatedPage) => {
    if (updatedPage && updatedPage.id === currentPageId) {
      const oldBotStatus = currentPageData?.bot_status;
      const newBotStatus = updatedPage.bot_status;
      
      currentPageData = updatedPage;

      // 1. Update Title if not actively editing it
      if (!getIsTranslationMode() && document.activeElement !== pageTitleInput && updatedPage.title !== pageTitleInput.value) {
        pageTitleInput.value = updatedPage.title || '';
        document.title = `Insel-Wiki - ${updatedPage.title || 'Ohne Titel'}`;
      }

      // 2. Re-render the bot's banner when it moves the request on.
      //
      // This used to call setContent(updatedPage.content) to let the bot "take
      // over" the editor of whoever had the page open. That is what emptied a
      // proposal on 2026-08-31: the daemon had just deleted the Yjs document to
      // force a resync, this handler pushed the stale in-memory document back,
      // and the reader was left looking at a blank page with the approval
      // checkbox gone. The bot's state is its own fields now, so there is
      // nothing to force into the document and the document is never touched.
      if (newBotStatus !== oldBotStatus) {
        console.log(`[Insel-Wiki] Bot status: ${oldBotStatus || 'none'} -> ${newBotStatus || 'none'}`);
      }
      showBotBanner(updatedPage);

      updateBreadcrumb(pageId);
      if (isPresentationOpen()) debouncedUpdatePresentation();
      const slug = slugify(updatedPage.title || '');
      const newHash = `#/${pageId}/${slug}`;
      if (window.location.hash !== newHash) {
        window.history.replaceState(null, '', newHash);
      }
    }
  });

  // Comments and history snapshot — in parallel, non-blocking
  loadCommentsForPage(pageId);
  
  if (currentPresenceUnsub) { currentPresenceUnsub(); currentPresenceUnsub = null; }
  if (newProvider) {
    currentPresenceUnsub = subscribeToYjsPresence(newProvider, (users) => renderPresence(users));
  }

  // Baseline initial snapshot state from page data
  titleEditedLocally = false;
  lastSnapshotContent = page?.content || '';
  lastSnapshotTitle = page?.title || '';

  getLatestHistorySnapshot(pageId).then(async (snap) => {
    if (currentPageId === pageId) {
      if (snap) {
        lastSnapshotContent = await getFullHistoryContent(pageId, snap.id);
        lastSnapshotTitle = snap.title || '';
      } else if (page) {
        lastSnapshotContent = page.content || '';
        lastSnapshotTitle = page.title || '';
      }
    }
  }).catch(() => {});

  if (!page.title || page.title === 'Neue Seite') {
    setTimeout(() => { pageTitleInput.focus(); pageTitleInput.select(); }, 100);
  }
}

/**
 * Unloads the current page and displays the dashboard empty/new state.
 * Performs teardown on listeners, destroys the editor, and updates UI containers.
 *
 * @returns {void}
 */
/**
 * Draw the DevOps-Bot banner for `page`, and wire its buttons.
 *
 * A button writes one field and returns; the daemon picks the decision up on
 * its next sweep and answers by moving `bot_status`, which comes back through
 * the page subscription and redraws this banner. Nothing here touches the
 * collaborative document.
 */
function showBotBanner(page) {
  if (!editorContainer) return;
  renderBotBanner(editorContainer, page, async (action) => {
    const user = getCurrentUser();
    const email = user?.email || '';
    if (!email) {
      showToast(i18next.t('errors.notLoggedIn', 'Nicht angemeldet.'), 'error');
      throw new Error('not signed in');
    }
    try {
      await setBotAction(page.id, action, email);
    } catch (e) {
      // The approval gate lives in the daemon and in firestore.rules, so a
      // refused write is a real answer and must be visible. Swallowing it is
      // what made every earlier failure look like a dead bot.
      console.error('[Insel-Wiki] Bot action failed:', e);
      showToast(i18next.t('errors.botActionFailed', 'Aktion konnte nicht gesendet werden.'), 'error');
      throw e;
    }
  });
}

export function showEmptyState() {
  if (isPresentationOpen()) {
    closePresentation();
  }
  if (getIsUsersViewActive()) {
    exitUsersView();
  }
  if (getIsTranslationMode()) {
    exitTranslationMode();
  }

  if (isMarkdownMode && markdownEditor) {
    if (!isMarkdownReadOnly) {
      debouncedSyncMarkdownToEditor.flush();
    }
    isMarkdownMode = false;
    isMarkdownReadOnly = false;
    markdownEditor.readOnly = false;
    markdownEditor.classList.add('hidden');
    if (editorEl) editorEl.style.display = 'block';
    if (markdownToggleBtn) markdownToggleBtn.classList.remove('active');
  } else {
    debouncedSyncMarkdownToEditor.cancel();
  }
  debouncedSnapshot.cancel();
  snapshotCurrentPage();
  if (currentPresenceUnsub) { currentPresenceUnsub(); currentPresenceUnsub = null; }
  currentPageId = null;
  destroyEditor();
  editorContainer.classList.add('hidden');
  emptyState.classList.remove('hidden');
  if (loadingOverlay) loadingOverlay.classList.add('hidden');
  breadcrumbEl.innerHTML = '';
  if (collabCursorsEl) collabCursorsEl.innerHTML = '';
}

// --- Presence ---

/**
 * Re-paints the collaboration avatar presence list in the header.
 *
 * @param {Array<Object>} users - The list of active users.
 * @returns {void}
 */
function renderPresence(users) {
  if (!collabCursorsEl) return;
  collabCursorsEl.innerHTML = '';
  users.forEach(presenceUser => {
    const avatar = document.createElement('div');
    avatar.className = 'collab-avatar';
    avatar.style.backgroundColor = presenceUser.color;
    avatar.title = presenceUser.name || presenceUser.email;
    if (presenceUser.photoURL) {
      const img = document.createElement('img');
      img.src = presenceUser.photoURL;
      img.alt = presenceUser.name || presenceUser.initials;
      img.onerror = function() { this.onerror = null; this.src = '/favicon.svg'; };
      avatar.appendChild(img);
    } else {
      avatar.textContent = presenceUser.initials;
    }
    collabCursorsEl.appendChild(avatar);
  });
}

/**
 * Directly updates the save status indicator DOM element text and class list.
 * Translates status tokens ("saving", "saved", "error", "offline") using the localization engine.
 *
 * @param {string} status - Save status state token.
 * @returns {void}
 */
function setSaveStatus(status) {
  if (!saveStatus) return;
  saveStatus.classList.remove('saving', 'error', 'offline');
  
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  if (!isOnline) {
    saveStatus.classList.add('offline');
    const provider = getProvider();
    const queuedCount = (provider && provider._pendingUpdates ? provider._pendingUpdates.length : 0) + pendingTitleSaves;
    if (queuedCount > 0) {
      saveStatus.textContent = i18next.t('messages.offlinePending', { count: queuedCount }) || `Offline (${queuedCount} ausstehend)`;
      saveStatus.classList.add('saving');
    } else {
      saveStatus.textContent = i18next.t('messages.offlineSynced') || 'Offline (Lokal gesichert)';
    }
    return;
  }

  switch (status) {
    case 'saving':
      saveStatus.textContent = i18next.t('common.saving');
      saveStatus.classList.add('saving');
      break;
    case 'saved':
      saveStatus.textContent = i18next.t('common.saved');
      break;
    case 'error':
      saveStatus.textContent = i18next.t('common.error');
      saveStatus.classList.add('error');
      break;
  }
}

// --- History Snapshot ---

/**
 * Evaluates the page content and captures a history snapshot if there are unsaved markdown changes
 * compared to the last snapshot. Ensures passive viewers do not take credit for remote edits.
 *
 * @returns {Promise<void>}
 */
async function snapshotCurrentPage() {
  if (!currentPageId || !canEdit()) return;
  // A write for the current content is already on its way out; a second one would
  // store the same version twice, because the baseline below only advances on resolve.
  if (snapshotInFlight) {
    snapshotQueued = true;
    return snapshotInFlight;
  }

  const pageId = currentPageId;
  let markdown;
  let currentTitle;
  let attribution;
  let provider;

  try {
    if (isMarkdownMode && markdownEditor && !isMarkdownReadOnly) {
      debouncedSyncMarkdownToEditor.flush();
    }
    markdown = getMarkdown();
    if (!markdown || markdown.trim().length === 0) return;
    currentTitle = pageTitleInput ? pageTitleInput.value : '';
    if (markdown === lastSnapshotContent && currentTitle === lastSnapshotTitle) return;

    provider = getProvider();
    attribution = resolveSnapshotAttribution({
      hasLocalEdits: Boolean(provider?.hasLocalEdits || titleEditedLocally),
      contributors: provider?.getContributors ? provider.getContributors() : [],
      currentUser: getCurrentUser()
    });

    // `null` means this client is a passive viewer that saw no editor: the content changed
    // underneath it, but signing the snapshot would credit the edit to the wrong person.
    // Whichever client actually made the edit writes it instead.
    if (!attribution) return;
  } catch (err) {
    console.warn('[Insel-Wiki] Snapshot error:', err);
    return;
  }

  snapshotInFlight = (async () => {
    const resultId = await createHistorySnapshot(
      pageId,
      markdown,
      currentTitle,
      attribution.primaryEmail,
      attribution.contributors
    );
    // `createHistorySnapshot` resolves to `undefined` when the write failed. Advancing the
    // baseline on a failure would drop the version from history for good, since nothing
    // would ever see the content as unsaved again.
    if (!resultId) return;
    if (currentPageId !== pageId) return; // navigated away; the new page owns the baseline now
    lastSnapshotContent = markdown;
    lastSnapshotTitle = currentTitle;
    titleEditedLocally = false;
    if (provider?.clearContributors) {
      provider.clearContributors();
    }
  })()
    .catch(err => { console.warn('[Insel-Wiki] Snapshot error:', err); })
    .finally(() => {
      snapshotInFlight = null;
      if (snapshotQueued) {
        snapshotQueued = false;
        snapshotCurrentPage(); // content changed while the write was out; the guards re-check
      }
    });

  return snapshotInFlight;
}

/**
 * Debounced snapshot trigger running 30 seconds after local editing pauses.
 *
 * @type {Function}
 */
const debouncedSnapshot = debounce(() => {
  snapshotCurrentPage();
}, 30000);

// --- Breadcrumb ---

/**
 * Builds the page's parent breadcrumb trail and updates the breadcrumb DOM.
 *
 * @param {string} pageId - Target page ID.
 * @returns {void}
 */
function updateBreadcrumb(pageId) {
  const trail = getBreadcrumb(pageId);
  breadcrumbEl.innerHTML = '';
  trail.forEach((page, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = '›';
      breadcrumbEl.appendChild(sep);
    }
    const item = document.createElement('span');
    item.className = `breadcrumb-item${i === trail.length - 1 ? ' current' : ''}`;
    item.textContent = page.title || i18next.t('common.untitled');
    if (i < trail.length - 1) {
      item.addEventListener('click', () => navigateCallback(page.id));
    }
    breadcrumbEl.appendChild(item);
  });
}

// --- Page Actions ---

/**
 * Triggered on new page creation click. Prompts the user with a modal, creates the page
 * in Firestore, inserts links to it if requested, and redirects the router.
 *
 * @returns {Promise<void>}
 */
async function handleNewPage() {
  if (!canEdit()) return;
  const modalData = await newPageModal(!!currentPageId);
  if (!modalData) return;

  const { title, isChild, copyLink } = modalData;
  try {
    const currentUser = getCurrentUser();
    const parentId = isChild ? currentPageId : null;
    const pageId = await createPage(title, parentId, currentUser?.email || '');

    if (copyLink) {
      const ed = getEditor();
      if (ed) {
        const slug = slugify(title);
        ed.chain().focus().insertContent(`<a href="#/${pageId}/${slug}">${title}</a> `).run();
        
        // Ensure the Yjs update is flushed immediately so the router doesn't
        // see 'unsaved changes' and trigger the leave-confirmation dialog. The
        // inserted link lives in Yjs; the markdown `content` field is projected
        // server-side, so no explicit content save is needed here.
        const provider = getProvider();
        if (provider) await provider.flushPending();
      }
    }

    navigateCallback(pageId, title);
  } catch (err) {
    console.error('[Insel-Wiki] Error creating page:', err);
    showToast(i18next.t('messages.pageCreateError') + (err.message || err), 'error');
  }
}

let followupInProgress = false;

/**
 * Creates the next page of a meeting series from the current page: a sibling
 * with the same access list, seeded with the open tasks and section structure,
 * and linked to and from the current page.
 *
 * @returns {Promise<void>}
 */
async function handleFollowupMeeting() {
  if (!canEdit() || !currentPageId || followupInProgress) return;
  followupInProgress = true;
  try {
    // Markdown mode edits live in the textarea until synced into the editor.
    flushMarkdownEditor();

    const predecessorId = currentPageId;
    const predecessorTitle = (pageTitleInput?.value || currentPageData?.title || '').trim();
    const predecessorContent = getMarkdown() || '';

    const modalData = await followupMeetingModal({ currentTitle: predecessorTitle, currentContent: predecessorContent });
    // The user may have navigated away while the modal was open.
    if (!modalData || currentPageId !== predecessorId) return;

    const { title, carryoverTasks, carryoverScaffold, linkPrevious } = modalData;
    const content = generateFollowupMeetingMarkdown({
      predecessorId: linkPrevious ? predecessorId : null,
      predecessorTitle,
      predecessorContent,
      carryoverTasks,
      carryoverScaffold
    });

    // The new page repeats this page's content, so it keeps this page's
    // readers rather than whatever the parent (or a root page) would grant.
    const acl = Array.isArray(currentPageData?.allowedEmails) && currentPageData.allowedEmails.length > 0
      ? currentPageData.allowedEmails
      : null;
    const currentUser = getCurrentUser();
    const pageId = await createPage(title, currentPageData?.parentId || null, currentUser?.email || '', {
      content,
      allowedEmails: acl
    });

    const ed = getEditor();
    if (linkPrevious && ed) {
      const link = [
        { type: 'text', text: '⏭ ' },
        { type: 'text', marks: [{ type: 'link', attrs: { href: `#/${pageId}/${slugify(title)}` } }], text: title }
      ];
      // Insert nodes instead of re-setting the document, so comments,
      // mentions and other collaborators' cursors on this page stay intact.
      const first = ed.state.doc.firstChild;
      const firstText = first?.textContent || '';
      if (first?.type.name === 'paragraph' && firstText.includes('⏮') && !firstText.includes('⏭')) {
        ed.chain().insertContentAt(first.nodeSize - 1, [{ type: 'text', text: ' | ' }, ...link]).run();
      } else {
        ed.chain().insertContentAt(0, { type: 'paragraph', content: link }).run();
      }
      const provider = getProvider();
      if (provider) await provider.flushPending();
    }

    showToast(i18next.t('series.createdSuccess', { title, interpolation: { escapeValue: false } }), 'success');
    navigateCallback(pageId, title);
  } catch (err) {
    console.error('[Insel-Wiki] Error creating follow-up page:', err);
    showToast(i18next.t('messages.pageCreateError') + (err.message || err), 'error');
  } finally {
    followupInProgress = false;
  }
}

/**
 * Requests confirmation and deletes the current page in Firestore.
 *
 * @returns {Promise<void>}
 */
async function handleDeletePage() {
  if (!canEdit() || !currentPageId) return;
  if (currentPageId === 'page-entwicklung' || currentPageId === 'page-tests') {
    showToast(i18next.t('messages.pinnedPageWarning'), 'warning');
    return;
  }
  const confirmed = await confirmModal(i18next.t('editor.deletePage'), i18next.t('messages.deletePageConfirm', { defaultValue: 'Diese Seite und alle Unterseiten in den Papierkorb verschieben?' }));
  if (!confirmed) return;
  try {
    await deletePage(currentPageId);
    navigateCallback('');
    showToast(i18next.t('messages.pageDeleted'), 'success');
  } catch (err) {
    console.error('Error deleting page:', err);
    showToast(i18next.t('messages.pageDeleteError'), 'error');
  }
}

/**
 * Restores a historical snapshot into the active page editor.
 *
 * @param {string} restoredContent - The markdown text to restore.
 * @param {Object} [restoredEntry] - The snapshot metadata.
 * @returns {Promise<void>}
 */
async function handleRestoreVersion(restoredContent, restoredEntry) {
  if (!currentPageId || !canEdit()) {
    showToast(i18next.t('messages.cannotEdit', { defaultValue: 'Keine Bearbeitungsrechte auf dieser Seite.' }), 'error');
    return;
  }

  const formattedDate = restoredEntry?.savedAt ? formatTimestamp(restoredEntry.savedAt) : '';
  const confirmMsg = formattedDate
    ? i18next.t('history.restoreConfirmWithDate', {
        defaultValue: `Möchtest du den Stand vom ${formattedDate} (${restoredEntry.savedBy || 'Unbekannt'}) wirklich als aktuelle Version wiederherstellen?`,
        date: formattedDate,
        user: restoredEntry.savedBy || ''
      })
    : i18next.t('history.restoreConfirm', {
        defaultValue: 'Möchtest du diesen Stand wirklich als aktuelle Version wiederherstellen?'
      });

  const confirmed = await confirmModal(
    i18next.t('history.restoreTitle', { defaultValue: 'Version wiederherstellen' }),
    confirmMsg,
    i18next.t('history.restore', { defaultValue: 'Wiederherstellen' })
  );

  if (!confirmed) return;

  try {
    // 1. Set editor content (Yjs document & Tiptap)
    setContent(restoredContent);
    if (isMarkdownMode && markdownEditor) {
      markdownEditor.value = restoredContent;
    }

    // 2. Restore title if available and different
    if (restoredEntry?.title && pageTitleInput && restoredEntry.title !== pageTitleInput.value) {
      pageTitleInput.value = restoredEntry.title;
      await updatePageTitle(currentPageId, restoredEntry.title);
    }

    // 3. Create a new snapshot explicitly recording the restore event
    const user = getCurrentUser();
    const restoreContributors = user?.email ? [{
      email: user.email,
      name: user.displayName || formatDefaultName(user.email)
    }] : [];
    await createHistorySnapshot(
      currentPageId,
      restoredContent,
      pageTitleInput?.value || '',
      user?.email || '',
      restoreContributors
    );
    lastSnapshotContent = restoredContent;
    lastSnapshotTitle = pageTitleInput?.value || '';

    showToast(i18next.t('history.restoreSuccess', { defaultValue: 'Version erfolgreich wiederhergestellt!' }), 'success');

    // 4. Refresh history panel to show the new snapshot
    loadHistory(currentPageId, currentPageData, getMarkdown, handleRestoreVersion);
  } catch (err) {
    console.error('Error restoring version:', err);
    showToast(i18next.t('history.restoreError', { defaultValue: 'Fehler beim Wiederherstellen der Version.' }), 'error');
  }
}

/**
 * Opens or closes the revision history panel for the page.
 *
 * @returns {Promise<void>}
 */
async function handleHistoryToggle() {
  if (currentPageId) {
    toggleHistoryPanel();
    loadHistory(currentPageId, currentPageData, getMarkdown, handleRestoreVersion);
  }
}

/**
 * Copies the current page's direct URL to the clipboard.
 *
 * @returns {Promise<void>}
 */
async function handleCopyLink() {
  if (!currentPageId) return;
  const title = pageTitleInput.value.trim() || i18next.t('common.untitled');
  const slug = slugify(title);
  const url = `${window.location.origin}${window.location.pathname}#/${currentPageId}/${slug}`;
  try {
    await navigator.clipboard.writeText(url);
    showToast(i18next.t('messages.linkCopied'), 'success', 2000);
  } catch (err) {
    console.error('Failed to copy link:', err);
  }
}

/**
 * Self-heal outdated internal links in markdown content.
 */
function selfHealLinks(markdown) {
  const pages = getAllPages();
  if (!pages || pages.length === 0) return { markdown, changed: false };

  const pageMap = new Map(pages.map(p => [p.id, p.title]));
  let changed = false;

  const healedMarkdown = markdown.replace(/\[(.*?)\]\(#\/(.*?)\/(.*?)\)/g, (match, text, id, slug) => {
    const currentTitle = pageMap.get(id);
    if (!currentTitle) return match;
    const currentSlug = slugify(currentTitle);
    if (slug !== currentSlug) {
      changed = true;
      if (slugify(text) === slug) {
        return `[${currentTitle}](#/${id}/${currentSlug})`;
      } else {
        return `[${text}](#/${id}/${currentSlug})`;
      }
    }
    return match;
  });

  return { markdown: healedMarkdown, changed };
}

/**
 * Rejoin presence after profile update
 */
/**
 * Re-submits user information to the active page's Yjs awareness states.
 * Invoked on user profile updates.
 *
 * @param {Object} updatedUser - Profile details of the user.
 * @returns {Promise<void>}
 */
export async function rejoinPresence(updatedUser) {
  const provider = getProvider();
  if (provider && provider.awareness) {
    const userName = updatedUser?.displayName || formatDefaultName(updatedUser?.email);
    provider.awareness.setLocalStateField('user', {
      name: userName,
      email: updatedUser?.email || '',
      photoURL: updatedUser?.photoURL || null,
      color: getColorForEmail(updatedUser?.email || 'Gast')
    });
  }
}

/**
 * Switches the editor view mode between Tiptap WYSIWYG and Raw Markdown editor.
 *
 * @returns {Promise<void>}
 */
async function toggleMarkdownMode() {
  if (!currentPageId || !canEdit() || getIsTranslationMode()) return;
  
  if (!isMarkdownMode) {
    const complexElements = detectComplexElements();
    if (complexElements.hasAny) {
      const choice = await markdownWarningModal(complexElements);
      if (choice === 'cancel' || !choice) {
        return;
      }
      if (choice === 'readonly') {
        isMarkdownReadOnly = true;
      } else if (choice === 'edit') {
        isMarkdownReadOnly = false;
      }
    } else {
      isMarkdownReadOnly = false;
    }
    isMarkdownMode = true;
  } else {
    isMarkdownMode = false;
  }

  updateMarkdownView();
}

/**
 * Scans editor HTML content for elements that could be broken or stripped by markdown editing
 * (e.g. tables, inline comment threads with data-comment-id, mentions with data-type="mention").
 *
 * @param {string|Object} [contentOrEditor] - HTML string or editor instance (defaults to current active editor).
 * @returns {{ tables: number, comments: number, mentions: number, hasAny: boolean, total: number }}
 */
export function detectComplexElements(contentOrEditor) {
  let html = '';
  if (typeof contentOrEditor === 'string') {
    html = contentOrEditor;
  } else if (contentOrEditor && typeof contentOrEditor.getHTML === 'function') {
    html = contentOrEditor.getHTML() || '';
  } else {
    const ed = getEditor();
    if (ed && typeof ed.getHTML === 'function') {
      html = ed.getHTML() || '';
    }
  }

  if (!html) {
    return { tables: 0, comments: 0, mentions: 0, hasAny: false, total: 0 };
  }

  // Count tables: match <table with whitespace or >
  const tableMatches = html.match(/<table(?=[\s>])/gi) || [];
  const tables = tableMatches.length;

  // Count comments: match data-comment-id attributes
  const commentMatches = html.match(/data-comment-id\s*=\s*["']?[^"'\s>]+/gi) || [];
  const comments = commentMatches.length;

  // Count mentions: match data-type="mention" or class="mention"
  const mentionMatches = html.match(/<[a-z0-9-]+[^>]+(?:data-type=["']mention["']|class=["'][^"']*?\bmention\b[^"']*?)[^>]*>/gi) || [];
  const mentions = mentionMatches.length;

  const total = tables + comments + mentions;
  const hasAny = total > 0;

  return {
    tables,
    comments,
    mentions,
    hasAny,
    total
  };
}

/**
 * Backwards-compatible boolean check for presence of complex elements.
 *
 * @param {string|Object} [contentOrEditor]
 * @returns {boolean} True if any complex elements exist.
 */
export function hasComplexElements(contentOrEditor) {
  return detectComplexElements(contentOrEditor).hasAny;
}

/**
 * Syncs DOM visibility, updates formatting toolbar displays, and transfers content
 * between WYSIWYG and Raw Markdown views when switching modes.
 *
 * @returns {void}
 */
function updateMarkdownView() {
  if (!markdownEditor || !editorEl) return;
  
  if (isMarkdownMode) {
    // Switch to Markdown mode
    const markdown = getMarkdown();
    originalMarkdownValue = markdown;
    lastSyncedMarkdown = markdown;
    markdownEditor.value = markdown;
    markdownEditor.readOnly = !!isMarkdownReadOnly;
    
    editorEl.style.display = 'none';
    markdownEditor.classList.remove('hidden');
    if (markdownToggleBtn) markdownToggleBtn.classList.add('active');
    
    // Hide format toolbar
    if (formatToolbar) formatToolbar.style.display = 'none';
  } else {
    // Switch back to WYSIWYG mode
    debouncedSyncMarkdownToEditor.cancel();
    if (!isMarkdownReadOnly) {
      const markdown = markdownEditor.value;
      if (markdown !== lastSyncedMarkdown) {
        setContent(markdown);
        lastSyncedMarkdown = markdown;
      }
    }
    
    isMarkdownReadOnly = false;
    markdownEditor.readOnly = false;
    
    markdownEditor.classList.add('hidden');
    editorEl.style.display = 'block';
    if (markdownToggleBtn) markdownToggleBtn.classList.remove('active');
    
    // Show format toolbar if user can edit
    if (formatToolbar && canEdit()) formatToolbar.style.display = 'flex';
  }
}

// --- Presentation Mode ---

/**
 * Opens Presentation Mode for the active page.
 */
function handlePresentation() {
  if (!currentPageId) return;
  const title = pageTitleInput?.value?.trim() || currentPageData?.title || i18next.t('common.untitled', { defaultValue: 'Ohne Titel' });
  let content = '';
  let isMarkdown = false;

  if (isMarkdownMode && markdownEditor) {
    content = markdownEditor.value;
    isMarkdown = true;
  } else {
    // `currentPageData.content` is the server-side *markdown* projection, so the
    // fallback must be flagged as markdown — parsing it as HTML rendered the
    // whole page as one unformatted slide.
    const html = getHTML();
    if (html) {
      content = html;
      isMarkdown = false;
    } else {
      content = currentPageData?.content || '';
      isMarkdown = true;
    }
  }

  openPresentation({ title, content, isMarkdown, pageId: currentPageId });
}

/**
 * Synchronizes the presentation (if currently open) with the active page's current content and title.
 *
 * @param {boolean} [immediate=false]
 */
export function syncPresentation(immediate = false) {
  if (!isPresentationOpen()) return;
  const title = pageTitleInput?.value?.trim() || currentPageData?.title || i18next.t('common.untitled', { defaultValue: 'Ohne Titel' });
  let content = '';
  let isMarkdown = false;

  if (isMarkdownMode && markdownEditor) {
    content = markdownEditor.value;
    isMarkdown = true;
  } else {
    // `currentPageData.content` is the server-side *markdown* projection, so the
    // fallback must be flagged as markdown — parsing it as HTML rendered the
    // whole page as one unformatted slide.
    const html = getHTML();
    if (html) {
      content = html;
      isMarkdown = false;
    } else {
      content = currentPageData?.content || '';
      isMarkdown = true;
    }
  }

  updatePresentation({ title, content, isMarkdown, pageId: currentPageId });
}

let _presentationDebounceTimer = null;

/**
 * Debounced update trigger for typing and live edits while presentation mode is active.
 */
export function debouncedUpdatePresentation() {
  if (!isPresentationOpen()) return;
  if (_presentationDebounceTimer) clearTimeout(_presentationDebounceTimer);
  _presentationDebounceTimer = setTimeout(() => {
    syncPresentation(true);
  }, 150);
}

// --- AI Translation (Non-Editable Preview) ---

/**
 * Calls backend /api/translate proxy to translate title and content.
 *
 * @param {string} title - Page title to translate.
 * @param {string} content - Markdown content to translate.
 * @param {string} targetLanguage - Target language code ('de', 'en', 'fr', 'it').
 * @returns {Promise<{translatedTitle: string, translatedContent: string}>}
 */
export async function requestTranslation(title, content, targetLanguage) {
  let token = '';
  try {
    const user = auth.currentUser;
    if (user) {
      token = await user.getIdToken();
    }
  } catch (e) {
    console.warn('[Translate] Failed to get auth token:', e);
  }

  if (!token) {
    throw new Error(i18next.t('editor.voiceErrors.auth', { defaultValue: 'Not authenticated' }));
  }

  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      title,
      content,
      targetLanguage
    })
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`API ${response.status}: ${errorBody.substring(0, 200)}`);
  }

  return await response.json();
}

/**
 * Handles translation button clicks. Prompts for language, executes translation,
 * and enters non-editable translation mode.
 *
 * @returns {Promise<void>}
 */
export async function handleTranslatePage() {
  if (!currentPageId) return;
  const requestedPageId = currentPageId;

  if (getIsTranslationMode()) {
    exitTranslationMode();
    return;
  }

  if (isMarkdownMode && markdownEditor) {
    debouncedSyncMarkdownToEditor.flush();
  }

  const currentTitle = pageTitleInput ? pageTitleInput.value : (currentPageData?.title || '');
  const currentMarkdown = getMarkdown() || currentPageData?.content || '';

  if (!currentMarkdown.trim() && !currentTitle.trim()) {
    showToast(i18next.t('messages.emptyPageTranslate', { defaultValue: 'Die Seite ist leer und kann nicht übersetzt werden.' }), 'warning');
    return;
  }

  const currentLang = i18next.language || 'de';
  const targetLang = await translateModal(currentLang);
  if (currentPageId !== requestedPageId) return;
  if (!targetLang) return;

  showToast(i18next.t('editor.translating', { defaultValue: 'Übersetze Seite mit KI…' }), 'info', 3000);
  if (translatePageBtn) translatePageBtn.classList.add('loading');

  try {
    const result = await requestTranslation(currentTitle, currentMarkdown, targetLang);
    if (currentPageId !== requestedPageId) return;
    if (!result || (result.translatedContent === undefined && result.translatedTitle === undefined)) {
      throw new Error('Invalid translation response');
    }

    enterTranslationMode(result.translatedTitle || currentTitle, result.translatedContent || '', targetLang);
  } catch (err) {
    console.error('[Translate] Translation failed:', err);
    showToast(i18next.t('editor.translateError', { defaultValue: 'Fehler bei der KI-Übersetzung.' }) + ' ' + (err.message || ''), 'error');
  } finally {
    if (translatePageBtn) translatePageBtn.classList.remove('loading');
  }
}

