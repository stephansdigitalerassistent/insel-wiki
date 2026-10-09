/**
 * Puts the page-action buttons behind a ⋯ menu in the toolbar on narrow screens.
 *
 * The toolbar holds eight fixed-width 32px icon buttons — 296px that never
 * shrink. The breadcrumb is `flex: 1; overflow: hidden`, so it absorbed the
 * whole shortfall: measured at 375px it collapsed to 0px and the button row
 * ended up flush against the hamburger.
 *
 * These actions first moved into the sidebar drawer, but seven labelled rows
 * cost 326px there — 49% of an iPhone SE screen — which left the page tree
 * showing 6 of 22 pages and made the drawer useless for navigating. They now
 * live in a popup instead, which costs the drawer nothing.
 *
 * The buttons are **moved**, not cloned. Every listener wired up in
 * initPageController and every state update that reaches for them by id
 * (disabled, hidden, active classes) keeps working on the same nodes. A comment
 * placeholder marks each original position so the toolbar is restored exactly on
 * the way back to desktop.
 */
import i18next from '../i18n.js';

const MOBILE_QUERY = '(max-width: 768px)';

/**
 * Buttons moved into the ⋯ menu, in the order they should appear there.
 * `toolbar-new-page-btn` deliberately stays in the toolbar as the one primary
 * action; the destructive delete sits last.
 */
const MENU_BUTTON_IDS = [
  'history-btn',
  'presentation-btn',
  'print-page-btn',
  'copy-link-btn',
  'translate-page-btn',
  'toolbar-followup-btn',
  'markdown-toggle-btn',
  'delete-page-btn'
];

const LABEL_CLASS = 'mobile-action-label';

/** @type {Map<string, Comment>} Original toolbar position of each moved button. */
const placeholders = new Map();

let menu = null;
let trigger = null;
let isOpen = false;

/**
 * Works out which translation key labels a button in the menu.
 *
 * Buttons carry `data-i18n="[title]some.key"`; the same key is the visible
 * label. `data-mobile-label` overrides it where the tooltip text reads badly as
 * a label (the presentation button's tooltip names its keyboard shortcut).
 *
 * @param {string|null} mobileLabel - `data-mobile-label` value, if any.
 * @param {string|null} dataI18n - `data-i18n` value, if any.
 * @returns {string|null} Translation key, or null if none applies.
 */
export function resolveLabelKey(mobileLabel, dataI18n) {
  if (mobileLabel) return mobileLabel;
  if (!dataI18n) return null;
  const attrMatch = dataI18n.match(/^\[([^\]]+)\](.+)$/);
  if (attrMatch) return attrMatch[1] === 'title' ? attrMatch[2] : null;
  return dataI18n;
}

/**
 * Adds the menu label span, carrying its own `data-i18n` so translatePage()
 * keeps it current when the language changes.
 * @param {HTMLElement} btn
 * @returns {void}
 */
function addLabel(btn) {
  if (btn.querySelector(`.${LABEL_CLASS}`)) return;
  const key = resolveLabelKey(btn.getAttribute('data-mobile-label'), btn.getAttribute('data-i18n'));
  if (!key) return;
  const span = document.createElement('span');
  span.className = LABEL_CLASS;
  span.setAttribute('data-i18n', key);
  span.textContent = i18next.t(key);
  btn.appendChild(span);
}

/**
 * @param {HTMLElement} btn
 * @returns {void}
 */
function removeLabel(btn) {
  const span = btn.querySelector(`.${LABEL_CLASS}`);
  if (span) span.remove();
}

/**
 * Positions the popup under the trigger, clamped inside the viewport.
 * @returns {void}
 */
function position() {
  if (!menu || !trigger) return;
  const rect = trigger.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${rect.bottom + 4}px`;
  // Right-aligned to the trigger, then clamped so it cannot run off either edge.
  const width = menu.offsetWidth;
  const left = Math.min(
    Math.max(8, rect.right - width),
    Math.max(8, window.innerWidth - width - 8)
  );
  menu.style.left = `${left}px`;
}

/**
 * @param {MouseEvent} e
 * @returns {void}
 */
function onDocumentPointerDown(e) {
  if (!isOpen) return;
  if (menu.contains(e.target) || trigger.contains(e.target)) return;
  closeMenu();
}

/**
 * @param {KeyboardEvent} e
 * @returns {void}
 */
function onKeyDown(e) {
  if (e.key === 'Escape') closeMenu();
}

/**
 * @returns {void}
 */
export function closeMenu() {
  if (!isOpen) return;
  isOpen = false;
  menu.hidden = true;
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
  document.removeEventListener('mousedown', onDocumentPointerDown, true);
  document.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('resize', position);
  window.removeEventListener('scroll', closeMenu, true);
}

/**
 * @returns {void}
 */
function openMenu() {
  if (isOpen) return;
  isOpen = true;
  menu.hidden = false;
  trigger.setAttribute('aria-expanded', 'true');
  position();
  // Deferred so the click that opened the menu does not immediately dismiss it.
  setTimeout(() => {
    document.addEventListener('mousedown', onDocumentPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', closeMenu, true);
  }, 0);
}

/**
 * @returns {void}
 */
function moveToMenu() {
  if (!menu) return;
  for (const id of MENU_BUTTON_IDS) {
    const btn = document.getElementById(id);
    if (!btn || btn.parentElement === menu) continue;
    if (!placeholders.has(id) && btn.parentElement) {
      const marker = document.createComment(`page-action:${id}`);
      btn.parentElement.insertBefore(marker, btn);
      placeholders.set(id, marker);
    }
    menu.appendChild(btn);
    addLabel(btn);
  }
}

/**
 * @returns {void}
 */
function moveToToolbar() {
  closeMenu();
  for (const id of MENU_BUTTON_IDS) {
    const btn = document.getElementById(id);
    const marker = placeholders.get(id);
    if (!btn || !marker || !marker.parentNode) continue;
    removeLabel(btn);
    marker.parentNode.insertBefore(btn, marker);
    marker.remove();
    placeholders.delete(id);
  }
}

/**
 * Starts keeping the page actions on the right side of the breakpoint.
 * @returns {void}
 */
export function initMobilePageActions() {
  menu = document.getElementById('mobile-actions-menu');
  trigger = document.getElementById('mobile-actions-btn');
  if (!menu || !trigger) return;

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    isOpen ? closeMenu() : openMenu();
  });

  // Acting on any of the moved buttons should dismiss the menu; their own
  // listeners still run, since this only observes the bubbled click.
  menu.addEventListener('click', (e) => {
    if (e.target.closest('.btn-icon')) closeMenu();
  });

  const mql = window.matchMedia(MOBILE_QUERY);
  const apply = () => { (mql.matches ? moveToMenu : moveToToolbar)(); };

  apply();
  mql.addEventListener('change', apply);
}
