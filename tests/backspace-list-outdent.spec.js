import { test, expect } from './helpers/test-fixture.js';
import { createTestPage, deletePageViaUI, ensureSidebarClosed } from './helpers/page-utils.js';
import { login as sharedLogin } from './helpers/auth.js';

const TEST_USER = 'test.user@insel.ch';
const TEST_PASS = 'InselWikiTest2026!';

async function login(page) {
  await sharedLogin(page, TEST_USER, TEST_PASS);
}

test.describe('Backspace Custom List-Outdent Path', () => {
  let createdPageId = null;

  test.afterEach(async ({ page }) => {
    if (createdPageId) {
      await deletePageViaUI(page, createdPageId);
    }
  });

  test('should outdent nested list and merge text to preceding paragraph when Backspace is pressed at first item start', async ({ page }) => {
    await login(page);

    const testTitle = `OutdentTest-${Date.now()}`;
    createdPageId = await createTestPage(page, testTitle);

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

    // Place selection cursor at the beginning of the text "First item"
    const selectionSet = await page.evaluate(() => {
      const { editor } = window;
      let targetPos = null;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'First item') {
          targetPos = pos;
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
          textBefore: editor.state.selection.$from.parent.textContent
        };
      }
      return null;
    });

    expect(selectionSet).not.toBeNull();
    expect(selectionSet.empty).toBe(true);
    expect(selectionSet.parentOffset).toBe(0);
    expect(selectionSet.textBefore).toBe('First item');

    // Trigger Backspace key press
    await page.keyboard.press('Backspace');

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
    
    // Using regex to allow minor whitespace variations in HTML output
    expect(resultHTML).toMatch(/<p>Preceding paragraphFirst item<\/p>/);
    expect(resultHTML).toMatch(/<ul><li><p>Nested item 1<\/p><\/li><li><p>Nested item 2<\/p><\/li><li><p>Second item<\/p><\/li><\/ul>/);
  });
});
