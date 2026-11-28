/* Statelia — Stage 3B E2E: 3D surface (WebGL + fallback) and overlaid contour.

   Local:  BASE=http://127.0.0.1:4190/PKPilot0018/ node tools/e2e_phase3_3b.cjs
   Live:   BASE=https://hyangdan2.github.io/PKPilot0018/ node tools/e2e_phase3_3b.cjs
   Screens: OUT=<release folder>
*/
const fs = require('fs');
const path = require('path');

const { chromium, executablePath: CHROME, browserEnv } = require('./browser_env.cjs');

const BASE = process.env.BASE || 'http://127.0.0.1:4190/PKPilot0018/';
const SERVE = process.env.SERVE !== '0';
let ACTIVE_BASE = BASE;
const OUT = process.env.OUT || path.resolve(__dirname, '..', 'artifacts', 'sigrun-phase3-3b');
/* The headless shell is the one browser binary this sandbox can run. Its
   system libraries are not installed, so the ones it needs are unpacked into
   work/chrome-libs and pointed at through LD_LIBRARY_PATH. */

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
    return { headless: true, executablePath: CHROME, env: browserEnv, args: [...base, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
  }
  // Software rasterisation disabled: WebGL is unavailable, which is the
  // environment the automatic static fallback exists for.
  return { headless: true, executablePath: CHROME, env: browserEnv, args: [...base, '--disable-gpu', '--disable-software-rasterizer'] };
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

/** The app's own autosave store, read and rewritten to seed a test state.
 *  Since WO-01 the record is a revision envelope; the project itself is the
 *  payload. A copy written before the envelope is returned as it stands. */
async function readAutosave(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open('sigrun-workspace', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('workspace', 'readonly');
      const get = tx.objectStore('workspace').get('current');
      get.onsuccess = () => {
        db.close();
        if (!get.result) { resolve(null); return; }
        const parsed = JSON.parse(get.result);
        resolve(parsed && parsed.format === 'sigrun-autosave' && 'payload' in parsed ? parsed.payload : parsed);
      };
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
      const envelope = { format: 'sigrun-autosave', revision: Date.now(), savedAt: new Date().toISOString(), payload: next };
      tx.objectStore('workspace').put(JSON.stringify(envelope), 'current');
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); resolve(false); };
    };
    request.onerror = () => resolve(false);
  }), state);
}

/** Which block to run. SECTION unset (or 'all') runs every block, which is
 *  what CI-style runs do; the sandbox's single-process browser needs one
 *  Chromium launch per shell call, so the Stage 3E run splits them. */
const ONLY = process.env.SECTION || 'all';
const pick = (letter) => ONLY === 'all' || ONLY === letter;

(async () => {
  let local = null;
  if (SERVE) {
    local = await startStaticServer();
    ACTIVE_BASE = `http://127.0.0.1:${local.port}/PKPilot0018/`;
  }

  if (pick('A')) /* ── A. WebGL context: the interactive surface ─────────────────────── */
  {
    const browser = await chromium.launch(launchArgs('webgl'));
    try {
      // A taller window gives the output panel room for the whole card, so the
      // element screenshot is not overlapped by the worksheet below it.
      const { page, errors } = await openPage(browser, { viewport: { width: 1440, height: 1200 } });
      await runRegression(page, 'C4');
      await saveLastModel(page);
      await openModelManager(page);

      const surfaceButton = page.locator('[data-testid=mm-surface]');
      check('3D surface entry is enabled for a stored model', (await surfaceButton.count()) === 1 && (await surfaceButton.isEnabled()));
      await page.screenshot({ path: path.join(OUT, 'phase3-3b-manager.png') });

      await page.locator('[data-testid=mm-item]').first().click();
      await surfaceButton.click();
      await page.waitForSelector('[data-testid=surface3d]', { timeout: 20000 });
      await page.waitForTimeout(900);

      const surface = page.locator('[data-testid=surface3d]');
      const renderer = await surface.getAttribute('data-renderer');
      check('the surface card renders through WebGL', renderer === 'webgl', String(renderer));
      check('WebGL surface draws a canvas', (await page.locator('[data-testid=surface3d-canvas]').count()) === 1);
      check('the frame overlay is drawn above the canvas', (await page.locator('[data-testid=surface3d-overlay]').count()) === 1);
      const az0 = Number(await surface.getAttribute('data-azimuth'));
      const el0 = Number(await surface.getAttribute('data-elevation'));

      /* drag to orbit */
      const stage = page.locator('.surface3d-stage').first();
      const box = await stage.boundingBox();
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.68, box.y + box.height * 0.62, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(400);
      const az1 = Number(await surface.getAttribute('data-azimuth'));
      const el1 = Number(await surface.getAttribute('data-elevation'));
      check('dragging rotates the camera', Math.abs(az1 - az0) > 5 && Math.abs(el1 - el0) > 2, `azimuth ${az0}→${az1}, elevation ${el0}→${el1}`);

      /* wheel to zoom */
      const zoom0 = Number(await surface.getAttribute('data-zoom'));
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.mouse.wheel(0, -240);
      await page.waitForTimeout(350);
      const zoom1 = Number(await surface.getAttribute('data-zoom'));
      check('the wheel zooms the surface', zoom1 > zoom0, `zoom ${zoom0}→${zoom1}`);

      /* view presets and projection */
      await page.click('[data-testid=surface-view-top]');
      await page.waitForTimeout(300);
      const topElevation = Number(await surface.getAttribute('data-elevation'));
      check('the Top view stands the camera above the plane', topElevation > 80, `elevation ${topElevation}`);
      await page.click('[data-testid=surface-view-front]');
      await page.waitForTimeout(250);
      await page.click('[data-testid=surface-view-side]');
      await page.waitForTimeout(250);
      const sideAzimuth = Number(await surface.getAttribute('data-azimuth'));
      check('the Side view turns the camera to −90°', Math.abs(((sideAzimuth % 360) + 360) % 360 - 270) < 5, `azimuth ${sideAzimuth}`);
      await page.click('[data-testid=surface-view-iso]');
      await page.waitForTimeout(250);
      await page.click('[data-testid=surface-projection]');
      await page.waitForTimeout(400);
      check('the projection toggles to orthographic', (await surface.getAttribute('data-projection')) === 'orthographic');
      await page.click('[data-testid=surface-projection]');
      await page.waitForTimeout(300);
      await page.click('[data-testid=surface-reset]');
      await page.waitForTimeout(300);
      check('Reset camera returns to the framed view', Math.abs(Number(await surface.getAttribute('data-zoom')) - 1) < 0.01);
      await page.screenshot({ path: path.join(OUT, 'phase3-3b-surface-interactive.png') });

      /* resolution through the drawer */
      await openDrawer(page);
      await page.click('[data-testid=cd-tab-surface]');
      await page.waitForTimeout(250);
      check('the 3D tab is offered for a surface chart', (await page.locator('[data-testid=cd-tab-surface]').count()) === 1);
      await page.selectOption('[data-testid=cd-surface-resolution]', 'draft');
      await page.waitForTimeout(350);
      const gridText = await page.locator('[data-testid=surface3d-resolution]').innerText();
      check('Draft resolution rebuilds the 41×41 grid', gridText.replace(/\s/g, '').startsWith('41×41'), gridText);
      await page.selectOption('[data-testid=cd-surface-render-mode]', 'wireframe');
      await page.waitForTimeout(350);
      const wireCharts = await page.locator('[data-testid=surface3d]').getAttribute('data-render-mode');
      check('the render mode reaches the chart', wireCharts === 'wireframe', String(wireCharts));
      await page.selectOption('[data-testid=cd-surface-render-mode]', 'both');
      await page.selectOption('[data-testid=cd-surface-projection]', 'orthographic');
      await page.click('[data-testid=cd-apply]');
      await page.waitForTimeout(700);
      check('the drawer applies the 3D settings to the card', (await page.locator('[data-testid=surface3d]').getAttribute('data-projection')) === 'orthographic');
      // The card itself, not the viewport, with the output panel given the room
      // a reader would give it before reading a 3D chart.
      await focusResults(page);
      await page.locator('[data-testid=out-card]').last().screenshot({ path: path.join(OUT, 'phase3-3b-surface.png') });
      await page.screenshot({ path: path.join(OUT, 'phase3-3b-surface-full.png') });

      /* export still produces a picture (static projection path) */
      const png = page.locator('[data-testid=out-card]').last().locator('[data-testid=card-png]');
      const download = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
      await png.click();
      const file = await download;
      check('the surface card exports a PNG', Boolean(file), file ? file.suggestedFilename() : 'no download event');

      check('no page errors during the 3D session', errors.length === 0, errors.slice(0, 2).join(' | '));
    } finally {
      await browser.close();
    }
  }

  if (pick('B')) /* ── B. No WebGL: the automatic static projection ──────────────────── */
  {
    const browser = await chromium.launch(launchArgs('fallback'));
    try {
      const { page, errors } = await openPage(browser);
      await runRegression(page, 'C4');
      await saveLastModel(page);
      await openModelManager(page);
      await page.locator('[data-testid=mm-item]').first().click();
      await page.click('[data-testid=mm-surface]');
      await page.waitForSelector('[data-testid=surface3d]', { timeout: 20000 });
      await page.waitForTimeout(700);

      const surface = page.locator('[data-testid=surface3d]');
      check('without WebGL the surface falls back to a static projection', (await surface.getAttribute('data-renderer')) === 'static');
      check('the fallback notice is shown', (await page.locator('[data-testid=surface3d-fallback]').count()) === 1);
      const staticSvg = await page.locator('[data-testid=surface3d-static] svg').count();
      check('the static projection is a real drawing', staticSvg === 1);
      const staticHtml = await page.locator('[data-testid=surface3d-static]').innerHTML();
      check('the static picture carries the surface geometry', staticHtml.includes('surface-faces') && staticHtml.includes('surface-axes'));
      await page.screenshot({ path: path.join(OUT, 'phase3-3b-surface-fallback.png') });
      check('no page errors during the fallback session', errors.length === 0, errors.slice(0, 2).join(' | '));
    } finally {
      await browser.close();
    }
  }

  if (pick('C')) /* ── C. Overlaid contour from two stored models ────────────────────── */
  {
    const browser = await chromium.launch(launchArgs('fallback'));
    try {
      const { page, errors } = await openPage(browser, { viewport: { width: 1440, height: 1200 } });
      await runRegression(page, 'C4');
      await saveLastModel(page);
      await runRegression(page, 'C3');
      await saveLastModel(page);
      await openModelManager(page);

      const items = page.locator('[data-testid=mm-item]');
      check('two models are stored', (await items.count()) === 2, String(await items.count()));
      const picks = page.locator('[data-testid^=mm-pick-]');
      await picks.nth(0).check();
      await picks.nth(1).check();
      await page.waitForTimeout(300);
      const overlaid = page.locator('[data-testid=mm-overlaid]');
      check('the overlaid entry is enabled for two compatible models', await overlaid.isEnabled());
      check('both models share two numeric factors', (await page.locator('[data-testid=mm-overlaid-nofactors]').count()) === 0);
      await overlaid.click();
      await page.waitForSelector('[data-testid=out-card] >> nth=-1');
      await page.waitForTimeout(1200);

      const card = page.locator('[data-testid=out-card]').last();
      const text = await card.innerText();
      check('the overlaid card names both responses', /Yield|Speed/.test(text), text.replace(/\s+/g, ' ').slice(0, 90));
      const svg = await card.locator('.chart-canvas svg').first().innerHTML();
      check('the overlaid plot draws a joint feasible region', svg.includes('feasible-region'));
      check('the overlaid plot draws per-response regions', (svg.match(/overlay-region/g) || []).length >= 2);
      check('the feasible area ratio is printed on the plot', svg.includes('feasible-ratio'));
      check('the grid approximation note is printed', svg.includes('overlaid-grid-note'));


      /* the drawer edits a response specification and the region narrows */
      await openDrawer(page);
      await page.click('[data-testid=cd-tab-feasible]');
      await page.waitForTimeout(300);
      check('the Overlay tab is offered for an overlaid chart', (await page.locator('[data-testid=cd-tab-feasible]').count()) === 1);
      const ratioBefore = await page.locator('[data-testid=out-card]').last().locator('[data-chart-role=feasible-ratio]').first().textContent();
      // The reactor sample yields about 78–85 %: a window inside that range
      // leaves a real feasible window instead of an empty one.
      await page.fill('input[aria-label="Yield (%) LSL"]', '78');
      await page.fill('input[aria-label="Yield (%) USL"]', '82');
      await page.fill('input[aria-label="Speed (rpm) LSL"]', '48');
      await page.fill('input[aria-label="Speed (rpm) USL"]', '55');
      await page.waitForTimeout(500);
      const basisOptions = await page.locator('[data-testid=cd-feasible-basis] option').count();
      check('the interval bases are offered when every model carries a covariance', basisOptions === 3, String(basisOptions));
      await page.click('[data-testid=cd-apply]');
      await page.waitForTimeout(1200);
      const ratioAfter = await page.locator('[data-testid=out-card]').last().locator('[data-chart-role=feasible-ratio]').first().textContent();
      check('a specification edit recomputes the feasible region', Boolean(ratioBefore) && Boolean(ratioAfter) && ratioBefore !== ratioAfter, `${ratioBefore} → ${ratioAfter}`);
      // The deliverable screenshot shows the judged state: both spec windows
      // set, limit lines drawn, the joint region bounded.
      await focusResults(page);
      await card.screenshot({ path: path.join(OUT, 'phase3-3b-overlaid.png') });
      await page.screenshot({ path: path.join(OUT, 'phase3-3b-overlaid-full.png') });
      const appliedSvg = await page.locator('[data-testid=out-card]').last().locator('.chart-canvas svg').first().innerHTML();
      check('the applied spec lines reach the plot', appliedSvg.includes('spec-line'));
      /* the confidence basis narrows the same region */
      await openDrawer(page);
      await page.click('[data-testid=cd-tab-feasible]');
      await page.waitForTimeout(300);
      await page.selectOption('[data-testid=cd-feasible-basis]', 'confidence');
      await page.waitForTimeout(400);
      await page.click('[data-testid=cd-apply]');
      await page.waitForTimeout(1200);
      const ratioConfidence = await page.locator('[data-testid=out-card]').last().locator('[data-chart-role=feasible-ratio]').first().textContent();
      check('the confidence basis shrinks the region', Boolean(ratioConfidence) && ratioConfidence !== ratioAfter, `${ratioAfter} → ${ratioConfidence}`);
      const resumed = await page.locator('[data-testid=out-card]').last().locator('.chart-canvas svg').first().innerHTML();
      check('the legend states the basis in use', /confidence/i.test(resumed), 'basis label');
      check('no page errors during the overlaid session', errors.length === 0, errors.slice(0, 2).join(' | '));
    } finally {
      await browser.close();
    }
  }

  if (pick('D')) /* ── D. A model without covariance disables the interval bases ─────── */
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
        stripped.models[1].dof = null;
        if (stripped.models[1].residual) delete stripped.models[1].residual.df;
        await writeAutosave(page, stripped);
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForSelector('[data-testid=menubar]');
        await page.waitForTimeout(600);
        await openModelManager(page);
        const picks = page.locator('[data-testid^=mm-pick-]');
        await picks.nth(0).check();
        await picks.nth(1).check();
        await page.waitForTimeout(300);
        check('the manager names the model that blocks intervals', (await page.locator('[data-testid=mm-overlaid-interval]').count()) === 1);
        await page.click('[data-testid=mm-overlaid]');
        await page.waitForTimeout(1200);
        await openDrawer(page);
        await page.click('[data-testid=cd-tab-feasible]');
        await page.waitForTimeout(300);
        const options = await page.locator('[data-testid=cd-feasible-basis] option').count();
        check('only the predicted-mean basis remains', options === 1, String(options));
        check('the drawer explains why the interval bases are disabled', (await page.locator('[data-testid=cd-feasible-interval-blocked]').count()) === 1);
        await page.screenshot({ path: path.join(OUT, 'phase3-3b-overlaid-blocked.png') });
      }
      check('no page errors during the blocked-interval session', errors.length === 0, errors.slice(0, 2).join(' | '));
    } finally {
      await browser.close();
    }
  }

  if (pick('E')) /* ── E. Mobile layout: the 3D view fits a 390 px screen ───────────── */
  {
    const browser = await chromium.launch(launchArgs('fallback'));
    try {
      const { page } = await openPage(browser, { viewport: { width: 390, height: 844 } });
      await runRegression(page, 'C4');
      await saveLastModel(page);
      await openModelManager(page);
      await page.locator('[data-testid=mm-item]').first().click();
      await page.click('[data-testid=mm-surface]');
      await page.waitForSelector('[data-testid=surface3d]', { timeout: 20000 });
      await page.waitForTimeout(800);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check('the 3D surface does not overflow a 390 px screen', overflow <= 1, `${overflow}px`);
      await page.screenshot({ path: path.join(OUT, 'phase3-3b-surface-mobile.png') });
    } finally {
      await browser.close();
    }
  }

  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n${results.length - failed.length} / ${results.length} PASS`);
  /* The in-process server would otherwise keep the event loop alive and make
     a finished run look like a hang to whatever started it. */
  if (local) local.server.close();
  fs.writeFileSync(path.join(OUT, ONLY === 'all' ? 'phase3-3b-report.json' : `phase3-3b-report-${ONLY}.json`), JSON.stringify({ base: ACTIVE_BASE, section: ONLY, results }, null, 1));
})();
