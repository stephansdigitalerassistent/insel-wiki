# Spellcheck prompt evaluation

The autocorrect in `functions/index.js` has two failure modes, and they are not
equally bad:

- **a typo left alone** — the person types on, no harm done;
- **a correct word changed** — a wrong word lands in a colleague's page, and the
  person who most needs this feature is the least likely to catch it.

Swiss surnames are the hard case, because many sit one edit from a common German
word: `Bracher`/`Braucher`, `Bieri`/`Bier`, `Anken`/`Enkel`, `Heuscher`/`Heusler`.
The old prompt said "Ignore medical terms, acronyms, names" and did none of that.
So a variant is scored on how much it **leaves alone** first, and on how many real
typos it still fixes second.

## Running

```sh
GEMINI_API_KEY=... node tests/spellcheck-eval/run.mjs                 # all variants
GEMINI_API_KEY=... node tests/spellcheck-eval/run.mjs strict baseline # named ones
SPELLCHECK_CASES=cases-adversarial.json GEMINI_API_KEY=... node tests/spellcheck-eval/run.mjs
SPELLCHECK_MODEL=gemini-3.1-flash-lite GEMINI_API_KEY=... node tests/spellcheck-eval/run.mjs
```

It calls the live Gemini API, so it is **not** part of `npm run test:unit` and
does not run in CI. `functions/test/spellcheck-prompt.test.js` does run there, and
fails if `index.js` and `prompts.mjs` drift apart.

## The three case sets

| file | what it is for |
|---|---|
| `cases.json` | ordinary words, names, drugs, abbreviations, plus real typos |
| `cases-holdout.json` | same shape, entirely different words |
| `cases-adversarial.json` | Swiss surnames one edit from a common German word |

The held-out set exists because a prompt that lists its own examples will ace a
set built from those same words. Judge a variant on words its text has never
seen, then confirm on the others.

## Results (2026-08-31, `gemini-3.5-flash-lite`, two repeat runs)

Words correctly left alone; every variant fixed every real typo.

| variant | cases | holdout | adversarial |
|---|---|---|---|
| `baseline` (was in production) | 22–23/25 | 24–25/25 | 17–19/20 |
| `guarded` | 25/25 | 25/25 | 19/20 |
| `dictionary` | 24/25 | 25/25 | 20/20 |
| **`strict`** (shipped) | **25/25** | **25/25** | **20/20** |

`strict` was the only variant perfect on all three sets, and it repeated exactly.

Also measured and rejected: `gemini-3.6-flash` is a thinking model that overruns
the handler's `maxOutputTokens: 30` and returns fragments of the prompt back;
thinking cannot be switched off (`thinkingBudget: 0` → HTTP 400), and with room
to think it still answered `legastine → legasthenische`. `gemini-3.6-flash-lite`
does not exist. Keep the lite tier — being conservative is the job.
