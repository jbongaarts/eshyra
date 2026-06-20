import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  VERSION_SENTINEL,
  // @ts-expect-error - .mjs tooling script without type declarations
} from '../../../scripts/release/build-release-artifact.mjs';

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

  it('POSIX installer uses GitHub API asset discovery, not tag-derived filename', () => {
    const sh = readText('scripts/release/install.sh');

    // Must query the GitHub Releases API.
    expect(sh).toContain('api.github.com');
    expect(sh).toMatch(/releases\/latest|releases\/tags/);

    // Must find the archive URL from the API response by suffix match.
    expect(sh).toContain('browser_download_url');

    // The GitHub-mode path must NOT construct the archive name by stripping 'v'
    // from the resolved tag and appending the target. That pattern breaks when
    // root package.json has no version (builder falls back to "0.0.0") while the
    // tag is "v0.1.0". The name must come from the actual asset URL.
    // Verify: archive_name must be set from basename of the discovered URL, not
    // from a template like "eshyra-${version}-${target}.tar.gz".
    expect(sh).toMatch(/ARCHIVE_NAME=\$\(basename/);
  });

  it('PowerShell installer uses GitHub API asset discovery, not tag-derived filename', () => {
    const ps1 = readText('scripts/release/install.ps1');

    // Must query the GitHub Releases API.
    expect(ps1).toContain('api.github.com');

    // Must find the archive by filtering the assets list, not by constructing
    // a filename from the resolved tag version.
    expect(ps1).toMatch(/\.assets\s*\|/);
    expect(ps1).toMatch(/browser_download_url/);
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

  it('installer custom-base fallback matches the builder version sentinel', () => {
    // The installer smoke test builds a fresh artifact with NO release version
    // injected, so the builder names it eshyra-${VERSION_SENTINEL}-…, and runs
    // install.sh in ESHYRA_BASE_URL mode without ESHYRA_VERSION. The installer's
    // custom-base fallback must therefore equal the builder sentinel, or it
    // looks for the wrong filename and the Release workflow's installer-smoke
    // job fails. Tie both to the real builder constant so they can't drift.
    expect(VERSION_SENTINEL).toBe('0.0.0-dev');

    const sh = readText('scripts/release/install.sh');
    const ps1 = readText('scripts/release/install.ps1');

    // POSIX custom-base mode: _ver defaults to the sentinel when ESHYRA_VERSION
    // is unset (parameter-expansion default).
    expect(sh).toContain(`\${ESHYRA_VERSION:-${VERSION_SENTINEL}}`);
    // PowerShell custom-base mode: $ver falls back to the sentinel literal.
    expect(ps1).toContain(`'${VERSION_SENTINEL}'`);

    // Neither installer's custom-base fallback may use the old bare "0.0.0".
    // This is the literal POSIX parameter-expansion string the installer must
    // NOT contain, not a mis-typed JS template literal.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting on a literal shell parameter-expansion string, not a JS template
    expect(sh).not.toContain('${ESHYRA_VERSION:-0.0.0}');
    expect(ps1).not.toMatch(/else\s*\{\s*'0\.0\.0'\s*\}/);
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

  it('POSIX installer fails closed when a published checksum cannot be verified', () => {
    const sh = readText('scripts/release/install.sh');

    // The verify_checksum function must hard-fail (die), not warn-and-continue,
    // when the archive has no entry in sha256sums.txt or no hashing tool exists.
    const verifyBody = sh.slice(
      sh.indexOf('verify_checksum() {'),
      sh.indexOf('# ---------- main'),
    );
    expect(verifyBody).toMatch(/die "no checksum entry/);
    expect(verifyBody).toMatch(
      /die "checksums are published .* no SHA-256 tool/s,
    );
    expect(verifyBody).toMatch(/die "SHA-256 mismatch/);
    // It must NOT silently skip on those conditions.
    expect(verifyBody).not.toMatch(/skipping['"]?\s*$/m);
    expect(verifyBody).not.toContain('return 0');
  });

  it('PowerShell installer fails closed when a published checksum cannot be verified', () => {
    const ps1 = readText('scripts/release/install.ps1');

    const verifyBody = ps1.slice(
      ps1.indexOf('function Confirm-EshyraChecksum'),
      ps1.indexOf('function Install-Eshyra'),
    );
    // Missing entry must throw, not warn-and-return.
    expect(verifyBody).toMatch(/throw "No checksum entry/);
    // Mismatch must throw.
    expect(verifyBody).toMatch(/throw "SHA-256 checksum mismatch/);
    expect(verifyBody).not.toMatch(/Write-Warning.*skipping verification/);
  });

  it('PowerShell installer only skips verification when checksums cannot be downloaded', () => {
    const ps1 = readText('scripts/release/install.ps1');

    // The "predates checksums / continue" warning must be tied to a failed
    // download, and verification (Confirm-EshyraChecksum) must run whenever the
    // file WAS downloaded — never swallowed in the download catch block.
    expect(ps1).toMatch(/predates published checksums/);
    expect(ps1).toMatch(/if \(\$checksumsDownloaded\)/);
  });

  it('installer scripts expose only a clearly test/dev checksum opt-out', () => {
    const sh = readText('scripts/release/install.sh');
    const ps1 = readText('scripts/release/install.ps1');

    // An explicit, clearly-named opt-out may exist for dev loops, but it must be
    // labeled test/dev only — never presented as a normal install path.
    expect(sh).toContain('ESHYRA_SKIP_CHECKSUM');
    expect(ps1).toContain('ESHYRA_SKIP_CHECKSUM');
    expect(sh).toMatch(/test\/dev only|test\/development/i);
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

  it('POSIX installer install_dir is derived from the artifact name, not template', () => {
    const sh = readText('scripts/release/install.sh');
    // The actual top-level directory inside the archive is named by the builder,
    // and may not match the tag version. The install path must come from the
    // archive filename (artifact_dir = ARCHIVE_NAME minus .tar.gz) rather than
    // a template constructed from tag + target.
    expect(sh).toMatch(/artifact_dir.*ARCHIVE_NAME|ARCHIVE_NAME.*artifact_dir/);
    expect(sh).toMatch(/install_dir.*artifact_dir/);
  });

  it('PowerShell installer install_dir is derived from the artifact name, not template', () => {
    const ps1 = readText('scripts/release/install.ps1');
    // Must use the actual asset name from the API response, not reconstruct it
    // from the tag version.
    expect(ps1).toMatch(/GetFileNameWithoutExtension|\.name\s*-like/);
    expect(ps1).toMatch(/artifactDir|artifact_dir/i);
    expect(ps1).toMatch(/installDir.*artifactDir|artifactDir.*install/i);
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

  it('docs install path matches actual script path (eshyra-<edition>-<version>-<target>)', () => {
    const install = readText('docs/install.md');
    const sh = readText('scripts/release/install.sh');

    // Docs must describe the full artifact subdirectory name, now including the
    // edition segment (ADR 0011), not just <version>.
    expect(install).toMatch(
      /eshyra-<edition>-<version>-<target>|eshyra-<edition>-<version>-linux-x64|eshyra-<edition>-<version>-windows-x64/,
    );

    // The script itself must derive install_dir from the artifact name (not template).
    expect(sh).toMatch(/artifact_dir/);
    expect(sh).toMatch(/install_dir.*artifact_dir/);
  });

  it('docs POSIX version-pinned example passes ESHYRA_VERSION to sh, not curl', () => {
    const install = readText('docs/install.md');

    // Correct: ESHYRA_VERSION appears after the pipe, before sh.
    // e.g. "curl ... | ESHYRA_VERSION=... sh"
    expect(install).toMatch(/curl.*\|\s*ESHYRA_VERSION=/);

    // Wrong: ESHYRA_VERSION before curl causes the env var to be passed to
    // curl, not to the piped sh process.
    expect(install).not.toMatch(/ESHYRA_VERSION=.*curl/);
  });

  it('docs PowerShell version-pinned example does not pass -Version to iex', () => {
    const install = readText('docs/install.md');

    // Wrong: "iex -Version ..." passes -Version to Invoke-Expression, not to
    // the downloaded script.
    expect(install).not.toMatch(/iex\s+-Version\b/);

    // Correct: use $env:ESHYRA_VERSION before the iex pipe.
    expect(install).toContain('$env:ESHYRA_VERSION');
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
