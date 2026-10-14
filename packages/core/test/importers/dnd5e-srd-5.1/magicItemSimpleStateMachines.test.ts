import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectMagicItemChargeEconomies } from '../../../scripts/importers/dnd5e-srd-5.1/magicItemChargeEconomies.js';
import { aggregateMagicItemFamilyProjections } from '../../../scripts/importers/dnd5e-srd-5.1/magicItemCompiler.js';
import { projectMagicItemConsumable } from '../../../scripts/importers/dnd5e-srd-5.1/magicItemConsumables.js';
import {
  MAGIC_ITEM_SIMPLE_M5_DEFERRED_COMPLEX_NAMES,
  MAGIC_ITEM_SIMPLE_M5_NAMES,
  projectMagicItemSimpleStateMachine,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemSimpleStateMachines.js';
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

describe('regular/simple M5 state-machine projection', () => {
  it('pins an exact conservation split of all 50 reviewed M5 rows', () => {
    expect(MAGIC_ITEM_SIMPLE_M5_NAMES).toHaveLength(30);
    expect(MAGIC_ITEM_SIMPLE_M5_DEFERRED_COMPLEX_NAMES).toHaveLength(20);
    expect(
      new Set([
        ...MAGIC_ITEM_SIMPLE_M5_NAMES,
        ...MAGIC_ITEM_SIMPLE_M5_DEFERRED_COMPLEX_NAMES,
      ]).size,
    ).toBe(50);

    const inventory = readFileSync(
      join(
        process.cwd(),
        'docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-7-3-magic-item-mechanics-inventory.md',
      ),
      'utf8',
    );
    const reviewed = [...inventory.matchAll(/^\| ([a-z0-9-]+) \| ([^|]+) \|/gm)]
      .filter((match) =>
        match[2]
          .split(',')
          .map((tag) => tag.trim())
          .includes('M5'),
      )
      .map((match) => `magic-item:${match[1]}`);
    expect(reviewed).toHaveLength(50);
    const classified = new Set([
      ...MAGIC_ITEM_SIMPLE_M5_NAMES,
      ...MAGIC_ITEM_SIMPLE_M5_DEFERRED_COMPLEX_NAMES,
    ]);
    expect(
      reviewed
        .map((key) => itemRecords.find((record) => record.key === key)?.name)
        .filter((name) => name === undefined || !classified.has(name)),
    ).toEqual([]);
  });

  it('projects toggle, coating, suppression, orbit, restraint, counter, and transform goldens', () => {
    expect(
      projectMagicItemSimpleStateMachine(named('Flame Tongue')),
    ).toMatchObject({
      mechanics: {
        stateMachine: {
          initial: 'inactive',
          states: [{ id: 'inactive' }, { id: 'active' }],
        },
      },
    });
    expect(
      projectMagicItemSimpleStateMachine(named('Dagger of Venom')),
    ).toMatchObject({
      mechanics: {
        operations: [{ id: 'coat-blade' }],
        stateMachine: {
          initial: 'uncoated',
          termination: 'first hit or one minute',
        },
      },
    });
    expect(
      projectMagicItemSimpleStateMachine(named('Cloak of Displacement')),
    ).toMatchObject({
      mechanics: {
        stateMachine: { states: [{ id: 'displacing' }, { id: 'suppressed' }] },
      },
    });
    expect(
      projectMagicItemSimpleStateMachine(named('Dancing Sword')),
    ).toMatchObject({
      mechanics: {
        stateMachine: {
          states: [
            { id: 'held' },
            { id: 'attack-zero' },
            { id: 'attack-one' },
            { id: 'attack-two' },
            { id: 'attack-three' },
            { id: 'returning' },
            { id: 'grounded' },
          ],
        },
      },
    });
    expect(
      projectMagicItemSimpleStateMachine(named('Ioun Stone')),
    ).toMatchObject({
      mechanics: {
        stateMachine: {
          states: [{ id: 'stowed' }, { id: 'orbiting' }, { id: 'seized' }],
        },
      },
    });
    expect(
      projectMagicItemSimpleStateMachine(named('Staff of the Python')),
    ).toMatchObject({
      mechanics: {
        stateMachine: {
          initial: 'staff',
          states: [{ id: 'staff' }, { id: 'python' }, { id: 'destroyed' }],
        },
      },
    });
    expect(
      projectMagicItemSimpleStateMachine(named('Dimensional Shackles')),
    ).toMatchObject({
      mechanics: {
        stateMachine: {
          transitions: [
            {},
            {},
            {
              onFailure: {
                retryAfter: { amount: 30, unit: 'day' },
                scope: 'actor',
                to: 'bound',
              },
            },
          ],
        },
      },
    });
    expect(
      projectMagicItemSimpleStateMachine(named('Iron Bands of Binding')),
    ).toMatchObject({
      mechanics: {
        stateMachine: {
          transitions: [
            {},
            {},
            {
              onFailure: {
                retryAfter: { amount: 24, unit: 'hour' },
                scope: 'actor',
                to: 'restraining',
              },
            },
          ],
        },
      },
    });
  });

  it('source-anchors and schema-validates every simple projection', () => {
    for (const name of MAGIC_ITEM_SIMPLE_M5_NAMES) {
      const projection = projectMagicItemSimpleStateMachine(named(name));
      expect(projection, name).toBeDefined();
      expect(() =>
        validateRecordKindSchema(
          schemaRecord(name, projection?.mechanics),
          name,
        ),
      ).not.toThrow();
    }
  });

  it('keeps every generated condition transition source-complete and unique per state', () => {
    for (const record of itemRecords) {
      const data = record.data as Record<string, unknown>;
      const mechanics = data.mechanics as Record<string, unknown> | undefined;
      const machine = mechanics?.stateMachine as
        | { transitions?: Record<string, unknown>[] }
        | undefined;
      if (machine?.transitions === undefined) continue;
      const seen = new Set<string>();
      for (const transition of machine.transitions) {
        if (typeof transition.condition !== 'string') continue;
        expect(
          data.description,
          `${record.name}: ${transition.condition}`,
        ).toContain(transition.condition);
        const key = `${String(transition.from)}\u0000${transition.condition}`;
        expect(
          seen.has(key),
          `${record.name}: duplicate ${transition.condition}`,
        ).toBe(false);
        seen.add(key);
      }
    }
  });

  it("treats the Ioun Stone's other-creature action as an external event with its full predicate", () => {
    const machine = projectMagicItemSimpleStateMachine(named('Ioun Stone'))
      ?.mechanics.stateMachine;
    const seizure = machine?.transitions.find(
      (transition) =>
        transition.from === 'orbiting' && transition.to === 'seized',
    );
    expect(seizure).toEqual({
      from: 'orbiting',
      to: 'seized',
      condition:
        'Thereafter, another creature must use an action to grasp or net the stone to separate it from you, either by making a successful attack roll against AC 24 or a successful DC 24 Dexterity (Acrobatics) check',
    });
    const generated = itemRecords.find(
      (record) => record.name === 'Ioun Stone',
    );
    expect(generated?.data).toMatchObject({
      mechanics: {
        stateMachine: {
          transitions: expect.arrayContaining([
            {
              from: 'orbiting',
              to: 'seized',
              condition:
                'Thereafter, another creature must use an action to grasp or net the stone to separate it from you, either by making a successful attack roll against AC 24 or a successful DC 24 Dexterity (Acrobatics) check',
            },
          ]),
        },
      },
    });
    if (generated === undefined)
      throw new Error('missing generated Ioun Stone');
    const generatedMechanics = (generated.data as Record<string, unknown>)
      .mechanics as { operations: { id: string }[] };
    expect(
      generatedMechanics.operations.map((entry) => entry.id),
    ).not.toContain('grab-orbiting-stone');
  });

  it('carries the Animated Shield termination placement clause verbatim in the generated pack', () => {
    const generated = itemRecords.find(
      (record) => record.name === 'Animated Shield',
    );
    expect(generated?.data).toMatchObject({
      executionReadiness: {
        clauses: expect.arrayContaining([
          expect.objectContaining({
            clauseId:
              'magic-item:animated-shield/state-animated-shield-fall-destination',
            representation: expect.objectContaining({
              adjudicated: true,
              sourceText:
                'at which point the shield falls to the ground or into your hand if you have one free',
            }),
          }),
        ]),
      },
    });
  });

  it('models the Rope target escape as a no-cost external condition event', () => {
    const generated = itemRecords.find(
      (record) => record.name === 'Rope of Entanglement',
    );
    const mechanics = (generated?.data as Record<string, unknown>)
      ?.mechanics as Record<string, unknown>;
    const operations = mechanics.operations as { id: string }[];
    const machine = mechanics.stateMachine as {
      transitions: Record<string, unknown>[];
    };
    expect(operations.map((entry) => entry.id)).not.toContain('escape-rope');
    expect(machine.transitions).toContainEqual({
      from: 'restraining',
      to: 'loose',
      condition:
        'A target restrained by the rope can use an action to make a DC 15 Strength or Dexterity check (target’s choice). On a success, the creature is no longer restrained by the rope.',
    });
    expect(
      operations.find((entry) => entry.id === 'release-creature'),
    ).toBeDefined();
  });

  it('merges the same operation IDs with the existing C1/M1 owners', () => {
    for (const name of MAGIC_ITEM_SIMPLE_M5_NAMES) {
      const item = named(name);
      const projections = [
        projectMagicItemChargeEconomies(item),
        projectMagicItemUseEconomies(item),
        projectMagicItemConsumable(item),
        projectMagicItemSimpleStateMachine(item),
      ].filter((projection) => projection !== undefined);
      expect(
        () => aggregateMagicItemFamilyProjections(projections),
        name,
      ).not.toThrow();
    }
  });

  it('fails closed on unrelated items and source drift', () => {
    expect(
      projectMagicItemSimpleStateMachine(named('Cube of Force')),
    ).toBeUndefined();
    const dagger = named('Dagger of Venom');
    expect(() =>
      projectMagicItemSimpleStateMachine({
        ...dagger,
        description: dagger.description.replace(
          'poison remains for 1 minute or until an attack using this weapon hits',
          'poison remains briefly',
        ),
      }),
    ).toThrow(/expected source phrase/);
  });
});
