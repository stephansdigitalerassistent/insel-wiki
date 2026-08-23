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
import { EditorState, Selection, TextSelection } from '@tiptap/pm/state';
import { handleListMergeKeydown } from './editor.js';

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
  TableHeader
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

console.log(`\n────────────────────────────────────────\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('✅ All keymap tests passed!');
}
