/**
 * Unit tests for Markdown warning modal logic — src/components/modal.js
 * Run with: node src/components/modal.test.js
 */

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✕ ${name}`);
    console.error(`    ${err.message}`);
  }
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
    toBeTruthy() {
      if (!actual) throw new Error(`Expected truthy but got "${actual}"`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`Expected falsy but got "${actual}"`);
    }
  };
}

// Minimal DOM Mocking for Node.js execution
class MockElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.className = '';
    this.textContent = '';
    this.innerHTML = '';
    this.style = {};
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.parentNode = null;
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }
  addEventListener(event, fn) {
    this.listeners[event] = this.listeners[event] || [];
    this.listeners[event].push(fn);
  }
  dispatchEvent(event) {
    const fns = this.listeners[event.type] || [];
    fns.forEach(fn => fn(event));
  }
  focus() {}
  click() {
    this.dispatchEvent({ type: 'click', target: this });
  }
}

global.document = {
  createElement: (tag) => new MockElement(tag),
  body: new MockElement('body'),
  documentElement: { style: {} },
  cookie: '',
  addEventListener: () => {},
  removeEventListener: () => {}
};

const { markdownWarningModal } = await import('./modal.js');

console.log('\n🛡️ markdownWarningModal()');

test('creates modal with granular element descriptions and action buttons', async () => {
  const modalPromise = markdownWarningModal({
    tables: 1,
    comments: 2,
    mentions: 3
  });

  const overlay = global.document.body.children[0];
  expect(overlay).toBeTruthy();
  expect(overlay.className).toBe('modal-overlay');

  const modalBox = overlay.children[0];
  expect(modalBox.className).toBe('modal-box markdown-warning-modal-box');

  const list = modalBox.children.find(c => c.className === 'markdown-warning-list');
  expect(list).toBeTruthy();
  expect(list.children.length).toBe(3);

  const actions = modalBox.children.find(c => c.className === 'modal-actions');
  expect(actions).toBeTruthy();
  expect(actions.children.length).toBe(3);

  const cancelBtn = actions.children.find(c => c.id === 'md-warning-cancel');
  const readOnlyBtn = actions.children.find(c => c.id === 'md-warning-readonly');
  const editAnywayBtn = actions.children.find(c => c.id === 'md-warning-edit');

  expect(cancelBtn).toBeTruthy();
  expect(readOnlyBtn).toBeTruthy();
  expect(editAnywayBtn).toBeTruthy();

  readOnlyBtn.click();
  const choice = await modalPromise;
  expect(choice).toBe('readonly');
});

test('resolves with "edit" when edit anyway button is clicked', async () => {
  const modalPromise = markdownWarningModal({ tables: 1 });
  const overlay = global.document.body.children[0];
  const modalBox = overlay.children[0];
  const actions = modalBox.children.find(c => c.className === 'modal-actions');
  const editAnywayBtn = actions.children.find(c => c.id === 'md-warning-edit');

  editAnywayBtn.click();
  const choice = await modalPromise;
  expect(choice).toBe('edit');
});

test('resolves with "cancel" when cancel button is clicked', async () => {
  const modalPromise = markdownWarningModal({ comments: 1 });
  const overlay = global.document.body.children[0];
  const modalBox = overlay.children[0];
  const actions = modalBox.children.find(c => c.className === 'modal-actions');
  const cancelBtn = actions.children.find(c => c.id === 'md-warning-cancel');

  cancelBtn.click();
  const choice = await modalPromise;
  expect(choice).toBe('cancel');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
