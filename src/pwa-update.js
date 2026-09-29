/**
 * Keeps long-lived tabs on current code.
 *
 * The wiki is a hash-routed SPA, so moving between pages changes only the URL
 * fragment and never issues a navigation request — and a navigation is the main
 * thing that makes a browser re-check `/sw.js`. A tab left open therefore never
 * discovers a new build. One client was observed running an eight-day-old
 * bundle for exactly this reason.
 *
 * `registerType: 'autoUpdate'` does not help on its own: it only controls what a
 * new service worker does once it has been *found* (skipWaiting + clientsClaim).
 * The registration snippet vite-plugin-pwa injects by default just calls
 * `register()` once and never calls `update()`, so nothing ever looks. This
 * module replaces it (`injectRegister: null` in vite.config.js) and adds the
 * missing half: poll for a new worker, then act when one takes over.
 */
import { showToast } from './components/toast.js';
import { getProvider } from './editor/editor.js';
import { isPresentationOpen } from './components/presentation.js';
import i18next from './i18n.js';
import { isReloadSafe } from './utils/reload-safety.js';

const SW_URL = '/sw.js';
/** How often an open tab asks whether a new service worker exists. */
const CHECK_INTERVAL_MS = 60_000;
/** How often a deferred reload re-tests whether it has become safe. */
const RETRY_INTERVAL_MS = 15_000;

let reloadScheduled = false;
let updateToast = null;

/**
 * Reads the live page state and asks the reload-safety policy about it.
 * @returns {boolean}
 */
function canReloadNow() {
  let hasUnsavedChanges = false;
  try {
    const provider = getProvider();
    hasUnsavedChanges = Boolean(provider && provider.hasUnsavedChanges);
  } catch (e) {
    // No editor mounted yet — nothing to lose.
  }

  return isReloadSafe({
    presenting: isPresentationOpen(),
    hasUnsavedChanges,
    visibilityState: typeof document !== 'undefined' ? document.visibilityState : 'visible',
    activeElement: typeof document !== 'undefined' ? document.activeElement : null
  });
}

/**
 * Reloads once, ignoring repeat triggers.
 * @returns {void}
 */
function applyUpdate() {
  if (reloadScheduled) return;
  reloadScheduled = true;
  window.location.reload();
}

/**
 * Reloads if that is currently harmless, otherwise offers the choice and keeps
 * re-testing quietly until it becomes harmless.
 * @returns {void}
 */
export function reloadWhenSafe() {
  if (reloadScheduled) return;

  if (canReloadNow()) {
    applyUpdate();
    return;
  }

  if (!updateToast) {
    const label = i18next.t('pwa.updateAvailable', { defaultValue: 'Neue Version verfügbar.' });
    const action = i18next.t('pwa.reload', { defaultValue: 'Neu laden' });
    updateToast = showToast(
      `${label} <button type="button" class="toast-action" id="pwa-reload-btn">${action}</button>`,
      'info',
      0
    );
    const btn = updateToast && updateToast.querySelector('#pwa-reload-btn');
    if (btn) btn.addEventListener('click', applyUpdate);
  }

  const timer = setInterval(() => {
    if (reloadScheduled) {
      clearInterval(timer);
      return;
    }
    if (canReloadNow()) {
      clearInterval(timer);
      applyUpdate();
    }
  }, RETRY_INTERVAL_MS);
}

/**
 * Registers the service worker and starts looking for new builds.
 * @returns {void}
 */
export function initServiceWorkerUpdates() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  // A page that had no controller is seeing its first install; that claim is not
  // a new version and must not trigger a reload loop.
  const hadController = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    reloadWhenSafe();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register(SW_URL, { scope: '/' }).then((registration) => {
      const check = () => { registration.update().catch(() => {}); };

      setInterval(check, CHECK_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      window.addEventListener('online', check);
    }).catch(() => {
      // No service worker (private mode, unsupported browser) — the app still works.
    });
  });
}
