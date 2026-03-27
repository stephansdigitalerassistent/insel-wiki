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
  writeBatch,
  getCountFromServer
} from 'firebase/firestore';
import DiffMatchPatch from 'diff-match-patch';

const dmp = new DiffMatchPatch();

// --- History settings ---
const SNAPSHOT_KEYFRAME_INTERVAL = 10; // Save full snapshot every 10th change

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
 * Uses a hybrid approach: saves full text occasionally, and patches for small changes.
 */
export async function createHistorySnapshot(pageId, content, title, savedBy = '') {
  try {
    const historyRef = collection(db, PAGES_COLLECTION, pageId, 'history');
    
    // 1. Get the latest version to compare
    const latestSnap = await getLatestHistorySnapshot(pageId);
    let latestContent = '';
    
    if (latestSnap) {
      latestContent = await getFullHistoryContent(pageId, latestSnap.id);
    }
    
    let type = 'full';
    let storedContent = content;

    if (latestContent) {
      // 2. Decide if patch or full
      const snapshotCount = await getCountFromServer(historyRef);
      const count = snapshotCount.data().count;
      
      // Calculate diff
      const diffs = dmp.diff_main(latestContent, content);
      dmp.diff_cleanupSemantic(diffs);
      const patches = dmp.patch_make(latestContent, diffs);
      const patchText = dmp.patch_toText(patches);

      // Criteria for patch:
      const isSmallPatch = patchText.length < content.length * 0.5;
      const isIntervalKeyframe = (count > 0 && count % SNAPSHOT_KEYFRAME_INTERVAL === 0);

      if (isSmallPatch && !isIntervalKeyframe) {
        type = 'patch';
        storedContent = patchText;
      }
    }

    await addDoc(historyRef, {
      content: storedContent,
      type, // 'full' or 'patch'
      title: title || '',
      savedBy,
      savedAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('[Insel-Wiki] Snapshot error:', err);
  }
}

/**
 * Get the full content of a history entry, reconstructing it from patches if necessary.
 */
export async function getFullHistoryContent(pageId, snapshotId) {
  try {
    const historyRef = collection(db, PAGES_COLLECTION, pageId, 'history');
    const targetSnap = await getDoc(doc(historyRef, snapshotId));
    
    if (!targetSnap.exists()) return '';
    const data = targetSnap.data();
    
    if (data.type === 'full') {
      return data.content;
    }

    // It's a patch. We need to find the chain of patches since the last full snapshot.
    // To keep it simple and performant, we fetch all history entries before this one, 
    // ordered by date descending, until we hit a 'full' one.
    const q = query(
      historyRef, 
      where('savedAt', '<=', data.savedAt),
      orderBy('savedAt', 'desc'),
      limit(20) // Limit the chain depth for safety
    );
    const querySnapshot = await getDocs(q);
    const entries = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Find the first 'full' entry in the past
    let baseContent = '';
    const chain = [];
    
    for (const entry of entries) {
      if (entry.type === 'full') {
        baseContent = entry.content;
        break;
      }
      chain.unshift(entry); // Add to beginning to process in chronological order
    }

    if (!baseContent && entries.length > 0) {
      // Fallback: If we didn't find a full snap in the last 20, 
      // the chain is too long or broken.
      console.warn('History chain too long or broken for', snapshotId);
      return entries[entries.length - 1].content; // best effort
    }

    // Apply patches in order
    let currentContent = baseContent;
    for (const patchEntry of chain) {
      try {
        const patches = dmp.patch_fromText(patchEntry.content);
        const [reconstructed] = dmp.patch_apply(patches, currentContent);
        currentContent = reconstructed;
      } catch (e) {
        console.error('Failed to apply patch', patchEntry.id, e);
      }
    }

    return currentContent;
  } catch (err) {
    console.error('Error reconstructing history content:', err);
    return '';
  }
}

/**
 * Compute a visual HTML diff between two texts
 */
export function computeDiffHtml(oldText, newText) {
  const diffs = dmp.diff_main(oldText || '', newText || '');
  dmp.diff_cleanupSemantic(diffs);
  return dmp.diff_prettyHtml(diffs);
}

/**
 * Get the latest history snapshot for a page
 */
export async function getLatestHistorySnapshot(pageId) {
  try {
    const historyRef = collection(db, PAGES_COLLECTION, pageId, 'history');
    const q = query(historyRef, orderBy('savedAt', 'desc'), limit(1));
    const querySnapshot = await getDocs(q);
    
    if (!querySnapshot.empty) {
      const doc = querySnapshot.docs[0];
      return { id: doc.id, ...doc.data() };
    }
    return null;
  } catch (err) {
    console.error('Error getting latest snapshot:', err);
    return null;
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
