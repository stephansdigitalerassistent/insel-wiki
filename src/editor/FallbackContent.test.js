/**
 * Unit tests for Yjs Fallback Content & Emptied Document Preservation
 * Run with: node src/editor/FallbackContent.test.js
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
// Stub awareness network write in unit tests to prevent hanging grpc retries
FirestoreYjsProvider.prototype._publishOwnAwareness = () => Promise.resolve();

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
    toBeTruthy() {
      if (!actual) throw new Error(`Expected truthy but got "${actual}"`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`Expected falsy but got "${actual}"`);
    }
  };
}

console.log('\n📄 Yjs Provider & Fallback Content Invariants');

test('FirestoreYjsProvider initializes with isLoaded=false and hasYjsData=false', () => {
  const ydoc = new Y.Doc();
  const provider = new FirestoreYjsProvider('test-page-id', ydoc, { name: 'Test' });
  expect(provider.isLoaded).toBe(false);
  expect(provider.hasYjsData).toBe(false);
  provider.destroy();
});

test('FirestoreYjsProvider setLoadCallback triggers immediately if already loaded', () => {
  const ydoc = new Y.Doc();
  const provider = new FirestoreYjsProvider('test-page-id', ydoc, { name: 'Test' });
  provider.isLoaded = true;
  provider.hasYjsData = true;

  let reportedData = null;
  provider.setLoadCallback((hasData) => {
    reportedData = hasData;
  });

  expect(reportedData).toBe(true);
  provider.destroy();
});

test('Fallback logic NEVER applies initialContent when hasAnyYjsData is true', () => {
  // Simulate the fireReady decision logic
  const shouldApplyFallback = ({ initialContent, isEmpty, hasDocChanged, hasAnyYjsData, canApplyFallback, isCurrentPage }) => {
    return Boolean(initialContent && isEmpty && !hasDocChanged && !hasAnyYjsData && canApplyFallback && isCurrentPage);
  };

  // Scenario 1: Page has existing Yjs data, user deleted screenshot making doc empty
  const res1 = shouldApplyFallback({
    initialContent: '![](https://example.com/screenshot.png)',
    isEmpty: true,
    hasDocChanged: true, // user deleted screenshot
    hasAnyYjsData: true, // provider has Yjs state/updates
    canApplyFallback: true,
    isCurrentPage: true,
  });
  expect(res1).toBe(false);

  // Scenario 2: Document reloaded after emptying (hasDocChanged false on fresh mount, but Yjs has updates)
  const res2 = shouldApplyFallback({
    initialContent: '![](https://example.com/screenshot.png)',
    isEmpty: true,
    hasDocChanged: false,
    hasAnyYjsData: true, // provider loaded Yjs data (state or updates)
    canApplyFallback: true,
    isCurrentPage: true,
  });
  expect(res2).toBe(false);

  // Scenario 3: Legacy page with no Yjs data ever saved
  const res3 = shouldApplyFallback({
    initialContent: '# Legacy Markdown Page',
    isEmpty: true,
    hasDocChanged: false,
    hasAnyYjsData: false, // no Yjs records exist
    canApplyFallback: true,
    isCurrentPage: true,
  });
  expect(res3).toBe(true);

  // Scenario 4: User started typing before fireReady ran
  const res4 = shouldApplyFallback({
    initialContent: '# Legacy Markdown Page',
    isEmpty: false, // user typed
    hasDocChanged: true,
    hasAnyYjsData: false,
    canApplyFallback: true,
    isCurrentPage: true,
  });
  expect(res4).toBe(false);

  // Scenario 5: Timeout fired while provider is still loading over slow network
  const res5 = shouldApplyFallback({
    initialContent: '![](https://example.com/screenshot.png)',
    isEmpty: true,
    hasDocChanged: false,
    hasAnyYjsData: false, // not loaded yet
    canApplyFallback: false, // provider.isLoaded is false
    isCurrentPage: true,
  });
  expect(res5).toBe(false);
});

console.log(`\n────────────────────────────────────────`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('✅ All fallback content tests passed!');
  process.exit(0);
}
