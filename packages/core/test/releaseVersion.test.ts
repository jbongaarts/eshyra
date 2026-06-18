import { describe, expect, it } from 'vitest';
// The release build script is plain JS tooling; import its pure version helpers.
import {
  normalizeVersion,
  resolveVersion,
  VERSION_SENTINEL,
  // @ts-expect-error - .mjs tooling script without type declarations
} from '../../../scripts/release/build-release-artifact.mjs';

describe('release version resolution', () => {
  it('strips a leading v and accepts semver-like versions', () => {
    expect(normalizeVersion('v0.1.0')).toBe('0.1.0');
    expect(normalizeVersion('0.1.0')).toBe('0.1.0');
    expect(normalizeVersion('v1.2.3-rc.1')).toBe('1.2.3-rc.1');
    expect(normalizeVersion(' v2.0.0 ')).toBe('2.0.0');
    // Two-part tags are tolerated (e.g. v0.1).
    expect(normalizeVersion('v0.1')).toBe('0.1');
  });

  it('rejects non-semver-like versions', () => {
    for (const bad of ['', 'v', 'latest', '1', 'abc', '0.1.0.0', 'v1.x']) {
      expect(() => normalizeVersion(bad)).toThrow(/invalid release version/);
    }
  });

  it('prefers explicit --version over env and tag', () => {
    const env = {
      ESHYRA_RELEASE_VERSION: '2.0.0',
      GITHUB_REF_TYPE: 'tag',
      GITHUB_REF_NAME: 'v3.0.0',
    };
    expect(resolveVersion('v1.0.0', env)).toBe('1.0.0');
  });

  it('falls back to ESHYRA_RELEASE_VERSION when no explicit version', () => {
    const env = {
      ESHYRA_RELEASE_VERSION: 'v2.5.0',
      GITHUB_REF_TYPE: 'tag',
      GITHUB_REF_NAME: 'v3.0.0',
    };
    expect(resolveVersion(undefined, env)).toBe('2.5.0');
  });

  it('derives the version from the pushed tag in CI', () => {
    const env = { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v0.1.0' };
    expect(resolveVersion(undefined, env)).toBe('0.1.0');
  });

  it('ignores GITHUB_REF_NAME when the ref is a branch, not a tag', () => {
    const env = { GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main' };
    expect(resolveVersion(undefined, env)).toBe(VERSION_SENTINEL);
  });

  it('falls back to the dev sentinel with no signals (local build)', () => {
    expect(resolveVersion(undefined, {})).toBe(VERSION_SENTINEL);
    expect(VERSION_SENTINEL).toBe('0.0.0-dev');
  });
});
