import { test as setup, expect } from '@playwright/test';
import { login } from './helpers/auth.js';

const authFile = 'test-results/.auth/user.json';
const TEST_USER = 'test.user@insel.ch';
const TEST_PASS = 'InselWikiTest2026!';

setup('authenticate', async ({ page }) => {
  // Use a long timeout for the initial login
  setup.setTimeout(90000);

  // Clear any existing state before login to ensure a clean auth session
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  // Clear IndexedDB
  await page.evaluate(async () => {
    if (window.indexedDB && window.indexedDB.databases) {
      const dbs = await window.indexedDB.databases();
      for (const db of dbs) {
        window.indexedDB.deleteDatabase(db.name);
      }
    }
  });

  await login(page, TEST_USER, TEST_PASS);
  
  // Ensure the user info is not just visible, but has text (confirming sync)
  await expect(page.locator('#user-info span')).not.toBeEmpty({ timeout: 10000 });
  
  // Final stabilization wait for Firebase storage
  await page.waitForTimeout(2000);
  
  await page.context().storageState({ path: authFile });
});
