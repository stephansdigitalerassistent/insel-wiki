import { mergeAttributes, Node, InputRule, PasteRule } from '@tiptap/core';

/**
 * @module editor/DateNode
 * @description
 * Tiptap node that turns plain ISO dates into an interactive date pill inside the document.
 *
 * ### Node Shape
 * - **Inline atom:** The node is `inline`, belongs to the `inline` group, and is an `atom` — it has
 *   no editable child content, so the caret steps over it as a single unit instead of letting the
 *   user break the date apart character by character.
 * - **Single attribute:** The value lives in the `date` attribute as an ISO `YYYY-MM-DD` string,
 *   defaulting to today. It is serialised to `<span data-type="date">`, which is also the parse
 *   selector, so pills survive an HTML export/import round trip.
 *
 * ### Conversion Triggers
 * - **Typing / pasting a date:** {@link DATE_REGEX} matches a bare `YYYY-MM-DD` token and replaces
 *   it with a pill, both as an input rule (while typing) and as a paste rule.
 * - **`//` shorthand:** Typing `//` at the start of a word inserts a pill pre-filled with today.
 * - **Guarded contexts:** Both rules bail out when the match sits inside a `link` or `code` mark, or
 *   inside a code block. A date in a URL or a code sample must stay literal text.
 * - **Whitespace preservation:** The regex intentionally captures the surrounding spaces so it can
 *   match at word boundaries; the handlers then shrink the replaced range back to the date itself,
 *   leaving the user's spacing untouched.
 *
 * ### Node View
 * The pill is rendered by a custom node view (see {@link addNodeView}) built from a styled `<span>`
 * containing a 📅 icon and a native `<input type="date">`. Picking a new date dispatches an
 * `updateAttributes` transaction, so the change flows through ProseMirror — and therefore through
 * Yjs to collaborators and into the undo history — rather than mutating the DOM behind the editor's
 * back. Styling is driven by CSS custom properties so the pill follows the active theme.
 */

/**
 * Matches an ISO `YYYY-MM-DD` date delimited by whitespace or a string boundary.
 * Capture group 1 is the bare date; the match itself may include the delimiting spaces.
 * @type {RegExp}
 */
const DATE_REGEX = /(?:\s|^)(\d{4}-\d{2}-\d{2})(?:\s|$)/g;

/**
 * Tiptap node `dateNode` — an inline, atomic date pill with a native date picker.
 * @type {import('@tiptap/core').Node}
 */
export const DateNode = Node.create({
  name: 'dateNode',
  group: 'inline',
  inline: true,
  atom: true,

  /**
   * @returns {Object<string, import('@tiptap/core').Attribute>} Attribute spec holding the ISO
   *   `YYYY-MM-DD` value, defaulting to today's date.
   */
  addAttributes() {
    return {
      date: {
        default: new Date().toISOString().split('T')[0],
      },
    };
  },

  /**
   * @returns {Array<import('@tiptap/core').ParseRule>} Rule matching `<span data-type="date">`, so
   *   pills are restored when previously exported HTML is pasted or loaded.
   */
  parseHTML() {
    return [
      {
        tag: 'span[data-type="date"]',
      }
    ];
  },

  /**
   * Serialises the node to HTML (export, clipboard, non-editable rendering).
   *
   * @param {Object} props Tiptap render props.
   * @param {Object} props.HTMLAttributes Attributes produced by {@link addAttributes}.
   * @returns {Array} DOM output spec: `<span data-type="date">` with the ISO date as plain text, so
   *   the value stays readable wherever the node view is not active.
   */
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'date' }), HTMLAttributes.date];
  },

  /**
   * Builds the interactive pill rendered in place of the node inside the editor.
   *
   * The view is a themed `<span class="date-pill">` holding a 📅 icon and a native
   * `<input type="date">`. Changing the input dispatches `updateAttributes` on the node's position
   * so the edit travels through ProseMirror (and thus Yjs and the undo stack). The returned
   * `update` hook keeps the input in sync with remote/undo-driven attribute changes and rejects
   * nodes of a different type, prompting ProseMirror to rebuild the view.
   *
   * @returns {Function} Node view factory receiving `{ node, getPos, editor }` and returning
   *   `{ dom, update }`.
   */
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('span');
      dom.classList.add('date-pill');
      dom.style.display = 'inline-flex';
      dom.style.alignItems = 'center';
      dom.style.background = 'var(--bg-elevated)';
      dom.style.border = '1px solid var(--border-strong)';
      dom.style.borderRadius = '16px';
      dom.style.padding = '0 8px';
      dom.style.fontSize = '0.85em';
      dom.style.color = 'var(--text-primary)';
      dom.style.gap = '6px';
      dom.style.margin = '0 4px';
      dom.style.verticalAlign = 'baseline';
      dom.style.boxShadow = 'var(--glass-shadow)';

      const icon = document.createElement('span');
      icon.innerHTML = '📅';
      icon.style.fontSize = '0.9em';
      icon.style.opacity = '0.8';
      
      const input = document.createElement('input');
      input.type = 'date';
      input.value = node.attrs.date;
      input.style.border = 'none';
      input.style.background = 'transparent';
      input.style.outline = 'none';
      input.style.color = 'inherit';
      input.style.fontFamily = 'inherit';
      input.style.fontSize = 'inherit';
      input.style.cursor = 'pointer';
      input.style.padding = '2px 0';
      
      input.addEventListener('change', (e) => {
        if (typeof getPos === 'function') {
          editor.chain().focus().setNodeSelection(getPos()).updateAttributes('dateNode', { date: e.target.value }).run();
        }
      });

      dom.appendChild(icon);
      dom.appendChild(input);

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== this.name) return false;
          input.value = updatedNode.attrs.date;
          return true;
        },
      };
    };
  },

  /**
   * Registers the two typing triggers that create a pill.
   *
   * @returns {import('@tiptap/core').InputRule[]} 1) A rule converting a typed `YYYY-MM-DD` token
   *   (range trimmed back to the date so surrounding spaces survive); 2) a rule converting a `//`
   *   shorthand at a word boundary into today's date. Both return `null` — leaving the text as
   *   typed — when the match sits inside a link, inline code, or a code block.
   */
  addInputRules() {
    return [
      new InputRule({
        find: DATE_REGEX,
        handler: ({ state, range, match }) => {
          const { tr, schema } = state;
          const captureGroup = match[1];
          if (!captureGroup) return null;

          const fullMatch = match[0];
          let { from, to } = range;

          // Adjust range to only cover the date part, preserving surrounding whitespace
          if (fullMatch.startsWith(' ')) {
            from += 1;
          }
          if (fullMatch.endsWith(' ')) {
            to -= 1;
          }

          // Prevent conversion if we are inside a link, code, or other mark that should stay text
          const hasLink = (schema.marks.link && state.doc.rangeHasMark(from, to, schema.marks.link)) || 
                          state.selection.$from.marks().some(m => m.type.name === 'link');
          const hasCode = (schema.marks.code && state.doc.rangeHasMark(from, to, schema.marks.code)) ||
                          state.selection.$from.marks().some(m => m.type.name === 'code') ||
                          state.selection.$from.parent.type.name === 'codeBlock';
          
          if (hasLink || hasCode) {
            return null;
          }

          tr.replaceWith(from, to, this.type.create({ date: captureGroup.trim() }));
        },
      }),
      new InputRule({
        find: /(?<=\s|^)\/\/$/,
        handler: ({ state, range, match }) => {
          const { tr, schema } = state;
          const start = range.from;
          const end = range.to;

          const hasLink = (schema.marks.link && state.doc.rangeHasMark(start, end, schema.marks.link)) ||
                          state.selection.$from.marks().some(m => m.type.name === 'link');
          const hasCode = (schema.marks.code && state.doc.rangeHasMark(start, end, schema.marks.code)) ||
                          state.selection.$from.marks().some(m => m.type.name === 'code') ||
                          state.selection.$from.parent.type.name === 'codeBlock';
          
          if (hasLink || hasCode) {
            return null;
          }

          tr.replaceWith(start, end, this.type.create({ date: new Date().toISOString().split('T')[0] }));
        },
      }),
    ];
  },

  /**
   * Registers the paste trigger that converts dates in pasted content.
   *
   * @returns {import('@tiptap/core').PasteRule[]} A single rule mirroring the typed-date input rule:
   *   same {@link DATE_REGEX} match, same whitespace-preserving range adjustment, and the same
   *   link/code guard so pasted URLs and code samples keep their literal dates.
   */
  addPasteRules() {
    return [
      new PasteRule({
        find: DATE_REGEX,
        handler: ({ state, range, match }) => {
          const { tr, schema } = state;
          const captureGroup = match[1];
          if (!captureGroup) return null;

          const fullMatch = match[0];
          let { from, to } = range;

          // Adjust range to only cover the date part, preserving surrounding whitespace
          if (fullMatch.startsWith(' ')) {
            from += 1;
          }
          if (fullMatch.endsWith(' ')) {
            to -= 1;
          }

          // Prevent conversion if we are inside a link, code, or other mark that should stay text
          // For paste, we check both the range marks and the current selection marks
          const hasLink = (schema.marks.link && state.doc.rangeHasMark(from, to, schema.marks.link)) ||
                          state.selection.$from.marks().some(m => m.type.name === 'link');
          const hasCode = (schema.marks.code && state.doc.rangeHasMark(from, to, schema.marks.code)) ||
                          state.selection.$from.marks().some(m => m.type.name === 'code') ||
                          state.selection.$from.parent.type.name === 'codeBlock';
          
          if (hasLink || hasCode) {
            return null;
          }

          tr.replaceWith(from, to, this.type.create({ date: captureGroup.trim() }));
        },
      }),
    ];
  }
});

