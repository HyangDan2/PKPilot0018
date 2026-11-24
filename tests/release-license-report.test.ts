/* WO-FINAL-002 · Q-05 — license qualification: full texts, NOTICE files,
   an explicit first-party note, and never an invented license. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectLicenses, licensesText, FIRST_PARTY_NOTE } from '../tools/license_report.mjs';

const roots: string[] = [];

function packageAt(root: string, dir: string, manifest: object, files: Record<string, string> = {}): void {
  const full = path.join(root, 'node_modules', dir);
  fs.mkdirSync(full, { recursive: true });
  fs.writeFileSync(path.join(full, 'package.json'), JSON.stringify(manifest));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(full, name), text);
}

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sigrun-license-'));
  roots.push(root);
  packageAt(root, 'pkg-a', { name: 'pkg-a', version: '1.0.0', license: 'MIT', homepage: 'https://a.example' }, {
    LICENSE: 'MIT LICENSE TEXT FOR A\n',
    NOTICE: 'NOTICE FOR A\n',
  });
  packageAt(root, '@scope/pkg-b', { name: '@scope/pkg-b', version: '2.0.0', license: 'ISC' }, {
    'COPYING.txt': 'ISC TEXT FOR B\n',
  });
  packageAt(root, 'pkg-c', { name: 'pkg-c', version: '0.1.0' });
  packageAt(root, 'pkg-d', { name: 'pkg-d', version: '3.0.0', license: 'Apache-2.0' });
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Q-05 · license report', () => {
  it('stops on a package without a confirmed license and never assigns one', () => {
    const { rows, problems } = collectLicenses(fixture());
    expect(rows.map((row) => row.name)).toEqual(['@scope/pkg-b', 'pkg-a', 'pkg-d']);
    expect(problems).toEqual(['license: pkg-c@0.1.0 has no confirmed license']);
    expect(rows.some((row) => row.name === 'pkg-c')).toBe(false);
  });

  it('carries the full license text and every NOTICE file', () => {
    const { rows } = collectLicenses(fixture());
    const a = rows.find((row) => row.name === 'pkg-a')!;
    expect(a.texts).toEqual([{ file: 'LICENSE', text: 'MIT LICENSE TEXT FOR A' }]);
    expect(a.notices).toEqual([{ file: 'NOTICE', text: 'NOTICE FOR A' }]);
    const text = licensesText(rows, { version: '1.0.0', description: 'Test build' });
    expect(text).toContain('MIT LICENSE TEXT FOR A');
    expect(text).toContain('--- NOTICE: NOTICE ---');
    expect(text).toContain('NOTICE FOR A');
    expect(text).toContain('ISC TEXT FOR B');
    expect(text).toContain('--- COPYING.txt ---');
  });

  it('states that a package ships no license text instead of filling one in', () => {
    const { rows } = collectLicenses(fixture());
    const text = licensesText(rows, { version: '1.0.0', description: 'Test build' });
    expect(text).toContain('pkg-d@3.0.0 — Apache-2.0');
    expect(text).toContain('(the package ships no license text file)');
  });

  it('names the first-party content as an owner-approval matter', () => {
    const text = licensesText(collectLicenses(fixture()).rows, { version: '1.0.0', description: 'Test build' });
    for (const line of FIRST_PARTY_NOTE) expect(text).toContain(line);
  });

  it('is deterministic for the same tree', () => {
    const root = fixture();
    const first = licensesText(collectLicenses(root).rows, { version: '1.0.0', description: 'Test build' });
    const second = licensesText(collectLicenses(root).rows, { version: '1.0.0', description: 'Test build' });
    expect(first).toBe(second);
  });
});
