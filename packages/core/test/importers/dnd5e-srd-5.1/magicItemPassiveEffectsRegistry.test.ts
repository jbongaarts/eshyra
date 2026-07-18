import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ItemClauseExpectation } from '../../../scripts/importers/dnd5e-srd-5.1/magicItemCompiler.js';
import { validateMagicItemClausesAndClassify } from '../../../scripts/importers/dnd5e-srd-5.1/magicItemCompiler.js';
import {
  MAGIC_ITEM_M2_NAMES,
  MAGIC_ITEM_M3_NAMES,
  projectMagicItemPassiveMechanics,
  projectMagicItemPassiveVariantMechanics,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemPassiveEffects.js';
import type {
  MagicItemExtraction,
  MagicItemVariant,
} from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
import type { RulesRecord } from '../../../src/rules/types.js';

const records = JSON.parse(
  readFileSync(
    join(
      process.cwd(),
      'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json',
    ),
    'utf8',
  ),
) as RulesRecord[];
const magicItems = records.filter((record) => record.kind === 'magic-item');

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

function recordNamed(name: string): RulesRecord {
  const record = magicItems.find((candidate) => candidate.name === name);
  if (record === undefined) throw new Error(`missing fixture ${name}`);
  return record;
}

function projections(name: string) {
  const record = recordNamed(name);
  const item = extraction(record);
  return [
    projectMagicItemPassiveMechanics(item),
    ...(item.variants ?? []).map((variant) =>
      projectMagicItemPassiveVariantMechanics(name, variant),
    ),
  ].filter((projection) => projection !== undefined);
}

describe('M2/M3 passive effect clause registry', () => {
  it('pins 23 M2 rows, 38 M3 rows, 58 unique items, and the exact three-row overlap', () => {
    expect(MAGIC_ITEM_M2_NAMES).toEqual([
      'Amulet of Health',
      'Belt of Dwarvenkind',
      'Belt of Giant Strength',
      'Berserker Axe',
      'Bracers of Archery',
      'Demon Armor',
      'Elven Chain',
      'Gauntlets of Ogre Power',
      'Hammer of Thunderbolts',
      'Headband of Intellect',
      'Manual of Bodily Health',
      'Manual of Gainful Exercise',
      'Manual of Quickness of Action',
      'Periapt of Wound Closure',
      'Potion of Giant Strength',
      'Ring of Regeneration',
      'Robe of the Archmagi',
      'Sun Blade',
      'Tome of Clear Thought',
      'Tome of Leadership and Influence',
      'Tome of Understanding',
      'Ioun Stone',
      'Ring of Elemental Command',
    ]);
    expect(MAGIC_ITEM_M3_NAMES).toEqual([
      'Belt of Dwarvenkind',
      'Boots of Speed',
      'Boots of Striding and Springing',
      'Boots of the Winterlands',
      'Broom of Flying',
      'Carpet of Flying',
      'Cloak of Arachnida',
      'Cloak of the Bat',
      'Cloak of the Manta Ray',
      'Dragon Scale Mail',
      'Gem of Seeing',
      'Gloves of Swimming and Climbing',
      'Goggles of Night',
      'Helm of Telepathy',
      'Horseshoes of a Zephyr',
      'Horseshoes of Speed',
      'Lantern of Revealing',
      'Necklace of Adaptation',
      'Potion of Climbing',
      'Potion of Flying',
      'Potion of Water Breathing',
      'Ring of Feather Falling',
      'Ring of Free Action',
      'Ring of Swimming',
      'Ring of Warmth',
      'Ring of Water Walking',
      'Ring of X-ray Vision',
      'Robe of Eyes',
      'Rod of Alertness',
      'Rod of Lordly Might',
      'Slippers of Spider Climbing',
      'Wand of Enemy Detection',
      'Wand of Secrets',
      'Winged Boots',
      'Wings of Flying',
      'Ioun Stone',
      'Ring of Elemental Command',
      'Crystal Ball',
    ]);
    expect(MAGIC_ITEM_M2_NAMES).toHaveLength(23);
    expect(MAGIC_ITEM_M3_NAMES).toHaveLength(38);
    expect(new Set(MAGIC_ITEM_M2_NAMES).size).toBe(23);
    expect(new Set(MAGIC_ITEM_M3_NAMES).size).toBe(38);
    expect(new Set([...MAGIC_ITEM_M2_NAMES, ...MAGIC_ITEM_M3_NAMES]).size).toBe(
      58,
    );
    expect(
      MAGIC_ITEM_M2_NAMES.filter((name) => MAGIC_ITEM_M3_NAMES.includes(name)),
    ).toEqual([
      'Belt of Dwarvenkind',
      'Ioun Stone',
      'Ring of Elemental Command',
    ]);
  });

  it('assigns globally unique semantic IDs with one resolving clause per effect', () => {
    const effectIds = new Set<string>();
    const clauseIds = new Set<string>();
    let effectCount = 0;
    let clauseCount = 0;
    const tagCounts = { M2: 0, M3: 0 };
    for (const name of new Set([
      ...MAGIC_ITEM_M2_NAMES,
      ...MAGIC_ITEM_M3_NAMES,
    ])) {
      for (const projection of projections(name)) {
        const effects = projection.mechanics.effects ?? [];
        expect(projection.clauses).toHaveLength(effects.length);
        for (const effect of effects) {
          expect(effect.id).toMatch(/^m[23]-[a-z0-9]+(?:-[a-z0-9]+)*$/);
          expect(effectIds.has(effect.id as string), effect.id).toBe(false);
          effectIds.add(effect.id as string);
          effectCount += 1;
        }
        for (const clause of projection.clauses) {
          expect(clauseIds.has(clause.id), clause.id).toBe(false);
          clauseIds.add(clause.id);
          clauseCount += 1;
          tagCounts[clause.tag as 'M2' | 'M3'] += 1;
          expect(clause.representation).toEqual({
            block: 'effects',
            effectId: clause.id,
          });
          expect(effectIds.has(clause.id), clause.id).toBe(true);
          expect(clause.id.startsWith(clause.tag.toLowerCase())).toBe(true);
        }
      }
    }
    expect(effectCount).toBe(clauseCount);
    expect(effectCount).toBe(98);
    expect(tagCounts).toEqual({ M2: 35, M3: 63 });
  });

  it('keeps mixed and structured-variant ownership source-faithful', () => {
    const belt = projections('Belt of Dwarvenkind')[0];
    expect(belt?.clauses.map((clause) => clause.tag)).toEqual([
      'M2',
      'M2',
      'M3',
    ]);
    const ioun = projections('Ioun Stone');
    expect(ioun).toHaveLength(9);
    expect(
      ioun.flatMap((entry) => entry.clauses).map((clause) => clause.tag),
    ).toEqual(['M2', 'M2', 'M2', 'M2', 'M2', 'M2', 'M2', 'M2', 'M3']);
    expect(projections('Ring of Elemental Command')).toHaveLength(4);
    expect(projections('Crystal Ball')).toHaveLength(1);
  });

  it('passes the shared clause-integrity framework with parent and variant scopes', () => {
    const clausesByItemKey = new Map<
      string,
      readonly ItemClauseExpectation[]
    >();
    const projectedRecords = [
      ...new Set([...MAGIC_ITEM_M2_NAMES, ...MAGIC_ITEM_M3_NAMES]),
    ].map((name) => {
      const record = recordNamed(name);
      const data = record.data as Record<string, unknown>;
      const item = extraction(record);
      const parent = projectMagicItemPassiveMechanics(item);
      const variants = (item.variants ?? []).map((variant) => {
        const projection = projectMagicItemPassiveVariantMechanics(
          name,
          variant,
        );
        return {
          ...variant,
          ...(projection === undefined
            ? {}
            : { mechanics: projection.mechanics }),
        };
      });
      const clauses = [
        ...(parent?.clauses ?? []),
        ...(item.variants ?? []).flatMap(
          (variant: MagicItemVariant) =>
            projectMagicItemPassiveVariantMechanics(name, variant)?.clauses ??
            [],
        ),
      ];
      clausesByItemKey.set(record.key, clauses);
      const {
        mechanics: _oldMechanics,
        variants: _oldVariants,
        ...rest
      } = data;
      return {
        ...record,
        data: {
          ...rest,
          ...(parent === undefined ? {} : { mechanics: parent.mechanics }),
          ...(variants.length === 0 ? {} : { variants }),
        },
      } as RulesRecord;
    });
    expect(() =>
      validateMagicItemClausesAndClassify({
        records: projectedRecords,
        clausesByItemKey,
      }),
    ).not.toThrow();
  });
});
