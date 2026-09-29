/**
 * Unit tests for Users View (Read-only dynamic roster) — src/editor/UsersView.test.js
 * Run with: node src/editor/UsersView.test.js
 */

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

console.log('\n👥 Users View (Read-Only & Live Sync) Unit Coverage');

// Setup mock DOM environment
function createMockElement(tag = 'div') {
  const classes = new Set();
  const children = [];
  const listeners = {};
  return {
    tagName: tag.toUpperCase(),
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    style: {},
    innerHTML: '',
    value: '',
    readOnly: false,
    appendChild: (child) => children.push(child),
    addEventListener: (event, handler) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
    },
    querySelector: () => null,
    querySelectorAll: () => []
  };
}

test('enterUsersView locks page to read-only and displays live roster container', async () => {
  const editorEl = createMockElement('div');
  const markdownEditor = createMockElement('textarea');
  const translationPreviewEl = createMockElement('div');
  const translationBanner = createMockElement('div');
  const usersPreviewEl = createMockElement('div');
  const pageTitleInput = createMockElement('input');
  const markdownToggleBtn = createMockElement('button');
  const translatePageBtn = createMockElement('button');
  const saveStatus = createMockElement('span');
  const formatToolbar = createMockElement('div');

  const { initUsersView, enterUsersView, exitUsersView, getIsUsersViewActive } = await import('../controllers/users-view.js');

  initUsersView({
    editorEl,
    markdownEditor,
    translationPreviewEl,
    translationBanner,
    usersPreviewEl,
    pageTitleInput,
    markdownToggleBtn,
    translatePageBtn,
    saveStatus,
    getFormatToolbar: () => formatToolbar,
    recomputeSaveStatus: () => {}
  });

  expect(getIsUsersViewActive()).toBe(false);

  enterUsersView({ title: '👥 Teilnehmende' });

  expect(getIsUsersViewActive()).toBe(true);
  expect(pageTitleInput.readOnly).toBe(true);
  expect(pageTitleInput.value).toBe('👥 Teilnehmende');
  expect(editorEl.style.display).toBe('none');
  expect(markdownToggleBtn.style.display).toBe('none');
  expect(translatePageBtn.style.display).toBe('none');
  expect(formatToolbar.style.display).toBe('none');
  expect(usersPreviewEl.classList.contains('hidden')).toBe(false);

  exitUsersView();

  expect(getIsUsersViewActive()).toBe(false);
  expect(usersPreviewEl.classList.contains('hidden')).toBe(true);
  expect(editorEl.style.display).toBe('block');
});

// ──────────────────────────────────────────────
// Run all tests sequentially
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

console.log(`\n────────────────────────────────────────`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`❌ Users view tests failed!`);
  process.exit(1);
} else {
  console.log(`✅ All users view tests passed!`);
}
