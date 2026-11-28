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
import { collectLicenses, licensesText } from './license_report.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/* The release identity is the Git tag when the build runs at a tag, and an RC
   id otherwise. A tag, the package version and the built manifest must all
   name the same release; `check` refuses to build when they do not (Q-04). */
export function parseReleaseId(id) {
  const match = /^v(\d+\.\d+\.\d+)(?:-rc\.(\d+))?$/.exec(id);
  return match ? { version: match[1], channel: match[2] ? 'rc' : 'final' } : null;
}

export function releaseIdentity(version, { env = {}, tag = '' } = {}) {
  const envTag = env.GITHUB_REF_TYPE === 'tag' ? (env.GITHUB_REF_NAME ?? '') : '';
  const explicitTag = envTag || env.RELEASE_TAG || tag || '';
  const id = env.RELEASE_ID || explicitTag || `v${version}-rc.1`;
  const parsed = parseReleaseId(id);
  const problems = [];
  if (!parsed) problems.push(`release id "${id}" is not vX.Y.Z or vX.Y.Z-rc.N`);
  else if (parsed.version !== version) problems.push(`release id ${id} does not match package version ${version}`);
  if (explicitTag && id !== explicitTag) problems.push(`release id ${id} ≠ git tag ${explicitTag}`);
  return { id, tag: explicitTag || null, channel: parsed?.channel ?? null, problems };
}

function gitTag() {
  try {
    return execFileSync('git', ['describe', '--tags', '--exact-match', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

const IDENTITY = releaseIdentity(PACKAGE.version, { env: process.env, tag: gitTag() });
const RELEASE_ID = IDENTITY.id;
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

function auditLicenses() {
  const { rows, problems } = collectLicenses(ROOT);
  for (const message of problems) problem(message);
  return rows;
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
  for (const message of IDENTITY.problems) problem(message);
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
  console.log(`release ${RELEASE_ID} · ${IDENTITY.channel ?? 'unknown'} channel${IDENTITY.tag ? ` · tag ${IDENTITY.tag}` : ' · no tag on HEAD'}`);
  console.log(`product ${pub.APP_NAME} ${pub.APP_VERSION} · edition ${pub.EDITION_ID}`);

  step('licenses');
  const rows = auditLicenses();
  console.log(`${rows.length} packages with a confirmed license · ${rows.filter((row) => row.texts.length).length} with license text · ${rows.filter((row) => row.notices.length).length} with NOTICE`);
  const licenses = licensesText(rows, { version: PACKAGE.version, description: PACKAGE.description });

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

/* WO-BRAND-001: release artefacts carry the product's own name —
   Statelia-v1.0.0.html, Statelia-v1.0.0-Portable.zip, Statelia-v1.0.0-Web.zip —
   read from the built product record instead of being typed here. */
let artifactBaseCache = null;
function artifactBase() {
  if (artifactBaseCache) return artifactBaseCache;
  for (const file of [path.join(ROOT, 'dist', 'product.json'), path.join(RELEASE_DIR, 'build-info.json')]) {
    if (!fs.existsSync(file)) continue;
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    const full = record.APP_NAME ?? record.name;
    if (!full) continue;
    const brand = record.BRAND_NAME ?? '';
    artifactBaseCache = brand && full.startsWith(brand) ? full.slice(brand.length).trim() : full;
    return artifactBaseCache;
  }
  throw new Error('no product record to name the release artefacts (build the web bundle first)');
}

function nameFor(kind) {
  const base = artifactBase();
  if (kind === 'html') return `${base}-${RELEASE_ID}.html`;
  if (kind === 'portableZip') return `${base}-${RELEASE_ID}-Portable.zip`;
  if (kind === 'webZip') return `${base}-${RELEASE_ID}-Web.zip`;
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
      .replaceAll('%PRODUCT%', product.APP_NAME)
      .replaceAll('%VERSION%', PACKAGE.version)
      .replaceAll('%COMMIT%', readCommit(ROOT));
    fs.writeFileSync(path.join(RELEASE_DIR, target), text);
  }
  fs.writeFileSync(path.join(RELEASE_DIR, 'LICENSES.txt'), checked.licenses ?? licensesText(auditLicenses(), { version: PACKAGE.version, description: PACKAGE.description }));
  fs.writeFileSync(path.join(RELEASE_DIR, 'VERSION.txt'), [
    `name        ${product.APP_NAME}`,
    `version     ${PACKAGE.version}`,
    `release     ${RELEASE_ID}`,
    `edition     ${product.EDITION_ID}`,
    `phase       ${product.APP_PHASE}`,
    `engine      ${product.ENGINE_NAME ?? ''} ${product.ENGINE_VERSION ?? ''}`.trimEnd(),
    `commit      ${readCommit(ROOT)}`,
    `built       ${stampText()}`,
    '',
  ].join('\n'));

  step('build manifest');
  const info = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist-portable', 'build-info.json'), 'utf8'));
  const releaseInfo = {
    ...info,
    release: RELEASE_ID,
    channel: IDENTITY.channel,
    tag: IDENTITY.tag,
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

/* A bundle stays valid while nothing it was built from has changed. Docs and
   CI files may commit after the build; a change to any build input may not.
   package.json is not a build input here (scripts and description do not reach
   the bundle); its version is checked against build-info.json separately. */
const BUILD_INPUTS = [
  'src', 'public', 'index.html', 'portable.html',
  'package-lock.json', 'tsconfig.json',
  'vite.config.ts', 'vite.portable.config.ts',
  'tools/product_plugin.ts', 'tools/build_portable.mjs', 'tools/build_manifest.mjs',
];
function sourceTreeMatches(commit) {
  try {
    execFileSync('git', ['diff', '--quiet', commit, 'HEAD', '--', ...BUILD_INPUTS], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
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
  else if (info.commit !== readCommit(ROOT)) {
    if (sourceTreeMatches(info.commit)) console.log(`built at ${info.commit}, before HEAD ${readCommit(ROOT)} — build inputs unchanged`);
    else problem(`build-info commit ${info.commit} ≠ HEAD ${readCommit(ROOT)} and the build inputs changed since`);
  }
  if (!info.release || info.release !== RELEASE_ID) problem(`build-info release ${info.release} ≠ ${RELEASE_ID}`);
  const packaged = parseReleaseId(String(info.release ?? ''));
  if (info.release && !packaged) problem(`build-info release ${info.release} is not a version tag`);
  else if (packaged && packaged.version !== PACKAGE.version) problem(`build-info release ${info.release} ≠ package version ${PACKAGE.version}`);
  if (info.channel && packaged && info.channel !== packaged.channel) problem(`build-info channel ${info.channel} ≠ ${packaged.channel} implied by ${info.release}`);
  if (info.tag && info.tag !== info.release) problem(`build-info tag ${info.tag} ≠ release ${info.release}`);

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

async function main(argv) {
  const [, , command, ...flags] = argv;
  if (command === 'check') await commandCheck();
  else if (command === 'build') await commandBuild();
  else if (command === 'verify') await commandVerify(flags.includes('--repro'));
  else {
    console.error('usage: node tools/release.mjs check|build|verify [--repro]');
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main(process.argv);
  } catch (error) {
    console.error(String(error.message).split('\n').slice(0, 4).join('\n'));
    process.exitCode = 1;
  }
}
