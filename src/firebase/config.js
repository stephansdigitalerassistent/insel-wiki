// Firebase configuration for Insel-Wiki
import { initializeApp } from 'firebase/app';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache } from 'firebase/firestore';
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

const app = initializeApp(firebaseConfig);

// Modern persistence API — supports multi-tab out of the box
// In Playwright tests, IndexedDB caching with Service Workers blocked can cause BloomFilter errors
// and auth token sync issues (resulting in permission-denied). Use memory cache for tests.
export const isTestEnv = typeof navigator !== 'undefined' && (
  navigator.webdriver || 
  window.__playwright_test__ || 
  window.location.hostname === 'localhost' || 
  window.location.hostname === '127.0.0.1'
);

// Suppress internal Firestore BloomFilter errors in tests as they are expected when Service Workers are blocked
if (isTestEnv && typeof window !== 'undefined') {
  const originalWarn = console.warn;
  console.warn = (...args) => {
    if (args[0] && typeof args[0] === 'string' && args[0].includes('BloomFilter error')) return;
    originalWarn.apply(console, args);
  };
  const originalError = console.error;
  console.error = (...args) => {
    if (args[0] && typeof args[0] === 'string' && args[0].includes('BloomFilter error')) return;
    originalError.apply(console, args);
  };
}

export const db = initializeFirestore(app, {
  localCache: isTestEnv ? memoryLocalCache() : persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
export const auth = getAuth(app);
if (isTestEnv) {
  setPersistence(auth, browserLocalPersistence).catch(err => {
    console.warn('[FirebaseConfig] Failed to set auth persistence:', err);
  });
}
export const storage = getStorage(app);
