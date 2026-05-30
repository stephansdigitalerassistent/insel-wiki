/**
 * Unit tests for extractTasksFromContent() — src/utils/tasks.js
 * Run with: node src/utils/tasks.test.js
 *
 * Simple test runner — no framework needed (matches tests/utils.test.js).
 */

const { extractTasksFromContent } = await import('./tasks.js');

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
console.log('\n☑️  extractTasksFromContent() — basic checkbox formats');
// ──────────────────────────────────────────────

test('extracts an unchecked "- [ ]" task', () => {
  const tasks = extractTasksFromContent('- [ ] Aufgabe');
  expect(tasks).toHaveLength(1);
  expect(tasks[0].done).toBe(false);
  expect(tasks[0].text).toBe('Aufgabe');
});

test('extracts a checked "- [x]" task', () => {
  const tasks = extractTasksFromContent('- [x] Erledigt');
  expect(tasks).toHaveLength(1);
  expect(tasks[0].done).toBe(true);
  expect(tasks[0].text).toBe('Erledigt');
});

test('supports the "*" bullet marker for unchecked tasks', () => {
  const tasks = extractTasksFromContent('* [ ] Star task');
  expect(tasks).toHaveLength(1);
  expect(tasks[0].done).toBe(false);
  expect(tasks[0].text).toBe('Star task');
  expect(tasks[0].raw).toBe('* [ ] Star task');
});

test('supports the "*" bullet marker for checked tasks', () => {
  const tasks = extractTasksFromContent('* [x] Done star');
  expect(tasks).toHaveLength(1);
  expect(tasks[0].done).toBe(true);
  expect(tasks[0].text).toBe('Done star');
});

test('treats uppercase "[X]" as checked', () => {
  const tasks = extractTasksFromContent('- [X] Capital X');
  expect(tasks).toHaveLength(1);
  expect(tasks[0].done).toBe(true);
  expect(tasks[0].text).toBe('Capital X');
});

test('extracts a task even without a leading bullet marker', () => {
  const tasks = extractTasksFromContent('[ ] No bullet');
  expect(tasks).toHaveLength(1);
  expect(tasks[0].done).toBe(false);
  expect(tasks[0].text).toBe('No bullet');
});

test('extracts a task with no space after the closing bracket', () => {
  const tasks = extractTasksFromContent('- [x]Tight');
  expect(tasks).toHaveLength(1);
  expect(tasks[0].done).toBe(true);
  expect(tasks[0].text).toBe('Tight');
});

// ──────────────────────────────────────────────
console.log('\n🧱 returned task shape');
// ──────────────────────────────────────────────

test('returns the full {done, text, raw, index, indent} shape', () => {
  const tasks = extractTasksFromContent('- [ ] Aufgabe');
  expect(tasks[0]).toEqual({
    done: false,
    text: 'Aufgabe',
    raw: '- [ ] Aufgabe',
    index: 0,
    indent: 0
  });
});

test('matches the JSDoc example output exactly', () => {
  const tasks = extractTasksFromContent('- [ ] Aufgabe\n- [x] Erledigt');
  expect(tasks).toEqual([
    { done: false, text: 'Aufgabe', raw: '- [ ] Aufgabe', index: 0, indent: 0 },
    { done: true, text: 'Erledigt', raw: '- [x] Erledigt', index: 1, indent: 0 }
  ]);
});

// ──────────────────────────────────────────────
console.log('\n📐 indentation levels');
// ──────────────────────────────────────────────

test('reports indent 0 for a top-level task', () => {
  const tasks = extractTasksFromContent('- [ ] Top');
  expect(tasks[0].indent).toBe(0);
});

test('counts leading spaces as the indent level', () => {
  const tasks = extractTasksFromContent('  - [ ] Two spaces');
  expect(tasks[0].indent).toBe(2);
  expect(tasks[0].text).toBe('Two spaces');
});

test('counts a leading tab as one indent unit', () => {
  const tasks = extractTasksFromContent('\t- [x] Tabbed');
  expect(tasks[0].indent).toBe(1);
  expect(tasks[0].done).toBe(true);
  expect(tasks[0].text).toBe('Tabbed');
});

test('tracks increasing indent across nested tasks', () => {
  const content = '- [ ] Parent\n  - [x] Child\n    - [ ] Grandchild';
  const tasks = extractTasksFromContent(content);
  expect(tasks).toHaveLength(3);
  expect(tasks[0].indent).toBe(0);
  expect(tasks[1].indent).toBe(2);
  expect(tasks[1].text).toBe('Child');
  expect(tasks[1].done).toBe(true);
  expect(tasks[2].indent).toBe(4);
  expect(tasks[2].text).toBe('Grandchild');
});

// ──────────────────────────────────────────────
console.log('\n🔢 multiple tasks in one string');
// ──────────────────────────────────────────────

test('extracts every task in a multi-line string', () => {
  const content = '- [ ] Buy milk\n- [x] Clean room\n- [ ] Code review';
  const tasks = extractTasksFromContent(content);
  expect(tasks).toHaveLength(3);
  expect(tasks[0].text).toBe('Buy milk');
  expect(tasks[1].text).toBe('Clean room');
  expect(tasks[2].text).toBe('Code review');
});

test('assigns sequential, zero-based indices in document order', () => {
  const content = '- [ ] A\n- [ ] B\n- [ ] C';
  const tasks = extractTasksFromContent(content);
  expect(tasks[0].index).toBe(0);
  expect(tasks[1].index).toBe(1);
  expect(tasks[2].index).toBe(2);
});

test('mixes "-" and "*" markers within the same string', () => {
  const content = '- [ ] Dash\n* [x] Star';
  const tasks = extractTasksFromContent(content);
  expect(tasks).toHaveLength(2);
  expect(tasks[0].text).toBe('Dash');
  expect(tasks[0].done).toBe(false);
  expect(tasks[1].text).toBe('Star');
  expect(tasks[1].done).toBe(true);
});

test('extracts only task lines from prose-interleaved content', () => {
  const content = [
    '# Heading',
    'Some intro paragraph.',
    '- [ ] First todo',
    '',
    'More explanatory text.',
    '- [x] Second todo',
    'Closing remarks.'
  ].join('\n');
  const tasks = extractTasksFromContent(content);
  expect(tasks).toHaveLength(2);
  expect(tasks[0].text).toBe('First todo');
  expect(tasks[0].index).toBe(0);
  expect(tasks[1].text).toBe('Second todo');
  expect(tasks[1].done).toBe(true);
  expect(tasks[1].index).toBe(1);
});

// ──────────────────────────────────────────────
console.log('\n✂️  text normalisation');
// ──────────────────────────────────────────────

test('trims leading and trailing whitespace from task text', () => {
  const tasks = extractTasksFromContent('- [ ]    padded task    ');
  expect(tasks[0].text).toBe('padded task');
});

test('preserves whitespace inside the task text', () => {
  const tasks = extractTasksFromContent('- [ ] keep   inner   spaces');
  expect(tasks[0].text).toBe('keep   inner   spaces');
});

test('returns an empty text for an empty task body', () => {
  const tasks = extractTasksFromContent('- [ ]');
  expect(tasks).toHaveLength(1);
  expect(tasks[0].text).toBe('');
  expect(tasks[0].done).toBe(false);
});

test('handles CRLF line endings and strips the carriage return', () => {
  const tasks = extractTasksFromContent('- [ ] Win\r\n- [x] Lin');
  expect(tasks).toHaveLength(2);
  expect(tasks[0].text).toBe('Win');
  expect(tasks[1].text).toBe('Lin');
  expect(tasks[1].done).toBe(true);
});

// ──────────────────────────────────────────────
console.log('\n🚫 lines that should NOT match');
// ──────────────────────────────────────────────

test('ignores plain text without any task markers', () => {
  const tasks = extractTasksFromContent('This is just regular text without any tasks.');
  expect(tasks).toHaveLength(0);
});

test('ignores empty checkbox brackets "[]"', () => {
  const tasks = extractTasksFromContent('- [] empty brackets');
  expect(tasks).toHaveLength(0);
});

test('ignores invalid checkbox characters like "[y]"', () => {
  const tasks = extractTasksFromContent('- [y] invalid marker');
  expect(tasks).toHaveLength(0);
});

test('ignores a bullet with no space before the checkbox', () => {
  const tasks = extractTasksFromContent('-[ ] no space');
  expect(tasks).toHaveLength(0);
});

test('ignores checkboxes that appear mid-line rather than at line start', () => {
  const tasks = extractTasksFromContent('Status: [x] done inline');
  expect(tasks).toHaveLength(0);
});

test('ignores a whitespace-only string', () => {
  const tasks = extractTasksFromContent('   \n\t  ');
  expect(tasks).toHaveLength(0);
});

// ──────────────────────────────────────────────
console.log('\n🪫 falsy / invalid inputs');
// ──────────────────────────────────────────────

test('returns [] for an empty string', () => {
  expect(extractTasksFromContent('')).toHaveLength(0);
});

test('returns [] for null', () => {
  expect(extractTasksFromContent(null)).toHaveLength(0);
});

test('returns [] for undefined', () => {
  expect(extractTasksFromContent(undefined)).toHaveLength(0);
});

test('returns [] for a number input', () => {
  expect(extractTasksFromContent(42)).toHaveLength(0);
});

test('returns [] for a boolean input', () => {
  expect(extractTasksFromContent(true)).toHaveLength(0);
});

test('returns [] for an object input', () => {
  expect(extractTasksFromContent({ foo: 'bar' })).toHaveLength(0);
});

test('returns [] for an array input', () => {
  expect(extractTasksFromContent(['- [ ] nope'])).toHaveLength(0);
});

test('always returns a fresh array instance (no shared state)', () => {
  const a = extractTasksFromContent('- [ ] one');
  const b = extractTasksFromContent('- [ ] two');
  expect(a === b).toBe(false);
  expect(a[0].text).toBe('one');
  expect(b[0].text).toBe('two');
});

// ──────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('✅ All tests passed!');
}
