import { test, expect } from './helpers/test-fixture.js';
import { login as sharedLogin } from './helpers/auth.js';
import { createTestPage, deletePageViaUI, ensureSidebarOpen, ensureSidebarClosed } from './helpers/page-utils.js';

const TEST_USER = 'test.user@insel.ch';
const TEST_PASS = 'InselWikiTest2026!';

// Overriding baseUrl to the live site

test.describe('Live Insel-Wiki E2E Tests', () => {
  test.use({ baseURL: 'https://insel-wiki.web.app' });
  let createdPageIds = [];
  let createdTitles = [];

  async function login(page) {
    await sharedLogin(page, TEST_USER, TEST_PASS);
  }

  async function createPage(page, title, isChild = false) {
      if (!isChild) {
          // Top level in this context means child of page-tests
          const id = await createTestPage(page, title);
          createdPageIds.push(id);
          createdTitles.push(title);
          return id;
      } else {
          // Create as child of current page
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
          await expect(page.locator('#page-title')).toHaveValue(title, { timeout: 15000 });
          
          await page.waitForURL(/\/([a-zA-Z0-9_-]+)/);
          const urlMatch = page.url().match(/#\/([^\/]+)/);
          const pageId = urlMatch ? urlMatch[1] : '';
          createdPageIds.push(pageId);
          createdTitles.push(title);
          return pageId;
      }
  }

  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(`Browser: ${msg.text()}`));
    createdPageIds = [];
    createdTitles = [];
    await login(page);
  });

  test.afterEach(async ({ page }) => {
    // Ensure dashboard is closed if open
    const dashboardOverlay = page.locator('.dashboard-overlay');
    if (await dashboardOverlay.isVisible()) {
        await page.click('#close-dashboard-btn', { force: true });
        await expect(dashboardOverlay).toBeHidden({ timeout: 5000 });
    }

    // Soft Delete any created pages that still exist (reversed order to delete children first)
    for (const id of [...createdPageIds].reverse()) {
        try {
            await deletePageViaUI(page, id);
        } catch (e) {
            // Might already be deleted
        }
    }
    
    // Empty the trash of exactly the items we created
    await ensureSidebarOpen(page);
    await page.click('.trash-header');
    await page.waitForTimeout(1000);
    
    for (const title of createdTitles) {
       const trashItem = page.locator('.trash-item', { hasText: title });
       if (await trashItem.isVisible()) {
          await trashItem.locator('.btn-danger').click();
          const confirm = page.locator('.modal-box', { hasText: 'Endgültig löschen?' });
          if (await confirm.isVisible({ timeout: 5000 })) {
              await confirm.locator('button', { hasText: 'Löschen' }).click();
          }
          await expect(trashItem).not.toBeVisible({timeout: 5000});
       }
    }
  });

  test('Core functionality: Pages, Tasks, Search', async ({ page }) => {
    test.setTimeout(120000); // Increase timeout for live e2e test
    // 1. Create Top-level Page (under page-tests)
    const topLevelTitle = `E2E-Top-${Date.now()}`;
    await createPage(page, topLevelTitle, false);
    await ensureSidebarClosed(page);
    
    // Write some rich text
    await expect(page.locator('#editor-loading-overlay')).toBeHidden({ timeout: 15000 });
    let editor = page.locator('.tiptap:visible');
    await editor.focus();
    await page.keyboard.type('Hello World! This is a rich text test.');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+S');
    await expect(page.locator('#save-status')).toHaveText(/Gespeichert/, { timeout: 10000 });
    await page.waitForTimeout(2000); // sync

    // 2. Create Child Page (under the topLevelTitle page)
    const childTitle = `E2E-Child-${Date.now()}`;
    await createPage(page, childTitle, true);
    await ensureSidebarClosed(page);
    
    // Add a Task Item
    await expect(page.locator('#editor-loading-overlay')).toBeHidden({ timeout: 15000 });
    const taskText = `Task-${Date.now()}`;
    editor = page.locator('.tiptap:visible');
    await editor.focus();
    
    await page.keyboard.type(`[ ] ${taskText}`, { delay: 50 });
    await page.keyboard.press('Enter');
    
    await page.keyboard.press('Control+S');
    await expect(page.locator('#save-status')).toHaveText(/Gespeichert/, { timeout: 10000 });
    await page.waitForTimeout(6000); // wait for save to firestore

    // We navigate away to ensure "Auto-saving Markdown on page leave" triggers 
    await page.goto('/#/');
    await page.waitForTimeout(4000); // wait for save to firestore

    // 3. Task Aggregation in Dashboard
    await ensureSidebarOpen(page);
    await page.click('#open-dashboard-btn');
    const dashboardOverlay = page.locator('.dashboard-overlay');
    await expect(dashboardOverlay).toBeVisible();
    await page.waitForTimeout(2000);

    await expect(async () => {
      const taskCard = page.locator('.task-card', { hasText: taskText });
      try {
        await expect(taskCard).toBeVisible({ timeout: 2000 });
      } catch (e) {
        // close and reopen
        await page.click('#close-dashboard-btn', { force: true });
        await page.waitForTimeout(500);
        await ensureSidebarOpen(page);
        await page.click('#open-dashboard-btn');
        await expect(dashboardOverlay).toBeVisible();
        throw e;
      }
    }).toPass({ timeout: 30000 });

    // Close dashboard
    await page.click('#close-dashboard-btn', { force: true });
    await expect(dashboardOverlay).toBeHidden({ timeout: 5000 });

    // 4. Full-text Search
    await ensureSidebarOpen(page);
    
    const searchInput = page.locator('#search-input');
    await searchInput.fill('');
    await page.waitForTimeout(500);
    await searchInput.pressSequentially(childTitle, { delay: 100 });
    await page.waitForTimeout(2000);
    
    const searchResult = page.locator('#page-tree').locator(`text="${childTitle}"`).first();
    await expect(searchResult).toBeVisible({ timeout: 15000 });
    
    // 5. Soft & Permanent Deletion
    // We delete the child page
    await searchResult.click();
    await ensureSidebarClosed(page);
    await page.waitForTimeout(1000);
    
    // Soft Delete
    await page.click('#delete-page-btn');
    const deleteConfirm = page.locator('.modal-box', { hasText: 'Seite löschen' });
    if (await deleteConfirm.isVisible({ timeout: 5000 })) {
        await deleteConfirm.locator('button', { hasText: 'Löschen' }).click();
    }
    await page.waitForTimeout(2000);
    
    // Permanent Delete
    await ensureSidebarOpen(page);
    await page.click('.trash-header');
    await page.waitForTimeout(2000);
    
    const trashItem = page.locator('.trash-item', { hasText: childTitle });
    await expect(trashItem).toBeVisible({ timeout: 5000 });
    
    await trashItem.locator('.btn-danger').click();
    const permConfirm = page.locator('.modal-box', { hasText: 'Endgültig löschen?' });
    if (await permConfirm.isVisible({ timeout: 5000 })) {
        await permConfirm.locator('button', { hasText: 'Löschen' }).click();
    }
    await expect(trashItem).not.toBeVisible({ timeout: 5000 });
  });
});
