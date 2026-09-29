/**
 * Unit tests for the reload-safety gate — src/utils/reload-safety.js
 * Run with: node src/utils/reload-safety.test.js
 *
 * A service-worker update must never yank the page out from under someone
 * mid-pitch or with writes still in flight, so this policy is worth pinning down.
 */

const { isReloadSafe } = await import('./reload-safety.js');

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
    }
  };
}

console.log('\n🔄 Service Worker Reload-Safety Gate');

test('an idle, visible tab reloads immediately', () => {
  expect(isReloadSafe({})).toBe(true);
  expect(isReloadSafe()).toBe(true);
});

test('never reloads while presenting, even in a hidden tab', () => {
  expect(isReloadSafe({ presenting: true })).toBe(false);
  // The projector keeps showing the deck even when the tab reports itself hidden.
  expect(isReloadSafe({ presenting: true, visibilityState: 'hidden' })).toBe(false);
});

test('never reloads with writes still pending', () => {
  expect(isReloadSafe({ hasUnsavedChanges: true })).toBe(false);
  // Not even backgrounded: that would trip the beforeunload guard.
  expect(isReloadSafe({ hasUnsavedChanges: true, visibilityState: 'hidden' })).toBe(false);
});

test('a settled provider does not block the reload', () => {
  expect(isReloadSafe({ hasUnsavedChanges: false })).toBe(true);
});

test('never reloads while the caret sits in an editable', () => {
  expect(isReloadSafe({ activeElement: { isContentEditable: true, tagName: 'DIV' } })).toBe(false);
  expect(isReloadSafe({ activeElement: { tagName: 'TEXTAREA' } })).toBe(false);
  expect(isReloadSafe({ activeElement: { tagName: 'INPUT' } })).toBe(false);
});

test('a hidden tab reloads even with focus parked in an editable', () => {
  expect(isReloadSafe({
    visibilityState: 'hidden',
    activeElement: { isContentEditable: true, tagName: 'DIV' }
  })).toBe(true);
});

test('focus on a button or the body does not block the reload', () => {
  expect(isReloadSafe({ activeElement: { tagName: 'BUTTON' } })).toBe(true);
  expect(isReloadSafe({ activeElement: { tagName: 'BODY' } })).toBe(true);
});

console.log(`\n────────────────────────────────────────\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('✅ All reload-safety tests passed!');
}
