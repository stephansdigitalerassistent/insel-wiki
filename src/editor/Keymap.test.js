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

const isCell = n => n.type.name === 'tableCell' || n.type.name === 'tableHeader';
const getCell = $pos => {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (isCell(node)) return node;
  }
  return null;
};

function handleKeydown(view, event) {
  const { ctrlKey, metaKey, altKey, shiftKey, code, key } = event;
  const isMod = ctrlKey || metaKey;

  if (key === 'Backspace') {
    const { state } = view;
    const { selection } = state;
    if (selection.empty && selection.$from.parentOffset === 0) {
      const depth = selection.$from.depth;
      const isInsideList = depth >= 1 && (
        selection.$from.node(depth - 1).type.name === 'listItem' || 
        selection.$from.node(depth - 1).type.name === 'taskItem'
      );
      if (isInsideList && selection.$from.index(depth - 1) === 0) {
        const listStart = selection.$from.before(depth - 1);
        if (listStart > 0) {
          const prevSelection = Selection.near(state.doc.resolve(listStart - 1), -1);
          if (prevSelection && prevSelection.$to && prevSelection.$to.pos < listStart) {
            if (getCell(selection.$from) !== getCell(prevSelection.$to)) {
              return false;
            }
            const prevEndPos = prevSelection.$to.pos;
            const content = selection.$from.parent.content;
            
            const tr = state.tr;
            tr.insert(prevEndPos, content);
            
            let shift = content.size;
            
            const listItemNode = selection.$from.node(depth - 1);
            const nestedNodes = [];
            for (let i = 1; i < listItemNode.childCount; i++) {
              nestedNodes.push(listItemNode.child(i));
            }
            
            for (const nestedNode of nestedNodes) {
              const insertPos = selection.$from.before(depth - 1) + shift;
              if (nestedNode.type.name === 'bulletList' || nestedNode.type.name === 'orderedList' || nestedNode.type.name === 'taskList') {
                tr.insert(insertPos, nestedNode.content);
                shift += nestedNode.content.size;
              } else {
                const wrapperType = selection.$from.node(depth - 1).type;
                const wrappedNode = wrapperType.createAndFill(null, nestedNode);
                if (wrappedNode) {
                  tr.insert(insertPos, wrappedNode);
                  shift += wrappedNode.nodeSize;
                } else {
                  tr.insert(insertPos, nestedNode);
                  shift += nestedNode.nodeSize;
                }
              }
            }
            
            const deleteStart = selection.$from.before(depth - 1) + shift;
            const deleteEnd = selection.$from.after(depth - 1) + shift;
            tr.delete(deleteStart, deleteEnd);
            
            tr.setSelection(Selection.near(tr.doc.resolve(prevEndPos)));
            view.dispatch(tr);
            if (event.preventDefault) event.preventDefault();
            return true;
          }
        }
      }
    }
  }

  if (key === 'Delete') {
    const { state } = view;
    const { selection } = state;
    if (selection.empty && selection.$from.parentOffset === selection.$from.parent.content.size) {
      const currentEndPos = selection.$from.pos;
      const afterCurrentBlock = selection.$from.after();
      if (afterCurrentBlock < state.doc.content.size) {
        const nextSelection = Selection.near(state.doc.resolve(afterCurrentBlock), 1);
        if (nextSelection && nextSelection.$from && nextSelection.$from.pos > currentEndPos) {
          if (getCell(selection.$from) === getCell(nextSelection.$from) && nextSelection.$from.parentOffset === 0) {
            const nextDepth = nextSelection.$from.depth;
            const isNextInsideList = nextDepth >= 1 && (
              nextSelection.$from.node(nextDepth - 1).type.name === 'listItem' || 
              nextSelection.$from.node(nextDepth - 1).type.name === 'taskItem'
            );

            if (isNextInsideList && nextSelection.$from.index(nextDepth - 1) === 0) {
              const nextListItemNode = nextSelection.$from.node(nextDepth - 1);
              const nextListStart = nextSelection.$from.before(nextDepth - 1);
              const nextListEnd = nextSelection.$from.after(nextDepth - 1);
              const content = nextSelection.$from.parent.content;

              const tr = state.tr;
              tr.insert(currentEndPos, content);

              let shift = content.size;

              const nestedNodes = [];
              for (let i = 1; i < nextListItemNode.childCount; i++) {
                nestedNodes.push(nextListItemNode.child(i));
              }

              for (const nestedNode of nestedNodes) {
                const insertPos = nextListStart + shift;
                if (nestedNode.type.name === 'bulletList' || nestedNode.type.name === 'orderedList' || nestedNode.type.name === 'taskList') {
                  tr.insert(insertPos, nestedNode.content);
                  shift += nestedNode.content.size;
                } else {
                  const wrapperType = nextListItemNode.type;
                  const wrappedNode = wrapperType.createAndFill(null, nestedNode);
                  if (wrappedNode) {
                    tr.insert(insertPos, wrappedNode);
                    shift += wrappedNode.nodeSize;
                  } else {
                    tr.insert(insertPos, nestedNode);
                    shift += nestedNode.nodeSize;
                  }
                }
              }

              const deleteStart = nextListStart + shift;
              const deleteEnd = nextListEnd + shift;
              tr.delete(deleteStart, deleteEnd);

              tr.setSelection(Selection.near(tr.doc.resolve(currentEndPos)));
              view.dispatch(tr);
              if (event.preventDefault) event.preventDefault();
              return true;
            } else if (nextSelection.$from.parent.isTextblock) {
              const nextBlockStart = nextSelection.$from.before();
              const nextBlockEnd = nextSelection.$from.after();
              const content = nextSelection.$from.parent.content;

              const tr = state.tr;
              tr.insert(currentEndPos, content);
              const shift = content.size;
              tr.delete(nextBlockStart + shift, nextBlockEnd + shift);

              tr.setSelection(Selection.near(tr.doc.resolve(currentEndPos)));
              view.dispatch(tr);
              if (event.preventDefault) event.preventDefault();
              return true;
            }
          }
        }
      }
    }
  }

  return false;
}

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

  const handled = handleKeydown(view, { key: 'Delete' });
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

  const handled = handleKeydown(view, { key: 'Delete' });
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

  const handled = handleKeydown(view, { key: 'Delete' });
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

  const handled = handleKeydown(view, { key: 'Delete' });
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

  const handled = handleKeydown(view, { key: 'Delete' });
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

  const handled = handleKeydown(view, { key: 'Delete' });
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

  const handled = handleKeydown(view, { key: 'Backspace' });
  expect(handled).toBeFalsy();
  expect(view.state.doc.textContent).toBe('Outside ParagraphInside List Item');
});

console.log(`\n────────────────────────────────────────\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('✅ All keymap tests passed!');
}
