import { test, expect } from '@playwright/test';
import { login as sharedLogin } from './helpers/auth.js';
import { createTestPage, deletePageViaUI, ensureSidebarClosed } from './helpers/page-utils.js';

// Credentials for testing
const TEST_USER = 'test.user@insel.ch';
const TEST_PASS = 'InselWikiTest2026!';

async function login(page) {
  await sharedLogin(page, TEST_USER, TEST_PASS);
}

test.describe('Insel-Wiki Markdown Warning & Read-Only Suite', () => {
  let createdPageIds = [];

  test.beforeEach(async ({ page }) => {
    await login(page);
    createdPageIds = [];
  });

  test.afterEach(async ({ page }) => {
    for (const id of createdPageIds) {
      try {
        await deletePageViaUI(page, id);
      } catch (e) {
        console.warn(`Failed to delete page ${id} via UI:`, e.message);
      }
    }
  });

  test('Granular warning modal for complex elements with Read-only, Edit, and Cancel options', async ({ page }) => {
    const title = `TEST-MD-Warning-${Date.now()}`;
    const pageId = await createTestPage(page, title);
    createdPageIds.push(pageId);

    await ensureSidebarClosed(page);
    const editor = page.locator('.tiptap:visible');
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.focus();

    // 1. Insert a table into the page
    const tableBtn = page.locator('.format-btn[data-action="table"]');
    await expect(tableBtn).toBeVisible({ timeout: 10000 });
    await tableBtn.click();

    const tableModal = page.locator('.table-modal-box');
    await expect(tableModal).toBeVisible({ timeout: 5000 });
    await page.fill('#table-modal-rows', '2');
    await page.fill('#table-modal-cols', '2');
    await page.click('#table-modal-submit');
    await expect(tableModal).not.toBeVisible({ timeout: 5000 });

    const table = editor.locator('table');
    await expect(table).toBeVisible({ timeout: 10000 });

    // Fill table cell
    await table.locator('th').nth(0).click();
    await page.keyboard.type('Spalte 1');

    // 2. Click Markdown mode toggle button
    const mdToggleBtn = page.locator('#markdown-toggle-btn');
    await expect(mdToggleBtn).toBeVisible();
    await mdToggleBtn.click();

    // 3. Verify granular warning modal appears
    const warningModal = page.locator('.markdown-warning-modal-box');
    await expect(warningModal).toBeVisible({ timeout: 5000 });

    // Verify detected list contains table information
    const warningList = warningModal.locator('.markdown-warning-list');
    await expect(warningList).toBeVisible();
    await expect(warningList.locator('li')).toContainText(['Tabelle']);

    // Verify the 3 action buttons exist
    const cancelBtn = page.locator('#md-warning-cancel');
    const readOnlyBtn = page.locator('#md-warning-readonly');
    const editAnywayBtn = page.locator('#md-warning-edit');
    await expect(cancelBtn).toBeVisible();
    await expect(readOnlyBtn).toBeVisible();
    await expect(editAnywayBtn).toBeVisible();

    // 4. Test Cancel option
    await cancelBtn.click();
    await expect(warningModal).not.toBeVisible({ timeout: 5000 });
    // Editor must still be in WYSIWYG mode
    await expect(editor).toBeVisible();
    await expect(page.locator('#markdown-editor')).toBeHidden();

    // 5. Click Markdown toggle again and select Read-only
    await mdToggleBtn.click();
    await expect(warningModal).toBeVisible({ timeout: 5000 });
    await readOnlyBtn.click();
    await expect(warningModal).not.toBeVisible({ timeout: 5000 });

    // Verify markdown editor is visible and is read-only
    const mdEditor = page.locator('#markdown-editor');
    await expect(mdEditor).toBeVisible();
    await expect(mdToggleBtn).toHaveClass(/active/);
    const isReadOnly = await mdEditor.evaluate((el) => el.readOnly);
    expect(isReadOnly).toBe(true);

    // Toggle back to WYSIWYG mode
    await mdToggleBtn.click();
    await expect(mdEditor).toBeHidden();
    await expect(editor).toBeVisible();

    // Verify table is intact
    await expect(editor.locator('table')).toBeVisible();
    await expect(editor.locator('table th').first()).toHaveText('Spalte 1');

    // 6. Click Markdown toggle again and select Edit anyway
    await mdToggleBtn.click();
    await expect(warningModal).toBeVisible({ timeout: 5000 });
    await editAnywayBtn.click();
    await expect(warningModal).not.toBeVisible({ timeout: 5000 });

    // Verify markdown editor is visible and NOT read-only
    await expect(mdEditor).toBeVisible();
    const isEditable = await mdEditor.evaluate((el) => !el.readOnly);
    expect(isEditable).toBe(true);

    // Edit content in markdown mode
    await mdEditor.fill('# Ersetzter Markdown Text');
    await page.waitForTimeout(600); // Allow debounced sync or toggle sync

    // Toggle back to WYSIWYG mode
    await mdToggleBtn.click();
    await expect(mdEditor).toBeHidden();
    await expect(editor).toBeVisible();
    await expect(editor.locator('h1')).toHaveText('Ersetzter Markdown Text');
  });
});
