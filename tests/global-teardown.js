// Runs once after all Playwright tests finish. Catches any test pages whose
// in-test afterEach hook didn't manage to clean up (crashed test, timeout,
// network blip, etc.) so Firestore stays tidy.

import { cleanupTestPages } from './helpers/firestore-cleanup.js';

export default async function globalTeardown() {
  try {
    await cleanupTestPages();
  } catch (e) {
    console.warn('[global-teardown] cleanup failed (continuing):', e.message);
  }
}
