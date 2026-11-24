/* Sigrún — release packaging and verification (WO-FINAL-001 · WO-06)

   Three subcommands, one source of truth:

     node tools/release.mjs check    preflight: tools, editions, licenses
     node tools/release.mjs build    web + portable builds, release/ folder, hashes
     node tools/release.mjs verify   recompute every hash and inspect the archives
     node tools/release.mjs verify --repro
                                     rebuild with the recorded epoch and compare

   Reproducibility: SOURCE_DATE_EPOCH is the only clock. When it is unset the
   build takes the current time and runs the children with that value pinned,
   so the page's About year, the ZIP timestamps, the manifest and the hashes all
   agree; a rebuild with the recorded epoch must produce the same bytes.

   Circular hashes are avoided by construction: SHA256SUMS.txt lists every file
   except itself, and build-info.json never contains its own hash. `verify`
   fails if either rule is broken.
*/
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build as esbuild } from 'esbuild';
import { readCommit, resolveBuildDate } from './build_manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RELEASE_ID = process.env.RELEASE_ID || `v${PACKAGE.version}-rc.1`;
const RELEASE_DIR = path.resolve(ROOT, process.env.RELEASE_DIR || path.join('release', RELEASE_ID));
const EPOCH = resolveBuildDate(process.env);
const JSON_SPACE = 2;

const PROBLEMS = [];
function problem(text) { PROBLEMS.push(text); }
function step(text) { console.log(`── ${text}`); }
function sha256(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function rel(file) { return path.relative(ROOT, file); }

/** Load an edition record without a TypeScript toolchain in the way. */
async function loadEdition(entry) {
  const result = await esbuild({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

async function editions() {
  const [pub, ent] = await Promise.all([
    loadEdition('src/config/editions/public.ts'),
    loadEdition('src/config/editions/enterprise.ts'),
  ]);
  return { public: pub.PUBLIC_EDITION, enterprise: ent.ENTERPRISE_EDITION };
}

/* ── licenses ──────────────────────────────────────────────────────────── */

function installedPackages() {
  const modules = path.join(ROOT, 'node_modules');
  const found = [];
  for (const entry of fs.readdirSync(modules).sort()) {
    if (entry.startsWith('.')) continue;
    if (entry.startsWith('@')) {
      for (const scoped of fs.readdirSync(path.join(modules, entry)).sort()) {
        if (scoped.startsWith('.')) continue;
        found.push(path.join(modules, entry, scoped));
      }
      continue;
    }
    found.push(path.join(modules, entry));
  }
  return found.filter((dir) => fs.existsSync(path.join(dir, 'package.json')));
}

function licenseOf(manifest) {
  const value = manifest.license ?? (typeof manifest.licenses === 'string' ? manifest.licenses : manifest.licenses?.[0]?.type);
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function auditLicenses() {
  const rows = [];
  for (const dir of installedPackages()) {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const license = licenseOf(manifest);
    if (!license || /^unlicensed$/i.test(license)) {
      problem(`license: ${manifest.name}@${manifest.version} has no confirmed license`);
      continue;
    }
    rows.push({ name: manifest.name, version: manifest.version, license, url: manifest.homepage || (manifest.repository && (manifest.repository.url || manifest.repository)) || '' });
  }
  return rows;
}

function licensesText(rows) {
  const lines = [
    `Third-party packages installed for ${PACKAGE.description ?? PACKAGE.name}`,
    `build ${PACKAGE.version} · ${rows.length} packages · generated from node_modules`,
    '',
  ];
  for (const row of rows) lines.push(`${row.name}@${row.version}  ${row.license}${row.url ? `  ${row.url}` : ''}`);
  return `${lines.join('\n')}\n`;
}

/* ── check ─────────────────────────────────────────────────────────────── */

async function commandCheck() {
  step('tools');
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 22) problem(`node ${process.versions.node} is older than 22`);
  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'vite'))) problem('vite is not installed (run npm ci)');
  console.log(`node ${process.versions.node} (need ≥22)`);

  step('release identity');
  if (!/^\d+\.\d+\.\d+/.test(PACKAGE.version)) problem(`package version "${PACKAGE.version}" is not semver`);
  if (!PACKAGE.description) problem('package.json has no description');
  const built = await editions();
  const pub = built.public;
  for (const field of ['PRODUCT_ID', 'EDITION_ID', 'APP_NAME', 'APP_NAME_LOCAL', 'APP_VERSION', 'APP_PHASE', 'BRAND_NAME', 'BASE_PATH', 'STORAGE_NAMESPACE', 'EXPORT_FILE_PREFIX']) {
    if (!(field in pub)) problem(`public edition is missing ${field}`);
  }
  if (pub.APP_VERSION !== PACKAGE.version) problem(`public edition version ${pub.APP_VERSION} ≠ package.json ${PACKAGE.version}`);
  if (pub.STORAGE_NAMESPACE !== '') problem('the public edition must not be namespaced (it would hide existing reader data)');
  if (process.env.VITE_EDITION === 'enterprise') {
    if (!built.enterprise.BRAND_NAME) problem('enterprise: BRAND_NAME is not approved yet');
    if (!built.enterprise.COPYRIGHT) problem('enterprise: COPYRIGHT is not approved yet');
    if (!built.enterprise.STORAGE_NAMESPACE) problem('enterprise: STORAGE_NAMESPACE is empty');
  }
  console.log(`release ${RELEASE_ID} · product ${pub.APP_NAME} ${pub.APP_VERSION} · edition ${pub.EDITION_ID}`);

  step('licenses');
  const rows = auditLicenses();
  console.log(`${rows.length} packages with a confirmed license`);
  const licenses = licensesText(rows);

  if (PROBLEMS.length) {
    for (const message of PROBLEMS) console.error(`FAIL · ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log('release check: PASS');
  if (process.env.RELEASE_WRITE_LICENSES) {
    fs.mkdirSync(RELEASE_DIR, { recursive: true });
    fs.writeFileSync(path.join(RELEASE_DIR, 'LICENSES.txt'), licenses);
  }
  return { licenses };
}

/* ── build ─────────────────────────────────────────────────────────────── */

function run(command, args, env = {}) {
  execFileSync(command, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
}

function nameFor(kind) {
  if (kind === 'html') return `Sigrun-${RELEASE_ID}.html`;
  if (kind === 'portableZip') return `Sigrun-${RELEASE_ID}-Portable.zip`;
  if (kind === 'webZip') return `Sigrun-${RELEASE_ID}-Web.zip`;
  return kind;
}

function zipWeb(outFile) {
  const dist = path.join(ROOT, 'dist');
  execFileSync('python3', ['-c', `
import os, sys, zipfile
src, out, stamp = sys.argv[1], sys.argv[2], sys.argv[3]
year, month, day = (int(p) for p in stamp[:10].split('-'))
hour, minute, second = (int(p) for p in stamp[11:19].split(':'))
entries = []
for base, _, files in os.walk(src):
    for name in files:
        full = os.path.join(base, name)
        entries.append((os.path.relpath(full, src).replace(os.sep, '/'), full))
entries.sort()
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for name, full in entries:
        entry = zipfile.ZipInfo(name, (year, month, day, hour, minute, second))
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = 0o644 << 16
        z.writestr(entry, open(full, 'rb').read())
`, dist, outFile, stampText()], { cwd: ROOT, stdio: 'inherit' });
}

function stampText() {
  return EPOCH.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function commandBuild() {
  fs.rmSync(RELEASE_DIR, { recursive: true, force: true });
  fs.mkdirSync(RELEASE_DIR, { recursive: true });
  const epoch = String(Math.floor(EPOCH.getTime() / 1000));

  step('release check');
  const checked = await commandCheck();
  if (process.exitCode) throw new Error('release check failed');

  step('web build');
  run(process.execPath, [path.join('node_modules', 'vite', 'bin', 'vite.js'), 'build'], { SOURCE_DATE_EPOCH: epoch, VITE_BUILD_YEAR: String(EPOCH.getUTCFullYear()) });

  step('portable build');
  run(process.execPath, [path.join('tools', 'build_portable.mjs')], {
    SOURCE_DATE_EPOCH: epoch,
    VITE_BUILD_YEAR: String(EPOCH.getUTCFullYear()),
    PORTABLE_RELEASE_DIR: RELEASE_DIR,
  });

  step('assemble release folder');
  const product = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'product.json'), 'utf8'));
  const htmlSource = path.join(ROOT, 'dist-portable', 'sigrun-portable.html');
  const htmlTarget = path.join(RELEASE_DIR, nameFor('html'));
  fs.copyFileSync(htmlSource, htmlTarget);
  fs.copyFileSync(path.join(ROOT, 'dist-portable', 'sigrun-portable.zip'), path.join(RELEASE_DIR, nameFor('portableZip')));
  zipWeb(path.join(RELEASE_DIR, nameFor('webZip')));
  // The packager copied build-info.json and its own zip name; keep only the named copies.
  fs.rmSync(path.join(RELEASE_DIR, 'sigrun-portable.zip'), { force: true });

  for (const [template, target] of [['RELEASE_NOTES.md', 'RELEASE_NOTES.md'], ['KNOWN_LIMITATIONS.md', 'KNOWN_LIMITATIONS.md'], ['README-EN.txt', 'README-EN.txt'], ['README-KO.txt', 'README-KO.txt']]) {
    const text = fs.readFileSync(path.join(ROOT, 'docs', 'release', template), 'utf8')
      .replaceAll('%RELEASE_ID%', RELEASE_ID)
      .replaceAll('%VERSION%', PACKAGE.version)
      .replaceAll('%COMMIT%', readCommit(ROOT));
    fs.writeFileSync(path.join(RELEASE_DIR, target), text);
  }
  fs.writeFileSync(path.join(RELEASE_DIR, 'LICENSES.txt'), checked.licenses ?? licensesText(auditLicenses()));
  fs.writeFileSync(path.join(RELEASE_DIR, 'VERSION.txt'), [
    `name        ${product.APP_NAME}`,
    `version     ${PACKAGE.version}`,
    `release     ${RELEASE_ID}`,
    `edition     ${product.EDITION_ID}`,
    `phase       ${product.APP_PHASE}`,
    `commit      ${readCommit(ROOT)}`,
    `built       ${stampText()}`,
    '',
  ].join('\n'));

  step('build manifest');
  const info = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist-portable', 'build-info.json'), 'utf8'));
  const releaseInfo = {
    ...info,
    release: RELEASE_ID,
    edition: product.EDITION_ID,
    web: {
      indexSha256: sha256(path.join(ROOT, 'dist', 'index.html')),
      files: fs.readdirSync(path.join(ROOT, 'dist', 'assets')).length,
    },
    artifacts: {
      html: nameFor('html'),
      portableZip: nameFor('portableZip'),
      webZip: nameFor('webZip'),
    },
  };
  fs.writeFileSync(path.join(RELEASE_DIR, 'build-info.json'), `${JSON.stringify(releaseInfo, null, JSON_SPACE)}\n`);

  step('SHA256SUMS');
  const files = fs.readdirSync(RELEASE_DIR).filter((name) => name !== 'SHA256SUMS.txt').sort();
  const sums = files.map((name) => `${sha256(path.join(RELEASE_DIR, name))}  ${name}`);
  fs.writeFileSync(path.join(RELEASE_DIR, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
  console.log(`${files.length} files hashed in ${rel(RELEASE_DIR)}`);
  for (const line of sums) console.log(line);
}

/* ── verify ────────────────────────────────────────────────────────────── */

function expectedNames() {
  return [
    nameFor('html'), nameFor('portableZip'), nameFor('webZip'),
    'README-KO.txt', 'README-EN.txt', 'RELEASE_NOTES.md', 'KNOWN_LIMITATIONS.md',
    'LICENSES.txt', 'VERSION.txt', 'build-info.json', 'SHA256SUMS.txt',
  ].sort();
}

function readSums() {
  const text = fs.readFileSync(path.join(RELEASE_DIR, 'SHA256SUMS.txt'), 'utf8');
  const map = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (!match) { problem(`SHA256SUMS: unreadable line "${line}"`); continue; }
    if (map.has(match[2])) problem(`SHA256SUMS: ${match[2]} is listed twice`);
    map.set(match[2], match[1]);
  }
  return map;
}

function zipListing(file) {
  const output = execFileSync('python3', ['-c', `
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    print(json.dumps([{'name': i.filename, 'sha256': __import__('hashlib').sha256(z.read(i.filename)).hexdigest(), 'date': list(i.date_time), 'bytes': i.file_size} for i in z.infolist()]))
`, file], { encoding: 'utf8' });
  return JSON.parse(output);
}

async function commandVerify(repro) {
  if (!fs.existsSync(path.join(RELEASE_DIR, 'SHA256SUMS.txt'))) throw new Error(`${rel(RELEASE_DIR)} has no SHA256SUMS.txt`);
  step('file set');
  const present = fs.readdirSync(RELEASE_DIR).sort();
  const expected = expectedNames();
  for (const name of expected) if (!present.includes(name)) problem(`missing ${name}`);
  for (const name of present) if (!expected.includes(name)) problem(`unexpected file ${name}`);

  step('hashes');
  const sums = readSums();
  if (sums.has('SHA256SUMS.txt')) problem('SHA256SUMS.txt lists itself');
  for (const [name, hash] of sums) {
    const file = path.join(RELEASE_DIR, name);
    if (!fs.existsSync(file)) { problem(`${name} is listed but absent`); continue; }
    const actual = sha256(file);
    if (actual !== hash) problem(`${name}: hash ${actual} ≠ ${hash}`);
  }
  // build-info.json must not carry its own hash (circular)
  const infoText = fs.readFileSync(path.join(RELEASE_DIR, 'build-info.json'), 'utf8');
  const info = JSON.parse(infoText);
  if (JSON.stringify(info).includes(sha256(path.join(RELEASE_DIR, 'build-info.json')))) problem('build-info.json contains its own hash');
  if (info.version !== PACKAGE.version) problem(`build-info version ${info.version} ≠ package ${PACKAGE.version}`);
  if (!info.commit || info.commit === 'unknown') problem('build-info has no commit');
  else if (info.commit !== readCommit(ROOT)) problem(`build-info commit ${info.commit} ≠ HEAD ${readCommit(ROOT)}`);
  if (!info.release || info.release !== RELEASE_ID) problem(`build-info release ${info.release} ≠ ${RELEASE_ID}`);

  step('VERSION.txt');
  const versionText = fs.readFileSync(path.join(RELEASE_DIR, 'VERSION.txt'), 'utf8');
  for (const needle of [PACKAGE.version, RELEASE_ID, info.commit]) if (!versionText.includes(needle)) problem(`VERSION.txt is missing ${needle}`);

  step('portable archive');
  const portable = zipListing(path.join(RELEASE_DIR, nameFor('portableZip')));
  // The packager keeps the file name its README tells the reader to open;
  // the release copy is compared by bytes, not by the name on the wrapper.
  const innerHtml = portable.find((entry) => entry.name === nameFor('html') || entry.name.endsWith('/sigrun-portable.html'));
  const releaseHtml = sha256(path.join(RELEASE_DIR, nameFor('html')));
  if (!innerHtml) problem('Portable.zip does not carry the release HTML');
  else if (innerHtml.sha256 !== releaseHtml) problem('Portable.zip HTML differs from the release HTML');
  if (!portable.some((entry) => entry.name.endsWith('README.txt'))) problem('Portable.zip has no README');
  if (!portable.some((entry) => entry.name.endsWith('build-info.json'))) problem('Portable.zip has no build-info.json');

  step('web archive');
  const web = zipListing(path.join(RELEASE_DIR, nameFor('webZip')));
  const index = web.find((entry) => entry.name === 'index.html');
  if (!index) problem('Web.zip has no index.html at its root');
  else if (index.sha256 !== info.web?.indexSha256) problem('Web.zip index.html differs from the built page');
  for (const required of ['manifest.json']) if (!web.some((entry) => entry.name === required)) problem(`Web.zip is missing ${required}`);
  if (!web.some((entry) => entry.name.startsWith('assets/'))) problem('Web.zip carries no assets');
  const stamp = info.zipTimestamp ?? '';
  if (stamp) {
    const [y, mo, d, h, mi] = stamp.replace('Z', '').split(/[-T:]/).map(Number);
    if (web.some((entry) => entry.date[0] !== y || entry.date[1] !== mo || entry.date[2] !== d || entry.date[3] !== h || entry.date[4] !== mi)) {
      problem('Web.zip timestamps do not match the build stamp');
    }
  }

  step('page stays local');
  const html = fs.readFileSync(path.join(RELEASE_DIR, nameFor('html')), 'utf8');
  if (/<script[^>]+src=/i.test(html)) problem('portable HTML loads an external script');
  if (/%PRODUCT_[A-Z_]*%/.test(html)) problem('portable HTML still contains an unresolved product token');
  for (const packageManifest of [path.join(ROOT, 'dist', 'manifest.json')]) {
    if (info.edition === 'public' && !fs.readFileSync(packageManifest, 'utf8').includes('HD2Lab')) problem('public manifest lost its brand');
  }

  if (repro) {
    step('reproducible rebuild');
    const epoch = String(Math.floor(Date.parse(info.builtAt) / 1000));
    const output = execFileSync(process.execPath, [path.join('tools', 'build_portable.mjs')], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, SOURCE_DATE_EPOCH: epoch, VITE_BUILD_YEAR: String(new Date(epoch * 1000).getUTCFullYear()) },
    });
    const rebuilt = sha256(path.join(ROOT, 'dist-portable', 'sigrun-portable.html'));
    if (rebuilt !== releaseHtml) problem(`reproducible rebuild differs: ${rebuilt} ≠ ${releaseHtml}`);
    else console.log('portable HTML is byte-identical on rebuild');
    if (!/portable build complete/.test(output)) problem('reproducible rebuild did not finish');
  }

  if (PROBLEMS.length) {
    for (const message of PROBLEMS) console.error(`FAIL · ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nrelease verify: PASS · ${rel(RELEASE_DIR)} · ${expected.length} files`);
}

/* ── entry ─────────────────────────────────────────────────────────────── */

const [, , command, ...flags] = process.argv;
try {
  if (command === 'check') await commandCheck();
  else if (command === 'build') await commandBuild();
  else if (command === 'verify') await commandVerify(flags.includes('--repro'));
  else {
    console.error('usage: node tools/release.mjs check|build|verify [--repro]');
    process.exitCode = 2;
  }
} catch (error) {
  console.error(String(error.message).split('\n').slice(0, 4).join('\n'));
  process.exitCode = 1;
}
