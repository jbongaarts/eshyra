import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DoltCli } from '../src/persistence/checkpoint/doltCli.js';
import { DoltRepo } from '../src/persistence/checkpoint/doltRepo.js';
import { serializeCampaign } from '../src/persistence/checkpoint/serialize.js';
import { materializeSnapshot } from '../src/persistence/checkpoint/store.js';
import { type Db, openDatabase } from '../src/persistence/db.js';
import { initSchema } from '../src/persistence/schema.js';

function objects(db: Db) {
  return db
    .prepare(
      'SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name',
    )
    .all();
}

describe('checkpoint semantic schema integrity', () => {
  it('preserves enforcement, views and side-effect triggers through the Dolt payload reader and materialization', () => {
    const dir = mkdtempSync(join(tmpdir(), 'checkpoint-schema-'));
    const db = openDatabase(':memory:');
    try {
      initSchema(db);
      // A migration-grandfathered oversized row must survive without replaying
      // guards or side effects, while the guards apply to subsequent writes.
      const guard = db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE name='inventory_identity_insert_guard'",
        )
        .get() as { sql: string };
      db.exec('DROP TRIGGER inventory_identity_insert_guard');
      db.prepare(
        "INSERT INTO inventory(id,name,quantity,provenance,session_id,updated_at) VALUES (?, 'legacy', 1, 'test','s','at')",
      ).run('x'.repeat(257));
      db.exec(guard.sql);
      db.exec(`CREATE TABLE sqliteish (id TEXT);
        CREATE TABLE z_parent (id TEXT);
        CREATE UNIQUE INDEX parent_key ON z_parent(id);
        CREATE TABLE a_child (parent TEXT REFERENCES z_parent(id));
        INSERT INTO z_parent VALUES ('p');
        INSERT INTO a_child VALUES ('p');
        CREATE TABLE audit (value TEXT);
        CREATE TRIGGER audit_inventory AFTER INSERT ON inventory BEGIN INSERT INTO audit VALUES (NEW.id); END;
        CREATE VIEW inventory_names AS SELECT name FROM inventory;
        CREATE TRIGGER rename_inventory INSTEAD OF UPDATE ON inventory_names BEGIN UPDATE inventory SET name=NEW.name WHERE name=OLD.name; END;`);
      db.prepare(
        "INSERT INTO inventory(id,name,quantity,provenance,session_id,updated_at) VALUES ('valid','Current',1,'test','s','at')",
      ).run();
      const records = serializeCampaign(db);
      // The actual Dolt reader must retain the versioned metadata inside payload
      // even though SQL returns records in a different order than serialization.
      const cli = new DoltCli(join(dir, 'dolt'));
      vi.spyOn(cli, 'run').mockReturnValue(
        JSON.stringify({
          rows: [...records].reverse().map((r) => ({
            tbl: r.table,
            kind: r.kind,
            ordinal: r.ordinal,
            payload: Buffer.from(r.payload).toString('hex'),
          })),
        }),
      );
      const transported = new DoltRepo(cli).readSnapshotAt('checkpoint');
      const dest = join(dir, 'restored.db');
      materializeSnapshot(transported, dest);
      const restored = openDatabase(dest);
      try {
        initSchema(restored);
        expect(objects(restored)).toEqual(objects(db));
        expect(restored.prepare('SELECT * FROM a_child').all()).toEqual([
          { parent: 'p' },
        ]);
        expect(() =>
          restored.exec("INSERT INTO a_child VALUES ('missing')"),
        ).toThrow('FOREIGN KEY');
        expect(restored.prepare('SELECT * FROM audit').all()).toEqual([
          { value: 'valid' },
        ]);
        expect(
          restored
            .prepare('SELECT name FROM inventory_names ORDER BY name')
            .all(),
        ).toEqual([{ name: 'Current' }, { name: 'legacy' }]);
        expect(() =>
          restored
            .prepare(
              "INSERT INTO inventory(id,name,quantity,provenance,session_id,updated_at) VALUES (?, 'bad', 1,'test','s','at')",
            )
            .run('y'.repeat(257)),
        ).toThrow('identity bounds');
        expect(() =>
          restored
            .prepare("UPDATE inventory SET name=? WHERE id='valid'")
            .run('y'.repeat(257)),
        ).toThrow('identity bounds');
        restored.exec(
          "UPDATE inventory_names SET name='Renamed' WHERE name='Current'",
        );
        expect(
          restored.prepare("SELECT name FROM inventory WHERE id='valid'").get(),
        ).toEqual({ name: 'Renamed' });
        for (const table of ['scene_log', 'character_wallet_event']) {
          const insert =
            table === 'scene_log'
              ? "INSERT INTO scene_log(campaign_id,session_id,scene_id,seq,turn_id,role,content,created_at,insertion_order) VALUES ('c','s','scene',?,'t','dm','text','at',1)"
              : "INSERT INTO character_wallet_event(id,character_id,kind,amounts_json,resulting_wallet_json,source,occurred_at,provenance,session_id,insertion_order) VALUES (?,'pc','gain','{}','{}','test','at','test','s',1)";
          restored.prepare(insert).run(1);
          expect(() => restored.prepare(insert).run(2)).toThrow('UNIQUE');
        }
        restored
          .prepare(
            "INSERT INTO inventory(id,name,quantity,provenance,session_id,updated_at) VALUES ('next','Next',1,'test','s','at')",
          )
          .run();
        expect(
          restored.prepare('SELECT * FROM audit ORDER BY value').all(),
        ).toEqual([{ value: 'next' }, { value: 'valid' }]);
      } finally {
        restored.close();
      }
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects old incomplete snapshots without publishing a weakened database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'checkpoint-legacy-'));
    const db = openDatabase(':memory:');
    try {
      initSchema(db);
      const records = serializeCampaign(db).map((r) =>
        r.kind === 'schema'
          ? {
              ...r,
              payload: JSON.stringify({ create: JSON.parse(r.payload).create }),
            }
          : r,
      );
      const dest = join(dir, 'restored.db');
      expect(() => materializeSnapshot(records, dest)).toThrow(
        'create a new checkpoint from the original campaign database',
      );
      expect(existsSync(dest)).toBe(false);
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('fails atomically when restored rows violate a standalone unique index', () => {
    const dir = mkdtempSync(join(tmpdir(), 'checkpoint-conflict-'));
    const db = openDatabase(':memory:');
    try {
      db.exec(
        "CREATE TABLE items(id INTEGER PRIMARY KEY, label TEXT); CREATE UNIQUE INDEX unique_label ON items(label); INSERT INTO items VALUES (1,'one'),(2,'two')",
      );
      const records = serializeCampaign(db).map((r) =>
        r.kind === 'row'
          ? {
              ...r,
              payload: JSON.stringify({
                ...JSON.parse(r.payload),
                label: 'duplicate',
              }),
            }
          : r,
      );
      const dest = join(dir, 'restored.db');
      expect(() => materializeSnapshot(records, dest)).toThrow('UNIQUE');
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
