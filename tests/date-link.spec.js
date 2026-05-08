import { test, expect } from '@playwright/test';

// Credentials for testing
const TEST_USER = 'test.user@insel.ch';
const TEST_PASS = 'InselWikiTest2026!';

async function login(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  const overlay = page.locator('#auth-overlay');
  try {
    await expect(overlay).not.toHaveClass(/hidden/, { timeout: 2000 });
    await page.fill('#login-email', TEST_USER);
    await page.fill('#login-password', TEST_PASS);
    await page.click('#login-btn');
    await expect(overlay).toHaveClass(/hidden/, { timeout: 15000 });
  } catch (e) {
    // Already logged in
  }
  await page.evaluate(() => document.getElementById('auth-overlay')?.remove());
  await expect(page.locator('#user-info span')).toBeVisible({ timeout: 15000 });
}

async function ensureSidebarClosed(page) {
  const toggle = page.locator('#sidebar-toggle');
  if (await toggle.isVisible()) {
    const sidebar = page.locator('#sidebar');
    if (await sidebar.evaluate(el => el.classList.contains('open'))) {
      const overlay = page.locator('#sidebar-overlay');
      if (await overlay.isVisible()) {
        await overlay.click({ force: true });
      } else {
        await toggle.click({ force: true });
      }
      await expect(sidebar).not.toHaveClass(/open/, { timeout: 2000 });
    }
  }
}

test.describe('Date in Link Verification', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    // Use a known existing page but with a random hash to force a "fresh" view if needed
    // Actually, navigating to page-tests is safest for ensuring the editor UI exists
    await page.goto('/#/page-tests');
    
    // The editor might be hidden if it's loading
    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 30000 });
    
    await page.waitForFunction(() => window.editor !== undefined, { timeout: 15000 });
    
    // Ensure we have a clean slate on this page
    await page.evaluate(() => {
      window.editor.chain().focus().selectAll().deleteSelection().setContent('<p></p>', true).run();
    });
    
    // Wait for the editor to be empty of date pills
    await expect(page.locator('.date-pill')).toHaveCount(0, { timeout: 10000 });
    
    await ensureSidebarClosed(page);
  });

  test('should NOT convert date to chip when typing a date inside a link', async ({ page }) => {
    const editor = page.locator('.tiptap');
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
    const editor = page.locator('.tiptap');
    await editor.focus();
    
    // Create a link
    await page.evaluate(() => {
      window.editor.chain().focus().setLink({ href: 'https://example.com' }).insertContent('LINK').run();
    });

    // Place cursor inside LINK
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    
    // Paste a date
    await page.evaluate((text) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', text);
      const event = new ClipboardEvent('paste', {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true
      });
      document.querySelector('.tiptap').dispatchEvent(event);
    }, ' 2024-05-09 ');

    await page.waitForTimeout(500);

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
      const markdown = '[Date 2024-05-10](https://example.com)';
      window.editor.commands.setContent(markdown, true);
    });

    const editor = page.locator('.tiptap');
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
