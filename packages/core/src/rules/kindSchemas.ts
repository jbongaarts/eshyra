// Kind-specific schema validation for rules records.
//
// Every record kind has a baseline validator that all systems share. Where a
// system supplies structured data for a given kind (today: `dnd5e-srd` and
// `pathfinder2e-remaster`), a system-specific validator layers additional
// shape checks on top. Unregistered (system, kind) pairs fall through to the
// baseline check, so a new importer can ship records before its deeper schemas
// exist.

import type { RulesRecord, RulesRecordKind } from './types.js';
import { RulesPackError } from './types.js';

type Obj = Record<string, unknown>;
type Validator = (record: RulesRecord, path: string) => void;
type Scalar = string | number | boolean | null;

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

// Optional starting-equipment block on a class: verbatim `text` plus optional
// per-line `entries` (the bulleted options).
function optStartingEquipment(parent: Obj, key: string, path: string): void {
  const value = parent[key];
  if (value === undefined) return;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RulesPackError(`${path}.${key} must be an object when present`);
  }
  const obj = value as Obj;
  reqStr(obj, 'text', `${path}.${key}`);
  optStrArray(obj, 'entries', `${path}.${key}`);
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

// Baseline per-kind validators. Every record of the kind must satisfy these
// minimum shape constraints. The shared rule is `data` is a non-null object
// and `description` (if present) is a non-empty string; some kinds add a few
// more cross-system minimums.

function baseObjectKind(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  optStr(data, 'description', `${path}.data`);
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
}

function validateDnd5eCreature(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
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
  // Optional "Variant: …" sidebars that modify the creature (eshyra-70xr).
  optNamedEntryArray(data, 'variants', `${path}.data`);
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
}

// An `ancestry` (race/subrace per ADR 0005) carries its racial traits as a
// nested `{ name, text }` array. A trait that chooses from a printed option
// table (the Dragonborn "Draconic Ancestry" table) additionally carries
// `tableRefs` linking to the emitted `table` record(s) so the option rows are
// reachable as structured data, not prose only (eshyra-4a7.7; mirrors
// `feature.data.tableRefs`).
function validateDnd5eAncestry(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  const traits = objArray(data, 'traits', `${path}.data`);
  if (traits !== undefined) {
    traits.forEach((trait, i) => {
      const traitPath = `${path}.data.traits[${i}]`;
      reqStr(trait, 'name', traitPath);
      reqStr(trait, 'text', traitPath);
      optStrArray(trait, 'tableRefs', traitPath);
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
  optStr(data, 'languages', `${path}.data`);
  optStr(data, 'equipment', `${path}.data`);
  const feature = reqObj(data, 'feature', `${path}.data`);
  reqStr(feature, 'name', `${path}.data.feature`);
  reqStr(feature, 'text', `${path}.data.feature`);
  optStr(data, 'suggestedCharacteristics', `${path}.data`);
}

function validateDnd5eHazard(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqStr(data, 'description', `${path}.data`);
}

function validateDnd5eAction(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqStr(data, 'description', `${path}.data`);
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
    feat: validateDnd5eFeat,
    feature: validateDnd5eFeature,
    subclass: validateDnd5eSubclass,
    hazard: validateDnd5eHazard,
    action: validateDnd5eAction,
    'magic-item': validateDnd5eMagicItem,
    'stat-block': validateDnd5eStatBlock,
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
