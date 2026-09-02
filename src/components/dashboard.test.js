/**
 * Unit tests for Task Board Dashboard — src/components/dashboard.js
 * Run with: node src/components/dashboard.test.js
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
    toHaveLength(n) {
      if (!actual || actual.length !== n) throw new Error(`Expected length ${n} but got ${actual ? actual.length : actual}`);
    },
    toBeTruthy() {
      if (!actual) throw new Error(`Expected truthy but got "${actual}"`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`Expected falsy but got "${actual}"`);
    },
    toContain(substr) {
      if (!actual || !actual.includes(substr)) throw new Error(`Expected "${actual}" to contain "${substr}"`);
    }
  };
}

function matchesSelector(el, sel) {
  if (!sel || !el) return false;
  const parts = sel.match(/(?:^[a-zA-Z0-9-]+|#[a-zA-Z0-9-_]+|\.[a-zA-Z0-9-_]+|\[[a-zA-Z0-9-_]+(?:="[^"]*"|='[^']*'|=[^\]]*)?\])/g);
  if (!parts) return false;
  for (const part of parts) {
    if (part.startsWith('#')) {
      if (el.id !== part.slice(1)) return false;
    } else if (part.startsWith('.')) {
      if (!el.classList.contains(part.slice(1))) return false;
    } else if (part.startsWith('[')) {
      const match = part.match(/\[([a-zA-Z0-9-_]+)(?:=([\"']?)(.*?)\2)?\]/);
      if (!match) return false;
      const attrName = match[1];
      const attrVal = match[3];
      if (attrName.startsWith('data-')) {
        const key = attrName.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        if (!(key in el.dataset)) return false;
        if (attrVal !== undefined && el.dataset[key] !== attrVal) return false;
      } else {
        const hasAttr = attrName in el.attributes || el[attrName] !== undefined;
        if (!hasAttr) return false;
        if (attrVal !== undefined && el.attributes[attrName] !== attrVal && el[attrName] !== attrVal) return false;
      }
    } else {
      if (el.tagName.toLowerCase() !== part.toLowerCase()) return false;
    }
  }
  return true;
}

function parseHtmlToMock(html, parent) {
  const root = { children: [] };
  const stack = [root];
  const tagRegex = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z0-9-]+)((?:\s+[^>"'=]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/)?>|([^<]+)/g;
  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    const [full, isClose, tagName, attrString, isSelfClose, text] = match;
    if (full.startsWith('<!--')) continue;
    if (text) {
      const top = stack[stack.length - 1];
      if (top && top !== root) {
        top.textContent = (top.textContent || '') + text;
      }
      continue;
    }
    if (isClose) {
      if (stack.length > 1 && stack[stack.length - 1].tagName.toLowerCase() === tagName.toLowerCase()) {
        stack.pop();
      }
    } else {
      const el = new MockElement(tagName);
      el.parentNode = stack[stack.length - 1] === root ? parent : stack[stack.length - 1];
      if (attrString) {
        const attrRegex = /([a-zA-Z0-9-_:]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
        let m;
        while ((m = attrRegex.exec(attrString)) !== null) {
          const name = m[1];
          const val = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : true));
          el.attributes[name] = val;
          if (name === 'class') {
            el.className = val;
            val.split(/\s+/).filter(Boolean).forEach(c => el.classList.add(c));
          }
          if (name === 'id') el.id = val;
          if (name.startsWith('data-')) {
            const dataKey = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            el.dataset[dataKey] = val;
          }
          if (name === 'value') el.value = val;
          if (name === 'selected') el.selected = true;
        }
      }
      stack[stack.length - 1].children.push(el);
      const isVoid = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(tagName);
      if (!isSelfClose && !isVoid) {
        stack.push(el);
      }
    }
  }
  return root.children;
}

class MockElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.id = '';
    this.className = '';
    this.textContent = '';
    this._innerHTML = '';
    this.style = {};
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.parentNode = null;
    this.value = '';
    this.selected = false;

    const classSet = new Set();
    this.classList = {
      add: (...classes) => {
        classes.forEach(c => classSet.add(c));
        this.className = Array.from(classSet).join(' ');
      },
      remove: (...classes) => {
        classes.forEach(c => classSet.delete(c));
        this.className = Array.from(classSet).join(' ');
      },
      contains: (c) => classSet.has(c)
    };
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(val) {
    this._innerHTML = val;
    this.children = parseHtmlToMock(val, this);
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

  click() {
    this.dispatchEvent({ type: 'click', target: this });
  }

  querySelector(selector) {
    const results = this.querySelectorAll(selector);
    return results.length > 0 ? results[0] : null;
  }

  querySelectorAll(selector) {
    const matched = [];
    function traverse(node) {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) {
          matched.push(child);
        }
        traverse(child);
      }
    }
    traverse(this);
    return matched;
  }
}

// Setup global mock document
const bodyEl = new MockElement('body');

global.document = {
  createElement: (tag) => new MockElement(tag),
  body: bodyEl,
  documentElement: { style: {} },
  cookie: '',
  addEventListener: () => {},
  removeEventListener: () => {},
  getElementById: (id) => {
    function find(node) {
      if (node.id === id) return node;
      for (const child of node.children) {
        const res = find(child);
        if (res) return res;
      }
      return null;
    }
    return find(bodyEl);
  },
  querySelector: (sel) => bodyEl.querySelector(sel),
  querySelectorAll: (sel) => bodyEl.querySelectorAll(sel)
};

// Import modules
const { renderDashboard, _resetDashboardStateForTesting } = await import('./dashboard.js');
const { _setCurrentUserForTesting } = await import('../firebase/auth.js');

console.log('\n📋 renderDashboard() Unit Tests');

const samplePages = [
  {
    id: 'page-1',
    title: 'Project Alpha',
    content: `
- [ ] Implement login @Alice
- [x] Setup repository @Alice
- [ ] Database schema @Bob
- [ ] General documentation
`
  },
  {
    id: 'page-2',
    title: 'Project Beta',
    content: `
- [ ] Write integration tests @Alice
- [x] Architecture review @Bob
`
  }
];

test('defaults to filtering open tasks containing @<displayName> and excludes completed (done: true) tasks', () => {
  _resetDashboardStateForTesting();
  bodyEl.children = [];
  _setCurrentUserForTesting({ displayName: 'Alice', email: 'alice@insel.ch' });

  renderDashboard(samplePages);

  const overlay = document.getElementById('dashboard-overlay');
  expect(overlay).toBeTruthy();

  const taskCards = overlay.querySelectorAll('.task-card');
  expect(taskCards).toHaveLength(2);

  const taskTexts = taskCards.map(card => card.querySelector('.task-text').textContent.trim());
  expect(taskTexts.includes('Implement login @Alice')).toBe(true);
  expect(taskTexts.includes('Write integration tests @Alice')).toBe(true);

  // Completed tasks excluded
  expect(taskTexts.includes('Setup repository @Alice')).toBe(false);

  // Other users or unassigned tasks excluded
  expect(taskTexts.includes('Database schema @Bob')).toBe(false);
  expect(taskTexts.includes('General documentation')).toBe(false);

  // None of the rendered cards should have 'completed' class
  taskCards.forEach(card => {
    expect(card.classList.contains('completed')).toBe(false);
  });
});

test('properly sets active CSS class on My Tasks button and selected attribute on Open option on initial load', () => {
  _resetDashboardStateForTesting();
  bodyEl.children = [];
  _setCurrentUserForTesting({ displayName: 'Alice', email: 'alice@insel.ch' });

  renderDashboard(samplePages);

  const overlay = document.getElementById('dashboard-overlay');
  const myBtn = overlay.querySelector('.filter-btn[data-filter="my"]');
  const allBtn = overlay.querySelector('.filter-btn[data-filter="all"]');
  const statusSelect = overlay.querySelector('#status-filter-select');

  expect(myBtn).toBeTruthy();
  expect(myBtn.classList.contains('active')).toBe(true);

  expect(allBtn).toBeTruthy();
  expect(allBtn.classList.contains('active')).toBe(false);

  expect(statusSelect).toBeTruthy();
  const openOption = statusSelect.children.find(opt => opt.value === 'open');
  const allOption = statusSelect.children.find(opt => opt.value === 'all');
  const doneOption = statusSelect.children.find(opt => opt.value === 'done');

  expect(openOption.selected).toBe(true);
  expect(allOption.selected).toBe(false);
  expect(doneOption.selected).toBe(false);
});

test('gracefully handles filtering when getCurrentUser() has no displayName', () => {
  _resetDashboardStateForTesting();
  bodyEl.children = [];
  // User with no displayName and no email
  _setCurrentUserForTesting({ displayName: null });

  renderDashboard(samplePages);

  const overlay = document.getElementById('dashboard-overlay');
  const taskCards = overlay.querySelectorAll('.task-card');
  // No tasks should be shown for 'my' filter when displayName is missing
  expect(taskCards).toHaveLength(0);

  const emptyHint = overlay.querySelector('.empty-hint');
  expect(emptyHint).toBeTruthy();
});

test('gracefully handles filtering when user state is still loading (getCurrentUser() is null)', () => {
  _resetDashboardStateForTesting();
  bodyEl.children = [];
  _setCurrentUserForTesting(null);

  renderDashboard(samplePages);

  const overlay = document.getElementById('dashboard-overlay');
  const taskCards = overlay.querySelectorAll('.task-card');
  expect(taskCards).toHaveLength(0);

  const emptyHint = overlay.querySelector('.empty-hint');
  expect(emptyHint).toBeTruthy();
});

test('correctly falls back to formatDefaultName when displayName is missing but email is provided', () => {
  _resetDashboardStateForTesting();
  bodyEl.children = [];
  _setCurrentUserForTesting({ displayName: null, email: 'alice.smith@insel.ch' });

  const pagesWithEmailFormattedName = [
    {
      id: 'page-3',
      title: 'Project Gamma',
      content: `- [ ] Follow up on report @Alice Smith\n- [ ] Unrelated @Bob`
    }
  ];

  renderDashboard(pagesWithEmailFormattedName);

  const overlay = document.getElementById('dashboard-overlay');
  const taskCards = overlay.querySelectorAll('.task-card');
  expect(taskCards).toHaveLength(1);

  const text = taskCards[0].querySelector('.task-text').textContent.trim();
  expect(text).toContain('Follow up on report @Alice Smith');
});

test('switches to showing all open tasks when clicking the All filter button', () => {
  _resetDashboardStateForTesting();
  bodyEl.children = [];
  _setCurrentUserForTesting({ displayName: 'Alice', email: 'alice@insel.ch' });

  renderDashboard(samplePages);

  const overlay = document.getElementById('dashboard-overlay');
  const allBtn = overlay.querySelector('.filter-btn[data-filter="all"]');
  allBtn.click();

  const updatedOverlay = document.getElementById('dashboard-overlay');
  const taskCards = updatedOverlay.querySelectorAll('.task-card');
  // All open tasks from both pages:
  // 'Implement login @Alice', 'Database schema @Bob', 'General documentation', 'Write integration tests @Alice'
  expect(taskCards).toHaveLength(4);

  const updatedAllBtn = updatedOverlay.querySelector('.filter-btn[data-filter="all"]');
  const updatedMyBtn = updatedOverlay.querySelector('.filter-btn[data-filter="my"]');
  expect(updatedAllBtn.classList.contains('active')).toBe(true);
  expect(updatedMyBtn.classList.contains('active')).toBe(false);
});

test('switches to showing completed tasks when status filter changes to done', () => {
  _resetDashboardStateForTesting();
  bodyEl.children = [];
  _setCurrentUserForTesting({ displayName: 'Alice', email: 'alice@insel.ch' });

  renderDashboard(samplePages);

  const overlay = document.getElementById('dashboard-overlay');
  const statusSelect = overlay.querySelector('#status-filter-select');

  // Trigger change event to 'done'
  statusSelect.dispatchEvent({ type: 'change', target: { value: 'done' } });

  const updatedOverlay = document.getElementById('dashboard-overlay');
  const taskCards = updatedOverlay.querySelectorAll('.task-card');
  // Only completed tasks for Alice: 'Setup repository @Alice'
  expect(taskCards).toHaveLength(1);

  const text = taskCards[0].querySelector('.task-text').textContent.trim();
  expect(text).toContain('Setup repository @Alice');
  expect(taskCards[0].classList.contains('completed')).toBe(true);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
