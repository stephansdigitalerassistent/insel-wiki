import * as Y from 'yjs';
import { FirestoreYjsProvider } from '../editor/FirestoreYjsProvider.js';
import { getCurrentUser } from '../firebase/auth.js';
import { db } from '../firebase/config.js';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { insertSeriesLinkInFragment, insertSeriesLinkInMarkdown } from './series-parent.js';

/**
 * Toggles a task status both in Yjs (for collaboration) and in Firestore Markdown (for immediate Dashboard update).
 */
export async function toggleTask(pageId, taskIndex) {
  const user = getCurrentUser();
  if (!user) {
    console.error('[Insel-Wiki] Cannot toggle task: No user logged in');
    return;
  }

  console.log(`[Insel-Wiki] Toggling task ${taskIndex} on page ${pageId}`);

  // 1. Update Yjs (Source of truth for collaboration)
  const ydoc = new Y.Doc();
  const provider = new FirestoreYjsProvider(pageId, ydoc, user);
  
  const yjsPromise = new Promise((resolve, reject) => {
    provider.setLoadCallback(async (hasState) => {
      try {
        const content = ydoc.getXmlFragment('default');
        
        // Traverse the XML fragment to find the n-th taskItem
        let currentIndex = 0;
        let found = false;

        function traverse(node) {
          if (found) return;
          if (node.nodeName === 'taskItem') {
            if (currentIndex === taskIndex) {
              const currentChecked = node.getAttribute('checked');
              node.setAttribute('checked', currentChecked === 'true' ? 'false' : 'true');
              found = true;
              return;
            }
            currentIndex++;
          }
          if (node.toArray) {
            node.toArray().forEach(child => traverse(child));
          }
        }

        traverse(content);
        
        if (found) {
          // Wait a bit for the provider to sync the update
          setTimeout(() => {
            provider.destroy();
            ydoc.destroy();
            resolve();
          }, 500); 
        } else {
          provider.destroy();
          ydoc.destroy();
          resolve(); // Still resolve to allow the Markdown update to try its best
        }
      } catch (err) {
        provider.destroy();
        ydoc.destroy();
        reject(err);
      }
    });
    provider.init();
  });

  // 2. Update Firestore Markdown Content (Immediate UI update for Dashboard)
  const pageRef = doc(db, 'pages', pageId);
  const pageSnap = await getDoc(pageRef);
  
  if (pageSnap.exists()) {
    const pageData = pageSnap.data();
    const oldContent = pageData.content || '';
    
    // Use the same robust regex as extractTasksFromContent
    const taskRegex = /^([ \t]*)(?:([-*])\s+)?\[( |x|X)\]\s*(.*)$/gm;
    let matchIndex = 0;
    const newContent = oldContent.replace(taskRegex, (match, whitespace, marker, checked, text) => {
      if (matchIndex === taskIndex) {
        matchIndex++;
        const isDone = checked.toLowerCase() === 'x';
        const newChecked = isDone ? ' ' : 'x';
        const bullet = marker ? `${marker} ` : '';
        return `${whitespace}${bullet}[${newChecked}] ${text}`;
      }
      matchIndex++;
      return match;
    });

    if (newContent !== oldContent) {
      await updateDoc(pageRef, {
        content: newContent,
        updatedAt: serverTimestamp(),
        lastSavedBy: user.email,
        lastSavedByName: user.displayName || user.email
      });
    }
  }

  return yjsPromise;
}

/**
 * Adds a link to a new meeting page to the parent page, next to the link to its
 * predecessor — only when the parent already lists the predecessor.
 *
 * @param {string} parentId - Parent page ID.
 * @param {{ predecessorId: string, href: string, title: string }} opts
 * @returns {Promise<boolean>} Whether the parent was changed.
 */
export async function addSeriesLinkToParent(parentId, opts) {
  const user = getCurrentUser();
  if (!user || !parentId) return false;

  const ydoc = new Y.Doc();
  const provider = new FirestoreYjsProvider(parentId, ydoc, user);
  try {
    const hasData = await new Promise((resolve) => {
      provider.setLoadCallback(resolve);
      provider.init();
    });
    if (hasData) {
      let added = false;
      ydoc.transact(() => {
        added = insertSeriesLinkInFragment(ydoc.getXmlFragment('default'), opts);
      });
      if (added) await provider.flushPending();
      return added;
    }
  } finally {
    provider.destroy();
  }

  // Never opened in the editor: the page is only its markdown seed, which the
  // editor turns into the Yjs document on first open.
  const pageRef = doc(db, 'pages', parentId);
  const pageSnap = await getDoc(pageRef);
  const updated = insertSeriesLinkInMarkdown(pageSnap.data()?.content, opts);
  if (updated === null) return false;
  await updateDoc(pageRef, {
    content: updated,
    updatedAt: serverTimestamp(),
    lastSavedBy: user.email,
    lastSavedByName: user.displayName || user.email
  });
  return true;
}
