import { test, expect } from '@playwright/test';

const TEST_USER = 'test.user@insel.ch';
const TEST_PASS = 'InselWikiTest2026!';

async function login(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  
  const overlay = page.locator('#auth-overlay');
  try {
    await expect(overlay).not.toHaveClass(/hidden/, { timeout: 3000 });
    await page.fill('#login-email', TEST_USER);
    await page.fill('#login-password', TEST_PASS);
    await page.click('#login-btn');
    await expect(overlay).toHaveClass(/hidden/, { timeout: 15000 });
  } catch (e) {}

  await page.evaluate(() => document.getElementById('auth-overlay')?.remove());
  await expect(page.locator('#user-info span')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(500);
}

async function ensureSidebarOpen(page) {
  const toggle = page.locator('#sidebar-toggle');
  if (await toggle.isVisible()) {
    const sidebar = page.locator('#sidebar');
    await expect(async () => {
      if (await sidebar.evaluate(el => !el.classList.contains('open'))) {
        await toggle.click({ force: true });
        await expect(sidebar).toHaveClass(/open/, { timeout: 1000 });
      }
    }).toPass({ timeout: 5000 });
    await page.waitForTimeout(500);
  }
}

test.describe('Comprehensive Feature Tests', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('User Profile Modal: open and close', async ({ page }) => {
    await ensureSidebarOpen(page);
    await page.click('#user-info');
    const profileModal = page.locator('#profile-modal');
    await expect(profileModal).not.toHaveClass(/hidden/, { timeout: 5000 });
    await page.click('#profile-cancel-btn');
    await expect(profileModal).toHaveClass(/hidden/, { timeout: 5000 });
  });

  test('History Panel: open and close', async ({ page }) => {
    // Go to an existing page like page-tests to see history
    await page.goto('/#/page-tests');
    await page.waitForTimeout(1000);
    const historyBtn = page.locator('#history-btn');
    // Ensure button is visible (desktop)
    if (await historyBtn.isVisible()) {
        await historyBtn.click();
        const historyPanel = page.locator('#history-panel');
        await expect(historyPanel).not.toHaveClass(/hidden/, { timeout: 5000 });
        // Close it
        await page.click('#close-history');
        await expect(historyPanel).toHaveClass(/hidden/, { timeout: 5000 });
    }
  });

  test('Comments Sidebar: add comment and close', async ({ page }) => {
    await page.goto('/#/page-tests');
    await page.waitForTimeout(1000);
    
    // Use the comment toolbar button
    const commentBtn = page.locator('button[data-action="comment"]');
    if (await commentBtn.isVisible()) {
        await commentBtn.click();
        const commentsSidebar = page.locator('.comments-sidebar');
        await expect(commentsSidebar).not.toHaveClass(/hidden/, { timeout: 5000 });
        
        await page.fill('#new-comment-text', 'Automated Test Comment');
        await page.click('#save-comment-btn');
        
        // Wait for comment to appear
        const commentItem = page.locator('.comment-item', { hasText: 'Automated Test Comment' }).first();
        await expect(commentItem).toBeVisible({ timeout: 5000 });

        // Close
        await page.click('#close-comments-btn');
        await expect(commentsSidebar).toHaveClass(/hidden/, { timeout: 5000 });
    }
  });

  test('Mentions: check suggestion popup', async ({ page }) => {
    await page.goto('/#/page-tests');
    await expect(page.locator('#editor-loading-overlay')).toBeHidden({ timeout: 15000 });
    const editor = page.locator('.tiptap');
    await editor.focus();
    await page.keyboard.type('@');
    await page.waitForTimeout(1000);
    const popup = page.locator('.mention-suggestions');
    // The popup should be in the DOM
    await expect(popup).toBeVisible({ timeout: 5000 });
  });
});
