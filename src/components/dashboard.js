// Global Task Dashboard Component
import { getAllPages } from './sidebar.js';
import { extractTasks } from '../utils/tasks.js';

let dashboardOverlay = null;
let onNavigateCallback = null;

export function initDashboard(container, onNavigate) {
  onNavigateCallback = onNavigate;
  
  dashboardOverlay = document.createElement('div');
  dashboardOverlay.className = 'dashboard-overlay hidden';
  dashboardOverlay.innerHTML = `
    <div class="dashboard-card">
      <div class="dashboard-header">
        <h2>📋 Globales Task-Dashboard</h2>
        <button class="btn-icon" id="close-dashboard-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="dashboard-filters">
        <button class="btn btn-outline btn-small active" data-filter="all">Alle</button>
        <button class="btn btn-outline btn-small" data-filter="mine">Meine Tasks</button>
        <button class="btn btn-outline btn-small" data-filter="open">Offen</button>
      </div>
      <div class="dashboard-content" id="dashboard-tasks-list">
        <!-- Tasks will be rendered here -->
      </div>
    </div>
  `;
  
  container.appendChild(dashboardOverlay);
  
  document.getElementById('close-dashboard-btn').onclick = () => {
    dashboardOverlay.classList.add('hidden');
  };

  const openBtn = document.getElementById('open-dashboard-btn');
  if (openBtn) {
    openBtn.onclick = () => showDashboard();
  }
}

export function showDashboard() {
  dashboardOverlay.classList.remove('hidden');
  renderTasks();
}

function renderTasks(filter = 'all') {
  const list = document.getElementById('dashboard-tasks-list');
  const pages = getAllPages();
  let allTasks = [];

  console.log(`[Dashboard] Rendering tasks for ${pages.length} pages`);

  pages.forEach(page => {
    if (page.content) {
      const tasks = extractTasks(page.content, page.id, page.title);
      if (tasks.length > 0) {
        console.log(`[Dashboard] Found ${tasks.length} tasks in ${page.title}`);
      }
      allTasks = allTasks.concat(tasks);
    }
  });

  if (allTasks.length === 0) {
    list.innerHTML = '<div class="empty-hint">Keine Tasks in Wiki-Seiten gefunden.</div>';
    return;
  }

  list.innerHTML = allTasks.map(task => `
    <div class="task-card ${task.status}" onclick="window.dispatchEvent(new CustomEvent('nav-to-task', {detail: {pageId: '${task.pageId}', line: ${task.lineIndex}}}))">
      <div class="task-status-icon">${task.status === 'completed' ? '✅' : '⭕'}</div>
      <div class="task-body">
        <div class="task-text">${task.text}</div>
        <div class="task-meta">In: <strong>${task.pageTitle}</strong></div>
      </div>
    </div>
  `).join('');
}

// Listen for navigation requests
window.addEventListener('nav-to-task', (e) => {
  const { pageId } = e.detail;
  dashboardOverlay.classList.add('hidden');
  if (onNavigateCallback) onNavigateCallback(pageId);
});
