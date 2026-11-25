/* Sigrún — Phase 3F QA screenshots (WO-3F-02 … WO-3F-07).

   Drives the shipped build and saves the screens this phase is judged by:
   the Model Terms Editor, the pooling/comparison card, the DOE effect charts,
   the saturated result with Lenth, and the Model Manager — on a desktop and a
   390 px mobile viewport.

     npm run build
     node tools/e2e_phase3f_shots.cjs

   Output: artifacts/phase3f-qa-shots/*.png (OUT overrides the folder).
*/
const fs = require('fs');
const http = require('http');
const path = require('path');

const { chromium, executablePath: CHROME, browserEnv } = require('./browser_env.cjs');

const OUT = process.env.OUT || path.resolve(__dirname, '..', 'artifacts', 'phase3f-qa-shots');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

fs.mkdirSync(OUT, { recursive: true });

function startStaticServer() {
  const root = path.resolve(__dirname, '..', 'dist');
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (!urlPath.startsWith('/PKPilot0018/')) { res.writeHead(404); res.end('not found'); return; }
    let rel = urlPath.slice('/PKPilot0018/'.length);
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function shot(page, name) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(1)))));
  await page.screenshot({ path: path.join(OUT, `${name}.png`), timeout: 90000 });
  console.log('saved', path.join(OUT, `${name}.png`));
}

/** A whole block, even when the output pane is scrolled or the table is long. */
async function blockShot(locator, name) {
  await locator.scrollIntoViewIfNeeded();
  await locator.screenshot({ path: path.join(OUT, `${name}.png`), timeout: 90000 });
  console.log('saved', path.join(OUT, `${name}.png`));
}

function tableBlock(page, title) {
  return page.locator('.out-block-title', { hasText: title }).first().locator('..');
}

function chartBlock(page, title) {
  return page.locator('.chart-card', { hasText: title }).first();
}

async function sample(page, id) {
  await page.click('[data-testid=sample-button]');
  await page.waitForSelector('[data-testid=sample-menu]');
  await page.click(`[data-testid=sample-${id}]`);
  await page.waitForTimeout(400);
}

async function openAnalysis(page, id) {
  await page.click('[data-testid=menu-stat]');
  await page.getByRole('menuitem', { name: 'DOE', exact: true }).first().hover();
  await page.waitForTimeout(200);
  await page.click(`[data-testid=menu-item-${id}]`);
  await page.waitForSelector('[data-testid=analysis-dialog]', { timeout: 8000 });
}

async function pick(page, slot, vars) {
  await page.click(`[data-testid=slot-${slot}]`);
  for (const variable of vars) {
    await page.click(`[data-testid=var-${variable}]`);
    await page.click('[data-testid=add-selected]');
  }
}

async function factorial(page, order) {
  await sample(page, 'doe-pooled');
  await openAnalysis(page, 'doeanalyze');
  await pick(page, 'response', ['C7']);
  await pick(page, 'factors', ['C4', 'C5', 'C6']);
  await page.click('[data-testid=tab-options]');
  await page.waitForTimeout(150);
  await page.selectOption('[data-testid=field-order]', String(order));
  await page.waitForTimeout(200);
  await page.click('[data-testid=tab-main]');
  await page.waitForTimeout(150);
}

async function run(page) {
  await page.click('[data-testid=dialog-ok]');
  await page.waitForSelector('[data-testid=analysis-dialog]', { state: 'detached', timeout: 30000 });
  await page.waitForTimeout(900);
}

async function scrollToText(page, text) {
  const node = page.getByText(text, { exact: false }).last();
  await node.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
}

async function desktop(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid=menubar]');

  // 1 · Model Terms Editor (WO-3F-02/03/04)
  await factorial(page, 3);
  await page.click('[data-testid=model-edit]');
  await page.waitForSelector('[data-testid=model-terms-dialog]', { timeout: 8000 });
  await page.waitForTimeout(400);
  await shot(page, 'desktop-01-model-terms');
  await page.click('[data-testid="mt-pool-B|C"]');
  await page.waitForTimeout(250);
  await shot(page, 'desktop-02-model-terms-pooled');
  await page.click('[data-testid=mt-save]');
  await page.waitForSelector('[data-testid=model-terms-dialog]', { state: 'detached', timeout: 8000 });

  // 2 · Pooling, comparison and partial F (WO-3F-03/05)
  await run(page);
  await blockShot(tableBlock(page, 'Error pooling (terms moved to error)'), 'desktop-03a-error-pooling');
  await blockShot(tableBlock(page, 'Original vs reduced model'), 'desktop-03-pooling-comparison');
  await blockShot(tableBlock(page, 'Partial F-test'), 'desktop-04-partial-f');

  // 3 · DOE effect charts (WO-3F-07)
  await blockShot(chartBlock(page, 'Pareto chart of standardized effects'), 'desktop-05-effect-pareto');
  await blockShot(chartBlock(page, 'Normal plot of effects'), 'desktop-06-effect-normal');
  await blockShot(chartBlock(page, 'Pareto chart before pooling'), 'desktop-06b-before-pooling');

  // 4 · Model Manager (WO-3F-08)
  await page.locator('[data-testid=out-card]').first().locator('[data-testid=card-save-model]').click();
  await page.waitForTimeout(600);
  await page.click('[data-testid=menu-stat]');
  await page.click('[data-testid=menu-item-modelManager]');
  await page.waitForSelector('[data-testid=model-manager]', { timeout: 8000 });
  await page.waitForTimeout(500);
  await shot(page, 'desktop-07-model-manager');
  await page.click('[data-testid=mm-close]');

  // 5 · Saturated design and Lenth (WO-3F-06)
  await sample(page, 'doe-unreplicated');
  await openAnalysis(page, 'doeanalyze');
  await pick(page, 'response', ['C7']);
  await pick(page, 'factors', ['C4', 'C5', 'C6']);
  await page.click('[data-testid=tab-options]');
  await page.waitForTimeout(150);
  await page.selectOption('[data-testid=field-order]', '3');
  await page.waitForTimeout(200);
  await page.click('[data-testid=tab-main]');
  await page.waitForTimeout(150);
  await page.click('[data-testid=model-edit]');
  await page.waitForSelector('[data-testid=model-terms-dialog]', { timeout: 8000 });
  await page.click('[data-testid=mt-remove-all]');
  await page.click('[data-testid=mt-add-all]');
  await page.click('[data-testid=mt-save]');
  await page.waitForSelector('[data-testid=model-terms-dialog]', { state: 'detached', timeout: 8000 });
  await run(page);
  await blockShot(tableBlock(page, 'Lenth'), 'desktop-08-saturated-lenth');

  await ctx.close();
  return errors;
}

async function mobile(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid=menubar]');
  await factorial(page, 3);
  await page.click('[data-testid=model-edit]');
  await page.waitForSelector('[data-testid=model-terms-dialog]', { timeout: 8000 });
  await page.waitForTimeout(400);
  await shot(page, 'mobile-01-model-terms');
  await page.click('[data-testid="mt-pool-B|C"]');
  await page.waitForTimeout(250);
  await shot(page, 'mobile-02-model-terms-pooled');
  await page.click('[data-testid=mt-save]');
  await page.waitForSelector('[data-testid=model-terms-dialog]', { state: 'detached', timeout: 8000 });
  await run(page);
  await blockShot(tableBlock(page, 'Original vs reduced model'), 'mobile-03-pooling-comparison');
  await blockShot(chartBlock(page, 'Pareto chart of standardized effects'), 'mobile-04-effect-pareto');
  await ctx.close();
  return errors;
}

(async () => {
  const server = await startStaticServer();
  const base = `http://127.0.0.1:${server.address().port}/PKPilot0018/`;
  const launch = () => chromium.launch({
    headless: true,
    executablePath: CHROME,
    env: browserEnv,
    args: ['--single-process', '--no-zygote', '--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  let failed = false;
  let errors = [];
  // The single-process sandbox browser dies when a second context opens after
  // one is closed, so each viewport gets its own process.
  for (const run of [desktop, mobile]) {
    const browser = await launch();
    try {
      errors = [...errors, ...(await run(browser, base))];
    } catch (error) {
      console.error(error);
      failed = true;
    } finally {
      await browser.close();
    }
  }
  console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
  if (errors.length) failed = true;
  server.close();
  if (failed) process.exitCode = 1;
})();
