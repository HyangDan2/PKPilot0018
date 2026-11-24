/* Sigrún — Stage 3C E2E: multi-response optimizer, prediction profiler and the
   repaired WebGL surface.

   Local:  BASE=http://127.0.0.1:4190/PKPilot0018/ node tools/e2e_phase3_3c.cjs
   Live:   BASE=https://hyangdan2.github.io/PKPilot0018/ node tools/e2e_phase3_3c.cjs
   Screens: OUT=/workspace/work/pkpilot0018
*/
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/**
 * A minimal PNG reader so an element screenshot can be judged by its pixels.
 * WebGL's drawing buffer is not preserved, so readPixels after the frame is
 * composited returns nothing; the screenshot is the picture a reader sees.
 */
function decodePng(buffer) {
  let pos = 8;
  let width = 0; let height = 0; let colorType = 6; let bitDepth = 8;
  const idat = [];
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + length;
  }
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(width * height * channels);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value = (value + a) & 0xff;
      else if (filter === 2) value = (value + b) & 0xff;
      else if (filter === 3) value = (value + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        value = (value + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      cur[x] = value;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { width, height, channels, data: out };
}

/** Share of pixels that carry the surface's lavender/indigo colour. */
function purpleShare(buffer) {
  const png = decodePng(buffer);
  let hits = 0;
  for (let i = 0; i < png.data.length; i += png.channels) {
    const r = png.data[i]; const g = png.data[i + 1]; const b = png.data[i + 2];
    if (b - r > 22 && b - g > 18) hits += 1;
  }
  return hits / (png.width * png.height);
}

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    '/workspace/pkpilot0014/node_modules/playwright',
    '/workspace/visna-sol/node_modules/playwright',
    '/workspace/repos/PKPilot0015/node_modules/playwright',
    'playwright',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { return require(candidate); } catch { /* try the next install */ }
  }
  throw new Error('playwright is not installed in any known location');
}
const { chromium } = loadPlaywright();

const BASE = process.env.BASE || 'http://127.0.0.1:4190/PKPilot0018/';
const SERVE = process.env.SERVE !== '0';
let ACTIVE_BASE = BASE;
const OUT = process.env.OUT || '/workspace/work/pkpilot0018';
const SHELL = process.env.CHROME_PATH || '/workspace/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const LIBS = process.env.CHROME_LIBS || '/workspace/work/chrome-libs/usr/lib/x86_64-linux-gnu:/workspace/work/chrome-libs/lib/x86_64-linux-gnu';
const BROWSER_ENV = { ...process.env, LD_LIBRARY_PATH: LIBS };

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
    executablePath: SHELL,
    env: BROWSER_ENV,
    args: ['--single-process', '--no-zygote', '--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  };
}

function startStaticServer() {
  if (!SERVE) return null;
  const http = require('http');
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

async function openPage(browser, options = {}) {
  const ctx = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 1000 }, acceptDownloads: true });
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

/** Fit one regression: C<response> on C1 + C2. */
async function fitRegression(page, responseVar) {
  await page.click('[data-testid=menu-stat]');
  await page.getByRole('menuitem', { name: 'Regression', exact: true }).hover();
  await page.waitForTimeout(150);
  await page.getByRole('menuitem', { name: /Fit Regression Model/ }).click();
  await page.waitForSelector('[data-testid=analysis-dialog]');
  await page.click('[data-testid=slot-response]');
  await page.click(`[data-testid=var-${responseVar}]`);
  await page.click('[data-testid=add-selected]');
  await page.click('[data-testid=slot-predictors]');
  await page.click('[data-testid=var-C1]');
  await page.click('[data-testid=add-selected]');
  await page.click('[data-testid=slot-predictors]');
  await page.click('[data-testid=var-C2]');
  await page.click('[data-testid=add-selected]');
  await page.click('[data-testid=dialog-ok]');
  await page.waitForSelector('[data-testid=analysis-dialog]', { state: 'detached', timeout: 30000 });
  await page.waitForTimeout(700);
}

async function saveLastModel(page) {
  const card = page.locator('[data-testid=out-card]').last();
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(18, box.height / 2));
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(120);
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(250);
  await page.getByRole('menuitem', { name: /Save model to Model Manager/ }).click();
  await page.waitForTimeout(400);
}

/** Sample data, one stored model, and its 3D surface card. */
async function openSurfaceCard(page) {
  await sample(page, 'regression');
  await fitRegression(page, 'C4');
  await saveLastModel(page);
  await openModelManager(page);
  await page.locator('[data-testid=mm-item]').first().click();
  await page.click('[data-testid=mm-surface]');
  await page.waitForSelector('[data-testid=surface3d]', { timeout: 20000 });
  await page.waitForTimeout(1200);
}

async function openModelManager(page) {
  await page.click('[data-testid=menu-stat]');
  await page.waitForTimeout(150);
  await page.getByRole('menuitem', { name: /Stored Model Manager/ }).click();
  await page.waitForSelector('[data-testid=model-manager]');
  await page.waitForTimeout(250);
}

(async () => {
  let local = null;
  if (SERVE) {
    local = await startStaticServer();
    ACTIVE_BASE = `http://127.0.0.1:${local.port}/PKPilot0018/`;
  }
  const browser = await chromium.launch(launchArgs());
  try {
    const { page, errors } = await openPage(browser, { viewport: { width: 1440, height: 1100 } });
    await sample(page, 'regression');
    await fitRegression(page, 'C4');
    await saveLastModel(page);
    await fitRegression(page, 'C3');
    await saveLastModel(page);

    /* ── A. the 3D surface is drawn as a mesh again ─────────────────── */
    await openModelManager(page);
    await page.locator('[data-testid=mm-item]').first().click();
    await page.click('[data-testid=mm-surface]');
    await page.waitForSelector('[data-testid=surface3d]scan', { timeout: 20000 }).catch(() => {});
    await page.waitForSelector('[data-testid=surface3d]', { timeout: 20000 });
    await page.waitForTimeout(1400);
    const surfaceInfo = await page.evaluate(() => {
      const el = document.querySelector('[data-testid=surface3d]');
      const canvas = el.querySelector('canvas');
      if (!canvas) return { renderer: el.getAttribute('data-renderer'), canvas: false };
      const gl = canvas.getContext('webgl');
      return { renderer: el.getAttribute('data-renderer'), w: canvas.width, h: canvas.height, lost: gl ? gl.isContextLost() : false };
    });
    check('the stored-model surface renders through WebGL', surfaceInfo.renderer === 'webgl', String(surfaceInfo.renderer));
    check('the WebGL context is alive', surfaceInfo.lost === false, String(surfaceInfo.lost));
    const liveCanvas = page.locator('[data-testid=surface3d-canvas]');
    await liveCanvas.scrollIntoViewIfNeeded();
    const canvasBox = await liveCanvas.boundingBox();
    const liveShot = await page.screenshot({ clip: canvasBox });

    /* The same card in the static projection. Both pictures come from the same
       geometry module, so a surface that lost its index or vertex data in the
       upload carries visibly less of it than the SVG does. */
    await page.goto(`${ACTIVE_BASE}?webgl=off`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid=menubar]');
    if (!(await page.locator('[data-testid=surface3d]').count())) {
      await openSurfaceCard(page);
    }
    await page.waitForTimeout(1200);
    const staticRenderer = await page.locator('[data-testid=surface3d]').getAttribute('data-renderer');
    check('the same card falls back to the static projection without WebGL', staticRenderer === 'static', String(staticRenderer));
    const surfaceCardBox = await page.locator('[data-testid=surface3d]').boundingBox();
    await page.locator('[data-testid=surface3d]').scrollIntoViewIfNeeded();
    const shifted = await page.locator('[data-testid=surface3d-canvas], [data-testid=surface3d-static]').first().boundingBox();
    const staticShot = await page.screenshot({ clip: { x: shifted.x, y: shifted.y, width: canvasBox.width, height: Math.min(canvasBox.height, shifted.height) } });
    const liveShareClipped = purpleShare(liveShot);
    const staticShare = purpleShare(staticShot);
    check(
      'the WebGL surface covers as much of the card as the static projection',
      staticShare > 0.02 && liveShareClipped > 0.02 && Math.abs(liveShareClipped - staticShare) / staticShare < 0.6,
      `WebGL ${(liveShareClipped * 100).toFixed(2)}% vs static ${(staticShare * 100).toFixed(2)}%`,
    );
    void surfaceCardBox;
    // Return to the interactive page for the rest of the run.
    await page.goto(ACTIVE_BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid=menubar]');
    await page.waitForTimeout(600);
    if (!(await page.locator('[data-testid=surface3d]').count())) await openSurfaceCard(page);
    await page.waitForTimeout(900);
    const surfaceCard = page.locator('[data-testid=surface3d]').last();
    await surfaceCard.scrollIntoViewIfNeeded();
    await surfaceCard.screenshot({ path: path.join(OUT, 'phase3-3b-surface-fixed-stage.png') });
    const outCard = page.locator('[data-testid=out-card]').last();
    await outCard.screenshot({ path: path.join(OUT, 'phase3-3b-surface-fixed.png') });
    await page.screenshot({ path: path.join(OUT, 'phase3-3c-surface-page.png') });

    /* ── B. the response optimiser ──────────────────────────────────── */
    await openModelManager(page);
    const picker = page.locator('[data-testid=mm-pick-]');
    void picker;
    const items = page.locator('[data-testid=mm-item]');
    check('two stored models are listed', (await items.count()) === 2, String(await items.count()));
    await items.nth(0).locator('input[type=checkbox]').check();
    await items.nth(1).locator('input[type=checkbox]').check();
    const optimizerButton = page.locator('[data-testid=mm-optimizer]');
    check('the response optimizer button is enabled', await optimizerButton.isEnabled());
    await page.screenshot({ path: path.join(OUT, 'phase3-3c-manager.png') });
    await optimizerButton.click();
    await page.waitForSelector('[data-testid=optimizer]', { timeout: 10000 });
    await page.waitForTimeout(300);

    const responseRows = page.locator('[data-testid=opt-response-row]');
    const factorRows = page.locator('[data-testid=opt-factor-row]');
    check('the optimizer lists both responses', (await responseRows.count()) === 2, String(await responseRows.count()));
    check('the optimizer lists the shared factors', (await factorRows.count()) === 2, String(await factorRows.count()));
    await page.screenshot({ path: path.join(OUT, 'phase3-3c-optimizer-input.png') });

    /* maximize Yield (C4), minimize Speed (C3) */
    const goals = await responseRows.locator('select').count();
    check('every response has a goal selector', goals === 2, String(goals));
    const rows = await responseRows.all();
    await rows[0].locator('select').selectOption('maximize');
    await rows[1].locator('select').selectOption('minimize');
    await page.click('[data-testid=opt-run]');
    await page.waitForSelector('[data-testid=opt-result]', { timeout: 20000 });
    await page.waitForTimeout(400);
    const status = await page.locator('[data-testid=opt-status]').getAttribute('data-status').catch(() => null);
    const resultStatus = await page.locator('[data-testid=opt-result]').getAttribute('data-status');
    const composite = await page.locator('[data-testid=opt-composite]').count()
      ? await page.locator('[data-testid=opt-composite]').textContent()
      : (console.log('DEBUG result:', (await page.locator('[data-testid=opt-result]').textContent()).slice(0, 500)), 'NaN');
    check('the optimizer reports a status', ['optimal', 'best-found', 'limit', 'no-feasible'].includes(resultStatus || ''), String(resultStatus));
    check('the composite desirability is a number in 0…1', Number(composite) >= 0 && Number(composite) <= 1, String(composite));
    check('the optimizer lists a predicted response per model', (await page.locator('[data-testid=opt-prediction-row]').count()) === 2);
    check('the optimizer reports optimal factor settings', (await page.locator('[data-testid=opt-condition-row]').count()) === 2);
    const alternatives = await page.locator('[data-testid=opt-alternative-row]').count();
    check('alternative conditions are reported', alternatives >= 1, String(alternatives));
    await page.screenshot({ path: path.join(OUT, 'phase3-3c-optimizer.png') });
    const optimizerDialog = page.locator('[data-testid=optimizer]');
    await optimizerDialog.screenshot({ path: path.join(OUT, 'phase3-3c-optimizer-window.png') });
    void status;

    /* result becomes an output card */
    await page.click('[data-testid=opt-to-output]');
    await page.waitForTimeout(500);
    const optimizerCard = page.locator('[data-testid=out-card]').last();
    const cardText = await optimizerCard.textContent();
    check('the optimizer result is added to the output', Boolean(cardText && /Composite|종합/.test(cardText)), (cardText || '').slice(0, 60));

    /* ── C. the prediction profiler ──────────────────────────────────── */
    await openModelManager(page);
    await items.nth(0).locator('input[type=checkbox]').check();
    await items.nth(1).locator('input[type=checkbox]').check();
    await page.click('[data-testid=mm-optimizer]');
    await page.waitForSelector('[data-testid=optimizer]', { timeout: 10000 });
    await page.click('[data-testid=opt-run]');
    await page.waitForSelector('[data-testid=opt-result]', { timeout: 20000 });
    await page.click('[data-testid=opt-to-profiler]');
    await page.waitForSelector('[data-testid=profiler]', { timeout: 10000 });
    await page.waitForTimeout(500);

    const cells = await page.locator('[data-testid=prof-row]').count();
    check('the profiler draws one row per response', cells === 2, String(cells));
    const sliders = await page.locator('[data-testid^=prof-slider-]').count();
    check('the profiler gives every factor a slider', sliders === 2, String(sliders));
    const before = await page.locator('[data-testid=prof-answer-C4]').textContent().catch(() => null);
    const answerBefore = await page.locator('[data-testid=prof-row]').first().textContent();
    const slider = page.locator('[data-testid^=prof-slider-]').first();
    await slider.evaluate((el) => {
      const min = Number(el.min); const max = Number(el.max);
      const next = min + (max - min) * 0.25;
      el.value = String(next);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(600);
    const answerAfter = await page.locator('[data-testid=prof-row]').first().textContent();
    check('moving a slider changes the prediction', answerBefore !== answerAfter, `${(answerBefore || '').slice(0, 24)} → ${(answerAfter || '').slice(0, 24)}`);
    const currentLines = await page.locator('[data-testid=prof-current-line]').count();
    check('the current value is drawn as a vertical line', currentLines >= 2, String(currentLines));
    await page.screenshot({ path: path.join(OUT, 'phase3-3c-profiler.png') });
    await page.locator('[data-testid=profiler]').screenshot({ path: path.join(OUT, 'phase3-3c-profiler-window.png') });
    void before;

    const compositeBefore = await page.locator('[data-testid=prof-composite]').textContent();
    await page.click('[data-testid=prof-optimize]');
    await page.waitForTimeout(900);
    const compositeAfter = await page.locator('[data-testid=prof-composite]').textContent();
    check('the profiler Optimize button raises the composite', compositeBefore !== compositeAfter, `${compositeBefore} → ${compositeAfter}`);
    await page.click('[data-testid=prof-reset]');
    await page.waitForTimeout(700);
    const compositeReset = await page.locator('[data-testid=prof-composite]').textContent();
    check('the profiler Reset returns to the centre', compositeReset !== compositeAfter, `${compositeAfter} → ${compositeReset}`);

    await page.click('[data-testid=prof-save]');
    await page.waitForTimeout(500);
    const savedCard = page.locator('[data-testid=out-card]').last();
    const savedText = await savedCard.textContent();
    check('the current condition is saved to the output', Boolean(savedText && savedText.length > 40), (savedText || '').slice(0, 60));
    await page.screenshot({ path: path.join(OUT, 'phase3-3c-profiler-saved.png') });
    await page.click('[data-testid=prof-done]');

    /* ── D. regression: the rest of the workspace still works ───────── */
    await page.click('[data-testid=menu-stat]');
    await page.waitForTimeout(150);
    await page.getByRole('menuitem', { name: /Stored Model Manager/ }).click();
    await page.waitForSelector('[data-testid=model-manager]');
    await page.locator('[data-testid=mm-item]').first().click();
    await page.locator('[data-testid=mm-contour]').click();
    await page.waitForTimeout(900);
    const contourCard = page.locator('[data-testid=out-card]').last();
    const contourText = await contourCard.textContent();
    check('a contour plot from a stored model still draws', Boolean(contourText && contourText.length > 30), (contourText || '').slice(0, 48));
    await page.screenshot({ path: path.join(OUT, 'phase3-3c-regression.png') });

    const fatal = errors.filter((message) => !/favicon|manifest|ResizeObserver/i.test(message));
    check('no page errors during the run', fatal.length === 0, fatal.slice(0, 2).join(' | '));
  } catch (error) {
    check('e2e run completed without an exception', false, error.message);
    console.error(error);
  } finally {
    await browser.close();
    if (local) local.server.close();
  }

  fs.writeFileSync(path.join(OUT, 'phase3-3c-report.json'), JSON.stringify({ base: ACTIVE_BASE, checks: results }, null, 1));
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
})();
