import { Mark, mergeAttributes } from '@tiptap/core';

/**
 * @module editor/Comment
 * @description
 * Tiptap mark that anchors a discussion thread to a range of text.
 *
 * ### Anchoring Model
 * - **Mark, not node:** Comments are stored as an inline mark so the highlighted range keeps
 *   participating in normal editing — typing inside it extends the range, deleting text shrinks it,
 *   and collaborative (Yjs) merges resolve it like any other mark.
 * - **Indirection via `commentId`:** The document only carries the thread's identifier. The thread
 *   body, author, replies, and resolution state live in Firestore; the mark is purely the anchor.
 *   That keeps the CRDT payload small and lets a thread be edited without touching the document.
 * - **Round-tripping:** The id is serialised to the `data-comment-id` attribute, so a comment
 *   survives an HTML export/import cycle (see {@link parseHTML} / {@link renderHTML}).
 *
 * ### Rendering
 * Commented ranges are wrapped in `<span class="comment-highlight" data-comment-id="…">`. The
 * `comment-highlight` class supplies the visual treatment; the sidebar/UI layer queries the
 * `data-comment-id` attribute to scroll to, focus, or highlight the matching thread.
 */

/**
 * @typedef {Object} CommentAttributes
 * @property {string|null} commentId Identifier of the Firestore comment thread this range is
 *   anchored to. `null` means the mark carries no thread and renders without a data attribute.
 */

/**
 * Tiptap mark `comment` — highlights a text range and links it to a comment thread.
 *
 * Adds two editor commands:
 * - `setComment(commentId)` — apply the mark (and thread id) to the current selection.
 * - `unsetComment()` — remove the mark from the current selection.
 *
 * @type {import('@tiptap/core').Mark}
 */
export const Comment = Mark.create({
  name: 'comment',

  /**
   * Declares the mark's attributes and how each is (de)serialised to HTML.
   *
   * @returns {Object<string, import('@tiptap/core').Attribute>} Attribute spec for `commentId`,
   *   read from `data-comment-id` on parse and written back on render. An unset id renders no
   *   attribute at all, so stray empty marks do not pollute the exported HTML.
   */
  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: element => element.getAttribute('data-comment-id'),
        renderHTML: attributes => {
          if (!attributes.commentId) {
            return {};
          }

          return {
            'data-comment-id': attributes.commentId,
          };
        },
      },
    };
  },

  /**
   * Recognises previously exported comment highlights when HTML is pasted or loaded.
   *
   * @returns {Array<import('@tiptap/core').ParseRule>} A single rule matching any `<span>` that
   *   carries a `data-comment-id` attribute.
   */
  parseHTML() {
    return [
      {
        tag: 'span[data-comment-id]',
      },
    ];
  },

  /**
   * Serialises the mark to HTML.
   *
   * @param {Object} props Tiptap render props.
   * @param {Object} props.HTMLAttributes Attributes produced by {@link addAttributes}.
   * @returns {Array} ProseMirror DOM output spec: a `<span class="comment-highlight">` wrapping the
   *   marked content (the trailing `0` is the content hole).
   */
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'comment-highlight' }), 0];
  },

  /**
   * Registers the editor commands used by the comment sidebar / toolbar.
   *
   * @returns {Object<string, Function>} `setComment(commentId)` applies the mark with the given
   *   thread id to the selection; `unsetComment()` removes it. Both return the underlying
   *   command's boolean result, so they can be chained and dry-run for UI enablement.
   */
  addCommands() {
    return {
      setComment: commentId => ({ commands }) => {
        return commands.setMark(this.name, { commentId });
      },
      unsetComment: () => ({ commands }) => {
        return commands.unsetMark(this.name);
      },
    };
  },
});
