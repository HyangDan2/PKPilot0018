/* Sigrún — offline & enterprise security qualification (WO-FINAL-001 · WO-05)

   A string search for "http" cannot prove a page stays offline: the URL can be
   built at runtime. This audit opens the real builds in a real browser, records
   every request the engine makes (document, scripts, styles, XHR/fetch, beacons,
   images, fonts) and fails on any host that is not the page's own origin.

   It audits three builds:
     web        dist/                 public edition served under /PKPilot0018/
     portable   dist-portable/…html   file:// single-file build
     enterprise dist-enterprise-audit  built here from the same tree

   Enterprise also proves its isolation: no outbound menu links, its own storage
   namespace, and a manifest generated from its own edition record. The public
   build keeps its outbound links, so the gate is edition-driven, not a deletion.

   Usage: node tools/qa_network_audit.cjs   (npm run qa:network)
*/
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const { launchBrowser } = require('./e2e_browser.cjs');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 4199);
const BASE = `http://127.0.0.1:${PORT}/PKPilot0018/`;
const ENTERPRISE_DIST = path.join(ROOT, 'dist-enterprise-audit');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} · ${name}${detail ? ` · ${detail}` : ''}`);
}

function serve(root, port = PORT, prefix = '/PKPilot0018/') {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (!urlPath.startsWith(prefix)) { res.writeHead(404); res.end('not found'); return; }
      let rel = urlPath.slice(prefix.length);
      if (!rel || rel.endsWith('/')) rel += 'index.html';
      const file = path.join(root, rel);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

/** Every request the page made, classified by whether it left the origin. */
function monitor(page) {
  const requests = [];
  const failures = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('requestfailed', (request) => failures.push(`${request.url()} ${request.failure()?.errorText ?? ''}`));
  return { requests, failures };
}

function externalRequests(requests, allowedOrigins) {
  return requests.filter((url) => {
    const scheme = url.split(':')[0];
    if (scheme === 'data' || scheme === 'blob' || scheme === 'about' || scheme === 'file') return false;
    return !allowedOrigins.some((origin) => url.startsWith(origin));
  });
}

async function boot(page, url) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('[data-testid=brand]', { timeout: 15000 });
}

async function exercise(page) {
  // Open the menu (where the outbound links live), Help ▸ About, and a sample.
  await page.click('[data-testid=menu-button]');
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.keyboard.press('?').catch(() => {});
  await page.waitForTimeout(400);
  const helpClose = page.locator('.modal [aria-label="Close"], .modal [data-testid=help-close]');
  if (await helpClose.count()) await helpClose.first().click();
  await page.click('[data-testid=sample-button]').catch(() => {});
  await page.waitForTimeout(600);
  const sample = page.locator('[data-testid=sample-process]');
  if (await sample.count()) { await sample.click(); await page.waitForTimeout(800); }
}

async function auditWeb(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const seen = monitor(page);
  await boot(page, BASE);
  await exercise(page);
  const leaked = externalRequests(seen.requests, [BASE.replace(/\/$/, '')]);
  check('web: the page loads and makes requests', seen.requests.length > 0, `${seen.requests.length} requests`);
  check('web: no request leaves the page’s own origin', leaked.length === 0, leaked.slice(0, 3).join(' | ') || 'none');
  const perf = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
  const perfLeaked = externalRequests(perf, [BASE.replace(/\/$/, '')]);
  check('web: performance timeline agrees', perfLeaked.length === 0, perfLeaked.slice(0, 3).join(' | ') || 'none');
  const anchors = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((href) => /^https?:/i.test(href ?? '')));
  await page.click('[data-testid=menu-button]');
  await page.waitForTimeout(250);
  const menuLinks = await page.evaluate(() => [...document.querySelectorAll('.menu-pop a[href]')].map((a) => a.getAttribute('href')).filter((href) => /^https?:/i.test(href ?? '')));
  check('web: the public build keeps its outbound menu links', menuLinks.length >= 2, menuLinks.join(' | '));
  check('web: no anchor is fetched by the page itself', anchors.every((href) => !seen.requests.includes(href)), `${anchors.length} anchors, none requested`);
  await context.close();
}

async function auditPortable(browser) {
  const html = path.join(ROOT, 'dist-portable', 'sigrun-portable.html');
  if (!fs.existsSync(html)) { check('portable: single-file build exists', false, html); return; }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const seen = monitor(page);
  await boot(page, pathToFileURL(html).href);
  await exercise(page);
  const network = seen.requests.filter((url) => /^https?:/i.test(url));
  check('portable: opens from file://', (await page.title()).length > 0, await page.title());
  check('portable: issues no HTTP(S) request at all', network.length === 0, network.slice(0, 3).join(' | ') || 'none');
  check('portable: no failed subresource is retried over the network', seen.failures.every((entry) => !/https?:/.test(entry)), seen.failures.slice(0, 2).join(' | ') || 'none');
  const keys = await page.evaluate(() => Object.keys(localStorage));
  check('portable: writes only its own storage keys', keys.every((key) => key.startsWith('sigrun.')), keys.join(', ') || 'none');
  await context.close();
}

async function auditEnterprise(browser) {
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', 'dist-enterprise-audit'], {
    cwd: ROOT,
    stdio: 'pipe',
    env: { ...process.env, VITE_EDITION: 'enterprise' },
  });
  // The enterprise edition builds at the server root (its BASE_PATH is '/').
  const enterpriseBase = `http://127.0.0.1:${PORT + 1}/`;
  const server = await serve(ENTERPRISE_DIST, PORT + 1, '/');
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const seen = monitor(page);
    await boot(page, enterpriseBase);
    await page.click('[data-testid=menu-button]');
    await page.waitForTimeout(250);
    const menuLinks = await page.evaluate(() => [...document.querySelectorAll('.menu-pop a[href]')].map((a) => a.getAttribute('href')).filter((href) => /^https?:/i.test(href ?? '')));
    check('enterprise: the outbound menu links are absent', menuLinks.length === 0, menuLinks.join(' | ') || 'none');
    await page.keyboard.press('Escape');
    await exercise(page);
    const leaked = externalRequests(seen.requests, [enterpriseBase.replace(/\/$/, '')]);
    check('enterprise: no request leaves its own server', leaked.length === 0, leaked.slice(0, 3).join(' | ') || 'none');
    await page.click('[data-testid=theme-toggle]');
    await page.waitForTimeout(400);
    const keys = await page.evaluate(() => Object.keys(localStorage));
    check('enterprise: settings land in its own namespace', keys.includes('sigrun.enterprise.sigrun.settings.v1') && !keys.includes('sigrun.settings.v1'), keys.join(', ') || 'none');
    const manifest = await page.evaluate(async () => (await fetch('./manifest.json')).json());
    check('enterprise: the manifest names the enterprise edition', /Enterprise/.test(manifest.name) && !/HD2Lab/.test(JSON.stringify(manifest)), manifest.name);
    await context.close();
  } finally {
    server.close();
  }
}

async function main() {
  const { browser, name } = await launchBrowser();
  console.log(`browser ${name}`);
  const server = await serve(path.join(ROOT, 'dist'));
  try {
    await auditWeb(browser);
    await auditPortable(browser);
    await auditEnterprise(browser);
  } finally {
    server.close();
    await browser.close();
    fs.rmSync(ENTERPRISE_DIST, { recursive: true, force: true });
  }
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error('NETWORK AUDIT FAILED', String(error.message).split('\n').slice(0, 3).join('\n'));
  process.exit(1);
});
