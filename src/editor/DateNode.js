import { mergeAttributes, Node, InputRule, PasteRule, nodeInputRule, nodePasteRule } from '@tiptap/core';

// Match dates in the format YYYY-MM-DD
const DATE_REGEX = /(?:\s|^)(\d{4}-\d{2}-\d{2})(?:\s|$)/g;

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
    return [
      {
        tag: 'span[data-type="date"]',
      }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'date' }), HTMLAttributes.date];
  },

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

