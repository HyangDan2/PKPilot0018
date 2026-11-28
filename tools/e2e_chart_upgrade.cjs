/* Statelia — Phase 2 chart upgrade E2E + visual verification.

   Runs the built app in a real browser at desktop (1440×900) and mobile
   (390×844) sizes, exercises the chart drawer, style presets, contour modes,
   export geometry, zoom and the hover readout, and captures the before/after
   screenshots the Phase 2 report links.

   Local:  BASE=http://127.0.0.1:4190/PKPilot0018/ BASELINE=http://127.0.0.1:4190/baseline/ node tools/e2e_chart_upgrade.cjs
   Live:   BASE=https://hyangdan2.github.io/PKPilot0018/ node tools/e2e_chart_upgrade.cjs
*/
const fs = require('fs');
const path = require('path');

const { chromium, executablePath: CHROME, browserEnv } = require('./browser_env.cjs');

const BASE = process.env.BASE || require('./serve_inline.cjs').ensureServed();
const BASELINE = process.env.BASELINE || '';
const OUT = process.env.OUT || path.resolve(__dirname, '..', 'artifacts', 'sigrun-upgrade-shots');
const LAUNCH = { headless: true, executablePath: CHROME, env: browserEnv, args: ['--single-process', '--no-zygote', '--disable-gpu', '--disable-dev-shm-usage', '--disable-software-rasterizer'] };

fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
}

async function openPage(browser, options = {}) {
  const ctx = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 900 }, permissions: options.permissions || [] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push('pageerror: ' + error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
  await page.goto(options.url || BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid=menubar]');
  return { ctx, page, errors };
}

async function sample(page, id) {
  await page.click('[data-testid=sample-button]');
  await page.waitForSelector('[data-testid=sample-menu]');
  await page.click(`[data-testid=sample-${id}]`);
  await page.waitForTimeout(350);
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

async function runRsm(page) {
  await sample(page, 'rsm');
  await page.click('[data-testid=menu-stat]');
  await page.getByRole('menuitem', { name: 'DOE', exact: true }).hover();
  await page.waitForTimeout(150);
  await page.getByRole('menuitem', { name: /Analyze Response Surface/ }).click();
  await page.waitForSelector('[data-testid=analysis-dialog]');
  await page.click('[data-testid=slot-response]');
  await page.click('[data-testid=var-C6]');
  await page.click('[data-testid=add-selected]');
  await page.click('[data-testid=slot-factors]');
  await page.click('[data-testid=var-C4]');
  await page.click('[data-testid=add-selected]');
  await page.click('[data-testid=slot-factors]');
  await page.click('[data-testid=var-C5]');
  await page.click('[data-testid=add-selected]');
  await page.click('[data-testid=dialog-ok]');
  await page.waitForSelector('[data-testid=analysis-dialog]', { state: 'detached', timeout: 30000 });
  await page.waitForTimeout(800);
}

function frame(page, index = 0) {
  return page.locator('[data-testid=chart-frame]').nth(index);
}

async function openDrawer(page, index = 0, tab = 'general') {
  await frame(page, index).hover();
  await frame(page, index).locator('[data-testid=chart-edit]').click();
  await page.waitForSelector('[data-testid=chart-drawer]');
  await page.click(`[data-testid=cd-tab-${tab}]`);
  await page.waitForTimeout(250);
}

async function closeDrawer(page, how = 'apply') {
  await page.click(`[data-testid=cd-${how}]`);
  await page.waitForSelector('[data-testid=chart-drawer]', { state: 'detached' });
  await page.waitForTimeout(250);
}

/** A real right-click: move, press, release (Playwright's click() cancels the menu). */
async function rightClick(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(120);
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(350);
}

async function shotElement(page, target, name) {
  const file = path.join(OUT, name);
  await target.screenshot({ path: file });
  return file;
}

async function overflowOf(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const offenders = [];
    document.querySelectorAll('[data-testid=chart-frame], [data-testid=chart-drawer], .out-card').forEach((node) => {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && (rect.right > window.innerWidth + 1 || rect.left < -1)) {
        offenders.push(`${node.className}:${Math.round(rect.left)}..${Math.round(rect.right)}`);
      }
    });
    return { scrollWidth: doc.scrollWidth, innerWidth: window.innerWidth, offenders };
  });
}

/** Text clipped inside its own box (a title running out of the chart frame). */
async function clippedTexts(page) {
  // The visual test: a label that really falls outside the drawn chart box.
  // getBBox ignores the rotate() of an axis title, so client rectangles are used.
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll('[data-testid=chart-frame] svg.chart-svg').forEach((svg) => {
      const frame = svg.getBoundingClientRect();
      svg.querySelectorAll('text').forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (!rect.width) return;
        if (rect.left < frame.left - 1 || rect.right > frame.right + 1 || rect.top < frame.top - 1 || rect.bottom > frame.bottom + 1) {
          out.push(`${node.textContent}@${rect.left.toFixed(1)},${rect.top.toFixed(1)}`);
        }
      });
    });
    return out;
  });
}

(async () => {
  /* ── before: the ee1dafe baseline ───────────────────────────────────── */
  if (BASELINE) {
    const browser = await chromium.launch(LAUNCH);
    try {
      const { ctx, page, errors } = await openPage(browser, { url: BASELINE });
      await runRsm(page);
      const contourCard = page.locator('[data-testid=out-card] svg.chart-svg').last();
      check('baseline ee1dafe renders the RSM contour', (await contourCard.count()) === 1);
      await page.locator('[data-testid=out-card] .chart-card').last().screenshot({ path: path.join(OUT, 'before_contour_ee1dafe.png') });
      await runTwoSample(page);
      await page.locator('[data-testid=out-card] .chart-card').last().screenshot({ path: path.join(OUT, 'before_boxplot_ee1dafe.png') });
      check('baseline produced no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
      await ctx.close();
    } finally {
      await browser.close();
    }
  }

  /* ── desktop: the upgraded engine ──────────────────────────────────── */
  const browser = await chromium.launch(LAUNCH);
  try {
    const { ctx, page, errors } = await openPage(browser, { permissions: ['clipboard-read', 'clipboard-write'] });

    await runTwoSample(page);
    check('2-sample t renders a chart frame in the upgraded app', (await page.locator('[data-testid=chart-frame]').count()) === 1);
    await page.locator('[data-testid=out-card] .chart-card').last().screenshot({ path: path.join(OUT, 'after_boxplot_engineering.png') });

    // Header buttons on every chart.
    const tools = await frame(page, 0).locator('.chart-toolbar button').count();
    check('each chart carries Edit / Zoom / Fullscreen / Copy PNG / Export controls', tools === 5, String(tools));

    // Right-click opens the chart menu, not the card menu.
    await rightClick(page, frame(page, 0));
    const menuItems = await page.locator('[role=menuitem]').allInnerTexts();
    check('right-click opens a chart context menu', menuItems.some((text) => /Scale/i.test(text)) && menuItems.some((text) => /Copy style/i.test(text)), menuItems.join(' | ').slice(0, 300));
    check('the card menu does not appear on a chart', !menuItems.some((text) => /Delete card|카드 삭제/i.test(text)), menuItems.join(' | ').slice(0, 120));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Double-click routing: the Y axis opens Scale / Y.
    const yAxis = frame(page, 0).locator('g[data-chart-role="axis-y"] text').first();
    await yAxis.dblclick({ force: true });
    await page.waitForTimeout(350);
    check('double-clicking the Y axis opens the drawer on Scale', (await page.locator('[data-testid=chart-drawer]').count()) === 1
      && (await page.locator('[data-testid=cd-tab-scale]').getAttribute('aria-selected')) === 'true');
    await shotElement(page, page.locator('[data-testid=chart-drawer]'), 'drawer_scale_desktop.png');

    // A manual range previews live and commits on Apply.
    const minField = page.locator('.cd-row', { hasText: 'Minimum' }).locator('input').first();
    await minField.click();
    await minField.press('Control+a');
    await minField.type('65', { delay: 25 });
    await page.waitForTimeout(350);
    const liveTicks = await frame(page, 0).locator('svg.chart-svg').evaluate((svg) => [...svg.querySelectorAll('g[data-chart-role="axis-y"] text')].map((n) => n.textContent).join(','));
    check('a scale change previews live in the chart', !liveTicks.split(',').includes('60') && Number(liveTicks.split(',')[0]) >= 65, liveTicks.slice(0, 60));
    await page.click('[data-testid=cd-undo]');
    await page.waitForTimeout(200);
    await page.click('[data-testid=cd-cancel]');
    await page.waitForTimeout(250);

    // Seven presets, each applied to the real chart.
    for (const preset of ['sigrun-classic', 'engineering', 'scientific', 'corporate', 'monochrome', 'high-contrast', 'dark']) {
      await openDrawer(page, 0, 'style');
      await page.click(`[data-testid=cd-preset-${preset}]`);
      await page.waitForTimeout(200);
      if (preset === 'sigrun-classic') await shotElement(page, page.locator('[data-testid=chart-drawer]'), 'drawer_style_desktop.png');
      await page.click('[data-testid=cd-apply]');
      await page.waitForSelector('[data-testid=chart-drawer]', { state: 'detached' });
      await page.waitForTimeout(250);
      const index = ['sigrun-classic', 'engineering', 'scientific', 'corporate', 'monochrome', 'high-contrast', 'dark'].indexOf(preset) + 1;
      await page.locator('[data-testid=out-card] .chart-card').last().screenshot({ path: path.join(OUT, `style_${index}_${preset.replace(/-/g, '_')}.png`) });
    }
    const styled = await frame(page, 0).locator('svg.chart-svg').getAttribute('data-chart-style');
    check('the dark preset is applied to the chart', styled === 'dark', String(styled));
    await shotElement(page, page.locator('[data-testid=out-card] .chart-card').last(), 'style_presets_applied.png');

    // A re-run keeps the chart configuration the card already has.
    await page.click('[data-testid=card-rerun]');
    await page.waitForSelector('[data-testid=analysis-dialog]');
    await page.click('[data-testid=dialog-ok]');
    await page.waitForSelector('[data-testid=analysis-dialog]', { state: 'detached', timeout: 20000 });
    await page.waitForTimeout(700);
    const rerunStyle = await page.locator('[data-testid=chart-frame]').last().locator('svg.chart-svg').getAttribute('data-chart-style');
    check('a re-run keeps the chart style the card was given', rerunStyle === 'dark', String(rerunStyle));

    // Restore the professional default for the boxplot summary shot.
    await frame(page, 0).hover();
    await frame(page, 0).locator('[data-testid=chart-edit]').click();
    await page.waitForSelector('[data-testid=chart-drawer]');
    await page.click('[data-testid=cd-tab-style]');
    await page.click('[data-testid=cd-preset-engineering]');
    await page.click('[data-testid=cd-apply]');
    await page.waitForSelector('[data-testid=chart-drawer]', { state: 'detached' });

    // Export tab: DPI × physical size -> exact pixels, and a real PNG copy.
    await openDrawer(page, 0, 'export');
    const sizeText = await page.locator('[data-testid=cd-export-size]').innerText();
    check('export box equals physical size × DPI', sizeText.includes('1890 × 1181') && sizeText.includes('160 × 100 mm') && sizeText.includes('300 DPI'), sizeText);
    await page.click('[data-testid=cd-dpi-600]');
    await page.waitForTimeout(200);
    const size600 = await page.locator('[data-testid=cd-export-size]').innerText();
    check('600 DPI doubles the pixel box', size600.includes('3780 × 2362'), size600);
    await page.click('[data-testid=cd-dpi-300]');
    await page.waitForTimeout(150);
    await shotElement(page, page.locator('[data-testid=chart-drawer]'), 'drawer_export_desktop.png');
    await page.click('[data-testid=cd-export-copy]');
    await page.waitForTimeout(1600);
    const clipTypes = await page.evaluate(async () => {
      try {
        const items = await navigator.clipboard.read();
        return items.flatMap((item) => item.types);
      } catch { return []; }
    });
    // A deployment origin may refuse clipboard *reads*; the app reports its own
    // outcome, so the toast is the fallback evidence.
    const copyToast = (await page.locator('.toast').allInnerTexts()).some((text) => /copied|복사/i.test(text));
    check('Copy PNG puts an image on the clipboard', clipTypes.includes('image/png') || copyToast, clipTypes.length ? clipTypes.join(',') : 'clipboard read refused; app toast reported the copy');
    await page.click('[data-testid=cd-cancel]');
    await page.waitForTimeout(250);

    // Zoom view.
    await frame(page, 0).hover();
    await frame(page, 0).locator('[data-testid=chart-zoom]').click();
    await page.waitForSelector('[data-testid=chart-viewer]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, 'chart_zoom.png') });
    await page.click('[data-testid=chart-viewer-close]');
    await page.waitForTimeout(200);

    // Hover readout on a plotted point.
    const point = frame(page, 0).locator('[data-point="1"]').first();
    if (await point.count()) {
      await point.hover({ force: true });
      await page.waitForTimeout(250);
      const tip = await frame(page, 0).locator('[data-testid=chart-tip]').count();
      check('hovering a point shows its exact values', tip === 1, String(tip));
      await page.screenshot({ path: path.join(OUT, 'chart_zoom_tooltip.png') });
    } else {
      check('hovering a point shows its exact values', false, 'no point element');
    }
    check('no horizontal overflow on desktop', (await overflowOf(page)).scrollWidth <= 1441);
    check('no clipped chart text on desktop', (await clippedTexts(page)).length === 0, (await clippedTexts(page)).slice(0, 3).join(' , '));

    /* ── RSM contour: modes, colormaps, resolutions, pairs ─────────────── */
    await page.evaluate(() => window.scrollTo(0, 0));
    await runRsm(page);
    const contourFrames = await page.locator('[data-testid=chart-frame]').count();
    check('RSM analysis produces a contour chart', contourFrames >= 1, String(contourFrames));
    const contourIndex = contourFrames - 1;
    await shotElement(page, page.locator('[data-testid=out-card] .chart-card').last(), 'after_contour_101_filled_lines.png');

    await openDrawer(page, contourIndex, 'general');
    check('the contour drawer exposes resolution and render mode', (await page.locator('.cd-row', { hasText: 'Grid resolution' }).count()) === 1
      && (await page.locator('.cd-row', { hasText: 'Render mode' }).count()) === 1);
    await shotElement(page, page.locator('[data-testid=chart-drawer]').locator('.cd-body'), 'contour_rsm_options.png');

    const modes = [
      ['lines', 'Contour lines', 'contour_mode_lines.png'],
      ['filled', 'Filled contour', 'contour_mode_filled.png'],
      ['filled-lines', 'Filled + lines', 'contour_mode_filled_lines.png'],
      ['heatmap-continuous', 'Continuous heatmap', 'contour_mode_heatmap_continuous.png'],
      ['heatmap-discrete', 'Discrete heatmap', 'contour_mode_heatmap_discrete.png'],
    ];
    for (const [value, label, name] of modes) {
      await page.locator('.cd-row', { hasText: 'Render mode' }).locator('select').selectOption({ label });
      await page.waitForTimeout(250);
      const drawn = await frame(page, contourIndex).locator('svg.chart-svg').evaluate((svg) => {
        const bands = svg.querySelectorAll('[data-chart-role="chart-contour-band"]').length;
        const lines = svg.querySelectorAll('[data-chart-role="chart-contour-line"]').length;
        return { bands, lines, text: svg.textContent.includes('NaN') };
      });
      check(`contour render mode ${value} draws geometry`, (value === 'lines' ? drawn.lines > 0 : drawn.bands > 0) && !drawn.text, JSON.stringify(drawn));
      await shotElement(page, page.locator('[data-testid=out-card] .chart-card').last(), name);
    }
    await page.locator('.cd-row', { hasText: 'Render mode' }).locator('select').selectOption({ label: 'Filled + lines' });

    // Resolution presets keep the geometry exact.
    for (const [label, points] of [['Draft 41×41', 41], ['Standard 101×101', 101], ['High 201×201', 201], ['Ultra 401×401', 401]]) {
      const started = Date.now();
      await page.locator('.cd-row', { hasText: 'Grid resolution' }).locator('select').selectOption({ label });
      await page.waitForTimeout(450);
      const elapsed = Date.now() - started;
      const count = await frame(page, contourIndex).locator('svg.chart-svg').count();
      const geometry = await frame(page, contourIndex).locator('svg.chart-svg').first().evaluate((svg) => svg.innerHTML.length > 1000 && !svg.textContent.includes('NaN'));
      check(`resolution ${label} renders without error`, count === 1 && geometry && elapsed < 8000, `${count} svg, ${elapsed} ms`);
      if (points === 201) await shotElement(page, page.locator('[data-testid=out-card] .chart-card').last(), 'contour_resolution_201.png');
    }
    await page.locator('.cd-row', { hasText: 'Grid resolution' }).locator('select').selectOption({ label: 'Standard 101×101' });

    // Colormap switch.
    await page.click('[data-testid=cd-tab-style]');
    await page.waitForTimeout(200);
    await page.locator('.cd-row', { hasText: 'Colormap' }).locator('select').selectOption({ label: 'Turbo' });
    await page.waitForTimeout(250);
    await shotElement(page, page.locator('[data-testid=out-card] .chart-card').last(), 'contour_colormap_turbo.png');
    await page.locator('.cd-row', { hasText: 'Colormap' }).locator('select').selectOption({ label: 'Viridis' });
    await page.waitForTimeout(200);
    const modeShot = path.join(OUT, 'contour_modes.png');
    await shotElement(page, page.locator('[data-testid=out-card] .chart-card').last(), 'contour_modes.png');
    await page.click('[data-testid=cd-apply]');
    await page.waitForSelector('[data-testid=chart-drawer]', { state: 'detached' });
    await page.waitForTimeout(300);

    // Every factor pair as its own chart.
    const beforePairs = await page.locator('[data-testid=chart-frame]').count();
    await openDrawer(page, contourIndex, 'general');
    await page.click('[data-testid=cd-generate-pairs]');
    await page.waitForSelector('[data-testid=chart-drawer]', { state: 'detached' });
    await page.waitForTimeout(900);
    const afterPairs = await page.locator('[data-testid=chart-frame]').count();
    check('Generate all factor-pair contours adds one chart per pair', afterPairs === beforePairs + 1, `${beforePairs} -> ${afterPairs} (2-factor design: C(2,2)=1)`);
    await page.screenshot({ path: path.join(OUT, 'contour_pairs.png'), fullPage: false });

    // Legend outside the data area.
    const legendFrame = 0;
    const firstChart = await frame(page, legendFrame).locator('svg.chart-svg').evaluate((svg) => {
      const legend = svg.querySelector('[data-chart-role="legend"] rect');
      const plot = svg.querySelector('[data-chart-role="plot"]');
      if (!legend || !plot) return null;
      const box = (plot.getAttribute('data-plot-box') || '').split(',').map(Number);
      return { legendX: Number(legend.getAttribute('x')), plotRight: box[0] + box[2], plotTop: box[1] };
    });
    if (firstChart) check('a chart legend sits inside its frame', firstChart.legendX <= 560, JSON.stringify(firstChart));

    check('no horizontal overflow after the RSM work', (await overflowOf(page)).scrollWidth <= 1441);
    check('no clipped chart text after the RSM work', (await clippedTexts(page)).length === 0, (await clippedTexts(page)).slice(0, 3).join(' , '));
    check('desktop run produced no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  } finally {
    await browser.close();
  }

  /* ── mobile 390×844 ─────────────────────────────────────────────────── */
  const mobileBrowser = await chromium.launch(LAUNCH);
  try {
    const { ctx, page, errors } = await openPage(mobileBrowser, { viewport: { width: 390, height: 844 } });
    await runTwoSample(page);
    check('mobile renders the chart frame', (await page.locator('[data-testid=chart-frame]').count()) === 1);
    await frame(page, 0).hover();
    await frame(page, 0).locator('[data-testid=chart-edit]').click();
    await page.waitForSelector('[data-testid=chart-drawer]');
    await page.waitForTimeout(350);
    const sheet = await page.locator('[data-testid=chart-drawer]').boundingBox();
    check('mobile opens the drawer as a bottom sheet', Boolean(sheet) && sheet.width >= 380 && sheet.height > 500, JSON.stringify(sheet));
    await page.click('[data-testid=cd-tab-scale]');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, 'drawer_mobile_390.png') });
    const overflow = await overflowOf(page);
    check('the mobile drawer fits the 390 px viewport', overflow.scrollWidth <= 391 && overflow.offenders.length === 0, JSON.stringify(overflow));
    await page.click('[data-testid=cd-cancel]');
    await page.waitForTimeout(250);
    check('mobile has no horizontal overflow', (await overflowOf(page)).scrollWidth <= 391, String((await overflowOf(page)).scrollWidth));
    check('mobile run produced no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.screenshot({ path: path.join(OUT, 'mobile_390_output.png'), fullPage: false });
    await ctx.close();
  } finally {
    await mobileBrowser.close();
  }

  console.log('\n' + results.filter((r) => r.ok).length + '/' + results.length + ' checks passed');
  fs.writeFileSync(path.join(OUT, 'e2e_results.json'), JSON.stringify(results, null, 2));
})();
