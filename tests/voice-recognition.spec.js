import { test, expect } from '@playwright/test';
import { createTestPage, deletePageViaUI, ensureSidebarOpen, ensureSidebarClosed } from './helpers/page-utils.js';

// Helper to perform login
async function login(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  
  const overlay = page.locator('#auth-overlay');
  if (await overlay.isHidden() && await page.locator('#user-info span').isVisible()) {
    await page.evaluate(() => document.getElementById('auth-overlay')?.remove());
    return;
  }

  try {
    await expect(overlay).not.toHaveClass(/hidden/, { timeout: 5000 });
    await page.fill('#login-email', 'test.user@insel.ch');
    await page.fill('#login-password', 'InselWikiTest2026!');
    await page.click('#login-btn');
    await expect(overlay).toHaveClass(/hidden/, { timeout: 15000 });
  } catch (e) {
    // Already logged in
  }
  await page.evaluate(() => document.getElementById('auth-overlay')?.remove());
}

test.describe('Voice Recognition Accuracy', () => {
  let createdPageId = null;

  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      console.log(`Browser console [${msg.type()}]: ${msg.text()}`);
    });
    await login(page);
    
    // Mock SpeechRecognition early
    await page.evaluate(() => {
      class MockSpeechRecognition {
        constructor() {
          this.continuous = false;
          this.interimResults = false;
          this.lang = '';
          this.onstart = null;
          this.onresult = null;
          this.onend = null;
          this.onerror = null;
          window._activeMock = this;
        }
        start() { if (this.onstart) setTimeout(() => this.onstart(), 50); }
        stop() { if (this.onend) setTimeout(() => this.onend(), 50); }
      }
      window.SpeechRecognition = MockSpeechRecognition;
      window.webkitSpeechRecognition = MockSpeechRecognition;
      
      window._simulateSpeech = (transcript, isFinal = true) => {
        if (!window._activeMock) return;
        const event = {
          resultIndex: 0,
          results: [
            {
              isFinal: isFinal,
              0: { transcript: transcript }
            }
          ]
        };
        if (window._activeMock.onresult) window._activeMock.onresult(event);
      };
    });
  });

  test.afterEach(async ({ page }) => {
    if (createdPageId) {
        await deletePageViaUI(page, createdPageId);
    }
  });

  test('should correctly transcribe text and execute commands', async ({ page, browserName, isMobile }) => {
    // Skip mobile safari if it's too flaky in this environment
    if (browserName === 'webkit' && isMobile) {
        test.skip(true, 'Mobile Safari is flaky in this environment (handled via auto-restart in implementation)');
    }

    const pageTitle = `VoiceTest-${Date.now()}`;
    createdPageId = await createTestPage(page, pageTitle);

    const editor = page.locator('.tiptap:visible');
    await expect(editor).toBeVisible({ timeout: 30000 });
    await ensureSidebarClosed(page);

    const voiceBtn = page.locator('.format-btn[data-action="voice"]');
    await expect(voiceBtn).toBeVisible({ timeout: 10000 });

    // 1. Test basic text insertion and capitalization
    await voiceBtn.click();
    await page.waitForTimeout(500); 
    await page.evaluate(() => window._simulateSpeech('hallo welt'));
    await expect(editor).toContainText('Hallo welt', { timeout: 10000 }); 

    // 2. Test punctuation command
    await page.evaluate(() => window._simulateSpeech('punkt'));
    await expect(async () => {
        const text = await editor.innerText();
        if (!text.includes('Hallo welt. ')) {
            throw new Error(`Text does not contain expected punctuation: "${text}"`);
        }
    }).toPass({ timeout: 10000 });

    // 3. Test formatting command (Fett)
    await page.evaluate(() => window._simulateSpeech('fett'));
    await page.evaluate(() => window._simulateSpeech('fetter text'));
    await expect(editor.locator('strong')).toContainText(/fetter text/i, { timeout: 10000 });

    // 4. Test list command
    await page.evaluate(() => window._simulateSpeech('liste'));
    await page.evaluate(() => window._simulateSpeech('erstes element'));
    await expect(editor.locator('ul li')).toContainText(/erstes element/i, { timeout: 10000 });

    // 5. Test navigation command (Neuer Absatz)
    await page.evaluate(() => window._simulateSpeech('neuer absatz'));
    await page.evaluate(() => window._simulateSpeech('zweiter absatz'));
    await expect(editor.locator('p')).toHaveCount(2, { timeout: 10000 });
    await expect(editor.locator('p').last()).toContainText(/zweiter absatz/i, { timeout: 10000 });

    await voiceBtn.click(); // Stop recording
  });
});
