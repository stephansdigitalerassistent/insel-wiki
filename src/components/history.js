// History panel component
import { getHistory, formatTimestamp, getFullHistoryContent, computeDiffHtml } from '../firebase/firestore.js';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import i18next from '../i18n.js';

let currentPageId = null;

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Load and render history for a page
 * @param {string} pageId
 * @param {Object} livePageData
 * @param {Function} getLiveContent
 * @param {Function} [onRestore] Callback (content, entry) => Promise<void>
 */
export async function loadHistory(pageId, livePageData, getLiveContent, onRestore) {
  currentPageId = pageId;
  const listEl = document.getElementById('history-list');
  const previewEl = document.getElementById('history-preview');

  if (!listEl) return;

  listEl.innerHTML = `<div style="padding: 16px; color: var(--text-muted); font-size: 0.85rem;">${i18next.t('history.loading')}</div>`;
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
          <span style="font-weight: 600; color: var(--success); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;">${i18next.t('history.liveVersion')}</span>
          <span class="history-date" style="font-size: 0.7rem;">${i18next.t('history.justNow')}</span>
        </div>
        <div class="history-user">${livePageData.lastSavedBy || i18next.t('history.unknownUser')}</div>
      `;

      liveEl.addEventListener('click', async () => {
        listEl.querySelectorAll('.history-entry').forEach((e) => e.style.background = '');
        liveEl.style.background = 'rgba(16, 185, 129, 0.1)';

        if (previewEl) {
          previewEl.innerHTML = `<div style="padding: 16px; color: var(--text-muted);">${i18next.t('history.comparing')}</div>`;
          
          const currentContent = getLiveContent ? getLiveContent() : '';
          let latestSnapshotContent = '';
          
          if (entries.length > 0) {
            latestSnapshotContent = await getFullHistoryContent(pageId, entries[0].id);
          }

          if (!latestSnapshotContent) {
            previewEl.innerHTML = `
              <div class="history-preview-header">
                <span>${i18next.t('history.noSnapshots')}</span>
              </div>
              <div class="history-preview-body">
                ${DOMPurify.sanitize(marked.parse(currentContent || ''))}
              </div>
            `;
          } else {
            const diffHtml = computeDiffHtml(latestSnapshotContent, currentContent);
            previewEl.innerHTML = `
              <div class="history-preview-header">
                <span>${i18next.t('history.changesSinceLast')}</span>
              </div>
              <div class="diff-view">${diffHtml}</div>
            `;
          }
        }
      });
      listEl.appendChild(liveEl);
    }

    if (entries.length === 0 && (!livePageData || !livePageData.lastSavedBy)) {
      listEl.innerHTML = `<div style="padding: 16px; color: var(--text-muted); font-size: 0.85rem;">${i18next.t('history.noEntries')}</div>`;
      return;
    }
    entries.forEach((entry, index) => {
      const el = document.createElement('div');
      el.className = 'history-entry';
      el.innerHTML = `
        <div class="history-date">${formatTimestamp(entry.savedAt)}</div>
        <div class="history-user">${escapeHtml(entry.savedBy || i18next.t('history.unknownUser'))}</div>
      `;
      el.addEventListener('click', async () => {
        // Highlight active entry
        listEl.querySelectorAll('.history-entry').forEach((e) => e.style.background = '');
        el.style.background = 'var(--accent-subtle)';

        // Show preview with diff and restore button
        if (previewEl) {
          previewEl.innerHTML = `<div style="padding: 16px; color: var(--text-muted);">${i18next.t('history.comparing')}</div>`;
          
          // Get current selected content
          const currentVersionContent = await getFullHistoryContent(currentPageId, entry.id);
          
          // Get previous content (if exists)
          let previousVersionContent = '';
          if (index < entries.length - 1) {
            const prevEntry = entries[index + 1]; // entries are descending
            previousVersionContent = await getFullHistoryContent(currentPageId, prevEntry.id);
          }

          previewEl.innerHTML = '';

          // Header with label and Restore button
          const headerEl = document.createElement('div');
          headerEl.className = 'history-preview-header';

          const labelSpan = document.createElement('span');
          labelSpan.textContent = !previousVersionContent 
            ? i18next.t('history.firstVersion') 
            : i18next.t('history.changesInVersion');
          headerEl.appendChild(labelSpan);

          if (onRestore) {
            const restoreBtn = document.createElement('button');
            restoreBtn.className = 'btn-restore-version';
            restoreBtn.title = i18next.t('history.restoreTitle');
            restoreBtn.innerHTML = `
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="1 4 1 10 7 10"></polyline>
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
              </svg>
              <span>${i18next.t('history.restore')}</span>
            `;
            restoreBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              await onRestore(currentVersionContent, entry);
            });
            headerEl.appendChild(restoreBtn);
          }

          previewEl.appendChild(headerEl);

          const bodyEl = document.createElement('div');
          if (!previousVersionContent) {
            bodyEl.innerHTML = DOMPurify.sanitize(marked.parse(currentVersionContent || ''));
          } else {
            const diffHtml = computeDiffHtml(previousVersionContent, currentVersionContent);
            bodyEl.innerHTML = `<div class="diff-view">${diffHtml}</div>`;
          }
          previewEl.appendChild(bodyEl);
        }
      });
      listEl.appendChild(el);
    });
  } catch (err) {
    console.error('Error loading history:', err);
    listEl.innerHTML = `<div style="padding: 16px; color: var(--danger); font-size: 0.85rem;">${i18next.t('common.error')}</div>`;
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
