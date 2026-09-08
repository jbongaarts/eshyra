import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/persistence/db.js';
import { runMigrations } from '../src/persistence/migrationRunner.js';

/**
 * Guards the eshyra-jhpt.2.5 decision recorded in
 * docs/audits/2026-09-07-campaign-rule-index-audit.md: migration 0030 drops the
 * two campaign_rule indexes no statement can use, and keeps the one that backs
 * the ambiguity-overlap read.
 */

const SELECT = 'SELECT campaign_id, rule_identity, effective_position, status';

function migratedDb() {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

function planOf(sql: string, parameters: number): string {
  const db = migratedDb();
  try {
    const rows = db
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...Array.from({ length: parameters }, () => 'x')) as {
      detail: string;
    }[];
    return rows.map((row) => row.detail).join('\n');
  } finally {
    db.close();
  }
}

describe('campaign_rule indexes (eshyra-jhpt.2.5)', () => {
  it('keeps only the indexes a statement can use', () => {
    const db = migratedDb();
    const names = (
      db
        .prepare(
          `SELECT name FROM sqlite_master
             WHERE type = 'index' AND tbl_name = 'campaign_rule'
               AND sql IS NOT NULL
             ORDER BY name`,
        )
        .all() as { name: string }[]
    ).map((row) => row.name);
    db.close();
    // Speculative in 0025, dropped in 0030; campaign_rule_ambiguity stays.
    expect(names).toEqual(['campaign_rule_ambiguity']);
  });

  it('still plans the ambiguity-overlap read through campaign_rule_ambiguity', () => {
    expect(
      planOf(
        `${SELECT} FROM campaign_rule WHERE campaign_id = ?
           AND provenance_kind = 'ambiguity' AND ambiguity_id = ?`,
        2,
      ),
    ).toContain('USING INDEX campaign_rule_ambiguity');
  });

  it('does not degrade the campaign-keyed reads into a full table scan', () => {
    for (const [sql, parameters] of [
      [`${SELECT} FROM campaign_rule WHERE campaign_id = ?`, 1],
      [
        `${SELECT} FROM campaign_rule WHERE campaign_id = ? AND rule_identity = ?`,
        2,
      ],
      [
        `SELECT rule_identity FROM campaign_rule
           WHERE campaign_id = ? AND superseded_by = ? LIMIT 1`,
        2,
      ],
      [
        `UPDATE campaign_rule SET status = 'revoked'
           WHERE campaign_id = ? AND rule_identity = ?`,
        2,
      ],
    ] as const) {
      const plan = planOf(sql, parameters);
      expect(plan).toContain('SEARCH campaign_rule');
      expect(plan).not.toContain('SCAN campaign_rule');
    }
  });

  it('orders campaign rules in memory rather than through SQL', async () => {
    // The dropped indexes could only have served a SQL position predicate, and
    // the store deliberately has none: BINARY ordering of the serialized anchor
    // does not match compareCampaignPositions.
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        new URL('../src/campaign/campaignRuleStore.ts', import.meta.url),
        'utf8',
      ),
    );
    expect(source).not.toMatch(/ORDER BY/i);
    expect(source).not.toMatch(/effective_position\s*[<>]/);
  });
});
