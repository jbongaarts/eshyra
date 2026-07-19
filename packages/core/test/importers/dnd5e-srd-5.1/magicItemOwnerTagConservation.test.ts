import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  ItemClauseExpectation,
  MagicItemClauseTag,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemCompiler.js';
import {
  buildMagicItemClausesByItemKey,
  MAGIC_ITEM_REVIEWED_TAG_ITEM_COUNTS,
  magicItemClauseTagCensus,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemFamilyRegistry.js';
import type { MagicItemExtraction } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
import type { RulesRecord } from '../../../src/rules/types.js';

const PACK_PATH = join(
  process.cwd(),
  'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json',
);
const INVENTORY_PATH = join(
  process.cwd(),
  'docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-7-3-magic-item-mechanics-inventory.md',
);
const OWNER_TAGS = new Set<MagicItemClauseTag>([
  'C1',
  'C2',
  'S',
  'DB',
  'M1',
  'M2',
  'M3',
  'M4',
  'M5',
  'M6',
  'M7',
  'M8',
  'M9',
  'M10',
  'M11',
]);

const records = JSON.parse(readFileSync(PACK_PATH, 'utf8')) as RulesRecord[];
const magicItemRecords = records.filter(
  (record) => record.kind === 'magic-item',
);

function extraction(record: RulesRecord): MagicItemExtraction {
  const data = record.data as Record<string, unknown>;
  return {
    name: record.name,
    itemType: data.itemType as string,
    rarity: data.rarity as string,
    requiresAttunement: data.requiresAttunement as boolean,
    description: data.description as string,
    sourcePage: record.provenance?.pageStart ?? 1,
    variants: data.variants as MagicItemExtraction['variants'],
  };
}

/** Independent oracle parsed from the reviewed §2 master inventory. */
function reviewedOwners(): ReadonlyMap<
  string,
  ReadonlySet<MagicItemClauseTag>
> {
  const markdown = readFileSync(INVENTORY_PATH, 'utf8');
  const section = markdown
    .split('## 2. Master inventory')[1]
    ?.split('\n## ')[0];
  if (section === undefined)
    throw new Error('reviewed magic-item master inventory section is missing');
  const result = new Map<string, ReadonlySet<MagicItemClauseTag>>();
  for (const line of section.split('\n')) {
    const match = /^\| ([a-z0-9][a-z0-9-]*) \| ([^|]+) \|/.exec(line);
    if (match === null || match[1] === 'key') continue;
    const key = `magic-item:${match[1]}`;
    const owners = new Set<MagicItemClauseTag>();
    for (const raw of match[2].split(',').map((value) => value.trim())) {
      if (raw === 'NM') continue;
      if (!OWNER_TAGS.has(raw as MagicItemClauseTag))
        throw new Error(
          `reviewed magic-item inventory ${key} has unknown owner tag ${JSON.stringify(raw)}`,
        );
      owners.add(raw as MagicItemClauseTag);
    }
    if (owners.size === 0)
      throw new Error(`${key} has no executable or design-blocked owner`);
    if (result.has(key))
      throw new Error(`duplicate reviewed inventory row ${key}`);
    result.set(key, owners);
  }
  return result;
}

function sorted(values: Iterable<string>): readonly string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function census(
  ownersByKey: ReadonlyMap<string, ReadonlySet<MagicItemClauseTag>>,
): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const owners of ownersByKey.values())
    for (const owner of owners) result[owner] = (result[owner] ?? 0) + 1;
  return result;
}

function conservationDiagnostics(
  expected: ReadonlyMap<string, ReadonlySet<MagicItemClauseTag>>,
  actualClauses: ReadonlyMap<string, readonly ItemClauseExpectation[]>,
): readonly string[] {
  const diagnostics: string[] = [];
  for (const key of sorted(
    new Set([...expected.keys(), ...actualClauses.keys()]),
  )) {
    const expectedTags = expected.get(key) ?? new Set<MagicItemClauseTag>();
    const actualTags = new Set(
      (actualClauses.get(key) ?? []).map((clause) => clause.tag),
    );
    const missing = sorted(
      [...expectedTags].filter((tag) => !actualTags.has(tag)),
    );
    const extra = sorted(
      [...actualTags].filter((tag) => !expectedTags.has(tag)),
    );
    if (missing.length > 0 || extra.length > 0)
      diagnostics.push(
        `${key}: missing [${missing.join(', ')}]; extra [${extra.join(', ')}]`,
      );
  }
  return diagnostics;
}

describe('reviewed magic-item owner-tag conservation', () => {
  const expected = reviewedOwners();

  it('pins the exact 240-row inventory and reviewed per-tag censuses', () => {
    expect(expected.size).toBe(240);
    expect(magicItemRecords).toHaveLength(240);
    expect(sorted(expected.keys())).toEqual(
      sorted(magicItemRecords.map((record) => record.key)),
    );
    expect(census(expected)).toEqual(MAGIC_ITEM_REVIEWED_TAG_ITEM_COUNTS);
    expect(census(expected)).toMatchObject({
      C1: 105,
      C2: 169,
      S: 50,
      DB: 1,
      M1: 31,
      M2: 23,
      M3: 38,
      M4: 17,
      M5: 50,
      M6: 10,
      M7: 12,
      M8: 18,
      M9: 7,
      M10: 7,
      M11: 9,
    });
  });

  it('conserves every split owner tag per item across all parent and variant projectors', () => {
    const actualClauses = buildMagicItemClausesByItemKey(
      magicItemRecords.map(extraction),
      records,
    );
    expect(conservationDiagnostics(expected, actualClauses)).toEqual([]);
    expect(magicItemClauseTagCensus(actualClauses)).toEqual(census(expected));
  });

  it('detects a missing split owner even when the item retains other mechanics', () => {
    const actual = buildMagicItemClausesByItemKey(
      magicItemRecords.map(extraction),
      records,
    );
    const damaged = new Map(actual);
    const key = 'magic-item:belt-of-dwarvenkind';
    const surviving = (damaged.get(key) ?? []).filter(
      (clause) => clause.tag !== 'M3',
    );
    expect(new Set(surviving.map((clause) => clause.tag))).toContain('M2');
    damaged.set(key, surviving);
    expect(conservationDiagnostics(expected, damaged)).toEqual([
      'magic-item:belt-of-dwarvenkind: missing [M3]; extra []',
    ]);
  });

  it('licenses DB only for the reviewed Orb of Dragonkind clause', () => {
    const dbKeys = [...expected.entries()]
      .filter(([, owners]) => owners.has('DB'))
      .map(([key]) => key);
    expect(dbKeys).toEqual(['magic-item:orb-of-dragonkind']);
    const actual = buildMagicItemClausesByItemKey(
      magicItemRecords.map(extraction),
      records,
    );
    const dbClauses = [...actual.entries()].flatMap(([key, clauses]) =>
      clauses
        .filter((clause) => clause.tag === 'DB')
        .map((clause) => ({ key, clause })),
    );
    expect(dbClauses).toHaveLength(1);
    expect(dbClauses[0]?.key).toBe('magic-item:orb-of-dragonkind');
    expect(dbClauses[0]?.clause.representation).toMatchObject({
      designBlocked: true,
    });
  });
});
