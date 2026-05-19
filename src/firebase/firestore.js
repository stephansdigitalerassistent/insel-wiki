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
const ARCHIVE_COLLECTION = 'archive';

/**
 * Create a new page
 */
export async function createPage(title, parentId = null, createdBy = '') {
  // If this is a test page (starts with typical test prefixes) and it's being
  // created at the top level, force it under the 'page-tests' root.
  const isTestPage = /^(test-|TEST|E2E|AUDIT|FixTest|VoiceTest|Test Page|Mentions Test|Comment Test|Checkbox Test)-?/i.test(title);
  if (isTestPage && !parentId) {
    parentId = 'page-tests';
  }

  const pagesRef = collection(db, PAGES_COLLECTION);
  const docRef = await addDoc(pagesRef, {
    title,
    parentId,
    order: 0, // Default order
    content: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy,
    deleted: false
  });
  return docRef.id;
}

/**
 * Get a single page by ID
 */
export async function getPage(pageId) {
  const pageRef = doc(db, PAGES_COLLECTION, pageId);
  const snap = await getDoc(pageRef);
  if (snap.exists()) {
    return { id: snap.id, ...snap.data() };
  }
  return null;
}

/**
 * Update page content. Title is owned by updatePageTitle — saving content
 * must not touch the title field, otherwise a content flush during
 * navigation can clobber the old page's title with the new page's.
 */
export async function savePage(pageId, content, savedBy = '', savedByName = '', savedByPhoto = '') {
  console.log('[Firestore] savePage called for', pageId, 'with content length:', content?.length, 'content starts with:', content?.substring(0, 50));
  const pageRef = doc(db, PAGES_COLLECTION, pageId);
  try {
    await updateDoc(pageRef, {
      content,
      updatedAt: serverTimestamp(),
      lastSavedBy: savedBy,
      lastSavedByName: savedByName,
      lastSavedByPhoto: savedByPhoto
    });
  } catch (err) {
    console.error('Firestore save error:', err);
    if (err.code === 'unavailable') {
      alert('Verbindung zum Server unterbrochen. Bitte überprüfe deine Internetverbindung.');
    } else if (err.code === 'resource-exhausted') {
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
    const snapData = targetSnap.data();
    
    if (snapData.type === 'full') {
      return snapData.content;
    }

    // It's a patch. We need to find the chain of patches since the last full snapshot.
    const q = query(
      historyRef, 
      where('savedAt', '<=', snapData.savedAt),
      orderBy('savedAt', 'desc'),
      limit(20) 
    );
    const querySnapshot = await getDocs(q);
    const entries = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    
    let baseContent = '';
    const chain = [];
    
    for (const entry of entries) {
      if (entry.type === 'full') {
        baseContent = entry.content;
        break;
      }
      chain.unshift(entry);
    }

    if (!baseContent && entries.length > 0) {
      return entries[entries.length - 1].content;
    }

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
 */
export async function deletePage(pageId) {
  const pagesRef = collection(db, PAGES_COLLECTION);
  const q = query(pagesRef, where('parentId', '==', pageId));
  const snapshot = await getDocs(q);
  for (const child of snapshot.docs) {
    await deletePage(child.id);
  }

  const pageRef = doc(db, PAGES_COLLECTION, pageId);
  await updateDoc(pageRef, {
    deleted: true,
    deletedAt: serverTimestamp()
  });
}

/**
 * Restore a soft-deleted page and all its children.
 */
export async function restorePage(pageId) {
  const pageRef = doc(db, PAGES_COLLECTION, pageId);
  await updateDoc(pageRef, {
    deleted: false,
    deletedAt: null
  });

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
 * Move a page and all its children + history to the archive collection,
 * then remove it from the active pages collection.
 */
export async function permanentlyDeletePage(pageId) {
  try {
    const pageRef = doc(db, PAGES_COLLECTION, pageId);
    const pageSnap = await getDoc(pageRef);
    
    if (!pageSnap.exists()) return;
    const pageData = pageSnap.data();

    // 1. Archive children first (recursive)
    const pagesRef = collection(db, PAGES_COLLECTION);
    const q = query(pagesRef, where('parentId', '==', pageId));
    const snapshot = await getDocs(q);
    for (const child of snapshot.docs) {
      await permanentlyDeletePage(child.id);
    }

    // 2. Archive history subcollection
    const historyRef = collection(db, PAGES_COLLECTION, pageId, 'history');
    const historySnaps = await getDocs(historyRef);
    const archivedHistoryRef = collection(db, ARCHIVE_COLLECTION, pageId, 'history');
    
    for (const snap of historySnaps.docs) {
      await setDoc(doc(archivedHistoryRef, snap.id), {
        ...snap.data(),
        archivedAt: serverTimestamp()
      });
      await deleteDoc(snap.ref);
    }

    // 3. Archive comments subcollection
    const commentsRef = collection(db, PAGES_COLLECTION, pageId, 'comments');
    const commentSnaps = await getDocs(commentsRef);
    const archivedCommentsRef = collection(db, ARCHIVE_COLLECTION, pageId, 'comments');

    for (const snap of commentSnaps.docs) {
      await setDoc(doc(archivedCommentsRef, snap.id), {
        ...snap.data(),
        archivedAt: serverTimestamp()
      });
      await deleteDoc(snap.ref);
    }

    // 4. Archive the main page document
    const archiveRef = doc(db, ARCHIVE_COLLECTION, pageId);
    await setDoc(archiveRef, {
      ...pageData,
      archivedAt: serverTimestamp(),
      originalCollection: PAGES_COLLECTION
    });

    // 5. Finally delete the original page
    await deleteDoc(pageRef);
    
    console.log(`[Insel-Wiki] Page ${pageId} successfully moved to archive.`);
  } catch (err) {
    console.error('Error during permanent delete (archiving):', err);
    throw err;
  }
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
 * Subscribe to the full page tree in real time.
 * Filters out documents marked as deleted.
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
  return onSnapshot(pageRef, (snap) => {
    if (snap.exists()) {
      callback({ id: snap.id, ...snap.data() });
    } else {
      callback(null);
    }
  });
}

/**
 * Update multiple pages (used for hierarchy changes)
 */
export async function updatePageHierarchy(pageId, parentId, order) {
  const pageRef = doc(db, PAGES_COLLECTION, pageId);
  await updateDoc(pageRef, { parentId, order, updatedAt: serverTimestamp() });
}

/**
 * Get all children of a page
 */
export async function getChildren(pageId) {
  const pagesRef = collection(db, PAGES_COLLECTION);
  const q = query(pagesRef, where('parentId', '==', pageId), where('deleted', '==', false), orderBy('order', 'asc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Get relative timestamp string
 */
export function formatTimestamp(ts) {
  if (!ts) return 'Gerade eben';
  const date = ts instanceof Timestamp ? ts.toDate() : new Date(ts);
  return date.toLocaleString('de-CH', { 
    day: '2-digit', 
    month: '2-digit', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}



/**
 * Save a new comment
 */
export async function saveComment(pageId, commentId, text, userId, userName) {
  const commentRef = doc(db, PAGES_COLLECTION, pageId, 'comments', commentId);
  await setDoc(commentRef, {
    text,
    userId,
    userName,
    createdAt: serverTimestamp(),
  });
}

/**
 * Subscribe to comments for a page
 */
export function subscribeToComments(pageId, callback) {
  const commentsRef = collection(db, PAGES_COLLECTION, pageId, 'comments');
  const q = query(commentsRef, orderBy('createdAt', 'asc'));
  return onSnapshot(q, (snapshot) => {
    const comments = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(comments);
  });
}

/**
 * Get all active users (for mentions)
 */
export async function getUsers() {
  const usersRef = collection(db, 'users');
  const snapshot = await getDocs(usersRef);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Ensure a page exists (e.g. root test page)
 */
export async function ensurePageExists(pageId, title = 'Tests', parentId = null) {
  const pageRef = doc(db, PAGES_COLLECTION, pageId);
  const snap = await getDoc(pageRef);
  if (!snap.exists()) {
    console.log('[Firestore] Creating missing root page:', pageId);
    await setDoc(pageRef, {
      title,
      parentId,
      order: 0,
      content: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: 'system',
      deleted: false
    });
    return true;
  }
  return false;
}




