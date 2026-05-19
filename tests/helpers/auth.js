import { expect } from '@playwright/test';

export async function login(page, user, pass) {
  // Ensure the browser knows it is in a test environment to avoid BloomFilter errors
  await page.addInitScript(() => {
    window.__playwright_test__ = true;
  });

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  
  const overlay = page.locator('#auth-overlay');
  const loginError = page.locator('#login-error');
  
  // Check if already logged in
  const isOverlayHidden = await overlay.isHidden() || await overlay.evaluate(el => el.classList.contains('hidden'));
  const isUserInfoVisible = await page.locator('#user-info span').isVisible();

  if (isOverlayHidden && isUserInfoVisible) {
    console.log('Already logged in (overlay hidden, user-info visible), skipping login flow.');
    return;
  }

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`Login attempt ${attempt}...`);
      await page.fill('#login-email', user);
      await page.fill('#login-password', pass);
      await page.click('#login-btn');
      
      await Promise.race([
        expect(overlay).toHaveClass(/hidden/, { timeout: 60000 }),
        expect(loginError).toBeVisible({ timeout: 60000 })
      ]);

      if (await loginError.isVisible()) {
        lastError = await loginError.textContent();
        console.warn(`Login attempt ${attempt} failed with UI error: ${lastError}`);
        if (lastError.includes('400') || lastError.includes('timeout') || lastError.includes('Anmeldung fehlgeschlagen')) {
           await page.waitForTimeout(5000 * attempt);
           continue;
        }
        throw new Error(`Login failed: ${lastError}`);
      }
      
      console.log('Login successful');
      // await page.reload(); // Removed to avoid potential secondary 400s
      // await page.waitForLoadState('domcontentloaded');
      break; 
    } catch (e) {
      lastError = e;
      console.warn(`Login attempt ${attempt} threw: ${e.message}`);
      if (attempt === 3) throw e;
      await page.waitForTimeout(2000 * attempt);
    }
  }

  await page.evaluate(() => document.getElementById('auth-overlay')?.remove());
  await expect(page.locator('#user-info span')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1000);
}
