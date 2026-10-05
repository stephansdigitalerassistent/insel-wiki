// Authentication module
// There is intentionally no anonymous/public read tier — Firestore rules gate
// reads to @insel.ch users; see ARCHITECTURE.md §5.
//
// Sign-up and sign-in are one flow: the user enters an @insel.ch address, the
// `requestLoginCode` function mails a 6-digit code, `verifyLoginCode` trades it
// for a custom token and activates the account server-side. Accounts that
// already have a password can keep using it.

import { auth, db } from './config.js';
import {
  signInWithEmailAndPassword,
  signInWithCustomToken,
  signOut,
  onAuthStateChanged,
  updateProfile
} from 'firebase/auth';
import { doc, setDoc, getDoc, getDocFromServer, serverTimestamp } from 'firebase/firestore';
import { changeUserPassword } from '../services/auth-service.js';
import i18next, { translatePage } from '../i18n.js';

const ALLOWED_DOMAIN = 'insel.ch';

let currentUser = null;
let spellCheckEnabled = false;
const authListeners = [];

/**
 * Subscribe to auth state changes
 */
export function onAuthChange(callback) {
  authListeners.push(callback);
  // Fire immediately with current state
  if (currentUser !== undefined) {
    callback(currentUser);
  }
  return () => {
    const idx = authListeners.indexOf(callback);
    if (idx >= 0) authListeners.splice(idx, 1);
  };
}

/**
 * Get current user
 */
export function getCurrentUser() {
  return currentUser;
}

/**
 * Test-only helper to override the current user in unit tests.
 */
export function _setCurrentUserForTesting(user) {
  currentUser = user;
}

/**
 * Check if user is logged in
 */
export function isLoggedIn() {
  return currentUser !== null;
}

/**
 * Check if user has edit permissions (@insel.ch domain)
 */
export function canEdit() {
  if (!currentUser || !currentUser.email) return false;
  return currentUser.email.endsWith('@' + ALLOWED_DOMAIN);
}

/**
 * Check if spell check is enabled for the current user
 */
export function isSpellCheckEnabled() {
  return spellCheckEnabled;
}

/**
 * Set spell check preference (local cache — must be persisted via updateUserProfile)
 */
export function setSpellCheckEnabled(enabled) {
  spellCheckEnabled = enabled;
}

/**
 * Error from the login-code endpoints. `code` is the server's machine-readable
 * reason (e.g. 'cooldown', 'invalid_code'), which the UI maps to
 * `auth.code.errors.<code>`.
 */
export class LoginCodeError extends Error {
  constructor(code, retryAfterSec) {
    super(code);
    this.name = 'LoginCodeError';
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

export function isAllowedEmail(email) {
  return typeof email === 'string' && email.trim().toLowerCase().endsWith('@' + ALLOWED_DOMAIN);
}

async function postLoginCodeEndpoint(path, payload) {
  let response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch {
    throw new LoginCodeError('network');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new LoginCodeError(data.error || 'internal', data.retryAfterSec);
  }
  return data;
}

/**
 * Ask the server to mail a one-time code to an @insel.ch address.
 */
export async function requestLoginCode(email) {
  if (!isAllowedEmail(email)) throw new LoginCodeError('invalid_email');
  await postLoginCodeEndpoint('/api/requestLoginCode', {
    email: email.trim().toLowerCase(),
    lang: (i18next.language || 'de').split('-')[0]
  });
}

/**
 * Trade the mailed code for a session. The server creates the account on first
 * use and marks it active, so there is no separate registration step.
 */
export async function verifyLoginCode(email, code) {
  const { token } = await postLoginCodeEndpoint('/api/verifyLoginCode', {
    email: email.trim().toLowerCase(),
    code
  });
  return signInWithCustomToken(auth, token);
}

/**
 * Changes the current user's password
 */
export async function changePassword(oldPassword, newPassword) {
    return changeUserPassword(oldPassword, newPassword);
}

/**
 * Login with email and password
 */
export async function login(email, password) {
  if (!isAllowedEmail(email)) {
    throw new Error(i18next.t('auth.validation.onlyInsel'));
  }
  
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
    const user = userCredential.user;

    // Check if active in Firestore (force server fetch to bypass stale cache)
    const userRef = doc(db, 'users', user.uid);
    let userSnap;
    try {
      userSnap = await getDocFromServer(userRef);
    } catch (e) {
      console.warn('[Auth] Failed to fetch active status from server, falling back to cache:', e.message);
      userSnap = await getDoc(userRef);
    }
    
    if (!userSnap.exists() || userSnap.data().isActive !== true) {
      await signOut(auth); // Log out immediately if not active
      throw new Error(i18next.t('auth.validation.notActivated'));
    }

    // Cache spell check preference
    spellCheckEnabled = userSnap.data().spellCheckEnabled === true;

    return userCredential;
  } catch (error) {
    console.error('[Auth] Login failed:', {
      message: error.message,
      code: error.code,
      status: error.status,
      customData: error.customData
    });
    throw error;
  }
}

/**
 * Logout
 */
export async function logout() {
  return signOut(auth);
}

/**
 * Initialize auth listener
 */
export function initAuth() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Double check if still active (try server first to update any stale local cache)
        const userRef = doc(db, 'users', user.uid);
        let userSnap;
        try {
          userSnap = await getDocFromServer(userRef);
        } catch (e) {
          console.warn('[Auth] Failed to double-check active status from server, falling back to cache:', e.message);
          userSnap = await getDoc(userRef);
        }
        if (!userSnap.exists() || userSnap.data().isActive !== true) {
          console.warn('[Auth] User session found but user is not active in Firestore. Logging out.');
          await signOut(auth);
          currentUser = null;
        } else {
          currentUser = user;
          // Load spell check preference on session restore
          spellCheckEnabled = userSnap.data().spellCheckEnabled === true;

          // Load and apply language preference
          const lang = userSnap.data().language;
          if (lang) {
            if (i18next.language !== lang) {
              i18next.changeLanguage(lang).then(() => translatePage()).catch(err => console.error('[Auth] Failed to apply language preference:', err));
            }
          }
        }
      } else {
        currentUser = null;
      }
      
      authListeners.forEach((cb) => cb(currentUser));
      resolve(currentUser);
    });
  });
}

/**
 * Update user profile details (Name, Photo URL, Spellcheck, Language)
 */
export async function updateUserProfile(displayName, photoURL, spellCheck, language) {
  if (!currentUser) throw new Error('Nicht angemeldet.');
  
  await updateProfile(currentUser, { displayName, photoURL });
  
  // Sync with Firestore users collection for mentions/search
  const userRef = doc(db, 'users', currentUser.uid);
  const updateData = {
    displayName,
    photoURL,
    email: currentUser.email,
    updatedAt: serverTimestamp()
  };
  
  // Only write spellCheckEnabled if explicitly provided
  if (spellCheck !== undefined) {
    updateData.spellCheckEnabled = spellCheck;
    spellCheckEnabled = spellCheck;
  }

  // Only write language if explicitly provided
  if (language !== undefined) {
    updateData.language = language;
  }
  
  await setDoc(userRef, updateData, { merge: true });

  // Firebase Auth does not trigger onAuthStateChanged after updateProfile.
  // We use the updated User object from the SDK to keep all methods (getIdToken, etc.) intact.
  currentUser = auth.currentUser;
  
  // Trigger listeners manually
  authListeners.forEach((cb) => cb(currentUser));
  
  return currentUser;
}
