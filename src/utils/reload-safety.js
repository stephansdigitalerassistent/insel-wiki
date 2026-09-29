/**
 * Decides whether reloading the page right now would cost the user something.
 *
 * Kept free of imports and browser globals so the policy can be tested directly;
 * `src/pwa-update.js` supplies the live values.
 *
 * @param {Object} state
 * @param {boolean} [state.presenting] - Presentation mode is open.
 * @param {boolean} [state.hasUnsavedChanges] - Yjs provider still has writes in flight.
 * @param {string} [state.visibilityState] - `document.visibilityState`.
 * @param {{isContentEditable?: boolean, tagName?: string}|null} [state.activeElement] - `document.activeElement`.
 * @returns {boolean} True when a reload is unlikely to interrupt anyone.
 */
export function isReloadSafe({
  presenting = false,
  hasUnsavedChanges = false,
  visibilityState = 'visible',
  activeElement = null
} = {}) {
  // A reload during a pitch is worse than running a slightly old bundle, and the
  // projector keeps showing the deck even when the tab reports itself hidden.
  if (presenting) return false;

  // Reloading with writes in flight would also trip main.js's `beforeunload`
  // guard and raise a browser confirm dialog.
  if (hasUnsavedChanges) return false;

  // A backgrounded tab has no one to interrupt.
  if (visibilityState === 'hidden') return true;

  if (activeElement && (
    activeElement.isContentEditable ||
    activeElement.tagName === 'INPUT' ||
    activeElement.tagName === 'TEXTAREA'
  )) {
    return false;
  }

  return true;
}
