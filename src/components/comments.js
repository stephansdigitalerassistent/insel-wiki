// Comments component — inline commenting system
import { subscribeToComments, saveComment, formatTimestamp } from '../firebase/firestore.js';
import { getCurrentUser } from '../firebase/auth.js';

let commentsSidebar = null;
let currentUnsub = null;
let activePageId = null;
let activeCommentId = null;
let commentsData = [];

/**
 * Initialize comments sidebar
 */
export function initComments(container) {
  commentsSidebar = document.createElement('div');
  commentsSidebar.className = 'comments-sidebar hidden';
  commentsSidebar.innerHTML = `
    <div class="comments-header">
      <h3>Kommentare</h3>
      <button class="btn-icon" id="close-comments-btn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="comments-list" id="comments-list"></div>
    <div class="comment-input-container hidden" id="comment-input-area">
      <textarea class="comment-input" id="new-comment-text" placeholder="Antworten oder Kommentar schreiben..." rows="3"></textarea>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button class="btn btn-outline btn-small" id="cancel-comment-btn">Abbrechen</button>
        <button class="btn btn-primary btn-small" id="save-comment-btn">Speichern</button>
      </div>
    </div>
  `;
  container.appendChild(commentsSidebar);

  document.getElementById('close-comments-btn').onclick = () => closeComments();
  document.getElementById('cancel-comment-btn').onclick = () => {
    document.getElementById('comment-input-area').classList.add('hidden');
    activeCommentId = null;
  };
  
  document.getElementById('save-comment-btn').onclick = async () => {
    const text = document.getElementById('new-comment-text').value.trim();
    if (!text || !activeCommentId || !activePageId) return;

    const user = getCurrentUser();
    try {
      await saveComment(activePageId, activeCommentId, text, user.uid, user.displayName || user.email);
      document.getElementById('new-comment-text').value = '';
      document.getElementById('comment-input-area').classList.add('hidden');
    } catch (err) {
      console.error('Save comment error:', err);
    }
  };

  // Listen for the custom 'add-comment' event from the editor
  window.addEventListener('add-comment', (e) => {
    const { commentId } = e.detail;
    openCommentThread(commentId, true);
  });

  // Listen for clicks on comment highlights in the editor
  document.addEventListener('click', (e) => {
    const highlight = e.target.closest('.comment-highlight');
    if (highlight) {
      const commentId = highlight.dataset.commentId;
      openCommentThread(commentId);
    }
  });
}

/**
 * Load comments for a specific page
 */
export function loadCommentsForPage(pageId) {
  if (currentUnsub) currentUnsub();
  activePageId = pageId;
  closeComments();

  if (!pageId) return;

  currentUnsub = subscribeToComments(pageId, (comments) => {
    commentsData = comments;
    renderCommentsList();
  });
}

/**
 * Open the sidebar and focus on a specific comment thread
 */
function openCommentThread(commentId, isNew = false) {
  activeCommentId = commentId;
  commentsSidebar.classList.remove('hidden');
  
  if (isNew) {
    document.getElementById('comment-input-area').classList.remove('hidden');
    document.getElementById('new-comment-text').focus();
  } else {
    // Focus the existing comment in the list
    const commentEl = document.querySelector(`[data-id="${commentId}"]`);
    if (commentEl) {
      commentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      commentEl.classList.add('is-active');
      setTimeout(() => commentEl.classList.remove('is-active'), 2000);
    } else {
        // If it's not in the list yet (someone else highlighted but no text saved)
        document.getElementById('comment-input-area').classList.remove('hidden');
        document.getElementById('new-comment-text').focus();
    }
  }
}

/**
 * Close comments sidebar
 */
function closeComments() {
  if (commentsSidebar) {
    commentsSidebar.classList.add('hidden');
    activeCommentId = null;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderCommentsList() {
  const list = document.getElementById('comments-list');
  if (!list) return;

  if (commentsData.length === 0) {
    list.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">Noch keine Kommentare auf dieser Seite.</div>';
    return;
  }

  list.innerHTML = commentsData.map(c => `
    <div class="comment-item" data-id="${escapeHtml(c.id)}">
      <div class="comment-user">${escapeHtml(c.userName)}</div>
      <div class="comment-text">${escapeHtml(c.text)}</div>
      <div class="comment-date">${formatTimestamp(c.createdAt)}</div>
    </div>
  `).join('');
}
