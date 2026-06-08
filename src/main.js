// Insel-Wiki — Main Application Bootstrap
// Thin orchestrator that wires together all controllers and components.

import i18next, { translatePage } from './i18n.js';
import { initAuth, onAuthChange, canEdit } from './firebase/auth.js';
import { setEditable, getProvider, reevaluateSpellCheck } from './editor/editor.js';
import { slugify } from './utils/string.js';
import { initSidebar } from './components/sidebar.js';
import { initComments } from './components/comments.js';
import { initDashboard } from './components/dashboard.js';
import { showToast, initGlobalErrorHandler } from './components/toast.js';
import { initAuthUI, handleAuthChange } from './controllers/auth-ui.js';
import { initPageController, loadPage, showEmptyState, getFormatToolbar, getPageTitleInput, rejoinPresence } from './controllers/page.js';
import { confirmModal } from './components/modal.js';
import { ensurePageExists } from './firebase/firestore.js';


// --- DOM Elements ---
const appEl = document.getElementById('app');
const pageTreeEl = document.getElementById('page-tree');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarCloseBtn = document.getElementById('sidebar-close-btn');

// --- Mobile Sidebar ---
function closeSidebarOnMobile() {
  if (window.innerWidth <= 768) {
    sidebar.classList.remove('open');
    if (sidebarOverlay) sidebarOverlay.classList.remove('show');
  }
}

// --- Routing ---
let isRevertingHash = false;
let ignoreNextHashCheck = false;
let previousHash = window.location.hash;

async function handleRoute() {
  const skipCheck = ignoreNextHashCheck;
  ignoreNextHashCheck = false;

  if (isRevertingHash) {
    isRevertingHash = false;
    previousHash = window.location.hash;
    return;
  }

  const provider = getProvider();
  if (!skipCheck && provider && provider.hasUnsavedChanges) {
    const confirmed = await confirmModal(i18next.t('messages.unsavedChangesTitle'), i18next.t('messages.unsavedChangesMessage'));
    if (!confirmed) {
      isRevertingHash = true;
      window.location.hash = previousHash;
      return;
    }
  }

  previousHash = window.location.hash;

  const hash = window.location.hash.replace('#/', '').replace('#', '');
  console.log('[Insel-Wiki] Routing to hash:', window.location.hash, 'parsed pageId:', hash.split('/')[0]);
  if (hash) {
    const pageId = hash.split('/')[0];
    loadPage(pageId).then(() => closeSidebarOnMobile());
  } else {
    showEmptyState();
  }
}

function navigateToPage(pageId, title = '') {
  const newHash = title ? `#/${pageId}/${slugify(title)}` : (pageId ? `#/${pageId}` : '');
  if (window.location.hash !== newHash) {
    ignoreNextHashCheck = true;
    window.location.hash = newHash;
  }
  if (sidebar) sidebar.classList.remove('open');
  if (sidebarOverlay) sidebarOverlay.classList.remove('show');
}

// --- Online/Offline Status ---
function updateOnlineStatus() {
  const isOnline = navigator.onLine;
  let indicator = document.getElementById('offline-indicator');
  if (!isOnline) {
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'offline-indicator';
      indicator.className = 'offline-status';
      indicator.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.58 9M1.42 9a15.91 15.91 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0M12 20h.01"/></svg> ${i18next.t('messages.offlineMode')}`;
      document.body.appendChild(indicator);
    }
  } else if (indicator) {
    indicator.remove();
  }
}

// --- Initialize ---
async function init() {
  // #14: Global error handler
  initGlobalErrorHandler();

  // Initialize i18n
  translatePage();


  // Auth UI (login/register/profile)
  initAuthUI({
    onProfileUpdate: (updatedUser) => rejoinPresence(updatedUser)
  });

  // Page controller (editor, page loading, save, etc.)
  initPageController({
    navigateTo: navigateToPage
  });

  // Sidebar toggle for mobile
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      if (sidebarOverlay) sidebarOverlay.classList.toggle('show');
    });
  }
  if (sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', closeSidebarOnMobile);
  if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebarOnMobile);

  // Shortcuts modal
  const shortcutsBtn = document.getElementById('shortcuts-btn');
  const shortcutsModal = document.getElementById('shortcuts-modal');
  const shortcutsCloseBtn = document.getElementById('shortcuts-close-btn');
  if (shortcutsBtn) shortcutsBtn.addEventListener('click', () => shortcutsModal.classList.remove('hidden'));
  if (shortcutsCloseBtn) shortcutsCloseBtn.addEventListener('click', () => shortcutsModal.classList.add('hidden'));
  if (shortcutsModal) shortcutsModal.addEventListener('click', (e) => { if (e.target === shortcutsModal) shortcutsModal.classList.add('hidden'); });

  // Init auth
  await initAuth();

  // #2026: Ensure root test page exists in test environments
  const isTestEnv = typeof navigator !== 'undefined' && (
    navigator.webdriver || 
    window.__playwright_test__ || 
    window.location.hostname === 'localhost' || 
    window.location.hostname === '127.0.0.1'
  );
  if (isTestEnv) {
    ensurePageExists('page-tests', 'Tests').catch(err => {
      console.warn('[Insel-Wiki] Failed to ensure root test page exists:', err);
    });
  }

  // Auth state changes → update UI
  onAuthChange((user) => {
    handleAuthChange(user, {
      setEditable,
      formatToolbar: getFormatToolbar(),
      pageTitleInput: getPageTitleInput()
    });
    reevaluateSpellCheck();
  });

  // Hash-based routing
  window.addEventListener('hashchange', handleRoute);

  // Init sidebar
  initSidebar(pageTreeEl, navigateToPage);

  // Initial route
  handleRoute();

  // Init comments & dashboard
  initComments(appEl);
  initDashboard(appEl, navigateToPage);

  // Online/offline
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();

  // Prevent closing tab if unsaved changes exist
  window.addEventListener('beforeunload', (e) => {
    const provider = getProvider();
    if (provider && provider.hasUnsavedChanges) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

// --- Go! ---
init().catch(console.error);
