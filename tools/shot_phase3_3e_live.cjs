/* Stage 3E — live screenshots from GitHub Pages (not a test, just pictures). */
const path = require('path');
const fs = require('fs');
let chromium;
for (const candidate of ['/workspace/pkpilot0014/node_modules/playwright', 'playwright']) {
  try { chromium = require(candidate).chromium; break; } catch { /* next */ }
}
if (!chromium) throw new Error('playwright missing');

const BASE = process.env.BASE || 'https://hyangdan2.github.io/PKPilot0018/';
const OUT = process.env.OUT || '/workspace/work/pkpilot0018';
const SHELL = '/workspace/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const LIBS = '/workspace/work/chrome-libs/usr/lib/x86_64-linux-gnu:/workspace/work/chrome-libs/lib/x86_64-linux-gnu';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: SHELL,
    env: { ...process.env, LD_LIBRARY_PATH: LIBS },
    args: ['--single-process', '--no-zygote', '--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid=menubar]');
    await page.click('[data-testid=sample-button]');
    await page.waitForSelector('[data-testid=sample-menu]');
    await page.click('[data-testid=sample-regression]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, 'phase3-3e-live-home.png') });

    /* one regression → stored model → 3D surface */
    await page.click('[data-testid=menu-stat]');
    await page.waitForTimeout(150);
    await page.getByRole('menuitem', { name: 'Regression', exact: true }).hover();
    await page.waitForTimeout(200);
    await page.getByRole('menuitem', { name: /Fit Regression Model/ }).click();
    await page.waitForSelector('[data-testid=analysis-dialog]');
    await page.click('[data-testid=slot-response]');
    await page.click('[data-testid=var-C4]');
    await page.click('[data-testid=add-selected]');
    await page.click('[data-testid=slot-predictors]');
    await page.click('[data-testid=var-C1]');
    await page.click('[data-testid=add-selected]');
    await page.click('[data-testid=slot-predictors]');
    await page.click('[data-testid=var-C2]');
    await page.click('[data-testid=add-selected]');
    await page.click('[data-testid=dialog-ok]');
    await page.waitForSelector('[data-testid=analysis-dialog]', { state: 'detached', timeout: 60000 });
    await page.waitForTimeout(800);
    const card = page.locator('[data-testid=out-card]').last();
    await card.scrollIntoViewIfNeeded();
    const box = await card.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 18);
    await page.mouse.down({ button: 'right' });
    await page.waitForTimeout(120);
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(300);
    await page.getByRole('menuitem', { name: /Save model to Model Manager/ }).click();
    await page.waitForTimeout(400);
    await page.click('[data-testid=menu-stat]');
    await page.waitForTimeout(150);
    await page.getByRole('menuitem', { name: /Stored Model Manager/ }).click();
    await page.waitForSelector('[data-testid=model-manager]');
    await page.locator('[data-testid=mm-item]').first().click();
    await page.click('[data-testid=mm-surface]');
    await page.waitForSelector('[data-testid=surface3d]', { timeout: 30000 });
    await page.waitForTimeout(1800);
    const renderer = await page.locator('[data-testid=surface3d]').getAttribute('data-renderer');
    await page.locator('[data-testid=surface3d]').last().screenshot({ path: path.join(OUT, 'phase3-3e-live-surface.png') });
    await page.screenshot({ path: path.join(OUT, 'phase3-3e-live.png') });
    console.log(`live screenshots written · surface renderer = ${renderer}`);
    await ctx.close();
  } finally {
    await browser.close();
  }
})();
