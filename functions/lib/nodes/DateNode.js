// Schema-only mirror of src/editor/DateNode.js. The browser version renders a
// rich node-view (<input type="date">); server-side we only need the schema and
// the static renderHTML so generateHTML() emits the same
// `<span data-type="date">YYYY-MM-DD</span>` the Turndown `dateNode` rule keys on.
//
// MAINTENANCE CONTRACT: keep name/group/inline/atom + addAttributes/parseHTML/
// renderHTML in sync with src/editor/DateNode.js. Input/paste rules and the
// node-view are browser-only and intentionally dropped.
import { Node, mergeAttributes } from '@tiptap/core';

export const DateNode = Node.create({
  name: 'dateNode',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      date: {
        default: new Date().toISOString().split('T')[0],
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="date"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'date' }), HTMLAttributes.date];
  },
});
