import { test, expect } from '@playwright/test';
import { login as sharedLogin } from './helpers/auth.js';
import { ensureSidebarClosed } from './helpers/page-utils.js';

const TEST_USER = 'test.user@insel.ch';
const TEST_PASS = 'InselWikiTest2026!';

async function login(page) {
  await sharedLogin(page, TEST_USER, TEST_PASS);
}

test.describe('Date in Link Verification', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.__E2E_DISABLE_COLLAB__ = true;
    });
    await login(page);
    // Use page-tests but with collab disabled via the init script and editor.js logic
    await page.goto('/#/page-tests');
    
    // The editor might be hidden if it's loading
    const editor = page.locator('.tiptap:visible');
    await expect(editor).toBeVisible({ timeout: 30000 });
    
    await page.waitForFunction(() => window.editor !== undefined, { timeout: 15000 });
    await page.waitForTimeout(1000); // Give it a moment to settle
    
    // Ensure we have a clean slate on this page
    // First wait for any async initial content to load
    await page.waitForTimeout(2000); 
    
    await page.evaluate(() => {
      window.editor.chain().focus().selectAll().deleteSelection().setContent('<p></p>', true).run();
    });
    
    // One more wait to be absolutely sure no more async content is coming
    await page.waitForTimeout(1000);
    
    await page.evaluate(() => {
      if (window.editor.isEmpty) return;
      window.editor.chain().focus().selectAll().deleteSelection().setContent('<p></p>', true).run();
    });
    
    // Wait for the editor to be empty of date pills
    await expect(page.locator('.date-pill')).toHaveCount(0, { timeout: 10000 });
    
    await ensureSidebarClosed(page);
  });

  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      if (window.clearEditorCache) window.clearEditorCache();
    });
  });

  test('should NOT convert date to chip when typing a date inside a link', async ({ page }) => {
    const editor = page.locator('.tiptap:visible');
    await editor.focus();
    
    // Create a link with text
    await page.evaluate(() => {
      window.editor.chain().focus().setLink({ href: 'https://example.com' }).insertContent('CLICKME').run();
    });

    // Move cursor into the middle of the link
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');

    // Type a date
    await page.keyboard.type('2024-05-08');
    // Typing a space usually triggers the input rule
    await page.keyboard.press('Space');

    // Verify it is still a link and it contains the date
    const link = editor.locator('a.editable-link');
    await expect(link.first()).toBeVisible();
    
    const linkText = await link.first().evaluate(el => {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('.collaboration-cursor__caret').forEach(c => c.remove());
      return clone.textContent;
    });
    expect(linkText).toContain('2024-05-08');

    // Verify NO date chip was created
    await expect(editor.locator('.date-pill')).toHaveCount(0);
  });

  test('should NOT convert date to chip when pasting text with date into a link', async ({ page }) => {
    const editor = page.locator('.tiptap:visible');
    await editor.focus();
    
    // Create a link
    await page.evaluate(() => {
      window.editor.chain().focus().setLink({ href: 'https://example.com' }).insertContent('LINK').run();
    });

    // Place cursor inside LINK (LINK is at pos 1-5, so 3 is in the middle)
    await page.evaluate(() => {
      window.editor.commands.focus();
      window.editor.commands.setTextSelection(3);
    });
    
    // Paste a date
    await page.evaluate((text) => {
      window.editor.view.focus();
      window.editor.view.pasteText(text);
    }, ' 2024-05-09 ');

    await page.waitForTimeout(1000); // Wait for paste to process

    // Verify it is still a link and NO date chip
    const link = editor.locator('a.editable-link');
    await expect(link.first()).toBeVisible();
    
    const linkText = await link.first().evaluate(el => {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('.collaboration-cursor__caret').forEach(c => c.remove());
      return clone.textContent;
    });
    expect(linkText).toContain('2024-05-09');

    await expect(editor.locator('.date-pill')).toHaveCount(0);
  });

  test('should NOT convert date to chip when setting content with date inside A tag', async ({ page }) => {
    await page.evaluate(() => {
      const html = '<a href="https://example.com">Date 2024-05-10</a>';
      window.editor.commands.setContent(html, true);
    });

    const editor = page.locator('.tiptap:visible');
    const link = editor.locator('a.editable-link');
    await expect(link.first()).toBeVisible();
    
    const linkText = await link.first().evaluate(el => {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('.collaboration-cursor__caret').forEach(c => c.remove());
      return clone.textContent;
    });
    expect(linkText).toContain('2024-05-10');

    await expect(editor.locator('.date-pill')).toHaveCount(0);
  });
});
