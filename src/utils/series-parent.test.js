/**
 * Unit tests for series-parent.js
 * Run with: node src/utils/series-parent.test.js
 */

import * as Y from 'yjs';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';

const { insertSeriesLinkInFragment, insertSeriesLinkInMarkdown } = await import('./series-parent.js');

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
      if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toEqual(expected) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    }
  };
}

const LINK_ATTRS = { href: '', target: null, rel: null, class: null };

/** Builds a Yjs document holding a heading and a list of page links. */
function docWithList(pageIds, { listType = 'bulletList', itemType = 'listItem' } = {}) {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment('default');
  const heading = new Y.XmlElement('heading');
  const headingText = new Y.XmlText();
  headingText.insert(0, 'Meetings');
  heading.insert(0, [headingText]);
  const list = new Y.XmlElement(listType);
  list.insert(0, pageIds.map(id => {
    const text = new Y.XmlText();
    text.insert(0, id, { link: { ...LINK_ATTRS, href: `#/${id}/${id}` } });
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [text]);
    const item = new Y.XmlElement(itemType);
    if (itemType === 'taskItem') item.setAttribute('checked', true);
    item.insert(0, [paragraph]);
    return item;
  }));
  fragment.insert(0, [heading, list]);
  return fragment;
}

/** The link targets of the first list, in order. */
function listHrefs(fragment) {
  const list = yXmlFragmentToProsemirrorJSON(fragment).content.find(n => /List$/.test(n.type));
  return list.content.map(item => item.content[0].content[0].marks[0].attrs.href);
}

const opts = { predecessorId: 'm2', href: '#/new/micha-3', title: 'micha-3' };

console.log('\n🧩 insertSeriesLinkInFragment()');

test('adds the new page after the predecessor in an oldest-first list', () => {
  const fragment = docWithList(['m1', 'm2']);
  expect(insertSeriesLinkInFragment(fragment, opts)).toBe(true);
  expect(listHrefs(fragment)).toEqual(['#/m1/m1', '#/m2/m2', '#/new/micha-3']);
});

test('adds the new page on top of a newest-first list', () => {
  const fragment = docWithList(['m2', 'm1']);
  insertSeriesLinkInFragment(fragment, opts);
  expect(listHrefs(fragment)).toEqual(['#/new/micha-3', '#/m2/m2', '#/m1/m1']);
});

test('writes a list item that converts to a proper ProseMirror link', () => {
  const fragment = docWithList(['m2']);
  insertSeriesLinkInFragment(fragment, opts);
  const list = yXmlFragmentToProsemirrorJSON(fragment).content[1];
  expect(list.content[1]).toEqual({
    type: 'listItem',
    content: [{
      type: 'paragraph',
      content: [{ type: 'text', text: 'micha-3', marks: [{ type: 'link', attrs: { ...LINK_ATTRS, href: '#/new/micha-3' } }] }]
    }]
  });
});

test('adds an unchecked task to a task list', () => {
  const fragment = docWithList(['m2'], { listType: 'taskList', itemType: 'taskItem' });
  insertSeriesLinkInFragment(fragment, opts);
  const list = yXmlFragmentToProsemirrorJSON(fragment).content[1];
  expect(list.content[1].type).toBe('taskItem');
  expect(list.content[1].attrs.checked).toBe(false);
});

test('leaves the page alone when no list links to the predecessor', () => {
  const fragment = docWithList(['m1']);
  expect(insertSeriesLinkInFragment(fragment, opts)).toBe(false);
  expect(listHrefs(fragment)).toEqual(['#/m1/m1']);
});

test('does not mistake a page whose id starts with the predecessor id', () => {
  const fragment = docWithList(['m22']);
  expect(insertSeriesLinkInFragment(fragment, opts)).toBe(false);
});

console.log('\n📝 insertSeriesLinkInMarkdown()');

test('adds the new page after the predecessor', () => {
  const md = '# Meetings\n\n- [micha-1](#/m1/micha-1)\n- [micha-2](#/m2/micha-2)\n\nText';
  expect(insertSeriesLinkInMarkdown(md, opts))
    .toBe('# Meetings\n\n- [micha-1](#/m1/micha-1)\n- [micha-2](#/m2/micha-2)\n- [micha-3](#/new/micha-3)\n\nText');
});

test('adds the new page on top of a newest-first list', () => {
  const md = '* [micha-2](#/m2)\n* [micha-1](#/m1)';
  expect(insertSeriesLinkInMarkdown(md, opts)).toBe('* [micha-3](#/new/micha-3)\n* [micha-2](#/m2)\n* [micha-1](#/m1)');
});

test('keeps the predecessor\'s nested lines with it', () => {
  const md = '- [micha-2](#/m2)\n  - Notiz';
  expect(insertSeriesLinkInMarkdown(md, opts)).toBe('- [micha-2](#/m2)\n  - Notiz\n- [micha-3](#/new/micha-3)');
});

test('adds an open task to a task list and escapes brackets', () => {
  const md = '- [x] [micha-2](#/m2/micha-2)';
  expect(insertSeriesLinkInMarkdown(md, { ...opts, title: 'Sprint [3]' }))
    .toBe('- [x] [micha-2](#/m2/micha-2)\n- [ ] [Sprint \\[3\\]](#/new/micha-3)');
});

test('returns null when the predecessor is only linked outside a list', () => {
  expect(insertSeriesLinkInMarkdown('Siehe [micha-2](#/m2)', opts)).toBe(null);
  expect(insertSeriesLinkInMarkdown('- [micha-22](#/m22)', opts)).toBe(null);
  expect(insertSeriesLinkInMarkdown('', opts)).toBe(null);
});

console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('✅ All tests passed!');
}
