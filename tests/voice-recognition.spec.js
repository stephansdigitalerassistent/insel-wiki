import { test, expect } from '@playwright/test';

// Helper to perform login
async function login(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  
  const overlay = page.locator('#auth-overlay');
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

async function ensureSidebarOpen(page) {
  const toggle = page.locator('#sidebar-toggle');
  if (await toggle.isVisible()) {
    const sidebar = page.locator('#sidebar');
    await expect(async () => {
      if (await sidebar.evaluate(el => !el.classList.contains('open'))) {
        await toggle.click({ force: true });
        await expect(sidebar).toHaveClass(/open/, { timeout: 2000 });
      }
    }).toPass({ timeout: 10000 });
    await page.waitForTimeout(1000);
  }
}

test.describe('Voice Recognition Accuracy', () => {
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

  test('should correctly transcribe text and execute commands', async ({ page, browserName, isMobile }) => {
    // Skip mobile safari if it's too flaky in this environment
    if (browserName === 'webkit' && isMobile) {
        test.skip(true, 'Mobile Safari is flaky in this environment');
    }

    await ensureSidebarOpen(page);
    
    const pageTitle = `VoiceTest-${Date.now()}`;
    
    await page.evaluate(() => {
        const btn = document.getElementById('new-page-btn') || document.getElementById('toolbar-new-page-btn');
        if (btn) btn.click();
    });

    await page.waitForSelector('#new-page-modal-input', { timeout: 15000 });
    await page.fill('#new-page-modal-input', pageTitle);
    await page.click('#new-page-modal-submit');

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 30000 });

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
    // Use regex for case-insensitivity because of auto-capitalization after dot
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
