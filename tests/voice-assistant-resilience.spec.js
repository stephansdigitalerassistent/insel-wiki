import { test, expect } from './helpers/test-fixture.js';
import { createTestPage, deletePageViaUI, waitForSaved } from './helpers/page-utils.js';
import { installVoiceMocks } from './helpers/voice-mocks.js';

/**
 * VoiceAssistant resilience — reconnection and failure handling.
 *
 * The streaming backend is mocked (see voice-mocks.js). Each test installs the
 * mocks with its own options before navigating, since the failure mode under
 * test differs per case.
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

  const pageId = await createTestPage(page, `VoiceResilience-${Date.now()}`);

  const editor = page.locator('.tiptap:visible');
  await expect(editor).toBeVisible({ timeout: 15000 });
  await editor.focus();

  return { editor, pageId };
}

test.describe('VoiceAssistant Resilience', () => {
  let createdPageId = null;

  test.afterEach(async ({ page }) => {
    if (createdPageId) {
      await deletePageViaUI(page, createdPageId);
      createdPageId = null;
    }
  });

  test('transparently reconnects when the recognition stream is dropped', async ({ page }) => {
    await page.addInitScript(installVoiceMocks);
    const { editor, pageId } = await loginAndCreatePage(page);
    createdPageId = pageId;

    const voiceBtn = page.locator('.format-btn[data-action="voice"]');
    await voiceBtn.click();
    await expect(voiceBtn).toHaveClass(/is-recording/);
    await page.waitForFunction(() => window.__voice && window.__voice.ready());

    // Drop the session the way the service does at its ~5-min stream limit.
    await page.evaluate(() => window.__voice.drop(4011));

    // A fresh session opens and recording never visibly stops.
    await page.waitForFunction(() => window.__voice.socketCount() >= 2);
    await page.waitForFunction(() => window.__voice.ready());
    await expect(voiceBtn).toHaveClass(/is-recording/);

    // Transcription still works on the reconnected session.
    await page.evaluate(() => window.__voice.final('nach reconnect'));
    await expect(editor).toContainText(/nach reconnect/i, { timeout: 10000 });

    // Let edits persist so afterEach navigation isn't blocked by the
    // "Seite verlassen?" unsaved-changes guard.
    await waitForSaved(page);

    await voiceBtn.click();
    await expect(voiceBtn).not.toHaveClass(/is-recording/);
  });

  test('gives up and stops after repeated reconnect failures', async ({ page }) => {
    await page.addInitScript(installVoiceMocks);
    const { pageId } = await loginAndCreatePage(page);
    createdPageId = pageId;

    const voiceBtn = page.locator('.format-btn[data-action="voice"]');
    await voiceBtn.click();
    await expect(voiceBtn).toHaveClass(/is-recording/);
    await page.waitForFunction(() => window.__voice && window.__voice.ready());

    // From now on every (re)connection drops right after the auth frame.
    await page.evaluate(() => { window.__voiceState.serverDown = true; });
    await page.evaluate(() => window.__voice.drop(1006));

    // After exhausting its reconnect budget the assistant stops.
    await expect(voiceBtn).not.toHaveClass(/is-recording/, { timeout: 5000 });
  });

  test('stops on an auth rejection without retrying', async ({ page }) => {
    await page.addInitScript(installVoiceMocks, { rejectAuth: true });
    const { pageId } = await loginAndCreatePage(page);
    createdPageId = pageId;

    const voiceBtn = page.locator('.format-btn[data-action="voice"]');
    await voiceBtn.click();

    // The backend rejects the token — recording stops and is not retried.
    await expect(voiceBtn).not.toHaveClass(/is-recording/, { timeout: 5000 });
    expect(await page.evaluate(() => window.__voice.socketCount())).toBe(1);
  });

  test('stops gracefully when microphone access is denied', async ({ page }) => {
    await page.addInitScript(installVoiceMocks, { failGetUserMedia: true });
    const { pageId } = await loginAndCreatePage(page);
    createdPageId = pageId;

    const voiceBtn = page.locator('.format-btn[data-action="voice"]');
    await voiceBtn.click();

    await expect(voiceBtn).not.toHaveClass(/is-recording/);

    // Verify error toast is shown
    const toast = page.locator('.toast-error');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(/mikro|micro/i);
  });

  test('handles a browser without MediaRecorder support', async ({ page }) => {
    await page.addInitScript(installVoiceMocks, { noMediaRecorder: true });
    const { pageId } = await loginAndCreatePage(page);
    createdPageId = pageId;

    const voiceBtn = page.locator('.format-btn[data-action="voice"]');
    await voiceBtn.click();

    await expect(voiceBtn).not.toHaveClass(/is-recording/);

    // Verify error toast is shown
    const toast = page.locator('.toast-error');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(/support|unterstütz|charge/i);
  });
});
