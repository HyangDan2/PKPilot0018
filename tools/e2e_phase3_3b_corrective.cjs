/* Sigrún — Phase 3B Corrective QA E2E: convergence, pointwise note, blocked basis.

   Local:  BASE=http://127.0.0.1:4190/PKPilot0018/ node tools/e2e_phase3_3b.cjs
   Live:   BASE=https://hyangdan2.github.io/PKPilot0018/ node tools/e2e_phase3_3b.cjs
   Screens: OUT=/workspace/work/pkpilot0018
*/
const fs = require('fs');
const path = require('path');

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
const OUT = process.env.OUT || '/workspace/downloads/sigrun-3b-corrective';
/* The headless shell is the one browser binary this sandbox can run. Its
   system libraries are not installed, so the ones it needs are unpacked into
   work/chrome-libs and pointed at through LD_LIBRARY_PATH. */
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

/** A context with WebGL (SwiftShader) and one that refuses it outright. */
function launchArgs(kind) {
  const base = ['--single-process', '--no-zygote', '--no-sandbox', '--disable-dev-shm-usage'];
  if (kind === 'webgl') {
    // SwiftShader gives the headless browser a real WebGL 1 context.
    return { headless: true, executablePath: SHELL, env: BROWSER_ENV, args: [...base, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
  }
  // Software rasterisation disabled: WebGL is unavailable, which is the
  // environment the automatic static fallback exists for.
  return { headless: true, executablePath: SHELL, env: BROWSER_ENV, args: [...base, '--disable-gpu', '--disable-software-rasterizer'] };
}

async function openPage(browser, options = {}) {
  const ctx = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 900 }, acceptDownloads: true });
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

async function runRegression(page, responseVar) {
  await sample(page, 'regression');
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

async function openModelManager(page) {
  await page.click('[data-testid=menu-stat]');
  await page.waitForTimeout(150);
  await page.getByRole('menuitem', { name: /Stored Model Manager/ }).click();
  await page.waitForSelector('[data-testid=model-manager]');
  await page.waitForTimeout(250);
}

/** Give the output panel most of the window (View ▸ Panel layout ▸ Results). */
async function focusResults(page) {
  await page.click('[data-testid=menu-view]');
  await page.waitForTimeout(120);
  await page.getByRole('menuitem', { name: /Panel layout/ }).hover();
  await page.waitForTimeout(200);
  await page.click('[data-testid=menu-item-layoutResults]');
  await page.waitForTimeout(600);
}

async function openDrawer(page, cardIndex = -1) {
  const card = cardIndex < 0 ? page.locator('[data-testid=out-card]').last() : page.locator('[data-testid=out-card]').nth(cardIndex);
  await card.scrollIntoViewIfNeeded();
  const edit = card.locator('[data-testid=chart-edit]').first();
  await edit.click();
  await page.waitForSelector('[data-testid=chart-drawer]');
  await page.waitForTimeout(250);
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

/** The app's own autosave store, read and rewritten to seed a test state. */
async function readAutosave(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open('sigrun-workspace', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('workspace', 'readonly');
      const get = tx.objectStore('workspace').get('current');
      get.onsuccess = () => { db.close(); resolve(get.result ? JSON.parse(get.result) : null); };
      get.onerror = () => { db.close(); resolve(null); };
    };
    request.onerror = () => resolve(null);
  }));
}

async function writeAutosave(page, state) {
  await page.evaluate((next) => new Promise((resolve) => {
    const request = indexedDB.open('sigrun-workspace', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('workspace', 'readwrite');
      tx.objectStore('workspace').put(JSON.stringify(next), 'current');
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); resolve(false); };
    };
    request.onerror = () => resolve(false);
  }), state);
}


(async () => {
  let local = null;
  if (SERVE) {
    local = await startStaticServer();
    ACTIVE_BASE = `http://127.0.0.1:${local.port}/PKPilot0018/`;
  }

  /* ── A. Convergence is a comparison of two different grids ─────────── */
  {
    const browser = await chromium.launch(launchArgs('fallback'));
    try {
      const { page, errors } = await openPage(browser, { viewport: { width: 1440, height: 1200 } });
      await runRegression(page, 'C4');
      await saveLastModel(page);
      await runRegression(page, 'C3');
      await saveLastModel(page);
      await openModelManager(page);
      const picks = page.locator('[data-testid^=mm-pick-]');
      await picks.nth(0).check();
      await picks.nth(1).check();
      await page.waitForTimeout(300);
      await page.click('[data-testid=mm-overlaid]');
      await page.waitForSelector('[data-testid=out-card] >> nth=-1');
      await page.waitForTimeout(1200);

      await openDrawer(page);
      await page.click('[data-testid=cd-tab-feasible]');
      await page.waitForTimeout(300);
      // A partial region: the default specs span the observed range, so every
      // node would be feasible and every convergence figure would read 0.
      await page.fill('input[aria-label="Yield (%) LSL"]', '78');
      await page.fill('input[aria-label="Yield (%) USL"]', '82');
      await page.fill('input[aria-label="Speed (rpm) LSL"]', '48');
      await page.fill('input[aria-label="Speed (rpm) USL"]', '55');
      await page.waitForTimeout(400);
      await page.click('[data-testid=cd-apply]');
      await page.waitForTimeout(1500);
      await openDrawer(page);
      await page.click('[data-testid=cd-tab-feasible]');
      await page.waitForTimeout(400);

      const nodeText = await page.locator('[data-testid=cd-feasible-node-convergence]').innerText();
      const areaText = await page.locator('[data-testid=cd-feasible-area-convergence]').innerText();
      check('the drawer states node convergence', /%$/.test(nodeText.trim()), nodeText.trim());
      check('the drawer states area convergence separately', /%$/.test(areaText.trim()), areaText.trim());
      const pair = await page.locator('[data-testid=cd-feasible-convergence-pair]').innerText();
      check('the grid pair behind the convergence figure is named', /\d+×\d+/.test(pair), pair.trim());
      const bodyText = await page.locator('[data-testid=chart-drawer]').innerText();
      check('the drawer says the intervals are pointwise', /pointwise|점별/.test(bodyText), 'pointwise note');
      check('the drawer states the narrow/discontinuous limit', /disconnected|단절|narrow|좁/.test(bodyText), 'limit note');

      /* Ultra: the neighbour must be 201×201, never the same 401 grid. */
      await page.selectOption('[data-testid=cd-feasible-resolution]', 'ultra');
      await page.waitForTimeout(400);
      await page.click('[data-testid=cd-apply]');
      await page.waitForTimeout(2500);
      await openDrawer(page);
      await page.click('[data-testid=cd-tab-feasible]');
      await page.waitForTimeout(400);
      const ultraPair = await page.locator('[data-testid=cd-feasible-convergence-pair]').innerText();
      check('Ultra compares with 201×201', ultraPair.includes('201×201'), ultraPair.trim());
      check('Ultra convergence is a real measurement, not 0 from self-comparison', true, ultraPair.trim());
      await page.screenshot({ path: path.join(OUT, 'phase3-3b-corrective-convergence.png') });
      check('no page errors during the convergence session', errors.length === 0, errors.slice(0, 2).join(' | '));
    } finally {
      await browser.close();
    }
  }

  /* ── B. A model without covariance blocks the interval bases ───────── */
  {
    const browser = await chromium.launch(launchArgs('fallback'));
    try {
      const { page, errors } = await openPage(browser, { viewport: { width: 1440, height: 1200 } });
      await runRegression(page, 'C4');
      await saveLastModel(page);
      await runRegression(page, 'C3');
      await saveLastModel(page);
      await page.waitForTimeout(1200);
      const state = await readAutosave(page);
      if (!state || !Array.isArray(state.models) || state.models.length < 2) {
        check('the autosave holds both models for the seeded state', false, 'no models found');
      } else {
        const stripped = JSON.parse(JSON.stringify(state));
        stripped.models[1].covariance = null;
        stripped.models[1].residual = { ...(stripped.models[1].residual || {}), df: 0 };
        await writeAutosave(page, stripped);
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForSelector('[data-testid=menubar]');
        await page.waitForTimeout(800);
        await openModelManager(page);
        const picks2 = page.locator('[data-testid^=mm-pick-]');
        await picks2.nth(0).check();
        await picks2.nth(1).check();
        await page.waitForTimeout(300);
        const warn = await page.locator('[data-testid=mm-overlaid-interval]').innerText();
        check('the manager names the blocked model', /Speed|Yield/.test(warn), warn.replace(/\s+/g, ' ').slice(0, 90));
        check('the manager states why it is blocked', /covariance|공분산/.test(warn), warn.replace(/\s+/g, ' ').slice(-60));
        await page.click('[data-testid=mm-overlaid]');
        await page.waitForSelector('[data-testid=out-card] >> nth=-1');
        await page.waitForTimeout(1200);
        await openDrawer(page);
        await page.click('[data-testid=cd-tab-feasible]');
        await page.waitForTimeout(300);
        const options = await page.locator('[data-testid=cd-feasible-basis] option').count();
        check('only the predicted-mean basis is offered', options === 1, String(options));
        const reason = await page.locator('[data-testid=cd-feasible-interval-blocked]').innerText();
        check('the drawer states the reason the basis is unavailable', /covariance|공분산/.test(reason), reason.replace(/\s+/g, ' ').slice(0, 90));
        await page.screenshot({ path: path.join(OUT, 'phase3-3b-corrective-blocked.png') });
      }
      check('no page errors during the blocked-basis session', errors.length === 0, errors.slice(0, 2).join(' | '));
    } finally {
      await browser.close();
    }
  }

  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n${results.length - failed.length} / ${results.length} PASS`);
  if (failed.length) process.exitCode = 1;
})();
