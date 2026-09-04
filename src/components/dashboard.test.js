/**
 * Unit tests for Task Board Dashboard — src/components/dashboard.test.js
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

// ──────────────────────────────────────────────
// Minimal DOM Mocking for Node.js
// ──────────────────────────────────────────────
class MockElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.className = '';
    this.id = '';
    this.value = '';
    this.selected = false;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this.parentNode = null;
    this._textContent = '';
    this._innerHTML = '';

    const self = this;
    this.classList = {
      add(...classes) {
        classes.forEach(c => {
          const arr = self.className.split(/\s+/).filter(Boolean);
          if (!arr.includes(c)) arr.push(c);
          self.className = arr.join(' ');
        });
      },
      remove(...classes) {
        classes.forEach(c => {
          const arr = self.className.split(/\s+/).filter(Boolean);
          const idx = arr.indexOf(c);
          if (idx !== -1) arr.splice(idx, 1);
          self.className = arr.join(' ');
        });
      },
      contains(c) {
        return self.className.split(/\s+/).filter(Boolean).includes(c);
      }
    };
  }

  get textContent() {
    if (this.children.length > 0) {
      return this.children.map(c => c.textContent).join(' ').trim();
    }
    return this._textContent.trim();
  }

  set textContent(val) {
    this._textContent = String(val);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(html) {
    this._innerHTML = html;
    this.children = [];
    this._textContent = '';
    parseHtmlToMock(html, this);
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type, fn) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(fn);
  }

  dispatchEvent(event) {
    const type = typeof event === 'string' ? event : event.type;
    const fns = this.listeners[type] || [];
    for (const fn of fns) {
      fn(event);
    }
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this, stopPropagation: () => {} });
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
    if (full && full.startsWith('<!--')) continue;
    if (text) {
      const top = stack[stack.length - 1];
      if (top && top !== root) {
        top._textContent += text;
      } else {
        parent._textContent += text;
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
  for (const child of root.children) {
    parent.appendChild(child);
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

// Import modules under test
const {
  renderDashboard,
  _resetDashboardStateForTesting,
  _setDashboardFilterForTesting
} = await import('./dashboard.js');
const { _setCurrentUserForTesting } = await import('../firebase/auth.js');

console.log('\n📋 Task Board Dashboard: Multi-Assignee & Mention Edge Cases Unit Tests');

const multiAssigneePages = [
  {
    id: 'page-1',
    title: 'Alpha Project',
    content: `
- [ ] Task 1 first position @Alice @Bob
- [ ] Task 2 second position @Bob @Alice
- [ ] Task 3 middle position @Carol @Alice @Dave
- [x] Task 4 completed multi @Alice @Bob
- [ ] Task 5 other team only @Bob @Carol
- [ ] Task 6 unassigned plain task
`
  },
  {
    id: 'page-2',
    title: 'Beta Project',
    content: `
- [ ] Task 7 review needed @Alice, please check
- [ ] Task 8 documentation by @Alice.
- [ ] Task 9 @Alice: urgent deployment
- [ ] Task 10 handled by (@Alice) and (@Bob)
- [ ] Task 11 contact support@insel.ch for info @Alice
- [ ] Task 12 email admin@insel.ch @Bob
- [x] Task 13 completed capital @Bob @Alice
`
  }
];

test('defaults to filtering open tasks assigned to current user and excludes completed tasks on initial load', () => {
  _resetDashboardStateForTesting();
  bodyEl.children = [];
  _setCurrentUserForTesting({ displayName: 'Alice', email: 'alice@insel.ch' });

  renderDashboard(multiAssigneePages);

  const overlay = document.getElementById('dashboard-overlay');
  expect(overlay).toBeTruthy();

  const taskCards = overlay.querySelectorAll('.task-card');
  const taskTexts = taskCards.map(c => c.querySelector('.task-text').textContent.trim());

  // Incomplete tasks for Alice should be present
  expect(taskTexts.some(t => t.includes('Task 1 first position @Alice @Bob'))).toBe(true);
  expect(taskTexts.some(t => t.includes('Task 2 second position @Bob @Alice'))).toBe(true);

  // Completed tasks for Alice (done: true) must be excluded by default (status is 'open')
  expect(taskTexts.some(t => t.includes('Task 4 completed multi @Alice @Bob'))).toBe(false);
  expect(taskTexts.some(t => t.includes('Task 13 completed capital @Bob @Alice'))).toBe(false);

  // Other users or unassigned tasks must be excluded
  expect(taskTexts.some(t => t.includes('Task 5 other team only @Bob @Carol'))).toBe(false);
  expect(taskTexts.some(t => t.includes('Task 6 unassigned plain task'))).toBe(false);
});

test('properly sets active CSS class on My Tasks button and selected attribute on Open option on initial load', () => {
  _resetDashboardStateForTesting();
  bodyEl.children = [];
  _setCurrentUserForTesting({ displayName: 'Alice', email: 'alice@insel.ch' });

  renderDashboard(multiAssigneePages);

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

test('correctly falls back to formatDefaultName when displayName is missing but email is provided', () => {
  _resetDashboardStateForTesting();
  bodyEl.children = [];
  _setCurrentUserForTesting({ displayName: null, email: 'alice.smith@insel.ch' });

  const pagesWithEmailFormattedName = [
    {
      id: 'page-email-test',
      title: 'Project Gamma',
      content: `- [ ] Follow up on report @Alice Smith\n- [ ] Unrelated task @Bob`
    }
  ];

  renderDashboard(pagesWithEmailFormattedName);

  const overlay = document.getElementById('dashboard-overlay');
  const taskCards = overlay.querySelectorAll('.task-card');
  expect(taskCards).toHaveLength(1);

  const text = taskCards[0].querySelector('.task-text').textContent.trim();
  expect(text).toContain('Follow up on report @Alice Smith');
});

test('multi-assignee tasks: filters tasks where current user is in 1st, 2nd, or middle position under My Tasks', () => {
  _resetDashboardStateForTesting();
  bodyEl.children = [];
  _setCurrentUserForTesting({ displayName: 'Alice', email: 'alice@insel.ch' });
  _setDashboardFilterForTesting('my', 'all');

  renderDashboard(multiAssigneePages);

  const overlay = document.getElementById('dashboard-overlay');
  expect(overlay).toBeTruthy();

  const taskCards = overlay.querySelectorAll('.task-card');
  const taskTexts = taskCards.map(c => c.querySelector('.task-text').textContent.trim());

  // Current user in 1st, 2nd, and middle positions MUST be included
  expect(taskTexts.some(t => t.includes('Task 1 first position @Alice @Bob'))).toBe(true);
  expect(taskTexts.some(t => t.includes('Task 2 second position @Bob @Alice'))).toBe(true);
  expect(taskTexts.some(t => t.includes('Task 3 middle position @Carol @Alice @Dave'))).toBe(true);

  // Other users only and unassigned tasks MUST be excluded
  expect(taskTexts.some(t => t.includes('Task 5 other team only @Bob @Carol'))).toBe(false);
  expect(taskTexts.some(t => t.includes('Task 6 unassigned plain task'))).toBe(false);
  expect(taskTexts.some(t => t.includes('Task 12 email admin@insel.ch @Bob'))).toBe(false);
});

test('mention edge cases: handles trailing punctuation on mentions (@Alice,, @Alice., @Alice:, (@Alice))', () => {
  _resetDashboardStateForTesting();
  bodyEl.children = [];
  _setCurrentUserForTesting({ displayName: 'Alice', email: 'alice@insel.ch' });
  _setDashboardFilterForTesting('my', 'all');

  renderDashboard(multiAssigneePages);

  const overlay = document.getElementById('dashboard-overlay');
  const taskCards = overlay.querySelectorAll('.task-card');
  const taskTexts = taskCards.map(c => c.querySelector('.task-text').textContent.trim());

  // Mentions with trailing punctuation must be parsed and matched
  expect(taskTexts.some(t => t.includes('Task 7 review needed @Alice, please check'))).toBe(true);
  expect(taskTexts.some(t => t.includes('Task 8 documentation by @Alice.'))).toBe(true);
  expect(taskTexts.some(t => t.includes('Task 9 @Alice: urgent deployment'))).toBe(true);
  expect(taskTexts.some(t => t.includes('Task 10 handled by (@Alice) and (@Bob)'))).toBe(true);
});

test('email coexistence: email addresses in task body do not break mention parsing or cause false positives', () => {
  _resetDashboardStateForTesting();
  bodyEl.children = [];
  _setCurrentUserForTesting({ displayName: 'Alice', email: 'alice@insel.ch' });
  _setDashboardFilterForTesting('my', 'all');

  renderDashboard(multiAssigneePages);

  const overlay = document.getElementById('dashboard-overlay');
  const taskCards = overlay.querySelectorAll('.task-card');
  const taskTexts = taskCards.map(c => c.querySelector('.task-text').textContent.trim());

  // Task 11 has support@insel.ch AND @Alice -> matches for Alice
  expect(taskTexts.some(t => t.includes('Task 11 contact support@insel.ch for info @Alice'))).toBe(true);

  // Task 12 has admin@insel.ch AND @Bob -> does NOT match for Alice
  expect(taskTexts.some(t => t.includes('Task 12 email admin@insel.ch @Bob'))).toBe(false);
});

test('status filter: open status excludes completed multi-assignee tasks', () => {
  _resetDashboardStateForTesting();
  bodyEl.children = [];
  _setCurrentUserForTesting({ displayName: 'Alice', email: 'alice@insel.ch' });
  _setDashboardFilterForTesting('my', 'open');

  renderDashboard(multiAssigneePages);

  const overlay = document.getElementById('dashboard-overlay');
  const taskCards = overlay.querySelectorAll('.task-card');
  const taskTexts = taskCards.map(c => c.querySelector('.task-text').textContent.trim());

  // Open multi-assignee tasks included
  expect(taskTexts.some(t => t.includes('Task 1 first position @Alice @Bob'))).toBe(true);
  expect(taskTexts.some(t => t.includes('Task 2 second position @Bob @Alice'))).toBe(true);
  expect(taskTexts.some(t => t.includes('Task 3 middle position @Carol @Alice @Dave'))).toBe(true);

  // Completed multi-assignee tasks excluded
  expect(taskTexts.some(t => t.includes('Task 4 completed multi @Alice @Bob'))).toBe(false);
  expect(taskTexts.some(t => t.includes('Task 13 completed capital @Bob @Alice'))).toBe(false);

  // None of the rendered cards have completed class
  taskCards.forEach(card => {
    expect(card.classList.contains('completed')).toBe(false);
  });
});

test('status filter: done status includes only completed multi-assignee tasks', () => {
  _resetDashboardStateForTesting();
  bodyEl.children = [];
  _setCurrentUserForTesting({ displayName: 'Alice', email: 'alice@insel.ch' });
  _setDashboardFilterForTesting('my', 'done');

  renderDashboard(multiAssigneePages);

  const overlay = document.getElementById('dashboard-overlay');
  const taskCards = overlay.querySelectorAll('.task-card');
  const taskTexts = taskCards.map(c => c.querySelector('.task-text').textContent.trim());

  // Completed tasks included
  expect(taskTexts.some(t => t.includes('Task 4 completed multi @Alice @Bob'))).toBe(true);
  expect(taskTexts.some(t => t.includes('Task 13 completed capital @Bob @Alice'))).toBe(true);

  // Open tasks excluded
  expect(taskTexts.some(t => t.includes('Task 1 first position @Alice @Bob'))).toBe(false);
  expect(taskTexts.some(t => t.includes('Task 2 second position @Bob @Alice'))).toBe(false);

  // Rendered cards should have completed class and checkmark icon
  taskCards.forEach(card => {
    expect(card.classList.contains('completed')).toBe(true);
    expect(card.querySelector('.clickable-status').textContent.trim()).toBe('✅');
  });
});

test('filter switching: switching to All Tasks shows tasks for all assignees and unassigned', () => {
  _resetDashboardStateForTesting();
  bodyEl.children = [];
  _setCurrentUserForTesting({ displayName: 'Alice', email: 'alice@insel.ch' });
  _setDashboardFilterForTesting('my', 'all');

  renderDashboard(multiAssigneePages);

  const overlay = document.getElementById('dashboard-overlay');
  const allBtn = overlay.querySelector('.filter-btn[data-filter="all"]');
  allBtn.click();

  const updatedOverlay = document.getElementById('dashboard-overlay');
  const taskCards = updatedOverlay.querySelectorAll('.task-card');
  const taskTexts = taskCards.map(c => c.querySelector('.task-text').textContent.trim());

  // Under All Tasks, all tasks from both pages are visible
  expect(taskTexts.some(t => t.includes('Task 5 other team only @Bob @Carol'))).toBe(true);
  expect(taskTexts.some(t => t.includes('Task 6 unassigned plain task'))).toBe(true);
  expect(taskTexts.some(t => t.includes('Task 12 email admin@insel.ch @Bob'))).toBe(true);
  expect(taskTexts.some(t => t.includes('Task 1 first position @Alice @Bob'))).toBe(true);
  expect(taskTexts.length).toBe(13);
});

test('status filter dropdown change updates task list', () => {
  _resetDashboardStateForTesting();
  bodyEl.children = [];
  _setCurrentUserForTesting({ displayName: 'Alice', email: 'alice@insel.ch' });
  _setDashboardFilterForTesting('my', 'all');

  renderDashboard(multiAssigneePages);

  const overlay = document.getElementById('dashboard-overlay');
  const statusSelect = overlay.querySelector('#status-filter-select');

  // Change to 'done'
  statusSelect.dispatchEvent({ type: 'change', target: { value: 'done' } });

  const updatedOverlay = document.getElementById('dashboard-overlay');
  const taskCards = updatedOverlay.querySelectorAll('.task-card');
  expect(taskCards).toHaveLength(2); // Task 4 and Task 13
  taskCards.forEach(card => {
    expect(card.classList.contains('completed')).toBe(true);
  });
});

test('multi-page aggregation preserves pageId, pageTitle, and task indices', () => {
  _resetDashboardStateForTesting();
  bodyEl.children = [];
  _setCurrentUserForTesting({ displayName: 'Alice', email: 'alice@insel.ch' });
  _setDashboardFilterForTesting('all', 'all');

  renderDashboard(multiAssigneePages);

  const overlay = document.getElementById('dashboard-overlay');
  const page1Cards = overlay.querySelectorAll('.task-card[data-page-id="page-1"]');
  const page2Cards = overlay.querySelectorAll('.task-card[data-page-id="page-2"]');

  expect(page1Cards).toHaveLength(6);
  expect(page2Cards).toHaveLength(7);

  // Check sequential indices
  expect(page1Cards[0].dataset.taskIndex).toBe('0');
  expect(page1Cards[1].dataset.taskIndex).toBe('1');
  expect(page2Cards[0].dataset.taskIndex).toBe('0');
});

test('handles unauthenticated or missing displayName gracefully', () => {
  _resetDashboardStateForTesting();
  bodyEl.children = [];
  _setCurrentUserForTesting(null);
  _setDashboardFilterForTesting('my', 'open');

  renderDashboard(multiAssigneePages);

  const overlay = document.getElementById('dashboard-overlay');
  const taskCards = overlay.querySelectorAll('.task-card');
  expect(taskCards).toHaveLength(0);

  const emptyHint = overlay.querySelector('.empty-hint');
  expect(emptyHint).toBeTruthy();
});

console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('✅ All tests passed!');
}
