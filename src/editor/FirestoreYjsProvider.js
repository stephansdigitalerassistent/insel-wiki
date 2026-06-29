import * as Y from 'yjs';
import { 
  Awareness, 
  encodeAwarenessUpdate, 
  applyAwarenessUpdate, 
  removeAwarenessStates 
} from 'y-protocols/awareness';
import { db } from '../firebase/config.js';
import i18next from '../i18n.js';
import { showToast } from '../components/toast.js';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  serverTimestamp, 
  Bytes,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  limit,
  where,
  runTransaction
} from 'firebase/firestore';

export class FirestoreYjsProvider {
  constructor(pageId, ydoc, user) {
    this.ydoc = ydoc;
    this.doc = ydoc; // Explicitly expose `doc` for Tiptap CollaborationCursor extension
    this.pageId = pageId;
    this.awareness = new Awareness(ydoc);
    this.clientId = this.awareness.clientID;
    
    // Initialize awareness state for ourselves
    this.awareness.setLocalStateField('user', {
      name: user?.name || i18next.t('common.guest'),
      email: user?.email || '',
      color: user?.color || this.getRandomColor(),
      photoURL: user?.photoURL || null
    });

    this.updatesRef = collection(db, 'pages', pageId, 'yjs_updates');
    this.awarenessRef = collection(db, 'pages', pageId, 'yjs_awareness');
    this.stateDocRef = doc(db, 'pages', pageId, 'yjs_state', 'state'); // Binary state single source

    this.unsubUpdates = null;
    this.unsubAwareness = null;
    this.awarenessTimeout = null;
    this.onLoadComplete = null;
    this.hasYjsState = false;
    this.localUpdateCount = 0;
    this.compactionThreshold = 50;
    this.pendingWrites = 0;
    this._statusListeners = new Set();
    // Optional local cache (e.g. y-indexeddb). Updates re-applied from this
    // origin are local replays; we must not echo them back to Firestore or
    // every IDB rehydrate would create duplicate writes.
    this.persistence = null;
    // suspended means: Firestore listeners are detached and our awareness doc
    // has been removed, but ydoc and the local persistence stay alive. Used by
    // the editor cache to park inactive pages without holding open watchers.
    this._suspended = false;
    // Yjs writes are coalesced over a 1s window to cut Firestore write
    // volume. Buffered updates are merged into a single addDoc per flush.
    this._writeDebounceMs = 1000;
    this._pendingUpdates = [];
    this._writeTimer = null;

    this.isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    this.hadLocalEditsWhileOffline = false;

    this._onlineHandler = () => {
      this.isOnline = true;
      if (this._pendingUpdates.length > 0) {
        this.flushPending();
      }
      this._emitStatus();
    };
    this._offlineHandler = () => {
      this.isOnline = false;
      this._emitStatus();
    };
  }

  get hasUnsavedChanges() {
    return this.pendingWrites > 0;
  }

  onStatusChange(cb) {
    this._statusListeners.add(cb);
    return () => this._statusListeners.delete(cb);
  }

  _emitStatus() {
    for (const cb of this._statusListeners) {
      try { cb(this.hasUnsavedChanges); } catch {}
    }
  }

  /**
   * Merge and write any buffered Yjs updates immediately. Returns the write
   * promise; safe to fire-and-forget from unload handlers (Firestore queues
   * the write in its IndexedDB cache).
   */
  flushPending() {
    clearTimeout(this._writeTimer);
    this._writeTimer = null;
    if (this._pendingUpdates.length === 0) return Promise.resolve();
    const merged = Y.mergeUpdates(this._pendingUpdates);
    this._pendingUpdates = [];
    return addDoc(this.updatesRef, {
      update: Bytes.fromUint8Array(merged),
      timestamp: serverTimestamp(),
      clientId: this.clientId
    }).catch(() => {}).finally(() => {
      this.pendingWrites--;
      this._emitStatus();
    });
  }

  setLoadCallback(callback) {
    this.onLoadComplete = callback;
  }

  setLocalPersistence(persistence) {
    this.persistence = persistence;
  }

  getRandomColor() {
    const colors = ['#f87171', '#fb923c', '#fbbf24', '#34d399', '#38bdf8', '#818cf8', '#c084fc', '#f472b6'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  async compact() {
    try {
      // 1. Fetch all pending updates currently in the database
      const updatesSnap = await getDocs(query(this.updatesRef, orderBy('timestamp', 'asc')));
      
      // 2. Apply any updates we don't have yet to ensure the compaction is up to date
      updatesSnap.forEach(change => {
        const data = change.data();
        if (data.update) {
          try {
            Y.applyUpdate(this.ydoc, data.update.toUint8Array(), this);
          } catch (e) {
            console.error('[FirestoreYjs] Failed to apply update during compaction:', e);
          }
        }
      });

      const compacted = await runTransaction(db, async (transaction) => {
        const stateSnap = await transaction.get(this.stateDocRef);
        const existingData = stateSnap.data();
        
        // Skip compaction if another client already compacted within the last 10 seconds
        if (existingData?.updatedAt) {
          const lastCompacted = existingData.updatedAt.toDate();
          if (Date.now() - lastCompacted.getTime() < 10000) {
            return false; // Another client already compacted — skip
          }
        }
        
        const newState = Y.encodeStateAsUpdate(this.ydoc);
        transaction.set(this.stateDocRef, { 
          state: Bytes.fromUint8Array(newState), 
          updatedAt: serverTimestamp() 
        });
        return true;
      });

      if (!compacted) {
        console.log('[FirestoreYjs] Compaction skipped (recently compacted by another client).');
        return;
      }
      
      // 3. Delete ONLY the updates that were read and folded into the compacted state
      const deletePromises = [];
      updatesSnap.forEach(d => {
        deletePromises.push(deleteDoc(d.ref).catch(() => {}));
      });
      await Promise.all(deletePromises);
      
      this.localUpdateCount = 0;
      console.log('[FirestoreYjs] Compaction successful.');
    } catch (err) {
      console.error('[FirestoreYjs] Compaction error:', err);
    }
  }

  async init() {
    try {
      // 1 & 2. Fetch Compressed State and pending updates in parallel
      const [stateDocs, pendingUpdates] = await Promise.all([
        getDocs(query(collection(db, 'pages', this.pageId, 'yjs_state'), limit(1))),
        getDocs(query(this.updatesRef, orderBy('timestamp', 'asc')))
      ]);

      if (!stateDocs.empty && stateDocs.docs[0].data().state) {
        this.hasYjsState = true;
        const stateArr = stateDocs.docs[0].data().state.toUint8Array();
        Y.applyUpdate(this.ydoc, stateArr, this);
      }

      if (!pendingUpdates.empty) {
        pendingUpdates.forEach(change => {
          if (change.data().update) {
            const updateArr = change.data().update.toUint8Array();
            Y.applyUpdate(this.ydoc, updateArr, this);
          }
        });
        // Defer initial compaction
        setTimeout(() => this.compact(), 1000);
      }

      // Inform editor that binary state load is complete
      if (this.onLoadComplete) {
        this.onLoadComplete(this.hasYjsState || !pendingUpdates.empty);
      }
    } catch (err) {
      console.error('[FirestoreYjs] init error:', err);
      // Even on failure, we signal completion so the UI can fallback to markdown content
      if (this.onLoadComplete) this.onLoadComplete(false);
    }

    // 3. Sync New Document Updates (Live, debounced 2s)
    this.ydoc.on('update', (update, origin) => {
      // Skip self-applied (Firestore replay) and y-indexeddb-applied (local cache replay) updates.
      if (origin === this) return;
      if (this.persistence && origin === this.persistence) return;

      const wasEmpty = this._pendingUpdates.length === 0;
      this._pendingUpdates.push(update);
      if (wasEmpty) {
        // Mark as dirty for the duration of the buffer + write so the
        // save indicator stays on "Speichern…" while changes are pending.
        this.pendingWrites++;
        this._emitStatus();
      }

      if (this.isOnline) {
        clearTimeout(this._writeTimer);
        this._writeTimer = setTimeout(() => this.flushPending(), this._writeDebounceMs);

        // Check if we should trigger background compaction
        this.localUpdateCount++;
        if (this.localUpdateCount >= this.compactionThreshold) {
          this.compact();
        }
      } else {
        this.hadLocalEditsWhileOffline = true;
        this._emitStatus();
      }
    });

    // 4. Sync Awareness (Cursors & Selections)
    // Clean up stale awareness docs in the background
    getDocs(this.awarenessRef).then(existing => {
      existing.forEach(d => deleteDoc(d.ref).catch(() => {}));
    }).catch(() => {});

    this.awareness.on('update', ({ added, updated, removed }, origin) => {
      if (origin === 'local') {
        if (this._suspended) return; // parked — don't write awareness for hidden editors
        clearTimeout(this.awarenessTimeout);
        this.awarenessTimeout = setTimeout(() => {
          const state = encodeAwarenessUpdate(this.awareness, [this.clientId]);
          const docRef = doc(this.awarenessRef, this.clientId.toString());
          setDoc(docRef, {
            state: Bytes.fromUint8Array(state),
            updatedAt: serverTimestamp()
          }).catch(() => {});
        }, 300); // Debounce to prevent sluggishness
      }
    });

    this._attachUpdatesListener(new Date());
    this._publishOwnAwareness();
    this._attachAwarenessListener();

    // Cleanup when browser tab closes
    this.handleUnload = () => this.destroy();
    window.addEventListener('beforeunload', this.handleUnload);

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this._onlineHandler);
      window.addEventListener('offline', this._offlineHandler);
    }
  }

  _attachUpdatesListener(fromTime) {
    const qUpdates = query(this.updatesRef, where('timestamp', '>=', fromTime), orderBy('timestamp', 'asc'));
    this.unsubUpdates = onSnapshot(qUpdates, (snapshot) => {
      let remoteUpdatesCount = 0;
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') {
          const updateData = change.doc.data();
          if (updateData.clientId !== this.clientId && updateData.update) {
            const updateArr = updateData.update.toUint8Array();
            Y.applyUpdate(this.ydoc, updateArr, this);
            remoteUpdatesCount++;
          }
        }
      });
      if (remoteUpdatesCount > 0 && this.hadLocalEditsWhileOffline) {
        this.hadLocalEditsWhileOffline = false;
        showToast(i18next.t('messages.conflictMerged') || 'Konflikt gelöst: Gleichzeitige Änderungen wurden automatisch zusammengeführt.', 'info');
      }
    }, (err) => {
      console.warn('[FirestoreYjsProvider] unsubUpdates permission error or other failure:', err);
    });
  }

  _attachAwarenessListener() {
    this.unsubAwareness = onSnapshot(this.awarenessRef, (snapshot) => {
      snapshot.docChanges().forEach(change => {
        const awarenessData = change.doc.data();
        if (change.doc.id !== this.clientId.toString() && awarenessData.state) {
          if (change.type === 'added' || change.type === 'modified') {
            const stateArr = awarenessData.state.toUint8Array();
            applyAwarenessUpdate(this.awareness, stateArr, this);
          } else if (change.type === 'removed') {
             removeAwarenessStates(this.awareness, [Number(change.doc.id)], this);
          }
        }
      });
    }, (err) => {
      console.warn('[FirestoreYjsProvider] unsubAwareness permission error or other failure:', err);
    });
  }

  _publishOwnAwareness() {
    const state = encodeAwarenessUpdate(this.awareness, [this.clientId]);
    const myDocRef = doc(this.awarenessRef, this.clientId.toString());
    return setDoc(myDocRef, {
      state: Bytes.fromUint8Array(state),
      updatedAt: serverTimestamp()
    }).catch(() => {});
  }

  /**
   * Detach Firestore listeners and remove our awareness doc, but keep ydoc
   * and persistence alive. Used by the editor cache when parking a page so
   * collaborators don't see this user "viewing" pages they've navigated away
   * from, and so we don't pay for live snapshots on hidden editors.
   */
  suspend() {
    if (this._suspended) return;
    this._suspended = true;

    // Flush any pending Yjs updates so we don't lose typing on park.
    if (this._pendingUpdates.length) this.flushPending();

    if (this.unsubUpdates) { this.unsubUpdates(); this.unsubUpdates = null; }
    if (this.unsubAwareness) { this.unsubAwareness(); this.unsubAwareness = null; }
    clearTimeout(this.awarenessTimeout);
    this.awarenessTimeout = null;

    // Remove our awareness doc so collaborators stop seeing us on the parked page.
    try {
      const docRef = doc(this.awarenessRef, this.clientId.toString());
      deleteDoc(docRef).catch(() => {});
    } catch (e) {}
  }

  /**
   * Re-attach Firestore listeners and republish awareness after suspend().
   * Catches up on Yjs state via a state-doc + pending-updates re-fetch; CRDT
   * applies are idempotent, so any updates we already had are no-ops.
   */
  async resume() {
    if (!this._suspended) return;
    this._suspended = false;

    try {
      const stateSnap = await getDocs(query(collection(db, 'pages', this.pageId, 'yjs_state'), limit(1)));
      if (!stateSnap.empty && stateSnap.docs[0].data().state) {
        const stateArr = stateSnap.docs[0].data().state.toUint8Array();
        Y.applyUpdate(this.ydoc, stateArr, this);
      }
      const pending = await getDocs(query(this.updatesRef, orderBy('timestamp', 'asc')));
      pending.forEach(change => {
        const updateData = change.data();
        if (updateData.update && updateData.clientId !== this.clientId) {
          Y.applyUpdate(this.ydoc, updateData.update.toUint8Array(), this);
        }
      });
    } catch (err) {
      console.warn('[FirestoreYjs] resume catchup error:', err);
    }

    this._attachUpdatesListener(new Date());
    this._publishOwnAwareness();
    this._attachAwarenessListener();
  }

  destroy() {
    // Flush buffered updates before tearing down so we don't lose the last
    // 0–1s of typing on navigation or tab close.
    if (this._pendingUpdates.length) this.flushPending();
    if (this.unsubUpdates) this.unsubUpdates();
    if (this.unsubAwareness) this.unsubAwareness();
    window.removeEventListener('beforeunload', this.handleUnload);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this._onlineHandler);
      window.removeEventListener('offline', this._offlineHandler);
    }

    // Remove awareness doc from Firestore
    try {
      const docRef = doc(this.awarenessRef, this.clientId.toString());
      deleteDoc(docRef).catch(() => {});
    } catch(e) {}
    
    removeAwarenessStates(this.awareness, [this.clientId], 'local');
  }
}
