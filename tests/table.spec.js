import { test, expect } from '@playwright/test';
import { login as sharedLogin } from './helpers/auth.js';
import { createTestPage, deletePageViaUI, ensureSidebarClosed } from './helpers/page-utils.js';

// Credentials for testing
const TEST_USER = 'test.user@insel.ch';
const TEST_PASS = 'InselWikiTest2026!';

async function login(page) {
  await sharedLogin(page, TEST_USER, TEST_PASS);
}

test.describe('Insel-Wiki Table Suite', () => {
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

  test('Table generation and bubble menu manipulation', async ({ page }) => {
    const title = `TEST-Table-${Date.now()}`;
    const pageId = await createTestPage(page, title);
    createdPageIds.push(pageId);

    await ensureSidebarClosed(page);
    const editor = page.locator('.tiptap:visible');
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.focus();

    // 1. Click Table button in formatting toolbar
    const tableBtn = page.locator('.format-btn[data-action="table"]');
    await expect(tableBtn).toBeVisible({ timeout: 10000 });
    await tableBtn.click();

    // 2. Table Modal should open
    const modal = page.locator('.table-modal-box');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Set 2 rows, 2 columns with header
    await page.fill('#table-modal-rows', '2');
    await page.fill('#table-modal-cols', '2');
    await page.click('#table-modal-submit');
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // 3. Table should be inserted: 2 rows (1 header row + 1 data row), 2 columns
    const table = editor.locator('table');
    await expect(table).toBeVisible({ timeout: 10000 });
    await expect(table.locator('tr')).toHaveCount(2);
    const headers = table.locator('th');
    await expect(headers).toHaveCount(2);
    const cells = table.locator('td');
    await expect(cells).toHaveCount(2);

    // 4. Fill cells
    await headers.nth(0).click();
    await page.keyboard.type('Spalte A');

    await headers.nth(1).click();
    await page.keyboard.type('Spalte B');

    await cells.nth(0).click();
    await page.keyboard.type('Wert 1');

    await cells.nth(1).click();
    await page.keyboard.type('Wert 2');

    // 5. Check Table Bubble Menu is displayed when caret is in table
    const tableMenu = page.locator('#table-bubble-menu');
    await expect(tableMenu).toBeVisible({ timeout: 5000 });

    // 6. Test Add Row Below (2 rows -> 3 rows)
    const addRowBelowBtn = tableMenu.locator('.table-bubble-action[data-action="addRowBelow"]');
    await addRowBelowBtn.click();
    await expect(table.locator('tr')).toHaveCount(3);

    // 7. Test Add Column After (2 cols -> 3 cols)
    const addColAfterBtn = tableMenu.locator('.table-bubble-action[data-action="addColumnAfter"]');
    await addColAfterBtn.click();
    await expect(table.locator('tr').nth(0).locator('th')).toHaveCount(3);

    // 8. Test Delete Table
    const deleteTableBtn = tableMenu.locator('.table-bubble-action[data-action="deleteTable"]');
    await deleteTableBtn.click();
    await expect(table).toHaveCount(0);
  });
});
