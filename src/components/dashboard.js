import { extractTasksFromContent } from '../utils/tasks.js';
import { subscribeToPages } from '../firebase/firestore.js';

let unsubscribe = null;

export function initDashboard(appEl, navigateTo) {
  console.log('[Insel-Wiki] Dashboard initialized');

  // Start real-time subscription for the dashboard
  if (unsubscribe) unsubscribe();
  unsubscribe = subscribeToPages((pages) => {
    renderDashboard(pages, navigateTo);
  });
}

export function renderDashboard(pages, navigateTo) {
  let overlay = document.getElementById('dashboard-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'dashboard-overlay';
    overlay.className = 'dashboard-overlay hidden';
    document.body.appendChild(overlay);
  }

  const allTasks = pages.flatMap(page => {
    const tasks = extractTasksFromContent(page.content || '');
    return tasks.map(t => ({ ...t, pageTitle: page.title, pageId: page.id }));
  });

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
      
      <div class="dashboard-content">
        ${allTasks.length > 0 
          ? allTasks.map(task => `
              <div class="task-card ${task.done ? 'completed' : ''}" data-page-id="${task.pageId}">
                <div class="task-status-icon">
                  ${task.done ? '✅' : '⏳'}
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
              <p>Keine Aufgaben in diesem Wiki gefunden.</p>
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

  // Navigate to page on task click
  overlay.querySelectorAll('.task-card').forEach(card => {
    card.addEventListener('click', () => {
      const pageId = card.dataset.pageId;
      overlay.classList.add('hidden');
      if (navigateTo) navigateTo(pageId);
    });
  });
}