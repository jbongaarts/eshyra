import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readText(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('Release installer policy', () => {
  it('installer scripts exist in scripts/release/', () => {
    for (const f of [
      'scripts/release/install.sh',
      'scripts/release/install.ps1',
      'scripts/release/generate-checksums.mjs',
    ]) {
      expect(existsSync(join(process.cwd(), f)), `${f} must exist`).toBe(true);
    }
  });

  it('POSIX installer maps to the correct artifact targets', () => {
    const sh = readText('scripts/release/install.sh');

    // Must handle all supported target triples.
    expect(sh).toContain('linux-x64');
    expect(sh).toContain('linux-arm64');
    expect(sh).toContain('darwin-arm64');

    // darwin-x64 (Intel macOS) is explicitly rejected.
    expect(sh).toMatch(
      /darwin.*x64.*not supported|Intel macOS.*not supported/i,
    );

    // WSL note: uses the Linux artifact.
    expect(sh).toMatch(/microsoft|wsl|WSL/i);
  });

  it('PowerShell installer maps to windows-x64, not win32-x64', () => {
    const ps1 = readText('scripts/release/install.ps1');

    expect(ps1).toContain('windows-x64');
    expect(ps1).not.toContain('win32-x64');
  });

  it('POSIX installer does not reference win32-x64', () => {
    const sh = readText('scripts/release/install.sh');
    expect(sh).not.toContain('win32-x64');
  });

  it('installer scripts support version override', () => {
    const sh = readText('scripts/release/install.sh');
    const ps1 = readText('scripts/release/install.ps1');

    // POSIX: env var override.
    expect(sh).toContain('ESHYRA_VERSION');
    // PowerShell: parameter + env var.
    expect(ps1).toContain('ESHYRA_VERSION');
    expect(ps1).toContain('-Version');
  });

  it('installer scripts support base URL override for local testing', () => {
    const sh = readText('scripts/release/install.sh');
    const ps1 = readText('scripts/release/install.ps1');

    expect(sh).toContain('ESHYRA_BASE_URL');
    expect(ps1).toContain('ESHYRA_BASE_URL');
  });

  it('installer scripts verify SHA-256 checksums', () => {
    const sh = readText('scripts/release/install.sh');
    const ps1 = readText('scripts/release/install.ps1');

    expect(sh).toContain('sha256sums.txt');
    expect(ps1).toContain('sha256sums.txt');
    // Both must compute and compare hashes.
    expect(sh).toMatch(/sha256|SHA256/);
    expect(ps1).toMatch(/SHA256/);
  });

  it('installer scripts install without requiring system Node', () => {
    const sh = readText('scripts/release/install.sh');
    const ps1 = readText('scripts/release/install.ps1');

    // Strip comment lines before checking for tool invocations. Comments may
    // legitimately say "does not require Node.js, npm, ..."; only actual
    // command invocations outside comments are prohibited.
    const stripShComments = (s: string) =>
      s
        .split('\n')
        .filter((l) => !/^\s*#/.test(l))
        .join('\n');
    const stripPs1Comments = (s: string) =>
      s
        .split('\n')
        .filter((l) => !/^\s*#/.test(l))
        .join('\n');

    expect(stripShComments(sh)).not.toMatch(/\bnvm\b|\bnpm\b|\bnode\s/);
    expect(stripPs1Comments(ps1)).not.toMatch(/\bnvm\b|\bnpm\b|\bnode\s/);
  });

  it('POSIX installer installs to XDG_DATA_HOME-respecting path', () => {
    const sh = readText('scripts/release/install.sh');
    expect(sh).toContain('XDG_DATA_HOME');
    expect(sh).toContain('.local/share');
    expect(sh).toContain('.local/bin');
  });

  it('PowerShell installer installs to LOCALAPPDATA', () => {
    const ps1 = readText('scripts/release/install.ps1');
    expect(ps1).toContain('LOCALAPPDATA');
    expect(ps1).toContain('Eshyra\\bin');
  });

  it('installer scripts verify the installed command', () => {
    const sh = readText('scripts/release/install.sh');
    const ps1 = readText('scripts/release/install.ps1');

    // Both should check for the no-config marker string.
    expect(sh).toContain('ANTHROPIC_API_KEY');
    expect(ps1).toContain('ANTHROPIC_API_KEY');
  });

  it('release workflow references all installer assets', () => {
    const wf = readText('.github/workflows/release.yml');

    for (const asset of ['install.sh', 'install.ps1', 'sha256sums.txt']) {
      expect(wf, `workflow must reference ${asset}`).toContain(asset);
    }
  });

  it('release workflow has a validate-installer-scripts job', () => {
    const wf = readText('.github/workflows/release.yml');
    expect(wf).toContain('validate-installer-scripts');
  });

  it('package.json provides release:checksums script', () => {
    interface PackageJson {
      scripts?: Record<string, string>;
    }
    const pkg = JSON.parse(readText('package.json')) as PackageJson;
    expect(pkg.scripts?.['release:checksums']).toBe(
      'node scripts/release/generate-checksums.mjs',
    );
  });

  it('docs/install.md shows one-line installer as primary path', () => {
    const install = readText('docs/install.md');

    // One-liner commands must appear before any manual tar/unpack instructions.
    const curlIdx = install.indexOf('curl -fsSL');
    const irmIdx = install.indexOf('irm ');
    const tarIdx = install.indexOf('tar -xzf');

    expect(
      curlIdx,
      'curl one-liner must be present in docs/install.md',
    ).toBeGreaterThan(-1);
    expect(
      irmIdx,
      'irm one-liner must be present in docs/install.md',
    ).toBeGreaterThan(-1);
    // curl must appear before the manual tar instructions.
    expect(
      curlIdx,
      'curl one-liner must appear before manual tar instructions',
    ).toBeLessThan(tarIdx === -1 ? Number.MAX_SAFE_INTEGER : tarIdx);
  });

  it('docs/install.md uses windows-x64, not win32-x64', () => {
    const install = readText('docs/install.md');
    expect(install).not.toContain('win32-x64');
  });

  it('docs/install.md preserves license wording', () => {
    const install = readText('docs/install.md');

    expect(install).toContain('PolyForm Noncommercial');
    // "not open source" must appear; Markdown bold markers (**) around "not" are allowed.
    expect(install).toMatch(/(?:\*\*)?not(?:\*\*)? open source/i);
    // Must not affirmatively describe Eshyra as open source.
    expect(install).not.toMatch(/Eshyra is (?:an? )?open[- ]source/i);
    expect(install).toContain('commercial use');
  });

  it('README.md shows one-line installer prominently', () => {
    const readme = readText('README.md');
    expect(readme).toContain('curl -fsSL');
    expect(readme).toContain('irm ');
    // README must not describe Eshyra as open source.
    expect(readme).not.toMatch(/\bopen.source\b/i);
  });
});
