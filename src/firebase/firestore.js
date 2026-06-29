// Firestore CRUD operations for wiki pages
import { db, auth, isTestEnv } from './config.js';
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
import { shouldLogError } from '../utils/error-filter.js';
import { getBreadcrumbs } from '../utils/breadcrumbs.js';

const dmp = new DiffMatchPatch();

// Build version injected by Vite (see vite.config.js `define`); falls back to
// 'dev' in non-bundled contexts such as unit tests.
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

// Client-side rate limit so an error inside a render/retry loop can't write
// thousands of docs. Tracks write timestamps within a rolling window.
const MAX_ERROR_LOGS_PER_WINDOW = 20;
const ERROR_LOG_WINDOW_MS = 60_000;
let errorLogTimestamps = [];

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
  if (isTestPage && !parentId && isTestEnv) {
    parentId = 'page-tests';
  }

  let allowedEmails = ['*'];
  if (parentId && parentId !== 'page-tests') {
    try {
      const parentSnap = await getDoc(doc(db, PAGES_COLLECTION, parentId));
      if (parentSnap.exists()) {
        const parentData = parentSnap.data();
        if (parentData.allowedEmails) {
          allowedEmails = parentData.allowedEmails;
        }
      }
    } catch (e) {
      console.warn('[Firestore] Failed to inherit parent ACL:', e);
    }
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
    deleted: false,
    allowedEmails
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
  if (isTestEnv) {
    console.log('[Firestore] savePage called for', pageId, 'with content length:', content?.length, 'content starts with:', content?.substring(0, 50));
  }
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
    throw err;
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
 * Helper to manage atomic batch writes in Firestore.
 * Automatically chunks writes into batches of up to 400 operations to respect Firestore's 500-write limit.
 * 
 * NOTE: This is atomic per 400-operation chunk, not globally atomic across all chunks. 
 * If a write in a later chunk fails, updates/deletes in earlier chunks will already have been committed. 
 * For instance, in permanentlyDeletePage, a mid-way failure could leave a page partially archived/deleted.
 */
class BatchCommitter {
  constructor(databaseInstance) {
    this.db = databaseInstance;
    this.batches = [writeBatch(this.db)];
    this.count = 0;
  }

  set(ref, data, options) {
    const currentBatch = this.batches[this.batches.length - 1];
    if (options) {
      currentBatch.set(ref, data, options);
    } else {
      currentBatch.set(ref, data);
    }
    this._increment();
  }

  update(ref, data) {
    const currentBatch = this.batches[this.batches.length - 1];
    currentBatch.update(ref, data);
    this._increment();
  }

  delete(ref) {
    const currentBatch = this.batches[this.batches.length - 1];
    currentBatch.delete(ref);
    this._increment();
  }

  _increment() {
    this.count++;
    if (this.count >= 400) {
      this.batches.push(writeBatch(this.db));
      this.count = 0;
    }
  }

  async commit() {
    // Commit sequentially to stop on the first error and prevent further chunk pollution
    for (const batch of this.batches) {
      await batch.commit();
    }
  }
}

/**
 * Soft-delete a page and all its children recursively.
 */
export async function deletePage(pageId) {
  if (isTestEnv) {
    return _clientDeletePage(pageId);
  }
  let token = '';
  if (auth.currentUser) {
    token = await auth.currentUser.getIdToken();
  }
  const response = await fetch('/api/deletePage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ pageId })
  });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Failed to delete page: ${errorBody || response.statusText}`);
  }
}

export async function restorePage(pageId) {
  if (isTestEnv) {
    return _clientRestorePage(pageId);
  }
  let token = '';
  if (auth.currentUser) {
    token = await auth.currentUser.getIdToken();
  }
  const response = await fetch('/api/restorePage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ pageId })
  });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Failed to restore page: ${errorBody || response.statusText}`);
  }
}

export async function getDeletedPages() {
  const pagesRef = collection(db, PAGES_COLLECTION);
  const userEmail = auth?.currentUser?.email;
  const q = userEmail
    ? query(pagesRef, where('deleted', '==', true), where('allowedEmails', 'array-contains-any', [userEmail, '*']), orderBy('deletedAt', 'desc'))
    : query(pagesRef, where('deleted', '==', true), orderBy('deletedAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function permanentlyDeletePage(pageId) {
  if (isTestEnv) {
    return _clientPermanentlyDeletePage(pageId);
  }
  try {
    let token = '';
    if (auth.currentUser) {
      token = await auth.currentUser.getIdToken();
    }
    const response = await fetch('/api/permanentlyDeletePage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ pageId })
    });
    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(errorBody || response.statusText);
    }
    console.log(`[Insel-Wiki] Page ${pageId} successfully moved to archive.`);
  } catch (err) {
    console.error('Error during permanent delete (archiving):', err);
    try {
      const pageRef = doc(db, PAGES_COLLECTION, pageId);
      const pageSnap = await getDoc(pageRef);
      if (pageSnap.exists()) {
        await updateDoc(pageRef, {
          archiveFailed: true,
          archiveError: err.message || String(err),
          updatedAt: serverTimestamp()
        });
      }
    } catch (innerErr) {
      console.error('Failed to write compensating archive failure state:', innerErr);
    }
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
  const user = auth.currentUser;
  const userEmail = user ? user.email : '';
  const q = query(pagesRef, where('allowedEmails', 'array-contains-any', [userEmail || 'guest', '*']));
  return onSnapshot(q, (snapshot) => {
    const pages = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => !p.deleted);
    pages.sort((a, b) => (a.order || 0) - (b.order || 0));
    callback(pages);
  }, (err) => {
    console.warn('[Firestore] subscribeToPages query error:', err);
    // If the allowedEmails field doesn't exist on all docs yet, array-contains-any query might be bypassed or fail.
    // Try to fall back to a public query or empty list
    callback([]);
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
  }, (err) => {
    console.warn('[Firestore] subscribeToPage permission error or other failure:', err);
    callback(null);
  });
}

/**
 * Update multiple pages (used for hierarchy changes)
 */
export async function updatePageHierarchy(pageId, parentId, order) {
  const pageRef = doc(db, PAGES_COLLECTION, pageId);
  const committer = new BatchCommitter(db);
  committer.update(pageRef, { parentId, order, updatedAt: serverTimestamp() });
  await committer.commit();
}

/**
 * Get all children of a page
 */
export async function getChildren(pageId) {
  const pagesRef = collection(db, PAGES_COLLECTION);
  const userEmail = auth?.currentUser?.email;
  const q = userEmail
    ? query(pagesRef, where('parentId', '==', pageId), where('deleted', '==', false), where('allowedEmails', 'array-contains-any', [userEmail, '*']), orderBy('order', 'asc'))
    : query(pagesRef, where('parentId', '==', pageId), where('deleted', '==', false), orderBy('order', 'asc'));
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
  try {
    const usersRef = collection(db, 'users');
    const snapshot = await getDocs(usersRef);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn('[Firestore] Failed to get users list (likely restricted):', err.message || err);
    return [];
  }
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
      deleted: false,
      allowedEmails: ['*']
    });
    return true;
  }
  return false;
}

/**
 * Log a client-side error to the database.
 * @param {string} message - The error message.
 * @param {string|null} stack - Optional stack trace.
 * @param {{severity?: 'error'|'warning'|'unhandled-rejection'|'uncaught', source?: string|null}} [options]
 */
export async function logClientError(message, stack = null, options = {}) {
  const { severity = 'error', source = null } = options;
  try {
    // Drop known transient/noisy messages (shared with the global handler).
    if (!shouldLogError(message)) return;

    // Rate limit: cap writes per rolling window to avoid flooding the
    // collection (and Firestore costs) when an error fires repeatedly.
    const now = Date.now();
    errorLogTimestamps = errorLogTimestamps.filter((t) => now - t < ERROR_LOG_WINDOW_MS);
    if (errorLogTimestamps.length >= MAX_ERROR_LOGS_PER_WINDOW) return;
    errorLogTimestamps.push(now);

    const errorData = {
      message: String(message).slice(0, 2000),
      stack: stack ? String(stack).slice(0, 8000) : null,
      severity,
      source,
      url: typeof window !== 'undefined' ? window.location.href.slice(0, 2000) : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 1000) : '',
      userId: auth?.currentUser?.uid || 'anonymous',
      userName: auth?.currentUser?.displayName || auth?.currentUser?.email || 'anonymous',
      appVersion: APP_VERSION,
      breadcrumbs: getBreadcrumbs(),
      online: typeof navigator !== 'undefined' ? navigator.onLine : true,
      viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '',
      timestamp: serverTimestamp()
    };

    const errorsRef = collection(db, 'client_errors');
    await addDoc(errorsRef, errorData);
  } catch (err) {
    // Use console.warn to avoid recursion loops with console.error
    console.warn('[Firestore] Failed to log client error to database:', err);
  }
}

/**
 * Recursively update allowedEmails for a page and its subtree in Firestore.
 */
export async function updatePageAcl(pageId, allowedEmails) {
  if (isTestEnv) {
    return _clientUpdatePageAcl(pageId, allowedEmails);
  }
  let token = '';
  if (auth.currentUser) {
    token = await auth.currentUser.getIdToken();
  }
  const response = await fetch('/api/updatePageAcl', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ pageId, allowedEmails })
  });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Failed to update ACL: ${errorBody || response.statusText}`);
  }
}

async function _clientDeletePage(pageId) {
  const committer = new BatchCommitter(db);
  await _clientRecursiveSoftDelete(pageId, committer);
  await committer.commit();
}

async function _clientRecursiveSoftDelete(pageId, committer) {
  const pagesRef = collection(db, PAGES_COLLECTION);
  const userEmail = auth?.currentUser?.email;
  const q = userEmail
    ? query(pagesRef, where('parentId', '==', pageId), where('allowedEmails', 'array-contains-any', [userEmail, '*']))
    : query(pagesRef, where('parentId', '==', pageId));
  const snapshot = await getDocs(q);
  for (const child of snapshot.docs) {
    await _clientRecursiveSoftDelete(child.id, committer);
  }

  const pageRef = doc(db, PAGES_COLLECTION, pageId);
  committer.update(pageRef, {
    deleted: true,
    deletedAt: serverTimestamp()
  });
}

async function _clientRestorePage(pageId) {
  const committer = new BatchCommitter(db);
  await _clientRecursiveRestore(pageId, committer);
  await committer.commit();
}

async function _clientRecursiveRestore(pageId, committer) {
  const pageRef = doc(db, PAGES_COLLECTION, pageId);
  committer.update(pageRef, {
    deleted: false,
    deletedAt: null
  });

  const pagesRef = collection(db, PAGES_COLLECTION);
  const userEmail = auth?.currentUser?.email;
  const q = userEmail
    ? query(pagesRef, where('parentId', '==', pageId), where('deleted', '==', true), where('allowedEmails', 'array-contains-any', [userEmail, '*']))
    : query(pagesRef, where('parentId', '==', pageId), where('deleted', '==', true));
  const snapshot = await getDocs(q);
  for (const child of snapshot.docs) {
    await _clientRecursiveRestore(child.id, committer);
  }
}

async function _clientPermanentlyDeletePage(pageId) {
  const committer = new BatchCommitter(db);
  await _clientRecursivePermanentDelete(pageId, committer);
  await committer.commit();
}

async function _clientRecursivePermanentDelete(pageId, committer) {
  const pageRef = doc(db, PAGES_COLLECTION, pageId);
  const pageSnap = await getDoc(pageRef);
  if (!pageSnap.exists()) return;
  const pageData = pageSnap.data();

  const pagesRef = collection(db, PAGES_COLLECTION);
  const userEmail = auth?.currentUser?.email;
  const q = userEmail
    ? query(pagesRef, where('parentId', '==', pageId), where('allowedEmails', 'array-contains-any', [userEmail, '*']))
    : query(pagesRef, where('parentId', '==', pageId));
  const snapshot = await getDocs(q);
  for (const child of snapshot.docs) {
    await _clientRecursivePermanentDelete(child.id, committer);
  }

  const historyRef = collection(db, PAGES_COLLECTION, pageId, 'history');
  const historySnaps = await getDocs(historyRef);
  const archivedHistoryRef = collection(db, ARCHIVE_COLLECTION, pageId, 'history');
  for (const snap of historySnaps.docs) {
    committer.set(doc(archivedHistoryRef, snap.id), {
      ...snap.data(),
      archivedAt: serverTimestamp()
    });
    committer.delete(snap.ref);
  }

  const commentsRef = collection(db, PAGES_COLLECTION, pageId, 'comments');
  const commentSnaps = await getDocs(commentsRef);
  const archivedCommentsRef = collection(db, ARCHIVE_COLLECTION, pageId, 'comments');
  for (const snap of commentSnaps.docs) {
    committer.set(doc(archivedCommentsRef, snap.id), {
      ...snap.data(),
      archivedAt: serverTimestamp()
    });
    committer.delete(snap.ref);
  }

  const yjsUpdatesRef = collection(db, PAGES_COLLECTION, pageId, 'yjs_updates');
  const yjsUpdatesSnaps = await getDocs(yjsUpdatesRef);
  for (const snap of yjsUpdatesSnaps.docs) {
    committer.delete(snap.ref);
  }

  const yjsAwarenessRef = collection(db, PAGES_COLLECTION, pageId, 'yjs_awareness');
  const yjsAwarenessSnaps = await getDocs(yjsAwarenessRef);
  for (const snap of yjsAwarenessSnaps.docs) {
    committer.delete(snap.ref);
  }

  const yjsStateRef = collection(db, PAGES_COLLECTION, pageId, 'yjs_state');
  const yjsStateSnaps = await getDocs(yjsStateRef);
  for (const snap of yjsStateSnaps.docs) {
    committer.delete(snap.ref);
  }

  try {
    const presenceRef = collection(db, PAGES_COLLECTION, pageId, 'presence');
    const presenceSnaps = await getDocs(presenceRef);
    for (const snap of presenceSnaps.docs) {
      committer.delete(snap.ref);
    }
  } catch (err) {
    // ignore
  }

  const archiveRef = doc(db, ARCHIVE_COLLECTION, pageId);
  committer.set(archiveRef, {
    ...pageData,
    archivedAt: serverTimestamp(),
    originalCollection: PAGES_COLLECTION
  });
  committer.delete(pageRef);
}

async function _clientUpdatePageAcl(pageId, allowedEmails) {
  const committer = new BatchCommitter(db);
  await _clientRecursiveUpdateAcl(pageId, allowedEmails, committer);
  await committer.commit();
}

async function _clientRecursiveUpdateAcl(pageId, allowedEmails, committer) {
  const pageRef = doc(db, PAGES_COLLECTION, pageId);
  committer.update(pageRef, {
    allowedEmails,
    updatedAt: serverTimestamp()
  });

  const pagesRef = collection(db, PAGES_COLLECTION);
  const userEmail = auth?.currentUser?.email;
  const q = userEmail
    ? query(pagesRef, where('parentId', '==', pageId), where('allowedEmails', 'array-contains-any', [userEmail, '*']))
    : query(pagesRef, where('parentId', '==', pageId));
  const snapshot = await getDocs(q);
  for (const child of snapshot.docs) {
    await _clientRecursiveUpdateAcl(child.id, allowedEmails, committer);
  }
}




