import { test, expect } from '@playwright/test';

// Credentials for testing
const TEST_USER = 'test.user@insel.ch';
const TEST_PASS = 'InselWikiTest2026!';

/**
 * Helper to perform login
 */
async function login(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  const overlay = page.locator('#auth-overlay');
  if (await overlay.isHidden()) return;
  await page.fill('#login-email', TEST_USER);
  await page.fill('#login-password', TEST_PASS);
  await page.click('#login-btn');
  await expect(overlay).toBeHidden({ timeout: 15000 });
}

test.describe('Insel-Wiki Evolution Suite', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Dashboard: Aggregating tasks from pages', async ({ page }) => {
    const taskText = `Task-${Date.now()}`;
    
    // 1. Create page
    await page.click('#new-page-btn');
    await page.fill('#new-page-modal-input', `TaskPage-${Date.now()}`);
    await page.click('#new-page-modal-submit');
    
    const editor = page.locator('.tiptap');
    await editor.focus();
    
    // We type something that the editor will likely convert or we can just use the MD fallback
    // The most reliable way to test the dashboard is to ensure SOMETHING is saved that our regex catches.
    // Let's use the most permissive regex match: "[ ] text"
    await page.keyboard.type(`[ ] ${taskText}`);
    await page.keyboard.press('Enter');
    
    // Trigger manual save
    await page.keyboard.press('Control+S');
    await page.waitForTimeout(5000); // Wait longer for Firestore propagation

    // 2. Open Dashboard
    await page.click('#open-dashboard-btn');
    await expect(page.locator('.dashboard-overlay')).toBeVisible();
    
    // 3. Verify task exists (allow some retry time)
    // We search specifically for our taskText
    const taskCard = page.locator('.task-card', { hasText: taskText });
    await expect(taskCard).toBeVisible({ timeout: 15000 });
    
    // 4. Click task to navigate
    await taskCard.first().click();
    await expect(page.locator('.dashboard-overlay')).toBeHidden();
  });

  test('Offline: Status indicator should appear', async ({ page, context }) => {
    await context.setOffline(true);
    await expect(page.locator('#offline-indicator')).toBeVisible();
    await context.setOffline(false);
    await expect(page.locator('#offline-indicator')).toBeHidden();
  });

  test('Page Lifecycle: Robust check', async ({ page }) => {
    const title = `Robust-${Date.now()}`;
    await page.click('#new-page-btn');
    await page.fill('#new-page-modal-input', title);
    await page.click('#new-page-modal-submit');
    await expect(page.locator('#page-title')).toHaveValue(title);
    page.once('dialog', dialog => dialog.accept());
    await page.click('#delete-page-btn');
    await expect(page.locator('#empty-state')).toBeVisible();
  });

});
