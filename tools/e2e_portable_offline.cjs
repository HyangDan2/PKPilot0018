/* Sigrún — Stage 3E: portable build offline smoke test (file://).

   Opens dist-portable/sigrun-portable.html directly from the filesystem in
   Chromium with the network taken away, and drives the same flows the hosted
   build is tested with:

     boot · analysis · charts · 3D surface (WebGL) · static fallback ·
     overlaid contour · optimizer · profiler · graph layout editor ·
     CSV import/export · XLSX export/import · project save/restore

   Network: the context is put offline and every http(s) request is aborted
   and recorded, so a page that quietly wanted a CDN would show up as a
   blocked request rather than as a mystery failure.

   Usage:  node tools/e2e_portable_offline.cjs
           OUT=/workspace/work/pkpilot0018 PORTABLE=dist-portable/sigrun-portable.html
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

const OUT = process.env.OUT || '/workspace/work/pkpilot0018';
const ROOT = path.resolve(__dirname, '..');
const HTML = path.resolve(ROOT, process.env.PORTABLE || 'dist-portable/sigrun-portable.html');
const FIXTURE_CSV = path.join(OUT, 'portable-fixture.csv');
const PROJECT_PATH = path.join(OUT, 'phase3-3e-portable.sigrun.json');
const SHELL = process.env.CHROME_PATH || '/workspace/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const LIBS = process.env.CHROME_LIBS || '/workspace/work/chrome-libs/usr/lib/x86_64-linux-gnu:/workspace/work/chrome-libs/lib/x86_64-linux-gnu';
const BROWSER_ENV = { ...process.env, LD_LIBRARY_PATH: LIBS };

fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(HTML)) {
  console.error(`missing ${HTML} — run \`npm run build:portable\` first`);
  process.exit(2);
}
const FILE_URL = 'file://' + HTML;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
}
function note(name, value) {
  results.push({ name, ok: null, detail: String(value) });
  console.log(`[INFO] ${name} — ${value}`);
}

function launchArgs() {
  return {
    headless: true,
    executablePath: SHELL,
    env: BROWSER_ENV,
    args: ['--single-process', '--no-zygote', '--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  };
}

/** A context with the network removed and a Worker counter installed. */
async function openOffline(browser, options = {}) {
  const ctx = await browser.newContext({
    viewport: options.viewport || { width: 1440, height: 1100 },
    acceptDownloads: true,
    offline: true,
  });
  const blocked = [];
  await ctx.route(/^https?:\/\//, (route) => {
    blocked.push(route.request().url());
    return route.abort();
  });
  await ctx.addInitScript(() => {
    window.__sigrunWorkers = 0;
    const NativeWorker = window.Worker;
    if (NativeWorker) {
      window.Worker = function counted(...args) {
        window.__sigrunWorkers += 1;
        return new NativeWorker(...args);
      };
      window.Worker.prototype = NativeWorker.prototype;
    }
    window.__sigrunStorage = (() => {
      const out = {};
      try { localStorage.setItem('__probe', '1'); localStorage.removeItem('__probe'); out.localStorage = true; } catch { out.localStorage = false; }
      out.indexedDB = typeof indexedDB !== 'undefined';
      return out;
    })();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push('pageerror: ' + error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
  return { ctx, page, errors, blocked };
}

async function gotoPortable(page, suffix = '') {
  await page.goto(FILE_URL + suffix, { waitUntil: 'load' });
  await page.waitForSelector('[data-testid=menubar]', { timeout: 30000 });
}

async function sample(page, id) {
  await page.click('[data-testid=sample-button]');
  await page.waitForSelector('[data-testid=sample-menu]');
  await page.click(`[data-testid=sample-${id}]`);
  await page.waitForTimeout(400);
}

async function runAnalysis(page, menu, item, fill, group) {
  await page.click(`[data-testid=menu-${menu}]`);
  await page.waitForTimeout(150);
  if (group) {
    await page.getByRole('menuitem', { name: group, exact: true }).first().hover();
    await page.waitForTimeout(200);
  }
  await page.getByRole('menuitem', { name: item }).first().click();
  await page.waitForSelector('[data-testid=analysis-dialog]');
  await fill();
  await page.click('[data-testid=dialog-ok]');
  await page.waitForSelector('[data-testid=analysis-dialog]', { state: 'detached', timeout: 30000 });
  await page.waitForTimeout(700);
}

async function scatter(page, ys, xs) {
  await runAnalysis(page, 'graph', /Scatterplot/, async () => {
    for (const y of ys) {
      await page.click('[data-testid=slot-y]');
      await page.click(`[data-testid=var-${y}]`);
      await page.click('[data-testid=add-selected]');
    }
    for (const x of xs) {
      await page.click('[data-testid=slot-x]');
      await page.click(`[data-testid=var-${x}]`);
      await page.click('[data-testid=add-selected]');
    }
  });
}

async function fitRegression(page, responseVar) {
  await runAnalysis(page, 'stat', /Fit Regression Model/, async () => {
    await page.click('[data-testid=slot-response]');
    await page.click(`[data-testid=var-${responseVar}]`);
    await page.click('[data-testid=add-selected]');
    await page.click('[data-testid=slot-predictors]');
    await page.click('[data-testid=var-C1]');
    await page.click('[data-testid=add-selected]');
    await page.click('[data-testid=slot-predictors]');
    await page.click('[data-testid=var-C2]');
    await page.click('[data-testid=add-selected]');
  }, 'Regression');
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

async function pickFile(page, menuId, file) {
  await page.click('[data-testid=menu-file]');
  await page.waitForTimeout(150);
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 15000 }).catch(() => null);
  await page.click(`[data-testid=${menuId}]`);
  const chooser = await chooserPromise;
  if (!chooser) return false;
  await chooser.setFiles(file);
  return true;
}

const SECTIONS = [];
/** Each section gets its own browser: closing a context in the single-process
 *  headless shell can take the whole browser with it, and one crashed section
 *  must not hide the rest of the suite. */
async function section(title, body) {
  console.log(`\n── ${title} ──`);
  const started = Date.now();
  const browser = await chromium.launch(launchArgs());
  try {
    await body(browser);
  } catch (error) {
    check(`${title}: completed without an exception`, false, error.message.split('\n')[0]);
    console.error(error.message.split('\n').slice(0, 4).join('\n'));
  } finally {
    await browser.close().catch(() => {});
  }
  SECTIONS.push({ title, ms: Date.now() - started });
}

(async () => {
  /* ── artefact shape ─────────────────────────────────────────────────── */
  const htmlBytes = fs.statSync(HTML).size;
  const html = fs.readFileSync(HTML, 'utf8');
  const moduleScripts = (html.match(/<script[^>]*type="module"/g) || []).length;
  const classicScripts = (html.match(/<script(?![^>]*type="module")[^>]*>/g) || []).length;
  const remoteRefs = (html.replace(/<script>[\s\S]*?<\/script>/g, '').match(/(?:src|href)="(https?:)?\/\//g) || []).length;
  check('the portable artefact is a single HTML file', path.extname(HTML) === '.html' && htmlBytes > 100000, `${path.basename(HTML)} · ${(htmlBytes / 1024).toFixed(1)} kB`);
  check('no module script is left in the page', moduleScripts === 0, `${moduleScripts} module scripts`);
  check('the page runs its bundle as a classic script', classicScripts >= 1, `${classicScripts} classic scripts`);
  check('the page references no remote resource', remoteRefs === 0, `${remoteRefs} remote refs`);
  const missing = path.join(path.dirname(HTML), 'assets');
  check('the neighbouring page build is not involved', !fs.existsSync(missing), fs.existsSync(missing) ? 'assets/ exists' : 'no assets/ folder beside it');

  {
    /* ── A. boot ─────────────────────────────────────────────────────── */
    await section('A. boot from file://', async (browser) => {
      const { ctx, page, errors, blocked } = await openOffline(browser);
      const started = Date.now();
      await gotoPortable(page);
      const bootMs = Date.now() - started;
      const title = await page.title();
      check('the page boots from a file:// URL', await page.locator('[data-testid=menubar]').isVisible(), FILE_URL);
      check('the document title names the product', /Sigrún/.test(title), title);
      check('the renderer is done before the menu bar shows', (await page.locator('[data-testid=menubar] [data-testid=menu-file]').count()) === 1);
      const nav = await page.evaluate(() => {
        const entry = performance.getEntriesByType('navigation')[0];
        return entry ? { domContentLoaded: Math.round(entry.domContentLoadedEventEnd), load: Math.round(entry.loadEventEnd), transfer: entry.transferSize } : null;
      });
      note('boot to interactive (menubar visible)', `${bootMs} ms · DOMContentLoaded ${nav ? nav.domContentLoaded + ' ms' : 'n/a'}`);
      const workers = await page.evaluate(() => window.__sigrunWorkers);
      check('the page starts no Worker', workers === 0, `${workers} workers`);
      const storage = await page.evaluate(() => window.__sigrunStorage);
      note('storage available on file://', `localStorage ${storage.localStorage} · IndexedDB ${storage.indexedDB}`);
      const sw = await page.evaluate(async () => {
        /* On file:// the API exists but refuses to enumerate; that refusal is
           itself the answer — nothing can be serving this page from a cache. */
        try {
          if (!navigator.serviceWorker) return 'absent';
          const list = await navigator.serviceWorker.getRegistrations();
          return list.length;
        } catch (error) {
          return 'not-allowed-on-file';
        }
      });
      check('the page needs no service worker', sw === 0 || sw === 'absent' || sw === 'not-allowed-on-file', String(sw));
      const webgl = await page.evaluate(() => {
        const probe = document.createElement('canvas');
        const gl = probe.getContext('webgl') || probe.getContext('experimental-webgl');
        return gl ? { ok: true, vendor: gl.getParameter(gl.VENDOR), version: gl.getParameter(gl.VERSION) } : { ok: false };
      });
      check('this browser offers WebGL for the 3D surface', webgl.ok, webgl.ok ? `${webgl.vendor} · ${webgl.version}` : 'no WebGL');
      check('nothing reached for the network during boot', blocked.length === 0, blocked.slice(0, 3).join(', ') || 'none');

      /* worksheet + statistics + chart */
      await sample(page, 'regression');
      const rows = await page.locator('[data-testid^=ws-rownum-]').count();
      check('a sample dataset loads into the worksheet', rows > 0, `${rows} rows`);
      await runAnalysis(page, 'stat', /Descriptive Statistics/, async () => {
        for (const col of ['C1', 'C2', 'C4']) {
          await page.click('[data-testid=slot-variables]');
          await page.click(`[data-testid=var-${col}]`);
          await page.click('[data-testid=add-selected]');
        }
      }, 'Basic Statistics');
      const card = page.locator('[data-testid=out-card]').last();
      const cardText = (await card.innerText()).replace(/\s+/g, ' ');
      check('descriptive statistics run and print a table', /(MEAN|평균)/i.test(cardText) && /(STDEV|표준편차)/i.test(cardText), cardText.slice(0, 90));
      await scatter(page, ['C4'], ['C1']);
      const chartCard = page.locator('[data-testid=out-card]').last();
      await chartCard.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1200);
      /* A scatterplot draws its marks as circles and its grid as lines; both
         live in the SVG the browser paints, not on a canvas. */
      const marks = await chartCard.locator('svg circle').count();
      const rules = await chartCard.locator('svg line').count();
      const plotted = await chartCard.locator('[data-chart-role=plot]').count();
      check('a scatterplot is drawn as SVG', plotted === 1 && marks >= 40 && rules > 5, `${marks} points · ${rules} rules`);
      await page.screenshot({ path: path.join(OUT, 'phase3-3e-portable.png') });
      await page.screenshot({ path: path.join(OUT, 'phase3-3e-portable-full.png'), fullPage: false });
      const fatal = errors.filter((message) => !/favicon|manifest|ResizeObserver/i.test(message));
      check('no page error during boot and the first analyses', fatal.length === 0, fatal.slice(0, 2).join(' | '));
      await ctx.close();
    });

    /* ── B. models, 3D surface, contour, optimizer, profiler ─────────── */
    await section('B. 3D surface · overlaid contour · optimizer · profiler', async (browser) => {
      const { ctx, page, errors, blocked } = await openOffline(browser, { viewport: { width: 1440, height: 1200 } });
      await gotoPortable(page);
      await sample(page, 'regression');
      await fitRegression(page, 'C4');
      await saveLastModel(page);
      await fitRegression(page, 'C3');
      await saveLastModel(page);

      await openModelManager(page);
      const items = page.locator('[data-testid=mm-item]');
      check('two models are stored in the portable page', (await items.count()) === 2, String(await items.count()));
      await items.first().click();
      await page.click('[data-testid=mm-surface]');
      await page.waitForSelector('[data-testid=surface3d]', { timeout: 20000 });
      await page.waitForTimeout(1500);
      const surface = await page.evaluate(() => {
        const el = document.querySelector('[data-testid=surface3d]');
        const canvas = el && el.querySelector('canvas');
        const gl = canvas ? (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) : null;
        return { renderer: el && el.getAttribute('data-renderer'), w: canvas ? canvas.width : 0, h: canvas ? canvas.height : 0, lost: gl ? gl.isContextLost() : null };
      });
      check('the stored-model 3D surface renders through WebGL on file://', surface.renderer === 'webgl', String(surface.renderer));
      check('the WebGL context is alive', surface.lost === false, `${surface.w}×${surface.h} lost=${surface.lost}`);
      const surfaceCard = page.locator('[data-testid=surface3d]').last();
      await surfaceCard.scrollIntoViewIfNeeded();
      await surfaceCard.screenshot({ path: path.join(OUT, 'phase3-3e-portable-surface.png') });

      /* overlaid contour from two stored models */
      await page.keyboard.press('Escape');
      await page.locator('[data-testid=mm-close]').click().catch(() => {});
      await page.waitForTimeout(200);
      await openModelManager(page);
      const picks = page.locator('[data-testid^=mm-pick-]');
      await picks.nth(0).check();
      await picks.nth(1).check();
      await page.waitForTimeout(300);
      check('the overlaid contour entry is enabled', await page.locator('[data-testid=mm-overlaid]').isEnabled());
      await page.click('[data-testid=mm-overlaid]');
      await page.waitForTimeout(1400);
      const overlayCard = page.locator('[data-testid=out-card]').last();
      const overlaySvg = await overlayCard.locator('.chart-canvas svg').first().innerHTML();
      check('the overlaid contour draws its feasible region', overlaySvg.includes('feasible-region') || (overlaySvg.match(/overlay-region/g) || []).length >= 2, `${(overlaySvg.match(/overlay-region/g) || []).length} regions`);
      await overlayCard.screenshot({ path: path.join(OUT, 'phase3-3e-portable-contour.png') });

      /* response optimizer */
      await openModelManager(page);
      await page.locator('[data-testid^=mm-pick-]').nth(0).check();
      await page.locator('[data-testid^=mm-pick-]').nth(1).check();
      await page.click('[data-testid=mm-optimizer]');
      await page.waitForSelector('[data-testid=optimizer]', { timeout: 10000 });
      await page.waitForTimeout(300);
      const responseRows = page.locator('[data-testid=opt-response-row]');
      check('the optimizer lists both responses', (await responseRows.count()) === 2, String(await responseRows.count()));
      check('the optimizer lists the shared factors', (await page.locator('[data-testid=opt-factor-row]').count()) === 2, String(await page.locator('[data-testid=opt-factor-row]').count()));
      const rows = await responseRows.all();
      await rows[0].locator('select').selectOption('maximize');
      await rows[1].locator('select').selectOption('minimize');
      const optStart = Date.now();
      await page.click('[data-testid=opt-run]');
      await page.waitForSelector('[data-testid=opt-result]', { timeout: 20000 });
      const optMs = Date.now() - optStart;
      await page.waitForTimeout(300);
      const status = await page.locator('[data-testid=opt-result]').getAttribute('data-status');
      check('the optimizer returns a status', ['optimal', 'best-found', 'limit', 'no-feasible'].includes(status || ''), String(status));
      const composite = (await page.locator('[data-testid=opt-composite]').count()) ? await page.locator('[data-testid=opt-composite]').textContent() : 'n/a';
      check('the composite desirability is within 0…1', Number(composite) >= 0 && Number(composite) <= 1, `${composite} · ${optMs} ms`);
      check('the optimizer reports optimal factor settings', (await page.locator('[data-testid=opt-condition-row]').count()) === 2);
      note('optimizer solve time (two responses, two factors)', `${optMs} ms`);
      await page.locator('[data-testid=optimizer]').screenshot({ path: path.join(OUT, 'phase3-3e-portable-optimizer.png') });

      /* profiler */
      await page.click('[data-testid=opt-to-profiler]');
      await page.waitForSelector('[data-testid=profiler]', { timeout: 10000 });
      await page.waitForTimeout(500);
      check('the profiler draws one row per response', (await page.locator('[data-testid=prof-row]').count()) === 2, String(await page.locator('[data-testid=prof-row]').count()));
      check('the profiler gives every factor a slider', (await page.locator('[data-testid^=prof-slider-]').count()) === 2, String(await page.locator('[data-testid^=prof-slider-]').count()));
      const before = await page.locator('[data-testid=prof-row]').first().textContent();
      const slider = page.locator('[data-testid^=prof-slider-]').first();
      const refreshMs = await page.evaluate(() => {
        const el = document.querySelector('[data-testid^=prof-slider-]');
        const min = Number(el.min); const max = Number(el.max);
        const start = performance.now();
        el.value = String(min + (max - min) * 0.25);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return performance.now() - start;
      });
      await page.waitForTimeout(500);
      const after = await page.locator('[data-testid=prof-row]').first().textContent();
      check('moving a profiler slider changes the prediction', before !== after, `${(before || '').slice(0, 22)} → ${(after || '').slice(0, 22)}`);
      note('profiler slider dispatch cost (synchronous part)', `${refreshMs.toFixed(1)} ms`);
      await page.locator('[data-testid=profiler]').screenshot({ path: path.join(OUT, 'phase3-3e-portable-profiler.png') });
      await page.click('[data-testid=prof-done]').catch(() => {});

      check('nothing reached for the network in the model session', blocked.length === 0, blocked.slice(0, 3).join(', ') || 'none');
      const fatal = errors.filter((message) => !/favicon|manifest|ResizeObserver/i.test(message));
      check('no page error in the model session', fatal.length === 0, fatal.slice(0, 2).join(' | '));
      await page.screenshot({ path: path.join(OUT, 'phase3-3e-portable-analysis.png') });
      await ctx.close();
    });

    /* ── C. WebGL absent → static projection ────────────────────────── */
    await section('C. 3D surface without WebGL', async (browser) => {
      const { ctx, page, errors } = await openOffline(browser, { viewport: { width: 1440, height: 1100 } });
      await gotoPortable(page, '?webgl=off');
      await sample(page, 'regression');
      await fitRegression(page, 'C4');
      await saveLastModel(page);
      await openModelManager(page);
      await page.locator('[data-testid=mm-item]').first().click();
      await page.click('[data-testid=mm-surface]');
      await page.waitForSelector('[data-testid=surface3d]', { timeout: 20000 });
      await page.waitForTimeout(1200);
      const renderer = await page.locator('[data-testid=surface3d]').getAttribute('data-renderer');
      check('the surface falls back to the static projection when WebGL is off', renderer === 'static', String(renderer));
      check('the static projection is an SVG the file can print', (await page.locator('[data-testid=surface3d] svg').count()) > 0, String(await page.locator('[data-testid=surface3d] svg').count()));
      await page.locator('[data-testid=surface3d]').last().screenshot({ path: path.join(OUT, 'phase3-3e-portable-surface-static.png') });
      const fatal = errors.filter((message) => !/favicon|manifest|ResizeObserver/i.test(message));
      check('no page error in the fallback session', fatal.length === 0, fatal.slice(0, 2).join(' | '));
      await ctx.close();
    });

    /* ── D. graph layout editor ─────────────────────────────────────── */
    await section('D. graph layout editor', async (browser) => {
      const { ctx, page, errors } = await openOffline(browser, { viewport: { width: 1440, height: 1100 } });
      await gotoPortable(page);
      await sample(page, 'regression');
      await scatter(page, ['C4'], ['C1']);
      await scatter(page, ['C3'], ['C2']);
      await page.click('[data-testid=menu-graph]');
      await page.waitForTimeout(150);
      await page.click('[data-testid=menu-item-graphLayout]');
      await page.waitForSelector('[data-testid=graph-layout]');
      await page.waitForTimeout(400);
      const library = page.locator('[data-testid^=gl-chart-]');
      check('the layout editor lists the charts in the output', (await library.count()) >= 2, String(await library.count()));
      await library.first().click();
      await page.waitForTimeout(400);
      await library.nth(1).click();
      await page.waitForTimeout(400);
      check('two charts are placed on the page', (await page.locator('[data-testid=gl-panel]').count()) === 2, String(await page.locator('[data-testid=gl-panel]').count()));
      await page.click('[data-testid=gl-add-text]');
      await page.fill('[data-testid=gl-text-input]', 'Portable build · figure 1');
      await page.waitForTimeout(200);
      await page.selectOption('[data-testid=gl-page-preset]', 'a4-portrait');
      await page.waitForTimeout(300);
      const label = await page.locator('[data-testid=gl-page-label]').textContent();
      check('the page preset switches to A4 portrait', /210×297/.test(label || ''), label || '');
      const [svgDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.click('[data-testid=gl-export-svg]'),
      ]);
      const svgText = fs.readFileSync(await svgDownload.path(), 'utf8');
      fs.writeFileSync(path.join(OUT, 'phase3-3e-portable-figure.svg'), svgText);
      check('the figure exports as one SVG', svgText.includes('class="sigrun-figure"') && (svgText.match(/data-panel="/g) || []).length >= 2, `${svgText.length} bytes`);
      const [pngDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.click('[data-testid=gl-export-png-300]'),
      ]);
      check('the figure exports as a 300 DPI PNG', /300dpi\.png$/.test(pngDownload.suggestedFilename()), pngDownload.suggestedFilename());
      fs.copyFileSync(await pngDownload.path(), path.join(OUT, 'phase3-3e-portable-figure-300dpi.png'));
      const [layoutDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.click('[data-testid=gl-save]'),
      ]);
      const layoutText = fs.readFileSync(await layoutDownload.path(), 'utf8');
      fs.writeFileSync(path.join(OUT, 'phase3-3e-portable-layout.sigrun.json'), layoutText);
      check('the layout saves as a restorable document', JSON.parse(layoutText).format === 'sigrun-layout', JSON.parse(layoutText).format);
      await page.screenshot({ path: path.join(OUT, 'phase3-3e-portable-layout.png') });
      await page.click('[data-testid=gl-close]');
      const fatal = errors.filter((message) => !/favicon|manifest|ResizeObserver/i.test(message));
      check('no page error in the layout session', fatal.length === 0, fatal.slice(0, 2).join(' | '));
      await ctx.close();
    });

    /* ── E. CSV / XLSX import and export ────────────────────────────── */
    await section('E. CSV · XLSX import and export', async (browser) => {
      const csv = ['Run,Temperature,Pressure,Yield', ...Array.from({ length: 12 }, (_, i) => {
        const t = 180 + i * 2.5; const p = 40 + (i % 5) * 2; const y = 78 + (i % 4) * 1.6 - (i % 3);
        return `${i + 1},${t.toFixed(1)},${p.toFixed(1)},${y.toFixed(2)}`;
      })].join('\n');
      fs.writeFileSync(FIXTURE_CSV, csv + '\n', 'utf8');

      const { ctx, page, errors } = await openOffline(browser, { viewport: { width: 1440, height: 1000 } });
      await gotoPortable(page);
      const sheetCountBefore = await page.locator('[data-testid^=nav-sheet-]').count();
      const picked = await pickFile(page, 'menu-item-importCsv', FIXTURE_CSV);
      check('the CSV import asks for a file', picked);
      await page.waitForTimeout(700);
      const dialog = page.locator('.modal.narrow');
      check('the import preview appears before anything is added', await dialog.count() === 1);
      const previewText = (await dialog.innerText()).replace(/\s+/g, ' ');
      check('the preview shows the file name and its shape', /portable-fixture/.test(previewText) && /12/.test(previewText), previewText.slice(0, 80));
      await dialog.locator('.modal-foot .btn.primary').click();
      await page.waitForTimeout(800);
      const sheetCountAfter = await page.locator('[data-testid^=nav-sheet-]').count();
      check('the CSV becomes a new worksheet', sheetCountAfter === sheetCountBefore + 1, `${sheetCountBefore} → ${sheetCountAfter}`);
      /* The grid always paints a full screen of row numbers, so the last data
         row is what says how many rows really arrived. */
      check('every CSV data row landed in the grid', await page.locator('[data-testid=ws-rownum-12]').count() === 1, `row 12 present · ${await page.locator('[data-testid^=ws-rownum-]').count()} painted`);

      const [csvDownload] = await Promise.all([
        page.waitForEvent('download'),
        (async () => {
          await page.click('[data-testid=menu-file]');
          await page.waitForTimeout(150);
          await page.click('[data-testid=menu-item-exportCsv]');
        })(),
      ]);
      const csvOutPath = path.join(OUT, 'phase3-3e-portable-export.csv');
      await csvDownload.saveAs(csvOutPath);
      const csvOut = fs.readFileSync(csvOutPath, 'utf8').replace(/^\uFEFF/, '');
      const csvLines = csvOut.trim().split(/\r?\n/);
      check('the exported CSV starts with the header row that was imported', /^Run,Temperature,Pressure,Yield/.test(csvLines[0] || ''), csvLines[0]);
      check('the exported CSV carries every data row back out', csvLines.length === 13, `${csvLines.length} lines · ${csvOut.length} bytes`);

      const [xlsxDownload] = await Promise.all([
        page.waitForEvent('download'),
        (async () => {
          await page.click('[data-testid=menu-file]');
          await page.waitForTimeout(150);
          await page.click('[data-testid=menu-item-exportXlsxCurrent]');
        })(),
      ]);
      const xlsxPath = path.join(OUT, 'phase3-3e-portable-export.xlsx');
      await xlsxDownload.saveAs(xlsxPath);
      const xlsxHead = fs.readFileSync(xlsxPath).subarray(0, 2).toString('latin1');
      check('the sheet exports as a real XLSX (ZIP container)', xlsxHead === 'PK' && fs.statSync(xlsxPath).size > 2000, `${fs.statSync(xlsxPath).size} bytes`);

      const sheetsBeforeXlsx = await page.locator('[data-testid^=nav-sheet-]').count();
      const pickedXlsx = await pickFile(page, 'menu-item-importXlsx', xlsxPath);
      check('the XLSX import asks for a file', pickedXlsx);
      await page.waitForTimeout(1200);
      const xlsxDialog = page.locator('.modal.narrow');
      check('the XLSX import preview appears', (await xlsxDialog.count()) === 1, String(await xlsxDialog.count()));
      if (await xlsxDialog.count()) await xlsxDialog.locator('.modal-foot .btn.primary').click();
      await page.waitForTimeout(1000);
      check('the XLSX becomes a worksheet of its own', (await page.locator('[data-testid^=nav-sheet-]').count()) === sheetsBeforeXlsx + 1, `${sheetsBeforeXlsx} → ${await page.locator('[data-testid^=nav-sheet-]').count()}`);
      await page.screenshot({ path: path.join(OUT, 'phase3-3e-portable-import.png') });
      const fatal = errors.filter((message) => !/favicon|manifest|ResizeObserver/i.test(message));
      check('no page error in the import session', fatal.length === 0, fatal.slice(0, 2).join(' | '));
      await ctx.close();
    });

    /* ── F. project save ────────────────────────────────────────────── */
    await section('F. project save', async (browser) => {
      const { ctx, page, errors } = await openOffline(browser, { viewport: { width: 1440, height: 1000 } });
      await gotoPortable(page);
      await sample(page, 'regression');
      await runAnalysis(page, 'stat', /Descriptive Statistics/, async () => {
        await page.click('[data-testid=slot-variables]');
        await page.click('[data-testid=var-C1]');
        await page.click('[data-testid=add-selected]');
      }, 'Basic Statistics');
      await scatter(page, ['C4'], ['C1']);
      const outsBefore = await page.locator('[data-testid=out-card]').count();
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        (async () => {
          await page.click('[data-testid=menu-file]');
          await page.waitForTimeout(150);
          await page.click('[data-testid=menu-item-save]');
        })(),
      ]);
      await download.saveAs(PROJECT_PATH);
      const project = JSON.parse(fs.readFileSync(PROJECT_PATH, 'utf8'));
      check('Save Project writes a .sigrun.json file', project.format === 'sigrun-project' && project.version === 1, `${path.basename(PROJECT_PATH)} · ${fs.statSync(PROJECT_PATH).size} bytes`);
      check('the file carries the worksheets and the output', Array.isArray(project.worksheets) && project.worksheets.length >= 1 && Array.isArray(project.outputs) && project.outputs.length === outsBefore, `${project.worksheets.length} sheets · ${project.outputs.length} outputs`);
      const fatal = errors.filter((message) => !/favicon|manifest|ResizeObserver/i.test(message));
      check('no page error while saving the project', fatal.length === 0, fatal.slice(0, 2).join(' | '));
      await ctx.close();
    });

    /* ── G. project restore in a fresh browser ──────────────────────── */
    await section('G. project restore', async (browser) => {
      check('the project file from the save session is present', fs.existsSync(PROJECT_PATH), path.basename(PROJECT_PATH));
      if (!fs.existsSync(PROJECT_PATH)) return;
      /* A brand-new browser: no autosave, no storage — the file is the only
         thing that can bring the work back. */
      const { ctx, page, errors } = await openOffline(browser, { viewport: { width: 1440, height: 1000 } });
      await gotoPortable(page);
      const empties = await page.locator('[data-testid=out-card]').count();
      check('a fresh portable page starts with an empty output', empties === 0, String(empties));
      const picked = await pickFile(page, 'menu-item-open', PROJECT_PATH);
      check('Open Project asks for a file', picked);
      await page.waitForTimeout(1800);
      const project = JSON.parse(fs.readFileSync(PROJECT_PATH, 'utf8'));
      const restored = await page.locator('[data-testid=out-card]').count();
      check('the saved outputs come back from the project file', restored === project.outputs.length, `${restored}/${project.outputs.length}`);
      const restoredText = (await page.locator('[data-testid=output-panel]').innerText()).replace(/\s+/g, ' ');
      check('the restored cards keep their content', restoredText.length > 120 && /(MEAN|평균|Scatter|Yield|산점도)/i.test(restoredText), restoredText.slice(0, 80));
      const gridRows = await page.locator('[data-testid^=ws-rownum-]').count();
      check('the worksheet comes back with the project', gridRows > 0, `${gridRows} rows painted`);
      await page.screenshot({ path: path.join(OUT, 'phase3-3e-portable-restored.png') });
      const fatal = errors.filter((message) => !/favicon|manifest|ResizeObserver/i.test(message));
      check('no page error while restoring the project', fatal.length === 0, fatal.slice(0, 2).join(' | '));
      await ctx.close();
    });
  }

  const failed = results.filter((result) => result.ok === false).length;
  const passed = results.filter((result) => result.ok === true).length;
  fs.writeFileSync(
    path.join(OUT, 'phase3-3e-portable-report.json'),
    JSON.stringify({ url: FILE_URL, artefactBytes: htmlBytes, passed, failed, info: results.filter((r) => r.ok === null).length, sections: SECTIONS, checks: results }, null, 1),
  );
  console.log(`\n${passed}/${passed + failed} checks passed${failed ? ` · ${failed} FAILED` : ''}`);
})();
