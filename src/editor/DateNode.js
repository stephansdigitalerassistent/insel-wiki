import { mergeAttributes, Node, InputRule, nodeInputRule, nodePasteRule } from '@tiptap/core';

// Match dates in the format YYYY-MM-DD
const DATE_REGEX = /(?:\s|^)(\d{4}-\d{2}-\d{2})(?:\s|$)/;

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
          const { tr } = state;
          const start = range.from;
          const end = range.to;

          // Prevent conversion if we are inside a link, code, or other mark that should stay text
          let shouldSkip = false;
          state.doc.nodesBetween(start, end, (node) => {
            if (node.marks.some(mark => ['link', 'code'].includes(mark.type.name))) {
              shouldSkip = true;
            }
          });

          if (shouldSkip) return null;

          tr.replaceWith(start, end, this.type.create({ date: match[1].trim() }));
        },
      }),
      new InputRule({
        find: /(?<=\s|^)\/\/$/,
        handler: ({ state, range, match }) => {
          const { tr } = state;
          const start = range.from;
          const end = range.to;

          let shouldSkip = false;
          state.doc.nodesBetween(start, end, (node) => {
            if (node.marks.some(mark => ['link', 'code'].includes(mark.type.name))) {
              shouldSkip = true;
            }
          });

          if (shouldSkip) return null;

          tr.replaceWith(start, end, this.type.create({ date: new Date().toISOString().split('T')[0] }));
        },
      }),
    ];
  },

  addPasteRules() {
    return [
      nodePasteRule({
        find: DATE_REGEX,
        type: this.type,
        getAttributes: match => {
          return { date: match[1] };
        },
      }),
    ];
  }
});
