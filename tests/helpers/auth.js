import { expect } from '@playwright/test';

/**
 * Robust login helper for Insel-Wiki.
 * Handles existing sessions, retries on transient errors, and ensures UI is stable.
 */
export async function login(page, user, pass) {
  // Use a shorter default timeout for internal actions to fail fast and retry
  const actionTimeout = 15000;

  // Ensure the browser knows it is in a test environment to avoid BloomFilter errors
  await page.addInitScript(() => {
    window.__playwright_test__ = true;
  });

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      
      const overlay = page.locator('#auth-overlay');
      const loginError = page.locator('#login-error');
      const userInfo = page.locator('#user-info span');
      
      // 1. Check if we are already logged in
      // We give Firebase a few moments to restore the session from storageState
      try {
        await expect(async () => {
          const isHidden = await overlay.isHidden() || await overlay.evaluate(el => el.classList.contains('hidden'));
          const isUserVisible = await userInfo.isVisible();
          if (!isHidden || !isUserVisible) {
            throw new Error('Not logged in yet');
          }
        }).toPass({ timeout: 3000 });
        console.log('Already logged in, skipping login flow.');
        return;
      } catch (e) {
        // Not logged in or overlay still visible, proceed to manual login
      }

      console.log(`Login attempt ${attempt} for ${user}...`);
      
      // Ensure overlay is visible before interacting
      await expect(overlay).toBeVisible({ timeout: actionTimeout });
      
      await page.fill('#login-email', user);
      await page.fill('#login-password', pass);
      await page.click('#login-btn');
      
      // 2. Wait for either success (overlay hidden) or failure (error message)
      await expect(async () => {
        const isHiddenNow = await overlay.evaluate(el => el.classList.contains('hidden'));
        const hasError = await loginError.isVisible() && (await loginError.textContent()).trim().length > 0;
        if (!isHiddenNow && !hasError) {
          throw new Error('Waiting for login response...');
        }
      }).toPass({ timeout: 30000 });

      if (await loginError.isVisible()) {
        const errorText = await loginError.textContent();
        console.warn(`Login attempt ${attempt} failed with UI error: ${errorText}`);
        
        if (errorText.includes('400') || errorText.includes('timeout') || errorText.includes('Anmeldung fehlgeschlagen')) {
           await page.waitForTimeout(3000 * attempt);
           continue; // Retry
        }
        throw new Error(`Login failed: ${errorText}`);
      }
      
      console.log('Login successful');
      break;
    } catch (e) {
      console.warn(`Login attempt ${attempt} failed: ${e.message}`);
      if (attempt === 3) throw e;
      await page.waitForTimeout(2000 * attempt);
    }
  }

  // Ensure auth overlay is definitively gone and UI is ready
  await page.evaluate(() => {
    const ov = document.getElementById('auth-overlay');
    if (ov) ov.classList.add('hidden');
  });
  
  await expect(page.locator('#user-info span')).toBeVisible({ timeout: 30000 });
  // Final wait for any remaining transitions
  await page.waitForTimeout(500);
}
