import { expect } from '@playwright/test';

/**
 * Ensures the sidebar is open (for mobile layouts)
 */
export async function ensureSidebarOpen(page) {
  const toggle = page.locator('#sidebar-toggle');
  if (await toggle.isVisible()) {
    const sidebar = page.locator('#sidebar');
    await expect(async () => {
      if (await sidebar.evaluate(el => !el.classList.contains('open'))) {
        await toggle.click({ force: true });
        await expect(sidebar).toHaveClass(/open/, { timeout: 1000 });
      }
    }).toPass({ timeout: 5000 });
    await page.waitForTimeout(500);
  }
}

/**
 * Ensures the sidebar is closed
 */
export async function ensureSidebarClosed(page) {
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
      await expect(sidebar).not.toHaveClass(/open/, { timeout: 1000 });
      await page.waitForTimeout(500);
    }
  }
}

/**
 * Navigates to the Tests page and creates a subpage
 */
export async function createTestPage(page, title) {
  // Navigate to 'Tests' page root
  await page.goto('/#/page-tests');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000); // Give auth and state time to settle

  const emptyNewBtn = page.locator('#empty-new-page');
  if (await emptyNewBtn.isVisible()) {
    await emptyNewBtn.click({ force: true });
  } else {
    await ensureSidebarOpen(page);
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const btn = document.getElementById('new-page-btn') || document.getElementById('toolbar-new-page-btn');
      if (btn) btn.click();
    });
  }
  
  await page.waitForSelector('#new-page-modal-input', { timeout: 10000 });
  await page.fill('#new-page-modal-input', title);
  
  // Ensure 'Als Unterseite' (As subpage) is checked
  const childOpt = page.locator('#modal-opt-child');
  if (await childOpt.isVisible() && await childOpt.isEnabled() && !(await childOpt.isChecked())) {
      await childOpt.check({ force: true });
  }
  
  await page.click('#new-page-modal-submit');
  
  // Wait for navigation to the new page
  await expect(page.locator('#page-title')).toHaveValue(title, { timeout: 20000 });
  
  // Extract ID from URL
  await page.waitForURL(/\/([a-zA-Z0-9_-]+)/);
  const urlMatch = page.url().match(/#\/([^\/]+)/);
  const pageId = urlMatch ? urlMatch[1] : '';
  
  return pageId;
}

/**
 * Deletes a page via the UI
 */
export async function deletePageViaUI(page, pageId) {
  await page.goto(`/#/${pageId}`);
  await page.waitForLoadState('domcontentloaded');
  await ensureSidebarClosed(page);
  
  // Ensure no modal is blocking the delete button
  const overlay = page.locator('.modal-overlay:visible');
  if (await overlay.count() > 0) {
    await expect(overlay.first()).toBeHidden({ timeout: 10000 });
  }
  
  await page.waitForSelector('#delete-page-btn', { timeout: 10000 });
  await page.click('#delete-page-btn');
  
  const confirm = page.locator('.modal-box', { hasText: 'Seite löschen' });
  if (await confirm.isVisible({ timeout: 5000 })) {
      await confirm.locator('button', { hasText: 'Löschen' }).click();
  }
  
  // Wait for redirect to home or parent
  await expect(page).not.toHaveURL(new RegExp(`${pageId}$`), { timeout: 10000 });
}

/**
 * Waits for the editor to be fully synced (Yjs + Tiptap ready)
 */
export async function waitForEditorSynced(page) {
  const editor = page.locator('.editor-pane[data-synced="true"]:visible');
  await editor.waitFor({ state: 'attached', timeout: 15000 });
}

/**
 * Waits until pending edits are persisted (the #save-status indicator leaves
 * its "saving" state). Navigating away before this trips the "Seite
 * verlassen?" unsaved-changes guard, which blocks helpers like deletePageViaUI.
 */
export async function waitForSaved(page) {
  await expect(page.locator('#save-status')).not.toHaveClass(/saving/, { timeout: 15000 });
}
