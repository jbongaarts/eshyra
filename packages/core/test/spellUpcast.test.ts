import { describe, expect, it } from 'vitest';
import {
  EXPECTED_CHARACTER_LEVEL_SPELL_KEYS,
  EXPECTED_HIGHER_SLOT_SOURCE_SHA256,
  EXPECTED_HIGHER_SLOT_SPELL_KEYS,
} from '../scripts/importers/dnd5e-srd-5.1/spellUpcastInventory.js';
import { compileSpellUpcast } from '../scripts/importers/dnd5e-srd-5.1/upcast.js';
import {
  getBundledDnd5eSrdPack,
  parseSpellUpcastSpec,
  resolveSpellUpcast as resolveSpellUpcastFromSource,
  SpellUpcastError,
  validateRecordKindSchema,
} from '../src/internal.js';

const pack = getBundledDnd5eSrdPack();
function spell(ref: string) {
  const record = pack.records.find((candidate) => candidate.key === ref);
  if (record === undefined) throw new Error(`missing ${ref}`);
  return record;
}

function resolveSpellUpcast(
  record: ReturnType<typeof spell>,
  slotLevel: number,
) {
  return resolveSpellUpcastFromSource(
    {
      record,
      pack: pack.meta,
      overrideChain: [],
    },
    slotLevel,
  );
}

function compileRecordWithClause(
  ref: string,
  higherLevels: string,
  sourcePage?: number,
) {
  const record = spell(ref);
  const data = record.data as Record<string, unknown>;
  return compileSpellUpcast({
    name: record.name,
    level: data.level as number,
    school: data.school as string,
    ritual: data.ritual === true,
    castingTime: data.castingTime as string,
    range: data.range as string,
    components: data.components as readonly string[],
    duration: data.duration as string,
    description: data.description as string,
    higherLevels,
    scalingSourceKind: 'higher-slot',
    scalingSourceText: higherLevels,
    sourcePage:
      sourcePage ?? Number(/p(?:p)?\.\s*(\d+)/i.exec(record.source)?.[1]),
  });
}

const duration = (
  amount: number,
  unit: 'minute' | 'hour' | 'day' | 'year',
  concentration: boolean,
  upTo = false,
) => ({
  kind: 'duration' as const,
  amount,
  unit,
  concentration,
  ...(upTo ? { upTo: true as const } : {}),
});

describe('source-bound spell upcast resolver', () => {
  it('resolves dice-per-slot scaling exactly without rolling', () => {
    expect(resolveSpellUpcast(spell('spell:fireball'), 5)).toMatchObject({
      spellRef: 'spell:fireball',
      baseSpellLevel: 3,
      selectedSlotLevel: 5,
      levelsAboveBase: 2,
      hasHigherSlotBenefit: true,
      clauseIds: ['fireball:higher-slot'],
      sourceBindings: [
        {
          clauseId: 'fireball:higher-slot',
          packId: 'rules:dnd5e-srd-5.1',
          packVersion: '5.1',
          sourceRef:
            'https://dnd.wizards.com/resources/systems-reference-document',
          locator: 'p. 144',
          sourcePage: 144,
          sourcePhrase:
            'When you cast this spell using a spell slot of 4th level or higher, the damage increases by 1d6 for each slot level above 3rd.',
          operationIds: ['fireball:damage:dice-per-slot'],
          overrideChain: [],
        },
      ],
      adjustments: [
        {
          kind: 'dice',
          addedDice: '2d6',
          sourceOperationId: 'fireball:damage:dice-per-slot',
        },
      ],
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
    ).toMatchObject({
      subject: { property: 'current-and-maximum-hit-points' },
    });
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

  it('replays to byte-identical source-bound evidence', () => {
    const first = resolveSpellUpcast(spell('spell:wall-of-ice'), 9);
    const replay = resolveSpellUpcast(spell('spell:wall-of-ice'), 9);
    expect(JSON.stringify(replay)).toBe(JSON.stringify(first));
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
        sourceOperationId: 's1:creation-menu-counts:slot-multipliers',
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
        sourceOperationId:
          's1:summoning-cardinality:per-slot-cardinality:base-3',
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
        sourceOperationId: 's1:summoning-option-menu:slot-option-menu',
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
    const extractedSourcePhrase =
      'When you cast this spell using a spell slot of 2nd level or higher, you can affect one additional beast t level above 1st.';
    const reviewedSourcePhrase =
      'When you cast this spell using a spell slot of 2nd level or higher, you can affect one additional beast for each slot level above 1st.';
    const sourceCorrection = {
      id: 'dnd5e-srd-5.1:animal-friendship:higher-slot:text-layer-omission',
      extractedSourcePhrase,
      extractedSourceSha256:
        EXPECTED_HIGHER_SLOT_SOURCE_SHA256['spell:animal-friendship'],
      reviewedSourcePhrase,
      note: 'The PDF text layer omitted "for each slot"; the reviewed text restores the source-backed phrase used to derive the count-per-slot operation.',
    };
    expect(
      (animalFriendship.data as Record<string, unknown>).higherLevels,
    ).toBe(extractedSourcePhrase);
    expect(
      (
        (animalFriendship.data as Record<string, unknown>).upcast as Record<
          string,
          unknown
        >
      ).sourceCorrection,
    ).toEqual(sourceCorrection);
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
            semanticId: 'animal friendship:additional-beast',
            property: 'creature-count',
            creatureType: 'beast',
          },
          amount,
          sourceOperationId:
            'animal friendship:additional-beast:count-per-slot',
        },
      ]);
    }
    expect(
      resolveSpellUpcast(animalFriendship, 2).sourceBindings[0],
    ).toMatchObject({
      sourcePhrase: reviewedSourcePhrase,
      sourceCorrection,
    });
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
    ).toThrow(/unreviewed higher-slot source clause/);
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
      sourceBindings: [
        {
          clauseId: 'acid-arrow:higher-slot',
          packId: 'rules:dnd5e-srd-5.1',
          packVersion: '5.1',
          sourceRef:
            'https://dnd.wizards.com/resources/systems-reference-document',
          locator: 'p. 114',
          sourcePage: 114,
          sourcePhrase:
            'When you cast this spell using a spell slot of 3rd level or higher, the damage (both initial and later) increases by 1d4 for each slot level above 2nd.',
          operationIds: [
            'acid arrow:initial-damage:dice-per-slot',
            'acid arrow:later-damage:dice-per-slot',
          ],
          overrideChain: [],
        },
      ],
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
          sourceOperationId: 'acid arrow:initial-damage:dice-per-slot',
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
          sourceOperationId: 'acid arrow:later-damage:dice-per-slot',
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
          5: duration(10, 'minute', true, true),
          6: duration(1, 'hour', true, true),
          7: duration(8, 'hour', true, true),
        },
      ],
      [
        'spell:dominate-person',
        5,
        {
          6: duration(10, 'minute', true, true),
          7: duration(1, 'hour', true, true),
          8: duration(8, 'hour', true, true),
        },
      ],
      [
        'spell:mass-suggestion',
        6,
        {
          7: duration(10, 'day', false),
          8: duration(30, 'day', false),
          9: {
            ...duration(1, 'year', false),
            additionalDays: 1,
          },
        },
      ],
      [
        'spell:planar-binding',
        5,
        {
          6: duration(10, 'day', false),
          7: duration(30, 'day', false),
          8: duration(180, 'day', false),
          9: {
            ...duration(1, 'year', false),
            additionalDays: 1,
          },
        },
      ],
      [
        'spell:modify-memory',
        5,
        {
          6: { kind: 'memory-age', amount: 7, unit: 'day' },
          7: { kind: 'memory-age', amount: 30, unit: 'day' },
          8: { kind: 'memory-age', amount: 1, unit: 'year' },
          9: { kind: 'memory-age', unrestricted: true },
        },
      ],
      [
        'spell:bestow-curse',
        3,
        {
          4: duration(10, 'minute', true, true),
          5: duration(8, 'hour', false),
          7: duration(24, 'hour', false),
          9: {
            kind: 'duration',
            ending: 'until-dispelled',
            concentration: false,
          },
        },
      ],
      [
        'spell:geas',
        5,
        {
          7: duration(1, 'year', false),
          9: {
            kind: 'duration',
            ending: 'until-ended-by-allowed-spell',
            concentration: false,
          },
        },
      ],
      [
        'spell:hunters-mark',
        1,
        {
          3: duration(8, 'hour', true, true),
          5: duration(24, 'hour', true, true),
        },
      ],
      [
        'spell:magic-weapon',
        2,
        {
          4: { kind: 'bonus', amount: 2 },
          6: { kind: 'bonus', amount: 3 },
        },
      ],
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

  it('resolves independent multi-threshold schedules on exclusive choice axes', () => {
    const record = structuredClone(spell('spell:magic-weapon'));
    const data = record.data as Record<string, unknown>;
    const upcast = data.upcast as Record<string, unknown>;
    const subject = {
      kind: 'effect',
      semanticId: 'synthetic:shared-choice-threshold',
      property: 'bonus',
    };
    upcast.operations = [
      {
        kind: 'threshold',
        subject,
        choice: { groupId: 'synthetic:mode', optionId: 'branch-a' },
        atSlotLevel: 4,
        value: { kind: 'bonus', amount: 1 },
      },
      {
        kind: 'threshold',
        subject,
        choice: { groupId: 'synthetic:mode', optionId: 'branch-b' },
        atSlotLevel: 5,
        value: { kind: 'bonus', amount: 10 },
      },
      {
        kind: 'threshold',
        subject,
        choice: { groupId: 'synthetic:mode', optionId: 'branch-a' },
        atSlotLevel: 6,
        value: { kind: 'bonus', amount: 2 },
      },
      {
        kind: 'threshold',
        subject,
        choice: { groupId: 'synthetic:mode', optionId: 'branch-b' },
        atSlotLevel: 7,
        value: { kind: 'bonus', amount: 20 },
      },
    ];

    expect(resolveSpellUpcast(record, 5).adjustments).toEqual([
      expect.objectContaining({
        threshold: 4,
        choice: { groupId: 'synthetic:mode', optionId: 'branch-a' },
        value: { kind: 'bonus', amount: 1 },
      }),
      expect.objectContaining({
        threshold: 5,
        choice: { groupId: 'synthetic:mode', optionId: 'branch-b' },
        value: { kind: 'bonus', amount: 10 },
      }),
    ]);
    expect(resolveSpellUpcast(record, 7).adjustments).toEqual([
      expect.objectContaining({
        threshold: 6,
        choice: { groupId: 'synthetic:mode', optionId: 'branch-a' },
        value: { kind: 'bonus', amount: 2 },
      }),
      expect.objectContaining({
        threshold: 7,
        choice: { groupId: 'synthetic:mode', optionId: 'branch-b' },
        value: { kind: 'bonus', amount: 20 },
      }),
    ]);
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
        kind: 'flat',
        amount: 20,
        choice: {
          groupId: 'create-or-destroy-water:scaled-mode',
          optionId: 'water-volume',
        },
        subject: expect.objectContaining({
          property: 'volume-gallons',
        }),
      }),
      expect.objectContaining({
        kind: 'flat',
        amount: 10,
        choice: {
          groupId: 'create-or-destroy-water:scaled-mode',
          optionId: 'cube-size',
        },
        subject: expect.objectContaining({
          property: 'cube-size-feet',
        }),
      }),
    ]);
    const glyphBase = resolveSpellUpcast(spell('spell:glyph-of-warding'), 3);
    expect(glyphBase.qualifier).toBeUndefined();
    const glyphUpcast = resolveSpellUpcast(spell('spell:glyph-of-warding'), 4);
    expect(glyphUpcast).toMatchObject({
      hasHigherSlotBenefit: true,
      adjustments: [
        expect.objectContaining({ addedDice: '1d8' }),
        expect.objectContaining({ kind: 'slot-value', amount: 4 }),
      ],
    });
    expect(glyphUpcast.qualifier).toBeUndefined();
  });

  it('fails closed when any reviewed projection source tuple drifts', () => {
    expect(Object.keys(EXPECTED_HIGHER_SLOT_SOURCE_SHA256)).toEqual(
      EXPECTED_HIGHER_SLOT_SPELL_KEYS,
    );
    for (const ref of EXPECTED_HIGHER_SLOT_SPELL_KEYS) {
      const raw = (spell(ref).data as Record<string, unknown>)
        .higherLevels as string;
      expect(
        () => compileRecordWithClause(ref, `${raw} Source drift.`),
        ref,
      ).toThrow(/source phrase drift/);
      const page = Number(/p(?:p)?\.\s*(\d+)/i.exec(spell(ref).source)?.[1]);
      expect(
        () => compileRecordWithClause(ref, raw, page + 100),
        `${ref} page`,
      ).toThrow(/source page drift/);
    }
  });

  it('resolves Etherealness as a maximum total that includes the caster', () => {
    expect(resolveSpellUpcast(spell('spell:etherealness'), 7)).toMatchObject({
      hasHigherSlotBenefit: false,
      adjustments: [],
    });
    for (const [slotLevel, amount] of [
      [8, 3],
      [9, 6],
    ] as const) {
      expect(
        resolveSpellUpcast(spell('spell:etherealness'), slotLevel).adjustments,
      ).toEqual([
        {
          kind: 'count',
          subject: {
            kind: 'effect',
            semanticId: 'etherealness:willing-creature-maximum',
            property: 'creature-count',
            cardinalityMode: 'maximum-total',
            includesCaster: true,
            willingTargets: true,
            allTargetsWithinFeetOfCaster: 10,
          },
          amount,
          sourceOperationId:
            'etherealness:willing-creature-maximum:count-per-slot',
        },
      ]);
    }
  });

  it('resolves Dispel Magic automatic ending to the selected slot level', () => {
    expect(
      resolveSpellUpcast(spell('spell:dispel-magic'), 3).adjustments,
    ).toEqual([]);
    for (const slotLevel of [4, 5, 9]) {
      expect(
        resolveSpellUpcast(spell('spell:dispel-magic'), slotLevel).adjustments,
      ).toEqual([
        {
          kind: 'slot-value',
          subject: {
            kind: 'effect',
            semanticId: 'dispel magic:automatic-spell-level-threshold',
            property: 'spell-level-threshold',
          },
          amount: slotLevel,
          sourceOperationId:
            'dispel magic:automatic-spell-level-threshold:selected-slot-value:min-4',
        },
      ]);
    }
  });

  it('types Counterspell and both exclusive Glyph of Warding branches', () => {
    expect(
      resolveSpellUpcast(spell('spell:counterspell'), 3).adjustments,
    ).toEqual([]);
    for (const slotLevel of [4, 5, 9]) {
      expect(
        resolveSpellUpcast(spell('spell:counterspell'), slotLevel).adjustments,
      ).toEqual([
        {
          kind: 'slot-value',
          subject: {
            kind: 'effect',
            semanticId: 'counterspell:automatic-spell-level-threshold',
            property: 'spell-level-threshold',
          },
          amount: slotLevel,
          sourceOperationId:
            'counterspell:automatic-spell-level-threshold:selected-slot-value:min-4',
        },
      ]);
    }
    const glyph = resolveSpellUpcast(spell('spell:glyph-of-warding'), 5);
    expect(glyph.qualifier).toBeUndefined();
    expect(glyph.adjustments).toEqual([
      expect.objectContaining({
        kind: 'dice',
        addedDice: '2d8',
        choice: {
          groupId: 'glyph-of-warding:mode',
          optionId: 'explosive-runes',
        },
      }),
      {
        kind: 'slot-value',
        subject: {
          kind: 'effect',
          semanticId: 'glyph of warding:stored-spell-level-threshold',
          property: 'spell-level-threshold',
        },
        amount: 5,
        sourceOperationId:
          'glyph of warding:stored-spell-level-threshold:selected-slot-value:min-4:choice:glyph-of-warding:mode:spell-glyph',
        choice: {
          groupId: 'glyph-of-warding:mode',
          optionId: 'spell-glyph',
        },
      },
    ]);
  });

  it('binds paired HP, scalar volume, target geometry, and Wall of Fire components', () => {
    expect(
      resolveSpellUpcast(spell('spell:aid'), 4).adjustments[0],
    ).toMatchObject({
      kind: 'flat',
      amount: 10,
      subject: { property: 'current-and-maximum-hit-points' },
    });
    expect(
      resolveSpellUpcast(spell('spell:create-or-destroy-water'), 3)
        .adjustments[0],
    ).toMatchObject({
      kind: 'flat',
      amount: 20,
      subject: { property: 'volume-gallons' },
    });
    for (const ref of [
      'spell:charm-person',
      'spell:command',
      'spell:hold-monster',
      'spell:hold-person',
    ]) {
      const record = spell(ref);
      const level = (record.data as Record<string, unknown>).level as number;
      expect(
        resolveSpellUpcast(record, level + 1).adjustments[0],
      ).toMatchObject({
        subject: { maximumSeparationFeet: 30 },
      });
    }
    expect(
      resolveSpellUpcast(spell('spell:hold-person'), 3).adjustments[0],
    ).toMatchObject({ subject: { creatureType: 'humanoid' } });
    expect(
      resolveSpellUpcast(spell('spell:chain-lightning'), 9).adjustments[0],
    ).toMatchObject({
      kind: 'count',
      amount: 3,
      subject: {
        property: 'projectile-count',
        projectileOrigin: 'first-target',
        projectileDestination: 'different-target',
      },
    });
    expect(
      resolveSpellUpcast(spell('spell:wall-of-fire'), 5).adjustments,
    ).toEqual([
      expect.objectContaining({
        addedDice: '1d8',
        subject: expect.objectContaining({
          semanticId: 'wall of fire:appearing-wall-damage',
        }),
      }),
      expect.objectContaining({
        addedDice: '1d8',
        subject: expect.objectContaining({
          semanticId: 'wall of fire:hot-side-or-entry-damage',
        }),
      }),
    ]);
  });

  it('resolves False Life as a flat temporary-hit-point increase', () => {
    expect(
      resolveSpellUpcast(spell('spell:false-life'), 1).adjustments,
    ).toEqual([]);
    for (const [slotLevel, amount] of [
      [2, 5],
      [4, 15],
      [9, 40],
    ] as const) {
      expect(
        resolveSpellUpcast(spell('spell:false-life'), slotLevel).adjustments,
      ).toEqual([
        {
          kind: 'flat',
          subject: {
            kind: 'effect',
            semanticId: 'false life:temporary-hit-points',
            property: 'temporary-hit-points',
          },
          amount,
          sourceOperationId: 'false life:temporary-hit-points:flat-per-slot',
        },
      ]);
    }
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
      /source phrase must equal/,
    );
    const pageDrift = structuredClone(spell('spell:fireball'));
    const data = pageDrift.data as Record<string, unknown>;
    (data.upcast as Record<string, unknown>).sourcePage = 999;
    expect(() => resolveSpellUpcast(pageDrift, 4)).toThrow(
      /must equal record provenance page/,
    );
    const displayLabelWithoutPage = structuredClone(spell('spell:fireball'));
    (displayLabelWithoutPage as { source: string }).source =
      'SRD display label';
    expect(() => resolveSpellUpcast(displayLabelWithoutPage, 4)).not.toThrow();
    expect(() =>
      validateRecordKindSchema(displayLabelWithoutPage, 'record'),
    ).not.toThrow();
    const missingPage = structuredClone(spell('spell:fireball'));
    (missingPage.provenance as { locator?: string }).locator = undefined;
    expect(() => resolveSpellUpcast(missingPage, 4)).toThrow(
      /requires a source-page locator/,
    );
    expect(() => validateRecordKindSchema(missingPage, 'record')).toThrow(
      /requires a source-page locator/,
    );
    const mismatchedSource = structuredClone(spell('spell:fireball'));
    (mismatchedSource.provenance as { sourceRef: string }).sourceRef =
      'test:wrong-source';
    expect(() => resolveSpellUpcast(mismatchedSource, 4)).toThrow(
      /provenance does not match owning pack/,
    );
    const correctionHashDrift = structuredClone(
      spell('spell:animal-friendship'),
    );
    const correction = (
      (correctionHashDrift.data as Record<string, unknown>).upcast as Record<
        string,
        unknown
      >
    ).sourceCorrection as Record<string, unknown>;
    correction.extractedSourceSha256 = '0'.repeat(64);
    expect(() => resolveSpellUpcast(correctionHashDrift, 2)).toThrow(
      /does not match extractedSourcePhrase/,
    );
  });

  it('uses one closed parser for schema/runtime adversarial payloads', () => {
    const parse = (mutate: (data: Record<string, unknown>) => void) => {
      const record = structuredClone(spell('spell:fireball'));
      const data = record.data as Record<string, unknown>;
      mutate(data);
      return () =>
        parseSpellUpcastSpec({
          recordKey: record.key,
          data,
          provenanceLocator: 'p. 144',
        });
    };
    const upcast = (data: Record<string, unknown>) =>
      data.upcast as Record<string, unknown>;
    const operation = (data: Record<string, unknown>) =>
      (upcast(data).operations as Record<string, unknown>[])[0];
    const subject = (data: Record<string, unknown>) =>
      operation(data).subject as Record<string, unknown>;

    expect(
      parse((data) => {
        upcast(data).unexpected = true;
      }),
    ).toThrow(/unsupported key/);
    const schemaRecord = structuredClone(spell('spell:fireball'));
    const schemaData = schemaRecord.data as Record<string, unknown>;
    (
      (
        (schemaData.upcast as Record<string, unknown>).operations as Record<
          string,
          unknown
        >[]
      )[0] as Record<string, unknown>
    ).unexpected = true;
    expect(() => validateRecordKindSchema(schemaRecord, 'record')).toThrow(
      /unsupported key/,
    );
    expect(
      parse((data) => {
        operation(data).unexpected = true;
      }),
    ).toThrow(/unsupported key/);
    expect(
      parse((data) => {
        subject(data).unexpected = true;
      }),
    ).toThrow(/unsupported key/);
    expect(
      parse((data) => {
        subject(data).damageType = 'water';
      }),
    ).toThrow(/canonical damage type/);
    expect(
      parse((data) => {
        operation(data).dice = '1d6+1';
      }),
    ).toThrow(/canonical NdN/);
    expect(
      parse((data) => {
        operation(data).dice = '999999999999999999999d6';
      }),
    ).toThrow(/canonical NdN/);
    expect(
      parse((data) => {
        operation(data).startSlotLevel = 9;
      }),
    ).toThrow(/through 8/);
    expect(
      parse((data) => {
        operation(data).startSlotLevel = 8;
        operation(data).everySlotLevels = 2;
      }),
    ).toThrow(/cannot apply to a legal spell slot/);
    expect(
      parse((data) => {
        operation(data).kind = 'selected-slot-value';
        operation(data).minSlotLevel = 4;
        operation(data).value = 'selected-slot-level';
        Reflect.deleteProperty(operation(data), 'dice');
        Reflect.deleteProperty(operation(data), 'startSlotLevel');
        Reflect.deleteProperty(operation(data), 'everySlotLevels');
      }),
    ).toThrow(/cannot modify damage-dice/);
    expect(
      parse((data) => {
        upcast(data).disposition = 'existing-s1-typed-scaling';
      }),
    ).toThrow(/cannot duplicate operations/);
    expect(
      parse((data) => {
        operation(data).choice = { groupId: 'g', optionId: '' };
      }),
    ).toThrow(/non-empty string/);
    expect(
      parse((data) => {
        operation(data).choice = { groupId: 'g', optionId: 'only-option' };
      }),
    ).toThrow(/at least two options/);
    expect(
      parse((data) => {
        subject(data).cardinalityMode = 'maximum-total';
      }),
    ).toThrow(/unsupported key/);
    expect(
      parse((data) => {
        const original = operation(data);
        (upcast(data).operations as unknown[]).push({
          everySlotLevels: original.everySlotLevels,
          startSlotLevel: original.startSlotLevel,
          dice: original.dice,
          subject: original.subject,
          kind: original.kind,
        });
      }),
    ).toThrow(/duplicates semantic operation/);
    const thresholds = structuredClone(spell('spell:magic-weapon'));
    const thresholdData = thresholds.data as Record<string, unknown>;
    const thresholdOperations = (
      thresholdData.upcast as Record<string, unknown>
    ).operations as unknown[];
    thresholdOperations.reverse();
    expect(() =>
      parseSpellUpcastSpec({
        recordKey: thresholds.key,
        data: thresholdData,
        provenanceLocator: 'p. 161',
      }),
    ).toThrow(/strictly ordered/);
    expect(
      parse((data) => {
        data.scalingSourceText = 'drift';
      }),
    ).toThrow(/source phrase must equal/);

    const noMechanics = structuredClone(spell('spell:fireball'));
    Reflect.deleteProperty(
      noMechanics.data as Record<string, unknown>,
      'mechanics',
    );
    expect(resolveSpellUpcast(noMechanics, 4).adjustments).toHaveLength(1);
    const malformedS1 = structuredClone(spell('spell:conjure-animals'));
    Reflect.deleteProperty(
      malformedS1.data as Record<string, unknown>,
      'mechanics',
    );
    expect(() => resolveSpellUpcast(malformedS1, 5)).toThrow(
      /S1 upcast disposition requires mechanics effects/,
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
    const reviewedSemanticOracle = higher.map((record) => {
      const data = record.data as Record<string, unknown>;
      const upcast = data.upcast as Record<string, unknown>;
      const projection = {
        disposition: upcast.disposition,
        operations: upcast.operations,
        qualifier: upcast.qualifier ?? null,
      };
      const baseLevel = data.level as number;
      const resolutions = Array.from({ length: 10 - baseLevel }, (_, index) =>
        resolveSpellUpcast(record, baseLevel + index),
      );
      return {
        spellRef: record.key,
        spellName: record.name,
        sourcePage: upcast.sourcePage,
        sourcePhrase: upcast.sourcePhrase,
        projection,
        resolutions,
      };
    });
    expect(reviewedSemanticOracle).toMatchSnapshot();
  });
});
