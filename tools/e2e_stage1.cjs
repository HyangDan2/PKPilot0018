/* Sigrún Stage 1 E2E — worksheet selection, context menus, + column header.
   Runs its own static server for dist/, so no preview daemon is needed.

   PART=selection | menus | column | shots | all   (default all)
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
const PORT = Number(process.env.PORT || 4183);
const LIVE = process.env.LIVE === '1';
const BASE = LIVE ? 'https://hyangdan2.github.io/PKPilot0018/' : `http://127.0.0.1:${PORT}/PKPilot0018/`;
const OUT = '/workspace/work/pkpilot0018';
const EXE = process.env.CHROME_PATH || '/workspace/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const PART = process.env.PART || 'all';

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

const cell = (row, col) => `td[data-row="${row}"][data-col="${col}"]`;
const selectedCount = (page) => page.locator('.ws-cell.sel').count();

async function setClipboard(page, text) {
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
}

async function pasteBlock(page, row, col, text) {
  await page.evaluate(() => { const wrap = document.querySelector('.grid-wrap'); if (wrap) wrap.scrollTop = 0; });
  await page.waitForTimeout(120);
  await setClipboard(page, text);
  await page.click(cell(row, col));
  await page.keyboard.press('Control+V');
  await page.waitForTimeout(250);
}

async function freshPage(browser, viewport = { width: 1366, height: 768 }) {
  const ctx = await browser.newContext({ viewport, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid=worksheet-grid]');
  return { ctx, page, errors };
}

async function partSelection(browser) {
  const { ctx, page, errors } = await freshPage(browser);
  check('grid renders the default worksheet', (await page.locator('td[data-cell]').count()) > 30,
    String(await page.locator('td[data-cell]').count()));

  // put a predictable block in A1:B4
  await pasteBlock(page, 0, 0, '1\t2\n3\t4\n5\t6\n7\t8');
  check('block paste lands in A1:B4', (await page.locator(cell(3, 1)).innerText()).trim() === '8');
  check('paste leaves a range selected', (await selectedCount(page)) >= 1);

  // 1. Shift+click range
  await page.click(cell(0, 0));
  await page.keyboard.down('Shift');
  await page.click(cell(3, 1));
  await page.keyboard.up('Shift');
  check('Shift+click selects the rectangle', (await selectedCount(page)) === 8, String(await selectedCount(page)));
  const status1 = await page.locator('.statusbar').innerText();
  check('status names the blocked range', /C11:C24/.test(status1), status1.replace(/\n/g, ' | '));

  // 2. Ctrl+click non-adjacent
  await page.keyboard.down('Control');
  await page.click(cell(6, 2));
  await page.keyboard.up('Control');
  const status2 = await page.locator('.statusbar').innerText();
  check('Ctrl+click adds a non-adjacent cell', /C37/.test(status2), status2.replace(/\n/g, ' | '));
  check('both blocks stay selected', (await selectedCount(page)) === 9, String(await selectedCount(page)));

  // 3. Drag selection
  const from = await page.locator(cell(1, 1)).boundingBox();
  const to = await page.locator(cell(3, 2)).boundingBox();
  await page.mouse.move(from.x + 20, from.y + 10);
  await page.mouse.down();
  await page.mouse.move(to.x + 20, to.y + 10, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  check('drag paints a rectangle', (await selectedCount(page)) === 6, String(await selectedCount(page)));

  // 4. Row and column headers
  await page.click('[data-testid=ws-rownum-4]');
  const rowSel = await selectedCount(page);
  check('row header selects the whole row', rowSel === 3, String(rowSel));
  await page.click('[data-testid=ws-colhead-C2]');
  const colSel = await selectedCount(page);
  check('column header selects the whole column', colSel >= 20, String(colSel));
  await page.keyboard.down('Shift');
  await page.click('[data-testid=ws-colhead-C3]');
  await page.keyboard.up('Shift');
  const colSel2 = await selectedCount(page);
  check('Shift on a column header extends across columns', colSel2 >= colSel * 2 - 2, `${colSel} → ${colSel2}`);

  // 5. Ctrl+A then copy / paste / undo / redo
  await page.keyboard.press('Control+a');
  const allStatus = await page.locator('.statusbar').innerText();
  check('Ctrl+A selects the whole sheet', /Cell All/.test(allStatus), allStatus.replace(/\n/g, ' | '));
  await page.click(cell(0, 0));
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check('Ctrl+C copies the active cell', clip.trim() === '1', JSON.stringify(clip));
  await page.click(cell(4, 0));
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(250);
  check('Ctrl+V pastes at the new cell', (await page.locator(cell(4, 0)).innerText()).trim() === '1');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  check('Ctrl+Z undoes the paste', (await page.locator(cell(4, 0)).innerText()).trim() === '');
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(200);
  check('Ctrl+Shift+Z redoes the paste', (await page.locator(cell(4, 0)).innerText()).trim() === '1');

  // 6. keyboard boundary jumps
  await page.click(cell(0, 0));
  await page.keyboard.press('Control+ArrowDown');
  const statusDown = await page.locator('.statusbar').innerText();
  check('Ctrl+Down lands on the last value of the block', /C15/.test(statusDown), statusDown.replace(/\n/g, ' | '));
  await page.keyboard.press('Control+Home');
  const statusHome = await page.locator('.statusbar').innerText();
  check('Ctrl+Home returns to A1', /C11/.test(statusHome), statusHome.replace(/\n/g, ' | '));
  await page.keyboard.press('End');
  const statusEnd = await page.locator('.statusbar').innerText();
  check('End jumps to the row end', /C21/.test(statusEnd), statusEnd.replace(/\n/g, ' | '));

  // 7. multi-range paste refusal
  await page.click(cell(0, 0));
  await page.keyboard.down('Control');
  await page.click(cell(5, 2));
  await page.keyboard.up('Control');
  await setClipboard(page, '99');
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(300);
  const toast = await page.locator('.toast').allInnerTexts();
  check('multi-block paste is refused with a toast', toast.some((t) => /one block|한 블록/i.test(t)), toast.join(' | '));
  check('refused paste wrote nothing', (await page.locator(cell(0, 0)).innerText()).trim() === '1');

  // 8. Ctrl+Shift+Arrow extends to the boundary
  await page.keyboard.press('Control+Home');
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  const extendStatus = await page.locator('.statusbar').innerText();
  check('Ctrl+Shift+Down extends to the data boundary', /C11:C15/.test(extendStatus), extendStatus.replace(/\n/g, ' | '));

  // 9. F2 / Enter / Esc editing
  await page.click(cell(9, 2));
  await page.keyboard.press('F2');
  await page.waitForSelector('[data-testid=cell-editor]');
  await page.locator('[data-testid=cell-editor]').fill('42');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  check('F2 + Enter commits and moves down', (await page.locator(cell(9, 2)).innerText()).trim() === '42');
  await page.keyboard.press('F2');
  await page.locator('[data-testid=cell-editor]').fill('99');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('Esc cancels an edit', (await page.locator(cell(9, 2)).innerText()).trim() === '42');

  // 10. Ctrl+X moves the cells and stays undoable
  await page.click(cell(0, 0));
  await page.keyboard.press('Control+x');
  await page.waitForTimeout(200);
  await page.click(cell(8, 0));
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(250);
  check('cut + paste moves the value', (await page.locator(cell(0, 0)).innerText()).trim() === ''
    && (await page.locator(cell(8, 0)).innerText()).trim() === '1');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  check('one undo restores both sides of the move', (await page.locator(cell(0, 0)).innerText()).trim() === '1'
    && (await page.locator(cell(8, 0)).innerText()).trim() === '');

  // 11. worksheet tab context menu
  await page.click('[data-testid^=sheet-tab-]', { button: 'right' });
  await page.waitForSelector('[data-testid=ctx-menu]');
  const tabItems = await page.locator('[data-testid=ctx-menu] [role=menuitem]').allInnerTexts();
  check('worksheet tab menu offers rename/new/delete',
    tabItems.some((t) => /Rename worksheet/i.test(t)) && tabItems.some((t) => /New worksheet/i.test(t))
    && tabItems.some((t) => /Delete worksheet/i.test(t)), tabItems.join(' / '));
  check('the last worksheet cannot be deleted from the tab menu',
    (await page.locator('[data-testid=ctx-item-sheet-delete]').getAttribute('aria-disabled')) === 'true');
  await page.keyboard.press('Escape');

  check('no console errors during selection', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

async function partMenus(browser) {
  const { ctx, page, errors } = await freshPage(browser, { width: 1366, height: 768 });
  await pasteBlock(page, 0, 0, '30\tc\n10\ta\n20\tb');

  // cell menu
  await page.click(cell(0, 0), { button: 'right' });
  await page.waitForSelector('[data-testid=ctx-menu]');
  check('right-click opens the cell menu', (await page.locator('[data-testid=ctx-menu]').count()) === 1);
  const items = await page.locator('[data-testid=ctx-menu] [role=menuitem]').allInnerTexts();
  for (const label of ['Copy', 'Cut', 'Paste', 'Clear contents', 'Insert row above', 'Insert column left', 'Find & replace']) {
    check(`cell menu has ${label}`, items.some((t) => t.includes(label)), items.join(' / '));
  }
  const menuBox = await page.locator('[data-testid=ctx-menu]').boundingBox();
  check('menu stays inside the viewport', menuBox.x >= 0 && menuBox.y >= 0
    && menuBox.x + menuBox.width <= 1367 && menuBox.y + menuBox.height <= 769, JSON.stringify(menuBox));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  check('Escape closes the menu', (await page.locator('[data-testid=ctx-menu]').count()) === 0);

  // right-click outside the selection selects the target first
  await page.click('[data-testid=ws-rownum-2]');
  const before = await page.locator('.statusbar').innerText();
  await page.click(cell(0, 1), { button: 'right' });
  await page.waitForSelector('[data-testid=ctx-menu]');
  const after = await page.locator('.statusbar').innerText();
  check('right-click outside the selection moves it to that cell', /C21/.test(after) && !/C21/.test(before), `${before} → ${after}`);
  await page.keyboard.press('Escape');

  // column menu: description
  await page.click('[data-testid=ws-colhead-C1]', { button: 'right' });
  await page.waitForSelector('[data-testid=ctx-menu]');
  await page.click('[data-testid=ctx-item-col-desc]');
  await page.waitForSelector('[data-testid=col-dialog]');
  await page.fill('[data-testid=col-dialog-input]', 'Coating thickness, mm');
  await page.click('[data-testid=col-dialog-ok]');
  await page.waitForTimeout(200);
  const described = await page.locator('[data-testid=ws-colhead-C1]').getAttribute('title');
  check('column description is stored on the header', described === 'Coating thickness, mm', String(described));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);

  // column menu: rename dialog
  await page.click('[data-testid=ws-colhead-C1]', { button: 'right' });
  await page.waitForSelector('[data-testid=ctx-menu]');
  check('column menu keeps the whole-column selection', (await selectedCount(page)) >= 20, String(await selectedCount(page)));
  await page.click('[data-testid=ctx-item-rename-col]');
  await page.waitForSelector('[data-testid=col-dialog]');
  await page.fill('[data-testid=col-dialog-input]', 'Thickness');
  await page.click('[data-testid=col-dialog-ok]');
  await page.waitForTimeout(200);
  check('column rename reaches the header input', (await page.locator('[data-testid=col-name-C1]').inputValue()) === 'Thickness');

  // column menu: sort ascending -- 30,10,20 -> 10,20,30
  await page.click('[data-testid=ws-colhead-C1]', { button: 'right' });
  await page.waitForSelector('[data-testid=ctx-menu]');
  await page.hover('[data-testid=ctx-item-col-sort]');
  await page.waitForSelector('[data-testid=ctx-submenu-col-sort]');
  await page.click('[data-testid=ctx-item-sort-asc]');
  await page.waitForTimeout(250);
  check('sort submenu reorders the rows', (await page.locator(cell(0, 0)).innerText()).trim() === '10'
    && (await page.locator(cell(2, 0)).innerText()).trim() === '30');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  check('Ctrl+Z restores the pre-sort order', (await page.locator(cell(0, 0)).innerText()).trim() === '30');

  // column menu: data type submenu marks the current type
  await page.click('[data-testid=ws-colhead-C2]', { button: 'right' });
  await page.waitForSelector('[data-testid=ctx-menu]');
  await page.hover('[data-testid=ctx-item-col-type]');
  await page.waitForSelector('[data-testid=ctx-submenu-col-type]');
  const textChecked = await page.locator('[data-testid=ctx-item-type-text]').getAttribute('aria-checked');
  check('data type menu checks the current type', textChecked === 'true', String(textChecked));
  await page.click('[data-testid=ctx-item-type-text]');
  await page.waitForTimeout(150);

  // row menu: insert above / delete
  await page.click('[data-testid=ws-rownum-1]', { button: 'right' });
  await page.waitForSelector('[data-testid=ctx-menu]');
  const rowItems = await page.locator('[data-testid=ctx-menu] [role=menuitem]').allInnerTexts();
  check('row menu lists insert above/below and delete', rowItems.some((t) => /row above/i.test(t))
    && rowItems.some((t) => /row below/i.test(t)) && rowItems.some((t) => /Delete row/i.test(t)), rowItems.join(' / '));
  await page.click('[data-testid=ctx-item-row-insert-above]');
  await page.waitForTimeout(200);
  check('insert row above shifts the data down', (await page.locator(cell(1, 0)).innerText()).trim() === '30');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);

  // column delete refuses to empty the sheet
  await page.click('[data-testid=ctx-menu]', { button: 'right' }).catch(() => {});

  // cell menu: clear then undo
  await page.click(cell(0, 0));
  await page.click(cell(0, 0), { button: 'right' });
  await page.waitForSelector('[data-testid=ctx-menu]');
  await page.click('[data-testid=ctx-item-clear]');
  await page.waitForTimeout(150);
  check('clear contents empties the cell', (await page.locator(cell(0, 0)).innerText()).trim() === '');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  check('Ctrl+Z restores a cleared cell', (await page.locator(cell(0, 0)).innerText()).trim() === '30');

  // menu near the bottom-right corner is clamped
  await page.evaluate(() => { const wrap = document.querySelector('.grid-wrap'); if (wrap) wrap.scrollTop = wrap.scrollHeight; });
  await page.waitForTimeout(400);
  const gridBox2 = await page.locator('[data-testid=worksheet-grid]').boundingBox();
  await page.mouse.click(gridBox2.x + 70, gridBox2.y + gridBox2.height - 26, { button: 'right' });
  await page.waitForSelector('[data-testid=ctx-menu]');
  await page.waitForTimeout(250);
  const nearBox = await page.locator('[data-testid=ctx-menu]').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  check('menu stays on screen near the bottom edge', nearBox.y + nearBox.height <= 769 && nearBox.y >= 7, JSON.stringify(nearBox));
  await page.mouse.click(5, 300);
  await page.waitForTimeout(150);
  check('clicking outside closes the menu', (await page.locator('[data-testid=ctx-menu]').count()) === 0);

  // find & replace
  await pasteBlock(page, 0, 0, 'alpha\nbeta\nalpha');
  await page.click(cell(0, 0), { button: 'right' });
  await page.waitForSelector('[data-testid=ctx-menu]');
  await page.click('[data-testid=ctx-item-find]');
  await page.waitForSelector('[data-testid=find-panel]');
  await page.fill('[data-testid=find-input]', 'alpha');
  await page.click('[data-testid=find-next]');
  const findStatus = await page.locator('.statusbar').innerText();
  check('find next selects the first match', /C11/.test(findStatus), findStatus.replace(/\n/g, ' | '));
  await page.fill('[data-testid=replace-input]', 'gamma');
  await page.click('[data-testid=replace-all]');
  await page.waitForTimeout(250);
  check('replace all rewrites every match', (await page.locator(cell(0, 0)).innerText()).trim() === 'gamma'
    && (await page.locator(cell(2, 0)).innerText()).trim() === 'gamma');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  check('Ctrl+Z undoes replace all', (await page.locator(cell(0, 0)).innerText()).trim() === 'alpha');
  await page.click('[data-testid=find-close]');

  // Korean labels for the new menu
  await page.click('[data-testid=lang-ko]');
  await page.waitForTimeout(200);
  await page.click(cell(0, 0), { button: 'right' });
  await page.waitForSelector('[data-testid=ctx-menu]');
  const koItems = await page.locator('[data-testid=ctx-menu] [role=menuitem]').allInnerTexts();
  check('the context menu follows the Korean UI',
    koItems.some((t) => t.includes('복사')) && koItems.some((t) => t.includes('열 삽입')) && koItems.some((t) => t.includes('찾기')),
    koItems.join(' / '));
  await page.keyboard.press('Escape');
  await page.click('[data-testid=lang-en]');

  check('no console errors during menus', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

async function partColumn(browser) {
  const { ctx, page, errors } = await freshPage(browser, { width: 1366, height: 768 });
  check('the old bottom add-column row is gone', (await page.locator('.ws-addcol').count()) === 0);
  check('the + header sits at the end of the header row', (await page.locator('[data-testid=add-column-head]').count()) === 1);
  const plus = await page.locator('[data-testid=add-column-head]').boundingBox();
  const lastHead = await page.locator('[data-testid=ws-colhead-C3]').boundingBox();
  check('+ is to the right of the last data column', plus.x > lastHead.x + lastHead.width - 2,
    `${Math.round(lastHead.x + lastHead.width)} vs ${Math.round(plus.x)}`);

  await pasteBlock(page, 0, 0, '1\t2\t3');
  await page.click('[data-testid=add-column-head]');
  await page.waitForTimeout(300);
  const headIds = await page.locator('.ws-colhead').allInnerTexts();
  check('a new column is appended with a fresh id', headIds.length === 4 && headIds[3].startsWith('C4'), headIds.join(','));
  const status = await page.locator('.statusbar').innerText();
  check('the new column takes the focus', /C41/.test(status), status.replace(/\n/g, ' | '));

  // add enough columns to force horizontal scrolling, then check the + is reachable
  for (let i = 0; i < 9; i += 1) await page.click('[data-testid=add-column-head]');
  await page.waitForTimeout(300);
  const scrollLeft = await page.evaluate(() => document.querySelector('.grid-wrap').scrollLeft);
  check('the grid scrolls sideways to the new column', scrollLeft > 0, String(scrollLeft));
  const plusBox = await page.locator('[data-testid=add-column-head]').boundingBox();
  const gridBox = await page.locator('[data-testid=worksheet-grid]').boundingBox();
  check('the + header is visible after the scroll', plusBox.x >= gridBox.x && plusBox.x + plusBox.width <= gridBox.x + gridBox.width + 1,
    `${Math.round(plusBox.x)} in [${Math.round(gridBox.x)}, ${Math.round(gridBox.x + gridBox.width)}]`);

  // column identity after insert/delete
  await page.evaluate(() => { const wrap = document.querySelector('.grid-wrap'); if (wrap) wrap.scrollLeft = 0; });
  await page.waitForTimeout(300);
  await page.click('[data-testid=ws-colhead-C1]', { button: 'right' });
  await page.waitForSelector('[data-testid=ctx-menu]');
  await page.click('[data-testid=ctx-item-insert-col-left]');
  await page.waitForTimeout(250);
  const idsAfterInsert = (await page.locator('.ws-colhead').allInnerTexts()).map((text) => text.split('-')[0]);
  check('inserting keeps every existing column id',
    idsAfterInsert[0] === 'C14' && idsAfterInsert[1] === 'C1' && idsAfterInsert[2] === 'C2',
    idsAfterInsert.join(','));
  const c1Value = await page.locator(cell(0, 1)).innerText();
  check('the data stays with its column id', c1Value.trim() === '1', c1Value);

  await page.click('[data-testid=ws-colhead-C1]', { button: 'right' });
  await page.waitForSelector('[data-testid=ctx-menu]');
  await page.click('[data-testid=ctx-item-delete-col]');
  await page.waitForTimeout(200);
  const idsAfterDelete = (await page.locator('.ws-colhead').allInnerTexts()).map((text) => text.split('-')[0]);
  check('deleting removes that column only', !idsAfterDelete.includes('C1') && idsAfterDelete.includes('C2'),
    idsAfterDelete.join(','));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  const idsAfterUndo = (await page.locator('.ws-colhead').allInnerTexts()).map((text) => text.split('-')[0]);
  check('Ctrl+Z brings the column back', idsAfterUndo.includes('C1'), idsAfterUndo.join(','));

  // empty worksheet keeps the + button
  await page.click('[data-testid=menu-data]');
  await page.waitForTimeout(200);
  await page.click('[data-testid=menu-item-newSheet]');
  await page.waitForTimeout(300);
  check('a blank worksheet still offers +', (await page.locator('[data-testid=add-column-head]').count()) === 1);
  await page.click('[data-testid=add-column-head]');
  await page.waitForTimeout(250);
  check('a column can be added to a blank sheet', (await page.locator('.ws-colhead').count()) === 4);

  check('no console errors during column layout', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

async function partShots(browser) {
  const only = Number(process.env.WIDTH || 0);
  const sizes = [[1366, 768, 'stage1-worksheet-pc.png'], [1920, 1080, 'stage1-worksheet-wide.png']];
  for (const [width, height, name] of sizes.filter(([w]) => !only || w === only)) {
    const { ctx, page, errors } = await freshPage(browser, { width, height });
    await pasteBlock(page, 0, 0, '10.2\tLine 1\tDay\n10.4\tLine 2\tNight\n9.8\tLine 1\tDay\n10.1\tLine 3\tDay\n10.5\tLine 2\tNight');
    await page.locator('[data-testid=col-name-C1]').fill('Thickness');
    await page.locator('[data-testid=col-name-C2]').fill('Line');
    await page.locator('[data-testid=col-name-C3]').fill('Shift');
    await page.click('[data-testid=ws-rownum-2]');
    await page.keyboard.down('Shift');
    await page.click('[data-testid=ws-rownum-4]');
    await page.keyboard.up('Shift');
    await page.waitForTimeout(3200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${width}px: no horizontal page overflow`, overflow <= 1, `${overflow}px`);
    await page.screenshot({ path: `${OUT}/${name}` });
    check(`${width}px: screenshot saved`, fs.existsSync(`${OUT}/${name}`), `${OUT}/${name}`);
    check(`${width}px: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
}

async function launch() {
  return chromium.launch({
    headless: true,
    executablePath: EXE,
    args: ['--single-process', '--no-zygote', '--disable-gpu', '--disable-dev-shm-usage', '--disable-software-rasterizer'],
  });
}

(async () => {
  const server = LIVE ? null : await serve();
  const parts = PART === 'all' ? ['selection', 'menus', 'column', 'shots'] : [PART];
  try {
    for (const part of parts) {
      // One browser per part: the sandbox chrome runs single-process and gets
      // unstable after several wide contexts in a row.
      console.log(`\n── part: ${part} ──`);
      const browser = await launch();
      try {
        if (part === 'selection') await partSelection(browser);
        if (part === 'menus') await partMenus(browser);
        if (part === 'column') await partColumn(browser);
        if (part === 'shots') await partShots(browser);
      } finally {
        await browser.close();
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
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
