import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DOLT_REF = 'refs/dolt/data';
export const PROJECTION_REF = 'refs/beads/state';

const runProcess = (command, args, options = {}) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0)
        reject(
          new Error(
            `${command} ${args.join(' ')} failed (${code}): ${stderr.trim()}`,
          ),
        );
      else resolvePromise({ stdout, stderr });
    });
  });

export function parseExport(raw) {
  const records = [];
  const ids = new Set();
  for (const [lineNumber, line] of raw.split('\n').entries()) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `Malformed Beads export JSON on line ${lineNumber + 1}: ${error.message}`,
      );
    }
    if (
      !record ||
      typeof record !== 'object' ||
      Array.isArray(record) ||
      typeof record.id !== 'string' ||
      !record.id
    ) {
      throw new Error(
        `Beads export line ${lineNumber + 1} is not an issue record with an id`,
      );
    }
    if (ids.has(record.id))
      throw new Error(`Duplicate Bead id in export: ${record.id}`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(record.id))
      throw new Error(`Unsafe Bead id: ${record.id}`);
    ids.add(record.id);
    records.push(record);
  }
  if (!records.length)
    throw new Error('Beads export contained no issue records');
  return records;
}

const secretPatterns = [
  {
    name: 'private key block',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9_-]{20,}\b/ },
  {
    name: 'API key',
    pattern:
      /\b(?:sk|rk|pk)_(?:live|test)?[_-]?[A-Za-z0-9]{16,}\b|\b(?:anthropic|openai)[_-]?(?:api[_-]?)?key\s*[:=]\s*["']?[A-Za-z0-9_-]{16,}/i,
  },
  { name: 'credential URL', pattern: /https?:\/\/[^\s/@:]+:[^\s/@]+@/i },
  {
    name: 'password assignment',
    pattern:
      /\b(?:password|passwd|secret|auth[_-]?token)\s*[:=]\s*["']?[^\s"']{8,}/i,
  },
];

function findSecret(value, path = '') {
  if (typeof value === 'string') {
    for (const { name, pattern } of secretPatterns)
      if (pattern.test(value)) return { path, name };
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const found = findSecret(child, path ? `${path}.${key}` : key);
      if (found) return found;
    }
  }
  return undefined;
}

export function scanForSecrets(records) {
  const findings = [];
  for (const record of records) {
    const finding = findSecret(record);
    if (finding) findings.push({ id: record.id, ...finding });
  }
  if (findings.length)
    throw new Error(
      `Credential material detected in Beads export: ${findings.map(({ id, path, name }) => `${id} (${path}: ${name})`).join(', ')}`,
    );
}

function navRecord(record) {
  const fields = [
    'id',
    'title',
    'status',
    'priority',
    'issue_type',
    'type',
    'labels',
    'dependencies',
    'parent',
    'parent_id',
    'metadata',
    'close_reason',
    'closed_at',
    'assignee',
    'owner',
    'created_at',
    'updated_at',
  ];
  return Object.fromEntries(
    fields
      .filter((field) => Object.hasOwn(record, field))
      .map((field) => [field, record[field]]),
  );
}

export function createProjection(
  records,
  {
    doltSha,
    repository,
    beadsVersion,
    rawExport,
    generatedAtUtc = new Date().toISOString(),
  },
) {
  const lines =
    rawExport ??
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
  const indexRecords = records.map(navRecord);
  const index = {
    schemaVersion: 1,
    generatedFrom: 'issues.jsonl',
    issues: indexRecords,
    openIds: records.filter((r) => r.status === 'open').map((r) => r.id),
    inProgressIds: records
      .filter((r) => r.status === 'in_progress')
      .map((r) => r.id),
    closedIds: records.filter((r) => r.status === 'closed').map((r) => r.id),
  };
  const metadata = {
    projectionSchemaVersion: 1,
    generatedAtUtc,
    repository,
    sourceRef: DOLT_REF,
    sourceDoltGitSha: doltSha,
    projectionRef: PROJECTION_REF,
    beadsVersion,
    exportMechanism:
      'bd export (JSONL; regular issue records, including labels, dependencies, and comments)',
    exportedBeadCount: records.length,
    rawExportSha256: createHash('sha256').update(lines).digest('hex'),
  };
  const readme = `# Beads state projection\n\nThis ref is a generated, disposable read-only projection. Never edit or merge it; it is not a Git branch.\n\nBeads/Dolt remains authoritative. ${DOLT_REF} is the canonical remote database transport; ordinary Beads history lives in Dolt, not here. ${PROJECTION_REF} exists only to make the current state readable. The exact source Dolt Git SHA is recorded in metadata.json.\n\nConsumers should resolve ${PROJECTION_REF} to its commit SHA and read files from that commit. Never reconstruct Beads state from this projection and write it back.\n`;
  const files = {
    'README.md': readme,
    'metadata.json': `${JSON.stringify(metadata, null, 2)}\n`,
    'issues.jsonl': lines,
    'index.json': `${JSON.stringify(index, null, 2)}\n`,
  };
  for (const record of records)
    files[`beads/${record.id}.json`] = `${JSON.stringify(record, null, 2)}\n`;
  return { files, metadata, index };
}

export async function buildSnapshot({
  files,
  git = 'git',
  repoDir = process.cwd(),
  generatedAtUtc = new Date().toISOString(),
}) {
  const tempIndexDir = await mkdtemp(join(tmpdir(), 'eshyra-beads-index-'));
  const indexPath = join(tempIndexDir, 'index');
  const env = { ...process.env, GIT_INDEX_FILE: indexPath };
  try {
    await runProcess(git, ['read-tree', '--empty'], { cwd: repoDir, env });
    const entries = [];
    for (const [path, content] of Object.entries(files)) {
      if (
        path !== 'README.md' &&
        path !== 'metadata.json' &&
        path !== 'issues.jsonl' &&
        path !== 'index.json' &&
        !path.startsWith('beads/')
      )
        throw new Error(`Unexpected projection path: ${path}`);
      const hash = await new Promise((resolvePromise, reject) => {
        const child = spawn(git, ['hash-object', '-w', '--stdin'], {
          cwd: repoDir,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
          stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
          stderr += chunk;
        });
        child.on('error', reject);
        child.on('close', (code) =>
          code === 0
            ? resolvePromise(stdout.trim())
            : reject(new Error(stderr.trim())),
        );
        child.stdin.end(content);
      });
      await runProcess(
        git,
        ['update-index', '--add', '--cacheinfo', `100644,${hash},${path}`],
        { cwd: repoDir, env },
      );
      entries.push(path);
    }
    const { stdout: tree } = await runProcess(git, ['write-tree'], {
      cwd: repoDir,
      env,
    });
    const { stdout: commit } = await runProcess(
      git,
      [
        'commit-tree',
        tree.trim(),
        '-m',
        `Update readable Beads state (${generatedAtUtc})`,
      ],
      {
        cwd: repoDir,
        env: {
          ...env,
          GIT_AUTHOR_NAME: 'Eshyra Beads Projection',
          GIT_AUTHOR_EMAIL: 'beads-projection@localhost',
          GIT_COMMITTER_NAME: 'Eshyra Beads Projection',
          GIT_COMMITTER_EMAIL: 'beads-projection@localhost',
        },
      },
    );
    return { commit: commit.trim(), tree: tree.trim(), paths: entries.sort() };
  } finally {
    await rm(tempIndexDir, { recursive: true, force: true });
  }
}

export async function publishProjection({
  dryRun = false,
  repoDir = process.cwd(),
  remote = 'origin',
  run = runProcess,
  build = buildSnapshot,
} = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'eshyra-beads-sync-'));
  try {
    if (!dryRun) await run('bd', ['dolt', 'push'], { cwd: repoDir });
    const resolveDolt = async () =>
      (
        await run('git', ['ls-remote', remote, DOLT_REF], { cwd: repoDir })
      ).stdout
        .trim()
        .split(/\s+/)[0] || undefined;
    const doltSha = await resolveDolt();
    if (!doltSha) throw new Error(`Remote does not expose ${DOLT_REF}`);
    const exportPath = join(tempDir, 'issues.jsonl');
    await run('bd', ['export', '-o', exportPath], { cwd: repoDir });
    const raw = await readFile(exportPath, 'utf8');
    const records = parseExport(raw);
    scanForSecrets(records);
    const remoteUrl = (
      await run('git', ['config', '--get', `remote.${remote}.url`], {
        cwd: repoDir,
      })
    ).stdout.trim();
    const repository = remoteUrl
      .replace(/^git@github.com:/, 'https://github.com/')
      .replace(/^git\+/, '')
      .replace(/\.git$/, '');
    const beadsVersion = (
      await run('bd', ['--version'], { cwd: repoDir })
    ).stdout.trim();
    const projection = createProjection(records, {
      doltSha,
      repository,
      beadsVersion,
      rawExport: raw,
    });
    const snapshot = await build({
      files: projection.files,
      repoDir,
      generatedAtUtc: projection.metadata.generatedAtUtc,
    });
    const beforePublishDoltSha = await resolveDolt();
    if (beforePublishDoltSha !== doltSha)
      throw new Error(
        `Canonical ${DOLT_REF} changed during snapshot generation (${doltSha} -> ${beforePublishDoltSha})`,
      );
    if (!dryRun) {
      await run(
        'git',
        ['push', remote, `${snapshot.commit}:${PROJECTION_REF}`, '--force'],
        { cwd: repoDir },
      );
      const published = (
        await run('git', ['ls-remote', remote, PROJECTION_REF], {
          cwd: repoDir,
        })
      ).stdout
        .trim()
        .split(/\s+/)[0];
      if (published !== snapshot.commit)
        throw new Error(
          `Remote ${PROJECTION_REF} verification failed (${published || 'missing'})`,
        );
    }
    return {
      doltSha,
      projectionSha: snapshot.commit,
      count: records.length,
      dryRun,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  publishProjection({ dryRun: process.argv.includes('--dry-run') })
    .then((result) =>
      console.log(
        `${result.dryRun ? 'Would publish' : 'Published'} ${result.count} Beads; ${DOLT_REF}=${result.doltSha}; ${PROJECTION_REF}=${result.projectionSha}`,
      ),
    )
    .catch((error) => {
      console.error(`beads:sync failed: ${error.message}`);
      process.exitCode = 1;
    });
}
