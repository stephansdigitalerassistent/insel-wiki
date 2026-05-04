// Firestore-level cleanup for test-created pages. Runs as the wiki bot, which
// has delete permission on /pages/* (see firestore.rules). Used by Playwright
// globalSetup and globalTeardown to guarantee idempotent test runs even when
// in-test UI cleanup hooks crash or get skipped.

import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore,
  collection,
  getDocs,
  deleteDoc,
  doc,
  writeBatch,
} from 'firebase/firestore';
import dotenv from 'dotenv';
dotenv.config();

const BOT_EMAIL = 'stephansdigitalassistent+wiki@gmail.com';
const BOT_PASSWORD = 'InselWikiUser2026!';

// Test-created pages always carry a 13-digit ms-since-1970 suffix from
// `${prefix}-${Date.now()}` and one of these prefixes. Any matching page is
// considered fair game to permanently delete.
const TEST_TITLE_RE = /^(TEST-(Robust|TaskPage|Trash)|E2E-(Top|Child)|AUDIT-(Top|Child))-\d{13}$/;

const PAGE_SUBCOLLECTIONS = [
  'history',
  'comments',
  'presence',
  'yjs_updates',
  'yjs_awareness',
  'yjs_state',
];

function getFirebaseConfig() {
  return {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
  };
}

async function deleteSubcollection(db, pageId, sub) {
  const snap = await getDocs(collection(db, 'pages', pageId, sub));
  if (snap.empty) return 0;
  let deleted = 0;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const chunk = docs.slice(i, i + 400);
    const batch = writeBatch(db);
    chunk.forEach(d => batch.delete(d.ref));
    await batch.commit();
    deleted += chunk.length;
  }
  return deleted;
}

/**
 * Permanently delete every page whose title matches TEST_TITLE_RE.
 * Returns { pages, subdocs } counts.
 */
export async function cleanupTestPages({ verbose = true } = {}) {
  const cfg = getFirebaseConfig();
  if (!cfg.apiKey) {
    if (verbose) console.warn('[firestore-cleanup] VITE_FIREBASE_API_KEY missing — skipping.');
    return { pages: 0, subdocs: 0, skipped: true };
  }

  const app = getApps().length ? getApps()[0] : initializeApp(cfg);
  const auth = getAuth(app);
  const db = getFirestore(app);

  await signInWithEmailAndPassword(auth, BOT_EMAIL, BOT_PASSWORD);

  const snap = await getDocs(collection(db, 'pages'));
  const matches = [];
  snap.forEach(d => {
    const title = d.data().title;
    if (title && TEST_TITLE_RE.test(String(title))) {
      matches.push({ id: d.id, title });
    }
  });

  if (verbose) console.log(`[firestore-cleanup] ${matches.length} test page(s) to purge.`);

  let subdocs = 0;
  for (const m of matches) {
    for (const sub of PAGE_SUBCOLLECTIONS) {
      try {
        subdocs += await deleteSubcollection(db, m.id, sub);
      } catch (e) {
        if (verbose) console.warn(`[firestore-cleanup] ${m.id}/${sub}: ${e.code || e.message}`);
      }
    }
    try {
      await deleteDoc(doc(db, 'pages', m.id));
    } catch (e) {
      if (verbose) console.warn(`[firestore-cleanup] ${m.id}: ${e.code || e.message}`);
    }
  }

  if (verbose && matches.length) {
    console.log(`[firestore-cleanup] purged ${matches.length} page(s), ${subdocs} subdoc(s).`);
  }
  return { pages: matches.length, subdocs, skipped: false };
}
