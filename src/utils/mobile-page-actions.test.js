/**
 * Unit tests for the drawer label-key resolution —
 * src/components/mobile-page-actions.js
 * Run with: node src/utils/mobile-page-actions.test.js
 *
 * The drawer reuses each button's existing `[title]` translation key as its
 * visible label, so no new strings drift out of sync. Getting that derivation
 * wrong silently produces unlabelled rows.
 */

const { resolveLabelKey } = await import('../components/mobile-page-actions.js');

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

console.log('\n📱 Mobile Page Actions — label keys');

test('derives the label key from a [title] binding', () => {
  expect(resolveLabelKey(null, '[title]editor.history')).toBe('editor.history');
  expect(resolveLabelKey(null, '[title]editor.deletePage')).toBe('editor.deletePage');
});

test('data-mobile-label overrides the tooltip key', () => {
  // The presentation tooltip is "Präsentieren (Alt+P)" — a shortcut hint reads
  // badly as a label on a phone.
  expect(resolveLabelKey('editor.presentationModeShort', '[title]editor.presentationMode'))
    .toBe('editor.presentationModeShort');
});

test('accepts a plain (non-attribute) binding', () => {
  expect(resolveLabelKey(null, 'editor.history')).toBe('editor.history');
});

test('ignores bindings that target another attribute', () => {
  // A [placeholder] or [aria-label] binding is not a label for this button.
  expect(resolveLabelKey(null, '[placeholder]navigation.searchPlaceholder')).toBe(null);
  expect(resolveLabelKey(null, '[aria-label]editor.history')).toBe(null);
});

test('returns null when there is nothing to go on', () => {
  expect(resolveLabelKey(null, null)).toBe(null);
  expect(resolveLabelKey(undefined, undefined)).toBe(null);
  expect(resolveLabelKey('', '')).toBe(null);
});

console.log(`\n────────────────────────────────────────\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('✅ All mobile page action tests passed!');
}
