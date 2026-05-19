import { test, expect } from './helpers/test-fixture.js';
import { createTestPage, deletePageViaUI, waitForSaved } from './helpers/page-utils.js';
import { installVoiceMocks } from './helpers/voice-mocks.js';

/**
 * VoiceAssistant ↔ Tiptap integration.
 *
 * VoiceAssistant streams mic audio to /api/transcribe over a WebSocket; the
 * getUserMedia / MediaRecorder / WebSocket stack is mocked (see voice-mocks.js)
 * so transcripts can be injected deterministically.
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

  const pageId = await createTestPage(page, `VoiceTest-${Date.now()}`);

  const editor = page.locator('.tiptap:visible');
  await expect(editor).toBeVisible({ timeout: 15000 });
  await editor.focus();

  return { editor, pageId };
}

// Click the mic button and wait for a live recognition session (socket open,
// recorder running) so injected transcripts are not dropped.
async function startRecording(page, voiceBtn) {
  await expect(voiceBtn).toBeVisible();
  await voiceBtn.click();
  await expect(voiceBtn).toHaveClass(/is-recording/);
  await page.waitForFunction(() => window.__voice && window.__voice.ready());
}

test.describe('VoiceAssistant ↔ Tiptap Integration', () => {
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

  test('executes voice commands: "fett", "neuer absatz", "rückgängig"', async ({ page }) => {
    const { editor, pageId } = await loginAndCreatePage(page);
    createdPageId = pageId;

    const voiceBtn = page.locator('.format-btn[data-action="voice"]');
    await startRecording(page, voiceBtn);

    // --- 'fett' (toggle bold) ---
    await page.evaluate(() => window.__voice.final('fett'));
    await page.evaluate(() => window.__voice.final('fetter text'));
    await expect(editor.locator('strong, b')).toContainText(/fetter text/i);

    // --- 'neuer absatz' (new paragraph) ---
    await page.evaluate(() => window.__voice.final('neuer absatz'));
    await page.evaluate(() => window.__voice.final('zweiter absatz'));
    await expect(editor.locator('p')).toHaveCount(2);
    await expect(editor.locator('p').last()).toContainText(/zweiter absatz/i);

    // --- 'rückgängig' (undo) ---
    await page.evaluate(() => window.__voice.final('rückgängig'));
    await expect(editor).not.toContainText(/zweiter absatz/i);

    // Let edits persist so afterEach navigation isn't blocked by the
    // "Seite verlassen?" unsaved-changes guard.
    await waitForSaved(page);

    await voiceBtn.click();
    await expect(voiceBtn).not.toHaveClass(/is-recording/);
  });

  test('streams audio while recording and closes the session on stop', async ({ page }) => {
    const { pageId } = await loginAndCreatePage(page);
    createdPageId = pageId;

    const voiceBtn = page.locator('.format-btn[data-action="voice"]');
    await startRecording(page, voiceBtn);

    // The mocked MediaRecorder emits chunks that are streamed to the backend.
    await page.waitForFunction(() => window.__voice.audioFramesSent() > 0);
    expect(await page.evaluate(() => window.__voice.socketCount())).toBe(1);

    await voiceBtn.click();
    await expect(voiceBtn).not.toHaveClass(/is-recording/);

    // The recorder is stopped and no new session is opened.
    expect(await page.evaluate(() => window.__voice.recorderActive())).toBe(false);
    expect(await page.evaluate(() => window.__voice.socketCount())).toBe(1);
  });
});
