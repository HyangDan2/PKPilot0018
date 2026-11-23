/* Sigrún compact top bar · sample-dropdown layer · chart clipboard ·
   floating panels · layout presets — live browser E2E against the built app.

   The sandbox runs Chromium in single-process mode, so the run is split:
     PART=ui      single bar + sample dropdown layer + chart clipboard
     PART=panels  detach/dock + layout presets + PC screenshot
     PART=mobile  390/320 overflow + dropdown layer + mobile screenshot
     (no PART)    every part in order
*/
function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    '/workspace/repos/PKPilot0011/node_modules/playwright',
    '/workspace/repos/PKPilot0015/node_modules/playwright',
    'playwright',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { return require(candidate); } catch { /* try the next install */ }
  }
  throw new Error('playwright is not installed in any known location');
}
const { chromium } = loadPlaywright();

const BASE = process.env.BASE || 'http://localhost:4178/PKPilot0018/';
const OUT = '/workspace/work/pkpilot0018';
const EXE = process.env.CHROME_PATH || '/workspace/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const PART = process.env.PART || 'all';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
}

const MENUITEM = (page, name) => page.getByRole('menuitem', { name, exact: true });

async function topHit(page, x, y) {
  return page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    return el ? el.closest('[data-testid]')?.getAttribute('data-testid') || el.tagName : 'none';
  }, [x, y]);
}

async function loadSample(page, id) {
  await page.click('[data-testid=sample-button]');
  await page.waitForSelector('[data-testid=sample-menu]', { timeout: 8000 });
  await page.click(`[data-testid=sample-${id}]`);
  await page.waitForTimeout(400);
}

async function runHistogram(page) {
  await page.click('[data-testid=quick-hist]');
  await page.waitForSelector('[data-testid=analysis-dialog]', { timeout: 8000 });
  await page.click('[data-testid=slot-variable]');
  await page.click('[data-testid=var-C1]');
  const add = page.locator('[data-testid=add-selected]');
  if (await add.count()) await add.first().click();
  await page.click('[data-testid=dialog-ok]');
  await page.waitForSelector('[data-testid=analysis-dialog]', { state: 'detached', timeout: 15000 });
  await page.waitForTimeout(400);
}

async function pickLayout(page, name) {
  await page.click('[data-testid=menu-view]');
  await page.waitForTimeout(200);
  await MENUITEM(page, 'Panel layout').hover();
  await page.waitForTimeout(300);
  await MENUITEM(page, name).click();
  await page.waitForTimeout(400);
}

async function copyTypes(page) {
  return page.evaluate(async () => {
    try {
      const items = await navigator.clipboard.read();
      return items.flatMap((item) => item.types);
    } catch (error) {
      return ['error:' + error.name];
    }
  });
}

async function partUi(browser, errors) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid=menubar]');

  check('no separate logo header row', (await page.locator('.app-header').count()) === 0);
  const bar = await page.locator('[data-testid=menubar]').boundingBox();
  check('top bar is a single slim line', bar.height >= 36 && bar.height <= 44, `${bar.height}px`);
  check('brand sits inside the menu bar', (await page.locator('[data-testid=menubar] [data-testid=brand]').count()) === 1);
  check('official CSS .mark logo, no svg logo', (await page.locator('[data-testid=menubar] .brand-mark .mark').count()) === 1
    && (await page.locator('[data-testid=menubar] .brand-mark svg').count()) === 0);
  for (const sel of ['[data-testid=lang-ko]', '[data-testid=lang-en]', '[data-testid=theme-toggle]', '[data-testid=menu-button]']) {
    check(`${sel} lives in the bar`, (await page.locator(`[data-testid=menubar] ${sel}`).count()) === 1);
  }
  const centers = await page.evaluate(() => {
    const ids = ['brand', 'menu-file', 'lang-ko', 'theme-toggle', 'menu-button'];
    return ids.map((id) => {
      const r = document.querySelector(`[data-testid=${id}]`).getBoundingClientRect();
      return Math.round(r.top + r.height / 2);
    });
  });
  check('all bar items share one line', Math.max(...centers) - Math.min(...centers) <= 3, centers.join(','));
  const barItems = await page.evaluate(() => {
    const right = (sel) => document.querySelector(sel).getBoundingClientRect().right;
    return { theme: right('[data-testid=theme-toggle]'), kebab: right('[data-testid=menu-button]') };
  });
  check('theme and kebab sit at the right end', barItems.kebab > 1400 && barItems.theme < barItems.kebab, JSON.stringify(barItems));
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('no horizontal overflow at 1440', overflowX <= 1, `${overflowX}px`);
  const workspaceTop = await page.evaluate(() => document.querySelector('.workspace').getBoundingClientRect().top);
  check('workspace starts higher than the old 88px header stack', workspaceTop <= 118, `${Math.round(workspaceTop)}px`);

  await page.click('[data-testid=sample-button]');
  await page.waitForSelector('[data-testid=sample-menu]');
  const menuBox = await page.locator('[data-testid=sample-menu]').boundingBox();
  check('sample dropdown inside the viewport', menuBox.x >= 0 && menuBox.y >= 0
    && menuBox.x + menuBox.width <= 1440 && menuBox.y + menuBox.height <= 900, JSON.stringify(menuBox));
  check('sample dropdown paints on top', (await topHit(page, menuBox.x + menuBox.width / 2, menuBox.y + 30)) === 'sample-menu');
  const lastItem = await page.locator('[data-testid=sample-menu] .menu-item').last().boundingBox();
  const lastHit = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest('[data-testid=sample-menu]') !== null : false;
  }, [lastItem.x + 10, lastItem.y + lastItem.height / 2]);
  check('every sample row is reachable (not clipped)', lastHit);
  const zLayers = await page.evaluate(() => {
    const ids = ['.menubar', '.toolbar', '.output-panel', '.worksheet-panel'];
    return ids.map((sel) => `${sel}:${getComputedStyle(document.querySelector(sel)).zIndex}`);
  });
  check('dropdown layer sits above the toolbars', (await page.evaluate(() => {
    const menu = document.querySelector('[data-testid=sample-menu]');
    const toolbar = document.querySelector('.toolbar');
    return Number(getComputedStyle(menu).zIndex) > Number(getComputedStyle(toolbar).zIndex || 0);
  })), zLayers.join(' '));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('Escape closes the sample dropdown', (await page.locator('[data-testid=sample-menu]').count()) === 0);

  await page.click('[data-testid=menu-file]');
  await page.waitForTimeout(200);
  await MENUITEM(page, 'Sample data').hover();
  await page.waitForTimeout(350);
  check('File ▸ Sample data submenu still lists every dataset', (await page.locator('.submenu [role=menuitem]').count()) >= 7,
    String(await page.locator('.submenu [role=menuitem]').count()));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  await page.click('[data-testid=sample-button]');
  await page.waitForSelector('[data-testid=sample-menu]');
  await page.click('[data-testid=sample-process]');
  await page.waitForTimeout(500);
  await runHistogram(page);
  check('chart copy controls rendered', (await page.locator('[data-testid=chart-copy]').count()) >= 1);
  await page.locator('[data-testid=card-copy]').first().click();
  await page.waitForTimeout(800);
  const clip = await copyTypes(page);
  check('card copy writes a PNG image to the clipboard', clip.includes('image/png'), clip.join(','));
  const toasts = await page.locator('.toast').allInnerTexts();
  check('card copy reports success', toasts.some((text) => /copied|복사/i.test(text)), toasts.join(' | '));
  await page.locator('[data-testid=chart-copy]').first().click();
  await page.waitForTimeout(800);
  const clip2 = await copyTypes(page);
  check('single-chart copy writes a PNG image', clip2.includes('image/png'), clip2.join(','));
  await ctx.close();
}

async function partPanels(browser, errors) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid=menubar]');
  await loadSample(page, 'process');
  await runHistogram(page);

  await page.click('[data-testid=detach-output]');
  await page.waitForTimeout(250);
  check('output detaches into a floating window', (await page.locator('[data-testid=float-output]').count()) === 1);
  check('dock placeholder appears in place', (await page.locator('[data-testid=dock-slot-output]').count()) === 1);
  check('floating window keeps the analysis card', (await page.locator('[data-testid=float-output] [data-testid=out-card]').count()) >= 1);
  const before = await page.locator('[data-testid=float-output]').boundingBox();
  const head = await page.locator('[data-testid=float-output-head]').boundingBox();
  await page.mouse.move(head.x + 60, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(head.x + 180, head.y + 110, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await page.locator('[data-testid=float-output]').boundingBox();
  check('floating window drags by its header', Math.abs(after.x - before.x) > 40 || Math.abs(after.y - before.y) > 30,
    `${Math.round(before.x)},${Math.round(before.y)} → ${Math.round(after.x)},${Math.round(after.y)}`);
  check('dragged window stays on screen', after.x + after.width <= 1441 && after.y + after.height <= 901 && after.x >= -after.width + 96);

  // ── resize from the bottom-right corner ─────────────────────────────
  const chartBefore = await page.locator('[data-testid=float-output] .chart-svg').first().boundingBox();
  const grip = await page.locator('[data-testid=float-output-resize-se]').boundingBox();
  check('bottom-right resize grip is visible', Boolean(grip) && grip.width >= 12 && grip.height >= 12,
    grip ? `${Math.round(grip.width)}×${Math.round(grip.height)}` : 'missing');
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 140, grip.y + grip.height / 2 + 60, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(350);
  const resized = await page.locator('[data-testid=float-output]').boundingBox();
  check('bottom-right corner grows the window', resized.width >= after.width + 100 && resized.height >= after.height + 40,
    `${Math.round(after.width)}×${Math.round(after.height)} → ${Math.round(resized.width)}×${Math.round(resized.height)}`);
  check('resized window stays inside the viewport', resized.x + resized.width <= 1441 && resized.y + resized.height <= 901,
    `${Math.round(resized.x + resized.width)},${Math.round(resized.y + resized.height)}`);
  const chartAfter = await page.locator('[data-testid=float-output] .chart-svg').first().boundingBox();
  check('chart redraws at the new width', chartAfter.width > chartBefore.width + 15,
    `${Math.round(chartBefore.width)} → ${Math.round(chartAfter.width)}`);
  const overflowX = await page.evaluate(() => {
    const body = document.querySelector('[data-testid=float-output] .float-body');
    return body ? body.scrollWidth - body.clientWidth : -1;
  });
  check('resized body does not overflow sideways', overflowX <= 1, `${overflowX}px`);

  await page.click('[data-testid=float-output-dock]');
  await page.waitForTimeout(300);
  check('docking restores the docked output panel', (await page.locator('[data-testid=float-output]').count()) === 0
    && (await page.locator('.output-panel').count()) === 1);

  // the last size survives docking, re-detaching and a page reload
  await page.click('[data-testid=detach-output]');
  await page.waitForTimeout(300);
  const reopened = await page.locator('[data-testid=float-output]').boundingBox();
  check('re-detached window reopens at the resized size', Math.abs(reopened.width - resized.width) <= 3 && Math.abs(reopened.height - resized.height) <= 3,
    `${Math.round(reopened.width)}×${Math.round(reopened.height)} vs ${Math.round(resized.width)}×${Math.round(resized.height)}`);
  await page.click('[data-testid=float-output-dock]');
  await page.waitForTimeout(250);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid=menubar]');
  await page.waitForSelector('[data-testid=detach-output]');
  await page.click('[data-testid=detach-output]');
  await page.waitForTimeout(300);
  const remembered = await page.locator('[data-testid=float-output]').boundingBox();
  check('reloaded page re-detaches at the remembered size', Math.abs(remembered.width - resized.width) <= 3 && Math.abs(remembered.height - resized.height) <= 3,
    `${Math.round(remembered.width)}×${Math.round(remembered.height)} vs ${Math.round(resized.width)}×${Math.round(resized.height)}`);

  // west edge and the minimum-size floor
  const westGrip = await page.locator('[data-testid=float-output-resize-w]').boundingBox();
  const westBefore = await page.locator('[data-testid=float-output]').boundingBox();
  await page.mouse.move(westGrip.x + westGrip.width / 2, westGrip.y + 80);
  await page.mouse.down();
  await page.mouse.move(westGrip.x + westGrip.width / 2 - 120, westGrip.y + 80, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const westAfter = await page.locator('[data-testid=float-output]').boundingBox();
  check('west edge widens the window and keeps its right edge fixed', westAfter.width >= westBefore.width + 100
    && Math.abs((westAfter.x + westAfter.width) - (westBefore.x + westBefore.width)) <= 2,
    `x ${Math.round(westBefore.x)}→${Math.round(westAfter.x)}, w ${Math.round(westBefore.width)}→${Math.round(westAfter.width)}`);
  const minGrip = await page.locator('[data-testid=float-output-resize-se]').boundingBox();
  await page.mouse.move(minGrip.x + minGrip.width / 2, minGrip.y + minGrip.height / 2);
  await page.mouse.down();
  await page.mouse.move(5, 5, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const floored = await page.locator('[data-testid=float-output]').boundingBox();
  check('resize stops at the minimum window size', Math.round(floored.width) === 360 && Math.round(floored.height) === 240,
    `${Math.round(floored.width)}×${Math.round(floored.height)}`);
  await page.click('[data-testid=float-output-dock]');
  await page.waitForTimeout(250);

  await page.click('[data-testid=detach-worksheet]');
  await page.waitForTimeout(250);
  check('worksheet detaches', (await page.locator('[data-testid=float-worksheet]').count()) === 1);
  check('detached worksheet still shows cells', (await page.locator('[data-testid=float-worksheet] .ws-grid, [data-testid=float-worksheet] table').count()) >= 1);
  await page.click('[data-testid=float-worksheet-dock]');
  await page.waitForTimeout(250);
  check('worksheet docks back', (await page.locator('.worksheet-panel').count()) === 1
    && (await page.locator('[data-testid=float-worksheet]').count()) === 0);

  await page.click('[data-testid=detach-navigator]');
  await page.waitForTimeout(250);
  check('navigator detaches', (await page.locator('[data-testid=float-navigator]').count()) === 1);
  await page.click('[data-testid=float-navigator-dock]');
  await page.waitForTimeout(250);
  check('navigator docks back', (await page.locator('.navigator').count()) === 1);

  const outH = async () => (await page.locator('.output-panel').boundingBox()).height;
  const balancedH = await outH();
  await pickLayout(page, 'Worksheet focus');
  const sheetH = await outH();
  check('worksheet-focus preset shrinks the output pane', sheetH < balancedH - 20, `${Math.round(balancedH)} → ${Math.round(sheetH)}`);
  await pickLayout(page, 'Results & charts focus');
  const resultsH = await outH();
  check('results-focus preset enlarges the output pane', resultsH > balancedH + 20, `${Math.round(resultsH)}`);
  await pickLayout(page, 'Full focus (navigator hidden)');
  check('full-focus preset hides the navigator', (await page.locator('[data-testid=navigator]').count()) === 0);
  await pickLayout(page, 'Balanced (default)');
  check('balanced preset restores the navigator', (await page.locator('[data-testid=navigator]').count()) === 1);
  const restoredH = await outH();
  check('balanced preset restores the split', Math.abs(restoredH - balancedH) <= 2, `${Math.round(restoredH)}`);

  await page.screenshot({ path: `${OUT}/ui-compact-pc.png` });
  await ctx.close();
}

async function partMobile(browser, errors) {
  const widths = process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : [390, 320];
  for (const width of widths) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror ${width}: ` + e.message));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid=menubar]');
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${width}px: no horizontal overflow`, ov <= 1, `${ov}px`);
    const brandBox = await page.locator('[data-testid=brand]').boundingBox();
    const actBox = await page.locator('[data-testid=header-actions]').boundingBox();
    check(`${width}px: brand and language/theme/kebab visible`, Boolean(brandBox && actBox)
      && brandBox.x >= 0 && actBox.x + actBox.width <= width + 1);
    const menusBox = await page.locator('.menubar-menus').boundingBox();
    check(`${width}px: menus take their own row`, menusBox.y > brandBox.y + brandBox.height - 2, `${Math.round(menusBox.y)}`);
    const overlap = await page.evaluate(() => {
      const a = document.querySelector('[data-testid=brand]').getBoundingClientRect();
      const b = document.querySelector('[data-testid=header-actions]').getBoundingClientRect();
      return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    });
    check(`${width}px: brand and actions do not overlap`, overlap === 0, `${overlap}px`);
    await page.click('[data-testid=sample-button]');
    await page.waitForSelector('[data-testid=sample-menu]');
    const mb = await page.locator('[data-testid=sample-menu]').boundingBox();
    check(`${width}px: sample dropdown inside viewport`, mb.x >= 0 && mb.width <= width && mb.y + mb.height <= 844, JSON.stringify(mb));
    const hit = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return el ? el.closest('[data-testid=sample-menu]') !== null : false;
    }, [mb.x + 12, mb.y + 24]);
    check(`${width}px: sample dropdown paints on top`, hit);
    await page.keyboard.press('Escape');
    if (width === 390) await page.screenshot({ path: `${OUT}/ui-compact-mobile.png` });
    await ctx.close();
  }
}

(async () => {
  const errors = [];
  const browser = await chromium.launch({
    headless: true,
    executablePath: EXE,
    args: ['--single-process', '--no-zygote', '--disable-gpu', '--disable-dev-shm-usage', '--disable-software-rasterizer'],
  });
  try {
    if (PART === 'all' || PART === 'ui') await partUi(browser, errors);
    if (PART === 'all' || PART === 'panels') await partPanels(browser, errors);
    if (PART === 'all' || PART === 'mobile') await partMobile(browser, errors);
  } finally {
    check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await browser.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed (${PART})`);
  if (failed.length) {
    console.log('failed: ' + failed.map((f) => f.name).join('; '));
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error('E2E crashed:', error);
  process.exitCode = 1;
});
