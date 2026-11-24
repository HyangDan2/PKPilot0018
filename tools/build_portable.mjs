/* Sigrún — portable (single-file) build.

   `npm run build:portable` produces dist-portable/sigrun-portable.html: one
   HTML file that carries the whole application — the IIFE bundle, the CSS and
   the icon — and opens from a file:// URL with no Node, no Python and no
   network. A ZIP with the same file (plus a short read-me) is written next to
   it.

   Steps
     1. vite build with vite.portable.config.ts   (iife, one chunk, ./ base)
     2. inline sigrun.js + sigrun.css into the built HTML
     3. drop the icon into the head as a data: URL
     4. write the ZIP (python3 zipfile — the sandbox has no `zip` binary)

   Nothing in this script touches the network.
*/
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest, readCommit, releaseDirectory, resolveBuildDate } from './build_manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist-portable');
const RAW = path.join(OUT, '_raw');
const HTML_NAME = 'sigrun-portable.html';
const ZIP_NAME = 'sigrun-portable.zip';
const INFO_NAME = 'build-info.json';
/* An optional copy for a release folder: asked for by name, never assumed. */
const RELEASE_DIR = releaseDirectory(process.env, ROOT);
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
/* One clock for the whole build, so the README, the manifest and the ZIP agree
   and SOURCE_DATE_EPOCH makes two builds of one commit identical. */
const BUILT_AT = resolveBuildDate(process.env, new Date());
const ZIP_DATE = BUILT_AT.toISOString().replace(/\.\d{3}Z$/, 'Z');

function step(text) {
  console.log(`── ${text}`);
}

function assert(condition, message) {
  if (!condition) {
    console.error(`ERROR: ${message}`);
    process.exit(1);
  }
}

/* 1 ── bundle ------------------------------------------------------------ */
step('1/6 vite build (portable config)');
const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
assert(fs.existsSync(vite), 'vite is not installed (node_modules/vite is missing)');
execFileSync(process.execPath, [vite, 'build', '--config', 'vite.portable.config.ts'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: process.env,
});

const rawHtml = path.join(RAW, 'portable.html');
const rawJs = path.join(RAW, 'sigrun.js');
const rawCss = path.join(RAW, 'sigrun.css');
assert(fs.existsSync(rawHtml), 'portable.html was not produced');
assert(fs.existsSync(rawJs), 'sigrun.js was not produced');
assert(fs.existsSync(rawCss), 'sigrun.css was not produced');

/* 2 ── inline ------------------------------------------------------------- */
step('2/6 inline the bundle and the stylesheet');
let html = fs.readFileSync(rawHtml, 'utf8');
const js = fs.readFileSync(rawJs, 'utf8');
const css = fs.readFileSync(rawCss, 'utf8');

/* A literal </script> or </style> inside the payload would close the tag that
   carries it. Neither appears today (checked below); if a future dependency
   introduces one, fail instead of silently shipping a broken file. */
assert(!/<\/script/i.test(js), 'the bundle contains a literal </script> and cannot be inlined as-is');
assert(!/<\/style/i.test(css), 'the stylesheet contains a literal </style> and cannot be inlined as-is');

const moduleTag = /<script type="module"[^>]*src="\.\/sigrun\.js"[^>]*><\/script>/;
const linkTag = /<link rel="stylesheet"[^>]*href="\.\/sigrun\.css"[^>]*>/;
assert(moduleTag.test(html), 'the module <script> tag was not found in portable.html');
assert(linkTag.test(html), 'the stylesheet <link> was not found in portable.html');

/* Vite lifts the entry script into <head> with type="module" (which defers).
   A classic inline script there would run before #root exists, so the payload
   moves to the end of <body>. */
html = html.replace(linkTag, () => `<style>\n${css}\n</style>`);
html = html.replace(moduleTag, () => '');
assert(html.includes('</body>'), 'portable.html has no </body> to close');
html = html.replace('</body>', () => `<script>\n${js}\n</script>\n  </body>`);

/* 3 ── icon ---------------------------------------------------------------- */
step('3/6 embed the icon');
const svgPath = path.join(ROOT, 'public', 'favicon.svg');
if (fs.existsSync(svgPath)) {
  const svg = fs.readFileSync(svgPath, 'utf8');
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg.endsWith('\n') ? svg : svg + '\n').toString('base64')}`;
  html = html.replace(
    '</title>',
    `</title>\n    <link rel="icon" href="${dataUrl}" type="image/svg+xml" />`,
  );
}

/* What must not survive: a resource the browser would have to fetch. Outbound
   links a person clicks (<a href="https://…">) are fine; a <link>, <script
   src>, <img src> or a CSS url() pointing at a remote host is not. The markers
   are read off the shell only, because the bundle legitimately contains SVG
   namespace strings and menu links. */
const shell = html
  .replace(/<script>[\s\S]*?<\/script>/g, '<script></script>')
  .replace(/<style>[\s\S]*?<\/style>/g, '<style></style>');
assert(!/(?:src|href)="https?:\/\//i.test(shell.replace(/<a\s[^>]*>/gi, '')), 'the portable page still loads something from a remote URL');
assert(!/url\(\s*['"]?https?:/i.test(css), 'the stylesheet still loads something from a remote URL');
fs.mkdirSync(OUT, { recursive: true });
const htmlPath = path.join(OUT, HTML_NAME);
fs.writeFileSync(htmlPath, html, 'utf8');

const bytes = fs.statSync(htmlPath).size;
const sha = createHash('sha256').update(fs.readFileSync(htmlPath)).digest('hex');
console.log(`   ${HTML_NAME}  ${(bytes / 1024).toFixed(1)} kB  sha256 ${sha.slice(0, 16)}…`);

/* 4 ── release copies ------------------------------------------------------ */
step('4/6 release copies');
const readme = `Sigrún — Portable Build (HD2Lab)
================================

This folder carries the portable build of Sigrún (PKPilot0018), the
pure-browser statistical and quality workspace.

  sigrun-portable.html    the entire application in one file

How to run it
-------------
1. Copy sigrun-portable.html anywhere on your machine.
2. Double-click it, or drag it into Microsoft Edge or Google Chrome.

That is all. There is nothing to install: no Node.js, no Python, no server,
and no network connection. Every statistic, chart and export is computed in
the browser tab itself, exactly as on the hosted build.

What works offline
------------------
* Worksheets: import CSV / XLSX, export CSV / XLSX
* Statistics: descriptive statistics, t-tests, ANOVA + Tukey, regression,
  GLM, control charts (Nelson rules), capability, Pareto, reliability,
  Gage R&R, power and sample size, DOE/RSM
* Charts: every Stage 1–3 chart, 3D surface (WebGL, with a static fallback
  when WebGL is unavailable), overlaid contour, prediction profiler,
  multi-response optimizer, graph layout editor
* Projects: Save Project writes a .sigrun.json file, Open Project reads it
  back — both through the browser's own download / file picker

Notes
-----
* The portable page has one origin (file://). Autosave uses IndexedDB where
  the browser allows it on file:// and falls back to localStorage otherwise;
  if the browser blocks both, autosave is skipped and Save Project still works.
* Browsers differ in how much they allow a file:// page to keep. For a
  long-lived installation, keep the HTML file somewhere stable rather than in
  a temporary folder.

Build information
-----------------
version     ${PACKAGE.version}
generated   ${BUILT_AT.toISOString()}
size        ${bytes} bytes
sha256      ${sha}

© HD2Lab
`;
const readmePath = path.join(OUT, 'README.txt');
fs.writeFileSync(readmePath, readme, 'utf8');

/* 5 ── manifest ----------------------------------------------------------- */
step('5/6 build manifest');
const info = buildManifest({
  name: 'HD2Lab Sigrún',
  version: PACKAGE.version,
  phase: 'Phase 3',
  commit: readCommit(ROOT),
  builtAt: BUILT_AT,
  zipTimestamp: ZIP_DATE,
  file: HTML_NAME,
  bytes,
  sha256: sha,
  jsBytes: Buffer.byteLength(js),
  cssBytes: Buffer.byteLength(css),
  format: 'iife/single-file',
  tools: {
    node: process.version,
    vite: JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'vite', 'package.json'), 'utf8')).version,
  },
});
fs.writeFileSync(path.join(OUT, INFO_NAME), JSON.stringify(info, null, 2) + '\n', 'utf8');

/* 6 ── zip ---------------------------------------------------------------- */
step('6/6 zip');
const zipPath = path.join(OUT, ZIP_NAME);
execFileSync(
  'python3',
  [
    '-c',
    `import sys, zipfile, os
src, out, stamp = sys.argv[1], sys.argv[2], sys.argv[3]
year, month, day = (int(part) for part in stamp[:10].split('-'))
hour, minute, second = (int(part) for part in stamp[11:19].split(':'))
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in ('${HTML_NAME}', 'README.txt', '${INFO_NAME}'):
        entry = zipfile.ZipInfo('sigrun-portable/' + name, (year, month, day, hour, minute, second))
        entry.compress_type = zipfile.ZIP_DEFLATED
        # A fixed attribute byte keeps the archive identical between runs.
        entry.external_attr = 0o644 << 16
        z.writestr(entry, open(os.path.join(src, name), 'rb').read())
`,
    OUT,
    zipPath,
    ZIP_DATE,
  ],
  { cwd: ROOT, stdio: 'inherit' },
);

const zipBytes = fs.statSync(zipPath).size;
const zipSha = createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');

/* The manifest now knows what the archive weighs: write both again. */
info.zip = { file: ZIP_NAME, bytes: zipBytes, sha256: zipSha };
fs.writeFileSync(path.join(OUT, INFO_NAME), JSON.stringify(info, null, 2) + '\n', 'utf8');

if (RELEASE_DIR) {
  fs.mkdirSync(RELEASE_DIR, { recursive: true });
  const releaseZip = path.join(RELEASE_DIR, ZIP_NAME);
  fs.copyFileSync(zipPath, releaseZip);
  console.log(`   ${releaseZip}`);
}

console.log(`   ${ZIP_NAME}  ${(zipBytes / 1024).toFixed(1)} kB  sha256 ${zipSha.slice(0, 16)}…  stamp ${ZIP_DATE}`);
console.log(`   ${INFO_NAME}  version ${info.version}  commit ${info.commit}`);
console.log('portable build complete');
