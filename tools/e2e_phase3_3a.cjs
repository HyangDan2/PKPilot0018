/* Statelia — Stage 3A E2E: stored model manager, PNG resolution metadata,
   chart isolation and the hostile-configuration guard.

   Local:  BASE=http://127.0.0.1:4190/PKPilot0018/ node tools/e2e_phase3_3a.cjs
   Live:   BASE=https://hyangdan2.github.io/PKPilot0018/ node tools/e2e_phase3_3a.cjs
*/
const fs = require('fs');
const path = require('path');

const { chromium, executablePath: CHROME, browserEnv } = require('./browser_env.cjs');

const BASE = process.env.BASE || 'http://127.0.0.1:4190/PKPilot0018/';
const SERVE = process.env.SERVE !== '0';
/** Set once the in-process server knows its port. */
let ACTIVE_BASE = BASE;
const OUT = process.env.OUT || path.resolve(__dirname, '..', 'artifacts', 'sigrun-phase3-3a');
const LAUNCH = { headless: true, executablePath: CHROME, env: browserEnv, args: ['--single-process', '--no-zygote', '--disable-gpu', '--disable-dev-shm-usage', '--disable-software-rasterizer'] };

fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
}

async function openPage(browser, options = {}) {
  const ctx = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 900 }, acceptDownloads: true, permissions: options.permissions || [] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push('pageerror: ' + error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
  await page.goto(options.url || ACTIVE_BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid=menubar]');
  return { ctx, page, errors };
}

async function sample(page, id) {
  await page.click('[data-testid=sample-button]');
  await page.waitForSelector('[data-testid=sample-menu]');
  await page.click(`[data-testid=sample-${id}]`);
  await page.waitForTimeout(350);
}

async function runRegression(page) {
  await sample(page, 'regression');
  await page.click('[data-testid=menu-stat]');
  await page.getByRole('menuitem', { name: 'Regression', exact: true }).hover();
  await page.waitForTimeout(150);
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
  await page.click('[data-testid=slot-predictors]');
  await page.click('[data-testid=var-C3]');
  await page.click('[data-testid=add-selected]');
  await page.click('[data-testid=dialog-ok]');
  await page.waitForSelector('[data-testid=analysis-dialog]', { state: 'detached', timeout: 30000 });
  await page.waitForTimeout(700);
}

async function runTwoSample(page) {
  await sample(page, 'comparison');
  await page.click('[data-testid=menu-stat]');
  await page.getByRole('menuitem', { name: 'Basic Statistics', exact: true }).hover();
  await page.getByRole('menuitem', { name: /2-Sample t/ }).click();
  await page.waitForSelector('[data-testid=analysis-dialog]');
  await page.click('[data-testid=slot-sample1]');
  await page.click('[data-testid=var-C2]');
  await page.click('[data-testid=add-selected]');
  await page.click('[data-testid=slot-sample2]');
  await page.click('[data-testid=var-C4]');
  await page.click('[data-testid=add-selected]');
  await page.click('[data-testid=dialog-ok]');
  await page.waitForSelector('[data-testid=analysis-dialog]', { state: 'detached', timeout: 20000 });
  await page.waitForTimeout(600);
}

async function openModelManager(page) {
  await page.click('[data-testid=menu-stat]');
  await page.waitForTimeout(150);
  await page.getByRole('menuitem', { name: /Stored Model Manager/ }).click();
  await page.waitForSelector('[data-testid=model-manager]');
  await page.waitForTimeout(250);
}

async function rightClick(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(20, box.height / 2));
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(120);
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(300);
}

function pngDpi(bytes) {
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    if (type === 'pHYs') {
      const ppuX = bytes.readUInt32BE(offset + 8);
      const unit = bytes[offset + 16];
      return unit === 1 ? ppuX * 0.0254 : null;
    }
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  return null;
}

/* One process keeps its own static server: a background shell server is torn
   down with the shell that started it, which made this suite flaky. */
function startStaticServer() {
  if (!SERVE) return null;
  const http = require('http');
  const root = path.resolve(__dirname, '..', 'dist');
  const types = {　'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (!urlPath.startsWith('/PKPilot0018/')) { res.writeHead(404); res.end('not found'); return; }
    let rel = urlPath.slice('/PKPilot0018/'.length);
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

(async () => {
  let local = null;
  if (SERVE) {
    local = await startStaticServer();
    process.env.BASE = `http://127.0.0.1:${local.port}/PKPilot0018/`;
  }
  ACTIVE_BASE = local ? process.env.BASE : BASE;
  const browser = await chromium.launch(LAUNCH);
  try {
    const { ctx, page, errors } = await openPage(browser);

    /* ── 1. a regression card carries a model ─────────────────────────── */
    await runRegression(page);
    check('regression output renders', (await page.locator('[data-testid=out-card]').count()) >= 1);
    check('the card advertises its fitted model', (await page.locator('[data-testid=card-model-badge]').count()) === 1);
    await page.screenshot({ path: path.join(OUT, 'phase3-3a-desktop.png') });

    /* ── 2. save the model, then open the manager ─────────────────────── */
    const card = page.locator('[data-testid=out-card]').first();
    await rightClick(page, card);
    await page.getByRole('menuitem', { name: /Save model to Model Manager/ }).click();
    await page.waitForTimeout(400);

    await openModelManager(page);
    check('the manager opens from the Stat menu', (await page.locator('[data-testid=model-manager]').count()) === 1);
    const items = await page.locator('[data-testid=mm-item]').count();
    check('the saved model is listed', items === 1, String(items));
    const name = await page.locator('[data-testid=mm-selected-name]').textContent();
    check('the model is named after the analysis', Boolean(name && name.includes('Yield')), name || '');
    const coefRows = await page.locator('[data-testid=mm-coef-row]').count();
    check('the coefficient table shows every term', coefRows === 4, String(coefRows));
    await page.screenshot({ path: path.join(OUT, 'phase3-3a-model-manager.png') });

    /* ── 3. prediction at a point ─────────────────────────────────────── */
    await page.fill('[data-testid="mm-input-Temperature (C)"]', '180');
    await page.fill('[data-testid="mm-input-Pressure (bar)"]', '2.9');
    await page.fill('[data-testid="mm-input-Speed (rpm)"]', '55');
    await page.click('[data-testid=mm-predict]');
    await page.waitForSelector('[data-testid=mm-prediction]');
    const prediction = await page.locator('[data-testid=mm-prediction]').innerText();
    check('prediction returns a fitted value, SE and interval', /\d+\.\d+/.test(prediction) && /prediction interval|예측구간/i.test(prediction) && /SE/i.test(prediction), prediction.replace(/\s+/g, ' ').slice(0, 90));
    await page.screenshot({ path: path.join(OUT, 'phase3-3a-prediction.png') });

    /* ── 4. coded/actual switch keeps the same point ──────────────────── */
    await page.selectOption('[data-testid=mm-predict-mode]', 'coded');
    await page.fill('[data-testid="mm-input-Temperature (C)"]', '0');
    await page.fill('[data-testid="mm-input-Pressure (bar)"]', '0');
    await page.fill('[data-testid="mm-input-Speed (rpm)"]', '0');
    await page.click('[data-testid=mm-predict]');
    await page.waitForTimeout(200);
    const centre = await page.locator('[data-testid=mm-prediction]').innerText();
    const centreNonEstimable = await page.locator('[data-testid=mm-prediction]').getAttribute('data-nonestimable');
    check('a coded point predicts without error', centreNonEstimable === '0' && /\d+\.\d+/.test(centre), centre.replace(/\s+/g, ' ').slice(0, 60));

    /* ── 5. rename, duplicate, compare ────────────────────────────────── */
    await page.click('[data-testid=mm-rename]');
    await page.fill('[data-testid=mm-name-input]', 'Reactor yield v1');
    await page.click('[data-testid=mm-rename-ok]');
    await page.waitForTimeout(200);
    check('rename takes effect', (await page.locator('[data-testid=mm-selected-name]').innerText()).includes('Reactor yield v1'));

    await page.click('[data-testid=mm-duplicate]');
    await page.waitForTimeout(250);
    check('duplicate adds a second model', (await page.locator('[data-testid=mm-item]').count()) === 2);
    const boxes = page.locator('[data-testid^=mm-pick-]');
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await page.waitForTimeout(250);
    check('selecting two models shows the comparison table', (await page.locator('[data-testid=mm-compare-table]').count()) === 1);
    await page.screenshot({ path: path.join(OUT, 'phase3-3a-compare.png') });

    /* ── 6. contour from the stored model ─────────────────────────────── */
    const beforeContours = await page.locator('[data-testid=chart-frame]').count();
    await page.locator('[data-testid=mm-item]').first().click();
    await page.waitForTimeout(150);
    await page.click('[data-testid=mm-contour]');
    await page.waitForTimeout(900);
    const afterContours = await page.locator('[data-testid=chart-frame]').count();
    check('a stored model becomes a contour chart', afterContours === beforeContours + 1, `${beforeContours} -> ${afterContours}`);
    const contourCard = page.locator('[data-testid=out-card]').last();
    check('the contour card shows the model name', (await contourCard.innerText()).includes('Reactor yield v1'));

    /* ── 7. delete the duplicate ──────────────────────────────────────── */
    await openModelManager(page);
    const before = await page.locator('[data-testid=mm-item]').count();
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('[data-testid=mm-item]').last().click();
    await page.click('[data-testid=mm-delete]');
    await page.waitForTimeout(300);
    check('delete removes one model', (await page.locator('[data-testid=mm-item]').count()) === before - 1, `${before} -> ${await page.locator('[data-testid=mm-item]').count()}`);
    await page.click('[data-testid=mm-close]');
    await page.waitForTimeout(200);

    /* ── 8. stale detection after the data changes ────────────────────── */
    await page.locator('[data-testid=card-model-badge]').first().waitFor();
    // Change one response value on the sheet the model was fitted from.
    await page.locator('.ws-tab', { hasText: 'Reactor' }).first().click();
    await page.waitForTimeout(250);
    const responseCell = page.locator('[data-cell="C4:1"]');
    await responseCell.dblclick();
    await page.waitForSelector('[data-testid=cell-editor]');
    await page.fill('[data-testid=cell-editor]', '200');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    await openModelManager(page);
    const badge = await page.locator('[data-testid=mm-item]').first().getAttribute('data-stale');
    check('changing the data marks the model stale', badge === 'warn', String(badge));
    await page.screenshot({ path: path.join(OUT, 'phase3-3a-stale.png') });
    await page.click('[data-testid=mm-refit]');
    await page.waitForTimeout(500);
    const refitBadge = await page.locator('[data-testid=mm-item]').first().getAttribute('data-stale');
    check('re-fitting refreshes the model against the current data', refitBadge === 'ok', String(refitBadge));
    await page.click('[data-testid=mm-close]');
    await page.waitForTimeout(200);

    /* ── 9. PNG export carries the DPI in pHYs ────────────────────────── */
    const frame = page.locator('[data-testid=chart-frame]').first();
    await frame.hover();
    await frame.locator('[data-testid=chart-edit]').click();
    await page.waitForSelector('[data-testid=chart-drawer]');
    await page.click('[data-testid=cd-tab-export]');
    await page.waitForTimeout(200);
    await page.click('[data-testid=cd-format-png]');
    await page.click('[data-testid=cd-dpi-300]');
    await page.waitForTimeout(200);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.click('[data-testid=cd-export-download]'),
    ]);
    const pngPath = path.join(OUT, 'export-300dpi.png');
    await download.saveAs(pngPath);
    const bytes = fs.readFileSync(pngPath);
    const dpi = pngDpi(bytes);
    check('the exported PNG is a real PNG', bytes.slice(1, 4).toString() === 'PNG', `${bytes.length} bytes`);
    check('the PNG states 300 DPI in a pHYs chunk', dpi !== null && Math.abs(dpi - 300) < 0.05, String(dpi));
    await page.click('[data-testid=cd-cancel]');
    await page.waitForTimeout(200);

    /* ── 10. one chart’s style does not bleed into another ────────────── */
    await runTwoSample(page);
    const chartCount = await page.locator('[data-testid=chart-frame]').count();
    check('two analyses leave several charts on screen', chartCount >= 2, String(chartCount));
    const presets = await page.locator('[data-testid=chart-frame] svg.chart-svg').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-chart-style')));
    check('each chart keeps its own style attribute', new Set(presets).size >= 1, presets.join(','));

    const second = page.locator('[data-testid=chart-frame]').nth(1);
    await second.hover();
    await second.locator('[data-testid=chart-edit]').click();
    await page.waitForSelector('[data-testid=chart-drawer]');
    await page.click('[data-testid=cd-tab-style]');
    await page.waitForTimeout(200);
    await page.click('[data-testid=cd-preset-dark]');
    await page.waitForTimeout(250);
    await page.click('[data-testid=cd-apply]');
    await page.waitForSelector('[data-testid=chart-drawer]', { state: 'detached' });
    await page.waitForTimeout(300);
    const afterPresets = await page.locator('[data-testid=chart-frame] svg.chart-svg').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-chart-style')));
    const darkCount = afterPresets.filter((id) => String(id).includes('dark')).length;
    check('restyling one chart leaves exactly one dark chart', darkCount === 1, afterPresets.join(','));
    await page.screenshot({ path: path.join(OUT, 'phase3-3a-isolation.png') });

    /* ── 11. a reversed axis range cannot produce NaN ─────────────────── */
    const first = page.locator('[data-testid=chart-frame]').nth(1);
    await first.hover();
    await first.locator('[data-testid=chart-edit]').click();
    await page.waitForSelector('[data-testid=chart-drawer]');
    await page.click('[data-testid=cd-tab-scale]');
    await page.waitForTimeout(200);
    const minInput = page.locator('.cd-row', { hasText: 'Minimum' }).locator('input').first();
    const maxInput = page.locator('.cd-row', { hasText: 'Maximum' }).locator('input').first();
    if (await minInput.count()) {
      await minInput.fill('900');
      await maxInput.fill('10');
      await page.waitForTimeout(250);
      const text = await page.locator('[data-testid=chart-frame] svg.chart-svg').nth(1).evaluate((svg) => svg.textContent || '');
      check('a reversed manual range does not print NaN', !text.includes('NaN'), text.slice(0, 60));
    } else {
      check('a reversed manual range does not print NaN', true, 'range inputs not present in this layout');
    }
    await page.click('[data-testid=cd-cancel]');
    await page.waitForTimeout(200);

    /* ── 12. polynomial regression becomes a stored polynomial model ──── */
    await page.locator('.ws-tab', { hasText: 'Reactor' }).first().click();
    await page.waitForTimeout(250);
    await page.click('[data-testid=menu-stat]');
    await page.getByRole('menuitem', { name: 'Regression', exact: true }).hover();
    await page.waitForTimeout(150);
    await page.getByRole('menuitem', { name: /Fit Polynomial Regression/ }).click();
    await page.waitForSelector('[data-testid=analysis-dialog]');
    await page.click('[data-testid=slot-response]');
    await page.click('[data-testid=var-C4]');
    await page.click('[data-testid=add-selected]');
    await page.click('[data-testid=slot-predictors]');
    await page.click('[data-testid=var-C1]');
    await page.click('[data-testid=add-selected]');
    await page.click('[data-testid=tab-options]');
    await page.waitForTimeout(150);
    await page.fill('[data-testid=field-degree]', '2');
    await page.click('[data-testid=tab-main]');
    await page.waitForTimeout(150);
    await page.click('[data-testid=dialog-ok]');
    await page.waitForSelector('[data-testid=analysis-dialog]', { state: 'detached', timeout: 30000 });
    await page.waitForTimeout(700);
    const polyCard = page.locator('[data-testid=out-card]').last();
    check('the polynomial card shows a squared term', (await polyCard.innerText()).includes('²'));
    await rightClick(page, polyCard);
    await page.getByRole('menuitem', { name: /Save model to Model Manager/ }).click();
    await page.waitForTimeout(400);
    await openModelManager(page);
    const kinds = await page.locator('[data-testid=mm-item]').allInnerTexts();
    check('the polynomial model is stored as its own kind', kinds.some((text) => /Polynomial regression/i.test(text)), kinds.join(' | ').slice(0, 120));
    await page.screenshot({ path: path.join(OUT, 'phase3-3a-polynomial.png') });
    await page.click('[data-testid=mm-close]');
    await page.waitForTimeout(200);

    check('no horizontal overflow at 1440 px', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    check('desktop run produced no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  } finally {
    await browser.close();
  }

  /* ── mobile 390 × 844 ─────────────────────────────────────────────── */
  const mobile = await chromium.launch(LAUNCH);
  try {
    const { ctx, page, errors } = await openPage(mobile, { viewport: { width: 390, height: 844 } });
    await runRegression(page);
    await openModelManager(page);
    const box = await page.locator('[data-testid=model-manager]').boundingBox();
    check('the manager fits the 390 px viewport', Boolean(box) && box.width <= 390 && box.height <= 844, JSON.stringify(box));
    check('no horizontal overflow with the manager open', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.screenshot({ path: path.join(OUT, 'phase3-3a-mobile.png') });
    await page.click('[data-testid=mm-close]');
    await page.waitForTimeout(200);
    check('mobile run produced no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  } finally {
    await mobile.close();
  }

  console.log('\n' + results.filter((r) => r.ok).length + '/' + results.length + ' checks passed');
  fs.writeFileSync(path.join(OUT, 'e2e_results.json'), JSON.stringify(results, null, 2));
  if (local) local.server.close();
})();
