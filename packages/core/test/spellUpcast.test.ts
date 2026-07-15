import { describe, expect, it } from 'vitest';
import {
  EXPECTED_CHARACTER_LEVEL_SPELL_KEYS,
  EXPECTED_HIGHER_SLOT_SPELL_KEYS,
} from '../scripts/importers/dnd5e-srd-5.1/spellUpcastInventory.js';
import { compileSpellUpcast } from '../scripts/importers/dnd5e-srd-5.1/upcast.js';
import {
  getBundledDnd5eSrdPack,
  resolveSpellUpcast,
  SpellUpcastError,
} from '../src/internal.js';

const pack = getBundledDnd5eSrdPack();
function spell(ref: string) {
  const record = pack.records.find((candidate) => candidate.key === ref);
  if (record === undefined) throw new Error(`missing ${ref}`);
  return record;
}

describe('source-bound spell upcast resolver', () => {
  it('resolves dice-per-slot scaling exactly without rolling', () => {
    expect(resolveSpellUpcast(spell('spell:fireball'), 5)).toMatchObject({
      spellRef: 'spell:fireball',
      baseSpellLevel: 3,
      selectedSlotLevel: 5,
      levelsAboveBase: 2,
      hasHigherSlotBenefit: true,
      clauseIds: ['fireball:higher-slot'],
      adjustments: [{ kind: 'dice', addedDice: '2d6', sourceOperation: 0 }],
    });
  });

  it('resolves healing, flat, and count families', () => {
    expect(
      resolveSpellUpcast(spell('spell:cure-wounds'), 3).adjustments[0],
    ).toMatchObject({ kind: 'dice', addedDice: '2d8' });
    expect(
      resolveSpellUpcast(spell('spell:aid'), 4).adjustments[0],
    ).toMatchObject({ kind: 'flat', amount: 10 });
    expect(
      resolveSpellUpcast(spell('spell:magic-missile'), 3).adjustments[0],
    ).toMatchObject({
      kind: 'count',
      amount: 2,
      subject: { property: 'projectile-count' },
    });
    expect(
      resolveSpellUpcast(spell('spell:aid'), 4).adjustments[0],
    ).toMatchObject({ subject: { property: 'hit-points' } });
    expect(
      resolveSpellUpcast(spell('spell:animal-messenger'), 3).adjustments[0],
    ).toMatchObject({ subject: { property: 'duration-hours' }, amount: 48 });
  });

  it('returns no adjustment at base level and permits a non-scaling spell', () => {
    expect(resolveSpellUpcast(spell('spell:fireball'), 3).adjustments).toEqual(
      [],
    );
    expect(resolveSpellUpcast(spell('spell:shield'), 1)).toMatchObject({
      hasHigherSlotBenefit: false,
      adjustments: [],
    });
  });

  it('reuses S1 summoning scaling rather than emitting a second generic operation', () => {
    expect(resolveSpellUpcast(spell('spell:conjure-animals'), 3)).toMatchObject(
      {
        hasHigherSlotBenefit: false,
        adjustments: [],
      },
    );
    expect(resolveSpellUpcast(spell('spell:conjure-animals'), 4)).toMatchObject(
      {
        hasHigherSlotBenefit: false,
        adjustments: [],
      },
    );
    expect(resolveSpellUpcast(spell('spell:conjure-animals'), 5)).toMatchObject(
      {
        hasHigherSlotBenefit: true,
        adjustments: [{ threshold: 5, multiplier: 2 }],
      },
    );
    const result = resolveSpellUpcast(spell('spell:conjure-animals'), 7);
    expect(result.qualifier).toBeUndefined();
    expect(result.adjustments).toEqual([
      {
        kind: 'summoning',
        subject: { kind: 'summoning', semanticId: 'creation-menu-counts' },
        sourceOperation: 's1',
        scalingKind: 'slot-multipliers',
        appliesTo: 'creation-menu-counts',
        threshold: 7,
        multiplier: 3,
      },
    ]);
  });

  it('retains S1 creation and control-reassertion scopes and option semantics', () => {
    expect(
      resolveSpellUpcast(spell('spell:animate-dead'), 4).adjustments,
    ).toEqual([
      {
        kind: 'summoning',
        subject: { kind: 'summoning', semanticId: 'summoning-cardinality' },
        sourceOperation: 's1',
        scalingKind: 'per-slot-cardinality',
        appliesTo: ['creation', 'control-reassertion'],
        amount: 2,
      },
    ]);
    expect(
      resolveSpellUpcast(spell('spell:create-undead'), 8).adjustments,
    ).toEqual([
      {
        kind: 'summoning',
        subject: { kind: 'summoning', semanticId: 'summoning-option-menu' },
        sourceOperation: 's1',
        scalingKind: 'slot-option-menu',
        appliesTo: ['creation', 'control-reassertion'],
        selection: 'choose-one',
        threshold: 8,
        choices: [
          {
            creatureRefs: ['creature:ghoul'],
            cardinality: { mode: 'maximum', count: 5 },
          },
          {
            creatureRefs: ['creature:ghast', 'creature:wight'],
            cardinality: { mode: 'maximum', count: 2 },
            composition: {
              kind: 'source-ambiguity',
              ambiguityId: 'ambiguity:create-undead-ghast-wight-composition',
            },
          },
        ],
      },
    ]);
  });

  it('corrects and resolves Animal Friendship per-slot cardinality exactly', () => {
    const animalFriendship = spell('spell:animal-friendship');
    expect(
      (animalFriendship.data as Record<string, unknown>).higherLevels,
    ).toBe(
      'When you cast this spell using a spell slot of 2nd level or higher, you can affect one additional beast t level above 1st.',
    );
    expect(resolveSpellUpcast(animalFriendship, 1).adjustments).toEqual([]);
    for (const [slotLevel, amount] of [
      [2, 1],
      [3, 2],
      [9, 8],
    ] as const) {
      expect(
        resolveSpellUpcast(animalFriendship, slotLevel).adjustments,
      ).toEqual([
        {
          kind: 'count',
          subject: {
            kind: 'effect',
            semanticId: 'animal friendship:effect',
            property: 'creature-count',
          },
          amount,
          sourceOperation: 0,
        },
      ]);
    }
    expect(() =>
      compileSpellUpcast({
        name: 'Animal Friendships',
        level: 1,
        school: 'enchantment',
        ritual: false,
        castingTime: '1 action',
        range: '30 feet',
        components: ['V', 'S', 'M'],
        duration: '24 hours',
        description: 'Source fixture.',
        higherLevels:
          'When you cast this spell using a spell slot of 2nd level or higher, you can affect one additional beast t level above 1st.',
        scalingSourceKind: 'higher-slot',
        scalingSourceText:
          'When you cast this spell using a spell slot of 2nd level or higher, you can affect one additional beast t level above 1st.',
        sourcePage: 115,
      }),
    ).toThrow(/malformed Animal Friendship/);
  });

  it('binds independently scaled same-type damage components and local damage types', () => {
    expect(resolveSpellUpcast(spell('spell:acid-arrow'), 3)).toEqual({
      spellRef: 'spell:acid-arrow',
      spellName: 'Acid Arrow',
      baseSpellLevel: 2,
      selectedSlotLevel: 3,
      levelsAboveBase: 1,
      hasHigherSlotBenefit: true,
      clauseIds: ['acid-arrow:higher-slot'],
      adjustments: [
        {
          kind: 'dice',
          subject: {
            kind: 'damage',
            damageType: 'acid',
            semanticId: 'acid arrow:initial-damage',
            property: 'damage-dice',
          },
          addedDice: '1d4',
          sourceOperation: 0,
        },
        {
          kind: 'dice',
          subject: {
            kind: 'damage',
            damageType: 'acid',
            semanticId: 'acid arrow:later-damage',
            property: 'damage-dice',
          },
          addedDice: '1d4',
          sourceOperation: 1,
        },
      ],
    });
    expect(resolveSpellUpcast(spell('spell:ice-storm'), 5).adjustments).toEqual(
      [
        expect.objectContaining({
          subject: expect.objectContaining({ damageType: 'bludgeoning' }),
        }),
      ],
    );
    expect(
      resolveSpellUpcast(spell('spell:flame-strike'), 6).adjustments,
    ).toEqual([
      expect.objectContaining({
        subject: expect.objectContaining({
          damageTypes: ['fire', 'radiant'],
          selection: 'choose-one',
        }),
      }),
    ]);
  });

  it('keeps Arcane Hand component damage independent without a duplicate generic dice operation', () => {
    expect(
      resolveSpellUpcast(spell('spell:arcane-hand'), 6).adjustments,
    ).toMatchObject([
      expect.objectContaining({
        kind: 'dice',
        addedDice: '2d8',
        subject: expect.objectContaining({
          semanticId: 'arcane hand:clenched-fist',
          damageType: 'force',
        }),
      }),
      expect.objectContaining({
        kind: 'dice',
        addedDice: '2d6',
        subject: expect.objectContaining({
          semanticId: 'arcane hand:grasping-hand',
          damageType: 'bludgeoning',
        }),
      }),
    ]);
  });

  it('resolves every reviewed multi-threshold schedule on one semantic axis', () => {
    const schedules = [
      [
        'spell:dominate-beast',
        4,
        {
          5: 'concentration, up to 10 minutes',
          6: 'concentration, up to 1 hour',
          7: 'concentration, up to 8 hours',
        },
      ],
      [
        'spell:dominate-person',
        5,
        {
          6: 'concentration, up to 10 minutes',
          7: 'concentration, up to 1 hour',
          8: 'concentration, up to 8 hours',
        },
      ],
      [
        'spell:mass-suggestion',
        6,
        { 7: '10 days', 8: '30 days', 9: 'a year and a day' },
      ],
      [
        'spell:planar-binding',
        5,
        { 6: '10 days', 7: '30 days', 8: '180 days', 9: 'a year and a day' },
      ],
      [
        'spell:modify-memory',
        5,
        {
          6: 'up to 7 days ago',
          7: 'up to 30 days ago',
          8: 'up to 1 year ago',
          9: 'any time in the creature’s past',
        },
      ],
      [
        'spell:bestow-curse',
        3,
        {
          4: 'concentration, up to 10 minutes',
          5: '8 hours, no concentration',
          7: '24 hours, no concentration',
          9: 'until dispelled, no concentration',
        },
      ],
      ['spell:geas', 5, { 7: '1 year', 9: 'until ended by an allowed spell' }],
      [
        'spell:hunters-mark',
        1,
        {
          3: 'concentration, up to 8 hours',
          5: 'concentration, up to 24 hours',
        },
      ],
      ['spell:magic-weapon', 2, { 4: '+2', 6: '+3' }],
    ] as const;
    for (const [ref, base, thresholds] of schedules) {
      for (let slot = base; slot <= 9; slot += 1) {
        const applicable = Object.entries(thresholds)
          .map(([level, value]) => [Number(level), value] as const)
          .filter(([level]) => level <= slot)
          .sort(([left], [right]) => right - left)[0];
        const adjustments = resolveSpellUpcast(spell(ref), slot).adjustments;
        expect(adjustments, `${ref} at slot ${slot}`).toEqual(
          applicable === undefined
            ? []
            : [
                expect.objectContaining({
                  kind: 'threshold',
                  threshold: applicable[0],
                  value: applicable[1],
                }),
              ],
        );
      }
    }
  });

  it('does not fabricate an interval threshold for Spiritual Weapon', () => {
    expect(
      resolveSpellUpcast(spell('spell:spiritual-weapon'), 3),
    ).toMatchObject({
      hasHigherSlotBenefit: false,
      adjustments: [],
    });
    expect(
      resolveSpellUpcast(spell('spell:spiritual-weapon'), 4).adjustments,
    ).toEqual([expect.objectContaining({ kind: 'dice', addedDice: '1d8' })]);
  });

  it('represents damage choices, all-components scaling, and named component types', () => {
    expect(
      resolveSpellUpcast(spell('spell:wall-of-thorns'), 7).adjustments,
    ).toEqual([
      expect.objectContaining({
        subject: expect.objectContaining({
          damageTypes: ['piercing', 'slashing'],
          application: 'all-components',
        }),
      }),
    ]);
  });

  it('covers every independent reviewed branch and gates retained qualifiers', () => {
    expect(
      resolveSpellUpcast(spell('spell:create-or-destroy-water'), 3).adjustments,
    ).toEqual([
      expect.objectContaining({
        kind: 'count',
        amount: 20,
        subject: expect.objectContaining({
          property: 'volume-gallons',
          selection: 'choose-one',
          choiceGroup: 'create-or-destroy-water:scaled-mode',
        }),
      }),
      expect.objectContaining({
        kind: 'flat',
        amount: 10,
        subject: expect.objectContaining({
          property: 'cube-size-feet',
          selection: 'choose-one',
          choiceGroup: 'create-or-destroy-water:scaled-mode',
        }),
      }),
    ]);
    const glyphBase = resolveSpellUpcast(spell('spell:glyph-of-warding'), 3);
    expect(glyphBase.qualifier).toBeUndefined();
    const glyphUpcast = resolveSpellUpcast(spell('spell:glyph-of-warding'), 4);
    expect(glyphUpcast).toMatchObject({
      hasHigherSlotBenefit: true,
      adjustments: [expect.objectContaining({ addedDice: '1d8' })],
      qualifier:
        'If you create a spell glyph, you can store any spell of up to the same level as the slot you use for the glyph of warding.',
    });
  });

  it('compiles both Wall of Ice damage components without qualifier leakage', () => {
    expect(resolveSpellUpcast(spell('spell:wall-of-ice'), 6)).toMatchObject({
      hasHigherSlotBenefit: false,
      adjustments: [],
    });
    expect(
      resolveSpellUpcast(spell('spell:wall-of-ice'), 6).qualifier,
    ).toBeUndefined();
    expect(
      resolveSpellUpcast(spell('spell:wall-of-ice'), 7).adjustments,
    ).toEqual([
      expect.objectContaining({
        addedDice: '2d6',
        subject: expect.objectContaining({
          damageType: 'cold',
          semanticId: 'wall of ice:appearing-wall-damage',
        }),
      }),
      expect.objectContaining({
        addedDice: '1d6',
        subject: expect.objectContaining({
          damageType: 'cold',
          semanticId: 'wall of ice:frigid-air-damage',
        }),
      }),
    ]);
  });

  it('distinguishes affected-HP-pool dice from damage and flat healing points', () => {
    expect(
      resolveSpellUpcast(spell('spell:color-spray'), 2).adjustments,
    ).toEqual([
      expect.objectContaining({
        addedDice: '2d10',
        subject: {
          kind: 'affected-hit-points',
          semanticId: 'color spray:affected-hit-point-pool',
          property: 'affected-hit-point-pool-dice',
        },
      }),
    ]);
    expect(resolveSpellUpcast(spell('spell:sleep'), 2).adjustments).toEqual([
      expect.objectContaining({
        addedDice: '2d8',
        subject: {
          kind: 'affected-hit-points',
          semanticId: 'sleep:affected-hit-point-pool',
          property: 'affected-hit-point-pool-dice',
        },
      }),
    ]);
    expect(resolveSpellUpcast(spell('spell:heal'), 7).adjustments).toEqual([
      expect.objectContaining({
        kind: 'flat',
        amount: 10,
        subject: {
          kind: 'healing',
          semanticId: 'heal:healing',
          property: 'healing-points',
        },
      }),
    ]);
  });

  it('fails closed for cantrips, illegal slots, source drift, and malformed payloads', () => {
    expect(() => resolveSpellUpcast(spell('spell:fire-bolt'), 1)).toThrow(
      SpellUpcastError,
    );
    expect(() => resolveSpellUpcast(spell('spell:fireball'), 2)).toThrow(
      SpellUpcastError,
    );
    expect(() => resolveSpellUpcast(spell('spell:fireball'), 10)).toThrow(
      SpellUpcastError,
    );
    const drifted = structuredClone(spell('spell:fireball'));
    (drifted.data as Record<string, unknown>).higherLevels = 'drift';
    expect(() => resolveSpellUpcast(drifted, 4)).toThrow(
      /source phrase drifted/,
    );
    const pageDrift = structuredClone(spell('spell:fireball'));
    const data = pageDrift.data as Record<string, unknown>;
    (data.upcast as Record<string, unknown>).sourcePage = 999;
    expect(() => resolveSpellUpcast(pageDrift, 4)).toThrow(
      /source page drifted/,
    );
  });

  it('pins independent source-marker membership and dispositions', () => {
    const spells = pack.records.filter((record) => record.kind === 'spell');
    const higher = spells.filter((record) => {
      const data = record.data as Record<string, unknown>;
      return data.scalingSourceKind === 'higher-slot';
    });
    const cantrips = spells.filter(
      (record) =>
        (record.data as Record<string, unknown>).scalingSourceKind ===
        'character-level',
    );
    expect(higher.map((record) => record.key)).toEqual(
      EXPECTED_HIGHER_SLOT_SPELL_KEYS,
    );
    expect(cantrips.map((record) => record.key)).toEqual(
      EXPECTED_CHARACTER_LEVEL_SPELL_KEYS,
    );
    expect(
      cantrips.every(
        (record) =>
          (record.data as Record<string, unknown>).upcast === undefined,
      ),
    ).toBe(true);
    const eldritchBlast = spell('spell:eldritch-blast');
    expect(eldritchBlast.data).toMatchObject({
      scalingSourceKind: 'character-level',
      scalingSourceText:
        'The spell creates more than one beam when you reach higher levels: two beams at 5th level, three beams at 11th level, and four beams at 17th level.',
    });
    expect(
      higher.every(
        (record) =>
          (record.data as Record<string, unknown>).upcast !== undefined,
      ),
    ).toBe(true);
    expect(
      higher.every((record) =>
        [
          'complete-typed-upcast',
          'existing-s1-typed-scaling',
          'typed-core-with-model-qualifier',
        ].includes(
          (
            (record.data as Record<string, unknown>).upcast as Record<
              string,
              unknown
            >
          ).disposition as string,
        ),
      ),
    ).toBe(true);
  });
});
