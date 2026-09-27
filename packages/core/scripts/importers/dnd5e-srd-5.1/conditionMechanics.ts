import type { ConditionExtraction } from './types.js';

type MechanicsEffect = Record<string, unknown>;

export interface ConditionMechanics {
  readonly effects?: readonly MechanicsEffect[];
  readonly levelApplication?: 'current-and-lower';
  readonly levels?: readonly {
    readonly level: number;
    readonly effects: readonly MechanicsEffect[];
  }[];
  readonly levelLifecycle?: ExhaustionLevelLifecycle;
}

/**
 * How an exhaustion level is gained, lost, and ended (eshyra-o9bd.19.3.4).
 * The six level rows say only what each level DOES; the introductory prose
 * also says how the level CHANGES, including the one rest interaction the
 * condition owns. Each clause is emitted only when its exact source sentence
 * is present, so a reworded source drops the clause instead of keeping a
 * curated claim the text no longer makes.
 */
export interface ExhaustionLevelLifecycle {
  readonly gain?: 'increase-by-amount-specified-by-effect';
  readonly removal?: 'reduce-by-amount-specified-by-effect';
  readonly endsWhenLevelBelow?: 1;
  readonly restReduction?: {
    readonly rest: 'long-rest';
    readonly levels: 1;
    readonly requires: 'ingested-food-and-drink';
  };
  /**
   * Rules elsewhere in the source that override this lifecycle. SRD 5.1
   * "Food and Water": exhaustion caused by lack of food or water "can't be
   * removed until the character eats and drinks the full required amount".
   */
  readonly exceptionRuleRefs?: readonly string[];
}

const EXHAUSTION_LIFECYCLE_CLAUSES = {
  gain: 'If an already exhausted creature suffers another effect that causes exhaustion, its current level of exhaustion increases by the amount specified in the effect’s description.',
  removal:
    'An effect that removes exhaustion reduces its level as specified in the effect’s description, with all exhaustion effects ending if a creature’s exhaustion level is reduced below 1.',
  restReduction:
    'Finishing a long rest reduces a creature’s exhaustion level by 1, provided that the creature has also ingested some food and drink.',
} as const;

function deriveExhaustionLevelLifecycle(
  description: string,
): ExhaustionLevelLifecycle | undefined {
  const says = (clause: string): boolean => description.includes(clause);
  const lifecycle: ExhaustionLevelLifecycle = {
    ...(says(EXHAUSTION_LIFECYCLE_CLAUSES.gain)
      ? { gain: 'increase-by-amount-specified-by-effect' }
      : {}),
    ...(says(EXHAUSTION_LIFECYCLE_CLAUSES.removal)
      ? {
          removal: 'reduce-by-amount-specified-by-effect',
          endsWhenLevelBelow: 1,
        }
      : {}),
    ...(says(EXHAUSTION_LIFECYCLE_CLAUSES.restReduction)
      ? {
          restReduction: {
            rest: 'long-rest',
            levels: 1,
            requires: 'ingested-food-and-drink',
          },
          exceptionRuleRefs: ['rule:food-and-water'],
        }
      : {}),
  };
  return Object.keys(lifecycle).length > 0 ? lifecycle : undefined;
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

  const hasLevels = levels !== undefined && levels.length > 0;
  const levelLifecycle = hasLevels
    ? deriveExhaustionLevelLifecycle(condition.description)
    : undefined;
  return {
    ...(effects.length > 0 ? { effects } : {}),
    ...(hasLevels ? { levelApplication: 'current-and-lower', levels } : {}),
    ...(levelLifecycle !== undefined ? { levelLifecycle } : {}),
  };
}
