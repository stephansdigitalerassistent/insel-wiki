import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

await signInWithEmailAndPassword(auth, 'stephansdigitalassistent+wiki@gmail.com', 'InselWikiUser2026!');
const snap = await getDocs(collection(db, 'pages'));
const titles = [];
snap.forEach(d => {
  const t = d.data().title;
  titles.push({ id: d.id, title: t, deleted: !!d.data().deleted });
});
// Show those that contain a digit run >= 10 — likely candidates
const digits = titles.filter(t => /\d{10,}/.test(String(t.title || '')));
console.log(`Total pages: ${titles.length}`);
console.log(`With long digit run (>=10): ${digits.length}`);
for (const t of digits) {
  console.log(`  ${t.id}  title="${t.title}"  deleted=${t.deleted}`);
}
process.exit(0);
