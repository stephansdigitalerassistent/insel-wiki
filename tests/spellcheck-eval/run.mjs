/**
 * Spellcheck prompt evaluation.
 *
 * The corrector's two failure modes pull against each other: leave a real typo
 * alone, or "fix" a surname into a different name. Only the second one is
 * visible to the person typing, and only the second one puts a wrong word into
 * a colleague's page — so a variant is judged on `leave` first.
 *
 * Usage: GEMINI_API_KEY=... node tests/spellcheck-eval/run.mjs [variant...]
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODEL = process.env.SPELLCHECK_MODEL || 'gemini-3.5-flash-lite';
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('GEMINI_API_KEY not set'); process.exit(2); }

const { prompts } = await import(path.join(HERE, 'prompts.mjs'));
// SPELLCHECK_CASES picks the set. The held-out set exists because a prompt that
// names its examples will ace a set built from those same words; a variant only
// counts if it wins on words its own text has never seen.
const CASE_FILE = process.env.SPELLCHECK_CASES || 'cases.json';
const cases = JSON.parse(await readFile(path.join(HERE, CASE_FILE), 'utf8'));

async function ask(systemPrompt, word, before, after) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
    for (let attempt = 1; attempt <= 3; attempt++) {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Referer': 'https://insel-wiki.web.app/' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemPrompt }] },
                contents: [{ parts: [{ text: `Target: ${word}\nContext before: ${before}\nContext after: ${after}` }] }],
                generationConfig: { temperature: 0, maxOutputTokens: 30, candidateCount: 1 }
            })
        });
        if (res.ok) {
            const j = await res.json();
            return (j.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
        }
        if (res.status !== 429 && res.status < 500) return `<<HTTP ${res.status}>>`;
        await new Promise(r => setTimeout(r, 1000 * attempt));
    }
    return '<<RETRIES EXHAUSTED>>';
}

// Bounded concurrency: fast enough to iterate on, gentle enough not to get 429ed.
async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i], i);
        }
    }));
    return out;
}

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(prompts);
const summary = [];

for (const name of names) {
    const systemPrompt = prompts[name];
    if (!systemPrompt) { console.error(`unknown variant: ${name}`); process.exit(2); }

    const leaveOut = await mapLimit(cases.leave, 6, ([w, b, a]) => ask(systemPrompt, w, b, a));
    const fixOut = await mapLimit(cases.correct, 6, ([w, b, a]) => ask(systemPrompt, w, b, a));

    const norm = s => String(s).replace(/[.,!?;:"']/g, '').trim();
    const mangled = cases.leave
        .map(([w], i) => [w, leaveOut[i]])
        .filter(([w, got]) => norm(got).toLowerCase() !== w.toLowerCase());
    const missed = cases.correct
        .map(([w, , , exp], i) => [w, exp, fixOut[i]])
        .filter(([, exp, got]) => norm(got).toLowerCase() !== exp.toLowerCase());

    const kept = cases.leave.length - mangled.length;
    const fixed = cases.correct.length - missed.length;
    summary.push({ name, kept, ofLeave: cases.leave.length, fixed, ofFix: cases.correct.length, mangled, missed });

    console.log(`\n=== ${name} (${MODEL}, ${CASE_FILE}) ===`);
    console.log(`  left alone : ${kept}/${cases.leave.length}`);
    console.log(`  corrected  : ${fixed}/${cases.correct.length}`);
    if (mangled.length) console.log('  MANGLED    : ' + mangled.map(([w, g]) => `${w}→${g}`).join(', '));
    if (missed.length) console.log('  missed     : ' + missed.map(([w, e, g]) => `${w}→${g} (want ${e})`).join(', '));
}

console.log('\n---------------- summary ----------------');
for (const s of summary) {
    console.log(`${s.name.padEnd(14)} leave ${String(s.kept).padStart(2)}/${s.ofLeave}   fix ${String(s.fixed).padStart(2)}/${s.ofFix}`);
}
