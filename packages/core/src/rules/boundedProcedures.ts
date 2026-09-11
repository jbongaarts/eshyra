import {
  LIVE_STATE_MAX_ABILITY_SCORE,
  LIVE_STATE_MIN_ABILITY_SCORE,
} from '../character/abilities.js';
import { RulesPackError } from './types.js';

type JsonObject = Record<string, unknown>;

export interface SaveAtom {
  readonly ability: string;
  readonly dc: number;
}

export interface DamageAtom {
  readonly dice: string;
  readonly type: string;
}

export interface RepeatSaveHazardProcedure {
  readonly id: string;
  readonly kind: 'repeat-save-hazard';
  readonly entryTransition: {
    readonly onInitialSuccess: 'end';
    readonly onInitialFailure: 'activate-repeat';
  };
  readonly initial: {
    readonly save: SaveAtom;
    readonly failureDamage: DamageAtom;
  };
  readonly repeat: {
    readonly timing: 'start-of-affected-turn';
    readonly save: SaveAtom;
    readonly failureDamage: DamageAtom;
  };
  readonly termination: {
    readonly kind: 'successful-saves';
    readonly count: number;
  };
}

export interface WeaponDamageModesProcedure {
  readonly id: string;
  readonly kind: 'weapon-damage-modes';
  readonly selector: 'hands-used';
  readonly modes: readonly {
    readonly id: string;
    readonly hands: 1 | 2;
    readonly damage: DamageAtom;
  }[];
}

export type FeatureOptionEffect =
  | {
      readonly kind: 'attack-roll-bonus';
      readonly amount: number;
      readonly weaponRange: 'ranged';
    }
  | {
      readonly kind: 'armor-class-bonus';
      readonly amount: number;
      readonly whileWearingArmor: true;
    }
  | {
      readonly kind: 'damage-roll-bonus';
      readonly amount: number;
      readonly weaponRange: 'melee';
      readonly weaponHands: 1;
      readonly noOtherWeapon: true;
    }
  | {
      readonly kind: 'damage-die-reroll';
      readonly rerollValues: readonly [1, 2];
      readonly keepReroll: true;
      readonly weaponRange: 'melee';
      readonly handsUsed: 2;
      readonly propertyRequirement: {
        readonly kind: 'any-of';
        readonly properties: readonly ['two-handed', 'versatile'];
      };
    }
  | {
      readonly kind: 'reaction-attack-disadvantage';
      readonly actionCost: 'reaction';
      readonly attacker: {
        readonly mustBeVisibleToYou: true;
      };
      readonly protectedTarget: {
        readonly mustBeOtherThanYou: true;
        readonly maximumDistanceFromYouFeet: 5;
      };
      readonly requiresShield: true;
    }
  | {
      readonly kind: 'offhand-damage-ability-modifier';
      readonly addAbilityModifier: true;
    };

export interface FeatureOptionProcedure {
  readonly id: string;
  readonly kind: 'feature-options';
  readonly choiceId: string;
  readonly duplicateSelection: 'prohibited';
  readonly options: readonly {
    readonly id: string;
    readonly effect: FeatureOptionEffect;
  }[];
}

export interface ResourceConversionProcedure {
  readonly id: string;
  readonly kind: 'resource-conversion';
  readonly pool: {
    readonly id: string;
    readonly name: string;
    readonly maximumByLevel: readonly {
      readonly level: number;
      readonly maximum: number;
    }[];
    readonly reset: 'long-rest';
  };
  readonly operations: {
    readonly createSpellSlot: {
      readonly actionCost: 'bonus-action';
      readonly maximumSlotLevel: number;
      readonly costBySlotLevel: readonly {
        readonly slotLevel: number;
        readonly cost: number;
      }[];
      readonly createdSlotExpires: 'long-rest';
    };
    readonly convertSpellSlot: {
      readonly actionCost: 'bonus-action';
      readonly pointsGained: 'slot-level';
    };
  };
}

export interface AdjudicatedStressProcedure {
  readonly id: string;
  readonly kind: 'adjudicated-stress';
  readonly adjudicationBoundary: {
    readonly id: string;
    readonly boundaryKind: 'designed-adjudication';
    readonly adjudicator: 'dm';
    readonly trigger: 'beyond-listed-effects';
  };
  readonly stress: {
    readonly trigger: 'non-duplication-effect';
    readonly recurringDamage: {
      readonly event: 'cast-spell-before-long-rest';
      readonly dicePerSpellLevel: '1d10';
      readonly damageType: 'necrotic';
      readonly preventable: false;
    };
    readonly strength: {
      readonly maximumAfterStress: 3;
      readonly durationDice: '2d4';
      readonly unit: 'day';
    };
    readonly recovery: {
      readonly ordinaryDayReduction: 1;
      readonly restDayReduction: 2;
      readonly maximumRestActivity: 'light';
    };
    readonly wishLoss: {
      readonly chancePercent: 33;
      readonly state: 'unable-to-cast-wish';
    };
  };
}

/**
 * The five procedure shapes proven by eshyra-o9bd.19.1.14. This is a bounded
 * positive capability surface, not a universal rules taxonomy and not evidence
 * that records without one of these shapes contain no mechanics.
 */
export type BoundedProcedure =
  | RepeatSaveHazardProcedure
  | WeaponDamageModesProcedure
  | FeatureOptionProcedure
  | ResourceConversionProcedure
  | AdjudicatedStressProcedure;

export class BoundedProcedureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoundedProcedureError';
  }
}

function objectAt(value: unknown, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BoundedProcedureError(`${path} must be an object`);
  }
  return value as JsonObject;
}

function arrayAt(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BoundedProcedureError(`${path} must be a non-empty array`);
  }
  return value;
}

function stringAt(object: JsonObject, key: string, path: string): string {
  const value = object[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new BoundedProcedureError(
      `${path}.${key} must be a non-empty string`,
    );
  }
  return value;
}

function integerAt(
  object: JsonObject,
  key: string,
  path: string,
  minimum = 0,
): number {
  const value = object[key];
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new BoundedProcedureError(
      `${path}.${key} must be an integer >= ${minimum}`,
    );
  }
  return value as number;
}

function literalAt<T extends string | number | boolean>(
  object: JsonObject,
  key: string,
  expected: T,
  path: string,
): T {
  if (object[key] !== expected) {
    throw new BoundedProcedureError(
      `${path}.${key} must be ${JSON.stringify(expected)}`,
    );
  }
  return expected;
}

function requireOnlyKeys(
  object: JsonObject,
  keys: readonly string[],
  path: string,
): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) {
      throw new BoundedProcedureError(
        `${path} has unsupported key ${JSON.stringify(key)}`,
      );
    }
  }
}

function validateSave(value: unknown, path: string): void {
  const save = objectAt(value, path);
  requireOnlyKeys(save, ['ability', 'dc'], path);
  stringAt(save, 'ability', path);
  integerAt(save, 'dc', path, 1);
}

function validateDamage(value: unknown, path: string): void {
  const damage = objectAt(value, path);
  requireOnlyKeys(damage, ['dice', 'type'], path);
  const dice = stringAt(damage, 'dice', path);
  if (!/^\d+d\d+(?:\s*[+-]\s*\d+)?$/.test(dice)) {
    throw new BoundedProcedureError(`${path}.dice must be a dice expression`);
  }
  stringAt(damage, 'type', path);
}

function validateRepeatSaveHazard(procedure: JsonObject, path: string): void {
  requireOnlyKeys(
    procedure,
    ['id', 'kind', 'entryTransition', 'initial', 'repeat', 'termination'],
    path,
  );
  const entryTransition = objectAt(
    procedure.entryTransition,
    `${path}.entryTransition`,
  );
  requireOnlyKeys(
    entryTransition,
    ['onInitialSuccess', 'onInitialFailure'],
    `${path}.entryTransition`,
  );
  literalAt(
    entryTransition,
    'onInitialSuccess',
    'end',
    `${path}.entryTransition`,
  );
  literalAt(
    entryTransition,
    'onInitialFailure',
    'activate-repeat',
    `${path}.entryTransition`,
  );
  const initial = objectAt(procedure.initial, `${path}.initial`);
  requireOnlyKeys(initial, ['save', 'failureDamage'], `${path}.initial`);
  validateSave(initial.save, `${path}.initial.save`);
  validateDamage(initial.failureDamage, `${path}.initial.failureDamage`);
  const repeat = objectAt(procedure.repeat, `${path}.repeat`);
  requireOnlyKeys(
    repeat,
    ['timing', 'save', 'failureDamage'],
    `${path}.repeat`,
  );
  literalAt(repeat, 'timing', 'start-of-affected-turn', `${path}.repeat`);
  validateSave(repeat.save, `${path}.repeat.save`);
  validateDamage(repeat.failureDamage, `${path}.repeat.failureDamage`);
  const termination = objectAt(procedure.termination, `${path}.termination`);
  requireOnlyKeys(termination, ['kind', 'count'], `${path}.termination`);
  literalAt(termination, 'kind', 'successful-saves', `${path}.termination`);
  integerAt(termination, 'count', `${path}.termination`, 1);
}

function validateWeaponDamageModes(procedure: JsonObject, path: string): void {
  requireOnlyKeys(procedure, ['id', 'kind', 'selector', 'modes'], path);
  literalAt(procedure, 'selector', 'hands-used', path);
  const modes = arrayAt(procedure.modes, `${path}.modes`);
  const hands = new Set<number>();
  for (const [index, value] of modes.entries()) {
    const modePath = `${path}.modes[${index}]`;
    const mode = objectAt(value, modePath);
    requireOnlyKeys(mode, ['id', 'hands', 'damage'], modePath);
    stringAt(mode, 'id', modePath);
    const handCount = integerAt(mode, 'hands', modePath, 1);
    if (handCount !== 1 && handCount !== 2) {
      throw new BoundedProcedureError(`${modePath}.hands must be 1 or 2`);
    }
    if (hands.has(handCount)) {
      throw new BoundedProcedureError(
        `${path}.modes duplicates hands=${handCount}`,
      );
    }
    hands.add(handCount);
    validateDamage(mode.damage, `${modePath}.damage`);
  }
  if (hands.size !== 2 || !hands.has(1) || !hands.has(2)) {
    throw new BoundedProcedureError(
      `${path}.modes must define hands=1 and hands=2`,
    );
  }
}

function validateFeatureOptions(procedure: JsonObject, path: string): void {
  requireOnlyKeys(
    procedure,
    ['id', 'kind', 'choiceId', 'duplicateSelection', 'options'],
    path,
  );
  stringAt(procedure, 'choiceId', path);
  literalAt(procedure, 'duplicateSelection', 'prohibited', path);
  const options = arrayAt(procedure.options, `${path}.options`);
  const ids = new Set<string>();
  for (const [index, value] of options.entries()) {
    const optionPath = `${path}.options[${index}]`;
    const option = objectAt(value, optionPath);
    requireOnlyKeys(option, ['id', 'effect'], optionPath);
    const id = stringAt(option, 'id', optionPath);
    if (ids.has(id)) {
      throw new BoundedProcedureError(
        `${path}.options duplicates id ${JSON.stringify(id)}`,
      );
    }
    ids.add(id);
    const effect = objectAt(option.effect, `${optionPath}.effect`);
    validateFeatureOptionEffect(effect, `${optionPath}.effect`);
  }
}

function validateFeatureOptionEffect(effect: JsonObject, path: string): void {
  const kind = stringAt(effect, 'kind', path);
  if (kind === 'attack-roll-bonus') {
    requireOnlyKeys(effect, ['kind', 'amount', 'weaponRange'], path);
    integerAt(effect, 'amount', path, 1);
    literalAt(effect, 'weaponRange', 'ranged', path);
    return;
  }
  if (kind === 'armor-class-bonus') {
    requireOnlyKeys(effect, ['kind', 'amount', 'whileWearingArmor'], path);
    integerAt(effect, 'amount', path, 1);
    literalAt(effect, 'whileWearingArmor', true, path);
    return;
  }
  if (kind === 'damage-roll-bonus') {
    requireOnlyKeys(
      effect,
      ['kind', 'amount', 'weaponRange', 'weaponHands', 'noOtherWeapon'],
      path,
    );
    integerAt(effect, 'amount', path, 1);
    literalAt(effect, 'weaponRange', 'melee', path);
    literalAt(effect, 'weaponHands', 1, path);
    literalAt(effect, 'noOtherWeapon', true, path);
    return;
  }
  if (kind === 'damage-die-reroll') {
    requireOnlyKeys(
      effect,
      [
        'kind',
        'rerollValues',
        'keepReroll',
        'weaponRange',
        'handsUsed',
        'propertyRequirement',
      ],
      path,
    );
    if (
      !Array.isArray(effect.rerollValues) ||
      effect.rerollValues.length !== 2 ||
      effect.rerollValues[0] !== 1 ||
      effect.rerollValues[1] !== 2
    ) {
      throw new BoundedProcedureError(`${path}.rerollValues must be [1, 2]`);
    }
    literalAt(effect, 'keepReroll', true, path);
    literalAt(effect, 'weaponRange', 'melee', path);
    literalAt(effect, 'handsUsed', 2, path);
    const propertyRequirement = objectAt(
      effect.propertyRequirement,
      `${path}.propertyRequirement`,
    );
    requireOnlyKeys(
      propertyRequirement,
      ['kind', 'properties'],
      `${path}.propertyRequirement`,
    );
    literalAt(
      propertyRequirement,
      'kind',
      'any-of',
      `${path}.propertyRequirement`,
    );
    if (
      !Array.isArray(propertyRequirement.properties) ||
      propertyRequirement.properties.length !== 2 ||
      propertyRequirement.properties[0] !== 'two-handed' ||
      propertyRequirement.properties[1] !== 'versatile'
    ) {
      throw new BoundedProcedureError(
        `${path}.propertyRequirement.properties must be ["two-handed", "versatile"]`,
      );
    }
    return;
  }
  if (kind === 'reaction-attack-disadvantage') {
    requireOnlyKeys(
      effect,
      ['kind', 'actionCost', 'attacker', 'protectedTarget', 'requiresShield'],
      path,
    );
    literalAt(effect, 'actionCost', 'reaction', path);
    const attacker = objectAt(effect.attacker, `${path}.attacker`);
    requireOnlyKeys(attacker, ['mustBeVisibleToYou'], `${path}.attacker`);
    literalAt(attacker, 'mustBeVisibleToYou', true, `${path}.attacker`);
    const protectedTarget = objectAt(
      effect.protectedTarget,
      `${path}.protectedTarget`,
    );
    requireOnlyKeys(
      protectedTarget,
      ['mustBeOtherThanYou', 'maximumDistanceFromYouFeet'],
      `${path}.protectedTarget`,
    );
    literalAt(
      protectedTarget,
      'mustBeOtherThanYou',
      true,
      `${path}.protectedTarget`,
    );
    literalAt(
      protectedTarget,
      'maximumDistanceFromYouFeet',
      5,
      `${path}.protectedTarget`,
    );
    literalAt(effect, 'requiresShield', true, path);
    return;
  }
  if (kind === 'offhand-damage-ability-modifier') {
    requireOnlyKeys(effect, ['kind', 'addAbilityModifier'], path);
    literalAt(effect, 'addAbilityModifier', true, path);
    return;
  }
  throw new BoundedProcedureError(
    `${path}.kind is not a bounded feature-option effect`,
  );
}

function validateResourceConversion(procedure: JsonObject, path: string): void {
  requireOnlyKeys(procedure, ['id', 'kind', 'pool', 'operations'], path);
  const pool = objectAt(procedure.pool, `${path}.pool`);
  requireOnlyKeys(
    pool,
    ['id', 'name', 'maximumByLevel', 'reset'],
    `${path}.pool`,
  );
  stringAt(pool, 'id', `${path}.pool`);
  stringAt(pool, 'name', `${path}.pool`);
  literalAt(pool, 'reset', 'long-rest', `${path}.pool`);
  const maxima = arrayAt(pool.maximumByLevel, `${path}.pool.maximumByLevel`);
  let previousLevel = 0;
  for (const [index, value] of maxima.entries()) {
    const maximumPath = `${path}.pool.maximumByLevel[${index}]`;
    const maximum = objectAt(value, maximumPath);
    requireOnlyKeys(maximum, ['level', 'maximum'], maximumPath);
    const level = integerAt(maximum, 'level', maximumPath, 1);
    integerAt(maximum, 'maximum', maximumPath, 1);
    if (level <= previousLevel) {
      throw new BoundedProcedureError(
        `${path}.pool.maximumByLevel must be level-sorted and unique`,
      );
    }
    previousLevel = level;
  }
  const operations = objectAt(procedure.operations, `${path}.operations`);
  requireOnlyKeys(
    operations,
    ['createSpellSlot', 'convertSpellSlot'],
    `${path}.operations`,
  );
  const create = objectAt(
    operations.createSpellSlot,
    `${path}.operations.createSpellSlot`,
  );
  requireOnlyKeys(
    create,
    ['actionCost', 'maximumSlotLevel', 'costBySlotLevel', 'createdSlotExpires'],
    `${path}.operations.createSpellSlot`,
  );
  literalAt(
    create,
    'actionCost',
    'bonus-action',
    `${path}.operations.createSpellSlot`,
  );
  const maximumSlotLevel = integerAt(
    create,
    'maximumSlotLevel',
    `${path}.operations.createSpellSlot`,
    1,
  );
  literalAt(
    create,
    'createdSlotExpires',
    'long-rest',
    `${path}.operations.createSpellSlot`,
  );
  const costs = arrayAt(
    create.costBySlotLevel,
    `${path}.operations.createSpellSlot.costBySlotLevel`,
  );
  const levels = new Set<number>();
  for (const [index, value] of costs.entries()) {
    const costPath = `${path}.operations.createSpellSlot.costBySlotLevel[${index}]`;
    const cost = objectAt(value, costPath);
    requireOnlyKeys(cost, ['slotLevel', 'cost'], costPath);
    const level = integerAt(cost, 'slotLevel', costPath, 1);
    integerAt(cost, 'cost', costPath, 1);
    if (level > maximumSlotLevel || levels.has(level)) {
      throw new BoundedProcedureError(
        `${costPath}.slotLevel is duplicated or out of range`,
      );
    }
    levels.add(level);
  }
  if (levels.size !== maximumSlotLevel) {
    throw new BoundedProcedureError(
      `${path}.operations.createSpellSlot must define every slot level through maximumSlotLevel`,
    );
  }
  const convert = objectAt(
    operations.convertSpellSlot,
    `${path}.operations.convertSpellSlot`,
  );
  requireOnlyKeys(
    convert,
    ['actionCost', 'pointsGained'],
    `${path}.operations.convertSpellSlot`,
  );
  literalAt(
    convert,
    'actionCost',
    'bonus-action',
    `${path}.operations.convertSpellSlot`,
  );
  literalAt(
    convert,
    'pointsGained',
    'slot-level',
    `${path}.operations.convertSpellSlot`,
  );
}

function validateAdjudicatedStress(procedure: JsonObject, path: string): void {
  requireOnlyKeys(
    procedure,
    ['id', 'kind', 'adjudicationBoundary', 'stress'],
    path,
  );
  const boundary = objectAt(
    procedure.adjudicationBoundary,
    `${path}.adjudicationBoundary`,
  );
  requireOnlyKeys(
    boundary,
    ['id', 'boundaryKind', 'adjudicator', 'trigger'],
    `${path}.adjudicationBoundary`,
  );
  stringAt(boundary, 'id', `${path}.adjudicationBoundary`);
  literalAt(
    boundary,
    'boundaryKind',
    'designed-adjudication',
    `${path}.adjudicationBoundary`,
  );
  literalAt(boundary, 'adjudicator', 'dm', `${path}.adjudicationBoundary`);
  literalAt(
    boundary,
    'trigger',
    'beyond-listed-effects',
    `${path}.adjudicationBoundary`,
  );
  const stress = objectAt(procedure.stress, `${path}.stress`);
  requireOnlyKeys(
    stress,
    ['trigger', 'recurringDamage', 'strength', 'recovery', 'wishLoss'],
    `${path}.stress`,
  );
  literalAt(stress, 'trigger', 'non-duplication-effect', `${path}.stress`);
  const damage = objectAt(
    stress.recurringDamage,
    `${path}.stress.recurringDamage`,
  );
  requireOnlyKeys(
    damage,
    ['event', 'dicePerSpellLevel', 'damageType', 'preventable'],
    `${path}.stress.recurringDamage`,
  );
  literalAt(
    damage,
    'event',
    'cast-spell-before-long-rest',
    `${path}.stress.recurringDamage`,
  );
  literalAt(
    damage,
    'dicePerSpellLevel',
    '1d10',
    `${path}.stress.recurringDamage`,
  );
  literalAt(damage, 'damageType', 'necrotic', `${path}.stress.recurringDamage`);
  literalAt(damage, 'preventable', false, `${path}.stress.recurringDamage`);
  const strength = objectAt(stress.strength, `${path}.stress.strength`);
  requireOnlyKeys(
    strength,
    ['maximumAfterStress', 'durationDice', 'unit'],
    `${path}.stress.strength`,
  );
  literalAt(strength, 'maximumAfterStress', 3, `${path}.stress.strength`);
  literalAt(strength, 'durationDice', '2d4', `${path}.stress.strength`);
  literalAt(strength, 'unit', 'day', `${path}.stress.strength`);
  const recovery = objectAt(stress.recovery, `${path}.stress.recovery`);
  requireOnlyKeys(
    recovery,
    ['ordinaryDayReduction', 'restDayReduction', 'maximumRestActivity'],
    `${path}.stress.recovery`,
  );
  literalAt(recovery, 'ordinaryDayReduction', 1, `${path}.stress.recovery`);
  literalAt(recovery, 'restDayReduction', 2, `${path}.stress.recovery`);
  literalAt(
    recovery,
    'maximumRestActivity',
    'light',
    `${path}.stress.recovery`,
  );
  const wishLoss = objectAt(stress.wishLoss, `${path}.stress.wishLoss`);
  requireOnlyKeys(
    wishLoss,
    ['chancePercent', 'state'],
    `${path}.stress.wishLoss`,
  );
  literalAt(wishLoss, 'chancePercent', 33, `${path}.stress.wishLoss`);
  literalAt(
    wishLoss,
    'state',
    'unable-to-cast-wish',
    `${path}.stress.wishLoss`,
  );
}

export function assertBoundedProcedures(
  value: unknown,
  path = 'boundedProcedures',
): asserts value is readonly BoundedProcedure[] {
  const procedures = arrayAt(value, path);
  const ids = new Set<string>();
  const kinds = new Set<string>();
  for (const [index, value] of procedures.entries()) {
    const procedurePath = `${path}[${index}]`;
    const procedure = objectAt(value, procedurePath);
    const id = stringAt(procedure, 'id', procedurePath);
    if (ids.has(id)) {
      throw new BoundedProcedureError(
        `${path} duplicates id ${JSON.stringify(id)}`,
      );
    }
    ids.add(id);
    const kind = stringAt(procedure, 'kind', procedurePath);
    if (kinds.has(kind)) {
      throw new BoundedProcedureError(
        `${path} duplicates kind ${JSON.stringify(kind)}`,
      );
    }
    kinds.add(kind);
    if (kind === 'repeat-save-hazard') {
      validateRepeatSaveHazard(procedure, procedurePath);
    } else if (kind === 'weapon-damage-modes') {
      validateWeaponDamageModes(procedure, procedurePath);
    } else if (kind === 'feature-options') {
      validateFeatureOptions(procedure, procedurePath);
    } else if (kind === 'resource-conversion') {
      validateResourceConversion(procedure, procedurePath);
    } else if (kind === 'adjudicated-stress') {
      validateAdjudicatedStress(procedure, procedurePath);
    } else {
      throw new BoundedProcedureError(
        `${procedurePath}.kind is not a positively selected bounded procedure`,
      );
    }
  }
}

/** Converts the bounded validator's diagnostics into pack-validation errors. */
export function validateBoundedProceduresForPack(
  value: unknown,
  path: string,
): void {
  try {
    assertBoundedProcedures(value, path);
  } catch (error) {
    if (error instanceof BoundedProcedureError) {
      throw new RulesPackError(error.message);
    }
    throw error;
  }
}

export function readBoundedProcedures(
  data: unknown,
): readonly BoundedProcedure[] {
  const root = objectAt(data, 'record.data');
  const mechanics = objectAt(root.mechanics, 'record.data.mechanics');
  assertBoundedProcedures(
    mechanics.procedures,
    'record.data.mechanics.procedures',
  );
  return mechanics.procedures;
}

function procedureOfKind<K extends BoundedProcedure['kind']>(
  data: unknown,
  kind: K,
): Extract<BoundedProcedure, { readonly kind: K }> {
  const matches = readBoundedProcedures(data).filter(
    (procedure): procedure is Extract<BoundedProcedure, { readonly kind: K }> =>
      procedure.kind === kind,
  );
  if (matches.length !== 1) {
    throw new BoundedProcedureError(
      `record.data must contain exactly one ${JSON.stringify(kind)} procedure`,
    );
  }
  return matches[0];
}

export interface FeatureChoiceBinding {
  readonly choiceIndex: number;
  readonly choiceId: string;
  readonly choose: 1;
  readonly offeredOptionIds: readonly string[];
  readonly procedureOptionIds: readonly string[];
}

/** Resolves and closes the real player-facing menu against its bounded effects. */
export function readFeatureChoiceBinding(
  data: unknown,
  procedure: FeatureOptionProcedure,
): FeatureChoiceBinding {
  const root = objectAt(data, 'record.data');
  const choices = arrayAt(root.choices, 'record.data.choices');
  const matchingChoices = choices.flatMap((value, choiceIndex) => {
    const choice = objectAt(value, `record.data.choices[${choiceIndex}]`);
    return choice.id === procedure.choiceId ? [{ choice, choiceIndex }] : [];
  });
  if (matchingChoices.length !== 1) {
    throw new BoundedProcedureError(
      `record.data must contain exactly one choice matching feature procedure choiceId ${JSON.stringify(procedure.choiceId)}`,
    );
  }
  const [{ choice, choiceIndex }] = matchingChoices;
  if (choice.choose !== 1) {
    throw new BoundedProcedureError(
      `record.data.choices[${choiceIndex}].choose must be 1`,
    );
  }
  const offeredOptions = arrayAt(
    choice.options,
    `record.data.choices[${choiceIndex}].options`,
  );
  const offeredOptionIds = offeredOptions.map((value, optionIndex) =>
    stringAt(
      objectAt(
        value,
        `record.data.choices[${choiceIndex}].options[${optionIndex}]`,
      ),
      'id',
      `record.data.choices[${choiceIndex}].options[${optionIndex}]`,
    ),
  );
  if (new Set(offeredOptionIds).size !== offeredOptionIds.length) {
    throw new BoundedProcedureError(
      `record.data.choices[${choiceIndex}].options duplicates an id`,
    );
  }
  const sortedOfferedIds = [...offeredOptionIds].sort();
  const sortedProcedureIds = procedure.options
    .map((option) => option.id)
    .sort();
  if (
    sortedOfferedIds.length !== sortedProcedureIds.length ||
    sortedOfferedIds.some(
      (optionId, index) => optionId !== sortedProcedureIds[index],
    )
  ) {
    throw new BoundedProcedureError(
      `record.data.choices[${choiceIndex}].options must exactly match feature procedure options`,
    );
  }
  return {
    choiceIndex,
    choiceId: procedure.choiceId,
    choose: 1,
    offeredOptionIds: sortedOfferedIds,
    procedureOptionIds: sortedProcedureIds,
  };
}

/**
 * The complete known facts for one bounded Fighting Style predicate. Runtime
 * admission selects the exact member from the generated option effect and
 * rejects missing or unrelated facts instead of interpreting absence as false.
 */
export type FeatureOptionApplicabilityContext =
  | { readonly weaponRange: 'melee' | 'ranged' }
  | { readonly wearingArmor: boolean }
  | {
      readonly weaponRange: 'melee' | 'ranged';
      readonly handsUsed: 1 | 2;
      readonly noOtherWeapon: boolean;
    }
  | {
      readonly weaponRange: 'melee' | 'ranged';
      readonly handsUsed: 1 | 2;
      readonly weaponProperties: readonly string[];
    }
  | {
      readonly attackerVisibleToYou: boolean;
      readonly protectedTargetIsYou: boolean;
      readonly protectedTargetDistanceFromYouFeet: number;
      readonly wieldingShield: boolean;
      readonly reactionAvailable: boolean;
    }
  | { readonly twoWeaponFighting: boolean };

export type BoundedProcedureRequest =
  | {
      readonly kind: 'hazard-save';
      readonly phase: 'initial';
      readonly rollTotal: number;
      readonly priorSuccessfulSaves?: never;
      readonly repeatActive?: never;
    }
  | {
      readonly kind: 'hazard-save';
      readonly phase: 'repeat';
      readonly rollTotal: number;
      readonly priorSuccessfulSaves: number;
      readonly repeatActive: true;
    }
  | { readonly kind: 'weapon-damage'; readonly handsUsed: 1 | 2 }
  | {
      readonly kind: 'select-feature-option';
      readonly optionId: string;
      /** Option IDs selected in completed earlier occurrences of this choice. */
      readonly historicalSelections: readonly string[];
      /** Option IDs occupying this specific choice occurrence. */
      readonly currentChoiceSelections: readonly string[];
    }
  | {
      readonly kind: 'feature-option-applicability';
      readonly optionId: string;
      readonly context: FeatureOptionApplicabilityContext;
    }
  | {
      readonly kind: 'create-spell-slot';
      readonly classLevel: number;
      readonly currentPoints: number;
      readonly slotLevel: number;
    }
  | {
      readonly kind: 'convert-spell-slot';
      readonly classLevel: number;
      readonly currentPoints: number;
      readonly slotLevel: number;
      readonly currentSlotCount: number;
    }
  | {
      readonly kind: 'begin-wish-stress';
      readonly currentStrength: number;
      readonly recoveryDaysRoll: number;
      readonly percentileRoll: number;
    }
  | { readonly kind: 'wish-stress-spell'; readonly spellLevel: number }
  | {
      readonly kind: 'wish-stress-recovery-day';
      readonly remainingDays: number;
      readonly activity: 'light' | 'strenuous';
    };

export type BoundedProcedureResult =
  | {
      readonly kind: 'hazard-save';
      readonly succeeded: boolean;
      readonly damage?: DamageAtom;
      readonly successfulSaves: number;
      readonly repeatActive: boolean;
      readonly ended: boolean;
    }
  | { readonly kind: 'weapon-damage'; readonly damage: DamageAtom }
  | {
      readonly kind: 'feature-option-selected';
      readonly optionId: string;
      readonly effect: FeatureOptionEffect;
    }
  | {
      readonly kind: 'feature-option-applicability';
      readonly optionId: string;
      readonly applicable: boolean;
    }
  | {
      readonly kind: 'resource-transition';
      readonly actionCost: 'bonus-action';
      readonly pointDelta: number;
      readonly slotLevel: number;
      readonly slotDelta: 1 | -1;
      readonly createdSlotExpires?: 'long-rest';
    }
  | {
      readonly kind: 'wish-stress-started';
      readonly strength: number;
      readonly recoveryDays: number;
      readonly unableToCastWish: boolean;
    }
  | {
      readonly kind: 'wish-stress-damage';
      readonly damage: {
        readonly dice: string;
        readonly type: 'necrotic';
      };
      readonly preventable: false;
    }
  | {
      readonly kind: 'wish-stress-no-damage';
      readonly spellLevel: 0;
      readonly damage: 0;
    }
  | { readonly kind: 'wish-stress-recovery'; readonly remainingDays: number };

function finiteInteger(
  value: unknown,
  name: string,
  minimum?: number,
  maximum?: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    (minimum !== undefined && value < minimum) ||
    (maximum !== undefined && value > maximum)
  ) {
    const range =
      minimum === undefined
        ? ''
        : maximum === undefined
          ? ` >= ${minimum}`
          : ` between ${minimum} and ${maximum}`;
    throw new BoundedProcedureError(`${name} must be a finite integer${range}`);
  }
  return value;
}

function exactKeys(
  object: JsonObject,
  keys: readonly string[],
  path: string,
): void {
  requireOnlyKeys(object, keys, path);
  for (const key of keys) {
    if (!Object.hasOwn(object, key)) {
      throw new BoundedProcedureError(
        `${path} is missing required key ${JSON.stringify(key)}`,
      );
    }
  }
}

function booleanAt(object: JsonObject, key: string, path: string): boolean {
  const value = object[key];
  if (typeof value !== 'boolean') {
    throw new BoundedProcedureError(`${path}.${key} must be boolean`);
  }
  return value;
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new BoundedProcedureError(`${path} must be an array of strings`);
  }
  const strings = value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new BoundedProcedureError(
        `${path}[${index}] must be a non-empty string`,
      );
    }
    return entry;
  });
  if (new Set(strings).size !== strings.length) {
    throw new BoundedProcedureError(`${path} must not contain duplicates`);
  }
  return strings;
}

function validateBoundedProcedureRequest(
  value: unknown,
): BoundedProcedureRequest {
  const request = objectAt(value, 'bounded procedure request');
  const kind = stringAt(request, 'kind', 'bounded procedure request');
  if (kind === 'hazard-save') {
    const phase = request.phase;
    if (phase === 'initial') {
      exactKeys(
        request,
        ['kind', 'phase', 'rollTotal'],
        'initial hazard request',
      );
      finiteInteger(request.rollTotal, 'hazard rollTotal');
      return request as unknown as BoundedProcedureRequest;
    }
    if (phase === 'repeat') {
      exactKeys(
        request,
        ['kind', 'phase', 'rollTotal', 'priorSuccessfulSaves', 'repeatActive'],
        'repeat hazard request',
      );
      finiteInteger(request.rollTotal, 'hazard rollTotal');
      finiteInteger(
        request.priorSuccessfulSaves,
        'hazard priorSuccessfulSaves',
        0,
      );
      literalAt(request, 'repeatActive', true, 'repeat hazard request');
      return request as unknown as BoundedProcedureRequest;
    }
    throw new BoundedProcedureError(
      'hazard request.phase must be initial or repeat',
    );
  }
  if (kind === 'weapon-damage') {
    exactKeys(request, ['kind', 'handsUsed'], 'weapon damage request');
    finiteInteger(request.handsUsed, 'weapon handsUsed', 1, 2);
    return request as unknown as BoundedProcedureRequest;
  }
  if (kind === 'select-feature-option') {
    exactKeys(
      request,
      ['kind', 'optionId', 'historicalSelections', 'currentChoiceSelections'],
      'feature selection request',
    );
    stringAt(request, 'optionId', 'feature selection request');
    stringArray(
      request.historicalSelections,
      'feature selection request.historicalSelections',
    );
    stringArray(
      request.currentChoiceSelections,
      'feature selection request.currentChoiceSelections',
    );
    return request as unknown as BoundedProcedureRequest;
  }
  if (kind === 'feature-option-applicability') {
    exactKeys(
      request,
      ['kind', 'optionId', 'context'],
      'feature applicability request',
    );
    stringAt(request, 'optionId', 'feature applicability request');
    objectAt(request.context, 'feature applicability context');
    return request as unknown as BoundedProcedureRequest;
  }
  if (kind === 'create-spell-slot') {
    exactKeys(
      request,
      ['kind', 'classLevel', 'currentPoints', 'slotLevel'],
      'create spell slot request',
    );
    finiteInteger(request.classLevel, 'resource classLevel', 1);
    finiteInteger(request.currentPoints, 'resource currentPoints', 0);
    finiteInteger(request.slotLevel, 'resource slotLevel', 1, 9);
    return request as unknown as BoundedProcedureRequest;
  }
  if (kind === 'convert-spell-slot') {
    exactKeys(
      request,
      ['kind', 'classLevel', 'currentPoints', 'slotLevel', 'currentSlotCount'],
      'convert spell slot request',
    );
    finiteInteger(request.classLevel, 'resource classLevel', 1);
    finiteInteger(request.currentPoints, 'resource currentPoints', 0);
    finiteInteger(request.slotLevel, 'resource slotLevel', 1, 9);
    finiteInteger(request.currentSlotCount, 'resource currentSlotCount', 1);
    return request as unknown as BoundedProcedureRequest;
  }
  if (kind === 'begin-wish-stress') {
    exactKeys(
      request,
      ['kind', 'currentStrength', 'recoveryDaysRoll', 'percentileRoll'],
      'begin wish stress request',
    );
    finiteInteger(
      request.currentStrength,
      'wish currentStrength',
      LIVE_STATE_MIN_ABILITY_SCORE,
      LIVE_STATE_MAX_ABILITY_SCORE,
    );
    finiteInteger(request.recoveryDaysRoll, 'wish recoveryDaysRoll', 2, 8);
    finiteInteger(request.percentileRoll, 'wish percentileRoll', 1, 100);
    return request as unknown as BoundedProcedureRequest;
  }
  if (kind === 'wish-stress-spell') {
    exactKeys(request, ['kind', 'spellLevel'], 'wish stress spell request');
    finiteInteger(request.spellLevel, 'wish spellLevel', 0, 9);
    return request as unknown as BoundedProcedureRequest;
  }
  if (kind === 'wish-stress-recovery-day') {
    exactKeys(
      request,
      ['kind', 'remainingDays', 'activity'],
      'wish stress recovery request',
    );
    finiteInteger(request.remainingDays, 'wish remainingDays', 0);
    if (request.activity !== 'light' && request.activity !== 'strenuous') {
      throw new BoundedProcedureError(
        'wish activity must be light or strenuous',
      );
    }
    return request as unknown as BoundedProcedureRequest;
  }
  throw new BoundedProcedureError(
    `unsupported bounded procedure request kind ${JSON.stringify(kind)}`,
  );
}

function featureOptionApplies(
  effect: FeatureOptionEffect,
  rawContext: unknown,
): boolean {
  const context = objectAt(rawContext, 'feature applicability context');
  if (effect.kind === 'attack-roll-bonus') {
    exactKeys(context, ['weaponRange'], 'feature applicability context');
    if (context.weaponRange !== 'melee' && context.weaponRange !== 'ranged') {
      throw new BoundedProcedureError(
        'feature applicability context.weaponRange must be melee or ranged',
      );
    }
    return context.weaponRange === effect.weaponRange;
  }
  if (effect.kind === 'armor-class-bonus') {
    exactKeys(context, ['wearingArmor'], 'feature applicability context');
    return (
      effect.whileWearingArmor &&
      booleanAt(context, 'wearingArmor', 'feature applicability context')
    );
  }
  if (effect.kind === 'damage-roll-bonus') {
    exactKeys(
      context,
      ['weaponRange', 'handsUsed', 'noOtherWeapon'],
      'feature applicability context',
    );
    if (context.weaponRange !== 'melee' && context.weaponRange !== 'ranged') {
      throw new BoundedProcedureError(
        'feature applicability context.weaponRange must be melee or ranged',
      );
    }
    finiteInteger(
      context.handsUsed,
      'feature applicability context.handsUsed',
      1,
      2,
    );
    const noOtherWeapon = booleanAt(
      context,
      'noOtherWeapon',
      'feature applicability context',
    );
    return (
      context.weaponRange === effect.weaponRange &&
      context.handsUsed === effect.weaponHands &&
      effect.noOtherWeapon &&
      noOtherWeapon
    );
  }
  if (effect.kind === 'damage-die-reroll') {
    exactKeys(
      context,
      ['weaponRange', 'handsUsed', 'weaponProperties'],
      'feature applicability context',
    );
    if (context.weaponRange !== 'melee' && context.weaponRange !== 'ranged') {
      throw new BoundedProcedureError(
        'feature applicability context.weaponRange must be melee or ranged',
      );
    }
    finiteInteger(
      context.handsUsed,
      'feature applicability context.handsUsed',
      1,
      2,
    );
    const weaponProperties = stringArray(
      context.weaponProperties,
      'feature applicability context.weaponProperties',
    );
    return (
      context.weaponRange === effect.weaponRange &&
      context.handsUsed === effect.handsUsed &&
      effect.propertyRequirement.kind === 'any-of' &&
      effect.propertyRequirement.properties.some((property) =>
        weaponProperties.includes(property),
      )
    );
  }
  if (effect.kind === 'reaction-attack-disadvantage') {
    exactKeys(
      context,
      [
        'attackerVisibleToYou',
        'protectedTargetIsYou',
        'protectedTargetDistanceFromYouFeet',
        'wieldingShield',
        'reactionAvailable',
      ],
      'feature applicability context',
    );
    const attackerVisibleToYou = booleanAt(
      context,
      'attackerVisibleToYou',
      'feature applicability context',
    );
    const protectedTargetIsYou = booleanAt(
      context,
      'protectedTargetIsYou',
      'feature applicability context',
    );
    const wieldingShield = booleanAt(
      context,
      'wieldingShield',
      'feature applicability context',
    );
    const reactionAvailable = booleanAt(
      context,
      'reactionAvailable',
      'feature applicability context',
    );
    const distance = context.protectedTargetDistanceFromYouFeet;
    if (
      typeof distance !== 'number' ||
      !Number.isFinite(distance) ||
      distance < 0
    ) {
      throw new BoundedProcedureError(
        'feature applicability context.protectedTargetDistanceFromYouFeet must be finite and non-negative',
      );
    }
    return (
      effect.actionCost === 'reaction' &&
      reactionAvailable &&
      effect.attacker.mustBeVisibleToYou &&
      attackerVisibleToYou &&
      effect.protectedTarget.mustBeOtherThanYou &&
      !protectedTargetIsYou &&
      distance <= effect.protectedTarget.maximumDistanceFromYouFeet &&
      effect.requiresShield &&
      wieldingShield
    );
  }
  exactKeys(context, ['twoWeaponFighting'], 'feature applicability context');
  return (
    effect.addAbilityModifier &&
    booleanAt(context, 'twoWeaponFighting', 'feature applicability context')
  );
}

/**
 * Executes only the five positively selected procedures. The harness receives
 * redacted record data: no record key, source metadata, obligation, or proof
 * result is available to semantic dispatch.
 */
export function executeBoundedProcedure(
  data: unknown,
  rawRequest: unknown,
): BoundedProcedureResult {
  const request = validateBoundedProcedureRequest(rawRequest);
  if (request.kind === 'hazard-save') {
    const procedure = procedureOfKind(data, 'repeat-save-hazard');
    const priorSuccessfulSaves =
      request.phase === 'initial'
        ? 0
        : finiteInteger(
            request.priorSuccessfulSaves,
            'hazard priorSuccessfulSaves',
            0,
            procedure.termination.count - 1,
          );
    const branch =
      request.phase === 'initial' ? procedure.initial : procedure.repeat;
    const succeeded = request.rollTotal >= branch.save.dc;
    if (request.phase === 'initial') {
      const ended =
        succeeded && procedure.entryTransition.onInitialSuccess === 'end';
      return {
        kind: 'hazard-save',
        succeeded,
        ...(succeeded ? {} : { damage: branch.failureDamage }),
        successfulSaves: 0,
        repeatActive:
          !succeeded &&
          procedure.entryTransition.onInitialFailure === 'activate-repeat',
        ended,
      };
    }
    const successfulSaves = priorSuccessfulSaves + (succeeded ? 1 : 0);
    const ended = successfulSaves >= procedure.termination.count;
    return {
      kind: 'hazard-save',
      succeeded,
      ...(succeeded ? {} : { damage: branch.failureDamage }),
      successfulSaves,
      repeatActive: !ended,
      ended,
    };
  }
  if (request.kind === 'weapon-damage') {
    const procedure = procedureOfKind(data, 'weapon-damage-modes');
    finiteInteger(request.handsUsed, 'weapon handsUsed', 1, 2);
    const modes = procedure.modes.filter(
      (mode) => mode.hands === request.handsUsed,
    );
    if (modes.length !== 1) {
      throw new BoundedProcedureError(
        `weapon procedure does not define exactly one mode for hands=${request.handsUsed}`,
      );
    }
    return { kind: 'weapon-damage', damage: modes[0].damage };
  }
  if (request.kind === 'select-feature-option') {
    const procedure = procedureOfKind(data, 'feature-options');
    const choice = readFeatureChoiceBinding(data, procedure);
    const procedureOptionIds = new Set(
      procedure.options.map((option) => option.id),
    );
    for (const selectedOptionId of [
      ...request.historicalSelections,
      ...request.currentChoiceSelections,
    ]) {
      if (!procedureOptionIds.has(selectedOptionId)) {
        throw new BoundedProcedureError(
          `feature selection state contains unknown option ${JSON.stringify(selectedOptionId)}`,
        );
      }
    }
    const duplicatedAcrossState = request.currentChoiceSelections.find(
      (optionId) => request.historicalSelections.includes(optionId),
    );
    if (duplicatedAcrossState !== undefined) {
      throw new BoundedProcedureError(
        `feature selection state duplicates option ${JSON.stringify(duplicatedAcrossState)} across historical and current-choice state`,
      );
    }
    if (
      procedure.duplicateSelection === 'prohibited' &&
      request.historicalSelections.includes(request.optionId)
    ) {
      throw new BoundedProcedureError(
        `feature option ${JSON.stringify(request.optionId)} is already selected`,
      );
    }
    if (request.currentChoiceSelections.length >= choice.choose) {
      throw new BoundedProcedureError(
        `feature choice ${JSON.stringify(choice.choiceId)} is already fulfilled`,
      );
    }
    const options = procedure.options.filter(
      (option) => option.id === request.optionId,
    );
    if (options.length !== 1) {
      throw new BoundedProcedureError(
        `feature procedure does not define option ${JSON.stringify(request.optionId)}`,
      );
    }
    return {
      kind: 'feature-option-selected',
      optionId: options[0].id,
      effect: options[0].effect,
    };
  }
  if (request.kind === 'feature-option-applicability') {
    const procedure = procedureOfKind(data, 'feature-options');
    readFeatureChoiceBinding(data, procedure);
    const options = procedure.options.filter(
      (option) => option.id === request.optionId,
    );
    if (options.length !== 1) {
      throw new BoundedProcedureError(
        `feature procedure does not define option ${JSON.stringify(request.optionId)}`,
      );
    }
    return {
      kind: 'feature-option-applicability',
      optionId: options[0].id,
      applicable: featureOptionApplies(options[0].effect, request.context),
    };
  }
  if (
    request.kind === 'create-spell-slot' ||
    request.kind === 'convert-spell-slot'
  ) {
    const procedure = procedureOfKind(data, 'resource-conversion');
    const maximum = procedure.pool.maximumByLevel.find(
      (entry) => entry.level === request.classLevel,
    )?.maximum;
    if (maximum === undefined) {
      throw new BoundedProcedureError(
        `resource procedure has no maximum for class level ${request.classLevel}`,
      );
    }
    if (request.currentPoints > maximum) {
      throw new BoundedProcedureError(
        `resource currentPoints exceeds the class-level maximum ${maximum}`,
      );
    }
    if (request.kind === 'create-spell-slot') {
      const operation = procedure.operations.createSpellSlot;
      const cost = operation.costBySlotLevel.find(
        (entry) => entry.slotLevel === request.slotLevel,
      )?.cost;
      if (
        cost === undefined ||
        request.slotLevel > operation.maximumSlotLevel
      ) {
        throw new BoundedProcedureError(
          `cannot create spell slot level ${request.slotLevel}`,
        );
      }
      if (request.currentPoints < cost) {
        throw new BoundedProcedureError(
          `creating spell slot level ${request.slotLevel} requires ${cost} points`,
        );
      }
      return {
        kind: 'resource-transition',
        actionCost: operation.actionCost,
        pointDelta: -cost,
        slotLevel: request.slotLevel,
        slotDelta: 1,
        createdSlotExpires: operation.createdSlotExpires,
      };
    }
    const operation = procedure.operations.convertSpellSlot;
    if (
      request.slotLevel < 1 ||
      request.currentPoints + request.slotLevel > maximum
    ) {
      throw new BoundedProcedureError(
        `converting spell slot level ${request.slotLevel} exceeds the resource maximum`,
      );
    }
    return {
      kind: 'resource-transition',
      actionCost: operation.actionCost,
      pointDelta: request.slotLevel,
      slotLevel: request.slotLevel,
      slotDelta: -1,
    };
  }
  const procedure = procedureOfKind(data, 'adjudicated-stress');
  if (request.kind === 'begin-wish-stress') {
    return {
      kind: 'wish-stress-started',
      strength: Math.min(
        request.currentStrength,
        procedure.stress.strength.maximumAfterStress,
      ),
      recoveryDays: request.recoveryDaysRoll,
      unableToCastWish:
        request.percentileRoll <= procedure.stress.wishLoss.chancePercent,
    };
  }
  if (request.kind === 'wish-stress-spell') {
    if (request.spellLevel === 0) {
      return {
        kind: 'wish-stress-no-damage',
        spellLevel: 0,
        damage: 0,
      };
    }
    const perLevel = procedure.stress.recurringDamage.dicePerSpellLevel;
    const dice = /^(\d+)d(\d+)$/.exec(perLevel);
    if (dice === null) {
      throw new BoundedProcedureError(
        'wish dicePerSpellLevel must be a dice expression',
      );
    }
    return {
      kind: 'wish-stress-damage',
      damage: {
        dice: `${request.spellLevel * Number(dice[1])}d${dice[2]}`,
        type: procedure.stress.recurringDamage.damageType,
      },
      preventable: procedure.stress.recurringDamage.preventable,
    };
  }
  if (request.kind === 'wish-stress-recovery-day') {
    const reduction =
      request.activity === 'light'
        ? procedure.stress.recovery.restDayReduction
        : procedure.stress.recovery.ordinaryDayReduction;
    return {
      kind: 'wish-stress-recovery',
      remainingDays: Math.max(0, request.remainingDays - reduction),
    };
  }
  throw new BoundedProcedureError('unsupported bounded procedure request');
}
