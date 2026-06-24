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

/** Class fields character creation reads from a generated `class` record. */
export interface ResolvedClassData {
  readonly key: string;
  readonly name: string;
  readonly hitDie: number;
  readonly primaryAbilities: readonly string[];
  readonly savingThrowProficiencies: readonly string[];
}

/** Spell fields character creation reads from a generated `spell` record. */
export interface ResolvedSpellData {
  readonly key: string;
  readonly name: string;
  readonly level: number;
  readonly classes: readonly string[];
}

/** Ancestry fields character creation reads from a generated `ancestry` record. */
export interface ResolvedAncestryData {
  readonly key: string;
  readonly name: string;
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
  /**
   * Every well-formed `class` record in the stack, in canonical-key order.
   * Drives ability-score-driven class recommendations (eshyra-b69j.7), which
   * need to score the whole class list rather than resolve a single name.
   * Malformed records (failing the generated-data shape guard) are skipped.
   */
  listClasses(): readonly ResolvedClassData[];
}

/** Build a resolver over an already-resolved rules stack (e.g. for tests). */
export function createRulesPackCharacterResolver(
  stack: ResolvedRulesStack,
): RulesPackCharacterResolver {
  return {
    resolveClass: (nameOrRef) => resolveClass(stack, nameOrRef),
    resolveSpell: (nameOrRef) => resolveSpell(stack, nameOrRef),
    resolveAncestry: (nameOrRef) => resolveAncestry(stack, nameOrRef),
    listClasses: () => listClasses(stack),
  };
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
    record: {
      key: result.record.key,
      name: result.record.name,
      hitDie: data.hitDie,
      primaryAbilities: data.primaryAbilities,
      savingThrowProficiencies: data.savingThrowProficiencies,
    },
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
    classes.push({
      key: record.key,
      name: record.name,
      hitDie: record.data.hitDie,
      primaryAbilities: record.data.primaryAbilities,
      savingThrowProficiencies: record.data.savingThrowProficiencies,
    });
  }
  return classes.sort((left, right) => left.key.localeCompare(right.key));
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
  return {
    ok: true,
    record: { key: result.record.key, name: result.record.name },
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}
