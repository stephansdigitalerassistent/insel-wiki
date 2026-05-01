// One-off cleanup: list (and optionally delete) pages whose title is a
// millisecond timestamp (13-digit number in 2001..~2286 range).
//
// Usage:
//   node scripts/delete-timestamp-pages.mjs           # dry-run, lists matches
//   node scripts/delete-timestamp-pages.mjs --delete  # actually deletes

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
  deleteDoc,
  doc,
  writeBatch,
} from 'firebase/firestore';
import dotenv from 'dotenv';
dotenv.config();

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

const BOT_EMAIL = 'stephansdigitalassistent+wiki@gmail.com';
const BOT_PASSWORD = 'InselWikiUser2026!';
const PAGES = 'pages';

// Match a 13-digit ms-since-1970 timestamp anywhere in the title.
// Range: 2001-09-09 (1e12) .. 2286-11-20 (~9.99e12). Bounded by non-digits
// so we don't match inside longer numbers.
const TS_RE = /(?<!\d)(\d{13})(?!\d)/;

function isTimestampTitle(title) {
  if (!title) return false;
  const m = TS_RE.exec(String(title));
  if (!m) return false;
  const n = Number(m[1]);
  return n >= 1_000_000_000_000 && n <= 9_999_999_999_999;
}

async function deleteSubcollection(db, pageId, sub) {
  const ref = collection(db, PAGES, pageId, sub);
  const snap = await getDocs(ref);
  if (snap.empty) return 0;
  // Batch in chunks of 400 to stay under the 500 limit.
  const docs = snap.docs;
  let deleted = 0;
  for (let i = 0; i < docs.length; i += 400) {
    const chunk = docs.slice(i, i + 400);
    const batch = writeBatch(db);
    chunk.forEach(d => batch.delete(d.ref));
    await batch.commit();
    deleted += chunk.length;
  }
  return deleted;
}

async function main() {
  const doDelete = process.argv.includes('--delete');

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  await signInWithEmailAndPassword(auth, BOT_EMAIL, BOT_PASSWORD);
  console.log(`Signed in as ${BOT_EMAIL}`);

  const snap = await getDocs(collection(db, PAGES));
  const matches = [];
  snap.forEach(d => {
    const data = d.data();
    if (isTimestampTitle(data.title)) {
      matches.push({ id: d.id, title: data.title, deleted: !!data.deleted });
    }
  });

  console.log(`\nFound ${matches.length} page(s) with ms-timestamp titles:`);
  for (const m of matches) {
    const ts = TS_RE.exec(String(m.title))?.[1];
    const date = ts ? new Date(Number(ts)).toISOString() : '?';
    console.log(`  ${m.id}  title="${m.title}"  (${date})  deleted=${m.deleted}`);
  }

  if (!doDelete) {
    console.log('\nDry run. Re-run with --delete to permanently delete these pages.');
    process.exit(0);
  }

  console.log('\nDeleting...');
  let pageCount = 0;
  let subCount = 0;
  const subcollections = ['history', 'comments', 'presence', 'yjs_updates', 'yjs_awareness', 'yjs_state'];
  for (const m of matches) {
    for (const sub of subcollections) {
      try {
        subCount += await deleteSubcollection(db, m.id, sub);
      } catch (e) {
        console.warn(`  ! ${m.id}/${sub}: ${e.code || e.message}`);
      }
    }
    await deleteDoc(doc(db, PAGES, m.id));
    pageCount += 1;
    console.log(`  - deleted ${m.id} ("${m.title}")`);
  }
  console.log(`\nDone. Deleted ${pageCount} page(s) and ${subCount} subcollection doc(s).`);
  process.exit(0);
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
