import { test, expect } from './helpers/test-fixture.js';
import { createTestPage, deletePageViaUI, ensureSidebarClosed, waitForSaved } from './helpers/page-utils.js';
import { login as sharedLogin } from './helpers/auth.js';

const TEST_USER = 'test.user@insel.ch';
const TEST_PASS = 'InselWikiTest2026!';

async function login(page) {
  await sharedLogin(page, TEST_USER, TEST_PASS);
}

test.describe('Delete Key List Merge & Outdent Suite', () => {
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

  test('should outdent nested list and merge following item text when Delete is pressed at end of preceding paragraph', async ({ page }) => {
    const testTitle = `DeleteOutdentTest-${Date.now()}`;
    const pageId = await createTestPage(page, testTitle);
    createdPageIds.push(pageId);

    const editorLocator = page.locator('.tiptap:visible');
    await expect(editorLocator).toBeVisible({ timeout: 15000 });
    await ensureSidebarClosed(page);
    await editorLocator.focus();

    // Set editor content with a preceding paragraph and a list with nested sublists
    await page.evaluate(() => {
      const { editor } = window;
      editor.commands.setContent(`
        <p>Preceding paragraph</p>
        <ul>
          <li>
            <p>First item</p>
            <ul>
              <li><p>Nested item 1</p></li>
              <li><p>Nested item 2</p></li>
            </ul>
          </li>
          <li><p>Second item</p></li>
        </ul>
      `);
    });

    // Place selection cursor at the very END of "Preceding paragraph"
    const selectionSet = await page.evaluate(() => {
      const { editor } = window;
      let targetPos = null;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'Preceding paragraph') {
          targetPos = pos + 'Preceding paragraph'.length;
          return false;
        }
      });

      if (targetPos !== null) {
        const $pos = editor.state.doc.resolve(targetPos);
        const selection = new editor.state.selection.constructor($pos, $pos);
        editor.view.dispatch(editor.state.tr.setSelection(selection));
        return {
          empty: editor.state.selection.empty,
          parentOffset: editor.state.selection.$from.parentOffset,
          text: editor.state.selection.$from.parent.textContent
        };
      }
      return null;
    });

    expect(selectionSet).not.toBeNull();
    expect(selectionSet.empty).toBe(true);
    expect(selectionSet.parentOffset).toBe('Preceding paragraph'.length);

    // Trigger Delete (Forward Delete / Del) key press
    await page.keyboard.press('Delete');

    // Read updated editor content
    const resultHTML = await page.evaluate(() => {
      const { editor } = window;
      return editor.getHTML();
    });

    // Verify content has been merged and the nested sublist has been outdented/spliced in
    // Expected structure:
    // <p>Preceding paragraphFirst item</p>
    // <ul>
    //   <li><p>Nested item 1</p></li>
    //   <li><p>Nested item 2</p></li>
    //   <li><p>Second item</p></li>
    // </ul>
    expect(resultHTML).toMatch(/<p>Preceding paragraphFirst item<\/p>/);
    expect(resultHTML).toMatch(/<ul><li><p>Nested item 1<\/p><\/li><li><p>Nested item 2<\/p><\/li><li><p>Second item<\/p><\/li><\/ul>/);
  });

  test('should merge following list item text when Delete is pressed at end of list item', async ({ page }) => {
    const testTitle = `DeleteListItemMerge-${Date.now()}`;
    const pageId = await createTestPage(page, testTitle);
    createdPageIds.push(pageId);

    const editorLocator = page.locator('.tiptap:visible');
    await expect(editorLocator).toBeVisible({ timeout: 15000 });
    await ensureSidebarClosed(page);
    await editorLocator.focus();

    await page.evaluate(() => {
      const { editor } = window;
      editor.commands.setContent(`
        <ul>
          <li><p>First item</p></li>
          <li><p>Second item</p></li>
        </ul>
      `);
    });

    // Place selection cursor at the end of "First item"
    await page.evaluate(() => {
      const { editor } = window;
      let targetPos = null;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'First item') {
          targetPos = pos + 'First item'.length;
          return false;
        }
      });
      if (targetPos !== null) {
        const $pos = editor.state.doc.resolve(targetPos);
        const selection = new editor.state.selection.constructor($pos, $pos);
        editor.view.dispatch(editor.state.tr.setSelection(selection));
      }
    });

    // Trigger Delete key press
    await page.keyboard.press('Delete');

    const resultHTML = await page.evaluate(() => {
      const { editor } = window;
      return editor.getHTML();
    });

    expect(resultHTML).toMatch(/<ul><li><p>First itemSecond item<\/p><\/li><\/ul>/);
  });
});
