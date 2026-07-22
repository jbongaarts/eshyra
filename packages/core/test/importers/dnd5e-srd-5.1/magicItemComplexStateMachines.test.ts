import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectMagicItemChargeEconomies } from '../../../scripts/importers/dnd5e-srd-5.1/magicItemChargeEconomies.js';
import { aggregateMagicItemFamilyProjections } from '../../../scripts/importers/dnd5e-srd-5.1/magicItemCompiler.js';
import {
  MAGIC_ITEM_COMPLEX_M5_NAMES,
  MAGIC_ITEM_COMPLEX_M5_REFERENCES,
  projectMagicItemComplexStateMachine,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemComplexStateMachines.js';
import { projectMagicItemConsumable } from '../../../scripts/importers/dnd5e-srd-5.1/magicItemConsumables.js';
import { MAGIC_ITEM_SIMPLE_M5_NAMES } from '../../../scripts/importers/dnd5e-srd-5.1/magicItemSimpleStateMachines.js';
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
function named(name: string): MagicItemExtraction {
  const record = items.find((candidate) => candidate.name === name);
  if (record === undefined) throw new Error(`missing fixture ${name}`);
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
  const record = items.find((candidate) => candidate.name === name);
  if (record === undefined) throw new Error(`missing fixture ${name}`);
  return { ...record, data: { ...(record.data as object), mechanics } };
}

describe('complex M5 state-machine complement', () => {
  it('pins the exact 20-item complement and canonical table references', () => {
    expect(MAGIC_ITEM_COMPLEX_M5_NAMES).toHaveLength(20);
    expect(
      new Set([...MAGIC_ITEM_SIMPLE_M5_NAMES, ...MAGIC_ITEM_COMPLEX_M5_NAMES])
        .size,
    ).toBe(50);
    for (const ref of MAGIC_ITEM_COMPLEX_M5_REFERENCES)
      expect(keys.has(ref), ref).toBe(true);
  });
  it('projects apparatus, cube, rod, sphere, and fortress goldens', () => {
    expect(
      projectMagicItemComplexStateMachine(named('Apparatus of the Crab')),
    ).toMatchObject({
      mechanics: {
        effects: [
          {
            tableRef: 'table:apparatus-of-the-crab-levers',
            depthDamage: {
              dice: '2d6',
              type: 'bludgeoning',
              interval: { amount: 1, unit: 'minute' },
            },
          },
        ],
        stateMachine: { initial: 'sealed' },
      },
    });
    expect(
      projectMagicItemComplexStateMachine(named('Apparatus of the Crab'))
        ?.clauses,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          representation: expect.objectContaining({ adjudicated: true }),
        }),
      ]),
    );
    const cube = projectMagicItemComplexStateMachine(named('Cube of Force'));
    expect(cube?.mechanics.operations?.[0]).toMatchObject({
      id: 'press-face-1',
    });
    expect(cube?.mechanics.effects).toMatchObject([
      { tableRef: 'table:cube-of-force-faces' },
      { tableRef: 'table:cube-of-force-charges-lost' },
    ]);
    expect(cube?.mechanics.stateMachine?.states.map(({ id }) => id)).toEqual([
      'inactive',
      'face-1',
      'face-2',
      'face-3',
      'face-4',
      'face-5',
    ]);
    expect(
      cube?.mechanics.stateMachine?.transitions.filter(
        ({ via }) => via === 'press-face-6',
      ),
    ).toEqual(
      [1, 2, 3, 4, 5].map((face) => ({
        from: `face-${face}`,
        to: 'inactive',
        via: 'press-face-6',
      })),
    );
    // The barrier "lasts for 1 minute". Only pressing a different face resets
    // that duration; spell contact merely deducts charges.
    expect(
      cube?.mechanics.stateMachine?.transitions.filter(
        ({ resetsDuration }) => resetsDuration === true,
      ),
    ).toEqual(
      [1, 2, 3, 4, 5].map((face) => ({
        from: `face-${face}`,
        to: `face-${face}`,
        via: `press-face-${face}`,
        resetsDuration: true,
      })),
    );
    expect(
      cube?.mechanics.stateMachine?.transitions.filter(
        ({ timer }) => timer !== undefined,
      ),
    ).toEqual(
      [1, 2, 3, 4, 5].map((face) => ({
        from: `face-${face}`,
        to: 'inactive',
        timer: { amount: 1, unit: 'minute' },
      })),
    );
    expect(cube?.mechanics.stateMachine?.duration).toEqual({
      amount: 1,
      unit: 'minute',
    });
    const rod = projectMagicItemComplexStateMachine(
      named('Rod of Lordly Might'),
    );
    expect(rod?.mechanics.stateMachine?.states.map(({ id }) => id)).toEqual([
      'mace',
      'flame-tongue',
      'battleaxe',
      'spear',
      'climbing-pole',
      'battering-ram',
    ]);
    for (const [state, button] of [
      ['flame-tongue', 1],
      ['battleaxe', 2],
      ['spear', 3],
      ['climbing-pole', 4],
      ['battering-ram', 5],
    ] as const) {
      expect(rod?.mechanics.stateMachine?.transitions).toContainEqual({
        from: state,
        to: 'mace',
        via: `press-button-${button}`,
      });
    }
    const sphere = projectMagicItemComplexStateMachine(
      named('Sphere of Annihilation'),
    );
    expect(sphere?.mechanics.stateMachine?.initial).toBe('uncontrolled');
    expect(sphere?.mechanics.operations?.[0]).toMatchObject({
      id: 'attempt-control',
      effects: ['m5-complex-sphere-failed-control'],
    });
    expect(sphere?.mechanics.effects?.[0]).toMatchObject({
      trigger: 'the DC 25 Intelligence (Arcana) check fails',
      result: 'the sphere moves 10 feet toward the actor who attempted control',
    });
    expect(
      projectMagicItemComplexStateMachine(
        named('Instant Fortress'),
      )?.mechanics.stateMachine?.states.map(({ id }) => id),
    ).toEqual(['cube', 'fortress', 'destroyed']);
  });

  it('merges the same operation IDs with the existing C1/M1 owners', () => {
    for (const name of MAGIC_ITEM_COMPLEX_M5_NAMES) {
      const item = named(name);
      const projections = [
        projectMagicItemChargeEconomies(item),
        projectMagicItemUseEconomies(item),
        projectMagicItemConsumable(item),
        projectMagicItemComplexStateMachine(item),
      ].filter((projection) => projection !== undefined);
      expect(
        () => aggregateMagicItemFamilyProjections(projections),
        name,
      ).not.toThrow();
    }
  });
  it('source-anchors and schema-validates every complex projection', () => {
    for (const name of MAGIC_ITEM_COMPLEX_M5_NAMES) {
      const projection = projectMagicItemComplexStateMachine(named(name));
      expect(projection, name).toBeDefined();
      expect(() =>
        validateRecordKindSchema(
          schemaRecord(name, projection?.mechanics),
          name,
        ),
      ).not.toThrow();
    }
  });
  it('fails closed on drift, unrelated items, and unresolved refs', () => {
    expect(
      projectMagicItemComplexStateMachine(named('Flame Tongue')),
    ).toBeUndefined();
    const cube = named('Cube of Force');
    expect(() =>
      projectMagicItemComplexStateMachine({
        ...cube,
        description: cube.description.replace(
          'cube loses charges when the barrier is targeted by certain spells',
          'barrier flickers',
        ),
      }),
    ).toThrow(/expected source phrase/);
    expect(() =>
      projectMagicItemComplexStateMachine({
        ...cube,
        description: cube.description.replace(
          'expending the requisite number of charges, resetting the duration',
          'expending the requisite number of charges',
        ),
      }),
    ).toThrow(/resetting the duration/);
    expect(
      [...MAGIC_ITEM_COMPLEX_M5_REFERENCES, 'table:not-in-srd'].filter(
        (ref) => !keys.has(ref),
      ),
    ).toEqual(['table:not-in-srd']);
  });
});
