import { extractTasksFromContent } from '../utils/tasks.js';
import { subscribeToPages } from '../firebase/firestore.js';
import { onAuthChange, canEdit, getCurrentUser } from '../firebase/auth.js';
import { toggleTask } from '../utils/yjs-sync.js';

let unsubscribe = null;
let lastPages = [];
let lastNavigateTo = null;
let currentFilter = 'all'; // 'all' or 'my'
let currentStatus = 'all'; // 'all', 'open', 'done'

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

  const allTasks = lastPages.flatMap(page => {
    const tasks = extractTasksFromContent(page.content || '');
    return tasks.map(t => ({ ...t, pageTitle: page.title, pageId: page.id }));
  });

  const user = getCurrentUser();
  const myName = user ? user.displayName : null;

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

  overlay.innerHTML = `
    <div class="dashboard-card">
      <div class="dashboard-header">
        <h3 style="margin: 0; display: flex; align-items: center; gap: 10px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
          Aufgaben-Übersicht
        </h3>
        <button id="close-dashboard-btn" class="btn-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="dashboard-filters">
        <div class="filter-group">
          <button class="filter-btn ${currentFilter === 'all' ? 'active' : ''}" data-filter="all">Alle</button>
          <button class="filter-btn ${currentFilter === 'my' ? 'active' : ''}" data-filter="my">Meine Aufgaben</button>
        </div>
        <div class="filter-group" style="margin-left: auto;">
          <span style="font-size: 0.8rem; color: var(--text-muted);">Status:</span>
          <select id="status-filter-select" class="filter-select">
            <option value="all" ${currentStatus === 'all' ? 'selected' : ''}>Alle</option>
            <option value="open" ${currentStatus === 'open' ? 'selected' : ''}>Offen</option>
            <option value="done" ${currentStatus === 'done' ? 'selected' : ''}>Erledigt</option>
          </select>
        </div>
      </div>
      
      <div class="dashboard-content">
        ${filteredTasks.length > 0 
          ? filteredTasks.map(task => `
              <div class="task-card ${task.done ? 'completed' : ''}" data-page-id="${task.pageId}" data-task-index="${task.index}">
                <div class="task-status-icon clickable-status">
                  ${task.done ? '✅' : '⬜'}
                </div>
                <div class="task-body">
                  <div class="task-text">${task.text}</div>
                  <div class="task-meta">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 4px;"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    ${task.pageTitle}
                  </div>
                </div>
              </div>
            `).join('')
          : `
            <div class="empty-hint">
              <p>Keine Aufgaben gefunden.</p>
            </div>
          `
        }
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
    });
  }

  // Filter Events
  overlay.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.filter;
      renderDashboard();
    });
  });

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