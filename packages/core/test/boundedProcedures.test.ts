import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  BoundedProcedureRequest,
  FeatureOptionApplicabilityContext,
  RulesPack,
  RulesRecord,
} from '../src/internal.js';
import {
  abilityModifier,
  BoundedProcedureError,
  createSeededRng,
  executeBoundedProcedure,
  resolveD20,
  validateRulesPack,
} from '../src/internal.js';

const PACK_DIR = join(
  process.cwd(),
  'packages/core/data/rules-packs/rules__dnd5e-srd-5.1',
);
const records = JSON.parse(
  readFileSync(join(PACK_DIR, 'records.json'), 'utf8'),
) as readonly RulesRecord[];
const manifest = JSON.parse(
  readFileSync(join(PACK_DIR, 'manifest.json'), 'utf8'),
) as RulesPack['meta'];

function data(key: string): unknown {
  const found = records.find((record) => record.key === key);
  if (found === undefined) throw new Error(`missing test record ${key}`);
  return found.data;
}

describe('bounded provider-neutral procedure execution', () => {
  it('executes both branches and the success-count termination of Burnt Othur Fumes', () => {
    const hazard = data('hazard:burnt-othur-fumes');
    expect(
      executeBoundedProcedure(hazard, {
        kind: 'hazard-save',
        phase: 'initial',
        rollTotal: 13,
      }),
    ).toEqual({
      kind: 'hazard-save',
      succeeded: true,
      successfulSaves: 0,
      repeatActive: false,
      ended: true,
    });
    expect(
      executeBoundedProcedure(hazard, {
        kind: 'hazard-save',
        phase: 'initial',
        rollTotal: 12,
      }),
    ).toEqual({
      kind: 'hazard-save',
      succeeded: false,
      damage: { dice: '3d6', type: 'poison' },
      successfulSaves: 0,
      repeatActive: true,
      ended: false,
    });
    expect(
      executeBoundedProcedure(hazard, {
        kind: 'hazard-save',
        phase: 'repeat',
        rollTotal: 12,
        priorSuccessfulSaves: 0,
        repeatActive: true,
      }),
    ).toEqual({
      kind: 'hazard-save',
      succeeded: false,
      damage: { dice: '1d6', type: 'poison' },
      successfulSaves: 0,
      repeatActive: true,
      ended: false,
    });
    expect(
      executeBoundedProcedure(hazard, {
        kind: 'hazard-save',
        phase: 'repeat',
        rollTotal: 13,
        priorSuccessfulSaves: 2,
        repeatActive: true,
      }),
    ).toEqual({
      kind: 'hazard-save',
      succeeded: true,
      successfulSaves: 3,
      repeatActive: false,
      ended: true,
    });
  });

  it('fails closed when a repeat hazard save is attempted without active recurrence', () => {
    expect(() =>
      executeBoundedProcedure(data('hazard:burnt-othur-fumes'), {
        kind: 'hazard-save',
        phase: 'repeat',
        rollTotal: 13,
        priorSuccessfulSaves: 0,
        repeatActive: false,
      }),
    ).toThrow(BoundedProcedureError);
    expect(() =>
      executeBoundedProcedure(data('hazard:burnt-othur-fumes'), {
        kind: 'hazard-save',
        phase: 'initial',
        rollTotal: 13,
        repeatActive: true,
      }),
    ).toThrow(BoundedProcedureError);
  });

  it('accepts a negative canonical d20 total without treating it as malformed', () => {
    let resolved = resolveD20(
      {
        kind: 'saving_throw',
        modifiers: [{ label: 'Strength 1', value: abilityModifier(1) }],
      },
      createSeededRng(0),
    );
    for (let seed = 1; resolved.total >= 0 && seed < 10_000; seed += 1) {
      resolved = resolveD20(
        {
          kind: 'saving_throw',
          modifiers: [{ label: 'Strength 1', value: abilityModifier(1) }],
        },
        createSeededRng(seed),
      );
    }
    expect(resolved.total).toBeLessThan(0);
    expect(
      executeBoundedProcedure(data('hazard:burnt-othur-fumes'), {
        kind: 'hazard-save',
        phase: 'repeat',
        rollTotal: resolved.total,
        priorSuccessfulSaves: 1,
        repeatActive: true,
      }),
    ).toMatchObject({
      succeeded: false,
      successfulSaves: 1,
      repeatActive: true,
    });
  });

  it('requires explicit repeat progress and forbids it on the initial transition', () => {
    const hazard = data('hazard:burnt-othur-fumes');
    expect(() =>
      executeBoundedProcedure(hazard, {
        kind: 'hazard-save',
        phase: 'repeat',
        rollTotal: 13,
        repeatActive: true,
      }),
    ).toThrow(BoundedProcedureError);
    expect(() =>
      executeBoundedProcedure(hazard, {
        kind: 'hazard-save',
        phase: 'initial',
        rollTotal: 13,
        priorSuccessfulSaves: 0,
      }),
    ).toThrow(BoundedProcedureError);
  });

  it('selects exactly one Longsword damage mode from hands used', () => {
    const longsword = data('equipment:longsword');
    expect(
      executeBoundedProcedure(longsword, {
        kind: 'weapon-damage',
        handsUsed: 1,
      }),
    ).toEqual({
      kind: 'weapon-damage',
      damage: { dice: '1d8', type: 'slashing' },
    });
    expect(
      executeBoundedProcedure(longsword, {
        kind: 'weapon-damage',
        handsUsed: 2,
      }),
    ).toEqual({
      kind: 'weapon-damage',
      damage: { dice: '1d10', type: 'slashing' },
    });
  });

  it('returns only the selected Fighting Style effect and rejects duplicate selection', () => {
    const fightingStyle = data('feature:fighter:fighting-style');
    expect(
      executeBoundedProcedure(fightingStyle, {
        kind: 'select-feature-option',
        optionId: 'fighting-style:archery',
        alreadySelected: [],
      }),
    ).toEqual({
      kind: 'feature-option-selected',
      optionId: 'fighting-style:archery',
      effect: {
        kind: 'attack-roll-bonus',
        amount: 2,
        weaponRange: 'ranged',
      },
    });
    expect(() =>
      executeBoundedProcedure(fightingStyle, {
        kind: 'select-feature-option',
        optionId: 'fighting-style:archery',
        alreadySelected: ['fighting-style:archery'],
      }),
    ).toThrow(BoundedProcedureError);
    expect(() =>
      executeBoundedProcedure(fightingStyle, {
        kind: 'select-feature-option',
        optionId: 'fighting-style:archery',
        alreadySelected: ['fighting-style:defense'],
      }),
    ).toThrow(BoundedProcedureError);
  });

  it.each([
    null,
    'fighting-style:archery',
    [42],
    [''],
    ['fighting-style:defense', 'fighting-style:defense'],
    ['fighting-style:stale-option'],
  ])('rejects malformed or stale authoritative selection state %#', (state) => {
    expect(() =>
      executeBoundedProcedure(data('feature:fighter:fighting-style'), {
        kind: 'select-feature-option',
        optionId: 'fighting-style:archery',
        alreadySelected: state,
      }),
    ).toThrow(BoundedProcedureError);
  });

  it.each(['delete', 'replace', 'add'] as const)(
    'rejects a Fighting Style choice/procedure membership %s divergence',
    (mutation) => {
      const fightingStyle = structuredClone(
        data('feature:fighter:fighting-style'),
      ) as Record<string, unknown>;
      const choices = fightingStyle.choices as Record<string, unknown>[];
      const options = choices[0].options as Record<string, unknown>[];
      if (mutation === 'delete') options.shift();
      if (mutation === 'replace') {
        options[0].id = 'fighting-style:unreviewed';
      }
      if (mutation === 'add') {
        options.push({
          id: 'fighting-style:unreviewed',
          text: 'Unreviewed option.',
        });
      }
      expect(() =>
        executeBoundedProcedure(fightingStyle, {
          kind: 'select-feature-option',
          optionId: 'fighting-style:archery',
          alreadySelected: [],
        }),
      ).toThrow(BoundedProcedureError);
    },
  );

  it('accepts Fighting Style menu reordering without weakening membership closure', () => {
    const fightingStyle = structuredClone(
      data('feature:fighter:fighting-style'),
    ) as Record<string, unknown>;
    const choices = fightingStyle.choices as Record<string, unknown>[];
    const options = choices[0].options as Record<string, unknown>[];
    options.reverse();
    expect(
      executeBoundedProcedure(fightingStyle, {
        kind: 'select-feature-option',
        optionId: 'fighting-style:archery',
        alreadySelected: [],
      }),
    ).toMatchObject({ optionId: 'fighting-style:archery' });
  });

  it('executes Great Weapon Fighting any-of property applicability', () => {
    const fightingStyle = data('feature:fighter:fighting-style');
    const request = (weaponProperties: readonly string[]) =>
      executeBoundedProcedure(fightingStyle, {
        kind: 'feature-option-applicability',
        optionId: 'fighting-style:great-weapon-fighting',
        context: {
          weaponRange: 'melee',
          handsUsed: 2,
          weaponProperties,
        },
      });
    expect(request(['two-handed'])).toMatchObject({ applicable: true });
    expect(request(['versatile'])).toMatchObject({ applicable: true });
    expect(request([])).toMatchObject({ applicable: false });
  });

  it('executes Protection with explicit attacker and protected-target roles', () => {
    const fightingStyle = data('feature:fighter:fighting-style');
    const request = (
      overrides: Record<string, unknown> = {},
    ): ReturnType<typeof executeBoundedProcedure> =>
      executeBoundedProcedure(fightingStyle, {
        kind: 'feature-option-applicability',
        optionId: 'fighting-style:protection',
        context: {
          attackerVisibleToYou: true,
          protectedTargetIsYou: false,
          protectedTargetDistanceFromYouFeet: 5,
          wieldingShield: true,
          reactionAvailable: true,
          ...overrides,
        },
      });
    expect(request()).toMatchObject({ applicable: true });
    expect(request({ attackerVisibleToYou: false })).toMatchObject({
      applicable: false,
    });
    expect(request({ protectedTargetIsYou: true })).toMatchObject({
      applicable: false,
    });
    expect(request({ protectedTargetDistanceFromYouFeet: 10 })).toMatchObject({
      applicable: false,
    });
    expect(request({ reactionAvailable: false })).toMatchObject({
      applicable: false,
    });
    expect(request({ wieldingShield: false })).toMatchObject({
      applicable: false,
    });
  });

  it.each([
    [
      'fighting-style:archery',
      { weaponRange: 'ranged' },
      { weaponRange: 'melee' },
    ],
    ['fighting-style:defense', { wearingArmor: true }, { wearingArmor: false }],
    [
      'fighting-style:dueling',
      { weaponRange: 'melee', handsUsed: 1, noOtherWeapon: true },
      { weaponRange: 'melee', handsUsed: 1, noOtherWeapon: false },
    ],
    [
      'fighting-style:two-weapon-fighting',
      { twoWeaponFighting: true },
      { twoWeaponFighting: false },
    ],
  ] satisfies readonly (readonly [
    string,
    FeatureOptionApplicabilityContext,
    FeatureOptionApplicabilityContext,
  ])[])(
    'executes the bounded applicability predicate for %s',
    (optionId, qualifying, nonQualifying) => {
      const execute = (context: FeatureOptionApplicabilityContext) =>
        executeBoundedProcedure(data('feature:fighter:fighting-style'), {
          kind: 'feature-option-applicability',
          optionId,
          context,
        });
      expect(execute(qualifying)).toMatchObject({ applicable: true });
      expect(execute(nonQualifying)).toMatchObject({ applicable: false });
    },
  );

  it.each([
    ['fighting-style:archery', [{ weaponRange: 'melee' }]],
    ['fighting-style:defense', [{ wearingArmor: false }]],
    [
      'fighting-style:dueling',
      [
        { weaponRange: 'ranged', handsUsed: 1, noOtherWeapon: true },
        { weaponRange: 'melee', handsUsed: 2, noOtherWeapon: true },
        { weaponRange: 'melee', handsUsed: 1, noOtherWeapon: false },
      ],
    ],
    [
      'fighting-style:great-weapon-fighting',
      [
        {
          weaponRange: 'ranged',
          handsUsed: 2,
          weaponProperties: ['versatile'],
        },
        { weaponRange: 'melee', handsUsed: 1, weaponProperties: ['versatile'] },
        { weaponRange: 'melee', handsUsed: 2, weaponProperties: [] },
      ],
    ],
    [
      'fighting-style:protection',
      [
        {
          attackerVisibleToYou: false,
          protectedTargetIsYou: false,
          protectedTargetDistanceFromYouFeet: 5,
          wieldingShield: true,
          reactionAvailable: true,
        },
        {
          attackerVisibleToYou: true,
          protectedTargetIsYou: true,
          protectedTargetDistanceFromYouFeet: 5,
          wieldingShield: true,
          reactionAvailable: true,
        },
        {
          attackerVisibleToYou: true,
          protectedTargetIsYou: false,
          protectedTargetDistanceFromYouFeet: 5.5,
          wieldingShield: true,
          reactionAvailable: true,
        },
        {
          attackerVisibleToYou: true,
          protectedTargetIsYou: false,
          protectedTargetDistanceFromYouFeet: 5,
          wieldingShield: false,
          reactionAvailable: true,
        },
        {
          attackerVisibleToYou: true,
          protectedTargetIsYou: false,
          protectedTargetDistanceFromYouFeet: 5,
          wieldingShield: true,
          reactionAvailable: false,
        },
      ],
    ],
    ['fighting-style:two-weapon-fighting', [{ twoWeaponFighting: false }]],
  ] satisfies readonly (readonly [
    string,
    readonly FeatureOptionApplicabilityContext[],
  ])[])(
    'distinguishes explicit non-qualifying facts for every %s operand',
    (optionId, contexts) => {
      for (const context of contexts) {
        expect(
          executeBoundedProcedure(data('feature:fighter:fighting-style'), {
            kind: 'feature-option-applicability',
            optionId,
            context,
          }),
        ).toMatchObject({ applicable: false });
      }
    },
  );

  it.each([
    ['fighting-style:archery', { weaponRange: 'ranged' }],
    ['fighting-style:defense', { wearingArmor: true }],
    [
      'fighting-style:dueling',
      { weaponRange: 'melee', handsUsed: 1, noOtherWeapon: true },
    ],
    [
      'fighting-style:great-weapon-fighting',
      {
        weaponRange: 'melee',
        handsUsed: 2,
        weaponProperties: ['two-handed'],
      },
    ],
    [
      'fighting-style:protection',
      {
        attackerVisibleToYou: true,
        protectedTargetIsYou: false,
        protectedTargetDistanceFromYouFeet: 5,
        wieldingShield: true,
        reactionAvailable: true,
      },
    ],
    ['fighting-style:two-weapon-fighting', { twoWeaponFighting: true }],
  ] satisfies readonly (readonly [
    string,
    FeatureOptionApplicabilityContext,
  ])[])('refuses unknown applicability facts for %s', (optionId, complete) => {
    for (const key of Object.keys(complete)) {
      const incomplete = { ...complete } as Record<string, unknown>;
      Reflect.deleteProperty(incomplete, key);
      expect(() =>
        executeBoundedProcedure(data('feature:fighter:fighting-style'), {
          kind: 'feature-option-applicability',
          optionId,
          context: incomplete,
        }),
      ).toThrow(BoundedProcedureError);
      expect(() =>
        executeBoundedProcedure(data('feature:fighter:fighting-style'), {
          kind: 'feature-option-applicability',
          optionId,
          context: { ...complete, [key]: null },
        }),
      ).toThrow(BoundedProcedureError);
    }
  });

  it.each([
    ['fighting-style:archery', { weaponRange: 'thrown' }],
    ['fighting-style:defense', { wearingArmor: 1 }],
    [
      'fighting-style:dueling',
      { weaponRange: 'melee', handsUsed: 1.5, noOtherWeapon: true },
    ],
    [
      'fighting-style:great-weapon-fighting',
      {
        weaponRange: 'melee',
        handsUsed: 2,
        weaponProperties: ['versatile', 'versatile'],
      },
    ],
    [
      'fighting-style:protection',
      {
        attackerVisibleToYou: true,
        protectedTargetIsYou: false,
        protectedTargetDistanceFromYouFeet: Number.NaN,
        wieldingShield: true,
        reactionAvailable: true,
      },
    ],
    ['fighting-style:two-weapon-fighting', { twoWeaponFighting: 'yes' }],
  ])('rejects malformed applicability facts for %s', (optionId, context) => {
    expect(() =>
      executeBoundedProcedure(data('feature:fighter:fighting-style'), {
        kind: 'feature-option-applicability',
        optionId,
        context,
      }),
    ).toThrow(BoundedProcedureError);
  });

  it('rejects applicability facts unrelated to the selected effect', () => {
    expect(() =>
      executeBoundedProcedure(data('feature:fighter:fighting-style'), {
        kind: 'feature-option-applicability',
        optionId: 'fighting-style:archery',
        context: { weaponRange: 'ranged', wearingArmor: true },
      }),
    ).toThrow(BoundedProcedureError);
  });

  it('executes both Font of Magic conversions from source-derived tables', () => {
    const font = data('feature:sorcerer:font-of-magic');
    expect(
      executeBoundedProcedure(font, {
        kind: 'create-spell-slot',
        classLevel: 5,
        currentPoints: 5,
        slotLevel: 3,
      }),
    ).toEqual({
      kind: 'resource-transition',
      actionCost: 'bonus-action',
      pointDelta: -5,
      slotLevel: 3,
      slotDelta: 1,
      createdSlotExpires: 'long-rest',
    });
    expect(
      executeBoundedProcedure(font, {
        kind: 'convert-spell-slot',
        classLevel: 5,
        currentPoints: 2,
        slotLevel: 3,
        currentSlotCount: 1,
      }),
    ).toEqual({
      kind: 'resource-transition',
      actionCost: 'bonus-action',
      pointDelta: 3,
      slotLevel: 3,
      slotDelta: -1,
    });
    expect(() =>
      executeBoundedProcedure(font, {
        kind: 'convert-spell-slot',
        classLevel: 5,
        currentPoints: 4,
        slotLevel: 2,
        currentSlotCount: 1,
      }),
    ).toThrow(/exceeds the resource maximum/);
  });

  it('executes Wish stress consequences while leaving the open-ended effect to the DM', () => {
    const wish = data('spell:wish');
    expect(
      executeBoundedProcedure(wish, {
        kind: 'begin-wish-stress',
        currentStrength: 18,
        recoveryDaysRoll: 6,
        percentileRoll: 33,
      }),
    ).toEqual({
      kind: 'wish-stress-started',
      strength: 3,
      recoveryDays: 6,
      unableToCastWish: true,
    });
    expect(
      executeBoundedProcedure(wish, {
        kind: 'wish-stress-spell',
        spellLevel: 7,
      }),
    ).toEqual({
      kind: 'wish-stress-damage',
      damage: { dice: '7d10', type: 'necrotic' },
      preventable: false,
    });
    expect(
      executeBoundedProcedure(wish, {
        kind: 'wish-stress-recovery-day',
        remainingDays: 6,
        activity: 'light',
      }),
    ).toEqual({ kind: 'wish-stress-recovery', remainingDays: 4 });
  });

  it.each([
    [
      'hazard initial',
      'hazard:burnt-othur-fumes',
      { kind: 'hazard-save', phase: 'initial', rollTotal: 12 },
    ],
    [
      'hazard repeat',
      'hazard:burnt-othur-fumes',
      {
        kind: 'hazard-save',
        phase: 'repeat',
        rollTotal: 12,
        priorSuccessfulSaves: 0,
        repeatActive: true,
      },
    ],
    [
      'weapon damage',
      'equipment:longsword',
      { kind: 'weapon-damage', handsUsed: 1 },
    ],
    [
      'feature selection',
      'feature:fighter:fighting-style',
      {
        kind: 'select-feature-option',
        optionId: 'fighting-style:archery',
        alreadySelected: [],
      },
    ],
    [
      'feature applicability',
      'feature:fighter:fighting-style',
      {
        kind: 'feature-option-applicability',
        optionId: 'fighting-style:archery',
        context: { weaponRange: 'ranged' },
      },
    ],
    [
      'slot creation',
      'feature:sorcerer:font-of-magic',
      {
        kind: 'create-spell-slot',
        classLevel: 5,
        currentPoints: 5,
        slotLevel: 3,
      },
    ],
    [
      'slot conversion',
      'feature:sorcerer:font-of-magic',
      {
        kind: 'convert-spell-slot',
        classLevel: 5,
        currentPoints: 2,
        slotLevel: 3,
        currentSlotCount: 1,
      },
    ],
    [
      'wish stress entry',
      'spell:wish',
      {
        kind: 'begin-wish-stress',
        currentStrength: 10,
        recoveryDaysRoll: 4,
        percentileRoll: 50,
      },
    ],
    [
      'wish stress spell',
      'spell:wish',
      { kind: 'wish-stress-spell', spellLevel: 1 },
    ],
    [
      'wish recovery',
      'spell:wish',
      {
        kind: 'wish-stress-recovery-day',
        remainingDays: 2,
        activity: 'light',
      },
    ],
  ] as const)(
    'enforces every required and forbidden top-level field for %s requests',
    (_name, recordKey, admittedRequest) => {
      expect(() =>
        executeBoundedProcedure(data(recordKey), admittedRequest),
      ).not.toThrow();
      for (const key of Object.keys(admittedRequest)) {
        const missing = { ...admittedRequest } as Record<string, unknown>;
        Reflect.deleteProperty(missing, key);
        expect(() => executeBoundedProcedure(data(recordKey), missing)).toThrow(
          BoundedProcedureError,
        );
        const admittedValue =
          admittedRequest[key as keyof typeof admittedRequest];
        const malformedValue =
          typeof admittedValue === 'number'
            ? Number.NaN
            : typeof admittedValue === 'boolean'
              ? !admittedValue
              : null;
        expect(() =>
          executeBoundedProcedure(data(recordKey), {
            ...admittedRequest,
            [key]: malformedValue,
          }),
        ).toThrow(BoundedProcedureError);
      }
      expect(() =>
        executeBoundedProcedure(data(recordKey), {
          ...admittedRequest,
          crossVariantState: 0,
        }),
      ).toThrow(BoundedProcedureError);
    },
  );

  it('accepts owner-defined lower and upper numeric boundaries', () => {
    const font = data('feature:sorcerer:font-of-magic');
    const wish = data('spell:wish');
    expect(() =>
      executeBoundedProcedure(font, {
        kind: 'create-spell-slot',
        classLevel: 2,
        currentPoints: 2,
        slotLevel: 1,
      }),
    ).not.toThrow();
    expect(() =>
      executeBoundedProcedure(font, {
        kind: 'create-spell-slot',
        classLevel: 20,
        currentPoints: 20,
        slotLevel: 5,
      }),
    ).not.toThrow();
    expect(() =>
      executeBoundedProcedure(font, {
        kind: 'convert-spell-slot',
        classLevel: 20,
        currentPoints: 11,
        slotLevel: 9,
        currentSlotCount: 1,
      }),
    ).not.toThrow();
    for (const currentStrength of [1, 30]) {
      for (const recoveryDaysRoll of [2, 8]) {
        for (const percentileRoll of [1, 100]) {
          expect(() =>
            executeBoundedProcedure(wish, {
              kind: 'begin-wish-stress',
              currentStrength,
              recoveryDaysRoll,
              percentileRoll,
            }),
          ).not.toThrow();
        }
      }
    }
    for (const spellLevel of [0, 9]) {
      expect(() =>
        executeBoundedProcedure(wish, {
          kind: 'wish-stress-spell',
          spellLevel,
        }),
      ).not.toThrow();
    }
    expect(() =>
      executeBoundedProcedure(wish, {
        kind: 'wish-stress-recovery-day',
        remainingDays: 0,
        activity: 'strenuous',
      }),
    ).not.toThrow();
  });

  it.each([
    ['equipment:longsword', { kind: 'weapon-damage', handsUsed: 0 }],
    ['equipment:longsword', { kind: 'weapon-damage', handsUsed: 1.5 }],
    ['equipment:longsword', { kind: 'weapon-damage', handsUsed: 3 }],
    [
      'hazard:burnt-othur-fumes',
      {
        kind: 'hazard-save',
        phase: 'repeat',
        rollTotal: Number.NaN,
        priorSuccessfulSaves: 0,
        repeatActive: true,
      },
    ],
    [
      'hazard:burnt-othur-fumes',
      {
        kind: 'hazard-save',
        phase: 'repeat',
        rollTotal: 12.5,
        priorSuccessfulSaves: 0,
        repeatActive: true,
      },
    ],
    [
      'hazard:burnt-othur-fumes',
      {
        kind: 'hazard-save',
        phase: 'repeat',
        rollTotal: 13,
        priorSuccessfulSaves: -1,
        repeatActive: true,
      },
    ],
    [
      'hazard:burnt-othur-fumes',
      {
        kind: 'hazard-save',
        phase: 'repeat',
        rollTotal: 13,
        priorSuccessfulSaves: 3,
        repeatActive: true,
      },
    ],
    [
      'hazard:burnt-othur-fumes',
      {
        kind: 'hazard-save',
        phase: 'initial',
        rollTotal: 13,
        priorSuccessfulSaves: 1,
      },
    ],
    [
      'feature:sorcerer:font-of-magic',
      {
        kind: 'convert-spell-slot',
        classLevel: 5,
        currentPoints: 1,
        slotLevel: 1.5,
        currentSlotCount: 1,
      },
    ],
    [
      'feature:sorcerer:font-of-magic',
      {
        kind: 'create-spell-slot',
        classLevel: 5.5,
        currentPoints: 5,
        slotLevel: 1,
      },
    ],
    [
      'feature:sorcerer:font-of-magic',
      {
        kind: 'create-spell-slot',
        classLevel: 5,
        currentPoints: Number.NaN,
        slotLevel: 1,
      },
    ],
    [
      'feature:sorcerer:font-of-magic',
      {
        kind: 'create-spell-slot',
        classLevel: 5,
        currentPoints: 4.5,
        slotLevel: 1,
      },
    ],
    [
      'feature:sorcerer:font-of-magic',
      {
        kind: 'create-spell-slot',
        classLevel: 5,
        currentPoints: 6,
        slotLevel: 1,
      },
    ],
    [
      'feature:sorcerer:font-of-magic',
      {
        kind: 'convert-spell-slot',
        classLevel: 5,
        currentPoints: 1,
        slotLevel: 1,
        currentSlotCount: 0,
      },
    ],
    [
      'feature:sorcerer:font-of-magic',
      {
        kind: 'create-spell-slot',
        classLevel: 1,
        currentPoints: 0,
        slotLevel: 1,
      },
    ],
    [
      'feature:sorcerer:font-of-magic',
      {
        kind: 'create-spell-slot',
        classLevel: 21,
        currentPoints: 2,
        slotLevel: 1,
      },
    ],
    [
      'feature:sorcerer:font-of-magic',
      {
        kind: 'create-spell-slot',
        classLevel: 5,
        currentPoints: -1,
        slotLevel: 1,
      },
    ],
    [
      'feature:sorcerer:font-of-magic',
      {
        kind: 'create-spell-slot',
        classLevel: 5,
        currentPoints: 5,
        slotLevel: 0,
      },
    ],
    [
      'feature:sorcerer:font-of-magic',
      {
        kind: 'convert-spell-slot',
        classLevel: 20,
        currentPoints: 0,
        slotLevel: 10,
        currentSlotCount: 1,
      },
    ],
    [
      'spell:wish',
      {
        kind: 'begin-wish-stress',
        currentStrength: Number.NaN,
        recoveryDaysRoll: 4,
        percentileRoll: 50,
      },
    ],
    [
      'spell:wish',
      {
        kind: 'begin-wish-stress',
        currentStrength: 0,
        recoveryDaysRoll: 4,
        percentileRoll: 50,
      },
    ],
    [
      'spell:wish',
      {
        kind: 'begin-wish-stress',
        currentStrength: 31,
        recoveryDaysRoll: 4,
        percentileRoll: 50,
      },
    ],
    [
      'spell:wish',
      {
        kind: 'begin-wish-stress',
        currentStrength: 10,
        recoveryDaysRoll: 1,
        percentileRoll: 50,
      },
    ],
    [
      'spell:wish',
      {
        kind: 'begin-wish-stress',
        currentStrength: 10,
        recoveryDaysRoll: 9,
        percentileRoll: 50,
      },
    ],
    [
      'spell:wish',
      {
        kind: 'begin-wish-stress',
        currentStrength: 10,
        recoveryDaysRoll: 4,
        percentileRoll: 0,
      },
    ],
    [
      'spell:wish',
      {
        kind: 'begin-wish-stress',
        currentStrength: 10,
        recoveryDaysRoll: 4,
        percentileRoll: 101,
      },
    ],
    [
      'spell:wish',
      {
        kind: 'begin-wish-stress',
        currentStrength: 10,
        recoveryDaysRoll: 3.5,
        percentileRoll: 50,
      },
    ],
    [
      'spell:wish',
      {
        kind: 'begin-wish-stress',
        currentStrength: 10,
        recoveryDaysRoll: 4,
        percentileRoll: Number.NaN,
      },
    ],
    ['spell:wish', { kind: 'wish-stress-spell', spellLevel: -1 }],
    ['spell:wish', { kind: 'wish-stress-spell', spellLevel: 9.5 }],
    ['spell:wish', { kind: 'wish-stress-spell', spellLevel: 10 }],
    [
      'spell:wish',
      {
        kind: 'wish-stress-recovery-day',
        remainingDays: Number.NaN,
        activity: 'light',
      },
    ],
    [
      'spell:wish',
      {
        kind: 'wish-stress-recovery-day',
        remainingDays: -1,
        activity: 'light',
      },
    ],
  ] satisfies readonly (readonly [string, unknown])[])(
    'rejects invalid numeric state for %s',
    (key, request) => {
      expect(() => executeBoundedProcedure(data(key), request)).toThrow(
        BoundedProcedureError,
      );
    },
  );

  it('dispatches by redacted structure, independent of record identity', () => {
    const redacted = structuredClone(data('equipment:longsword'));
    const synthetic = structuredClone(redacted);
    expect(
      executeBoundedProcedure(redacted, {
        kind: 'weapon-damage',
        handsUsed: 2,
      }),
    ).toEqual(
      executeBoundedProcedure(synthetic, {
        kind: 'weapon-damage',
        handsUsed: 2,
      }),
    );
  });

  it('follows redacted procedure values instead of a known record identity', () => {
    const synthetic = structuredClone(
      data('hazard:burnt-othur-fumes'),
    ) as Record<string, unknown>;
    const mechanics = synthetic.mechanics as Record<string, unknown>;
    const procedures = mechanics.procedures as Record<string, unknown>[];
    const repeat = procedures[0].repeat as Record<string, unknown>;
    repeat.save = { ability: 'wisdom', dc: 17 };
    repeat.failureDamage = { dice: '2d8', type: 'psychic' };
    expect(
      executeBoundedProcedure(synthetic, {
        kind: 'hazard-save',
        phase: 'repeat',
        rollTotal: 16,
        priorSuccessfulSaves: 0,
        repeatActive: true,
      }),
    ).toEqual({
      kind: 'hazard-save',
      succeeded: false,
      damage: { dice: '2d8', type: 'psychic' },
      successfulSaves: 0,
      repeatActive: true,
      ended: false,
    });
  });

  it.each([
    [
      'hazard:burnt-othur-fumes',
      { kind: 'hazard-save', phase: 'initial', rollTotal: 12 },
    ],
    ['equipment:longsword', { kind: 'weapon-damage', handsUsed: 2 }],
    [
      'feature:fighter:fighting-style',
      {
        kind: 'select-feature-option',
        optionId: 'fighting-style:archery',
        alreadySelected: [],
      },
    ],
    [
      'feature:sorcerer:font-of-magic',
      {
        kind: 'create-spell-slot',
        classLevel: 5,
        currentPoints: 5,
        slotLevel: 3,
      },
    ],
    ['spell:wish', { kind: 'wish-stress-spell', spellLevel: 2 }],
  ] satisfies readonly (readonly [string, BoundedProcedureRequest])[])(
    'rejects duplicate and competing execution procedures for %s',
    (key, request) => {
      const duplicateData = structuredClone(data(key)) as Record<
        string,
        unknown
      >;
      const duplicateMechanics = duplicateData.mechanics as Record<
        string,
        unknown
      >;
      const duplicateProcedures = duplicateMechanics.procedures as Record<
        string,
        unknown
      >[];
      duplicateProcedures.push(structuredClone(duplicateProcedures[0]));
      expect(() => executeBoundedProcedure(duplicateData, request)).toThrow(
        BoundedProcedureError,
      );

      const competingData = structuredClone(data(key)) as Record<
        string,
        unknown
      >;
      const competingMechanics = competingData.mechanics as Record<
        string,
        unknown
      >;
      const competingProcedures = competingMechanics.procedures as Record<
        string,
        unknown
      >[];
      const competing = structuredClone(competingProcedures[0]);
      competing.id = `${String(competing.id)}-competitor`;
      competingProcedures.push(competing);
      expect(() => executeBoundedProcedure(competingData, request)).toThrow(
        BoundedProcedureError,
      );
    },
  );

  it.each([
    [
      'hazard:burnt-othur-fumes',
      'equipment:longsword',
      { kind: 'hazard-save', phase: 'initial', rollTotal: 12 },
    ],
    [
      'equipment:longsword',
      'hazard:burnt-othur-fumes',
      { kind: 'weapon-damage', handsUsed: 2 },
    ],
    [
      'feature:fighter:fighting-style',
      'equipment:longsword',
      {
        kind: 'select-feature-option',
        optionId: 'fighting-style:archery',
        alreadySelected: [],
      },
    ],
    [
      'feature:sorcerer:font-of-magic',
      'equipment:longsword',
      {
        kind: 'create-spell-slot',
        classLevel: 5,
        currentPoints: 5,
        slotLevel: 3,
      },
    ],
    [
      'spell:wish',
      'equipment:longsword',
      { kind: 'wish-stress-spell', spellLevel: 2 },
    ],
  ] satisfies readonly (readonly [string, string, BoundedProcedureRequest])[])(
    'executes %s identically after unrelated procedure reordering',
    (key, donorKey, request) => {
      const reordered = structuredClone(data(key)) as Record<string, unknown>;
      const mechanics = reordered.mechanics as Record<string, unknown>;
      const targetProcedures = mechanics.procedures as Record<
        string,
        unknown
      >[];
      const donor = structuredClone(data(donorKey)) as Record<string, unknown>;
      const donorMechanics = donor.mechanics as Record<string, unknown>;
      const donorProcedure = (
        donorMechanics.procedures as Record<string, unknown>[]
      )[0];
      targetProcedures.unshift(donorProcedure);
      expect(executeBoundedProcedure(reordered, request)).toEqual(
        executeBoundedProcedure(data(key), request),
      );
    },
  );

  it('refuses malformed or absent fields without a prose fallback', () => {
    const wish = structuredClone(data('spell:wish')) as Record<string, unknown>;
    const mechanics = wish.mechanics as Record<string, unknown>;
    const procedures = mechanics.procedures as Record<string, unknown>[];
    const stress = procedures[0].stress as Record<string, unknown>;
    Reflect.deleteProperty(stress, 'recurringDamage');
    expect(() =>
      executeBoundedProcedure(wish, {
        kind: 'wish-stress-spell',
        spellLevel: 2,
      }),
    ).toThrow(BoundedProcedureError);
  });

  it('makes the generated pack schema reject an unrecognized procedure shape', () => {
    const changed = structuredClone({
      meta: manifest,
      records,
    }) as RulesPack;
    const longsword = changed.records.find(
      (record) => record.key === 'equipment:longsword',
    );
    if (longsword === undefined) throw new Error('missing Longsword');
    const root = longsword.data as Record<string, unknown>;
    const mechanics = root.mechanics as Record<string, unknown>;
    const procedures = mechanics.procedures as Record<string, unknown>[];
    procedures[0].kind = 'unknown-procedure';
    expect(() => validateRulesPack(changed)).toThrow(
      /not a positively selected bounded procedure/,
    );
  });

  it('makes the generated pack schema reject an unrecognized option effect', () => {
    const changed = structuredClone({
      meta: manifest,
      records,
    }) as RulesPack;
    const fightingStyle = changed.records.find(
      (record) => record.key === 'feature:fighter:fighting-style',
    );
    if (fightingStyle === undefined) throw new Error('missing Fighting Style');
    const root = fightingStyle.data as Record<string, unknown>;
    const mechanics = root.mechanics as Record<string, unknown>;
    const procedures = mechanics.procedures as Record<string, unknown>[];
    const options = procedures[0].options as Record<string, unknown>[];
    options[0].effect = { kind: 'unreviewed-effect' };
    expect(() => validateRulesPack(changed)).toThrow(
      /not a bounded feature-option effect/,
    );
  });
});
