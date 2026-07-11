// Kind-specific schema validation for rules records.
//
// Every record kind has a baseline validator that all systems share. Where a
// system supplies structured data for a given kind (today: `dnd5e-srd` and
// `pathfinder2e-remaster`), a system-specific validator layers additional
// shape checks on top. Unregistered (system, kind) pairs fall through to the
// baseline check, so a new importer can ship records before its deeper schemas
// exist.

import { CONDITION_RELATION_VALUES } from './conditionRelations.js';
import {
  FEATURE_CHOICE_CATEGORIES,
  isFeatureChoiceCategory,
} from './featureChoices.js';
import {
  summoningHasTransitionTrigger,
  validateS1SummoningEffect,
} from './summoningSchema.js';
import type { RulesRecord, RulesRecordKind } from './types.js';
import { RulesPackError } from './types.js';

type Obj = Record<string, unknown>;
type Validator = (record: RulesRecord, path: string) => void;
type Scalar = string | number | boolean | null;

// Closed relation vocabulary shared with the classifier and the
// condition-relation-safety audit gate (see conditionRelations.ts).
const CONDITION_RELATIONS = new Set<string>(CONDITION_RELATION_VALUES);

const MECHANICS_EFFECT_KINDS: ReadonlySet<string> = new Set([
  'abilityCheckModifier',
  'acBonus',
  'acFormula',
  'acMinimum',
  'abilityScoreIncrease',
  'advantage',
  'attackAndDamageBonus',
  'attackOrDamageBonus',
  'attackRollModifier',
  'attackableAppendage',
  'banishment',
  'berserk',
  'cannotWearOrCarry',
  'carryingCapacitySize',
  'changeShape',
  'climbAnywhere',
  'communication',
  'communicationBarriers',
  'concurrentEffectLimit',
  'conjuredUtilityObject',
  'corpseEligibility',
  'createsOrDestroysWater',
  'createsProvisions',
  'dcIncrease',
  'endsCurses',
  'extraTurns',
  'falseAppearance',
  'illusionDiscernment',
  'jumpDistanceMultiplier',
  'locationKnowledge',
  'mirrorImages',
  'movementCostMultiplier',
  'messengerTravel',
  'naturalWeaponDamage',
  'onsetTime',
  'pathMemory',
  'percentChance',
  'permanenceAfterRepetition',
  'questionLimit',
  'recastLockout',
  'senseSharing',
  'slowFall',
  'splitOnDamage',
  'stabilize',
  'stagedTableShift',
  'sleepException',
  'summoning',
  'telepathy',
  'terrainAlteration',
  'understandLanguages',
  'unlock',
  'walkOnLiquids',
  'climbWithoutCheck',
  'damageTransfer',
  'damageAbsorption',
  'earthGlide',
  'enterHostileSpace',
  'hoveringWeapon',
  'illusoryDisguise',
  'summonCreature',
  'extraReactions',
  'extraWeaponDamageDie',
  'hiddenFromView',
  'ignoreDifficultTerrain',
  'ignoreMovementRestriction',
  'limitedAmmunition',
  'mimicry',
  'moveThroughNarrowSpaces',
  'moveUpTo',
  'planeShift',
  'recurringDamage',
  'rejuvenation',
  'seeInMagicalDarkness',
  'spellReflection',
  'spellStoring',
  'swarm',
  'teleport',
  'tunneler',
  'weaponCorrosion',
  'autoFailCheck',
  'autoFailSave',
  'abilitySubstitution',
  'autoSucceedSave',
  'benefitEndsWhen',
  'bonusAction',
  'triggeredBonusAction',
  'breathes',
  'brutalCritical',
  'cannotAttackOrTarget',
  'cannotHear',
  'checkBonus',
  'checkMinimum',
  'climbWithoutExtraMovement',
  'cannotMove',
  'cannotSee',
  'cannotSpeak',
  'cannotTakeActions',
  'cannotTakeReactions',
  'conditionEndsWhen',
  'damageDieReplacement',
  'damageMultiplier',
  'damageOnSuccessfulSave',
  'damageReduction',
  'criticalHitOnHit',
  'criticalRange',
  'castSpell',
  'damageResistance',
  'death',
  'damageBonus',
  'dropHeldObjects',
  'evasion',
  'expertise',
  'extraAttack',
  'extraDamage',
  'extraDamageOnHit',
  'extraMovement',
  'extraTurn',
  'forcedMovement',
  'gainRuleBenefitsOnSuccess',
  'halfProficiencyToChecks',
  'healing',
  'hitPointMaximumIncrease',
  'hitPointMaximumMultiplier',
  'holdBreath',
  'immunity',
  'jumpDistance',
  'jumpDistanceBonus',
  'light',
  'impliesCondition',
  'imposesCondition',
  'legendaryResistance',
  'locationDetectableBy',
  'makeAbilityCheck',
  'makeAttack',
  'maximizeHealingDice',
  'movementRestriction',
  'multiattack',
  'obscurement',
  'objectInteraction',
  'proficiency',
  'permanentSpellEffect',
  'preventOpportunityAttacks',
  'reaction',
  'readyAction',
  'readySpell',
  'regeneration',
  'repeatSave',
  'resourceRegain',
  'rollBonusDice',
  'rollFloor',
  'rollModifier',
  'rollPenaltyDice',
  'resistance',
  'revive',
  'saveDcFormula',
  'savingThrowBonus',
  'savingThrowModifier',
  'sense',
  'slowAging',
  'speechRestricted',
  'speedBonus',
  'speedBonusSuppressed',
  'speedMultiplier',
  'speedSet',
  'stopsAging',
  'temporaryHitPoints',
  'transformed',
  'triggeredEffect',
  'unaware',
  'visibility',
  'weaponAttacksMagical',
  'weightMultiplier',
  // Magic-item passive modifier vocabulary (eshyra-o9bd.18.7.7.5, M2+M3):
  // ability-score floor semantics, proficiency-bonus grants, healing-rate
  // modifiers, and marker traits with no existing kind.
  'abilityScoreSet',
  'proficiencyBonusIncrease',
  'healingMultiplier',
  'hover',
  'leavesNoTracks',
  'sustenance',
  'swimWithoutExtraMovement',
  'telepathicRelay',
  'temperatureTolerance',
]);

const ACTION_ECONOMY_COSTS: ReadonlySet<string> = new Set([
  'action',
  'reaction',
]);

function dataObj(record: RulesRecord, path: string): Obj {
  const value = record.data;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RulesPackError(`${path}.data must be a non-null object`);
  }
  return value as Obj;
}

function reqStr(parent: Obj, key: string, path: string): string {
  const value = parent[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new RulesPackError(`${path}.${key} must be a non-empty string`);
  }
  return value;
}

function reqNum(parent: Obj, key: string, path: string): number {
  const value = parent[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RulesPackError(`${path}.${key} must be a finite number`);
  }
  return value;
}

function reqInt(parent: Obj, key: string, path: string, min?: number): number {
  const value = reqNum(parent, key, path);
  if (!Number.isInteger(value)) {
    throw new RulesPackError(`${path}.${key} must be an integer`);
  }
  if (min !== undefined && value < min) {
    throw new RulesPackError(`${path}.${key} must be >= ${min}`);
  }
  return value;
}

function reqStrArray(
  parent: Obj,
  key: string,
  path: string,
): readonly string[] {
  const value = parent[key];
  if (!Array.isArray(value)) {
    throw new RulesPackError(`${path}.${key} must be an array`);
  }
  value.forEach((item, i) => {
    if (typeof item !== 'string' || item.length === 0) {
      throw new RulesPackError(
        `${path}.${key}[${i}] must be a non-empty string`,
      );
    }
  });
  return value as readonly string[];
}

function reqObj(parent: Obj, key: string, path: string): Obj {
  const value = parent[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RulesPackError(`${path}.${key} must be a non-null object`);
  }
  return value as Obj;
}

function optStr(parent: Obj, key: string, path: string): void {
  const value = parent[key];
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new RulesPackError(
      `${path}.${key} must be a non-empty string when present`,
    );
  }
}

function optStrArray(parent: Obj, key: string, path: string): void {
  const value = parent[key];
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new RulesPackError(`${path}.${key} must be an array when present`);
  }
  value.forEach((item, i) => {
    if (typeof item !== 'string' || item.length === 0) {
      throw new RulesPackError(
        `${path}.${key}[${i}] must be a non-empty string`,
      );
    }
  });
}

/** SRD 5.1's six ability scores, lowercase, as `rule:skills`' map keys. */
const ABILITY_SCORE_KEYS: ReadonlySet<string> = new Set([
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
]);

/**
 * `rule:skills`' p78 skill-to-ability mapping (eshyra-erf5.1): an object keyed
 * by lowercase ability name, each value a (possibly empty, e.g. Constitution)
 * array of governing skill names.
 */
function optSkillsByAbility(parent: Obj, key: string, path: string): void {
  const value = parent[key];
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RulesPackError(
      `${path}.${key} must be a non-null object when present`,
    );
  }
  const map = value as Obj;
  for (const ability of Object.keys(map)) {
    if (!ABILITY_SCORE_KEYS.has(ability)) {
      throw new RulesPackError(
        `${path}.${key} has unsupported ability key "${ability}"`,
      );
    }
    const skills = map[ability];
    if (!Array.isArray(skills)) {
      throw new RulesPackError(`${path}.${key}.${ability} must be an array`);
    }
    skills.forEach((skill, i) => {
      if (typeof skill !== 'string' || skill.length === 0) {
        throw new RulesPackError(
          `${path}.${key}.${ability}[${i}] must be a non-empty string`,
        );
      }
    });
  }
  for (const ability of ABILITY_SCORE_KEYS) {
    if (!(ability in map)) {
      throw new RulesPackError(
        `${path}.${key} is missing ability "${ability}"`,
      );
    }
  }
}

function optNonEmptyStrArray(parent: Obj, key: string, path: string): void {
  const value = parent[key];
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new RulesPackError(
      `${path}.${key} must be a non-empty array when present`,
    );
  }
  value.forEach((item, i) => {
    if (typeof item !== 'string' || item.length === 0) {
      throw new RulesPackError(
        `${path}.${key}[${i}] must be a non-empty string`,
      );
    }
  });
}

// Validate an optional array of `{ name, text }` stat-block entries (creature
// traits / actions / reactions / legendary-action options). Each requires a
// non-empty name and text; absent is allowed.
function optNamedEntryArray(parent: Obj, key: string, path: string): void {
  const value = parent[key];
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new RulesPackError(`${path}.${key} must be an array when present`);
  }
  value.forEach((item, i) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new RulesPackError(`${path}.${key}[${i}] must be an object`);
    }
    const entry = item as Obj;
    reqStr(entry, 'name', `${path}.${key}[${i}]`);
    reqStr(entry, 'text', `${path}.${key}[${i}]`);
    optMechanics(entry, 'mechanics', `${path}.${key}[${i}]`);
  });
}

function optBool(parent: Obj, key: string, path: string): void {
  const value = parent[key];
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'boolean') {
    throw new RulesPackError(`${path}.${key} must be a boolean when present`);
  }
}

function optTrue(parent: Obj, key: string, path: string): void {
  const value = parent[key];
  if (value === undefined) {
    return;
  }
  if (value !== true) {
    throw new RulesPackError(`${path}.${key} must be true when present`);
  }
}

function optInt(parent: Obj, key: string, path: string, min?: number): void {
  const value = parent[key];
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new RulesPackError(`${path}.${key} must be an integer when present`);
  }
  if (min !== undefined && value < min) {
    throw new RulesPackError(`${path}.${key} must be >= ${min} when present`);
  }
}

function isScalar(value: unknown): value is Scalar {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function objArray(parent: Obj, key: string, path: string): Obj[] | undefined {
  const value = parent[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new RulesPackError(`${path}.${key} must be an array when present`);
  }
  return value.map((item, i) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new RulesPackError(`${path}.${key}[${i}] must be an object`);
    }
    return item as Obj;
  });
}

// An optional array of source-backed CHOICE entries (tool/skill proficiency
// choices on a class). Each entry keeps the verbatim source `text`; `choose`
// (count), `from` (a list or a free-text restriction), and `any` are optional
// structure parsed out of that text (eshyra-4a7.6).
function optChoiceArray(parent: Obj, key: string, path: string): void {
  const entries = objArray(parent, key, path);
  if (entries === undefined) return;
  entries.forEach((entry, i) => {
    reqStr(entry, 'text', `${path}.${key}[${i}]`);
    optInt(entry, 'choose', `${path}.${key}[${i}]`, 1);
    optBool(entry, 'any', `${path}.${key}[${i}]`);
    const from = entry.from;
    if (
      from !== undefined &&
      typeof from !== 'string' &&
      !Array.isArray(from)
    ) {
      throw new RulesPackError(
        `${path}.${key}[${i}].from must be a string or string array when present`,
      );
    }
    if (Array.isArray(from)) {
      optStrArray(entry, 'from', `${path}.${key}[${i}]`);
    }
  });
}

// Optional array of structured player-choice entries on a feature record
// (eshyra-o9bd.9). Each entry names a closed `category`, a player-facing
// `prompt`, and the `level` the choice is made. It is EITHER a structured
// choice (a `choose` count plus optional `from` option list/restriction) OR a
// named out-of-scope marker (`unsupported.reason`) — exactly one, never both,
// so an unmodeled choice is always explicit rather than silently missing. The
// category vocabulary and entry shape are shared with the `choice-coverage`
// audit gate via `./featureChoices`.
function optFeatureChoiceOptions(entry: Obj, key: string, path: string): void {
  const options = objArray(entry, key, path);
  if (options === undefined) return;
  if (options.length === 0) {
    throw new RulesPackError(`${path}.${key} must not be empty when present`);
  }
  options.forEach((option, i) => {
    const at = `${path}.${key}[${i}]`;
    reqStr(option, 'id', at);
    reqStr(option, 'name', at);
    reqStr(option, 'text', at);
    optStr(option, 'prerequisite', at);
    optPrerequisiteClauses(option, 'prerequisites', at);
    reqStr(option, 'source', at);
  });
}

// Structured prerequisite clauses on an option (eshyra-vk23.9): each is a typed
// `level` (class-scoped minimum level), `pactBoon` (required Pact Boon inline
// option, addressed by the owning `featureRef` record plus the option's inline
// `ref` id — eshyra-o9bd.18.4), or `cantrip` (required spell ref). The verbatim
// `prerequisite` prose is retained alongside; this is its machine-readable parse.
function optPrerequisiteClauses(parent: Obj, key: string, path: string): void {
  const clauses = objArray(parent, key, path);
  if (clauses === undefined) return;
  if (clauses.length === 0) {
    throw new RulesPackError(`${path}.${key} must not be empty when present`);
  }
  clauses.forEach((clause, i) => {
    const at = `${path}.${key}[${i}]`;
    const kind = reqStr(clause, 'kind', at);
    if (kind === 'level') {
      reqStr(clause, 'classRef', at);
      reqInt(clause, 'level', at, 1);
    } else if (kind === 'pactBoon') {
      const featureRef = reqStr(clause, 'featureRef', at);
      if (!featureRef.startsWith('feature:')) {
        throw new RulesPackError(
          `${at}.featureRef must be a 'feature:' record key, got ${JSON.stringify(featureRef)}`,
        );
      }
      const ref = reqStr(clause, 'ref', at);
      if (!ref.startsWith('pact-boon:')) {
        throw new RulesPackError(
          `${at}.ref must be a 'pact-boon:' ref, got ${JSON.stringify(ref)}`,
        );
      }
    } else if (kind === 'cantrip') {
      const ref = reqStr(clause, 'ref', at);
      if (!ref.startsWith('spell:')) {
        throw new RulesPackError(
          `${at}.ref must be a 'spell:' ref, got ${JSON.stringify(ref)}`,
        );
      }
    } else {
      throw new RulesPackError(
        `${at}.kind must be one of: level, pactBoon, cantrip`,
      );
    }
  });
}

function optFeatureChoiceArray(parent: Obj, key: string, path: string): void {
  const entries = objArray(parent, key, path);
  if (entries === undefined) return;
  entries.forEach((entry, i) => {
    const at = `${path}.${key}[${i}]`;
    reqStr(entry, 'id', at);
    const category = reqStr(entry, 'category', at);
    if (!isFeatureChoiceCategory(category)) {
      throw new RulesPackError(
        `${at}.category must be one of: ${FEATURE_CHOICE_CATEGORIES.join(', ')}`,
      );
    }
    reqStr(entry, 'prompt', at);
    reqInt(entry, 'level', at, 1);
    // A choice carries EXACTLY one selection mode: a fixed `choose` count, a
    // `chooseFormula` (prepared-caster daily count, eshyra-vk23.2), or an
    // `unsupported` out-of-scope marker — never two, never zero.
    const hasChoose = entry.choose !== undefined;
    const hasFormula = entry.chooseFormula !== undefined;
    const hasUnsupported = entry.unsupported !== undefined;
    const modes = [hasChoose, hasFormula, hasUnsupported].filter(
      Boolean,
    ).length;
    if (modes !== 1) {
      throw new RulesPackError(
        `${at} must carry exactly one of 'choose' (fixed count), 'chooseFormula' (prepared-caster count), or 'unsupported' (out-of-scope marker)`,
      );
    }
    if (hasChoose || hasFormula) {
      if (hasChoose) reqInt(entry, 'choose', at, 1);
      if (hasFormula) {
        validatePreparationFormula(
          reqObj(entry, 'chooseFormula', at),
          `${at}.chooseFormula`,
        );
      }
      // Optional advancement annotations: when the choice is made/repeated, and
      // whether it replaces a prior pick (known-caster level-up swap).
      optStr(entry, 'trigger', at);
      optBool(entry, 'replaces', at);
      const from = entry.from;
      if (
        from !== undefined &&
        typeof from !== 'string' &&
        !Array.isArray(from) &&
        (from === null || typeof from !== 'object')
      ) {
        throw new RulesPackError(
          `${at}.from must be a string, string array, or structured object when present`,
        );
      }
      if (Array.isArray(from)) optStrArray(entry, 'from', at);
      optFeatureChoiceOptions(entry, 'options', at);
    } else {
      const unsupported = reqObj(entry, 'unsupported', at);
      reqStr(unsupported, 'reason', `${at}.unsupported`);
    }
  });
}

// Optional starting-equipment block on a class: verbatim `text` plus optional
// per-line `entries` (the bulleted options).
const STARTING_EQUIPMENT_FILTER_SELECTS: ReadonlySet<string> = new Set([
  'weapon',
  'arcane-focus',
  'druidic-focus',
  'holy-symbol',
  'musical-instrument',
]);
const WEAPON_CATEGORIES: ReadonlySet<string> = new Set(['simple', 'martial']);
const WEAPON_RANGES: ReadonlySet<string> = new Set(['melee', 'ranged']);

/**
 * Validate the typed starting-equipment grants (eshyra-ngcj.3): each entry is a
 * fixed `item` grant (equipment ref + positive quantity, optional condition) or
 * an open `filter` grant (a closed `select` vocabulary + positive quantity,
 * with weapon category/range only on weapon filters). Required and non-empty.
 */
function reqStartingEquipmentGrants(parent: Obj, path: string): void {
  const grants = objArray(parent, 'grants', path);
  if (grants === undefined || grants.length === 0) {
    throw new RulesPackError(`${path}.grants must be a non-empty array`);
  }
  grants.forEach((grant, i) => {
    const gpath = `${path}.grants[${i}]`;
    const kind = grant.kind;
    if (kind === 'item') {
      reqStr(grant, 'ref', gpath);
      reqInt(grant, 'quantity', gpath, 1);
      optStr(grant, 'condition', gpath);
      return;
    }
    if (kind === 'filter') {
      const select = reqStr(grant, 'select', gpath);
      if (!STARTING_EQUIPMENT_FILTER_SELECTS.has(select)) {
        throw new RulesPackError(
          `${gpath}.select must be one of ${[...STARTING_EQUIPMENT_FILTER_SELECTS].join(', ')}`,
        );
      }
      reqInt(grant, 'quantity', gpath, 1);
      if (grant.weaponCategory !== undefined) {
        if (
          select !== 'weapon' ||
          !WEAPON_CATEGORIES.has(grant.weaponCategory as string)
        ) {
          throw new RulesPackError(
            `${gpath}.weaponCategory must be simple|martial on a weapon filter`,
          );
        }
      }
      if (grant.weaponRange !== undefined) {
        if (
          select !== 'weapon' ||
          !WEAPON_RANGES.has(grant.weaponRange as string)
        ) {
          throw new RulesPackError(
            `${gpath}.weaponRange must be melee|ranged on a weapon filter`,
          );
        }
      }
      return;
    }
    throw new RulesPackError(`${gpath}.kind must be "item" or "filter"`);
  });
}

function optStartingEquipment(parent: Obj, key: string, path: string): void {
  const value = parent[key];
  if (value === undefined) return;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RulesPackError(`${path}.${key} must be an object when present`);
  }
  const obj = value as Obj;
  reqStr(obj, 'text', `${path}.${key}`);
  const entries = obj.entries;
  if (entries === undefined) return;
  if (!Array.isArray(entries)) {
    throw new RulesPackError(`${path}.${key}.entries must be an array`);
  }
  entries.forEach((item, i) => {
    if (typeof item === 'string' && item.length > 0) return;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new RulesPackError(
        `${path}.${key}.entries[${i}] must be an object`,
      );
    }
    const entry = item as Obj;
    const kind = entry.kind;
    if (kind === 'choice') {
      reqStr(entry, 'sourceText', `${path}.${key}.entries[${i}]`);
      const options = objArray(
        entry,
        'options',
        `${path}.${key}.entries[${i}]`,
      );
      if (options === undefined || options.length === 0) {
        throw new RulesPackError(
          `${path}.${key}.entries[${i}].options must be a non-empty array`,
        );
      }
      options.forEach((option, optionIndex) => {
        const optionPath = `${path}.${key}.entries[${i}].options[${optionIndex}]`;
        reqStr(option, 'label', optionPath);
        reqStr(option, 'text', optionPath);
        reqStartingEquipmentGrants(option, optionPath);
      });
      return;
    }
    if (kind === 'fixed') {
      reqStr(entry, 'text', `${path}.${key}.entries[${i}]`);
      reqStr(entry, 'sourceText', `${path}.${key}.entries[${i}]`);
      reqStartingEquipmentGrants(entry, `${path}.${key}.entries[${i}]`);
      return;
    }
    throw new RulesPackError(
      `${path}.${key}.entries[${i}].kind must be "choice" or "fixed"`,
    );
  });
}

function optLanguageGrantArray(parent: Obj, key: string, path: string): void {
  const value = parent[key];
  if (value === undefined) return;
  if (typeof value === 'string' && value.length > 0) return;
  const entries = objArray(parent, key, path);
  if (entries === undefined) return;
  if (entries.length === 0) {
    throw new RulesPackError(`${path}.${key} must be non-empty when present`);
  }
  entries.forEach((entry, i) => {
    reqStrArray(entry, 'fixed', `${path}.${key}[${i}]`);
    optInt(entry, 'choose', `${path}.${key}[${i}]`, 1);
    // The enumerable option domain for `choose` (eshyra-8r8f) — e.g. the
    // Standard Languages table for a Half-Elf/Human/Acolyte "extra language".
    if (entry.from !== undefined) {
      optStrArray(entry, 'from', `${path}.${key}[${i}]`);
      if ((entry.from as unknown[]).length === 0) {
        throw new RulesPackError(
          `${path}.${key}[${i}].from must not be empty when present`,
        );
      }
    }
    reqStr(entry, 'sourceText', `${path}.${key}[${i}]`);
  });
}

function optAbilityScoreIncreaseArray(
  parent: Obj,
  key: string,
  path: string,
): void {
  const entries = objArray(parent, key, path);
  if (entries === undefined) return;
  if (entries.length === 0) {
    throw new RulesPackError(`${path}.${key} must be non-empty when present`);
  }
  entries.forEach((entry, i) => {
    const fixed = objArray(entry, 'fixed', `${path}.${key}[${i}]`);
    if (fixed === undefined || fixed.length === 0) {
      throw new RulesPackError(
        `${path}.${key}[${i}].fixed must be a non-empty array`,
      );
    }
    fixed.forEach((increase, increaseIndex) => {
      reqStr(
        increase,
        'ability',
        `${path}.${key}[${i}].fixed[${increaseIndex}]`,
      );
      reqInt(
        increase,
        'bonus',
        `${path}.${key}[${i}].fixed[${increaseIndex}]`,
        1,
      );
    });
    const choice = entry.choice;
    if (choice !== undefined) {
      if (
        typeof choice !== 'object' ||
        choice === null ||
        Array.isArray(choice)
      ) {
        throw new RulesPackError(
          `${path}.${key}[${i}].choice must be an object`,
        );
      }
      const choiceObj = choice as Obj;
      reqInt(choiceObj, 'choose', `${path}.${key}[${i}].choice`, 1);
      reqInt(choiceObj, 'bonus', `${path}.${key}[${i}].choice`, 1);
      reqStrArray(choiceObj, 'from', `${path}.${key}[${i}].choice`);
    }
    reqStr(entry, 'sourceText', `${path}.${key}[${i}]`);
  });
}

const SPELL_PREP_ABILITIES: ReadonlySet<string> = new Set([
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
]);

/**
 * Validate a machine-readable spell-preparation formula (eshyra-vk23.2): the
 * prepared-spell count is `max(minimum, abilityModifier + floor(classLevel /
 * classLevelDivisor))`. Cleric/Druid/Wizard use divisor 1 (full level), Paladin
 * uses divisor 2 (half level rounded down). Shared by class
 * `spellPreparation.preparationFormula` and a feature choice's `chooseFormula`.
 */
function validatePreparationFormula(obj: Obj, path: string): void {
  const ability = reqStr(obj, 'ability', path);
  if (!SPELL_PREP_ABILITIES.has(ability)) {
    throw new RulesPackError(
      `${path}.ability must be a lowercase ability score name`,
    );
  }
  reqInt(obj, 'classLevelDivisor', path, 1);
  reqInt(obj, 'minimum', path, 0);
}

function optPreparationFormula(parent: Obj, key: string, path: string): void {
  const value = parent[key];
  if (value === undefined) return;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RulesPackError(`${path}.${key} must be an object when present`);
  }
  validatePreparationFormula(value as Obj, `${path}.${key}`);
}

function optSpellPreparation(parent: Obj, key: string, path: string): void {
  const value = parent[key];
  if (value === undefined) return;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RulesPackError(`${path}.${key} must be an object when present`);
  }
  const obj = value as Obj;
  const kind = reqStr(obj, 'kind', `${path}.${key}`);
  if (kind !== 'known' && kind !== 'prepared') {
    throw new RulesPackError(
      `${path}.${key}.kind must be "known" or "prepared"`,
    );
  }
  optInt(obj, 'spellbookStartingSpells', `${path}.${key}`, 1);
  optPreparationFormula(obj, 'preparationFormula', `${path}.${key}`);
  reqStr(obj, 'sourceText', `${path}.${key}`);
}

// Optional proficiency-restriction notes ({ field, text }) — e.g. the Druid's
// "will not wear armor or use shields made of metal" lifted out of the
// normalized armorProficiencies token (eshyra-4a7.6).
function optProficiencyNotes(parent: Obj, key: string, path: string): void {
  const entries = objArray(parent, key, path);
  if (entries === undefined) return;
  entries.forEach((entry, i) => {
    reqStr(entry, 'field', `${path}.${key}[${i}]`);
    reqStr(entry, 'text', `${path}.${key}[${i}]`);
  });
}

// The 13 canonical SRD 5.1 damage types (PH ch. 9 "Damage Types"). Shared
// with the importer's own copy in mechanicsProjections.ts, which is what
// keeps `parseDamage` from capturing non-damage adjectives (eshyra-erf5.4).
const SRD_5_1_DAMAGE_TYPES: ReadonlySet<string> = new Set([
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
]);

function requireOnlyKeys(
  obj: Obj,
  allowed: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(obj)) {
    if (!allowedSet.has(key)) {
      throw new RulesPackError(
        `${path} has unsupported key ${JSON.stringify(key)}`,
      );
    }
  }
}

function optRulesAmbiguities(
  mechanics: Obj,
  path: string,
): ReadonlySet<string> {
  const entries = objArray(mechanics, 'ambiguities', path);
  if (entries === undefined) return new Set();
  if (entries.length === 0) {
    throw new RulesPackError(`${path}.ambiguities must not be empty`);
  }
  const ids = new Set<string>();
  entries.forEach((ambiguity, index) => {
    const ambiguityPath = `${path}.ambiguities[${index}]`;
    requireOnlyKeys(
      ambiguity,
      [
        'id',
        'question',
        'source',
        'affects',
        'interpretations',
        'canonicalResolution',
        'runtimeDisposition',
      ],
      ambiguityPath,
    );
    const id = reqStr(ambiguity, 'id', ambiguityPath);
    if (!/^ambiguity:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      throw new RulesPackError(
        `${ambiguityPath}.id must be a stable ambiguity:<kebab-case> ID`,
      );
    }
    if (ids.has(id)) {
      throw new RulesPackError(`${ambiguityPath}.id must be unique`);
    }
    ids.add(id);
    reqStr(ambiguity, 'question', ambiguityPath);
    const sources = objArray(ambiguity, 'source', ambiguityPath);
    if (sources === undefined || sources.length === 0) {
      throw new RulesPackError(`${ambiguityPath}.source must be non-empty`);
    }
    const sourceKeys = new Set<string>();
    sources.forEach((source, sourceIndex) => {
      const sourcePath = `${ambiguityPath}.source[${sourceIndex}]`;
      requireOnlyKeys(source, ['locator', 'clauseId'], sourcePath);
      const locator = reqStr(source, 'locator', sourcePath);
      const clauseId = reqStr(source, 'clauseId', sourcePath);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clauseId)) {
        throw new RulesPackError(
          `${sourcePath}.clauseId must be a stable kebab-case clause ID`,
        );
      }
      const sourceKey = `${locator}:${clauseId}`;
      if (sourceKeys.has(sourceKey)) {
        throw new RulesPackError(`${sourcePath} duplicates a source binding`);
      }
      sourceKeys.add(sourceKey);
    });
    const affects = reqStrArray(ambiguity, 'affects', ambiguityPath);
    if (affects.length === 0 || new Set(affects).size !== affects.length) {
      throw new RulesPackError(
        `${ambiguityPath}.affects must be non-empty and unique`,
      );
    }
    const interpretations = objArray(
      ambiguity,
      'interpretations',
      ambiguityPath,
    );
    if (interpretations === undefined || interpretations.length < 2) {
      throw new RulesPackError(
        `${ambiguityPath}.interpretations must contain at least two entries`,
      );
    }
    const interpretationIds = new Set<string>();
    interpretations.forEach((interpretation, interpretationIndex) => {
      const interpretationPath = `${ambiguityPath}.interpretations[${interpretationIndex}]`;
      requireOnlyKeys(interpretation, ['id', 'summary'], interpretationPath);
      const interpretationId = reqStr(interpretation, 'id', interpretationPath);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(interpretationId)) {
        throw new RulesPackError(
          `${interpretationPath}.id must be a stable kebab-case ID`,
        );
      }
      if (interpretationIds.has(interpretationId)) {
        throw new RulesPackError(`${interpretationPath}.id must be unique`);
      }
      interpretationIds.add(interpretationId);
      reqStr(interpretation, 'summary', interpretationPath);
    });
    if (ambiguity.canonicalResolution !== null) {
      throw new RulesPackError(
        `${ambiguityPath}.canonicalResolution must be null`,
      );
    }
    const disposition = reqObj(ambiguity, 'runtimeDisposition', ambiguityPath);
    requireOnlyKeys(
      disposition,
      ['status', 'owner'],
      `${ambiguityPath}.runtimeDisposition`,
    );
    if (
      disposition.status !== 'engine-pending' ||
      disposition.owner !== 'campaign-ruling'
    ) {
      throw new RulesPackError(
        `${ambiguityPath}.runtimeDisposition must declare engine-pending campaign-ruling ownership`,
      );
    }
  });
  return ids;
}

function validateAmbiguityReferences(
  effects: readonly Obj[] | undefined,
  ambiguityIds: ReadonlySet<string>,
  path: string,
): void {
  const referenced = new Set<string>();
  const visit = (value: unknown, valuePath: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        visit(entry, `${valuePath}[${index}]`);
      });
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const object = value as Obj;
    if (typeof object.ambiguityId === 'string') {
      if (!ambiguityIds.has(object.ambiguityId)) {
        throw new RulesPackError(
          `${valuePath}.ambiguityId references unknown mechanics ambiguity ${JSON.stringify(object.ambiguityId)}`,
        );
      }
      referenced.add(object.ambiguityId);
    }
    for (const [key, entry] of Object.entries(object)) {
      visit(entry, `${valuePath}.${key}`);
    }
  };
  effects?.forEach((effect, index) => {
    visit(effect, `${path}.effects[${index}]`);
  });
  for (const ambiguityId of ambiguityIds) {
    if (!referenced.has(ambiguityId)) {
      throw new RulesPackError(
        `${path}.ambiguities declares ${JSON.stringify(ambiguityId)} without an affected mechanic reference`,
      );
    }
  }
}

function optMechanics(parent: Obj, key: string, path: string): void {
  const value = parent[key];
  if (value === undefined) return;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RulesPackError(`${path}.${key} must be an object when present`);
  }
  const mechanics = value as Obj;
  const ambiguityIds = optRulesAmbiguities(mechanics, `${path}.${key}`);
  const actionEconomy = mechanics.actionEconomy;
  if (actionEconomy !== undefined) {
    if (
      typeof actionEconomy !== 'object' ||
      actionEconomy === null ||
      Array.isArray(actionEconomy)
    ) {
      throw new RulesPackError(
        `${path}.${key}.actionEconomy must be an object when present`,
      );
    }
    const economy = actionEconomy as Obj;
    const cost = reqStr(economy, 'cost', `${path}.${key}.actionEconomy`);
    if (!ACTION_ECONOMY_COSTS.has(cost)) {
      throw new RulesPackError(
        `${path}.${key}.actionEconomy.cost must be one of ${[...ACTION_ECONOMY_COSTS].join(', ')}, got ${JSON.stringify(cost)}`,
      );
    }
  }
  optBool(mechanics, 'concentration', `${path}.${key}`);
  optBool(mechanics, 'spellAttack', `${path}.${key}`);
  // `spellGrants` is a structured list of validated spell refs (eshyra-vk23.1),
  // not free prose: each entry is `{ spell: 'spell:<slug>' }`. The importer
  // emits an entry only when a captured spell name resolves to a real spell
  // record, so this field can never carry clipped natural-language fragments.
  const spellGrants = objArray(mechanics, 'spellGrants', `${path}.${key}`);
  if (spellGrants !== undefined) {
    if (spellGrants.length === 0) {
      throw new RulesPackError(
        `${path}.${key}.spellGrants must not be empty when present`,
      );
    }
    spellGrants.forEach((grant, i) => {
      const grantPath = `${path}.${key}.spellGrants[${i}]`;
      reqStr(grant, 'spell', grantPath);
      const ref = grant.spell;
      if (typeof ref === 'string' && !ref.startsWith('spell:')) {
        throw new RulesPackError(
          `${grantPath}.spell must be a 'spell:' ref, got ${JSON.stringify(ref)}`,
        );
      }
    });
  }
  // `conditions` entries carry a `relation` alongside the bare condition name
  // (eshyra-qqyj): a raw condition-name match conflates "this effect applies
  // the condition" with advantage/immunity clauses, targeting exclusions, and
  // incidental mentions. Only `applies`/`removes` are authoritative state
  // mutations; consumers must not treat any other relation as one.
  const conditions = objArray(mechanics, 'conditions', `${path}.${key}`);
  if (conditions !== undefined) {
    if (conditions.length === 0) {
      throw new RulesPackError(
        `${path}.${key}.conditions must not be empty when present`,
      );
    }
    conditions.forEach((entry, i) => {
      const entryPath = `${path}.${key}.conditions[${i}]`;
      reqStr(entry, 'condition', entryPath);
      const relation = reqStr(entry, 'relation', entryPath);
      if (!CONDITION_RELATIONS.has(relation)) {
        throw new RulesPackError(
          `${entryPath}.relation must be one of ${[...CONDITION_RELATIONS].join(', ')}, got ${JSON.stringify(relation)}`,
        );
      }
    });
  }
  for (const arrayKey of ['attacks', 'saves', 'resources']) {
    const entries = objArray(mechanics, arrayKey, `${path}.${key}`);
    if (entries === undefined) continue;
    if (entries.length === 0) {
      throw new RulesPackError(
        `${path}.${key}.${arrayKey} must not be empty when present`,
      );
    }
  }
  const effects = objArray(mechanics, 'effects', `${path}.${key}`);
  if (effects !== undefined) {
    if (effects.length === 0) {
      throw new RulesPackError(
        `${path}.${key}.effects must not be empty when present`,
      );
    }
    effects.forEach((effect, i) => {
      validateMechanicsEffect(effect, `${path}.${key}.effects[${i}]`);
    });
    effects.forEach((effect, i) => {
      if (
        effect.kind === 'summoning' &&
        summoningHasTransitionTrigger(effect, 'concentration-broken')
      ) {
        const duration = mechanics.duration;
        const isConcentration =
          typeof duration === 'object' &&
          duration !== null &&
          !Array.isArray(duration) &&
          (duration as Obj).concentration === true;
        if (!isConcentration) {
          throw new RulesPackError(
            `${path}.${key}.effects[${i}] concentration-broken lifecycle requires a concentration duration`,
          );
        }
      }
    });
  }
  validateAmbiguityReferences(effects, ambiguityIds, `${path}.${key}`);
  const levelApplication = mechanics.levelApplication;
  if (
    levelApplication !== undefined &&
    levelApplication !== 'current-and-lower'
  ) {
    throw new RulesPackError(
      `${path}.${key}.levelApplication must be "current-and-lower" when present`,
    );
  }
  const levels = objArray(mechanics, 'levels', `${path}.${key}`);
  if (levels !== undefined) {
    if (levels.length === 0) {
      throw new RulesPackError(
        `${path}.${key}.levels must not be empty when present`,
      );
    }
    levels.forEach((level, i) => {
      const levelPath = `${path}.${key}.levels[${i}]`;
      reqInt(level, 'level', levelPath, 1);
      const levelEffects = objArray(level, 'effects', levelPath);
      if (levelEffects === undefined || levelEffects.length === 0) {
        throw new RulesPackError(`${levelPath}.effects must be non-empty`);
      }
      levelEffects.forEach((effect, j) => {
        validateMechanicsEffect(effect, `${levelPath}.effects[${j}]`);
      });
    });
  } else if (levelApplication !== undefined) {
    throw new RulesPackError(
      `${path}.${key}.levelApplication requires ${path}.${key}.levels`,
    );
  }
  // `damage`/`hitDamage` entries are dealt damage, so `type` must be one of
  // the 13 canonical SRD damage types — not any "<dice> <word> damage" match,
  // which would also capture non-damage adjectives like Enlarge/Reduce's
  // "1d4 extra damage" weapon-size flavor text (eshyra-erf5.4). That case is
  // instead modeled as `weaponDamageModifiers` below.
  for (const damageKey of ['damage', 'hitDamage']) {
    const entries = objArray(mechanics, damageKey, `${path}.${key}`);
    if (entries === undefined) continue;
    if (entries.length === 0) {
      throw new RulesPackError(
        `${path}.${key}.${damageKey} must not be empty when present`,
      );
    }
    entries.forEach((entry, i) => {
      const entryPath = `${path}.${key}.${damageKey}[${i}]`;
      // A damage entry carries a dice expression, or — for the SRD's flat
      // no-dice prints ("Hit: 1 piercing damage.", the Bat's Bite;
      // eshyra-o9bd.18.7.3) — a fixed integer `amount`.
      if (entry.dice === undefined) {
        reqInt(entry, 'amount', entryPath, 0);
      } else {
        reqStr(entry, 'dice', entryPath);
      }
      const type = reqStr(entry, 'type', entryPath);
      if (!SRD_5_1_DAMAGE_TYPES.has(type)) {
        throw new RulesPackError(
          `${entryPath}.type must be a canonical SRD damage type, got ${JSON.stringify(type)}`,
        );
      }
    });
  }
  // A weapon-damage-die MODIFIER (Enlarge/Reduce), not damage dealt directly.
  const weaponDamageModifiers = objArray(
    mechanics,
    'weaponDamageModifiers',
    `${path}.${key}`,
  );
  if (weaponDamageModifiers !== undefined) {
    if (weaponDamageModifiers.length === 0) {
      throw new RulesPackError(
        `${path}.${key}.weaponDamageModifiers must not be empty when present`,
      );
    }
    weaponDamageModifiers.forEach((entry, i) => {
      const entryPath = `${path}.${key}.weaponDamageModifiers[${i}]`;
      reqStr(entry, 'dice', entryPath);
      const operation = reqStr(entry, 'operation', entryPath);
      if (operation !== 'increase' && operation !== 'decrease') {
        throw new RulesPackError(
          `${entryPath}.operation must be "increase" or "decrease", got ${JSON.stringify(operation)}`,
        );
      }
    });
  }
  const scaling = mechanics.scaling;
  if (scaling !== undefined) {
    if (
      typeof scaling !== 'object' ||
      scaling === null ||
      Array.isArray(scaling)
    ) {
      throw new RulesPackError(`${path}.${key}.scaling must be an object`);
    }
    const scalingObj = scaling as Obj;
    const scalingPath = `${path}.${key}.scaling`;
    optStr(scalingObj, 'sourceText', scalingPath);
    // Structured upcast scaling (eshyra-o9bd.18.7.4).
    const perSlot = scalingObj.perSlot;
    if (perSlot !== undefined) {
      if (
        typeof perSlot !== 'object' ||
        perSlot === null ||
        Array.isArray(perSlot)
      ) {
        throw new RulesPackError(`${scalingPath}.perSlot must be an object`);
      }
      const perSlotObj = perSlot as Obj;
      const perSlotPath = `${scalingPath}.perSlot`;
      reqInt(perSlotObj, 'baseSlotLevel', perSlotPath, 1);
      optStr(perSlotObj, 'stat', perSlotPath);
      const stat = perSlotObj.stat;
      if (stat !== undefined && stat !== 'damage' && stat !== 'healing') {
        throw new RulesPackError(
          `${perSlotPath}.stat must be "damage" or "healing", got ${JSON.stringify(stat)}`,
        );
      }
      optStr(perSlotObj, 'increase', perSlotPath);
      optInt(perSlotObj, 'additionalTargets', perSlotPath, 1);
      if (stat === undefined && perSlotObj.additionalTargets === undefined) {
        throw new RulesPackError(
          `${perSlotPath} must carry a stat increase or additionalTargets`,
        );
      }
    }
    const cantrip = scalingObj.cantripDamageByLevel;
    if (cantrip !== undefined) {
      if (
        typeof cantrip !== 'object' ||
        cantrip === null ||
        Array.isArray(cantrip)
      ) {
        throw new RulesPackError(
          `${scalingPath}.cantripDamageByLevel must be an object`,
        );
      }
      const cantripObj = cantrip as Obj;
      const cantripPath = `${scalingPath}.cantripDamageByLevel`;
      const keys = Object.keys(cantripObj).sort((a, b) =>
        Number(a) < Number(b) ? -1 : 1,
      );
      if (keys.join(',') !== '5,11,17') {
        throw new RulesPackError(
          `${cantripPath} must carry exactly the 5/11/17 tier keys, got ${JSON.stringify(keys)}`,
        );
      }
      for (const tier of keys) {
        const dice = cantripObj[tier];
        if (typeof dice !== 'string' || !/^\d+d\d+$/.test(dice)) {
          throw new RulesPackError(
            `${cantripPath}[${tier}] must be a dice expression`,
          );
        }
      }
    }
  }
  // Structured casting metadata (eshyra-o9bd.18.7.4): the closed duration
  // vocabulary and the Self-range area parenthetical.
  const duration = mechanics.duration;
  if (duration !== undefined) {
    if (
      typeof duration !== 'object' ||
      duration === null ||
      Array.isArray(duration)
    ) {
      throw new RulesPackError(`${path}.${key}.duration must be an object`);
    }
    const durationObj = duration as Obj;
    const durationPath = `${path}.${key}.duration`;
    const durationKind = reqStr(durationObj, 'kind', durationPath);
    if (!SPELL_DURATION_KINDS.has(durationKind)) {
      throw new RulesPackError(
        `${durationPath}.kind must be one of ${[...SPELL_DURATION_KINDS].join(', ')}, got ${JSON.stringify(durationKind)}`,
      );
    }
    if (durationKind === 'timed') {
      reqInt(durationObj, 'amount', durationPath, 1);
      const unit = reqStr(durationObj, 'unit', durationPath);
      if (!SPELL_DURATION_UNITS.has(unit)) {
        throw new RulesPackError(
          `${durationPath}.unit must be one of ${[...SPELL_DURATION_UNITS].join(', ')}, got ${JSON.stringify(unit)}`,
        );
      }
      optBool(durationObj, 'upTo', durationPath);
      optBool(durationObj, 'concentration', durationPath);
    } else {
      for (const forbidden of ['amount', 'unit', 'upTo', 'concentration']) {
        if (durationObj[forbidden] !== undefined) {
          throw new RulesPackError(
            `${durationPath}.${forbidden} is only valid on timed durations`,
          );
        }
      }
      if (durationKind === 'until-dispelled') {
        optBool(durationObj, 'orTriggered', durationPath);
      } else if (durationObj.orTriggered !== undefined) {
        throw new RulesPackError(
          `${durationPath}.orTriggered is only valid on until-dispelled durations`,
        );
      }
    }
  }
  const area = mechanics.area;
  if (area !== undefined) {
    if (typeof area !== 'object' || area === null || Array.isArray(area)) {
      throw new RulesPackError(`${path}.${key}.area must be an object`);
    }
    const areaObj = area as Obj;
    const areaPath = `${path}.${key}.area`;
    const shape = reqStr(areaObj, 'shape', areaPath);
    if (!SPELL_AREA_SHAPES.has(shape)) {
      throw new RulesPackError(
        `${areaPath}.shape must be one of ${[...SPELL_AREA_SHAPES].join(', ')}, got ${JSON.stringify(shape)}`,
      );
    }
    reqInt(areaObj, 'size', areaPath, 1);
    const unit = reqStr(areaObj, 'unit', areaPath);
    if (unit !== 'foot' && unit !== 'mile') {
      throw new RulesPackError(
        `${areaPath}.unit must be "foot" or "mile", got ${JSON.stringify(unit)}`,
      );
    }
    const origin = reqStr(areaObj, 'origin', areaPath);
    if (origin !== 'self') {
      throw new RulesPackError(
        `${areaPath}.origin must be "self", got ${JSON.stringify(origin)}`,
      );
    }
  }
  const recharge = mechanics.recharge;
  if (recharge !== undefined) {
    if (
      typeof recharge !== 'object' ||
      recharge === null ||
      Array.isArray(recharge)
    ) {
      throw new RulesPackError(`${path}.${key}.recharge must be an object`);
    }
    const obj = recharge as Obj;
    reqStr(obj, 'roll', `${path}.${key}.recharge`);
    reqInt(obj, 'minimum', `${path}.${key}.recharge`, 1);
    reqInt(obj, 'maximum', `${path}.${key}.recharge`, 1);
  }
  // Use-economy qualifiers from the entry-name parenthetical
  // (eshyra-o9bd.18.7.3): "(3/Day)" → perDay, "(Recharges after a Short or
  // Long Rest)" → rechargeAfterRest, "(Costs 2 Actions)" → legendaryActionCost.
  const usage = mechanics.usage;
  if (usage !== undefined) {
    if (typeof usage !== 'object' || usage === null || Array.isArray(usage)) {
      throw new RulesPackError(`${path}.${key}.usage must be an object`);
    }
    const obj = usage as Obj;
    const usagePath = `${path}.${key}.usage`;
    if (
      obj.perDay === undefined &&
      obj.rechargeAfterRest === undefined &&
      obj.legendaryActionCost === undefined
    ) {
      throw new RulesPackError(`${usagePath} must not be empty when present`);
    }
    optInt(obj, 'perDay', usagePath, 1);
    optInt(obj, 'legendaryActionCost', usagePath, 1);
    optStr(obj, 'rechargeAfterRest', usagePath);
    const rechargeAfterRest = obj.rechargeAfterRest;
    if (
      rechargeAfterRest !== undefined &&
      !USAGE_RECHARGE_RESTS.has(rechargeAfterRest as string)
    ) {
      throw new RulesPackError(
        `${usagePath}.rechargeAfterRest must be one of ${[...USAGE_RECHARGE_RESTS].join(', ')}, got ${JSON.stringify(rechargeAfterRest)}`,
      );
    }
  }
  // Structured creature Spellcasting / Innate Spellcasting projection
  // (eshyra-o9bd.18.7.3). Fail-closed at import: every group spell must be a
  // resolved `spell:` ref, so the schema requires that shape outright.
  const spellcasting = mechanics.spellcasting;
  if (spellcasting !== undefined) {
    if (
      typeof spellcasting !== 'object' ||
      spellcasting === null ||
      Array.isArray(spellcasting)
    ) {
      throw new RulesPackError(`${path}.${key}.spellcasting must be an object`);
    }
    const obj = spellcasting as Obj;
    const castPath = `${path}.${key}.spellcasting`;
    const mode = reqStr(obj, 'mode', castPath);
    if (mode !== 'innate' && mode !== 'prepared') {
      throw new RulesPackError(
        `${castPath}.mode must be "innate" or "prepared", got ${JSON.stringify(mode)}`,
      );
    }
    reqStr(obj, 'ability', castPath);
    optInt(obj, 'saveDC', castPath, 1);
    optInt(obj, 'attackBonus', castPath);
    optInt(obj, 'casterLevel', castPath, 1);
    optStr(obj, 'listClass', castPath);
    optStr(obj, 'footnote', castPath);
    optStr(obj, 'componentRequirement', castPath);
    const componentRequirement = obj.componentRequirement;
    if (
      componentRequirement !== undefined &&
      !SPELLCASTING_COMPONENT_REQUIREMENTS.has(componentRequirement as string)
    ) {
      throw new RulesPackError(
        `${castPath}.componentRequirement must be one of ${[...SPELLCASTING_COMPONENT_REQUIREMENTS].join(', ')}, got ${JSON.stringify(componentRequirement)}`,
      );
    }
    const groups = objArray(obj, 'groups', castPath);
    if (groups === undefined || groups.length === 0) {
      throw new RulesPackError(`${castPath}.groups must be non-empty`);
    }
    groups.forEach((group, i) => {
      const groupPath = `${castPath}.groups[${i}]`;
      const frequency = reqStr(group, 'frequency', groupPath);
      if (!SPELLCASTING_GROUP_FREQUENCIES.has(frequency)) {
        throw new RulesPackError(
          `${groupPath}.frequency must be one of ${[...SPELLCASTING_GROUP_FREQUENCIES].join(', ')}, got ${JSON.stringify(frequency)}`,
        );
      }
      // Frequency-specific structure is enforced, not merely permitted:
      // `per-day` REQUIRES its use count, `slot-level` REQUIRES the spell
      // level and slot count, and every field is forbidden on frequencies
      // it does not describe — a structurally invalid group must be
      // rejected, not silently carried (eshyra-o9bd.18.7.3 review).
      if (frequency === 'per-day') {
        reqInt(group, 'uses', groupPath, 1);
        optBool(group, 'each', groupPath);
      } else {
        for (const key of ['uses', 'each']) {
          if (group[key] !== undefined) {
            throw new RulesPackError(
              `${groupPath}.${key} is only valid on per-day groups`,
            );
          }
        }
      }
      if (frequency === 'slot-level') {
        reqInt(group, 'level', groupPath, 1);
        reqInt(group, 'slots', groupPath, 1);
      } else {
        for (const key of ['level', 'slots']) {
          if (group[key] !== undefined) {
            throw new RulesPackError(
              `${groupPath}.${key} is only valid on slot-level groups`,
            );
          }
        }
      }
      const spells = objArray(group, 'spells', groupPath);
      if (spells === undefined || spells.length === 0) {
        throw new RulesPackError(`${groupPath}.spells must be non-empty`);
      }
      spells.forEach((spell, j) => {
        const spellPath = `${groupPath}.spells[${j}]`;
        const ref = reqStr(spell, 'ref', spellPath);
        if (!ref.startsWith('spell:')) {
          throw new RulesPackError(
            `${spellPath}.ref must be a 'spell:' ref, got ${JSON.stringify(ref)}`,
          );
        }
        optStr(spell, 'note', spellPath);
        optBool(spell, 'footnoteMarked', spellPath);
      });
    });
  }
}

const SPELL_DURATION_KINDS: ReadonlySet<string> = new Set([
  'instantaneous',
  'timed',
  'until-dispelled',
  'special',
]);

const SPELL_DURATION_UNITS: ReadonlySet<string> = new Set([
  'round',
  'minute',
  'hour',
  'day',
]);

const SPELL_AREA_SHAPES: ReadonlySet<string> = new Set([
  'cone',
  'line',
  'cube',
  'sphere',
  'hemisphere',
  'radius',
]);

const USAGE_RECHARGE_RESTS: ReadonlySet<string> = new Set([
  'short-rest',
  'long-rest',
  'short-or-long-rest',
]);

const SPELLCASTING_COMPONENT_REQUIREMENTS: ReadonlySet<string> = new Set([
  'no-material',
  'verbal-only',
  'none',
]);

const SPELLCASTING_GROUP_FREQUENCIES: ReadonlySet<string> = new Set([
  'cantrip',
  'at-will',
  'per-day',
  'slot-level',
]);

const ABILITY_NAMES: ReadonlySet<string> = new Set([
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
]);

function reqAbility(parent: Obj, key: string, path: string): void {
  const value = reqStr(parent, key, path);
  if (!ABILITY_NAMES.has(value)) {
    throw new RulesPackError(
      `${path}.${key} must be an ability name, got ${JSON.stringify(value)}`,
    );
  }
}

function reqDice(parent: Obj, key: string, path: string): void {
  const value = reqStr(parent, key, path);
  if (!/^\d*d\d+(?:\s*[+-]\s*\d+)?$/.test(value)) {
    throw new RulesPackError(
      `${path}.${key} must be a dice expression, got ${JSON.stringify(value)}`,
    );
  }
}

function optAbility(parent: Obj, key: string, path: string): void {
  if (parent[key] !== undefined) {
    reqAbility(parent, key, path);
  }
}

function optEnum(
  parent: Obj,
  key: string,
  path: string,
  allowed: ReadonlySet<string>,
): void {
  const value = parent[key];
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new RulesPackError(
      `${path}.${key} must be one of ${[...allowed].join(', ')}, got ${JSON.stringify(value)}`,
    );
  }
}

function reqEnum(
  parent: Obj,
  key: string,
  path: string,
  allowed: ReadonlySet<string>,
): string {
  const value = reqStr(parent, key, path);
  optEnum(parent, key, path, allowed);
  return value;
}

/**
 * A marker-only effect's contract is exactly `{ kind }` — any payload field
 * on it is either a projection bug or an undocumented contract change, and
 * must fail validation rather than ride the whitelist (eshyra-o9bd.18.7.5
 * re-review).
 */
function markerOnly(effect: Obj, path: string): void {
  for (const key of Object.keys(effect)) {
    if (key !== 'kind') {
      throw new RulesPackError(
        `${path} is a marker-only effect; unexpected payload key ${JSON.stringify(key)}`,
      );
    }
  }
}

/**
 * Like `markerOnly`, but also allows an optional free-text `condition` —
 * for marker kinds that are sometimes qualified by a source-printed
 * exception or prerequisite (eshyra-o9bd.18.7.7.5 review: e.g. slippers of
 * spider climbing's `climbAnywhere` excludes slippery surfaces). Still
 * fail-closed against any other unexpected key.
 */
function markerWithOptionalCondition(effect: Obj, path: string): void {
  for (const key of Object.keys(effect)) {
    if (key !== 'kind' && key !== 'condition') {
      throw new RulesPackError(
        `${path} is a marker effect with an optional condition; unexpected payload key ${JSON.stringify(key)}`,
      );
    }
  }
  optStr(effect, 'condition', path);
}

/**
 * Shared equipment-state eligibility rider (Martial Arts, Dragon Wings):
 * `wielding` is a closed wielding constraint, `armor` is `false` (none
 * allowed) or `"accommodating-armor-only"`, `shield` is a boolean.
 */
function optEligibility(effect: Obj, path: string): void {
  const value = effect.eligibility;
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RulesPackError(
      `${path}.eligibility must be a non-null object when present`,
    );
  }
  const eligibility = value as Obj;
  const keys = Object.keys(eligibility);
  if (keys.length === 0) {
    throw new RulesPackError(`${path}.eligibility must not be empty`);
  }
  for (const key of keys) {
    if (key !== 'wielding' && key !== 'armor' && key !== 'shield') {
      throw new RulesPackError(
        `${path}.eligibility has unsupported key ${JSON.stringify(key)}`,
      );
    }
  }
  optStr(eligibility, 'wielding', `${path}.eligibility`);
  const armor = eligibility.armor;
  if (
    armor !== undefined &&
    armor !== false &&
    armor !== 'accommodating-armor-only'
  ) {
    throw new RulesPackError(
      `${path}.eligibility.armor must be false or "accommodating-armor-only", got ${JSON.stringify(armor)}`,
    );
  }
  optBool(eligibility, 'shield', `${path}.eligibility`);
}

/** Action-economy cost object rider ({ cost: 'bonus-action' | … }). */
function optActionCost(effect: Obj, key: string, path: string): void {
  const value = effect[key];
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RulesPackError(
      `${path}.${key} must be a non-null object when present`,
    );
  }
  reqEnum(
    value as Obj,
    'cost',
    `${path}.${key}`,
    new Set(['action', 'bonus-action', 'reaction']),
  );
}

/**
 * Per-kind payload contracts for the structured effect kinds introduced by
 * the eshyra-o9bd.18.7.x projection passes. A recognized `kind` string with
 * a malformed payload must fail pack validation, not slide through on the
 * kind whitelist alone (eshyra-o9bd.18.7.5 review). Kinds without an entry
 * here are validated by the whitelist only (their payloads are either
 * free-form standard-action shapes or under review in later 18.7 children).
 */
const MECHANICS_EFFECT_PAYLOAD_VALIDATORS: Readonly<
  Record<string, (effect: Obj, path: string) => void>
> = {
  abilitySubstitution: (effect, path) => {
    // Shillelagh substitutes the caster's spellcasting ability rather than a
    // named ability score.
    if (effect.use !== 'spellcasting-ability') {
      reqAbility(effect, 'use', path);
    }
    reqAbility(effect, 'insteadOf', path);
    optStrArray(effect, 'for', path);
    optStr(effect, 'appliesTo', path);
    optEligibility(effect, path);
  },
  attackOrDamageBonus: (effect, path) => {
    reqAbility(effect, 'addAbilityModifier', path);
  },
  attackableAppendage: (effect, path) => {
    reqStr(effect, 'appendage', path);
    reqInt(effect, 'ac', path, 1);
    reqInt(effect, 'hitPoints', path, 1);
    reqStr(effect, 'immunities', path);
    optInt(effect, 'maximumCount', path, 1);
    optInt(effect, 'breakDc', path, 1);
    optAbility(effect, 'breakAbility', path);
    optBool(effect, 'regrowsNextTurn', path);
  },
  carryingCapacitySize: (effect, path) => {
    reqEnum(
      effect,
      'size',
      path,
      new Set(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']),
    );
  },
  breathes: (effect, path) => {
    // Necklace of Adaptation grants breathing in literally any environment
    // (not merely air/water) — `anyEnvironment: true` represents that
    // faithfully instead of forcing a lossy `environments` list
    // (eshyra-o9bd.18.7.7.5 review). Mutually exclusive with `environments`.
    if (effect.anyEnvironment !== undefined) {
      if (effect.anyEnvironment !== true) {
        throw new RulesPackError(`${path}.anyEnvironment must be true`);
      }
      if (effect.environments !== undefined) {
        throw new RulesPackError(
          `${path} must not carry both anyEnvironment and environments`,
        );
      }
      optBool(effect, 'only', path);
      optStr(effect, 'condition', path);
      return;
    }
    const environments = effect.environments;
    if (
      !Array.isArray(environments) ||
      environments.length === 0 ||
      !environments.every(
        (environment) => environment === 'air' || environment === 'water',
      )
    ) {
      throw new RulesPackError(
        `${path}.environments must be a non-empty array of "air"/"water", or anyEnvironment: true`,
      );
    }
    optBool(effect, 'only', path);
    // The condition under which the grant applies (eshyra-o9bd.18.7.7.5
    // review): e.g. the cloak of the manta ray only breathes underwater
    // while its hood is raised.
    optStr(effect, 'condition', path);
  },
  obscurement: (effect, path) => {
    if (effect.level !== undefined) {
      reqEnum(effect, 'level', path, new Set(['heavily', 'lightly']));
    } else {
      reqStr(effect, 'degree', path);
    }
    optStr(effect, 'source', path);
    optStr(effect, 'context', path);
    optStr(effect, 'subject', path);
    optInt(effect, 'radiusFeet', path, 1);
    optBool(effect, 'blocksDarkvision', path);
  },
  damageResistance: (effect, path) => {
    const variants = [
      effect.types,
      effect.typeFrom,
      effect.chooseOne,
      effect.damage,
    ].filter((variant) => variant !== undefined);
    if (variants.length !== 1) {
      throw new RulesPackError(
        `${path} must carry exactly one of types, typeFrom, chooseOne, or damage`,
      );
    }
    const validTypesArray = (value: unknown): boolean =>
      Array.isArray(value) &&
      value.length > 0 &&
      value.every(
        (type) => typeof type === 'string' && SRD_5_1_DAMAGE_TYPES.has(type),
      );
    if (
      effect.types !== undefined &&
      effect.types !== 'all' &&
      !validTypesArray(effect.types)
    ) {
      throw new RulesPackError(
        `${path}.types must be "all" or a non-empty array of canonical damage types`,
      );
    }
    if (effect.typeFrom !== undefined) {
      reqStr(effect, 'typeFrom', path);
    }
    if (effect.chooseOne !== undefined && !validTypesArray(effect.chooseOne)) {
      throw new RulesPackError(
        `${path}.chooseOne must be a non-empty array of canonical damage types`,
      );
    }
    if (effect.damage !== undefined && effect.damage !== 'all') {
      throw new RulesPackError(`${path}.damage must be "all" when present`);
    }
    optBool(effect, 'nonmagicalOnly', path);
    optStr(effect, 'target', path);
    optStr(effect, 'subject', path);
  },
  banishment: (effect, path) => {
    reqStr(effect, 'destination', path);
    reqInt(effect, 'escapeDc', path, 1);
    reqAbility(effect, 'escapeAbility', path);
    reqEnum(
      effect,
      'escapeCost',
      path,
      new Set(['action', 'bonus-action', 'reaction']),
    );
  },
  berserk: (effect, path) => {
    requireOnlyKeys(
      effect,
      ['kind', 'initialState', 'transitions', 'reentryEligibility'],
      path,
    );
    reqEnum(effect, 'initialState', path, new Set(['calm']));
    const transitions = objArray(effect, 'transitions', path);
    if (transitions === undefined || transitions.length < 4) {
      throw new RulesPackError(
        `${path}.transitions must contain the Berserk state machine`,
      );
    }
    const ids = transitions.map((transition, index) =>
      reqStr(transition, 'id', `${path}.transitions[${index}]`),
    );
    const expectedBaseIds = [
      'low-hit-points-entry',
      'berserk-turn-behavior',
      'destroyed-exit',
      'fully-healed-exit',
    ];
    const hasCalming = ids.includes('creator-calming-exit');
    const expectedIds = hasCalming
      ? [...expectedBaseIds, 'creator-calming-exit']
      : expectedBaseIds;
    if (
      ids.length !== expectedIds.length ||
      ids.some((id, index) => id !== expectedIds[index])
    ) {
      throw new RulesPackError(
        `${path}.transitions must be the complete ordered Berserk state machine`,
      );
    }

    const entry = transitions[0];
    const entryPath = `${path}.transitions[0]`;
    requireOnlyKeys(
      entry,
      ['id', 'from', 'to', 'trigger', 'hitPointsAtMost', 'roll'],
      entryPath,
    );
    reqEnum(entry, 'from', entryPath, new Set(['calm']));
    reqEnum(entry, 'to', entryPath, new Set(['berserk']));
    reqEnum(
      entry,
      'trigger',
      entryPath,
      new Set(['start-of-turn-at-or-below-hit-points']),
    );
    const threshold = reqInt(entry, 'hitPointsAtMost', entryPath, 1);
    const roll = reqObj(entry, 'roll', entryPath);
    requireOnlyKeys(roll, ['die', 'entersOn'], `${entryPath}.roll`);
    reqEnum(roll, 'die', `${entryPath}.roll`, new Set(['d6']));
    if (reqInt(roll, 'entersOn', `${entryPath}.roll`, 1) !== 6) {
      throw new RulesPackError(`${entryPath}.roll.entersOn must be 6`);
    }

    const continuation = transitions[1];
    const continuationPath = `${path}.transitions[1]`;
    requireOnlyKeys(
      continuation,
      ['id', 'from', 'to', 'trigger', 'behavior'],
      continuationPath,
    );
    reqEnum(continuation, 'from', continuationPath, new Set(['berserk']));
    reqEnum(continuation, 'to', continuationPath, new Set(['berserk']));
    reqEnum(continuation, 'trigger', continuationPath, new Set(['each-turn']));
    const behavior = reqObj(continuation, 'behavior', continuationPath);
    requireOnlyKeys(
      behavior,
      ['action', 'target', 'fallback'],
      `${continuationPath}.behavior`,
    );
    reqEnum(
      behavior,
      'action',
      `${continuationPath}.behavior`,
      new Set(['attack']),
    );
    reqEnum(
      behavior,
      'target',
      `${continuationPath}.behavior`,
      new Set(['nearest-visible-creature']),
    );
    const fallback = reqObj(
      behavior,
      'fallback',
      `${continuationPath}.behavior`,
    );
    requireOnlyKeys(
      fallback,
      ['when', 'target', 'preference'],
      `${continuationPath}.behavior.fallback`,
    );
    reqEnum(
      fallback,
      'when',
      `${continuationPath}.behavior.fallback`,
      new Set(['no-creature-near-enough-to-move-to-and-attack']),
    );
    reqEnum(
      fallback,
      'target',
      `${continuationPath}.behavior.fallback`,
      new Set(['object']),
    );
    reqEnum(
      fallback,
      'preference',
      `${continuationPath}.behavior.fallback`,
      new Set(['smaller-than-self']),
    );

    const validateExit = (
      transition: Obj,
      index: number,
      id: string,
      to: string,
      trigger: string,
    ): void => {
      const transitionPath = `${path}.transitions[${index}]`;
      requireOnlyKeys(
        transition,
        ['id', 'from', 'to', 'trigger'],
        transitionPath,
      );
      if (reqStr(transition, 'id', transitionPath) !== id) {
        throw new RulesPackError(`${transitionPath}.id must be ${id}`);
      }
      reqEnum(transition, 'from', transitionPath, new Set(['berserk']));
      reqEnum(transition, 'to', transitionPath, new Set([to]));
      reqEnum(transition, 'trigger', transitionPath, new Set([trigger]));
    };
    validateExit(transitions[2], 2, 'destroyed-exit', 'destroyed', 'destroyed');
    validateExit(
      transitions[3],
      3,
      'fully-healed-exit',
      'calm',
      'all-hit-points-regained',
    );

    if (!hasCalming) {
      if (effect.reentryEligibility !== undefined) {
        throw new RulesPackError(
          `${path}.reentryEligibility requires creator-calming-exit`,
        );
      }
      return;
    }
    const calming = transitions[4];
    const calmingPath = `${path}.transitions[4]`;
    requireOnlyKeys(
      calming,
      [
        'id',
        'from',
        'to',
        'trigger',
        'actor',
        'rangeFeet',
        'requiresHearing',
        'cost',
        'check',
        'outcome',
      ],
      calmingPath,
    );
    reqEnum(calming, 'from', calmingPath, new Set(['berserk']));
    reqEnum(calming, 'to', calmingPath, new Set(['calm']));
    reqEnum(
      calming,
      'trigger',
      calmingPath,
      new Set(['creator-calming-check']),
    );
    reqEnum(calming, 'actor', calmingPath, new Set(['creator']));
    if (reqInt(calming, 'rangeFeet', calmingPath, 1) !== 60) {
      throw new RulesPackError(`${calmingPath}.rangeFeet must be 60`);
    }
    if (calming.requiresHearing !== true) {
      throw new RulesPackError(`${calmingPath}.requiresHearing must be true`);
    }
    reqEnum(calming, 'cost', calmingPath, new Set(['action']));
    const check = reqObj(calming, 'check', calmingPath);
    requireOnlyKeys(check, ['dc', 'ability', 'skill'], `${calmingPath}.check`);
    if (reqInt(check, 'dc', `${calmingPath}.check`, 1) !== 15) {
      throw new RulesPackError(`${calmingPath}.check.dc must be 15`);
    }
    reqEnum(check, 'ability', `${calmingPath}.check`, new Set(['charisma']));
    reqEnum(check, 'skill', `${calmingPath}.check`, new Set(['persuasion']));
    reqEnum(calming, 'outcome', calmingPath, new Set(['on-success']));

    const reentry = reqObj(effect, 'reentryEligibility', path);
    const reentryPath = `${path}.reentryEligibility`;
    requireOnlyKeys(
      reentry,
      ['after', 'trigger', 'hitPointsAtMost', 'disposition', 'sourceOutcome'],
      reentryPath,
    );
    reqEnum(reentry, 'after', reentryPath, new Set(['creator-calming-exit']));
    reqEnum(
      reentry,
      'trigger',
      reentryPath,
      new Set(['damage-while-at-or-below-hit-points']),
    );
    if (reqInt(reentry, 'hitPointsAtMost', reentryPath, 1) !== threshold) {
      throw new RulesPackError(
        `${reentryPath}.hitPointsAtMost must equal the entry threshold`,
      );
    }
    reqEnum(
      reentry,
      'disposition',
      reentryPath,
      new Set(['model-adjudicated']),
    );
    reqEnum(
      reentry,
      'sourceOutcome',
      reentryPath,
      new Set(['might-go-berserk-again']),
    );
  },
  changeShape: (effect, path) => {
    requireOnlyKeys(
      effect,
      [
        'kind',
        'cost',
        'conditions',
        'forms',
        'statistics',
        'equipment',
        'reversion',
        'excludedCapabilities',
        'retainedCapabilities',
        'speedConditions',
        'riders',
      ],
      path,
    );
    reqEnum(effect, 'cost', path, new Set(['action']));
    optNonEmptyStrArray(effect, 'conditions', path);

    const forms = objArray(effect, 'forms', path);
    if (forms === undefined || forms.length === 0) {
      throw new RulesPackError(`${path}.forms must be a non-empty array`);
    }
    forms.forEach((form, index) => {
      const formPath = `${path}.forms[${index}]`;
      const kind = reqStr(form, 'kind', formPath);
      switch (kind) {
        case 'category': {
          requireOnlyKeys(form, ['kind', 'types', 'maxChallenge'], formPath);
          const types = reqStrArray(form, 'types', formPath);
          if (
            types.length === 0 ||
            types.some((type) => !['humanoid', 'beast'].includes(type))
          ) {
            throw new RulesPackError(
              `${formPath}.types must be a non-empty array of humanoid or beast`,
            );
          }
          reqEnum(form, 'maxChallenge', formPath, new Set(['own']));
          break;
        }
        case 'descriptor': {
          requireOnlyKeys(
            form,
            ['kind', 'sizes', 'type', 'qualifiers'],
            formPath,
          );
          const sizes = reqStrArray(form, 'sizes', formPath);
          if (
            sizes.length === 0 ||
            sizes.some((size) => !['small', 'medium', 'large'].includes(size))
          ) {
            throw new RulesPackError(
              `${formPath}.sizes must be a non-empty array of small, medium, or large`,
            );
          }
          reqStr(form, 'type', formPath);
          optNonEmptyStrArray(form, 'qualifiers', formPath);
          break;
        }
        case 'fixed': {
          requireOnlyKeys(form, ['kind', 'name', 'speedOverrides'], formPath);
          reqStr(form, 'name', formPath);
          if (form.speedOverrides !== undefined) {
            const speeds = reqObj(form, 'speedOverrides', formPath);
            const modes = new Set(['walk', 'fly', 'climb', 'swim', 'burrow']);
            for (const [mode, speed] of Object.entries(speeds)) {
              if (!modes.has(mode)) {
                throw new RulesPackError(
                  `${formPath}.speedOverrides has unsupported mode ${JSON.stringify(mode)}`,
                );
              }
              if (
                typeof speed !== 'number' ||
                !Number.isInteger(speed) ||
                speed < 1
              ) {
                throw new RulesPackError(
                  `${formPath}.speedOverrides.${mode} must be a positive integer`,
                );
              }
            }
          }
          break;
        }
        case 'object':
          requireOnlyKeys(form, ['kind'], formPath);
          break;
        case 'statline-variant': {
          requireOnlyKeys(
            form,
            ['kind', 'variant', 'size', 'statlineRefs'],
            formPath,
          );
          reqStr(form, 'variant', formPath);
          optEnum(
            form,
            'size',
            formPath,
            new Set(['small', 'medium', 'large']),
          );
          const statlineRefs = objArray(form, 'statlineRefs', formPath);
          if (statlineRefs !== undefined) {
            if (statlineRefs.length === 0) {
              throw new RulesPackError(
                `${formPath}.statlineRefs must be a non-empty array`,
              );
            }
            const seen = new Set<string>();
            statlineRefs.forEach((ref, refIndex) => {
              const refPath = `${formPath}.statlineRefs[${refIndex}]`;
              requireOnlyKeys(ref, ['kind', 'condition'], refPath);
              const refKind = reqStr(ref, 'kind', refPath);
              if (
                refKind !== 'armor-class-variant' &&
                refKind !== 'speed-variant'
              ) {
                throw new RulesPackError(
                  `${refPath}.kind has unsupported statline reference kind ${JSON.stringify(refKind)}`,
                );
              }
              const condition = reqStr(ref, 'condition', refPath);
              const identity = `${refKind}\u0000${condition}`;
              if (seen.has(identity)) {
                throw new RulesPackError(
                  `${refPath} duplicates an earlier statline reference`,
                );
              }
              seen.add(identity);
            });
          }
          if (form.size === undefined && statlineRefs === undefined) {
            throw new RulesPackError(
              `${formPath} must specify size or non-empty statlineRefs`,
            );
          }
          break;
        }
        default:
          throw new RulesPackError(
            `${formPath}.kind has unsupported changeShape form ${JSON.stringify(kind)}`,
          );
      }
    });

    const statistics = reqObj(effect, 'statistics', path);
    const model = reqStr(statistics, 'model', `${path}.statistics`);
    if (model === 'retain-listed') {
      requireOnlyKeys(
        statistics,
        ['model', 'retains', 'replaces', 'gainsMissingCapabilities'],
        `${path}.statistics`,
      );
      if (
        reqStrArray(statistics, 'retains', `${path}.statistics`).length === 0
      ) {
        throw new RulesPackError(
          `${path}.statistics.retains must be non-empty`,
        );
      }
      optNonEmptyStrArray(statistics, 'replaces', `${path}.statistics`);
      optBool(statistics, 'gainsMissingCapabilities', `${path}.statistics`);
    } else if (model === 'same-except') {
      requireOnlyKeys(statistics, ['model', 'except'], `${path}.statistics`);
      if (statistics.except !== undefined) {
        const except = reqStrArray(statistics, 'except', `${path}.statistics`);
        if (except.some((value) => !['size', 'ac', 'speed'].includes(value))) {
          throw new RulesPackError(
            `${path}.statistics.except must contain only size, ac, or speed`,
          );
        }
      }
    } else {
      throw new RulesPackError(
        `${path}.statistics.model must be retain-listed or same-except`,
      );
    }

    const equipment = reqObj(effect, 'equipment', path);
    const disposition = reqStr(equipment, 'disposition', `${path}.equipment`);
    if (
      disposition === 'absorbed-or-borne' ||
      disposition === 'not-transformed'
    ) {
      requireOnlyKeys(equipment, ['disposition'], `${path}.equipment`);
    } else if (disposition === 'specific') {
      requireOnlyKeys(equipment, ['disposition', 'items'], `${path}.equipment`);
      const items = objArray(equipment, 'items', `${path}.equipment`);
      if (items === undefined || items.length === 0) {
        throw new RulesPackError(`${path}.equipment.items must not be empty`);
      }
      items.forEach((item, index) => {
        const itemPath = `${path}.equipment.items[${index}]`;
        requireOnlyKeys(item, ['name', 'behavior', 'revertsOnDeath'], itemPath);
        reqStr(item, 'name', itemPath);
        reqEnum(item, 'behavior', itemPath, new Set(['transforms-with-form']));
        if (item.revertsOnDeath !== true) {
          throw new RulesPackError(`${itemPath}.revertsOnDeath must be true`);
        }
      });
    } else {
      throw new RulesPackError(
        `${path}.equipment.disposition has unsupported value ${JSON.stringify(disposition)}`,
      );
    }

    const reversion = reqObj(effect, 'reversion', path);
    requireOnlyKeys(reversion, ['on'], `${path}.reversion`);
    const on = reqStrArray(reversion, 'on', `${path}.reversion`);
    if (on.length === 0 || on.some((value) => value !== 'death')) {
      throw new RulesPackError(
        `${path}.reversion.on must be a non-empty array containing only death`,
      );
    }

    const excluded = effect.excludedCapabilities;
    if (excluded !== undefined) {
      const values = reqStrArray(effect, 'excludedCapabilities', path);
      const allowed = new Set([
        'class-features',
        'legendary-actions',
        'lair-actions',
      ]);
      if (values.length === 0 || values.some((value) => !allowed.has(value))) {
        throw new RulesPackError(
          `${path}.excludedCapabilities must be a non-empty array of supported capabilities`,
        );
      }
    }
    const retained = objArray(effect, 'retainedCapabilities', path);
    if (retained !== undefined) {
      if (retained.length === 0) {
        throw new RulesPackError(
          `${path}.retainedCapabilities must not be empty`,
        );
      }
      retained.forEach((capability, index) => {
        const capabilityPath = `${path}.retainedCapabilities[${index}]`;
        requireOnlyKeys(capability, ['name', 'whenFormHas'], capabilityPath);
        reqEnum(capability, 'name', capabilityPath, new Set(['bite']));
        const whenFormHas = reqObj(capability, 'whenFormHas', capabilityPath);
        requireOnlyKeys(
          whenFormHas,
          ['attack'],
          `${capabilityPath}.whenFormHas`,
        );
        reqEnum(
          whenFormHas,
          'attack',
          `${capabilityPath}.whenFormHas`,
          new Set(['bite']),
        );
      });
    }
    const speedConditions = objArray(effect, 'speedConditions', path);
    if (speedConditions !== undefined) {
      if (speedConditions.length === 0) {
        throw new RulesPackError(`${path}.speedConditions must not be empty`);
      }
      speedConditions.forEach((condition, index) => {
        const conditionPath = `${path}.speedConditions[${index}]`;
        requireOnlyKeys(
          condition,
          ['mode', 'lostUnlessFormHas'],
          conditionPath,
        );
        reqEnum(condition, 'mode', conditionPath, new Set(['fly']));
        const lostUnlessFormHas = reqObj(
          condition,
          'lostUnlessFormHas',
          conditionPath,
        );
        requireOnlyKeys(
          lostUnlessFormHas,
          ['anatomy'],
          `${conditionPath}.lostUnlessFormHas`,
        );
        reqEnum(
          lostUnlessFormHas,
          'anatomy',
          `${conditionPath}.lostUnlessFormHas`,
          new Set(['wings']),
        );
      });
    }
    const riders = effect.riders;
    if (riders !== undefined) {
      const values = reqStrArray(effect, 'riders', path);
      if (
        values.length === 0 ||
        values.some((rider) =>
          /\b(action|bonus action|reaction|bite|retain(?:ed|s)?|lose(?:s)?|lost|speed|unless|if)\b/i.test(
            rider,
          ),
        )
      ) {
        throw new RulesPackError(
          `${path}.riders must be non-empty narrative residue without deterministic clauses`,
        );
      }
    }
  },
  cannotWearOrCarry: markerOnly,
  // Slippers of spider climbing's surface-climbing grant is excluded on a
  // slippery surface such as ice or oil (eshyra-o9bd.18.7.7.5 review) — an
  // exception to the special movement this kind represents, not a universal
  // property of every `climbAnywhere` grant, so it stays optional.
  climbAnywhere: markerWithOptionalCondition,
  climbWithoutCheck: (effect, path) => {
    optStr(effect, 'surfaces', path);
  },
  communication: (effect, path) => {
    if (reqStrArray(effect, 'with', path).length === 0) {
      throw new RulesPackError(`${path}.with must be a non-empty array`);
    }
  },
  communicationBarriers: (effect, path) => {
    if (effect.magicalSilenceBlocks !== true) {
      throw new RulesPackError(`${path}.magicalSilenceBlocks must be true`);
    }
    optBool(effect, 'noStraightLineRequired', path);
    const materials = objArray(effect, 'materials', path);
    if (materials === undefined || materials.length === 0) {
      throw new RulesPackError(`${path}.materials must be a non-empty array`);
    }
    const allowedMaterials = new Set(['stone', 'common-metal', 'lead', 'wood']);
    const allowedThresholds = new Set(['blocks-at-or-above', 'any-thin-sheet']);
    materials.forEach((material, i) => {
      const materialPath = `${path}.materials[${i}]`;
      reqEnum(material, 'material', materialPath, allowedMaterials);
      reqEnum(material, 'threshold', materialPath, allowedThresholds);
      if (material.thickness !== undefined) {
        const thickness = reqObj(material, 'thickness', materialPath);
        reqInt(thickness, 'amount', `${materialPath}.thickness`, 1);
        reqEnum(
          thickness,
          'unit',
          `${materialPath}.thickness`,
          new Set(['foot', 'inch']),
        );
      }
    });
  },
  concurrentEffectLimit: (effect, path) => {
    reqInt(effect, 'max', path, 1);
    reqEnum(
      effect,
      'scope',
      path,
      new Set(['non-instantaneous-effects', 'one-minute-effects']),
    );
    reqEnum(effect, 'dismissCost', path, new Set(['action']));
  },
  conjuredUtilityObject: (effect, path) => {
    const restrictions = effect.restrictions;
    const hasBoundary =
      effect.capacityPounds !== undefined ||
      effect.leashFeet !== undefined ||
      effect.endsBeyondFeet !== undefined ||
      effect.moveFeetPerUse !== undefined ||
      (Array.isArray(restrictions) && restrictions.length > 0);
    if (!hasBoundary) {
      throw new RulesPackError(`${path} must carry at least one boundary`);
    }
    optInt(effect, 'capacityPounds', path, 1);
    optInt(effect, 'leashFeet', path, 1);
    optInt(effect, 'endsBeyondFeet', path, 1);
    optInt(effect, 'moveFeetPerUse', path, 1);
    if (restrictions !== undefined) {
      if (!Array.isArray(restrictions) || restrictions.length === 0) {
        throw new RulesPackError(
          `${path}.restrictions must be a non-empty array when present`,
        );
      }
      optStrArray(effect, 'restrictions', path);
    }
  },
  corpseEligibility: (effect, path) => {
    reqEnum(effect, 'target', path, new Set(['corpse']));
    optBool(effect, 'requiresMouth', path);
    optBool(effect, 'excludesUndead', path);
  },
  createsOrDestroysWater: (effect, path) => {
    reqInt(effect, 'gallons', path, 1);
    optStr(effect, 'areaAlternative', path);
    optTrue(effect, 'extinguishesExposedFlames', path);
    optStr(effect, 'destroyAlternative', path);
  },
  createsProvisions: (effect, path) => {
    if (
      effect.food === undefined &&
      effect.water === undefined &&
      effect.sustains === undefined
    ) {
      throw new RulesPackError(`${path} must carry food, water, or sustains`);
    }
    if (effect.food !== undefined) {
      const food = reqObj(effect, 'food', path);
      reqInt(food, 'pounds', `${path}.food`, 1);
      reqInt(food, 'spoilsAfterHours', `${path}.food`, 1);
    }
    if (effect.water !== undefined) {
      const water = reqObj(effect, 'water', path);
      reqInt(water, 'gallons', `${path}.water`, 1);
    }
    if (effect.sustains !== undefined) {
      const sustains = reqObj(effect, 'sustains', path);
      reqInt(sustains, 'humanoids', `${path}.sustains`, 1);
      reqInt(sustains, 'steeds', `${path}.sustains`, 1);
      reqInt(sustains, 'hours', `${path}.sustains`, 1);
    }
  },
  dcIncrease: (effect, path) => {
    reqInt(effect, 'amount', path, 1);
    reqStr(effect, 'appliesTo', path);
  },
  endsCurses: markerOnly,
  extraTurns: (effect, path) => {
    reqDice(effect, 'turnsDice', path);
  },
  falseAppearance: (effect, path) => {
    reqStr(effect, 'while', path);
    reqStr(effect, 'indistinguishableFrom', path);
  },
  illusionDiscernment: (effect, path) => {
    reqAbility(effect, 'ability', path);
    reqStr(effect, 'skill', path);
    reqEnum(effect, 'dc', path, new Set(['spell-save-dc']));
    optEnum(
      effect,
      'cost',
      path,
      new Set(['action', 'bonus-action', 'reaction']),
    );
  },
  jumpDistanceMultiplier: (effect, path) => {
    reqInt(effect, 'multiplier', path, 2);
    // Boots of striding and springing's multiplied jump is still capped by
    // remaining movement (eshyra-o9bd.18.7.7.5 review) — a source-printed
    // exception, not a universal property of every multiplied jump.
    optStr(effect, 'condition', path);
  },
  locationKnowledge: (effect, path) => {
    const knows = reqStrArray(effect, 'knows', path);
    if (knows.length === 0) {
      throw new RulesPackError(`${path}.knows must be a non-empty array`);
    }
    const allowed = new Set(['direction', 'distance', 'location']);
    knows.forEach((value, i) => {
      if (!allowed.has(value)) {
        throw new RulesPackError(
          `${path}.knows[${i}] must be one of direction, distance, location`,
        );
      }
    });
    reqStr(effect, 'of', path);
    optStr(effect, 'condition', path);
  },
  mirrorImages: (effect, path) => {
    reqInt(effect, 'images', path, 1);
    const thresholds = objArray(effect, 'redirectThresholds', path);
    if (thresholds === undefined || thresholds.length === 0) {
      throw new RulesPackError(
        `${path}.redirectThresholds must be a non-empty array`,
      );
    }
    thresholds.forEach((tier, i) => {
      reqInt(tier, 'duplicates', `${path}.redirectThresholds[${i}]`, 1);
      reqInt(tier, 'minimumRoll', `${path}.redirectThresholds[${i}]`, 1);
    });
    optStr(effect, 'duplicateAcFormula', path);
  },
  movementCostMultiplier: (effect, path) => {
    reqInt(effect, 'feetPerFoot', path, 2);
    // The terrain/subject this multiplier applies to is effect SCOPE, not a
    // gating condition — mirrors `ignoreDifficultTerrain.terrain`
    // (eshyra-o9bd.18.7.7.5 review: cloak of arachnida's web movement).
    optStrArray(effect, 'terrain', path);
  },
  messengerTravel: (effect, path) => {
    const rates = reqObj(effect, 'ratesMilesPer24h', path);
    reqInt(rates, 'flying', `${path}.ratesMilesPer24h`, 1);
    reqInt(rates, 'other', `${path}.ratesMilesPer24h`, 1);
    reqInt(effect, 'maxWords', path, 1);
    if (effect.lostIfUndelivered !== true) {
      throw new RulesPackError(`${path}.lostIfUndelivered must be true`);
    }
  },
  onsetTime: (effect, path) => {
    reqDice(effect, 'roll', path);
    reqInt(effect, 'multiplierMinutes', path, 1);
  },
  pathMemory: (effect, path) => {
    reqEnum(effect, 'scope', path, new Set(['any-previously-traveled-path']));
    reqEnum(effect, 'recall', path, new Set(['perfect']));
  },
  percentChance: (effect, path) => {
    const percent = reqInt(effect, 'percent', path, 1);
    if (percent > 100) {
      throw new RulesPackError(`${path}.percent must be <= 100`);
    }
    reqStr(effect, 'per', path);
    reqStr(effect, 'trigger', path);
    reqStr(effect, 'effect', path);
    optBool(effect, 'cumulative', path);
    optEnum(effect, 'resetOn', path, new Set(['long-rest']));
    optBool(effect, 'secret', path);
  },
  permanenceAfterRepetition: (effect, path) => {
    reqEnum(effect, 'period', path, new Set(['day']));
    reqInt(effect, 'count', path, 1);
    reqEnum(effect, 'result', path, new Set(['until-dispelled', 'permanent']));
  },
  questionLimit: (effect, path) => {
    reqInt(effect, 'maxQuestions', path, 1);
  },
  recastLockout: (effect, path) => {
    reqEnum(effect, 'scope', path, new Set(['per-target']));
    reqInt(effect, 'days', path, 1);
  },
  senseSharing: (effect, path) => {
    reqStr(effect, 'source', path);
    reqStr(effect, 'recipient', path);
    reqStr(effect, 'senses', path);
    optStr(effect, 'condition', path);
  },
  naturalWeaponDamage: (effect, path) => {
    reqDice(effect, 'dice', path);
    const choice = effect.typeChoice;
    if (
      !Array.isArray(choice) ||
      choice.length === 0 ||
      !choice.every(
        (type) => typeof type === 'string' && SRD_5_1_DAMAGE_TYPES.has(type),
      )
    ) {
      throw new RulesPackError(
        `${path}.typeChoice must be a non-empty array of canonical damage types`,
      );
    }
    optInt(effect, 'attackAndDamageBonus', path, 1);
    optBool(effect, 'magical', path);
    optBool(effect, 'proficient', path);
  },
  slowFall: (effect, path) => {
    reqInt(effect, 'descentFeetPerRound', path, 1);
    optBool(effect, 'noFallingDamageOnLanding', path);
  },
  splitOnDamage: (effect, path) => {
    requireOnlyKeys(
      effect,
      [
        'kind',
        'damageTypes',
        'minimumSize',
        'minimumHitPoints',
        'resultingCreatureCount',
        'hitPointsFraction',
        'sizeCategoriesDown',
      ],
      path,
    );
    const damageTypes = reqStrArray(effect, 'damageTypes', path);
    if (damageTypes.length === 0) {
      throw new RulesPackError(`${path}.damageTypes must not be empty`);
    }
    if (damageTypes.some((type) => !SRD_5_1_DAMAGE_TYPES.has(type))) {
      throw new RulesPackError(
        `${path}.damageTypes must contain only canonical damage types`,
      );
    }
    if (new Set(damageTypes).size !== damageTypes.length) {
      throw new RulesPackError(
        `${path}.damageTypes must not contain duplicates`,
      );
    }
    reqEnum(
      effect,
      'minimumSize',
      path,
      new Set(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']),
    );
    reqInt(effect, 'minimumHitPoints', path, 1);
    reqInt(effect, 'resultingCreatureCount', path, 1);
    reqEnum(effect, 'hitPointsFraction', path, new Set(['half-rounded-down']));
    reqInt(effect, 'sizeCategoriesDown', path, 1);
  },
  stabilize: (effect, path) => {
    optStr(effect, 'target', path);
    // The periapt of wound closure ties auto-stabilization to a specific
    // moment (start of the wearer's turn) rather than an unconditional grant
    // (eshyra-o9bd.18.7.7.5).
    optStr(effect, 'trigger', path);
  },
  sleepException: (effect, path) => {
    reqStr(effect, 'detail', path);
  },
  stagedTableShift: (effect, path) => {
    if (reqStrArray(effect, 'tableRefs', path).length === 0) {
      throw new RulesPackError(`${path}.tableRefs must be a non-empty array`);
    }
    reqInt(effect, 'stepsPerChange', path, 1);
  },
  telepathy: (effect, path) => {
    if (effect.conveys !== undefined) {
      throw new RulesPackError(
        `${path}.conveys is not a supported telepathy field; use content for non-directional content limits`,
      );
    }
    const hasBoundary =
      effect.rangeFeet !== undefined ||
      effect.audience !== undefined ||
      effect.maxCreatures !== undefined;
    if (!hasBoundary) {
      throw new RulesPackError(
        `${path} must carry at least one telepathy boundary`,
      );
    }
    optInt(effect, 'rangeFeet', path, 1);
    optBool(effect, 'samePlaneOnly', path);
    optBool(effect, 'oneWay', path);
    optBool(effect, 'requiresLanguage', path);
    optStr(effect, 'audience', path);
    optBool(effect, 'commands', path);
    optInt(effect, 'maxCreatures', path, 1);
    optBool(effect, 'willingOnly', path);
    optInt(effect, 'minIntelligence', path, 1);
    const content = effect.content;
    if (content !== undefined) {
      if (!Array.isArray(content) || content.length === 0) {
        throw new RulesPackError(
          `${path}.content must be a non-empty array when present`,
        );
      }
      const allowedContent = new Set([
        'simple-messages',
        'simple-ideas',
        'emotions',
        'images',
      ]);
      content.forEach((value, i) => {
        if (typeof value !== 'string' || !allowedContent.has(value)) {
          throw new RulesPackError(
            `${path}.content[${i}] must be one of simple-messages, simple-ideas, emotions, images`,
          );
        }
      });
    }
  },
  terrainAlteration: (effect, path) => {
    optStrArray(effect, 'canCreate', path);
    optStrArray(effect, 'canRemove', path);
    const allowed = new Set(['difficult-terrain']);
    for (const key of ['canCreate', 'canRemove']) {
      const values = effect[key];
      if (values === undefined) continue;
      if (!Array.isArray(values) || values.length === 0) {
        throw new RulesPackError(`${path}.${key} must be non-empty`);
      }
      values.forEach((value, i) => {
        if (typeof value !== 'string' || !allowed.has(value)) {
          throw new RulesPackError(
            `${path}.${key}[${i}] must be difficult-terrain`,
          );
        }
      });
    }
    if (effect.canCreate === undefined && effect.canRemove === undefined) {
      throw new RulesPackError(`${path} must carry canCreate or canRemove`);
    }
    optTrue(effect, 'removedPiecesDisappear', path);
  },
  understandLanguages: (effect, path) => {
    if (effect.spoken !== true) {
      throw new RulesPackError(`${path}.spoken must be true`);
    }
    optBool(effect, 'written', path);
    optBool(effect, 'speechUnderstood', path);
  },
  unlock: (effect, path) => {
    optInt(effect, 'audibleRangeFeet', path, 1);
    optInt(effect, 'suppressesArcaneLockMinutes', path, 1);
  },
  walkOnLiquids: (effect, path) => {
    optInt(effect, 'surfacingFeetPerRound', path, 1);
    // What the grant lets you walk on is effect SCOPE, not a gating
    // condition — kept distinct from `condition` (eshyra-o9bd.18.7.7.5
    // review: horseshoes of a zephyr's nonsolid/unstable surfaces).
    optStr(effect, 'surfaces', path);
    optStr(effect, 'condition', path);
  },
  damageTransfer: (effect, path) => {
    reqEnum(effect, 'portion', path, new Set(['half']));
    reqEnum(effect, 'rounding', path, new Set(['down', 'up']));
    optStr(effect, 'from', path);
    optInt(effect, 'rangeFeet', path, 1);
  },
  damageAbsorption: (effect, path) => {
    requireOnlyKeys(effect, ['kind', 'type', 'damageTaken', 'healing'], path);
    reqEnum(effect, 'type', path, SRD_5_1_DAMAGE_TYPES);
    reqEnum(effect, 'damageTaken', path, new Set(['none']));
    reqEnum(effect, 'healing', path, new Set(['damage-dealt']));
  },
  earthGlide: markerOnly,
  enterHostileSpace: markerOnly,
  hoveringWeapon: (effect, path) => {
    reqStr(effect, 'weapon', path);
    reqInt(effect, 'releaseRangeFeet', path, 1);
    reqEnum(
      effect,
      'commandCost',
      path,
      new Set(['action', 'bonus-action', 'reaction']),
    );
    reqInt(effect, 'commandFlyFeet', path, 1);
    reqStrArray(effect, 'commandOptions', path);
  },
  illusoryDisguise: (effect, path) => {
    reqInt(effect, 'discernDc', path, 1);
    reqAbility(effect, 'ability', path);
    reqStr(effect, 'skill', path);
    reqEnum(
      effect,
      'inspectionCost',
      path,
      new Set(['action', 'bonus-action', 'reaction']),
    );
    optEnum(
      effect,
      'endCost',
      path,
      new Set(['action', 'bonus-action', 'reaction']),
    );
  },
  summonCreature: (effect, path) => {
    reqStr(effect, 'creature', path);
    reqInt(effect, 'rangeFeet', path, 1);
    optStr(effect, 'target', path);
    optInt(effect, 'maximumControlled', path, 1);
  },
  summoning: (effect, path) => {
    validateS1SummoningEffect(effect, path);
  },
  movementRestriction: (effect, path) => {
    reqStr(effect, 'restriction', path);
    optStr(effect, 'subject', path);
    optStr(effect, 'target', path);
    optStr(effect, 'endsBy', path);
    optStr(effect, 'trigger', path);
  },
  triggeredEffect: (effect, path) => {
    reqStr(effect, 'trigger', path);
    optStr(effect, 'result', path);
    optStr(effect, 'condition', path);
  },
  extraReactions: (effect, path) => {
    if ((effect.perTurn === undefined) === (effect.formula === undefined)) {
      throw new RulesPackError(
        `${path} must carry exactly one of perTurn or formula`,
      );
    }
    if (effect.perTurn !== undefined) {
      reqInt(effect, 'perTurn', path, 1);
    }
    if (effect.formula !== undefined) {
      reqStr(effect, 'formula', path);
    }
    optStr(effect, 'restrictedTo', path);
  },
  extraWeaponDamageDie: (effect, path) => {
    reqInt(effect, 'extraDice', path, 1);
  },
  hiddenFromView: (effect, path) => {
    reqInt(effect, 'spotDc', path, 1);
    reqAbility(effect, 'ability', path);
    reqStr(effect, 'skill', path);
  },
  ignoreDifficultTerrain: (effect, path) => {
    if (reqStrArray(effect, 'terrain', path).length === 0) {
      throw new RulesPackError(`${path}.terrain must not be empty`);
    }
    optStr(effect, 'condition', path);
  },
  ignoreMovementRestriction: (effect, path) => {
    reqStr(effect, 'source', path);
  },
  limitedAmmunition: (effect, path) => {
    reqInt(effect, 'count', path, 1);
    reqStr(effect, 'replenish', path);
  },
  mimicry: (effect, path) => {
    reqInt(effect, 'discernDc', path, 1);
    reqAbility(effect, 'ability', path);
    reqStr(effect, 'skill', path);
  },
  moveThroughNarrowSpaces: (effect, path) => {
    reqInt(effect, 'widthInches', path, 1);
  },
  moveUpTo: (effect, path) => {
    reqEnum(effect, 'amount', path, new Set(['speed', 'half-speed']));
    optBool(effect, 'withoutOpportunityAttacks', path);
  },
  planeShift: (effect, path) => {
    if (reqStrArray(effect, 'planes', path).length === 0) {
      throw new RulesPackError(`${path}.planes must not be empty`);
    }
    // Blink's chance-gated shift: a die, a threshold, a trigger, and the
    // return radius.
    if (effect.roll !== undefined) {
      const roll = reqStr(effect, 'roll', path);
      if (!/^d\d+$/.test(roll)) {
        throw new RulesPackError(
          `${path}.roll must be a die (e.g. "d20"), got ${JSON.stringify(roll)}`,
        );
      }
    }
    optInt(effect, 'threshold', path, 1);
    optStr(effect, 'trigger', path);
    optInt(effect, 'returnRangeFeet', path, 1);
  },
  recurringDamage: (effect, path) => {
    if ((effect.amount === undefined) === (effect.dice === undefined)) {
      throw new RulesPackError(
        `${path} must carry exactly one of amount or dice`,
      );
    }
    if (effect.amount !== undefined) {
      reqInt(effect, 'amount', path, 1);
    }
    if (effect.dice !== undefined) {
      reqDice(effect, 'dice', path);
    }
    if ((effect.type === undefined) === (effect.typeChoice === undefined)) {
      throw new RulesPackError(
        `${path} must carry exactly one of type or typeChoice`,
      );
    }
    if (effect.type !== undefined) {
      const type = reqStr(effect, 'type', path);
      if (!SRD_5_1_DAMAGE_TYPES.has(type)) {
        throw new RulesPackError(
          `${path}.type must be a canonical SRD damage type, got ${JSON.stringify(type)}`,
        );
      }
    }
    if (effect.typeChoice !== undefined) {
      const choice = effect.typeChoice;
      if (
        !Array.isArray(choice) ||
        choice.length === 0 ||
        !choice.every(
          (type) => typeof type === 'string' && SRD_5_1_DAMAGE_TYPES.has(type),
        )
      ) {
        throw new RulesPackError(
          `${path}.typeChoice must be a non-empty array of canonical damage types`,
        );
      }
    }
    reqStr(effect, 'trigger', path);
  },
  rejuvenation: (effect, path) => {
    if (effect.afterHours === undefined && effect.afterDaysDice === undefined) {
      throw new RulesPackError(
        `${path} must carry afterHours or afterDaysDice`,
      );
    }
    if (effect.afterHours !== undefined) {
      reqInt(effect, 'afterHours', path, 1);
    }
    if (effect.afterDaysDice !== undefined) {
      reqDice(effect, 'afterDaysDice', path);
    }
    optStr(effect, 'condition', path);
  },
  seeInMagicalDarkness: markerOnly,
  spellReflection: (effect, path) => {
    const roll = reqStr(effect, 'roll', path);
    if (!/^d\d+$/.test(roll)) {
      throw new RulesPackError(
        `${path}.roll must be a die (e.g. "d6"), got ${JSON.stringify(roll)}`,
      );
    }
    reqInt(effect, 'unaffectedOnMaximum', path, 1);
    reqInt(effect, 'reflectedOn', path, 1);
  },
  spellStoring: (effect, path) => {
    const level = reqInt(effect, 'maximumSpellLevel', path, 1);
    if (level > 9) {
      throw new RulesPackError(
        `${path}.maximumSpellLevel must be <= 9, got ${level}`,
      );
    }
    optInt(effect, 'capacity', path, 1);
  },
  swarm: (effect, path) => {
    if (effect.canOccupyOtherCreaturesSpace !== true) {
      throw new RulesPackError(
        `${path}.canOccupyOtherCreaturesSpace must be true`,
      );
    }
    optBool(effect, 'cannotRegainHitPoints', path);
    optBool(effect, 'cannotGainTemporaryHitPoints', path);
  },
  teleport: (effect, path) => {
    // Either a fixed distance (creature Teleport actions, Misty Step) or a
    // named destination (Word of Recall, Teleportation Circle).
    if (effect.distanceFeet === undefined && effect.destination === undefined) {
      throw new RulesPackError(
        `${path} must carry distanceFeet or destination`,
      );
    }
    if (effect.distanceFeet !== undefined) {
      reqInt(effect, 'distanceFeet', path, 1);
    }
    optStr(effect, 'destination', path);
    optStr(effect, 'via', path);
    optInt(effect, 'movementCostFeet', path, 1);
  },
  tunneler: (effect, path) => {
    const multiplier = reqNum(effect, 'solidRockBurrowSpeedMultiplier', path);
    if (multiplier !== 0.5) {
      throw new RulesPackError(
        `${path}.solidRockBurrowSpeedMultiplier must be 0.5`,
      );
    }
    reqInt(effect, 'tunnelDiameterFeet', path, 1);
  },
  weaponCorrosion: (effect, path) => {
    const perHit = reqInt(effect, 'penaltyPerHit', path);
    const destroyedAt = reqInt(effect, 'destroyedAtPenalty', path);
    if (perHit >= 0 || destroyedAt >= 0) {
      throw new RulesPackError(
        `${path} penaltyPerHit and destroyedAtPenalty must be negative integers`,
      );
    }
    optBool(effect, 'ammunitionDestroyedOnHit', path);
  },
  multiattack: (effect, path) => {
    const variants = [
      effect.attacks,
      effect.options,
      effect.attacksFormula,
      effect.attacksDice,
    ].filter((variant) => variant !== undefined);
    if (variants.length !== 1) {
      throw new RulesPackError(
        `${path} must carry exactly one of attacks, options, attacksFormula, or attacksDice`,
      );
    }
    if (effect.attacks !== undefined) {
      reqInt(effect, 'attacks', path, 1);
      const routine = objArray(effect, 'routine', path);
      routine?.forEach((part, i) => {
        reqInt(part, 'attacks', `${path}.routine[${i}]`, 1);
        reqStr(part, 'attack', `${path}.routine[${i}]`);
      });
    }
    if (effect.options !== undefined) {
      const options = objArray(effect, 'options', path);
      if (options === undefined || options.length === 0) {
        throw new RulesPackError(`${path}.options must be a non-empty array`);
      }
      options.forEach((option, i) => {
        reqInt(option, 'attacks', `${path}.options[${i}]`, 1);
        reqEnum(
          option,
          'attackType',
          `${path}.options[${i}]`,
          new Set(['melee', 'ranged']),
        );
      });
    }
    if (effect.attacksFormula !== undefined) {
      reqEnum(effect, 'attacksFormula', path, new Set(['one-per-head']));
      optStr(effect, 'attackName', path);
    }
    if (effect.attacksDice !== undefined) {
      reqDice(effect, 'attacksDice', path);
    }
  },
  light: (effect, path) => {
    // Continual Flame's brightness is defined only by analogy to a torch.
    if (effect.equivalentTo !== undefined) {
      reqEnum(effect, 'equivalentTo', path, new Set(['torch']));
      return;
    }
    reqEnum(effect, 'level', path, new Set(['bright', 'dim']));
    const fixed = effect.radiusFeet !== undefined;
    const variable =
      effect.radiusFeetMinimum !== undefined ||
      effect.radiusFeetMaximum !== undefined;
    if (fixed === variable) {
      throw new RulesPackError(
        `${path} must carry radiusFeet or a radiusFeetMinimum/radiusFeetMaximum pair`,
      );
    }
    if (fixed) {
      reqInt(effect, 'radiusFeet', path, 1);
    } else {
      reqInt(effect, 'radiusFeetMinimum', path, 1);
      reqInt(effect, 'radiusFeetMaximum', path, 1);
    }
    optInt(effect, 'dimAdditionalFeet', path, 1);
    optBool(effect, 'dimAdditionalFeetEqualsRadius', path);
    optBool(effect, 'variable', path);
    optStr(effect, 'condition', path);
  },
  sense: (effect, path) => {
    reqStr(effect, 'sense', path);
    optInt(effect, 'rangeFeet', path, 1);
    optInt(effect, 'rangeMiles', path, 1);
    optStr(effect, 'detects', path);
    // Magic-item grants (eshyra-o9bd.18.7.7.5): a time-boxed activation
    // (gem of seeing's 10-minute truesight window), a conditional range
    // increase when the wearer already has the sense (goggles of night's
    // "+60 feet if you already have darkvision"), and free-text scoping.
    optInt(effect, 'durationMinutes', path, 1);
    optInt(effect, 'bonusRangeFeetIfAlreadyHasSense', path, 1);
    optStr(effect, 'condition', path);
  },
  jumpDistance: (effect, path) => {
    reqInt(effect, 'longJumpFeet', path, 1);
    optInt(effect, 'highJumpFeet', path, 1);
    optBool(effect, 'runningStartRequired', path);
    optInt(effect, 'runningStartFeet', path, 1);
  },
  autoSucceedSave: (effect, path) => {
    reqStr(effect, 'targets', path);
    reqStr(effect, 'countFormula', path);
    optBool(effect, 'noDamageInsteadOfHalf', path);
  },
  climbWithoutExtraMovement: markerOnly,
  evasion: markerOnly,
  damageBonus: (effect, path) => {
    if (
      (effect.amount === undefined) ===
      (effect.addAbilityModifier === undefined)
    ) {
      throw new RulesPackError(
        `${path} must carry exactly one of amount or addAbilityModifier`,
      );
    }
    if (effect.amount !== undefined) {
      reqInt(effect, 'amount', path);
    }
    optAbility(effect, 'addAbilityModifier', path);
    optStr(effect, 'scope', path);
  },
  damageDieReplacement: (effect, path) => {
    reqDice(effect, 'die', path);
    reqStr(effect, 'appliesTo', path);
    const progression = effect.progression;
    if (progression !== undefined) {
      if (
        typeof progression !== 'object' ||
        progression === null ||
        Array.isArray(progression)
      ) {
        throw new RulesPackError(
          `${path}.progression must be a non-null object when present`,
        );
      }
      const ref = reqStr(progression as Obj, 'classRef', `${path}.progression`);
      if (!ref.startsWith('class:')) {
        throw new RulesPackError(
          `${path}.progression.classRef must be a 'class:' ref, got ${JSON.stringify(ref)}`,
        );
      }
      reqStr(progression as Obj, 'resource', `${path}.progression`);
    }
    optEligibility(effect, path);
  },
  damageOnSuccessfulSave: (effect, path) => {
    reqEnum(effect, 'portion', path, new Set(['half', 'none']));
    reqStr(effect, 'scope', path);
  },
  extraTurn: (effect, path) => {
    reqInt(effect, 'round', path, 1);
    reqInt(effect, 'secondTurnInitiativeOffset', path);
  },
  expertise: (effect, path) => {
    optAbility(effect, 'ability', path);
    optStr(effect, 'skill', path);
    optStr(effect, 'condition', path);
  },
  halfProficiencyToChecks: (effect, path) => {
    reqStr(effect, 'scope', path);
    optEnum(effect, 'round', path, new Set(['up', 'down']));
  },
  jumpDistanceBonus: (effect, path) => {
    reqAbility(effect, 'addAbilityModifier', path);
    reqStr(effect, 'appliesTo', path);
  },
  maximizeHealingDice: (effect, path) => {
    reqStr(effect, 'appliesTo', path);
  },
  slowAging: (effect, path) => {
    reqInt(effect, 'periodYears', path, 1);
    reqInt(effect, 'agesYears', path, 1);
  },
  speedSet: (effect, path) => {
    // Two emitted shapes: the condition projection's `{ speed: 0, subject }`
    // and the feature projection's `{ mode, value, … }` (Dragon Wings).
    if (effect.speed !== undefined) {
      reqInt(effect, 'speed', path, 0);
      optStr(effect, 'subject', path);
      return;
    }
    reqEnum(
      effect,
      'mode',
      path,
      new Set(['walk', 'fly', 'swim', 'climb', 'burrow']),
    );
    // The magnitude is either an inline value or (carpet of flying) a
    // pointer to the printed by-size table (eshyra-o9bd.18.7.7.5) — never
    // both, and never neither.
    const hasValue = effect.value !== undefined;
    const hasValueTableRef = effect.valueTableRef !== undefined;
    if (hasValue === hasValueTableRef) {
      throw new RulesPackError(
        `${path} must carry exactly one of value or valueTableRef`,
      );
    }
    if (hasValueTableRef) {
      const ref = reqStr(effect, 'valueTableRef', path);
      if (!ref.startsWith('table:')) {
        throw new RulesPackError(
          `${path}.valueTableRef must be a 'table:' ref, got ${JSON.stringify(ref)}`,
        );
      }
    } else {
      const value = effect.value;
      if (
        value !== 'current-speed' &&
        value !== 'walking-speed' &&
        (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
      ) {
        throw new RulesPackError(
          `${path}.value must be "current-speed", "walking-speed", or a non-negative integer, got ${JSON.stringify(value)}`,
        );
      }
    }
    optActionCost(effect, 'activation', path);
    optActionCost(effect, 'deactivation', path);
    optEligibility(effect, path);
    // Magic-item extensions (eshyra-o9bd.18.7.7.5): `floor` marks a minimum
    // rather than an absolute set (boots of striding and springing never
    // reduce an already-higher walking speed), and `hover` marks a granted
    // flying/floating mode as including the ability to hover in place.
    optBool(effect, 'floor', path);
    optBool(effect, 'hover', path);
    optStr(effect, 'condition', path);
    // A weight-based speed reduction with a hard capacity ceiling (broom of
    // flying: "flying speed becomes 30 feet while carrying over 200 pounds"
    // under a 400-pound cap) — structured rather than folded into
    // `condition`, since a consumer must not have to parse prose to
    // determine movement speed (eshyra-o9bd.18.7.7.5 review round 3).
    const weightCapacity = effect.weightCapacity;
    if (weightCapacity !== undefined) {
      if (
        typeof weightCapacity !== 'object' ||
        weightCapacity === null ||
        Array.isArray(weightCapacity)
      ) {
        throw new RulesPackError(
          `${path}.weightCapacity must be a non-null object when present`,
        );
      }
      const wc = weightCapacity as Obj;
      const wcPath = `${path}.weightCapacity`;
      reqInt(wc, 'maximumPounds', wcPath, 1);
      const hasReducedValue = wc.reducedValue !== undefined;
      const hasThreshold = wc.reducedAboveWeightPounds !== undefined;
      if (hasReducedValue !== hasThreshold) {
        throw new RulesPackError(
          `${wcPath} must carry both reducedValue and reducedAboveWeightPounds, or neither`,
        );
      }
      if (hasReducedValue) {
        const reducedValue = wc.reducedValue;
        if (
          reducedValue !== 'current-speed' &&
          reducedValue !== 'walking-speed' &&
          (typeof reducedValue !== 'number' ||
            !Number.isInteger(reducedValue) ||
            reducedValue < 0)
        ) {
          throw new RulesPackError(
            `${wcPath}.reducedValue must be "current-speed", "walking-speed", or a non-negative integer, got ${JSON.stringify(reducedValue)}`,
          );
        }
        reqInt(wc, 'reducedAboveWeightPounds', wcPath, 1);
      }
    }
  },
  // No dedicated validator previously existed (any payload was accepted).
  // Adding one now (eshyra-o9bd.18.7.7.5 review round 3, corrected round 4)
  // is scoped to this bead's own new usage: carpet of flying's "carries up
  // to TWICE the table capacity, but flies at half speed if it carries more
  // than its NORMAL [table] capacity" names two independent table-derived
  // numbers, not one — the half-speed threshold is the table value itself
  // (×1), and the hard carrying ceiling is a further, separate ×2 of that
  // same value. Collapsing them into one `thresholdMultiplier` (round 3)
  // wrongly pushed the half-speed threshold up to ×2. `threshold` and
  // `maximumCapacity` are independent optional table-derived facts.
  // Existing callers are unaffected: they all set only `multiplier` (+
  // optional `subject`/`condition`).
  speedMultiplier: (effect, path) => {
    const multiplier = effect.multiplier;
    if (typeof multiplier !== 'number' || !Number.isFinite(multiplier)) {
      throw new RulesPackError(`${path}.multiplier must be a finite number`);
    }
    optStr(effect, 'subject', path);
    optStr(effect, 'condition', path);
    for (const key of ['threshold', 'maximumCapacity'] as const) {
      const value = effect[key];
      if (value === undefined) continue;
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new RulesPackError(
          `${path}.${key} must be a non-null object when present`,
        );
      }
      const obj = value as Obj;
      const objPath = `${path}.${key}`;
      const ref = reqStr(obj, 'tableRef', objPath);
      if (!ref.startsWith('table:')) {
        throw new RulesPackError(
          `${objPath}.tableRef must be a 'table:' ref, got ${JSON.stringify(ref)}`,
        );
      }
      const tableMultiplier = obj.multiplier;
      if (
        typeof tableMultiplier !== 'number' ||
        !Number.isFinite(tableMultiplier) ||
        tableMultiplier <= 0
      ) {
        throw new RulesPackError(
          `${objPath}.multiplier must be a positive finite number`,
        );
      }
    }
  },
  abilityScoreIncrease: (effect, path) => {
    const raw = effect.abilities;
    if (
      !Array.isArray(raw) ||
      raw.length === 0 ||
      !raw.every(
        (ability) => typeof ability === 'string' && ABILITY_NAMES.has(ability),
      )
    ) {
      throw new RulesPackError(
        `${path}.abilities must be a non-empty ability-name array`,
      );
    }
    reqInt(effect, 'amount', path, 1);
    optInt(effect, 'newMaximum', path, 1);
    // The manuals/tomes of +2 ("your score increases by 2, as does your
    // maximum for that score") raise the character's ability-score maximum
    // by the same relative amount rather than setting it to a fixed printed
    // number, so this is distinct from `newMaximum` (eshyra-o9bd.18.7.7.5).
    optBool(effect, 'alsoIncreasesMaximum', path);
    if (
      effect.newMaximum !== undefined &&
      effect.alsoIncreasesMaximum !== undefined
    ) {
      throw new RulesPackError(
        `${path} must not carry both newMaximum and alsoIncreasesMaximum`,
      );
    }
    // Hammer of Thunderbolts' Strength increase applies only while attuned
    // AND holding the weapon — a narrower condition than ordinary attunement
    // (eshyra-o9bd.18.7.7.5 review).
    optStr(effect, 'condition', path);
  },
  // Ability-score FLOOR semantics (eshyra-o9bd.18.7.7.5): "your Strength
  // score is 19 while you wear these gauntlets... no effect if already 19 or
  // higher" is a minimum, not a `+N` delta, so it does not fit
  // `abilityScoreIncrease`. `value` is a fixed floor (amulet of health,
  // gauntlets of ogre power, headband of intellect); `tableRef` is used
  // instead when the floor varies by a printed variant table (belt/potion of
  // giant strength), which already carries the table via `data.tableRefs`.
  abilityScoreSet: (effect, path) => {
    reqAbility(effect, 'ability', path);
    const hasValue = effect.value !== undefined;
    const hasTableRef = effect.tableRef !== undefined;
    if (hasValue === hasTableRef) {
      throw new RulesPackError(
        `${path} must carry exactly one of value or tableRef`,
      );
    }
    if (hasValue) reqInt(effect, 'value', path, 1);
    if (hasTableRef) {
      const ref = reqStr(effect, 'tableRef', path);
      if (!ref.startsWith('table:')) {
        throw new RulesPackError(
          `${path}.tableRef must be a 'table:' ref, got ${JSON.stringify(ref)}`,
        );
      }
    }
  },
  // Ioun stone of Mastery: "your proficiency bonus increases by 1"
  // (eshyra-o9bd.18.7.7.5) — no existing kind models a flat PB delta.
  proficiencyBonusIncrease: (effect, path) => {
    reqInt(effect, 'amount', path, 1);
  },
  // A multiplier on a healing ROLL, distinct from `maximizeHealingDice`
  // (which sets dice to their maximum rather than scaling the result). The
  // periapt of wound closure doubles Hit Die healing (eshyra-o9bd.18.7.7.5).
  healingMultiplier: (effect, path) => {
    const multiplier = effect.multiplier;
    if (typeof multiplier !== 'number' || !Number.isFinite(multiplier)) {
      throw new RulesPackError(`${path}.multiplier must be a finite number`);
    }
    reqStr(effect, 'appliesTo', path);
  },
  // Horseshoes of a Zephyr's hover requires all four horseshoes affixed
  // (eshyra-o9bd.18.7.7.5 review) — an item-specific prerequisite, so
  // `condition` stays optional rather than a universal requirement.
  // `heightInches` is the fixed hover height that item prints (4 inches) —
  // structured rather than folded into `condition` (review round 3). Both
  // fields stay optional and fail-closed against any other key.
  hover: (effect, path) => {
    for (const key of Object.keys(effect)) {
      if (key !== 'kind' && key !== 'heightInches' && key !== 'condition') {
        throw new RulesPackError(
          `${path} has unexpected payload key ${JSON.stringify(key)}`,
        );
      }
    }
    optInt(effect, 'heightInches', path, 1);
    optStr(effect, 'condition', path);
  },
  // A standalone effect (eshyra-o9bd.18.7.7.5 review): the horseshoes of a
  // zephyr's "leaves no tracks" is an independent benefit, not a qualifier
  // nested inside `walkOnLiquids`.
  leavesNoTracks: markerWithOptionalCondition,
  sustenance: markerOnly,
  swimWithoutExtraMovement: markerOnly,
  // Helm of telepathy's bonus-action message relay while concentrating on
  // its detect thoughts cast (eshyra-o9bd.18.7.7.5). The F3 concentration
  // dependency is named in the mechanics inventory, not modeled here.
  telepathicRelay: (effect, path) => {
    optStr(effect, 'requires', path);
  },
  // Shared by boots of the winterlands and the ring of warmth
  // (eshyra-o9bd.18.7.7.5): tolerance of extreme cold without additional
  // protection, down to a fixed floor.
  temperatureTolerance: (effect, path) => {
    reqInt(effect, 'minimumFahrenheit', path);
    optInt(effect, 'withHeavyClothesMinimumFahrenheit', path);
  },
  // No dedicated validator previously existed for these two kinds (any
  // payload was accepted). Adding one now (eshyra-o9bd.18.7.7.5) is scoped to
  // this bead's own new usage: the berserker axe's "+1 [hit point maximum]
  // for each level you have attained" is a scaling rate, not the flat
  // `amount` the existing creature-trait callers always emitted, so `amount`
  // and `perLevel` are accepted as alternatives; existing callers are
  // unaffected since they all set `amount`.
  hitPointMaximumIncrease: (effect, path) => {
    const hasAmount = effect.amount !== undefined;
    const hasPerLevel = effect.perLevel !== undefined;
    if (hasAmount === hasPerLevel) {
      throw new RulesPackError(
        `${path} must carry exactly one of amount or perLevel`,
      );
    }
    if (hasAmount) reqInt(effect, 'amount', path, 1);
    if (hasPerLevel) reqInt(effect, 'perLevel', path, 1);
    optBool(effect, 'alsoCurrentHitPoints', path);
  },
  // Regeneration previously had no dedicated validator. This shape covers
  // both the existing creature-trait usage (fixed `hitPoints`, `timing`
  // `"start-of-turn"`) and the ring of regeneration / ioun stone of
  // regeneration's dice-based, interval-timed healing plus the ring's
  // separate limb-regrowth clause (eshyra-o9bd.18.7.7.5).
  regeneration: (effect, path) => {
    const hasHitPoints = effect.hitPoints !== undefined;
    const hasHitDice = effect.hitDice !== undefined;
    if (hasHitPoints === hasHitDice) {
      throw new RulesPackError(
        `${path} must carry exactly one of hitPoints or hitDice`,
      );
    }
    if (hasHitPoints) reqInt(effect, 'hitPoints', path, 1);
    if (hasHitDice) reqDice(effect, 'hitDice', path);
    reqStr(effect, 'timing', path);
    optStr(effect, 'condition', path);
    optStr(effect, 'suppressedBy', path);
    const suppressedByDamageTypes = effect.suppressedByDamageTypes;
    if (suppressedByDamageTypes !== undefined) {
      if (
        !Array.isArray(suppressedByDamageTypes) ||
        !suppressedByDamageTypes.every(
          (type) => typeof type === 'string' && SRD_5_1_DAMAGE_TYPES.has(type),
        )
      ) {
        throw new RulesPackError(
          `${path}.suppressedByDamageTypes must be an array of canonical damage types`,
        );
      }
    }
    if (effect.limbRegrowthDays !== undefined) {
      reqDice(effect, 'limbRegrowthDays', path);
    }
    optStr(effect, 'limbRegrowthCondition', path);
  },
  acFormula: (effect, path) => {
    reqInt(effect, 'base', path, 1);
    const raw = effect.abilities;
    if (
      !Array.isArray(raw) ||
      raw.length === 0 ||
      !raw.every(
        (ability) => typeof ability === 'string' && ABILITY_NAMES.has(ability),
      )
    ) {
      throw new RulesPackError(
        `${path}.abilities must be a non-empty ability-name array`,
      );
    }
    optBool(effect, 'allowsShield', path);
  },
  brutalCritical: (effect, path) => {
    reqInt(effect, 'additionalDice', path, 1);
    const increases = objArray(effect, 'increases', path);
    increases?.forEach((tier, i) => {
      reqInt(tier, 'level', `${path}.increases[${i}]`, 1);
      reqInt(tier, 'additionalDice', `${path}.increases[${i}]`, 1);
    });
  },
  damageReduction: (effect, path) => {
    if (
      effect.dice === undefined &&
      effect.multiplier === undefined &&
      effect.amountFormula === undefined
    ) {
      throw new RulesPackError(
        `${path} must carry dice, multiplier, or amountFormula`,
      );
    }
    if (effect.dice !== undefined) reqDice(effect, 'dice', path);
    // Every alternate shape is fully validated (eshyra-o9bd.18.7.5
    // re-review): a recognized kind with a malformed payload must fail.
    if (effect.multiplier !== undefined) {
      const multiplier = effect.multiplier;
      if (
        typeof multiplier !== 'number' ||
        !Number.isFinite(multiplier) ||
        multiplier <= 0 ||
        multiplier >= 1
      ) {
        throw new RulesPackError(
          `${path}.multiplier must be a finite number in (0, 1), got ${JSON.stringify(multiplier)}`,
        );
      }
    }
    optStr(effect, 'amountFormula', path);
    if (effect.addAbilityModifier !== undefined) {
      reqAbility(effect, 'addAbilityModifier', path);
    }
    optStr(effect, 'addClassLevel', path);
    optStr(effect, 'scope', path);
  },
  bonusAction: (effect, path) => {
    const options = effect.options;
    if (
      !Array.isArray(options) ||
      options.length === 0 ||
      !options.every(
        (option) => typeof option === 'string' && option.length > 0,
      )
    ) {
      throw new RulesPackError(
        `${path}.options must be a non-empty string array`,
      );
    }
    optStr(effect, 'via', path);
    optStr(effect, 'frequency', path);
    optStr(effect, 'prerequisite', path);
    optEligibility(effect, path);
  },
  // A trigger-gated, single bonus action. This is deliberately distinct from
  // `bonusAction.options`, whose array is a menu of independently available
  // choices: both the trigger and the composite result belong to this one
  // effect, never to corresponding array positions.
  triggeredBonusAction: (effect, path) => {
    requireOnlyKeys(effect, ['kind', 'trigger', 'action'], path);
    const trigger = reqObj(effect, 'trigger', path);
    requireOnlyKeys(
      trigger,
      ['event', 'attackType', 'timing'],
      `${path}.trigger`,
    );
    reqEnum(
      trigger,
      'event',
      `${path}.trigger`,
      new Set(['reduce-creature-to-0-hit-points']),
    );
    reqEnum(trigger, 'attackType', `${path}.trigger`, new Set(['melee']));
    reqEnum(trigger, 'timing', `${path}.trigger`, new Set(['on-its-turn']));

    const action = reqObj(effect, 'action', path);
    requireOnlyKeys(action, ['movement', 'attack'], `${path}.action`);
    reqEnum(
      action,
      'movement',
      `${path}.action`,
      new Set(['up-to-half-speed']),
    );
    reqEnum(action, 'attack', `${path}.action`, new Set(['bite']));
  },
  checkMinimum: (effect, path) => {
    reqAbility(effect, 'ability', path);
    reqStr(effect, 'minimum', path);
  },
  extraAttack: (effect, path) => {
    reqInt(effect, 'attacks', path, 2);
    const increases = objArray(effect, 'increases', path);
    increases?.forEach((tier, i) => {
      reqInt(tier, 'level', `${path}.increases[${i}]`, 1);
      reqInt(tier, 'attacks', `${path}.increases[${i}]`, 2);
    });
  },
  extraDamage: (effect, path) => {
    reqDice(effect, 'dice', path);
    optStr(effect, 'trigger', path);
    if (effect.type !== undefined) {
      const type = reqStr(effect, 'type', path);
      if (!SRD_5_1_DAMAGE_TYPES.has(type)) {
        throw new RulesPackError(
          `${path}.type must be a canonical SRD damage type, got ${JSON.stringify(type)}`,
        );
      }
    }
    if (effect.maximumDice !== undefined) reqDice(effect, 'maximumDice', path);
    if (effect.perSlotLevelIncrease !== undefined) {
      reqDice(effect, 'perSlotLevelIncrease', path);
    }
    if (effect.bonusDiceVsUndeadOrFiend !== undefined) {
      reqDice(effect, 'bonusDiceVsUndeadOrFiend', path);
    }
  },
  permanentSpellEffect: (effect, path) => {
    const ref = reqStr(effect, 'spell', path);
    if (!ref.startsWith('spell:')) {
      throw new RulesPackError(
        `${path}.spell must be a 'spell:' ref, got ${JSON.stringify(ref)}`,
      );
    }
  },
  reaction: (effect, path) => {
    reqStr(effect, 'action', path);
    reqStr(effect, 'trigger', path);
  },
  resourceRegain: (effect, path) => {
    reqStr(effect, 'resource', path);
    reqInt(effect, 'amount', path, 1);
    reqStr(effect, 'trigger', path);
  },
  rollFloor: (effect, path) => {
    // Reliable Talent's "treat a roll of N or lower as M" carries rollOf;
    // Glibness's "replace the number you roll with a 15" carries scope only.
    reqInt(effect, 'treatAs', path, 1);
    optInt(effect, 'rollOf', path, 1);
    optStr(effect, 'scope', path);
  },
  saveDcFormula: (effect, path) => {
    reqInt(effect, 'base', path, 1);
    reqAbility(effect, 'ability', path);
    optBool(effect, 'addProficiencyBonus', path);
  },
  savingThrowBonus: (effect, path) => {
    reqAbility(effect, 'addAbilityModifier', path);
    optInt(effect, 'minimum', path, 1);
    optInt(effect, 'rangeFeet', path, 1);
  },
  weaponAttacksMagical: (effect, path) => {
    const scope = effect.scope;
    if (
      scope !== undefined &&
      scope !== 'unarmed-strikes' &&
      scope !== 'weapon-attacks'
    ) {
      throw new RulesPackError(
        `${path}.scope must be "unarmed-strikes" or "weapon-attacks", got ${JSON.stringify(scope)}`,
      );
    }
  },
};

function validateMechanicsEffect(effect: Obj, path: string): void {
  const kind = reqStr(effect, 'kind', path);
  if (!MECHANICS_EFFECT_KINDS.has(kind)) {
    throw new RulesPackError(
      `${path}.kind has unsupported mechanics effect kind ${JSON.stringify(kind)}`,
    );
  }
  MECHANICS_EFFECT_PAYLOAD_VALIDATORS[kind]?.(effect, path);
}

// Optional level-by-level class progression (eshyra-4a7.6). Each row carries an
// integer `level` and a verbatim `proficiencyBonus`; optional `features`
// (each `{ name, ref?, detail? }`), `resources` (scalar/null map), and
// `spellcasting` (scalar/null map, possibly one level deep) derive from the
// emitted progression table rows.
function optProgression(parent: Obj, key: string, path: string): void {
  const rows = objArray(parent, key, path);
  if (rows === undefined) return;
  rows.forEach((row, i) => {
    const rowPath = `${path}.${key}[${i}]`;
    reqInt(row, 'level', rowPath, 1);
    reqStr(row, 'proficiencyBonus', rowPath);
    const features = objArray(row, 'features', rowPath);
    if (features !== undefined) {
      features.forEach((f, fi) => {
        reqStr(f, 'name', `${rowPath}.features[${fi}]`);
        optStr(f, 'ref', `${rowPath}.features[${fi}]`);
        optStr(f, 'detail', `${rowPath}.features[${fi}]`);
      });
    }
    for (const mapKey of ['resources', 'spellcasting'] as const) {
      const map = row[mapKey];
      if (map === undefined) continue;
      if (typeof map !== 'object' || map === null || Array.isArray(map)) {
        throw new RulesPackError(
          `${rowPath}.${mapKey} must be an object when present`,
        );
      }
      for (const [k, v] of Object.entries(map as Obj)) {
        // Values are scalars/null, or (for nested spellcasting slot maps) a
        // single further scalar/null map.
        const nestedOk =
          typeof v === 'object' &&
          v !== null &&
          !Array.isArray(v) &&
          Object.values(v as Obj).every(isScalar);
        if (!isScalar(v) && !nestedOk) {
          throw new RulesPackError(
            `${rowPath}.${mapKey}.${k} must be a scalar, null, or a flat scalar map`,
          );
        }
      }
    }
  });
}

// Optional level-grouped subclass feature projection (eshyra-vk23.5). Each row
// carries an integer `level` (>= 1) and a non-empty `features` array of feature
// refs unlocked at that level. Rows are required to be in strictly ascending
// level order so the projection reads as play-order progression and a level is
// not split across two rows.
function optFeaturesByLevel(parent: Obj, key: string, path: string): void {
  const rows = objArray(parent, key, path);
  if (rows === undefined) return;
  let previousLevel = 0;
  rows.forEach((row, i) => {
    const rowPath = `${path}.${key}[${i}]`;
    const level = reqInt(row, 'level', rowPath, 1);
    if (level <= previousLevel) {
      throw new RulesPackError(
        `${rowPath}.level must be strictly greater than the previous row's level`,
      );
    }
    previousLevel = level;
    const features = reqStrArray(row, 'features', rowPath);
    if (features.length === 0) {
      throw new RulesPackError(`${rowPath}.features must be non-empty`);
    }
  });
}

// Baseline per-kind validators. Every record of the kind must satisfy these
// minimum shape constraints. The shared rule is `data` is a non-null object
// and `description` (if present) is a non-empty string; some kinds add a few
// more cross-system minimums.

function baseObjectKind(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  optStr(data, 'description', `${path}.data`);
}

function projectionRows(projection: Obj, path: string): readonly Obj[] {
  const rows = projection.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new RulesPackError(`${path}.rows must be a non-empty array`);
  }
  rows.forEach((row, index) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      throw new RulesPackError(`${path}.rows[${index}] must be an object`);
    }
  });
  return rows as readonly Obj[];
}

function validateDestroyUndeadProjection(projection: Obj, path: string): void {
  projectionRows(projection, path).forEach((row, index) => {
    const rowPath = `${path}.rows[${index}]`;
    reqInt(row, 'clericLevel', rowPath, 1);
    reqStr(row, 'maxChallengeRating', rowPath);
    reqNum(row, 'maxChallengeRatingValue', rowPath);
  });
}

function validateBeastShapeProjection(projection: Obj, path: string): void {
  projectionRows(projection, path).forEach((row, index) => {
    const rowPath = `${path}.rows[${index}]`;
    reqInt(row, 'druidLevel', rowPath, 1);
    reqStr(row, 'maxChallengeRating', rowPath);
    reqNum(row, 'maxChallengeRatingValue', rowPath);
    reqStr(row, 'limitations', rowPath);
    reqStr(row, 'example', rowPath);
  });
}

function validateDraconicAncestryProjection(
  projection: Obj,
  path: string,
): void {
  projectionRows(projection, path).forEach((row, index) => {
    const rowPath = `${path}.rows[${index}]`;
    reqStr(row, 'dragon', rowPath);
    reqStr(row, 'damageType', rowPath);
    reqStr(row, 'breathWeapon', rowPath);
    reqStr(row, 'breathWeaponShape', rowPath);
    reqStr(row, 'breathWeaponSaveAbility', rowPath);
  });
}

function reqBoolField(parent: Obj, key: string, path: string): void {
  if (typeof parent[key] !== 'boolean') {
    throw new RulesPackError(`${path}.${key} must be a boolean`);
  }
}

function reqNullableInt(
  parent: Obj,
  key: string,
  path: string,
  min?: number,
): void {
  if (parent[key] === null) return;
  reqInt(parent, key, path, min);
}

function reqNullableStr(parent: Obj, key: string, path: string): void {
  if (parent[key] === null) return;
  reqStr(parent, key, path);
}

function validateCoinExchangeRatesProjection(
  projection: Obj,
  path: string,
): void {
  projectionRows(projection, path).forEach((row, index) => {
    const rowPath = `${path}.rows[${index}]`;
    reqStr(row, 'coin', rowPath);
    reqInt(row, 'valueInCopper', rowPath, 1);
  });
}

function validateTradeGoodsProjection(projection: Obj, path: string): void {
  projectionRows(projection, path).forEach((row, index) => {
    const rowPath = `${path}.rows[${index}]`;
    reqStr(row, 'cost', rowPath);
    reqInt(row, 'costCopper', rowPath, 0);
    reqStr(row, 'goods', rowPath);
  });
}

function validateFoodDrinkLodgingProjection(
  projection: Obj,
  path: string,
): void {
  projectionRows(projection, path).forEach((row, index) => {
    const rowPath = `${path}.rows[${index}]`;
    reqStr(row, 'item', rowPath);
    reqStr(row, 'cost', rowPath);
    reqInt(row, 'costCopper', rowPath, 0);
  });
}

function validateServicePricesProjection(projection: Obj, path: string): void {
  projectionRows(projection, path).forEach((row, index) => {
    const rowPath = `${path}.rows[${index}]`;
    reqStr(row, 'service', rowPath);
    reqStr(row, 'pay', rowPath);
    reqInt(row, 'payCopper', rowPath, 0);
    reqStr(row, 'payUnit', rowPath);
  });
}

function validateLifestyleExpensesProjection(
  projection: Obj,
  path: string,
): void {
  projectionRows(projection, path).forEach((row, index) => {
    const rowPath = `${path}.rows[${index}]`;
    reqStr(row, 'lifestyle', rowPath);
    reqStr(row, 'pricePerDay', rowPath);
    reqNullableInt(row, 'pricePerDayCopper', rowPath, 0);
    reqBoolField(row, 'isMinimum', rowPath);
  });
}

function validateLanguageOptionsProjection(
  projection: Obj,
  path: string,
): void {
  projectionRows(projection, path).forEach((row, index) => {
    const rowPath = `${path}.rows[${index}]`;
    reqStr(row, 'language', rowPath);
    reqStr(row, 'typicalSpeakers', rowPath);
    reqNullableStr(row, 'script', rowPath);
    reqStr(row, 'category', rowPath);
  });
}

function validateSubclassSpellGrantsProjection(
  projection: Obj,
  path: string,
): void {
  projectionRows(projection, path).forEach((row, index) => {
    const rowPath = `${path}.rows[${index}]`;
    reqInt(row, 'level', rowPath, 1);
    reqStrArray(row, 'spells', rowPath);
  });
}

function validateObjectArmorClassProjection(
  projection: Obj,
  path: string,
): void {
  projectionRows(projection, path).forEach((row, index) => {
    const rowPath = `${path}.rows[${index}]`;
    reqStr(row, 'substance', rowPath);
    reqStrArray(row, 'materials', rowPath);
    reqInt(row, 'armorClass', rowPath, 0);
  });
}

function validateObjectHitPointsRoll(
  parent: Obj,
  key: string,
  path: string,
): void {
  const roll = reqObj(parent, key, path);
  const rollPath = `${path}.${key}`;
  reqInt(roll, 'average', rollPath, 1);
  reqStr(roll, 'dice', rollPath);
}

function validateObjectHitPointsProjection(
  projection: Obj,
  path: string,
): void {
  projectionRows(projection, path).forEach((row, index) => {
    const rowPath = `${path}.rows[${index}]`;
    reqStr(row, 'size', rowPath);
    reqStr(row, 'sizeCategory', rowPath);
    validateObjectHitPointsRoll(row, 'fragile', rowPath);
    validateObjectHitPointsRoll(row, 'resilient', rowPath);
  });
}

function optDnd5eTableProjection(parent: Obj, path: string): void {
  const value = parent.projection;
  if (value === undefined) return;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RulesPackError(
      `${path}.projection must be an object when present`,
    );
  }
  const projection = value as Obj;
  const kind = reqStr(projection, 'kind', `${path}.projection`);
  switch (kind) {
    case 'destroyUndeadThresholds':
      validateDestroyUndeadProjection(projection, `${path}.projection`);
      return;
    case 'beastShapeOptions':
      validateBeastShapeProjection(projection, `${path}.projection`);
      return;
    case 'draconicAncestryOptions':
      validateDraconicAncestryProjection(projection, `${path}.projection`);
      return;
    case 'coinExchangeRates':
      validateCoinExchangeRatesProjection(projection, `${path}.projection`);
      return;
    case 'tradeGoodsPrices':
      validateTradeGoodsProjection(projection, `${path}.projection`);
      return;
    case 'foodDrinkLodgingPrices':
      validateFoodDrinkLodgingProjection(projection, `${path}.projection`);
      return;
    case 'servicePrices':
      validateServicePricesProjection(projection, `${path}.projection`);
      return;
    case 'lifestyleExpenses':
      validateLifestyleExpensesProjection(projection, `${path}.projection`);
      return;
    case 'languageOptions':
      validateLanguageOptionsProjection(projection, `${path}.projection`);
      return;
    case 'subclassSpellGrants':
      validateSubclassSpellGrantsProjection(projection, `${path}.projection`);
      return;
    case 'objectArmorClass':
      validateObjectArmorClassProjection(projection, `${path}.projection`);
      return;
    case 'objectHitPoints':
      validateObjectHitPointsProjection(projection, `${path}.projection`);
      return;
    default:
      throw new RulesPackError(
        `${path}.projection.kind has unsupported table projection kind "${kind}"`,
      );
  }
}

const BASE_KIND_VALIDATORS: Record<RulesRecordKind, Validator> = {
  ability: baseObjectKind,
  action: baseObjectKind,
  ancestry: baseObjectKind,
  background: baseObjectKind,
  class: baseObjectKind,
  condition: baseObjectKind,
  creature: baseObjectKind,
  equipment: baseObjectKind,
  feat: baseObjectKind,
  // Class/subclass-granted features (see ADR 0009); baseline only requires an
  // object payload, the dnd5e validator enforces grantor/level linkage.
  feature: baseObjectKind,
  hazard: baseObjectKind,
  'magic-item': baseObjectKind,
  rule: (record, path) => {
    // Rule records always carry the rule body as `text`.
    const data = dataObj(record, path);
    reqStr(data, 'text', `${path}.data`);
    optStrArray(data, 'tableRefs', `${path}.data`);
    optSkillsByAbility(data, 'skillsByAbility', `${path}.data`);
  },
  spell: baseObjectKind,
  // An abbreviated inline combat stat block (eshyra-4a7.4); baseline only
  // requires an object payload, the dnd5e validator enforces the stat-block
  // shape (permissive hit points, optional challenge rating).
  'stat-block': baseObjectKind,
  // An addressable subclass (Champion, Life domain, ...); baseline only
  // requires an object payload, the dnd5e validator enforces the parent-class
  // linkage. See ADR 0009.
  subclass: baseObjectKind,
  table: (record, path) => {
    // Tables always carry column headers and rows.
    const data = dataObj(record, path);
    const columns = reqStrArray(data, 'columns', `${path}.data`);
    if (columns.length === 0) {
      throw new RulesPackError(`${path}.data.columns must not be empty`);
    }
    const rows = data.rows;
    if (!Array.isArray(rows)) {
      throw new RulesPackError(`${path}.data.rows must be an array`);
    }
    rows.forEach((row, i) => {
      if (!Array.isArray(row)) {
        throw new RulesPackError(`${path}.data.rows[${i}] must be an array`);
      }
      if (row.length !== columns.length) {
        throw new RulesPackError(
          `${path}.data.rows[${i}] length must match data.columns length`,
        );
      }
      row.forEach((cell, j) => {
        if (isScalar(cell) === false) {
          throw new RulesPackError(
            `${path}.data.rows[${i}][${j}] must be a string, number, boolean, or null`,
          );
        }
      });
    });
  },
};

// System-specific deeper validators. These run AFTER the baseline check.

function validateDnd5eTable(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  optDnd5eTableProjection(data, `${path}.data`);
}

function validateDnd5eSpell(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqInt(data, 'level', `${path}.data`, 0);
  reqStr(data, 'school', `${path}.data`);
  reqStr(data, 'castingTime', `${path}.data`);
  reqStr(data, 'range', `${path}.data`);
  reqStr(data, 'duration', `${path}.data`);
  reqStrArray(data, 'components', `${path}.data`);
  reqStrArray(data, 'classes', `${path}.data`);
  // Optional references to structured tables embedded in this spell's source
  // description (eshyra-o4j7). The prose remains source-preserving; tableRefs
  // provides direct navigation to the separately emitted table records.
  optStrArray(data, 'tableRefs', `${path}.data`);
  optMechanics(data, 'mechanics', `${path}.data`);
}

/**
 * Validate a creature `armorClass` statline object (eshyra-o9bd.18.6.1):
 * required base `value` + verbatim `sourceText`, optional armor `source`
 * parenthetical, optional base `condition`, and optional conditional/alternate
 * `variants` (each `{ value, source?, condition }`).
 */
function reqCreatureArmorClass(parent: Obj, path: string): void {
  const ac = reqObj(parent, 'armorClass', path);
  const acPath = `${path}.armorClass`;
  reqInt(ac, 'value', acPath, 0);
  optStr(ac, 'source', acPath);
  optStr(ac, 'condition', acPath);
  reqStr(ac, 'sourceText', acPath);
  const variants = ac.variants;
  if (variants !== undefined) {
    if (!Array.isArray(variants) || variants.length === 0) {
      throw new RulesPackError(
        `${acPath}.variants must be a non-empty array when present`,
      );
    }
    variants.forEach((entry, i) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        throw new RulesPackError(`${acPath}.variants[${i}] must be an object`);
      }
      const variant = entry as Obj;
      reqInt(variant, 'value', `${acPath}.variants[${i}]`, 0);
      optStr(variant, 'source', `${acPath}.variants[${i}]`);
      reqStr(variant, 'condition', `${acPath}.variants[${i}]`);
    });
  }
}

/**
 * Validate optional form-/condition-specific speed variants
 * (eshyra-o9bd.18.6.3): each `{ condition, speed }` where `speed` is a
 * mode→feet object like the base `speed` map.
 */
function optCreatureSpeedVariants(parent: Obj, path: string): void {
  const variants = parent.speedVariants;
  if (variants === undefined) return;
  if (!Array.isArray(variants) || variants.length === 0) {
    throw new RulesPackError(
      `${path}.speedVariants must be a non-empty array when present`,
    );
  }
  variants.forEach((entry, i) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new RulesPackError(`${path}.speedVariants[${i}] must be an object`);
    }
    const variant = entry as Obj;
    reqStr(variant, 'condition', `${path}.speedVariants[${i}]`);
    reqObj(variant, 'speed', `${path}.speedVariants[${i}]`);
  });
}

function validateDnd5eCreature(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  optNonEmptyStrArray(data, 'familyPath', `${path}.data`);
  reqStr(data, 'size', `${path}.data`);
  reqStr(data, 'type', `${path}.data`);
  reqStr(data, 'alignment', `${path}.data`);
  // Structured statline objects (eshyra-o9bd.18.6): the printed AC semantics
  // (armor source, base condition, conditional/alternate values, verbatim
  // text), the printed average + dice formula for hit points (matching the
  // inline `stat-block` kind, which always modeled `hitPoints` as an object),
  // and the Speed line's hover / form-conditional parentheticals.
  reqCreatureArmorClass(data, `${path}.data`);
  const hp = reqObj(data, 'hitPoints', `${path}.data`);
  reqInt(hp, 'value', `${path}.data.hitPoints`, 0);
  reqStr(hp, 'formula', `${path}.data.hitPoints`);
  reqObj(data, 'speed', `${path}.data`);
  // `hover` is emitted only when the Speed line prints "(hover)", and only as
  // literal true — false is expressed by omission, mirroring `category`.
  if (data.hover !== undefined && data.hover !== true) {
    throw new RulesPackError(
      `${path}.data.hover must be literal true when present`,
    );
  }
  optCreatureSpeedVariants(data, `${path}.data`);
  reqStr(data, 'speedSourceText', `${path}.data`);
  reqStr(data, 'challengeRating', `${path}.data`);
  // The printed XP award from the Challenge parenthetical (eshyra-o9bd.18.5).
  // Required: every SRD creature prints one, and CR 0 is source-underdetermined
  // (0 or 10 XP) so the value cannot be derived from challengeRating alone.
  reqInt(data, 'experiencePoints', `${path}.data`, 0);
  const abilities = reqObj(data, 'abilityScores', `${path}.data`);
  for (const key of [
    'strength',
    'dexterity',
    'constitution',
    'intelligence',
    'wisdom',
    'charisma',
  ]) {
    reqInt(abilities, key, `${path}.data.abilityScores`, 1);
  }
  // Optional keyed defensive / sense fields preserved verbatim from the stat
  // block (eshyra-ez6v / eshyra-4a7.5). A creature carries only the labels the
  // SRD prints for it, so each is optional; the required header stats above are
  // unchanged (integer AC/HP, required CR).
  optStr(data, 'savingThrows', `${path}.data`);
  optStr(data, 'skills', `${path}.data`);
  optStr(data, 'damageVulnerabilities', `${path}.data`);
  optStr(data, 'damageResistances', `${path}.data`);
  optStr(data, 'damageImmunities', `${path}.data`);
  optStr(data, 'conditionImmunities', `${path}.data`);
  optStr(data, 'senses', `${path}.data`);
  optStr(data, 'languages', `${path}.data`);
  // Optional narrative body sections (eshyra-yevt / eshyra-4a7.5): arrays of
  // {name, text} entries, plus the legendary-actions object (optional intro
  // description + entries array). A creature carries only the sections it prints.
  optNamedEntryArray(data, 'traits', `${path}.data`);
  optNamedEntryArray(data, 'actions', `${path}.data`);
  optNamedEntryArray(data, 'reactions', `${path}.data`);
  const legendary = data.legendaryActions;
  if (legendary !== undefined) {
    const obj = reqObj(data, 'legendaryActions', `${path}.data`);
    optStr(obj, 'description', `${path}.data.legendaryActions`);
    optNamedEntryArray(obj, 'entries', `${path}.data.legendaryActions`);
    if (!Array.isArray(obj.entries)) {
      throw new RulesPackError(
        `${path}.data.legendaryActions.entries must be an array`,
      );
    }
  }
  // Optional source-derived flavor/description prose printed after the stat
  // block (eshyra-76b7). A single string (paragraphs joined with "\n\n"). Kept
  // separate from the mechanical action/reaction/legendary-action text so lore
  // never contaminates a stat-block entry.
  optStr(data, 'description', `${path}.data`);
  // Optional "Variant: …" sidebars that modify the creature (eshyra-70xr).
  optNamedEntryArray(data, 'variants', `${path}.data`);
  optMechanics(data, 'mechanics', `${path}.data`);
}

// An abbreviated combat stat block defined INLINE under another entry — Avatar
// of Death inside the Deck of Many Things, Giant Fly inside the Figurine of
// Wondrous Power (eshyra-4a7.4). It shares a creature's core combat shape (size,
// type, alignment, armor class, speed, ability scores) but is deliberately
// permissive where the SRD's abbreviated inline blocks diverge from a full
// creature stat block, so the strict `creature` schema stays untouched:
//   - `hitPoints` is an object, not an integer: real blocks print a fixed value
//     (`{ value: 19, formula: "3d10 + 3" }` for Giant Fly) OR a derived/textual
//     amount (`{ special: "half the hit point maximum of its summoner" }` for
//     Avatar of Death). At least one of value/formula/special must be present.
//   - `challengeRating` is OPTIONAL: Giant Fly has no Challenge line and Avatar
//     of Death prints "—", so an abbreviated block legitimately omits it.
//   - `inlineSource` records the containing item and page so the block's
//     provenance is explicit; source placement does not gate discoverability
//     (the record is name-resolvable like a creature). Containers point back at
//     the block via `magic-item` `data.statBlockRefs`.
function validateDnd5eStatBlock(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqStr(data, 'size', `${path}.data`);
  reqStr(data, 'type', `${path}.data`);
  reqStr(data, 'alignment', `${path}.data`);
  reqInt(data, 'armorClass', `${path}.data`, 0);
  const hp = reqObj(data, 'hitPoints', `${path}.data`);
  const hasValue = hp.value !== undefined;
  const hasFormula = hp.formula !== undefined;
  const hasSpecial = hp.special !== undefined;
  if (!hasValue && !hasFormula && !hasSpecial) {
    throw new RulesPackError(
      `${path}.data.hitPoints must carry at least one of value, formula, or special`,
    );
  }
  if (hasValue) reqInt(hp, 'value', `${path}.data.hitPoints`, 0);
  if (hasFormula) reqStr(hp, 'formula', `${path}.data.hitPoints`);
  if (hasSpecial) reqStr(hp, 'special', `${path}.data.hitPoints`);
  reqObj(data, 'speed', `${path}.data`);
  const abilities = reqObj(data, 'abilityScores', `${path}.data`);
  for (const key of [
    'strength',
    'dexterity',
    'constitution',
    'intelligence',
    'wisdom',
    'charisma',
  ]) {
    reqInt(abilities, key, `${path}.data.abilityScores`, 1);
  }
  // Optional keyed fields preserved verbatim from the source stat block. An
  // abbreviated block carries only the ones the SRD prints; challengeRating may
  // be the literal "—" and experiencePoints may be 0.
  optStr(data, 'savingThrows', `${path}.data`);
  optStr(data, 'skills', `${path}.data`);
  optStr(data, 'damageVulnerabilities', `${path}.data`);
  optStr(data, 'damageResistances', `${path}.data`);
  optStr(data, 'damageImmunities', `${path}.data`);
  optStr(data, 'conditionImmunities', `${path}.data`);
  optStr(data, 'senses', `${path}.data`);
  optStr(data, 'languages', `${path}.data`);
  optStr(data, 'challengeRating', `${path}.data`);
  optInt(data, 'experiencePoints', `${path}.data`, 0);
  optNamedEntryArray(data, 'traits', `${path}.data`);
  optNamedEntryArray(data, 'actions', `${path}.data`);
  optMechanics(data, 'mechanics', `${path}.data`);
  const inlineSource = reqObj(data, 'inlineSource', `${path}.data`);
  reqStr(inlineSource, 'containingItem', `${path}.data.inlineSource`);
  reqInt(inlineSource, 'page', `${path}.data.inlineSource`, 1);
}

function validateDnd5eClass(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqInt(data, 'hitDie', `${path}.data`, 1);
  reqStrArray(data, 'primaryAbilities', `${path}.data`);
  reqStrArray(data, 'savingThrowProficiencies', `${path}.data`);
  reqStrArray(data, 'armorProficiencies', `${path}.data`);
  reqStrArray(data, 'weaponProficiencies', `${path}.data`);
  // Optional progression/options modeling (eshyra-4a7.6). Absent on a minimal
  // class record; present once the importer parses tools/skills/equipment and
  // derives the structured level progression.
  optStrArray(data, 'toolProficiencies', `${path}.data`);
  optChoiceArray(data, 'toolProficiencyChoices', `${path}.data`);
  optChoiceArray(data, 'skillChoices', `${path}.data`);
  optStartingEquipment(data, 'startingEquipment', `${path}.data`);
  optProficiencyNotes(data, 'proficiencyNotes', `${path}.data`);
  optStr(data, 'progressionTableRef', `${path}.data`);
  optStrArray(data, 'features', `${path}.data`);
  optProgression(data, 'progression', `${path}.data`);
  optStr(data, 'spellcastingAbility', `${path}.data`);
  optSpellPreparation(data, 'spellPreparation', `${path}.data`);
}

// The closed vocabulary of named SRD gameplay-relevant equipment groups
// (eshyra-erf5.3.2). The four focus/symbol/instrument groups match the
// `StartingEquipmentFilterSelect` filter vocabulary exactly; artisan-tools and
// gaming-set have no dedicated filter yet but are equally reviewed groups.
const EQUIPMENT_GROUPS: ReadonlySet<string> = new Set([
  'arcane-focus',
  'druidic-focus',
  'holy-symbol',
  'artisans-tools',
  'gaming-set',
  'musical-instrument',
]);

// How (if at all) the Dexterity modifier applies to a non-shield armor's base
// AC (eshyra-rtgi): light armor is unlimited, medium is capped (SRD 5.1 caps
// every medium armor at +2), heavy applies none.
const ARMOR_DEX_MODIFIER_KINDS: ReadonlySet<string> = new Set([
  'none',
  'unlimited',
  'capped',
]);

/**
 * Equipment is otherwise schema-permissive (varied category fields); this
 * validator only enforces the typed pack `contents` when present (eshyra-ngcj.4):
 * a non-empty list of line items, each with a positive `quantity`, a `name`, and
 * an optional `equipment:` `ref` / `detail`.
 */
function validateDnd5eEquipment(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  const contents = data.contents;
  if (contents !== undefined) {
    if (!Array.isArray(contents) || contents.length === 0) {
      throw new RulesPackError(
        `${path}.data.contents must be a non-empty array when present`,
      );
    }
    contents.forEach((entry, i) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        throw new RulesPackError(
          `${path}.data.contents[${i}] must be an object`,
        );
      }
      const content = entry as Obj;
      reqStr(content, 'name', `${path}.data.contents[${i}]`);
      reqInt(content, 'quantity', `${path}.data.contents[${i}]`, 1);
      optStr(content, 'ref', `${path}.data.contents[${i}]`);
      optStr(content, 'detail', `${path}.data.contents[${i}]`);
    });
  }
  // Every weapon carries its SRD proficiency category (simple/martial) and
  // engagement range (melee/ranged) so class proficiencies and
  // starting-equipment filters can resolve deterministically (eshyra-erf5.3.1).
  if (data.category === 'weapon') {
    const weaponCategory = data.weaponCategory;
    if (
      typeof weaponCategory !== 'string' ||
      !WEAPON_CATEGORIES.has(weaponCategory)
    ) {
      throw new RulesPackError(
        `${path}.data.weaponCategory must be "simple" or "martial"`,
      );
    }
    const weaponRange = data.weaponRange;
    if (typeof weaponRange !== 'string' || !WEAPON_RANGES.has(weaponRange)) {
      throw new RulesPackError(
        `${path}.data.weaponRange must be "melee" or "ranged"`,
      );
    }
  }
  if (data.equipmentGroup !== undefined) {
    if (
      typeof data.equipmentGroup !== 'string' ||
      !EQUIPMENT_GROUPS.has(data.equipmentGroup)
    ) {
      throw new RulesPackError(
        `${path}.data.equipmentGroup must be one of ${[...EQUIPMENT_GROUPS].join(', ')}`,
      );
    }
  }
  // Deterministic armor-calculation data (eshyra-rtgi): a shield's
  // `armorClass` is an add-on bonus (it has no base AC of its own — it adds
  // to whatever AC the wearer already has); every other armor type carries a
  // base AC plus how (if at all) the Dexterity modifier applies.
  if (data.category === 'armor') {
    const armorClass = reqObj(data, 'armorClass', `${path}.data`);
    if (data.armorType === 'shield') {
      reqInt(armorClass, 'bonus', `${path}.data.armorClass`, 1);
    } else {
      reqInt(armorClass, 'base', `${path}.data.armorClass`, 1);
      const dexModifier = reqStr(
        armorClass,
        'dexModifier',
        `${path}.data.armorClass`,
      );
      if (!ARMOR_DEX_MODIFIER_KINDS.has(dexModifier)) {
        throw new RulesPackError(
          `${path}.data.armorClass.dexModifier must be one of ${[...ARMOR_DEX_MODIFIER_KINDS].join(', ')}`,
        );
      }
      if (dexModifier === 'capped') {
        reqInt(armorClass, 'dexModifierCap', `${path}.data.armorClass`, 0);
      } else if (armorClass.dexModifierCap !== undefined) {
        throw new RulesPackError(
          `${path}.data.armorClass.dexModifierCap is only valid when dexModifier is "capped"`,
        );
      }
    }
  }
}

function validateDnd5eCondition(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqStr(data, 'description', `${path}.data`);
  optStrArray(data, 'effects', `${path}.data`);
  optMechanics(data, 'mechanics', `${path}.data`);
}

function validateDnd5eFeat(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqStr(data, 'description', `${path}.data`);
  optStr(data, 'prerequisites', `${path}.data`);
}

// A `feature` is class- or subclass-granted (Action Surge, Channel Divinity,
// Rage, ...), distinct from the player-selected `feat`. Per ADR 0009 it links
// to its grantor through `data.source` (the granting class/subclass record key)
// and the `data.level` at which it is gained; the feature name rides on the
// record. Parent linkage lives in `data`, never in `overrides`.
function validateDnd5eFeature(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqStr(data, 'description', `${path}.data`);
  reqStr(data, 'source', `${path}.data`);
  reqInt(data, 'level', `${path}.data`, 1);
  // Optional references to `table` records this feature owns (eshyra-4a7.6) —
  // e.g. feature:cleric:destroy-undead -> table:destroy-undead,
  // feature:druid:wild-shape -> table:beast-shapes — so the table rows live in
  // one reviewed `table` record instead of flattened into the feature prose.
  optStrArray(data, 'tableRefs', `${path}.data`);
  optMechanics(data, 'mechanics', `${path}.data`);
  // Optional structured player choices the feature requires at creation/level-up
  // (eshyra-o9bd.9): Fighting Style, subclass selection, Metamagic, etc.
  optFeatureChoiceArray(data, 'choices', `${path}.data`);
}

// An `ancestry` (race/subrace per ADR 0005) carries its racial traits as a
// nested `{ name, text }` array. A trait that chooses from a printed option
// table (the Dragonborn "Draconic Ancestry" table) additionally carries
// `tableRefs` linking to the emitted `table` record(s) so the option rows are
// reachable as structured data, not prose only (eshyra-4a7.7; mirrors
// `feature.data.tableRefs`).
const CREATION_CHOICE_CATEGORIES: ReadonlySet<string> = new Set([
  'draconicAncestry',
  'tool',
  'skill',
  'cantrip',
  'language',
  'personalityTrait',
  'ideal',
  'bond',
  'flaw',
]);

/**
 * Validate ancestry/background creation choices (eshyra-ngcj.5): each entry has
 * a kebab `id`, a closed-vocabulary `category`, a `prompt`, a positive `choose`,
 * a `sourceText`, and optional discrete `from` / `tableRef` / `roll`.
 *
 * `sourceText` is a source-cited display label, not guaranteed verbatim SRD
 * prose: for the rolled-table categories (`personalityTrait`/`ideal`/`bond`/
 * `flaw`) it is a constructed "<table name> (<die>)." pointer (e.g. "Acolyte
 * Bonds (d6)."), since the SRD prose there is the referenced table itself.
 * See `CreationChoice.sourceText` in `character/srdCreationChoices.ts` and
 * eshyra-o9bd.18.8.7.
 */
function optCreationChoices(parent: Obj, key: string, path: string): void {
  const entries = objArray(parent, key, path);
  if (entries === undefined) return;
  if (entries.length === 0) {
    throw new RulesPackError(`${path}.${key} must be non-empty when present`);
  }
  entries.forEach((entry, i) => {
    const cpath = `${path}.${key}[${i}]`;
    reqStr(entry, 'id', cpath);
    const category = reqStr(entry, 'category', cpath);
    if (!CREATION_CHOICE_CATEGORIES.has(category)) {
      throw new RulesPackError(
        `${cpath}.category must be one of ${[...CREATION_CHOICE_CATEGORIES].join(', ')}`,
      );
    }
    reqStr(entry, 'prompt', cpath);
    reqInt(entry, 'choose', cpath, 1);
    reqStr(entry, 'sourceText', cpath);
    optStrArray(entry, 'from', cpath);
    optStr(entry, 'tableRef', cpath);
    optStr(entry, 'roll', cpath);
  });
}

/**
 * Validate a background equipment-grant array (eshyra-ngcj.5): the same line-item
 * shape as equipment-pack contents — positive `quantity`, a `name`, optional
 * `ref` / `detail`.
 */
function optEquipmentGrantArray(parent: Obj, key: string, path: string): void {
  const entries = objArray(parent, key, path);
  if (entries === undefined) return;
  if (entries.length === 0) {
    throw new RulesPackError(`${path}.${key} must be non-empty when present`);
  }
  entries.forEach((entry, i) => {
    const gpath = `${path}.${key}[${i}]`;
    reqStr(entry, 'name', gpath);
    reqInt(entry, 'quantity', gpath, 1);
    optStr(entry, 'ref', gpath);
    optStr(entry, 'detail', gpath);
    // Optional open filter (e.g. a holy symbol), same closed vocabulary as a
    // starting-equipment filter grant (eshyra-ngcj.5).
    if (entry.select !== undefined) {
      const select = entry.select;
      if (
        typeof select !== 'string' ||
        !STARTING_EQUIPMENT_FILTER_SELECTS.has(select)
      ) {
        throw new RulesPackError(
          `${gpath}.select must be one of ${[...STARTING_EQUIPMENT_FILTER_SELECTS].join(', ')}`,
        );
      }
    }
  });
}

function validateDnd5eAncestry(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  optAbilityScoreIncreaseArray(data, 'abilityScoreIncreases', `${path}.data`);
  optLanguageGrantArray(data, 'languages', `${path}.data`);
  optCreationChoices(data, 'choices', `${path}.data`);
  const traits = objArray(data, 'traits', `${path}.data`);
  if (traits !== undefined) {
    traits.forEach((trait, i) => {
      const traitPath = `${path}.data.traits[${i}]`;
      reqStr(trait, 'name', traitPath);
      reqStr(trait, 'text', traitPath);
      optStrArray(trait, 'tableRefs', traitPath);
      optMechanics(trait, 'mechanics', traitPath);
    });
  }
}

// A `subclass` (Champion, Life domain, School of Evocation, ...) is its own
// addressable kind so the DM can lookup_rules it by name. Per ADR 0009 it links
// to its parent base class through `data.parentClass` (the parent class record
// key) — data-side linkage only, never `overrides`. A subclass validates only
// the fields it carries (parentClass, description, optional granted-feature
// references); base-class scalars like hitDie/proficiencies stay on the `class`
// record and are NOT required here.
function validateDnd5eSubclass(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqStr(data, 'parentClass', `${path}.data`);
  reqStr(data, 'description', `${path}.data`);
  // Optional named prose sections (e.g. "Tenets of Devotion" on Oath of
  // Devotion — eshyra-citg): sub-subsection headings whose body prose belongs
  // on the subclass but is not a granted feature or spell table.
  optNamedEntryArray(data, 'sections', `${path}.data`);
  optStrArray(data, 'features', `${path}.data`);
  // Optional level-grouped feature projection (eshyra-vk23.5): one row per
  // distinct grant level in ascending order, each carrying the subclass-feature
  // refs unlocked at that level. Lets a consumer read the progression order and
  // grant level without resolving every feature ref.
  optFeaturesByLevel(data, 'featuresByLevel', `${path}.data`);
  // Optional references to the subclass's `table` records (eshyra-4a7.6):
  // expanded/domain/oath spell tables and any progression tables, linked
  // rather than duplicated into the description.
  optStrArray(data, 'spellTableRefs', `${path}.data`);
  optStrArray(data, 'progressionTableRefs', `${path}.data`);
}

// A `background` (Acolyte, ...) grants skill proficiencies, optionally tool
// proficiencies / languages / an equipment package, and exactly one background
// feature. The feature is a NESTED `{ name, text }` object on the background
// record, not a top-level `feature` record — `validateDnd5eFeature` requires a
// class/subclass grantor key and an integer grant level, neither of which a
// background feature has (eshyra-0m9.17 decision; mirrors how ancestry traits
// nest in their ancestry record). The background's suggested-characteristics
// roll tables are separate `table` records; only their intro prose rides here.
function validateDnd5eBackground(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqStr(data, 'description', `${path}.data`);
  reqStrArray(data, 'skillProficiencies', `${path}.data`);
  optStrArray(data, 'toolProficiencies', `${path}.data`);
  optLanguageGrantArray(data, 'languages', `${path}.data`);
  optStr(data, 'equipment', `${path}.data`);
  const feature = reqObj(data, 'feature', `${path}.data`);
  reqStr(feature, 'name', `${path}.data.feature`);
  reqStr(feature, 'text', `${path}.data.feature`);
  optMechanics(feature, 'mechanics', `${path}.data.feature`);
  optStr(data, 'suggestedCharacteristics', `${path}.data`);
  // Optional links to the background's suggested-characteristics roll tables
  // (eshyra-o9bd.8.2); most backgrounds have none.
  optStrArray(data, 'tableRefs', `${path}.data`);
  // Structured creation choices + equipment grants (eshyra-ngcj.5).
  optCreationChoices(data, 'choices', `${path}.data`);
  optEquipmentGrantArray(data, 'equipmentGrants', `${path}.data`);
}

function validateDnd5eHazard(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  optStr(data, 'category', `${path}.data`);
  optStr(data, 'trapType', `${path}.data`);
  optStr(data, 'poisonType', `${path}.data`);
  reqStr(data, 'description', `${path}.data`);
  const category = data.category;
  if (
    category !== undefined &&
    category !== 'trap' &&
    category !== 'disease' &&
    category !== 'poison'
  ) {
    throw new RulesPackError(
      `${path}.data.category must be "trap", "disease", or "poison" when present`,
    );
  }
  const trapType = data.trapType;
  if (
    trapType !== undefined &&
    trapType !== 'mechanical' &&
    trapType !== 'magic'
  ) {
    throw new RulesPackError(
      `${path}.data.trapType must be "mechanical" or "magic" when present`,
    );
  }
  if (trapType !== undefined && category !== 'trap') {
    throw new RulesPackError(
      `${path}.data.category must be "trap" when trapType is present`,
    );
  }
  if (category === 'trap' && trapType === undefined) {
    throw new RulesPackError(
      `${path}.data.trapType must be present when category is "trap"`,
    );
  }
  if (data.poisonType !== undefined && category !== 'poison') {
    throw new RulesPackError(
      `${path}.data.category must be "poison" when poisonType is present`,
    );
  }
  optMechanics(data, 'mechanics', `${path}.data`);
}

function validateDnd5eAction(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqStr(data, 'description', `${path}.data`);
  optMechanics(data, 'mechanics', `${path}.data`);
}

function validateDnd5eMagicItem(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqStr(data, 'itemType', `${path}.data`);
  reqStr(data, 'rarity', `${path}.data`);
  const requiresAttunement = data.requiresAttunement;
  if (typeof requiresAttunement !== 'boolean') {
    throw new RulesPackError(
      `${path}.data.requiresAttunement must be a boolean`,
    );
  }
  optStr(data, 'attunementRequirement', `${path}.data`);
  reqStr(data, 'description', `${path}.data`);
  const variants = data.variants;
  if (variants !== undefined) {
    if (!Array.isArray(variants)) {
      throw new RulesPackError(
        `${path}.data.variants must be an array when present`,
      );
    }
    variants.forEach((item, index) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw new RulesPackError(
          `${path}.data.variants[${index}] must be an object`,
        );
      }
      const variant = item as Obj;
      reqStr(variant, 'name', `${path}.data.variants[${index}]`);
      reqStr(variant, 'rarity', `${path}.data.variants[${index}]`);
      reqStr(variant, 'text', `${path}.data.variants[${index}]`);
    });
  }
  // An item that defines an inline combat stat block (Deck of Many Things ->
  // Avatar of Death) points at the emitted `stat-block` record(s) it summons or
  // becomes via `statBlockRefs` (eshyra-4a7.4). Optional: most items have none.
  optStrArray(data, 'statBlockRefs', `${path}.data`);
  // Structured passive-modifier projection (eshyra-o9bd.18.7.7.5, M2+M3):
  // reuses the shared `mechanics.effects` vocabulary already validated for
  // creatures/spells/features/conditions. Most magic items carry no
  // `mechanics` yet — the charge/combat-bonus/state-machine/curse clause
  // families owned by sibling beads are out of scope here.
  optMechanics(data, 'mechanics', `${path}.data`);
}

function validatePf2eAncestry(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqInt(data, 'hitPoints', `${path}.data`, 1);
  reqStr(data, 'size', `${path}.data`);
  reqInt(data, 'speed', `${path}.data`, 0);
  reqStrArray(data, 'traits', `${path}.data`);
  reqObj(data, 'languages', `${path}.data`);
  reqObj(data, 'abilityBoosts', `${path}.data`);
}

function validatePf2eBackground(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqObj(data, 'abilityBoosts', `${path}.data`);
  reqStrArray(data, 'skillTraining', `${path}.data`);
  reqStr(data, 'skillFeat', `${path}.data`);
  optStr(data, 'loreTraining', `${path}.data`);
}

function validatePf2eClass(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqObj(data, 'keyAbility', `${path}.data`);
  reqInt(data, 'hitPointsPerLevel', `${path}.data`, 1);
  reqObj(data, 'initialProficiencies', `${path}.data`);
  reqObj(data, 'skills', `${path}.data`);
  reqObj(data, 'classFeats', `${path}.data`);
}

function validatePf2eFeat(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqInt(data, 'level', `${path}.data`, 1);
  reqStrArray(data, 'traits', `${path}.data`);
  // actionCost may be a string ('reaction'), null (passive), or an integer
  // (number of actions). Validate the shape rather than constrain the value.
  const actionCost = data.actionCost;
  if (
    actionCost !== null &&
    typeof actionCost !== 'string' &&
    typeof actionCost !== 'number'
  ) {
    throw new RulesPackError(
      `${path}.data.actionCost must be null, a string, or a number`,
    );
  }
  reqStr(data, 'effect', `${path}.data`);
  optStr(data, 'trigger', `${path}.data`);
}

function validatePf2eEquipment(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqStr(data, 'category', `${path}.data`);
  reqStr(data, 'group', `${path}.data`);
  reqObj(data, 'damage', `${path}.data`);
  reqInt(data, 'bulk', `${path}.data`, 0);
  reqInt(data, 'hands', `${path}.data`, 1);
  reqStrArray(data, 'traits', `${path}.data`);
  reqObj(data, 'price', `${path}.data`);
}

function validatePf2eSpell(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqInt(data, 'rank', `${path}.data`, 0);
  reqStrArray(data, 'traditions', `${path}.data`);
  reqStrArray(data, 'traits', `${path}.data`);
  reqInt(data, 'castingActions', `${path}.data`, 0);
  reqStr(data, 'range', `${path}.data`);
  reqStr(data, 'duration', `${path}.data`);
  optStr(data, 'area', `${path}.data`);
  optBool(data, 'cantrip', `${path}.data`);
  reqStr(data, 'description', `${path}.data`);
}

const SYSTEM_KIND_VALIDATORS: Record<
  string,
  Partial<Record<RulesRecordKind, Validator>>
> = {
  'dnd5e-srd': {
    spell: validateDnd5eSpell,
    creature: validateDnd5eCreature,
    ancestry: validateDnd5eAncestry,
    background: validateDnd5eBackground,
    class: validateDnd5eClass,
    condition: validateDnd5eCondition,
    equipment: validateDnd5eEquipment,
    feat: validateDnd5eFeat,
    feature: validateDnd5eFeature,
    subclass: validateDnd5eSubclass,
    hazard: validateDnd5eHazard,
    action: validateDnd5eAction,
    'magic-item': validateDnd5eMagicItem,
    'stat-block': validateDnd5eStatBlock,
    table: validateDnd5eTable,
  },
  'pathfinder2e-remaster': {
    ancestry: validatePf2eAncestry,
    background: validatePf2eBackground,
    class: validatePf2eClass,
    feat: validatePf2eFeat,
    equipment: validatePf2eEquipment,
    spell: validatePf2eSpell,
  },
};

/**
 * Validate that a rules record's `data` payload matches the schema for its
 * kind (and, if registered, its system+kind combination). Throws
 * `RulesPackError` on the first mismatch.
 */
export function validateRecordKindSchema(
  record: RulesRecord,
  path: string,
): void {
  BASE_KIND_VALIDATORS[record.kind](record, path);
  const systemValidator =
    SYSTEM_KIND_VALIDATORS[record.systemId]?.[record.kind];
  systemValidator?.(record, path);
}
