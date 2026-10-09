import { test, expect } from '@playwright/test';
import { login } from './helpers/auth.js';
import { createTestPage, deletePageViaUI, ensureSidebarClosed, waitForEditorSynced, waitForSaved } from './helpers/page-utils.js';

const TEST_USER = 'test.user@insel.ch';
const TEST_PASS = 'InselWikiTest2026!';

test.describe('Follow-up meeting', () => {
  test.describe.configure({ mode: 'serial' });

  const createdIds = [];

  test.afterEach(async ({ page }) => {
    for (const id of createdIds.splice(0)) {
      try {
        await deletePageViaUI(page, id);
      } catch (e) {
        // global-setup sweeps E2E- pages on the next run.
        console.warn(`cleanup of ${id} failed: ${e.message}`);
      }
    }
  });

  test('creates the next page of a series with open tasks, structure and links both ways', async ({ page }) => {
    test.setTimeout(120000);
    const stamp = Date.now();
    const firstTitle = `E2E-Series-${stamp}-7`;
    const nextTitle = `E2E-Series-${stamp}-8`;

    await login(page, TEST_USER, TEST_PASS);
    const firstId = await createTestPage(page, firstTitle);
    createdIds.push(firstId);

    await waitForEditorSynced(page);
    await page.waitForFunction(() => window.editor && window.editor.isEditable, null, { timeout: 15000 });
    await page.evaluate(() => {
      window.editor.commands.setContent(
        '<h2>Traktanden</h2><p>Budget besprochen</p>' +
        '<h2>Pendenzen</h2>' +
        '<ul data-type="taskList">' +
        '<li data-type="taskItem" data-checked="false"><p>Offerte einholen</p></li>' +
        '<li data-type="taskItem" data-checked="true"><p>Raum reservieren</p></li>' +
        '</ul>',
        true
      );
    });
    await waitForSaved(page);
    await ensureSidebarClosed(page);

    await page.locator('#toolbar-followup-btn').click();
    await expect(page.locator('#followup-title')).toHaveValue(nextTitle);
    await expect(page.locator('#followup-opt-tasks')).toBeChecked();
    await page.locator('#followup-modal-submit').click();

    // Lands on the new page, which is seeded from the first one.
    await expect(page.locator('#page-title')).toHaveValue(nextTitle, { timeout: 20000 });
    const nextId = page.url().match(/#\/([^/]+)/)[1];
    expect(nextId).not.toBe(firstId);
    createdIds.push(nextId);

    const editor = page.locator('.tiptap:visible');
    await expect(editor).toContainText('Offerte einholen', { timeout: 20000 });
    await expect(editor).toContainText(`(aus ${firstTitle})`);
    await expect(editor).not.toContainText('Raum reservieren');
    await expect(editor).not.toContainText('Budget besprochen');
    await expect(editor.locator('h2', { hasText: 'Traktanden' })).toBeVisible();
    await expect(editor.locator('li[data-checked="false"]', { hasText: 'Offerte einholen' })).toBeVisible();
    await expect(editor.locator(`a[href^="#/${firstId}"]`)).toHaveText(firstTitle);

    // The first page keeps its content and gains a link to the new one.
    await waitForSaved(page);
    await page.goto(`/#/${firstId}`);
    await expect(page.locator('#page-title')).toHaveValue(firstTitle, { timeout: 20000 });
    const firstEditor = page.locator('.tiptap:visible');
    await expect(firstEditor.locator(`a[href^="#/${nextId}"]`)).toHaveText(nextTitle, { timeout: 20000 });
    await expect(firstEditor).toContainText('Budget besprochen');
    await expect(firstEditor.locator('li[data-checked="true"]', { hasText: 'Raum reservieren' })).toBeVisible();
  });

  test('slash palette lists commands, inserts one, and Escape hands Enter back to the editor', async ({ page }) => {
    test.setTimeout(90000);
    await login(page, TEST_USER, TEST_PASS);
    const id = await createTestPage(page, `E2E-Slash-${Date.now()}`);
    createdIds.push(id);

    await waitForEditorSynced(page);
    await page.waitForFunction(() => window.editor && window.editor.isEditable, null, { timeout: 15000 });
    await ensureSidebarClosed(page);

    const editor = page.locator('.tiptap:visible');
    await editor.click();
    await page.keyboard.type('/trenn');
    const palette = page.locator('.slash-suggestions');
    await expect(palette).toBeVisible();
    await expect(palette.locator('.slash-item')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(editor.locator('hr')).toHaveCount(1);
    await expect(editor).not.toContainText('/trenn');

    await page.keyboard.type('/');
    await expect(palette).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await page.keyboard.press('Enter');
    // Enter made a new line instead of running the highlighted command.
    await expect(page.locator('.modal-overlay:visible')).toHaveCount(0);
    await expect(editor.locator('hr')).toHaveCount(1);
    await expect(editor).toContainText('/');
    await waitForSaved(page);
  });
});
