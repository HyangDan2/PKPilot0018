/* One live desktop shot for the Stage 3A report: the regression output with the
   Stored Model Manager open on top of it.

   LIVE=https://hyangdan2.github.io/PKPilot0018/ node tools/shot_phase3_3a.cjs
*/
const fs = require('fs');
const path = require('path');
const { chromium } = require('/workspace/repos/PKPilot0015/node_modules/playwright');

const BASE = process.env.BASE || 'https://hyangdan2.github.io/PKPilot0018/';
const OUT = process.env.OUT || '/workspace/work/pkpilot0018';
const FILE = process.env.FILE || 'phase3-3a-pc.png';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || '/workspace/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',
    args: ['--single-process', '--no-zygote', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid=menubar]');

  await page.click('[data-testid=sample-button]');
  await page.waitForSelector('[data-testid=sample-menu]');
  await page.click('[data-testid=sample-regression]');
  await page.waitForTimeout(400);

  await page.click('[data-testid=menu-stat]');
  await page.getByRole('menuitem', { name: 'Regression', exact: true }).hover();
  await page.waitForTimeout(150);
  await page.getByRole('menuitem', { name: /Fit Regression Model/ }).click();
  await page.waitForSelector('[data-testid=analysis-dialog]');
  await page.click('[data-testid=slot-response]');
  await page.click('[data-testid=var-C4]');
  await page.click('[data-testid=add-selected]');
  for (const column of ['C1', 'C2', 'C3']) {
    await page.click('[data-testid=slot-predictors]');
    await page.click(`[data-testid=var-${column}]`);
    await page.click('[data-testid=add-selected]');
  }
  await page.click('[data-testid=dialog-ok]');
  await page.waitForSelector('[data-testid=analysis-dialog]', { state: 'detached', timeout: 30000 });
  await page.waitForTimeout(800);

  // Save the model, then show the manager with a prediction on screen.
  const card = page.locator('[data-testid=out-card]').first();
  const box = await card.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 16);
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(120);
  await page.mouse.up({ button: 'right' });
  await page.getByRole('menuitem', { name: /Save model to Model Manager/ }).click();
  await page.waitForTimeout(400);

  await page.click('[data-testid=menu-stat]');
  await page.waitForTimeout(150);
  await page.getByRole('menuitem', { name: /Stored Model Manager/ }).click();
  await page.waitForSelector('[data-testid=model-manager]');
  await page.fill('[data-testid="mm-input-Temperature (C)"]', '180');
  await page.fill('[data-testid="mm-input-Pressure (bar)"]', '2.9');
  await page.fill('[data-testid="mm-input-Speed (rpm)"]', '55');
  await page.click('[data-testid=mm-predict]');
  await page.waitForSelector('[data-testid=mm-prediction]');
  await page.waitForTimeout(300);

  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, FILE) });
  console.log('saved', path.join(OUT, FILE));
  await browser.close();
})();
