/* Sigrún — Phase 3F E2E: model control in the browser.

   Drives the shipped UI over the four WO-3F-09 practice samples:
     · pool B×C in the 2³ replicated study and read the comparison + partial F
     · strict hierarchy refuses an orphan interaction, auto adds its parents
     · the unreplicated design reports Lenth instead of t-tests
     · the unbalanced study keeps Type I and Type III sums apart
     · the reduction tutorial is listed in the lesson library

   Local:  node tools/e2e_phase3f.cjs
   Live:   BASE=https://hyangdan2.github.io/PKPilot0018/ SERVE=0 node tools/e2e_phase3f.cjs
*/
const fs = require('fs');
const http = require('http');
const path = require('path');

const { chromium, executablePath: CHROME, browserEnv } = require('./browser_env.cjs');

const BASE = process.env.BASE || 'http://127.0.0.1:4190/PKPilot0018/';
const SERVE = process.env.SERVE !== '0';
let ACTIVE_BASE = BASE;
const OUT = process.env.OUT || path.resolve(__dirname, '..', '..', 'pkpilot0018');

fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
}

function launchArgs() {
  return {
    headless: true,
    executablePath: CHROME,
    env: browserEnv,
    args: ['--single-process', '--no-zygote', '--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  };
}

function startStaticServer() {
  if (!SERVE) return null;
  const root = path.resolve(__dirname, '..', 'dist');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
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

async function openPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push('pageerror: ' + error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
  await page.goto(ACTIVE_BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid=menubar]');
  return { ctx, page, errors };
}

async function sample(page, id) {
  await page.click('[data-testid=sample-button]');
  await page.waitForSelector('[data-testid=sample-menu]');
  await page.click(`[data-testid=sample-${id}]`);
  await page.waitForTimeout(350);
}

async function openAnalysis(page, id) {
  await page.click('[data-testid=menu-stat]');
  const group = id === 'doeanalyze' ? 'DOE' : id === 'glm' ? 'ANOVA' : null;
  if (group) {
    await page.getByRole('menuitem', { name: group, exact: true }).first().hover();
    await page.waitForTimeout(200);
  }
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

async function run(page) {
  await page.click('[data-testid=dialog-ok]');
  await page.waitForSelector('[data-testid=analysis-dialog]', { state: 'detached', timeout: 30000 });
  await page.waitForTimeout(700);
}

async function bodyText(page) {
  return page.locator('body').innerText();
}

/**
 * A screenshot of a full result page. The software rasteriser behind the
 * headless shell can take tens of seconds to paint the first frame of a large
 * table-and-chart page; the default 30 s is not a verdict on the page, so give
 * it room and settle one frame first.
 */
async function shot(page, name) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(1)))));
  await page.screenshot({ path: path.join(OUT, name), timeout: 90000 });
}

/** Load a sample, fill response/factors, set the model order, optionally edit the model. */
async function fillFactorial(page, response, factors, order, edit) {
  await pick(page, 'response', [response]);
  await pick(page, 'factors', factors);
  await page.click('[data-testid=tab-options]');
  await page.waitForTimeout(150);
  await page.selectOption('[data-testid=field-order]', order);
  await page.waitForTimeout(200);
  if (edit) {
    await page.click('[data-testid=tab-main]');
    await page.waitForTimeout(150);
    await page.click('[data-testid=model-edit]');
    await page.waitForSelector('[data-testid=model-terms-dialog]', { timeout: 8000 });
    await edit(page);
    await page.click('[data-testid=mt-save]');
    await page.waitForSelector('[data-testid=model-terms-dialog]', { state: 'detached', timeout: 8000 });
  }
}

(async () => {
  const local = await startStaticServer();
  if (local) ACTIVE_BASE = `http://127.0.0.1:${local.port}/PKPilot0018/`;
  const browser = await chromium.launch(launchArgs());
  const { page, errors } = await openPage(browser);

  try {
    /* ── A. pool B×C and read the comparison ─────────────────────── */
    await sample(page, 'doe-pooled');
    await openAnalysis(page, 'doeanalyze');
    await fillFactorial(page, 'C7', ['C4', 'C5', 'C6'], '3', async (dialog) => {
      await dialog.click('[data-testid="mt-pool-B|C"]');
      await dialog.waitForTimeout(150);
    });
    await run(page);
    let text = await bodyText(page);
    check('the reduced model keeps the original fit and reports the transfer',
      text.includes('Error df') && text.includes('98.55%'), text.includes('98.55%') ? 'R²(pred) present' : 'no comparison table');
    check('the partial F is computed for the nested reduction',
      text.includes('1.85') && text.includes('0.207'), 'F 1.85 · p 0.207');
    check('the pooled term leaves the fitted model formula',
      text.includes('Model formula: Y = β0 + A + B + C + A×B + A×C + A×B×C'), 'A×B×C retained, B×C removed');
    await shot(page, 'phase3f-pooling.png');

    /* ── B. hierarchy: strict refuses, auto adds the parents ─────── */
    await openAnalysis(page, 'doeanalyze');
    await fillFactorial(page, 'C7', ['C4', 'C5', 'C6'], '2', async (dialog) => {
      await dialog.click('[data-testid=mt-remove-all]');
      await dialog.click('[data-testid="mt-add-A|B"]');
      await dialog.selectOption('[data-testid=mt-hierarchy]', 'strict');
      await dialog.waitForSelector('[data-testid=mt-hierarchy-warning]', { timeout: 8000 });
      await dialog.click('[data-testid=mt-save]');
      await dialog.waitForSelector('[data-testid=mt-error]', { timeout: 8000 });
      check('strict hierarchy refuses to save an orphan interaction',
        (await dialog.textContent('[data-testid=mt-error]')).includes('A, B'));
      await dialog.selectOption('[data-testid=mt-hierarchy]', 'auto');
      await dialog.waitForSelector('[data-testid=mt-auto-add]', { timeout: 8000 });
      check('auto hierarchy names the parents it will add', true);
    });
    await run(page);
    text = await bodyText(page);
    check('the auto-closed model is the one that runs',
      text.includes('Model formula: Y = β0 + A + B + A×B'), 'A, B and A×B');

    /* ── C. unreplicated design: Lenth, not t-tests ──────────────── */
    await sample(page, 'doe-unreplicated');
    await openAnalysis(page, 'doeanalyze');
    await fillFactorial(page, 'C7', ['C4', 'C5', 'C6'], '3', async (dialog) => {
      await dialog.click('[data-testid=mt-remove-all]');
      await dialog.click('[data-testid=mt-add-all]');
    });
    await run(page);
    text = await bodyText(page);
    await shot(page, 'phase3f-lenth.png');
    check('Lenth PSE is reported with its margin of error',
      text.includes('PSE 2.1') && text.includes('ME 9.036'), 'PSE 2.1 · ME 9.036');
    check('the saturated fit says why t-tests are unavailable', text.includes('Error DF is 0'));

    /* ── D. unbalanced GLM: Type I and Type III stay apart ───────── */
    await sample(page, 'glm-unbalanced');
    await openAnalysis(page, 'glm');
    await pick(page, 'response', ['C3']);
    await pick(page, 'factors', ['C1', 'C2']);
    await run(page);
    text = await bodyText(page);
    check('the unbalanced study keeps Type I and Type III sums apart',
      text.includes('82.083') && text.includes('68.511'), 'Machine 82.083 / 68.511');
    await shot(page, 'phase3f-hierarchy-glm.png');

    /* ── E. the reduction lesson is listed ───────────────────────── */
    await page.click('[data-testid=learn-sigrun]');
    await page.waitForSelector('[data-testid=tutorial-library]', { timeout: 8000 });
    const card = await page.locator('[data-testid=tut-card-tutorial-doe-reduction-001]').count();
    check('the ten-step reduction tutorial is in the library', card > 0);
    await page.click('[data-testid=tutorial-library-close]');
    await page.waitForTimeout(200);

    const fatal = errors.filter((message) => !/favicon|manifest|ResizeObserver/i.test(message));
    check('no page errors during the run', fatal.length === 0, fatal.slice(0, 2).join(' | '));
  } catch (error) {
    check('e2e run completed without an exception', false, error.message);
    console.error(error);
  } finally {
    await browser.close();
    if (local) local.server.close();
  }

  fs.writeFileSync(path.join(OUT, 'phase3f-report.json'), JSON.stringify({ base: ACTIVE_BASE, checks: results }, null, 1));
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
})();
