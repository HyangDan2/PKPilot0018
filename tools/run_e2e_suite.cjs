/* Statelia — Stage 3E integrated E2E runner.

   Starts one static server for dist/ and runs the suites in this repository
   against it, one after another, so a single command answers "does the whole
   Phase 1/2/3 browser surface still pass?".

     node tools/run_e2e_suite.cjs                 # every suite
     node tools/run_e2e_suite.cjs stage3 phase3_3d
     node tools/run_e2e_suite.cjs --live          # against GitHub Pages

   Each suite keeps its own report file in OUT (`work/pkpilot0018`), so the
   numbers in the report can be traced back to a run.
*/
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const { libraries: browserLibraries } = require('./browser_env.cjs');

const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.OUT || path.resolve(__dirname, '..', '..', 'pkpilot0018');
const PORT = Number(process.env.SUITE_PORT || 4197);
const LIVE = process.argv.includes('--live');
const LIVE_BASE = 'https://hyangdan2.github.io/PKPilot0018/';

/* name, script, needs a served BASE */
const SUITES = [
  {
    name: 'stage1', file: 'e2e_stage1.cjs', base: false, phase: 'Phase 1',
    /* 1920×1080 shots get their own process: the single-process sandbox
       browser dies when a second wide context opens after one is closed. */
    runs: [
      { label: 'selection', env: { PART: 'selection' } },
      { label: 'menus', env: { PART: 'menus' } },
      { label: 'column', env: { PART: 'column' } },
      { label: 'shots 1366', env: { PART: 'shots', WIDTH: '1366' } },
      { label: 'shots 1920', env: { PART: 'shots', WIDTH: '1920' } },
    ],
  },
  { name: 'stage2', file: 'e2e_stage2.cjs', base: false, phase: 'Phase 1' },
  { name: 'stage3', file: 'e2e_stage3.cjs', base: false, phase: 'Phase 1' },
  { name: 'followup', file: 'e2e_followup.cjs', base: true, phase: 'Phase 2' },
  { name: 'chart_axes', file: 'e2e_chart_axes.cjs', base: true, phase: 'Phase 2' },
  { name: 'chart_upgrade', file: 'e2e_chart_upgrade.cjs', base: true, phase: 'Phase 2' },
  {
    name: 'ui_compact', file: 'e2e_ui_compact.cjs', base: true, phase: 'Phase 1',
    runs: [
      { label: 'ui', env: { PART: 'ui' } },
      { label: 'panels', env: { PART: 'panels' } },
      { label: 'mobile 390', env: { PART: 'mobile', WIDTHS: '390' } },
      { label: 'mobile 320', env: { PART: 'mobile', WIDTHS: '320' } },
    ],
  },
  { name: 'phase3_3a', file: 'e2e_phase3_3a.cjs', base: false, phase: 'Phase 3' },
  { name: 'phase3_3b', file: 'e2e_phase3_3b.cjs', base: false, phase: 'Phase 3' },
  { name: 'phase3_3b_corrective', file: 'e2e_phase3_3b_corrective.cjs', base: false, phase: 'Phase 3' },
  { name: 'phase3_3c', file: 'e2e_phase3_3c.cjs', base: false, phase: 'Phase 3' },
  { name: 'phase3_3d', file: 'e2e_phase3_3d.cjs', base: false, phase: 'Phase 3' },
];

/** Run one suite asynchronously — execFileSync would block the event loop and
 *  the static server in this process could not answer the page. */
function runSuite(script, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { cwd: ROOT, env });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 900000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, output }); });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function startServer() {
  const root = path.join(ROOT, 'dist');
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
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

(async () => {
  const wanted = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const list = wanted.length ? SUITES.filter((suite) => wanted.includes(suite.name)) : SUITES;
  const server = LIVE ? null : await startServer();
  const base = LIVE ? LIVE_BASE : `http://127.0.0.1:${PORT}/PKPilot0018/`;
  const summary = [];
  for (const suite of list) {
    const script = path.join(ROOT, 'tools', suite.file);
    if (!fs.existsSync(script)) { console.log(`SKIP ${suite.name} — ${suite.file} is missing`); summary.push({ ...suite, ok: false, note: 'missing script' }); continue; }
    const env = { ...process.env, OUT, PATH: `${path.join(ROOT, 'node_modules', '.bin')}:${process.env.PATH}` };
    /* The suites resolve the browser binary and its libraries themselves
       (tools/browser_env.cjs); this hands on what that resolver found so the
       child processes inherit the same environment. */
    if (browserLibraries) env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH || browserLibraries;
    if (suite.base) env.BASE = base;
    if (LIVE && suite.base) env.SERVE = '0';
    console.log(`\n════ ${suite.name} (${suite.phase}) ════`);
    const started = Date.now();
    let output = '';
    let ok = true;
    /* The single-process headless shell cannot open a second context after one
       is closed, so suites that walk several parts run one part per process. */
    const runs = suite.runs ? suite.runs : [{ label: null, env: {} }];
    for (const run of runs) {
      const runEnv = { ...env, ...run.env };
      if (run.label) console.log(`  · ${run.label}`);
      const result = await runSuite(script, runEnv);
      output += result.output;
      if (result.code !== 0) ok = false;
    }
    const ms = Date.now() - started;
    const lines = output.split('\n');
    const failed = lines.filter((line) => /^\[FAIL/m.test(line));
    const passed = lines.filter((line) => /^\[PASS/m.test(line));
    const totals = lines.filter((line) => /checks passed|PASS .*\/|^\s*\d+\s*\/\s*\d+/.test(line));
    console.log(lines.filter((line) => /^\[(FAIL|PASS)/.test(line)).slice(-400).join('\n'));
    if (failed.length) console.log(failed.join('\n'));
    console.log(`── ${suite.name}: exit ${ok ? 0 : 'non-zero'} · ${passed.length} PASS · ${failed.length} FAIL · ${(ms / 1000).toFixed(1)}s`);
    fs.writeFileSync(path.join(OUT, `suite-${suite.name}.log`), output, 'utf8');
    summary.push({ ...suite, ok, pass: passed.length, fail: failed.length, ms, totals: totals.slice(-2) });
  }
  if (server) server.close();
  const suiteFile = process.env.SUITE_OUT || (LIVE ? 'phase3-3e-e2e-live-suite.json' : 'phase3-3e-e2e-suite.json');
  fs.writeFileSync(path.join(OUT, suiteFile), JSON.stringify({ base, at: new Date().toISOString(), summary }, null, 1));
  console.log('\n════ summary ════');
  for (const row of summary) console.log(`${row.ok ? 'ok  ' : 'FAIL'} ${row.name.padEnd(20)} ${String(row.pass).padStart(3)} PASS ${String(row.fail).padStart(2)} FAIL ${(row.ms / 1000).toFixed(1)}s`);
  const bad = summary.filter((row) => !row.ok).length;
  console.log(`${summary.length - bad}/${summary.length} suites clean`);
  if (bad) process.exitCode = 1;
})();
