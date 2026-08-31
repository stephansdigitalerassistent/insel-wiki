/**
 * Unit tests for the DevOps-Bot banner's decision logic — src/components/bot-banner.js
 * Run with: node src/components/bot-banner.test.js
 *
 * Simple test runner — no framework needed (matches src/utils/tasks.test.js).
 *
 * Only the pure parts are covered here: which stage offers which decision, and
 * how a stored plan step reads. The DOM assembly is left to the E2E suite —
 * what actually went wrong before was never the markup, it was the bot and the
 * reader disagreeing about what state a request was in.
 */

const { actionsFor, headlineFor, planStepText } = await import('./bot-banner.js');

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

function assert(cond, message) {
  if (!cond) throw new Error(message || 'assertion failed');
}

function assertEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message || 'not equal'}: expected ${e}, got ${a}`);
}

console.log('\nactionsFor()');

test('a waiting request offers exactly one decision: start the analysis', () => {
  const actions = actionsFor('waiting');
  assertEqual(actions.map(a => a[0]), ['start_analysis']);
});

test('a proposal offers approve first, restart second', () => {
  const actions = actionsFor('proposed');
  assertEqual(actions.map(a => a[0]), ['approve', 'restart']);
  assertEqual(actions[0][2], 'primary', 'approve should be the primary action');
});

test('a failed request can be restarted but never approved', () => {
  const actions = actionsFor('failed');
  assertEqual(actions.map(a => a[0]), ['restart']);
});

// The whole point of the banner is that it never offers a button the daemon
// would ignore. A stage the bot is working through has no honest decision to
// offer, and a finished one has nothing left to decide.
test('stages the bot owns offer no buttons at all', () => {
  for (const status of ['analyzing', 'queued', 'running', 'completed', 'approved', 'subpage_created']) {
    assertEqual(actionsFor(status), [], `${status} should offer no actions`);
  }
});

test('an unknown status offers no buttons rather than guessing', () => {
  assertEqual(actionsFor('something-new'), []);
  assertEqual(actionsFor(undefined), []);
});

// The preview gate is the one place a person decides against evidence rather
// than a description, so what it offers has to depend on whether that evidence
// exists yet. The preview is BUILT by the PR's checks — offering "ship it"
// while they are still running would be offering to publish something nobody
// can look at.
test('a preview with green CI can be shipped or rejected', () => {
  const actions = actionsFor('preview', 'passed');
  assertEqual(actions.map(a => a[0]), ['ship', 'reject']);
  assertEqual(actions[0][2], 'primary', 'ship should be the primary action');
});

test('a preview whose CI is still running can only be rejected', () => {
  assertEqual(actionsFor('preview', 'pending').map(a => a[0]), ['reject']);
});

test('a preview whose CI failed can only be rejected', () => {
  assertEqual(actionsFor('preview', 'failed').map(a => a[0]), ['reject']);
});

test('a preview with no CI verdict at all cannot be shipped', () => {
  assertEqual(actionsFor('preview', undefined).map(a => a[0]), ['reject']);
});

test('a rejected change offers nothing further', () => {
  assertEqual(actionsFor('rejected'), []);
});

console.log('\nheadlineFor()');

test('every known stage has a sentence, not a raw status key', () => {
  const stages = ['waiting', 'analyzing', 'subpage_created', 'proposed',
                  'approved', 'queuing', 'queued', 'running', 'preview',
                  'rejected', 'completed', 'failed'];
  for (const status of stages) {
    const line = headlineFor({ bot_status: status });
    assert(line && line !== status, `${status} should read as a sentence, got "${line}"`);
    assert(!line.startsWith('bot.'), `${status} leaked an i18n key: "${line}"`);
  }
});

test('an unknown stage falls back to the raw status rather than going blank', () => {
  assertEqual(headlineFor({ bot_status: 'brand-new-stage' }), 'brand-new-stage');
});

console.log('\nplanStepText()');

test('reads the current shape: a plan of plain sentences', () => {
  assertEqual(planStepText('Add a read-only mode'), 'Add a read-only mode');
});

// Proposals written before the plan became prose are still on real pages, and
// their `cmd` was a shell command that was never going to be run. Show the
// sentence that says what the change is.
test('prefers the description over a stored shell command', () => {
  assertEqual(
    planStepText({ cmd: 'node -e "console.log(1)"', desc: 'Add the 3-option modal' }),
    'Add the 3-option modal'
  );
});

test('falls back to the command when a legacy step has no description', () => {
  assertEqual(planStepText({ cmd: 'npm run build' }), 'npm run build');
});

test('an unusable step reads as empty rather than "undefined"', () => {
  assertEqual(planStepText(null), '');
  assertEqual(planStepText(42), '');
  assertEqual(planStepText({}), '');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
