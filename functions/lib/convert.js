// Yjs document  →  Markdown projection.
//
// Reproduces the exact client pipeline so the projected `content` field matches
// what a browser would have written:
//
//   Y.Doc → XmlFragment('default') → ProseMirror JSON → HTML → Markdown
//
// The XML fragment field name 'default' is Tiptap's Collaboration default; the
// client never overrides `field`, so it stays 'default'.
import * as Y from 'yjs';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { generateHTML } from '@tiptap/html';
import TurndownService from 'turndown';
import { extensions } from './schema.js';

const MAX_CONTENT_LENGTH = 100000; // mirror editor.js truncation

// Firestore (admin SDK) returns Bytes fields as Node Buffers. Yjs wants a
// Uint8Array view over the same memory.
function toUint8(bytesField) {
  if (!bytesField) return null;
  if (bytesField instanceof Uint8Array) return bytesField;
  // admin SDK Bytes wrapper exposes toUint8Array(); Buffers are Uint8Arrays.
  if (typeof bytesField.toUint8Array === 'function') return bytesField.toUint8Array();
  return new Uint8Array(bytesField.buffer, bytesField.byteOffset, bytesField.byteLength);
}

/**
 * Rebuild a Y.Doc from the compacted state blob plus any pending incremental
 * updates, then project it to Markdown. Returns '' for an empty/absent doc.
 *
 * @param {Uint8Array|Buffer|null} stateBytes  the yjs_state/state blob
 * @param {Array<Uint8Array|Buffer>} updateBlobs  pending yjs_updates blobs
 * @returns {string} markdown
 */
export function projectToMarkdown(stateBytes, updateBlobs = []) {
  const ydoc = new Y.Doc();
  try {
    const state = toUint8(stateBytes);
    if (state) Y.applyUpdate(ydoc, state);
    for (const blob of updateBlobs) {
      const u = toUint8(blob);
      if (u) Y.applyUpdate(ydoc, u);
    }

    const fragment = ydoc.getXmlFragment('default');
    const pmJson = yXmlFragmentToProsemirrorJSON(fragment);

    // Empty doc → empty string (matches a fresh page's content).
    if (!pmJson || !pmJson.content || pmJson.content.length === 0) return '';

    const html = generateHTML(pmJson, extensions);
    let md = getTurndown().turndown(html);
    if (md.length > MAX_CONTENT_LENGTH) md = md.substring(0, MAX_CONTENT_LENGTH);
    return md;
  } finally {
    ydoc.destroy();
  }
}

// Turndown configured identically to src/editor/editor.js getTurndown().
let turndownInstance = null;
function getTurndown() {
  if (turndownInstance) return turndownInstance;
  turndownInstance = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });
  turndownInstance.addRule('taskItems', {
    filter(node) {
      return node.nodeName === 'LI' &&
        (node.getAttribute('data-type') === 'taskItem' || node.hasAttribute('data-checked'));
    },
    replacement(content, node) {
      // The browser DOM renders the checked state as data-checked="true"/"false",
      // but @tiptap/html's server DOM (zeed-dom) renders it as a bare boolean
      // attribute (present = checked, absent = unchecked). Handle both so the
      // projection matches what the browser would have written; a plain
      // `=== 'true'` check (as in the client's editor.js) would mis-render every
      // checked item as unchecked here.
      const checked = node.hasAttribute('data-checked') && node.getAttribute('data-checked') !== 'false';
      return (checked ? '- [x] ' : '- [ ] ') + content.trim() + '\n';
    },
  });
  turndownInstance.addRule('dateNode', {
    filter(node) {
      return node.nodeName === 'SPAN' && node.getAttribute('data-type') === 'date';
    },
    replacement(content, node) {
      return node.innerHTML;
    },
  });
  turndownInstance.addRule('tables', {
    filter: 'table',
    replacement(content, node) {
      // Turndown parses the HTML with domino, whose `children` is an array-like
      // HTMLCollection rather than an iterable — hence Array.from() throughout.
      const rows = [];
      (function collect(el) {
        for (const child of Array.from(el.children || [])) {
          if (child.nodeName === 'TR') rows.push(child);
          else collect(child);
        }
      })(node);
      if (rows.length === 0) return '';

      const cellsOf = (row) =>
        Array.from(row.children || []).filter(
          (cell) => cell.nodeName === 'TH' || cell.nodeName === 'TD'
        );

      const tableLines = [];
      let headerHandled = false;

      rows.forEach((row, rowIndex) => {
        const cells = cellsOf(row);
        if (cells.length === 0) return;

        const isHeaderRow = cells.some((cell) => cell.nodeName === 'TH') || rowIndex === 0;
        const cellTexts = cells.map((cell) => {
          const text = cell.textContent.trim().replace(/\|/g, '\\|').replace(/\n+/g, ' ');
          return text || ' ';
        });
        tableLines.push('| ' + cellTexts.join(' | ') + ' |');

        if (isHeaderRow && !headerHandled) {
          tableLines.push('| ' + cells.map(() => '---').join(' | ') + ' |');
          headerHandled = true;
        }
      });

      if (!headerHandled && tableLines.length > 0) {
        const delimiter = cellsOf(rows[0]).map(() => '---').join(' | ');
        tableLines.splice(1, 0, '| ' + delimiter + ' |');
      }

      return '\n\n' + tableLines.join('\n') + '\n\n';
    },
  });
  return turndownInstance;
}
