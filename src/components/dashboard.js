import { extractTasksFromContent } from '../utils/tasks.js';
import { subscribeToPages, getClientErrors } from '../firebase/firestore.js';
import { onAuthChange, canEdit, getCurrentUser } from '../firebase/auth.js';
import { toggleTask } from '../utils/yjs-sync.js';
import i18next from '../i18n.js';

let unsubscribe = null;
let lastPages = [];
let lastErrors = [];
let lastNavigateTo = null;
let currentFilter = 'all'; // 'all', 'my', or 'errors'
let currentStatus = 'all'; // 'all', 'open', 'done'
let isLoadingErrors = false;

const ADMIN_EMAILS = [
  'stephan.heuscher@insel.ch',
  's.heuscher@gmail.com',
  'stephansdigitalassistent@gmail.com',
  'stephansdigitalassistent+wiki@gmail.com'
];

function isUserAdmin(user) {
  if (!user || !user.email) return false;
  const email = user.email.toLowerCase();
  return ADMIN_EMAILS.includes(email) || email.startsWith('stephan.heuscher@');
}

export function initDashboard(appEl, navigateTo) {
  console.log('[Insel-Wiki] Dashboard initialized');

  onAuthChange((user) => {
    if (unsubscribe) unsubscribe();
    if (user) {
      unsubscribe = subscribeToPages((pages) => {
        renderDashboard(pages, navigateTo);
      });
    }
  });
}

async function loadAndRenderErrors(navigateTo) {
  isLoadingErrors = true;
  renderDashboard(lastPages, navigateTo);
  try {
    lastErrors = await getClientErrors(50);
  } catch (e) {
    console.error('[Dashboard] Error fetching client errors:', e);
    lastErrors = [];
  } finally {
    isLoadingErrors = false;
    renderDashboard(lastPages, navigateTo);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderDashboard(pages, navigateTo) {
  lastPages = pages || lastPages;
  lastNavigateTo = navigateTo || lastNavigateTo;

  let overlay = document.getElementById('dashboard-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'dashboard-overlay';
    overlay.className = 'dashboard-overlay hidden';
    document.body.appendChild(overlay);
  }

  const user = getCurrentUser();
  const isAdmin = isUserAdmin(user);
  const myName = user ? user.displayName : null;

  let contentHtml = '';

  if (currentFilter === 'errors') {
    if (isLoadingErrors) {
      contentHtml = `<div class="empty-hint"><p>${i18next.t('dashboard.loadingErrors')}</p></div>`;
    } else if (lastErrors.length === 0) {
      contentHtml = `<div class="empty-hint"><p>${i18next.t('dashboard.noErrors')}</p></div>`;
    } else {
      contentHtml = lastErrors.map(err => {
        const timeStr = err.timestamp?.toDate ? err.timestamp.toDate().toLocaleString() : (err.timestamp ? new Date(err.timestamp).toLocaleString() : 'N/A');
        const severityClass = `severity-${err.severity || 'error'}`;
        return `
          <div class="error-card" data-error-id="${err.id}">
            <div class="error-header">
              <span class="error-badge ${severityClass}">${err.severity || 'error'}</span>
              <span class="error-meta" style="margin-left: auto;">${timeStr}</span>
            </div>
            <div class="error-msg">${escapeHtml(err.message || 'No message')}</div>
            <div class="error-meta">
              <span>👤 ${escapeHtml(err.userName || err.userId || 'anonymous')}</span>
              ${err.url ? `<span style="margin-left: 12px; word-break: break-all;">🔗 ${escapeHtml(err.url)}</span>` : ''}
              ${err.appVersion ? `<span style="margin-left: 12px;">📦 v${escapeHtml(err.appVersion)}</span>` : ''}
            </div>
            ${err.stack ? `
              <details class="error-details">
                <summary>${i18next.t('dashboard.stack')}</summary>
                <pre class="error-stack">${escapeHtml(err.stack)}</pre>
              </details>
            ` : ''}
            ${err.breadcrumbs && err.breadcrumbs.length > 0 ? `
              <details class="error-details">
                <summary>${i18next.t('dashboard.breadcrumbs')} (${err.breadcrumbs.length})</summary>
                <div class="error-breadcrumbs">
                  ${err.breadcrumbs.map(b => `<div class="breadcrumb-item"><span class="bc-time">${new Date(b.t).toLocaleTimeString()}</span> <span class="bc-cat">[${escapeHtml(b.category)}]</span> ${escapeHtml(b.message)}</div>`).join('')}
                </div>
              </details>
            ` : ''}
          </div>
        `;
      }).join('');
    }
  } else {
    const allTasks = lastPages.flatMap(page => {
      const tasks = extractTasksFromContent(page.content || '');
      return tasks.map(t => ({ ...t, pageTitle: page.title, pageId: page.id }));
    });

    let filteredTasks = allTasks;

    // Apply Filter: My Tasks
    if (currentFilter === 'my' && myName) {
      filteredTasks = filteredTasks.filter(t => t.text.includes(`@${myName}`));
    }

    // Apply Filter: Status
    if (currentStatus === 'open') {
      filteredTasks = filteredTasks.filter(t => !t.done);
    } else if (currentStatus === 'done') {
      filteredTasks = filteredTasks.filter(t => t.done);
    }

    contentHtml = filteredTasks.length > 0
      ? filteredTasks.map(task => `
          <div class="task-card ${task.done ? 'completed' : ''}" data-page-id="${task.pageId}" data-task-index="${task.index}">
            <div class="task-status-icon clickable-status">
              ${task.done ? '✅' : '⬜'}
            </div>
            <div class="task-body">
              <div class="task-text">${task.text}</div>
              <div class="task-meta">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 4px;"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                ${task.pageTitle || i18next.t('common.untitled')}
              </div>
            </div>
          </div>
        `).join('')
      : `
        <div class="empty-hint">
          <p>${i18next.t('dashboard.noTasks')}</p>
        </div>
      `;
  }

  overlay.innerHTML = `
    <div class="dashboard-card">
      <div class="dashboard-header">
        <h3 style="margin: 0; display: flex; align-items: center; gap: 10px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
          ${i18next.t('dashboard.title')}
        </h3>
        <button id="close-dashboard-btn" class="btn-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="dashboard-filters">
        <div class="filter-group">
          <button class="filter-btn ${currentFilter === 'all' ? 'active' : ''}" data-filter="all">${i18next.t('dashboard.filterAll')}</button>
          <button class="filter-btn ${currentFilter === 'my' ? 'active' : ''}" data-filter="my">${i18next.t('dashboard.filterMy')}</button>
          ${isAdmin ? `<button class="filter-btn ${currentFilter === 'errors' ? 'active' : ''}" data-filter="errors">🚨 ${i18next.t('dashboard.filterErrors')}</button>` : ''}
        </div>
        ${currentFilter !== 'errors' ? `
        <div class="filter-group" style="margin-left: auto;">
          <span style="font-size: 0.8rem; color: var(--text-muted);">${i18next.t('dashboard.status')}</span>
          <select id="status-filter-select" class="filter-select">
            <option value="all" ${currentStatus === 'all' ? 'selected' : ''}>${i18next.t('dashboard.statusAll')}</option>
            <option value="open" ${currentStatus === 'open' ? 'selected' : ''}>${i18next.t('dashboard.statusOpen')}</option>
            <option value="done" ${currentStatus === 'done' ? 'selected' : ''}>${i18next.t('dashboard.statusDone')}</option>
          </select>
        </div>
        ` : `
        <div class="filter-group" style="margin-left: auto;">
          <button id="refresh-errors-btn" class="filter-btn" style="padding: 4px 10px;">🔄 Refresh</button>
        </div>
        `}
      </div>
      
      <div class="dashboard-content">
        ${contentHtml}
      </div>
    </div>
  `;

  // --- Events ---
  const closeBtn = document.getElementById('close-dashboard-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      overlay.classList.add('hidden');
    });
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.add('hidden');
  });

  const openBtn = document.getElementById('open-dashboard-btn');
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      overlay.classList.remove('hidden');
      if (currentFilter === 'errors') {
        loadAndRenderErrors(lastNavigateTo);
      }
    });
  }

  // Filter Events
  overlay.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.filter;
      if (currentFilter === 'errors') {
        loadAndRenderErrors(lastNavigateTo);
      } else {
        renderDashboard();
      }
    });
  });

  const refreshBtn = document.getElementById('refresh-errors-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadAndRenderErrors(lastNavigateTo);
    });
  }

  const statusSelect = document.getElementById('status-filter-select');
  if (statusSelect) {
    statusSelect.addEventListener('change', (e) => {
      currentStatus = e.target.value;
      renderDashboard();
    });
  }

  // Task interaction
  overlay.querySelectorAll('.task-card').forEach(card => {
    const statusIcon = card.querySelector('.clickable-status');
    const pageId = card.dataset.pageId;
    const taskIndex = parseInt(card.dataset.taskIndex, 10);

    if (statusIcon && canEdit()) {
      statusIcon.addEventListener('click', async (e) => {
        e.stopPropagation();
        statusIcon.innerHTML = '⏳'; // Loading indicator
        try {
          await toggleTask(pageId, taskIndex);
        } catch (err) {
          console.error('[Insel-Wiki] Error toggling task:', err);
          statusIcon.innerHTML = card.classList.contains('completed') ? '✅' : '⬜';
        }
      });
    }

    card.addEventListener('click', () => {
      overlay.classList.add('hidden');
      if (navigateTo) navigateTo(pageId);
    });
  });
}