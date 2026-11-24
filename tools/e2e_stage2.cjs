/* Sigrún Stage 2 E2E — scatterplot with several Y and X variables.
   Runs its own static server for dist/, so no preview daemon is needed.

   PART=10 | 11 | 12 | 13 | 14 | shots | all   (default all)
   LIVE=1 runs the same checks against the deployed Pages build.
*/
const http = require('http');
const fs = require('fs');
const path = require('path');

const { chromium, executablePath: CHROME, browserEnv } = require('./browser_env.cjs');

const ROOT = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT || 4184);
const LIVE = process.env.LIVE === '1';
const BASE = LIVE ? 'https://hyangdan2.github.io/PKPilot0018/' : `http://127.0.0.1:${PORT}/PKPilot0018/`;
const OUT = process.env.OUT || path.resolve(__dirname, '..', '..', 'pkpilot0018');
const SHOTS = process.env.SHOTS || OUT;
const PART = process.env.PART || 'all';
const WIDTH = Number(process.env.WIDTH || 1366);
const HEIGHT = Number(process.env.HEIGHT || 900);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serve() {
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (!urlPath.startsWith('/PKPilot0018/')) {
      res.writeHead(404); res.end('not found'); return;
    }
    let rel = urlPath.slice('/PKPilot0018/'.length);
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
}

async function launch() {
  return chromium.launch({
    headless: true,
    executablePath: CHROME,
    env: browserEnv,
    args: ['--single-process', '--no-zygote', '--disable-gpu', '--disable-dev-shm-usage', '--disable-software-rasterizer'],
  });
}

async function freshPage(browser, viewport = { width: WIDTH, height: HEIGHT }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid=worksheet-grid]');
  return { ctx, page, errors };
}

/** File > Sample data > <id> */
async function openSample(page, id) {
  await page.click('[data-testid=menu-file]');
  await page.waitForTimeout(150);
  await page.getByRole('menuitem', { name: /Sample data/i }).hover();
  await page.waitForTimeout(250);
  await page.click(`[data-testid=menu-item-${id}]`);
  await page.waitForTimeout(500);
}

async function openScatter(page) {
  await page.click('[data-testid=menu-graph]');
  await page.waitForTimeout(150);
  await page.click('[data-testid=menu-item-scatter]');
  await page.waitForSelector('[data-testid=analysis-dialog]');
}

/** Double-clicking a variable row puts it in the active slot and moves on. */
async function addVars(page, refs) {
  for (const ref of refs) {
    await page.dblclick(`[data-testid=var-${ref}]`);
    await page.waitForTimeout(80);
  }
}

async function runDialog(page) {
  await page.click('[data-testid=dialog-ok]');
  await page.waitForTimeout(600);
}

const cards = () => '.out-card';
const chartCount = (page, scope = '.out-card') => page.locator(`${scope} .chart-holder`).count();
const gridCount = (page) => page.locator('.out-card .chart-grid .chart-card').count();

async function deleteCell(page, col, row) {
  await page.click(`td[data-row="${row}"][data-col="${col}"]`);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(160);
}

async function part10(browser) {
  console.log('\n── 10. scatterplot Y 1 + X 3 ──');
  const { ctx, page, errors } = await freshPage(browser);
  await openSample(page, 'regression');
  await openScatter(page);
  // Y = Yield (C4); X = Temperature, Pressure, Speed (C1, C2, C3)
  await addVars(page, ['C4', 'C1', 'C2', 'C3']);
  const chips = await page.locator('[data-testid=slot-y] .chip').allInnerTexts();
  check('10: one Y chip', chips.length === 1, chips.join(','));
  const xChips = await page.locator('[data-testid=slot-x] .chip').allInnerTexts();
  check('10: three X chips', xChips.length === 3, xChips.map((s) => s.replace(/\s+/g, ' ').trim()).join(','));
  await runDialog(page);

  const charts = await chartCount(page);
  check('10: three charts drawn', charts === 3, String(charts));
  const captions = await page.locator('.out-card .chart-card h5').allInnerTexts();
  check('10: captions name every pair',
    captions.length === 3 && /yield/i.test(captions[0]) && /temperature/i.test(captions[0]) && /speed/i.test(captions[2]),
    captions.join(' | '));
  const notes = await page.locator('.out-card .chart-holder svg text').allTextContents();
  check('10: Pearson r, R² and the equation are written on the plot',
    notes.some((t) => /Pearson r = /.test(t)) && notes.some((t) => /R² = /.test(t)) && notes.some((t) => /^y = /.test(t)),
    notes.filter((t) => /Pearson|R²|^y =/.test(t)).slice(0, 3).join(' | '));
  const texts = await page.locator('.out-card .out-text').allInnerTexts();
  check('10: n line per plot', texts.filter((t) => /n = \d+/.test(t)).length === 3, texts.join(' | '));
  // A text column is refused by name, not with "not enough data".
  await openScatter(page);
  await addVars(page, ['C5']);   // Shift (text) into Y
  await addVars(page, ['C1']);   // Temperature into X
  await page.click('[data-testid=dialog-ok]');
  await page.waitForTimeout(400);
  const dialogError = await page.locator('[data-testid=dialog-error]').innerText().catch(() => '');
  check('10: a text column is refused by name', /Shift/.test(dialogError) && /not a numeric column/i.test(dialogError), dialogError);
  await page.keyboard.press('Escape');
  check('10: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.screenshot({ path: `${SHOTS}/stage2-10-y1x3.png` });
  await ctx.close();
}

async function part11(browser) {
  console.log('\n── 11. scatterplot Y 2 + X 2, panel layout ──');
  const { ctx, page, errors } = await freshPage(browser);
  await openSample(page, 'regression');
  await openScatter(page);
  await addVars(page, ['C4']);
  // Y = Yield and Pressure; X = Temperature and Speed
  await page.click('[data-testid=slot-y]');
  await addVars(page, ['C2']);
  await page.click('[data-testid=slot-x]');
  await addVars(page, ['C1', 'C3']);
  const yChips = await page.locator('[data-testid=slot-y] .chip').allInnerTexts();
  check('11: two Y chips', yChips.length === 2, yChips.map((s) => s.replace(/\s+/g, ' ').trim()).join(','));
  await page.click('[data-testid=tab-graphs]');
  await page.selectOption('[data-testid=field-layout]', 'panel');
  await page.click('[data-testid=tab-main]');
  await runDialog(page);

  const inGrid = await gridCount(page);
  check('11: four panels in one grid', inGrid === 4, String(inGrid));
  const titles = await page.locator('.out-card .chart-grid h5').allInnerTexts();
  check('11: every panel is titled', titles.length === 4 && /yield/i.test(titles[0]) && /pressure/i.test(titles[2]),
    titles.join(' | '));
  const rows = await page.locator('.out-card table tbody tr').count();
  const headerCells = await page.locator('.out-card table thead th').allInnerTexts();
  check('11: summary table has Y, X, N, r, R², equation, P',
    headerCells.some((h) => /y variable/i.test(h)) && headerCells.some((h) => /x variable/i.test(h)) && headerCells.some((h) => /pearson r/i.test(h)),
    headerCells.join(','));
  check('11: one summary row per combination', rows === 4, String(rows));
  check('11: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.screenshot({ path: `${SHOTS}/stage2-11-y2x2.png` });
  await ctx.close();
}

async function part12(browser) {
  console.log('\n── 12. XY pairs ──');
  const { ctx, page, errors } = await freshPage(browser);
  await openSample(page, 'regression');
  await openScatter(page);
  await addVars(page, ['C4']);         // Y: Yield
  await page.click('[data-testid=slot-y]');
  await addVars(page, ['C2']);         // Y: Pressure
  await page.click('[data-testid=slot-x]');
  await addVars(page, ['C1', 'C3']);   // X: Temperature, Speed
  await page.selectOption('[data-testid=field-mode]', 'pairs');
  await runDialog(page);

  const charts = await chartCount(page);
  check('12: exactly two paired plots', charts === 2, String(charts));
  const captions = await page.locator('.out-card .chart-card h5').allInnerTexts();
  check('12: first Y is paired with the first X, second with the second',
    captions.length === 2 && /yield.*temperature/i.test(captions[0]) && /pressure.*speed/i.test(captions[1]),
    captions.join(' | '));
  // Different list lengths cannot be paired.
  await openScatter(page);
  await addVars(page, ['C4']);
  await page.click('[data-testid=slot-x]');
  await addVars(page, ['C1', 'C3']);
  await page.selectOption('[data-testid=field-mode]', 'pairs');
  await page.click('[data-testid=dialog-ok]');
  await page.waitForTimeout(400);
  const pairsError = await page.locator('[data-testid=dialog-error]').innerText().catch(() => '');
  check('12: unequal lists are refused', /same number of Y variables and X variables/i.test(pairsError), pairsError);
  await page.keyboard.press('Escape');
  check('12: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

async function part13(browser) {
  console.log('\n── 13. groups and missing values ──');
  const { ctx, page, errors } = await freshPage(browser);
  await openSample(page, 'regression');
  // Drop two X values so the pair-count test has something to see.
  await deleteCell(page, 0, 2);
  await deleteCell(page, 0, 5);
  await openScatter(page);
  await addVars(page, ['C4', 'C1']);    // Y: Yield, X: Temperature
  await page.click('[data-testid=slot-by]');
  await addVars(page, ['C5']);          // By: Shift
  await runDialog(page);

  const charts = await chartCount(page);
  check('13: one grouped plot', charts === 1, String(charts));
  const groupCells = await page.locator('td[data-col="4"]').allInnerTexts();
  const groupNames = [...new Set(groupCells.map((s) => s.trim()).filter(Boolean))];
  const legend = await page.locator('.out-card svg text').allTextContents();
  const shown = groupNames.filter((name) => legend.includes(name));
  check('13: the legend names the By groups', shown.length >= 2 && shown.length === groupNames.length,
    groupNames.join(',') + ' → ' + shown.join(','));
  const texts = await page.locator('.out-card .out-text').allInnerTexts();
  check('13: dropped rows are reported as N*', texts.some((t) => /N\* = 2/.test(t)), texts.join(' | '));
  const nLine = texts.find((t) => /n = /.test(t)) ?? '';
  check('13: n equals the complete pairs (46)', /n = 46/.test(nLine), nLine);
  check('13: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.screenshot({ path: `${SHOTS}/stage2-13-groups.png` });
  await ctx.close();
}

const SAVED = `${SHOTS}/stage2-project.sigrun.json`;

/** 14a — build a two-by-two panel scatter and save the project file. */
async function part14a() {
  console.log('\n── 14a. save the project ──');
  const browser = await launch();
  try {
    const { ctx, page, errors } = await freshPage(browser);
    await openSample(page, 'regression');
    await openScatter(page);
    await addVars(page, ['C4']);          // Y: Yield
    await page.click('[data-testid=slot-y]');
    await addVars(page, ['C2']);          // Y: Pressure
    await page.click('[data-testid=slot-x]');
    await addVars(page, ['C1', 'C3']);    // X: Temperature, Speed
    await page.click('[data-testid=tab-graphs]');
    await page.selectOption('[data-testid=field-layout]', 'panel');
    await page.click('[data-testid=tab-main]');
    await runDialog(page);
    check('14: the run produced four panels', (await gridCount(page)) === 4, String(await gridCount(page)));

    await page.click('[data-testid=menu-file]');
    await page.waitForTimeout(150);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid=menu-item-save]'),
    ]);
    await download.saveAs(SAVED);
    check('14: project file saved', fs.existsSync(SAVED) && fs.statSync(SAVED).size > 500, SAVED);
    const project = JSON.parse(fs.readFileSync(SAVED, 'utf8'));
    const scatterOutput = (project.outputs || []).find((o) => o.dialog && o.dialog.analysisId === 'scatter');
    check('14: the file keeps the scatter options',
      Boolean(scatterOutput) && scatterOutput.dialog.values.layout === 'panel'
        && Array.isArray(scatterOutput.dialog.values.y) && scatterOutput.dialog.values.y.length === 2
        && Array.isArray(scatterOutput.dialog.values.x) && scatterOutput.dialog.values.x.length === 2,
      JSON.stringify(scatterOutput?.dialog?.values ?? null).slice(0, 200));
    check('14a: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  } finally {
    await browser.close();
  }
}

/** 14b — a fresh browser (no IndexedDB) restores the run from the file alone. */
async function part14b() {
  console.log('\n── 14b. reopen the project ──');
  if (!fs.existsSync(SAVED)) {
    check('14: project file exists for the reopen test', false, SAVED);
    return;
  }
  const browser = await launch();
  try {
    const { ctx, page, errors } = await freshPage(browser);
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 15000 }).catch(() => null);
    await page.click('[data-testid=menu-file]');
    await page.waitForTimeout(150);
    await page.click('[data-testid=menu-item-open]');
    const chooser = await chooserPromise;
    check('14: the open dialog asks for a project file', Boolean(chooser), chooser ? 'filechooser fired' : 'no filechooser');
    if (chooser) await chooser.setFiles(SAVED);
    await page.waitForTimeout(1400);
    check('14: reopened project restores the four panels', (await gridCount(page)) === 4, String(await gridCount(page)));

    await page.click(`${cards()} [data-testid=card-rerun]`);
    await page.waitForSelector('[data-testid=analysis-dialog]');
    const yChips = await page.locator('[data-testid=slot-y] .chip').allInnerTexts();
    const xChips = await page.locator('[data-testid=slot-x] .chip').allInnerTexts();
    await page.click('[data-testid=tab-graphs]');
    const layout = await page.inputValue('[data-testid=field-layout]');
    await page.click('[data-testid=tab-main]');
    check('14: Y variables come back as chips', yChips.length === 2, yChips.join(','));
    check('14: X variables come back as chips', xChips.length === 2, xChips.join(','));
    check('14: layout comes back as panel', layout === 'panel', layout);
    await page.click('[data-testid=dialog-ok]');
    await page.waitForTimeout(800);
    check('14: rerunning from the restored options still draws four panels', (await gridCount(page)) >= 4,
      String(await gridCount(page)));
    check('14b: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  } finally {
    await browser.close();
  }
}

async function partShots(browser) {
  console.log('\n── screenshots ──');
  const { ctx, page, errors } = await freshPage(browser, { width: 1440, height: 960 });
  await openSample(page, 'regression');
  await openScatter(page);
  await addVars(page, ['C4']);          // Y: Yield
  await page.click('[data-testid=slot-y]');
  await addVars(page, ['C2']);          // Y: Pressure
  await page.click('[data-testid=slot-x]');
  await addVars(page, ['C1', 'C3']);    // X: Temperature, Speed
  await page.click('[data-testid=slot-by]');
  await addVars(page, ['C5']);          // By: Shift
  await page.click('[data-testid=tab-graphs]');
  await page.selectOption('[data-testid=field-layout]', 'panel');
  await page.click('[data-testid=tab-main]');
  await runDialog(page);
  await page.waitForTimeout(700);
  // Give the output the room to show the whole panel grid.
  await page.click('[data-testid=menu-button]');
  await page.waitForTimeout(200);
  await page.click('[data-testid=kebab-layout-results]');
  await page.waitForTimeout(3200);   // let the layout toast clear before the shot
  await page.evaluate(() => { const panel = document.querySelector('[data-testid=output-panel]'); if (panel) panel.scrollTop = 0; });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('shots: no horizontal page overflow', overflow <= 1, `${overflow}px`);
  await page.screenshot({ path: `${OUT}/stage2-scatter-pc.png` });
  await page.screenshot({ path: `${OUT}/stage2-shots-${Date.now()}.png` });
  check('shots: PC screenshot saved', fs.existsSync(`${OUT}/stage2-scatter-pc.png`), `${OUT}/stage2-scatter-pc.png`);
  console.log('shots: subtitle =', (await page.locator('.out-sub').first().innerText()).replace(/\n/g, ' '));
  console.log('shots: panels =', await page.locator('.out-card .chart-grid .chart-card').count());
  check('shots: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

(async () => {
  const server = LIVE ? null : await serve();
  const parts = (PART === 'all' ? ['10', '11', '12', '13', '14', 'shots'] : PART.split(','))
    .flatMap((part) => (part === '14' ? ['14a', '14b'] : [part]));
  try {
    for (const part of parts) {
      if (part === '14a') { await part14a(); await new Promise((r) => setTimeout(r, 1200)); continue; }
      if (part === '14b') { await part14b(); await new Promise((r) => setTimeout(r, 1200)); continue; }
      const browser = await launch();
      try {
        if (part === '10') await part10(browser);
        if (part === '11') await part11(browser);
        if (part === '12') await part12(browser);
        if (part === '13') await part13(browser);
        if (part === 'shots') await partShots(browser);
      } finally {
        await browser.close();
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } finally {
    server?.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed (${PART})`);
  if (failed.length) console.log('failed: ' + failed.map((f) => f.name).join('; '));
})().catch((error) => {
  console.error('E2E crashed:', error);
  process.exitCode = 1;
});
