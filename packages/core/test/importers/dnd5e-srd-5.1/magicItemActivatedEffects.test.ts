import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAGIC_ITEM_ACTIVATED_EFFECT_NAMES,
  MAGIC_ITEM_ACTIVATED_EFFECT_REFERENCES,
  projectMagicItemActivatedEffects,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemActivatedEffects.js';
import { projectMagicItemChargeEconomies } from '../../../scripts/importers/dnd5e-srd-5.1/magicItemChargeEconomies.js';
import { aggregateMagicItemFamilyProjections } from '../../../scripts/importers/dnd5e-srd-5.1/magicItemCompiler.js';
import { projectMagicItemConsumable } from '../../../scripts/importers/dnd5e-srd-5.1/magicItemConsumables.js';
import { projectMagicItemUseEconomies } from '../../../scripts/importers/dnd5e-srd-5.1/magicItemUseEconomies.js';
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
const items = records.filter((record) => record.kind === 'magic-item');
const keys = new Set(records.map(({ key }) => key));

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

function named(name: string): MagicItemExtraction {
  const record = items.find((candidate) => candidate.name === name);
  if (record === undefined) throw new Error(`missing fixture item ${name}`);
  return extraction(record);
}

function mechanicsRecord(name: string, mechanics: unknown): RulesRecord {
  const source = items.find((candidate) => candidate.name === name);
  if (source === undefined) throw new Error(`missing fixture item ${name}`);
  return {
    ...source,
    data: { ...(source.data as Record<string, unknown>), mechanics },
  };
}

describe('C2 spell grants and activated save/DC projection', () => {
  it('pins the exact reviewed bounded membership and canonical references', () => {
    expect(MAGIC_ITEM_ACTIVATED_EFFECT_NAMES).toHaveLength(64);
    expect(new Set(MAGIC_ITEM_ACTIVATED_EFFECT_NAMES).size).toBe(64);
    expect(
      items
        .map(({ name }) => name)
        .filter((name) => MAGIC_ITEM_ACTIVATED_EFFECT_NAMES.includes(name)),
    ).toHaveLength(64);
    for (const ref of MAGIC_ITEM_ACTIVATED_EFFECT_REFERENCES) {
      expect(keys.has(ref), ref).toBe(true);
    }
  });

  it('projects fixed and owner-DC staff/wand spell goldens with cast levels', () => {
    const healing = projectMagicItemActivatedEffects(named('Staff of Healing'));
    expect(healing?.mechanics.operations?.[0]).toMatchObject({
      id: 'cast-cure-wounds',
    });
    expect(healing?.mechanics.effects?.[0]).toMatchObject({
      spellRef: 'spell:cure-wounds',
      castLevel: '1-4 selected by charges',
    });
    expect(
      projectMagicItemActivatedEffects(named('Staff of Charming'))?.mechanics
        .effects?.[0],
    ).toMatchObject({
      spellRef: 'spell:charm-person',
      saveDc: 'owner-spell-save-dc',
    });
    expect(
      projectMagicItemActivatedEffects(named('Wand of Fireballs'))?.mechanics
        .effects?.[0],
    ).toMatchObject({
      spellRef: 'spell:fireball',
      saveDc: 15,
      castLevel: 3,
      additionalLevelPerAdditionalCharge: 1,
    });
    expect(
      projectMagicItemActivatedEffects(named('Robe of Stars'))?.mechanics
        .effects?.[0],
    ).toMatchObject({ spellRef: 'spell:magic-missile', castLevel: 5 });
    expect(
      projectMagicItemActivatedEffects(named('Staff of Frost'))?.mechanics
        .effects,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          spellRef: 'spell:cone-of-cold',
          saveDc: 'owner-spell-save-dc',
        }),
        expect.objectContaining({
          spellRef: 'spell:ice-storm',
          saveDc: 'owner-spell-save-dc',
        }),
        expect.objectContaining({
          spellRef: 'spell:wall-of-ice',
          saveDc: 'owner-spell-save-dc',
        }),
      ]),
    );
    expect(
      projectMagicItemActivatedEffects(named('Potion of Healing'))?.mechanics
        .effects?.[0],
    ).toMatchObject({ kind: 'healing', tableRef: 'table:potions-of-healing' });
  });

  it('models activation, save branches, conditions, repeats, and healing', () => {
    expect(
      projectMagicItemActivatedEffects(named('Ring of Shooting Stars'))
        ?.mechanics.effects,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'c2-launch-shooting-stars-payload',
          save: { ability: 'dexterity', dc: 15 },
          failedSaveDamage: { dice: '5d4', type: 'fire' },
          successfulSaveDamage: 'half',
        }),
      ]),
    );
    expect(
      projectMagicItemActivatedEffects(named('Staff of Power'))?.mechanics
        .effects,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'c2-power-strike-payload',
          damage: { dice: '1d6', type: 'force' },
        }),
      ]),
    );
    expect(
      projectMagicItemActivatedEffects(named('Armor of Invulnerability')),
    ).toMatchObject({
      mechanics: {
        operations: [
          {
            id: 'activate-immunity',
            activation: { cost: 'action', target: 'self' },
          },
        ],
        effects: [
          {
            kind: 'immunity',
            duration: { amount: 10, unit: 'minute' },
            endsOn: ['armor-removed'],
          },
        ],
      },
    });
    expect(
      projectMagicItemActivatedEffects(named('Horn of Blasting')),
    ).toMatchObject({
      mechanics: {
        effects: [
          {
            failedSaveDamage: { dice: '5d6', type: 'thunder' },
            successfulSaveDamage: 'half',
            failedSaveCondition: 'deafened',
          },
        ],
      },
    });
    expect(
      projectMagicItemActivatedEffects(named('Rod of Lordly Might')),
    ).toMatchObject({
      mechanics: {
        effects: [
          {
            save: { ability: 'constitution', dc: 17 },
            healing: 'half necrotic damage dealt',
          },
          { conditions: ['paralyzed'], repeatSave: 'end of each turn' },
          { conditions: ['frightened'], repeatSave: 'end of each turn' },
        ],
      },
    });
  });

  it('projects Staff of Striking per-charge damage', () => {
    expect(
      projectMagicItemActivatedEffects(named('Staff of Striking')),
    ).toMatchObject({
      mechanics: {
        operations: [
          {
            id: 'powerful-strike',
            activation: {
              cost: 'free',
              trigger: 'hit with a melee attack using the staff',
            },
            effects: ['c2-powerful-strike-payload'],
          },
        ],
        effects: [
          {
            id: 'c2-powerful-strike-payload',
            kind: 'triggeredEffect',
            trigger: 'hit with a melee attack using the staff',
            extraDamage: {
              dice: '1d6',
              type: 'force',
              perChargeExpended: true,
              maximumCharges: 3,
            },
          },
        ],
      },
    });
  });

  it('projects the restored source-exact activated payloads', () => {
    expect(
      projectMagicItemActivatedEffects(named('Cloak of Arachnida')),
    ).toMatchObject({
      mechanics: {
        effects: [{ spellRef: 'spell:web', saveDc: 13, areaMultiplier: 2 }],
      },
    });
    expect(
      projectMagicItemActivatedEffects(named('Dagger of Venom')),
    ).toMatchObject({
      mechanics: {
        effects: [
          {
            save: { ability: 'constitution', dc: 15 },
            failedSaveDamage: { dice: '2d10', type: 'poison' },
            failedSaveCondition: 'poisoned',
            conditionDuration: { amount: 1, unit: 'minute' },
          },
        ],
      },
    });
    expect(
      projectMagicItemActivatedEffects(named('Hammer of Thunderbolts')),
    ).toMatchObject({
      mechanics: {
        effects: [
          {
            save: { ability: 'constitution', dc: 17 },
            failedSaveEffect: 'die',
          },
          {
            range: { normalFeet: 20, longFeet: 60 },
            area: { feet: 30 },
            failedSaveCondition: 'stunned',
            duration: 'until end of your next turn',
          },
        ],
      },
    });
    expect(
      projectMagicItemActivatedEffects(named('Nine Lives Stealer')),
    ).toMatchObject({
      mechanics: {
        effects: [
          {
            save: { ability: 'constitution', dc: 15 },
            immuneTypes: ['construct', 'undead'],
            chargeCost: 1,
          },
        ],
      },
    });
  });

  it('merges payloads into the exact C1 operation IDs and validates every result', () => {
    for (const name of MAGIC_ITEM_ACTIVATED_EFFECT_NAMES) {
      const item = named(name);
      const projections = [
        projectMagicItemChargeEconomies(item),
        projectMagicItemUseEconomies(item),
        projectMagicItemConsumable(item),
        projectMagicItemActivatedEffects(item),
      ].filter((value) => value !== undefined);
      const { mechanics } = aggregateMagicItemFamilyProjections(projections);
      expect(mechanics, name).toBeDefined();
      expect(() =>
        validateRecordKindSchema(
          mechanicsRecord(name, mechanics),
          `magic-item:${name}`,
        ),
      ).not.toThrow();
    }
  });

  it('fails closed on unrelated items and source drift', () => {
    expect(
      projectMagicItemActivatedEffects(named('Bag of Holding')),
    ).toBeUndefined();
    expect(() =>
      projectMagicItemActivatedEffects({
        ...named('Wand of Paralysis'),
        description: named('Wand of Paralysis').description.replace(
          'repeat the saving throw, ending the effect on itself on a success',
          'the effect simply ends',
        ),
      }),
    ).toThrow(/expected source phrase/);
  });

  it('makes unresolved curated references fail the same conservation check', () => {
    const forged = [
      ...MAGIC_ITEM_ACTIVATED_EFFECT_REFERENCES,
      'spell:not-in-srd',
    ];
    expect(forged.filter((ref) => !keys.has(ref))).toEqual([
      'spell:not-in-srd',
    ]);
  });
});
