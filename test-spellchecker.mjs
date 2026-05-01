import { SpellCheckerBot } from './src/editor/SpellCheckerBot.js';
import { EditorState } from 'prosemirror-state';
import { schema } from 'prosemirror-schema-basic';

// Mock Provider
const mockProvider = { pageId: 'test' };

// Mock fetch
global.fetch = async () => ({
  ok: true,
  json: async () => ({
    candidates: [{ content: { parts: [{ text: 'corrected' }] } }]
  })
});

// To track what was corrected
let correctedQueue = [];

class MockSpellChecker extends SpellCheckerBot {
  constructor(editor, provider) {
    super(editor, provider);
  }
  
  async _correctWord(word, startPos, endPos, posKey, contextBefore, contextAfter) {
    correctedQueue.push({ word, startPos, endPos, posKey });
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runTests() {
  console.log('--- Running Intensive Autocorrect Tests ---');
  let testsPassed = 0;
  let testsFailed = 0;

  function assertEqual(actual, expected, msg) {
    if (actual === expected) {
      console.log(`✅ [PASS] ${msg} (got: ${actual})`);
      testsPassed++;
    } else {
      console.error(`❌ [FAIL] ${msg}`);
      console.error(`   Expected: ${expected}`);
      console.error(`   Actual:   ${actual}`);
      testsFailed++;
    }
  }

  async function simulateTyping(text, insertPos = null, splitBlock = false) {
    correctedQueue = [];
    let state = EditorState.create({ schema });
    let editor = {
      state,
      on: () => {},
      off: () => {}
    };
    const bot = new MockSpellChecker(editor, mockProvider);
    
    // Initial insert
    let trFinal;
    if (splitBlock) {
      // First insert text
      const tr = state.tr.insertText(text);
      state = state.apply(tr);
      // Then split
      trFinal = state.tr.split(state.selection.from);
    } else {
      // Create a transaction that inserts the text
      trFinal = state.tr;
      if (insertPos === null) {
        trFinal = trFinal.insertText(text);
      } else {
        trFinal = trFinal.insertText(text, insertPos);
      }
    }
    
    // Simulate transaction
    editor.state = state.apply(trFinal);
    bot._onTransaction({ transaction: trFinal });
    
    await sleep(600); // wait for DEBOUNCE_MS
    
    return correctedQueue.length > 0 ? correctedQueue[0] : null;
  }

  // 1. Enter on word end
  const res1 = await simulateTyping("hello", null, true);
  assertEqual(res1 ? res1.word : null, "hello", "Should extract word before Enter");

  // 2. Space on word end
  const res2 = await simulateTyping("world ");
  assertEqual(res2 ? res2.word : null, "world", "Should extract word before Space");

  // 3. Parentheses on word start
  const res3 = await simulateTyping("(test ");
  assertEqual(res3 ? res3.word : null, "test", "Should extract word ignoring leading parenthesis");
  assertEqual(res3 ? res3.startPos : null, 2, "Start position should account for leading parenthesis");

  // 4. Word surrounded by parentheses
  const res4 = await simulateTyping("(wrapped) ");
  assertEqual(res4 ? res4.word : null, "wrapped", "Should ignore surrounding parentheses");
  assertEqual(res4 ? res4.startPos : null, 2, "Start position should ignore leading '('");

  // 5. Punctuation at the start and Enter
  const res5 = await simulateTyping("«hello»", null, true);
  assertEqual(res5 ? res5.word : null, "hello", "Should handle guillemets and Enter");
  assertEqual(res5 ? res5.startPos : null, 2, "Start position should ignore leading '«'");

  // 6. Enter at word end on a new line
  correctedQueue = [];
  let state = EditorState.create({ schema });
  let tr = state.tr.insertText("first");
  state = state.apply(tr);
  tr = state.tr.split(state.selection.from);
  state = state.apply(tr);
  tr = state.tr.insertText("second");
  state = state.apply(tr);
  let editor = { state, on: () => {}, off: () => {} };
  const bot = new MockSpellChecker(editor, mockProvider);
  tr = state.tr.split(state.selection.from);
  editor.state = state.apply(tr);
  bot._onTransaction({ transaction: tr });
  await sleep(600);
  assertEqual(correctedQueue[0] ? correctedQueue[0].word : null, "second", "Should handle Enter on second paragraph");

  console.log(`\nResults: ${testsPassed} passed, ${testsFailed} failed`);
  if (testsFailed > 0) process.exit(1);
}

runTests();
