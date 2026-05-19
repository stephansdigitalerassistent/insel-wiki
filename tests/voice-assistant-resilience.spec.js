import { test, expect } from '@playwright/test';
import { createTestPage, deletePageViaUI, ensureSidebarOpen, ensureSidebarClosed } from './helpers/page-utils.js';

/**
 * VoiceAssistant Resilience Spec
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
  const pageTitle = `VoiceResilience-${Date.now()}`;
  const pageId = await createTestPage(page, pageTitle);

  // Wait for editor to be ready
  const editor = page.locator('.tiptap:visible');
  await expect(editor).toBeVisible({ timeout: 15000 });
  await editor.focus();
  
  return { editor, pageId };
}

test.describe('VoiceAssistant Resilience', () => {
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
          this.startCount = 0;
          window._mockSpeechInstance = this;
        }
        start() {
          this.startCount++;
          if (window._mockStartShouldThrow) {
            throw new Error('Mock Start Failed');
          }
          if (this.onstart) setTimeout(() => this.onstart(), 10);
        }
        stop() {
          if (this.onend) setTimeout(() => this.onend(), 10);
        }
      }

      window.SpeechRecognition = MockSpeechRecognition;
      window.webkitSpeechRecognition = MockSpeechRecognition;
      
      window._mockStartShouldThrow = false;
    });
  });

  test.afterEach(async ({ page }) => {
    if (createdPageId) {
        await deletePageViaUI(page, createdPageId);
    }
  });

  test('should auto-restart if onend is triggered while recording', async ({ page }) => {
    const { pageId } = await loginAndCreatePage(page);
    createdPageId = pageId;
    
    const voiceBtn = page.locator('.format-btn[data-action="voice"]');
    
    // Start Voice Assistant
    await voiceBtn.click();
    await expect(voiceBtn).toHaveClass(/is-recording/);

    // Initial start call
    let startCount = await page.evaluate(() => window._mockSpeechInstance.startCount);
    expect(startCount).toBe(1);

    // Simulate unexpected 'onend' (e.g. Mobile Safari timeout)
    await page.evaluate(() => {
      window._mockSpeechInstance.onend();
    });

    // It should have called start() again
    await page.waitForFunction(() => window._mockSpeechInstance.startCount > 1);
    startCount = await page.evaluate(() => window._mockSpeechInstance.startCount);
    expect(startCount).toBe(2);
    
    // UI should still show recording state
    await expect(voiceBtn).toHaveClass(/is-recording/);
  });

  test('should stop recording gracefully on recognition error (non-network)', async ({ page }) => {
    const { pageId } = await loginAndCreatePage(page);
    createdPageId = pageId;
    
    const voiceBtn = page.locator('.format-btn[data-action="voice"]');
    
    // Start Voice Assistant
    await voiceBtn.click();
    await expect(voiceBtn).toHaveClass(/is-recording/);

    // Simulate 'onerror' with something other than 'network'
    await page.evaluate(() => {
      window._mockSpeechInstance.onerror({ error: 'not-allowed' });
    });

    // UI should update to NOT recording
    await expect(voiceBtn).not.toHaveClass(/is-recording/);
  });

  test('should attempt recovery on network error', async ({ page }) => {
    const { pageId } = await loginAndCreatePage(page);
    createdPageId = pageId;
    
    const voiceBtn = page.locator('.format-btn[data-action="voice"]');
    
    // Start Voice Assistant
    await voiceBtn.click();
    await expect(voiceBtn).toHaveClass(/is-recording/);

    // Initial start call
    let startCount = await page.evaluate(() => window._mockSpeechInstance.startCount);
    expect(startCount).toBe(1);

    // Simulate 'onerror' with 'network'
    await page.evaluate(() => {
      window._mockSpeechInstance.onerror({ error: 'network' });
    });

    // UI should STILL show recording state (it's in retry phase)
    await expect(voiceBtn).toHaveClass(/is-recording/);

    // It should have called start() again after a timeout
    await page.waitForFunction(() => window._mockSpeechInstance.startCount > 1, { timeout: 5000 });
    startCount = await page.evaluate(() => window._mockSpeechInstance.startCount);
    expect(startCount).toBe(2);
    
    await expect(voiceBtn).toHaveClass(/is-recording/);
  });

  test('should handle failure to start SpeechRecognition', async ({ page }) => {
    const { pageId } = await loginAndCreatePage(page);
    createdPageId = pageId;
    
    const voiceBtn = page.locator('.format-btn[data-action="voice"]');

    // Make start() throw
    await page.evaluate(() => {
      window._mockStartShouldThrow = true;
    });

    // Try to start
    await voiceBtn.click();

    // UI should not show recording state because it failed immediately
    await expect(voiceBtn).not.toHaveClass(/is-recording/);
  });
  
  test('should handle auto-restart failure gracefully', async ({ page }) => {
    const { pageId } = await loginAndCreatePage(page);
    createdPageId = pageId;
    
    const voiceBtn = page.locator('.format-btn[data-action="voice"]');
    
    // Start Voice Assistant
    await voiceBtn.click();
    await expect(voiceBtn).toHaveClass(/is-recording/);

    // Make NEXT start() call throw (for auto-restart)
    await page.evaluate(() => {
      window._mockStartShouldThrow = true;
    });

    // Simulate unexpected 'onend'
    await page.evaluate(() => {
      window._mockSpeechInstance.onend();
    });

    // UI should update to NOT recording because auto-restart failed
    await expect(voiceBtn).not.toHaveClass(/is-recording/);
  });

  test('should handle unsupported browser gracefully', async ({ page }) => {
    await page.addInitScript(() => {
      window.SpeechRecognition = undefined;
      window.webkitSpeechRecognition = undefined;
    });

    const { pageId } = await loginAndCreatePage(page);
    createdPageId = pageId;
    
    const voiceBtn = page.locator('.format-btn[data-action="voice"]');
    
    // Try to start
    await voiceBtn.click();
    
    // UI should not show recording state
    await expect(voiceBtn).not.toHaveClass(/is-recording/);
  });
});
