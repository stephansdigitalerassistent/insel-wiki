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
  
  // Wait for auth to initialize or show login form
  const overlay = page.locator('#auth-overlay');
  
  try {
    // Check if we need to login (wait a bit to see if overlay stays)
    await expect(overlay).not.toHaveClass(/hidden/, { timeout: 2000 });
    
    // If it didn't throw, we need to login
    await page.fill('#login-email', TEST_USER);
    await page.fill('#login-password', TEST_PASS);
    await page.click('#login-btn');
    await expect(overlay).toHaveClass(/hidden/, { timeout: 15000 });
  } catch (e) {
    // Already logged in (overlay is hidden)
  }

  // Force remove to be 100% sure it's not intercepting on mobile
  await page.evaluate(() => document.getElementById('auth-overlay')?.remove());
  
  // Wait for the user profile to be rendered, confirming full auth state
  await expect(page.locator('#user-info span')).toBeVisible({ timeout: 15000 });
  
  // Extra wait to ensure transitions are finished
  await page.waitForTimeout(500);
}

/**
 * Helper to ensure sidebar is visible (for mobile)
 */
async function ensureSidebarOpen(page) {
  const toggle = page.locator('#sidebar-toggle');
  if (await toggle.isVisible()) {
    const sidebar = page.locator('#sidebar');
    // We retry clicking a few times since mobile layouts can shift or animations block
    await expect(async () => {
      if (await sidebar.evaluate(el => !el.classList.contains('open'))) {
        await toggle.click({ force: true });
        await expect(sidebar).toHaveClass(/open/, { timeout: 1000 });
      }
    }).toPass({ timeout: 5000 });
    // Wait for slide-in animation
    await page.waitForTimeout(500);
  }
}

test.describe('Insel-Wiki Navigation & UI Fixes Suite', () => {
  let createdPageId = null;

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test.afterEach(async ({ page }) => {
    if (createdPageId) {
      // Cleanup is handled by the test
      createdPageId = null;
    }
  });

  test('Page Creation: No unsaved changes warning', async ({ page }) => {
    const title = `FixTest-${Date.now()}`;
    
    await page.goto('/#/page-tests');
    await ensureSidebarOpen(page);
    
    // 1. Open New Page Modal
    // Use evaluate to avoid viewport issues on mobile if button is tricky
    await page.evaluate(() => document.getElementById('new-page-btn')?.click());
    
    // Use more specific locator to avoid strict mode violation
    const newPageModal = page.locator('.modal-box', { hasText: 'Neue Seite erstellen' });
    await expect(newPageModal).toBeVisible();
    
    // 2. Fill title and ensure 'Link einfügen' is checked
    await page.fill('#new-page-modal-input', title);
    await page.check('#modal-opt-link');
    
    // 3. Submit and check for navigation WITHOUT 'Seite verlassen?' confirmModal
    const leaveConfirmModal = page.locator('.modal-box', { hasText: 'Seite verlassen?' });
    
    await page.click('#new-page-modal-submit');
    
    // If our fix works, we should arrive at the new page title without seeing the leaveConfirmModal
    await expect(page.locator('#page-title')).toHaveValue(title, { timeout: 15000 });
    await expect(leaveConfirmModal).not.toBeVisible();
    
    // Get ID for cleanup
    const url = page.url();
    createdPageId = url.split('#/')[1]?.split('/')[0];
    
    // 4. Cleanup: Delete the page using the new confirmModal
    await page.click('#delete-page-btn');
    const deleteConfirm = page.locator('.modal-box', { hasText: 'Seite löschen?' });
    await expect(deleteConfirm).toBeVisible();
    await deleteConfirm.locator('button', { hasText: 'Löschen' }).click();
    await expect(page.locator('#empty-state')).toBeVisible();
  });

  test('Sidebar: Context Menu Sorting Arrows', async ({ page }) => {
    await page.goto('/#/page-tests');
    await ensureSidebarOpen(page);
    
    // 1. Right click on 'Entwicklung' or a known page to open context menu
    // Using more-btn instead of btn-options as identified in the code
    const pageItem = page.locator('.tree-item').filter({ hasText: /^Entwicklung/ });
    await pageItem.first().hover();
    const optionsBtn = pageItem.first().locator('.more-btn');
    await optionsBtn.click();
    
    const menu = page.locator('.sidebar-options-menu');
    await expect(menu).toBeVisible();
    
    // 2. Ensure Sort Mode is 'Manuell'
    const manualBtn = menu.locator('.sidebar-options-item', { hasText: 'Manuell' });
    await manualBtn.click(); // Sets or ensures state
    
    // Open again to check arrows
    await pageItem.first().hover();
    await optionsBtn.click();
    
    // 3. Check for Up/Down arrows
    await expect(menu.locator('.sidebar-options-item', { hasText: '↑ Nach oben' })).toBeVisible();
    await expect(menu.locator('.sidebar-options-item', { hasText: '↓ Nach unten' })).toBeVisible();
    
    // 4. Switch to 'Name' sort and ensure arrows are gone
    await menu.locator('.sidebar-options-item', { hasText: 'Name ↑' }).click();
    
    await pageItem.first().hover();
    await optionsBtn.click();
    await expect(menu.locator('.sidebar-options-item', { hasText: '↑ Nach oben' })).not.toBeVisible();
    
    // 5. Verify the sorting indicator arrow (↑) is visible in the sidebar tree item
    await expect(pageItem.first().locator('.sort-indicator')).toHaveText('↑');
  });
});
