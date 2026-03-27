// History panel component
import { getHistory, formatTimestamp, getFullHistoryContent } from '../firebase/firestore.js';
import { marked } from 'marked';

let currentPageId = null;

/**
 * Load and render history for a page
 */
export async function loadHistory(pageId) {
  currentPageId = pageId;
  const listEl = document.getElementById('history-list');
  const previewEl = document.getElementById('history-preview');

  if (!listEl) return;

  listEl.innerHTML = '<div style="padding: 16px; color: var(--text-muted); font-size: 0.85rem;">Lade Verlauf…</div>';
  if (previewEl) previewEl.innerHTML = '';

  try {
    const entries = await getHistory(pageId);

    if (entries.length === 0) {
      listEl.innerHTML = '<div style="padding: 16px; color: var(--text-muted); font-size: 0.85rem;">Noch keine Einträge</div>';
      return;
    }

    listEl.innerHTML = '';
    entries.forEach((entry, index) => {
      const el = document.createElement('div');
      el.className = 'history-entry';
      el.innerHTML = `
        <div class="history-date">${formatTimestamp(entry.savedAt)}</div>
        <div class="history-user">${entry.savedBy || 'Unbekannt'}</div>
      `;
      el.addEventListener('click', async () => {
        // Highlight active entry
        listEl.querySelectorAll('.history-entry').forEach((e) => e.style.background = '');
        el.style.background = 'var(--accent-subtle)';

        // Show preview
        if (previewEl) {
          previewEl.innerHTML = '<div style="padding: 16px; color: var(--text-muted);">Rekonstruiere Inhalt…</div>';
          const fullContent = await getFullHistoryContent(currentPageId, entry.id);
          previewEl.innerHTML = marked.parse(fullContent || '');
        }
      });
      listEl.appendChild(el);
    });
  } catch (err) {
    console.error('Error loading history:', err);
    listEl.innerHTML = '<div style="padding: 16px; color: var(--danger); font-size: 0.85rem;">Fehler beim Laden</div>';
  }
}

/**
 * Toggle history panel visibility
 */
export function toggleHistoryPanel() {
  const panel = document.getElementById('history-panel');
  if (panel) {
    panel.classList.toggle('hidden');
  }
}

/**
 * Close history panel
 */
export function closeHistoryPanel() {
  const panel = document.getElementById('history-panel');
  if (panel) {
    panel.classList.add('hidden');
  }
}
