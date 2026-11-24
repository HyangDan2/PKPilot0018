/* Open the audit dashboard from file:// in headless Chromium, fail on any console
   error or page error, confirm the embedded data renders, and save the screenshot
   the audit asks for. */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { launchBrowser } = require('./e2e_browser.cjs');

const FILE = path.resolve(__dirname, '..', 'docs', 'audit', 'minitab-gap-dashboard.html');
const SHOT = process.env.SHOT || path.resolve(__dirname, '..', '..', 'pkpilot0018', 'audit-dashboard.png');

(async () => {
  const { browser, name } = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 2200 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  const external = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) external.push(r.url()); });
  await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load' });
  const stats = await page.evaluate(() => ({
    svgs: document.querySelectorAll('svg').length,
    cards: document.querySelectorAll('.card').length,
    rows: document.querySelectorAll('tbody tr, table tr').length,
    title: document.title,
    data: (() => { try { return JSON.parse(document.getElementById('audit-dashboard-data').textContent); } catch (e) { return null; } })(),
  }));
  fs.mkdirSync(path.dirname(SHOT), { recursive: true });
  await page.screenshot({ path: SHOT, fullPage: true });
  console.log(`browser ${name}`);
  console.log(`title    ${stats.title}`);
  console.log(`svg ${stats.svgs} · cards ${stats.cards} · rows ${stats.rows}`);
  console.log(`data     minitab ${stats.data && stats.data.minitabFeatureCount} · missing ${stats.data && stats.data.overall.MISSING} · qa ${stats.data && stats.data.qaCases}`);
  console.log(`console errors ${errors.length}${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);
  console.log(`external requests ${external.length}${external.length ? ': ' + external.slice(0, 5).join(' | ') : ''}`);
  console.log(`screenshot ${SHOT} (${fs.statSync(SHOT).size} bytes)`);
  await browser.close();
  if (errors.length || external.length || !stats.svgs) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
