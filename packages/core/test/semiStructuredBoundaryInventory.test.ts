import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const inventory = JSON.parse(
  readFileSync(
    join(
      process.cwd(),
      'docs/inventories/o9bd-18-8-8-semi-structured-boundary.json',
    ),
    'utf8',
  ),
) as {
  recordCounts: { dnd5eSrd: number; pathfinderFixture: number };
  rows: {
    fieldPath: string;
    disposition: string;
    typedSchemaOrConsumer: string | null;
    owner: string | null;
  }[];
};

const DISPOSITIONS = new Set([
  'complete',
  'typed-core-with-prose-qualifier',
  'model-adjudicated',
  'unsupported',
  'not-mechanical',
]);

describe('semi-structured boundary inventory', () => {
  it('covers the active D&D pack and Pathfinder fixture', () => {
    expect(inventory.recordCounts).toEqual({
      dnd5eSrd: 1813,
      pathfinderFixture: 7,
    });
    expect(inventory.rows.length).toBeGreaterThan(700);
  });

  it('uses only the adopted dispositions and names authority for typed rows', () => {
    for (const row of inventory.rows) {
      expect(DISPOSITIONS.has(row.disposition), row.fieldPath).toBe(true);
      if (
        row.disposition === 'complete' ||
        row.disposition === 'typed-core-with-prose-qualifier'
      ) {
        expect(row.typedSchemaOrConsumer, row.fieldPath).toBeTruthy();
      }
      if (row.disposition === 'unsupported') {
        expect(row.owner, row.fieldPath).toBeTruthy();
      }
    }
  });

  it('does not introduce a universal raw/parsed catch-all', () => {
    for (const row of inventory.rows) {
      expect(row.fieldPath).not.toMatch(/raw|parsed|tokens/i);
      expect(row.typedSchemaOrConsumer ?? '').not.toMatch(
        /Record<string, unknown>|raw.*parsed|tokens/i,
      );
    }
  });
});
