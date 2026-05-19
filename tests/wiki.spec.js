import { test, expect } from '@playwright/test';
import { login as sharedLogin } from './helpers/auth.js';
import { createTestPage, deletePageViaUI, ensureSidebarOpen, ensureSidebarClosed } from './helpers/page-utils.js';

// Credentials for testing
const TEST_USER = 'test.user@insel.ch';
const TEST_PASS = 'InselWikiTest2026!';

/**
 * Helper to perform login
 */
async function login(page) {
  await sharedLogin(page, TEST_USER, TEST_PASS);
}

test.describe('Insel-Wiki Evolution Suite', () => {
  let createdPageIds = [];

  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      console.log(`Browser console [${msg.type()}]: ${msg.text()}`);
    });
    await login(page);
    createdPageIds = []; // Reset for each test
  });

  test.afterEach(async ({ page }) => {
    // Ensure dashboard is closed if open
    const dashboardOverlay = page.locator('.dashboard-overlay');
    if (await dashboardOverlay.isVisible()) {
        await page.click('#close-dashboard-btn', { force: true });
        await expect(dashboardOverlay).toBeHidden({ timeout: 5000 });
    }

    for (const id of createdPageIds) {
        try {
            await deletePageViaUI(page, id);
        } catch (e) {
            console.warn(`Failed to delete page ${id} via UI:`, e.message);
        }
    }
  });

  test('Dashboard: Aggregating tasks from pages', async ({ page }) => {
    const taskText = `Task-${Date.now()}`;
    const pageTitle = `TEST-TaskPage-${Date.now()}`;
    
    const pageId = await createTestPage(page, pageTitle);
    createdPageIds.push(pageId);

    await ensureSidebarClosed(page);
    const editor = page.locator('.tiptap:visible');
    await editor.focus();
    await page.keyboard.type(`[ ] ${taskText}`);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(6000); // give yjs and firestore time to sync

    // 2. Open Dashboard
    await ensureSidebarOpen(page);
    await page.waitForTimeout(500);
    await page.click('#open-dashboard-btn');
    await expect(page.locator('.dashboard-overlay')).toBeVisible();

    // Wait for the task to appear, retrying if necessary
    await expect(async () => {
      // Re-open dashboard if it closed or tasks are still rendering
      const taskCard = page.locator('.task-card', { hasText: taskText });
      await expect(taskCard).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    
    const taskCard = page.locator('.task-card', { hasText: taskText });
    await taskCard.first().click({ force: true });
    await expect(page.locator('.dashboard-overlay')).toBeHidden({ timeout: 5000 });
  });

  test('Offline: Status indicator should appear', async ({ page, context }) => {
    // On mobile, the sidebar might overlap the indicator if open
    await ensureSidebarClosed(page);

    await context.setOffline(true);
    await expect(page.locator('#offline-indicator')).toBeVisible();
    await context.setOffline(false);
    await expect(page.locator('#offline-indicator')).toBeHidden();
  });

  test('Page Lifecycle: Robust check', async ({ page }) => {
    const title = `TEST-Robust-${Date.now()}`;
    const pageId = await createTestPage(page, title);
    createdPageIds.push(pageId);

    // Verify it's created and visible
    await expect(page.locator('#page-title')).toHaveValue(title);
    
    // Edit content
    const editor = page.locator('.tiptap:visible');
    await editor.focus();
    await page.keyboard.type('Hello World');
    await page.keyboard.press('Control+s');
    
    // Wait for sync
    await page.waitForTimeout(2000);
    
    // Reload and check
    await page.reload();
    await expect(page.locator('#page-title')).toHaveValue(title);
    await expect(page.locator('.tiptap:visible')).toContainText('Hello World');
  });

  test('Trash: Moving pages to trash', async ({ page }) => {
    const title = `TEST-Trash-${Date.now()}`;
    const pageId = await createTestPage(page, title);
    // Don't push to createdPageIds as we'll delete it in the test
    
    await ensureSidebarClosed(page);
    await page.waitForSelector('#delete-page-btn');
    await page.click('#delete-page-btn');
    
    const confirm = page.locator('.modal-box', { hasText: 'Seite löschen' });
    await expect(confirm).toBeVisible();
    await confirm.locator('button', { hasText: 'Löschen' }).click();
    
    // Should redirect
    await expect(page).not.toHaveURL(new RegExp(`${pageId}$`));
  });

  test('Trash: Permanent Deletion', async ({ page }) => {
    const title = `TEST-Trash-Perm-${Date.now()}`;
    const pageId = await createTestPage(page, title);
    
    await ensureSidebarClosed(page);

    // 2. Soft delete
    await page.click('#delete-page-btn');
    const confirm = page.locator('.modal-box', { hasText: 'Seite löschen' });
    await expect(confirm).toBeVisible();
    await confirm.locator('button', { hasText: 'Löschen' }).click();
    await expect(page.locator('#empty-state')).toBeVisible();

    // 3. Open Trash
    await ensureSidebarOpen(page);
    await page.waitForTimeout(500);
    await page.click('.trash-header');
    const trashItem = page.locator('.trash-item', { hasText: title });
    await expect(trashItem).toBeVisible();

    // 4. Permanent delete
    await trashItem.locator('.btn-danger').click();
    const permConfirm = page.locator('.modal-box', { hasText: 'Endgültig löschen?' });
    await expect(permConfirm).toBeVisible();
    await permConfirm.locator('button', { hasText: 'Löschen' }).click();

    // 5. Verify gone from trash
    await expect(trashItem).not.toBeVisible();
  });
});
