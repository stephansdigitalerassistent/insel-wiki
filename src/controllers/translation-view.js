/**
 * @module controllers/translation-view
 * @description
 * View logic for AI translation preview mode.
 * Manages entering and exiting non-editable translation preview mode,
 * rendering translated markdown, and updating UI states.
 */

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import i18next from '../i18n.js';

let isTranslationMode = false;
let originalPageTitle = '';
let viewRefs = {};
let sanitizeHtml = null;

/**
 * Escapes HTML special characters in plain text to safely prevent XSS.
 *
 * @param {string} str - Raw string
 * @returns {string} Escaped HTML string
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Resolves the HTML sanitizer once at initialization.
 * Prioritizes caller-injected sanitizer, then DOMPurify function, then DOMPurify(window),
 * otherwise defaults to null.
 *
 * @param {Function|null|undefined} customSanitizer - Injected sanitizer option
 * @returns {Function|null}
 */
function resolveSanitizer(customSanitizer) {
  if (typeof customSanitizer === 'function') {
    return customSanitizer;
  }
  if (customSanitizer === null) {
    return null;
  }
  if (DOMPurify && typeof DOMPurify.sanitize === 'function') {
    return (html) => DOMPurify.sanitize(html);
  }
  if (typeof DOMPurify === 'function' && typeof window !== 'undefined' && window && window.document) {
    try {
      const purifier = DOMPurify(window);
      if (purifier && typeof purifier.sanitize === 'function') {
        return (html) => purifier.sanitize(html);
      }
    } catch (_) {}
  }
  return null;
}

/**
 * Initializes translation view references and callbacks.
 *
 * @param {Object} refs - DOM elements, state getters, and options
 * @param {Function} [refs.sanitizeHtml] - Injected sanitizer function
 */
export function initTranslationView(refs = {}) {
  viewRefs = refs;
  sanitizeHtml = resolveSanitizer(refs.sanitizeHtml);
}

function getFormatToolbar() {
  if (typeof viewRefs.getFormatToolbar === 'function') {
    return viewRefs.getFormatToolbar();
  }
  if (typeof viewRefs.formatToolbar === 'function') {
    return viewRefs.formatToolbar();
  }
  return viewRefs.formatToolbar;
}

function getCanEdit() {
  if (typeof viewRefs.canEdit === 'function') {
    return viewRefs.canEdit();
  }
  return true;
}

function getCurrentPageData() {
  if (typeof viewRefs.getCurrentPageData === 'function') {
    return viewRefs.getCurrentPageData();
  }
  if (typeof viewRefs.currentPageData === 'function') {
    return viewRefs.currentPageData();
  }
  return viewRefs.currentPageData;
}

function getIsMarkdownMode() {
  if (typeof viewRefs.getIsMarkdownMode === 'function') {
    return viewRefs.getIsMarkdownMode();
  }
  if (typeof viewRefs.isMarkdownMode === 'function') {
    return viewRefs.isMarkdownMode();
  }
  return !!viewRefs.isMarkdownMode;
}

/**
 * Activates non-editable translation mode for the current page.
 *
 * @param {string} translatedTitle - Translated title to display.
 * @param {string} translatedContentMarkdown - Translated markdown content.
 * @param {string} targetLang - The target language code.
 * @returns {void}
 */
export function enterTranslationMode(translatedTitle, translatedContentMarkdown, targetLang) {
  isTranslationMode = true;
  originalPageTitle = viewRefs.pageTitleInput ? viewRefs.pageTitleInput.value : '';

  // 1. Hide real editor and markdown editor, show translation preview
  if (viewRefs.editorEl) viewRefs.editorEl.style.display = 'none';
  if (viewRefs.markdownEditor) viewRefs.markdownEditor.classList.add('hidden');
  if (viewRefs.translationPreviewEl) {
    viewRefs.translationPreviewEl.classList.remove('hidden');
    viewRefs.translationPreviewEl.style.display = 'block';

    if (typeof sanitizeHtml === 'function') {
      try {
        let html = marked.parse(translatedContentMarkdown || '');
        if (typeof html === 'string') {
          html = html.replace(/<ul>\s*(<li[^>]*><input[^>]*type="checkbox"[^>]*>[\s\S]*?)<\/ul>/gi, '<ul data-type="taskList">$1</ul>');
          html = html.replace(/<li><input([^>]*)type="checkbox"([^>]*)>(.*?)<\/li>/gi, (match, p1, p2, text) => {
            const isChecked = p1.includes('checked') || p2.includes('checked');
            return `<li data-type="taskItem" data-checked="${isChecked}"><input type="checkbox" disabled${isChecked ? ' checked' : ''}>${text}</li>`;
          });
          html = html.replace(/@((?:Stephan Heuscher|Organisationsteam|[A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+)*)(?:\s+\(Ich\))?)(?!\.[a-z]{2,})/g, (match, rawLabel) => {
            const cleanLabel = rawLabel.replace(/\s*\(Ich\)$/, '');
            const id = cleanLabel.includes('Stephan Heuscher') ? '0koM5JrpINSg5E4KC0wgI1jEOkM2' : cleanLabel;
            return `<span class="mention" data-type="mention" data-id="${id}" data-label="${cleanLabel}">@${cleanLabel}</span>`;
          });
        }
        const cleanHtml = sanitizeHtml(html);
        viewRefs.translationPreviewEl.innerHTML = typeof cleanHtml === 'string' ? cleanHtml : '';
      } catch (err) {
        console.error('[TranslationView] Sanitizer failed:', err);
        viewRefs.translationPreviewEl.innerHTML = escapeHtml(translatedContentMarkdown || '');
      }
    } else {
      console.error('[TranslationView] No working HTML sanitizer available. Translation preview rendering safely as escaped plain text.');
      viewRefs.translationPreviewEl.innerHTML = escapeHtml(translatedContentMarkdown || '');
    }
  }

  // 2. Set title to translated title and lock it read-only
  if (viewRefs.pageTitleInput) {
    viewRefs.pageTitleInput.value = translatedTitle;
    viewRefs.pageTitleInput.readOnly = true;
  }

  // 3. Hide formatting toolbar & markdown toggle
  const formatToolbar = getFormatToolbar();
  if (formatToolbar) formatToolbar.style.display = 'none';
  if (viewRefs.markdownToggleBtn) viewRefs.markdownToggleBtn.style.display = 'none';

  // 4. Update banner
  const langNameMap = {
    de: i18next.t('languages.de', { defaultValue: 'Deutsch' }),
    en: i18next.t('languages.en', { defaultValue: 'Englisch' }),
    fr: i18next.t('languages.fr', { defaultValue: 'Französisch' }),
    it: i18next.t('languages.it', { defaultValue: 'Italienisch' }),
  };
  const langDisplay = langNameMap[targetLang] || (targetLang ? targetLang.toUpperCase() : 'EN');

  if (viewRefs.translationBannerText) {
    viewRefs.translationBannerText.innerHTML = i18next.t('editor.translationBanner', {
      language: langDisplay,
      defaultValue: `<strong>KI-Übersetzung (${langDisplay})</strong> — Nicht-bearbeitbare Ansicht`
    });
  }
  if (viewRefs.translationBanner) {
    viewRefs.translationBanner.classList.remove('hidden');
    viewRefs.translationBanner.style.display = 'flex';
  }

  // 5. Update save status and button active state
  if (viewRefs.translatePageBtn) viewRefs.translatePageBtn.classList.add('active');
  if (viewRefs.saveStatus) {
    viewRefs.saveStatus.classList.remove('saving', 'error', 'offline');
    viewRefs.saveStatus.textContent = i18next.t('editor.translationStatus', { defaultValue: 'KI-Übersetzung (Nur Leseansicht)' });
  }
}

/**
 * Exits translation mode and restores the original collaborative editor.
 *
 * @returns {void}
 */
export function exitTranslationMode() {
  if (!isTranslationMode) return;

  isTranslationMode = false;

  // 1. Hide translation preview, show real editor
  if (viewRefs.translationPreviewEl) {
    viewRefs.translationPreviewEl.classList.add('hidden');
    viewRefs.translationPreviewEl.style.display = 'none';
    viewRefs.translationPreviewEl.innerHTML = '';
  }
  if (viewRefs.translationBanner) {
    viewRefs.translationBanner.classList.add('hidden');
    viewRefs.translationBanner.style.display = 'none';
  }

  const isMarkdownMode = getIsMarkdownMode();
  if (isMarkdownMode && viewRefs.markdownEditor) {
    viewRefs.markdownEditor.classList.remove('hidden');
    if (viewRefs.editorEl) viewRefs.editorEl.style.display = 'none';
  } else {
    if (viewRefs.editorEl) viewRefs.editorEl.style.display = 'block';
  }

  // 2. Restore title and editable state
  if (viewRefs.pageTitleInput) {
    const pageData = getCurrentPageData();
    viewRefs.pageTitleInput.value = pageData?.title || originalPageTitle;
    viewRefs.pageTitleInput.readOnly = !getCanEdit();
  }

  // 3. Restore toolbars
  const formatToolbar = getFormatToolbar();
  if (formatToolbar) {
    formatToolbar.style.display = (getCanEdit() && !isMarkdownMode) ? 'flex' : 'none';
  }
  if (viewRefs.markdownToggleBtn) {
    viewRefs.markdownToggleBtn.style.display = getCanEdit() ? 'inline-flex' : 'none';
  }

  // 4. Update button and save status
  if (viewRefs.translatePageBtn) viewRefs.translatePageBtn.classList.remove('active');
  if (typeof viewRefs.recomputeSaveStatus === 'function') {
    viewRefs.recomputeSaveStatus();
  }
}

/**
 * Returns whether translation mode is currently active.
 *
 * @returns {boolean}
 */
export function getIsTranslationMode() {
  return isTranslationMode;
}
