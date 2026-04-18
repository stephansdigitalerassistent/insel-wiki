import * as Y from 'yjs';
import { 
  Awareness, 
  encodeAwarenessUpdate, 
  applyAwarenessUpdate, 
  removeAwarenessStates 
} from 'y-protocols/awareness';
import { db } from '../firebase/config.js';
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
      name: user?.name || 'Gast',
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
  }

  setLoadCallback(callback) {
    this.onLoadComplete = callback;
  }

  getRandomColor() {
    const colors = ['#f87171', '#fb923c', '#fbbf24', '#34d399', '#38bdf8', '#818cf8', '#c084fc', '#f472b6'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  async init() {
    // 1. Fetch Compressed State (if any)
    const stateDoc = await getDocs(query(collection(db, 'pages', this.pageId, 'yjs_state'), limit(1)));
    if (!stateDoc.empty && stateDoc.docs[0].data().state) {
      this.hasYjsState = true;
      const stateArr = stateDoc.docs[0].data().state.toUint8Array();
      Y.applyUpdate(this.ydoc, stateArr, this);
    }

    // 2. Fetch pending updates and compact them if we are the first to load
    const pendingUpdates = await getDocs(query(this.updatesRef, orderBy('timestamp', 'asc')));
    if (!pendingUpdates.empty) {
      pendingUpdates.forEach(change => {
        if (change.data().update) {
          const updateArr = change.data().update.toUint8Array();
          Y.applyUpdate(this.ydoc, updateArr, this);
        }
      });
      // Defer compaction — don't block the editor from loading
      // Use a transaction to prevent race conditions when multiple clients load simultaneously
      setTimeout(async () => {
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
          });
          // Clean up compacted updates after successful transaction
          pendingUpdates.forEach(change => deleteDoc(change.ref).catch(() => {}));
        } catch (err) {
          console.error('[FirestoreYjs] Compaction error:', err);
        }
      }, 1000);
    }

    // Inform editor that binary state load is complete
    if (this.onLoadComplete) {
      this.onLoadComplete(this.hasYjsState || !pendingUpdates.empty);
    }

    // 3. Sync New Document Updates (Live)
    this.ydoc.on('update', (update, origin) => {
      if (origin !== this) {
        addDoc(this.updatesRef, {
          update: Bytes.fromUint8Array(update),
          timestamp: serverTimestamp(),
          clientId: this.clientId
        }).catch(() => {});
      }
    });

    const loadTime = new Date(); // Only listen for new updates to prevent re-applying old ones
    const qUpdates = query(this.updatesRef, where('timestamp', '>=', loadTime), orderBy('timestamp', 'asc'));
    this.unsubUpdates = onSnapshot(qUpdates, (snapshot) => {
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') {
          const data = change.doc.data();
          if (data.clientId !== this.clientId && data.update) {
            const updateArr = data.update.toUint8Array();
            Y.applyUpdate(this.ydoc, updateArr, this);
          }
        }
      });
    });

    // 4. Sync Awareness (Cursors & Selections)
    // Clean up stale awareness docs in the background
    getDocs(this.awarenessRef).then(existing => {
      existing.forEach(d => deleteDoc(d.ref).catch(() => {}));
    }).catch(() => {});

    this.awareness.on('update', ({ added, updated, removed }, origin) => {
      if (origin === 'local') {
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

    // Immediately publish our awareness so other clients see us
    const initialState = encodeAwarenessUpdate(this.awareness, [this.clientId]);
    const myDocRef = doc(this.awarenessRef, this.clientId.toString());
    setDoc(myDocRef, {
      state: Bytes.fromUint8Array(initialState),
      updatedAt: serverTimestamp()
    }).catch(() => {});

    this.unsubAwareness = onSnapshot(this.awarenessRef, (snapshot) => {
      snapshot.docChanges().forEach(change => {
        const data = change.doc.data();
        if (change.doc.id !== this.clientId.toString() && data.state) {
          if (change.type === 'added' || change.type === 'modified') {
            const stateArr = data.state.toUint8Array();
            applyAwarenessUpdate(this.awareness, stateArr, this);
          } else if (change.type === 'removed') {
             removeAwarenessStates(this.awareness, [Number(change.doc.id)], this);
          }
        }
      });
    });

    // Cleanup when browser tab closes
    this.handleUnload = () => this.destroy();
    window.addEventListener('beforeunload', this.handleUnload);
  }

  destroy() {
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
