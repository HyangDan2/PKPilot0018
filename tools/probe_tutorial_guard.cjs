/* Sigrún — Tutorial original-project guard probe (WO-TQA-01 / WO-TQA-02)

   Measures what the running app does to the reader's own project when a practice
   starts and ends. Every check states the corrected behaviour, so this script is
   the Red evidence on the pre-correction build and the Green evidence after it:

     node tools/probe_tutorial_guard.cjs                 # serves ./dist
     DIST=/path/to/baseline/dist node tools/probe_tutorial_guard.cjs

   T-01 · with browser storage refusing tutorial writes, the practice must not
          start until the reader has an explicit backup in hand
   T-01 · a reload during a practice leaves the reader's own worksheet in place
   T-01 · a cell edited just before the practice (autosave still debouncing)
          survives the practice untouched
   T-02 · a theme changed inside the practice is put back when the practice ends
   T-12 · the dock states the session and practice project a verdict belongs to

   The browser is resolved by tools/e2e_browser.cjs; nothing here reaches the
   network.
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const { launchBrowser } = require('./e2e_browser.cjs');

const ROOT = path.resolve(process.env.DIST || path.join(__dirname, '..', 'dist'));
const PORT = Number(process.env.PORT || 4196);
const SHOTS = process.env.SHOTS || path.resolve(__dirname, '..', 'artifacts', 'tutorial-guard');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (!urlPath.startsWith('/PKPilot0018/')) { res.writeHead(404); res.end('not found'); return; }
      let rel = urlPath.slice('/PKPilot0018/'.length);
      if (!rel || rel.endsWith('/')) rel += 'index.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} · ${name}${detail ? ` · ${detail}` : ''}`);
}

const wait = (page, ms) => page.waitForTimeout(ms);

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

/** Storage that refuses tutorial writes, as a full or blocked browser does. */
const REFUSE_TUTORIAL_WRITES = () => {
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function setItem(key, value) {
    if (String(key).startsWith('sigrun.tutorials')) {
      const error = new Error('QuotaExceededError: the quota has been exceeded');
      error.name = 'QuotaExceededError';
      throw error;
    }
    return original.call(this, key, value);
  };
};

async function boot(page, base, { refuseWrites = false } = {}) {
  if (refuseWrites) await page.addInitScript(REFUSE_TUTORIAL_WRITES);
  await page.goto(base, { waitUntil: 'load' });
  await wait(page, 700);
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
  await page.reload({ waitUntil: 'load' });
  await wait(page, 700);
}

async function tabNames(page) {
  return page.evaluate(() => [...document.querySelectorAll('.ws-tab')].map((element) => (element.textContent || '').replace('×', '').trim()));
}

async function startIsolated(page, tutorialId = 'tutorial-start-001') {
  await page.click('[data-testid=learn-sigrun]');
  await page.waitForSelector('[data-testid=tutorial-library]', { timeout: 8000 });
  const start = page.locator(`[data-testid=tut-start-${tutorialId}]`);
  if (await start.count()) {
    await start.click();
  } else {
    // A lesson already in progress offers resume/restart; the probe wants a start.
    await page.locator(`[data-testid=tut-restart-${tutorialId}]`).click();
    await page.waitForSelector('[data-testid=tutorial-dock]', { timeout: 8000 });
    return;
  }
  await page.waitForSelector('[data-testid=tutorial-start-dialog]', { timeout: 8000 });
  await page.click('[data-testid=tutorial-start-isolated]');
}

async function main() {
  const live = process.env.LIVE_URL || '';
  const server = live ? null : await serve();
  const { browser, name } = await launchBrowser();
  console.log(`browser ${name} · ${live ? `live ${live}` : `dist ${ROOT}`}`);
  const base = live || `http://127.0.0.1:${PORT}/PKPilot0018/`;

  /* ── T-01: a blocked store stops the practice until a backup exists ─── */
  const blocked = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  blocked.setDefaultTimeout(15000);
  const blockedPage = await blocked.newPage();
  blockedPage.on('dialog', (dialog) => { void dialog.accept(); });
  await boot(blockedPage, base, { refuseWrites: true });
  await blockedPage.click('[data-testid=sample-button]');
  await blockedPage.click('[data-testid=sample-process]');
  await wait(blockedPage, 500);
  await startIsolated(blockedPage);
  await wait(blockedPage, 900);
  const backupShown = await blockedPage.locator('[data-testid=tutorial-backup-dialog]').count();
  const dockWhileBlocked = await blockedPage.locator('[data-testid=tutorial-dock]').count();
  const practiceWhileBlocked = (await tabNames(blockedPage)).some((tab) => tab.startsWith('Practice ·'));
  check('T-01 a refused store stops the practice and asks for an explicit backup',
    backupShown === 1 && dockWhileBlocked === 0 && !practiceWhileBlocked,
    `backup=${backupShown} dock=${dockWhileBlocked} practiceTab=${practiceWhileBlocked}`);
  await shot(blockedPage, '01-backup-required');
  // The backup button hands the reader a file and only then opens the practice.
  const download = blockedPage.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  const downloadButton = blockedPage.locator('[data-testid=tutorial-backup-download]');
  if (await downloadButton.count()) {
    await downloadButton.click();
    const file = await download;
    await wait(blockedPage, 900);
    const dockAfterBackup = await blockedPage.locator('[data-testid=tutorial-dock]').count();
    check('T-01 the practice starts only after the backup is downloaded', Boolean(file) && dockAfterBackup === 1,
      `download=${file ? await file.suggestedFilename() : 'none'} dock=${dockAfterBackup}`);
    if (dockAfterBackup) {
      await blockedPage.click('[data-testid=tut-exit]');
      await blockedPage.waitForSelector('[data-testid=tutorial-exit-dialog]', { timeout: 8000 });
      await blockedPage.click('[data-testid=tutorial-exit-keep]');
      await wait(blockedPage, 700);
      const restoredTabs = await tabNames(blockedPage);
      check('T-01 the reader’s own worksheet is back after the practice', restoredTabs.some((tab) => /Coating|process|프로세스|공정/i.test(tab)) || restoredTabs.length === 1, JSON.stringify(restoredTabs));
    }
  } else {
    check('T-01 the practice starts only after the backup is downloaded', false, 'no backup button');
  }
  try { await blocked.close(); } catch { /* ignore */ }

  /* ── T-01: a cell edited just before the practice survives ─────────── */
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  context.setDefaultTimeout(15000);
  const page = await context.newPage();
  page.on('dialog', (dialog) => { void dialog.accept(); });
  await boot(page, base);
  await page.click('[data-testid=sample-button]');
  await page.click('[data-testid=sample-process]');
  await wait(page, 500);
  const target = page.locator('td[data-row="0"][data-col="0"]');
  await target.click();
  await page.keyboard.press('F2');
  await page.waitForSelector('[data-testid=cell-editor]', { timeout: 5000 });
  await page.locator('[data-testid=cell-editor]').fill('abc4242');
  await page.keyboard.press('Enter');
  await wait(page, 200);
  const edited = (await target.innerText()).trim();
  check('T-01 the edit is committed before the practice starts', edited === 'abc4242', `cell A1 = “${edited}”`);
  // Start immediately: the 700 ms autosave is still owed when the practice begins.
  await startIsolated(page);
  await wait(page, 900);
  const sessionStrip = await page.locator('[data-testid=tut-session-id]').count();
  check('T-12 the dock states the session and practice project', sessionStrip === 1, `${sessionStrip} strip(s)`);
  await shot(page, '02-practice-session');
  await page.click('[data-testid=tut-exit]');
  await page.waitForSelector('[data-testid=tutorial-exit-dialog]', { timeout: 8000 });
  await page.click('[data-testid=tutorial-exit-keep]');
  await wait(page, 700);
  const editSurvived = (await page.locator('td[data-row="0"][data-col="0"]').innerText()).trim() === 'abc4242';
  check('T-01 an edit made while the autosave was still debouncing survives the practice', editSurvived, `cell 4242 present=${editSurvived}`);
  await shot(page, '03-edited-cell-after-practice');

  /* ── T-01/T-02: a project with a stored model and a figure comes back whole ── */
  const fixture = process.env.GUARD_FIXTURE || path.resolve(__dirname, 'fixtures', 'guard-original.sigrun.json');
  if (fs.existsSync(fixture)) {
    await boot(page, base);
    await page.click('[data-testid=menu-file]');
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 15000 });
    await page.click('[data-testid=menu-item-open]');
    const chooser = await chooserPromise;
    await chooser.setFiles(fixture);
    await wait(page, 1500);
    const exportProject = async () => {
      const download = page.waitForEvent('download', { timeout: 15000 });
      await page.click('[data-testid=menu-file]');
      await page.click('[data-testid=menu-item-save]');
      const file = await download;
      const target = path.join(SHOTS, `export-${Date.now()}.sigrun.json`);
      fs.mkdirSync(SHOTS, { recursive: true });
      await file.saveAs(target);
      const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
      fs.unlinkSync(target);
      return parsed;
    };
    const summarize = (project) => ({
      sheets: project.worksheets.length,
      rows: project.worksheets[0].columns[0].values.length,
      models: (project.models || []).map((model) => `${model.name}:${model.coefficients.length}`).join('|'),
      figures: (project.figures || []).map((figure) => figure.panels.map((panel) => panel.kind).join('+')).join('|'),
      figureLabel: (project.figures || []).map((figure) => figure.panels.filter((panel) => panel.kind === 'figure-label').map((panel) => panel.label).join(',')).join('|'),
    });
    const beforeProject = summarize(await exportProject());
    await startIsolated(page, 'tutorial-data-001');
    await wait(page, 900);
    await page.click('[data-testid=tut-exit]');
    await page.waitForSelector('[data-testid=tutorial-exit-dialog]', { timeout: 8000 });
    await page.click('[data-testid=tutorial-exit-keep]');
    await wait(page, 1200);
    const afterProject = summarize(await exportProject());
    check('T-01/T-02 the original project comes back with its stored model and its figure',
      JSON.stringify(beforeProject) === JSON.stringify(afterProject) && beforeProject.models !== '' && beforeProject.figures !== '',
      `${JSON.stringify(beforeProject)} → ${JSON.stringify(afterProject)}`);
    await shot(page, '05-restored-project');
  } else {
    check('T-01/T-02 the original project comes back with its stored model and its figure', false, `fixture missing: ${fixture}`);
  }

  /* ── T-02: a theme changed inside the practice is put back ─────────── */
  const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme || 'light');
  await startIsolated(page, 'tutorial-normality-001');
  await wait(page, 900);
  await page.click('[data-testid=theme-toggle]');
  await wait(page, 400);
  const themeInside = await page.evaluate(() => document.documentElement.dataset.theme || 'light');
  await page.click('[data-testid=tut-exit]');
  await page.waitForSelector('[data-testid=tutorial-exit-dialog]', { timeout: 8000 });
  await page.click('[data-testid=tutorial-exit-keep]');
  await wait(page, 800);
  const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme || 'light');
  check('T-02 a theme changed inside the practice is not carried out of it',
    themeInside !== themeBefore && themeAfter === themeBefore,
    `before=${themeBefore} inside=${themeInside} after=${themeAfter}`);

  /* ── T-01: a reload during a practice keeps the reader's project ────── */
  const beforeReload = await tabNames(page);
  await startIsolated(page, 'tutorial-hypothesis-001');
  await wait(page, 900);
  const practiceTab = (await tabNames(page)).some((tab) => tab.startsWith('Practice ·'));
  await page.reload({ waitUntil: 'load' });
  await wait(page, 1200);
  const afterReload = await tabNames(page);
  check('T-01 a reload during a practice leaves the reader’s own worksheet in place',
    practiceTab && afterReload.some((tab) => beforeReload.includes(tab)) && !afterReload.some((tab) => tab.startsWith('Practice ·')),
    `${JSON.stringify(beforeReload)} → ${JSON.stringify(afterReload)}`);
  await shot(page, '04-after-reload');

  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  check('no page error during the run', errors.length === 0, errors.slice(0, 2).join(' | '));

  try { await context.close(); } catch { /* ignore */ }
  try { await browser.close(); } catch { /* ignore */ }
  if (server) server.close();

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    for (const result of failed) console.log(`  FAILED: ${result.name} — ${result.detail}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error('PROBE FAILED', String(error && error.message).split('\n').slice(0, 4).join('\n'));
  process.exit(2);
});
