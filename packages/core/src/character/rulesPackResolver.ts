/**
 * Character-creation resolver over the runtime generated rules pack (ADR 0013,
 * eshyra-b69j.3 / eshyra-x50w).
 *
 * Character creation needs to validate class, spell, and ancestry choices and
 * read the mechanical fields those choices imply (a class hit die, a spell's
 * legal classes). Historically that ran against the hand-authored
 * `SRD_CATALOG` seed, which only carried a single Fighter/Goblin/Fire-Bolt
 * sample. This resolver is the seam that moves that validation onto the
 * importer-generated SRD pack — the audited runtime rules truth — so every SRD
 * class, spell, and ancestry is available and stays in sync with the pack.
 *
 * The resolver hides two things from the wizard:
 *   1. the generated-pack lookup mechanics (resolve a stack, query by ref/name);
 *   2. the `data: unknown` shape on generated records, narrowed here once via
 *      typed guards so callers receive concrete, typed fields.
 *
 * Name matching is centralised here: callers pass a display name ("Fighter",
 * "Fire Bolt", "Wood Elf") or a canonical record key ("class:fighter"); they
 * never need to know internal ids. Ambiguous names (legitimately repeated
 * within a kind in the audited SRD) surface candidate keys for disambiguation
 * rather than silently picking one.
 */

import { getBundledDnd5eSrdPack } from '../rules/bundledSrdPack.js';
import { lookupRulesRecord, type RulesLookupResult } from '../rules/lookup.js';
import { type ResolvedRulesStack, resolveRulesStack } from '../rules/stack.js';
import type { RulesRecordKind } from '../rules/types.js';

/**
 * A source-backed choice from a generated record: the verbatim `text` plus the
 * structured `choose` count and `from` option list the importer parsed out of
 * it (a class skill/tool proficiency choice). Mirrors the pack's choice shape
 * (eshyra-4a7.6).
 */
export interface ResolvedChoiceSpec {
  readonly text: string;
  readonly choose?: number;
  readonly from?: readonly string[];
  readonly any?: boolean;
}

/**
 * A class's starting equipment: the verbatim block `text` plus the per-line
 * `entries` (the bulleted "(a) … or (b) …" options). The entries are NOT yet
 * parsed into selectable option groups — see eshyra-b69j.12's follow-up beads.
 */
export interface ResolvedStartingEquipment {
  readonly text: string;
  readonly entries: readonly string[];
}

/** Structured spellcasting counts on a class's level row (from the progression table). */
export interface ResolvedLevelSpellcasting {
  readonly cantripsKnown?: number;
  readonly spellsKnown?: number;
  /** Spell slots by spell level, e.g. `{ "1": 2 }` at level 1. */
  readonly slots?: Readonly<Record<string, number>>;
}

/** The structured slice of a class's level-1 progression row. */
export interface ResolvedClassLevel1 {
  /** Feature record refs granted at level 1 (e.g. `feature:wizard:spellcasting`). */
  readonly featureRefs: readonly string[];
  /** Level-1 spellcasting counts, present only for spellcasting classes. */
  readonly spellcasting?: ResolvedLevelSpellcasting;
}

/** Class fields character creation reads from a generated `class` record. */
export interface ResolvedClassData {
  readonly key: string;
  readonly name: string;
  readonly hitDie: number;
  readonly primaryAbilities: readonly string[];
  readonly savingThrowProficiencies: readonly string[];
  /** Fixed armor proficiencies, when the pack record carries them. */
  readonly armorProficiencies?: readonly string[];
  /** Fixed weapon proficiencies, when present. */
  readonly weaponProficiencies?: readonly string[];
  /** Fixed tool proficiencies, when present. */
  readonly toolProficiencies?: readonly string[];
  /** Skill proficiency choices ("choose two from …"). */
  readonly skillChoices?: readonly ResolvedChoiceSpec[];
  /** Tool proficiency choices, when the class grants any. */
  readonly toolProficiencyChoices?: readonly ResolvedChoiceSpec[];
  /** Starting equipment block (verbatim text + per-line entries). */
  readonly startingEquipment?: ResolvedStartingEquipment;
  /** Structured level-1 progression slice (features + spellcasting counts). */
  readonly level1?: ResolvedClassLevel1;
}

/** Spell fields character creation reads from a generated `spell` record. */
export interface ResolvedSpellData {
  readonly key: string;
  readonly name: string;
  readonly level: number;
  readonly classes: readonly string[];
}

/** A racial trait as stored on an ancestry record: a name and verbatim prose. */
export interface ResolvedAncestryTrait {
  readonly name: string;
  readonly text: string;
}

/** Ancestry fields character creation reads from a generated `ancestry` record. */
export interface ResolvedAncestryData {
  readonly key: string;
  readonly name: string;
  readonly size?: string;
  readonly speed?: number;
  /**
   * Racial traits as `{ name, text }`. The "Ability Score Increase" trait's
   * bonus is currently prose only (e.g. "Your Dexterity score increases by 2");
   * structured ability increases are tracked in eshyra-b69j.12's follow-up.
   */
  readonly traits?: readonly ResolvedAncestryTrait[];
}

/** Background fields character creation reads from a generated `background` record. */
export interface ResolvedBackgroundData {
  readonly key: string;
  readonly name: string;
  readonly skillProficiencies: readonly string[];
  readonly toolProficiencies?: readonly string[];
  /** Verbatim language grant (e.g. "Two of your choice"); not yet structured. */
  readonly languages?: string;
  /** Verbatim equipment package prose; not yet structured into items. */
  readonly equipment?: string;
}

/**
 * Outcome of resolving one character-creation choice. `malformed` means the
 * record exists but its generated `data` did not match the expected shape — a
 * pack/importer defect the caller should surface, not a user input error.
 */
export type CharacterResolution<T> =
  | { readonly ok: true; readonly record: T }
  | {
      readonly ok: false;
      readonly code: 'not_found' | 'ambiguous' | 'malformed';
      readonly message: string;
      readonly candidateKeys?: readonly string[];
    };

/**
 * Thin adapter over a resolved rules stack that resolves character-creation
 * choices by display name or canonical key and returns typed record data.
 */
export interface RulesPackCharacterResolver {
  resolveClass(nameOrRef: string): CharacterResolution<ResolvedClassData>;
  resolveSpell(nameOrRef: string): CharacterResolution<ResolvedSpellData>;
  resolveAncestry(nameOrRef: string): CharacterResolution<ResolvedAncestryData>;
  resolveBackground(
    nameOrRef: string,
  ): CharacterResolution<ResolvedBackgroundData>;
  /**
   * Every well-formed `class` record in the stack, in canonical-key order.
   * Drives ability-score-driven class recommendations (eshyra-b69j.7), which
   * need to score the whole class list rather than resolve a single name.
   * Malformed records (failing the generated-data shape guard) are skipped.
   */
  listClasses(): readonly ResolvedClassData[];
  /**
   * Every well-formed `ancestry` record in the stack, in canonical-key order.
   * Drives the guided-creation `list`/`search` commands (eshyra-b69j.10).
   */
  listAncestries(): readonly ResolvedAncestryData[];
  /** Every well-formed `background` record, in canonical-key order. */
  listBackgrounds(): readonly ResolvedBackgroundData[];
  /** Every well-formed `spell` record, in canonical-key order. */
  listSpells(): readonly ResolvedSpellData[];
}

/** Build a resolver over an already-resolved rules stack (e.g. for tests). */
export function createRulesPackCharacterResolver(
  stack: ResolvedRulesStack,
): RulesPackCharacterResolver {
  return {
    resolveClass: (nameOrRef) => resolveClass(stack, nameOrRef),
    resolveSpell: (nameOrRef) => resolveSpell(stack, nameOrRef),
    resolveAncestry: (nameOrRef) => resolveAncestry(stack, nameOrRef),
    resolveBackground: (nameOrRef) => resolveBackground(stack, nameOrRef),
    listClasses: () => listClasses(stack),
    listAncestries: () =>
      listByKind(stack, 'ancestry', (key) => resolveAncestry(stack, key)),
    listBackgrounds: () =>
      listByKind(stack, 'background', (key) => resolveBackground(stack, key)),
    listSpells: () =>
      listByKind(stack, 'spell', (key) => resolveSpell(stack, key)),
  };
}

/**
 * Every record of a kind that resolves cleanly (passing its generated-data
 * guard), built through the same per-kind resolver used for single lookups so
 * listing and resolving can never diverge, sorted by canonical key.
 */
function listByKind<T extends { readonly key: string }>(
  stack: ResolvedRulesStack,
  kind: RulesRecordKind,
  resolveOne: (key: string) => CharacterResolution<T>,
): readonly T[] {
  const index = stack.recordsByKind.get(kind);
  if (index === undefined) {
    return [];
  }
  const records: T[] = [];
  for (const { record } of index.byKey.values()) {
    const result = resolveOne(record.key);
    if (result.ok) {
      records.push(result.record);
    }
  }
  return records.sort((left, right) => left.key.localeCompare(right.key));
}

let cachedResolver: RulesPackCharacterResolver | undefined;

/**
 * Resolver over the bundled D&D 5e SRD 5.1 pack. The stack is resolved once and
 * cached, reusing the pack cache in `bundledSrdPack.ts`.
 */
export function getBundledDnd5eCharacterResolver(): RulesPackCharacterResolver {
  cachedResolver ??= createRulesPackCharacterResolver(
    resolveRulesStack({ base: getBundledDnd5eSrdPack() }),
  );
  return cachedResolver;
}

function resolveClass(
  stack: ResolvedRulesStack,
  nameOrRef: string,
): CharacterResolution<ResolvedClassData> {
  const result = lookup(stack, 'class', nameOrRef);
  if (!result.ok) {
    return lookupError(result);
  }
  const data = result.record.data;
  if (!isGeneratedClassData(data)) {
    return malformed('class', result.record.key);
  }
  return {
    ok: true,
    record: toResolvedClassData(result.record.key, result.record.name, data),
  };
}

function listClasses(stack: ResolvedRulesStack): readonly ResolvedClassData[] {
  const index = stack.recordsByKind.get('class');
  if (index === undefined) {
    return [];
  }
  const classes: ResolvedClassData[] = [];
  for (const entry of index.byKey.values()) {
    const { record } = entry;
    if (!isGeneratedClassData(record.data)) {
      continue;
    }
    classes.push(toResolvedClassData(record.key, record.name, record.data));
  }
  return classes.sort((left, right) => left.key.localeCompare(right.key));
}

/**
 * Build the typed class view, narrowing the required fields once and reading the
 * optional structured progression/choice fields best-effort. A field that does
 * not match the expected shape is simply omitted (left `undefined`) rather than
 * failing the whole record — those minimum fields are guarded by
 * {@link isGeneratedClassData}; the rest is enrichment for level-1 creation.
 */
function toResolvedClassData(
  key: string,
  name: string,
  data: GeneratedClassData,
): ResolvedClassData {
  const raw = data as unknown as Record<string, unknown>;
  return {
    key,
    name,
    hitDie: data.hitDie,
    primaryAbilities: data.primaryAbilities,
    savingThrowProficiencies: data.savingThrowProficiencies,
    armorProficiencies: optStringArray(raw.armorProficiencies),
    weaponProficiencies: optStringArray(raw.weaponProficiencies),
    toolProficiencies: optStringArray(raw.toolProficiencies),
    skillChoices: parseChoiceSpecs(raw.skillChoices),
    toolProficiencyChoices: parseChoiceSpecs(raw.toolProficiencyChoices),
    startingEquipment: parseStartingEquipment(raw.startingEquipment),
    level1: parseLevel1(raw.progression),
  };
}

function optStringArray(value: unknown): readonly string[] | undefined {
  return isStringArray(value) ? value : undefined;
}

function parseChoiceSpecs(
  value: unknown,
): readonly ResolvedChoiceSpec[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const specs: ResolvedChoiceSpec[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.text !== 'string') {
      continue;
    }
    specs.push({
      text: entry.text,
      choose: typeof entry.choose === 'number' ? entry.choose : undefined,
      from: isStringArray(entry.from) ? entry.from : undefined,
      any: typeof entry.any === 'boolean' ? entry.any : undefined,
    });
  }
  return specs.length > 0 ? specs : undefined;
}

function parseStartingEquipment(
  value: unknown,
): ResolvedStartingEquipment | undefined {
  if (!isRecord(value) || typeof value.text !== 'string') {
    return undefined;
  }
  return {
    text: value.text,
    entries: isStringArray(value.entries) ? value.entries : [],
  };
}

function parseLevel1(progression: unknown): ResolvedClassLevel1 | undefined {
  if (!Array.isArray(progression)) {
    return undefined;
  }
  const row = progression.find(
    (entry): entry is Record<string, unknown> =>
      isRecord(entry) && entry.level === 1,
  );
  if (row === undefined) {
    return undefined;
  }
  const featureRefs: string[] = [];
  if (Array.isArray(row.features)) {
    for (const feature of row.features) {
      if (isRecord(feature) && typeof feature.ref === 'string') {
        featureRefs.push(feature.ref);
      }
    }
  }
  return {
    featureRefs,
    spellcasting: parseLevelSpellcasting(row.spellcasting),
  };
}

function parseLevelSpellcasting(
  value: unknown,
): ResolvedLevelSpellcasting | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const slots: Record<string, number> = {};
  if (isRecord(value.slots)) {
    for (const [level, count] of Object.entries(value.slots)) {
      if (typeof count === 'number') {
        slots[level] = count;
      }
    }
  }
  return {
    cantripsKnown:
      typeof value.cantripsKnown === 'number' ? value.cantripsKnown : undefined,
    spellsKnown:
      typeof value.spellsKnown === 'number' ? value.spellsKnown : undefined,
    slots: Object.keys(slots).length > 0 ? slots : undefined,
  };
}

function resolveSpell(
  stack: ResolvedRulesStack,
  nameOrRef: string,
): CharacterResolution<ResolvedSpellData> {
  const result = lookup(stack, 'spell', nameOrRef);
  if (!result.ok) {
    return lookupError(result);
  }
  const data = result.record.data;
  if (!isGeneratedSpellData(data)) {
    return malformed('spell', result.record.key);
  }
  return {
    ok: true,
    record: {
      key: result.record.key,
      name: result.record.name,
      level: data.level,
      classes: data.classes,
    },
  };
}

function resolveAncestry(
  stack: ResolvedRulesStack,
  nameOrRef: string,
): CharacterResolution<ResolvedAncestryData> {
  const result = lookup(stack, 'ancestry', nameOrRef);
  if (!result.ok) {
    return lookupError(result);
  }
  const raw = isRecord(result.record.data) ? result.record.data : {};
  return {
    ok: true,
    record: {
      key: result.record.key,
      name: result.record.name,
      size: typeof raw.size === 'string' ? raw.size : undefined,
      speed: typeof raw.speed === 'number' ? raw.speed : undefined,
      traits: parseAncestryTraits(raw.traits),
    },
  };
}

function parseAncestryTraits(
  value: unknown,
): readonly ResolvedAncestryTrait[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const traits: ResolvedAncestryTrait[] = [];
  for (const entry of value) {
    if (
      isRecord(entry) &&
      typeof entry.name === 'string' &&
      typeof entry.text === 'string'
    ) {
      traits.push({ name: entry.name, text: entry.text });
    }
  }
  return traits.length > 0 ? traits : undefined;
}

function resolveBackground(
  stack: ResolvedRulesStack,
  nameOrRef: string,
): CharacterResolution<ResolvedBackgroundData> {
  const result = lookup(stack, 'background', nameOrRef);
  if (!result.ok) {
    return lookupError(result);
  }
  const data = result.record.data;
  if (!isGeneratedBackgroundData(data)) {
    return malformed('background', result.record.key);
  }
  const raw = data as unknown as Record<string, unknown>;
  return {
    ok: true,
    record: {
      key: result.record.key,
      name: result.record.name,
      skillProficiencies: data.skillProficiencies,
      toolProficiencies: optStringArray(raw.toolProficiencies),
      languages: typeof raw.languages === 'string' ? raw.languages : undefined,
      equipment: typeof raw.equipment === 'string' ? raw.equipment : undefined,
    },
  };
}

/**
 * Look a choice up by canonical key when it carries the kind's `<kind>:` prefix,
 * otherwise by display name. Mirrors how the legacy catalog distinguished refs
 * from names so callers can keep passing either.
 */
function lookup(
  stack: ResolvedRulesStack,
  kind: RulesRecordKind,
  nameOrRef: string,
): RulesLookupResult {
  return nameOrRef.startsWith(`${kind}:`)
    ? lookupRulesRecord(stack, { kind, ref: nameOrRef })
    : lookupRulesRecord(stack, { kind, name: nameOrRef });
}

function lookupError<T>(
  result: Extract<RulesLookupResult, { ok: false }>,
): CharacterResolution<T> {
  if (result.code === 'ambiguous') {
    return {
      ok: false,
      code: 'ambiguous',
      message: result.message,
      candidateKeys: result.candidateKeys,
    };
  }
  return { ok: false, code: 'not_found', message: result.message };
}

function malformed<T>(
  kind: RulesRecordKind,
  key: string,
): CharacterResolution<T> {
  return {
    ok: false,
    code: 'malformed',
    message: `Generated ${kind} record ${key} is missing fields required for character creation.`,
  };
}

interface GeneratedClassData {
  readonly hitDie: number;
  readonly primaryAbilities: readonly string[];
  readonly savingThrowProficiencies: readonly string[];
}

function isGeneratedClassData(data: unknown): data is GeneratedClassData {
  return (
    isRecord(data) &&
    typeof data.hitDie === 'number' &&
    isStringArray(data.primaryAbilities) &&
    isStringArray(data.savingThrowProficiencies)
  );
}

interface GeneratedSpellData {
  readonly level: number;
  readonly classes: readonly string[];
}

function isGeneratedSpellData(data: unknown): data is GeneratedSpellData {
  return (
    isRecord(data) &&
    typeof data.level === 'number' &&
    isStringArray(data.classes)
  );
}

interface GeneratedBackgroundData {
  readonly skillProficiencies: readonly string[];
}

function isGeneratedBackgroundData(
  data: unknown,
): data is GeneratedBackgroundData {
  return isRecord(data) && isStringArray(data.skillProficiencies);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}
