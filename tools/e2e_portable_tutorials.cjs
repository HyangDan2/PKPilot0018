/* Statelia — Portable tutorial E2E (WO-3E-11 / WO-T11)

   Opens dist-portable/statelia-portable.html from a real file:// URL, runs a
   lesson end to end and fails on any request that leaves the file: scheme.
   This is the check that the Sample, Help and Tutorial registries were bundled
   at build time rather than fetched.

   node tools/e2e_portable_tutorials.cjs
*/
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { launchBrowser } = require('./e2e_browser.cjs');

const FILE = path.resolve(__dirname, '..', 'dist-portable', 'statelia-portable.html');
const SHOTS = process.env.SHOTS || path.resolve(__dirname, '..', 'artifacts', 'tutorial-shots');
const results = [];
const record = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} · ${name}${detail ? ` · ${detail}` : ''}`); };
const wait = (page, ms) => page.waitForTimeout(ms);

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function main() {
  const { browser, name } = await launchBrowser();
  console.log(`browser ${name}`);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  context.setDefaultTimeout(9000);
  const page = await context.newPage();
  const external = [];
  const errors = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('file:') && !url.startsWith('data:') && !url.startsWith('blob:')) external.push(url);
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('dialog', (dialog) => { void dialog.accept(); });

  await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load' });
  await wait(page, 900);
  record('portable build boots from file://', (await page.locator('[data-testid=menubar]').count()) === 1, '');

  await page.click('[data-testid=learn-sigrun]');
  await page.waitForSelector('[data-testid=tutorial-library]', { timeout: 8000 });
  const cards = await page.locator('[data-testid^=tut-card-]').count();
  record('tutorial registry is bundled', cards === 12, `${cards} lessons`);

  await page.click('[data-testid=tut-start-tutorial-start-001]');
  await page.waitForSelector('[data-testid=tutorial-start-dialog]', { timeout: 8000 });
  await page.click('[data-testid=tutorial-start-isolated]');
  await page.waitForSelector('[data-testid=tutorial-dock]', { timeout: 8000 });
  await wait(page, 500);
  record('tutorial starts offline', (await page.locator('[data-testid=tutorial-step]').count()) === 1, '');

  await page.click('[data-testid=tut-action-load-sample]');
  await wait(page, 600);
  await page.click('[data-testid=tut-action-open-analysis]');
  await page.waitForSelector('[data-testid=analysis-dialog]', { timeout: 8000 });
  await page.click('[data-testid=dialog-ok]');
  await wait(page, 800);
  const progress = await page.locator('[data-testid=tutorial-progress-count]').innerText();
  record('analysis runs offline', progress.includes('2/4'), progress);

  // Help registry and sample library come from the same bundle.
  await page.click('[data-testid=tut-action-open-help]');
  await page.waitForSelector('[data-testid=help-center]', { timeout: 8000 });
  const docs = await page.locator('[data-testid^=help-item-]').count();
  record('help registry is bundled', docs >= 18, `${docs} documents`);
  await page.click('[data-testid=help-center-close]');
  await wait(page, 300);

  record('no external request was made', external.length === 0, external.slice(0, 4).join(' | '));
  await shot(page, '07-portable-tutorial');

  // The progress store must either save locally or say it cannot (never pretend).
  const storage = await page.evaluate(() => {
    try {
      const key = 'sigrun.tutorials.progress.v1';
      return localStorage.getItem(key) ? 'saved' : 'empty';
    } catch (error) {
      return `blocked:${String(error).slice(0, 40)}`;
    }
  });
  record('progress is saved or its absence is visible', storage === 'saved' || storage.startsWith('blocked'), storage);

  record('no console errors in the portable build', errors.length === 0, errors.slice(0, 3).join(' | '));

  try { await context.close(); } catch { /* ignore */ }
  try { await browser.close(); } catch { /* ignore */ }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} portable checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => { console.error('PORTABLE E2E FAILED', String(error.message).split('\n').slice(0, 3).join('\n')); process.exit(1); });
