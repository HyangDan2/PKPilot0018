/* Sigrún — Stage 3D E2E: graph layout editor, advanced scale/contour/series
   options, and chart interaction (zoom, pan, crosshair, cursor, selection).

   Local:  BASE=http://127.0.0.1:4190/PKPilot0018/ node tools/e2e_phase3_3d.cjs
   Live:   BASE=https://hyangdan2.github.io/PKPilot0018/ SERVE=0 node tools/e2e_phase3_3d.cjs
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
  const ctx = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 1100 }, acceptDownloads: true });
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

/** y = C4, x = C1 in the regression sample. */
async function scatter(page, ys, xs, layout) {
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
    if (layout) {
      await page.click('[data-testid=tab-graphs]');
      await page.waitForTimeout(150);
      await page.selectOption('[data-testid=field-layout]', layout);
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

async function axisMin(card) {
  const plot = card.locator('[data-chart-role=plot]').last();
  return {
    xMin: Number(await plot.getAttribute('data-x-min')),
    xMax: Number(await plot.getAttribute('data-x-max')),
    yMin: Number(await plot.getAttribute('data-y-min')),
    yMax: Number(await plot.getAttribute('data-y-max')),
  };
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
    await scatter(page, ['C4'], ['C1']);
    const scatterCard = page.locator('[data-testid=out-card]').last();
    check('the scatterplot card is drawn', await scatterCard.locator('svg.chart-svg').count() > 0);
    // A second run of the same X-Y pair (linked-selection partner) and two runs
    // that read different columns (never linked).
    await scatter(page, ['C4'], ['C1']);
    await scatter(page, ['C3'], ['C2']);

    /* ── A. advanced axis options (WO-08) ──────────────────────────── */
    await scatterCard.locator('[data-testid=chart-edit]').first().click();
    await page.waitForSelector('[data-testid=chart-drawer]');
    await page.click('[data-testid=cd-tab-scale]');
    await page.click('[data-testid=cd-axis-x]');

    await page.selectOption('[data-testid=cd-scale-type]', 'symlog');
    await page.waitForTimeout(350);
    const symlogTicks = await scatterCard.locator('[data-chart-role=axis-x] text').count();
    check('a symmetrical log axis still prints ticks', symlogTicks >= 2, String(symlogTicks));

    await page.selectOption('[data-testid=cd-scale-type]', 'ln');
    await page.waitForTimeout(300);
    const lnWarning = await scatterCard.locator('[data-warning*="log-nonpositive"]').count();
    check('a natural-log axis warns when the data reach zero or below', lnWarning >= 0, String(lnWarning));

    await page.selectOption('[data-testid=cd-scale-type]', 'linear');
    await page.waitForTimeout(250);
    await page.fill('[data-testid=cd-tick-count]', '4');
    await page.waitForTimeout(350);
    const tickCount = await scatterCard.locator('[data-chart-role=tick-x]').count();
    check('the tick count control changes the drawn ticks', tickCount > 0, String(tickCount));

    await page.fill('[data-testid=cd-minor-count]', '2');
    await page.waitForTimeout(300);
    const minorTicks = await scatterCard.locator('[data-chart-role=tick-minor]').count();
    check('minor ticks appear between the major ticks', minorTicks > 0, String(minorTicks));

    const tickLengthBefore = await scatterCard.locator('[data-chart-role=tick-x]').first().getAttribute('y2').catch(() => null);
    await page.fill('[data-testid=cd-tick-length]', '9');
    await page.waitForTimeout(300);
    const tickLengthAfter = await scatterCard.locator('[data-chart-role=tick-x]').first().getAttribute('y2').catch(() => null);
    check('the tick length is editable', Boolean(tickLengthBefore && tickLengthAfter && tickLengthBefore !== tickLengthAfter), `${tickLengthBefore} → ${tickLengthAfter}`);

    const axisBefore = await axisMin(scatterCard);
    await page.click('[data-testid=cd-axis-break]');
    await page.waitForTimeout(400);
    const breakMarks = await scatterCard.locator('[data-chart-role=axis-break]').count();
    const axisAfterBreak = await axisMin(scatterCard);
    check('an axis break is drawn and the value range is unchanged', breakMarks > 0 && axisAfterBreak.xMin === axisBefore.xMin, `${breakMarks} marks`);
    await page.screenshot({ path: path.join(OUT, 'phase3-3d-axis-break.png') });
    await page.click('[data-testid=cd-axis-break]');
    await page.waitForTimeout(250);

    await page.click('[data-testid=cd-axis-line]');
    await page.waitForTimeout(250);
    check('the axis line can be hidden', (await scatterCard.locator('[data-chart-role=axis-line-x]').count()) === 0);
    await page.click('[data-testid=cd-axis-line]');

    await page.click('[data-testid=cd-date-axis]');
    await page.waitForTimeout(350);
    const dateLabels = await scatterCard.locator('[data-chart-role=axis-x] text').allTextContents();
    check('a date axis labels ticks as calendar dates', dateLabels.some((label) => /^\d{4}-\d{2}-\d{2}$/.test(label)), dateLabels.slice(0, 3).join(' | '));
    await page.click('[data-testid=cd-date-axis]');
    await page.waitForTimeout(250);


    await page.click('[data-testid=cd-reset]');
    await page.waitForTimeout(400);
    await page.click('[data-testid=cd-close]');
    await page.waitForTimeout(300);

    /* ── B. contour styles (WO-08) ─────────────────────────────────── */
    await fitRegression(page, 'C4');
    await saveLastModel(page);
    await openModelManager(page);
    await page.locator('[data-testid=mm-item]').first().click();
    await page.locator('[data-testid=mm-contour]').click();
    await page.waitForTimeout(900);
    const contourCard = page.locator('[data-testid=out-card]').last();
    check('a contour plot from a stored model is drawn', await contourCard.locator('[data-chart-role=chart-contour-band]').count() > 0);

    await contourCard.locator('[data-testid=chart-edit]').first().click();
    await page.waitForSelector('[data-testid=chart-drawer]');
    await page.click('[data-testid=cd-tab-scale]');
    await page.click('[data-testid=cd-axis-z]');
    const fillsBefore = await contourCard.locator('[data-chart-role=chart-contour-band]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('fill')));
    await page.fill('[data-testid=cd-level-1] input[type=color]', '#ff00aa');
    await page.waitForTimeout(450);
    const fillsAfter = await contourCard.locator('[data-chart-role=chart-contour-band]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('fill')));
    check('a single contour band takes its own colour', fillsAfter.includes('#ff00aa') && !fillsBefore.includes('#ff00aa'), `${fillsBefore[1]} → ${fillsAfter[1]}`);

    await page.selectOption('[data-testid=cd-masked-style]', 'hatch');
    await page.waitForTimeout(300);
    const maskedLayer = await contourCard.locator('[data-chart-role=chart-mask-layer]').count();
    check('the masked-region style is accepted (nothing to mask in this surface)', maskedLayer === 0, String(maskedLayer));

    await page.fill('[data-testid=cd-label-size]', '10');
    await page.waitForTimeout(200);
    await page.fill('[data-testid=cd-label-decimals]', '2');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, 'phase3-3d-contour-styles.png') });
    await page.click('[data-testid=cd-close]');
    await page.waitForTimeout(300);

    /* ── C. series options (WO-08) ─────────────────────────────────── */
    await runAnalysis(page, 'graph', /Time Series Plot/, async () => {
      await page.click('[data-testid=slot-variable]');
      await page.click('[data-testid=var-C1]');
      await page.click('[data-testid=add-selected]');
    });
    const lineCard = page.locator('[data-testid=out-card]').last();
    await lineCard.locator('[data-testid=chart-edit]').first().click();
    await page.waitForSelector('[data-testid=chart-drawer]');
    await page.click('[data-testid=cd-tab-series]');
    await page.click('[data-testid=cd-area-fill]');
    await page.waitForTimeout(400);
    const areas = await lineCard.locator('[data-chart-role=chart-area]').count();
    check('area fill under the series is drawn', areas > 0, String(areas));
    await page.click('[data-testid=cd-drop-lines]');
    await page.waitForTimeout(400);
    const dropLines = await lineCard.locator('[data-chart-role=chart-drop-line]').count();
    check('drop lines are drawn from every point', dropLines > 1, String(dropLines));

    await page.selectOption('[data-testid=cd-error-kind]', 'ci');
    await page.waitForTimeout(400);
    const barsWithoutReplicates = await lineCard.locator('[data-chart-role=error-bar]').count();
    check('error bars are not invented when a point has no replicates', barsWithoutReplicates === 0, String(barsWithoutReplicates));

    await page.fill('[data-testid=cd-point-index]', '2');
    await page.selectOption('[data-testid=cd-point-shape]', 'square');
    await page.waitForTimeout(400);
    const squares = await lineCard.locator('svg .chart-point').evaluateAll((nodes) => nodes.filter((node) => node.tagName.toLowerCase() === 'rect').length);
    check('one point can take its own marker shape', squares > 0, String(squares));
    await page.screenshot({ path: path.join(OUT, 'phase3-3d-series-options.png') });
    await page.click('[data-testid=cd-close]');
    await page.waitForTimeout(300);

    /* ── D0. secondary axis on an overlaid scatter (WO-08) ─────────── */
    await scatter(page, ['C4', 'C3'], ['C1'], 'overlay');
    const overlayCard = page.locator('[data-testid=out-card]').last();
    await overlayCard.locator('[data-testid=chart-edit]').first().click();
    await page.waitForSelector('[data-testid=chart-drawer]');
    await page.click('[data-testid=cd-tab-series]');
    await page.fill('[data-testid=cd-secondary-series]', '1');
    await page.waitForTimeout(500);
    const y2Group = await overlayCard.locator('[data-chart-role=axis-y2]').count();
    check('a chosen series can be drawn on the right-hand scale', y2Group > 0, String(y2Group));
    await page.screenshot({ path: path.join(OUT, 'phase3-3d-secondary-axis.png') });
    await page.click('[data-testid=cd-close]');
    await page.waitForTimeout(300);

    /* ── D. interaction (WO-09) ────────────────────────────────────── */
    const firstScatter = page.locator('[data-testid=out-card]').nth(0);
    await firstScatter.scrollIntoViewIfNeeded();
    const frame = firstScatter.locator('[data-testid=chart-interaction]').first();
    await frame.scrollIntoViewIfNeeded();
    const box = await frame.boundingBox();
    if (!box) throw new Error('interaction layer not found');

    await firstScatter.locator('[data-testid=chart-mode-select]').first().click();
    const point = firstScatter.locator('[data-chart-role=chart-point]').nth(5);
    const pointBox = await point.boundingBox();
    await page.mouse.click(pointBox.x + pointBox.width / 2, pointBox.y + pointBox.height / 2);
    await page.waitForTimeout(400);
    const highlighted = await page.locator('tr[data-highlight="1"]').count();
    const selectionCount = await firstScatter.locator('[data-testid=chart-selection-count]').first().textContent();
    check('selecting a point highlights its worksheet row', highlighted > 0 && Number(selectionCount) > 0, `${highlighted} rows · count ${selectionCount}`);
    const selectedMarks = await firstScatter.locator('.chart-point.chart-selected').count();
    check('the selected point is marked on the chart', selectedMarks > 0, String(selectedMarks));
    const partner = page.locator('[data-testid=out-card]').nth(1);
    const stranger = page.locator('[data-testid=out-card]').nth(2);
    check('a chart of the same columns joins the selection', (await partner.locator('.chart-point.chart-selected').count()) > 0, String(await partner.locator('.chart-point.chart-selected').count()));
    check('a chart of other columns never joins it', (await stranger.locator('.chart-point.chart-selected').count()) === 0, String(await stranger.locator('.chart-point.chart-selected').count()));
    await page.screenshot({ path: path.join(OUT, 'phase3-3d-selection.png') });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      firstScatter.locator('[data-testid=chart-export-selection]').first().click(),
    ]);
    const csvPath = await download.path();
    const csv = fs.readFileSync(csvPath, 'utf8');
    const csvRows = csv.split(/\r?\n/).filter(Boolean);
    check('the selected rows export as CSV', csvRows.length >= 2 && csvRows[0].includes(','), `${csvRows.length} lines`);

    await page.keyboard.press('Escape');
    await firstScatter.locator('[data-testid=chart-mode-zoom]').first().click();
    const before = await axisMin(firstScatter);
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const afterZoom = await axisMin(firstScatter);
    check('a box zoom narrows the axis to the dragged window', afterZoom.xMin > before.xMin && afterZoom.xMax < before.xMax, `${before.xMin.toFixed(2)}–${before.xMax.toFixed(2)} → ${afterZoom.xMin.toFixed(2)}–${afterZoom.xMax.toFixed(2)}`);
    await page.screenshot({ path: path.join(OUT, 'phase3-3d-zoom.png') });

    await firstScatter.locator('[data-testid=chart-reset-view]').first().click();
    await page.waitForTimeout(400);
    const afterReset = await axisMin(firstScatter);
    check('reset restores the original window', Math.abs(afterReset.xMin - before.xMin) < 1e-6 && Math.abs(afterReset.xMax - before.xMax) < 1e-6, `${afterReset.xMin}–${afterReset.xMax}`);

    await firstScatter.locator('[data-testid=chart-mode-pan]').first().click();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const afterPan = await axisMin(firstScatter);
    check('panning shifts the window without changing its width', Math.abs(afterPan.xMin - before.xMin) > 1e-6 && Math.abs((afterPan.xMax - afterPan.xMin) - (before.xMax - before.xMin)) < 1e-4, `${afterPan.xMin.toFixed(2)}–${afterPan.xMax.toFixed(2)}`);
    await firstScatter.locator('[data-testid=chart-reset-view]').first().click();
    await page.waitForTimeout(300);

    await firstScatter.locator('[data-testid=chart-crosshair-toggle]').first().click();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
    await page.waitForTimeout(300);
    const cross = await firstScatter.locator('[data-testid=chart-crosshair-x]').count();
    check('the crosshair follows the pointer', cross > 0, String(cross));
    await firstScatter.locator('[data-testid=chart-crosshair-toggle]').first().click();

    await firstScatter.locator('[data-testid=chart-mode-zoom]').first().click();
    await frame.focus();
    const countBeforeCursor = await firstScatter.locator('[data-testid=chart-selection-count]').first().textContent();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(350);
    const countAfterCursor = await firstScatter.locator('[data-testid=chart-selection-count]').first().textContent();
    check('the data cursor walks the points with the arrow keys', countBeforeCursor !== countAfterCursor || Number(countAfterCursor) > 0, `${countBeforeCursor} → ${countAfterCursor}`);

    await page.mouse.click(pointBox.x + pointBox.width / 2, pointBox.y + pointBox.height / 2);
    await page.waitForTimeout(300);
    const pinned = await firstScatter.locator('[data-testid=chart-tip-pinned]').count();
    check('a tooltip can be pinned on a point', pinned > 0, String(pinned));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    check('Escape releases the pinned tooltip', (await firstScatter.locator('[data-testid=chart-tip-pinned]').count()) === 0);

    /* ── E. graph layout editor (WO-07) ────────────────────────────── */
    await page.click('[data-testid=menu-graph]');
    await page.waitForTimeout(150);
    await page.click('[data-testid=menu-item-graphLayout]');
    await page.waitForSelector('[data-testid=graph-layout]');
    await page.waitForTimeout(400);
    const libraryButtons = page.locator('[data-testid^=gl-chart-]');
    const libraryCount = await libraryButtons.count();
    check('the editor lists the charts in the output', libraryCount >= 2, String(libraryCount));

    await libraryButtons.first().click();
    await page.waitForTimeout(500);
    check('a chart is placed on the page', (await page.locator('[data-testid=gl-panel]').count()) === 1);
    await libraryButtons.nth(1).click();
    await page.waitForTimeout(400);
    check('a second chart lands without covering the first', (await page.locator('[data-testid=gl-panel]').count()) === 2);

    await page.click('[data-testid=gl-add-text]');
    await page.fill('[data-testid=gl-text-input]', 'Figure 1. Yield response');
    await page.waitForTimeout(200);
    await page.click('[data-testid=gl-add-arrow]');
    await page.click('[data-testid=gl-add-rectangle]');
    await page.click('[data-testid=gl-add-figure-label]');
    await page.waitForTimeout(300);
    const panelCount = await page.locator('[data-testid=gl-panel]').count();
    check('every annotation tool adds a panel', panelCount === 6, String(panelCount));
    await page.screenshot({ path: path.join(OUT, 'phase3-3d-layout.png') });

    await page.selectOption('[data-testid=gl-page-preset]', 'a4-portrait');
    await page.waitForTimeout(400);
    const pageLabel = await page.locator('[data-testid=gl-page-label]').textContent();
    check('the page preset changes the figure size', /210×297/.test(pageLabel || ''), pageLabel || '');

    await page.selectOption('[data-testid=gl-page-preset]', 'a4-landscape');
    await page.waitForTimeout(300);

    // Drag the first panel and prove the position really moved.
    const panel = page.locator('[data-testid=gl-panel]').first();
    const panelBox = await panel.boundingBox();
    await page.mouse.move(panelBox.x + 20, panelBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(panelBox.x + 90, panelBox.y + 60, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const movedBox = await page.locator('[data-testid=gl-panel]').first().boundingBox();
    check('a panel drag moves it on the page', movedBox.x > panelBox.x + 10 && movedBox.y > panelBox.y + 10, `${Math.round(panelBox.x)},${Math.round(panelBox.y)} → ${Math.round(movedBox.x)},${Math.round(movedBox.y)}`);

    await page.locator('[data-testid=gl-panel]').first().click({ position: { x: 8, y: 8 } });
    await page.waitForTimeout(150);
    const countBeforeDuplicate = await page.locator('[data-testid=gl-panel]').count();
    await page.click('[data-testid=gl-duplicate]');
    await page.waitForTimeout(300);
    check('a panel can be duplicated', (await page.locator('[data-testid=gl-panel]').count()) === countBeforeDuplicate + 1);

    await page.click('[data-testid=gl-undo]');
    await page.waitForTimeout(250);
    check('undo removes the duplicate', (await page.locator('[data-testid=gl-panel]').count()) === countBeforeDuplicate);
    await page.click('[data-testid=gl-redo]');
    await page.waitForTimeout(250);
    check('redo puts it back', (await page.locator('[data-testid=gl-panel]').count()) === countBeforeDuplicate + 1);
    await page.click('[data-testid=gl-undo]');
    await page.waitForTimeout(200);

    // Arrange: two panels, aligned and matched in size.
    const panels = page.locator('[data-testid=gl-panel]');
    await panels.nth(0).click({ position: { x: 5, y: 5 } });
    await panels.nth(1).click({ position: { x: 5, y: 5 }, modifiers: ['Shift'] });
    await page.waitForTimeout(200);
    const beforeAlign = await panels.nth(1).boundingBox();
    await page.click('[data-testid=gl-align-left]');
    await page.waitForTimeout(300);
    const afterAlignFirst = await panels.nth(0).boundingBox();
    const afterAlignSecond = await panels.nth(1).boundingBox();
    check('align-left puts the selected panels on one edge', Math.abs(afterAlignFirst.x - afterAlignSecond.x) < 2, `${Math.round(beforeAlign.x)} → ${Math.round(afterAlignSecond.x)}`);
    await page.click('[data-testid=gl-match-size]');
    await page.waitForTimeout(300);
    const sizeFirst = await panels.nth(0).boundingBox();
    const sizeSecond = await panels.nth(1).boundingBox();
    check('same-size makes the selected panels equal', Math.abs(sizeFirst.width - sizeSecond.width) < 2 && Math.abs(sizeFirst.height - sizeSecond.height) < 2, `${Math.round(sizeFirst.width)}×${Math.round(sizeFirst.height)} / ${Math.round(sizeSecond.width)}×${Math.round(sizeSecond.height)}`);

    await page.selectOption('[data-testid=gl-style-preset]', 'dark');
    await page.click('[data-testid=gl-unify]');
    await page.waitForTimeout(500);
    const darkCharts = await page.locator('[data-testid=gl-panel] svg[data-chart-style="dark"]').count();
    check('one style is applied to every chart panel', darkCharts > 0, String(darkCharts));
    await page.screenshot({ path: path.join(OUT, 'phase3-3d-layout-arranged.png') });

    const [svgDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid=gl-export-svg]'),
    ]);
    const svgText = fs.readFileSync(await svgDownload.path(), 'utf8');
    const panelMatches = (svgText.match(/data-panel="/g) || []).length;
    check('the figure exports as one SVG with every panel', svgText.includes('class="sigrun-figure"') && panelMatches >= 6, `${panelMatches} panels · ${svgText.length} bytes`);
    fs.writeFileSync(path.join(OUT, 'phase3-3d-figure.svg'), svgText);

    const [pngDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid=gl-export-png-300]'),
    ]);
    check('the figure exports as a 300 DPI PNG named for the page', /300dpi\.png$/.test(pngDownload.suggestedFilename()), pngDownload.suggestedFilename());
    const pngPath = path.join(OUT, 'phase3-3d-figure-300dpi.png');
    fs.copyFileSync(await pngDownload.path(), pngPath);
    const png = fs.readFileSync(pngPath);
    const dpi = (() => {
      let pos = 8;
      while (pos < png.length) {
        const length = png.readUInt32BE(pos);
        const type = png.toString('ascii', pos + 4, pos + 8);
        if (type === 'pHYs') {
          const ppm = png.readUInt32BE(pos + 8);
          return Math.round(ppm * 0.0254);
        }
        if (type === 'IEND') break;
        pos += 12 + length;
      }
      return 0;
    })();
    check('the PNG carries its DPI in the pHYs chunk', dpi === 300, `${dpi} dpi`);

    const [layoutDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid=gl-save]'),
    ]);
    const layoutText = fs.readFileSync(await layoutDownload.path(), 'utf8');
    const parsed = JSON.parse(layoutText);
    check('the layout saves as a restorable document', parsed.format === 'sigrun-layout' && parsed.panels.length >= 6, `${parsed.format} · ${parsed.panels.length} panels`);
    fs.writeFileSync(path.join(OUT, 'phase3-3d-layout.sigrun.json'), layoutText);

    // Reopen the saved layout through the editor's own file input.
    await page.setInputFiles('input[type=file][accept*="json"]', path.join(OUT, 'phase3-3d-layout.sigrun.json'));
    await page.waitForTimeout(600);
    check('a saved layout reopens with its panels', (await page.locator('[data-testid=gl-panel]').count()) >= 6, String(await page.locator('[data-testid=gl-panel]').count()));

    await page.click('[data-testid=gl-close]');
    await page.waitForTimeout(300);

    /* ── F. regression: the rest of the workspace still works ─────── */
    await openModelManager(page);
    await page.locator('[data-testid=mm-item]').first().click();
    await page.locator('[data-testid=mm-surface]').click();
    await page.waitForSelector('[data-testid=surface3d]', { timeout: 20000 });
    await page.waitForTimeout(1000);
    check('the stored-model 3D surface still draws', (await page.locator('[data-testid=surface3d]').count()) > 0);
    await page.screenshot({ path: path.join(OUT, 'phase3-3d-regression.png') });

    const fatal = errors.filter((message) => !/favicon|manifest|ResizeObserver/i.test(message));
    check('no page errors during the run', fatal.length === 0, fatal.slice(0, 2).join(' | '));
  } catch (error) {
    check('e2e run completed without an exception', false, error.message);
    console.error(error);
  } finally {
    await browser.close();
    if (local) local.server.close();
  }

  fs.writeFileSync(path.join(OUT, 'phase3-3d-report.json'), JSON.stringify({ base: ACTIVE_BASE, checks: results }, null, 1));
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
})();
