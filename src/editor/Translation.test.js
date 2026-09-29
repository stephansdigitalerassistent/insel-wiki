/**
 * Unit tests for AI Page Translation — src/editor/Translation.test.js
 * Run with: node src/editor/Translation.test.js
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let passed = 0;
let failed = 0;
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) throw new Error(`Expected "${expected}" but got "${actual}"`);
    },
    toEqual(expected) {
      const a = JSON.stringify(actual);
      const e = JSON.stringify(expected);
      if (a !== e) throw new Error(`Expected ${e} but got ${a}`);
    },
    toHaveLength(n) {
      if (actual.length !== n) throw new Error(`Expected length ${n} but got ${actual.length}`);
    },
    toBeTruthy() {
      if (!actual) throw new Error(`Expected truthy but got "${actual}"`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`Expected falsy but got "${actual}"`);
    }
  };
}

// ──────────────────────────────────────────────
// 🌐 Locale Completeness Tests
// ──────────────────────────────────────────────
console.log('\n🌐 AI Translation Locale Completeness');

test('all locales contain required translation keys', () => {
  const locales = ['de', 'en', 'fr', 'it'];
  const requiredEditorKeys = [
    'translatePage',
    'translateModalTitle',
    'translateModalHint',
    'targetLanguage',
    'translateButton',
    'translating',
    'translationBanner',
    'showOriginal',
    'translationStatus',
    'translateError'
  ];

  for (const lang of locales) {
    const filePath = resolve(process.cwd(), `src/locales/${lang}.json`);
    const content = JSON.parse(readFileSync(filePath, 'utf-8'));

    for (const key of requiredEditorKeys) {
      if (!content.editor || !content.editor[key]) {
        throw new Error(`Missing editor.${key} in src/locales/${lang}.json`);
      }
    }

    if (!content.languages || !content.languages.de || !content.languages.en || !content.languages.fr || !content.languages.it) {
      throw new Error(`Missing languages block in src/locales/${lang}.json`);
    }
  }
});

// ──────────────────────────────────────────────
// 🔒 Non-Editable Translation Mode Invariants
// ──────────────────────────────────────────────
console.log('\n🔒 Non-Editable Translation Mode Invariants');

// Mock DOM environment helper
function createMockElement(initial = {}) {
  const classSet = new Set(initial.classes || []);
  const element = {
    id: initial.id || '',
    style: initial.style || {},
    value: initial.value !== undefined ? initial.value : '',
    readOnly: !!initial.readOnly,
    innerHTML: initial.innerHTML || '',
    textContent: initial.textContent || '',
    classList: {
      contains: (c) => classSet.has(c),
      add: (...cs) => cs.forEach(c => classSet.add(c)),
      remove: (...cs) => cs.forEach(c => classSet.delete(c)),
      toggle: (c, force) => {
        if (force === undefined) {
          if (classSet.has(c)) classSet.delete(c);
          else classSet.add(c);
        } else if (force) {
          classSet.add(c);
        } else {
          classSet.delete(c);
        }
      }
    },
    addEventListener: () => {}
  };
  return element;
}

function setupMockEnv() {
  const mockElements = {
    'editor-container': createMockElement(),
    'editor': createMockElement({ style: { display: 'block' } }),
    'page-title': createMockElement({ value: 'Original Title', readOnly: false }),
    'save-status': createMockElement({ textContent: 'Gespeichert' }),
    'breadcrumb': createMockElement(),
    'collab-cursors': createMockElement(),
    'empty-state': createMockElement({ classes: ['hidden'] }),
    'last-edited-badge': createMockElement({ classes: ['hidden'] }),
    'editor-loading-overlay': createMockElement({ classes: ['hidden'] }),
    'history-btn': createMockElement(),
    'print-page-btn': createMockElement(),
    'presentation-btn': createMockElement(),
    'add-child-btn': createMockElement(),
    'delete-page-btn': createMockElement(),
    'toolbar-new-page-btn': createMockElement(),
    'copy-link-btn': createMockElement(),
    'markdown-editor': createMockElement({ classes: ['hidden'], value: '' }),
    'markdown-toggle-btn': createMockElement({ style: { display: 'inline-flex' } }),
    'translate-page-btn': createMockElement(),
    'translation-banner': createMockElement({ classes: ['hidden'], style: { display: 'none' } }),
    'translation-banner-text': createMockElement(),
    'exit-translation-btn': createMockElement(),
    'translation-preview': createMockElement({ classes: ['hidden'], style: { display: 'none' } }),
    'new-page-btn': createMockElement(),
    'close-history': createMockElement(),
    'empty-new-page': createMockElement()
  };

  global.document = {
    getElementById: (id) => mockElements[id] || null,
    querySelectorAll: () => [],
    cookie: ''
  };

  global.window = {
    addEventListener: () => {},
    location: { hash: '', origin: 'http://localhost', pathname: '/', search: '', href: 'http://localhost/' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  };

  return mockElements;
}

test('enterTranslationMode switches to non-editable preview and exitTranslationMode restores editor', async () => {
  const mockElements = setupMockEnv();
  const { initTranslationView, enterTranslationMode, exitTranslationMode, getIsTranslationMode } = await import('../controllers/translation-view.js');

  const currentPageData = { title: 'Original Title' };
  let isMarkdownMode = false;
  const formatToolbar = createMockElement({ style: { display: 'flex' } });

  const sanitizeCalls = [];
  const recordingSanitizer = (dirty) => {
    sanitizeCalls.push(dirty);
    return dirty;
  };

  initTranslationView({
    editorEl: mockElements['editor'],
    markdownEditor: mockElements['markdown-editor'],
    translationPreviewEl: mockElements['translation-preview'],
    pageTitleInput: mockElements['page-title'],
    markdownToggleBtn: mockElements['markdown-toggle-btn'],
    translationBanner: mockElements['translation-banner'],
    translationBannerText: mockElements['translation-banner-text'],
    translatePageBtn: mockElements['translate-page-btn'],
    saveStatus: mockElements['save-status'],
    canEdit: () => true,
    recomputeSaveStatus: () => {},
    getCurrentPageData: () => currentPageData,
    getIsMarkdownMode: () => isMarkdownMode,
    getFormatToolbar: () => formatToolbar,
    sanitizeHtml: recordingSanitizer
  });

  expect(getIsTranslationMode()).toBe(false);

  // Enter translation mode
  enterTranslationMode('Translated Page Title', '# Translated Header\n\n- [ ] Todo item\n- [x] Done item\n\n@Stephan Heuscher', 'en');

  // Verify sanitizer was invoked
  expect(sanitizeCalls.length).toBe(1);

  // Verify non-editable translation mode state
  expect(getIsTranslationMode()).toBe(true);
  const titleEl = document.getElementById('page-title');
  expect(titleEl.value).toBe('Translated Page Title');
  expect(titleEl.readOnly).toBe(true);

  const banner = document.getElementById('translation-banner');
  expect(banner.classList.contains('hidden')).toBe(false);

  const preview = document.getElementById('translation-preview');
  expect(preview.classList.contains('hidden')).toBe(false);
  expect(preview.innerHTML.includes('<ul data-type="taskList">')).toBe(true);
  expect(preview.innerHTML.includes('<li data-type="taskItem" data-checked="false"><input type="checkbox" disabled> Todo item</li>')).toBe(true);
  expect(preview.innerHTML.includes('<li data-type="taskItem" data-checked="true"><input type="checkbox" disabled checked> Done item</li>')).toBe(true);
  expect(preview.innerHTML.includes('<span class="mention" data-type="mention" data-id="0koM5JrpINSg5E4KC0wgI1jEOkM2" data-label="Stephan Heuscher">@Stephan Heuscher</span>')).toBe(true);

  // Exit translation mode
  exitTranslationMode();

  expect(getIsTranslationMode()).toBe(false);
  expect(banner.classList.contains('hidden')).toBe(true);
  expect(preview.classList.contains('hidden')).toBe(true);
  expect(titleEl.readOnly).toBe(false);
  expect(titleEl.value).toBe('Original Title');
});

test('sanitizeHtml is invoked with generated and transformed HTML when entering translation mode', async () => {
  const mockElements = setupMockEnv();
  const { initTranslationView, enterTranslationMode, exitTranslationMode } = await import('../controllers/translation-view.js');

  const sanitizeCalls = [];
  const recordingSanitizer = (dirty) => {
    sanitizeCalls.push(dirty);
    return `<sanitized>${dirty}</sanitized>`;
  };

  initTranslationView({
    editorEl: mockElements['editor'],
    markdownEditor: mockElements['markdown-editor'],
    translationPreviewEl: mockElements['translation-preview'],
    pageTitleInput: mockElements['page-title'],
    markdownToggleBtn: mockElements['markdown-toggle-btn'],
    translationBanner: mockElements['translation-banner'],
    translationBannerText: mockElements['translation-banner-text'],
    translatePageBtn: mockElements['translate-page-btn'],
    saveStatus: mockElements['save-status'],
    canEdit: () => true,
    recomputeSaveStatus: () => {},
    getCurrentPageData: () => ({ title: 'Page' }),
    getIsMarkdownMode: () => false,
    getFormatToolbar: () => mockElements['editor'],
    sanitizeHtml: recordingSanitizer
  });

  enterTranslationMode('Translated Title', '# Heading\n\n- [ ] Task 1\n\n@Stephan Heuscher', 'en');

  expect(sanitizeCalls.length).toBe(1);
  const passedHtml = sanitizeCalls[0];
  expect(passedHtml.includes('Heading')).toBe(true);
  expect(passedHtml.includes('<ul data-type="taskList">')).toBe(true);
  expect(passedHtml.includes('data-type="taskItem"')).toBe(true);
  expect(passedHtml.includes('class="mention"')).toBe(true);
  expect(mockElements['translation-preview'].innerHTML.includes('<sanitized>')).toBe(true);

  exitTranslationMode();
});

test('enterTranslationMode fails closed and renders escaped text without raw script or onerror when no sanitizer is available', async () => {
  const mockElements = setupMockEnv();
  const { initTranslationView, enterTranslationMode, exitTranslationMode } = await import('../controllers/translation-view.js');

  initTranslationView({
    editorEl: mockElements['editor'],
    markdownEditor: mockElements['markdown-editor'],
    translationPreviewEl: mockElements['translation-preview'],
    pageTitleInput: mockElements['page-title'],
    markdownToggleBtn: mockElements['markdown-toggle-btn'],
    translationBanner: mockElements['translation-banner'],
    translationBannerText: mockElements['translation-banner-text'],
    translatePageBtn: mockElements['translate-page-btn'],
    saveStatus: mockElements['save-status'],
    canEdit: () => true,
    recomputeSaveStatus: () => {},
    getCurrentPageData: () => ({ title: 'Original' }),
    getIsMarkdownMode: () => false,
    getFormatToolbar: () => mockElements['editor'],
    sanitizeHtml: null
  });

  const maliciousInput = '# Hi\n\n<img src=x onerror="alert(1)">\n\n<script>alert(2)</script>';
  enterTranslationMode('Security Test', maliciousInput, 'en');

  const preview = mockElements['translation-preview'];
  expect(preview.classList.contains('hidden')).toBe(false);

  // Assert fail-closed behavior: raw unescaped script and onerror tags are absent
  expect(preview.innerHTML.includes('<script')).toBe(false);
  expect(preview.innerHTML.includes('<img')).toBe(false);
  expect(preview.innerHTML.includes('onerror="alert(1)"')).toBe(false);
  expect(preview.innerHTML.includes('<')).toBe(false);
  expect(preview.innerHTML.includes('>')).toBe(false);

  // Assert safe escaped representation is present
  expect(preview.innerHTML.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')).toBe(true);
  expect(preview.innerHTML.includes('&lt;script&gt;alert(2)&lt;/script&gt;')).toBe(true);

  exitTranslationMode();
});

// ──────────────────────────────────────────────
// Run all tests
// ──────────────────────────────────────────────
for (const t of tests) {
  try {
    await t.fn();
    console.log(`  ✓ ${t.name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${t.name}`);
    console.error(err);
    failed++;
  }
}

console.log('\n────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('✅ All translation tests passed!');
}
