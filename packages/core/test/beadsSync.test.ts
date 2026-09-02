import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  buildSnapshot,
  createProjection,
  DOLT_REF,
  PROJECTION_REF,
  parseExport,
  publishProjection,
  scanForSecrets,
} from '../../../scripts/beads-sync.mjs';

const exec = promisify(execFile);
const record = (id: string, extra: Record<string, unknown> = {}) => ({
  _type: 'issue',
  id,
  title: `Task ${id}`,
  description: 'full description',
  status: 'open',
  priority: 2,
  issue_type: 'task',
  labels: ['one'],
  dependencies: [],
  comments: [],
  ...extra,
});

describe('Beads readable projection', () => {
  it('preserves complete records, navigation, and source metadata', () => {
    const records = [
      record('eshyra-a1', { status: 'closed', close_reason: 'done' }),
      record('eshyra-b2', {
        status: 'in_progress',
        dependencies: [
          { issue_id: 'eshyra-b2', depends_on_id: 'eshyra-a1', type: 'blocks' },
        ],
        notes: 'keep me',
      }),
    ];
    const rawExport = `${records.map((item) => JSON.stringify(item)).join('\n')}\n`;
    const projection = createProjection(records, {
      doltSha: 'dolt-sha',
      repository: 'https://github.com/example/repo',
      beadsVersion: 'bd version 1.1.0',
      rawExport,
      generatedAtUtc: '2026-01-01T00:00:00.000Z',
    });
    expect(JSON.parse(projection.files['beads/eshyra-b2.json'])).toEqual(
      records[1],
    );
    expect(projection.index.issues[1].dependencies).toEqual(
      records[1].dependencies,
    );
    expect(projection.index.openIds).toEqual([]);
    expect(projection.index.closedIds).toEqual(['eshyra-a1']);
    expect(projection.index.inProgressIds).toEqual(['eshyra-b2']);
    expect(projection.metadata).toMatchObject({
      sourceRef: DOLT_REF,
      sourceDoltGitSha: 'dolt-sha',
      projectionRef: PROJECTION_REF,
      exportedBeadCount: 2,
    });
    expect(projection.metadata.rawExportSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(projection.files['issues.jsonl']).toBe(rawExport);
  });

  it('rejects malformed, duplicate, unsafe, and secret-bearing exports without echoing values', () => {
    expect(() => parseExport('{"id":"x"}\nnot json')).toThrow(/Malformed/);
    expect(() => parseExport('{"id":"x"}\n{"id":"x"}')).toThrow(/Duplicate/);
    expect(() => parseExport('{"id":"../escape"}')).toThrow(/Unsafe/);
    const secret = 'ghp_123456789012345678901234567890';
    expect(() =>
      scanForSecrets([record('eshyra-secret', { notes: secret })]),
    ).toThrow(/eshyra-secret/);
    try {
      scanForSecrets([record('eshyra-secret', { notes: secret })]);
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it('creates parentless root commits with only projection files and preserves worktree/index', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eshyra-beads-git-test-'));
    try {
      await exec('git', ['init', '-q', '-b', 'main'], { cwd: dir });
      await exec('git', ['config', 'user.name', 'Test'], { cwd: dir });
      await exec('git', ['config', 'user.email', 'test@example.com'], {
        cwd: dir,
      });
      await exec('git', ['commit', '--allow-empty', '-qm', 'base'], {
        cwd: dir,
      });
      const beforeIndex = (
        await exec('git', ['write-tree'], { cwd: dir })
      ).stdout.trim();
      const projection = createProjection([record('eshyra-z9')], {
        doltSha: 'sha',
        repository: 'repo',
        beadsVersion: 'bd 1',
      });
      const first = await buildSnapshot({
        files: projection.files,
        repoDir: dir,
      });
      const second = await buildSnapshot({
        files: projection.files,
        repoDir: dir,
      });
      expect(
        (
          await exec('git', ['rev-list', '--parents', first.commit], {
            cwd: dir,
          })
        ).stdout.trim(),
      ).toBe(first.commit);
      expect(
        (
          await exec('git', ['ls-tree', '-r', '--name-only', first.commit], {
            cwd: dir,
          })
        ).stdout
          .trim()
          .split('\n')
          .sort(),
      ).toEqual(first.paths);
      expect(second.commit).not.toBe(first.commit);
      expect(
        (
          await exec('git', ['rev-list', '--parents', second.commit], {
            cwd: dir,
          })
        ).stdout.trim(),
      ).toBe(second.commit);
      expect(
        (await exec('git', ['write-tree'], { cwd: dir })).stdout.trim(),
      ).toBe(beforeIndex);
      expect(
        (await exec('git', ['status', '--porcelain'], { cwd: dir })).stdout,
      ).toBe('');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps the dry run from publishing and uses the fixed projection target in source', async () => {
    const source = await readFile('scripts/beads-sync.mjs', 'utf8');
    expect(source).toContain(
      `snapshot.commit}:${String.fromCharCode(36)}{PROJECTION_REF}`,
    );
    expect(source).not.toContain('process.argv[2]');
  });

  it('force-updates exactly the projection ref and fails closed on Dolt push or race errors', async () => {
    const calls: string[][] = [];
    const run = async (command: string, args: string[]) => {
      calls.push([command, ...args]);
      if (command === 'bd' && args[0] === 'dolt') return { stdout: '' };
      if (command === 'git' && args[0] === 'ls-remote') {
        return {
          stdout: `${args.at(-1) === PROJECTION_REF ? 'candidate-sha' : 'dolt-sha'}\t${args.at(-1)}\n`,
        };
      }
      if (command === 'bd' && args[0] === 'export') {
        await (await import('node:fs/promises')).writeFile(
          args[args.indexOf('-o') + 1],
          `${JSON.stringify(record('eshyra-a1'))}\n`,
        );
      }
      if (command === 'git' && args[0] === 'config')
        return { stdout: 'https://github.com/example/repo.git\n' };
      if (command === 'bd' && args[0] === '--version')
        return { stdout: 'bd version 1.1.0\n' };
      return { stdout: '' };
    };
    await publishProjection({
      run,
      build: async () => ({ commit: 'candidate-sha' }),
      repoDir: '.',
    });
    expect(
      calls.find((call) => call[0] === 'git' && call[1] === 'push'),
    ).toEqual([
      'git',
      'push',
      'origin',
      `candidate-sha:${PROJECTION_REF}`,
      '--force',
    ]);
    expect(calls.some((call) => call.includes('refs/heads/main'))).toBe(false);

    const racedCalls: string[][] = [];
    const racedRun = async (command: string, args: string[]) => {
      racedCalls.push([command, ...args]);
      if (command === 'git' && args[0] === 'ls-remote')
        return {
          stdout: `${racedCalls.filter((call) => call[1] === 'ls-remote').length === 1 ? 'one' : 'two'}\t${args.at(-1)}\n`,
        };
      if (command === 'bd' && args[0] === 'export')
        await (await import('node:fs/promises')).writeFile(
          args[args.indexOf('-o') + 1],
          `${JSON.stringify(record('eshyra-a1'))}\n`,
        );
      if (command === 'git' && args[0] === 'config')
        return { stdout: 'repo\n' };
      if (command === 'bd' && args[0] === '--version')
        return { stdout: 'bd 1\n' };
      return { stdout: '' };
    };
    await expect(
      publishProjection({
        run: racedRun,
        build: async () => ({ commit: 'candidate-sha' }),
        repoDir: '.',
      }),
    ).rejects.toThrow(/changed during export/);
    expect(racedCalls.some((call) => call[1] === 'push')).toBe(false);

    const failedRun = async (command: string, args: string[]) => {
      if (command === 'bd' && args[0] === 'dolt')
        throw new Error('push failed');
      return { stdout: '' };
    };
    await expect(
      publishProjection({
        run: failedRun,
        build: async () => ({ commit: 'candidate-sha' }),
        repoDir: '.',
      }),
    ).rejects.toThrow(/push failed/);
  });
});
