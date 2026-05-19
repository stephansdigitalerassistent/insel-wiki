import { test, expect } from '@playwright/test';
import { createTestPage, deletePageViaUI, ensureSidebarOpen, ensureSidebarClosed } from './helpers/page-utils.js';

const TEST_USER = 'test.user@insel.ch';
const TEST_PASS = 'InselWikiTest2026!';

async function login(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const overlay = page.locator('#auth-overlay');
  if (await overlay.isHidden() && await page.locator('#user-info span').isVisible()) {
    return;
  }

  // Handle Login
  if (await overlay.isVisible()) {
    await page.fill('#login-email', TEST_USER);
    await page.fill('#login-password', TEST_PASS);
    await page.click('#login-btn');
    await expect(overlay).toBeHidden({ timeout: 15000 });
  }

  await expect(page.locator('#user-info span')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(500);
}

test.describe('Link Overlap Repro', () => {
  let createdPageId = null;

  test.afterEach(async ({ page }) => {
    if (createdPageId) {
        await deletePageViaUI(page, createdPageId);
    }
  });

  test('Link dialog autocomplete should not overlap URL input', async ({ page }) => {
    await login(page);
    
    const testTitle = `SearchTarget-${Date.now()}`;
    
    // Create a page to ensure we have a search result under page-tests
    createdPageId = await createTestPage(page, testTitle);
    
    const editor = page.locator('.tiptap:visible');
    await expect(editor).toBeVisible({ timeout: 15000 });
    await ensureSidebarClosed(page);
    await editor.focus();
    
    // Trigger link modal
    await page.keyboard.press('Control+k');
    
    const linkModal = page.locator('.link-modal-box');
    await expect(linkModal).toBeVisible();
    
    // URL input is the second modal-input
    const urlInput = linkModal.locator('input.modal-input').nth(1); 
    await urlInput.fill(testTitle);
    
    const dropdown = linkModal.locator('.link-search-dropdown');
    // Wait for it to be visible AND have results
    await expect(dropdown).toBeVisible({ timeout: 10000 });
    await expect(dropdown.locator('.dropdown-item')).toHaveCount(1, { timeout: 10000 });
    
    // Wait for stable, non-null bounding boxes using toPass
    let inputBounds, dropdownBounds;
    await expect(async () => {
      inputBounds = await urlInput.boundingBox();
      dropdownBounds = await dropdown.boundingBox();
      
      expect(inputBounds).not.toBeNull();
      expect(dropdownBounds).not.toBeNull();
      expect(dropdownBounds.height).toBeGreaterThan(0);
      expect(dropdownBounds.width).toBeGreaterThan(0);
      
      // Dropdown should be below input. 
      // Animation might be in progress, so we check for overlap in a retry loop
      expect(dropdownBounds.y).toBeGreaterThanOrEqual(inputBounds.y + inputBounds.height - 2);
    }).toPass({ timeout: 10000 });
    
    console.log('Final Input bounds:', inputBounds);
    console.log('Final Dropdown bounds:', dropdownBounds);
  });
});
