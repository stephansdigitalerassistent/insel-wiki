// Authentication module
// Flow: Non-logged-in users see read-only wiki + mailto link to request access.
// @insel.ch users send their chosen password via email → admin or Cloud Function creates account.
// Logged-in users can edit.

import { auth, db } from './config.js';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';

// Wiki admin email — receiving end for access requests
const WIKI_ADMIN_EMAIL = 'stephansdigitalassistent@gmail.com';
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
 * Register a new user with email and password
 * Creates the user in Firebase Auth and a pending document in Firestore
 */
export async function register(email, password) {
  if (!email.endsWith('@' + ALLOWED_DOMAIN)) {
    throw new Error('Nur @insel.ch E-Mail-Adressen sind zugelassen.');
  }
  
  // 1. Create in Firebase Auth
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;
  
  // 2. Create in Firestore with isActive: false
  const userRef = doc(db, 'users', user.uid);
  await setDoc(userRef, {
    email: email,
    displayName: email.split('@')[0].split('.').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' '),
    isActive: false, // Must be activated via email bot
    updatedAt: serverTimestamp()
  }, { merge: true });

  // 3. Log out immediately (user is logged in by createUserWithEmailAndPassword)
  // They should not have access until the bot activates them.
  await signOut(auth);
  
  return user;
}

/**
 * Login with email and password
 */
export async function login(email, password) {
  if (!email.endsWith('@' + ALLOWED_DOMAIN)) {
    throw new Error('Nur @insel.ch E-Mail-Adressen sind zugelassen.');
  }
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;

  // Check if active in Firestore
  const userRef = doc(db, 'users', user.uid);
  const userSnap = await getDoc(userRef);
  
  if (!userSnap.exists() || userSnap.data().isActive !== true) {
    await signOut(auth); // Log out immediately if not active
    throw new Error('Account ist noch nicht aktiviert. Bitte senden Sie die Aktivierungs-E-Mail ab.');
  }

  // Cache spell check preference
  spellCheckEnabled = userSnap.data().spellCheckEnabled === true;

  return userCredential;
}

/**
 * Logout
 */
export async function logout() {
  return signOut(auth);
}

/**
 * Generate the mailto link for access requests
 */
export function getAccessRequestLink() {
  const subject = encodeURIComponent('Insel-Wiki Zugang anfordern');
  const body = encodeURIComponent(
    'Hallo,\n\n' +
    'Ich möchte Zugang zum Insel-Wiki erhalten.\n\n' +
    'Mein gewünschtes Passwort: [PASSWORT HIER EINGEBEN]\n\n' +
    'Vielen Dank!'
  );
  return `mailto:${WIKI_ADMIN_EMAIL}?subject=${subject}&body=${body}`;
}

/**
 * Initialize auth listener
 */
export function initAuth() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Double check if still active
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists() || userSnap.data().isActive !== true) {
          console.warn('[Auth] User session found but user is not active in Firestore. Logging out.');
          await signOut(auth);
          currentUser = null;
        } else {
          currentUser = user;
          // Load spell check preference on session restore (critical for page refresh!)
          spellCheckEnabled = userSnap.data().spellCheckEnabled === true;
          console.log('[Auth] Session restored. spellCheckEnabled:', spellCheckEnabled);
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
 * Update user profile details (Name, Photo URL)
 */
export async function updateUserProfile(displayName, photoURL, spellCheck) {
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
  
  await setDoc(userRef, updateData, { merge: true });

  // Firebase Auth does not trigger onAuthStateChanged after updateProfile.
  // We use the updated User object from the SDK to keep all methods (getIdToken, etc.) intact.
  currentUser = auth.currentUser;
  
  // Trigger listeners manually
  authListeners.forEach((cb) => cb(currentUser));
  
  return currentUser;
}
