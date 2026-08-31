// The shipped spellcheck prompt must stay the one that was actually measured.
//
// The prompt is a plain template literal inside index.js, and the eval that
// justifies it lives in tests/spellcheck-eval/prompts.mjs. Nothing but this test
// stops someone tightening one and leaving the other behind — at which point the
// numbers in index.js's comment describe a prompt that is no longer deployed.
//
// Run: cd functions && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.join(HERE, '..', 'index.js');
const PROMPTS = path.join(HERE, '..', '..', 'tests', 'spellcheck-eval', 'prompts.mjs');

/**
 * The prompt as index.js will send it.
 *
 * Sliced out of the spellcheck handler rather than taken as the file's first
 * `systemPrompt`: index.js holds more than one (the hAnSpecathon fork also has a
 * translator), and a test that silently grabs the wrong one would pass while the
 * prompt it is guarding drifted freely.
 */
async function shippedPrompt() {
    const src = await readFile(INDEX, 'utf8');
    const start = src.indexOf('export const spellcheck = onRequest');
    assert.notEqual(start, -1, 'no spellcheck handler found in functions/index.js');
    const end = src.indexOf('\nexport const ', start + 1);
    const handler = src.slice(start, end === -1 ? undefined : end);
    const m = handler.match(/const systemPrompt = `([\s\S]*?)`;/);
    assert.ok(m, 'no systemPrompt template literal inside the spellcheck handler');
    return m[1];
}

test('shipped prompt is the evaluated "strict" variant', async () => {
    const { prompts } = await import(PROMPTS);
    assert.equal(await shippedPrompt(), prompts.strict);
});

test('shipped prompt keeps the rules the eval scored', async () => {
    const prompt = await shippedPrompt();
    // Output shape: anything more than the bare word breaks the client, which
    // writes the reply straight into the document.
    assert.match(prompt, /Output ONLY the word/);
    // The asymmetry is the whole point — without it the model "helps".
    assert.match(prompt, /Unsure for any reason -> unchanged/);
    assert.match(prompt, /surname, place, clinic, brand, product, project, drug name or/);
    // Swiss German and umlaut handling predate this rework; keep them.
    assert.match(prompt, /never ae\/oe\/ue/);
    assert.match(prompt, /'ß' becomes 'ss'/);
});
