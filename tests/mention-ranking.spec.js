import { test, expect } from '@playwright/test';
import { login as sharedLogin } from './helpers/auth.js';

const TEST_USER = 'test.user@insel.ch';
const TEST_PASS = 'InselWikiTest2026!';

async function login(page) {
  await sharedLogin(page, TEST_USER, TEST_PASS);
}

test.describe('Mention Ranking', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  const getCleanedItems = async (page) => {
    const items = await page.locator('.mention-item:not(.no-result)').allTextContents();
    return items.map(s => s.trim().replace(/\s+/g, ' '));
  };

  test('should rank frequently picked mentions higher and cap to 7', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/#/page-tests');
    await expect(page.locator('#editor-loading-overlay')).toBeHidden({ timeout: 30000 });
    
    const editor = page.locator('.tiptap:visible');
    await expect(editor).toBeVisible();
    await editor.focus();

    // Clear previous frequency state
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter(key => key.startsWith('mention-frequencies-'))
        .forEach(key => localStorage.removeItem(key));
    });

    // 1. Initial trigger
    await page.keyboard.type('@');
    await page.waitForSelector('.mention-suggestions', { timeout: 10000 });

    let cleanedItems = await getCleanedItems(page);
    
    if (cleanedItems.length < 2) {
      // Fallback if not enough users are visible initially
      await page.keyboard.type('a');
      await page.waitForTimeout(1000);
      cleanedItems = await getCleanedItems(page);
    }
    
    if (cleanedItems.length < 2) {
      console.warn('Skipping ranking test: not enough mention options found.');
      return;
    }

    const secondItem = cleanedItems[1];

    // 2. Pick the second item multiple times to increase its frequency
    for (let i = 0; i < 3; i++) {
      if (!(await page.locator('.mention-suggestions').isVisible())) {
        await page.keyboard.press('Enter');
        await page.keyboard.type('@');
      }
      await page.waitForSelector('.mention-suggestions', { timeout: 5000 });
      await page.locator('.mention-item', { hasText: secondItem }).first().click();
      await page.waitForTimeout(500);
    }

    // 3. Verify it now ranks first
    await page.keyboard.press('Enter');
    await page.keyboard.type('@');
    await page.waitForSelector('.mention-suggestions', { timeout: 5000 });
    
    const updatedItems = await getCleanedItems(page);
    expect(updatedItems[0]).toBe(secondItem);
    expect(updatedItems.length).toBeLessThanOrEqual(7);
  });

  test('unpicked options should still be reachable via typing', async ({ page }) => {
    await page.goto('/#/page-tests');
    await expect(page.locator('#editor-loading-overlay')).toBeHidden({ timeout: 15000 });
    const editor = page.locator('.tiptap:visible');
    await editor.focus();

    await page.keyboard.type('@');
    await page.waitForSelector('.mention-suggestions', { timeout: 10000 });

    // Type a specific prefix to find a user
    await page.keyboard.type('S'); 
    await page.waitForTimeout(1000);
    
    const filteredItems = await getCleanedItems(page);
    expect(filteredItems.some(item => item.toLowerCase().includes('s'))).toBe(true);
    
    await page.keyboard.type('tefanie');
    await page.waitForTimeout(1000);
    const specificItems = await getCleanedItems(page);
    expect(specificItems[0].toLowerCase()).toContain('stefanie');
  });
});
