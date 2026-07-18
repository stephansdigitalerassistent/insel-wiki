import * as Y from 'yjs';
import { 
  Awareness, 
  encodeAwarenessUpdate, 
  applyAwarenessUpdate, 
  removeAwarenessStates 
} from 'y-protocols/awareness';
import { db } from '../firebase/config.js';
import i18next from '../i18n.js';
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

/**
 * @class FirestoreYjsProvider
 * @classdesc
 * FirestoreYjsProvider is a custom sync provider for Yjs that integrates with Cloud Firestore.
 * It manages real-time collaboration, offline persistence buffering, and document compaction.
 * 
 * ### Sync Architecture
 * - **Document State Source of Truth:** The document state is represented by a single compiled binary state document 
 *   stored in the `yjs_state` subcollection (as a single document named `state`).
 * - **Incremental Updates:** New changes typed by clients are written to the `yjs_updates` subcollection. 
 *   Live snapshot listeners catch up with and apply these incremental updates to keep all collaborative clients in sync.
 * - **Awareness Protocol:** Cursors, selections, and user metadata are synchronized through the `yjs_awareness` subcollection. 
 *   Local updates are debounced and published to Firestore, and remote presence states are applied locally using `y-protocols/awareness`.
 * 
 * ### Custom Offline Buffering & Debouncing
 * - **Write Coalescing:** To avoid hitting Firestore write limits and minimize billing cost, individual Yjs update events 
 *   are debounced and buffered.
 * - **Debounce Window:** Changes are grouped during a 1-second window (`_writeDebounceMs = 1000`). When typing stops or the 
 *   buffer is flushed, these updates are merged using `Y.mergeUpdates` and written to Firestore as a single `addDoc` operation.
 * - **Dirty State Tracking:** A `pendingWrites` counter and `hasUnsavedChanges` getter are provided to track unsaved edits, 
 *   alerting the editor UI to show saving states and preventing loss of data.
 * 
 * ### Document Compaction
 * - **Compaction Trigger:** As changes accumulate, the `yjs_updates` collection grows. When a client applies a number of local 
 *   updates exceeding the `compactionThreshold` (default: 50), a compaction operation is triggered.
 * - **Transaction-Based Merge:** Compaction compresses the current memory state of `Y.Doc` into a single binary blob, which is 
 *   written to the `yjs_state` document. This is performed inside a Firestore transaction.
 * - **Concurrency Guard:** The transaction inspects `updatedAt` on the existing state document. If another client has compacted 
 *   within the last 10 seconds, the compaction is aborted to avoid redundant writes.
 * - **Obsolete Cleanup:** Upon a successful transaction write, all incremental updates older than the compaction timestamp 
 *   are fetched and deleted from the database.
 * 
 * @property {Y.Doc} ydoc The primary Yjs document instance.
 * @property {Y.Doc} doc Explicitly exposed alias to the Yjs doc for Tiptap CollaborationCursor extension.
 * @property {string} pageId The unique identifier of the page / document in Firestore.
 * @property {Awareness} awareness The Yjs awareness instance used to coordinate client cursors and presence.
 * @property {number} clientId Unique ID identifying this client within the Yjs session.
 * @property {CollectionReference} updatesRef Firestore collection reference containing incremental update documents.
 * @property {CollectionReference} awarenessRef Firestore collection reference containing active awareness/presence documents.
 * @property {DocumentReference} stateDocRef Firestore document reference to the single compiled binary state.
 * @property {Function|null} unsubUpdates Unsubscribe callback function for the live updates collection snapshot listener.
 * @property {Function|null} unsubAwareness Unsubscribe callback function for the live awareness collection snapshot listener.
 * @property {any|null} awarenessTimeout Timer ID for debouncing local awareness state updates.
 * @property {Function|null} onLoadComplete Callback executed when the provider has completed initial state retrieval and application.
 * @property {boolean} hasYjsState Flags if a compiled state document was successfully found and loaded from Firestore.
 * @property {number} localUpdateCount Count of local Yjs update events since the last compaction check.
 * @property {number} compactionThreshold Limit of local updates allowed before triggering a background compaction.
 * @property {number} pendingWrites Active count of outstanding writes/flushes.
 * @property {Set<Function>} _statusListeners Subscribed listener callbacks notified on unsaved changes / dirty status changes.
 * @property {any|null} persistence Optional local persistence cache provider (e.g., `IndexeddbPersistence`).
 * @property {boolean} _suspended Indicates if the provider has detached Firestore snapshot listeners and is in sleep mode.
 * @property {number} _writeDebounceMs Duration in milliseconds to debounce local edits before flushing to Firestore.
 * @property {Uint8Array[]} _pendingUpdates Buffer storing local Yjs updates that have not yet been flushed to Firestore.
 * @property {any|null} _writeTimer Timer ID for debouncing the local edit write operation.
 * @property {Function|null} handleUnload Cached event handler reference for beforeunload window events.
 */
export class FirestoreYjsProvider {
  /**
   * Creates an instance of FirestoreYjsProvider.
   * 
   * @param {string} pageId The unique identifier of the wiki page/document in Firestore.
   * @param {Y.Doc} ydoc The shared Yjs document instance to sync.
   * @param {Object} [user] Optional user profile metadata for collaborative presence.
   * @param {string} [user.name] User display name.
   * @param {string} [user.color] User color (hex format) representing cursor coloring.
   * @param {string|null} [user.photoURL] Optional URL to user profile picture.
   */
  constructor(pageId, ydoc, user) {
    /** @type {Y.Doc} */
    this.ydoc = ydoc;
    /** @type {Y.Doc} */
    this.doc = ydoc; // Explicitly expose `doc` for Tiptap CollaborationCursor extension
    /** @type {string} */
    this.pageId = pageId;
    /** @type {Awareness} */
    this.awareness = new Awareness(ydoc);
    /** @type {number} */
    this.clientId = this.awareness.clientID;
    
    // Initialize awareness state for ourselves
    this.awareness.setLocalStateField('user', {
      name: user?.name || i18next.t('common.guest'),
      color: user?.color || this.getRandomColor(),
      photoURL: user?.photoURL || null
    });

    /** @type {CollectionReference} */
    this.updatesRef = collection(db, 'pages', pageId, 'yjs_updates');
    /** @type {CollectionReference} */
    this.awarenessRef = collection(db, 'pages', pageId, 'yjs_awareness');
    /** @type {DocumentReference} */
    this.stateDocRef = doc(db, 'pages', pageId, 'yjs_state', 'state'); // Binary state single source

    /** @type {Function|null} */
    this.unsubUpdates = null;
    /** @type {Function|null} */
    this.unsubAwareness = null;
    /** @type {any|null} */
    this.awarenessTimeout = null;
    /** @type {Function|null} */
    this.onLoadComplete = null;
    /** @type {boolean} */
    this.hasYjsState = false;
    /** @type {number} */
    this.localUpdateCount = 0;
    /** @type {number} */
    this.compactionThreshold = 50;
    /** @type {number} */
    this.pendingWrites = 0;
    /** @type {Set<Function>} */
    this._statusListeners = new Set();
    // Optional local cache (e.g. y-indexeddb). Updates re-applied from this
    // origin are local replays; we must not echo them back to Firestore or
    // every IDB rehydrate would create duplicate writes.
    /** @type {any|null} */
    this.persistence = null;
    // suspended means: Firestore listeners are detached and our awareness doc
    // has been removed, but ydoc and the local persistence stay alive. Used by
    // the editor cache to park inactive pages without holding open watchers.
    /** @type {boolean} */
    this._suspended = false;
    // Yjs writes are coalesced over a 1s window to cut Firestore write
    // volume. Buffered updates are merged into a single addDoc per flush.
    /** @type {number} */
    this._writeDebounceMs = 1000;
    /** @type {Uint8Array[]} */
    this._pendingUpdates = [];
    /** @type {any|null} */
    this._writeTimer = null;
  }

  /**
   * Indicates if there are any local edits that have not yet been successfully saved to Firestore.
   * 
   * @type {boolean}
   */
  get hasUnsavedChanges() {
    return this.pendingWrites > 0;
  }

  /**
   * Subscribes a callback to receive status changes when the provider's unsaved changes status changes.
   * 
   * @param {Function} cb Callback function invoked with the current hasUnsavedChanges boolean state.
   * @returns {Function} A unsubscribe function to remove the registered callback.
   */
  onStatusChange(cb) {
    this._statusListeners.add(cb);
    return () => this._statusListeners.delete(cb);
  }

  /**
   * Invokes all registered status change listeners with the current unsaved changes status.
   * 
   * @private
   * @returns {void}
   */
  _emitStatus() {
    for (const cb of this._statusListeners) {
      try { cb(this.hasUnsavedChanges); } catch {}
    }
  }

  /**
   * Merges and writes any buffered Yjs updates immediately to Firestore.
   * This returns the write promise and is safe to fire-and-forget from unload handlers.
   * 
   * @returns {Promise<void>} A promise that resolves when the flush operation completes or skips.
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

  /**
   * Configures a callback to run when the provider finishes loading its initial document state.
   * 
   * @param {Function} callback Callback function invoked with a boolean indicating if state was found and loaded.
   * @returns {void}
   */
  setLoadCallback(callback) {
    this.onLoadComplete = callback;
  }

  /**
   * Sets the local cache persistence layer, such as y-indexeddb.
   * 
   * @param {any} persistence The persistence provider instance to associate.
   * @returns {void}
   */
  setLocalPersistence(persistence) {
    this.persistence = persistence;
  }

  /**
   * Generates a random pastel/vibrant hex color code used to represent cursor presence in collaboration.
   * 
   * @returns {string} Hexadecimal color string.
   */
  getRandomColor() {
    const colors = ['#f87171', '#fb923c', '#fbbf24', '#34d399', '#38bdf8', '#818cf8', '#c084fc', '#f472b6'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  /**
   * Compiles the current Yjs document state into a single compressed binary state document in Firestore
   * and cleans up obsolete incremental update records. This compaction process uses a transaction to ensure
   * only one client performs compaction if multiple clients trigger it concurrently.
   * 
   * @returns {Promise<void>} A promise that resolves when the compaction transaction and subsequent cleanup finish.
   */
  async compact() {
    try {
      await runTransaction(db, async (transaction) => {
        const stateSnap = await transaction.get(this.stateDocRef);
        const existingData = stateSnap.data();
        
        // Skip compaction if another client already compacted within the last 10 seconds
        if (existingData?.updatedAt) {
          const lastCompacted = existingData.updatedAt.toDate();
          if (Date.now() - lastCompacted.getTime() < 10000) {
            return; // Another client already compacted — skip
          }
        }
        
        const newState = Y.encodeStateAsUpdate(this.ydoc);
        transaction.set(this.stateDocRef, { 
          state: Bytes.fromUint8Array(newState), 
          updatedAt: serverTimestamp() 
        });

        // We can't delete pending updates within the transaction reliably while they are being written
        // but we can trigger a cleanup after the transaction succeeds
      });
      
      // Cleanup all updates older than now to prevent double-charging next load
      const cleanupQuery = query(this.updatesRef, where('timestamp', '<=', new Date()));
      const snap = await getDocs(cleanupQuery);
      snap.forEach(d => deleteDoc(d.ref).catch(() => {}));
      
      this.localUpdateCount = 0;
      console.log('[FirestoreYjs] Compaction successful.');
    } catch (err) {
      console.error('[FirestoreYjs] Compaction error:', err);
    }
  }

  /**
   * Initializes the provider by reading the compressed binary state and any pending incremental updates
   * from Firestore, applying them to the local Yjs document, registering live listeners for new updates
   * and awareness changes, and setting up beforeunload cleanup listeners.
   * 
   * @returns {Promise<void>} A promise that resolves once initial catch-up syncing and listener attachments are complete.
   */
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
      clearTimeout(this._writeTimer);
      this._writeTimer = setTimeout(() => this.flushPending(), this._writeDebounceMs);

      // Check if we should trigger background compaction
      this.localUpdateCount++;
      if (this.localUpdateCount >= this.compactionThreshold) {
        this.compact();
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
  }

  /**
   * Sets up a Firestore snapshot listener on the updates collection to fetch and apply new incremental updates.
   * 
   * @private
   * @param {Date} fromTime Date threshold to watch for updates created after this timestamp.
   * @returns {void}
   */
  _attachUpdatesListener(fromTime) {
    const qUpdates = query(this.updatesRef, where('timestamp', '>=', fromTime), orderBy('timestamp', 'asc'));
    this.unsubUpdates = onSnapshot(qUpdates, (snapshot) => {
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') {
          const updateData = change.doc.data();
          if (updateData.clientId !== this.clientId && updateData.update) {
            const updateArr = updateData.update.toUint8Array();
            Y.applyUpdate(this.ydoc, updateArr, this);
          }
        }
      });
    });
  }

  /**
   * Sets up a Firestore snapshot listener on the awareness presence collection to update local remote cursor locations.
   * 
   * @private
   * @returns {void}
   */
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
    });
  }

  /**
   * Encodes and writes the local client's current awareness state to the Firestore awareness collection.
   * 
   * @private
   * @returns {Promise<void>} A promise that resolves when the presence state is written to Firestore.
   */
  _publishOwnAwareness() {
    const state = encodeAwarenessUpdate(this.awareness, [this.clientId]);
    const myDocRef = doc(this.awarenessRef, this.clientId.toString());
    return setDoc(myDocRef, {
      state: Bytes.fromUint8Array(state),
      updatedAt: serverTimestamp()
    }).catch(() => {});
  }

  /**
   * Temporarily detaches Firestore updates and awareness snapshot listeners and deletes the local
   * client's awareness document from Firestore. Keeps the local Yjs document and optional local persistence
   * alive. Used for parking inactive editors to optimize network and database watcher usage.
   * 
   * @returns {void}
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
   * Resumes the provider from a suspended state by re-fetching the compiled state document and pending
   * incremental updates to catch up with any remote changes, re-attaching the live Firestore database listeners,
   * and republishing the local client's awareness document.
   * 
   * @returns {Promise<void>} A promise that resolves when catch-up and listener re-attachment are complete.
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

  /**
   * Teardown logic that flushes any pending buffered updates to Firestore, detaches all snapshot
   * listeners, removes window unload event listeners, and deletes the local client's awareness document
   * from Firestore.
   * 
   * @returns {void}
   */
  destroy() {
    // Flush buffered updates before tearing down so we don't lose the last
    // 0–1s of typing on navigation or tab close.
    if (this._pendingUpdates.length) this.flushPending();
    if (this.unsubUpdates) this.unsubUpdates();
    if (this.unsubAwareness) this.unsubAwareness();
    window.removeEventListener('beforeunload', this.handleUnload);

    // Remove awareness doc from Firestore
    try {
      const docRef = doc(this.awarenessRef, this.clientId.toString());
      deleteDoc(docRef).catch(() => {});
    } catch(e) {}
    
    removeAwarenessStates(this.awareness, [this.clientId], 'local');
  }
}
