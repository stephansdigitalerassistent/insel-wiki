import { test as base } from '@playwright/test';

/**
 * Custom test fixture that ensures a clean state for each test.
 * It clears y-indexeddb and non-auth state before each test runs.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    // We add an init script that will run on every page navigation/load.
    // We specifically target y-indexeddb which might leak between tests.
    await page.addInitScript(() => {
      try {
        // Clear all IndexedDB databases that match the wiki pattern
        if (window.indexedDB && window.indexedDB.databases) {
          window.indexedDB.databases().then(dbs => {
            for (const db of dbs) {
              // Only delete databases related to insel-wiki to avoid 
              // messing with Firebase Auth if it uses IDB.
              if (db.name && db.name.startsWith('insel-wiki-page-')) {
                window.indexedDB.deleteDatabase(db.name);
              }
            }
          }).catch(() => {});
        }

        // Clear LocalStorage items that are NOT auth-related
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && !key.startsWith('firebase:authUser')) {
            localStorage.removeItem(key);
          }
        }
      } catch (e) {
        // Ignore errors in init script
      }
    });

    await use(page);
  },
});

export { expect } from '@playwright/test';
