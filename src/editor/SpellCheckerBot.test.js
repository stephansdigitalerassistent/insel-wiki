/**
 * Unit tests for SpellCheckerBot — src/editor/SpellCheckerBot.js
 * Run with: node src/editor/SpellCheckerBot.test.js
 *
 * Simple test runner — no framework needed.
 */

const { SpellCheckerBot } = await import('./SpellCheckerBot.js');

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
// 🤖 SpellCheckerBot Collaboration Awareness
// ──────────────────────────────────────────────
console.log('\n🤖 SpellCheckerBot Collaboration Awareness');

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

// Run tests sequentially
for (const { name, fn } of tests) {
  try {
    const res = fn();
    if (res instanceof Promise) {
      await res;
    }
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✕ ${name}`);
    console.error(`    ${err.message}`);
  }
}

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
