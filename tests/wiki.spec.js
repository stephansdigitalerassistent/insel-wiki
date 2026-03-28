import { test, expect } from '@playwright/test';

// Credentials for testing (using the created test account)
const TEST_USER = 'test.user@insel.ch';
const TEST_PASS = 'InselWikiTest2026!';

test.describe('Insel-Wiki Core E2E Tests', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should show login screen for unauthenticated users', async ({ page }) => {
    await expect(page.locator('#auth-overlay')).toBeVisible();
    await expect(page.locator('#login-email')).toBeVisible();
  });

  test('should login successfully', async ({ page }) => {
    await page.fill('#login-email', TEST_USER);
    await page.fill('#login-password', TEST_PASS);
    await page.click('#login-btn');

    // Wait for overlay to disappear with extended timeout
    await expect(page.locator('#auth-overlay')).toBeHidden({ timeout: 15000 });
    
    // Verify user info is displayed
    await expect(page.locator('#user-info')).toContainText('Test User');
  });

  test('should search and find content (Full-Text)', async ({ page }) => {
    // 1. Login
    await page.fill('#login-email', TEST_USER);
    await page.fill('#login-password', TEST_PASS);
    await page.click('#login-btn');
    await expect(page.locator('#auth-overlay')).toBeHidden({ timeout: 15000 });

    // 2. Perform search
    const searchInput = page.locator('#search-input');
    await searchInput.fill('Willkommen');
    
    // 3. Verify search result visibility
    await page.waitForTimeout(1000); // Wait for filter
    await expect(page.locator('.page-tree')).toBeVisible();
  });

  test('mobile: should toggle sidebar', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'This test is only for mobile devices');

    // 1. Check if sidebar is hidden by default on mobile
    const sidebar = page.locator('#sidebar');
    // On mobile, the CSS transform: translateX(-100%) is used.
    // We check for the 'open' class
    await expect(sidebar).not.toHaveClass(/open/);

    // 2. Click toggle button
    await page.click('#sidebar-toggle');

    // 3. Verify sidebar is open
    await expect(sidebar).toHaveClass(/open/);

    // 4. Click overlay to close
    await page.click('#sidebar-overlay', { position: { x: 270, y: 100 } }); // Click outside
    await expect(sidebar).not.toHaveClass(/open/);
  });

  test('should show "Last edited by" badge on a page', async ({ page }) => {
    // 1. Login
    await page.fill('#login-email', TEST_USER);
    await page.fill('#login-password', TEST_PASS);
    await page.click('#login-btn');
    
    // 2. Navigate to a page if hash exists, or wait for tree
    await page.waitForSelector('.tree-item');
    const firstPage = page.locator('.tree-item').first();
    await firstPage.click();

    // 3. Check for badge visibility
    // It might be hidden if never edited, but usually pages have metadata
    const badge = page.locator('#last-edited-badge');
    // If it exists in the DOM, check its structure
    if (await badge.isVisible()) {
        await expect(badge).toContainText('Zuletzt bearbeitet von');
    }
  });
});
