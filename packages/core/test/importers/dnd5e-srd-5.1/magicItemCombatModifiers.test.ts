import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAGIC_ITEM_STATIC_COMBAT_ITEM_NAMES,
  MAGIC_ITEM_STATIC_COMBAT_VARIANT_MEMBERSHIP,
  projectMagicItemStaticCombatModifiers,
  projectMagicItemStaticCombatVariantModifiers,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemCombatModifiers.js';
import type {
  MagicItemExtraction,
  MagicItemVariant,
} from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
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

function extraction(record: RulesRecord): MagicItemExtraction {
  const data = record.data as Record<string, unknown>;
  return {
    name: record.name,
    itemType: data.itemType as string,
    rarity: data.rarity as string,
    requiresAttunement: data.requiresAttunement as boolean,
    description: data.description as string,
    sourcePage: record.provenance?.pageStart ?? 1,
    variants: data.variants as readonly MagicItemVariant[] | undefined,
  };
}

function named(name: string): MagicItemExtraction {
  const record = itemRecords.find((candidate) => candidate.name === name);
  if (record === undefined) throw new Error(`missing fixture item ${name}`);
  return extraction(record);
}

describe('C2 static combat modifier family projection', () => {
  it('pins the exact reviewed parent and variant membership', () => {
    expect(MAGIC_ITEM_STATIC_COMBAT_ITEM_NAMES).toHaveLength(62);
    expect(new Set(MAGIC_ITEM_STATIC_COMBAT_ITEM_NAMES).size).toBe(62);
    expect(MAGIC_ITEM_STATIC_COMBAT_VARIANT_MEMBERSHIP).toEqual([
      'Ioun Stone::Protection',
      'Ring of Elemental Command::Ring of Air Elemental Command',
      'Ring of Elemental Command::Ring of Earth Elemental Command',
      'Ring of Elemental Command::Ring of Fire Elemental Command',
    ]);
    expect(
      itemRecords
        .map((record) => record.name)
        .filter((name) => MAGIC_ITEM_STATIC_COMBAT_ITEM_NAMES.includes(name)),
    ).toHaveLength(62);
  });

  it('projects golden armor, weapon, resistance, and vulnerability effects', () => {
    expect(
      projectMagicItemStaticCombatModifiers(named('Demon Armor')),
    ).toMatchObject({
      family: 'c2-static-combat-modifiers',
      mechanics: {
        effects: [
          { id: 'c2-static-demon-armor-ac', kind: 'acBonus', amount: 1 },
          {
            id: 'c2-static-demon-armor-unarmed',
            kind: 'naturalWeaponDamage',
            dice: '1d8',
            typeChoice: ['slashing'],
            attackAndDamageBonus: 1,
          },
        ],
      },
    });

    expect(
      projectMagicItemStaticCombatModifiers(named('Dwarven Thrower')),
    ).toMatchObject({
      mechanics: {
        effects: [
          { kind: 'attackAndDamageBonus', amount: 3 },
          {
            kind: 'triggeredEffect',
            range: { normalFeet: 20, longFeet: 60 },
          },
          {
            kind: 'extraDamage',
            dice: '1d8',
            targetTypeOverride: { types: ['giant'], dice: '2d8' },
          },
        ],
      },
    });

    expect(
      projectMagicItemStaticCombatModifiers(named('Armor of Vulnerability')),
    ).toMatchObject({
      mechanics: {
        effects: [
          { kind: 'damageResistance', selection: 'one' },
          {
            kind: 'damageMultiplier',
            selection: 'two',
            excludesSelectedResistance: true,
            multiplier: 2,
          },
        ],
      },
    });
  });

  it('preserves rarity/table-driven values and F8/F9 ownership hooks', () => {
    const armor = projectMagicItemStaticCombatModifiers(
      named('Armor, +1, +2, or +3'),
    );
    expect(armor?.mechanics.effects?.[0]).toMatchObject({
      kind: 'acBonus',
      amountByRarity: [
        { rarity: 'rare', amount: 1 },
        { rarity: 'very rare', amount: 2 },
        { rarity: 'legendary', amount: 3 },
      ],
    });
    expect(armor?.clauses[0]?.engineHooks).toEqual([
      { engine: 'F8', hook: 'derived combat modifier application' },
    ]);

    const resistance = projectMagicItemStaticCombatModifiers(
      named('Armor of Resistance'),
    );
    expect(resistance?.mechanics.effects?.[0]).toMatchObject({
      tableRef: 'table:armor-of-resistance',
    });
    expect(resistance?.clauses[0]?.engineHooks).toEqual([
      {
        engine: 'F9',
        hook: 'damage resistance, vulnerability, and rider math',
      },
    ]);
  });

  it('projects only reviewed named variants and keeps parent effects off the parent', () => {
    expect(
      projectMagicItemStaticCombatModifiers(named('Ioun Stone')),
    ).toBeUndefined();
    const ioun = named('Ioun Stone');
    const protection = ioun.variants?.find(
      (variant) => variant.name === 'Protection',
    );
    expect(protection).toBeDefined();
    expect(
      projectMagicItemStaticCombatVariantModifiers(
        ioun.name,
        protection as MagicItemVariant,
      )?.mechanics.effects,
    ).toEqual([
      {
        id: 'c2-static-ioun-protection-ac',
        kind: 'acBonus',
        amount: 1,
      },
    ]);
  });

  it('fails loudly on source drift and rejects near-miss families', () => {
    const item = named('Armor of Resistance');
    expect(() =>
      projectMagicItemStaticCombatModifiers({
        ...item,
        description: item.description.replace(
          'resistance to one type of damage',
          'protection from one damage type',
        ),
      }),
    ).toThrow(/expected source phrase/);

    expect(
      projectMagicItemStaticCombatModifiers(
        named('Mantle of Spell Resistance'),
      ),
    ).toBeUndefined();
    expect(
      projectMagicItemStaticCombatModifiers(named('Gloves of Missile Snaring')),
    ).toBeUndefined();
  });

  it('binds every effect to one distinct clause and source phrase', () => {
    let effectCount = 0;
    const effectIds = new Set<string>();
    for (const name of MAGIC_ITEM_STATIC_COMBAT_ITEM_NAMES) {
      const projection = projectMagicItemStaticCombatModifiers(named(name));
      expect(projection).toBeDefined();
      expect(projection?.clauses).toHaveLength(
        projection?.mechanics.effects?.length ?? 0,
      );
      for (const clause of projection?.clauses ?? []) {
        expect(clause.tag).toBe('C2');
        expect(effectIds.has(clause.id)).toBe(false);
        effectIds.add(clause.id);
        effectCount += 1;
      }
    }
    expect(effectCount).toBe(92);
  });

  it('passes the complete magic-item kind schema for every parent and variant projection', () => {
    for (const name of MAGIC_ITEM_STATIC_COMBAT_ITEM_NAMES) {
      const source = itemRecords.find((record) => record.name === name);
      if (source === undefined) throw new Error(`missing fixture item ${name}`);
      const projection = projectMagicItemStaticCombatModifiers(
        extraction(source),
      );
      validateRecordKindSchema(
        {
          ...source,
          data: {
            ...source.data,
            executionReadiness: undefined,
            mechanics: projection?.mechanics,
          },
        },
        `magic-item:${name}`,
      );
    }

    for (const membership of MAGIC_ITEM_STATIC_COMBAT_VARIANT_MEMBERSHIP) {
      const [parentName, variantName] = membership.split('::');
      const parent = named(parentName as string);
      const variant = parent.variants?.find(
        (candidate) => candidate.name === variantName,
      );
      if (variant === undefined)
        throw new Error(`missing fixture ${membership}`);
      const projection = projectMagicItemStaticCombatVariantModifiers(
        parentName as string,
        variant,
      );
      const source = itemRecords.find((record) => record.name === parentName);
      if (source === undefined)
        throw new Error(`missing fixture item ${parentName}`);
      validateRecordKindSchema(
        {
          ...source,
          data: {
            ...source.data,
            executionReadiness: undefined,
            variants: [{ ...variant, mechanics: projection?.mechanics }],
          },
        },
        `magic-item:${membership}`,
      );
    }
  });
});
