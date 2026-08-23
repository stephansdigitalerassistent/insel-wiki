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

const TEST_TITLE_RE = /^(test-|TEST-|E2E-|AUDIT-|FixTest|VoiceTest|DateLink|SearchTarget|Robust-|TaskPage-|Trash-|Test Page|Mentions Test|Comment Test|Checkbox Test).*/i;
const TIMESTAMP_RE = /-\d{13}$/;

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

export async function cleanupTestPages({ verbose = true } = {}) {
  const cfg = getFirebaseConfig();
  const app = getApps().length ? getApps()[0] : initializeApp(cfg);
  const auth = getAuth(app);
  const db = getFirestore(app);

  if (verbose) console.log('[firestore-cleanup] Signing in...');
  await signInWithEmailAndPassword(auth, BOT_EMAIL, BOT_PASSWORD);

  if (verbose) console.log('[firestore-cleanup] Fetching all pages...');
  const snap = await getDocs(collection(db, 'pages'));
  const matches = [];
  
  if (verbose) console.log(`[firestore-cleanup] Total pages in collection: ${snap.size}`);

  snap.forEach(d => {
    const data = d.data();
    const title = data.title || '';
    const parentId = data.parentId || '';
    
    const isTestTitle = TEST_TITLE_RE.test(title);
    const isTimestamped = TIMESTAMP_RE.test(title);
    const isUnderTests = parentId === 'page-tests';

    // Deliberately does NOT match on `title === 'Neue Seite'`. That is the
    // default title the app gives every freshly created page, so the clause
    // matched real users' untitled, in-progress work anywhere in the wiki — not
    // just test fixtures — and this sweep HARD-deletes, bypassing the trash that
    // the delete-page UI uses. Pages created by the e2e suite land under
    // `page-tests`, which `isUnderTests` already covers, and carry a timestamped
    // title, which `isTimestamped` covers.
    if (isTestTitle || isTimestamped || isUnderTests) {
      matches.push({ id: d.id, title, parentId });
    }
  });

  if (verbose) console.log(`[firestore-cleanup] ${matches.length} test page(s) identified for purging.`);

  let subdocs = 0;
  let pagesDeleted = 0;
  for (const m of matches) {
    if (verbose) console.log(`[firestore-cleanup] Purging page: "${m.title}" (${m.id})`);
    for (const sub of PAGE_SUBCOLLECTIONS) {
      try {
        const count = await deleteSubcollection(db, m.id, sub);
        subdocs += count;
        if (verbose && count > 0) console.log(`[firestore-cleanup]   Deleted ${count} from ${sub}`);
      } catch (e) {
        if (verbose) console.warn(`[firestore-cleanup]   Error ${m.id}/${sub}: ${e.code || e.message}`);
      }
    }
    try {
      await deleteDoc(doc(db, 'pages', m.id));
      pagesDeleted++;
    } catch (e) {
      if (verbose) console.warn(`[firestore-cleanup]   Error deleting page doc ${m.id}: ${e.code || e.message}`);
    }
  }

  if (verbose) {
    console.log(`[firestore-cleanup] Purge complete: ${pagesDeleted}/${matches.length} pages, ${subdocs} subdocs.`);
  }
  return { pages: pagesDeleted, subdocs, skipped: false };
}
