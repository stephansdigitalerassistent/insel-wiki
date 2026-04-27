/**
 * Unit Tests for utility functions (#13)
 * Run with: node tests/utils.test.js
 * 
 * Simple test runner — no framework needed.
 */

// We use dynamic import since these are ESM modules
const { formatDefaultName, slugify } = await import('../src/utils/string.js');
const { extractTasksFromContent: extractTasks } = await import('../src/utils/tasks.js');

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
console.log('\n📝 formatDefaultName()');
// ──────────────────────────────────────────────

test('converts email prefix to capitalized name', () => {
  expect(formatDefaultName('max.muster@insel.ch')).toBe('Max Muster');
});

test('handles single-part email prefix', () => {
  expect(formatDefaultName('admin@insel.ch')).toBe('Admin');
});

test('handles hyphenated names', () => {
  expect(formatDefaultName('anna-maria.schmidt@insel.ch')).toBe('Anna Maria Schmidt');
});

test('handles underscored names', () => {
  expect(formatDefaultName('first_last@insel.ch')).toBe('First Last');
});

test('returns "Gast" for null/undefined', () => {
  expect(formatDefaultName(null)).toBe('Gast');
  expect(formatDefaultName(undefined)).toBe('Gast');
});

test('returns "Gast" for "Gast" string', () => {
  expect(formatDefaultName('Gast')).toBe('Gast');
});

// ──────────────────────────────────────────────
console.log('\n🔗 slugify()');
// ──────────────────────────────────────────────

test('converts title to URL-safe slug', () => {
  expect(slugify('Hello World')).toBe('hello-world');
});

test('removes special characters', () => {
  expect(slugify('Über uns & mehr!')).toBe('ber-uns-mehr');
});

test('handles empty string', () => {
  expect(slugify('')).toBe('');
});

test('handles null/undefined', () => {
  expect(slugify(null)).toBe('');
  expect(slugify(undefined)).toBe('');
});

test('collapses multiple dashes', () => {
  expect(slugify('a   b   c')).toBe('a-b-c');
});

test('trims whitespace', () => {
  expect(slugify('  trimmed  ')).toBe('trimmed');
});

// ──────────────────────────────────────────────
console.log('\n☑️  extractTasks()');
// ──────────────────────────────────────────────

test('extracts markdown checkbox tasks', () => {
  const content = '- [ ] Buy milk\n- [x] Clean room\n- [ ] Code review';
  const tasks = extractTasks(content);
  expect(tasks.length >= 1).toBeTruthy();
  expect(tasks[0].text).toBe('Buy milk');
  expect(tasks[0].done).toBe(false);
  expect(tasks[1].done).toBe(true);
});

test('handles empty content', () => {
  const tasks = extractTasks('');
  expect(tasks).toHaveLength(0);
});

test('handles null content', () => {
  const tasks = extractTasks(null);
  expect(tasks).toHaveLength(0);
});

test('ignores regular text without task markers', () => {
  const content = 'This is just regular text without any tasks.';
  const tasks = extractTasks(content);
  expect(tasks).toHaveLength(0);
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
