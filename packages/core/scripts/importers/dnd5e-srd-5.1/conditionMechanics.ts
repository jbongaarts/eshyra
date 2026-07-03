import type { ConditionExtraction } from './types.js';

type MechanicsEffect = Record<string, unknown>;

export interface ConditionMechanics {
  readonly effects?: readonly MechanicsEffect[];
  readonly levelApplication?: 'current-and-lower';
  readonly levels?: readonly {
    readonly level: number;
    readonly effects: readonly MechanicsEffect[];
  }[];
}

const STRENGTH_DEXTERITY = ['strength', 'dexterity'] as const;

function effectsForCondition(name: string): readonly MechanicsEffect[] {
  switch (name) {
    case 'Blinded':
      return [
        { kind: 'cannotSee', subject: 'conditioned' },
        {
          kind: 'autoFailCheck',
          subject: 'conditioned',
          roll: 'ability-check',
          requiredSense: 'sight',
        },
        {
          kind: 'attackRollModifier',
          subject: 'against-conditioned',
          mode: 'advantage',
        },
        {
          kind: 'attackRollModifier',
          subject: 'conditioned',
          mode: 'disadvantage',
        },
      ];
    case 'Charmed':
      return [
        {
          kind: 'cannotAttackOrTarget',
          subject: 'conditioned',
          target: 'charmer',
          harmfulOnly: true,
        },
        {
          kind: 'abilityCheckModifier',
          subject: 'charmer',
          target: 'conditioned',
          mode: 'advantage',
          context: 'social-interaction',
        },
      ];
    case 'Deafened':
      return [
        { kind: 'cannotHear', subject: 'conditioned' },
        {
          kind: 'autoFailCheck',
          subject: 'conditioned',
          roll: 'ability-check',
          requiredSense: 'hearing',
        },
      ];
    case 'Frightened':
      return [
        {
          kind: 'abilityCheckModifier',
          subject: 'conditioned',
          mode: 'disadvantage',
          context: 'fear-source-in-line-of-sight',
        },
        {
          kind: 'attackRollModifier',
          subject: 'conditioned',
          mode: 'disadvantage',
          context: 'fear-source-in-line-of-sight',
        },
        {
          kind: 'movementRestriction',
          subject: 'conditioned',
          restriction: 'cannot-willingly-move-closer',
          target: 'fear-source',
        },
      ];
    case 'Grappled':
      return [
        { kind: 'speedSet', subject: 'conditioned', speed: 0 },
        { kind: 'speedBonusSuppressed', subject: 'conditioned' },
        {
          kind: 'conditionEndsWhen',
          condition: 'grappled',
          trigger: 'grappler-incapacitated',
        },
        {
          kind: 'conditionEndsWhen',
          condition: 'grappled',
          trigger: 'removed-from-grappler-reach',
        },
      ];
    case 'Incapacitated':
      return [
        { kind: 'cannotTakeActions', subject: 'conditioned' },
        { kind: 'cannotTakeReactions', subject: 'conditioned' },
      ];
    case 'Invisible':
      return [
        {
          kind: 'visibility',
          subject: 'conditioned',
          state: 'impossible-to-see',
          exceptions: ['magic', 'special-sense'],
        },
        {
          kind: 'obscurement',
          subject: 'conditioned',
          degree: 'heavily-obscured',
          context: 'hiding',
        },
        {
          kind: 'locationDetectableBy',
          subject: 'conditioned',
          clues: ['noise', 'tracks'],
        },
        {
          kind: 'attackRollModifier',
          subject: 'against-conditioned',
          mode: 'disadvantage',
        },
        {
          kind: 'attackRollModifier',
          subject: 'conditioned',
          mode: 'advantage',
        },
      ];
    case 'Paralyzed':
      return [
        {
          kind: 'impliesCondition',
          subject: 'conditioned',
          condition: 'incapacitated',
        },
        { kind: 'cannotMove', subject: 'conditioned' },
        { kind: 'cannotSpeak', subject: 'conditioned' },
        {
          kind: 'autoFailSave',
          subject: 'conditioned',
          roll: 'saving-throw',
          abilities: STRENGTH_DEXTERITY,
        },
        {
          kind: 'attackRollModifier',
          subject: 'against-conditioned',
          mode: 'advantage',
        },
        {
          kind: 'criticalHitOnHit',
          subject: 'against-conditioned',
          attackerWithinFeet: 5,
        },
      ];
    case 'Petrified':
      return [
        {
          kind: 'transformed',
          subject: 'conditioned',
          form: 'solid-inanimate-substance',
        },
        { kind: 'weightMultiplier', subject: 'conditioned', multiplier: 10 },
        { kind: 'stopsAging', subject: 'conditioned' },
        {
          kind: 'impliesCondition',
          subject: 'conditioned',
          condition: 'incapacitated',
        },
        { kind: 'cannotMove', subject: 'conditioned' },
        { kind: 'cannotSpeak', subject: 'conditioned' },
        { kind: 'unaware', subject: 'conditioned' },
        {
          kind: 'attackRollModifier',
          subject: 'against-conditioned',
          mode: 'advantage',
        },
        {
          kind: 'autoFailSave',
          subject: 'conditioned',
          roll: 'saving-throw',
          abilities: STRENGTH_DEXTERITY,
        },
        { kind: 'damageResistance', subject: 'conditioned', damage: 'all' },
        {
          kind: 'immunity',
          subject: 'conditioned',
          targets: ['poison', 'disease'],
          existingEffects: 'suspended-not-neutralized',
        },
      ];
    case 'Poisoned':
      return [
        {
          kind: 'attackRollModifier',
          subject: 'conditioned',
          mode: 'disadvantage',
        },
        {
          kind: 'abilityCheckModifier',
          subject: 'conditioned',
          mode: 'disadvantage',
        },
      ];
    case 'Prone':
      return [
        {
          kind: 'movementRestriction',
          subject: 'conditioned',
          restriction: 'crawl-only',
          endsBy: 'stand-up',
        },
        {
          kind: 'attackRollModifier',
          subject: 'conditioned',
          mode: 'disadvantage',
        },
        {
          kind: 'attackRollModifier',
          subject: 'against-conditioned',
          mode: 'advantage',
          attackerWithinFeet: 5,
        },
        {
          kind: 'attackRollModifier',
          subject: 'against-conditioned',
          mode: 'disadvantage',
          attackerBeyondFeet: 5,
        },
      ];
    case 'Restrained':
      return [
        { kind: 'speedSet', subject: 'conditioned', speed: 0 },
        { kind: 'speedBonusSuppressed', subject: 'conditioned' },
        {
          kind: 'attackRollModifier',
          subject: 'against-conditioned',
          mode: 'advantage',
        },
        {
          kind: 'attackRollModifier',
          subject: 'conditioned',
          mode: 'disadvantage',
        },
        {
          kind: 'savingThrowModifier',
          subject: 'conditioned',
          mode: 'disadvantage',
          roll: 'saving-throw',
          abilities: ['dexterity'],
        },
      ];
    case 'Stunned':
      return [
        {
          kind: 'impliesCondition',
          subject: 'conditioned',
          condition: 'incapacitated',
        },
        { kind: 'cannotMove', subject: 'conditioned' },
        {
          kind: 'speechRestricted',
          subject: 'conditioned',
          restriction: 'faltering-only',
        },
        {
          kind: 'autoFailSave',
          subject: 'conditioned',
          roll: 'saving-throw',
          abilities: STRENGTH_DEXTERITY,
        },
        {
          kind: 'attackRollModifier',
          subject: 'against-conditioned',
          mode: 'advantage',
        },
      ];
    case 'Unconscious':
      return [
        {
          kind: 'impliesCondition',
          subject: 'conditioned',
          condition: 'incapacitated',
        },
        { kind: 'cannotMove', subject: 'conditioned' },
        { kind: 'cannotSpeak', subject: 'conditioned' },
        { kind: 'unaware', subject: 'conditioned' },
        { kind: 'dropHeldObjects', subject: 'conditioned' },
        {
          kind: 'imposesCondition',
          subject: 'conditioned',
          condition: 'prone',
        },
        {
          kind: 'autoFailSave',
          subject: 'conditioned',
          roll: 'saving-throw',
          abilities: STRENGTH_DEXTERITY,
        },
        {
          kind: 'attackRollModifier',
          subject: 'against-conditioned',
          mode: 'advantage',
        },
        {
          kind: 'criticalHitOnHit',
          subject: 'against-conditioned',
          attackerWithinFeet: 5,
        },
      ];
    default:
      return [];
  }
}

function effectsForExhaustionLevel(level: number): readonly MechanicsEffect[] {
  switch (level) {
    case 1:
      return [
        {
          kind: 'abilityCheckModifier',
          subject: 'conditioned',
          mode: 'disadvantage',
        },
      ];
    case 2:
      return [
        { kind: 'speedMultiplier', subject: 'conditioned', multiplier: 0.5 },
      ];
    case 3:
      return [
        {
          kind: 'attackRollModifier',
          subject: 'conditioned',
          mode: 'disadvantage',
        },
        {
          kind: 'savingThrowModifier',
          subject: 'conditioned',
          mode: 'disadvantage',
          roll: 'saving-throw',
        },
      ];
    case 4:
      return [
        {
          kind: 'hitPointMaximumMultiplier',
          subject: 'conditioned',
          multiplier: 0.5,
        },
      ];
    case 5:
      return [{ kind: 'speedSet', subject: 'conditioned', speed: 0 }];
    case 6:
      return [{ kind: 'death', subject: 'conditioned' }];
    default:
      return [];
  }
}

export function deriveConditionRecordMechanics(
  condition: ConditionExtraction,
): ConditionMechanics | undefined {
  const effects = effectsForCondition(condition.name);
  const levels = condition.levels
    ?.map((level) => ({
      level: level.level,
      effects: effectsForExhaustionLevel(level.level),
    }))
    .filter((level) => level.effects.length > 0);

  if (effects.length === 0 && (levels === undefined || levels.length === 0)) {
    return undefined;
  }

  return {
    ...(effects.length > 0 ? { effects } : {}),
    ...(levels !== undefined && levels.length > 0
      ? { levelApplication: 'current-and-lower', levels }
      : {}),
  };
}
