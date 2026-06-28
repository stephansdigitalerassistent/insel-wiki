// Auth UI Controller — login, registration, and auth overlay management
import { login, register, logout, getCurrentUser, onAuthChange, canEdit, getAccessRequestLink, updateUserProfile, isSpellCheckEnabled, setSpellCheckEnabled, changePassword } from '../firebase/auth.js';
import { formatDefaultName } from '../utils/string.js';
import { showToast } from '../components/toast.js';
import { uploadAvatar } from '../firebase/storage.js';
import { validatePassword } from '../services/password-validator.js';
import i18next, { translatePage } from '../i18n.js';

// --- DOM Elements ---
let authOverlay, loginForm, loginEmailInput, loginPasswordInput, loginError, loginBtn;
let registerForm, registerEmailInput, registerPasswordInput, registerBtn, registerError;
let forgotForm, forgotEmailInput, forgotBtn, forgotError;
let showRegisterBtn, showLoginBtn, showForgotBtn, showLoginFromForgotBtn;
let activationPanel, activationRecipientEl, activationSubjectEl, activationMailtoBtn, activationCopyBtn, activationBackBtn;
let profileModal, profileNameInput, profileLanguage, profileAvatarFile, avatarPreviewContainer, avatarPreviewImg;
let profileSaveBtn, profileCancelBtn, profileSpellcheck, profileOldPassword, profileNewPassword;
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
  showForgotBtn = document.getElementById('show-forgot-btn');
  showLoginFromForgotBtn = document.getElementById('show-login-from-forgot-btn');
  forgotForm = document.getElementById('forgot-form');
  forgotEmailInput = document.getElementById('forgot-email');
  forgotBtn = document.getElementById('forgot-btn');
  forgotError = document.getElementById('forgot-error');
  activationPanel = document.getElementById('activation-panel');
  activationRecipientEl = document.getElementById('activation-recipient');
  activationSubjectEl = document.getElementById('activation-subject');
  activationMailtoBtn = document.getElementById('activation-mailto-btn');
  activationCopyBtn = document.getElementById('activation-copy-btn');
  activationBackBtn = document.getElementById('activation-back-btn');
  requestAccessLink = document.getElementById('request-access-link');
  userInfoEl = document.getElementById('user-info');
  profileModal = document.getElementById('profile-modal');
  profileNameInput = document.getElementById('profile-name');
  profileLanguage = document.getElementById('profile-language');
  profileAvatarFile = document.getElementById('profile-avatar-file');
  avatarPreviewContainer = document.getElementById('avatar-preview-container');
  avatarPreviewImg = document.getElementById('avatar-preview-img');
  profileSaveBtn = document.getElementById('profile-save-btn');
  profileCancelBtn = document.getElementById('profile-cancel-btn');
  profileSpellcheck = document.getElementById('profile-spellcheck');
  profileOldPassword = document.getElementById('profile-old-password');
  profileNewPassword = document.getElementById('profile-new-password');

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

  // Forgot password
  if (showForgotBtn) {
    showForgotBtn.addEventListener('click', () => {
      loginForm.classList.add('hidden');
      forgotForm.classList.remove('hidden');
      forgotEmailInput.value = loginEmailInput.value || '';
      forgotError.classList.add('hidden');
    });
  }
  if (showLoginFromForgotBtn) {
    showLoginFromForgotBtn.addEventListener('click', () => {
      forgotForm.classList.add('hidden');
      loginForm.classList.remove('hidden');
    });
  }
  if (forgotForm) {
    forgotForm.addEventListener('submit', handleForgotPassword);
  }

  if (activationBackBtn) {
    activationBackBtn.addEventListener('click', () => {
      activationPanel.classList.add('hidden');
      loginForm.classList.remove('hidden');
    });
  }
  if (activationCopyBtn) {
    activationCopyBtn.addEventListener('click', async () => {
      const recipient = activationRecipientEl.textContent;
      const subject = activationSubjectEl.textContent;
      try {
        await navigator.clipboard.writeText(`An: ${recipient}\nBetreff: ${subject}`);
        showToast(i18next.t('messages.clipboardCopied'), 'success', 2000);
      } catch {
        showToast(i18next.t('messages.clipboardError'), 'warning', 4000);
      }
    });
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
    const appLayout = document.getElementById('app');
    if (appLayout) appLayout.style.display = '';
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
    const appLayout = document.getElementById('app');
    if (appLayout) appLayout.style.display = 'none';
    if (userInfoEl) userInfoEl.innerHTML = '';
  }
}

// --- Login ---
async function handleLogin(e) {
  e.preventDefault();
  loginError.classList.add('hidden');
  loginBtn.disabled = true;
  loginBtn.textContent = i18next.t('common.loading');

  try {
    await login(loginEmailInput.value, loginPasswordInput.value);
  } catch (err) {
    loginError.textContent = err.message || 'Anmeldung fehlgeschlagen.';
    loginError.classList.remove('hidden');
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = i18next.t('auth.login.submit');
  }
}

// --- Registration (instant creation + email activation) ---
async function handleRegister(e) {
  e.preventDefault();
  registerError.classList.add('hidden');
  registerBtn.disabled = true;
  registerBtn.textContent = i18next.t('common.loading');

  const email = registerEmailInput.value.trim().toLowerCase();
  const password = registerPasswordInput.value;

  if (!email.endsWith('@insel.ch')) {
    registerError.textContent = 'Nur @insel.ch E-Mail-Adressen sind zugelassen.';
    registerError.classList.remove('hidden');
    registerBtn.disabled = false;
    registerBtn.textContent = i18next.t('auth.register.submit');
    return;
  }

  const validation = validatePassword(password);
  if (!validation.isValid) {
    registerError.textContent = validation.error;
    registerError.classList.remove('hidden');
    registerBtn.disabled = false;
    registerBtn.textContent = i18next.t('auth.register.submit');
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
      registerBtn.textContent = i18next.t('auth.register.submit');
      return;
    }
    console.log('[AuthUI] Account already exists, proceeding to activation step.');
  }

  // 2. Show inline activation panel with mailto details
  const recipient = 'stephansdigitalassistent@gmail.com';
  const subjectPlain = `Wiki Activation: ${email}`;
  activationRecipientEl.textContent = recipient;
  activationSubjectEl.textContent = subjectPlain;
  const mailtoUrl = `mailto:${recipient}?subject=${encodeURIComponent(subjectPlain)}`;
  activationMailtoBtn.href = mailtoUrl;

  registerForm.classList.add('hidden');
  activationPanel.classList.remove('hidden');
  registerEmailInput.value = '';
  registerPasswordInput.value = '';

  // Automatically open the mail client to generate the activation email
  window.location.href = mailtoUrl;

  registerBtn.disabled = false;
  registerBtn.textContent = i18next.t('auth.register.submit');
}

// --- Forgot password (mailto activation, mirrors registration) ---
async function handleForgotPassword(e) {
  e.preventDefault();
  forgotError.classList.add('hidden');
  forgotBtn.disabled = true;
  forgotBtn.textContent = i18next.t('common.loading');

  const email = forgotEmailInput.value.trim().toLowerCase();

  if (!email.endsWith('@insel.ch')) {
    forgotError.textContent = 'Nur @insel.ch E-Mail-Adressen sind zugelassen.';
    forgotError.classList.remove('hidden');
    forgotBtn.disabled = false;
    forgotBtn.textContent = i18next.t('auth.forgot.submit');
    return;
  }

  const subject = encodeURIComponent(`Wiki Password Reset: ${email}`);
  const mailtoUrl = `mailto:stephansdigitalassistent@gmail.com?subject=${subject}`;
  window.location.href = mailtoUrl;

  showToast(i18next.t('messages.forgotInstructions'), 'info', 10000);

  setTimeout(() => {
    forgotForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    forgotEmailInput.value = '';
  }, 1500);

  forgotBtn.disabled = false;
  forgotBtn.textContent = i18next.t('auth.forgot.submit');
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
  if (profileLanguage) {
    profileLanguage.value = i18next.language.split('-')[0]; // Use base language (de, fr, it, en)
  }
  profileAvatarFile.value = '';
  selectedAvatarFile = null;
  if (user.photoURL) {
    avatarPreviewImg.src = user.photoURL;
    avatarPreviewImg.onerror = function() { this.onerror=null; this.src='/favicon.svg'; };
    avatarPreviewContainer.style.display = 'flex';
  } else {
    avatarPreviewContainer.style.display = 'none';
  }
  // Load spell check preference
  if (profileSpellcheck) {
    profileSpellcheck.checked = isSpellCheckEnabled();
  }
  if (profileOldPassword) profileOldPassword.value = '';
  if (profileNewPassword) profileNewPassword.value = '';
  profileModal.classList.remove('hidden');
}

function closeProfileModal() {
  profileModal.classList.add('hidden');
}

async function handleProfileSave() {
  const newName = profileNameInput.value.trim() || null;
  profileSaveBtn.disabled = true;
  profileSaveBtn.textContent = i18next.t('common.saving');
  
  try {
    const user = getCurrentUser();
    let newAvatarUrl = user.photoURL;
    
    if (selectedAvatarFile) {
      profileSaveBtn.textContent = i18next.t('common.loading');
      const resizedFile = await resizeAvatar(selectedAvatarFile, 256);
      profileSaveBtn.textContent = i18next.t('common.saving');
      newAvatarUrl = await uploadAvatar(resizedFile, user.uid);
    }
    
    profileSaveBtn.textContent = i18next.t('common.saving');
    const spellCheck = profileSpellcheck ? profileSpellcheck.checked : undefined;
    const language = profileLanguage ? profileLanguage.value : undefined;
    const updatedUser = await updateUserProfile(newName, newAvatarUrl, spellCheck, language);
    
    // Apply language change immediately
    if (language && i18next.language !== language) {
      await i18next.changeLanguage(language);
      translatePage();
    }
    
    // Handle password change if requested
    const oldPwd = profileOldPassword ? profileOldPassword.value : '';
    const newPwd = profileNewPassword ? profileNewPassword.value : '';

    if (oldPwd || newPwd) {
      if (!oldPwd || !newPwd) {
        throw new Error(i18next.t('errors.unexpected'));
      }
      
      const validation = validatePassword(newPwd);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      profileSaveBtn.textContent = i18next.t('common.saving');
      await changePassword(oldPwd, newPwd);
      showToast(i18next.t('messages.passwordChanged'), 'success');
    }

    closeProfileModal();
    showToast(i18next.t('messages.profileUpdated'), 'success');
    
    if (onProfileUpdateCallback) {
      onProfileUpdateCallback(updatedUser);
    }
  } catch (err) {
    console.error('Fehler beim Profil-Update:', err);
    showToast(i18next.t('messages.profileError') + (err.message || ''), 'error');
  } finally {
    profileSaveBtn.disabled = false;
    profileSaveBtn.textContent = i18next.t('common.save');
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
