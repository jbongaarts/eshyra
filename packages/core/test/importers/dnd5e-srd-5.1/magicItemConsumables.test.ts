import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  deriveMagicItemConsumableMechanics,
  EXPECTED_MAGIC_ITEM_CONSUMABLE_NAMES,
  projectMagicItemConsumable,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemConsumables.js';
import type { MagicItemExtraction } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
import { validateRecordKindSchema } from '../../../src/rules/kindSchemas.js';
import type { RulesRecord } from '../../../src/rules/types.js';

const records = JSON.parse(
  readFileSync(
    'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json',
    'utf8',
  ),
) as RulesRecord[];

const magicItems = records.filter(
  (record): record is RulesRecord & { data: { description: string } } =>
    record.kind === 'magic-item' &&
    typeof record.data === 'object' &&
    record.data !== null &&
    typeof (record.data as { description?: unknown }).description === 'string',
);

const REVIEWED_M1_NAMES = [
  'Bead of Force',
  'Dust of Disappearance',
  'Dust of Dryness',
  'Dust of Sneezing and Choking',
  'Elemental Gem',
  'Feather Token',
  'Marvelous Pigments',
  'Oil of Etherealness',
  'Oil of Sharpness',
  'Oil of Slipperiness',
  'Philter of Love',
  'Potion of Animal Friendship',
  'Potion of Clairvoyance',
  'Potion of Climbing',
  'Potion of Diminution',
  'Potion of Flying',
  'Potion of Gaseous Form',
  'Potion of Giant Strength',
  'Potion of Growth',
  'Potion of Healing',
  'Potion of Heroism',
  'Potion of Invisibility',
  'Potion of Mind Reading',
  'Potion of Poison',
  'Potion of Resistance',
  'Potion of Speed',
  'Potion of Water Breathing',
  'Restorative Ointment',
  'Sovereign Glue',
  'Spell Scroll',
  'Universal Solvent',
] as const;

function extraction(name: string, description?: string): MagicItemExtraction {
  const source = magicItems.find((item) => item.name === name);
  return {
    name,
    itemType: 'Wondrous item',
    rarity: 'rare',
    requiresAttunement: false,
    description: description ?? source?.data.description ?? '',
    sourcePage: 1,
  };
}

describe('magic-item M1 consumables', () => {
  it('pins exact 31-record reviewed membership and accepts every source record', () => {
    expect(EXPECTED_MAGIC_ITEM_CONSUMABLE_NAMES.size).toBe(31);
    expect([...EXPECTED_MAGIC_ITEM_CONSUMABLE_NAMES].sort()).toEqual(
      [...REVIEWED_M1_NAMES].sort(),
    );
    for (const name of REVIEWED_M1_NAMES) {
      expect(
        magicItems.some((item) => item.name === name),
        name,
      ).toBe(true);
      expect(projectMagicItemConsumable(extraction(name)), name).toBeDefined();
    }
  });

  it('keeps stackable one-shots stateless and reserves dose pools for source containers', () => {
    const doseItems = new Map([
      ['Dust of Dryness', '1d6+4'],
      ['Marvelous Pigments', '1d4'],
      ['Restorative Ointment', '1d4+1'],
      ['Sovereign Glue', '1d6+1'],
    ]);
    for (const name of REVIEWED_M1_NAMES) {
      const mechanics = deriveMagicItemConsumableMechanics(extraction(name));
      const expectedCount = doseItems.get(name);
      if (expectedCount !== undefined) {
        expect(mechanics?.economies?.doses, name).toMatchObject({
          kind: 'doses',
          doses: { count: expectedCount },
        });
      } else {
        expect(mechanics?.economies?.quantity, name).toMatchObject({
          kind: 'single-use',
          onDepleted: { becomes: 'destroyed' },
        });
      }
      expect(mechanics).not.toHaveProperty('stateMachine');
    }
  });

  it('binds every operation to declared economies and effects', () => {
    for (const name of REVIEWED_M1_NAMES) {
      const mechanics = deriveMagicItemConsumableMechanics(extraction(name));
      const economyIds = new Set(Object.keys(mechanics?.economies ?? {}));
      const effectIds = new Set(
        mechanics?.effects?.flatMap((entry) =>
          entry.id === undefined ? [] : [entry.id],
        ) ?? [],
      );
      for (const op of mechanics?.operations ?? []) {
        for (const entry of op.cost ?? []) {
          expect(economyIds.has(entry.economy), `${name}:${op.id}`).toBe(true);
        }
        for (const effectId of op.effects ?? []) {
          expect(effectIds.has(effectId), `${name}:${op.id}:${effectId}`).toBe(
            true,
          );
        }
      }
    }
  });

  it('passes the canonical magic-item mechanics schema for every member', () => {
    for (const name of REVIEWED_M1_NAMES) {
      const source = magicItems.find((item) => item.name === name);
      const mechanics = deriveMagicItemConsumableMechanics(extraction(name));
      expect(source, name).toBeDefined();
      expect(() =>
        validateRecordKindSchema(
          {
            ...(source as RulesRecord),
            data: { ...source?.data, mechanics },
          },
          `records.${name}`,
        ),
      ).not.toThrow();
    }
  });

  it('models potion healing by the source table and heroism through F6', () => {
    const healing = projectMagicItemConsumable(extraction('Potion of Healing'));
    expect(healing?.mechanics.effects).toContainEqual({
      id: 'healing',
      kind: 'healing',
      tableRef: 'table:potions-of-healing',
      selectRowBy: 'item rarity',
    });
    expect(healing?.clauses).toContainEqual({
      id: 's-healing-potency-table',
      tag: 'S',
      representation: {
        block: 'structuredField',
        field: 'effects.healing.tableRef',
        ref: 'table:potions-of-healing',
      },
    });

    const heroism = projectMagicItemConsumable(extraction('Potion of Heroism'));
    expect(heroism?.mechanics.effects).toContainEqual(
      expect.objectContaining({
        id: 'heroic-temporary-hit-points',
        amount: 10,
      }),
    );
    expect(heroism?.clauses[0]?.engineHooks).toContainEqual({
      engine: 'F6',
      hook: 'temporary hit point ownership and duration',
    });
  });

  it('models the complete spell-scroll cast, loss, table, and copy procedure', () => {
    const scroll = projectMagicItemConsumable(extraction('Spell Scroll'));
    expect(scroll?.mechanics.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'cast-spell' }),
        expect.objectContaining({ id: 'copy-spell' }),
      ]),
    );
    expect(scroll?.mechanics.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'scroll-casting-procedure',
          intelligibleOnlyIfOnReaderClassList: true,
          higherThanNormallyCastableCheck: {
            ability: 'reader spellcasting ability',
            dcFormula: '10 + spell level',
            onFailure: 'spell disappears with no other effect',
          },
          saveDcAndAttackBonusTableRef: 'table:spell-scroll',
        }),
        expect.objectContaining({
          id: 'scroll-copying-procedure',
          ability: 'intelligence',
          skill: 'arcana',
          dcFormula: '10 + spell level',
          onSuccessOrFailure: 'scroll destroyed',
        }),
      ]),
    );
    expect(scroll?.clauses[0]?.engineHooks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ engine: 'F4' }),
        expect.objectContaining({ engine: 'F8' }),
        expect.objectContaining({ engine: 'F9' }),
      ]),
    );
  });

  it('fails closed on source-anchor drift and ignores nonmembers', () => {
    expect(() =>
      projectMagicItemConsumable(
        extraction('Spell Scroll', 'A changed entry.'),
      ),
    ).toThrow(/expected source phrase/);
    expect(
      projectMagicItemConsumable(extraction('Vorpal Sword', '')),
    ).toBeUndefined();
  });
});
