/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — enterprise configuration (WO-FINAL-001 · WO-04, tests 26–32)

   What a derived edition must be able to change without touching the engine:
   identity and brand, version, base path, storage namespace, export prefix and
   the external-link policy. The public edition must keep every value, key and
   page string the live site already has.
   ───────────────────────────────────────────────────────────────────────── */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json';
import { PRODUCT, PRODUCT_SHORT_NAME, BUILD_YEAR, EDITION } from '../src/config/product';
import { PUBLIC_EDITION } from '../src/config/editions/public';
import { ENTERPRISE_EDITION } from '../src/config/editions/enterprise';
import {
  applyHtmlTokens,
  editionLockup,
  editionTitle,
  htmlTokens,
  manifestFor,
  shortName,
  stripEmptyTags,
} from '../src/config/editionMeta';
import { STORAGE_KEY, STORAGE_KEYS_IN_USE, namespacedKey } from '../src/config/storageNamespace';
import { normalizeBasePath, resolveBasePath } from '../src/config/basePath';
import { buildYearFrom } from '../src/config/buildYear';
import { APP_PHASE, APP_VERSION, aboutVersionLine, statusBarLabel } from '../src/lib/appInfo';
import { WORKSPACE_KEY } from '../src/lib/workspace';
import { CUSTOM_STYLE_STORAGE_KEY } from '../src/lib/chartStyles';
import { AUTOSAVE_STORAGE_KEY } from '../src/lib/db';
import { projectFileName } from '../src/lib/project';
import { TUTORIAL_ORIGINAL_KEY, TUTORIAL_PRACTICE_KEY, TUTORIAL_PRACTICE_KEY_V1, TUTORIAL_PROGRESS_KEY } from '../src/tutorials/progressStore';

const indexHtml = readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
const portableHtml = readFileSync(path.join(process.cwd(), 'portable.html'), 'utf8');

const CONFIG_REQUIRED = [
  'PRODUCT_ID', 'EDITION_ID', 'APP_NAME', 'APP_VERSION', 'APP_PHASE', 'BRAND_NAME', 'COPYRIGHT',
  'BASE_PATH', 'CANONICAL_URL', 'STORAGE_NAMESPACE', 'EXPORT_FILE_PREFIX', 'EXTERNAL_LINKS_ENABLED',
] as const;

/* ── 26. the two editions ─────────────────────────────────────────────── */

describe('WO-04 · the edition records', () => {
  it('states every required field for both editions', () => {
    for (const edition of [PUBLIC_EDITION, ENTERPRISE_EDITION]) {
      for (const field of CONFIG_REQUIRED) {
        expect(edition, `${edition.EDITION_ID} is missing ${field}`).toHaveProperty(field);
      }
    }
  });

  it('keeps the public edition exactly as the live site is', () => {
    expect(PUBLIC_EDITION).toMatchObject({
      EDITION_ID: 'public',
      APP_NAME: 'HD2Lab Sigrún',
      BRAND_NAME: 'HD2Lab',
      APP_PHASE: 'Phase 3',
      BASE_PATH: '/PKPilot0018/',
      CANONICAL_URL: 'https://hyangdan2.github.io/PKPilot0018/',
      STORAGE_NAMESPACE: '',
      EXPORT_FILE_PREFIX: 'sigrun',
      EXTERNAL_LINKS_ENABLED: true,
    });
    expect(EDITION).toBe('public');
    expect(PRODUCT.EDITION_ID).toBe('public');
    expect(PRODUCT_SHORT_NAME).toBe('Sigrún');
  });

  it('does not invent an enterprise brand or copyright', () => {
    expect(ENTERPRISE_EDITION.BRAND_NAME).toBe('');
    expect(ENTERPRISE_EDITION.COPYRIGHT).toBe('');
    expect(ENTERPRISE_EDITION.EXTERNAL_LINKS_ENABLED).toBe(false);
    expect(ENTERPRISE_EDITION.STORAGE_NAMESPACE.length).toBeGreaterThan(0);
    expect(editionTitle(ENTERPRISE_EDITION)).not.toContain('HD2Lab');
    expect(shortName(ENTERPRISE_EDITION)).toBe('Sigrún Enterprise');
  });

  it('names the product from its own record in the status bar', () => {
    expect(APP_PHASE).toBe('Phase 3');
    expect(statusBarLabel()).toBe('HD2LAB · SIGRÚN · PHASE 3');
    expect(editionLockup(ENTERPRISE_EDITION)).toBe('SIGRÚN ENTERPRISE');
  });
});

/* ── 27. version, year and deploy path ───────────────────────────────── */

describe('WO-04 · version, year and base path', () => {
  it('takes the version from package.json', () => {
    expect(APP_VERSION).toBe(pkg.version);
    expect(PRODUCT.APP_VERSION).toBe(pkg.version);
    expect(aboutVersionLine('en')).toContain(pkg.version);
    expect(aboutVersionLine('ko')).toContain('Phase 3');
  });

  it('reads the build year from a fixed clock when one is given', () => {
    expect(buildYearFrom('1764115200')).toBe(2025);
    expect(buildYearFrom(undefined, new Date(2031, 0, 1))).toBe(2031);
    expect(BUILD_YEAR).toBeGreaterThanOrEqual(2024);
  });

  it('resolves the GitHub Pages sub-path, a server root and file://', () => {
    expect(resolveBasePath({ edition: 'public', defaultBasePath: '/PKPilot0018/' })).toBe('/PKPilot0018/');
    expect(resolveBasePath({ edition: 'enterprise', defaultBasePath: '/' })).toBe('/');
    expect(resolveBasePath({ edition: 'public', defaultBasePath: '/PKPilot0018/', requested: 'stats' })).toBe('/stats/');
    expect(resolveBasePath({ edition: 'public', defaultBasePath: '/PKPilot0018/', portable: true })).toBe('./');
    expect(normalizeBasePath('')).toBe('./');
    expect(normalizeBasePath('/a/b')).toBe('/a/b/');
  });
});

/* ── 28. storage namespace isolation ─────────────────────────────────── */

describe('WO-04 · storage namespaces', () => {
  it('keeps the public keys unchanged and prefixes the enterprise ones', () => {
    expect(namespacedKey('sigrun.settings.v1', '')).toBe('sigrun.settings.v1');
    expect(namespacedKey('sigrun.settings.v1', 'sigrun.enterprise.')).toBe('sigrun.enterprise.sigrun.settings.v1');
    expect(new Set(STORAGE_KEYS_IN_USE).size).toBe(STORAGE_KEYS_IN_USE.length);
  });

  it('names every durable key through one inventory', () => {
    expect(AUTOSAVE_STORAGE_KEY).toBe(namespacedKey(STORAGE_KEY.autosave));
    expect(WORKSPACE_KEY).toBe(namespacedKey(STORAGE_KEY.workspace));
    expect(CUSTOM_STYLE_STORAGE_KEY).toBe(namespacedKey(STORAGE_KEY.chartStyles));
    expect(TUTORIAL_PROGRESS_KEY).toBe(namespacedKey(STORAGE_KEY.tutorialProgress));
    expect(TUTORIAL_PRACTICE_KEY).toBe(namespacedKey(STORAGE_KEY.tutorialPractice));
    expect(TUTORIAL_PRACTICE_KEY_V1).toBe(namespacedKey(STORAGE_KEY.tutorialPracticeV1));
    expect(TUTORIAL_ORIGINAL_KEY).toBe(namespacedKey(STORAGE_KEY.tutorialOriginal));
    expect(WORKSPACE_KEY).toBe('sigrun.workspace.v2');
  });

  it('never lets one edition read the other’s records', () => {
    const publicKeys = Object.values(STORAGE_KEY).map((key) => namespacedKey(key, ''));
    const enterpriseKeys = Object.values(STORAGE_KEY).map((key) => namespacedKey(key, ENTERPRISE_EDITION.STORAGE_NAMESPACE));
    expect(publicKeys.some((key) => key.startsWith(ENTERPRISE_EDITION.STORAGE_NAMESPACE))).toBe(false);
    expect(enterpriseKeys.every((key) => key.startsWith(ENTERPRISE_EDITION.STORAGE_NAMESPACE))).toBe(true);
    for (const key of enterpriseKeys) expect(publicKeys).not.toContain(key);
  });

  it('keeps the export prefix in the file names', () => {
    expect(projectFileName(new Date(2026, 10, 22))).toBe('sigrun-2026-11-22.sigrun.json');
    expect(PUBLIC_EDITION.EXPORT_FILE_PREFIX).toBe('sigrun');
    expect(ENTERPRISE_EDITION.EXPORT_FILE_PREFIX).not.toBe(PUBLIC_EDITION.EXPORT_FILE_PREFIX);
  });
});

/* ── 29. the HTML shells carry tokens, not brands ─────────────────────── */

describe('WO-04 · the pages are branded once', () => {
  const TOKEN = /%PRODUCT_[A-Z_]+%/g;

  it('leaves no brand, address, key or unknown token in either shell', () => {
    for (const [name, html] of [['index.html', indexHtml], ['portable.html', portableHtml]] as const) {
      expect(html, name).not.toMatch(/HD2Lab|hyangdan2\.github\.io|sigrun\.settings\.v1/);
      const tokens = html.match(TOKEN) ?? [];
      const known = Object.keys(htmlTokens(PUBLIC_EDITION));
      for (const token of tokens) expect(known, `${name} has ${token}`).toContain(token);
      expect(tokens.length).toBeGreaterThan(0);
    }
  });

  it('renders the public page exactly as the live site states it', () => {
    const html = applyHtmlTokens(indexHtml, PUBLIC_EDITION);
    expect(html).toContain('<title>Sigrún — HD2Lab Statistical Workspace</title>');
    expect(html).toContain('href="https://hyangdan2.github.io/PKPilot0018/"');
    expect(html).toContain("localStorage.getItem('sigrun.settings.v1')");
    expect(html).not.toContain('%PRODUCT_');
  });

  it('renders an address-less edition without an empty canonical or OG tag', () => {
    const html = applyHtmlTokens(indexHtml, ENTERPRISE_EDITION);
    expect(html).not.toContain('%PRODUCT_');
    expect(html).not.toContain('HD2Lab');
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('og:image');
    expect(html).toContain("localStorage.getItem('sigrun.enterprise.sigrun.settings.v1')");
    expect(stripEmptyTags('<meta name="x" content="" />\n<p>kept</p>')).toBe('<p>kept</p>');
  });

  it('states the manifest from the same record', () => {
    const manifest = manifestFor(PUBLIC_EDITION);
    expect(manifest.name).toBe('Sigrún — HD2Lab Statistical Workspace');
    expect(manifest.short_name).toBe('Sigrún');
    expect(manifest.description).toBe(PUBLIC_EDITION.SUMMARY);
    expect(manifest.start_url).toBe('./');
    expect(manifest.icons.length).toBeGreaterThan(0);
    expect(manifestFor(ENTERPRISE_EDITION).name).not.toContain('HD2Lab');
  });
});

/* ── 30. brand de-duplication in the application source ───────────────── */

describe('WO-04 · one place owns the brand', () => {
  const sources = ['Header', 'HelpModal', 'appInfo', 'project'].map((name) => {
    const file = name === 'Header' || name === 'HelpModal'
      ? path.join(process.cwd(), 'src', 'components', `${name}.tsx`)
      : path.join(process.cwd(), 'src', 'lib', `${name}.ts`);
    return { name, text: readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '') };
  });

  it('does not hardcode the owner in components or the project writer', () => {
    for (const source of sources) expect(source.text, source.name).not.toContain('HD2Lab');
  });

  it('gates the outbound menu links behind the edition flag', () => {
    const header = sources.find((source) => source.name === 'Header')!.text;
    expect(header).toContain('PRODUCT.EXTERNAL_LINKS_ENABLED');
    expect(ENTERPRISE_EDITION.EXTERNAL_LINKS_ENABLED).toBe(false);
    expect(PUBLIC_EDITION.EXTERNAL_LINKS_ENABLED).toBe(true);
  });
});
