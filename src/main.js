// Insel-Wiki — Main Application Bootstrap
import { initAuth, onAuthChange, login, logout, isLoggedIn, canEdit, getCurrentUser, getAccessRequestLink, updateUserProfile } from './firebase/auth.js';
import { uploadAvatar } from './firebase/storage.js';
import { formatDefaultName, slugify } from './utils/string.js';
import { createPage, getPage, savePage, createHistorySnapshot, getLatestHistorySnapshot, updatePageTitle, deletePage, restorePage, getDeletedPages, permanentlyDeletePage, getChildren, subscribeToPage, createRegistrationRequest, subscribeToRegistrationRequest, cancelRegistrationRequest } from './firebase/firestore.js';
import { createEditor, setContent, getMarkdown, setEditable, destroyEditor, createFormatToolbar, getProvider, getEditor } from './editor/editor.js';
import { joinPage, leavePage, subscribeToPresence, getColorForEmail } from './firebase/presence.js';
import { initSidebar, setActivePage, getBreadcrumb, getAllPages } from './components/sidebar.js';
import { loadHistory, toggleHistoryPanel, closeHistoryPanel } from './components/history.js';
import { promptModal, newPageModal } from './components/modal.js';
import { initComments, loadCommentsForPage } from './components/comments.js';
import { initDashboard, showDashboard } from './components/dashboard.js';

// --- State ---
let currentPageId = null;
let currentPageUnsub = null;
let currentPresenceUnsub = null;
let currentSessionId = null;
let formatToolbar = null;
let historySnapshotInterval = null;
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// History optimization
let lastSnapshotContent = '';
let isSnapshotDirty = false;

// --- DOM Elements ---
const authOverlay = document.getElementById('auth-overlay');
const loginForm = document.getElementById('login-form');
const loginEmailInput = document.getElementById('login-email');
const loginPasswordInput = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const loginBtn = document.getElementById('login-btn');

// --- Registration DOM Elements ---
const registerForm = document.getElementById('register-form');
const registerEmailInput = document.getElementById('register-email');
const registerPasswordInput = document.getElementById('register-password');
const registerBtn = document.getElementById('register-btn');
const registerError = document.getElementById('register-error');

const waitingState = document.getElementById('waiting-state');
const sendTokenEmailBtn = document.getElementById('send-token-email-btn');
const cancelRegisterBtn = document.getElementById('cancel-register-btn');

const successState = document.getElementById('success-state');
const successToLoginBtn = document.getElementById('success-to-login-btn');

const showRegisterBtn = document.getElementById('show-register-btn');
const showLoginBtn = document.getElementById('show-login-btn');

let currentRegistrationToken = null;
let currentRegistrationUnsub = null;

const historyBtn = document.getElementById('history-btn');
const printBtn = document.getElementById('print-page-btn');
const addChildBtn = document.getElementById('add-child-btn');
const deletePageBtn = document.getElementById('delete-page-btn');
const toolbarNewPageBtn = document.getElementById('toolbar-new-page-btn');
const copyLinkBtn = document.getElementById('copy-link-btn');
const requestAccessLink = document.getElementById('request-access-link');
const appEl = document.getElementById('app');
const editorContainer = document.getElementById('editor-container');
const editorEl = document.getElementById('editor');
const pageTitleInput = document.getElementById('page-title');
const saveStatus = document.getElementById('save-status');
const breadcrumbEl = document.getElementById('breadcrumb');
const collabCursorsEl = document.getElementById('collab-cursors');
const pageTreeEl = document.getElementById('page-tree');
const emptyState = document.getElementById('empty-state');
const userInfoEl = document.getElementById('user-info');
const lastEditedBadge = document.getElementById('last-edited-badge');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const sidebarCloseBtn = document.getElementById('sidebar-close-btn');

function closeSidebarOnMobile() {
  if (window.innerWidth <= 768) {
    sidebar.classList.remove('open');
    if (sidebarOverlay) sidebarOverlay.classList.remove('show');
  }
}

// --- Profile Modal Elements ---
const profileModal = document.getElementById('profile-modal');
const profileNameInput = document.getElementById('profile-name');
const profileAvatarFile = document.getElementById('profile-avatar-file');
const avatarPreviewContainer = document.getElementById('avatar-preview-container');
const avatarPreviewImg = document.getElementById('avatar-preview-img');
const profileSaveBtn = document.getElementById('profile-save-btn');
const profileCancelBtn = document.getElementById('profile-cancel-btn');

let selectedAvatarFile = null;

// --- Initialize ---
async function init() {
  // Setup mailto link
  if (requestAccessLink) {
    requestAccessLink.href = getAccessRequestLink();
  }

  // Setup login form
  loginForm.addEventListener('submit', handleLogin);

  // Setup registration flow
  if (showRegisterBtn) {
    showRegisterBtn.addEventListener('click', () => {
      loginForm.classList.add('hidden');
      registerForm.classList.remove('hidden');
    });
  }
  if (showLoginBtn) {
    showLoginBtn.addEventListener('click', () => {
      registerForm.classList.add('hidden');
      loginForm.classList.remove('hidden');
    });
  }
  if (registerForm) {
    registerForm.addEventListener('submit', handleRegister);
  }
  if (cancelRegisterBtn) {
    cancelRegisterBtn.addEventListener('click', handleCancelRegistration);
  }
  if (successToLoginBtn) {
    successToLoginBtn.addEventListener('click', () => {
      successState.classList.add('hidden');
      loginForm.classList.remove('hidden');
    });
  }

  // Setup logout
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  // Sidebar toggle for mobile
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      if (sidebarOverlay) sidebarOverlay.classList.toggle('show');
    });
  }

  if (sidebarCloseBtn) {
    sidebarCloseBtn.addEventListener('click', closeSidebarOnMobile);
  }

  if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', closeSidebarOnMobile);
  }

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

  // Setup shortcuts modal
  const shortcutsBtn = document.getElementById('shortcuts-btn');
  const shortcutsModal = document.getElementById('shortcuts-modal');
  const shortcutsCloseBtn = document.getElementById('shortcuts-close-btn');

  if (shortcutsBtn) {
    shortcutsBtn.addEventListener('click', () => {
      shortcutsModal.classList.remove('hidden');
    });
  }

  if (shortcutsCloseBtn) {
    shortcutsCloseBtn.addEventListener('click', () => {
      shortcutsModal.classList.add('hidden');
    });
  }

  if (shortcutsModal) {
    shortcutsModal.addEventListener('click', (e) => {
      if (e.target === shortcutsModal) {
        shortcutsModal.classList.add('hidden');
      }
    });
  }

  // Setup profile modal
  if (userInfoEl) userInfoEl.addEventListener('click', openProfileModal);
  if (profileCancelBtn) profileCancelBtn.addEventListener('click', closeProfileModal);
  if (profileSaveBtn) profileSaveBtn.addEventListener('click', handleProfileSave);
  
  if (profileAvatarFile) {
    profileAvatarFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        selectedAvatarFile = file;
        avatarPreviewImg.src = URL.createObjectURL(file);
        avatarPreviewContainer.style.display = 'flex';
      } else {
        selectedAvatarFile = null;
        avatarPreviewContainer.style.display = 'none';
      }
    });
  }

  // Title input — save on change
  pageTitleInput.addEventListener('input', debounce(() => {
    if (currentPageId && canEdit()) {
      updatePageTitle(currentPageId, pageTitleInput.value);
    }
  }, 800));

  // Init auth
  const user = await initAuth();

  // Auth state changes
  onAuthChange(handleAuthChange);

  // Setup hash-based routing
  window.addEventListener('hashchange', handleRoute);

  // Init sidebar (always, even for non-logged-in users for read-only tree)
  initSidebar(pageTreeEl, navigateToPage);

  // Initial route
  handleRoute();

  // Init comments
  initComments(appEl);

  // Init dashboard
  initDashboard(appEl, navigateToPage);

  // Offline listener
  window.addEventListener('online', () => updateOnlineStatus());
  window.addEventListener('offline', () => updateOnlineStatus());
  updateOnlineStatus();

  // Global Shortcuts
  window.addEventListener('keydown', (e) => {
    // Ctrl+S or Cmd+S for manual save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (currentPageId) {
        const markdown = getMarkdown();
        handleSave(currentPageId, markdown);
      }
    }
  });
}

/**
 * Update the online/offline status UI
 */
function updateOnlineStatus() {
  const isOnline = navigator.onLine;
  let indicator = document.getElementById('offline-indicator');
  
  if (!isOnline) {
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'offline-indicator';
      indicator.className = 'offline-status';
      indicator.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.58 9M1.42 9a15.91 15.91 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0M12 20h.01"/></svg> Offline-Modus aktiv';
      document.body.appendChild(indicator);
    }
  } else if (indicator) {
    indicator.remove();
  }
}

// --- Auth Handlers ---
function handleAuthChange(user) {
  if (user) {
    // Logged in
    authOverlay.classList.add('hidden');
    if (userInfoEl) {
      const name = user.displayName || formatDefaultName(user.email);
      let innerHTML = '';
      if (user.photoURL) {
        innerHTML = `<img src="${user.photoURL}" class="user-avatar-img" alt="Avatar" onerror="this.onerror=null; this.src='/favicon.svg';">`;
      } else {
        innerHTML = `<div class="user-avatar-img" style="display:flex;align-items:center;justify-content:center;font-weight:600;color:#fff;background:var(--accent);font-size:0.75rem">${name.charAt(0).toUpperCase()}</div>`;
      }
      innerHTML += `<span>${name}</span>`;
      userInfoEl.innerHTML = innerHTML;
    }
    // Enable/disable editing
    setEditable(canEdit());
    // Show/hide format toolbar based on edit permission
    if (formatToolbar) {
      formatToolbar.style.display = canEdit() ? 'flex' : 'none';
    }
    pageTitleInput.readOnly = !canEdit();
  } else {
    // Not logged in — show auth overlay
    authOverlay.classList.remove('hidden');
    if (userInfoEl) userInfoEl.innerHTML = '';
  }
}

async function handleLogin(e) {
  e.preventDefault();
  loginError.classList.add('hidden');
  loginBtn.disabled = true;
  loginBtn.textContent = 'Anmelden…';

  try {
    await login(loginEmailInput.value, loginPasswordInput.value);
  } catch (err) {
    loginError.textContent = err.message || 'Anmeldung fehlgeschlagen.';
    loginError.classList.remove('hidden');
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Anmelden';
  }
}

// --- Registration Flow ---
function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let token = 'TOKEN-';
  for (let i = 0; i < 6; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

async function handleRegister(e) {
  e.preventDefault();
  registerError.classList.add('hidden');
  registerBtn.disabled = true;
  registerBtn.textContent = 'Bereite vor…';

  const email = registerEmailInput.value;
  const password = registerPasswordInput.value;

  if (!email.endsWith('@insel.ch')) {
    registerError.textContent = 'Nur @insel.ch E-Mail-Adressen sind zugelassen.';
    registerError.classList.remove('hidden');
    registerBtn.disabled = false;
    registerBtn.textContent = 'Registrieren';
    return;
  }

  if (password.length < 6) {
    registerError.textContent = 'Das Passwort muss mindestens 6 Zeichen lang sein.';
    registerError.classList.remove('hidden');
    registerBtn.disabled = false;
    registerBtn.textContent = 'Registrieren';
    return;
  }

  try {
    currentRegistrationToken = generateToken();
    await createRegistrationRequest(currentRegistrationToken, email, password);

    // Prepare mailto link
    const subject = encodeURIComponent(`Wiki Registration: ${currentRegistrationToken}`);
    const body = encodeURIComponent(`Senden Sie diese E-Mail unverändert ab, um Ihren Account zu aktivieren.\n\nToken: ${currentRegistrationToken}`);
    sendTokenEmailBtn.href = `mailto:stephansdigitalassistent@gmail.com?subject=${subject}&body=${body}`;

    // Switch UI
    registerForm.classList.add('hidden');
    waitingState.classList.remove('hidden');

    // Subscribe to status changes
    currentRegistrationUnsub = subscribeToRegistrationRequest(currentRegistrationToken, (data) => {
      if (!data) return; // Deleted / Cancelled

      if (data.status === 'approved') {
        // Registration successful
        waitingState.classList.add('hidden');
        successState.classList.remove('hidden');
        if (currentRegistrationUnsub) {
          currentRegistrationUnsub();
          currentRegistrationUnsub = null;
        }
        currentRegistrationToken = null;
        // Clean up inputs
        registerEmailInput.value = '';
        registerPasswordInput.value = '';
      } else if (data.status === 'error') {
        alert('Ein Fehler ist aufgetreten: ' + (data.error || 'Unbekannt'));
        handleCancelRegistration();
      }
    });

  } catch (err) {
    registerError.textContent = err.message || 'Fehler beim Vorbereiten der Registrierung.';
    registerError.classList.remove('hidden');
  } finally {
    registerBtn.disabled = false;
    registerBtn.textContent = 'Registrieren';
  }
}

async function handleCancelRegistration() {
  if (currentRegistrationToken) {
    try {
      await cancelRegistrationRequest(currentRegistrationToken);
    } catch (err) {
      console.warn('Could not cancel request cleanly', err);
    }
    if (currentRegistrationUnsub) {
      currentRegistrationUnsub();
      currentRegistrationUnsub = null;
    }
    currentRegistrationToken = null;
  }
  
  waitingState.classList.add('hidden');
  registerForm.classList.remove('hidden');
}

async function handleLogout() {
  await logout();
  window.location.hash = '';
}

// --- Profile Modal logic ---
function openProfileModal() {
  const user = getCurrentUser();
  if (!user) return;
  profileNameInput.value = user.displayName || '';
  profileAvatarFile.value = '';
  selectedAvatarFile = null;
  if (user.photoURL) {
    avatarPreviewImg.src = user.photoURL;
    avatarPreviewImg.onerror = function() { this.onerror=null; this.src='/favicon.svg'; };
    avatarPreviewContainer.style.display = 'flex';
  } else {
    avatarPreviewContainer.style.display = 'none';
  }
  profileModal.classList.remove('hidden');
}

function closeProfileModal() {
  profileModal.classList.add('hidden');
}

async function handleProfileSave() {
  const newName = profileNameInput.value.trim() || null;
  profileSaveBtn.disabled = true;
  profileSaveBtn.textContent = 'Speichern...';
  
  try {
    const user = getCurrentUser();
    let newAvatarUrl = user.photoURL; // default to existing
    
    // Upload file if selected
    if (selectedAvatarFile) {
      profileSaveBtn.textContent = 'Bild verarbeiten...';
      const resizedFile = await resizeAvatar(selectedAvatarFile, 256);
      profileSaveBtn.textContent = 'Bild hochladen...';
      newAvatarUrl = await uploadAvatar(resizedFile, user.uid);
    }
    
    profileSaveBtn.textContent = 'Profil wird aktualisiert...';
    const updatedUser = await updateUserProfile(newName, newAvatarUrl);
    closeProfileModal();
    // Provide a hint to reload or gracefully update presence in current session
    // Right now, rejoining page re-transmits the new data cleanly
    if (currentPageId) {
      leavePage();
      currentSessionId = await joinPage(currentPageId, updatedUser);
    }
  } catch (err) {
    console.error('Fehler beim Profil-Update:', err);
    alert('Profil konnte nicht aktualisiert werden. ' + (err.message || ''));
  } finally {
    profileSaveBtn.disabled = false;
    profileSaveBtn.textContent = 'Speichern';
  }
}
// --- Routing ---
function handleRoute() {
  const hash = window.location.hash.replace('#/', '').replace('#', '');
  if (hash) {
    // Extract ID (first part before slash or just the hash)
    const pageId = hash.split('/')[0];
    loadPage(pageId);
  } else {
    showEmptyState();
  }
}

function navigateToPage(pageId, title = '') {
  if (title) {
    const slug = slugify(title);
    window.location.hash = `#/${pageId}/${slug}`;
  } else {
    window.location.hash = `#/${pageId}`;
  }
  
  // Close mobile sidebar
  if (sidebar) sidebar.classList.remove('open');
  if (sidebarOverlay) sidebarOverlay.classList.remove('show');
}

/**
 * Update the 'Last edited by' UI badge
 */
function updateLastEditedBadge(pageData) {
  if (!lastEditedBadge) return;

  if (!pageData || !pageData.lastSavedBy) {
    lastEditedBadge.classList.add('hidden');
    return;
  }

  const date = pageData.updatedAt?.toDate ? pageData.updatedAt.toDate() : new Date(pageData.updatedAt);
  const timeStr = date.toLocaleString('de-CH', { 
    day: '2-digit', 
    month: '2-digit', 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  const name = pageData.lastSavedByName || formatDefaultName(pageData.lastSavedBy);

  let avatarHTML = '';
  if (pageData.lastSavedByPhoto) {
    avatarHTML = `<img src="${pageData.lastSavedByPhoto}" class="last-edited-avatar" alt="Avatar">`;
  } else {
    avatarHTML = `<div class="last-edited-avatar">${name.charAt(0).toUpperCase()}</div>`;
  }

  lastEditedBadge.innerHTML = `
    ${avatarHTML}
    <span>Zuletzt bearbeitet von <strong>${name}</strong> am ${timeStr}</span>
  `;
  lastEditedBadge.classList.remove('hidden');
}

// --- Page Loading ---
async function loadPage(pageId) {
  // Snapshot the old page before leaving
  await snapshotCurrentPage();

  // Cleanup
  if (currentPageUnsub) {
    currentPageUnsub();
    currentPageUnsub = null;
  }
  if (currentPresenceUnsub) {
    currentPresenceUnsub();
    currentPresenceUnsub = null;
  }
  await leavePage();
  clearInterval(historySnapshotInterval);
  closeHistoryPanel();
  
  collabCursorsEl.innerHTML = '';

  currentPageId = pageId;
  setActivePage(pageId);
  loadCommentsForPage(pageId);

  // Show editor, hide empty state
  editorContainer.classList.remove('hidden');
  emptyState.classList.add('hidden');

  // Load page data
  const page = await getPage(pageId);
  if (!page) {
    showEmptyState();
    return;
  }

  updateLastEditedBadge(page);

  // Subscribe to real-time updates for title and metadata
  currentPageUnsub = subscribeToPage(pageId, (updatedPage) => {
    if (!updatedPage) return;
    if (pageTitleInput.value !== updatedPage.title && document.activeElement !== pageTitleInput) {
      pageTitleInput.value = updatedPage.title || '';
    }
    updateLastEditedBadge(updatedPage);
  });

  // Self-heal internal links before loading into editor
  const { markdown: healedMarkdown, changed } = selfHealLinks(page.content || '');
  if (changed) {
    console.log(`[Insel-Wiki] Auto-healed links for page: ${pageId}`);
    page.content = healedMarkdown;
    // Trigger a silent background save
    setTimeout(() => {
      if (canEdit()) {
        savePage(pageId, healedMarkdown, page.title, 'System (Link-Healer)').catch(console.warn);
      }
    }, 2000);
  }

  // Set title
  pageTitleInput.value = page.title || '';

  // Create editor
  const user = getCurrentUser();
  const userName = user?.displayName || formatDefaultName(user?.email);
  
  // Passed full user info to createEditor
  const fullUser = {
    name: userName,
    email: user?.email || '',
    photoURL: user?.photoURL || null,
    color: getColorForEmail(user?.email || 'Gast')
  };
  
  const ed = createEditor(editorEl, pageId, fullUser, handleSave);

  // Create format toolbar (once)
  if (!formatToolbar) {
    formatToolbar = createFormatToolbar(editorContainer);
    if (!canEdit()) {
      formatToolbar.style.display = 'none';
    }
  }

  // Content is handled by the Yjs Provider load callback
  setEditable(canEdit());
  pageTitleInput.readOnly = !canEdit();

  // Update breadcrumb
  updateBreadcrumb(pageId);

  // Set save status
  updateSaveStatus('saved');

  // Start periodic history snapshots (every 5 min while editing)
  historySnapshotInterval = setInterval(() => {
    snapshotCurrentPage();
  }, SNAPSHOT_INTERVAL_MS);

  // Handle unload scenario
  const handleUnload = () => {
    snapshotCurrentPage();
    leavePage();
  };
  window.removeEventListener('beforeunload', handleUnload);
  window.addEventListener('beforeunload', handleUnload);

  // Subscribe to real-time updates for this page
  currentPageUnsub = subscribeToPage(pageId, (updatedPage) => {
    if (updatedPage && updatedPage.id === currentPageId) {
      // Update title if changed externally
      if (document.activeElement !== pageTitleInput && updatedPage.title !== pageTitleInput.value) {
        pageTitleInput.value = updatedPage.title || '';
      }
      updateBreadcrumb(pageId);
      
      // Keep URL synced with title
      const slug = slugify(updatedPage.title || '');
      const newHash = `#/${pageId}/${slug}`;
      if (window.location.hash !== newHash) {
        window.history.replaceState(null, '', newHash);
      }
    }
  });

  // Setup presence
  if (user) {
    currentSessionId = await joinPage(pageId, fullUser);
  }
  
  currentPresenceUnsub = subscribeToPresence(pageId, (users) => {
    renderPresence(users);
  });

  // Initialize history optimization state
  isSnapshotDirty = false;
  const latestSnap = await getLatestHistorySnapshot(pageId);
  lastSnapshotContent = latestSnap ? latestSnap.content : (page.content || '');

  // Auto-focus logic: focus title if empty, else editor handles it via autofocus: 'end'
  if (!page.title || page.title === 'Neue Seite') {
    setTimeout(() => {
      pageTitleInput.focus();
      pageTitleInput.select();
    }, 100);
  }

  closeSidebarOnMobile();
}

function renderPresence(users) {
  if (!collabCursorsEl) return;
  collabCursorsEl.innerHTML = '';
  
  users.forEach(u => {
    const avatar = document.createElement('div');
    avatar.className = 'collab-avatar';
    avatar.style.backgroundColor = u.color;
    avatar.title = u.name || u.email;
    
    if (u.photoURL) {
      const img = document.createElement('img');
      img.src = u.photoURL;
      img.alt = u.name || u.initials;
      img.onerror = function() { this.onerror = null; this.src = '/favicon.svg'; };
      avatar.appendChild(img);
    } else {
      avatar.textContent = u.initials;
    }
    
    collabCursorsEl.appendChild(avatar);
  });
}

function showEmptyState() {
  snapshotCurrentPage();
  leavePage();
  if (currentPresenceUnsub) {
    currentPresenceUnsub();
    currentPresenceUnsub = null;
  }
  clearInterval(historySnapshotInterval);
  currentPageId = null;
  currentSessionId = null;
  destroyEditor();
  editorContainer.classList.add('hidden');
  emptyState.classList.remove('hidden');
  breadcrumbEl.innerHTML = '';
  if (collabCursorsEl) collabCursorsEl.innerHTML = '';
}

/**
 * Create a history snapshot of the current page (if any content exists).
 * Called on page leave, periodically, and on browser unload.
 */
async function snapshotCurrentPage() {
  if (!currentPageId || !canEdit()) return;
  
  // Optimization: Only save if there are actual changes
  if (!isSnapshotDirty) return;

  try {
    const markdown = getMarkdown();
    if (!markdown || markdown.trim().length === 0) return;
    
    // Extra safety: double check content hasn't reverted or stayed identical
    if (markdown === lastSnapshotContent) {
      isSnapshotDirty = false;
      return;
    }

    const user = getCurrentUser();
    await createHistorySnapshot(
      currentPageId,
      markdown,
      pageTitleInput.value,
      user?.email || ''
    );

    // Update tracking state
    lastSnapshotContent = markdown;
    isSnapshotDirty = false;
    
  } catch (err) {
    // Silent — don't block navigation for snapshot errors
    console.warn('[Insel-Wiki] Snapshot error:', err);
  }
}

// --- Save ---
async function handleSave(pageId, markdown) {
  if (!canEdit()) return;
  updateSaveStatus('saving');
  isSnapshotDirty = true; // Trigger history snapshot on next interval
  try {
    const user = getCurrentUser();
    const userName = user?.displayName || formatDefaultName(user?.email);
    await savePage(pageId, markdown, pageTitleInput.value, user?.email || '', userName, user?.photoURL || null);
    updateSaveStatus('saved');
    
    // Update local last-edited badge immediately
    updateLastEditedBadge({
      lastSavedByName: userName,
      lastSavedByPhoto: user?.photoURL || null,
      updatedAt: new Date()
    });
  } catch (err) {
    console.error('Save error:', err);
    updateSaveStatus('error');
  }
}

function updateSaveStatus(status) {
  if (!saveStatus) return;
  saveStatus.classList.remove('saving', 'error');
  switch (status) {
    case 'saving':
      saveStatus.textContent = 'Speichern…';
      saveStatus.classList.add('saving');
      break;
    case 'saved':
      saveStatus.textContent = 'Gespeichert';
      break;
    case 'error':
      saveStatus.textContent = 'Fehler beim Speichern';
      saveStatus.classList.add('error');
      break;
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
    item.textContent = page.title || 'Ohne Titel';
    if (i < trail.length - 1) {
      item.addEventListener('click', () => navigateToPage(page.id));
    }
    breadcrumbEl.appendChild(item);
  });
}

// --- Page Actions ---
async function handleNewPage() {
  if (!canEdit()) return;
  
  // Open the new page modal with options
  const result = await newPageModal(!!currentPageId);
  if (!result) return;

  const { title, isChild, copyLink } = result;
  const insertLink = copyLink; // renamed logic for clarity

  try {
    const currentUser = getCurrentUser();
    const parentId = isChild ? currentPageId : null;
    const pageId = await createPage(title, parentId, currentUser?.email || '');
    
    if (insertLink) {
      // Insert link into current editor before navigating
      const ed = getEditor();
      if (ed) {
        const slug = slugify(title);
        ed.chain().focus().insertContent(`<a href="#/${pageId}/${slug}">${title}</a> `).run();
        
        // Force save the current page immediately so the link isn't lost
        // before the router unmounts the editor
        const currentMarkdown = getMarkdown();
        if (currentPageId && currentMarkdown) {
           await handleSave(currentPageId, currentMarkdown);
        }
      }
    }
    
    // Always navigate to the newly created page
    navigateToPage(pageId, title);
  } catch (err) {
    console.error('[Insel-Wiki] Error creating page:', err);
    alert('Fehler beim Erstellen der Seite: ' + (err.message || err));
  }
}

async function handleDeletePage() {
  if (!canEdit() || !currentPageId) return;
  
  if (currentPageId === 'page-entwicklung' || currentPageId === 'page-tests') {
    alert('Diese Systemseite ist angeheftet und kann nicht gelöscht werden.');
    return;
  }

  const confirmed = confirm('Diese Seite und alle Unterseiten in den Papierkorb verschieben?');
  if (!confirmed) return;

  try {
    await deletePage(currentPageId);
    window.location.hash = '';
  } catch (err) {
    console.error('Error deleting page:', err);
    alert('Fehler beim Löschen der Seite.');
  }
}

async function handleHistoryToggle() {
  if (currentPageId) {
    toggleHistoryPanel();
    loadHistory(currentPageId);
    // Compact history in the background when viewing it
    // console.log('[Insel-Wiki] Page loaded successfully', currentPageId);
  }
}

// --- Utilities ---
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

async function handleCopyLink() {
  if (!currentPageId) return;
  const title = pageTitleInput.value.trim() || 'Seite';
  const slug = slugify(title);
  const url = `${window.location.origin}${window.location.pathname}#/${currentPageId}/${slug}`;
  
  try {
    await navigator.clipboard.writeText(url);
    const originalContent = copyLinkBtn.innerHTML;
    copyLinkBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
    setTimeout(() => {
      copyLinkBtn.innerHTML = originalContent;
    }, 2000);
  } catch (err) {
    console.error('Failed to copy link:', err);
  }
}

/**
 * Automatically find and update outdated internal links in markdown content.
 */
function selfHealLinks(markdown) {
  const pages = getAllPages();
  if (!pages || pages.length === 0) return markdown;

  const pageMap = new Map(pages.map(p => [p.id, p.title]));
  let changed = false;

  // Regex matches: [Text](#/ID/Slug)
  // Group 1: Text, Group 2: ID, Group 3: Slug
  const healedMarkdown = markdown.replace(/\[(.*?)\]\(#\/(.*?)\/(.*?)\)/g, (match, text, id, slug) => {
    const currentTitle = pageMap.get(id);
    if (!currentTitle) return match; // Page not found or deleted

    const currentSlug = slugify(currentTitle);
    
    // Check if the URL slug is outdated
    if (slug !== currentSlug) {
      changed = true;
      
      // If the link text matched the old slug (standard naming), update it too
      if (slugify(text) === slug) {
        return `[${currentTitle}](#/${id}/${currentSlug})`;
      } else {
        // Custom text: keep text, only update URL slug
        return `[${text}](#/${id}/${currentSlug})`;
      }
    }
    
    return match;
  });

  return { markdown: healedMarkdown, changed };
  }

  /**
  * Update the UI with a breadcrumb trail.
  */

async function resizeAvatar(file, maxDim = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxDim) {
            height *= maxDim / width;
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width *= maxDim / height;
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (blob) {
            resolve(new File([blob], file.name, { type: 'image/jpeg' }));
          } else {
            reject(new Error('Canvas toBlob failed'));
          }
        }, 'image/jpeg', 0.85); // 85% quality JPEG
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// --- Go! ---
init().catch(console.error);
