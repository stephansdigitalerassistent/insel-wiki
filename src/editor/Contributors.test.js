/**
 * Unit tests for Multi-User History Attribution & Contributor Tracking
 * Run with: node src/editor/Contributors.test.js
 */

import * as Y from 'yjs';

// Setup minimal global window for firebase client SDK & i18n in node unit test
globalThis.window = {
  location: { hostname: 'localhost', search: '', href: 'http://localhost' },
  addEventListener: () => {},
  removeEventListener: () => {}
};
try {
  Object.defineProperty(globalThis.navigator, 'webdriver', { value: true, configurable: true });
} catch (e) {}

const { FirestoreYjsProvider } = await import('./FirestoreYjsProvider.js');
FirestoreYjsProvider.prototype._publishOwnAwareness = () => Promise.resolve();
FirestoreYjsProvider.prototype.flushPending = function() {
  this._pendingUpdates = [];
  return Promise.resolve();
};
FirestoreYjsProvider.prototype.destroy = function() {};

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
    }
  };
}

console.log('\n👥 Multi-User Attribution & Contributor Tracking');

test('FirestoreYjsProvider initializes with hasLocalEdits=false and empty contributors', () => {
  const ydoc = new Y.Doc();
  const provider = new FirestoreYjsProvider('test-page', ydoc, {
    email: 'stefanie.raisch@insel.ch',
    name: 'Stefanie Raisch'
  });

  expect(provider.hasLocalEdits).toBe(false);
  expect(provider.getContributors()).toHaveLength(0);
  provider.destroy();
});

test('local edit sets hasLocalEdits=true and records contributor', () => {
  const ydoc = new Y.Doc();
  const provider = new FirestoreYjsProvider('test-page', ydoc, {
    email: 'stefanie.raisch@insel.ch',
    name: 'Stefanie Raisch'
  });
  provider._setupUpdateListener();

  // Simulate local edit via ydoc
  const ytext = ydoc.getText('test');
  ytext.insert(0, 'Hello world');

  expect(provider.hasLocalEdits).toBe(true);
  const contributors = provider.getContributors();
  expect(contributors).toHaveLength(1);
  expect(contributors[0].email).toBe('stefanie.raisch@insel.ch');
  expect(contributors[0].name).toBe('Stefanie Raisch');

  provider.destroy();
});

test('recordContributor keeps distinct contributors, most recently observed last', () => {
  const ydoc = new Y.Doc();
  const provider = new FirestoreYjsProvider('test-page', ydoc, {
    email: 'stefanie.raisch@insel.ch',
    name: 'Stefanie Raisch'
  });

  provider.recordContributor('stefanie.raisch@insel.ch', 'Stefanie Raisch');
  provider.recordContributor('lars.wenzel@insel.ch', 'Lars Wenzel');
  provider.recordContributor('stefanie.raisch@insel.ch', 'Stefanie Raisch'); // edits again

  // Order matters: resolveSnapshotAttribution() credits the *last* entry when this client
  // did not edit, so a repeat editor has to move to the end rather than keep its old slot.
  const contributors = provider.getContributors();
  expect(contributors).toHaveLength(2);
  expect(contributors[0].email).toBe('lars.wenzel@insel.ch');
  expect(contributors[1].email).toBe('stefanie.raisch@insel.ch');

  provider.clearContributors();
  expect(provider.getContributors()).toHaveLength(0);
  expect(provider.hasLocalEdits).toBe(false);

  provider.destroy();
});

test('a missing userName falls back to the formatted e-mail', () => {
  const ydoc = new Y.Doc();
  const provider = new FirestoreYjsProvider('test-page', ydoc, {
    email: 'stefanie.raisch@insel.ch',
    name: 'Stefanie Raisch'
  });

  provider.recordContributor('lars.wenzel@insel.ch');
  expect(provider.getContributors()[0].name).toBe('Lars Wenzel');

  provider.destroy();
});

console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
