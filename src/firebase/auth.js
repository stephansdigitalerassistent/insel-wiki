// Authentication module
// Flow: Non-logged-in users see read-only wiki + mailto link to request access.
// @insel.ch users send their chosen password via email → admin or Cloud Function creates account.
// Logged-in users can edit.

import { auth, db } from './config.js';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

// Wiki admin email — receiving end for access requests
const WIKI_ADMIN_EMAIL = 'wiki-admin@insel.ch';
const ALLOWED_DOMAIN = 'insel.ch';

let currentUser = null;
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
 * Login with email and password
 */
export async function login(email, password) {
  if (!email.endsWith('@' + ALLOWED_DOMAIN)) {
    throw new Error('Nur @insel.ch E-Mail-Adressen sind zugelassen.');
  }
  return signInWithEmailAndPassword(auth, email, password);
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
    onAuthStateChanged(auth, (user) => {
      currentUser = user;
      authListeners.forEach((cb) => cb(user));
      resolve(user);
    });
  });
}

/**
 * Update user profile details (Name, Photo URL)
 */
export async function updateUserProfile(displayName, photoURL) {
  if (!currentUser) throw new Error('Nicht angemeldet.');
  
  await updateProfile(currentUser, { displayName, photoURL });
  
  // Sync with Firestore users collection for mentions/search
  const userRef = doc(db, 'users', currentUser.uid);
  await setDoc(userRef, {
    displayName,
    photoURL,
    email: currentUser.email,
    updatedAt: serverTimestamp()
  }, { merge: true });

  // Firebase Auth does not trigger onAuthStateChanged after updateProfile.
  // We use the updated User object from the SDK to keep all methods (getIdToken, etc.) intact.
  currentUser = auth.currentUser;
  
  // Trigger listeners manually
  authListeners.forEach((cb) => cb(currentUser));
  
  return currentUser;
}
