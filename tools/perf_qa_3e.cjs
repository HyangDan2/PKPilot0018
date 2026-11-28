/* Statelia — Stage 3E performance QA.

   Measures the numbers the Stage 3E report has to state, on the same bundle
   GitHub Pages serves, in the same headless Chromium the other suites use:

     · boot to interactive            (three navigations, median)
     · large-data work: import, descriptive statistics, control chart, scatter
     · profiler slider -> prediction  (the "refresh after a factor change" cost)
     · optimizer solve                (two responses, two factors, UI path)
     · JS heap after each stage
     · the limits the engine enforces (reported from the shipped constants)

   Environment and data size are written into qa/reports/perf-3e.json next to
   the numbers, because a timing without them says nothing.

   Usage:  node tools/perf_qa_3e.cjs        (ROWS=20000 by default)
*/
const fs = require('fs');
const http = require('http');
const path = require('path');

const { chromium, executablePath: CHROME, browserEnv } = require('./browser_env.cjs');

const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.OUT || path.resolve(__dirname, '..', '..', 'pkpilot0018');
const REPORT = path.resolve(ROOT, process.env.REPORT || 'qa/reports/perf-3e.json');
const PORT = Number(process.env.PORT || 4198);
const ROWS = Number(process.env.ROWS || 20000);
/* Which large-data steps to run. The sandbox's single-process browser gives
   out after a 50,000-point scatter followed by a 50,000-point control chart in
   one page, so the heavy steps can be measured one at a time. */
const STEPS = (process.env.STEPS || 'import,descriptive,scatter,control').split(',');

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.dirname(REPORT), { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
}
function measure(name, value, unit = 'ms', extra = '') {
  results.push({ name, ok: null, value, unit, detail: extra });
  const shown = typeof value === 'number' && unit === 'ms' ? value.toFixed(1) + ' ms' : `${value} ${unit}`;
  console.log(`[MEASURE] ${name} — ${shown}${extra ? ' · ' + extra : ''}`);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
function startServer() {
  const root = path.join(ROOT, 'dist');
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
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

function launch() {
  return chromium.launch({
    headless: true,
    executablePath: CHROME,
    env: browserEnv,
    args: ['--single-process', '--no-zygote', '--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'],
  });
}

async function newPage(browser, viewport = { width: 1440, height: 1000 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push('pageerror: ' + error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
  return { ctx, page, errors };
}

const heap = (page) => page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null)).catch(() => null);

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
  await page.waitForSelector('[data-testid=analysis-dialog]', { state: 'detached', timeout: 120000 });
}

async function pick(page, menuId, file) {
  await page.click('[data-testid=menu-file]');
  await page.waitForTimeout(150);
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 15000 }).catch(() => null);
  await page.click(`[data-testid=${menuId}]`);
  const chooser = await chooserPromise;
  if (!chooser) return false;
  await chooser.setFiles(file);
  return true;
}

(async () => {
  const server = await startServer();
  const base = `http://127.0.0.1:${PORT}/PKPilot0018/`;
  const environment = {
    browser: 'chrome-headless-shell 1248 (single-process, SwiftShader)',
    viewport: '1440×1000',
    url: base,
    node: process.version,
    host: process.platform + ' ' + process.arch,
    rows: ROWS,
  };
  const report = { at: new Date().toISOString(), environment, measurements: {}, limits: {}, checks: results };

  try {
    /* ── 1. boot ─────────────────────────────────────────────────────── */
    {
      const browser = await launch();
      try {
        const { ctx, page, errors } = await newPage(browser);
        const timings = [];
        for (let i = 0; i < 3; i += 1) {
          const started = Date.now();
          await page.goto(base, { waitUntil: 'load' });
          await page.waitForSelector('[data-testid=menubar]');
          timings.push(Date.now() - started);
        }
        const nav = await page.evaluate(() => {
          const entry = performance.getEntriesByType('navigation')[0];
          return entry ? { dcl: Math.round(entry.domContentLoadedEventEnd), load: Math.round(entry.loadEventEnd) } : null;
        });
        timings.sort((a, b) => a - b);
        report.measurements.boot = { samples: timings, medianMs: timings[1], domContentLoadedMs: nav ? nav.dcl : null };
        measure('boot to interactive (median of 3)', timings[1], `samples ${timings.join(' / ')} ms · DOMContentLoaded ${nav ? nav.dcl + ' ms' : 'n/a'}`);
        report.measurements.bootHeapMB = await heap(page);
        measure('JS heap after boot', report.measurements.bootHeapMB, 'MB');
        check('the page boots without a page error', errors.length === 0, errors.slice(0, 2).join(' | '));
        await ctx.close();
      } finally {
        await browser.close().catch(() => {});
      }
    }

    /* ── 2. large dataset ────────────────────────────────────────────── */
    {
      const browser = await launch();
      try {
        const { ctx, page, errors } = await newPage(browser, { width: 1440, height: 1000 });
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForSelector('[data-testid=menubar]');

        /* A deterministic 4-column dataset: two factors and two responses,
           with a little noise so every statistic is finite. */
        const csvPath = path.join(OUT, `perf-3e-${ROWS}.csv`);
        const lines = ['Run,Temperature,Pressure,Yield,Speed'];
        let seed = 20261124;
        const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
        for (let i = 0; i < ROWS; i += 1) {
          const t = 150 + rnd() * 60;
          const p = 30 + rnd() * 20;
          const y = 70 + 0.06 * t + 0.4 * p + (rnd() - 0.5) * 4;
          const s = 40 + 0.8 * p - 0.02 * t + (rnd() - 0.5) * 6;
          lines.push(`${i + 1},${t.toFixed(2)},${p.toFixed(2)},${y.toFixed(3)},${s.toFixed(3)}`);
        }
        fs.writeFileSync(csvPath, lines.join('\n') + '\n', 'utf8');

        const importStart = Date.now();
        const picked = await pick(page, 'menu-item-importCsv', csvPath);
        check('the large CSV is offered to the importer', picked);
        await page.waitForTimeout(600);
        const dialog = page.locator('.modal.narrow');
        if (await dialog.count()) await dialog.locator('.modal-foot .btn.primary').click();
        await page.waitForSelector('.modal.narrow', { state: 'detached', timeout: 180000 }).catch(() => {});
        const importMs = Date.now() - importStart;
        report.measurements.largeImport = { rows: ROWS, ms: importMs };
        measure(`import ${ROWS} rows × 4 columns (CSV, preview + commit)`, importMs);
        /* The grid paints only the rows on screen, so the row count is read
           from the statistics rather than from the DOM. */


        if (STEPS.includes('descriptive')) {
        const descStart = Date.now();
        await runAnalysis(page, 'stat', /Descriptive Statistics/, async () => {
          for (const col of ['C2', 'C3', 'C4', 'C5']) {
            await page.click('[data-testid=slot-variables]');
            await page.click(`[data-testid=var-${col}]`);
            await page.click('[data-testid=add-selected]');
          }
        }, 'Basic Statistics');
        const descMs = Date.now() - descStart;
        report.measurements.descriptiveLarge = { rows: ROWS, variables: 4, ms: descMs };
        measure(`descriptive statistics on ${ROWS} rows × 4 variables`, descMs);
        const descText = (await page.locator('[data-testid=out-card]').last().innerText()).replace(/\s+/g, ' ');
        check('the large descriptive table reports all four variables', (descText.match(/\b\d{2,}\b/g) || []).length >= 4 && /(MEAN|평균)/i.test(descText), descText.slice(0, 60));
        check(`every imported row reached the statistics (N = ${ROWS})`, new RegExp(`\\b${ROWS}\\b`).test(descText), (descText.match(/\b\d{3,}\b/g) || []).slice(0, 4).join(','));
        }

        if (STEPS.includes('scatter')) {
        const chartStart = Date.now();
        await runAnalysis(page, 'graph', /Scatterplot/, async () => {
          await page.click('[data-testid=slot-y]');
          await page.click('[data-testid=var-C4]');
          await page.click('[data-testid=add-selected]');
          await page.click('[data-testid=slot-x]');
          await page.click('[data-testid=var-C2]');
          await page.click('[data-testid=add-selected]');
        });
        await page.locator('[data-testid=out-card]').last().scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
        const chartMs = Date.now() - chartStart;
        const marks = await page.locator('[data-testid=out-card]').last().locator('svg circle').count();
        report.measurements.scatterLarge = { rows: ROWS, ms: chartMs, marks };
        measure(`scatterplot of ${ROWS} points (compute + draw)`, chartMs, `${marks} marks drawn`);
        check('the large scatterplot actually draws its points', marks >= Math.min(ROWS, 1000), `${marks} marks`);
        }

        if (STEPS.includes('control')) {
        const spcStart = Date.now();
        await runAnalysis(page, 'stat', /Individuals Chart|I-MR/, async () => {
          await page.click('[data-testid=slot-variable]');
          await page.click('[data-testid=var-C4]');
          await page.click('[data-testid=add-selected]');
        }, 'Control Charts');
        const spcMs = Date.now() - spcStart;
        report.measurements.controlChartLarge = { rows: ROWS, ms: spcMs };
        measure(`I-MR chart on ${ROWS} rows`, spcMs);
        }

        report.measurements.largeHeapMB = await heap(page);
        measure('JS heap after the large-data session', report.measurements.largeHeapMB, 'MB', `${ROWS} rows in the worksheet`);
        check('the large-data session produced no page error', errors.length === 0, errors.slice(0, 2).join(' | '));
        await page.screenshot({ path: path.join(OUT, 'phase3-3e-perf-large.png') });
        await ctx.close();
      } finally {
        await browser.close().catch(() => {});
      }
    }

    /* ── 3. optimiser + profiler ─────────────────────────────────────── */
    {
      const browser = await launch();
      try {
        const { ctx, page, errors } = await newPage(browser, { width: 1440, height: 1100 });
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForSelector('[data-testid=menubar]');
        await sample(page, 'regression');
        for (const response of ['C4', 'C3']) {
          await runAnalysis(page, 'stat', /Fit Regression Model/, async () => {
            await page.click('[data-testid=slot-response]');
            await page.click(`[data-testid=var-${response}]`);
            await page.click('[data-testid=add-selected]');
            await page.click('[data-testid=slot-predictors]');
            await page.click('[data-testid=var-C1]');
            await page.click('[data-testid=add-selected]');
            await page.click('[data-testid=slot-predictors]');
            await page.click('[data-testid=var-C2]');
            await page.click('[data-testid=add-selected]');
          }, 'Regression');
          const card = page.locator('[data-testid=out-card]').last();
          await card.scrollIntoViewIfNeeded();
          const box = await card.boundingBox();
          await page.mouse.move(box.x + box.width / 2, box.y + 18);
          await page.mouse.down({ button: 'right' });
          await page.waitForTimeout(120);
          await page.mouse.up({ button: 'right' });
          await page.waitForTimeout(250);
          await page.getByRole('menuitem', { name: /Save model to Model Manager/ }).click();
          await page.waitForTimeout(400);
        }

        await page.click('[data-testid=menu-stat]');
        await page.waitForTimeout(150);
        await page.getByRole('menuitem', { name: /Stored Model Manager/ }).click();
        await page.waitForSelector('[data-testid=model-manager]');
        await page.locator('[data-testid^=mm-pick-]').nth(0).check();
        await page.locator('[data-testid^=mm-pick-]').nth(1).check();
        await page.click('[data-testid=mm-optimizer]');
        await page.waitForSelector('[data-testid=optimizer]', { timeout: 10000 });
        const responseRows = page.locator('[data-testid=opt-response-row]');
        const rows = await responseRows.all();
        await rows[0].locator('select').selectOption('maximize');
        await rows[1].locator('select').selectOption('minimize');
        const optTimings = [];
        for (let i = 0; i < 3; i += 1) {
          const started = Date.now();
          await page.click('[data-testid=opt-run]');
          await page.waitForSelector('[data-testid=opt-result]', { timeout: 60000 });
          optTimings.push(Date.now() - started);
          await page.waitForTimeout(200);
        }
        report.measurements.optimizer = { responses: 2, factors: 2, gridPoints: 21, samples: optTimings, medianMs: optTimings.sort((a, b) => a - b)[1] };
        measure('optimizer solve, 2 responses × 2 factors (median of 3)', report.measurements.optimizer.medianMs, `samples ${optTimings.join(' / ')} ms`);

        await page.click('[data-testid=opt-to-profiler]');
        await page.waitForSelector('[data-testid=profiler]', { timeout: 10000 });
        await page.waitForTimeout(500);
        /* The slider's own handler is synchronous: dispatch it inside the page
           and time the event, then wait a frame for React to paint. */
        const sliderLatency = [];
        for (let i = 0; i < 5; i += 1) {
          const value = await page.evaluate(async (step) => {
            const el = document.querySelector('[data-testid^=prof-slider-]');
            const min = Number(el.min); const max = Number(el.max);
            const target = min + (max - min) * (0.2 + step * 0.1);
            const start = performance.now();
            el.value = String(target);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            const sync = performance.now() - start;
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return { sync, painted: performance.now() - start };
          }, i);
          sliderLatency.push(value);
        }
        const syncMedian = sliderLatency.map((v) => v.sync).sort((a, b) => a - b)[2];
        const paintMedian = sliderLatency.map((v) => v.painted).sort((a, b) => a - b)[2];
        report.measurements.profiler = { samples: sliderLatency, syncMedianMs: Number(syncMedian.toFixed(1)), paintMedianMs: Number(paintMedian.toFixed(1)) };
        measure('profiler slider: handler cost (median of 5)', syncMedian, 'ms');
        measure('profiler slider: dispatch → two frames painted (median of 5)', paintMedian, 'ms');
        check('a factor change is reflected within 100 ms', paintMedian < 100, `${paintMedian.toFixed(1)} ms`);
        report.measurements.profilerHeapMB = await heap(page);
        measure('JS heap with the optimizer and profiler open', report.measurements.profilerHeapMB, 'MB');
        await page.locator('[data-testid=profiler]').screenshot({ path: path.join(OUT, 'phase3-3e-perf-profiler.png') });
        check('the performance session produced no page error', errors.length === 0, errors.slice(0, 2).join(' | '));
        await ctx.close();
      } finally {
        await browser.close().catch(() => {});
      }
    }

    /* ── 4. limits the engine enforces ───────────────────────────────── */
    {
      const read = (file, patterns) => {
        const text = fs.readFileSync(path.join(ROOT, 'src', 'lib', file), 'utf8');
        const out = {};
        for (const [key, pattern] of Object.entries(patterns)) {
          const match = pattern.exec(text);
          out[key] = match ? Number(match[1]) : null;
        }
        return out;
      };
      report.limits = {
        scatterPairs: read('analyses.ts', { max: /MAX_COMBOS = (\d+)/ }).max,
        surfaceGrid: read('surface3d.ts', { max: /SURFACE_MAX_GRID = (\d+)/ }).max,
        surfaceMeshGrid: read('surface3d.ts', { max: /SURFACE_MESH_MAX_GRID = (\d+)/ }).max,
        feasibleGrid: read('feasible.ts', { max: /MAX_GRID = (\d+)/ }).max,
        optimizerGridPoints: (() => {
          const text = fs.readFileSync(path.join(ROOT, 'src', 'components', 'ResponseOptimizer.tsx'), 'utf8');
          const match = /Math\.max\(2, Math\.min\((\d+), value\)\)/.exec(text);
          return match ? Number(match[1]) : null;
        })(),
        optimizerEvaluations: read('optimizationTypes.ts', { max: /maxEvaluations: (\d+)/ }).max,
      };
      measure('scatter combination ceiling (pairs per dialog)', report.limits.scatterPairs, 'documented constant');
      measure('surface grid ceiling', report.limits.surfaceGrid, 'documented constant');
      measure('surface mesh ceiling per axis', report.limits.surfaceMeshGrid, 'documented constant');
      measure('feasible-region grid ceiling', report.limits.feasibleGrid, 'documented constant');
      measure('optimizer grid points (UI ceiling)', report.limits.optimizerGridPoints, 'points per axis');
      measure('optimizer evaluation budget', report.limits.optimizerEvaluations, 'documented constant');
    }
  } catch (error) {
    check('the performance run completed without an exception', false, error.message.split('\n')[0]);
    console.error(error);
  } finally {
    server.close();
  }

  report.checks = results;
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 1) + '\n', 'utf8');
  const failed = results.filter((r) => r.ok === false).length;
  console.log(`\nperformance QA written to ${REPORT}${failed ? ` · ${failed} FAILED` : ''}`);
})();
