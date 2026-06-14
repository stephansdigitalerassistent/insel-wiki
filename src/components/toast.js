import i18next from '../i18n.js';
import { logClientError } from '../firebase/firestore.js';
import { shouldLogError } from '../utils/error-filter.js';
import { initBreadcrumbCapture } from '../utils/breadcrumbs.js';

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
    <button class="toast-close" aria-label="${i18next.t('common.close')}">&times;</button>
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
let isLoggingError = false;

export function initGlobalErrorHandler() {
  initBreadcrumbCapture();

  const originalConsoleError = console.error;
  console.error = (...args) => {
    originalConsoleError.apply(console, args);

    if (isLoggingError) return;

    isLoggingError = true;
    try {
      const message = args.map(arg => {
        if (arg instanceof Error) return arg.message;
        if (arg && typeof arg === 'object') {
          try {
            return JSON.stringify(arg);
          } catch (e) {
            return String(arg);
          }
        }
        return String(arg);
      }).join(' ');

      if (!shouldLogError(message)) return;

      const errorObj = args.find(arg => arg instanceof Error);
      const stack = errorObj ? errorObj.stack : null;

      logClientError(message, stack, { severity: 'error', source: 'console' });
    } catch (err) {
      originalConsoleError('[Logging] Failed to process console error:', err);
    } finally {
      isLoggingError = false;
    }
  };

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = reason?.message || String(reason ?? '') || i18next.t('errors.unexpected');
    // Use the original console.error so we don't double-log through the funnel
    // above — we log explicitly below with the correct severity.
    originalConsoleError('[Insel-Wiki] Unhandled rejection:', reason);
    if (!shouldLogError(message)) return;
    logClientError(message, reason?.stack || null, { severity: 'unhandled-rejection', source: 'window' });
    showToast(message, 'error', 6000);
  });

  window.addEventListener('error', (event) => {
    const err = event.error;
    const message = err?.message || event.message || 'Uncaught error';
    originalConsoleError('[Insel-Wiki] Uncaught error:', err);
    if (shouldLogError(message)) {
      logClientError(message, err?.stack || null, { severity: 'uncaught', source: 'window' });
    }
    showToast(i18next.t('errors.reload'), 'error', 8000);
  });
}
