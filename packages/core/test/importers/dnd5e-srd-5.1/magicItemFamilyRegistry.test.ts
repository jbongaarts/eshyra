import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateMagicItemClausesAndClassify } from '../../../scripts/importers/dnd5e-srd-5.1/magicItemCompiler.js';
import {
  buildMagicItemClausesByItemKey,
  compileMagicItemFamilies,
  MAGIC_ITEM_REVIEWED_TAG_ITEM_COUNTS,
  magicItemClauseTagCensus,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemFamilyRegistry.js';
import type { MagicItemExtraction } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
import type { RulesRecord } from '../../../src/rules/types.js';

const ROOT = process.cwd();
const records = JSON.parse(
  readFileSync(
    join(
      ROOT,
      'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json',
    ),
    'utf8',
  ),
) as RulesRecord[];
const sourceMagicItems = records.filter(
  (record) => record.kind === 'magic-item',
);

function extraction(record: RulesRecord): MagicItemExtraction {
  const data = record.data as Record<string, unknown>;
  return {
    name: record.name,
    itemType: data.itemType as string,
    rarity: data.rarity as string,
    requiresAttunement: data.requiresAttunement as boolean,
    attunementRequirement: data.attunementRequirement as string | undefined,
    description: data.description as string,
    sourcePage: 1,
    variants: data.variants as MagicItemExtraction['variants'],
  };
}

const extractions = sourceMagicItems.map(extraction);

function compiledRecords(): readonly RulesRecord[] {
  return records.map((record) => {
    if (record.kind !== 'magic-item') return record;
    const item = extraction(record);
    const compiled = compileMagicItemFamilies(item);
    const oldData = record.data as Record<string, unknown>;
    const data: Record<string, unknown> = Object.fromEntries(
      Object.entries(oldData).filter(([key]) => key !== 'mechanics'),
    );
    if (compiled.mechanics !== undefined) data.mechanics = compiled.mechanics;
    if (item.variants !== undefined) {
      data.variants = item.variants.map((variant) => {
        const variantData: Record<string, unknown> = Object.fromEntries(
          Object.entries(variant).filter(([key]) => key !== 'mechanics'),
        );
        const mechanics = compiled.variants.get(variant.name)?.mechanics;
        if (mechanics !== undefined) variantData.mechanics = mechanics;
        return variantData;
      });
    }
    return { ...record, data };
  });
}

function reviewedTags(): ReadonlyMap<string, readonly string[]> {
  const inventory = readFileSync(
    join(
      ROOT,
      'docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-7-3-magic-item-mechanics-inventory.md',
    ),
    'utf8',
  );
  const section = inventory
    .split('## 2. Master inventory')[1]
    ?.split('\n## ')[0];
  if (section === undefined) {
    throw new Error('reviewed magic-item master inventory section is missing');
  }
  const result = new Map<string, readonly string[]>();
  for (const match of section.matchAll(
    /^\| ([a-z0-9][a-z0-9-]*) \| ([^|]+) \|/gm,
  )) {
    if (match[1] === 'key') continue;
    result.set(
      `magic-item:${match[1]}`,
      match[2]
        .split(',')
        .filter((tag) => tag !== 'NM')
        .sort(),
    );
  }
  return result;
}

describe('authoritative magic-item family registry', () => {
  it('matches every item/tag row in the reviewed 240-item source inventory', () => {
    const compiled = compiledRecords();
    const clauses = buildMagicItemClausesByItemKey(extractions, compiled, {
      assertReviewedCensus: false,
    });
    const inventory = reviewedTags();
    expect(sourceMagicItems).toHaveLength(240);
    expect(clauses.size).toBe(240);
    expect(inventory.size).toBe(240);
    for (const [key, expected] of inventory) {
      const actual = [
        ...new Set((clauses.get(key) ?? []).map((clause) => clause.tag)),
      ].sort();
      expect(actual, key).toEqual(expected);
    }
    expect(magicItemClauseTagCensus(clauses)).toEqual(
      MAGIC_ITEM_REVIEWED_TAG_ITEM_COUNTS,
    );
  });

  it('resolves all mechanics and structured bindings with no red or transitional clauses', () => {
    const compiled = compiledRecords();
    const clauses = buildMagicItemClausesByItemKey(extractions, compiled);
    const readiness = validateMagicItemClausesAndClassify({
      records: compiled,
      clausesByItemKey: clauses,
    });
    expect(
      readiness.filter(
        (entry) =>
          entry.readiness === 'red' || entry.readiness === 'transitional',
      ),
    ).toEqual([]);
    expect(
      readiness.filter((entry) => entry.readiness === 'design-blocked'),
    ).toEqual([
      {
        itemKey: 'magic-item:orb-of-dragonkind',
        clauseId:
          'magic-item:orb-of-dragonkind/DB:Orb of Dragonkind:artifact-random-properties',
        readiness: 'design-blocked',
      },
    ]);

    const hookedClauseIds = new Set(
      [...clauses.values()]
        .flat()
        .filter((clause) => (clause.engineHooks?.length ?? 0) > 0)
        .map((clause) => clause.id),
    );
    for (const entry of readiness) {
      if (entry.clauseId !== undefined && hookedClauseIds.has(entry.clauseId)) {
        expect(entry.readiness, entry.clauseId).toBe('engine-pending');
      }
    }
  });
});
