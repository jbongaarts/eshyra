import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RulesPack, RulesRecord } from '../src/internal.js';
import {
  BoundedProcedureError,
  executeBoundedProcedure,
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
        rollTotal: 12,
      }),
    ).toEqual({
      kind: 'hazard-save',
      succeeded: false,
      damage: { dice: '3d6', type: 'poison' },
      successfulSaves: 0,
      ended: false,
    });
    expect(
      executeBoundedProcedure(hazard, {
        kind: 'hazard-save',
        phase: 'repeat',
        rollTotal: 13,
        priorSuccessfulSaves: 2,
      }),
    ).toEqual({
      kind: 'hazard-save',
      succeeded: true,
      successfulSaves: 3,
      ended: true,
    });
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
      }),
    ).toEqual({
      kind: 'hazard-save',
      succeeded: false,
      damage: { dice: '2d8', type: 'psychic' },
      successfulSaves: 0,
      ended: false,
    });
  });

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
