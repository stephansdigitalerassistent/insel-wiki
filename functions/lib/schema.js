// Headless Tiptap extension set used to turn ProseMirror JSON back into HTML.
//
// This MUST mirror the schema-contributing extensions in src/editor/editor.js so
// the server projection produces the same HTML the browser would. Interactive-
// only extensions are intentionally omitted because they contribute no node/mark
// to the document and are irrelevant to serialization:
//   - Collaboration / CollaborationCursor (transport, not schema)
//   - Placeholder, CharacterCount (decorations / counters, no schema)
//   - VoiceGhost (ghost-text decoration, never stored in the doc)
//
// MAINTENANCE CONTRACT: when an extension that contributes a node or mark is
// added/removed/reconfigured in editor.js, mirror it here.
import { StarterKit } from '@tiptap/starter-kit';
import { CodeBlock } from '@tiptap/extension-code-block';
import { Image } from '@tiptap/extension-image';
import { Link } from '@tiptap/extension-link';
import { Mention } from '@tiptap/extension-mention';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { mergeAttributes } from '@tiptap/core';
import { Comment } from './nodes/Comment.js';
import { DateNode } from './nodes/DateNode.js';

export const extensions = [
  StarterKit.configure({
    // codeBlock/link are disabled in StarterKit and provided separately below,
    // exactly as in editor.js. History is irrelevant for static rendering.
    codeBlock: false,
    link: false,
  }),
  CodeBlock,
  Comment,
  DateNode,
  Mention.extend({
    // Mirror editor.js: render mentions as plain `@label` text so the Turndown
    // pass yields `@label` in the markdown projection.
    renderHTML({ node, HTMLAttributes }) {
      return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), `@${node.attrs.label ?? node.attrs.id}`];
    },
  }).configure({
    HTMLAttributes: { class: 'mention' },
  }),
  Image.configure({ inline: true }),
  Link.configure({
    autolink: true,
    openOnClick: false,
    HTMLAttributes: { class: 'editable-link' },
  }).extend({ inclusive: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Table.configure({ resizable: true }),
  TableRow,
  TableCell,
  TableHeader,
];
