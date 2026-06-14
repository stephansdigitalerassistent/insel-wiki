// Page Controller — loading, saving, snapshots, link healing, and page actions
import { createPage, getPage, savePage, createHistorySnapshot, getLatestHistorySnapshot, updatePageTitle, deletePage, getChildren } from '../firebase/firestore.js';
import { createEditor, setContent, getMarkdown, setEditable, destroyEditor, createFormatToolbar, getProvider, getEditor, flushSave, hasCachedEditor } from '../editor/editor.js';
import { initSidebar, setActivePage, getBreadcrumb, getAllPages } from '../components/sidebar.js';
import { loadHistory, toggleHistoryPanel, closeHistoryPanel } from '../components/history.js';
import { loadCommentsForPage } from '../components/comments.js';
import { promptModal, newPageModal, confirmModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { canEdit, getCurrentUser, isLoggedIn } from '../firebase/auth.js';
import { formatDefaultName, slugify, getColorForEmail, getInitials } from '../utils/string.js';
import { subscribeToPage } from '../firebase/firestore.js';
import { marked } from 'marked';
import i18next from '../i18n.js';

// --- State ---
let currentPageId = null;
let currentPageData = null;
let currentPageUnsub = null;
let currentPresenceUnsub = null;
let currentSessionId = null;
let formatToolbar = null;
let historySnapshotInterval = null;
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

// History optimization
let lastSnapshotContent = '';
let isSnapshotDirty = false;

// --- Utilities ---
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
  return debounced;
}

const debouncedUpdateTitle = debounce(async (id, title) => {
  if (!id || !canEdit()) return;
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
// three concurrent write streams: live Yjs updates (every keystroke during
// editing), debounced markdown saves, and debounced title saves. We coalesce
// rapid bursts so the label doesn't flicker on every keystroke.
let pendingMarkdownSaves = 0;
let pendingTitleSaves = 0;
let saveErrored = false;
let savedSettleTimer = null;
let yjsStatusUnsub = null;

function anySavePending() {
  if (pendingMarkdownSaves > 0 || pendingTitleSaves > 0) return true;
  const provider = getProvider();
  if (provider && provider.hasUnsavedChanges) return true;
  return false;
}

function recomputeSaveStatus() {
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
let historyBtn, printBtn, addChildBtn, deletePageBtn, toolbarNewPageBtn, copyLinkBtn;

let navigateCallback = null;

export function navigateTo(pageId, title = '') {
  if (navigateCallback) {
    navigateCallback(pageId, title);
  } else {
    window.location.hash = title ? `#/${pageId}/${slugify(title)}` : `#/${pageId}`;
  }
}

// --- Yjs Presence Helper ---
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
 * Initialize the page controller
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
  addChildBtn = document.getElementById('add-child-btn');
  deletePageBtn = document.getElementById('delete-page-btn');
  toolbarNewPageBtn = document.getElementById('toolbar-new-page-btn');
  copyLinkBtn = document.getElementById('copy-link-btn');

  navigateCallback = opts.navigateTo;

  // Setup action buttons
  document.getElementById('new-page-btn').addEventListener('click', () => handleNewPage());
  if (toolbarNewPageBtn) toolbarNewPageBtn.addEventListener('click', () => handleNewPage());
  if (addChildBtn) addChildBtn.addEventListener('click', () => handleNewPage());
  if (deletePageBtn) deletePageBtn.addEventListener('click', handleDeletePage);
  if (historyBtn) historyBtn.addEventListener('click', handleHistoryToggle);
  if (printBtn) printBtn.addEventListener('click', () => window.print());
  if (copyLinkBtn) copyLinkBtn.addEventListener('click', handleCopyLink);

  document.getElementById('close-history').addEventListener('click', closeHistoryPanel);
  document.getElementById('empty-new-page').addEventListener('click', () => handleNewPage());

  pageTitleInput.addEventListener('input', () => {
    if (currentPageId && canEdit()) {
      debouncedUpdateTitle(currentPageId, pageTitleInput.value);
      document.title = `Insel-Wiki - ${pageTitleInput.value || 'Ohne Titel'}`;
    }
  });

  // Ctrl+S
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (currentPageId) {
        const markdown = getMarkdown();
        handleSave(currentPageId, markdown);
      }
    }
  });

  // Flush pending writes whenever the tab is being closed or backgrounded.
  // Firestore's IndexedDB persistence queues these writes if the network is
  // unavailable, and replays them on next load.
  const flushAll = () => {
    debouncedUpdateTitle.flush();
    const provider = getProvider();
    if (provider) provider.flushPending();
    flushSave();
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

export function getFormatToolbar() { return formatToolbar; }
export function getPageTitleInput() { return pageTitleInput; }
export function getCurrentPageId() { return currentPageId; }

/**
 * Load a page by ID
 */
export async function loadPage(pageId) {
  // Skip if we're already on this page
  if (pageId === currentPageId) return;

  if (debouncedUpdateTitle) debouncedUpdateTitle.flush();

  // Fire-and-forget cleanup (don't block the new page load)
  const oldPageId = currentPageId;
  if (oldPageId) {
    snapshotCurrentPage().catch(() => {});
  }

  // Cleanup subscriptions synchronously (instant, no network)
  if (currentPageUnsub) { currentPageUnsub(); currentPageUnsub = null; }
  if (currentPresenceUnsub) { currentPresenceUnsub(); currentPresenceUnsub = null; }
  clearInterval(historySnapshotInterval);
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
  pendingMarkdownSaves = 0;
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

  // Create editor (Yjs provider.init() runs internally)
  createEditor(editorEl, pageId, fullUser, handleSave, page.content || '', () => {
    if (loadingOverlay) loadingOverlay.classList.add('hidden');
    // Swap out static preview for real editor
    const staticPreview = document.getElementById('static-editor-preview');
    if (staticPreview) staticPreview.remove();
    editorEl.style.display = 'block';
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
          const { markdown: healedMarkdown, changed } = selfHealLinks(freshPage.content || '');
          if (changed) {
            freshPage.content = healedMarkdown;
            if (canEdit()) {
              savePage(pageId, healedMarkdown, 'System (Link-Healer)').catch(console.warn);
            }
          }
       }
    });
  }, 1000); // Defer by 1s to allow editor to fully render and idle

  if (!formatToolbar) {
    formatToolbar = createFormatToolbar(editorContainer);
    if (!canEdit()) formatToolbar.style.display = 'none';
  }

  setEditable(canEdit());
  pageTitleInput.readOnly = !canEdit();

  historySnapshotInterval = setInterval(() => snapshotCurrentPage(), SNAPSHOT_INTERVAL_MS);

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
      if (document.activeElement !== pageTitleInput && updatedPage.title !== pageTitleInput.value) {
        pageTitleInput.value = updatedPage.title || '';
        document.title = `Insel-Wiki - ${updatedPage.title || 'Ohne Titel'}`;
      }

      // 2. Force editor reload if bot status changed or if server forced an update
      // This allows the DevOps-Bot to 'take over' the editor even if the user has it open.
      if (newBotStatus !== oldBotStatus && newBotStatus !== 'new') {
        console.log(`[Insel-Wiki] Bot status changed to ${newBotStatus}. Refreshing content.`);
        setContent(updatedPage.content);
      }

      updateBreadcrumb(pageId);
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

  isSnapshotDirty = false;
  getLatestHistorySnapshot(pageId).then(snap => {
    lastSnapshotContent = snap ? snap.content : (page.content || '');
  }).catch(() => {});

  if (!page.title || page.title === 'Neue Seite') {
    setTimeout(() => { pageTitleInput.focus(); pageTitleInput.select(); }, 100);
  }
}

export function showEmptyState() {
  snapshotCurrentPage();
  if (currentPresenceUnsub) { currentPresenceUnsub(); currentPresenceUnsub = null; }
  clearInterval(historySnapshotInterval);
  currentPageId = null;
  currentSessionId = null;
  destroyEditor();
  editorContainer.classList.add('hidden');
  emptyState.classList.remove('hidden');
  if (loadingOverlay) loadingOverlay.classList.add('hidden');
  breadcrumbEl.innerHTML = '';
  if (collabCursorsEl) collabCursorsEl.innerHTML = '';
}

// --- Presence ---
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

// --- Save ---
async function handleSave(pageId, markdown) {
  if (!canEdit()) return;

  // Bot Protection: Never save an empty string if the bot is currently working.
  // This happens when the bot forces a clean reload and the editor is temporarily empty.
  if ((!markdown || markdown.trim() === '') && currentPageData?.bot_status && currentPageData.bot_status !== 'completed' && currentPageData.bot_status !== 'fixed') {
    console.warn('[Insel-Wiki] Blocked saving empty content during bot operation.');
    return;
  }

  pendingMarkdownSaves++;
  isSnapshotDirty = true;
  recomputeSaveStatus();
  try {
    const user = getCurrentUser();
    const userName = user?.displayName || formatDefaultName(user?.email);
    await savePage(pageId, markdown, user?.email || '', userName, user?.photoURL || null);
    saveErrored = false;
  } catch (err) {
    console.error('Save error:', err);
    saveErrored = true;
    if (err.code === 'unavailable') {
      showToast(i18next.t('errors.unavailable') || 'Verbindung zum Server unterbrochen. Bitte überprüfe deine Internetverbindung.', 'error');
    } else if (err.code === 'resource-exhausted') {
      showToast('Speicherfehler: Der Inhalt der Seite ist zu groß (über 1MB). Bitte reduziere die Menge an eingefügten Bildern.', 'error');
    } else {
      showToast(err.message || 'Speicherfehler beim Sichern der Seite.', 'error');
    }
  } finally {
    pendingMarkdownSaves--;
    recomputeSaveStatus();
  }
}

function setSaveStatus(status) {
  if (!saveStatus) return;
  saveStatus.classList.remove('saving', 'error');
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
async function snapshotCurrentPage() {
  if (!currentPageId || !canEdit()) return;
  if (!isSnapshotDirty) return;
  try {
    const markdown = getMarkdown();
    if (!markdown || markdown.trim().length === 0) return;
    if (markdown === lastSnapshotContent) { isSnapshotDirty = false; return; }
    const user = getCurrentUser();
    await createHistorySnapshot(currentPageId, markdown, pageTitleInput.value, user?.email || '');
    lastSnapshotContent = markdown;
    isSnapshotDirty = false;
  } catch (err) {
    console.warn('[Insel-Wiki] Snapshot error:', err);
  }
}

// --- Breadcrumb ---
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
        // see 'unsaved changes' and trigger the leave-confirmation dialog.
        const provider = getProvider();
        if (provider) await provider.flushPending();

        const currentMarkdown = getMarkdown();
        if (currentPageId && currentMarkdown) {
          await handleSave(currentPageId, currentMarkdown);
        }
      }
    }

    navigateCallback(pageId, title);
  } catch (err) {
    console.error('[Insel-Wiki] Error creating page:', err);
    showToast(i18next.t('messages.pageCreateError') + (err.message || err), 'error');
  }
}

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

async function handleHistoryToggle() {
  if (currentPageId) {
    toggleHistoryPanel();
    loadHistory(currentPageId, currentPageData, getMarkdown);
  }
}

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
