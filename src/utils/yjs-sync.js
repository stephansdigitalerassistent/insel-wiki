import * as Y from 'yjs';
import { FirestoreYjsProvider } from '../editor/FirestoreYjsProvider.js';
import { getCurrentUser } from '../firebase/auth.js';
import { db } from '../firebase/config.js';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

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
    const data = pageSnap.data();
    const oldContent = data.content || '';
    
    // Use the same regex as extractTasksFromContent
    const taskRegex = /^(\s*)- \[( |x|X)\] (.*)$/gm;
    let matchIndex = 0;
    const newContent = oldContent.replace(taskRegex, (match, whitespace, checked, text) => {
      if (matchIndex === taskIndex) {
        const newChecked = checked.toLowerCase() === 'x' ? ' ' : 'x';
        matchIndex++;
        return `${whitespace}- [${newChecked}] ${text}`;
      }
      matchIndex++;
      return match;
    });

    if (newContent !== oldContent) {
      await updateDoc(pageRef, {
        content: newContent,
        updatedAt: serverTimestamp(),
        lastSavedBy: user.uid,
        lastSavedByName: user.displayName || user.email
      });
    }
  }

  return yjsPromise;
}
