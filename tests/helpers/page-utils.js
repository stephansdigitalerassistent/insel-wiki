import { expect } from '@playwright/test';

/**
 * Ensures the sidebar is open (for mobile layouts)
 */
export async function ensureSidebarOpen(page) {
  const toggle = page.locator('#sidebar-toggle');
  if (await toggle.isVisible()) {
    const sidebar = page.locator('#sidebar');
    const isMobile = await page.evaluate(() => window.innerWidth <= 768);
    if (isMobile) {
      await expect(async () => {
        if (await sidebar.evaluate(el => !el.classList.contains('open'))) {
          await toggle.click({ force: true });
          await expect(sidebar).toHaveClass(/open/, { timeout: 1000 });
        }
      }).toPass({ timeout: 5000 });
    } else {
      await expect(async () => {
        if (await sidebar.evaluate(el => el.classList.contains('collapsed'))) {
          await toggle.click({ force: true });
          await expect(sidebar).not.toHaveClass(/collapsed/, { timeout: 1000 });
        }
      }).toPass({ timeout: 5000 });
    }
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
    const isMobile = await page.evaluate(() => window.innerWidth <= 768);
    if (isMobile) {
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
}

/**
 * Navigates to the Tests page and creates a subpage
 */
export async function createTestPage(page, title) {
  // Navigate to 'Tests' page root
  await page.goto('/#/page-tests');
  // Wait for sidebar or specific element instead of networkidle
  await expect(page.locator('#sidebar')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1000); // Give auth and state time to settle

  const emptyNewBtn = page.locator('#empty-new-page');
  if (await emptyNewBtn.isVisible()) {
    await emptyNewBtn.click({ force: true });
  } else {
    await ensureSidebarOpen(page);
    await page.waitForTimeout(500);
    const newPageBtn = page.locator('#new-page-btn, #toolbar-new-page-btn').first();
    await newPageBtn.waitFor({ state: 'visible', timeout: 5000 });
    await newPageBtn.click({ force: true });
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
  await expect(page.locator('#sidebar')).toBeVisible({ timeout: 15000 });

  // handleDeletePage() returns early when canEdit() is false or currentPageId is
  // still null, and it does so silently — no modal, no toast. #delete-page-btn
  // lives in static markup, so it is visible long before Firebase auth has
  // restored the session and loadPage() has run; clicking on visibility alone
  // lands in that window and does nothing, which used to surface as a confusing
  // "waiting for .modal-overlay" timeout in afterEach hooks.
  //
  // loadPage() sets `pageTitleInput.readOnly = !canEdit()` once it has the page,
  // so a populated *and* editable title is a direct signal that both of
  // handleDeletePage()'s preconditions now hold.
  const titleInput = page.locator('#page-title');
  await expect(titleInput).not.toHaveValue('', { timeout: 20000 });
  await expect(titleInput).toBeEditable({ timeout: 20000 });

  await ensureSidebarClosed(page);

  const deleteBtn = page.locator('#delete-page-btn');
  await expect(deleteBtn).toBeVisible({ timeout: 10000 });

  const confirm = page.locator('.modal-overlay:visible .modal-box', {
    has: page.locator('button.btn-danger'),
  });

  // Even with those guards the click can still race the controller wiring up its
  // listener, so retry rather than failing the caller's cleanup on a single miss.
  let opened = false;
  for (let attempt = 1; attempt <= 3 && !opened; attempt++) {
    await deleteBtn.click({ force: true });
    try {
      await confirm.waitFor({ state: 'visible', timeout: 5000 });
      opened = true;
    } catch {
      if (attempt < 3) await page.waitForTimeout(1000);
    }
  }
  if (!opened) {
    throw new Error(
      `deletePageViaUI: delete confirm modal never opened for page ${pageId} after 3 attempts ` +
      `(title="${await titleInput.inputValue()}", editable=${await titleInput.isEditable()})`
    );
  }

  await confirm.locator('button.btn-danger').click();

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
