/**
 * SRD equipment filter / proficiency resolution audit (eshyra-erf5.3.3).
 *
 * eshyra-erf5.3.1/.3.2 gave every weapon a structured `weaponCategory`/
 * `weaponRange` and every focus/symbol/instrument/tool group member a
 * structured `equipmentGroup`. This module proves those tags actually make
 * every generated starting-equipment filter and class equipment proficiency
 * SATISFIABLE against the equipment catalog — the deterministic-gameplay
 * usability bar the grouping work exists for, not just "the field is
 * present."
 *
 * Two independent things are resolved:
 *
 *   - Every distinct `{ kind: 'filter', select, weaponCategory?, weaponRange? }`
 *     grant actually emitted anywhere in the pack (class/ancestry starting
 *     equipment, background equipment grants) is resolved to its candidate
 *     `equipment:` keys via the structured tags. Zero candidates fails closed.
 *   - Every distinct class `armorProficiencies`/`weaponProficiencies`/
 *     `toolProficiencies` phrase is resolved to its candidate `equipment:`
 *     keys via a reviewed, closed phrase table (broad categories like
 *     "Simple weapons"/"Light armor"/"shields" resolve by structured tag; named
 *     single-item phrases like "Daggers"/"Herbalism kit" resolve to one key).
 *     A phrase absent from the table fails closed rather than being silently
 *     skipped, so a new SRD proficiency phrase in a future pack revision must
 *     be reviewed and added here.
 *
 * Pure and deterministic; results are sorted for diffable reports.
 *
 * Scope boundary (ADR 0020 §5.1): a green result covers only emitted
 * starting-equipment filters and the reviewed class-proficiency phrase table.
 * It is not evidence of global source, discovery, adjudication, or capability
 * completeness.
 */

import type { RulesPack, RulesRecord } from './types.js';

export type EquipmentResolutionSource =
  | 'starting-equipment-filter'
  | 'class-proficiency';

export interface EquipmentResolutionResult {
  readonly source: EquipmentResolutionSource;
  /** Human-readable label, e.g. "weapon:martial/melee" or "Simple weapons". */
  readonly phrase: string;
  /** Sorted `equipment:` keys the phrase resolves to. */
  readonly candidateKeys: readonly string[];
}

/** Thrown when a proficiency phrase has no entry in the reviewed phrase table. */
export class UnresolvedProficiencyPhraseError extends Error {
  constructor(public readonly phrase: string) {
    super(
      `No reviewed equipment resolution for class-proficiency phrase ${JSON.stringify(phrase)}. ` +
        'Add it to PROFICIENCY_PHRASE_RESOLVERS with source-backed evidence.',
    );
    this.name = 'UnresolvedProficiencyPhraseError';
  }
}

/** Thrown when a filter or proficiency phrase resolves to zero candidates. */
export class EquipmentResolutionEmptyError extends Error {
  constructor(
    public readonly source: EquipmentResolutionSource,
    public readonly phrase: string,
  ) {
    super(
      `${source} "${phrase}" resolves to zero equipment candidates — the ` +
        'grouping/tagging that should satisfy it has regressed.',
    );
    this.name = 'EquipmentResolutionEmptyError';
  }
}

function equipmentData(record: RulesRecord): Record<string, unknown> {
  return (record.data ?? {}) as Record<string, unknown>;
}

function weaponCandidates(
  equipment: readonly RulesRecord[],
  weaponCategory?: string,
  weaponRange?: string,
): readonly string[] {
  return equipment
    .filter((r) => {
      const data = equipmentData(r);
      if (data.category !== 'weapon') return false;
      if (
        weaponCategory !== undefined &&
        data.weaponCategory !== weaponCategory
      ) {
        return false;
      }
      if (weaponRange !== undefined && data.weaponRange !== weaponRange) {
        return false;
      }
      return true;
    })
    .map((r) => r.key)
    .sort();
}

function groupCandidates(
  equipment: readonly RulesRecord[],
  group: string,
): readonly string[] {
  return equipment
    .filter((r) => equipmentData(r).equipmentGroup === group)
    .map((r) => r.key)
    .sort();
}

function armorTypeCandidates(
  equipment: readonly RulesRecord[],
  armorType: string,
): readonly string[] {
  return equipment
    .filter(
      (r) =>
        equipmentData(r).category === 'armor' &&
        equipmentData(r).armorType === armorType,
    )
    .map((r) => r.key)
    .sort();
}

function armorCandidates(equipment: readonly RulesRecord[]): readonly string[] {
  return equipment
    .filter((r) => equipmentData(r).category === 'armor')
    .map((r) => r.key)
    .sort();
}

function namedItemCandidates(
  equipment: readonly RulesRecord[],
  key: string,
): readonly string[] {
  return equipment.some((r) => r.key === key) ? [key] : [];
}

// ---------------------------------------------------------------------------
// Starting-equipment filter grants: recursively find every
// `{ select, ... }` filter descriptor anywhere in the pack's record data.
// ---------------------------------------------------------------------------

interface FoundFilter {
  readonly select: string;
  readonly weaponCategory?: string;
  readonly weaponRange?: string;
}

const FILTER_SELECTS: ReadonlySet<string> = new Set([
  'weapon',
  'arcane-focus',
  'druidic-focus',
  'holy-symbol',
  'musical-instrument',
]);

function collectFilters(value: unknown, out: FoundFilter[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectFilters(item, out);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const obj = value as Record<string, unknown>;
  if (typeof obj.select === 'string' && FILTER_SELECTS.has(obj.select)) {
    out.push({
      select: obj.select,
      ...(typeof obj.weaponCategory === 'string'
        ? { weaponCategory: obj.weaponCategory }
        : {}),
      ...(typeof obj.weaponRange === 'string'
        ? { weaponRange: obj.weaponRange }
        : {}),
    });
  }
  for (const nested of Object.values(obj)) collectFilters(nested, out);
}

function filterPhrase(filter: FoundFilter): string {
  if (filter.select !== 'weapon') return filter.select;
  const parts = [
    'weapon',
    filter.weaponCategory ?? 'any',
    filter.weaponRange ?? 'any',
  ];
  return parts.join('/');
}

function resolveStartingEquipmentFilters(
  pack: RulesPack,
  equipment: readonly RulesRecord[],
): EquipmentResolutionResult[] {
  const found: FoundFilter[] = [];
  for (const record of pack.records) {
    if (record.kind === 'equipment') continue; // don't scan the catalog itself
    collectFilters(record.data, found);
  }
  const byPhrase = new Map<string, FoundFilter>();
  for (const filter of found) byPhrase.set(filterPhrase(filter), filter);

  return [...byPhrase.entries()]
    .map(([phrase, filter]) => ({
      source: 'starting-equipment-filter' as const,
      phrase,
      candidateKeys:
        filter.select === 'weapon'
          ? weaponCandidates(
              equipment,
              filter.weaponCategory,
              filter.weaponRange,
            )
          : groupCandidates(equipment, filter.select),
    }))
    .sort((a, b) => (a.phrase < b.phrase ? -1 : a.phrase > b.phrase ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Class equipment proficiencies: a reviewed, closed phrase table. Broad
// categories resolve via the structured tags; named single items resolve to
// one equipment key. A phrase not in this table fails closed.
// ---------------------------------------------------------------------------

type ProficiencyResolver = (
  equipment: readonly RulesRecord[],
) => readonly string[];

const PROFICIENCY_PHRASE_RESOLVERS: ReadonlyMap<string, ProficiencyResolver> =
  new Map<string, ProficiencyResolver>([
    // Armor categories.
    ['All armor', armorCandidates],
    ['Light armor', (eq) => armorTypeCandidates(eq, 'light')],
    ['medium armor', (eq) => armorTypeCandidates(eq, 'medium')],
    ['Heavy armor', (eq) => armorTypeCandidates(eq, 'heavy')],
    ['shields', (eq) => armorTypeCandidates(eq, 'shield')],
    // Weapon proficiency categories.
    ['Simple weapons', (eq) => weaponCandidates(eq, 'simple')],
    ['martial weapons', (eq) => weaponCandidates(eq, 'martial')],
    // Named single-weapon proficiencies (Druid/Rogue/Ranger/Bard subsets).
    ['Clubs', (eq) => namedItemCandidates(eq, 'equipment:club')],
    ['Daggers', (eq) => namedItemCandidates(eq, 'equipment:dagger')],
    ['daggers', (eq) => namedItemCandidates(eq, 'equipment:dagger')],
    ['darts', (eq) => namedItemCandidates(eq, 'equipment:dart')],
    [
      'hand crossbows',
      (eq) => namedItemCandidates(eq, 'equipment:crossbow-hand'),
    ],
    ['javelins', (eq) => namedItemCandidates(eq, 'equipment:javelin')],
    [
      'light crossbows',
      (eq) => namedItemCandidates(eq, 'equipment:crossbow-light'),
    ],
    ['longswords', (eq) => namedItemCandidates(eq, 'equipment:longsword')],
    ['maces', (eq) => namedItemCandidates(eq, 'equipment:mace')],
    [
      'quarterstaffs',
      (eq) => namedItemCandidates(eq, 'equipment:quarterstaff'),
    ],
    ['rapiers', (eq) => namedItemCandidates(eq, 'equipment:rapier')],
    ['scimitars', (eq) => namedItemCandidates(eq, 'equipment:scimitar')],
    ['shortswords', (eq) => namedItemCandidates(eq, 'equipment:shortsword')],
    ['sickles', (eq) => namedItemCandidates(eq, 'equipment:sickle')],
    ['slings', (eq) => namedItemCandidates(eq, 'equipment:sling')],
    ['spears', (eq) => namedItemCandidates(eq, 'equipment:spear')],
    // Named tool proficiencies.
    [
      'Herbalism kit',
      (eq) => namedItemCandidates(eq, 'equipment:herbalism-kit'),
    ],
    [
      'Thieves’ tools',
      (eq) => namedItemCandidates(eq, 'equipment:thieves-tools'),
    ],
  ]);

function resolveClassProficiencies(
  pack: RulesPack,
  equipment: readonly RulesRecord[],
): EquipmentResolutionResult[] {
  const phrases = new Set<string>();
  for (const record of pack.records) {
    if (record.kind !== 'class') continue;
    const data = equipmentData(record);
    for (const field of [
      'armorProficiencies',
      'weaponProficiencies',
      'toolProficiencies',
    ]) {
      const values = data[field];
      if (!Array.isArray(values)) continue;
      for (const value of values) {
        if (typeof value === 'string') phrases.add(value);
      }
    }
  }

  return [...phrases].sort().map((phrase) => {
    const resolver = PROFICIENCY_PHRASE_RESOLVERS.get(phrase);
    if (resolver === undefined) {
      throw new UnresolvedProficiencyPhraseError(phrase);
    }
    return {
      source: 'class-proficiency' as const,
      phrase,
      candidateKeys: resolver(equipment),
    };
  });
}

/**
 * Resolve every starting-equipment filter and class equipment proficiency
 * phrase found in `pack` to its candidate `equipment:` keys. Does not throw
 * on zero-candidate results; call `assertEquipmentResolution` for the
 * fail-closed gate.
 */
export function auditEquipmentResolution(
  pack: RulesPack,
): readonly EquipmentResolutionResult[] {
  const equipment = pack.records.filter((r) => r.kind === 'equipment');
  return [
    ...resolveStartingEquipmentFilters(pack, equipment),
    ...resolveClassProficiencies(pack, equipment),
  ];
}

/** Throw when any resolution result has zero candidates. */
export function assertEquipmentResolution(
  results: readonly EquipmentResolutionResult[],
): void {
  for (const result of results) {
    if (result.candidateKeys.length === 0) {
      throw new EquipmentResolutionEmptyError(result.source, result.phrase);
    }
  }
}
