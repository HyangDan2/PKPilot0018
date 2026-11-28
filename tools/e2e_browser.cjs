/* Statelia — one browser for the E2E suites.

   Resolution order, all overridable and all discoverable:
     1. CHROME_PATH with the libraries in CHROME_LIBS (if any)
     2. the Chromium Playwright was installed with, plus the library set
        `browser_env.cjs` finds beside the repository / in the home directory
     3. a self-contained headless build (`@sparticuz/chromium`, optional
        devDependency) — used on images where the system libraries are not
        installed. TMPDIR should point at a directory with ~400 MB free.

   Nothing here reaches the network. Launch options are intentionally the same
   for every candidate so a test that passes in one place passes in the other.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium, executablePath, browserEnv, libraries } = require('./browser_env.cjs');

const ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none'];

const LIB_DIRS = [
  process.env.CHROME_LIBS,
  path.join(__dirname, '..', '..', 'chrome-libs', 'usr', 'lib', 'x86_64-linux-gnu'),
  path.join(os.homedir(), 'chrome-libs', 'usr', 'lib', 'x86_64-linux-gnu'),
  '/opt/chrome-libs/usr/lib/x86_64-linux-gnu',
].filter(Boolean);

function libraryPath() {
  if (libraries) return libraries;
  for (const dir of LIB_DIRS) {
    try {
      if (fs.existsSync(path.join(dir, 'libnspr4.so'))) return dir;
    } catch { /* try the next */ }
  }
  return null;
}

function sparticuz() {
  try {
    return require('@sparticuz/chromium');
  } catch {
    return null;
  }
}

async function candidates() {
  const libs = libraryPath();
  const env = { ...process.env, ...(libs ? { LD_LIBRARY_PATH: [libs, process.env.LD_LIBRARY_PATH || ''].filter(Boolean).join(':') } : {}) };
  const list = [];
  if (process.env.CHROME_PATH) list.push({ name: 'CHROME_PATH', executablePath: process.env.CHROME_PATH, env });
  if (executablePath) list.push({ name: 'playwright', executablePath, env: { ...browserEnv, ...env } });
  const sp = sparticuz();
  if (sp) {
    try {
      const packed = sp.default ?? sp;
      const binary = await packed.executablePath();
      list.push({ name: 'sparticuz', executablePath: binary, env, args: [...ARGS, ...((packed.args || []).filter((arg) => !ARGS.includes(arg)))] });
    } catch {
      /* packing failed (disk or permissions); the other candidates remain */
    }
  }
  return list;
}

/** Launch the first candidate that actually starts; returns { browser, name }. */
async function launchBrowser() {
  const problems = [];
  for (const candidate of await candidates()) {
    try {
      const browser = await chromium.launch({
        executablePath: candidate.executablePath,
        args: candidate.args ?? ARGS,
        env: candidate.env,
        headless: true,
      });
      return { browser, name: candidate.name, executablePath: candidate.executablePath };
    } catch (error) {
      problems.push(`${candidate.name}: ${String(error.message).split('\n')[0]}`);
    }
  }
  throw new Error(`No browser could be launched.\n${problems.join('\n')}`);
}

module.exports = { launchBrowser, chromium, ARGS };
