import { storage } from './config.js';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

/**
 * Upload an avatar file to Firebase Storage
 * @param {File} file 
 * @param {string} uid 
 * @returns {Promise<string>} Download URL
 */
export async function uploadAvatar(file, uid) {
  if (!file) throw new Error('Keine Datei ausgewählt');
  
  // Extract file extension and safely upload
  const ext = file.name.split('.').pop() || 'jpg';
  const path = `avatars/${uid}/${uid}.${ext}`;
  const storageRef = ref(storage, path);
  
  const snapshot = await uploadBytes(storageRef, file);
  const url = await getDownloadURL(snapshot.ref);
  return url;
}

/**
 * Upload an image file from the editor to Firebase Storage
 * @param {File} file 
 * @param {string} uid 
 * @returns {Promise<string>} Download URL
 */
export async function uploadImageFile(file, uid) {
  if (!file) throw new Error('Keine Datei übergeben');
  
  const ext = file.name.split('.').pop() || 'png';
  const timestamp = Date.now();
  const path = `editor/${uid}/${timestamp}.${ext}`;
  const storageRef = ref(storage, path);
  
  const snapshot = await uploadBytes(storageRef, file);
  const url = await getDownloadURL(snapshot.ref);
  return url;
}
