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
      await expect(sidebar).not.toHaveClass(/open/, { timeout: 1000 });
      await page.waitForTimeout(500);
    }
  }
}

test.describe('Insel-Wiki Evolution Suite', () => {
  let createdPageIds = [];

  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      console.log(`Browser console [${msg.type()}]: ${msg.text()}`);
    });
    await login(page);
    createdPageIds = []; // Reset for each test
  });

  test.afterEach(async ({ page }) => {
    // Instead of complex browser logic, we'll just use the cleanup script if many pages exist,
    // or just ensure we delete what we created via the UI.
    
    // Ensure dashboard is closed if open
    const dashboardOverlay = page.locator('.dashboard-overlay');
    if (await dashboardOverlay.isVisible()) {
        await page.click('#close-dashboard-btn', { force: true });
        await expect(dashboardOverlay).toBeHidden({ timeout: 5000 });
    }

    for (const id of createdPageIds) {
        await page.goto(`/#/${id}`);
        await ensureSidebarClosed(page);
        await page.waitForSelector('#delete-page-btn');
        page.once('dialog', dialog => dialog.accept());
        await page.click('#delete-page-btn');
    }
  });
  test('Dashboard: Aggregating tasks from pages', async ({ page }) => {
    const taskText = `Task-${Date.now()}`;
    const pageTitle = `TEST-TaskPage-${Date.now()}`;
    
    // Navigate to 'Tests' page so we can create it as a child
    await page.goto('/#/page-tests');

    await page.waitForTimeout(1000); // Give auth time to settle
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
    await page.fill('#new-page-modal-input', pageTitle);
    
    // Check 'Als Unterseite' box if it's there and not disabled
    const childOpt = page.locator('#modal-opt-child');
    if (await childOpt.isVisible() && await childOpt.isEnabled() && !(await childOpt.isChecked())) {
        await childOpt.check({ force: true });
    }

    await page.click('#new-page-modal-submit');
    
    // Wait for navigation to the new page by checking the title
    await expect(page.locator('#page-title')).toHaveValue(pageTitle, { timeout: 15000 });
    
    // Extract ID from URL
    await page.waitForURL(/\/([a-zA-Z0-9_-]+)/);
    const urlMatch = page.url().match(/#\/([^\/]+)/);
    const pageId = urlMatch ? urlMatch[1] : '';
    createdPageIds.push(pageId);

    await ensureSidebarClosed(page);
    const editor = page.locator('.tiptap');
    await editor.focus();
    await page.keyboard.type(`[ ] ${taskText}`);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(6000); // give yjs and firestore time to sync

    // 2. Open Dashboard
    await ensureSidebarOpen(page);
    await page.waitForTimeout(500);
    await page.click('#open-dashboard-btn');
    await expect(page.locator('.dashboard-overlay')).toBeVisible();

    // Wait for the task to appear, retrying if necessary
    await expect(async () => {
      // Re-open dashboard if it closed or tasks are still rendering
      const taskCard = page.locator('.task-card', { hasText: taskText });
      await expect(taskCard).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    
    const taskCard = page.locator('.task-card', { hasText: taskText });
    await taskCard.first().click({ force: true });
    await expect(page.locator('.dashboard-overlay')).toBeHidden({ timeout: 5000 });
  });

  test('Offline: Status indicator should appear', async ({ page, context }) => {
    // On mobile, the sidebar might overlap the indicator if open
    const sidebar = page.locator('#sidebar');
    const toggle = page.locator('#sidebar-toggle');
    if (await toggle.isVisible() && await sidebar.evaluate(el => el.classList.contains('open'))) {
      await toggle.click();
      await expect(sidebar).not.toHaveClass(/open/);
    }

    await context.setOffline(true);
    await expect(page.locator('#offline-indicator')).toBeVisible();
    await context.setOffline(false);
    await expect(page.locator('#offline-indicator')).toBeHidden();
  });

  test('Page Lifecycle: Robust check', async ({ page }) => {
    const title = `TEST-Robust-${Date.now()}`;
    // Navigate to 'Tests' page so we can create it as a child
    await page.goto('/#/page-tests');

    await page.waitForTimeout(1000); // Give auth time to settle
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

    // Check 'Als Unterseite' box if it's there and not disabled
    const childOpt = page.locator('#modal-opt-child');
    if (await childOpt.isVisible() && await childOpt.isEnabled() && !(await childOpt.isChecked())) {
        await childOpt.check({ force: true });
    }

    await page.click('#new-page-modal-submit');

    // Wait for navigation to the new page by checking the title
    await expect(page.locator('#page-title')).toHaveValue(title, { timeout: 15000 });

    await page.waitForURL(/\/([a-zA-Z0-9_-]+)/);
    const urlMatch = page.url().match(/#\/([^\/]+)/);
    const pageId = urlMatch ? urlMatch[1] : '';
    // We don't push to createdPageIds here because we delete it manually in the test
    
    await ensureSidebarClosed(page);
    await expect(page.locator('#page-title')).toHaveValue(title);
    page.once('dialog', dialog => dialog.accept());
    await page.click('#delete-page-btn');
    await expect(page.locator('#empty-state')).toBeVisible();
  });

  test('Trash: Permanent Deletion', async ({ page }) => {
    const title = `TEST-Trash-${Date.now()}`;
    
    // 1. Create page
    // Ensure we are logged in and auth state is loaded by checking if new page buttons are visible/clickable
    // Navigate to 'Tests' page so we can create it as a child
    await page.goto('/#/page-tests');

    await page.waitForTimeout(1000); // Give auth time to settle
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

    // Check 'Als Unterseite' box if it's there and not disabled
    const childOpt = page.locator('#modal-opt-child');
    if (await childOpt.isVisible() && await childOpt.isEnabled() && !(await childOpt.isChecked())) {
        await childOpt.check({ force: true });
    }

    await page.click('#new-page-modal-submit');
    
    // Wait for navigation to the new page by checking the title
    await expect(page.locator('#page-title')).toHaveValue(title, { timeout: 15000 });
    await ensureSidebarClosed(page);

    // 2. Soft delete
    page.once('dialog', dialog => dialog.accept());
    await page.click('#delete-page-btn');
    await expect(page.locator('#empty-state')).toBeVisible();

    // 3. Open Trash
    await ensureSidebarOpen(page);
    await page.waitForTimeout(500);
    await page.click('.trash-header');
    const trashItem = page.locator('.trash-item', { hasText: title });
    await expect(trashItem).toBeVisible();

    // 4. Permanent delete
    page.once('dialog', dialog => dialog.accept());
    await trashItem.locator('.btn-danger').click();

    // 5. Verify gone from trash
    await expect(trashItem).not.toBeVisible();
  });

});
