import { test, expect } from '@playwright/test';
import { login as sharedLogin } from './helpers/auth.js';

// Credentials for testing
const TEST_USER = 'test.user@insel.ch';
const TEST_PASS = 'InselWikiTest2026!';

/**
 * Helper to perform login
 */
async function login(page) {
  await sharedLogin(page, TEST_USER, TEST_PASS);
}

test.describe('Language Switching and Persistence', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test.afterEach(async ({ page }) => {
    // Reset to German to avoid breaking other tests that might share the same user
    try {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      // Wait for auth to initialize
      await page.waitForSelector('#user-info span', { timeout: 10000 });
      
      await page.click('#user-info');
      await page.waitForSelector('#profile-language', { timeout: 5000 });
      await page.selectOption('#profile-language', 'de');
      await page.click('#profile-save-btn');
      await expect(page.locator('#profile-modal')).toHaveClass(/hidden/, { timeout: 5000 });
    } catch (e) {
      console.warn('Failed to reset language to German:', e.message);
    }
  });

  test('should switch language and persist it after reload', async ({ page }) => {
    // 1. Initial check (assuming default is German or detected from browser)
    // We'll force it to German first to have a stable starting point if needed,
    // but let's just see what it is and switch to English.
    
    const newPageBtn = page.locator('#new-page-btn');
    
    // Open profile modal
    await page.click('#user-info');
    await expect(page.locator('#profile-modal')).not.toHaveClass(/hidden/);

    // Select English
    await page.selectOption('#profile-language', 'en');
    await page.click('#profile-save-btn');

    // Wait for modal to close
    await expect(page.locator('#profile-modal')).toHaveClass(/hidden/);

    // 2. Verify immediate language change
    // Check "Saved" status text or some other translated element
    // navigation.newPage.button -> title of #new-page-btn
    await expect(newPageBtn).toHaveAttribute('title', 'New Page');
    
    // Also check #save-status text
    await expect(page.locator('#save-status')).toHaveText('Saved');

    // 3. Reload page and verify persistence
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    
    // Wait for auth and profile to load
    await expect(page.locator('#user-info span')).toBeVisible({ timeout: 15000 });

    // Verify it's still English
    await expect(newPageBtn).toHaveAttribute('title', 'New Page');
    await expect(page.locator('#save-status')).toHaveText('Saved');

    // Check if the selector in the modal also reflects the saved language
    await page.click('#user-info');
    await expect(page.locator('#profile-language')).toHaveValue('en');
    await page.click('#profile-cancel-btn');

    // 4. Test French
    await page.click('#user-info');
    await page.selectOption('#profile-language', 'fr');
    await page.click('#profile-save-btn');
    await expect(page.locator('#profile-modal')).toHaveClass(/hidden/);
    await expect(newPageBtn).toHaveAttribute('title', 'Nouvelle page');
    
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#user-info span')).toBeVisible({ timeout: 15000 });
    await expect(newPageBtn).toHaveAttribute('title', 'Nouvelle page');
  });
});
