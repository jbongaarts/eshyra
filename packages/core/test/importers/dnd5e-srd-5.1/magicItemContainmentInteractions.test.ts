import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAGIC_ITEM_M6_M11_REFERENCES,
  MAGIC_ITEM_M6_NAMES,
  MAGIC_ITEM_M11_NAMES,
  projectMagicItemContainmentInteractions,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemContainmentInteractions.js';
import type { MagicItemExtraction } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
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

function named(name: string): MagicItemExtraction {
  const record = magicItems.find((candidate) => candidate.name === name);
  if (record === undefined) throw new Error(`missing fixture ${name}`);
  const data = record.data as Record<string, unknown>;
  return {
    name,
    itemType: data.itemType as string,
    rarity: data.rarity as string,
    requiresAttunement: data.requiresAttunement as boolean,
    description: data.description as string,
    sourcePage: 1,
  };
}

function mechanics(name: string): Record<string, unknown> {
  const projection = projectMagicItemContainmentInteractions(named(name));
  if (projection === undefined) throw new Error(`missing projection ${name}`);
  return projection.mechanics as unknown as Record<string, unknown>;
}

describe('M6/M11 magic-item containment and interaction projection', () => {
  it('pins exact reviewed memberships with the intended overlap', () => {
    expect(MAGIC_ITEM_M6_NAMES).toEqual([
      'Bag of Devouring',
      'Bag of Holding',
      'Efficient Quiver',
      'Handy Haversack',
      'Iron Flask',
      'Mirror of Life Trapping',
      'Portable Hole',
      'Robe of Stars',
      'Rod of Security',
      'Well of Many Worlds',
    ]);
    expect(MAGIC_ITEM_M11_NAMES).toEqual([
      'Bag of Holding',
      'Handy Haversack',
      'Portable Hole',
      'Hammer of Thunderbolts',
      'Oil of Slipperiness',
      'Sovereign Glue',
      'Universal Solvent',
      'Talisman of the Sphere',
      'Sphere of Annihilation',
    ]);
    expect(MAGIC_ITEM_M6_NAMES).toHaveLength(10);
    expect(MAGIC_ITEM_M11_NAMES).toHaveLength(9);
    expect(
      MAGIC_ITEM_M6_NAMES.filter((name) => MAGIC_ITEM_M11_NAMES.includes(name)),
    ).toEqual(['Bag of Holding', 'Handy Haversack', 'Portable Hole']);
  });

  it('source-binds and schema-validates every reviewed projection', () => {
    for (const name of new Set([
      ...MAGIC_ITEM_M6_NAMES,
      ...MAGIC_ITEM_M11_NAMES,
    ])) {
      const projection = projectMagicItemContainmentInteractions(named(name));
      expect(projection?.family, name).toBe('m6-m11-containment-interactions');
      validateMagicItemMechanics(
        projection?.mechanics,
        `magic-item:${name}.mechanics`,
        () => {},
      );
      expect(projection?.clauses.map((clause) => clause.tag)).toEqual([
        ...(MAGIC_ITEM_M6_NAMES.includes(name) ? ['M6'] : []),
        ...(MAGIC_ITEM_M11_NAMES.includes(name) ? ['M11'] : []),
      ]);
    }
  });

  it('models all twelve mirror cells, overflow, release, and shatter without live occupancy', () => {
    expect(mechanics('Mirror of Life Trapping').containment).toEqual({
      mode: 'cells',
      tracksOccupancy: true,
      capacity: { creatures: 12 },
      cells: {
        count: 12,
        occupantsPerCell: 1,
        environment: 'infinite expanse of thick fog; visibility 10 feet',
        noAging: true,
        noNeeds: ['eat', 'drink', 'sleep'],
        overflowRelease: 'random-occupant',
      },
      entry: {
        trigger:
          'eligible creature sees its reflection while mirror is active and fails the declared save',
        result: 'creature and everything worn or carried enter one cell',
      },
      exit: {
        trigger: 'occupant uses magic that permits planar travel',
        result: 'occupant escapes its cell',
      },
      release: {
        activation: { cost: 'action', commandWord: true },
        destination: 'nearest unoccupied space facing away from the mirror',
        result:
          'free one creature selected by name or cell number with its possessions',
      },
      overflow:
        'free one random current occupant before trapping the new prisoner',
      rupture: {
        triggers: ['mirror reduced to 0 hit points and shattered'],
        destroysItem: true,
        contentsDestination: 'unoccupied spaces near the mirror',
      },
    });
    expect(
      JSON.stringify(mechanics('Mirror of Life Trapping').containment),
    ).not.toMatch(/occupantId|currentOccupants|cellAssignments/);
  });

  it('models typed quiver compartments and the three extradimensional nesting hazards', () => {
    expect(
      (mechanics('Efficient Quiver').containment as { compartments: unknown[] })
        .compartments,
    ).toEqual([
      expect.objectContaining({
        id: 'shortest',
        capacity: { count: 60 },
      }),
      expect.objectContaining({
        id: 'midsize',
        capacity: { count: 18 },
      }),
      expect.objectContaining({ id: 'longest', capacity: { count: 6 } }),
    ]);
    for (const name of ['Bag of Holding', 'Handy Haversack', 'Portable Hole']) {
      expect(mechanics(name).interItem).toEqual({
        nestingHazard: expect.objectContaining({
          withItemRefs: expect.arrayContaining(
            [
              'magic-item:bag-of-holding',
              'magic-item:handy-haversack',
              'magic-item:portable-hole',
            ].filter(
              (ref) =>
                ref !== `magic-item:${name.toLowerCase().replaceAll(' ', '-')}`,
            ),
          ),
          destroys: 'both-items',
          affectsRadiusFeet: 10,
          portal: {
            direction: 'one-way',
            destination: 'random location on the Astral Plane',
            closure: 'closes immediately and cannot be reopened',
          },
        }),
      });
    }
  });

  it('models hammer prerequisites, adhesive counters, and sphere relationships by canonical refs', () => {
    expect(mechanics('Hammer of Thunderbolts').interItem).toEqual({
      requiresItems: [
        expect.objectContaining({
          itemRefs: [
            'magic-item:belt-of-giant-strength',
            'magic-item:gauntlets-of-ogre-power',
          ],
          allRequired: true,
          state: 'both worn continuously while attuned',
        }),
      ],
    });
    expect(mechanics('Sovereign Glue').interItem).toMatchObject({
      counters: [
        {
          itemRefs: [
            'magic-item:universal-solvent',
            'magic-item:oil-of-etherealness',
          ],
          interaction: 'dissolves',
          targetRef: 'magic-item:sovereign-glue',
          note: expect.any(String),
        },
      ],
    });
    expect(mechanics('Talisman of the Sphere').interItem).toMatchObject({
      counters: [
        expect.objectContaining({
          interaction: 'enhances-control',
          targetRef: 'magic-item:sphere-of-annihilation',
        }),
      ],
    });
    expect(mechanics('Sphere of Annihilation').interItem).toMatchObject({
      portalInteraction: {
        tableRefs: ['table:sphere-of-annihilation'],
        procedure: expect.stringContaining('source table'),
      },
    });
  });

  it('resolves every curated item, spell, and table reference against the actual pack', () => {
    expect(new Set(MAGIC_ITEM_M6_M11_REFERENCES).size).toBeGreaterThan(10);
    for (const ref of new Set(MAGIC_ITEM_M6_M11_REFERENCES)) {
      expect(recordKeys.has(ref), ref).toBe(true);
    }
  });

  it('rejects malformed containment and inter-item payloads fail-closed', () => {
    expect(() =>
      validateMagicItemMechanics(
        {
          containment: {
            mode: 'cells',
            cells: {
              count: 0,
              occupantsPerCell: 1,
              environment: 'fog',
              overflowRelease: 'random-occupant',
            },
          },
        },
        'mirror.mechanics',
        () => {},
      ),
    ).toThrow(/cells.count/);
    expect(() =>
      validateMagicItemMechanics(
        {
          interItem: {
            requiresItems: [
              {
                itemRefs: ['spell:gate'],
                allRequired: true,
                state: 'worn',
              },
            ],
          },
        },
        'hammer.mechanics',
        () => {},
      ),
    ).toThrow(/magic-item: references/);
    expect(() =>
      validateMagicItemMechanics(
        {
          containment: {
            mode: 'storage',
            capacity: { count: 1 },
            currentOccupants: ['creature:goblin'],
          },
        },
        'bag.mechanics',
        () => {},
      ),
    ).toThrow(/unsupported key "currentOccupants"/);
  });

  it('fails loudly on flagship and interaction source drift', () => {
    const mirror = named('Mirror of Life Trapping');
    expect(() =>
      projectMagicItemContainmentInteractions({
        ...mirror,
        description: mirror.description.replaceAll(
          'twelve extradimensional cells',
          'several cells',
        ),
      }),
    ).toThrow(/expected source phrase.*twelve extradimensional cells/);
    const glue = named('Sovereign Glue');
    expect(() =>
      projectMagicItemContainmentInteractions({
        ...glue,
        description: glue.description.replace(
          'coated inside with oil of slipperiness',
          'specially coated',
        ),
      }),
    ).toThrow(/expected source phrase.*oil of slipperiness/);
  });

  it('excludes nearby storage and portal items outside the reviewed families', () => {
    expect(
      projectMagicItemContainmentInteractions(named('Bag of Tricks')),
    ).toBeUndefined();
    expect(
      projectMagicItemContainmentInteractions(named('Cape of the Mountebank')),
    ).toBeUndefined();
  });
});
