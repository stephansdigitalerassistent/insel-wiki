/**
 * Unit tests for VoiceGhost — src/editor/VoiceGhost.js
 * Run with: node src/editor/VoiceGhost.test.js
 *
 * Simple test runner — no framework needed (matches tests/utils.test.js).
 */

// Define mock globals before imports to handle environment dependencies in Node
global.window = {};
Object.defineProperty(global, 'navigator', {
  value: {
    userAgent: 'node.js',
  },
  configurable: true,
  writable: true,
});
global.document = {
  documentElement: {
    style: {},
  },
  createElement(name) {
    return {
      tagName: name.toUpperCase(),
      className: '',
      textContent: '',
    };
  }
};

const { VoiceGhost } = await import('./VoiceGhost.js');
const { getSchema } = await import('@tiptap/core');
const { StarterKit } = await import('@tiptap/starter-kit');
const { EditorState, TextSelection } = await import('@tiptap/pm/state');
const { DecorationSet } = await import('@tiptap/pm/view');

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
// 👻 VoiceGhost Unit Coverage
// ──────────────────────────────────────────────
console.log('\n👻 VoiceGhost Unit Coverage');

test('VoiceGhost extension name is correct', () => {
  expect(VoiceGhost.name).toBe('voiceGhost');
});

test('VoiceGhost configuration has expected hooks', () => {
  expect(typeof VoiceGhost.config.addOptions).toBe('function');
  expect(typeof VoiceGhost.config.addStorage).toBe('function');
  expect(typeof VoiceGhost.config.addCommands).toBe('function');
  expect(typeof VoiceGhost.config.addProseMirrorPlugins).toBe('function');
});

test('VoiceGhost has default options', () => {
  const options = VoiceGhost.config.addOptions();
  expect(options.HTMLAttributes).toBeTruthy();
  expect(options.HTMLAttributes.class).toBe('voice-ghost-text');
});

test('VoiceGhost has default empty storage transcript', () => {
  const storage = VoiceGhost.config.addStorage();
  expect(storage.transcript).toBe('');
});

test('VoiceGhost setVoiceTranscript command updates storage', () => {
  const storage = { transcript: '' };
  const mockEditor = {
    storage: {
      voiceGhost: storage
    }
  };
  const commands = VoiceGhost.config.addCommands();
  const result = commands.setVoiceTranscript('hello dictation')({ editor: mockEditor });
  expect(result).toBe(true);
  expect(storage.transcript).toBe('hello dictation');
});

test('VoiceGhost ProseMirror plugin returns DecorationSet.empty when transcript is empty', () => {
  const mockStorage = { transcript: '' };
  const plugins = VoiceGhost.config.addProseMirrorPlugins.call({ storage: mockStorage });
  expect(plugins.length).toBe(1);
  const plugin = plugins[0];

  const schema = getSchema([StarterKit, VoiceGhost]);
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.text('hello world')
    ])
  ]);
  const selection = TextSelection.create(doc, 1);
  const state = EditorState.create({ schema, doc, selection });

  const decos = plugin.spec.props.decorations(state);
  expect(decos).toBe(DecorationSet.empty);
});

test('VoiceGhost ProseMirror plugin returns widget decoration at cursor when transcript is set', () => {
  const mockStorage = { transcript: 'interim text' };
  const plugins = VoiceGhost.config.addProseMirrorPlugins.call({ storage: mockStorage });
  const plugin = plugins[0];

  const schema = getSchema([StarterKit, VoiceGhost]);
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.text('hello world')
    ])
  ]);
  const cursorPosition = 6; // middle of document
  const selection = TextSelection.create(doc, cursorPosition);
  const state = EditorState.create({ schema, doc, selection });

  const decos = plugin.spec.props.decorations(state);
  const found = decos.find();
  expect(found.length).toBe(1);

  const deco = found[0];
  expect(deco.from).toBe(cursorPosition);
  expect(deco.to).toBe(cursorPosition);
  expect(deco.type.spec.side).toBe(1);
  expect(JSON.stringify(deco.type.spec.marks)).toBe('[]');

  // Test rendering DOM element via toDOM function
  const domFn = deco.type.toDOM;
  expect(typeof domFn).toBe('function');
  const dom = domFn();
  expect(dom.tagName).toBe('SPAN');
  expect(dom.className).toBe('voice-ghost-text');
  expect(dom.textContent).toBe('interim text');
});

test('VoiceGhost ProseMirror plugin decoration moves when selection changes', () => {
  const mockStorage = { transcript: 'interim text' };
  const plugins = VoiceGhost.config.addProseMirrorPlugins.call({ storage: mockStorage });
  const plugin = plugins[0];

  const schema = getSchema([StarterKit, VoiceGhost]);
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.text('hello world')
    ])
  ]);

  // Cursor at start (position 1)
  const selection1 = TextSelection.create(doc, 1);
  const state1 = EditorState.create({ schema, doc, selection: selection1 });
  const decos1 = plugin.spec.props.decorations(state1).find();
  expect(decos1.length).toBe(1);
  expect(decos1[0].from).toBe(1);

  // Cursor moves to position 12
  const selection2 = TextSelection.create(doc, 12);
  const state2 = EditorState.create({ schema, doc, selection: selection2 });
  const decos2 = plugin.spec.props.decorations(state2).find();
  expect(decos2.length).toBe(1);
  expect(decos2[0].from).toBe(12);
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
