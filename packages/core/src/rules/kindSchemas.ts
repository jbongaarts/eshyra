// Kind-specific schema validation for rules records.
//
// Every record kind has a baseline validator that all systems share. Where a
// system supplies structured data for a given kind (today: `dnd5e-srd` and
// `pathfinder2e-remaster`), a system-specific validator layers additional
// shape checks on top. Unregistered (system, kind) pairs fall through to the
// baseline check, so a new importer can ship records before its deeper schemas
// exist.

import {
  FEATURE_CHOICE_CATEGORIES,
  isFeatureChoiceCategory,
} from './featureChoices.js';
import type { RulesRecord, RulesRecordKind } from './types.js';
import { RulesPackError } from './types.js';

type Obj = Record<string, unknown>;
type Validator = (record: RulesRecord, path: string) => void;
type Scalar = string | number | boolean | null;

const CONDITION_RELATIONS = new Set([
  'applies',
  'removes',
  'immune',
  'advantage',
  'disadvantage',
  'exclusion',
  'mention',
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
// `level` (class-scoped minimum level), `pactBoon` (required Pact Boon ref), or
// `cantrip` (required spell ref). The verbatim `prerequisite` prose is retained
// alongside; this is its machine-readable parse.
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

function optMechanics(parent: Obj, key: string, path: string): void {
  const value = parent[key];
  if (value === undefined) return;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RulesPackError(`${path}.${key} must be an object when present`);
  }
  const mechanics = value as Obj;
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
  for (const arrayKey of [
    'attacks',
    'saves',
    'damage',
    'resources',
    'effects',
    'hitDamage',
  ]) {
    const entries = objArray(mechanics, arrayKey, `${path}.${key}`);
    if (entries === undefined) continue;
    if (entries.length === 0) {
      throw new RulesPackError(
        `${path}.${key}.${arrayKey} must not be empty when present`,
      );
    }
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
    optStr(scaling as Obj, 'sourceText', `${path}.${key}.scaling`);
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

function validateDnd5eCreature(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  optNonEmptyStrArray(data, 'familyPath', `${path}.data`);
  reqStr(data, 'size', `${path}.data`);
  reqStr(data, 'type', `${path}.data`);
  reqStr(data, 'alignment', `${path}.data`);
  reqInt(data, 'armorClass', `${path}.data`, 0);
  reqInt(data, 'hitPoints', `${path}.data`, 0);
  reqObj(data, 'speed', `${path}.data`);
  reqStr(data, 'challengeRating', `${path}.data`);
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
}

function validateDnd5eCondition(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqStr(data, 'description', `${path}.data`);
  optStrArray(data, 'effects', `${path}.data`);
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
