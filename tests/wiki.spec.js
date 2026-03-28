import { test, expect } from '@playwright/test';

// Credentials for testing
const TEST_USER = 'test.user@insel.ch';
const TEST_PASS = 'InselWikiTest2026!';

/**
 * Helper to perform login
 */
async function login(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  
  const overlay = page.locator('#auth-overlay');
  
  // If overlay is already hidden, we are logged in
  const isHidden = await overlay.isHidden();
  if (isHidden) return;
  
  await page.fill('#login-email', TEST_USER);
  await page.fill('#login-password', TEST_PASS);
  await page.click('#login-btn');
  await expect(overlay).toBeHidden({ timeout: 15000 });
}

test.describe('Insel-Wiki Robust Suite', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Page Lifecycle: Create, Rename, and Delete', async ({ page }) => {
    const uniqueTitle = `Test-Seite ${Date.now()}`;
    
    // 1. Create Page
    await page.click('#new-page-btn');
    await expect(page.locator('#new-page-modal-input')).toBeVisible();
    await page.fill('#new-page-modal-input', uniqueTitle);
    await page.click('#new-page-modal-submit');
    
    // Verify it's loaded
    await expect(page.locator('#page-title')).toHaveValue(uniqueTitle, { timeout: 10000 });
    await expect(page.locator('.tree-item.active')).toContainText(uniqueTitle);

    // 2. Rename
    const updatedTitle = `${uniqueTitle} (Edited)`;
    await page.fill('#page-title', updatedTitle);
    // Wait for debounce save (800ms in main.js)
    await page.waitForTimeout(1500);
    await expect(page.locator('.tree-item.active')).toContainText(updatedTitle);

    // 3. Delete
    page.once('dialog', dialog => dialog.accept());
    await page.click('#delete-page-btn');
    
    // After delete, should show empty state
    await expect(page.locator('#empty-state')).toBeVisible();
  });

  test('Collaboration: Add Inline Comment', async ({ page }) => {
    // Navigate to a page
    await page.waitForSelector('.tree-item');
    await page.locator('.tree-item').first().click();
    await page.waitForTimeout(1000); // Wait for editor load

    // Type text
    const editor = page.locator('.tiptap');
    await editor.focus();
    await page.keyboard.type('Test-Text für Kommentar.');
    
    // Select all
    await page.keyboard.press('Control+A');
    
    // Click Comment button
    await page.click('[data-action="comment"]');
    
    const sidebar = page.locator('.comments-sidebar');
    await expect(sidebar).toBeVisible();
    
    // Type and save
    await page.fill('#new-comment-text', 'Automatisierter Test-Kommentar');
    await page.click('#save-comment-btn');
    
    // Verify
    await expect(page.locator('.comment-item').first()).toContainText('Automatisierter');
  });

  test('Collaboration: User Mentions (@)', async ({ page }) => {
    await page.waitForSelector('.tree-item');
    await page.locator('.tree-item').first().click();
    await page.waitForTimeout(1000);

    const editor = page.locator('.tiptap');
    await editor.focus();
    await page.keyboard.type('Paging @');
    
    // Check suggestions
    const suggestions = page.locator('.mention-suggestions');
    await expect(suggestions).toBeVisible({ timeout: 10000 });
    await page.keyboard.press('Enter');
    
    await expect(editor).toContainText('@');
  });

  test('Search: Full-Text Highlight', async ({ page }) => {
    const searchTerm = `SearchKey-${Date.now()}`;
    
    // 1. Create page with search term
    await page.click('#new-page-btn');
    await page.fill('#new-page-modal-input', `SearchTest-${Date.now()}`);
    await page.click('#new-page-modal-submit');
    
    await page.locator('.tiptap').focus();
    await page.keyboard.type(`Dies ist ein geheimes Wort: ${searchTerm}`);
    await page.waitForTimeout(1000); // Save sync

    // 2. Search
    const searchInput = page.locator('#search-input');
    await searchInput.fill(searchTerm);
    
    // 3. Verify snippet
    await expect(page.locator('.search-snippet')).toContainText(searchTerm);
    await expect(page.locator('.search-snippet mark')).toBeVisible();
  });

  test('Profile: Update Name', async ({ page }) => {
    await page.click('#user-info');
    const newName = `User-${Math.floor(Math.random() * 1000)}`;
    await page.fill('#profile-name', newName);
    await page.click('#profile-save-btn');
    
    await expect(page.locator('#user-info')).toContainText(newName);
  });

});
