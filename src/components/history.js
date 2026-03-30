// History panel component
import { getHistory, formatTimestamp, getFullHistoryContent, computeDiffHtml } from '../firebase/firestore.js';
import { marked } from 'marked';

let currentPageId = null;

/**
 * Load and render history for a page
 */
export async function loadHistory(pageId, livePageData, getLiveContent) {
  currentPageId = pageId;
  const listEl = document.getElementById('history-list');
  const previewEl = document.getElementById('history-preview');

  if (!listEl) return;

  listEl.innerHTML = '<div style="padding: 16px; color: var(--text-muted); font-size: 0.85rem;">Lade Verlauf…</div>';
  if (previewEl) previewEl.innerHTML = '';

  try {
    const entries = await getHistory(pageId);

    listEl.innerHTML = '';

    // Add Live Version at the top
    if (livePageData && livePageData.lastSavedBy) {
      const liveEl = document.createElement('div');
      liveEl.className = 'history-entry live-version';
      liveEl.style.borderLeft = '4px solid var(--success)';
      liveEl.style.marginBottom = '8px';
      liveEl.style.background = 'rgba(16, 185, 129, 0.05)';
      
      liveEl.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span style="font-weight: 600; color: var(--success); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;">Aktuelle Version</span>
          <span class="history-date" style="font-size: 0.7rem;">Gerade eben</span>
        </div>
        <div class="history-user">${livePageData.lastSavedByByName || livePageData.lastSavedBy}</div>
      `;

      liveEl.addEventListener('click', async () => {
        listEl.querySelectorAll('.history-entry').forEach((e) => e.style.background = '');
        liveEl.style.background = 'rgba(16, 185, 129, 0.1)';

        if (previewEl) {
          previewEl.innerHTML = '<div style="padding: 16px; color: var(--text-muted);">Vergleiche mit letztem Snapshot…</div>';
          
          const currentContent = getLiveContent ? getLiveContent() : '';
          let latestSnapshotContent = '';
          
          if (entries.length > 0) {
            latestSnapshotContent = await getFullHistoryContent(pageId, entries[0].id);
          }

          if (!latestSnapshotContent) {
            previewEl.innerHTML = `
              <div style="padding: 8px; font-size: 0.75rem; color: var(--text-muted); border-bottom: 1px solid var(--border); margin-bottom: 12px;">Live Inhalt (Keine Snapshots vorhanden)</div>
              ${marked.parse(currentContent || '')}
            `;
          } else {
            const diffHtml = computeDiffHtml(latestSnapshotContent, currentContent);
            previewEl.innerHTML = `
              <div style="padding: 8px; font-size: 0.75rem; color: var(--text-muted); border-bottom: 1px solid var(--border); margin-bottom: 12px;">Änderungen seit dem letzten Snapshot:</div>
              <div class="diff-view">${diffHtml}</div>
            `;
          }
        }
      });
      listEl.appendChild(liveEl);
    }

    if (entries.length === 0 && (!livePageData || !livePageData.lastSavedBy)) {
      listEl.innerHTML = '<div style="padding: 16px; color: var(--text-muted); font-size: 0.85rem;">Noch keine Einträge</div>';
      return;
    }
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

        // Show preview with diff
        if (previewEl) {
          previewEl.innerHTML = '<div style="padding: 16px; color: var(--text-muted);">Vergleiche Versionen…</div>';
          
          // Get current selected content
          const currentVersionContent = await getFullHistoryContent(currentPageId, entry.id);
          
          // Get previous content (if exists)
          let previousVersionContent = '';
          if (index < entries.length - 1) {
            const prevEntry = entries[index + 1]; // entries are descending
            previousVersionContent = await getFullHistoryContent(currentPageId, prevEntry.id);
          }

          if (!previousVersionContent) {
            // First version or no previous: show full marked content
            previewEl.innerHTML = `
              <div style="padding: 8px; font-size: 0.75rem; color: var(--text-muted); border-bottom: 1px solid var(--border); margin-bottom: 12px;">Erste Version</div>
              ${marked.parse(currentVersionContent || '')}
            `;
          } else {
            // Show visual diff
            const diffHtml = computeDiffHtml(previousVersionContent, currentVersionContent);
            previewEl.innerHTML = `
              <div style="padding: 8px; font-size: 0.75rem; color: var(--text-muted); border-bottom: 1px solid var(--border); margin-bottom: 12px;">Änderungen in dieser Version:</div>
              <div class="diff-view">${diffHtml}</div>
            `;
          }
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
