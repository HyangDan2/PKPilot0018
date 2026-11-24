/* Sigrún — Tutorial System E2E (WO-3E-11 / WO-T12)

   Runs the twelve lessons through their main execution path in a real browser,
   the flagship from data load to the completion summary, and the practice
   isolation check (the reader's own project must come back unchanged).

   Local:   node tools/e2e_tutorials.cjs
   Only:    node tools/e2e_tutorials.cjs --only=tutorial-rsm-001,tutorial-start-001
   Screens: SHOTS=<folder>   (default artifacts/tutorial-shots)

   The browser is resolved by tools/e2e_browser.cjs; nothing here reaches the
   network.
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const { launchBrowser } = require('./e2e_browser.cjs');

const ROOT = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT || 4192);
const SHOTS = process.env.SHOTS || path.resolve(__dirname, '..', 'artifacts', 'tutorial-shots');
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const TUTORIALS = [
  'tutorial-start-001',
  'tutorial-data-001',
  'tutorial-normality-001',
  'tutorial-hypothesis-001',
  'tutorial-regression-001',
  'tutorial-anova-001',
  'tutorial-spc-001',
  'tutorial-capability-001',
  'tutorial-gagerr-001',
  'tutorial-reliability-001',
  'tutorial-doe-001',
  'tutorial-rsm-001',
];

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
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} · ${name}${detail ? ` · ${detail}` : ''}`);
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

const wait = (page, ms) => page.waitForTimeout(ms);

async function openLibrary(page) {
  if (!(await page.locator('[data-testid=tutorial-library]').count())) {
    await page.click('[data-testid=learn-sigrun]');
  }
  await page.waitForSelector('[data-testid=tutorial-library]', { timeout: 8000 });
}

async function startTutorial(page, tutorialId, { keepLibrary = false } = {}) {
  savedCards.clear();
  await openLibrary(page);
  const start = page.locator(`[data-testid=tut-start-${tutorialId}]`);
  if (await start.count()) {
    await start.click();
  } else {
    // An unfinished lesson offers resume/restart; restart opens the start prompt.
    await page.click(`[data-testid=tut-restart-${tutorialId}]`);
  }
  await page.waitForSelector('[data-testid=tutorial-start-dialog]', { timeout: 8000 });
  await page.click('[data-testid=tutorial-start-isolated]');
  await page.waitForSelector('[data-testid=tutorial-dock]', { timeout: 8000 });
  await wait(page, 500);
  if (keepLibrary) return;
}

async function currentStepId(page) {
  const step = page.locator('[data-testid=tutorial-step]');
  if (!(await step.count())) return null;
  return step.getAttribute('data-step-id');
}

async function stepStatus(page) {
  const status = page.locator('[data-testid=tut-status]');
  return (await status.count()) ? (await status.innerText()).replace(/\n+/g, ' | ') : '';
}

const savedCards = new Set();

/** Save each fitted model once: a second save would store a duplicate. */
async function saveModelCards(page) {
  const buttons = page.locator('[data-testid=card-save-model]');
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (!(await button.count())) continue;
    const cardId = await button.evaluate((element) => element.closest('[data-testid=out-card]')?.id ?? '');
    if (cardId && savedCards.has(cardId)) continue;
    await button.click();
    if (cardId) savedCards.add(cardId);
    await wait(page, 180);
  }
}

async function closeIfOpen(page, testid, closer) {
  if (await page.locator(`[data-testid=${testid}]`).count()) {
    const button = page.locator(`[data-testid=${closer}]`);
    if (await button.count()) await button.click();
    await wait(page, 200);
  }
}

async function composeFigure(page, { exportPng = true } = {}) {
  if (!(await page.locator('[data-testid=graph-layout]').count())) return false;
  const charts = page.locator('[data-testid^=gl-chart-]');
  if ((await charts.count()) === 0) return false;
  await charts.nth(0).click();
  await wait(page, 200);
  if ((await charts.count()) > 1) { await charts.nth(1).click(); await wait(page, 200); }
  if (await page.locator('[data-testid=gl-add-figure-label]').count()) {
    await page.click('[data-testid=gl-add-figure-label]');
    await wait(page, 150);
  }
  await page.click('[data-testid=gl-save]');
  await wait(page, 300);
  if (exportPng) {
    const download = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    await page.click('[data-testid=gl-export-png-300]');
    await download;
    await wait(page, 900);
  }
  await page.click('[data-testid=gl-close]');
  await wait(page, 400);
  return true;
}

async function clickIfPresent(page, selector) {
  const element = page.locator(selector);
  if (!(await element.count())) return false;
  await element.click();
  return true;
}

async function handleAction(page, action) {
  const selector = `[data-testid=tut-action-${action}]`;
  switch (action) {
    case 'load-sample':
      await page.click(selector);
      await wait(page, 500);
      return;
    case 'open-analysis':
      await page.click(selector);
      await page.waitForSelector('[data-testid=analysis-dialog]', { timeout: 8000 });
      await page.click('[data-testid=dialog-ok]');
      await wait(page, 700);
      return;
    case 'apply-preset':
      await page.click(selector);
      await page.waitForSelector('[data-testid=analysis-dialog]', { timeout: 8000 });
      await wait(page, 200);
      return;
    case 'run-analysis': {
      if (await page.locator('[data-testid=analysis-dialog]').count()) {
        await page.click('[data-testid=dialog-ok]');
      } else {
        await page.click(selector);
      }
      await wait(page, 700);
      return;
    }
    case 'open-help':
      await page.click(selector);
      await page.waitForSelector('[data-testid=help-center]', { timeout: 8000 });
      await wait(page, 200);
      await page.click('[data-testid=help-center-close]');
      await wait(page, 250);
      return;
    case 'open-model-manager':
      await saveModelCards(page);
      if (!(await clickIfPresent(page, selector))) return; // the step advanced as the models were stored
      await page.waitForSelector('[data-testid=model-manager]', { timeout: 8000 });
      await wait(page, 200);
      await page.click('[data-testid=mm-close]');
      await wait(page, 250);
      return;
    case 'open-chart':
      await saveModelCards(page);
      if (!(await clickIfPresent(page, selector))) return;
      await wait(page, 700);
      return;
    case 'open-optimizer':
      await saveModelCards(page);
      if (!(await clickIfPresent(page, selector))) return;
      await page.waitForSelector('[data-testid=optimizer]', { timeout: 8000 });
      await page.click('[data-testid=opt-run]');
      await page.waitForFunction(() => {
        const run = document.querySelector('[data-testid=opt-run]');
        return run && !run.disabled;
      }, null, { timeout: 45000 });
      await wait(page, 700);
      await page.click('[data-testid=opt-close]');
      await wait(page, 300);
      return;
    case 'open-profiler':
      await page.click(selector);
      await page.waitForSelector('[data-testid=profiler]', { timeout: 8000 });
      await wait(page, 400);
      if (await page.locator('[data-testid=prof-save]').count()) await page.click('[data-testid=prof-save]');
      await wait(page, 300);
      await page.click('[data-testid=prof-close]');
      await wait(page, 300);
      return;
    case 'open-layout':
      await page.click(selector);
      await page.waitForSelector('[data-testid=graph-layout]', { timeout: 8000 });
      await wait(page, 400);
      await composeFigure(page);
      return;
    case 'export-chart':
      await page.click(selector);
      await page.waitForSelector('[data-testid=graph-layout]', { timeout: 8000 });
      await wait(page, 400);
      await composeFigure(page);
      return;
    case 'export-project': {
      const download = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
      await page.click(selector);
      await download;
      await wait(page, 700);
      return;
    }
    case 'validate-result':
      await page.click(selector);
      await wait(page, 500);
      return;
    default:
      throw new Error(`unhandled action ${action}`);
  }
}

async function runTutorial(page, tutorialId) {
  await startTutorial(page, tutorialId);
  let step = await currentStepId(page);
  let guard = 0;
  const attempts = new Map();
  while (step && guard < 60) {
    guard += 1;
    if (await page.locator('[data-testid=tutorial-summary]').count()) break;
    // A dialog the previous step opened hides the dock; running it is the reader's next move.
    if (await page.locator('[data-testid=analysis-dialog]').count()) {
      await page.click('[data-testid=dialog-ok]');
      await wait(page, 700);
      const afterRun = await currentStepId(page);
      if (afterRun) step = afterRun;
      continue;
    }
    // A manual step is completed by the reader.
    const manual = page.locator('[data-testid=tut-manual-complete]');
    if (await manual.count() && await manual.isVisible().catch(() => false)) {
      await manual.click();
      await wait(page, 350);
      const next = await currentStepId(page);
      if (next === step) break;
      step = next;
      continue;
    }
    const button = page.locator('[data-testid=tutorial-step] [data-testid^=tut-action-]').first();
    if (!(await button.count())) break;
    const testid = await button.getAttribute('data-testid');
    const action = testid.replace('tut-action-', '');
    console.log(`  [${tutorialId}] step ${step} → ${action}`);
    const key = `${step}:${action}`;
    attempts.set(key, (attempts.get(key) ?? 0) + 1);
    if (attempts.get(key) > 4) {
      const toast = (await page.locator('.toast').allInnerTexts()).join(' | ');
      const message = (await page.locator('[data-testid=tut-message]').allInnerTexts()).join(' | ');
      throw new Error(`step ${step} did not advance after ${action}: ${await stepStatus(page)} :: toast=${toast} :: message=${message}`);
    }
    await handleAction(page, action);
    if (process.env.SHOT_MATCH && new RegExp(process.env.SHOT_MATCH).test(action)) {
      await wait(page, 500);
      await shot(page, `step-${tutorialId}-${action}`);
    }
    await wait(page, 400);
    let next = await currentStepId(page);
    if (next === step) {
      // The step needs more than its primary action (several presets, a second analysis).
      const presets = await page.locator('[data-testid^=tut-preset-]').count();
      for (let index = 0; index < presets; index += 1) {
        const preset = page.locator('[data-testid^=tut-preset-]').nth(index);
        if (!(await preset.count())) break;
        await preset.click();
        if (await page.waitForSelector('[data-testid=analysis-dialog]', { timeout: 6000 }).catch(() => null)) {
          await page.click('[data-testid=dialog-ok]');
          await wait(page, 600);
        }
        if (await page.locator('[data-testid=tutorial-summary]').count()) break;
      }
      next = await currentStepId(page);
    }
    if (!next) break;
    step = next;
  }
  const complete = await page.locator('[data-testid=tutorial-summary]').count();
  if (!complete) {
    throw new Error(`${tutorialId} did not reach the summary (step ${step}): ${await stepStatus(page)}`);
  }
  const text = await page.locator('[data-testid=tutorial-summary]').innerText();
  return text;
}

async function exitPractice(page, mode = 'keep') {
  if (!(await page.locator('[data-testid=tutorial-dock]').count())) return;
  if (!(await page.locator('[data-testid=tutorial-exit-dialog]').count())) {
    await page.click('[data-testid=tut-exit]');
  }
  await page.waitForSelector('[data-testid=tutorial-exit-dialog]', { timeout: 8000 });
  if (mode === 'discard') {
    await page.click('[data-testid=tutorial-exit-discard]');
  } else {
    await page.click('[data-testid=tutorial-exit-keep]');
  }
  await wait(page, 700);
}

async function main() {
  const server = await serve();
  const { browser, name } = await launchBrowser();
  console.log(`browser ${name}`);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  context.setDefaultTimeout(Number(process.env.STEP_TIMEOUT || 12000));
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('dialog', (dialog) => { void dialog.accept(); });

  await page.goto(`http://127.0.0.1:${PORT}/PKPilot0018/`, { waitUntil: 'load' });
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
  await page.reload({ waitUntil: 'load' });
  await wait(page, 800);

  // Entry points: Help ▸ Tutorials, the Learn button and Sample Library → related tutorials.
  await openLibrary(page);
  const cards = await page.locator('[data-testid^=tut-card-]').count();
  record('library lists twelve tutorials', cards === 12, `${cards} cards`);
  await page.locator('[data-testid=tutorial-search]').fill('optimization');
  const filtered = await page.locator('[data-testid^=tut-card-]').count();
  record('library search filters', filtered === 1, `${filtered} card for “optimization”`);
  await page.locator('[data-testid=tutorial-search]').fill('');
  await shot(page, '01-tutorial-library');
  await page.click('[data-testid=tutorial-library-close]');

  // WO-TQA-13: the status bar states the build's own stage.
  const statusbar = await page.locator('.statusbar').innerText();
  record('status bar states the build stage', /PHASE 3/.test(statusbar) && !/PHASE 1/.test(statusbar), statusbar.split('\n').pop());

  await page.click('[data-testid=sample-button]');
  await page.click('[data-testid=sample-library-open]');
  await page.waitForSelector('[data-testid=sample-library]', { timeout: 8000 });
  const samples = await page.locator('[data-testid^=sample-item-]').count();
  record('sample library lists every dataset', samples === 8, `${samples} datasets`);
  await shot(page, '02-sample-library');
  await page.click('[data-testid=sample-library-close]');

  await page.click('[data-testid=menu-help]');
  await page.click('[data-testid=menu-item-helpCenter]');
  await page.waitForSelector('[data-testid=help-center]', { timeout: 8000 });
  const docs = await page.locator('[data-testid^=help-item-]').count();
  record('help center has theory documents', docs >= 18, `${docs} documents`);
  await shot(page, '03-help-center');
  await page.click('[data-testid=help-center-close]');

  const targets = ONLY.length ? TUTORIALS.filter((id) => ONLY.includes(id)) : TUTORIALS;
  for (const tutorialId of targets) {
    try {
      const summaryText = await runTutorial(page, tutorialId);
      record(`tutorial ${tutorialId} completes`, true, summaryText.split('\n')[0]);
      if (tutorialId === 'tutorial-rsm-001') {
        await shot(page, '04-flagship-summary');
        const summary = await page.locator('[data-testid=tutorial-summary]').innerText();
        record('flagship summary states the confirmation experiment', /confirmation|확인 실험/i.test(summary), '');
        const optimizer = await page.locator('[data-testid=tut-summary-optimizer]').count();
        record('flagship summary reports the optimiser result', optimizer === 1, '');
        // WO-TQA-10: a lesson finished without skips is reported as its own outcome.
        const completion = await page.locator('[data-testid=tut-completion]').getAttribute('data-completion');
        record('flagship summary states how the practice ended', completion === 'verified', String(completion));
        await page.click('[data-testid=tut-review]');
        await wait(page, 400);
        const reopened = (await page.locator('[data-testid=tutorial-step]').count()) === 1
          && (await page.locator('[data-testid=tutorial-summary]').count()) === 0;
        record('review steps reopens the lesson', reopened, '');
        await page.click('[data-testid=tut-show-summary]');
        await wait(page, 300);
      }
      await exitPractice(page, 'keep');
      await wait(page, 800);
    } catch (error) {
      record(`tutorial ${tutorialId} completes`, false, error.message.split('\n')[0]);
      await shot(page, `failed-${tutorialId}`);
      try { await exitPractice(page, 'discard'); } catch { /* ignore */ }
      await wait(page, 500);
    }
  }

  // Practice isolation: the reader's own sheet, columns and outputs survive a lesson.
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
  await page.reload({ waitUntil: 'load' });
  await wait(page, 700);
  await page.click('[data-testid=sample-button]');
  await page.click('[data-testid=sample-process]');
  await wait(page, 500);
  await page.click('[data-testid=quick-desc]');
  await page.waitForSelector('[data-testid=analysis-dialog]', { timeout: 6000 });
  await page.click('[data-testid=slot-variables]');
  await page.click('[data-testid=var-C1]');
  await page.click('[data-testid=add-selected]');
  await page.click('[data-testid=dialog-ok]');
  await wait(page, 800);
  const before = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll('.ws-tab')].map((element) => element.textContent?.replace('×', '').trim()),
    outputs: document.querySelectorAll('[data-testid=out-card]').length,
    status: document.querySelector('[data-testid=workspace]')?.getAttribute('data-layout'),
  }));
  await startTutorial(page, 'tutorial-start-001');
  await page.click('[data-testid=tut-action-load-sample]');
  await wait(page, 600);
  const during = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll('.ws-tab')].map((element) => element.textContent?.replace('×', '').trim()),
    outputs: document.querySelectorAll('[data-testid=out-card]').length,
  }));
  record('practice starts in its own project', Boolean(during.tabs?.[0]?.startsWith('Practice ·')) && during.outputs === 0 && !during.tabs?.includes('Worksheet 1'), JSON.stringify(during));
  await exitPractice(page, 'keep');
  await wait(page, 900);
  const after = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll('.ws-tab')].map((element) => element.textContent?.replace('×', '').trim()),
    outputs: document.querySelectorAll('[data-testid=out-card]').length,
    status: document.querySelector('[data-testid=workspace]')?.getAttribute('data-layout'),
  }));
  record('original project restored unchanged', JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);

  // WO-TQA-07: a second kept practice must not overwrite the first.
  await startTutorial(page, 'tutorial-start-001');
  await exitPractice(page, 'keep');
  await wait(page, 600);
  await startTutorial(page, 'tutorial-normality-001');
  await exitPractice(page, 'keep');
  await wait(page, 600);
  await openLibrary(page);
  const keptOne = await page.locator('[data-testid=tut-resume-tutorial-start-001]').count();
  const keptTwo = await page.locator('[data-testid=tut-resume-tutorial-normality-001]').count();
  record('two practice projects are kept side by side', keptOne === 1 && keptTwo === 1, `start=${keptOne} normality=${keptTwo}`);
  // WO-TQA-08: the older practice resumes with its project and its evidence.
  await page.click('[data-testid=tut-resume-tutorial-start-001]');
  await wait(page, 900);
  const resumedDock = await page.locator('[data-testid=tutorial-dock]').count();
  const resumedPractice = (await page.evaluate(() => [...document.querySelectorAll('.ws-tab')].map((element) => (element.textContent || '').replace('×', '').trim()))).some((tab) => tab.startsWith('Practice ·'));
  const resumedSession = await page.locator('[data-testid=tut-session-id]').count();
  record('the kept practice resumes with its project and session', resumedDock === 1 && resumedPractice && resumedSession === 1, `dock=${resumedDock} practiceTab=${resumedPractice} session=${resumedSession}`);
  if (await page.locator('[data-testid=tutorial-library]').count()) await page.click('[data-testid=tutorial-library-close]');
  await exitPractice(page, 'keep');
  await wait(page, 700);

  // WO-TQA-10: skipping every step lands on a summary that says so.
  await startTutorial(page, 'tutorial-spc-001');
  for (let index = 0; index < 14; index += 1) {
    if (await page.locator('[data-testid=tutorial-summary]').count()) break;
    const skip = page.locator('[data-testid=tut-skip]');
    if (!(await skip.count())) break;
    await skip.click();
    await wait(page, 250);
  }
  const skippedEnding = await page.locator('[data-testid=tut-completion]').getAttribute('data-completion').catch(() => null);
  record('a skipped-through lesson is not reported as a completed practice', skippedEnding === 'skipped', String(skippedEnding));
  await shot(page, '07-skipped-summary');
  await exitPractice(page, 'discard');
  await wait(page, 700);

  // Mobile: bottom sheet, workspace still reachable.
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, isMobile: true });
  const mobilePage = await mobile.newPage();
  mobilePage.on('dialog', (dialog) => { void dialog.accept(); });
  await mobilePage.goto(`http://127.0.0.1:${PORT}/PKPilot0018/`, { waitUntil: 'load' });
  await wait(mobilePage, 700);
  await mobilePage.click('[data-testid=learn-sigrun]');
  await mobilePage.waitForSelector('[data-testid=tutorial-library]', { timeout: 8000 });
  await mobilePage.click('[data-testid=tut-start-tutorial-hypothesis-001]');
  await mobilePage.waitForSelector('[data-testid=tutorial-start-dialog]', { timeout: 8000 });
  await mobilePage.click('[data-testid=tutorial-start-isolated]');
  await mobilePage.waitForSelector('[data-testid=tutorial-dock]', { timeout: 8000 });
  await wait(mobilePage, 500);
  const dockBox = await mobilePage.locator('[data-testid=tutorial-dock]').boundingBox();
  record('mobile tutorial opens as a bottom sheet', Boolean(dockBox && dockBox.y > 300 && dockBox.width > 300), JSON.stringify(dockBox));
  await shot(mobilePage, '05-mobile-sheet');
  await mobilePage.click('[data-testid=tut-collapse]');
  await wait(mobilePage, 400);
  await shot(mobilePage, '06-mobile-collapsed');
  record('no console errors during the run', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  try { await mobile.close(); } catch { /* already closed */ }
  try { await context.close(); } catch { /* already closed */ }
  try { await browser.close(); } catch { /* already closed */ }
  server.close();

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    for (const result of failed) console.log(`  FAILED: ${result.name} — ${result.detail}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(async (error) => {
  console.error('E2E FAILED', String(error.message).split('\n').slice(0, 4).join('\n'));
  process.exit(1);
});
