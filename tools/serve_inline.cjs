/* Serve dist/ from inside the E2E process.

   A server started by the shell dies with that shell, which made the local
   E2E runs fail with ERR_CONNECTION_REFUSED. These suites launch Chromium a
   few hundred milliseconds later, so binding the port synchronously here is
   enough: by the first navigation the listener is up.

   Usage in a tool script:
     const BASE = process.env.BASE || require('./serve_inline.cjs').ensureServed();
*/
const fs = require('fs');
const http = require('http');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function ensureServed(port = Number(process.env.PORT || 4190)) {
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
  server.on('error', () => { /* a port already in use means someone else serves it */ });
  server.listen(port, '127.0.0.1');
  server.unref();
  return `http://127.0.0.1:${port}/PKPilot0018/`;
}

module.exports = { ensureServed };
