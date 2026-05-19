import { test, expect } from '@playwright/test';
import { createTestPage, deletePageViaUI, ensureSidebarOpen, ensureSidebarClosed } from './helpers/page-utils.js';

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
  
  // Skip if already logged in
  if (await overlay.isHidden() || await overlay.evaluate(el => el.classList.contains('hidden'))) {
    if (await page.locator('#user-info span').isVisible()) {
      console.log('Already logged in, skipping.');
      return;
    }
  }

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

test.describe('Insel-Wiki Navigation & UI Fixes Suite', () => {
  let createdPageId = null;

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test.afterEach(async ({ page }) => {
    if (createdPageId) {
      try {
          await deletePageViaUI(page, createdPageId);
      } catch (e) {
          // Might already be deleted
      }
      createdPageId = null;
    }
  });

  test('Page Creation: No unsaved changes warning', async ({ page }) => {
    const title = `FixTest-${Date.now()}`;
    
    // Navigate to parent page
    await page.goto('/#/page-tests');
    await ensureSidebarOpen(page);
    
    // 1. Open New Page Modal
    await page.evaluate(() => document.getElementById('new-page-btn')?.click());
    
    const newPageModal = page.locator('.modal-box', { hasText: 'Neue Seite erstellen' });
    await expect(newPageModal).toBeVisible();
    
    // 2. Fill title and ensure 'Als Unterseite' is checked (to follow the new policy)
    await page.fill('#new-page-modal-input', title);
    await page.check('#modal-opt-child');
    await page.check('#modal-opt-link');
    
    // 3. Submit and check for navigation WITHOUT 'Seite verlassen?' confirmModal
    const leaveConfirmModal = page.locator('.modal-box', { hasText: 'Seite verlassen?' });
    
    await page.click('#new-page-modal-submit');
    
    await expect(page.locator('#page-title')).toHaveValue(title, { timeout: 15000 });
    await expect(leaveConfirmModal).not.toBeVisible();
    
    const url = page.url();
    createdPageId = url.split('#/')[1]?.split('/')[0];
    
    // 4. Cleanup via UI as part of the test (or it'll be done in afterEach)
    await deletePageViaUI(page, createdPageId);
    createdPageId = null;
    await expect(page.locator('#empty-state')).toBeVisible();
  });

  test('Sidebar: Context Menu Sorting Arrows and Toggle', async ({ page }) => {
    await page.goto('/#/page-tests');
    await ensureSidebarOpen(page);
    
    const pageItem = page.locator('.tree-item').filter({ hasText: /^Entwicklung/ });
    await pageItem.first().hover();
    const optionsBtn = pageItem.first().locator('.more-btn');
    await optionsBtn.click();
    
    const menu = page.locator('.sidebar-options-menu');
    await expect(menu).toBeVisible();
    // 1. Ensure Sort Mode is 'Manuell'
    const manualBtn = menu.locator('.sidebar-options-item', { hasText: 'Manuell' });
    await manualBtn.click({ force: true });

    await pageItem.first().hover();
    await optionsBtn.click({ force: true });

    // 3. Check for Up/Down arrows
    await expect(menu.locator('.sidebar-options-item', { hasText: '↑ Nach oben' })).toBeVisible();
    await expect(menu.locator('.sidebar-options-item', { hasText: '↓ Nach unten' })).toBeVisible();

    // 4. Switch to 'Name' sort (default asc)
    const nameBtn = menu.locator('.sidebar-options-item', { hasText: 'Name ↑' });
    await nameBtn.click({ force: true });

    await pageItem.first().hover();
    await optionsBtn.click({ force: true });
    await expect(pageItem.first().locator('.sort-indicator')).toHaveText('↑');

    // 3. Click 'Name ↑' again to toggle to 'Name ↓'
    await menu.locator('.sidebar-options-item', { hasText: 'Name ↑' }).click({ force: true });

    await pageItem.first().hover();
    await optionsBtn.click({ force: true });
    await expect(menu.locator('.sidebar-options-item', { hasText: 'Name ↓' })).toBeVisible();
    await expect(pageItem.first().locator('.sort-indicator')).toHaveText('↓');

    // 4. Click 'Name ↓' again to toggle back to 'Name ↑'
    await menu.locator('.sidebar-options-item', { hasText: 'Name ↓' }).click({ force: true });

    
    await pageItem.first().hover();
    await optionsBtn.click();
    await expect(menu.locator('.sidebar-options-item', { hasText: 'Name ↑' })).toBeVisible();
    await expect(pageItem.first().locator('.sort-indicator')).toHaveText('↑');
  });
});
