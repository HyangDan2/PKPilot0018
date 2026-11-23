/* Sigrún Stage 3 E2E — three-panel workspace, focus drawer, classic mode,
   output-card context menu, and the Stage 1–2 regression list (1–15).

   Runs its own static server for dist/:
     node tools/e2e_stage3.cjs                (default: 1366×768 then 1920×1080)
     VIEWPORT=1366x768 node tools/e2e_stage3.cjs
     LIVE=1 node tools/e2e_stage3.cjs         (same checks against GitHub Pages)
     PART=1,3,5 node tools/e2e_stage3.cjs     (a subset, for a single rerun)
*/
const http = require('http');
const fs = require('fs');
const path = require('path');

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    '/workspace/repos/PKPilot0015/node_modules/playwright',
    '/workspace/tmp-pwlibs/root/usr/lib/node_modules/playwright',
    'playwright',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { return require(candidate); } catch { /* try the next install */ }
  }
  throw new Error('playwright is not installed in any known location');
}
const { chromium } = loadPlaywright();

const ROOT = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT || 4186);
const LIVE = process.env.LIVE === '1';
const BASE = LIVE ? 'https://hyangdan2.github.io/PKPilot0018/' : `http://127.0.0.1:${PORT}/PKPilot0018/`;
const OUT = '/workspace/work/pkpilot0018';
const SHOTS = process.env.SHOTS || OUT;
const EXE = process.env.CHROME_PATH || '/workspace/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const VIEWPORTS = (process.env.VIEWPORT || '1366x768,1920x1080').split(',').map((pair) => {
  const [w, h] = pair.split('x').map(Number);
  return { width: w, height: h };
});
const PART = process.env.PART ? new Set(process.env.PART.split(',').map((n) => n.trim())) : null;

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
    executablePath: EXE,
    args: ['--single-process', '--no-zygote', '--disable-gpu', '--disable-dev-shm-usage', '--disable-software-rasterizer'],
  });
}

const box = async (page, selector) => page.locator(selector).first().boundingBox();
const cell = (row, col) => `td[data-row="${row}"][data-col="${col}"]`;

async function drag(page, selector, dx, dy) {
  const target = await box(page, selector);
  if (!target) return false;
  const cx = target.x + target.width / 2;
  const cy = target.y + Math.min(24, target.height / 2);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(220);
  return true;
}

async function loadSample(page, id) {
  await page.click('[data-testid=sample-button]');
  await page.waitForSelector('[data-testid=sample-menu]', { timeout: 8000 });
  await page.click(`[data-testid=sample-${id}]`);
  await page.waitForTimeout(450);
}

async function runDescriptive(page, ref = 'C1') {
  await page.click('[data-testid=quick-desc]');
  await page.waitForSelector('[data-testid=analysis-dialog]', { timeout: 8000 });
  await page.click('[data-testid=slot-variables]');
  await page.click(`[data-testid=var-${ref}]`);
  const add = page.locator('[data-testid=add-selected]');
  if (await add.count()) await add.first().click();
  await page.click('[data-testid=dialog-ok]');
  await page.waitForSelector('[data-testid=analysis-dialog]', { state: 'detached', timeout: 15000 });
  await page.waitForTimeout(500);
}

async function openScatter(page) {
  await page.click('[data-testid=menu-graph]');
  await page.waitForTimeout(160);
  await page.click('[data-testid=menu-item-scatter]');
  await page.waitForSelector('[data-testid=analysis-dialog]');
}

async function addVars(page, refs) {
  for (const ref of refs) {
    await page.dblclick(`[data-testid=var-${ref}]`);
    await page.waitForTimeout(70);
  }
}

async function pickWorkspace(page, id) {
  await page.click(`[data-testid=ws-layout-${id}]`);
  await page.waitForTimeout(320);
}

const layoutOf = (page) => page.getAttribute('[data-testid=workspace]', 'data-layout');

/** Keep every part runnable on its own, in any order. */
async function ensureLayout(page, id) {
  if ((await layoutOf(page)) !== id) await pickWorkspace(page, id);
}

async function ensureDrawer(page) {
  await ensureLayout(page, 'focus');
  if ((await page.locator('[data-testid=worksheet-drawer]').count()) === 0) {
    await page.click('[data-testid=drawer-toggle]');
    await page.waitForTimeout(300);
  }
}

async function ensureCard(page) {
  if ((await page.locator('[data-testid=out-card]').count()) === 0) {
    await loadSample(page, 'process');
    await runDescriptive(page, 'C1');
  }
}

async function runViewport(browser, viewport) {
  const tag = `${viewport.width}×${viewport.height}`;
  const ctx = await browser.newContext({ viewport, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid=worksheet-grid]', { timeout: 15000 });

  /* ── 1. the default: the classic Phase 1 shell ───────────────────── */
  if (!PART || PART.has('1')) {
    console.log(`\n── 1. default workspace — classic shell (${tag}) ──`);
    const layout = await layoutOf(page);
    check(`${tag} · 1: opens in the classic arrangement`, layout === 'classic', String(layout));
    const nav = await box(page, '[data-testid=navigator]');
    const out = await box(page, '.main-panels > .output-panel');
    const sheet = await box(page, '.main-panels > .worksheet-panel');
    check(`${tag} · 1: navigator on the left, output stacked above the worksheet`,
      Boolean(nav && out && sheet) && nav.x < out.x && out.y < sheet.y && Math.abs(out.x - sheet.x) <= 2,
      nav && out && sheet ? `nav ${Math.round(nav.x + nav.width)} | out y ${Math.round(out.y)}–${Math.round(out.y + out.height)} | sheet y ${Math.round(sheet.y)}` : 'missing panels');
    check(`${tag} · 1: the stacked splitter is back`, (await page.locator('[data-testid=splitter-output-h]').count()) === 1);
    check(`${tag} · 1: both stacked panes have real size`,
      Boolean(out && sheet) && out.height > 120 && sheet.height > 120,
      out && sheet ? `${Math.round(out.height)} / ${Math.round(sheet.height)}` : '');

    /* the header keeps the official mark alone */
    const brandText = (await page.locator('[data-testid=brand]').innerText()).trim();
    const brandBox = await box(page, '[data-testid=brand]');
    check(`${tag} · 1: the header shows no wordmark text`, brandText === '', JSON.stringify(brandText));
    check(`${tag} · 1: the dual-skew .mark is what is left`,
      (await page.locator('[data-testid=brand] .mark').count()) === 1 && Boolean(brandBox) && brandBox.width <= 44,
      brandBox ? `${Math.round(brandBox.width)}px wide` : 'missing');
    check(`${tag} · 1: the brand keeps its accessible name`,
      /HD2Lab/.test((await page.locator('[data-testid=brand]').getAttribute('aria-label')) || ''),
      (await page.locator('[data-testid=brand]').getAttribute('aria-label')) || '');
    check(`${tag} · 1: the logo no longer prints an svg`,
      (await page.locator('[data-testid=brand] svg').count()) === 0);

    /* classic is first, the two extras follow */
    const order = await page.locator('[data-testid=ws-switch] [data-testid^=ws-layout-]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
    check(`${tag} · 1: toolbar order is classic · 3-panel · focus`,
      order.join(',') === 'ws-layout-classic,ws-layout-tri,ws-layout-focus', order.join(','));
    check(`${tag} · 1: classic is the pressed switch`,
      (await page.locator('[data-testid=ws-layout-classic]').getAttribute('aria-pressed')) === 'true');

    /* the default survives a reload */
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid=worksheet-grid]', { timeout: 15000 });
    check(`${tag} · 1: classic comes back after a reload`, (await layoutOf(page)) === 'classic', String(await layoutOf(page)));
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('sigrun.workspace.v2') || 'null'));
    check(`${tag} · 1: the workspace is stored under v2`, Boolean(stored) && stored.layout === 'classic', JSON.stringify(stored));

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${tag} · 1: no horizontal page overflow`, overflow <= 1, `${overflow}px`);
  }

  /* ── 1b. Help ▸ About Sigrún wears the full lock-up ──────────────── */
  if (!PART || PART.has('1b')) {
    console.log(`\n── 1b. About Sigrún banner (${tag}) ──`);
    await page.click('[data-testid=menu-help]');
    await page.waitForTimeout(160);
    await page.click('[data-testid=menu-item-about]');
    await page.waitForSelector('[data-testid=about-brand]', { timeout: 8000 });
    const banner = page.locator('[data-testid=about-brand]');
    await page.waitForTimeout(250);
    check(`${tag} · 1b: the about banner is drawn`, (await banner.count()) === 1);
    const bannerText = (await banner.innerText()).replace(/\s+/g, ' ').trim();
    check(`${tag} · 1b: the banner carries mark · HD2Lab · Sigrún · badge`,
      (await banner.locator('.mark').count()) === 1 && /HD2Lab/.test(bannerText) && /Sigrún/.test(bannerText) && /STATISTICAL WORKSPACE/.test(bannerText),
      bannerText);
    const bannerBox = await banner.boundingBox();
    const descBox = await box(page, '.help-body > p');
    check(`${tag} · 1b: the banner sits above the description`,
      Boolean(bannerBox && descBox) && bannerBox.y + bannerBox.height <= descBox.y + 2,
      bannerBox && descBox ? `banner ${Math.round(bannerBox.y)}–${Math.round(bannerBox.y + bannerBox.height)}, description ${Math.round(descBox.y)}` : 'missing');
    await page.click('.modal-foot .btn');
    await page.waitForTimeout(250);
    check(`${tag} · 1b: the modal closes again`, (await page.locator('[data-testid=about-brand]').count()) === 0);
  }

  /* ── 2. splitter widths ──────────────────────────────────────────── */
  if (!PART || PART.has('2')) {
    console.log(`\n── 2. draggable splitters (${tag}) ──`);
    await ensureLayout(page, 'tri');
    const before = { nav: await box(page, '[data-testid=navigator]'), out: await box(page, '.workspace > .output-panel'), sheet: await box(page, '.workspace > .worksheet-panel') };
    await drag(page, '[data-testid=splitter-nav]', 80, 0);
    const afterNav = { nav: await box(page, '[data-testid=navigator]'), out: await box(page, '.workspace > .output-panel'), sheet: await box(page, '.workspace > .worksheet-panel') };
    check(`${tag} · 2: navigator splitter widens the navigator`,
      afterNav.nav.width >= before.nav.width + 60 && Math.abs(afterNav.sheet.width - (before.sheet.width - 80)) <= 12,
      `${Math.round(before.nav.width)}→${Math.round(afterNav.nav.width)}, sheet ${Math.round(before.sheet.width)}→${Math.round(afterNav.sheet.width)}`);
    await drag(page, '[data-testid=splitter-output]', -90, 0);
    const afterOut = { out: await box(page, '.workspace > .output-panel'), sheet: await box(page, '.workspace > .worksheet-panel') };
    check(`${tag} · 2: output splitter resizes the output column`,
      afterOut.out.width <= afterNav.out.width - 60 && afterOut.sheet.width >= afterNav.sheet.width + 60,
      `${Math.round(afterNav.out.width)}→${Math.round(afterOut.out.width)}, sheet ${Math.round(afterNav.sheet.width)}→${Math.round(afterOut.sheet.width)}`);
    await page.focus('[data-testid=splitter-nav]');
    const kbdBefore = (await box(page, '[data-testid=navigator]')).width;
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    const kbdAfter = (await box(page, '[data-testid=navigator]')).width;
    check(`${tag} · 2: splitter takes arrow keys`, Math.abs(kbdAfter - (kbdBefore + 24)) <= 2, `${Math.round(kbdBefore)}→${Math.round(kbdAfter)}`);
    await drag(page, '[data-testid=splitter-output]', -4000, 0);
    const floored = await box(page, '.workspace > .output-panel');
    check(`${tag} · 2: output column stops at its minimum width`, floored.width >= 319 && floored.width <= 321, `${Math.round(floored.width)}px`);
  }

  /* ── 3. focus mode and the worksheet drawer ──────────────────────── */
  if (!PART || PART.has('3')) {
    console.log(`\n── 3. focus mode · drawer open/close (${tag}) ──`);
    await ensureLayout(page, 'tri');
    await pickWorkspace(page, 'focus');
    check(`${tag} · 3: focus mode is painted`, (await layoutOf(page)) === 'focus', String(await layoutOf(page)));
    check(`${tag} · 3: the drawer opens when focus mode is picked`,
      (await page.locator('[data-testid=worksheet-drawer]').count()) === 1);
    check(`${tag} · 3: the three-column worksheet column is gone`,
      (await page.locator('.workspace > .worksheet-panel').count()) === 0);
    const drawer = await box(page, '[data-testid=worksheet-drawer]');
    check(`${tag} · 3: the drawer hugs the right edge`, Boolean(drawer) && Math.abs(drawer.x + drawer.width - viewport.width) <= 2,
      drawer ? `${Math.round(drawer.x + drawer.width)} of ${viewport.width}` : 'missing');
    await page.click('[data-testid=drawer-close]');
    await page.waitForTimeout(250);
    check(`${tag} · 3: the drawer closes`, (await page.locator('[data-testid=worksheet-drawer]').count()) === 0);
    const outWide = await box(page, '.focus-main > .output-panel');
    const mainBox = await box(page, '[data-testid=focus-main]');
    check(`${tag} · 3: the output takes the freed room`,
      Boolean(outWide && mainBox) && outWide.width >= mainBox.width - 2,
      outWide ? `${Math.round(outWide.width)}px of ${Math.round(mainBox.width)}` : 'missing');
    await page.click('[data-testid=drawer-toggle]');
    await page.waitForTimeout(300);
    check(`${tag} · 3: the edge tab reopens the drawer`, (await page.locator('[data-testid=worksheet-drawer]').count()) === 1);
  }

  /* ── 4. drawer width ─────────────────────────────────────────────── */
  if (!PART || PART.has('4')) {
    console.log(`\n── 4. drawer width (${tag}) ──`);
    await ensureDrawer(page);
    const before = await box(page, '[data-testid=worksheet-drawer]');
    await drag(page, '[data-testid=drawer-resize]', -100, 0);
    const after = await box(page, '[data-testid=worksheet-drawer]');
    check(`${tag} · 4: dragging the drawer edge widens it`,
      after.width >= before.width + 70, `${Math.round(before.width)}→${Math.round(after.width)}`);
    check(`${tag} · 4: the drawer keeps its right edge`, Math.abs((after.x + after.width) - (before.x + before.width)) <= 2);
    await drag(page, '[data-testid=drawer-resize]', 4000, 0);
    const floored = await box(page, '[data-testid=worksheet-drawer]');
    check(`${tag} · 4: the drawer stops at its minimum width`, floored.width >= 319 && floored.width <= 321, `${Math.round(floored.width)}px`);
  }

  /* ── 5. edit in the drawer, then rerun the analysis ──────────────── */
  if (!PART || PART.has('5')) {
    console.log(`\n── 5. drawer editing + rerun (${tag}) ──`);
    await ensureDrawer(page);
    await drag(page, '[data-testid=drawer-resize]', -260, 0);
    await loadSample(page, 'process');
    await runDescriptive(page, 'C1');
    const cardText = () => page.locator('[data-testid=out-card]').last().innerText();
    const before = await cardText();
    check(`${tag} · 5: the card shows the descriptive table`, /Mean/i.test(before) && /StDev/i.test(before), before.split('\n').slice(0, 2).join(' | '));
    await page.click(`${cell(1, 0)}`);
    await page.keyboard.type('9999');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const edited = await page.locator(`${cell(1, 0)}`).innerText();
    check(`${tag} · 5: the drawer cell takes an edit`, edited.replace(/[\s,]/g, '') === '9999', edited);
    await page.click('[data-testid=drawer-rerun]');
    await page.waitForTimeout(1000);
    check(`${tag} · 5: the drawer rerun needs no dialog`, (await page.locator('[data-testid=analysis-dialog]').count()) === 0);
    const after = await cardText();
    check(`${tag} · 5: rerunning from the drawer recomputes the analysis`, after !== before && /9999/.test(after.replace(/,/g, '')),
      `${before.replace(/\s+/g, ' ').slice(0, 70)} → ${after.replace(/\s+/g, ' ').slice(0, 70)}`);
    check(`${tag} · 5: the worksheet still holds the edit`,
      (await page.locator('[data-testid=worksheet-drawer] td[data-row="1"][data-col="0"]').innerText()).replace(/[\s,]/g, '') === '9999');
    // the drawer is the real grid: its own context menu, copy and paste work there
    await page.locator('[data-testid=worksheet-drawer] ' + cell(2, 0)).click({ button: 'right' });
    await page.waitForTimeout(250);
    check(`${tag} · 5: the drawer cell menu opens inside the drawer`,
      (await page.locator('[data-testid=ctx-item-copy]').count()) === 1 && (await page.locator('[data-testid=ctx-item-paste]').count()) === 1);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await page.evaluate(() => navigator.clipboard.writeText('777'));
    await page.locator('[data-testid=worksheet-drawer] ' + cell(2, 0)).click();
    await page.keyboard.press('Control+V');
    await page.waitForTimeout(400);
    check(`${tag} · 5: pasting into the drawer reaches the sheet`,
      (await page.locator('[data-testid=worksheet-drawer] td[data-row="2"][data-col="0"]').innerText()).trim() === '777',
      (await page.locator('[data-testid=worksheet-drawer] td[data-row="2"][data-col="0"]').innerText()).trim());
  }

  /* ── 6. classic mode ─────────────────────────────────────────────── */
  if (!PART || PART.has('6')) {
    console.log(`\n── 6. classic mode (${tag}) ──`);
    await ensureLayout(page, 'tri');
    await pickWorkspace(page, 'classic');
    check(`${tag} · 6: classic layout is painted`, (await layoutOf(page)) === 'classic', String(await layoutOf(page)));
    const out = await box(page, '.main-panels > .output-panel');
    const sheet = await box(page, '.main-panels > .worksheet-panel');
    check(`${tag} · 6: output sits above the worksheet`,
      Boolean(out && sheet) && out.y < sheet.y && Math.abs(out.x - sheet.x) <= 2,
      out && sheet ? `out y ${Math.round(out.y)}+${Math.round(out.height)} / sheet y ${Math.round(sheet.y)}` : 'missing');
    check(`${tag} · 6: the stacked splitter is back`, (await page.locator('[data-testid=splitter-output-h]').count()) === 1);
    const beforeH = out.height;
    await page.click('[data-testid=menu-view]');
    await page.waitForTimeout(160);
    await page.getByRole('menuitem', { name: 'Panel layout', exact: true }).hover();
    await page.waitForTimeout(250);
    await page.getByRole('menuitem', { name: /Results & charts focus/ }).click();
    await page.waitForTimeout(400);
    const afterH = (await box(page, '.main-panels > .output-panel')).height;
    check(`${tag} · 6: the emphasis preset still resizes the stacked output`, afterH > beforeH + 20, `${Math.round(beforeH)} → ${Math.round(afterH)}`);
    await page.click('[data-testid=menu-view]');
    await page.waitForTimeout(160);
    await page.getByRole('menuitem', { name: 'Panel layout', exact: true }).hover();
    await page.waitForTimeout(250);
    await page.getByRole('menuitem', { name: 'Balanced (default)' }).click();
    await page.waitForTimeout(300);
  }

  /* ── 7. the choice and the widths survive a reload ───────────────── */
  if (!PART || PART.has('7')) {
    console.log(`\n── 7. layout persistence (${tag}) ──`);
    await ensureCard(page);
    await ensureDrawer(page);
    await page.click(`${cell(6, 1)}`);
    await page.keyboard.type('4242');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    await drag(page, '[data-testid=drawer-resize]', -120, 0);
    const drawerW = (await box(page, '[data-testid=worksheet-drawer]')).width;
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid=worksheet-grid]', { timeout: 15000 });
    await page.waitForTimeout(700);
    check(`${tag} · 7: the workspace comes back in focus mode`, (await layoutOf(page)) === 'focus', String(await layoutOf(page)));
    const reopened = await page.locator('[data-testid=worksheet-drawer]').count();
    check(`${tag} · 7: the drawer is open again`, reopened === 1, String(reopened));
    const width = (await box(page, '[data-testid=worksheet-drawer]')).width;
    check(`${tag} · 7: the drawer keeps its width`, Math.abs(width - drawerW) <= 3, `${Math.round(drawerW)} → ${Math.round(width)}`);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('sigrun.workspace.v2') || 'null'));
    check(`${tag} · 7: the workspace is stored in localStorage`, Boolean(stored) && stored.layout === 'focus', JSON.stringify(stored));
    check(`${tag} · 7: worksheet data survives the layout switch`, (await page.locator(`${cell(6, 1)}`).innerText()).trim() === '4242',
      (await page.locator(`${cell(6, 1)}`).innerText()).trim());
    await pickWorkspace(page, 'tri');
  }

  /* ── 8. output card right-click menu ─────────────────────────────── */
  if (!PART || PART.has('8')) {
    console.log(`\n── 8. output context menu (${tag}) ──`);
    await ensureLayout(page, 'tri');
    await ensureCard(page);
    const card = await box(page, '[data-testid=out-card]');
    await page.mouse.click(card.x + 60, card.y + 20, { button: 'right' });
    await page.waitForTimeout(250);
    check(`${tag} · 8: right-clicking a card opens a menu`, (await page.locator('[data-testid=ctx-menu]').count()) === 1);
    for (const id of ['out-copy-text', 'out-copy-chart', 'out-save-chart', 'out-rerun', 'out-collapse', 'out-delete']) {
      check(`${tag} · 8: menu offers ${id}`, (await page.locator(`[data-testid=ctx-item-${id}]`).count()) === 1);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    check(`${tag} · 8: Escape closes the menu`, (await page.locator('[data-testid=ctx-menu]').count()) === 0);
    const panel = await box(page, '[data-testid=output-panel]');
    await page.mouse.click(panel.x + panel.width - 12, panel.y + panel.height - 12, { button: 'right' });
    await page.waitForTimeout(250);
    const menuBox = await box(page, '[data-testid=ctx-menu]');
    const inside = await page.evaluate(() => {
      const node = document.querySelector('[data-testid=ctx-menu]');
      if (!node) return false;
      const r = node.getBoundingClientRect();
      return r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1;
    });
    check(`${tag} · 8: a menu near the corner stays on screen`, inside, menuBox ? JSON.stringify({ x: Math.round(menuBox.x), y: Math.round(menuBox.y), w: Math.round(menuBox.width), h: Math.round(menuBox.height) }) : 'missing');
    await page.keyboard.press('Escape');
  }

  /* ── 9. the menu actions work ────────────────────────────────────── */
  if (!PART || PART.has('9')) {
    console.log(`\n── 9. output menu actions (${tag}) ──`);
    await ensureLayout(page, 'tri');
    await ensureCard(page);
    const card = await box(page, '[data-testid=out-card]');
    await page.mouse.click(card.x + 80, card.y + 20, { button: 'right' });
    await page.waitForTimeout(220);
    await page.click('[data-testid=ctx-item-out-copy-text]');
    await page.waitForTimeout(500);
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    check(`${tag} · 9: “copy results as text” fills the clipboard`, /Mean/i.test(clip) && clip.length > 20, clip.slice(0, 60).replace(/\n/g, ' / '));
    await page.mouse.click(card.x + 80, card.y + 20, { button: 'right' });
    await page.waitForTimeout(220);
    await page.click('[data-testid=ctx-item-out-collapse]');
    await page.waitForTimeout(300);
    check(`${tag} · 9: the menu collapses the card`, (await page.locator('[data-testid=out-card].collapsed').count()) === 1);
    await page.mouse.click(card.x + 80, card.y + 20, { button: 'right' });
    await page.waitForTimeout(220);
    const expandLabel = await page.locator('[data-testid=ctx-item-out-collapse]').innerText();
    check(`${tag} · 9: the menu offers “expand” on a collapsed card`, /Expand|펼치기/i.test(expandLabel), expandLabel.trim());
    await page.click('[data-testid=ctx-item-out-collapse]');
    await page.waitForTimeout(300);
    check(`${tag} · 9: expanding brings the table back`, (await page.locator('[data-testid=out-card].collapsed').count()) === 0);
    // the empty area of the output has its own menu
    const panel = await box(page, '[data-testid=output-panel]');
    await page.mouse.click(panel.x + 20, panel.y + panel.height - 12, { button: 'right' });
    await page.waitForTimeout(250);
    const areaItems = await page.locator('[data-testid=ctx-item-area-copy-all], [data-testid=ctx-item-area-collapse-all]').count();
    check(`${tag} · 9: the empty output area has a menu`, areaItems === 2, String(areaItems));
    await page.keyboard.press('Escape');
  }

  /* ── 10. Stage 1 regression — selection, copy/paste, add column ──── */
  if (!PART || PART.has('10')) {
    console.log(`\n── 10. Stage 1 regression · grid (${tag}) ──`);
    await ensureLayout(page, 'tri');
    await page.click(`${cell(2, 1)}`);
    await page.keyboard.down('Shift');
    await page.click(`${cell(4, 1)}`);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(200);
    const selected = await page.locator('.ws-cell.sel').count();
    check(`${tag} · 10: shift-click selects a range`, selected >= 3, `${selected} cells`);
    await page.click(`${cell(2, 1)}`);
    await page.evaluate(() => navigator.clipboard.writeText('11\n22'));
    await page.keyboard.press('Control+V');
    await page.waitForTimeout(450);
    const pasted = await page.locator(`${cell(2, 1)}`).innerText();
    const pastedNext = await page.locator(`${cell(3, 1)}`).innerText();
    check(`${tag} · 10: a pasted block lands in the sheet`, pasted.trim() === '11' && pastedNext.trim() === '22', `${pasted}/${pastedNext}`);
    const colsBefore = await page.locator('.ws-colhead').count();
    await page.click('[data-testid=ws-addcol-cell] button');
    await page.waitForTimeout(300);
    check(`${tag} · 10: the + header adds a column`, (await page.locator('.ws-colhead').count()) === colsBefore + 1);
    const cellBox = await box(page, `${cell(3, 2)}`);
    await page.locator(`${cell(3, 2)}`).click({ button: 'right' });
    await page.waitForTimeout(250);
    check(`${tag} · 10: the grid cell menu still opens`, (await page.locator('[data-testid=ctx-menu]').count()) === 1);
    check(`${tag} · 10: the cell menu still offers insert/delete`,
      (await page.locator('[data-testid=ctx-item-row-above]').count()) === 1 && (await page.locator('[data-testid=ctx-item-col-delete]').count()) === 1);
    await page.keyboard.press('Escape');
  }

  /* ── 11. Stage 1 regression — column header menu ─────────────────── */
  if (!PART || PART.has('11')) {
    console.log(`\n── 11. Stage 1 regression · column header (${tag}) ──`);
    await ensureLayout(page, 'tri');
    const head = await box(page, '[data-testid=ws-colhead-C1]');
    await page.evaluate(() => {
      const wrap = document.querySelector('.grid-wrap');
      if (wrap) { wrap.scrollLeft = 0; wrap.scrollTop = 0; }
    });
    await page.waitForTimeout(200);
    const headNow = await box(page, '[data-testid=ws-colhead-C1]');
    const hit = await page.evaluate(([x, y]) => {
      const node = document.elementFromPoint(x, y);
      return node ? `${node.tagName}.${String(node.className).slice(0, 30)}` : 'none';
    }, [headNow.x + 14, headNow.y + 12]);
    await page.mouse.click(headNow.x + 14, headNow.y + 12, { button: 'right' });
    await page.waitForTimeout(250);
    check(`${tag} · 11: the column header menu opens`, (await page.locator('[data-testid=ctx-menu]').count()) === 1,
      `at ${Math.round(headNow.x + 14)},${Math.round(headNow.y + 12)} → ${hit}${head ? '' : ' (no initial box)'}`);
    const menuIds = await page.locator('[data-testid^=ctx-item-]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-testid')));
    check(`${tag} · 11: rename / sort / type / description are offered`,
      (await page.locator('[data-testid=ctx-item-rename-col]').count()) === 1
      && (await page.locator('[data-testid=ctx-item-col-sort]').count()) === 1
      && (await page.locator('[data-testid=ctx-item-col-type]').count()) === 1
      && (await page.locator('[data-testid=ctx-item-col-desc]').count()) === 1,
      menuIds.join(','));
    await page.locator('[data-testid=ctx-item-col-sort]').hover();
    await page.waitForTimeout(250);
    check(`${tag} · 11: the sort submenu opens`, (await page.locator('[data-testid=ctx-item-sort-asc]').count()) === 1);
    await page.keyboard.press('Escape');
  }

  /* ── 12. detach / dock keeps working in three-panel mode ─────────── */
  if (!PART || PART.has('12')) {
    console.log(`\n── 12. detach · dock (${tag}) ──`);
    await ensureLayout(page, 'tri');
    await page.click('[data-testid=detach-output]');
    await page.waitForTimeout(300);
    check(`${tag} · 12: output detaches from the three-panel row`, (await page.locator('[data-testid=float-output]').count()) === 1);
    check(`${tag} · 12: the dock slot holds its column`, (await page.locator('[data-testid=dock-slot-output]').count()) === 1);
    check(`${tag} · 12: the layout stays three-panel while detached`, (await layoutOf(page)) === 'tri');
    const floatBox = await box(page, '[data-testid=float-output]');
    const sheetBox = await box(page, '.workspace > .worksheet-panel');
    check(`${tag} · 12: the worksheet panel is still docked beside it`, Boolean(floatBox && sheetBox) && Math.abs(sheetBox.x + sheetBox.width - viewport.width) <= 2,
      sheetBox ? `${Math.round(sheetBox.x + sheetBox.width)} of ${viewport.width}` : 'missing');
    await page.click('[data-testid=float-output-dock]');
    await page.waitForTimeout(300);
    check(`${tag} · 12: docking restores the column`, (await page.locator('.workspace > .output-panel').count()) === 1
      && (await page.locator('[data-testid=float-output]').count()) === 0);
  }

  /* ── 13. Stage 2 regression — scatter Y×X panel grid ─────────────── */
  if (!PART || PART.has('13')) {
    console.log(`\n── 13. Stage 2 regression · scatter panels (${tag}) ──`);
    await ensureLayout(page, 'tri');
    await loadSample(page, 'regression');
    await openScatter(page);
    await addVars(page, ['C4']);          // Y: Yield
    await page.click('[data-testid=slot-y]');
    await addVars(page, ['C2']);          // Y: Pressure
    await page.click('[data-testid=slot-x]');
    await addVars(page, ['C1', 'C3']);    // X: Temperature, Speed
    await page.click('[data-testid=tab-graphs]');
    await page.selectOption('[data-testid=field-layout]', 'panel');
    await page.click('[data-testid=tab-main]');
    await page.click('[data-testid=dialog-ok]');
    await page.waitForTimeout(900);
    const gridPanels = await page.locator('.out-card .chart-grid .chart-card').count();
    check(`${tag} · 13: a 2×2 panel grid is drawn`, gridPanels === 4, String(gridPanels));
    const titles = await page.locator('.out-card .chart-grid h5').allInnerTexts();
    check(`${tag} · 13: every panel is titled`, titles.length === 4 && /yield/i.test(titles[0]), titles.join(' | '));
  }

  /* ── 14. Stage 2 regression — XY pairs ───────────────────────────── */
  if (!PART || PART.has('14')) {
    console.log(`\n── 14. Stage 2 regression · XY pairs (${tag}) ──`);
    await ensureLayout(page, 'tri');
    await openScatter(page);
    await addVars(page, ['C4']);          // Y: Yield
    await page.click('[data-testid=slot-y]');
    await addVars(page, ['C2']);          // Y: Pressure
    await page.click('[data-testid=slot-x]');
    await addVars(page, ['C1', 'C3']);    // X: Temperature, Speed
    await page.selectOption('[data-testid=field-mode]', 'pairs');
    await page.click('[data-testid=dialog-ok]');
    await page.waitForTimeout(900);
    const cards = await page.locator('[data-testid=out-card]').count();
    const paired = await page.locator('[data-testid=out-card]').last().locator('.chart-card').count();
    check(`${tag} · 14: the paired run adds one card with two plots`, cards >= 2 && paired === 2, `${cards} cards, ${paired} plots`);
    const captions = await page.locator('[data-testid=out-card]').last().locator('.chart-card h5').allInnerTexts();
    check(`${tag} · 14: Y1 pairs with X1 and Y2 with X2`,
      captions.length === 2 && /yield.*temperature/i.test(captions[0]) && /pressure.*speed/i.test(captions[1]),
      captions.join(' | '));
  }

  /* ── 15. responsive fallback, console health ─────────────────────── */
  if (!PART || PART.has('15')) {
    console.log(`\n── 15. responsive fallback · console (${tag}) ──`);
    await ensureLayout(page, 'tri');
    await page.setViewportSize({ width: 1150, height: 800 });
    await page.waitForTimeout(400);
    check(`${tag} · 15: a narrow desktop folds three panels to classic`, (await layoutOf(page)) === 'classic', String(await layoutOf(page)));
    await page.setViewportSize({ width: 900, height: 800 });
    await page.waitForTimeout(400);
    const mobileLayout = await layoutOf(page);
    const tabsVisible = await page.locator('.mobile-tabs').isVisible();
    check(`${tag} · 15: a tablet-width window uses the tabbed shell`, mobileLayout === 'mobile' && tabsVisible, `${mobileLayout} / tabs ${tabsVisible}`);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${tag} · 15: no horizontal overflow at 900px`, ov <= 1, `${ov}px`);
    await page.setViewportSize(viewport);
    await page.waitForTimeout(500);
    check(`${tag} · 15: the stored layout returns when the window widens`, (await layoutOf(page)) === 'tri', String(await layoutOf(page)));
    check(`${tag} · 15: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  }

  await ctx.close();
}

/* ── screenshots for the report ──────────────────────────────────────── */
async function shots(browser) {
  console.log('\n── screenshots ──');
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid=worksheet-grid]');
  await page.evaluate(() => {
    localStorage.removeItem('sigrun.workspace.v1');
    localStorage.removeItem('sigrun.workspace.v2');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid=worksheet-grid]');
  await loadSample(page, 'regression');
  await runDescriptive(page, 'C4');
  await openScatter(page);
  await addVars(page, ['C4']);
  await page.click('[data-testid=slot-x]');
  await addVars(page, ['C1']);
  await page.click('[data-testid=dialog-ok]');
  await page.waitForTimeout(1200);
  await page.waitForTimeout(2900); // let the layout toast clear
  await page.evaluate(() => { const node = document.querySelector('[data-testid=output-panel]'); if (node) node.scrollTop = 0; });
  await page.mouse.move(900, 600);
  await page.waitForTimeout(300);
  const overflowClassic = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('shots: the classic default has no horizontal overflow', overflowClassic <= 1, `${overflowClassic}px`);
  check('shots: the default is the classic arrangement', (await layoutOf(page)) === 'classic', String(await layoutOf(page)));
  await page.screenshot({ path: `${SHOTS}/fix-header-classic-pc.png` });
  check('shots: fix-header-classic-pc.png saved', fs.existsSync(`${SHOTS}/fix-header-classic-pc.png`), `${SHOTS}/fix-header-classic-pc.png`);

  /* the about modal with the brand banner */
  await page.click('[data-testid=menu-help]');
  await page.waitForTimeout(200);
  await page.click('[data-testid=menu-item-about]');
  await page.waitForSelector('[data-testid=about-brand]');
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SHOTS}/fix-about-modal.png` });
  check('shots: fix-about-modal.png saved', fs.existsSync(`${SHOTS}/fix-about-modal.png`), `${SHOTS}/fix-about-modal.png`);
  await page.click('.modal-foot .btn');
  await page.waitForTimeout(300);

  /* the same banner in Navy & Lavender */
  await page.click('[data-testid=theme-toggle]');
  await page.waitForTimeout(350);
  await page.click('[data-testid=menu-help]');
  await page.waitForTimeout(200);
  await page.click('[data-testid=menu-item-about]');
  await page.waitForSelector('[data-testid=about-brand]');
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SHOTS}/fix-about-modal-dark.png` });
  check('shots: fix-about-modal-dark.png saved', fs.existsSync(`${SHOTS}/fix-about-modal-dark.png`), `${SHOTS}/fix-about-modal-dark.png`);
  await page.click('.modal-foot .btn');
  await page.waitForTimeout(300);
  await page.click('[data-testid=theme-toggle]');
  await page.waitForTimeout(350);

  await page.click('[data-testid=ws-layout-tri]');
  await page.waitForTimeout(3300);
  const overflowTri = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('shots: three-panel page has no horizontal overflow', overflowTri <= 1, `${overflowTri}px`);
  await page.screenshot({ path: `${SHOTS}/stage3-3panel-pc.png` });
  check('shots: stage3-3panel-pc.png saved', fs.existsSync(`${SHOTS}/stage3-3panel-pc.png`), `${SHOTS}/stage3-3panel-pc.png`);

  await page.click('[data-testid=ws-layout-focus]');
  await page.waitForTimeout(3300);
  await page.evaluate(() => { const node = document.querySelector('[data-testid=output-panel]'); if (node) node.scrollTop = 0; });
  await page.mouse.move(700, 600);
  await page.screenshot({ path: `${SHOTS}/stage3-drawer-pc.png` });
  check('shots: stage3-drawer-pc.png saved', fs.existsSync(`${SHOTS}/stage3-drawer-pc.png`), `${SHOTS}/stage3-drawer-pc.png`);

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.click('[data-testid=ws-layout-tri]');
  await page.waitForTimeout(3300);
  await page.screenshot({ path: `${SHOTS}/stage3-3panel-1366.png` });
  check('shots: stage3-3panel-1366.png saved', fs.existsSync(`${SHOTS}/stage3-3panel-1366.png`), `${SHOTS}/stage3-3panel-1366.png`);
  check('shots: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = LIVE ? null : await serve();
  try {
    for (const viewport of VIEWPORTS) {
      const browser = await launch();
      try {
        await runViewport(browser, viewport);
      } finally {
        await browser.close();
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    if (!PART) {
      const browser = await launch();
      try {
        await shots(browser);
      } finally {
        await browser.close();
      }
    }
  } finally {
    server?.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) console.log('failed:\n - ' + failed.map((f) => f.name).join('\n - '));
})().catch((error) => {
  console.error('E2E crashed:', error);
  process.exitCode = 1;
});
