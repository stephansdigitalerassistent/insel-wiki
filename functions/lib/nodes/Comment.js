// Schema-only mirror of src/editor/Comment.js — used server-side to give the
// headless Tiptap schema the `comment` mark so generateHTML() won't reject docs
// that contain commented ranges.
//
// MAINTENANCE CONTRACT: keep addAttributes/parseHTML/renderHTML in sync with
// src/editor/Comment.js. Commands/node-views are intentionally omitted (no
// effect on serialized HTML).
import { Mark, mergeAttributes } from '@tiptap/core';

export const Comment = Mark.create({
  name: 'comment',

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: element => element.getAttribute('data-comment-id'),
        renderHTML: attributes => {
          if (!attributes.commentId) return {};
          return { 'data-comment-id': attributes.commentId };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'comment-highlight' }), 0];
  },
});
