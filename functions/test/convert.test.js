// Unit tests for the server-side Yjs → Markdown projection (lib/convert.js).
//
// Strategy: build a ProseMirror document with the SAME Tiptap schema the client
// uses, encode it into a Y.Doc on the 'default' XML fragment (exactly how the
// browser's Collaboration extension stores it), serialize that Y.Doc to a binary
// state update, and feed those bytes through projectToMarkdown — the same path
// the Cloud Function takes. This exercises the full
// state-bytes → Y.Doc → XmlFragment → PM JSON → HTML → Markdown pipeline.
//
// Run: cd functions && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { getSchema } from '@tiptap/core';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import { extensions } from '../lib/schema.js';
import { projectToMarkdown } from '../lib/convert.js';

const schema = getSchema(extensions);

// Encode a ProseMirror doc JSON into the binary state blob the client would have
// written to pages/{id}/yjs_state/state.
function encodeStateFromPmJson(docJson) {
  const ydoc = prosemirrorJSONToYDoc(schema, docJson, 'default');
  const bytes = Y.encodeStateAsUpdate(ydoc);
  ydoc.destroy();
  return bytes;
}

test('empty document projects to empty string', () => {
  const bytes = encodeStateFromPmJson({ type: 'doc', content: [{ type: 'paragraph' }] });
  assert.equal(projectToMarkdown(bytes), '');
});

test('headings, paragraphs and bold marks render as Markdown', () => {
  const bytes = encodeStateFromPmJson({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', marks: [{ type: 'bold' }], text: 'world' },
        ],
      },
    ],
  });
  const md = projectToMarkdown(bytes);
  assert.match(md, /^## Title$/m); // atx heading style (matches editor.js Turndown config)
  assert.match(md, /Hello \*\*world\*\*/);
});

test('task list renders GitHub-style checkboxes', () => {
  const bytes = encodeStateFromPmJson({
    type: 'doc',
    content: [
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'done' }] }] },
          { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'todo' }] }] },
        ],
      },
    ],
  });
  const md = projectToMarkdown(bytes);
  assert.match(md, /- \[x\] done/);
  assert.match(md, /- \[ \] todo/);
});

test('custom dateNode serializes to its ISO date text', () => {
  const bytes = encodeStateFromPmJson({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Visit on ' },
          { type: 'dateNode', attrs: { date: '2026-06-14' } },
        ],
      },
    ],
  });
  assert.match(projectToMarkdown(bytes), /Visit on .*2026-06-14/);
});

test('mention renders as @label', () => {
  const bytes = encodeStateFromPmJson({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'cc ' },
          { type: 'mention', attrs: { id: 'max.muster', label: 'Max Muster' } },
        ],
      },
    ],
  });
  assert.match(projectToMarkdown(bytes), /@Max Muster/);
});

test('links render as Markdown links', () => {
  const bytes = encodeStateFromPmJson({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', marks: [{ type: 'link', attrs: { href: '#/page-123/intro' } }], text: 'Intro' },
        ],
      },
    ],
  });
  assert.match(projectToMarkdown(bytes), /\[Intro\]\(#\/page-123\/intro\)/);
});

test('incremental updates are folded on top of the state blob', () => {
  // Simulate compaction lag: base state has one paragraph, a later pending
  // update (the kind stored in yjs_updates) appends a second one.
  const base = prosemirrorJSONToYDoc(schema, {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }],
  }, 'default');
  const stateBytes = Y.encodeStateAsUpdate(base);

  // Apply a mutation and capture only the delta as an incremental update.
  const before = Y.encodeStateVector(base);
  const frag = base.getXmlFragment('default');
  const para = new Y.XmlElement('paragraph');
  para.insert(0, [new Y.XmlText('second')]);
  frag.insert(frag.length, [para]);
  const updateBytes = Y.encodeStateAsUpdate(base, before);
  base.destroy();

  const md = projectToMarkdown(stateBytes, [updateBytes]);
  assert.match(md, /first/);
  assert.match(md, /second/);
});

test('content over 100k characters is truncated', () => {
  const huge = 'x'.repeat(120000);
  const bytes = encodeStateFromPmJson({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: huge }] }],
  });
  assert.equal(projectToMarkdown(bytes).length, 100000);
});
