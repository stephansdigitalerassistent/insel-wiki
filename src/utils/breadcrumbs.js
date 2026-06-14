// Lightweight breadcrumb trail captured in-memory and attached to client
// errors, so a logged error carries the last few user actions / navigation /
// network events that led up to it. No external dependency, no persistence.

const MAX_BREADCRUMBS = 20;

/** @type {{category: string, message: string, t: number}[]} */
const trail = [];

/**
 * Record a breadcrumb. Oldest entries are dropped once the buffer is full.
 * @param {string} category - e.g. 'navigation', 'network', 'ui.click'
 * @param {string} message
 */
export function addBreadcrumb(category, message) {
  trail.push({
    category: String(category).slice(0, 40),
    message: String(message).slice(0, 200),
    t: Date.now(),
  });
  if (trail.length > MAX_BREADCRUMBS) trail.shift();
}

/**
 * Return a snapshot copy of the current breadcrumb trail.
 * @returns {{category: string, message: string, t: number}[]}
 */
export function getBreadcrumbs() {
  return trail.slice();
}

let captureInitialized = false;

/**
 * Wire up automatic breadcrumb capture for navigation, network state and
 * meaningful clicks. Safe to call multiple times and in non-browser (test)
 * environments — it becomes a no-op.
 */
export function initBreadcrumbCapture() {
  if (captureInitialized) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  captureInitialized = true;

  window.addEventListener('popstate', () => addBreadcrumb('navigation', location.href));
  window.addEventListener('hashchange', () => addBreadcrumb('navigation', location.href));
  window.addEventListener('online', () => addBreadcrumb('network', 'online'));
  window.addEventListener('offline', () => addBreadcrumb('network', 'offline'));

  document.addEventListener(
    'click',
    (event) => {
      const el = event.target?.closest?.('button, a, [role="button"], [data-action]');
      if (!el) return;
      const label = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 80);
      const id = el.id ? `#${el.id}` : '';
      addBreadcrumb('ui.click', `${el.tagName.toLowerCase()}${id} ${label}`.trim());
    },
    { capture: true }
  );
}
