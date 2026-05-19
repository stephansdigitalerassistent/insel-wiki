import { db } from './config.js';
import { formatDefaultName } from '../utils/string.js';
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  getDocs,
  query,
  where
} from 'firebase/firestore';

const PRESENCE_TIMEOUT_MS = 120000; // 2 minutes before considered offline
const HEARTBEAT_MS = 60000; // 1 minute heartbeat

let currentPresenceUnsub = null;
let currentPresenceRef = null;
let heartbeatInterval = null;

/**
 * Join a page's presence
 * Creates a document in pages/{pageId}/presence/{uid}
 * Returns the unique ID for this session
 */
export async function joinPage(pageId, user) {
  if (!user || (!user.email && !user.uid)) return null;
  
  const userId = user.uid || user.email.replace(/[@.]/g, '_');
  // Add a random session ID so multiple tabs from same user work
  const sessionId = `${userId}_${Math.random().toString(36).substr(2, 9)}`;
  
  const presenceRef = doc(db, 'pages', pageId, 'presence', sessionId);
  
  await setDoc(presenceRef, {
    email: user.email || 'Gast',
    name: user.name || user.displayName || formatDefaultName(user.email) || 'Gast',
    photoURL: user.photoURL || null,
    color: user.color || getColorForEmail(user.email || 'Gast'),
    joinedAt: serverTimestamp(),
    lastSeen: serverTimestamp()
  });

  currentPresenceRef = presenceRef;

  // Start heartbeat
  clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(async () => {
    if (currentPresenceRef) {
      try {
        await setDoc(currentPresenceRef, { lastSeen: serverTimestamp() }, { merge: true });
      } catch (err) {
        console.warn('[Insel-Wiki] Failed to update presence heartbeat:', err);
      }
    }
  }, HEARTBEAT_MS);

  return sessionId;
}

/**
 * Leave the current page (removes presence document)
 */
export async function leavePage() {
  clearInterval(heartbeatInterval);
  if (currentPresenceRef) {
    try {
      await deleteDoc(currentPresenceRef);
    } catch (err) {
      console.warn('[Insel-Wiki] Failed to delete presence doc:', err);
    }
    currentPresenceRef = null;
  }
}

/**
 * Subscribe to the presence list for a specific page
 * Cleans up stale entries automatically on first load
 */
export function subscribeToPresence(pageId, callback) {
  if (currentPresenceUnsub) {
    currentPresenceUnsub();
  }

  const presenceCol = collection(db, 'pages', pageId, 'presence');
  
  // Clean up stale entries in the background
  cleanStalePresence(pageId).catch(console.warn);

  currentPresenceUnsub = onSnapshot(presenceCol, (snapshot) => {
    const now = Date.now();
    const users = [];
    const seenEmails = new Set();
    
    snapshot.forEach((docSnap) => {
      const presenceData = docSnap.data();
      // Filter out stale entries locally as well just in case
      let isStale = false;
      if (presenceData.lastSeen && presenceData.lastSeen.toMillis) {
        isStale = (now - presenceData.lastSeen.toMillis()) > PRESENCE_TIMEOUT_MS;
      }
      
      if (!isStale && presenceData.email && !seenEmails.has(presenceData.email)) {
        seenEmails.add(presenceData.email);
        users.push({
          id: docSnap.id,
          email: presenceData.email,
          name: presenceData.name,
          photoURL: presenceData.photoURL,
          color: presenceData.color || getColorForEmail(presenceData.email),
          initials: getInitials(presenceData.name || presenceData.email)
        });
      }
    });
    
    callback(users);
  });

  return () => {
    if (currentPresenceUnsub) {
      currentPresenceUnsub();
      currentPresenceUnsub = null;
    }
  };
}

/**
 * Helper to clean up documents where lastSeen is older than timeout
 */
async function cleanStalePresence(pageId) {
  const presenceCol = collection(db, 'pages', pageId, 'presence');
  const snapshot = await getDocs(presenceCol);
  const now = Date.now();
  
  const deletions = [];
  snapshot.forEach((docSnap) => {
    const presence = docSnap.data();
    if (presence.lastSeen && presence.lastSeen.toMillis) {
      if ((now - presence.lastSeen.toMillis()) > PRESENCE_TIMEOUT_MS) {
        deletions.push(deleteDoc(docSnap.ref));
      }
    }
  });
  
  if (deletions.length > 0) {
    await Promise.allSettled(deletions);
  }
}

function getInitials(email) {
  if (!email || email === 'Gast') return 'G';
  const parts = email.split('@')[0].split('.');
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return email.substring(0, 2).toUpperCase();
}

export function getColorForEmail(email) {
  // Simple deterministic color generation based on email string
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    '#f87171', '#fb923c', '#fbbf24', '#34d399',
    '#38bdf8', '#818cf8', '#c084fc', '#f472b6'
  ];
  return colors[Math.abs(hash) % colors.length];
}
