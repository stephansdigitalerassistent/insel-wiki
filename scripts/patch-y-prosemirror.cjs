/**
 * Guards y-prosemirror's NodeSelection restore against a deleted node.
 *
 * `ProsemirrorBinding._typeChanged` restores the local selection after every
 * observed Yjs change via `restoreRelativeSelection`. Its 'node' branch calls
 * `NodeSelection.create(tr.doc, anchor)` with no null check, while the sibling
 * 'text' branch does check. When a NodeSelection is active and the change
 * removed that node, `anchor` resolves to a position with no node after it and
 * `NodeSelection.create` throws:
 *
 *     TypeError: Cannot read properties of null (reading 'nodeSize')
 *
 * Clicking an image node-selects it, so this fires on every image deletion —
 * and because `_typeChanged` also runs for REMOTE changes while
 * `beforeTransactionSelection` holds the *local* selection, another user
 * deleting an image you have selected crashes your editor. That collaborative
 * case cannot be fixed from application code, hence this patch.
 *
 * Vite bundles y-prosemirror from src/ (its exports.import is
 * ./src/y-prosemirror.js), so patching the source is what reaches the browser.
 *
 * Upstream: y-prosemirror 1.3.7, src/plugins/sync-plugin.js.
 * Remove this once upstream guards the branch.
 */
const fs = require('fs');
const path = require('path');

const targetFile = path.join(
  __dirname,
  '../node_modules/y-prosemirror/src/plugins/sync-plugin.js'
);

const MARKER = 'hanspecathon: guard dangling NodeSelection';

const ORIGINAL = `      tr.setSelection(NodeSelection.create(tr.doc, anchor))`;

const PATCHED = `      // ${MARKER}
      if (anchor !== null && anchor >= 0 && anchor <= tr.doc.content.size &&
          tr.doc.resolve(anchor).nodeAfter !== null) {
        tr.setSelection(NodeSelection.create(tr.doc, anchor))
      }`;

if (!fs.existsSync(targetFile)) {
  console.warn('Warning: y-prosemirror sync-plugin.js not found to patch.');
  process.exit(0);
}

const content = fs.readFileSync(targetFile, 'utf8');

if (content.includes(MARKER)) {
  console.log('y-prosemirror sync-plugin.js is already patched.');
  process.exit(0);
}

if (!content.includes(ORIGINAL)) {
  // Fail loudly rather than silently shipping the crash: the dependency moved
  // and the guard needs to be re-checked against the new source.
  console.error(
    'ERROR: could not patch y-prosemirror — the NodeSelection restore in\n' +
    '  node_modules/y-prosemirror/src/plugins/sync-plugin.js no longer matches.\n' +
    '  Re-check whether upstream now guards it and update scripts/patch-y-prosemirror.cjs.'
  );
  process.exit(1);
}

fs.writeFileSync(targetFile, content.replace(ORIGINAL, PATCHED), 'utf8');
console.log('Successfully patched y-prosemirror NodeSelection restore.');
