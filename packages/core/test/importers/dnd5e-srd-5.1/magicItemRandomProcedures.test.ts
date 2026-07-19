import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAGIC_ITEM_M8_NAMES,
  MAGIC_ITEM_M8_REFERENCES,
  projectMagicItemRandomProcedures,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemRandomProcedures.js';
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
const keys = new Set(records.map((record) => record.key));

function named(name: string): MagicItemExtraction {
  const record = records.find(
    (candidate) => candidate.kind === 'magic-item' && candidate.name === name,
  );
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

function randomProcedure(name: string) {
  const projection = projectMagicItemRandomProcedures(named(name));
  if (projection === undefined) throw new Error(`missing projection ${name}`);
  return projection.mechanics.randomProcedure;
}

describe('M8 magic-item random-procedure projection', () => {
  it('pins the exact eighteen-row reviewed census', () => {
    expect(MAGIC_ITEM_M8_NAMES).toEqual([
      'Amulet of the Planes',
      'Bag of Beans',
      'Deck of Illusions',
      'Deck of Many Things',
      'Efreeti Bottle',
      'Figurine of Wondrous Power',
      'Helm of Brilliance',
      'Horn of Blasting',
      'Iron Flask',
      'Necklace of Prayer Beads',
      'Ring of Spell Storing',
      'Robe of Useful Items',
      'Sphere of Annihilation',
      'Staff of Power',
      'Staff of the Magi',
      'Sword of Sharpness',
      'Wand of Wonder',
      'Wind Fan',
    ]);
    expect(MAGIC_ITEM_M8_NAMES).toHaveLength(18);
  });

  it('source-binds, validates, and sends every random procedure to F1', () => {
    for (const name of MAGIC_ITEM_M8_NAMES) {
      const projection = projectMagicItemRandomProcedures(named(name));
      expect(projection?.family, name).toBe('m8-random-procedures');
      validateMagicItemMechanics(
        projection?.mechanics,
        `${name}.mechanics`,
        () => {},
      );
      expect(projection?.clauses).toHaveLength(1);
      expect(projection?.clauses[0]?.tag).toBe('M8');
      expect(
        projection?.clauses[0]?.engineHooks?.some(
          (hook) => hook.engine === 'F1',
        ),
      ).toBe(true);
    }
  });

  it('keeps every table reference resolvable against the committed source pack', () => {
    expect(MAGIC_ITEM_M8_REFERENCES.length).toBeGreaterThan(0);
    for (const ref of MAGIC_ITEM_M8_REFERENCES)
      expect(keys.has(ref), ref).toBe(true);
    const expectedRows = new Map([
      ['table:bag-of-beans', 12],
      ['table:deck-of-illusions', 33],
      ['table:deck-of-many-things', 22],
      ['table:efreeti-bottle', 3],
      ['table:iron-flask', 20],
      ['table:necklace-of-prayer-beads', 6],
      ['table:robe-of-useful-items', 13],
      ['table:sphere-of-annihilation', 3],
      ['table:staff-of-power', 3],
      ['table:staff-of-the-magi', 3],
      ['table:wand-of-wonder', 22],
    ]);
    expect(new Set(MAGIC_ITEM_M8_REFERENCES)).toEqual(
      new Set(expectedRows.keys()),
    );
    for (const [ref, count] of expectedRows) {
      const record = records.find((candidate) => candidate.key === ref);
      const data = record?.data as { rows?: unknown[] } | undefined;
      expect(data?.rows, ref).toHaveLength(count);
    }
  });

  it('pins declared draws, the one-hour deadline, returning cards, and both exact deck variants', () => {
    expect(randomProcedure('Deck of Many Things')).toEqual({
      procedures: [
        {
          id: 'initial-deck-variant',
          kind: 'initial-state',
          trigger: 'deck instance is discovered',
          risk: { percent: 75 },
          outcome:
            '75 percent initializes the thirteen-card variant; otherwise initialize the twenty-two-card variant',
        },
        expect.objectContaining({
          id: 'declared-card-draw',
          kind: 'declared-draw',
          selectionField: 'remainingCardIds',
          tableRef: 'table:deck-of-many-things',
          outcome: expect.stringContaining('within 1 hour'),
        }),
      ],
      customState: expect.objectContaining({
        kind: 'card-pool',
        nonReturningCardIds: ['fool', 'jester'],
        variants: [
          expect.objectContaining({
            id: 'thirteen-card',
            initialCardIds: expect.arrayContaining(['sun', 'jester']),
          }),
          expect.objectContaining({
            id: 'twenty-two-card',
            initialCardIds: expect.arrayContaining([
              'vizier',
              'fool',
              'jester',
            ]),
          }),
        ],
      }),
    });
    expect(
      randomProcedure('Deck of Many Things')?.customState?.variants[0]
        ?.initialCardIds,
    ).toHaveLength(13);
    expect(
      randomProcedure('Deck of Many Things')?.customState?.variants[1]
        ?.initialCardIds,
    ).toHaveLength(22);
  });

  it('pins missing-count, cumulative-risk, nested-roll, and wand meta-rule regressions', () => {
    expect(randomProcedure('Helm of Brilliance')?.procedures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'failed-fire-save-destruction',
          outcome: expect.stringContaining('DC 17 Dexterity saving throw'),
        }),
      ]),
    );
    expect(randomProcedure('Staff of Power')?.procedures[0]).toMatchObject({
      outcome: expect.stringContaining('DC 17 Dexterity saving throw'),
    });
    expect(randomProcedure('Staff of the Magi')?.procedures[0]).toMatchObject({
      outcome: expect.stringContaining('DC 17 Dexterity saving throw'),
    });
    expect(randomProcedure('Deck of Illusions')?.procedures[0]).toMatchObject({
      roll: '1d20-1',
      tableRef: 'table:deck-of-illusions',
    });
    expect(randomProcedure('Wind Fan')?.procedures[0]).toMatchObject({
      risk: { percent: 20, cumulative: true, incrementPercent: 20 },
    });
    expect(randomProcedure('Sword of Sharpness')?.procedures[0]).toMatchObject({
      kind: 'nested-roll',
      roll: '1d20',
    });
    expect(randomProcedure('Wand of Wonder')?.procedures[0]).toMatchObject({
      roll: '1d100',
      tableRef: 'table:wand-of-wonder',
      procedureNote: expect.stringContaining('subordinate random roll'),
    });
  });

  it('fails closed when a reviewed source anchor drifts', () => {
    const item = named('Wind Fan');
    expect(() =>
      projectMagicItemRandomProcedures({
        ...item,
        description: item.description.replace(
          'cumulative 20 percent chance',
          'some chance',
        ),
      }),
    ).toThrow(/expected source phrase/);
  });

  it('rejects free-form card state and unseeded procedure shapes', () => {
    expect(() =>
      validateMagicItemMechanics({
        randomProcedure: {
          procedures: [
            {
              id: 'draw',
              kind: 'declared-draw',
              trigger: 'draw',
              outcome: 'resolve',
            },
          ],
        },
      }),
    ).toThrow(/roll, selectionField, or risk/);
    expect(() =>
      validateMagicItemMechanics({
        randomProcedure: {
          procedures: [
            {
              id: 'draw',
              kind: 'declared-draw',
              trigger: 'draw',
              selectionField: 'remainingCardIds',
              outcome: 'resolve',
            },
          ],
          customState: { kind: 'anything' },
        },
      }),
    ).toThrow(/unsupported key|card-pool/);
  });
});
