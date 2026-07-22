/**
 * Unit tests for Comment Mark — src/editor/Comment.js
 * Run with: node src/editor/Comment.test.js
 *
 * Simple test runner — no framework needed (matches tests/utils.test.js).
 */

const { Comment } = await import('./Comment.js');

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
// 💬 Comment Mark Unit Coverage
// ──────────────────────────────────────────────
console.log('\n💬 Comment Mark Unit Coverage');

test('Comment mark name is correct', () => {
  expect(Comment.name).toBe('comment');
});

test('Comment addAttributes config works as expected', () => {
  const attrs = Comment.config.addAttributes();
  expect(attrs.commentId).toBeTruthy();
  expect(attrs.commentId.default).toBe(null);

  // Test parseHTML function
  const mockElement = {
    getAttribute(name) {
      if (name === 'data-comment-id') return 'id-123';
      return null;
    }
  };
  const parsed = attrs.commentId.parseHTML(mockElement);
  expect(parsed).toBe('id-123');

  // Test renderHTML function
  const renderedEmpty = attrs.commentId.renderHTML({});
  expect(JSON.stringify(renderedEmpty)).toBe('{}');

  const renderedId = attrs.commentId.renderHTML({ commentId: 'id-456' });
  expect(renderedId['data-comment-id']).toBe('id-456');
});

test('Comment parseHTML rules returns matching tag', () => {
  const rules = Comment.config.parseHTML();
  expect(rules.length).toBe(1);
  expect(rules[0].tag).toBe('span[data-comment-id]');
});

test('Comment renderHTML returns correct ProseMirror DOM spec', () => {
  const HTMLAttributes = { 'data-comment-id': 'id-789' };
  const mockContext = {};
  const result = Comment.config.renderHTML.call(mockContext, { HTMLAttributes });
  expect(result[0]).toBe('span');
  expect(result[1]['data-comment-id']).toBe('id-789');
  expect(result[1].class).toBe('comment-highlight');
  expect(result[2]).toBe(0);
});

test('Comment commands setComment and unsetComment trigger setMark/unsetMark', () => {
  const mockContext = { name: 'comment' };
  const commandsObj = Comment.config.addCommands.call(mockContext);

  expect(typeof commandsObj.setComment).toBe('function');
  expect(typeof commandsObj.unsetComment).toBe('function');

  let setMarkCalled = null;
  const mockCommands = {
    setMark(name, attrs) {
      setMarkCalled = { name, attrs };
      return true;
    },
    unsetMark(name) {
      setMarkCalled = { name, unset: true };
      return true;
    }
  };

  const setCommentFn = commandsObj.setComment('test-id');
  const result1 = setCommentFn({ commands: mockCommands });
  expect(result1).toBe(true);
  expect(setMarkCalled.name).toBe('comment');
  expect(setMarkCalled.attrs.commentId).toBe('test-id');

  const unsetCommentFn = commandsObj.unsetComment();
  const result2 = unsetCommentFn({ commands: mockCommands });
  expect(result2).toBe(true);
  expect(setMarkCalled.name).toBe('comment');
  expect(setMarkCalled.unset).toBe(true);
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
