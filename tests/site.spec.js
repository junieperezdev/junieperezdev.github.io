const fs = require('fs');
const { test, expect } = require('@playwright/test');

// WCAG relative-luminance contrast between two computed rgb() colours
function contrast(a, b) {
  const lum = (c) => {
    const [r, g, bl] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

async function scrollThrough(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 300) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
  });
}

test('loads without console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await scrollThrough(page);
  expect(errors).toEqual([]);
});

test('never scrolls sideways', async ({ page }) => {
  await page.goto('/');
  await scrollThrough(page);
  const [scrollW, viewW] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scrollW).toBeLessThanOrEqual(viewW);
});

test('every section is revealed after scrolling', async ({ page }) => {
  await page.goto('/');
  await scrollThrough(page);
  await expect.poll(() => page.locator('.rv:not(.in)').count()).toBe(0);
});

test('headline is visible on first paint, never faded in', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.statement')).not.toHaveClass(/\brv\b/);
  expect(await page.locator('.statement').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
});

test('track-record figures end on their real values', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1500);
  await expect(page.locator('.fig-num')).toHaveText(['12 yrs', '>50%', '~6 mo', '<20 ms']);
});

test('pause button stops every loop and is remembered', async ({ page }) => {
  await page.goto('/');
  const toggle = page.locator('#motion-toggle');
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const running = () => page.evaluate(() =>
    document.getAnimations().filter((a) => a.playState === 'running' && a.effect.getTiming().iterations === Infinity).length);
  expect(await running()).toBe(0);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/\bpaused\b/);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('shows everything without scrolling, runs no animation, hides the pause button', async ({ page }) => {
    await page.goto('/');
    expect(await page.evaluate(() => document.documentElement.classList.contains('motion'))).toBe(false);
    await expect(page.locator('#motion-toggle')).toBeHidden();
    const hidden = await page.evaluate(() =>
      [...document.querySelectorAll('section *')].filter((el) => getComputedStyle(el).opacity === '0').length);
    expect(hidden).toBe(0);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });

  // Baselines come from GitHub's runner (Update screenshots workflow); until they exist this test is skipped
  test('full-page screenshot', async ({ page }, info) => {
    test.skip(!process.env.UPDATE_SCREENSHOTS && !fs.existsSync(info.snapshotPath('page.png')), 'no baseline yet');
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot('page.png', { fullPage: true, maxDiffPixelRatio: 0.01 });
  });
});

for (const scheme of ['light', 'dark']) {
  test(`filled badges meet 4.5:1 contrast in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    await scrollThrough(page);
    await page.waitForTimeout(1500); // let the colour transitions finish
    const pairs = await page.evaluate(() =>
      [...document.querySelectorAll('.sec-head.in .sec-n, .stepper li.in .st-n')].map((el) => {
        const cs = getComputedStyle(el);
        return [cs.color, cs.backgroundColor];
      }));
    expect(pairs.length).toBeGreaterThan(0);
    for (const [fg, bg] of pairs) expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
}

test('contact offers email, a free call and Messenger', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#email')).toHaveText('junieperez.dev@gmail.com');
  await expect(page.locator('.contact-actions a[href^="mailto:junieperez.dev@gmail.com"]')).toBeVisible();
  await expect(page.locator('.contact-actions a[href="https://m.me/junieperez.dev"]')).toBeVisible();
});
