/* Sigrún — Cure Study 2-sample t boxplot axis regression, in a live browser.

   Runs 2-sample t (Hardness vs Before) on the Cure Study sample and checks
   that the box/whiskers are drawn on the same scale as the Y tick labels:
   the lowest whisker (57.91) must sit below the 60 tick but still inside the
   plot, which the old tick-range mapping violated.

   Local: BASE=http://localhost:4178/PKPilot0018/ node tools/e2e_chart_axes.cjs
   Live:  BASE=https://hyangdan2.github.io/PKPilot0018/ SHOT=1 node tools/e2e_chart_axes.cjs
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
const OUT = process.env.OUT || '/workspace/work/pkpilot0018';
const EXE = process.env.CHROME_PATH || '/workspace/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
}

(async () => {
  const errors = [];
  const browser = await chromium.launch({
    headless: true,
    executablePath: EXE,
    args: ['--single-process', '--no-zygote', '--disable-gpu', '--disable-dev-shm-usage', '--disable-software-rasterizer'],
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid=menubar]');

    // Cure Study sample data.
    await page.click('[data-testid=sample-button]');
    await page.waitForSelector('[data-testid=sample-menu]');
    await page.click('[data-testid=sample-comparison]');
    await page.waitForTimeout(500);

    // Stat ▸ Basic Statistics ▸ 2-Sample t…
    await page.click('[data-testid=menu-stat]');
    await page.getByRole('menuitem', { name: 'Basic Statistics', exact: true }).hover();
    await page.getByRole('menuitem', { name: /2-Sample t/ }).click();
    await page.waitForSelector('[data-testid=analysis-dialog]');

    // Hardness vs Before.
    await page.click('[data-testid=slot-sample1]');
    await page.click('[data-testid=var-C2]');
    await page.click('[data-testid=add-selected]');
    await page.click('[data-testid=slot-sample2]');
    await page.click('[data-testid=var-C4]');
    await page.click('[data-testid=add-selected]');
    await page.click('[data-testid=dialog-ok]');
    await page.waitForSelector('[data-testid=analysis-dialog]', { state: 'detached', timeout: 15000 });
    await page.waitForTimeout(500);

    const svg = page.locator('[data-testid=out-card] svg.chart-svg').last();
    check('2-sample t renders a boxplot of Hardness vs Before', (await svg.count()) === 1);

    const geometry = await svg.evaluate((node) => {
      const texts = [...node.querySelectorAll('text')].map((el) => ({
        text: el.textContent || '',
        x: Number(el.getAttribute('x')),
        y: Number(el.getAttribute('y')),
      })).filter((t) => t.x === 47 && /^-?\d+(\.\d+)?$/.test(t.text.trim()));
      const ticks = texts.map((t) => ({ value: Number(t.text), pixel: t.y - 3 }));
      const lines = [...node.querySelectorAll('line')].map((el) => ({
        x1: Number(el.getAttribute('x1')), y1: Number(el.getAttribute('y1')),
        x2: Number(el.getAttribute('x2')), y2: Number(el.getAttribute('y2')),
        stroke: el.getAttribute('stroke'),
        cls: el.getAttribute('class') || '',
      }));
      const whiskers = lines.filter((l) => Math.abs(l.x1 - l.x2) < 0.01 && l.x1 > 60 && l.x1 < 520 && l.cls === 'chart-whisker');
      const boxes = [...node.querySelectorAll('rect.chart-box')].map((el) => ({
        y: Number(el.getAttribute('y')), h: Number(el.getAttribute('height')), fill: el.getAttribute('fill'),
      }));
      return {
        viewBox: node.getAttribute('viewBox'),
        ticks,
        whiskerBottom: whiskers.length ? Math.max(...whiskers.map((l) => Math.max(l.y1, l.y2))) : NaN,
        boxTop: boxes.length ? Math.min(...boxes.map((b) => b.y)) : NaN,
      };
    });

    const tickValues = geometry.ticks.map((t) => t.value).sort((a, b) => a - b);
    check('Y ticks bracket the 55–92 Hardness range', tickValues.length >= 3
      && tickValues[0] <= 60 && tickValues[tickValues.length - 1] >= 90, tickValues.join(', '));
    const plotTop = 18;
    const plotBottom = 208;
    const tick60 = geometry.ticks.find((t) => t.value === 60);
    check('the 60 tick is inside the plot, not pinned to its bottom', Boolean(tick60) && tick60.pixel < plotBottom - 10,
      tick60 ? `tick 60 at y=${tick60.pixel}` : 'tick 60 missing');
    check('lowest whisker sits below the 60 tick but inside the plot', geometry.whiskerBottom > (tick60 ? tick60.pixel : 0)
      && geometry.whiskerBottom < plotBottom - 2, `whisker y=${geometry.whiskerBottom}`);
    check('box top is inside the plot', geometry.boxTop >= plotTop - 0.5 && geometry.boxTop <= plotBottom + 0.5, `box top=${geometry.boxTop}`);

    if (process.env.SHOT) {
      await svg.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await svg.screenshot({ path: `${OUT}/chart-axis-cure-pc.png` });
      await page.screenshot({ path: `${OUT}/chart-axis-cure-page.png` });
    }
    check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  } finally {
    await browser.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed (chart axes)`);
  if (failed.length) console.log('failed: ' + failed.map((f) => f.name).join('; '));
})().catch((error) => {
  console.error('E2E crashed:', error);
  process.exitCode = 1;
});
