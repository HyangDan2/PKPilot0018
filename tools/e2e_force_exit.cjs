/* Sigrún — Phase 3F-A · WO-3F-01 force exit in a real browser

   The state machine is unit-tested; this suite is about the screens a reader
   can actually reach, and about what is left on disk after they leave:

     · force exit from the open panel
     · force exit from the minimised bar
     · force exit from the tutorial library while the panel is closed
     · force exit and cancel while the start is still waiting for its autosave
       (the pending start must not apply itself afterwards)
     · force exit from the save-failure dialog when the store refuses the practice
     · the reader's own project comes back unchanged every time
     · a forced exit is never a completion, and the lesson restarts as a new session
     · a reload after the exit shows the own project, not the practice

   Local:  node tools/e2e_force_exit.cjs
   Live:   BASE=https://hyangdan2.github.io/PKPilot0018/ SERVE=0 node tools/e2e_force_exit.cjs
*/
const http = require('http');
const fs = require('fs');
const path = require('path');

const { launchBrowser } = require('./e2e_browser.cjs');

const BASE = process.env.BASE || 'http://127.0.0.1:4193/PKPilot0018/';
const SERVE = process.env.SERVE !== '0' && !process.env.BASE;
const SHOTS = process.env.SHOTS || path.resolve(__dirname, '..', 'artifacts', 'force-exit-shots');
const LESSON = 'tutorial-start-001';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
}

function startStaticServer() {
  if (!SERVE) return null;
  const root = path.resolve(__dirname, '..', 'dist');
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
  return new Promise((resolve) => server.listen(4193, '127.0.0.1', () => resolve(server)));
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

/** The reader's own project as the workspace shows it. */
async function workspace(page) {
  return page.evaluate(() => ({
    tabs: [...document.querySelectorAll('.ws-tab')].map((element) => (element.textContent || '').replace('×', '').trim()),
    outputs: document.querySelectorAll('[data-testid=out-card]').length,
  }));
}

async function openLibrary(page) {
  if (!(await page.locator('[data-testid=tutorial-library]').count())) {
    await page.click('[data-testid=learn-sigrun]');
  }
  await page.waitForSelector('[data-testid=tutorial-library]', { timeout: 8000 });
}

async function openLessonStart(page) {
  await openLibrary(page);
  const start = page.locator(`[data-testid=tut-start-${LESSON}]`);
  if (await start.count()) await start.click();
  else await page.click(`[data-testid=tut-restart-${LESSON}]`);
  await page.waitForSelector('[data-testid=tutorial-start-dialog]', { timeout: 8000 });
}

async function startIsolated(page) {
  await openLessonStart(page);
  await page.click('[data-testid=tutorial-start-isolated]');
  await page.waitForSelector('[data-testid=tutorial-dock]', { timeout: 12000 });
  await page.waitForTimeout(400);
}

async function waitGone(page, selector, timeout = 6000) {
  return page.waitForSelector(selector, { state: 'detached', timeout }).then(() => true).catch(() => false);
}

/** The lesson's entry in the library: start card means no record, resume means a record. */
async function lessonRecord(page) {
  await openLibrary(page);
  const state = await page.evaluate((lesson) => ({
    start: document.querySelectorAll(`[data-testid=tut-start-${lesson}]`).length,
    resume: document.querySelectorAll(`[data-testid=tut-resume-${lesson}]`).length,
    activeSession: document.querySelectorAll('[data-testid=tut-library-active-session]').length,
    forceExit: document.querySelectorAll('[data-testid=tut-library-force-exit]').length,
  }), LESSON);
  await page.click('[data-testid=tutorial-library-close]');
  return state;
}

async function sessionId(page) {
  const locator = page.locator('[data-testid=tut-session-id]');
  if (!(await locator.count())) return null;
  const text = await locator.innerText();
  const match = text.match(/(sess-[A-Za-z0-9-]+)/);
  return match ? match[1] : text;
}

async function main() {
  const server = await startStaticServer();
  const { browser } = await launchBrowser();

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  context.setDefaultTimeout(15000);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push('pageerror: ' + error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push('console: ' + message.text()); });
  page.on('dialog', (dialog) => { void dialog.accept(); });

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('[data-testid=menubar]', { timeout: 20000 });
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('[data-testid=menubar]', { timeout: 20000 });
  await page.waitForTimeout(900);

  // A project of the reader's own: a sample with an output on it.
  await page.click('[data-testid=sample-button]');
  await page.click('[data-testid=sample-process]');
  await page.waitForTimeout(600);
  await page.click('[data-testid=quick-desc]');
  await page.waitForSelector('[data-testid=analysis-dialog]', { timeout: 8000 });
  await page.click('[data-testid=slot-variables]');
  await page.click('[data-testid=var-C1]');
  await page.click('[data-testid=add-selected]');
  await page.click('[data-testid=dialog-ok]');
  await page.waitForTimeout(900);
  const own = await workspace(page);
  check('own project loaded with an output', own.outputs === 1 && !own.tabs.some((tab) => tab.startsWith('Practice')), JSON.stringify(own));

  /* ── 1. force exit from the open panel ────────────────────────────────── */
  await startIsolated(page);
  const firstSession = await sessionId(page);
  await page.click('[data-testid=tut-action-load-sample]');
  await page.waitForTimeout(700);
  const during = await workspace(page);
  check('practice replaced the workspace', during.tabs.some((tab) => tab.startsWith('Practice')), JSON.stringify(during));

  await page.click('[data-testid=tut-force-exit]');
  const panelGone = await waitGone(page, '[data-testid=tutorial-dock]');
  await page.waitForTimeout(900);
  const afterPanelExit = await workspace(page);
  check('force exit from the panel closes the session', panelGone, '');
  check('force exit restores the own project unchanged', JSON.stringify(afterPanelExit) === JSON.stringify(own), `${JSON.stringify(during)} → ${JSON.stringify(afterPanelExit)}`);
  const recordAfterPanel = await lessonRecord(page);
  check('a forced exit leaves no progress record (lesson reads not started)', recordAfterPanel.start === 1 && recordAfterPanel.resume === 0, JSON.stringify(recordAfterPanel));
  await shot(page, '01-after-panel-force-exit');

  /* ── 2. force exit from the minimised bar ─────────────────────────────── */
  await startIsolated(page);
  await page.click('[data-testid=tut-collapse]');
  await page.waitForTimeout(300);
  const collapsed = await page.locator('[data-testid=tut-collapsed-force-exit]').count();
  check('a minimised lesson still offers force exit', collapsed === 1, `buttons=${collapsed}`);
  await page.click('[data-testid=tut-collapsed-force-exit]');
  const minimisedGone = await waitGone(page, '[data-testid=tutorial-dock]');
  await page.waitForTimeout(900);
  check('force exit from the minimised bar ends the session', minimisedGone, '');
  check('force exit from the minimised bar restores the own project', JSON.stringify(await workspace(page)) === JSON.stringify(own), JSON.stringify(await workspace(page)));
  const recordAfterMinimised = await lessonRecord(page);
  check('the minimised exit is not a completion either', recordAfterMinimised.start === 1 && recordAfterMinimised.resume === 0, JSON.stringify(recordAfterMinimised));

  /* ── 3. force exit from the library with the panel closed ─────────────── */
  await startIsolated(page);
  await page.click('[data-testid=tut-close]');
  await page.waitForTimeout(300);
  check('closing the panel keeps the session (no dock on screen)', (await page.locator('[data-testid=tutorial-dock]').count()) === 0, '');
  await openLibrary(page);
  const libraryExit = await page.locator('[data-testid=tut-library-force-exit]').count();
  check('the library offers force exit for a session whose panel is closed', libraryExit === 1, `buttons=${libraryExit}`);
  await shot(page, '02-library-force-exit');
  await page.click('[data-testid=tut-library-force-exit]');
  await page.waitForTimeout(1200);
  const libraryRecord = await page.locator('[data-testid=tut-library-active-session]').count();
  check('the library stops reporting the session after force exit', libraryRecord === 0, `rows=${libraryRecord}`);
  if (await page.locator('[data-testid=tutorial-library]').count()) await page.click('[data-testid=tutorial-library-close]');
  check('force exit from the library restores the own project', JSON.stringify(await workspace(page)) === JSON.stringify(own), JSON.stringify(await workspace(page)));

  /* ── 4. restart after a forced exit is a new session ──────────────────── */
  await startIsolated(page);
  const restartedSession = await sessionId(page);
  check('a lesson restarted after a forced exit gets a new session', Boolean(restartedSession) && restartedSession !== firstSession, `${firstSession} → ${restartedSession}`);
  const stepAtRestart = await page.locator('[data-testid=tutorial-step]').first().getAttribute('data-step-id').catch(() => null);
  check('the restarted lesson begins at its first step', Boolean(stepAtRestart), String(stepAtRestart));
  await page.click('[data-testid=tut-force-exit]');
  await waitGone(page, '[data-testid=tutorial-dock]');
  await page.waitForTimeout(800);

  /* ── 5. force exit from the save-failure dialog (store refuses) ───────── */
  await startIsolated(page);
  await page.click('[data-testid=tut-action-load-sample]');
  await page.waitForTimeout(600);
  // Only the kept-practice write is refused; everything else keeps working.
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    window.__restoreSetItem = () => { Storage.prototype.setItem = setItem; };
    Storage.prototype.setItem = function (key, value) {
      if (String(key).includes('tutorials.practice')) {
        const error = new Error('QuotaExceededError: the practice store is full');
        error.name = 'QuotaExceededError';
        throw error;
      }
      return setItem.call(this, key, value);
    };
  });
  await page.click('[data-testid=tut-exit]');
  await page.waitForSelector('[data-testid=tutorial-exit-dialog]', { timeout: 8000 });
  await page.click('[data-testid=tutorial-exit-keep]');
  const failureShown = await page.waitForSelector('[data-testid=practice-save-failed-dialog]', { timeout: 8000 }).then(() => true).catch(() => false);
  check('a refused save is reported instead of discarding the practice', failureShown, '');
  await shot(page, '03-save-failure-dialog');
  const forceInFailure = await page.locator('[data-testid=practice-save-force]').count();
  check('the save-failure dialog offers force exit', forceInFailure === 1, `buttons=${forceInFailure}`);
  await page.click('[data-testid=practice-save-force]');
  await page.waitForTimeout(1400);
  await page.evaluate(() => { if (window.__restoreSetItem) window.__restoreSetItem(); });
  const afterFailureExit = await workspace(page);
  check('force exit from the save-failure dialog ends the session', (await page.locator('[data-testid=tutorial-dock]').count()) === 0 && (await page.locator('[data-testid=practice-save-failed-dialog]').count()) === 0, '');
  check('force exit from the save-failure dialog restores the own project', JSON.stringify(afterFailureExit) === JSON.stringify(own), JSON.stringify(afterFailureExit));
  const recordAfterFailure = await lessonRecord(page);
  check('a failed save plus force exit is not a completion', recordAfterFailure.start === 1 && recordAfterFailure.resume === 0, JSON.stringify(recordAfterFailure));

  /* ── 6. reload after the exit shows the own project ───────────────────── */
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('[data-testid=menubar]', { timeout: 20000 });
  await page.waitForTimeout(1200);
  const afterReload = await workspace(page);
  check('a reload after force exit shows the own project', JSON.stringify(afterReload) === JSON.stringify(own), JSON.stringify(afterReload));
  const recordAfterReload = await lessonRecord(page);
  check('a reload after force exit does not resurrect the session', recordAfterReload.start === 1 && recordAfterReload.resume === 0, JSON.stringify(recordAfterReload));

  /* ── 7. force exit while the start is still running ───────────────────── */
  // The start waits for the autosave; delaying IndexedDB from inside the page
  // keeps that window open long enough to leave from it, which is what a slow
  // disk does to a reader.
  const slowOwn = await workspace(page);
  await page.evaluate((delay) => {
    const open = IDBFactory.prototype.open;
    window.__restoreIdb = () => { IDBFactory.prototype.open = open; };
    IDBFactory.prototype.open = function (...args) {
      const request = open.apply(this, args);
      return new Proxy(request, {
        set(target, prop, value) {
          if (prop === 'onsuccess') {
            target.onsuccess = (event) => setTimeout(() => value.call(target, event), delay);
            return true;
          }
          return Reflect.set(target, prop, value);
        },
        get(target, prop) {
          const value = Reflect.get(target, prop, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };
  }, 1500);
  const slowPage = page;

  await openLessonStart(slowPage);
  await slowPage.click('[data-testid=tutorial-start-isolated]');
  const startingShown = await slowPage.waitForSelector('[data-testid=tutorial-start-force-exit]', { timeout: 5000 }).then(() => true).catch(() => false);
  check('a start that is still running offers force exit', startingShown, '');
  if (startingShown) await shot(slowPage, '04-starting-force-exit');
  await slowPage.click('[data-testid=tutorial-start-force-exit]');
  await slowPage.waitForTimeout(3500);
  check('force exit during the start leaves no lesson behind', (await slowPage.locator('[data-testid=tutorial-dock]').count()) === 0, '');
  check('force exit during the start does not start the practice later', JSON.stringify(await workspace(slowPage)) === JSON.stringify(slowOwn), JSON.stringify(await workspace(slowPage)));
  const slowRecord = await lessonRecord(slowPage);
  check('the abandoned start left no progress record', slowRecord.start === 1 && slowRecord.resume === 0, JSON.stringify(slowRecord));

  /* ── 8. cancel during the start is the same exit ──────────────────────── */
  await openLessonStart(slowPage);
  await slowPage.click('[data-testid=tutorial-start-isolated]');
  await slowPage.waitForSelector('[data-testid=tutorial-start-cancel]', { timeout: 5000 });
  await slowPage.click('[data-testid=tutorial-start-cancel]');
  await slowPage.waitForTimeout(3500);
  check('cancelling a start in progress does not open the lesson afterwards', (await slowPage.locator('[data-testid=tutorial-dock]').count()) === 0, '');
  check('cancelling a start in progress leaves the own project untouched', JSON.stringify(await workspace(slowPage)) === JSON.stringify(slowOwn), JSON.stringify(await workspace(slowPage)));
  await slowPage.evaluate(() => { if (window.__restoreIdb) window.__restoreIdb(); });

  /* ── 9. the backup goes only after a verified restore ─────────────────── */
  // A kept practice is resumed (which guards the reader's project again) and
  // then force-exited: the restored copy was written and read back, so the
  // guard must not stay behind taking up the store.
  await startIsolated(page);
  await page.click('[data-testid=tut-exit]');
  await page.waitForSelector('[data-testid=tutorial-exit-dialog]', { timeout: 8000 });
  await page.click('[data-testid=tutorial-exit-keep]');
  await page.waitForTimeout(1200);
  const slotsKept = await page.evaluate(() => {
    const raw = localStorage.getItem('sigrun.tutorials.practice.v2');
    return raw ? Object.keys(JSON.parse(raw).slots || {}).length : 0;
  });
  check('keeping the practice stores exactly one copy', slotsKept === 1, `slots=${slotsKept}`);
  await openLibrary(page);
  const keptResume = page.locator(`[data-testid=tut-resume-${LESSON}]`);
  const keptCount = await keptResume.count();
  check('a kept practice is offered for resume', keptCount === 1, `resume=${keptCount}`);
  if (keptCount) await keptResume.click();
  await page.waitForSelector('[data-testid=tutorial-dock]', { timeout: 12000 });
  await page.waitForTimeout(700);
  const guardsBefore = await page.evaluate(() => {
    const raw = localStorage.getItem('sigrun.tutorials.original.v1');
    return raw ? Object.keys(JSON.parse(raw).slots || {}).length : 0;
  });
  check('resuming guarded the project again', guardsBefore >= 1, `guards=${guardsBefore}`);
  await page.click('[data-testid=tut-force-exit]');
  await page.waitForTimeout(1600);
  const guardsAfter = await page.evaluate(() => {
    const raw = localStorage.getItem('sigrun.tutorials.original.v1');
    return raw ? Object.keys(JSON.parse(raw).slots || {}).length : 0;
  });
  check('a verified restore removes the guarded backup', guardsAfter === 0, `guards=${guardsAfter}`);
  const slotsAfter = await page.evaluate(() => {
    const raw = localStorage.getItem('sigrun.tutorials.practice.v2');
    return raw ? Object.keys(JSON.parse(raw).slots || {}).length : 0;
  });
  check('a forced exit removes the kept copy of the reopened practice', slotsAfter === 0, `slots=${slotsAfter}`);
  check('the resumed practice force-exits back to the own project', JSON.stringify(await workspace(page)) === JSON.stringify(own), JSON.stringify(await workspace(page)));

  check('no console errors in the normal path', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  try { await context.close(); } catch { /* already closed */ }
  try { await browser.close(); } catch { /* already closed */ }
  if (server) server.close();

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    failed.forEach((result) => console.log(`  FAILED: ${result.name} — ${result.detail}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error('E2E FAILED', String(error && error.message).split('\n').slice(0, 4).join('\n'));
  process.exit(1);
});
