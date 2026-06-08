import { test, expect } from './helpers/test-fixture.js';
import { createTestPage, deletePageViaUI, ensureSidebarOpen, ensureSidebarClosed } from './helpers/page-utils.js';
import { login as sharedLogin } from './helpers/auth.js';

const TEST_USER = 'test.user@insel.ch';
const TEST_PASS = 'InselWikiTest2026!';

// Overriding baseURL to the live site for this audit
test.use({ baseURL: 'https://insel-wiki.web.app' });

test.describe('Insel-Wiki Core Audit', () => {
  let createdPageIds = [];
  let createdTitles = [];

  async function login(page) {
    await sharedLogin(page, TEST_USER, TEST_PASS);
  }

  async function createPage(page, title, isChild = false) {
    if (!isChild) {
      const id = await createTestPage(page, title);
      createdPageIds.push(id);
      createdTitles.push(title);
      return id;
    } else {
      const emptyNewBtn = page.locator('#empty-new-page');
      if (await emptyNewBtn.isVisible()) {
        await emptyNewBtn.click({ force: true });
      } else {
        await ensureSidebarOpen(page);
        await page.waitForTimeout(500);
        await page.evaluate(() => {
          const btn = document.getElementById('new-page-btn') || document.getElementById('toolbar-new-page-btn');
          if (btn) btn.click();
        });
      }
      
      await page.waitForSelector('#new-page-modal-input', { timeout: 10000 });
      await page.fill('#new-page-modal-input', title);
      
      const childOpt = page.locator('#modal-opt-child');
      if (await childOpt.isVisible() && await childOpt.isEnabled() && !(await childOpt.isChecked())) {
          await childOpt.check({ force: true });
      }
      
      await page.click('#new-page-modal-submit');
      await expect(page.locator('#page-title')).toHaveValue(title, { timeout: 20000 });
      
      await page.waitForURL(/\/([a-zA-Z0-9_-]+)/);
      const urlMatch = page.url().match(/#\/([^\/]+)/);
      const pageId = urlMatch ? urlMatch[1] : '';
      createdPageIds.push(pageId);
      createdTitles.push(title);
      return pageId;
    }
  }

  test.beforeEach(async ({ page }) => {
    createdPageIds = [];
    createdTitles = [];
    await login(page);
  });

  test.afterEach(async ({ page }) => {
    // 1. Close dashboard if open
    const dashboardOverlay = page.locator('.dashboard-overlay');
    if (await dashboardOverlay.isVisible()) {
        await page.click('#close-dashboard-btn', { force: true });
        await expect(dashboardOverlay).toBeHidden({ timeout: 5000 });
    }

    // 2. Soft Delete created pages (reversed to delete children first)
    for (const id of [...createdPageIds].reverse()) {
      try {
        await deletePageViaUI(page, id);
      } catch (e) {
        // Might already be deleted
      }
    }
    
    // 3. Permanent Delete from Trash
    try {
      await ensureSidebarOpen(page);
      await page.click('.trash-header');
      await page.waitForTimeout(2000);
      
      for (const title of createdTitles) {
         const trashItem = page.locator('.trash-item', { hasText: title });
         if (await trashItem.isVisible()) {
            await trashItem.locator('.btn-danger').click();
            const confirm = page.locator('.modal-box', { hasText: 'Endgültig löschen?' });
            if (await confirm.isVisible({ timeout: 5000 })) {
                await confirm.locator('button', { hasText: 'Löschen' }).click();
            }
            await expect(trashItem).not.toBeVisible({timeout: 10000});
         }
      }
    } catch (e) {
      console.log(`Trash cleanup error: ${e.message}`);
    }
  });

  test('Audit: Full Lifecycle & Core Features', async ({ page }) => {
    test.setTimeout(180000); // 3 minutes for the full audit

    // --- 1. Create Top-level Page (under page-tests) ---
    const topTitle = `AUDIT-Top-${Date.now()}`;
    await createPage(page, topTitle, false);
    await ensureSidebarClosed(page);

    // --- 2. Rich Text Content ---
    await expect(page.locator('#editor-loading-overlay')).toBeHidden({ timeout: 20000 });
    const editor = page.locator('.tiptap:visible');
    await editor.focus();
    await page.keyboard.type('Rich Text Audit Content.');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+s');
    await expect(page.locator('#save-status')).toHaveText(/Gespeichert/, { timeout: 15000 });

    // --- 3. Create Child Page ---
    const childTitle = `AUDIT-Child-${Date.now()}`;
    await createPage(page, childTitle, true);
    await ensureSidebarClosed(page);

    // --- 4. Task Items & Aggregation ---
    const taskText = `Audit-Task-${Date.now()}`;
    await editor.focus();
    // Use keyboard shortcut for task list to be platform independent
    await page.keyboard.press('Control+Shift+9');
    await page.keyboard.type(taskText);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+s');
    await expect(page.locator('#save-status')).toHaveText(/Gespeichert/, { timeout: 15000 });
    
    // Wait for Yjs/Firebase sync
    await page.waitForTimeout(10000);

    // Open Dashboard
    await ensureSidebarOpen(page);
    await page.click('#open-dashboard-btn');
    const dashboardOverlay = page.locator('.dashboard-overlay');
    await expect(dashboardOverlay).toBeVisible();

    // Verify task presence
    await expect(async () => {
      const taskCard = page.locator('.task-card', { hasText: taskText });
      if (!(await taskCard.isVisible())) {
          // Re-trigger dashboard load if needed
          await page.click('#close-dashboard-btn', { force: true });
          await page.waitForTimeout(1000);
          await ensureSidebarOpen(page);
          await page.click('#open-dashboard-btn');
          throw new Error('Task not visible yet');
      }
    }).toPass({ timeout: 30000 });

    await page.click('#close-dashboard-btn', { force: true });

    // --- 5. Full-text Search ---
    await ensureSidebarOpen(page);
    const searchInput = page.locator('#search-input');
    await searchInput.fill('AUDIT-Child');
    await page.waitForTimeout(2000);
    const searchResult = page.locator('.tree-item', { hasText: childTitle }).first();
    await expect(searchResult).toBeVisible({ timeout: 10000 });
    
    // --- 6. Navigation via Search ---
    await searchResult.click();
    await expect(page.locator('#page-title')).toHaveValue(childTitle);
    await ensureSidebarClosed(page);

    // --- 7. Soft Delete ---
    await page.click('#delete-page-btn');
    const confirm = page.locator('.modal-box', { hasText: 'Seite löschen' });
    await expect(confirm).toBeVisible();
    await confirm.locator('button', { hasText: 'Löschen' }).click();
    await expect(page.locator('#empty-state')).toBeVisible({ timeout: 10000 });

    // --- 8. Permanent Delete (Verification of Scenario 6) ---
    await ensureSidebarOpen(page);
    await page.click('.trash-header');
    const trashItem = page.locator('.trash-item', { hasText: childTitle });
    await expect(trashItem).toBeVisible({ timeout: 10000 });
    
    await trashItem.locator('.btn-danger').click();
    const permConfirm = page.locator('.modal-box', { hasText: 'Endgültig löschen?' });
    await expect(permConfirm).toBeVisible();
    await permConfirm.locator('button', { hasText: 'Löschen' }).click();
    await expect(trashItem).not.toBeVisible({ timeout: 15000 });
  });
});
