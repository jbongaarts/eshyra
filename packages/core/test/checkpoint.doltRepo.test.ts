import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  managedDoltRoot,
  resolveDoltBinary,
} from '../src/persistence/checkpoint/doltBinary.js';
import { DoltRepo } from '../src/persistence/checkpoint/doltRepo.js';
import type { SnapshotRecord } from '../src/persistence/checkpoint/serialize.js';

const doltOk = DoltRepo.available();
// Real Dolt subprocesses can exceed Vitest's 5s default under full-suite load.
const DOLT_TEST_TIMEOUT_MS = 30_000;
const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'lw-dolt-'));
  dirs.push(d);
  return d;
}
afterAll(() => {
  /* temp dirs are OS-cleaned; explicit rm omitted for cross-platform safety */
});

const SNAP: SnapshotRecord[] = [
  {
    table: 'meta',
    kind: 'schema',
    ordinal: 0,
    payload: JSON.stringify({
      create: 'CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
    }),
  },
  {
    table: 'meta',
    kind: 'row',
    ordinal: 0,
    payload: JSON.stringify({ key: 'a', value: '1' }),
  },
];

// Regression guard for loreweaver-l6n: dolt invocations must run against an
// isolated, Eshyra-owned global home with telemetry disabled, so they never
// read or pollute the user's ~/.dolt. We pin the binary explicitly and point
// ESHYRA_DOLT_HOME at a temp dir so managedDoltRoot() resolves into temp.
describe.skipIf(!doltOk)('DoltRepo telemetry isolation', () => {
  it(
    'runs in an isolated root with metrics disabled and no event backlog',
    () => {
      const bin = resolveDoltBinary();
      const home = mkdtempSync(join(tmpdir(), 'lw-isohome-'));
      const prevHome = process.env.ESHYRA_DOLT_HOME;
      const prevBin = process.env.ESHYRA_DOLT_BIN;
      process.env.ESHYRA_DOLT_HOME = home;
      process.env.ESHYRA_DOLT_BIN = bin;
      try {
        const repo = new DoltRepo(join(tmp(), 'dolt'));
        repo.init();
        repo.applySnapshot(SNAP);
        expect(repo.commit('checkpoint: iso')).toMatch(/\S+/);

        const root = managedDoltRoot();
        expect(root.startsWith(home)).toBe(true);

        // metrics disabled in the ISOLATED home (never the user's ~/.dolt)
        const cfg = join(root, '.dolt', 'config_global.json');
        expect(existsSync(cfg)).toBe(true);
        expect(readFileSync(cfg, 'utf8')).toContain('metrics.disabled');

        // no telemetry backlog accumulates, even in the isolated home
        const eventsDir = join(root, '.dolt', 'eventsData');
        const events = existsSync(eventsDir)
          ? readdirSync(eventsDir).filter((f) => f.endsWith('.devts'))
          : [];
        expect(events).toHaveLength(0);
      } finally {
        if (prevHome === undefined) delete process.env.ESHYRA_DOLT_HOME;
        else process.env.ESHYRA_DOLT_HOME = prevHome;
        if (prevBin === undefined) delete process.env.ESHYRA_DOLT_BIN;
        else process.env.ESHYRA_DOLT_BIN = prevBin;
      }
    },
    DOLT_TEST_TIMEOUT_MS,
  );
});
