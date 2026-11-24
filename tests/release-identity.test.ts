/* WO-FINAL-002 · Q-04 — the release identity is the tag, and nothing else. */

import { describe, expect, it } from 'vitest';
import { parseReleaseId, releaseIdentity } from '../tools/release.mjs';

describe('Q-04 · release identity', () => {
  it('defaults to an RC id from the package version', () => {
    const identity = releaseIdentity('1.0.0', { env: {}, tag: '' });
    expect(identity.id).toBe('v1.0.0-rc.1');
    expect(identity.channel).toBe('rc');
    expect(identity.tag).toBeNull();
    expect(identity.problems).toEqual([]);
  });

  it('uses the Git tag in tag CI', () => {
    const identity = releaseIdentity('1.0.0', { env: { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.0.0' }, tag: '' });
    expect(identity.id).toBe('v1.0.0');
    expect(identity.channel).toBe('final');
    expect(identity.tag).toBe('v1.0.0');
    expect(identity.problems).toEqual([]);
  });

  it('uses an exact tag on HEAD outside CI', () => {
    const identity = releaseIdentity('1.0.0', { env: {}, tag: 'v1.0.0-rc.1' });
    expect(identity.id).toBe('v1.0.0-rc.1');
    expect(identity.channel).toBe('rc');
    expect(identity.problems).toEqual([]);
  });

  it('distinguishes the final and RC package names', () => {
    expect(parseReleaseId('v1.0.0')).toEqual({ version: '1.0.0', channel: 'final' });
    expect(parseReleaseId('v1.0.0-rc.1')).toEqual({ version: '1.0.0', channel: 'rc' });
    expect(parseReleaseId('1.0.0')).toBeNull();
    expect(parseReleaseId('v1.0')).toBeNull();
  });

  it('blocks a tag whose version is not the package version', () => {
    const identity = releaseIdentity('1.0.0', { env: { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.0.1' } });
    expect(identity.problems.join(' ')).toMatch(/does not match package version/);
  });

  it('blocks an explicit id that disagrees with the tag', () => {
    const identity = releaseIdentity('1.0.0', { env: { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.0.0-rc.2', RELEASE_ID: 'v1.0.0-rc.1' } });
    expect(identity.problems.join(' ')).toMatch(/≠ git tag/);
  });

  it('blocks an id that is not a version tag', () => {
    const identity = releaseIdentity('1.0.0', { env: { RELEASE_ID: 'nightly' } });
    expect(identity.problems.join(' ')).toMatch(/not vX\.Y\.Z/);
  });
});
