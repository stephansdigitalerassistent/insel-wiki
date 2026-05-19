import { test, expect } from './helpers/test-fixture.js';
import { createTestPage, deletePageViaUI, ensureSidebarClosed, waitForSaved } from './helpers/page-utils.js';
import { installVoiceMocks } from './helpers/voice-mocks.js';

/**
 * Voice recognition accuracy — how transcripts land in the editor.
 *
 * The streaming backend (getUserMedia / MediaRecorder / WebSocket) is mocked;
 * see voice-mocks.js. Only FINAL results are inserted into the document;
 * interim results are surfaced via onInterim but never written.
 */

async function loginAndCreatePage(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const authOverlay = page.locator('#auth-overlay');
  if (await authOverlay.isVisible()) {
    await page.fill('#login-email', 'test.user@insel.ch');
    await page.fill('#login-password', 'InselWikiTest2026!');
    await page.click('#login-btn');
    await expect(authOverlay).toBeHidden({ timeout: 15000 });
  }

  const pageId = await createTestPage(page, `VoiceRecog-${Date.now()}`);

  const editor = page.locator('.tiptap:visible');
  await expect(editor).toBeVisible({ timeout: 30000 });
  await ensureSidebarClosed(page);
  await editor.focus();

  return { editor, pageId };
}

test.describe('Voice Recognition Accuracy', () => {
  let createdPageId = null;

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(installVoiceMocks);
  });

  test.afterEach(async ({ page }) => {
    if (createdPageId) {
      await deletePageViaUI(page, createdPageId);
      createdPageId = null;
    }
  });

  test('inserts transcribed text and runs punctuation commands', async ({ page }) => {
    const { editor, pageId } = await loginAndCreatePage(page);
    createdPageId = pageId;

    const voiceBtn = page.locator('.format-btn[data-action="voice"]');
    await expect(voiceBtn).toBeVisible({ timeout: 10000 });
    await voiceBtn.click();
    await expect(voiceBtn).toHaveClass(/is-recording/);
    await page.waitForFunction(() => window.__voice && window.__voice.ready());

    // Text insertion — capitalized at the start of an empty document.
    await page.evaluate(() => window.__voice.final('hallo welt'));
    await expect(editor).toContainText('Hallo welt', { timeout: 10000 });

    // 'punkt' command appends '. '.
    await page.evaluate(() => window.__voice.final('punkt'));
    await expect(async () => {
      const text = await editor.innerText();
      expect(text).toContain('Hallo welt. ');
    }).toPass({ timeout: 10000 });

    // 'liste' command then a list item.
    await page.evaluate(() => window.__voice.final('liste'));
    await page.evaluate(() => window.__voice.final('erstes element'));
    await expect(editor.locator('ul li')).toContainText(/erstes element/i, { timeout: 10000 });

    // Let edits persist so afterEach navigation isn't blocked by the
    // "Seite verlassen?" unsaved-changes guard.
    await waitForSaved(page);

    await voiceBtn.click();
    await expect(voiceBtn).not.toHaveClass(/is-recording/);
  });

  test('interim results are not written into the document', async ({ page }) => {
    const { editor, pageId } = await loginAndCreatePage(page);
    createdPageId = pageId;

    const voiceBtn = page.locator('.format-btn[data-action="voice"]');
    await voiceBtn.click();
    await expect(voiceBtn).toHaveClass(/is-recording/);
    await page.waitForFunction(() => window.__voice && window.__voice.ready());

    // Interim results stream in but must not touch the document...
    await page.evaluate(() => window.__voice.interim('vorläufig'));
    await page.evaluate(() => window.__voice.interim('vorläufiger text'));
    await expect(editor).not.toContainText(/vorläufig/i);

    // ...only the final result is inserted.
    await page.evaluate(() => window.__voice.final('endgültiger text'));
    await expect(editor).toContainText(/endgültiger text/i, { timeout: 10000 });

    await waitForSaved(page);

    await voiceBtn.click();
    await expect(voiceBtn).not.toHaveClass(/is-recording/);
  });
});
