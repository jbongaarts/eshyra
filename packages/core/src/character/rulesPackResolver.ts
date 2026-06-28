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
import type { AbilityScoreName } from './creation.js';

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
  readonly entries: readonly (string | ResolvedStartingEquipmentEntry)[];
}

export interface ResolvedStartingEquipmentOption {
  readonly label: string;
  readonly text: string;
}

export type ResolvedStartingEquipmentEntry =
  | {
      readonly kind: 'choice';
      readonly options: readonly ResolvedStartingEquipmentOption[];
      readonly sourceText: string;
    }
  | {
      readonly kind: 'fixed';
      readonly text: string;
      readonly sourceText: string;
    };

export interface ResolvedAbilityScoreIncrease {
  readonly ability: AbilityScoreName;
  readonly bonus: number;
}

export interface ResolvedAbilityScoreIncreaseChoice {
  readonly choose: number;
  readonly bonus: number;
  readonly from: readonly AbilityScoreName[];
}

export interface ResolvedAncestryAbilityScoreIncrease {
  readonly fixed: readonly ResolvedAbilityScoreIncrease[];
  readonly choice?: ResolvedAbilityScoreIncreaseChoice;
  readonly sourceText: string;
}

export interface ResolvedLanguageGrant {
  readonly fixed: readonly string[];
  readonly choose?: number;
  readonly sourceText: string;
}

/** Structured spellcasting counts on a class's level row (from the progression table). */
export interface ResolvedLevelSpellcasting {
  readonly cantripsKnown?: number;
  readonly spellsKnown?: number;
  /** Spell slots by spell level, e.g. `{ "1": 2 }` at level 1. */
  readonly slots?: Readonly<Record<string, number>>;
  /** Warlock Pact Magic slots: `count` slots at spell `level`. */
  readonly pactSlots?: { readonly count: number; readonly level: number };
  readonly invocationsKnown?: number;
}

/**
 * A typed subclass-feature slot on a progression row (eshyra-o9bd.2): the level
 * grants a feature determined by the character's chosen subclass. `slotName` is
 * the source label ("Path feature"); `subclassLevel` is the level at which the
 * subclass supplies the concrete feature.
 */
export interface ResolvedSubclassFeatureSlot {
  readonly slotName: string;
  readonly subclassLevel: number;
}

/**
 * A typed improvement to existing feature(s) at this level (eshyra-o9bd.2), e.g.
 * Druid Wild Shape gaining a better beast form. `targetRefs` are the base
 * feature records improved; `label` is the source row label.
 */
export interface ResolvedFeatureImprovement {
  readonly targetRefs: readonly string[];
  readonly label: string;
}

/** The structured slice of a class progression row (typed `advancement[]`). */
export interface ResolvedClassLevel {
  readonly level: number;
  readonly proficiencyBonus: number;
  /** Feature record refs granted at this level (from `featureGrant` entries). */
  readonly featureRefs: readonly string[];
  /** Subclass-feature slots resolved when the character has a chosen subclass. */
  readonly subclassFeatureSlots: readonly ResolvedSubclassFeatureSlot[];
  /** Typed improvements to existing features at this level. */
  readonly featureImprovements: readonly ResolvedFeatureImprovement[];
  /** Spellcasting counts for this level, present only for spellcasting classes. */
  readonly spellcasting?: ResolvedLevelSpellcasting;
}

/** The structured slice of a class's level-1 progression row. */
export type ResolvedClassLevel1 = Omit<ResolvedClassLevel, 'level'>;

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
  /** Spellcasting ability for classes with spellcasting/Pact Magic. */
  readonly spellcastingAbility?: AbilityScoreName;
  /** Structured class progression rows, when the pack record carries them. */
  readonly progression?: readonly ResolvedClassLevel[];
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

/** Subclass fields level-up reads from a generated `subclass` record. */
export interface ResolvedSubclassData {
  readonly key: string;
  readonly name: string;
  readonly parentClass: string;
  readonly features: readonly string[];
}

/** Feature fields level-up reads from generated `feature` records. */
export interface ResolvedFeatureData {
  readonly key: string;
  readonly name: string;
  readonly source: string;
  readonly level: number;
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
   * Structured ability score increases emitted from source-backed ancestry
   * traits.
   */
  readonly abilityScoreIncreases?: readonly ResolvedAncestryAbilityScoreIncrease[];
  /** Structured ancestry language grants. */
  readonly languages?: readonly ResolvedLanguageGrant[];
  /** Racial traits as `{ name, text }`. */
  readonly traits?: readonly ResolvedAncestryTrait[];
}

/** Background fields character creation reads from a generated `background` record. */
export interface ResolvedBackgroundData {
  readonly key: string;
  readonly name: string;
  readonly skillProficiencies: readonly string[];
  readonly toolProficiencies?: readonly string[];
  /** Structured language grants when generated; legacy packs may expose prose. */
  readonly languages?: string | readonly ResolvedLanguageGrant[];
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
  resolveClassLevel(
    nameOrRef: string,
    level: number,
  ): CharacterResolution<ResolvedClassLevel>;
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
  /** Every well-formed `subclass` record, in canonical-key order. */
  listSubclasses(): readonly ResolvedSubclassData[];
  /** Every well-formed `feature` record, in canonical-key order. */
  listFeatures(): readonly ResolvedFeatureData[];
}

/** Build a resolver over an already-resolved rules stack (e.g. for tests). */
export function createRulesPackCharacterResolver(
  stack: ResolvedRulesStack,
): RulesPackCharacterResolver {
  return {
    resolveClass: (nameOrRef) => resolveClass(stack, nameOrRef),
    resolveClassLevel: (nameOrRef, level) =>
      resolveClassLevel(stack, nameOrRef, level),
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
    listSubclasses: () =>
      listByKind(stack, 'subclass', (key) => resolveSubclass(stack, key)),
    listFeatures: () =>
      listByKind(stack, 'feature', (key) => resolveFeature(stack, key)),
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

function resolveClassLevel(
  stack: ResolvedRulesStack,
  nameOrRef: string,
  level: number,
): CharacterResolution<ResolvedClassLevel> {
  if (!Number.isInteger(level) || level < 1) {
    return {
      ok: false,
      code: 'not_found',
      message: `Class level must be a positive integer; got ${level}.`,
    };
  }
  const result = lookup(stack, 'class', nameOrRef);
  if (!result.ok) {
    return lookupError(result);
  }
  const data = result.record.data;
  if (!isGeneratedClassData(data)) {
    return malformed('class', result.record.key);
  }
  const raw = data as unknown as Record<string, unknown>;
  const row = parseClassProgressionLevel(raw.progression, level);
  if (row === 'malformed') {
    return malformed('class', result.record.key);
  }
  if (row === undefined) {
    return {
      ok: false,
      code: 'not_found',
      message: `Generated class record ${result.record.key} has no progression row for level ${level}.`,
    };
  }
  return { ok: true, record: row };
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
 * {@link isGeneratedClassData}; the rest is enrichment for character creation
 * and the leveling read layer.
 */
function toResolvedClassData(
  key: string,
  name: string,
  data: GeneratedClassData,
): ResolvedClassData {
  const raw = data as unknown as Record<string, unknown>;
  const progression = parseClassProgression(raw.progression);
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
    spellcastingAbility: parseAbility(raw.spellcastingAbility),
    progression: progression === 'malformed' ? undefined : progression,
    level1: parseLevel1(raw.progression),
  };
}

function optStringArray(value: unknown): readonly string[] | undefined {
  return isStringArray(value) ? value : undefined;
}

const ABILITY_SCORE_NAMES: ReadonlySet<string> = new Set([
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
]);

function parseAbility(value: unknown): AbilityScoreName | undefined {
  return typeof value === 'string' && ABILITY_SCORE_NAMES.has(value)
    ? (value as AbilityScoreName)
    : undefined;
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
    entries: parseStartingEquipmentEntries(value.entries),
  };
}

function parseStartingEquipmentEntries(
  value: unknown,
): readonly (string | ResolvedStartingEquipmentEntry)[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: (string | ResolvedStartingEquipmentEntry)[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      entries.push(entry);
      continue;
    }
    const parsed = parseStartingEquipmentEntry(entry);
    if (parsed !== undefined) {
      entries.push(parsed);
    }
  }
  return entries;
}

function parseStartingEquipmentEntry(
  value: unknown,
): ResolvedStartingEquipmentEntry | undefined {
  if (!isRecord(value) || typeof value.sourceText !== 'string') {
    return undefined;
  }
  if (value.kind === 'fixed' && typeof value.text === 'string') {
    return { kind: 'fixed', text: value.text, sourceText: value.sourceText };
  }
  if (value.kind !== 'choice' || !Array.isArray(value.options)) {
    return undefined;
  }
  const options: ResolvedStartingEquipmentOption[] = [];
  for (const option of value.options) {
    if (
      isRecord(option) &&
      typeof option.label === 'string' &&
      typeof option.text === 'string'
    ) {
      options.push({ label: option.label, text: option.text });
    }
  }
  return options.length > 0
    ? { kind: 'choice', options, sourceText: value.sourceText }
    : undefined;
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
  const parsed = parseClassProgressionRow(row);
  if (parsed === undefined) {
    return undefined;
  }
  const { level: _level, ...level1 } = parsed;
  return level1;
}

function parseClassProgression(
  progression: unknown,
): readonly ResolvedClassLevel[] | 'malformed' | undefined {
  if (progression === undefined) {
    return undefined;
  }
  if (!Array.isArray(progression)) {
    return 'malformed';
  }
  const rows: ResolvedClassLevel[] = [];
  for (const entry of progression) {
    const row = parseClassProgressionRow(entry);
    if (row === undefined) {
      return 'malformed';
    }
    rows.push(row);
  }
  return rows;
}

function parseClassProgressionLevel(
  progression: unknown,
  level: number,
): ResolvedClassLevel | 'malformed' | undefined {
  if (progression === undefined) {
    return undefined;
  }
  if (!Array.isArray(progression)) {
    return 'malformed';
  }
  const entry = progression.find(
    (row): row is Record<string, unknown> =>
      isRecord(row) && row.level === level,
  );
  if (entry === undefined) {
    return undefined;
  }
  return parseClassProgressionRow(entry) ?? 'malformed';
}

function parseClassProgressionRow(
  entry: unknown,
): ResolvedClassLevel | undefined {
  if (!isRecord(entry) || !Number.isInteger(entry.level)) {
    return undefined;
  }
  const level = entry.level as number;
  const proficiencyBonus = parseProficiencyBonus(entry.proficiencyBonus);
  if (proficiencyBonus === undefined) {
    return undefined;
  }
  const parsed = parseAdvancement(entry.advancement);
  if (parsed === undefined) {
    return undefined;
  }
  return {
    level,
    proficiencyBonus,
    featureRefs: parsed.featureRefs,
    subclassFeatureSlots: parsed.subclassFeatureSlots,
    featureImprovements: parsed.featureImprovements,
    ...(parsed.spellcasting !== undefined
      ? { spellcasting: parsed.spellcasting }
      : {}),
  };
}

function parseProficiencyBonus(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = /^\+?(\d+)$/.exec(value.trim());
  return match === null ? undefined : Number.parseInt(match[1], 10);
}

interface ParsedAdvancement {
  readonly featureRefs: readonly string[];
  readonly subclassFeatureSlots: readonly ResolvedSubclassFeatureSlot[];
  readonly featureImprovements: readonly ResolvedFeatureImprovement[];
  readonly spellcasting?: ResolvedLevelSpellcasting;
}

/**
 * Parse a row's typed `advancement[]` discriminated union (eshyra-o9bd.2) into
 * the resolved slices a level-up engine consumes. Returns `undefined`
 * (malformed) on any unknown kind or ill-shaped entry — fail-closed, so a
 * generated-pack defect surfaces rather than silently dropping advancement.
 */
function parseAdvancement(value: unknown): ParsedAdvancement | undefined {
  if (value === undefined) {
    return {
      featureRefs: [],
      subclassFeatureSlots: [],
      featureImprovements: [],
    };
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const featureRefs: string[] = [];
  const subclassFeatureSlots: ResolvedSubclassFeatureSlot[] = [];
  const featureImprovements: ResolvedFeatureImprovement[] = [];
  let spellcasting: ResolvedLevelSpellcasting | undefined;
  for (const entry of value) {
    if (!isRecord(entry)) {
      return undefined;
    }
    switch (entry.kind) {
      case 'featureGrant': {
        if (typeof entry.ref !== 'string') return undefined;
        featureRefs.push(entry.ref);
        break;
      }
      case 'subclassFeatureSlot': {
        if (
          typeof entry.slotName !== 'string' ||
          !Number.isInteger(entry.subclassLevel)
        ) {
          return undefined;
        }
        subclassFeatureSlots.push({
          slotName: entry.slotName,
          subclassLevel: entry.subclassLevel as number,
        });
        break;
      }
      case 'featureImprovement': {
        if (
          !Array.isArray(entry.targetRefs) ||
          typeof entry.label !== 'string'
        ) {
          return undefined;
        }
        const targetRefs: string[] = [];
        for (const ref of entry.targetRefs) {
          if (typeof ref !== 'string') return undefined;
          targetRefs.push(ref);
        }
        featureImprovements.push({ targetRefs, label: entry.label });
        break;
      }
      case 'resourceProgression': {
        if (typeof entry.resource !== 'string') return undefined;
        // Resource progressions are not consumed by the resolver layer today;
        // validate the shape and carry on.
        break;
      }
      case 'spellcastingProgression': {
        const parsed = parseSpellcastingEntry(entry);
        if (parsed === 'malformed') return undefined;
        spellcasting = parsed;
        break;
      }
      default:
        return undefined;
    }
  }
  return {
    featureRefs,
    subclassFeatureSlots,
    featureImprovements,
    spellcasting,
  };
}

function parseSpellcastingEntry(
  entry: Record<string, unknown>,
): ResolvedLevelSpellcasting | 'malformed' {
  const slots: Record<string, number> = {};
  if (entry.slots !== undefined) {
    if (!isRecord(entry.slots)) return 'malformed';
    for (const [level, count] of Object.entries(entry.slots)) {
      if (typeof count !== 'number') return 'malformed';
      slots[level] = count;
    }
  }
  if (
    (entry.cantripsKnown !== undefined &&
      typeof entry.cantripsKnown !== 'number') ||
    (entry.spellsKnown !== undefined &&
      typeof entry.spellsKnown !== 'number') ||
    (entry.invocationsKnown !== undefined &&
      typeof entry.invocationsKnown !== 'number')
  ) {
    return 'malformed';
  }
  let pactSlots: { count: number; level: number } | undefined;
  if (entry.pactSlots !== undefined) {
    if (
      !isRecord(entry.pactSlots) ||
      typeof entry.pactSlots.count !== 'number' ||
      typeof entry.pactSlots.level !== 'number'
    ) {
      return 'malformed';
    }
    pactSlots = {
      count: entry.pactSlots.count,
      level: entry.pactSlots.level,
    };
  }
  return {
    ...(typeof entry.cantripsKnown === 'number'
      ? { cantripsKnown: entry.cantripsKnown }
      : {}),
    ...(typeof entry.spellsKnown === 'number'
      ? { spellsKnown: entry.spellsKnown }
      : {}),
    ...(Object.keys(slots).length > 0 ? { slots } : {}),
    ...(pactSlots !== undefined ? { pactSlots } : {}),
    ...(typeof entry.invocationsKnown === 'number'
      ? { invocationsKnown: entry.invocationsKnown }
      : {}),
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

function resolveSubclass(
  stack: ResolvedRulesStack,
  nameOrRef: string,
): CharacterResolution<ResolvedSubclassData> {
  const result = lookup(stack, 'subclass', nameOrRef);
  if (!result.ok) {
    return lookupError(result);
  }
  const data = result.record.data;
  if (!isGeneratedSubclassData(data)) {
    return malformed('subclass', result.record.key);
  }
  return {
    ok: true,
    record: {
      key: result.record.key,
      name: result.record.name,
      parentClass: data.parentClass,
      features: data.features,
    },
  };
}

function resolveFeature(
  stack: ResolvedRulesStack,
  nameOrRef: string,
): CharacterResolution<ResolvedFeatureData> {
  const result = lookup(stack, 'feature', nameOrRef);
  if (!result.ok) {
    return lookupError(result);
  }
  const data = result.record.data;
  if (!isGeneratedFeatureData(data)) {
    return malformed('feature', result.record.key);
  }
  return {
    ok: true,
    record: {
      key: result.record.key,
      name: result.record.name,
      source: data.source,
      level: data.level,
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
      abilityScoreIncreases: parseAbilityScoreIncreases(
        raw.abilityScoreIncreases,
      ),
      languages: parseLanguageGrants(raw.languages),
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

function parseAbilityScoreIncreases(
  value: unknown,
): readonly ResolvedAncestryAbilityScoreIncrease[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const entries: ResolvedAncestryAbilityScoreIncrease[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.sourceText !== 'string') {
      continue;
    }
    const fixed = parseFixedAbilityScoreIncreases(entry.fixed);
    if (fixed === undefined) {
      continue;
    }
    const choice = parseAbilityScoreIncreaseChoice(entry.choice);
    entries.push({
      fixed,
      ...(choice !== undefined ? { choice } : {}),
      sourceText: entry.sourceText,
    });
  }
  return entries.length > 0 ? entries : undefined;
}

function parseFixedAbilityScoreIncreases(
  value: unknown,
): readonly ResolvedAbilityScoreIncrease[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const increases: ResolvedAbilityScoreIncrease[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.bonus !== 'number') {
      return undefined;
    }
    const ability = parseAbility(entry.ability);
    if (ability === undefined) {
      return undefined;
    }
    increases.push({ ability, bonus: entry.bonus });
  }
  return increases.length > 0 ? increases : undefined;
}

function parseAbilityScoreIncreaseChoice(
  value: unknown,
): ResolvedAbilityScoreIncreaseChoice | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    !isRecord(value) ||
    typeof value.choose !== 'number' ||
    typeof value.bonus !== 'number' ||
    !Array.isArray(value.from)
  ) {
    return undefined;
  }
  const from: AbilityScoreName[] = [];
  for (const ability of value.from) {
    const parsed = parseAbility(ability);
    if (parsed === undefined) {
      return undefined;
    }
    from.push(parsed);
  }
  return { choose: value.choose, bonus: value.bonus, from };
}

function parseLanguageGrants(
  value: unknown,
): readonly ResolvedLanguageGrant[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const grants: ResolvedLanguageGrant[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !isStringArray(entry.fixed) ||
      typeof entry.sourceText !== 'string'
    ) {
      continue;
    }
    grants.push({
      fixed: entry.fixed,
      ...(typeof entry.choose === 'number' ? { choose: entry.choose } : {}),
      sourceText: entry.sourceText,
    });
  }
  return grants.length > 0 ? grants : undefined;
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
      languages:
        typeof raw.languages === 'string'
          ? raw.languages
          : parseLanguageGrants(raw.languages),
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

interface GeneratedSubclassData {
  readonly parentClass: string;
  readonly features: readonly string[];
}

function isGeneratedSubclassData(data: unknown): data is GeneratedSubclassData {
  return (
    isRecord(data) &&
    typeof data.parentClass === 'string' &&
    isStringArray(data.features)
  );
}

interface GeneratedFeatureData {
  readonly source: string;
  readonly level: number;
}

function isGeneratedFeatureData(data: unknown): data is GeneratedFeatureData {
  return (
    isRecord(data) &&
    typeof data.source === 'string' &&
    typeof data.level === 'number'
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
