import { test, expect } from './helpers/test-fixture.js';
import { login } from './helpers/auth.js';

// Credentials for testing
const TEST_USER = 'test.user@insel.ch';
const TEST_PASS = 'InselWikiTest2026!';

test.describe('Language Persistence Across Sessions', () => {

  test.afterAll(async ({ browser }) => {
    // Final reset to German to ensure clean state for other tests
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await login(page, TEST_USER, TEST_PASS);
      await page.click('#user-info');
      await page.waitForSelector('#profile-language', { timeout: 5000 });
      await page.selectOption('#profile-language', 'de');
      await page.click('#profile-save-btn');
      await expect(page.locator('#profile-modal')).toHaveClass(/hidden/, { timeout: 5000 });
    } catch (e) {
      console.warn('Final reset to German failed:', e.message);
    } finally {
      await context.close();
    }
  });

  test('should persist language when opening a completely new session (browser context)', async ({ browser }) => {
    // --- Session 1: Set to English ---
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    await login(page1, TEST_USER, TEST_PASS);

    // Open profile and set to English
    await page1.click('#user-info');
    await page1.selectOption('#profile-language', 'en');
    await page1.click('#profile-save-btn');
    await expect(page1.locator('#profile-modal')).toHaveClass(/hidden/);
    
    // Verify immediate change
    await expect(page1.locator('#new-page-btn')).toHaveAttribute('title', 'New Page');

    await context1.close();

    // --- Session 2: Verify English and set to French ---
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await login(page2, TEST_USER, TEST_PASS);

    // Verify it's still English
    await expect(page2.locator('#new-page-btn')).toHaveAttribute('title', 'New Page');

    // Change to French
    await page2.click('#user-info');
    await page2.selectOption('#profile-language', 'fr');
    await page2.click('#profile-save-btn');
    await expect(page2.locator('#profile-modal')).toHaveClass(/hidden/);
    
    await context2.close();

    // --- Session 3: Verify French ---
    const context3 = await browser.newContext();
    const page3 = await context3.newPage();
    await login(page3, TEST_USER, TEST_PASS);

    // Verify it's French
    await expect(page3.locator('#new-page-btn')).toHaveAttribute('title', 'Nouvelle page');
    
    await context3.close();
  });

  test('should persist language after page reload in the same session', async ({ page }) => {
    await login(page, TEST_USER, TEST_PASS);

    // Set to Italian (assuming 'it' is supported)
    await page.click('#user-info');
    await page.selectOption('#profile-language', 'it');
    await page.click('#profile-save-btn');
    await expect(page.locator('#profile-modal')).toHaveClass(/hidden/);
    
    // Verify immediate change (it: "Nuova pagina")
    await expect(page.locator('#new-page-btn')).toHaveAttribute('title', 'Nuova pagina');

    // Reload
    await page.reload();
    await expect(page.locator('#user-info span')).toBeVisible({ timeout: 15000 });
    
    // Check again
    await expect(page.locator('#new-page-btn')).toHaveAttribute('title', 'Nuova pagina');
  });
});
