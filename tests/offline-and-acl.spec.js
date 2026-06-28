import { test, expect } from '@playwright/test';
import { login as sharedLogin } from './helpers/auth.js';
import { createTestPage, deletePageViaUI, ensureSidebarOpen, ensureSidebarClosed } from './helpers/page-utils.js';

const TEST_USER = 'test.user@insel.ch';
const TEST_PASS = 'InselWikiTest2026!';

test.describe('Offline and ACL Functionality Tests', () => {
  let createdPageIds = [];

  test.beforeEach(async ({ page }) => {
    createdPageIds = [];
    await sharedLogin(page, TEST_USER, TEST_PASS);
  });

  test.afterEach(async ({ page }) => {
    for (const id of createdPageIds) {
      try {
        await deletePageViaUI(page, id);
      } catch (e) {
        // Already deleted or not found
      }
    }
  });

  test('Offline status queueing and resolution', async ({ page, context }) => {
    const title = `TEST-OfflineQueue-${Date.now()}`;
    const pageId = await createTestPage(page, title);
    createdPageIds.push(pageId);

    await ensureSidebarClosed(page);

    // 1. Go Offline
    await context.setOffline(true);
    await expect(page.locator('#offline-indicator')).toBeVisible();
    await expect(page.locator('#save-status')).toContainText('Offline');

    // 2. Make local edits offline
    const editor = page.locator('.tiptap:visible');
    await editor.focus();
    await page.keyboard.type('Offline changes draft.');

    // 3. Verify queued count in UI
    await expect(page.locator('#save-status')).toContainText(/Offline \(\d+ ausstehend\)/);

    // 4. Go Online
    await context.setOffline(false);
    await expect(page.locator('#offline-indicator')).toBeHidden();
    
    // 5. Verify synced status is restored
    await expect(page.locator('#save-status')).toContainText('Gespeichert');
  });

  test('ACL page access management', async ({ page }) => {
    const title = `TEST-ACL-${Date.now()}`;
    const pageId = await createTestPage(page, title);
    createdPageIds.push(pageId);

    // 1. Open sidebar options menu
    await ensureSidebarOpen(page);
    await page.waitForTimeout(500);

    const treeItem = page.locator(`.tree-item[data-page-id="${pageId}"]`);
    await expect(treeItem).toBeVisible();

    const moreBtn = treeItem.locator('.more-btn');
    await moreBtn.click();

    // 2. Click Manage Access (Zugriff verwalten)
    const aclBtn = page.locator('.sidebar-options-item', { hasText: 'Zugriff verwalten' });
    await expect(aclBtn).toBeVisible();
    await aclBtn.click();

    // 3. Verify ACL Modal is open
    const modal = page.locator('.acl-modal-box');
    await expect(modal).toBeVisible();

    // 4. Select Restricted radio
    const radioRestricted = modal.locator('input[value="restricted"]');
    await radioRestricted.check();

    // 5. Add email address
    const emailInput = modal.locator('input[type="email"]');
    await emailInput.fill('another.user@insel.ch');
    
    const addBtn = modal.locator('button', { hasText: 'Hinzufügen' });
    await addBtn.click();

    // 6. Save ACL
    const saveBtn = modal.locator('button', { hasText: 'Speichern' });
    await saveBtn.click();

    // 7. Verify modal closes
    await expect(modal).toBeHidden();
  });
});
