// Firestore CRUD operations for wiki pages
import { db } from './config.js';
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  limit,
  writeBatch
} from 'firebase/firestore';

// --- History compaction settings ---
const HISTORY_KEEP_RECENT = 20;        // keep last N entries as-is
const HISTORY_MAX_AGE_DAYS = 30;       // delete entries older than this
const HISTORY_COMPACT_INTERVAL_MS = 5 * 60 * 1000; // snapshot every 5 min

const PAGES_COLLECTION = 'pages';

/**
 * Create a new page
 */
export async function createPage(title, parentId = null, createdBy = '') {
  const pagesRef = collection(db, PAGES_COLLECTION);
  
  // Get next order number for siblings
  const siblings = await getChildren(parentId);
  const order = siblings.length;

  const docRef = await addDoc(pagesRef, {
    title,
    content: '',
    parentId,
    order,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy,
  });

  return docRef.id;
}

/**
 * Get a single page by ID
 */
export async function getPage(pageId) {
  const docRef = doc(db, PAGES_COLLECTION, pageId);
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...snapshot.data() };
}

/**
 * Get children of a page (or root pages if parentId is null)
 */
export async function getChildren(parentId = null) {
  const pagesRef = collection(db, PAGES_COLLECTION);
  const q = query(
    pagesRef,
    where('parentId', '==', parentId),
    orderBy('order', 'asc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Save page content only (no history snapshot).
 * Called by the editor's debounced auto-save.
 */
export async function savePage(pageId, content, title, savedBy = '') {
  try {
    const pageRef = doc(db, PAGES_COLLECTION, pageId);
    const updates = { updatedAt: serverTimestamp() };
    if (content !== undefined) updates.content = content;
    if (title !== undefined) updates.title = title;
    await updateDoc(pageRef, updates);
  } catch (err) {
    console.error('[Insel-Wiki] Save error:', err);
    if (err.message && err.message.includes('longer than 1048487 bytes')) {
      alert('Speicherfehler: Der Inhalt der Seite ist zu groß (über 1MB). Bitte reduziere die Menge an eingefügten Bildern.');
    }
  }
}

/**
 * Create a history snapshot explicitly.
 * Called on page leave, periodic interval, or manual trigger.
 */
export async function createHistorySnapshot(pageId, content, title, savedBy = '') {
  try {
    const historyRef = collection(db, PAGES_COLLECTION, pageId, 'history');
    await addDoc(historyRef, {
      content,
      title: title || '',
      savedBy,
      savedAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('[Insel-Wiki] Snapshot error:', err);
    // Ignore history snapshot crashes for oversize docs silently to not annoy user twice,
    // they already get savePage alerts.
  }
}

/**
 * Compact history: keep last HISTORY_KEEP_RECENT entries,
 * for older entries keep only 1 per day, delete entries older than
 * HISTORY_MAX_AGE_DAYS.
 * Runs automatically when history is loaded.
 */
export async function compactHistory(pageId) {
  const historyRef = collection(db, PAGES_COLLECTION, pageId, 'history');
  const q = query(historyRef, orderBy('savedAt', 'desc'));
  const snapshot = await getDocs(q);
  const entries = snapshot.docs;

  if (entries.length <= HISTORY_KEEP_RECENT) return; // nothing to compact

  const now = Date.now();
  const maxAgeMs = HISTORY_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const seenDays = new Set(); // track "YYYY-MM-DD" keys for daily dedup
  const toDelete = [];

  entries.forEach((entry, index) => {
    // Always keep the most recent entries
    if (index < HISTORY_KEEP_RECENT) return;

    const data = entry.data();
    const ts = data.savedAt;
    const date = ts instanceof Timestamp ? ts.toDate() : new Date(ts);
    const ageMs = now - date.getTime();

    // Delete entries older than max age
    if (ageMs > maxAgeMs) {
      toDelete.push(entry.ref);
      return;
    }

    // For remaining old entries, keep 1 per day
    const dayKey = date.toISOString().slice(0, 10); // "YYYY-MM-DD"
    if (seenDays.has(dayKey)) {
      toDelete.push(entry.ref);
    } else {
      seenDays.add(dayKey);
    }
  });

  // Batch delete (Firestore limit: 500 per batch, but unlikely to hit)
  for (const ref of toDelete) {
    await deleteDoc(ref);
  }

  if (toDelete.length > 0) {
    console.log(`[Insel-Wiki] Compacted history for page ${pageId}: removed ${toDelete.length} old entries`);
  }
}

/**
 * Update page title only
 */
export async function updatePageTitle(pageId, title) {
  const pageRef = doc(db, PAGES_COLLECTION, pageId);
  await updateDoc(pageRef, { title, updatedAt: serverTimestamp() });
}

/**
 * Soft-delete a page and all its children recursively.
 * Sets `deleted: true` and `deletedAt` timestamp — data is preserved.
 */
export async function deletePage(pageId) {
  // Soft-delete children first
  const children = await getChildren(pageId);
  for (const child of children) {
    await deletePage(child.id);
  }

  // Mark page as deleted
  const pageRef = doc(db, PAGES_COLLECTION, pageId);
  await updateDoc(pageRef, {
    deleted: true,
    deletedAt: serverTimestamp(),
  });
}

/**
 * Restore a soft-deleted page (and its children).
 */
export async function restorePage(pageId) {
  const pageRef = doc(db, PAGES_COLLECTION, pageId);
  await updateDoc(pageRef, {
    deleted: false,
    deletedAt: null,
  });

  // Also restore children that were deleted together
  const pagesRef = collection(db, PAGES_COLLECTION);
  const q = query(pagesRef, where('parentId', '==', pageId), where('deleted', '==', true));
  const snapshot = await getDocs(q);
  for (const child of snapshot.docs) {
    await restorePage(child.id);
  }
}

/**
 * Get all soft-deleted pages (for the trash view).
 */
export async function getDeletedPages() {
  const pagesRef = collection(db, PAGES_COLLECTION);
  const q = query(pagesRef, where('deleted', '==', true), orderBy('deletedAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Permanently delete a page and all its children + history.
 * This is irreversible.
 */
export async function permanentlyDeletePage(pageId) {
  // Delete children first
  const pagesRef = collection(db, PAGES_COLLECTION);
  const q = query(pagesRef, where('parentId', '==', pageId));
  const snapshot = await getDocs(q);
  for (const child of snapshot.docs) {
    await permanentlyDeletePage(child.id);
  }

  // Delete history subcollection
  const historyRef = collection(db, PAGES_COLLECTION, pageId, 'history');
  const historySnaps = await getDocs(historyRef);
  for (const snap of historySnaps.docs) {
    await deleteDoc(snap.ref);
  }

  // Delete the page document
  const pageRef = doc(db, PAGES_COLLECTION, pageId);
  await deleteDoc(pageRef);
}

/**
 * Get history entries for a page
 */
export async function getHistory(pageId) {
  const historyRef = collection(db, PAGES_COLLECTION, pageId, 'history');
  const q = query(historyRef, orderBy('savedAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Subscribe to the full page tree in real time
 * Returns an unsubscribe function
 */
export function subscribeToPages(callback) {
  const pagesRef = collection(db, PAGES_COLLECTION);
  const q = query(pagesRef, orderBy('order', 'asc'));
  return onSnapshot(q, (snapshot) => {
    const pages = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => !p.deleted);
    callback(pages);
  });
}

/**
 * Subscribe to a single page in real time
 */
export function subscribeToPage(pageId, callback) {
  const pageRef = doc(db, PAGES_COLLECTION, pageId);
  return onSnapshot(pageRef, (snapshot) => {
    if (snapshot.exists()) {
      callback({ id: snapshot.id, ...snapshot.data() });
    } else {
      callback(null);
    }
  });
}

/**
 * Format a Firestore timestamp for display
 */
export function formatTimestamp(ts) {
  if (!ts) return '';
  const date = ts instanceof Timestamp ? ts.toDate() : new Date(ts);
  return date.toLocaleString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Update the hierarchy and order of pages.
 * Called when a page is dragged and dropped.
 */
export async function updatePageHierarchy(draggedId, newParentId, newOrder) {
  const batch = writeBatch(db);
  const pagesRef = collection(db, PAGES_COLLECTION);
  
  // 1. Get all siblings in the new parent's context
  const targetSiblings = await getChildren(newParentId);
  const siblingsList = targetSiblings
    .filter(p => p.id !== draggedId && !p.deleted) // remove dragged item from current position
    .sort((a, b) => a.order - b.order);
    
  // 2. Insert dragged item at the requested target index
  // Note: we just need to place an object representing the dragged item at the specified index
  const draggedPlaceholder = { id: draggedId };
  siblingsList.splice(newOrder, 0, draggedPlaceholder);
  
  // 3. Batch update the new order for all siblings in the destination list
  siblingsList.forEach((sibling, index) => {
    const ref = doc(db, PAGES_COLLECTION, sibling.id);
    const updates = { order: index };
    
    // For the dragged item itself, also update parentId
    if (sibling.id === draggedId) {
      updates.parentId = newParentId;
      updates.updatedAt = serverTimestamp();
    }
    
    batch.update(ref, updates);
  });
  
  await batch.commit();
}

// --- Registration Workflow ---

export async function createRegistrationRequest(tokenId, email, password) {
  const reqRef = doc(db, 'registration_requests', tokenId);
  await setDoc(reqRef, {
    email: email,
    password: password,
    status: 'pending',
    createdAt: serverTimestamp()
  });
}

export function subscribeToRegistrationRequest(tokenId, callback) {
  const reqRef = doc(db, 'registration_requests', tokenId);
  return onSnapshot(reqRef, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.data());
    } else {
      callback(null); // Document was deleted (could mean success or cancelled)
    }
  });
}

export async function cancelRegistrationRequest(tokenId) {
  const reqRef = doc(db, 'registration_requests', tokenId);
  await deleteDoc(reqRef);
}
