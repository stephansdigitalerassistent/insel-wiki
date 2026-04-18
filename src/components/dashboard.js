import { extractTasksFromContent } from '../utils/tasks.js';

export function initDashboard(appEl, navigateTo) {
  console.log('[Insel-Wiki] Dashboard initialized');
}

export function renderDashboard(pages) {
  const container = document.getElementById('dashboard-container');
  if (!container) return;

  const allTasks = pages.flatMap(page => {
    const tasks = extractTasksFromContent(page.content || '');
    return tasks.map(t => ({ ...t, pageTitle: page.title, pageId: page.id }));
  });

  container.innerHTML = `
    <div class="dashboard-section">
      <h2>Offene Todos</h2>
      <ul>
        ${allTasks.length > 0 
          ? allTasks.map(task => `
              <li class="task-item ${task.done ? 'completed' : ''}">
                <input type="checkbox" ${task.done ? 'checked' : ''} disabled>
                <span>${task.text} <small>(${task.pageTitle})</small></span>
              </li>
            `).join('')
          : '<li>Keine Todos gefunden</li>'
        }
      </ul>
    </div>
  `;
}