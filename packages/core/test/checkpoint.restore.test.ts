import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createCampaignRule,
  formatCampaignPosition,
  revokeCampaignRule,
  supersedeCampaignRule,
} from '../src/internal.js';
import { DoltRepo } from '../src/persistence/checkpoint/doltRepo.js';
import {
  canonicalize,
  serializeCampaign,
} from '../src/persistence/checkpoint/serialize.js';
import {
  CheckpointError,
  CheckpointStore,
} from '../src/persistence/checkpoint/store.js';
import { openDatabase } from '../src/persistence/db.js';
import { initSchema } from '../src/persistence/schema.js';

const doltOk = DoltRepo.available();
// Real Dolt subprocesses can exceed Vitest's 5s default under full-suite load.
const DOLT_TEST_TIMEOUT_MS = 30_000;

describe.skipIf(!doltOk)('CheckpointStore.restoreToNewWorkingCopy', () => {
  it(
    'round trips campaign-rule identities, ordering, provenance, statuses, and positions',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'lw-rules-rs-'));
      const src = join(root, 'live.db');
      const db = openDatabase(src);
      initSchema(db);
      const pos = (ordinal: number) => ({
        sessionId: 's1',
        turnId: `t${ordinal}`,
        ordinal,
      });
      const base = {
        campaignId: 'c1',
        ruleKind: 'house-rule' as const,
        origin: 'player-approved' as const,
        provenance: { kind: 'house-rule' as const, rationale: 'table' },
        temporalMode: { mode: 'prospective' as const },
        supersededBy: null,
        scope: 'combat',
        governingRecordKeys: ['record:one'],
        prose: 'Use the table ruling.',
      };
      createCampaignRule(db, {
        ...base,
        ruleIdentity: 'old',
        status: 'active',
        effectivePosition: pos(1),
      });
      supersedeCampaignRule(db, {
        campaignId: 'c1',
        ruleIdentity: 'old',
        successor: {
          ...base,
          ruleIdentity: 'new',
          status: 'active',
          effectivePosition: pos(3),
        },
      });
      createCampaignRule(db, {
        ...base,
        ruleIdentity: 'revoked',
        status: 'active',
        effectivePosition: pos(2),
      });
      revokeCampaignRule(db, {
        campaignId: 'c1',
        ruleIdentity: 'revoked',
        revokedPosition: pos(4),
      });
      const before = canonicalize(serializeCampaign(db));
      db.close();
      const store = new CheckpointStore(
        join(root, 'dolt'),
        join(root, '.beads'),
      );
      const id = store.checkpoint(src, 'campaign rules');
      const dest = join(root, 'restored.db');
      store.restoreToNewWorkingCopy(id, dest);
      const restored = openDatabase(dest);
      expect(canonicalize(serializeCampaign(restored))).toBe(before);
      expect(
        restored.prepare('SELECT COUNT(*) AS count FROM campaign_rule').get(),
      ).toEqual({
        count: 3,
      });
      expect(formatCampaignPosition(pos(3))).toMatch(/^cp1~/);
      restored.close();
    },
    DOLT_TEST_TIMEOUT_MS,
  );

  it(
    'restores a checkpoint into a new db identical to the source',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'lw-rs-'));
      const src = join(root, 'live.db');
      const db = openDatabase(src);
      db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
      db.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run('hp', '7');
      db.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run('gp', '42');
      const before = canonicalize(serializeCampaign(db));
      db.close();

      const store = new CheckpointStore(
        join(root, 'dolt'),
        join(root, '.beads'),
      );
      const id = store.checkpoint(src, 'cp1');

      const dest = join(root, 'restored.db');
      store.restoreToNewWorkingCopy(id, dest);

      const rdb = openDatabase(dest);
      const after = canonicalize(serializeCampaign(rdb));
      rdb.close();
      expect(after).toBe(before);
    },
    DOLT_TEST_TIMEOUT_MS,
  );

  it(
    'restores a snapshot whose tables have foreign keys',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'lw-rs-'));
      const src = join(root, 'live.db');
      const db = openDatabase(src);
      // 'child' sorts before 'parent', so the serializer emits child rows first;
      // the FK is satisfiable on restore only because FK checks are deferred to
      // commit, by which point the parent row exists.
      db.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY);');
      db.exec(
        'CREATE TABLE child (id INTEGER PRIMARY KEY, ' +
          'parent_id INTEGER NOT NULL REFERENCES parent(id));',
      );
      db.prepare('INSERT INTO parent(id) VALUES (1)').run();
      db.prepare('INSERT INTO child(id, parent_id) VALUES (10, 1)').run();
      db.close();

      const store = new CheckpointStore(
        join(root, 'dolt'),
        join(root, '.beads'),
      );
      const id = store.checkpoint(src, 'cp1');

      const dest = join(root, 'restored.db');
      store.restoreToNewWorkingCopy(id, dest);

      const rdb = openDatabase(dest);
      const child = rdb
        .prepare('SELECT parent_id FROM child WHERE id = 10')
        .get() as { parent_id: number } | undefined;
      rdb.close();
      expect(child?.parent_id).toBe(1);
    },
    DOLT_TEST_TIMEOUT_MS,
  );

  it(
    'round-trips text payloads with newlines, backslashes, and quotes',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'lw-rs-'));
      const src = join(root, 'live.db');
      const db = openDatabase(src);
      // A multi-line CREATE statement plus a value carrying the characters a
      // naive SQL-literal escape corrupts — backslash, newline, tab, and both
      // quote kinds. Regression cover: dolt string literals process backslash
      // escapes, so an unescaped `\n` in a payload silently became a real
      // newline and broke restore.
      db.exec(
        'CREATE TABLE lore (\n  id TEXT PRIMARY KEY,\n  body TEXT NOT NULL\n);',
      );
      const tricky = 'line one\nline two\ttab \\backslash\\ \'quote\' "dquote"';
      db.prepare('INSERT INTO lore(id, body) VALUES (?, ?)').run('l1', tricky);
      db.close();

      const store = new CheckpointStore(
        join(root, 'dolt'),
        join(root, '.beads'),
      );
      const id = store.checkpoint(src, 'cp1');

      const dest = join(root, 'restored.db');
      store.restoreToNewWorkingCopy(id, dest);

      const rdb = openDatabase(dest);
      const row = rdb.prepare('SELECT body FROM lore WHERE id = ?').get('l1') as
        | { body: string }
        | undefined;
      rdb.close();
      expect(row?.body).toBe(tricky);
    },
    DOLT_TEST_TIMEOUT_MS,
  );

  it(
    'refuses to restore onto an existing destination',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'lw-rs-'));
      const src = join(root, 'live.db');
      const db = openDatabase(src);
      db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
      db.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run('hp', '7');
      db.close();

      const store = new CheckpointStore(
        join(root, 'dolt'),
        join(root, '.beads'),
      );
      const id = store.checkpoint(src, 'cp1');

      // A pre-existing file at the destination must not be clobbered.
      const dest = join(root, 'occupied.db');
      writeFileSync(dest, 'EXISTING CAMPAIGN');
      expect(() => store.restoreToNewWorkingCopy(id, dest)).toThrow(
        CheckpointError,
      );
      expect(readFileSync(dest, 'utf8')).toBe('EXISTING CAMPAIGN');
    },
    DOLT_TEST_TIMEOUT_MS,
  );

  it(
    'leaves no database at the destination when a restore fails',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'lw-rs-'));
      const src = join(root, 'live.db');
      const db = openDatabase(src);
      db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
      db.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run('hp', '7');
      db.close();

      const store = new CheckpointStore(
        join(root, 'dolt'),
        join(root, '.beads'),
      );
      const id = store.checkpoint(src, 'cp1');

      // Destination directory does not exist: materialization fails. The temp
      // file is cleaned up and no partial database is left at the destination.
      const dest = join(root, 'missing-dir', 'restored.db');
      expect(() => store.restoreToNewWorkingCopy(id, dest)).toThrow();
      expect(existsSync(dest)).toBe(false);
    },
    DOLT_TEST_TIMEOUT_MS,
  );
});
