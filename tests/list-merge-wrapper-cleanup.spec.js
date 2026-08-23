import { test, expect } from './helpers/test-fixture.js';
import { createTestPage, ensureSidebarClosed } from './helpers/page-utils.js';
import { login as sharedLogin } from './helpers/auth.js';

const TEST_USER = 'test.user@insel.ch';
const TEST_PASS = 'InselWikiTest2026!';

/**
 * Browser regression coverage for the wrapper-cleanup fix: a merge must not
 * leave behind the list or blockquote it emptied. All cases run in a single
 * page to keep production writes to a minimum.
 */
test.describe('List merge leaves no empty wrapper', () => {
  let pageId = null;

  test('Delete and Backspace remove wrappers emptied by a merge', async ({ page }) => {
    test.setTimeout(120000);
    await sharedLogin(page, TEST_USER, TEST_PASS);

    const title = `WrapperCleanup-${Date.now()}`;
    pageId = await createTestPage(page, title);
    console.log(`[spec] created page ${pageId} ("${title}")`);

    const editorLocator = page.locator('.tiptap:visible');
    await expect(editorLocator).toBeVisible({ timeout: 15000 });
    await ensureSidebarClosed(page);
    await editorLocator.focus();

    async function runCase({ name, html, findText, atStart, key }) {
      await page.evaluate((h) => window.editor.commands.setContent(h), html);
      const placed = await page.evaluate(({ t, start }) => {
        const { editor } = window;
        let pos = null;
        editor.state.doc.descendants((node, p) => {
          if (pos === null && node.isText && node.text === t) { pos = start ? p : p + t.length; return false; }
        });
        if (pos === null) return null;
        const $p = editor.state.doc.resolve(pos);
        editor.view.dispatch(editor.state.tr.setSelection(new editor.state.selection.constructor($p, $p)));
        return { empty: editor.state.selection.empty, offset: editor.state.selection.$from.parentOffset };
      }, { t: findText, start: !!atStart });
      expect(placed, `${name}: cursor placed`).not.toBeNull();
      expect(placed.empty).toBe(true);

      await page.keyboard.press(key);
      const out = await page.evaluate(() => window.editor.getHTML());
      console.log(`[spec] ${name} => ${out}`);
      return out;
    }

    // A) single-item bullet list must not leave a stray empty bullet
    let out = await runCase({ name: 'A single-item list', key: 'Delete', findText: 'Para',
      html: '<p>Para</p><ul><li><p>Only</p></li></ul>' });
    expect(out).toMatch(/<p>ParaOnly<\/p>/);
    expect(out, 'A: no leftover list').not.toMatch(/<ul>/);

    // C) checked task item must not leave an unchecked ghost
    out = await runCase({ name: 'C checked task item', key: 'Delete', findText: 'Para',
      html: '<p>Para</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Done</p></li></ul>' });
    expect(out).toMatch(/<p>ParaDone<\/p>/);
    expect(out, 'C: no leftover taskList').not.toMatch(/data-type="taskList"/);
    expect(out, 'C: no unchecked ghost').not.toMatch(/data-checked="false"/);

    // D) single-paragraph blockquote must not leave an empty quote bar
    out = await runCase({ name: 'D single-para blockquote', key: 'Delete', findText: 'Para',
      html: '<p>Para</p><blockquote><p>q1</p></blockquote>' });
    expect(out).toMatch(/<p>Paraq1<\/p>/);
    expect(out, 'D: no leftover blockquote').not.toMatch(/<blockquote>/);

    // D2) a two-paragraph blockquote must KEEP its remaining paragraph
    out = await runCase({ name: 'D2 two-para blockquote (control)', key: 'Delete', findText: 'Para',
      html: '<p>Para</p><blockquote><p>q1</p><p>q2</p></blockquote>' });
    expect(out).toMatch(/<p>Paraq1<\/p>/);
    expect(out, 'D2: blockquote retained').toMatch(/<blockquote><p>q2<\/p><\/blockquote>/);

    // E) Backspace at the start of the only list item
    out = await runCase({ name: 'E backspace single item', key: 'Backspace', findText: 'Only', atStart: true,
      html: '<p>Para</p><ul><li><p>Only</p></li></ul>' });
    expect(out).toMatch(/<p>ParaOnly<\/p>/);
    expect(out, 'E: no leftover list').not.toMatch(/<ul>/);

    // G) a two-item list must still keep its second item (control)
    out = await runCase({ name: 'G two-item list (control)', key: 'Delete', findText: 'Para',
      html: '<p>Para</p><ul><li><p>One</p></li><li><p>Two</p></li></ul>' });
    expect(out).toMatch(/<p>ParaOne<\/p>/);
    expect(out, 'G: second item retained').toMatch(/<ul><li><p>Two<\/p><\/li><\/ul>/);
  });

  test.afterAll(async () => {
    console.log(`[spec] PAGE_ID_FOR_CLEANUP=${pageId}`);
  });
});
