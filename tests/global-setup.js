// Runs once before any Playwright tests start. Sweeps any test-prefix pages
// left behind by a prior failed run so each suite starts from a clean slate.

import { cleanupTestPages } from './helpers/firestore-cleanup.js';

export default async function globalSetup() {
  try {
    await cleanupTestPages();
  } catch (e) {
    console.warn('[global-setup] cleanup failed (continuing):', e.message);
  }
}
