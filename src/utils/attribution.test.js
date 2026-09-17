/**
 * Unit tests for history-snapshot attribution.
 * Run with: node src/utils/attribution.test.js
 *
 * These call the real resolver used by src/controllers/page.js — the logic is kept in
 * src/utils/attribution.js precisely so it can be exercised here instead of restated.
 */

import { resolveSnapshotAttribution } from './attribution.js';

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
    toBeNull() {
      if (actual !== null) throw new Error(`Expected null but got ${JSON.stringify(actual)}`);
    }
  };
}

const STEFANIE = { email: 'stefanie.raisch@insel.ch', name: 'Stefanie Raisch' };
const LARS = { email: 'lars.wenzel@insel.ch', name: 'Lars Wenzel' };
const VIEWER = { email: 'stephan.heuscher@insel.ch', displayName: 'Stephan Heuscher' };

console.log('\n👥 History snapshot attribution');

test('a passive viewer that saw no editor must not write a snapshot at all', () => {
  const result = resolveSnapshotAttribution({
    hasLocalEdits: false,
    contributors: [],
    currentUser: VIEWER
  });
  expect(result).toBeNull();
});

test('a viewer that observed a remote edit attributes it to the remote author, never itself', () => {
  const result = resolveSnapshotAttribution({
    hasLocalEdits: false,
    contributors: [STEFANIE],
    currentUser: VIEWER
  });
  expect(result.primaryEmail).toBe('stefanie.raisch@insel.ch');
  expect(result.contributors).toHaveLength(1);
  expect(result.contributors[0].name).toBe('Stefanie Raisch');
});

test('the primary author is the most recently observed editor, not the first one seen', () => {
  // Stefanie edited earlier in the session, Lars is the author of the pending content.
  const result = resolveSnapshotAttribution({
    hasLocalEdits: false,
    contributors: [STEFANIE, LARS],
    currentUser: VIEWER
  });
  expect(result.primaryEmail).toBe('lars.wenzel@insel.ch');
  expect(result.contributors[0].email).toBe('lars.wenzel@insel.ch');
  expect(result.contributors[1].email).toBe('stefanie.raisch@insel.ch');
});

test('co-editing lists both authors with the local user as primary', () => {
  const result = resolveSnapshotAttribution({
    hasLocalEdits: true,
    contributors: [LARS],
    currentUser: { email: 'stefanie.raisch@insel.ch', displayName: 'Stefanie Raisch' }
  });
  expect(result.primaryEmail).toBe('stefanie.raisch@insel.ch');
  expect(result.contributors).toHaveLength(2);
  expect(result.contributors[0].email).toBe('stefanie.raisch@insel.ch');
  expect(result.contributors[1].email).toBe('lars.wenzel@insel.ch');
});

test('the local user is not duplicated when the provider already recorded them', () => {
  const result = resolveSnapshotAttribution({
    hasLocalEdits: true,
    contributors: [STEFANIE, LARS],
    currentUser: { email: 'stefanie.raisch@insel.ch', displayName: 'Stefanie Raisch' }
  });
  expect(result.contributors).toHaveLength(2);
  expect(result.contributors[0].email).toBe('stefanie.raisch@insel.ch');
});

test('a local edit is attributed even when no contributor was recorded (title-only rename)', () => {
  const result = resolveSnapshotAttribution({
    hasLocalEdits: true,
    contributors: [],
    currentUser: VIEWER
  });
  expect(result.primaryEmail).toBe('stephan.heuscher@insel.ch');
  expect(result.contributors).toHaveLength(1);
  expect(result.contributors[0].name).toBe('Stephan Heuscher');
});

test('a missing name falls back to the formatted e-mail, as everywhere else in the app', () => {
  const result = resolveSnapshotAttribution({
    hasLocalEdits: false,
    contributors: [{ email: 'stefanie.raisch@insel.ch' }],
    currentUser: VIEWER
  });
  expect(result.contributors[0].name).toBe('Stefanie Raisch');
});

test('malformed contributor entries are ignored rather than written to history', () => {
  const result = resolveSnapshotAttribution({
    hasLocalEdits: false,
    contributors: [null, { name: 'No Address' }, STEFANIE],
    currentUser: VIEWER
  });
  expect(result.contributors).toHaveLength(1);
  expect(result.primaryEmail).toBe('stefanie.raisch@insel.ch');
});

console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
