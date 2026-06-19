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
    await page.waitForTimeout(2000); // wait for flushPending
    await page.reload(); // Reload to trigger compaction on init
    await page.waitForTimeout(15000); // give compaction and Cloud Function time to sync (handles cold starts)

    // 2. Open Dashboard
    await ensureSidebarOpen(page);
    await page.waitForTimeout(500);
    await page.click('#open-dashboard-btn');
    await expect(page.locator('.dashboard-overlay')).toBeVisible();

    // Wait for the task to appear, retrying if necessary
    await expect(async () => {
      const taskCard = page.locator('.task-card', { hasText: taskText });
      await expect(taskCard).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30000 });
    
    const taskCard = page.locator('.task-card', { hasText: taskText }).first();
    const statusIcon = taskCard.locator('.clickable-status');
    
    // Toggle checkmark to completed
    await statusIcon.click();
    await expect(statusIcon).toContainText('✅');
    await expect(taskCard).toHaveClass(/completed/);

    // Toggle checkmark back to open
    await statusIcon.click();
    await expect(statusIcon).toContainText('⬜');
    await expect(taskCard).not.toHaveClass(/completed/);

    await taskCard.click({ force: true });
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
    
    const confirm = page.locator('.modal-overlay:visible .modal-box');
    await expect(confirm).toBeVisible();
    await confirm.locator('button.btn-danger').click();
    
    // Should redirect
    await expect(page).not.toHaveURL(new RegExp(`${pageId}$`));
  });

  test('Trash: Permanent Deletion', async ({ page }) => {
    const title = `TEST-Trash-Perm-${Date.now()}`;
    const pageId = await createTestPage(page, title);
    
    await ensureSidebarClosed(page);

    // 2. Soft delete
    await page.click('#delete-page-btn');
    const confirm = page.locator('.modal-overlay:visible .modal-box');
    await expect(confirm).toBeVisible();
    await confirm.locator('button.btn-danger').click();
    await expect(page.locator('#empty-state')).toBeVisible();

    // 3. Open Trash
    await ensureSidebarOpen(page);
    await page.waitForTimeout(500);
    await page.click('.trash-header');
    const trashItem = page.locator('.trash-item', { hasText: title });
    await expect(trashItem).toBeVisible();

    // 4. Permanent delete
    await trashItem.locator('.btn-danger').click();
    const permConfirm = page.locator('.modal-overlay:visible .modal-box');
    await expect(permConfirm).toBeVisible();
    await permConfirm.locator('button.btn-danger').click();

    // 5. Verify gone from trash
    await expect(trashItem).not.toBeVisible();
  });

  test('List editing: Backspace merges list item text with previous item', async ({ page }) => {
    const title = `TEST-ListMerge-${Date.now()}`;
    const pageId = await createTestPage(page, title);
    createdPageIds.push(pageId);

    await ensureSidebarClosed(page);
    const editor = page.locator('.tiptap:visible');
    await editor.focus();
    
    // Toggle bullet list
    await page.keyboard.press('Control+Shift+8');
    await page.keyboard.type('First item');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second item');
    
    // Move cursor to the start of "Second item"
    for (let i = 0; i < 'Second item'.length; i++) {
      await page.keyboard.press('ArrowLeft');
    }
    
    // Press Backspace at the beginning of the second list item
    await page.keyboard.press('Backspace');
    
    // The text should merge with the first item: "First itemSecond item"
    const listItems = editor.locator('li');
    await expect(listItems).toHaveCount(1);
    await expect(listItems.first()).toHaveText('First itemSecond item');
  });

  test('List editing: Backspace merges list item text with nested previous item above', async ({ page }) => {
    const title = `TEST-ListMergeNested-${Date.now()}`;
    const pageId = await createTestPage(page, title);
    createdPageIds.push(pageId);

    await ensureSidebarClosed(page);
    const editor = page.locator('.tiptap:visible');
    await editor.focus();
    
    // Toggle bullet list
    await page.keyboard.press('Control+Shift+8');
    await page.keyboard.type('First item');
    await page.keyboard.press('Enter');
    
    // Indent to create nested item
    await page.keyboard.press('Tab');
    await page.keyboard.type('Nested item');
    await page.keyboard.press('Enter');
    
    // Outdent to create outer item
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.type('Outer item');
    
    // Move cursor to the start of "Outer item"
    for (let i = 0; i < 'Outer item'.length; i++) {
      await page.keyboard.press('ArrowLeft');
    }
    
    // Press Backspace at the beginning of "Outer item"
    await page.keyboard.press('Backspace');
    
    // The text should merge with "Nested item": "Nested itemOuter item"
    const listItems = editor.locator('li');
    await expect(listItems).toHaveCount(2);
    await expect(listItems.nth(0)).toContainText('First item');
    await expect(listItems.nth(1)).toHaveText('Nested itemOuter item');
  });

  test('List editing: Backspace on item with nested children does not delete children', async ({ page }) => {
    const title = `TEST-ListMergeNestedPreserve-${Date.now()}`;
    const pageId = await createTestPage(page, title);
    createdPageIds.push(pageId);

    await ensureSidebarClosed(page);
    const editor = page.locator('.tiptap:visible');
    await editor.focus();
    
    // Toggle bullet list
    await page.keyboard.press('Control+Shift+8');
    await page.keyboard.type('First item');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Outer item');
    await page.keyboard.press('Enter');
    
    // Indent to create nested item under Outer item
    await page.keyboard.press('Tab');
    await page.keyboard.type('Nested item');
    await page.waitForTimeout(300);
    
    // Move cursor back to the start of "Outer item"
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    for (let i = 0; i < 'Outer item'.length; i++) {
      await page.keyboard.press('ArrowLeft');
    }
    await page.waitForTimeout(200);
    
    // Press Backspace at the beginning of "Outer item"
    await page.keyboard.press('Backspace');
    
    // The text should merge with "First item": "First itemOuter item"
    // And "Nested item" must still exist and be promoted to the same level!
    const listItems = editor.locator('li');
    await expect(listItems).toHaveCount(2);
    await expect(listItems.nth(0)).toHaveText('First itemOuter item');
    await expect(listItems.nth(1)).toHaveText('Nested item');
  });

  test('List editing: Backspace on item with multi-level nested children promotes one level without drift', async ({ page }) => {
    const title = `TEST-ListMergeDeepNested-${Date.now()}`;
    const pageId = await createTestPage(page, title);
    createdPageIds.push(pageId);

    await ensureSidebarClosed(page);
    const editor = page.locator('.tiptap:visible');
    await editor.focus();

    // Build:
    // - First item
    // - Outer item
    //   - Nested A
    //     - Deep A1
    await page.keyboard.press('Control+Shift+8');
    await page.keyboard.type('First item');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Outer item');
    await page.keyboard.press('Enter');

    await page.keyboard.press('Tab');
    await page.keyboard.type('Nested A');
    await page.keyboard.press('Enter');

    await page.keyboard.press('Tab');
    await page.keyboard.type('Deep A1');
    await page.waitForTimeout(300);

    // Move cursor back to the start of "Outer item"
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    for (let i = 0; i < 'Outer item'.length; i++) {
      await page.keyboard.press('ArrowLeft');
    }
    await page.waitForTimeout(200);

    // Press Backspace at the beginning of "Outer item"
    await page.keyboard.press('Backspace');

    // "Outer item" text merges into "First item".
    // "Nested A" is promoted one level (to "First item" level), "Deep A1" stays under it.
    // No text should be lost or duplicated, and item count must stay 3.
    const listItems = editor.locator('li');
    await expect(listItems).toHaveCount(3);
    await expect(editor).toContainText('First itemOuter item');
    await expect(editor).toContainText('Nested A');
    await expect(editor).toContainText('Deep A1');
    // Drift guard: no stray/duplicated text fragments.
    await expect(editor).not.toContainText('Outer itemOuter');
    await expect(editor).not.toContainText('Nested ANested');
  });

  test('List editing: Backspace on item with mixed nested children (sublist + second paragraph) preserves all content', async ({ page }) => {
    const title = `TEST-ListMergeMixedChildren-${Date.now()}`;
    const pageId = await createTestPage(page, title);
    createdPageIds.push(pageId);

    await ensureSidebarClosed(page);
    const editor = page.locator('.tiptap:visible');
    await editor.focus();

    // Build an "Outer item" whose children are [paragraph, sublist, paragraph]:
    // - First item
    // - Outer item
    //   - Nested A
    //   second para            <- shift+enter keeps it inside the same list item
    await page.keyboard.press('Control+Shift+8');
    await page.keyboard.type('First item');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Outer item');
    await page.keyboard.press('Enter');

    await page.keyboard.press('Tab');
    await page.keyboard.type('Nested A');
    await page.waitForTimeout(200);

    // Move up into "Outer item" and append a hard-break paragraph after the sublist
    // via going to end of "Nested A" then outdent + new line is fragile, so instead
    // place a second paragraph in the outer item using Shift+Enter at its end.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('second para');
    await page.waitForTimeout(300);

    // Move cursor to the very start of "Outer item"
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Home');
    await page.waitForTimeout(200);

    // Press Backspace at the beginning of "Outer item"
    await page.keyboard.press('Backspace');
    // All textual content must survive the merge with correct offsets (no drift).
    await expect(editor).toContainText('First item');
    await expect(editor).toContainText('Outer item');
    await expect(editor).toContainText('Nested A');
    await expect(editor).toContainText('second para');
  });

  test('List editing: Backspace on multi-paragraph list item does not delete the first paragraph', async ({ page }) => {
    // Forward browser console logs to node terminal
    page.on('console', msg => console.log('BROWSER LOG:', msg.text()));

    const title = `TEST-ListMultiParaLoss-${Date.now()}`;
    const pageId = await createTestPage(page, title);
    createdPageIds.push(pageId);

    await ensureSidebarClosed(page);
    const editor = page.locator('.tiptap:visible');
    await editor.focus();

    // Inject an Intro paragraph followed by a list item containing two distinct paragraph blocks
    await page.evaluate(() => {
      window.editor.commands.setContent({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Intro' }]
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Paragraph 1' }]
                  },
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Paragraph 2' }]
                  }
                ]
              }
            ]
          }
        ]
      });
    });

    // Programmatically set cursor to the start of "Paragraph 2" to avoid keyboard navigation flakiness
    await page.evaluate(() => {
      let targetPos = 0;
      window.editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'Paragraph 2') {
          targetPos = pos;
          return false;
        }
      });
      window.editor.commands.setTextSelection(targetPos);
    });

    // Press Backspace at the start of Paragraph 2
    await page.keyboard.press('Backspace');

    // Expected: Paragraph 1 must still exist in the editor.
    // (This fails currently because the code deletes the whole listItem, losing "Paragraph 1" entirely).
    const textContent = await editor.textContent();
    expect(textContent).toContain('Paragraph 1');
  });

  test('List editing: Backspace on first list item inside a table cell does not merge content outside the table', async ({ page }) => {
    const title = `TEST-ListTableCellBoundary-${Date.now()}`;
    const pageId = await createTestPage(page, title);
    createdPageIds.push(pageId);

    await ensureSidebarClosed(page);
    const editor = page.locator('.tiptap:visible');
    await editor.focus();

    // Inject a paragraph outside, followed by a table with a bullet list inside a cell
    await page.evaluate(() => {
      window.editor.commands.setContent({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Outside Paragraph' }]
          },
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  {
                    type: 'tableCell',
                    content: [
                      {
                        type: 'bulletList',
                        content: [
                          {
                            type: 'listItem',
                            content: [
                              {
                                type: 'paragraph',
                                content: [{ type: 'text', text: 'Inside List Item' }]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      });
    });

    // Move cursor into the list item inside the table cell
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    // Move to start of 'Inside List Item'
    for (let i = 0; i < 'Inside List Item'.length; i++) {
      await page.keyboard.press('ArrowLeft');
    }

    // Press Backspace at the start of the list item inside the table cell
    await page.keyboard.press('Backspace');

    // Expected: The text 'Inside List Item' should NOT be merged into 'Outside Paragraph' outside the table.
    // The list item should either remain inside the table cell or be lifted, but not merge outside the table.
    const textContent = await editor.textContent();
    expect(textContent).not.toContain('Outside ParagraphInside List Item');
  });
});


