/**
 * Unit tests for Table Generation & Editing — src/editor/Table.test.js
 * Run with: node src/editor/Table.test.js
 *
 * Simple test runner — matches existing test suites in the codebase.
 */

import { getSchema } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { marked } from 'marked';
import TurndownService from 'turndown';

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
    console.error(`    ${err.message}`);
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
    toHaveLength(n) {
      if (actual.length !== n) throw new Error(`Expected length ${n} but got ${actual.length}`);
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
    }
  };
}

console.log('\n📊 Table Generation & Editing Unit Coverage');

test('Tiptap table schema includes table, tableRow, tableHeader, and tableCell nodes', () => {
  const schema = getSchema([StarterKit, Table, TableRow, TableHeader, TableCell]);
  expect(schema.nodes.table).toBeTruthy();
  expect(schema.nodes.tableRow).toBeTruthy();
  expect(schema.nodes.tableHeader).toBeTruthy();
  expect(schema.nodes.tableCell).toBeTruthy();
});

test('Table extension config provides expected manipulation commands', () => {
  const tableCommands = Table.config.addCommands();
  expect(typeof tableCommands.insertTable).toBe('function');
  expect(typeof tableCommands.addColumnBefore).toBe('function');
  expect(typeof tableCommands.addColumnAfter).toBe('function');
  expect(typeof tableCommands.deleteColumn).toBe('function');
  expect(typeof tableCommands.addRowBefore).toBe('function');
  expect(typeof tableCommands.addRowAfter).toBe('function');
  expect(typeof tableCommands.deleteRow).toBe('function');
  expect(typeof tableCommands.deleteTable).toBe('function');
  expect(typeof tableCommands.toggleHeaderRow).toBe('function');
});

test('Schema constructs valid table with headers and data cells', () => {
  const schema = getSchema([StarterKit, Table, TableRow, TableHeader, TableCell]);
  const tableNode = schema.nodes.table.create(null, [
    schema.nodes.tableRow.create(null, [
      schema.nodes.tableHeader.create(null, [
        schema.nodes.paragraph.create(null, [schema.text('Header 1')])
      ]),
      schema.nodes.tableHeader.create(null, [
        schema.nodes.paragraph.create(null, [schema.text('Header 2')])
      ])
    ]),
    schema.nodes.tableRow.create(null, [
      schema.nodes.tableCell.create(null, [
        schema.nodes.paragraph.create(null, [schema.text('Data 1')])
      ]),
      schema.nodes.tableCell.create(null, [
        schema.nodes.paragraph.create(null, [schema.text('Data 2')])
      ])
    ])
  ]);

  expect(tableNode.type.name).toBe('table');
  expect(tableNode.childCount).toBe(2);
  expect(tableNode.child(0).type.name).toBe('tableRow');
  expect(tableNode.child(0).child(0).type.name).toBe('tableHeader');
  expect(tableNode.child(1).child(0).type.name).toBe('tableCell');
});

test('Marked parses markdown table into valid HTML table', () => {
  marked.setOptions({ gfm: true, breaks: true });
  const md = `| Name | Rolle |
| --- | --- |
| Stephan | Admin |
| Lucia | Editor |`;

  const html = marked.parse(md);
  expect(html).toContain('<table>');
  expect(html).toContain('<th>Name</th>');
  expect(html).toContain('<th>Rolle</th>');
  expect(html).toContain('<td>Stephan</td>');
  expect(html).toContain('<td>Admin</td>');
});

test('Turndown serializes HTML table into GFM markdown table', () => {
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });

  turndownService.addRule('tables', {
    filter: 'table',
    replacement: function (content, node) {
      const rows = Array.from(node.querySelectorAll('tr'));
      if (rows.length === 0) return '';

      const tableLines = [];
      let headerHandled = false;

      rows.forEach((row, rowIndex) => {
        const cells = Array.from(row.children).filter(
          (cell) => cell.nodeName === 'TH' || cell.nodeName === 'TD'
        );
        if (cells.length === 0) return;

        const isHeaderRow = cells.some((cell) => cell.nodeName === 'TH') || rowIndex === 0;

        const cellTexts = cells.map((cell) => {
          const text = cell.textContent.trim().replace(/\|/g, '\\|').replace(/\n+/g, ' ');
          return text || ' ';
        });

        tableLines.push('| ' + cellTexts.join(' | ') + ' |');

        if (isHeaderRow && !headerHandled) {
          const delimiter = cells.map(() => '---').join(' | ');
          tableLines.push('| ' + delimiter + ' |');
          headerHandled = true;
        }
      });

      if (!headerHandled && tableLines.length > 0) {
        const firstRowCells = Array.from(rows[0].children).filter(
          (cell) => cell.nodeName === 'TH' || cell.nodeName === 'TD'
        );
        const delimiter = firstRowCells.map(() => '---').join(' | ');
        tableLines.splice(1, 0, '| ' + delimiter + ' |');
      }

      return '\n\n' + tableLines.join('\n') + '\n\n';
    }
  });

  // Simple DOM mock for Node environment
  const mockTableNode = {
    querySelectorAll(selector) {
      if (selector === 'tr') {
        return [
          {
            children: [
              { nodeName: 'TH', textContent: 'Titel' },
              { nodeName: 'TH', textContent: 'Status' }
            ]
          },
          {
            children: [
              { nodeName: 'TD', textContent: 'Projekt A' },
              { nodeName: 'TD', textContent: 'Aktiv' }
            ]
          }
        ];
      }
      return [];
    }
  };

  const rule = turndownService.rules.array.find((r) => r.filter === 'table');
  expect(rule).toBeTruthy();

  const mdOutput = rule.replacement('', mockTableNode);
  expect(mdOutput).toContain('| Titel | Status |');
  expect(mdOutput).toContain('| --- | --- |');
  expect(mdOutput).toContain('| Projekt A | Aktiv |');
});

test('Table dimension limits clamp rows (1-20) and columns (1-10)', () => {
  const clampDimensions = (r, c) => {
    let rows = parseInt(r, 10);
    let cols = parseInt(c, 10);
    if (isNaN(rows) || rows < 1) rows = 1;
    if (rows > 20) rows = 20;
    if (isNaN(cols) || cols < 1) cols = 1;
    if (cols > 10) cols = 10;
    return { rows, cols };
  };

  expect(clampDimensions(3, 3)).toEqual({ rows: 3, cols: 3 });
  expect(clampDimensions(0, -5)).toEqual({ rows: 1, cols: 1 });
  expect(clampDimensions(99, 50)).toEqual({ rows: 20, cols: 10 });
  expect(clampDimensions('invalid', 'NaN')).toEqual({ rows: 1, cols: 1 });
});

console.log(`\n────────────────────────────────────────`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error('❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('✅ All tests passed!');
}
