/**
 * Unit Tests for utility functions (#13)
 * Run with: node tests/utils.test.js
 * 
 * Simple test runner — no framework needed.
 */

const { formatDefaultName, slugify } = await import('../src/utils/string.js');
const { extractTasksFromContent: extractTasks } = await import('../src/utils/tasks.js');
const { shouldLogError } = await import('../src/utils/error-filter.js');

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

test('ignores dates in YYYY-MM-DD format', () => {
  expect(slugify('Meeting Notes 2024-05-12')).toBe('meeting-notes');
});

test('ignores dates in DD.MM.YYYY format', () => {
  expect(slugify('Protokoll 12.05.2024')).toBe('protokoll');
});

test('ignores dates in YYYYMMDD format', () => {
  expect(slugify('Session 20240512 Info')).toBe('session-info');
});

test('ignores dates with slashes', () => {
  expect(slugify('Meeting 2024/05/12')).toBe('meeting');
  expect(slugify('Protokoll 12/05/2024')).toBe('protokoll');
});

test('ignores dates with underscores', () => {
  expect(slugify('Meeting 2024_05_12')).toBe('meeting');
  expect(slugify('Protokoll 12_05_2024')).toBe('protokoll');
});

test('does not strip date-like strings containing letters or excessive digits', () => {
  expect(slugify('doc12345678')).toBe('doc12345678');
  expect(slugify('202405128')).toBe('202405128');
  expect(slugify('120240512')).toBe('120240512');
  expect(slugify('1202405128')).toBe('1202405128');
});

// ──────────────────────────────────────────────
console.log('\n☑️  extractTasks()');
// ──────────────────────────────────────────────

test('extracts markdown checkbox tasks', () => {
  const content = '- [ ] Buy milk\n- [x] Clean room\n- [ ] Code review';
  const tasks = extractTasks(content);
  expect(tasks.length).toBe(3);
  expect(tasks[0].text).toBe('Buy milk');
  expect(tasks[0].done).toBe(false);
  expect(tasks[0].index).toBe(0);
  expect(tasks[1].done).toBe(true);
  expect(tasks[1].index).toBe(1);
});

test('handles indented tasks', () => {
  const content = '- [ ] Parent\n  - [x] Child\n    - [ ] Grandchild';
  const tasks = extractTasks(content);
  expect(tasks.length).toBe(3);
  expect(tasks[1].text).toBe('Child');
  expect(tasks[1].done).toBe(true);
  expect(tasks[1].index).toBe(1);
  expect(tasks[2].text).toBe('Grandchild');
  expect(tasks[2].index).toBe(2);
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
console.log('\n🛡️  shouldLogError()');
// ──────────────────────────────────────────────

test('allows logging of normal/unexpected client errors', () => {
  expect(shouldLogError('TypeError: Cannot read properties of null (reading "title")')).toBeTruthy();
  expect(shouldLogError('Failed to fetch api endpoint')).toBeTruthy();
});

test('filters out expected future update time warning', () => {
  expect(shouldLogError('@firebase/firestore: Firestore (12.14.0): Detected an update time that is in the future: 1782713782238 > 1782713782098')).toBeFalsy();
});

test('filters out expected permission-denied errors', () => {
  expect(shouldLogError('FirebaseError: [code=permission-denied]: Missing or insufficient permissions.')).toBeFalsy();
  expect(shouldLogError('Error loading trash: Missing or insufficient permissions.')).toBeFalsy();
});

test('filters out original ignored patterns', () => {
  expect(shouldLogError('Failed to get document from cache')).toBeFalsy();
  expect(shouldLogError('Firestore backend is unavailable')).toBeFalsy();
  expect(shouldLogError('BloomFilter error occurred')).toBeFalsy();
  expect(shouldLogError('[Firestore] Failed to log client error to database')).toBeFalsy();
});

test('filters out new privileged endpoint errors', () => {
  expect(shouldLogError('Failed to delete page: Unauthorized: Missing token')).toBeFalsy();
  expect(shouldLogError('Failed to update ACL: Forbidden: Insufficient permissions for page')).toBeFalsy();
});

// ──────────────────────────────────────────────
console.log('\n🤖 SpellCheckerBot Collaboration Awareness');
// ──────────────────────────────────────────────

const { SpellCheckerBot } = await import('../src/editor/SpellCheckerBot.js');

test('SpellCheckerBot temporarily changes awareness user and restores it', async () => {
  let localState = {
    user: { name: 'Alice', color: '#123456' }
  };

  const mockProvider = {
    pageId: 'test-page',
    awareness: {
      getLocalState: () => localState,
      setLocalStateField: (field, value) => {
        if (field === 'user') {
          localState.user = value;
        }
      }
    },
    publishedCount: 0,
    _publishOwnAwareness() {
      this.publishedCount++;
    }
  };

  let dispatchedTr = null;
  const mockEditor = {
    on: () => {},
    off: () => {},
    state: {
      doc: {
        content: { size: 100 },
        textBetween: () => 'originalword'
      },
      tr: {
        insertText: () => {},
        setMeta: () => {}
      }
    },
    view: {
      dispatch: (tr) => {
        dispatchedTr = tr;
      }
    }
  };

  const bot = new SpellCheckerBot(mockEditor, mockProvider);
  
  // Mock Gemini response
  bot._callGemini = async () => 'correctedword';

  // Trigger correction
  await bot._correctWord('originalword', 0, 12, '0:originalword', '', '');

  // Verify that the identity was set to SpellCheckerBot
  expect(localState.user.name).toBe('SpellCheckerBot');
  expect(localState.user.color).toBe('#10b981');
  expect(mockProvider.publishedCount > 0).toBeTruthy();

  // Verify that restoring user identity resets it back to Alice
  bot._restoreUserIdentity();
  expect(localState.user.name).toBe('Alice');
  expect(localState.user.color).toBe('#123456');
});

test('SpellCheckerBot restores user identity immediately on subsequent user transaction', async () => {
  let localState = {
    user: { name: 'Alice', color: '#123456' }
  };

  const mockProvider = {
    pageId: 'test-page',
    awareness: {
      getLocalState: () => localState,
      setLocalStateField: (field, value) => {
        if (field === 'user') {
          localState.user = value;
        }
      }
    },
    _publishOwnAwareness() {}
  };

  const mockEditor = {
    on: () => {},
    off: () => {},
    state: {
      doc: {
        content: { size: 100 },
        textBetween: () => 'originalword'
      },
      tr: {
        insertText: () => {},
        setMeta: () => {}
      }
    },
    view: {
      dispatch: () => {}
    }
  };

  const bot = new SpellCheckerBot(mockEditor, mockProvider);
  bot._callGemini = async () => 'correctedword';

  // Trigger correction
  await bot._correctWord('originalword', 0, 12, '0:originalword', '', '');
  expect(localState.user.name).toBe('SpellCheckerBot');

  // Simulate a user transaction (without the spellchecker meta flag)
  const userTr = {
    getMeta: (key) => key === 'isSpellCheckerCorrection' ? false : undefined,
    docChanged: false
  };
  bot._onTransaction({ transaction: userTr });

  // Identity should be restored immediately
  expect(localState.user.name).toBe('Alice');
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
