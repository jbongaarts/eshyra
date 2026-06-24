import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  removeBinShimsFor,
  resolveEdition,
  // @ts-expect-error - .mjs tooling script without type declarations
} from '../../../scripts/release/build-release-artifact.mjs';
import {
  AGENT_SDK_PACKAGES,
  DEFAULT_EDITION,
  EDITION_NAMES,
  EDITIONS,
  editionPackages,
  excludedProviderKeys,
  isEdition,
  isRemovablePackage,
  // @ts-expect-error - .mjs tooling module without type declarations
} from '../../../scripts/release/editions.mjs';

function readText(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('release edition catalogue (ADR 0011)', () => {
  it('defines exactly the four editions api/claude/codex/full', () => {
    expect(new Set(EDITION_NAMES)).toEqual(
      new Set(['api', 'claude', 'codex', 'full']),
    );
  });

  it('maps each edition to its agent-SDK provider package set', () => {
    expect(editionPackages('api')).toEqual([]);
    expect(editionPackages('claude')).toEqual([
      '@anthropic-ai/claude-agent-sdk',
    ]);
    expect(editionPackages('codex')).toEqual(['@openai/codex-sdk']);
    expect(editionPackages('full')).toEqual([
      '@anthropic-ai/claude-agent-sdk',
      '@openai/codex-sdk',
    ]);
  });

  it('the api edition bundles NO agent CLI binary (lean)', () => {
    expect(editionPackages('api')).toHaveLength(0);
  });

  it('the full edition is the union of claude and codex providers', () => {
    const union = new Set([
      ...editionPackages('claude'),
      ...editionPackages('codex'),
    ]);
    expect(new Set(editionPackages('full'))).toEqual(union);
  });

  it('default edition is claude (preserves today’s artifact behavior)', () => {
    expect(DEFAULT_EDITION).toBe('claude');
    expect(EDITIONS[DEFAULT_EDITION]).toBeDefined();
  });

  it('isEdition accepts known editions and rejects typos', () => {
    for (const name of EDITION_NAMES) expect(isEdition(name)).toBe(true);
    for (const bad of ['', 'claud', 'openai', 'gpt', 'CLAUDE'])
      expect(isEdition(bad)).toBe(false);
  });

  it('editionPackages throws on an unknown edition', () => {
    expect(() => editionPackages('nope')).toThrow(/unknown edition/);
  });

  it('every provider in any edition is a known agent-SDK package', () => {
    const known = new Set(Object.values(AGENT_SDK_PACKAGES));
    for (const name of EDITION_NAMES) {
      for (const pkg of editionPackages(name)) {
        expect(known.has(pkg)).toBe(true);
      }
    }
  });
});

describe('build edition resolution', () => {
  it('prefers explicit --edition over env and default', () => {
    expect(resolveEdition('codex', { ESHYRA_EDITION: 'api' })).toBe('codex');
  });

  it('falls back to ESHYRA_EDITION when no explicit value', () => {
    expect(resolveEdition(undefined, { ESHYRA_EDITION: 'full' })).toBe('full');
  });

  it('falls back to the default edition when nothing is set', () => {
    expect(resolveEdition(undefined, {})).toBe(DEFAULT_EDITION);
  });

  it('rejects an invalid edition loudly', () => {
    expect(() => resolveEdition('bogus', {})).toThrow(/invalid edition/);
  });
});

describe('provider pruning targets (heavy binary, not just the wrapper)', () => {
  it('excludes the complement of each edition’s included providers', () => {
    expect(excludedProviderKeys('api').sort()).toEqual(['claude', 'codex']);
    expect(excludedProviderKeys('claude')).toEqual(['codex']);
    expect(excludedProviderKeys('codex')).toEqual(['claude']);
    expect(excludedProviderKeys('full')).toEqual([]);
  });

  it('matches the Claude wrapper AND its per-platform binary subpackages', () => {
    const excluded = ['claude'];
    expect(isRemovablePackage('@anthropic-ai/claude-agent-sdk', excluded)).toBe(
      true,
    );
    // The ~223 MB binary — the whole reason pruning the wrapper alone is useless.
    expect(
      isRemovablePackage('@anthropic-ai/claude-agent-sdk-linux-x64', excluded),
    ).toBe(true);
    expect(
      isRemovablePackage(
        '@anthropic-ai/claude-agent-sdk-darwin-arm64',
        excluded,
      ),
    ).toBe(true);
    // The api-native SDK ships in every edition — it must NEVER be pruned.
    expect(isRemovablePackage('@anthropic-ai/sdk', excluded)).toBe(false);
  });

  it('matches the Codex wrapper, launcher, and per-platform binary', () => {
    const excluded = ['codex'];
    expect(isRemovablePackage('@openai/codex-sdk', excluded)).toBe(true);
    expect(isRemovablePackage('@openai/codex', excluded)).toBe(true);
    expect(isRemovablePackage('@openai/codex-linux-x64', excluded)).toBe(true);
  });

  it('removes nothing when the provider is still included', () => {
    expect(
      isRemovablePackage('@anthropic-ai/claude-agent-sdk-linux-x64', ['codex']),
    ).toBe(false);
    expect(isRemovablePackage('@openai/codex', ['claude'])).toBe(false);
  });
});

describe('edition-aware artifact naming and installers', () => {
  it('build script encodes the edition in the artifact name', () => {
    const build = readText('scripts/release/build-release-artifact.mjs');
    // baseName template must place the edition between the eshyra- prefix and
    // the version, so all four editions can coexist on one Release.
    expect(build).toMatch(
      /eshyra-\$\{edition\}-\$\{version\}-\$\{target\.os\}-\$\{target\.arch\}/,
    );
  });

  it('build script prunes excluded agent SDKs from the staged tree', () => {
    const build = readText('scripts/release/build-release-artifact.mjs');
    expect(build).toMatch(/pruneAgentSdks/);
    expect(build).toMatch(/editionPackages/);
  });

  it('forces a deterministic workspace build before packing', () => {
    const build = readText('scripts/release/build-release-artifact.mjs');
    expect(build).toContain("npm(['run', 'typecheck'])");
    expect(build).not.toContain("npm(['run', 'build'])");
  });

  it('POSIX installer exposes an --edition flag and ESHYRA_EDITION env', () => {
    const sh = readText('scripts/release/install.sh');
    expect(sh).toContain('--edition');
    expect(sh).toContain('ESHYRA_EDITION');
    // All four editions must be selectable / validated.
    for (const name of ['api', 'claude', 'codex', 'full']) {
      expect(sh).toContain(name);
    }
  });

  it('POSIX installer default edition matches the catalogue default', () => {
    const sh = readText('scripts/release/install.sh');
    expect(sh).toContain(`ESHYRA_DEFAULT_EDITION="${DEFAULT_EDITION}"`);
  });

  it('POSIX installer selects the asset by edition prefix + target suffix', () => {
    const sh = readText('scripts/release/install.sh');
    // GitHub mode must filter assets by the edition prefix, not just target.
    expect(sh).toMatch(/grep -- "\/eshyra-\$\{EDITION\}-"/);
    // Custom-base mode must include the edition in the constructed name.
    // Matched as a regex (like the prefix assertion above) so the literal bash
    // ${...} variables in install.sh are not read as JS template placeholders.
    expect(sh).toMatch(
      /eshyra-\$\{EDITION\}-\$\{_ver\}-\$\{_target\}\.tar\.gz/,
    );
  });

  it('PowerShell installer exposes -Edition and $env:ESHYRA_EDITION', () => {
    const ps1 = readText('scripts/release/install.ps1');
    expect(ps1).toContain('$Edition');
    expect(ps1).toContain('ESHYRA_EDITION');
    for (const name of ['api', 'claude', 'codex', 'full']) {
      expect(ps1).toContain(name);
    }
  });

  it('PowerShell installer default edition matches the catalogue default', () => {
    const ps1 = readText('scripts/release/install.ps1');
    expect(ps1).toContain(`$EshyraDefaultEdition = '${DEFAULT_EDITION}'`);
  });

  it('PowerShell installer selects the asset by edition prefix + target', () => {
    const ps1 = readText('scripts/release/install.ps1');
    expect(ps1).toMatch(/eshyra-\$Edition-\*-\$Target\.zip/);
    expect(ps1).toContain('eshyra-$Edition-$ver-$Target.zip');
  });
});

describe('release workflow edition matrix', () => {
  it('release.yml builds the edition x platform grid', () => {
    const wf = readText('.github/workflows/release.yml');
    // The matrix must enumerate all four editions.
    for (const name of ['api', 'claude', 'codex', 'full']) {
      expect(wf).toContain(name);
    }
    // The build step must pass the edition through to the builder.
    expect(wf).toMatch(/ESHYRA_EDITION|--edition/);
  });
});

describe('docs document the editions', () => {
  it('docs/cli-distribution.md describes the four editions', () => {
    const doc = readText('docs/cli-distribution.md');
    for (const name of ['api', 'claude', 'codex', 'full']) {
      expect(doc).toContain(name);
    }
    expect(doc).toMatch(/edition/i);
  });

  it('docs/install.md shows the --edition install command', () => {
    const doc = readText('docs/install.md');
    expect(doc).toContain('--edition');
    expect(doc).toContain('ESHYRA_EDITION');
  });
});

describe('removeBinShimsFor (manifest-driven launcher cleanup)', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'eshyra-bin-test-'));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  /** Build a scoped package dir with a `bin` field + its `.bin` shims. */
  function seedScoped(bin: unknown): { nm: string; pkgDir: string } {
    const nm = join(scratch, 'node_modules');
    const pkgDir = join(nm, '@openai', 'codex');
    mkdirSync(pkgDir, { recursive: true });
    mkdirSync(join(nm, '.bin'), { recursive: true });
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: '@openai/codex', bin }),
    );
    return { nm, pkgDir };
  }

  it('removes the shim AND its Windows .cmd/.ps1 companions (string bin)', () => {
    const { nm, pkgDir } = seedScoped('bin/codex.js');
    // The staging copy dereferences symlinks, so the shims are real files.
    for (const f of ['codex', 'codex.cmd', 'codex.ps1', 'keep'])
      writeFileSync(join(nm, '.bin', f), '');

    const removed = removeBinShimsFor({ name: '@openai/codex', dir: pkgDir });

    expect(removed).toEqual(['codex']);
    // codex + companions gone; an unrelated shim is untouched.
    expect(readdirSync(join(nm, '.bin')).sort()).toEqual(['keep']);
  });

  it('removes every key of an object bin', () => {
    const nm = join(scratch, 'node_modules');
    const pkgDir = join(nm, 'multi');
    mkdirSync(pkgDir, { recursive: true });
    mkdirSync(join(nm, '.bin'), { recursive: true });
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'multi', bin: { a: 'a.js', b: 'b.js' } }),
    );
    for (const f of ['a', 'b']) writeFileSync(join(nm, '.bin', f), '');

    expect(removeBinShimsFor({ name: 'multi', dir: pkgDir }).sort()).toEqual([
      'a',
      'b',
    ]);
  });

  it('is a no-op for a package with no bin field', () => {
    const { pkgDir } = seedScoped(undefined);
    expect(removeBinShimsFor({ name: '@openai/codex', dir: pkgDir })).toEqual(
      [],
    );
  });
});
