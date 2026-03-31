// Toast Notification System — replaces native alert() calls
let toastContainer = null;

function ensureContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

/**
 * Show a toast notification.
 * @param {string} message - The message to display
 * @param {'success'|'error'|'warning'|'info'} type - The type of toast
 * @param {number} duration - Duration in ms before auto-dismiss (0 = sticky)
 */
export function showToast(message, type = 'info', duration = 4000) {
  const container = ensureContainer();
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };
  
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-close" aria-label="Schliessen">&times;</button>
  `;
  
  // Close button
  toast.querySelector('.toast-close').addEventListener('click', () => dismissToast(toast));
  
  container.appendChild(toast);
  
  // Trigger entrance animation
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  
  // Auto-dismiss
  if (duration > 0) {
    setTimeout(() => dismissToast(toast), duration);
  }
  
  return toast;
}

function dismissToast(toast) {
  if (!toast || !toast.parentNode) return;
  toast.classList.remove('toast-visible');
  toast.classList.add('toast-exit');
  toast.addEventListener('animationend', () => toast.remove(), { once: true });
  // Fallback removal if animationend doesn't fire
  setTimeout(() => toast.remove(), 400);
}

/**
 * Initialize global error handler (#14).
 * Catches unhandled promise rejections and JS errors.
 */
export function initGlobalErrorHandler() {
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[Insel-Wiki] Unhandled rejection:', event.reason);
    const message = event.reason?.message || 'Ein unerwarteter Fehler ist aufgetreten.';
    // Avoid spamming toasts for known Firebase offline errors
    if (message.includes('Failed to get document') || message.includes('unavailable')) return;
    showToast(message, 'error', 6000);
  });

  window.addEventListener('error', (event) => {
    console.error('[Insel-Wiki] Uncaught error:', event.error);
    showToast('Ein Fehler ist aufgetreten. Bitte Seite neu laden.', 'error', 8000);
  });
}
