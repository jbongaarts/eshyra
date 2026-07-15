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
        }),
      }),
      expect.objectContaining({
        kind: 'dice',
        addedDice: '2d6',
        subject: expect.objectContaining({
          semanticId: 'arcane hand:grasping-hand',
        }),
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
