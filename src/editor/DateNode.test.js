/**
 * Unit tests for DateNode Input & Paste Rules — src/editor/DateNode.js
 * Run with: node src/editor/DateNode.test.js
 *
 * Simple test runner — no framework needed (matches tests/utils.test.js).
 */

const { DateNode } = await import('./DateNode.js');
const { InputRule, PasteRule, getSchema, createChainableState } = await import('@tiptap/core');
const { StarterKit } = await import('@tiptap/starter-kit');
const { Link } = await import('@tiptap/extension-link');
const { EditorState, TextSelection } = await import('@tiptap/pm/state');

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
// 📅 DateNode Input & Paste Rules Unit Coverage
// ──────────────────────────────────────────────
console.log('\n📅 DateNode Input & Paste Rules');

test('DateNode config has addInputRules and addPasteRules', () => {
  expect(typeof DateNode.config.addInputRules).toBe('function');
  expect(typeof DateNode.config.addPasteRules).toBe('function');
});

test('DateNode constructs valid InputRule and PasteRule instances', () => {
  const schema = getSchema([StarterKit, Link, DateNode]);
  const mockContext = {
    name: 'dateNode',
    type: schema.nodes.dateNode
  };
  const inputRules = DateNode.config.addInputRules.call(mockContext);
  expect(inputRules.length).toBe(2);
  expect(inputRules[0] instanceof InputRule).toBeTruthy();
  expect(inputRules[1] instanceof InputRule).toBeTruthy();

  const pasteRules = DateNode.config.addPasteRules.call(mockContext);
  expect(pasteRules.length).toBe(1);
  expect(pasteRules[0] instanceof PasteRule).toBeTruthy();
});

test('DateNode first input rule handler replaces valid date and trims surrounding spaces', () => {
  const schema = getSchema([StarterKit, Link, DateNode]);
  const mockContext = {
    name: 'dateNode',
    type: schema.nodes.dateNode
  };
  const inputRules = DateNode.config.addInputRules.call(mockContext);
  const rule = inputRules[0];

  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.text('12345678 2024-05-08 ')
    ])
  ]);
  const selection = TextSelection.create(doc, 21);
  const editorState = EditorState.create({ schema, doc, selection });

  let replacedWith = null;
  const tr = editorState.tr;
  const originalReplaceWith = tr.replaceWith.bind(tr);
  tr.replaceWith = function(from, to, node) {
    replacedWith = { from, to, node };
    return originalReplaceWith(from, to, node);
  };

  const state = createChainableState({ state: editorState, transaction: tr });

  const match = [' 2024-05-08 ', '2024-05-08'];
  const range = { from: 10, to: 22 };

  rule.handler({ state, range, match });

  expect(replacedWith).toBeTruthy();
  expect(replacedWith.from).toBe(11);
  expect(replacedWith.to).toBe(21);
  expect(replacedWith.node.type.name).toBe('dateNode');
  expect(replacedWith.node.attrs.date).toBe('2024-05-08');
});

test('DateNode first input rule handler skips conversion in code block', () => {
  const schema = getSchema([StarterKit, Link, DateNode]);
  const mockContext = {
    name: 'dateNode',
    type: schema.nodes.dateNode
  };
  const inputRules = DateNode.config.addInputRules.call(mockContext);
  const rule = inputRules[0];

  const doc = schema.node('doc', null, [
    schema.node('codeBlock', null, [
      schema.text('12345678 2024-05-08 ')
    ])
  ]);
  const selection = TextSelection.create(doc, 21);
  const editorState = EditorState.create({ schema, doc, selection });

  let replacedWith = null;
  const tr = editorState.tr;
  const originalReplaceWith = tr.replaceWith.bind(tr);
  tr.replaceWith = function(from, to, node) {
    replacedWith = { from, to, node };
    return originalReplaceWith(from, to, node);
  };

  const state = createChainableState({ state: editorState, transaction: tr });

  const match = [' 2024-05-08 ', '2024-05-08'];
  const range = { from: 10, to: 22 };

  rule.handler({ state, range, match });

  expect(replacedWith).toBeFalsy();
});

test('DateNode first input rule handler skips conversion when link mark exists in range', () => {
  const schema = getSchema([StarterKit, Link, DateNode]);
  const mockContext = {
    name: 'dateNode',
    type: schema.nodes.dateNode
  };
  const inputRules = DateNode.config.addInputRules.call(mockContext);
  const rule = inputRules[0];

  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.text('12345678'),
      schema.text(' 2024-05-08 ', [schema.mark('link', { href: 'http://example.com' })])
    ])
  ]);
  const selection = TextSelection.create(doc, 21);
  const editorState = EditorState.create({ schema, doc, selection });

  let replacedWith = null;
  const tr = editorState.tr;
  const originalReplaceWith = tr.replaceWith.bind(tr);
  tr.replaceWith = function(from, to, node) {
    replacedWith = { from, to, node };
    return originalReplaceWith(from, to, node);
  };

  const state = createChainableState({ state: editorState, transaction: tr });

  const match = [' 2024-05-08 ', '2024-05-08'];
  const range = { from: 10, to: 22 };

  rule.handler({ state, range, match });

  expect(replacedWith).toBeFalsy();
});

test('DateNode first input rule handler skips conversion when link mark exists in selection', () => {
  const schema = getSchema([StarterKit, Link, DateNode]);
  const mockContext = {
    name: 'dateNode',
    type: schema.nodes.dateNode
  };
  const inputRules = DateNode.config.addInputRules.call(mockContext);
  const rule = inputRules[0];

  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.text('12345678 2024-05-08'),
      schema.text(' ', [schema.mark('link', { href: 'http://example.com' })])
    ])
  ]);
  const selection = TextSelection.create(doc, 21);
  const editorState = EditorState.create({ schema, doc, selection });

  let replacedWith = null;
  const tr = editorState.tr;
  const originalReplaceWith = tr.replaceWith.bind(tr);
  tr.replaceWith = function(from, to, node) {
    replacedWith = { from, to, node };
    return originalReplaceWith(from, to, node);
  };

  const state = createChainableState({ state: editorState, transaction: tr });

  const match = [' 2024-05-08 ', '2024-05-08'];
  const range = { from: 10, to: 22 };

  rule.handler({ state, range, match });

  expect(replacedWith).toBeFalsy();
});

test('DateNode second input rule handler replaces // with today date', () => {
  const schema = getSchema([StarterKit, Link, DateNode]);
  const mockContext = {
    name: 'dateNode',
    type: schema.nodes.dateNode
  };
  const inputRules = DateNode.config.addInputRules.call(mockContext);
  const rule = inputRules[1];

  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.text('123//')
    ])
  ]);
  const selection = TextSelection.create(doc, 6);
  const editorState = EditorState.create({ schema, doc, selection });

  let replacedWith = null;
  const tr = editorState.tr;
  const originalReplaceWith = tr.replaceWith.bind(tr);
  tr.replaceWith = function(from, to, node) {
    replacedWith = { from, to, node };
    return originalReplaceWith(from, to, node);
  };

  const state = createChainableState({ state: editorState, transaction: tr });

  rule.handler({ state, range: { from: 5, to: 7 }, match: ['//'] });

  expect(replacedWith).toBeTruthy();
  expect(replacedWith.from).toBe(5);
  expect(replacedWith.to).toBe(7);
  expect(replacedWith.node.type.name).toBe('dateNode');
  const todayStr = new Date().toISOString().split('T')[0];
  expect(replacedWith.node.attrs.date).toBe(todayStr);
});

test('DateNode paste rule handler replaces valid date and trims surrounding spaces', () => {
  const schema = getSchema([StarterKit, Link, DateNode]);
  const mockContext = {
    name: 'dateNode',
    type: schema.nodes.dateNode
  };
  const pasteRules = DateNode.config.addPasteRules.call(mockContext);
  const rule = pasteRules[0];

  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.text('12345678 2024-05-08 ')
    ])
  ]);
  const selection = TextSelection.create(doc, 21);
  const editorState = EditorState.create({ schema, doc, selection });

  let replacedWith = null;
  const tr = editorState.tr;
  const originalReplaceWith = tr.replaceWith.bind(tr);
  tr.replaceWith = function(from, to, node) {
    replacedWith = { from, to, node };
    return originalReplaceWith(from, to, node);
  };

  const state = createChainableState({ state: editorState, transaction: tr });

  const match = [' 2024-05-08 ', '2024-05-08'];
  const range = { from: 10, to: 22 };

  rule.handler({ state, range, match });

  expect(replacedWith).toBeTruthy();
  expect(replacedWith.from).toBe(11);
  expect(replacedWith.to).toBe(21);
  expect(replacedWith.node.type.name).toBe('dateNode');
  expect(replacedWith.node.attrs.date).toBe('2024-05-08');
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
