/**
 * Unit tests for Editor Keymap (Delete & Backspace key behaviors) — src/editor/Keymap.test.js
 * Run with: node src/editor/Keymap.test.js
 */

import { getSchema } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Image } from '@tiptap/extension-image';
import { EditorState, Selection, TextSelection, NodeSelection } from '@tiptap/pm/state';
import { handleListMergeKeydown, handleShortcutKeydown, handleImageKeydown, findImagePos, deleteSelectedImage } from './editor.js';

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
    console.error(`    ${err.message}\n${err.stack}`);
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
    toBeTruthy() {
      if (!actual) throw new Error(`Expected truthy but got "${actual}"`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`Expected falsy but got "${actual}"`);
    },
    toContain(substr) {
      if (typeof actual === 'string' && !actual.includes(substr)) {
        throw new Error(`Expected "${actual}" to contain "${substr}"`);
      }
    },
    toNotContain(substr) {
      if (typeof actual === 'string' && actual.includes(substr)) {
        throw new Error(`Expected "${actual}" NOT to contain "${substr}"`);
      }
    }
  };
}

const schema = getSchema([
  StarterKit,
  TaskList,
  TaskItem,
  Table,
  TableRow,
  TableCell,
  TableHeader,
  Image.configure({ inline: true })
]);



function createMockView(docJSON, cursorFinder) {
  const doc = schema.nodeFromJSON(docJSON);
  let state = EditorState.create({ schema, doc });
  
  if (cursorFinder) {
    let cursorPos = null;
    doc.descendants((node, pos) => {
      if (cursorPos === null && cursorFinder(node, pos)) {
        cursorPos = pos;
        return false;
      }
    });
    if (cursorPos !== null) {
      state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, cursorPos)));
    }
  }

  const view = {
    get state() { return state; },
    dispatch(tr) {
      state = state.apply(tr);
    }
  };

  return view;
}

console.log('\n⌨️ Keymap Delete & Backspace Equivalent Reaction Coverage');

test('Delete at end of paragraph merges following list item and outdents nested sublist', () => {
  const docJSON = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Preceding paragraph' }]
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'First item' }]
              },
              {
                type: 'bulletList',
                content: [
                  {
                    type: 'listItem',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested item 1' }] }]
                  },
                  {
                    type: 'listItem',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested item 2' }] }]
                  }
                ]
              }
            ]
          },
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second item' }] }]
          }
        ]
      }
    ]
  };

  const view = createMockView(docJSON, (node, pos) => {
    return node.isText && node.text === 'Preceding paragraph';
  });
  // Place cursor at the END of "Preceding paragraph"
  const paraEnd = view.state.selection.$from.pos + 'Preceding paragraph'.length;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, paraEnd)));

  const handled = handleListMergeKeydown(view, { key: 'Delete' });
  expect(handled).toBeTruthy();

  const text = view.state.doc.textContent;
  expect(text).toContain('Preceding paragraphFirst item');
  expect(text).toContain('Nested item 1');
  expect(text).toContain('Nested item 2');
  expect(text).toContain('Second item');

  // Verify paragraph node now contains merged text
  const firstChild = view.state.doc.child(0);
  expect(firstChild.type.name).toBe('paragraph');
  expect(firstChild.textContent).toBe('Preceding paragraphFirst item');

  // Verify second child is bulletList with Nested item 1, 2, and Second item
  const listChild = view.state.doc.child(1);
  expect(listChild.type.name).toBe('bulletList');
  expect(listChild.childCount).toBe(3);
  expect(listChild.child(0).textContent).toBe('Nested item 1');
  expect(listChild.child(1).textContent).toBe('Nested item 2');
  expect(listChild.child(2).textContent).toBe('Second item');
});

test('Delete at end of list item merges following list item text', () => {
  const docJSON = {
    type: 'doc',
    content: [
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First item' }] }]
          },
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second item' }] }]
          }
        ]
      }
    ]
  };

  const view = createMockView(docJSON, (node) => node.isText && node.text === 'First item');
  const endPos = view.state.selection.$from.pos + 'First item'.length;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, endPos)));

  const handled = handleListMergeKeydown(view, { key: 'Delete' });
  expect(handled).toBeTruthy();

  const list = view.state.doc.child(0);
  expect(list.childCount).toBe(1);
  expect(list.child(0).textContent).toBe('First itemSecond item');
});

test('Delete at end of outer item merges nested child and promotes deeper sublists', () => {
  const docJSON = {
    type: 'doc',
    content: [
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Outer item' }]
              },
              {
                type: 'bulletList',
                content: [
                  {
                    type: 'listItem',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested item' }] }]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const view = createMockView(docJSON, (node) => node.isText && node.text === 'Outer item');
  const endPos = view.state.selection.$from.pos + 'Outer item'.length;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, endPos)));

  const handled = handleListMergeKeydown(view, { key: 'Delete' });
  expect(handled).toBeTruthy();

  const list = view.state.doc.child(0);
  expect(list.childCount).toBe(1);
  expect(list.child(0).textContent).toBe('Outer itemNested item');
});

test('Delete at end of first paragraph in multi-paragraph list item merges second paragraph', () => {
  const docJSON = {
    type: 'doc',
    content: [
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Paragraph 1' }]
              },
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Paragraph 2' }]
              }
            ]
          }
        ]
      }
    ]
  };

  const view = createMockView(docJSON, (node) => node.isText && node.text === 'Paragraph 1');
  const endPos = view.state.selection.$from.pos + 'Paragraph 1'.length;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, endPos)));

  const handled = handleListMergeKeydown(view, { key: 'Delete' });
  expect(handled).toBeTruthy();

  const list = view.state.doc.child(0);
  expect(list.childCount).toBe(1);
  expect(list.child(0).childCount).toBe(1);
  expect(list.child(0).textContent).toBe('Paragraph 1Paragraph 2');
});

test('Delete at end of last list item merges following outside paragraph', () => {
  const docJSON = {
    type: 'doc',
    content: [
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Last item' }] }]
          }
        ]
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Outside paragraph' }]
      }
    ]
  };

  const view = createMockView(docJSON, (node) => node.isText && node.text === 'Last item');
  const endPos = view.state.selection.$from.pos + 'Last item'.length;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, endPos)));

  const handled = handleListMergeKeydown(view, { key: 'Delete' });
  expect(handled).toBeTruthy();

  expect(view.state.doc.childCount).toBe(1);
  expect(view.state.doc.child(0).textContent).toBe('Last itemOutside paragraph');
});

test('Delete at end of paragraph outside table does not merge inside table', () => {
  const docJSON = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Outside Paragraph' }]
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Inside Cell' }]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const view = createMockView(docJSON, (node) => node.isText && node.text === 'Outside Paragraph');
  const endPos = view.state.selection.$from.pos + 'Outside Paragraph'.length;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, endPos)));

  const handled = handleListMergeKeydown(view, { key: 'Delete' });
  expect(handled).toBeFalsy();
  expect(view.state.doc.textContent).toBe('Outside ParagraphInside Cell');
});

test('Backspace at start of list item inside table cell does not merge outside table', () => {
  const docJSON = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Outside Paragraph' }]
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [
                  {
                    type: 'bulletList',
                    content: [
                      {
                        type: 'listItem',
                        content: [
                          {
                            type: 'paragraph',
                            content: [{ type: 'text', text: 'Inside List Item' }]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const view = createMockView(docJSON, (node) => node.isText && node.text === 'Inside List Item');
  const startPos = view.state.selection.$from.pos;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, startPos)));

  const handled = handleListMergeKeydown(view, { key: 'Backspace' });
  expect(handled).toBeFalsy();
  expect(view.state.doc.textContent).toBe('Outside ParagraphInside List Item');
});

test('Delete at end of paragraph before a single-item list removes the emptied list', () => {
  const docJSON = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Para' }]
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Only' }] }]
          }
        ]
      }
    ]
  };

  const view = createMockView(docJSON, (node) => node.isText && node.text === 'Para');
  const endPos = view.state.selection.$from.pos + 'Para'.length;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, endPos)));

  const handled = handleListMergeKeydown(view, { key: 'Delete' });
  expect(handled).toBeTruthy();

  expect(view.state.doc.childCount).toBe(1);
  const firstChild = view.state.doc.child(0);
  expect(firstChild.type.name).toBe('paragraph');
  expect(firstChild.textContent).toBe('ParaOnly');

  const types = [];
  view.state.doc.descendants((node) => {
    types.push(node.type.name);
  });
  expect(types.includes('bulletList')).toBe(false);
});

test('Delete before a single CHECKED task item leaves no unchecked ghost', () => {
  const docJSON = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Para' }]
      },
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: true },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Done' }] }]
          }
        ]
      }
    ]
  };

  const view = createMockView(docJSON, (node) => node.isText && node.text === 'Para');
  const endPos = view.state.selection.$from.pos + 'Para'.length;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, endPos)));

  const handled = handleListMergeKeydown(view, { key: 'Delete' });
  expect(handled).toBeTruthy();

  expect(view.state.doc.childCount).toBe(1);
  expect(view.state.doc.textContent).toBe('ParaDone');

  const types = [];
  view.state.doc.descendants((node) => {
    types.push(node.type.name);
  });
  expect(types.includes('taskList')).toBe(false);
  expect(types.includes('taskItem')).toBe(false);
});

test('Delete before a single-paragraph blockquote removes the emptied blockquote', () => {
  const docJSON = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Para' }]
      },
      {
        type: 'blockquote',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'q1' }]
          }
        ]
      }
    ]
  };

  const view = createMockView(docJSON, (node) => node.isText && node.text === 'Para');
  const endPos = view.state.selection.$from.pos + 'Para'.length;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, endPos)));

  const handled = handleListMergeKeydown(view, { key: 'Delete' });
  expect(handled).toBeTruthy();

  expect(view.state.doc.childCount).toBe(1);
  expect(view.state.doc.textContent).toBe('Paraq1');

  const types = [];
  view.state.doc.descendants((node) => {
    types.push(node.type.name);
  });
  expect(types.includes('blockquote')).toBe(false);
});

test('Delete before a two-paragraph blockquote retains remaining blockquote paragraphs', () => {
  const docJSON = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Para' }]
      },
      {
        type: 'blockquote',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'q1' }]
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'q2' }]
          }
        ]
      }
    ]
  };

  const view = createMockView(docJSON, (node) => node.isText && node.text === 'Para');
  const endPos = view.state.selection.$from.pos + 'Para'.length;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, endPos)));

  const handled = handleListMergeKeydown(view, { key: 'Delete' });
  expect(handled).toBeTruthy();

  expect(view.state.doc.childCount).toBe(2);
  const firstChild = view.state.doc.child(0);
  expect(firstChild.type.name).toBe('paragraph');
  expect(firstChild.textContent).toBe('Paraq1');

  const secondChild = view.state.doc.child(1);
  expect(secondChild.type.name).toBe('blockquote');
  expect(secondChild.childCount).toBe(1);
  expect(secondChild.child(0).textContent).toBe('q2');
});

test('Backspace at start of the only item in a list removes the emptied list', () => {
  const docJSON = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Para' }]
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Only' }] }]
          }
        ]
      }
    ]
  };

  const view = createMockView(docJSON, (node) => node.isText && node.text === 'Only');
  const startPos = view.state.selection.$from.pos;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, startPos)));

  const handled = handleListMergeKeydown(view, { key: 'Backspace' });
  expect(handled).toBeTruthy();

  expect(view.state.doc.childCount).toBe(1);
  const firstChild = view.state.doc.child(0);
  expect(firstChild.type.name).toBe('paragraph');
  expect(firstChild.textContent).toBe('ParaOnly');

  const types = [];
  view.state.doc.descendants((node) => {
    types.push(node.type.name);
  });
  expect(types.includes('bulletList')).toBe(false);
});

console.log('\n⌨️ Shortcut Keymap (Ctrl+Shift+1..6 & Headings)');

function createMockShortcutEditor() {
  const calls = [];
  const editor = {
    chain() {
      return {
        focus() {
          return {
            toggleHeading(opts) {
              calls.push({ name: 'toggleHeading', opts });
              return { run() { return true; } };
            },
            setParagraph() {
              calls.push({ name: 'setParagraph' });
              return { run() { return true; } };
            },
            toggleCodeBlock() {
              calls.push({ name: 'toggleCodeBlock' });
              return { run() { return true; } };
            },
            setHorizontalRule() {
              calls.push({ name: 'setHorizontalRule' });
              return { run() { return true; } };
            }
          };
        }
      };
    }
  };
  return { editor, calls };
}

test('Ctrl+Shift+1 triggers toggleHeading level 1', () => {
  const { editor, calls } = createMockShortcutEditor();
  let prevented = false;
  const event = { ctrlKey: true, shiftKey: true, altKey: false, code: 'Digit1', preventDefault: () => { prevented = true; } };
  const handled = handleShortcutKeydown(editor, event);
  expect(handled).toBeTruthy();
  expect(prevented).toBeTruthy();
  expect(calls.length).toBe(1);
  expect(calls[0].name).toBe('toggleHeading');
  expect(calls[0].opts.level).toBe(1);
});

test('Ctrl+Shift+2 triggers toggleHeading level 2', () => {
  const { editor, calls } = createMockShortcutEditor();
  const event = { ctrlKey: true, shiftKey: true, altKey: false, code: 'Digit2', preventDefault: () => {} };
  const handled = handleShortcutKeydown(editor, event);
  expect(handled).toBeTruthy();
  expect(calls.length).toBe(1);
  expect(calls[0].name).toBe('toggleHeading');
  expect(calls[0].opts.level).toBe(2);
});

test('Ctrl+Shift+3 triggers toggleHeading level 3', () => {
  const { editor, calls } = createMockShortcutEditor();
  const event = { ctrlKey: true, shiftKey: true, altKey: false, code: 'Digit3', preventDefault: () => {} };
  const handled = handleShortcutKeydown(editor, event);
  expect(handled).toBeTruthy();
  expect(calls.length).toBe(1);
  expect(calls[0].name).toBe('toggleHeading');
  expect(calls[0].opts.level).toBe(3);
});

test('Cmd+Shift+1 on Mac triggers toggleHeading level 1', () => {
  const { editor, calls } = createMockShortcutEditor();
  const event = { metaKey: true, shiftKey: true, altKey: false, code: 'Digit1', preventDefault: () => {} };
  const handled = handleShortcutKeydown(editor, event);
  expect(handled).toBeTruthy();
  expect(calls.length).toBe(1);
  expect(calls[0].opts.level).toBe(1);
});

test('Ctrl+Shift+4..6 trigger heading levels 4, 5, 6 and 0 sets paragraph', () => {
  for (let lvl = 4; lvl <= 6; lvl++) {
    const { editor, calls } = createMockShortcutEditor();
    const event = { ctrlKey: true, shiftKey: true, altKey: false, code: `Digit${lvl}`, preventDefault: () => {} };
    const handled = handleShortcutKeydown(editor, event);
    expect(handled).toBeTruthy();
    expect(calls[0].opts.level).toBe(lvl);
  }

  const { editor: ed0, calls: calls0 } = createMockShortcutEditor();
  const event0 = { ctrlKey: true, shiftKey: true, altKey: false, code: 'Digit0', preventDefault: () => {} };
  const handled0 = handleShortcutKeydown(ed0, event0);
  expect(handled0).toBeTruthy();
  expect(calls0[0].name).toBe('setParagraph');
});

test('Ctrl+Alt+C still toggles a code block', () => {
  const { editor, calls } = createMockShortcutEditor();
  const eventCode = { ctrlKey: true, altKey: true, shiftKey: false, code: 'KeyC', preventDefault: () => {} };
  expect(handleShortcutKeydown(editor, eventCode)).toBeTruthy();
  expect(calls[0].name).toBe('toggleCodeBlock');
});

// Windows reports AltGr as Ctrl+Alt. On the Swiss German layout AltGr+2 is `@`
// and AltGr+3 is `#`, so Ctrl+Alt+digit must fall through to the browser or
// @mentions become impossible to type.
test('Ctrl+Alt+digit is not intercepted, so AltGr characters still reach the editor', () => {
  for (const digit of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit0']) {
    const { editor, calls } = createMockShortcutEditor();
    let prevented = false;
    const event = { ctrlKey: true, altKey: true, shiftKey: false, code: digit, preventDefault: () => { prevented = true; } };
    expect(handleShortcutKeydown(editor, event)).toBeFalsy();
    expect(prevented).toBeFalsy();
    expect(calls.length).toBe(0);
  }
});

test('Non-matching keys return false', () => {
  const { editor, calls } = createMockShortcutEditor();
  const event = { ctrlKey: false, shiftKey: false, altKey: false, code: 'KeyA' };
  expect(handleShortcutKeydown(editor, event)).toBeFalsy();
  expect(calls.length).toBe(0);
});

console.log('\n🖼️ Image Selection and Deletion Reaction Coverage');

test('findImagePos resolves image position correctly', () => {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.text('Hello '),
      schema.node('image', { src: 'https://example.com/test.png' }),
      schema.text(' world')
    ])
  ]);
  expect(findImagePos(doc, 7)).toBe(7);
  expect(findImagePos(doc, 8)).toBe(7);
  expect(findImagePos(doc, 0)).toBe(null);
  expect(findImagePos(doc, -1)).toBe(null);
  expect(findImagePos(doc, 100)).toBe(null);
});

test('handleImageKeydown: Backspace and Delete remove selected image node (NodeSelection)', () => {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.node('image', { src: 'https://example.com/screenshot.png' })
    ])
  ]);

  // Backspace with NodeSelection
  let state = EditorState.create({ doc, schema });
  state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 1)));
  let prevented = false;
  const view1 = {
    get state() { return state; },
    dispatch(tr) { state = state.apply(tr); }
  };
  const handled1 = handleImageKeydown(view1, { key: 'Backspace', preventDefault: () => { prevented = true; } });
  expect(handled1).toBeTruthy();
  expect(prevented).toBeTruthy();
  expect(state.doc.toString()).toBe('doc(paragraph)');

  // Delete with NodeSelection
  let state2 = EditorState.create({ doc, schema });
  state2 = state2.apply(state2.tr.setSelection(NodeSelection.create(state2.doc, 1)));
  let prevented2 = false;
  const view2 = {
    get state() { return state2; },
    dispatch(tr) { state2 = state2.apply(tr); }
  };
  const handled2 = handleImageKeydown(view2, { key: 'Delete', preventDefault: () => { prevented2 = true; } });
  expect(handled2).toBeTruthy();
  expect(prevented2).toBeTruthy();
  expect(state2.doc.toString()).toBe('doc(paragraph)');
});

test('handleImageKeydown: Backspace removes image immediately preceding the caret (nodeBefore)', () => {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.node('image', { src: 'https://example.com/screenshot.png' })
    ])
  ]);
  // Caret at pos 2 (after the image)
  let state = EditorState.create({ doc, schema, selection: TextSelection.create(doc, 2) });
  let prevented = false;
  const view = {
    get state() { return state; },
    dispatch(tr) { state = state.apply(tr); }
  };
  const handled = handleImageKeydown(view, { key: 'Backspace', preventDefault: () => { prevented = true; } });
  expect(handled).toBeTruthy();
  expect(prevented).toBeTruthy();
  expect(state.doc.toString()).toBe('doc(paragraph)');
});

test('handleImageKeydown: Delete removes image immediately following the caret (nodeAfter)', () => {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.node('image', { src: 'https://example.com/screenshot.png' })
    ])
  ]);
  // Caret at pos 1 (before the image)
  let state = EditorState.create({ doc, schema, selection: TextSelection.create(doc, 1) });
  let prevented = false;
  const view = {
    get state() { return state; },
    dispatch(tr) { state = state.apply(tr); }
  };
  const handled = handleImageKeydown(view, { key: 'Delete', preventDefault: () => { prevented = true; } });
  expect(handled).toBeTruthy();
  expect(prevented).toBeTruthy();
  expect(state.doc.toString()).toBe('doc(paragraph)');
});

test('handleImageKeydown: Unrelated key does not delete image and returns false', () => {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.node('image', { src: 'https://example.com/screenshot.png' })
    ])
  ]);
  let state = EditorState.create({ doc, schema, selection: TextSelection.create(doc, 2) });
  let prevented = false;
  const view = {
    get state() { return state; },
    dispatch(tr) { state = state.apply(tr); }
  };
  const handled = handleImageKeydown(view, { key: 'Enter', preventDefault: () => { prevented = true; } });
  expect(handled).toBeFalsy();
  expect(prevented).toBeFalsy();
  expect(state.doc.toString()).toBe('doc(paragraph(image))');
});

test('handleImageKeydown: Caret before image with Backspace falls through to default', () => {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.node('image', { src: 'https://example.com/screenshot.png' })
    ])
  ]);
  // Caret at pos 1 (before image). Backspace should NOT delete image behind it.
  let state = EditorState.create({ doc, schema, selection: TextSelection.create(doc, 1) });
  const view = {
    get state() { return state; },
    dispatch(tr) { state = state.apply(tr); }
  };
  const handled = handleImageKeydown(view, { key: 'Backspace' });
  expect(handled).toBeFalsy();
  expect(state.doc.toString()).toBe('doc(paragraph(image))');
});

test('handleImageKeydown: Caret after image with Delete falls through to default', () => {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.node('image', { src: 'https://example.com/screenshot.png' })
    ])
  ]);
  // Caret at pos 2 (after image). Delete should NOT delete image ahead of it.
  let state = EditorState.create({ doc, schema, selection: TextSelection.create(doc, 2) });
  const view = {
    get state() { return state; },
    dispatch(tr) { state = state.apply(tr); }
  };
  const handled = handleImageKeydown(view, { key: 'Delete' });
  expect(handled).toBeFalsy();
  expect(state.doc.toString()).toBe('doc(paragraph(image))');
});

// y-prosemirror rebuilds the pre-transaction selection after every observed
// change, and its NodeSelection branch is unguarded. Deleting the very node that
// selection points at is what threw "Cannot read properties of null (reading
// 'nodeSize')" on every image delete, so the selection must be collapsed in a
// separate transaction first.
test('deleting a selected image collapses the NodeSelection before removing it', () => {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.text('as soon'),
      schema.node('image', { src: 'https://example.com/screenshot.png' })
    ])
  ]);

  let state = EditorState.create({ doc, schema });
  state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 8)));
  expect(state.selection instanceof NodeSelection).toBeTruthy();

  const seen = [];
  const view = {
    get state() { return state; },
    dispatch(tr) {
      seen.push(state.selection.constructor.name);
      state = state.apply(tr);
    }
  };

  const handled = handleImageKeydown(view, { key: 'Backspace', preventDefault: () => {} });
  expect(handled).toBeTruthy();

  // Two dispatches: collapse, then delete. The delete must not be preceded by a
  // NodeSelection.
  expect(seen.length).toBe(2);
  expect(seen[0]).toBe('NodeSelection');
  expect(seen[1]).toBe('TextSelection');

  expect(state.doc.toString()).toBe('doc(paragraph("as soon"))');
  expect(state.selection instanceof NodeSelection).toBeFalsy();
});

test('deleteSelectedImage returns false when the selection is not an image', () => {
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('kein Bild')])]);
  let state = EditorState.create({ doc, schema });
  const view = { get state() { return state; }, dispatch(tr) { state = state.apply(tr); } };
  expect(deleteSelectedImage(view)).toBeFalsy();
  expect(state.doc.toString()).toBe('doc(paragraph("kein Bild"))');
});

console.log(`\n────────────────────────────────────────\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('✅ All keymap tests passed!');
}
