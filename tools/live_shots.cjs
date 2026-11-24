/* Clean live screenshots for the compact-UI handoff (PC, mobile, detach, presets). */
const path = require('path');
const { chromium, executablePath: CHROME, browserEnv } = require('./browser_env.cjs');
const BASE = process.env.BASE || 'https://hyangdan2.github.io/PKPilot0018/';
const OUT = process.env.OUT || path.resolve(__dirname, '..', '..', 'pkpilot0018');

const MENU = (page, name) => page.getByRole('menuitem', { name, exact: true });

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, env: browserEnv, args: ['--single-process', '--no-zygote', '--disable-gpu', '--disable-dev-shm-usage', '--disable-software-rasterizer'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid=menubar]');
    await page.click('[data-testid=sample-button]');
    await page.click('[data-testid=sample-process]');
    await page.waitForTimeout(500);
    await page.click('[data-testid=quick-hist]');
    await page.waitForSelector('[data-testid=analysis-dialog]');
    await page.click('[data-testid=slot-variable]');
    await page.click('[data-testid=var-C1]');
    const add = page.locator('[data-testid=add-selected]');
    if (await add.count()) await add.first().click();
    await page.click('[data-testid=dialog-ok]');
    await page.waitForSelector('[data-testid=analysis-dialog]', { state: 'detached' });
    await page.waitForTimeout(3800);
    await page.mouse.move(700, 500);
    await page.screenshot({ path: `${OUT}/ui-compact-pc.png` });

    // layout presets open in the View menu
    await page.click('[data-testid=menu-view]');
    await page.waitForTimeout(200);
    await MENU(page, 'Panel layout').hover();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/ui-layout-menu.png` });
    await page.keyboard.press('Escape');

    // detached output window over the docked workspace
    await page.click('[data-testid=detach-output]');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/ui-detach.png` });
    await page.close();

    const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mobile = await mobileCtx.newPage();
    await mobile.goto(BASE, { waitUntil: 'networkidle' });
    await mobile.waitForSelector('[data-testid=menubar]');
    await mobile.click('[data-testid=sample-button]');
    await mobile.waitForSelector('[data-testid=sample-menu]');
    await mobile.waitForTimeout(300);
    await mobile.screenshot({ path: `${OUT}/ui-compact-mobile.png` });
  } finally {
    await browser.close();
  }
  console.log('shots done');
})().catch((error) => { console.error(error.message); process.exit(1); });
