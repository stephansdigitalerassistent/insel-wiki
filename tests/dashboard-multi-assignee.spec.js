import { test, expect } from '@playwright/test';
import { createTestPage, deletePageViaUI, ensureSidebarClosed, ensureSidebarOpen } from './helpers/page-utils.js';

test.describe('Task Board Dashboard: Multi-Assignee & Mention Edge Cases', () => {
  let createdPageIds = [];

  test.afterEach(async ({ page }) => {
    for (const id of createdPageIds) {
      try {
        await deletePageViaUI(page, id);
      } catch (err) {
        console.warn(`Failed to cleanup page ${id}:`, err);
      }
    }
    createdPageIds = [];
  });

  test('correctly parses, filters, and toggles multi-assignee tasks and handles mention edge cases', async ({ page }) => {
    test.setTimeout(120000);

    // 1. Identify current logged-in user name
    await page.goto('/#/page-tests');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#user-info span')).toBeVisible();
    const userName = (await page.locator('#user-info span').innerText()).trim();

    const timestamp = Date.now();
    const taskMultiFirst = `MultiFirst-${timestamp}`;
    const taskMultiSecond = `MultiSecond-${timestamp}`;
    const taskMultiMiddle = `MultiMiddle-${timestamp}`;
    const taskMultiToggle = `MultiToggle-${timestamp}`;
    const taskOtherTeam = `OtherTeam-${timestamp}`;
    const taskMentionPunctuation = `PunctuationTask-${timestamp}`;
    const taskEmailEdge = `EmailTask-${timestamp}`;
    const taskUnassigned = `Unassigned-${timestamp}`;

    const pageTitle = `TEST-DashboardMultiAssignee-${timestamp}`;
    const pageId = await createTestPage(page, pageTitle);
    createdPageIds.push(pageId);

    await ensureSidebarClosed(page);
    const editor = page.locator('.tiptap:visible');
    await editor.focus();

    // Type task items with multi-assignees and mention edge cases:
    // 1) Current user in 1st position among multiple assignees
    await page.keyboard.type(`[ ] ${taskMultiFirst} @${userName} @ColleagueA `);
    await page.keyboard.press('Enter');

    // 2) Current user in 2nd position
    await page.keyboard.type(`${taskMultiSecond} @ColleagueA @${userName} `);
    await page.keyboard.press('Enter');

    // 3) Current user in middle position
    await page.keyboard.type(`${taskMultiMiddle} @TeamLead @${userName} @DevOps `);
    await page.keyboard.press('Enter');

    // 4) Multi-assignee task to be toggled
    await page.keyboard.type(`${taskMultiToggle} @${userName} @ColleagueA `);
    await page.keyboard.press('Enter');

    // 5) Multi-assignee task for other users only
    await page.keyboard.type(`${taskOtherTeam} @ColleagueA @ColleagueB `);
    await page.keyboard.press('Enter');

    // 6) Mention with punctuation attached
    await page.keyboard.type(`${taskMentionPunctuation} with @${userName}, urgent review `);
    await page.keyboard.press('Enter');

    // 7) Email address coexistence (not an @userName mention)
    await page.keyboard.type(`${taskEmailEdge} email support@insel.ch @ColleagueA `);
    await page.keyboard.press('Enter');

    // 8) Plain unassigned task
    await page.keyboard.type(`${taskUnassigned}`);

    // Save and reload to trigger Firestore and compaction sync
    await page.keyboard.press('Control+s');
    await expect(page.locator('#save-status')).toHaveText(/Gespeichert|Saved/, { timeout: 15000 });
    await page.waitForTimeout(5000);
    await page.reload();
    await expect(page.locator('#page-title')).toHaveValue(pageTitle, { timeout: 15000 });
    await page.waitForTimeout(10000);

    // 2. Open Dashboard Overlay
    await ensureSidebarOpen(page);
    await page.waitForTimeout(500);
    await page.click('#open-dashboard-btn');
    const overlay = page.locator('.dashboard-overlay');
    await expect(overlay).toBeVisible();

    const myFilterBtn = page.locator('.filter-btn[data-filter="my"]');
    const allFilterBtn = page.locator('.filter-btn[data-filter="all"]');
    const statusSelect = page.locator('#status-filter-select');

    // 3. Switch to "My Tasks" (active) + "open" status
    await myFilterBtn.click();
    await expect(myFilterBtn).toHaveClass(/active/);
    await statusSelect.selectOption('open');
    await expect(statusSelect).toHaveValue('open');

    // Wait for all expected tasks to appear (robust against Firestore sync)
    await expect(async () => {
      await expect(page.locator('.task-card', { hasText: taskMultiFirst })).toBeVisible({ timeout: 2000 });
      await expect(page.locator('.task-card', { hasText: taskMultiSecond })).toBeVisible({ timeout: 2000 });
      await expect(page.locator('.task-card', { hasText: taskMultiMiddle })).toBeVisible({ timeout: 2000 });
      await expect(page.locator('.task-card', { hasText: taskMultiToggle })).toBeVisible({ timeout: 2000 });
      await expect(page.locator('.task-card', { hasText: taskMentionPunctuation })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 45000 });

    // Other users' tasks, email-only tasks, and unassigned tasks MUST be hidden
    await expect(page.locator('.task-card', { hasText: taskOtherTeam })).toBeHidden();
    await expect(page.locator('.task-card', { hasText: taskEmailEdge })).toBeHidden();
    await expect(page.locator('.task-card', { hasText: taskUnassigned })).toBeHidden();

    // 4. Filter Mode: Switch to "All Tasks"
    await allFilterBtn.click();
    await expect(allFilterBtn).toHaveClass(/active/);
    await expect(myFilterBtn).not.toHaveClass(/active/);

    // Switch status to "all" to reveal all tasks
    await statusSelect.selectOption('all');
    await expect(page.locator('.task-card', { hasText: taskMultiFirst })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.task-card', { hasText: taskMultiSecond })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.task-card', { hasText: taskMultiMiddle })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.task-card', { hasText: taskMultiToggle })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.task-card', { hasText: taskOtherTeam })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.task-card', { hasText: taskEmailEdge })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.task-card', { hasText: taskUnassigned })).toBeVisible({ timeout: 5000 });

    // 5. Interactive Toggle: Toggle a multi-assignee task from Dashboard
    // Switch to "My Tasks" and "all" status
    await myFilterBtn.click();
    await statusSelect.selectOption('all');

    const multiToggleCard = page.locator('.task-card', { hasText: taskMultiToggle }).first();
    const statusIcon = multiToggleCard.locator('.clickable-status');

    // Click icon to mark as done
    await statusIcon.click();
    await expect(statusIcon).toContainText('✅', { timeout: 10000 });
    await expect(multiToggleCard).toHaveClass(/completed/);

    // 6. Status Filter: Switch to "done" under "My Tasks"
    await statusSelect.selectOption('done');
    await expect(page.locator('.task-card', { hasText: taskMultiToggle })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.task-card', { hasText: taskMultiFirst })).toBeHidden();
    await expect(page.locator('.task-card', { hasText: taskMultiSecond })).toBeHidden();
    await expect(page.locator('.task-card', { hasText: taskMultiMiddle })).toBeHidden();
    await expect(page.locator('.task-card', { hasText: taskMentionPunctuation })).toBeHidden();

    // 7. Status Filter: Switch to "open" under "My Tasks"
    await statusSelect.selectOption('open');
    await expect(page.locator('.task-card', { hasText: taskMultiToggle })).toBeHidden();
    await expect(page.locator('.task-card', { hasText: taskMultiFirst })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.task-card', { hasText: taskMultiSecond })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.task-card', { hasText: taskMultiMiddle })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.task-card', { hasText: taskMentionPunctuation })).toBeVisible({ timeout: 5000 });

    // 8. Toggle back to open under "all"
    await statusSelect.selectOption('all');
    await expect(multiToggleCard).toBeVisible();
    await statusIcon.click();
    await expect(statusIcon).toContainText('⬜', { timeout: 10000 });
    await expect(multiToggleCard).not.toHaveClass(/completed/);

    // 9. Navigation: Click task card to navigate to page and close dashboard
    await multiToggleCard.click({ force: true });
    await expect(overlay).toBeHidden({ timeout: 5000 });
    await expect(page.locator('#page-title')).toHaveValue(pageTitle, { timeout: 10000 });
  });
});
