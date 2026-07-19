import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAGIC_ITEM_ROLL_MANIPULATION_NAMES,
  MAGIC_ITEM_SPELL_INTEROP_NAMES,
  MAGIC_ITEM_SPELL_INTEROP_VARIANTS,
  MAGIC_ITEM_SPELL_ROLL_REFERENCES,
  projectMagicItemSpellRollInterop,
  projectMagicItemSpellRollInteropVariant,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemSpellRollInterop.js';
import type {
  MagicItemExtraction,
  MagicItemVariant,
} from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
import { validateMagicItemMechanics } from '../../../src/rules/magicItemMechanics.js';
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
const recordKeys = new Set(records.map((record) => record.key));

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
  const record = magicItems.find((candidate) => candidate.name === name);
  if (record === undefined) throw new Error(`missing fixture item ${name}`);
  return extraction(record);
}

function projection(name: string) {
  const result = projectMagicItemSpellRollInterop(named(name));
  if (result === undefined) throw new Error(`missing projection ${name}`);
  return result;
}

function spellContracts(name: string): readonly Record<string, unknown>[] {
  return (
    projection(name).mechanics.spellStore as unknown as Record<string, unknown>
  ).contracts as readonly Record<string, unknown>[];
}

function transforms(name: string): readonly Record<string, unknown>[] {
  return (
    projection(name).mechanics.rollManipulation as unknown as Record<
      string,
      unknown
    >
  ).transforms as readonly Record<string, unknown>[];
}

function withSiblingEconomyStandIns(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const existing = (value.economies ?? {}) as Record<string, unknown>;
  const referenced = new Set<string>();
  for (const operation of (value.operations ?? []) as readonly Record<
    string,
    unknown
  >[]) {
    for (const cost of (operation.cost ?? []) as readonly Record<
      string,
      unknown
    >[]) {
      referenced.add(cost.economy as string);
    }
    for (const id of (operation.doesNotExpend ?? []) as readonly string[]) {
      referenced.add(id);
    }
  }
  for (const transform of ((
    value.rollManipulation as Record<string, unknown> | undefined
  )?.transforms ?? []) as readonly Record<string, unknown>[]) {
    if (typeof transform.limitEconomy === 'string') {
      referenced.add(transform.limitEconomy);
    }
  }
  const standIns = Object.fromEntries(
    [...referenced]
      .filter((id) => !Object.hasOwn(existing, id))
      .map((id) => [id, { kind: 'at-will' }]),
  );
  return {
    ...value,
    ...(Object.keys(existing).length === 0 && Object.keys(standIns).length === 0
      ? {}
      : { economies: { ...existing, ...standIns } }),
  };
}

describe('M9 spell interop and M10 roll manipulation family projection', () => {
  it('pins exact reviewed 7+7 parent memberships and three Ioun variant scopes', () => {
    expect(MAGIC_ITEM_SPELL_INTEROP_NAMES).toEqual([
      'Ring of Spell Storing',
      'Rod of Absorption',
      'Ioun Stone',
      'Pearl of Power',
      'Spell Scroll',
      'Candle of Invocation',
      'Staff of the Magi',
    ]);
    expect(MAGIC_ITEM_ROLL_MANIPULATION_NAMES).toEqual([
      'Luck Blade',
      'Ring of Evasion',
      'Scarab of Protection',
      'Staff of Charming',
      'Ring of Spell Turning',
      'Rod of Absorption',
      'Talisman of the Sphere',
    ]);
    expect(MAGIC_ITEM_SPELL_INTEROP_VARIANTS).toEqual([
      'Ioun Stone::Reserve',
      'Ioun Stone::Absorption',
      'Ioun Stone::Greater Absorption',
    ]);
    expect(new Set(MAGIC_ITEM_SPELL_INTEROP_NAMES).size).toBe(7);
    expect(new Set(MAGIC_ITEM_ROLL_MANIPULATION_NAMES).size).toBe(7);
    for (const name of new Set([
      ...MAGIC_ITEM_SPELL_INTEROP_NAMES.filter(
        (entry) => entry !== 'Ioun Stone',
      ),
      ...MAGIC_ITEM_ROLL_MANIPULATION_NAMES,
    ])) {
      expect(projection(name).family, name).toBe('m9-m10-spell-roll-interop');
    }
    expect(
      projectMagicItemSpellRollInterop(named('Wand of Wonder')),
    ).toBeUndefined();
  });

  it('projects Ring of Spell Storing capacity, overflow, caster-of-record, and freeing semantics', () => {
    expect(spellContracts('Ring of Spell Storing')).toEqual([
      expect.objectContaining({
        id: 'ring-spell',
        kind: 'spell-storage',
        capacityLevels: 5,
        maximumSpellLevel: 5,
        initialLevels: '1d6-1',
        casterOfRecord: expect.stringContaining('original caster'),
        storeOn: expect.objectContaining({
          note: expect.stringContaining('over-capacity spell is expended'),
        }),
        castOut: expect.objectContaining({
          note: expect.stringContaining('free its slot-level space'),
        }),
      }),
    ]);
    expect(
      JSON.stringify(projection('Ring of Spell Storing').mechanics),
    ).not.toContain('storedSpells');
  });

  it('projects Rod of Absorption as separate lifetime/current energy contracts plus shared cancellation', () => {
    expect(spellContracts('Rod of Absorption')[0]).toMatchObject({
      kind: 'spell-energy',
      capacityLevels: 50,
      lifetimeCapacityLevels: 50,
      maximumSpellLevel: 5,
      initialLevels: '1d10',
      operationIds: ['m9-absorb-rod-spell', 'm9-cast-with-rod-energy'],
      onExhausted: expect.stringContaining('becomes nonmagical'),
      note: expect.stringContaining('distinct live item_state counters'),
    });
    expect(transforms('Rod of Absorption')).toEqual([
      expect.objectContaining({
        id: 'm10-rod-cancel',
        kind: 'cancel',
        operationId: 'm9-absorb-rod-spell',
        replacement: expect.stringContaining('store energy, not the spell'),
      }),
    ]);
  });

  it('projects only the three reviewed Ioun spell variants with exact capacities', () => {
    const ioun = named('Ioun Stone');
    const variants = new Map(
      (ioun.variants ?? []).map((variant) => [variant.name, variant]),
    );
    const projectVariant = (name: string) =>
      projectMagicItemSpellRollInteropVariant(
        'Ioun Stone',
        variants.get(name) as MagicItemVariant,
      );
    expect(
      (
        projectVariant('Reserve')?.mechanics.spellStore as unknown as Record<
          string,
          unknown
        >
      ).contracts,
    ).toEqual([
      expect.objectContaining({
        kind: 'spell-storage',
        variant: 'Reserve',
        capacityLevels: 3,
        maximumSpellLevel: 3,
        initialLevels: '1d4-1',
      }),
    ]);
    expect(
      (
        projectVariant('Absorption')?.mechanics.spellStore as unknown as Record<
          string,
          unknown
        >
      ).contracts,
    ).toEqual([
      expect.objectContaining({
        lifetimeCapacityLevels: 20,
        maximumSpellLevel: 4,
      }),
    ]);
    expect(
      (
        projectVariant('Greater Absorption')?.mechanics
          .spellStore as unknown as Record<string, unknown>
      ).contracts,
    ).toEqual([
      expect.objectContaining({
        lifetimeCapacityLevels: 50,
        maximumSpellLevel: 8,
      }),
    ]);
    expect(projectVariant('Agility')).toBeUndefined();
  });

  it('projects Pearl, Scroll, Candle, and Staff without private slot or charge execution', () => {
    expect(spellContracts('Pearl of Power')[0]).toMatchObject({
      kind: 'slot-recovery',
      maximumSpellLevel: 3,
      operationIds: ['regain-spell-slot'],
      condition: expect.stringContaining('4th level or higher'),
    });
    expect(spellContracts('Spell Scroll')[0]).toMatchObject({
      kind: 'scroll-casting',
      operationIds: ['cast-spell', 'copy-spell'],
      tableRefs: ['table:spell-scroll'],
      condition: expect.stringContaining('DC 10 + spell level'),
    });
    expect(spellContracts('Candle of Invocation')[0]).toMatchObject({
      kind: 'free-casting',
      maximumSpellLevel: 1,
      condition: expect.stringContaining('alignment matches'),
    });
    expect(spellContracts('Staff of the Magi')[0]).toMatchObject({
      kind: 'charge-absorption',
      capacityLevels: 50,
      overflow: expect.stringContaining('retributive strike'),
    });
  });

  it('projects all M10 transforms, including Staff of Charming dual modes', () => {
    expect(transforms('Luck Blade')).toEqual([
      expect.objectContaining({
        kind: 'reroll',
        replacement: 'must use second roll',
        limitEconomy: 'luck',
      }),
    ]);
    expect(transforms('Ring of Evasion')[0]).toMatchObject({
      kind: 'replace-fail',
      roll: 'Dexterity saving throw',
      replacement: 'success',
    });
    expect(transforms('Scarab of Protection')[0]).toMatchObject({
      condition: expect.stringContaining('necromancy'),
      replacement: 'success',
    });
    expect(transforms('Staff of Charming')).toEqual([
      expect.objectContaining({ kind: 'replace-fail' }),
      expect.objectContaining({ kind: 'reflect' }),
    ]);
    expect(transforms('Ring of Spell Turning')[0]).toMatchObject({
      kind: 'reflect',
      maximumSpellLevel: 7,
      roll: 'saving throw natural 20',
    });
    expect(transforms('Talisman of the Sphere')[0]).toMatchObject({
      kind: 'pb-double',
      multiplier: 2,
    });
  });

  it('binds M10 transforms to F1/F9 and M9 contracts to F4/F5', () => {
    for (const name of MAGIC_ITEM_ROLL_MANIPULATION_NAMES) {
      const hooks = projection(name)
        .clauses.filter((entry) => entry.tag === 'M10')
        .flatMap((entry) => entry.engineHooks ?? [])
        .map((entry) => entry.engine);
      expect(hooks, name).toContain('F1');
      expect(hooks, name).toContain('F9');
    }
    for (const name of MAGIC_ITEM_SPELL_INTEROP_NAMES.filter(
      (entry) => entry !== 'Ioun Stone',
    )) {
      const hooks = projection(name)
        .clauses.filter((entry) => entry.tag === 'M9')
        .flatMap((entry) => entry.engineHooks ?? [])
        .map((entry) => entry.engine);
      expect(hooks, name).toContain('F4');
    }
  });

  it('passes the canonical schema for every parent and reviewed Ioun variant', () => {
    for (const name of new Set([
      ...MAGIC_ITEM_SPELL_INTEROP_NAMES.filter(
        (entry) => entry !== 'Ioun Stone',
      ),
      ...MAGIC_ITEM_ROLL_MANIPULATION_NAMES,
    ])) {
      expect(() =>
        validateMagicItemMechanics(
          withSiblingEconomyStandIns(projection(name).mechanics),
          `magic-item:${name}.mechanics`,
        ),
      ).not.toThrow();
    }
    const ioun = named('Ioun Stone');
    for (const variantName of ['Reserve', 'Absorption', 'Greater Absorption']) {
      const variant = ioun.variants?.find(
        (candidate) => candidate.name === variantName,
      );
      if (variant === undefined) throw new Error(`missing ${variantName}`);
      const result = projectMagicItemSpellRollInteropVariant(
        'Ioun Stone',
        variant,
      );
      expect(() =>
        validateMagicItemMechanics(
          result?.mechanics,
          `magic-item:ioun-stone:${variantName}.mechanics`,
        ),
      ).not.toThrow();
    }
  });

  it('rejects loose spell contracts, dangling local refs, and incomplete transforms', () => {
    expect(() =>
      validateMagicItemMechanics({
        spellStore: {
          contracts: [
            {
              id: 'burnout',
              kind: 'spell-cancellation',
              lifetimeCapacityLevels: 20,
              maximumSpellLevel: 4,
              capacityLevels: 20,
              absorbOn: { cost: 'reaction' },
              operationIds: ['cancel-spell'],
              onExhausted: 'burns out',
            },
          ],
        },
      }),
    ).toThrow(/cannot store or cast spell energy/);
    expect(() =>
      validateMagicItemMechanics({
        operations: [{ id: 'known-operation' }],
        rollManipulation: {
          transforms: [
            {
              id: 'bad-reflect',
              kind: 'reflect',
              trigger: 'successful save',
              operationId: 'missing-operation',
              replacement: 'reflect spell',
            },
          ],
        },
      }),
    ).toThrow(/unknown operation/);
    expect(() =>
      validateMagicItemMechanics({
        rollManipulation: {
          transforms: [
            {
              id: 'bad-reroll',
              kind: 'reroll',
              trigger: 'after a roll',
              operationId: 'reroll',
            },
          ],
        },
      }),
    ).toThrow(/replacement is required/);
  });

  it('resolves canonical table/item references and keeps IDs stable by namespace', () => {
    for (const ref of MAGIC_ITEM_SPELL_ROLL_REFERENCES) {
      expect(recordKeys.has(ref), ref).toBe(true);
    }
    const clauseIds = new Set<string>();
    for (const name of new Set([
      ...MAGIC_ITEM_SPELL_INTEROP_NAMES.filter(
        (entry) => entry !== 'Ioun Stone',
      ),
      ...MAGIC_ITEM_ROLL_MANIPULATION_NAMES,
    ])) {
      for (const itemClause of projection(name).clauses) {
        expect(clauseIds.has(itemClause.id), itemClause.id).toBe(false);
        clauseIds.add(itemClause.id);
      }
    }
    expect(clauseIds.size).toBeGreaterThan(25);
  });

  it('fails loudly on parent and variant source drift', () => {
    const ring = named('Ring of Spell Storing');
    expect(() =>
      projectMagicItemSpellRollInterop({
        ...ring,
        description: ring.description.replace(
          'store up to 5 levels worth of spells at a time',
          'store several spells',
        ),
      }),
    ).toThrow(/expected source phrase.*store up to 5 levels/);

    const ioun = named('Ioun Stone');
    const reserve = ioun.variants?.find(
      (variant) => variant.name === 'Reserve',
    );
    expect(() =>
      projectMagicItemSpellRollInteropVariant('Ioun Stone', {
        ...(reserve as MagicItemVariant),
        text: (reserve as MagicItemVariant).text.replace(
          'store up to 3 levels worth of spells at a time',
          'store spells',
        ),
      }),
    ).toThrow(/expected source phrase.*store up to 3 levels/);
  });
});
