// Auth UI Controller — login, registration, and auth overlay management
import { login, register, logout, getCurrentUser, onAuthChange, canEdit, getAccessRequestLink, updateUserProfile } from '../firebase/auth.js';
import { formatDefaultName } from '../utils/string.js';
import { showToast } from '../components/toast.js';
import { uploadAvatar } from '../firebase/storage.js';

// --- DOM Elements ---
let authOverlay, loginForm, loginEmailInput, loginPasswordInput, loginError, loginBtn;
let registerForm, registerEmailInput, registerPasswordInput, registerBtn, registerError;
let showRegisterBtn, showLoginBtn;
let profileModal, profileNameInput, profileAvatarFile, avatarPreviewContainer, avatarPreviewImg;
let profileSaveBtn, profileCancelBtn;
let userInfoEl, requestAccessLink;

let selectedAvatarFile = null;
let onProfileUpdateCallback = null;

/**
 * Initialize auth UI (login/register forms, profile modal)
 */
export function initAuthUI(callbacks = {}) {
  onProfileUpdateCallback = callbacks.onProfileUpdate || null;

  // Cache DOM
  authOverlay = document.getElementById('auth-overlay');
  loginForm = document.getElementById('login-form');
  loginEmailInput = document.getElementById('login-email');
  loginPasswordInput = document.getElementById('login-password');
  loginError = document.getElementById('login-error');
  loginBtn = document.getElementById('login-btn');
  registerForm = document.getElementById('register-form');
  registerEmailInput = document.getElementById('register-email');
  registerPasswordInput = document.getElementById('register-password');
  registerBtn = document.getElementById('register-btn');
  registerError = document.getElementById('register-error');
  showRegisterBtn = document.getElementById('show-register-btn');
  showLoginBtn = document.getElementById('show-login-btn');
  requestAccessLink = document.getElementById('request-access-link');
  userInfoEl = document.getElementById('user-info');
  profileModal = document.getElementById('profile-modal');
  profileNameInput = document.getElementById('profile-name');
  profileAvatarFile = document.getElementById('profile-avatar-file');
  avatarPreviewContainer = document.getElementById('avatar-preview-container');
  avatarPreviewImg = document.getElementById('avatar-preview-img');
  profileSaveBtn = document.getElementById('profile-save-btn');
  profileCancelBtn = document.getElementById('profile-cancel-btn');

  // Setup mailto link
  if (requestAccessLink) {
    requestAccessLink.href = getAccessRequestLink();
  }

  // Login form
  loginForm.addEventListener('submit', handleLogin);

  // Toggle between login/register
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

  // Logout
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  // Profile modal
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
}

/**
 * Handle auth state changes — update UI accordingly
 */
export function handleAuthChange(user, { setEditable, formatToolbar, pageTitleInput }) {
  if (user) {
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
    setEditable(canEdit());
    if (formatToolbar) {
      formatToolbar.style.display = canEdit() ? 'flex' : 'none';
    }
    pageTitleInput.readOnly = !canEdit();
  } else {
    authOverlay.classList.remove('hidden');
    if (userInfoEl) userInfoEl.innerHTML = '';
  }
}

// --- Login ---
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

// --- Registration (instant creation + email activation) ---
async function handleRegister(e) {
  e.preventDefault();
  registerError.classList.add('hidden');
  registerBtn.disabled = true;
  registerBtn.textContent = 'Erstelle Account…';

  const email = registerEmailInput.value.trim().toLowerCase();
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
    // 1. Create account in Firebase (initially inactive)
    await register(email, password);
    console.log('[AuthUI] Account created successfully, waiting for activation.');
  } catch (err) {
    // If user exists, we still allow them to send the activation mail (in case they weren't activated yet)
    if (err.code !== 'auth/email-already-in-use') {
      registerError.textContent = 'Fehler bei der Registrierung: ' + err.message;
      registerError.classList.remove('hidden');
      registerBtn.disabled = false;
      registerBtn.textContent = 'Registrieren';
      return;
    }
    console.log('[AuthUI] Account already exists, proceeding to activation step.');
  }

  // 2. Build activation mailto link (empty body, specific subject)
  const subject = encodeURIComponent(`Wiki Activation: ${email}`);
  const mailtoUrl = `mailto:stephansdigitalassistent@gmail.com?subject=${subject}`;

  // 3. Open the mailto link
  window.location.href = mailtoUrl;

  // 4. Show confirmation message
  showToast('Account wurde erstellt! Bitte senden Sie die leere E-Mail von Ihrer @insel.ch Adresse ab, um Ihren Account zu aktivieren.', 'info', 10000);

  // 5. Switch back to login after a moment
  setTimeout(() => {
    registerForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    registerEmailInput.value = '';
    registerPasswordInput.value = '';
  }, 1500);

  registerBtn.disabled = false;
  registerBtn.textContent = 'Registrieren';
}

async function handleLogout() {
  await logout();
  window.location.hash = '';
}

// --- Profile Modal ---
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
    let newAvatarUrl = user.photoURL;
    
    if (selectedAvatarFile) {
      profileSaveBtn.textContent = 'Bild verarbeiten...';
      const resizedFile = await resizeAvatar(selectedAvatarFile, 256);
      profileSaveBtn.textContent = 'Bild hochladen...';
      newAvatarUrl = await uploadAvatar(resizedFile, user.uid);
    }
    
    profileSaveBtn.textContent = 'Profil wird aktualisiert...';
    const updatedUser = await updateUserProfile(newName, newAvatarUrl);
    closeProfileModal();
    showToast('Profil aktualisiert!', 'success');
    
    if (onProfileUpdateCallback) {
      onProfileUpdateCallback(updatedUser);
    }
  } catch (err) {
    console.error('Fehler beim Profil-Update:', err);
    showToast('Profil konnte nicht aktualisiert werden. ' + (err.message || ''), 'error');
  } finally {
    profileSaveBtn.disabled = false;
    profileSaveBtn.textContent = 'Speichern';
  }
}

function resizeAvatar(file, maxDim = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxDim) { height *= maxDim / width; width = maxDim; }
        } else {
          if (height > maxDim) { width *= maxDim / height; height = maxDim; }
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
        }, 'image/jpeg', 0.85);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
