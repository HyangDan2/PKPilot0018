/* Sigrún follow-up QA — live browser E2E for the chart rules and sheet
   transforms (QA-U-01…09) against the built app served by `vite preview`. */
const { chromium } = (() => {
  for (const candidate of [
    process.env.PLAYWRIGHT_PATH,
    '/workspace/repos/PKPilot0015/node_modules/playwright',
    '/workspace/repos/PKPilot0011/node_modules/playwright',
    '/workspace/tmp-pwlibs/root/usr/lib/node_modules/playwright',
    'playwright',
  ].filter(Boolean)) {
    try { return require(candidate); } catch { /* next install */ }
  }
  throw new Error('playwright is not installed in any known location');
})();

const STEP = (m) => console.log('[step]', m);
const BASE = process.env.BASE || 'http://localhost:4178/PKPilot0018/';
const OUT = '/workspace/downloads';

async function openMenu(page, testid) {
  await page.click(`[data-testid=${testid}]`);
  await page.waitForSelector('[role=menu]', { timeout: 5000 });
}

async function clickMenuItem(page, label) {
  const item = page.locator('[role=menuitem]', { hasText: label }).last();
  await item.click();
}

async function showTab(page, tab) {
  const el = page.locator(`[data-testid=tab-${tab}]`);
  if (await el.count()) { await el.click(); await page.waitForTimeout(250); }
}

async function fillField(page, testid, value) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const field = page.locator(`[data-testid=${testid}]`);
    if (await field.count()) {
      await field.fill(value);
      return;
    }
    await showTab(page, 'options');
    await page.waitForTimeout(300);
  }
  throw new Error(`field ${testid} not found; dialog: ${await page.locator('[data-testid=analysis-dialog]').count()}`);
}

async function pickColumn(page, slotTestid, colTestid) {
  await showTab(page, 'main');
  await page.click(`[data-testid=${slotTestid}]`);
  await page.click(`[data-testid=${colTestid}]`);
  await page.click('[data-testid=add-selected]');
}

async function runAnalysis(page, menuTestid, itemLabel, setup) {
  await openMenu(page, menuTestid);
  await page.waitForTimeout(300);
  await clickMenuItem(page, itemLabel);
  await page.waitForSelector('[data-testid=analysis-dialog]', { timeout: 5000 });
  if (setup) await setup(page);
  await page.click('[data-testid=dialog-ok]');
  await page.waitForSelector('[data-testid=analysis-dialog]', { state: 'detached', timeout: 8000 });
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/workspace/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid=menubar]');

  await openMenu(page, 'menu-file');
  await page.locator('[role=menuitem]', { hasText: 'Sample data' }).last().hover();
  await page.waitForTimeout(400);
  await page.locator('[role=menuitem]', { hasText: 'Coating Process' }).last().click();
  await page.waitForTimeout(500);
  const gridText = await page.locator('body').innerText();
  if (!/Coating Process/.test(gridText)) throw new Error('sample dataset not loaded');

  STEP('pareto open');
  // Pareto (QA-U-01)
  await openMenu(page, 'menu-stat');
  await page.locator('[role=menuitem]', { hasText: 'Quality Tools' }).last().hover();
  await page.waitForTimeout(300);
  await clickMenuItem(page, 'Pareto Chart');
  await page.waitForSelector('[data-testid=analysis-dialog]');
  await pickColumn(page, 'slot-category', 'var-C4');
  await page.click('[data-testid=dialog-ok]');
  await page.waitForSelector('[data-testid=analysis-dialog]', { state: 'detached' });
  await page.waitForTimeout(400);
  let out = await page.locator('body').innerText();
  if (!/Scratch/.test(out)) throw new Error('pareto output missing');
  const svgTotal = await page.locator('svg').count();

  STEP('histogram');
  // Histogram (QA-U-02)
  await runAnalysis(page, 'menu-graph', 'Histogram', async (p) => {
    await pickColumn(p, 'slot-variable', 'var-C1');
  });
  await page.waitForTimeout(400);

  STEP('boxplot');
  // Boxplot (QA-U-03)
  await runAnalysis(page, 'menu-graph', 'Boxplot', async (p) => {
    await pickColumn(p, 'slot-variables', 'var-C1');
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/sigrun_followup_charts.png`, fullPage: false });

  STEP('load reactor');
  // Reactor Window sample for scatter / timeseries / transforms
  await openMenu(page, 'menu-file');
  await page.locator('[role=menuitem]', { hasText: 'Sample data' }).last().hover();
  await page.waitForTimeout(400);
  await page.locator('[role=menuitem]', { hasText: 'Reactor Window' }).last().click();
  await page.waitForTimeout(500);

  STEP('scatter');
  // Scatterplot (QA-U-04)
  await runAnalysis(page, 'menu-graph', 'Scatterplot', async (p) => {
    await pickColumn(p, 'slot-y', 'var-C4');
    await pickColumn(p, 'slot-x', 'var-C1');
  });
  await page.waitForTimeout(300);
  out = await page.locator('body').innerText();
  if (!/R²/.test(out)) throw new Error('scatter output missing R2');

  STEP('timeseries');
  // Time series plot (QA-U-05) with spec limits
  await runAnalysis(page, 'menu-graph', 'Time series', async (p) => {
    await pickColumn(p, 'slot-variable', 'var-C4');
    await fillField(p, 'field-lsl', '55');
    await fillField(p, 'field-usl', '75');
    await fillField(p, 'field-target', '65');
  });
  await page.waitForTimeout(300);

  STEP('sort');
  // Sort (QA-U-06)
  await runAnalysis(page, 'menu-data', 'Sort', async (p) => {
    await pickColumn(p, 'slot-column', 'var-C1');
  });

  STEP('standardize');
  // Standardize (QA-U-07)
  await runAnalysis(page, 'menu-data', 'Standardize', async (p) => {
    await pickColumn(p, 'slot-column', 'var-C4');
  });

  STEP('recode');
  // Recode (QA-U-08)
  await runAnalysis(page, 'menu-data', 'Recode', async (p) => {
    await pickColumn(p, 'slot-column', 'var-C1');
    await fillField(p, 'field-mapping', '160=1, 180=2');
  });

  STEP('random');
  // Random data (QA-U-09), seeded
  await runAnalysis(page, 'menu-calc', 'Random', async (p) => {
    await fillField(p, 'field-count', '500');
    await fillField(p, 'field-seed', '20261121');
    await fillField(p, 'field-mean', '10');
    await fillField(p, 'field-sd', '2');
  });

  await page.waitForTimeout(600);
  out = await page.locator('body').innerText();
  for (const needle of ['Standardize', 'Recode', 'Random']) {
    if (!new RegExp(needle, 'i').test(out)) throw new Error(`transform output missing: ${needle}`);
  }
  await page.screenshot({ path: `${OUT}/sigrun_followup_transforms.png`, fullPage: false });

  console.log(JSON.stringify({ ok: true, svgTotal, consoleErrors: errors }, null, 1));
  await browser.close();
})().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1); });
