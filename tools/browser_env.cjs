/* Statelia — the one place the browser environment is resolved.

   The E2E suites need two things that a repository cannot carry: a browser
   binary and, on a bare Linux image, the shared libraries that binary links
   against. Both used to be written into every suite as absolute paths of the
   machine the stage was built on, which made the suites unrunnable anywhere
   else (and quietly wrong when the revision changed).

   Resolution order, all of it discoverable and overridable:

     browser binary   CHROME_PATH  →  playwright's own download directory
                         (PLAYWRIGHT_BROWSERS_PATH, ~/.cache/ms-playwright,
                         ./.cache/ms-playwright), newest revision first
     libraries        CHROME_LIBS  →  a `chrome-libs` folder beside the
                         repository, in the home directory or at /opt/chrome-libs

   Nothing here reaches the network and nothing here decides what to test: it
   only answers "where is the browser".

   Usage:
     const { chromium, executablePath, browserEnv, describeEnvironment } = require('./browser_env.cjs');
     await chromium.launch({ headless: true, executablePath, env: browserEnv });
*/
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** Playwright, from the declared devDependency or an explicit path. */
function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    path.join(ROOT, 'node_modules', 'playwright-core'),
    path.join(ROOT, 'node_modules', 'playwright'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { return require(candidate); } catch { /* try the next candidate */ }
  }
  throw new Error(
    'playwright-core is not installed. Run `npm ci` in the repository root: '
    + 'the E2E suites use the devDependency declared in package.json.',
  );
}

function revisionOf(name) {
  const match = /-(\d+)$/.exec(name);
  return match ? Number(match[1]) : 0;
}

const SHELL_LAYOUTS = [
  'chrome-headless-shell-linux64/chrome-headless-shell',
  'chrome-headless-shell-linux/chrome-headless-shell',
  'chrome-headless-shell-mac-arm64/chrome-headless-shell',
  'chrome-headless-shell-mac-x64/chrome-headless-shell',
  'chrome-headless-shell-win64/chrome-headless-shell.exe',
];

const BROWSER_LAYOUTS = [
  'chrome-linux/chrome',
  'chrome-linux64/chrome',
  'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
  'chrome-win/chrome.exe',
];

function browserRoots() {
  return [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    path.join(ROOT, '.cache', 'ms-playwright'),
  ].filter(Boolean);
}

function findExecutable() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const root of browserRoots()) {
    if (!fs.existsSync(root)) continue;
    let entries = [];
    try { entries = fs.readdirSync(root); } catch { continue; }
    const shells = entries.filter((name) => name.startsWith('chromium_headless_shell-')).sort((a, b) => revisionOf(b) - revisionOf(a));
    const full = entries.filter((name) => /^chromium-\d+$/.test(name)).sort((a, b) => revisionOf(b) - revisionOf(a));
    for (const group of [shells, full]) {
      for (const name of group) {
        for (const layout of group === shells ? SHELL_LAYOUTS : BROWSER_LAYOUTS) {
          const candidate = path.join(root, name, layout);
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    }
  }
  return null;
}

function findLibraries() {
  if (process.env.CHROME_LIBS) return process.env.CHROME_LIBS;
  const roots = [
    path.join(ROOT, '..', 'chrome-libs'),
    path.join(os.homedir(), 'chrome-libs'),
    '/opt/chrome-libs',
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const parts = [
      path.join(root, 'usr', 'lib', 'x86_64-linux-gnu'),
      path.join(root, 'lib', 'x86_64-linux-gnu'),
      path.join(root, 'usr', 'lib64'),
      path.join(root, 'lib64'),
    ].filter((folder) => fs.existsSync(folder));
    if (parts.length) return parts.join(':');
  }
  return null;
}

/**
 * The binary a suite launches: an explicit path, a discovered download, or the
 * one the installed Playwright itself would use. Null only when none of the
 * three answers — which the suites then let Playwright decide.
 */
/** The headless shell of one revision, when it was downloaded. */
function shellOfRevision(revision) {
  if (!revision) return null;
  for (const root of browserRoots()) {
    if (!fs.existsSync(root)) continue;
    const folder = path.join(root, `chromium_headless_shell-${revision}`);
    for (const layout of SHELL_LAYOUTS) {
      const candidate = path.join(folder, layout);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function resolveExecutable() {
  // The browser the installed Playwright was built against sets the revision;
  // the headless shell of that revision is preferred because it is the build
  // this repository's library set is assembled for (the full Chromium links
  // against a wider set of system libraries).
  try {
    const own = loadPlaywright().chromium.executablePath();
    const revision = own ? /-(\d+)[\\/]/.exec(own)?.[1] : null;
    const shell = shellOfRevision(revision);
    if (shell) return shell;
    if (own && fs.existsSync(own)) return own;
  } catch { /* fall through to a discovered download */ }
  return findExecutable();
}

const executablePath = resolveExecutable();
const libraries = findLibraries();
const browserEnv = libraries
  ? { ...process.env, LD_LIBRARY_PATH: [libraries, process.env.LD_LIBRARY_PATH || ''].filter(Boolean).join(':') }
  : { ...process.env };

/** Everything one suite needs, resolved once. */
function resolveBrowser() {
  return {
    chromium: loadPlaywright().chromium,
    executablePath,
    libraries,
    env: browserEnv,
  };
}

/** A one-line description of what was found, for the run log. */
function describeEnvironment() {
  const pick = (value, fallback) => (value ? value : fallback);
  return [
    `browser ${pick(executablePath, 'playwright default')}`,
    `libraries ${pick(libraries, 'system')}`,
    `playwright ${pick(process.env.PLAYWRIGHT_PATH, 'repository devDependency')}`,
  ].join(' · ');
}

module.exports = {
  chromium: loadPlaywright().chromium,
  executablePath,
  browserEnv,
  libraries,
  resolveBrowser,
  describeEnvironment,
  loadPlaywright,
};
