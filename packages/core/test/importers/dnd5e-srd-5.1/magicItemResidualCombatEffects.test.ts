import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAGIC_ITEM_ACTIVATED_EFFECT_NAMES } from '../../../scripts/importers/dnd5e-srd-5.1/magicItemActivatedEffects.js';
import { MAGIC_ITEM_STATIC_COMBAT_ITEM_NAMES } from '../../../scripts/importers/dnd5e-srd-5.1/magicItemCombatModifiers.js';
import {
  MAGIC_ITEM_RESIDUAL_COMBAT_CLAUSE_IDS,
  MAGIC_ITEM_RESIDUAL_COMBAT_NAMES,
  projectMagicItemResidualCombatEffects,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemResidualCombatEffects.js';
import type { MagicItemExtraction } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
import { validateRecordKindSchema } from '../../../src/rules/kindSchemas.js';
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
const itemRecords = records.filter((record) => record.kind === 'magic-item');

function named(name: string): MagicItemExtraction {
  const record = itemRecords.find((candidate) => candidate.name === name);
  if (record === undefined) throw new Error(`missing fixture item ${name}`);
  const data = record.data as Record<string, unknown>;
  return {
    name,
    itemType: data.itemType as string,
    rarity: data.rarity as string,
    requiresAttunement: data.requiresAttunement as boolean,
    description: data.description as string,
    sourcePage: record.provenance?.pageStart ?? 1,
    variants: data.variants as MagicItemExtraction['variants'],
  };
}

function schemaRecord(name: string, mechanics: unknown): RulesRecord {
  const record = itemRecords.find((candidate) => candidate.name === name);
  if (record === undefined) throw new Error(`missing fixture item ${name}`);
  return { ...record, data: { ...(record.data as object), mechanics } };
}

describe('residual C2 combat and defense projection', () => {
  it('pins the exact residual item/clause profile and conserves every reviewed C2 item', () => {
    expect(MAGIC_ITEM_RESIDUAL_COMBAT_NAMES).toHaveLength(70);
    expect(MAGIC_ITEM_RESIDUAL_COMBAT_CLAUSE_IDS).toHaveLength(90);
    expect(new Set(MAGIC_ITEM_RESIDUAL_COMBAT_CLAUSE_IDS).size).toBe(90);

    const inventory = readFileSync(
      join(
        process.cwd(),
        'docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-7-3-magic-item-mechanics-inventory.md',
      ),
      'utf8',
    );
    const reviewedKeys = [
      ...inventory.matchAll(/^\| ([a-z0-9-]+) \| ([^|]+) \|/gm),
    ]
      .filter((match) =>
        match[2]
          .split(',')
          .map((tag) => tag.trim())
          .includes('C2'),
      )
      .map((match) => `magic-item:${match[1]}`);
    expect(reviewedKeys).toHaveLength(169);
    const reviewedNames = reviewedKeys.map((key) => {
      const record = itemRecords.find((candidate) => candidate.key === key);
      if (record === undefined) throw new Error(`missing inventory key ${key}`);
      return record.name;
    });
    const threeSlices = new Set([
      ...MAGIC_ITEM_STATIC_COMBAT_ITEM_NAMES,
      ...MAGIC_ITEM_ACTIVATED_EFFECT_NAMES,
      ...MAGIC_ITEM_RESIDUAL_COMBAT_NAMES,
    ]);
    expect(reviewedNames.filter((name) => !threeSlices.has(name))).toEqual([]);
  });

  it('projects redirect, missile catch, visibility, save, cover, and range goldens', () => {
    expect(
      projectMagicItemResidualCombatEffects(named('Arrow of Slaying')),
    ).toMatchObject({
      mechanics: {
        operations: [
          {
            id: 'deal-extra-damage',
            effects: ['c2-residual-slaying-damage'],
          },
        ],
        effects: [{ id: 'c2-residual-slaying-damage' }],
      },
    });
    expect(
      projectMagicItemResidualCombatEffects(named('Arrow-Catching Shield')),
    ).toMatchObject({
      mechanics: {
        effects: [{ kind: 'reaction', action: 'redirect attack to wielder' }],
      },
    });
    expect(
      projectMagicItemResidualCombatEffects(named('Gloves of Missile Snaring')),
    ).toMatchObject({
      mechanics: {
        effects: [
          {
            kind: 'reaction',
            reductionDice: '1d10',
            addAbilityModifier: 'dexterity',
          },
        ],
      },
    });
    expect(
      projectMagicItemResidualCombatEffects(named('Cloak of Elvenkind')),
    ).toMatchObject({
      mechanics: { effects: [{ mode: 'disadvantage' }, { kind: 'advantage' }] },
    });
    expect(
      projectMagicItemResidualCombatEffects(
        named('Mantle of Spell Resistance'),
      ),
    ).toMatchObject({
      mechanics: {
        effects: [{ kind: 'advantage', condition: 'against spells' }],
      },
    });
    expect(
      projectMagicItemResidualCombatEffects(named('Oathbow')),
    ).toMatchObject({
      mechanics: {
        effects: [
          { kind: 'advantage' },
          {
            ignoresCover: ['half', 'three-quarters'],
            ignoresLongRangeDisadvantage: true,
          },
          { extraDamage: { dice: '3d6', type: 'piercing' } },
        ],
      },
    });
    expect(
      projectMagicItemResidualCombatEffects(
        named('Wand of the War Mage, +1, +2, or +3'),
      ),
    ).toMatchObject({
      mechanics: { effects: [{ result: 'ignore target half cover' }] },
    });
  });

  it('projects the restored source-exact C2 save and condition payloads', () => {
    expect(
      projectMagicItemResidualCombatEffects(named('Giant Slayer')),
    ).toMatchObject({
      mechanics: {
        effects: [
          {
            save: { ability: 'strength', dc: 15 },
            failedSaveCondition: 'prone',
          },
        ],
      },
    });
    expect(
      projectMagicItemResidualCombatEffects(named('Mace of Disruption')),
    ).toMatchObject({
      mechanics: {
        effects: [
          {
            save: { ability: 'wisdom', dc: 15 },
            hitPointThreshold: { maximum: 25 },
            failedSaveEffect: 'destroyed',
            onSuccessfulSave: { condition: 'frightened' },
          },
        ],
      },
    });
    expect(
      projectMagicItemResidualCombatEffects(named('Iron Flask'))?.mechanics
        .effects,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          save: { ability: 'wisdom', dc: 17 },
          rangeFeet: 60,
        }),
      ]),
    );
    expect(
      projectMagicItemResidualCombatEffects(named('Mirror of Life Trapping'))
        ?.mechanics.effects,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          save: { ability: 'charisma', dc: 15 },
          rangeFeet: 30,
        }),
      ]),
    );
    expect(
      projectMagicItemResidualCombatEffects(named('Robe of Eyes'))?.mechanics
        .effects,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conditions: ['blinded'],
          duration: { amount: 1, unit: 'minute' },
          saves: [
            { ability: 'constitution', dc: 11, source: 'light' },
            { ability: 'constitution', dc: 15, source: 'daylight' },
          ],
        }),
      ]),
    );
  });

  it('validates every projection through the canonical magic-item schema', () => {
    for (const name of MAGIC_ITEM_RESIDUAL_COMBAT_NAMES) {
      const projection = projectMagicItemResidualCombatEffects(named(name));
      expect(projection, name).toBeDefined();
      expect(() =>
        validateRecordKindSchema(
          schemaRecord(name, projection?.mechanics),
          name,
        ),
      ).not.toThrow();
    }
  });

  it('fails closed on source drift and unrelated records', () => {
    expect(
      projectMagicItemResidualCombatEffects(named('Bag of Holding')),
    ).toBeUndefined();
    const cloak = named('Cloak of Elvenkind');
    expect(() =>
      projectMagicItemResidualCombatEffects({
        ...cloak,
        description: cloak.description.replace(
          'Wisdom (Perception) checks made to see you have disadvantage',
          'observers struggle',
        ),
      }),
    ).toThrow(/expected source phrase/);
  });
});
