/* ─────────────────────────────────────────────────────────────────────────
   Statelia — third-party license report (WO-FINAL-002 · Q-05)

   The release must carry the license qualification, not just license names:
   every installed package's declared license, the full license text the
   package ships, and every NOTICE file it carries (Apache-2.0 requires NOTICE
   propagation). A package with no confirmed license stops the release; this
   file never invents one.

   First-party source and assets are not licensed here. Their redistribution
   rights belong to the product owner and are subject to written approval.

   Deterministic by construction: packages sorted by directory, files sorted by
   name, no timestamps — the release stays reproducible.
   ───────────────────────────────────────────────────────────────────────── */

import fs from 'node:fs';
import path from 'node:path';

const MAX_TEXT_BYTES = 512 * 1024;
const LICENSE_FILE = /^(licen[cs]e|copying)(\..*)?$/i;
const NOTICE_FILE = /^notice(\..*)?$/i;

export const FIRST_PARTY_NOTE = [
  'FIRST-PARTY CONTENT',
  'The application source and bundled assets (src/, public/) carry no license',
  'statement in this repository. Redistribution rights for them rest entirely',
  'with the product owner and are subject to written approval; no license is',
  'granted, assigned or implied by this file.',
];

export function installedPackages(root) {
  const modules = path.join(root, 'node_modules');
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

export function licenseOf(manifest) {
  const value = manifest.license ?? (typeof manifest.licenses === 'string' ? manifest.licenses : manifest.licenses?.[0]?.type);
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function readTextFiles(dir, pattern) {
  const files = fs.readdirSync(dir).filter((name) => pattern.test(name)).sort();
  const texts = [];
  for (const name of files) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (!stat.isFile() || stat.size > MAX_TEXT_BYTES) continue;
    texts.push({ file: name, text: fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n').trimEnd() });
  }
  return texts;
}

/** Declared license plus the license/NOTICE texts shipped with one package. */
export function packageLicense(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  return {
    name: manifest.name,
    version: manifest.version,
    license: licenseOf(manifest),
    url: manifest.homepage || (manifest.repository && (manifest.repository.url || manifest.repository)) || '',
    texts: readTextFiles(dir, LICENSE_FILE),
    notices: readTextFiles(dir, NOTICE_FILE),
  };
}

/**
 * Every installed package with a confirmed license, and the problems that stop
 * a release (an unconfirmed license, never an invented one).
 */
export function collectLicenses(root) {
  const rows = [];
  const problems = [];
  for (const dir of installedPackages(root)) {
    const row = packageLicense(dir);
    if (!row.license || /^unlicensed$/i.test(row.license)) {
      problems.push(`license: ${row.name}@${row.version} has no confirmed license`);
      continue;
    }
    rows.push(row);
  }
  return { rows, problems };
}

export function licensesText(rows, { version, description, firstParty = FIRST_PARTY_NOTE } = {}) {
  const lines = [
    'THIRD-PARTY SOFTWARE LICENSES',
    String(description ?? ''),
    `build ${version ?? ''} · ${rows.length} packages · generated from node_modules`,
    '',
    ...firstParty,
    '',
    'Each package below lists its declared license, the full license text it',
    'ships, and any NOTICE file it carries. A package that ships no license text',
    'says so; nothing is filled in on its behalf.',
    '',
  ];
  for (const row of rows) {
    lines.push('='.repeat(80));
    lines.push(`${row.name}@${row.version} — ${row.license}${row.url ? ` — ${row.url}` : ''}`);
    if (!row.texts.length) lines.push('(the package ships no license text file)');
    for (const text of row.texts) {
      lines.push(`--- ${text.file} ---`);
      lines.push(text.text);
    }
    for (const notice of row.notices) {
      lines.push(`--- NOTICE: ${notice.file} ---`);
      lines.push(notice.text);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
