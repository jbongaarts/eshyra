import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  engines?: { node?: string };
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface BiomeJson {
  vcs?: {
    enabled?: boolean;
    clientKind?: string;
    useIgnoreFile?: boolean;
  };
  files?: {
    includes?: string[];
  };
}

function readText(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function readJson<T>(path: string): T {
  return JSON.parse(readText(path)) as T;
}

function readPackageJson(path: string): PackageJson {
  return readJson<PackageJson>(path);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expectDependabotMajorIgnore(dependabot: string, dependency: string) {
  expect(dependabot).toMatch(
    new RegExp(
      `dependency-name:\\s*["']${escapeRegExp(
        dependency,
      )}["'][\\s\\S]*?update-types:\\s*\\r?\\n\\s*-\\s*["']version-update:semver-major["']`,
    ),
  );
}

describe('Node runtime policy', () => {
  it('supports Node 24 with a matching native SQLite dependency line', () => {
    const root = readPackageJson('package.json');
    const core = readPackageJson('packages/core/package.json');
    const cli = readPackageJson('packages/cli/package.json');

    expect(root.engines?.node).toBe('>=24 <25');
    expect(core.engines?.node).toBe('>=24 <25');
    expect(cli.engines?.node).toBe('>=24 <25');
    expect(core.dependencies?.['better-sqlite3']).toMatch(/^\^12\./);
    expect(root.devDependencies?.['@types/node']).toMatch(/^\^24\./);
  });

  it('keeps CI on Node 24 with cross-platform install smoke coverage', () => {
    const ci = readText('.github/workflows/ci.yml');

    expect(ci).toMatch(/node-version:\s*24/);
    expect(ci).not.toMatch(/node-version:\s*22|Node 22|better-sqlite3 11/);
    expect(ci).toContain('install-smoke:');
    expect(ci).toMatch(
      /os:\s*\[ubuntu-latest,\s*windows-latest,\s*macos-latest\]/,
    );
    expect(ci).toContain('npm ci --foreground-scripts');
    expect(ci).toContain('npm run smoke:cli-install');
    expect(ci).toContain('gyp info');
    expect(ci).toContain('CXX\\(target\\)');
    expect(ci).toContain('prebuild-install WARN install');
    expect(ci).toContain('node-gyp rebuild');
  });

  it('documents the same Node 24 dependency policy for agents', () => {
    const agents = readText('AGENTS.md');

    expect(agents).toContain('Node 24 LTS');
    expect(agents).toContain('`>=24 <25`');
    expect(agents).toContain('`better-sqlite3` 12.x');
    expect(agents).toContain('`@types/node`');
    expect(agents).toMatch(/Linux,\s+Windows, and macOS/);
    expect(agents).toMatch(/source-build fallback.*regression/i);
    expect(agents).not.toMatch(/Node 22|11\.x/);
  });

  it('makes Biome 2 respect gitignored local and generated artifacts', () => {
    const biome = readJson<BiomeJson>('biome.json');
    const gitignore = readText('.gitignore');

    expect(biome.vcs).toEqual({
      enabled: true,
      clientKind: 'git',
      useIgnoreFile: true,
    });
    expect(biome.files?.includes ?? []).toEqual(
      expect.arrayContaining([
        '**',
        '!**/node_modules',
        '!**/dist',
        '!**/coverage',
        '!**/.beads',
        '!**/package-lock.json',
        // Generated SRD rules-packs (large, machine-emitted JSON) are an
        // intentional, explicit exclusion so Biome never reformats them.
        '!**/packages/core/data',
      ]),
    );
    // Linked worktrees must stay ignored from the parent checkout through
    // .gitignore/VCS ignore. Do not add a Biome glob like !**/.worktrees here:
    // it also matches the active linked worktree's own root path.
    expect(biome.files?.includes ?? []).not.toContain('!**/.worktrees');
    expect(gitignore).toContain('.dolt/');
    expect(gitignore).toContain('.worktrees/');
    expect(gitignore).toContain('*.db');
    expect(gitignore).toContain('.env');
    expect(gitignore).toContain('.claude/settings.local.json');
    expect(gitignore).toContain(
      'packages/core/scripts/importers/*/.generated/',
    );
    // Vendored licensed source PDFs (e.g. SRD 5.1 under CC-BY-4.0) ARE committed
    // per ADR 0007 / loreweaver-60z so the importer + audit tooling run against
    // a pinned authoritative source on every clone and in CI; only non-PDF
    // scratch artifacts (extracted text, local caches) stay ignored.
    expect(gitignore).not.toMatch(/^packages\/core\/sources\/\*\/\*\.pdf$/m);
    expect(gitignore).toContain('packages/core/sources/*/*.txt');
    expect(gitignore).toContain('packages/core/sources/*/*.html');
    expect(gitignore).toContain('packages/core/sources/*/.cache/');
  });

  it('runs Biome across the whole repo without omitting tracked root files', () => {
    const root = readPackageJson('package.json');
    const scripts = root.scripts ?? {};

    // Root files that live outside docs/packages/scripts/.github and must not
    // be silently dropped from Biome coverage by a narrowed allowlist.
    const requiredRootFiles = [
      'AGENTS.md',
      'CLAUDE.md',
      'README.md',
      'biome.json',
      'package.json',
      'tsconfig.base.json',
      'tsconfig.json',
      'vitest.config.ts',
    ];

    for (const name of ['format', 'format:check', 'lint', 'check']) {
      const command = scripts[name];
      expect(command, `expected a "${name}" script`).toBeDefined();
      expect(command).toContain('biome');

      // A script may chain other gates around Biome with `&&` (e.g. `check`
      // also runs the hidden-Unicode scan); only the Biome segment's path
      // arguments are relevant to this whole-repo-coverage policy.
      const biomeSegment =
        (command as string)
          .split('&&')
          .map((segment) => segment.trim())
          .find((segment) => segment.includes('biome')) ?? (command as string);

      // Path arguments are the tokens that follow the biome subcommand/flags.
      const paths = biomeSegment
        .split(/\s+/)
        .filter(
          (token) =>
            token !== '' &&
            token !== 'biome' &&
            token !== 'format' &&
            token !== 'check' &&
            token !== 'lint' &&
            token !== 'ci' &&
            !token.startsWith('-'),
        );

      if (paths.includes('.')) {
        // Whole-repo form: rely on biome.json/.gitignore exclusions, and do
        // not also carry a narrowing allowlist that could omit root files.
        expect(paths).toEqual(['.']);
      } else {
        // Explicit allowlist is only acceptable if it still covers every
        // tracked root file the whole-repo form would otherwise pick up.
        for (const file of requiredRootFiles) {
          expect(
            paths,
            `"${name}" must cover ${file} (or pass "." for the whole repo)`,
          ).toContain(file);
        }
      }
    }
  });

  it('documents the linked-worktree verification workflow for agents', () => {
    const agents = readText('AGENTS.md');

    expect(agents).toContain('scripts/agent-preflight-main.mjs');
    expect(agents).toContain('scripts/verify-current-worktree.mjs');
    expect(agents).toContain('Fetch `origin/main`');
    expect(agents).toMatch(
      /Do not run full\s+verification from the parent checkout/,
    );
    expect(agents).toContain('cd "$(git rev-parse --show-toplevel)"');
    expect(agents).toContain(
      'If Biome says no relevant files were checked because `.worktrees` is ignored',
    );
    expect(agents).toMatch(/do not delete or recreate the\s+worktree/);
    expect(agents).toContain('`npm run format` (`biome check --write .`)');
    expect(agents).not.toContain('temporary worktree-local Biome config');
  });

  it('provides simple Node helpers for agent worktree workflow', () => {
    const root = readPackageJson('package.json');
    const scripts = root.scripts ?? {};

    expect(scripts['agent:preflight']).toBe(
      'node scripts/agent-preflight-main.mjs',
    );
    expect(scripts['verify:worktree']).toBe(
      'node scripts/verify-current-worktree.mjs',
    );
    expect(scripts['verify:worktree:sandbox']).toBe(
      'node scripts/verify-current-worktree.mjs --sandbox',
    );
    expect(scripts.format).toBe('biome check --write .');
    // CI fails on any Biome diagnostic, not just errors: the read-only Biome
    // scripts pass --error-on-warnings so a warning is as blocking as an error.
    expect(scripts['format:check']).toBe('biome check --error-on-warnings .');
    expect(scripts.lint).toBe('biome lint --error-on-warnings .');
    expect(scripts.check).toBe(
      'npm run check:hidden-unicode && biome ci --error-on-warnings .',
    );

    const preflight = readText('scripts/agent-preflight-main.mjs');
    expect(preflight).toContain(
      "checkedNative('git', ['fetch', 'origin', 'main'])",
    );
    expect(preflight).not.toContain('npm run check');
    expect(preflight).not.toContain('npm run test');
    expect(preflight).not.toContain('npm run build');

    const verify = readText('scripts/verify-current-worktree.mjs');
    expect(verify).toContain("['rev-parse', '--show-toplevel']");
    expect(verify).toContain('cwd: repoRoot');
    expect(verify).toContain("process.argv.includes('--sandbox')");
    expect(verify).toContain('ESHYRA_TEST_SANDBOX');
    expect(verify).not.toContain('BIOME_CONFIG_PATH');
    expect(verify).not.toContain('.biome-worktree-');
    expect(verify).not.toContain('New-WorktreeBiomeConfig');
    for (const script of ['format', 'check', 'typecheck', 'test']) {
      expect(verify).toContain(`'${script}'`);
    }
    expect(verify).not.toContain('bd preflight --check');
  });

  it('requires manual review for major runtime and toolchain updates', () => {
    const dependabot = readText('.github/dependabot.yml');

    for (const dependency of [
      'better-sqlite3',
      '@types/node',
      '@biomejs/biome',
      'typescript',
    ]) {
      expectDependabotMajorIgnore(dependabot, dependency);
    }
  });

  it('isolates PDF tooling so pdfjs-dist majors require a dedicated migration', () => {
    const dependabot = readText('.github/dependabot.yml');

    // pdfjs-dist (extraction runtime) and pdfkit (generation) are grouped
    // separately so a risky pdfjs-dist major can't ride along with routine
    // pdfkit / @types/pdfkit updates in one PR.
    expect(dependabot).toMatch(/^\s+pdf-extraction-tooling:/m);
    expect(dependabot).toMatch(/^\s+pdf-generation-tooling:/m);
    expect(dependabot).not.toContain('document-import-tooling');

    // Their majors are ignored; PDF.js major migrations are intentional work,
    // not routine dependency PRs.
    for (const dependency of ['pdfjs-dist', 'pdfkit']) {
      expectDependabotMajorIgnore(dependabot, dependency);
    }
  });
});
