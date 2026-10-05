// Auth UI Controller — email-code sign-in, password login, and auth overlay management
import { login, requestLoginCode, verifyLoginCode, isAllowedEmail, logout, getCurrentUser, onAuthChange, canEdit, updateUserProfile, isSpellCheckEnabled, setSpellCheckEnabled, changePassword } from '../firebase/auth.js';
import { formatDefaultName } from '../utils/string.js';
import { showToast } from '../components/toast.js';
import { uploadAvatar } from '../firebase/storage.js';
import { validatePassword } from '../services/password-validator.js';
import i18next, { translatePage } from '../i18n.js';

// --- DOM Elements ---
let authOverlay, loginForm, loginEmailInput, loginPasswordInput, loginError, loginBtn;
let codeRequestForm, codeEmailInput, codeRequestBtn, codeRequestError;
let codeVerifyForm, codeSentTo, codeInput, codeVerifyBtn, codeVerifyError, codeResendBtn, codeChangeEmailBtn;
let showPasswordBtn, showCodeBtn;
let profileModal, profileNameInput, profileLanguage, profileAvatarFile, avatarPreviewContainer, avatarPreviewImg;
let profileSaveBtn, profileCancelBtn, profileSpellcheck, profileOldPassword, profileNewPassword;
let userInfoEl;

// Remembers which sign-in form the user last chose (a per-browser convenience).
const AUTH_METHOD_KEY = 'insel-wiki.authMethod';
// Mirrors the server's resend cooldown (functions/lib/login-code.js).
const RESEND_COOLDOWN_SEC = 60;

let pendingCodeEmail = '';
let resendTimer = null;
let verifyInFlight = false;

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
  codeRequestForm = document.getElementById('code-request-form');
  codeEmailInput = document.getElementById('code-email');
  codeRequestBtn = document.getElementById('code-request-btn');
  codeRequestError = document.getElementById('code-request-error');
  codeVerifyForm = document.getElementById('code-verify-form');
  codeSentTo = document.getElementById('code-sent-to');
  codeInput = document.getElementById('code-input');
  codeVerifyBtn = document.getElementById('code-verify-btn');
  codeVerifyError = document.getElementById('code-verify-error');
  codeResendBtn = document.getElementById('code-resend-btn');
  codeChangeEmailBtn = document.getElementById('code-change-email-btn');
  showPasswordBtn = document.getElementById('show-password-btn');
  showCodeBtn = document.getElementById('show-code-btn');
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

  // Password login (accounts created before the code flow)
  loginForm.addEventListener('submit', handleLogin);

  // Email-code sign-in: request, verify, resend
  codeRequestForm.addEventListener('submit', handleCodeRequest);
  codeVerifyForm.addEventListener('submit', handleCodeVerify);
  codeResendBtn.addEventListener('click', handleCodeResend);
  codeChangeEmailBtn.addEventListener('click', () => {
    stopResendCountdown();
    showAuthForm(codeRequestForm);
    codeEmailInput.focus();
  });
  codeInput.addEventListener('input', () => {
    // Keep digits only (a pasted "123 456" still works) and submit once complete.
    const digits = codeInput.value.replace(/\D/g, '').slice(0, 6);
    if (digits !== codeInput.value) codeInput.value = digits;
    if (digits.length === 6) codeVerifyForm.requestSubmit();
  });

  showPasswordBtn.addEventListener('click', () => {
    loginEmailInput.value = loginEmailInput.value || codeEmailInput.value;
    rememberAuthMethod('password');
    showAuthForm(loginForm);
  });
  showCodeBtn.addEventListener('click', () => {
    codeEmailInput.value = codeEmailInput.value || loginEmailInput.value;
    rememberAuthMethod('code');
    showAuthForm(codeRequestForm);
  });

  if (recallAuthMethod() === 'password') showAuthForm(loginForm);

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
    const markdownToggleBtn = document.getElementById('markdown-toggle-btn');
    if (markdownToggleBtn) {
      markdownToggleBtn.style.display = canEdit() ? 'inline-flex' : 'none';
    }
    const markdownEditor = document.getElementById('markdown-editor');
    if (markdownEditor) {
      markdownEditor.readOnly = !canEdit();
    }
    pageTitleInput.readOnly = !canEdit();
  } else {
    authOverlay.classList.remove('hidden');
    const appLayout = document.getElementById('app');
    if (appLayout) appLayout.style.display = 'none';
    if (userInfoEl) userInfoEl.innerHTML = '';
  }
}

// --- Form switching ---
function showAuthForm(form) {
  for (const f of [codeRequestForm, codeVerifyForm, loginForm]) {
    f.classList.toggle('hidden', f !== form);
  }
}

// localStorage can throw (private mode, blocked site data); the choice is only a convenience.
function rememberAuthMethod(method) {
  try { localStorage.setItem(AUTH_METHOD_KEY, method); } catch { /* ignore */ }
}

function recallAuthMethod() {
  try { return localStorage.getItem(AUTH_METHOD_KEY); } catch { return null; }
}

function showAuthError(el, message) {
  el.textContent = message;
  el.classList.remove('hidden');
}

/** Translate a LoginCodeError (or anything else) into a message for the user. */
function describeCodeError(err) {
  const reason = err && err.name === 'LoginCodeError' ? err.code : 'internal';
  const retry = (err && err.retryAfterSec) || RESEND_COOLDOWN_SEC;
  return i18next.t(`auth.code.errors.${reason}`, {
    seconds: retry,
    minutes: Math.max(1, Math.ceil(retry / 60)),
    defaultValue: i18next.t('auth.code.errors.internal')
  });
}

// --- Password login ---
async function handleLogin(e) {
  e.preventDefault();
  loginError.classList.add('hidden');
  loginBtn.disabled = true;
  loginBtn.textContent = i18next.t('common.loading');

  try {
    await login(loginEmailInput.value, loginPasswordInput.value);
  } catch (err) {
    // Firebase's own messages ("Firebase: Error (auth/invalid-credential).") mean nothing to users.
    const isFirebaseAuthError = typeof err.code === 'string' && err.code.startsWith('auth/');
    showAuthError(loginError, isFirebaseAuthError || !err.message ? i18next.t('auth.validation.loginFailed') : err.message);
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = i18next.t('auth.login.submit');
  }
}

// --- Email-code sign-in (also the registration path) ---
async function handleCodeRequest(e) {
  e.preventDefault();
  codeRequestError.classList.add('hidden');

  const email = codeEmailInput.value.trim().toLowerCase();
  if (!isAllowedEmail(email)) {
    showAuthError(codeRequestError, i18next.t('auth.code.errors.invalid_email'));
    return;
  }

  codeRequestBtn.disabled = true;
  codeRequestBtn.textContent = i18next.t('auth.code.sending');
  try {
    await requestLoginCode(email);
    enterCodeStep(email, RESEND_COOLDOWN_SEC);
  } catch (err) {
    if (err.code === 'cooldown') {
      // A code was mailed moments ago (e.g. the page was reloaded) — it is still valid.
      enterCodeStep(email, err.retryAfterSec);
    } else {
      showAuthError(codeRequestError, describeCodeError(err));
    }
  } finally {
    codeRequestBtn.disabled = false;
    codeRequestBtn.textContent = i18next.t('auth.code.send');
  }
}

function enterCodeStep(email, cooldownSec) {
  pendingCodeEmail = email;
  rememberAuthMethod('code');
  // The address is validated above, but it is still user input going into innerHTML.
  const safeEmail = email.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  codeSentTo.innerHTML = i18next.t('auth.code.sentTo', { email: safeEmail, interpolation: { escapeValue: false } });
  codeInput.value = '';
  codeVerifyError.classList.add('hidden');
  showAuthForm(codeVerifyForm);
  startResendCountdown(cooldownSec);
  codeInput.focus();
}

async function handleCodeVerify(e) {
  e.preventDefault();
  if (verifyInFlight) return;
  codeVerifyError.classList.add('hidden');

  const code = codeInput.value.replace(/\D/g, '');
  if (code.length !== 6) {
    showAuthError(codeVerifyError, i18next.t('auth.code.errors.invalid_code'));
    return;
  }

  verifyInFlight = true;
  codeVerifyBtn.disabled = true;
  codeVerifyBtn.textContent = i18next.t('auth.code.verifying');
  try {
    // On success the auth listener hides the overlay; reset the forms for the next sign-out.
    await verifyLoginCode(pendingCodeEmail, code);
    stopResendCountdown();
    codeInput.value = '';
    showAuthForm(codeRequestForm);
  } catch (err) {
    showAuthError(codeVerifyError, describeCodeError(err));
    codeInput.value = '';
    codeInput.focus();
  } finally {
    verifyInFlight = false;
    codeVerifyBtn.disabled = false;
    codeVerifyBtn.textContent = i18next.t('auth.code.verify');
  }
}

async function handleCodeResend() {
  codeVerifyError.classList.add('hidden');
  codeResendBtn.disabled = true;
  try {
    await requestLoginCode(pendingCodeEmail);
    codeInput.value = '';
    startResendCountdown(RESEND_COOLDOWN_SEC);
    showToast(i18next.t('auth.code.resent'), 'success', 3000);
    codeInput.focus();
  } catch (err) {
    if (err.code === 'cooldown') {
      startResendCountdown(err.retryAfterSec);
    } else {
      codeResendBtn.disabled = false;
      showAuthError(codeVerifyError, describeCodeError(err));
    }
  }
}

function startResendCountdown(seconds) {
  stopResendCountdown();
  let remaining = Math.max(1, Math.ceil(seconds || RESEND_COOLDOWN_SEC));
  codeResendBtn.disabled = true;
  const render = () => {
    codeResendBtn.textContent = i18next.t('auth.code.resendIn', { seconds: remaining });
  };
  render();
  resendTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      stopResendCountdown();
    } else {
      render();
    }
  }, 1000);
}

function stopResendCountdown() {
  if (resendTimer) clearInterval(resendTimer);
  resendTimer = null;
  codeResendBtn.disabled = false;
  codeResendBtn.textContent = i18next.t('auth.code.resend');
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
