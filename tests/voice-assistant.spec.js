import { test, expect } from '@playwright/test';
import { createTestPage, deletePageViaUI, ensureSidebarOpen, ensureSidebarClosed } from './helpers/page-utils.js';

/**
 * VoiceAssistant Playwright Spec
 */

async function loginAndCreatePage(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  // Handle Login
  const authOverlay = page.locator('#auth-overlay');
  if (await authOverlay.isVisible()) {
    await page.fill('#login-email', 'test.user@insel.ch');
    await page.fill('#login-password', 'InselWikiTest2026!');
    await page.click('#login-btn');
    await expect(authOverlay).toBeHidden({ timeout: 15000 });
  }

  // Create a new test page under page-tests
  const pageTitle = `VoiceTest-${Date.now()}`;
  const pageId = await createTestPage(page, pageTitle);

  // Wait for editor to be ready
  const editor = page.locator('.tiptap:visible');
  await expect(editor).toBeVisible({ timeout: 15000 });
  await editor.focus();
  
  return { editor, pageId };
}

test.describe('VoiceAssistant ↔ Tiptap Integration', () => {
  let createdPageId = null;

  test.beforeEach(async ({ page }) => {
    // Mock SpeechRecognition before page load or initialization
    await page.addInitScript(() => {
      class MockSpeechRecognition {
        constructor() {
          this.continuous = true;
          this.interimResults = true;
          this.lang = 'de-CH';
          this.onstart = null;
          this.onresult = null;
          this.onend = null;
          this.onerror = null;
          window._mockSpeechInstance = this;
        }
        start() {
          if (this.onstart) setTimeout(() => this.onstart(), 10);
        }
        stop() {
          if (this.onend) setTimeout(() => this.onend(), 10);
        }
      }

      window.SpeechRecognition = MockSpeechRecognition;
      window.webkitSpeechRecognition = MockSpeechRecognition;

      // Global helper to simulate voice input from the test
      window.simulateVoiceInput = (transcript) => {
        if (!window._mockSpeechInstance || !window._mockSpeechInstance.onresult) {
          console.error('[MockSpeech] No active instance or onresult handler');
          return;
        }
        const event = {
          resultIndex: 0,
          results: [
            {
              isFinal: true,
              0: { transcript: transcript }
            }
          ]
        };
        window._mockSpeechInstance.onresult(event);
      };
    });
  });

  test.afterEach(async ({ page }) => {
    if (createdPageId) {
        await deletePageViaUI(page, createdPageId);
    }
  });

  test('should execute voice commands: "neuer absatz", "fett", and "rückgängig"', async ({ page }) => {
    const { editor, pageId } = await loginAndCreatePage(page);
    createdPageId = pageId;

    const voiceBtn = page.locator('.format-btn[data-action="voice"]');
    
    // Start Voice Assistant
    await expect(voiceBtn).toBeVisible();
    await voiceBtn.click();
    await expect(voiceBtn).toHaveClass(/is-recording/);

    // --- Command 1: 'fett' (toggle bold) ---
    await page.evaluate(() => window.simulateVoiceInput('fett'));
    await page.evaluate(() => window.simulateVoiceInput('fetter text'));
    
    // Check if bold text was inserted
    const boldElement = editor.locator('strong, b');
    await expect(boldElement).toContainText(/fetter text/i);

    // --- Command 2: 'neuer absatz' (insert paragraph) ---
    await page.evaluate(() => window.simulateVoiceInput('neuer absatz'));
    await page.evaluate(() => window.simulateVoiceInput('zweiter absatz'));
    
    // Check if a new paragraph was created
    const paragraphs = editor.locator('p');
    await expect(paragraphs).toHaveCount(2);
    await expect(paragraphs.last()).toContainText(/zweiter absatz/i);

    // --- Command 3: 'rückgängig' (undo) ---
    await page.evaluate(() => window.simulateVoiceInput('rückgängig'));
    await expect(editor).not.toContainText(/zweiter absatz/i);
    
    // Stop Voice Assistant
    await voiceBtn.click();
    await expect(voiceBtn).not.toHaveClass(/is-recording/);
  });
});
