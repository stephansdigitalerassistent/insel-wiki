import { auth } from '../firebase/config.js';
import { 
  updatePassword, 
  reauthenticateWithCredential, 
  EmailAuthProvider,
  createUserWithEmailAndPassword
} from 'firebase/auth';

/**
 * Changes the password of the currently logged-in user
 * @param {string} oldPassword 
 * @param {string} newPassword 
 */
export async function changeUserPassword(oldPassword, newPassword) {
  const user = auth.currentUser;
  if (!user) throw new Error('Nicht angemeldet.');

  const credential = EmailAuthProvider.credential(user.email, oldPassword);
  try {
    await reauthenticateWithCredential(user, credential);
  } catch (error) {
    if (error.code === 'auth/wrong-password') {
      throw new Error('Das aktuelle Passwort ist nicht korrekt.');
    }
    throw error;
  }

  await updatePassword(user, newPassword);
}

/**
 * Wrapper for creating a user (used by register)
 * @param {string} email 
 * @param {string} password 
 */
export async function createAuthUser(email, password) {
    return createUserWithEmailAndPassword(auth, email, password);
}
