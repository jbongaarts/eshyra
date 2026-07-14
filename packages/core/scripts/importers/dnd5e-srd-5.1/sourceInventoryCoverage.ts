/**
 * SRD source-coverage evaluation (eshyra-4a7.1).
 *
 * Gate half of the source-coverage pair: takes the typography-derived
 * inventory (sourceInventory.ts) plus the emitted records and decides, for
 * every source item, exactly one accounting status:
 *
 *   - `record`     — an emitted top-level record covers it (name auto-match);
 *   - `child-of`   — represented as structured child data on a record;
 *   - `ambiguous`  — multiple emitted records share the normalized heading;
 *                    this is visible but does not count as covered;
 *   - `taxonomy`   — represented by creature.familyPath metadata;
 *   - `ignored`    — intentionally not a record, with a stable reason code;
 *   - `known-gap`  — SHOULD become a record/child but doesn't yet; carries the
 *                    bead id of the work that will close it. When that bead
 *                    lands, its rule is removed so the gate starts enforcing
 *                    the new coverage;
 *   - `unaccounted`— nothing claims it. `assertSourceCoverage` fails closed.
 *
 * Resolution order: ALL explicit curated rules (both `record`-type and the
 * caller's remaining `child-of`/`ignore`/`taxonomy`/`known-gap` rules, in
 * list order, first match wins) outrank the unique-name auto-match, which
 * runs last before the ambiguous/document-structure defaults. A curated rule
 * is always more precise than the name heuristic: it can disambiguate
 * duplicate source captions (e.g. the two "Draconic Ancestry" tables on p5
 * and p44 map to two different emitted records) AND it can override a name
 * heuristic that would otherwise silently miscount a source item — e.g. the
 * SRD's p78 per-ability "Skills" bullet captions ("Strength", "Dexterity", …)
 * share their bare name with the real p79+ "Using Each Ability" subsections,
 * so without an explicit `child-of` rule the auto-match would count the p78
 * caption as covered by the unrelated same-named ability record even though
 * that record's body never mentions it (eshyra-erf5.1). A multi-record name
 * match becomes `ambiguous` rather than arbitrarily choosing a winner.
 * Finally, chapter/section tiers use the document-structure default; anything
 * else is unaccounted.
 *
 * Rules are PREDICATES with stable reason codes, not per-item lists: one rule
 * accounts for a whole class of source items (e.g. every spell-list header),
 * which keeps curation reviewable and means a NEW source item of an already
 * understood shape is auto-accounted while a genuinely novel one fails the
 * gate. Everything is pure and deterministic; entries are sorted in reading
 * order so reports diff cleanly.
 */

import { CREATURE_TAXONOMY_SPECS } from './creatureTaxonomy.js';
import type { SpellClassLevelEntry } from './parseSpells.js';
import type { SourceInventoryItem } from './sourceInventory.js';

export type CoverageStatus =
  | { readonly kind: 'record'; readonly key: string }
  | { readonly kind: 'child-of'; readonly key: string }
  | { readonly kind: 'ambiguous'; readonly candidateKeys: readonly string[] }
  | {
      readonly kind: 'taxonomy';
      readonly field: 'creature.familyPath';
      readonly path: readonly string[];
    }
  | {
      readonly kind: 'structured-field';
      readonly field: 'spell.data.classes';
      readonly evidence: SpellListCoverageEvidence;
    }
  | { readonly kind: 'ignored'; readonly reason: string }
  | { readonly kind: 'known-gap'; readonly beadId: string }
  | { readonly kind: 'unaccounted' };

/** Minimal record shape the evaluator needs (subset of RulesRecord). */
export interface CoverageRecordRef {
  readonly kind: string;
  readonly key: string;
  readonly name: string;
  readonly data?: unknown;
}

export interface SpellListCoverageEvidence {
  readonly sourceClass: string;
  readonly spellLevel: number | null;
  readonly memberCount: number;
  readonly spellKeys: readonly string[];
}

export interface SourceCoverageEntry {
  readonly item: SourceInventoryItem;
  readonly status: CoverageStatus;
  readonly resolution: CoverageResolution;
}

/** The exact decision that produced a coverage status. */
export type CoverageResolution =
  | { readonly kind: 'curated-record'; readonly ownerKey: string }
  | { readonly kind: 'curated-child-of'; readonly ownerKey: string }
  | {
      readonly kind: 'curated-structured-field';
      readonly field: 'spell.data.classes';
    }
  | {
      readonly kind: 'curated-taxonomy';
      readonly field: 'creature.familyPath';
      readonly path: readonly string[];
    }
  | { readonly kind: 'curated-ignore'; readonly reason: string }
  | { readonly kind: 'curated-known-gap'; readonly beadId: string }
  | { readonly kind: 'contextual-stat-block'; readonly ownerKey: string }
  | {
      readonly kind: 'unique-normalized-name';
      readonly normalizedName: string;
      readonly ownerKey: string;
    }
  | {
      readonly kind: 'ambiguous-normalized-name';
      readonly normalizedName: string;
      readonly candidateKeys: readonly string[];
    }
  | {
      readonly kind: 'document-structure-default';
      readonly reason: 'document-structure';
    }
  | { readonly kind: 'unaccounted-default' };

export type CoverageRule =
  | {
      readonly type: 'ignore';
      readonly reason: string;
      readonly match: (item: SourceInventoryItem) => boolean;
    }
  | {
      readonly type: 'known-gap';
      readonly beadId: string;
      readonly match: (item: SourceInventoryItem) => boolean;
    }
  | {
      readonly type: 'child-of';
      readonly key: string;
      readonly match: (item: SourceInventoryItem) => boolean;
    }
  | {
      readonly type: 'taxonomy';
      readonly path: readonly string[];
      readonly match: (item: SourceInventoryItem) => boolean;
    }
  | {
      readonly type: 'record';
      readonly key: string;
      readonly match: (item: SourceInventoryItem) => boolean;
    }
  | {
      readonly type: 'structured-field';
      readonly field: 'spell.data.classes';
      readonly evidence: SpellListCoverageEvidence;
      readonly match: (item: SourceInventoryItem) => boolean;
    };

export function ignoreRule(
  reason: string,
  match: (item: SourceInventoryItem) => boolean,
): CoverageRule {
  return { type: 'ignore', reason, match };
}

export function knownGapRule(
  beadId: string,
  match: (item: SourceInventoryItem) => boolean,
): CoverageRule {
  return { type: 'known-gap', beadId, match };
}

export function childOfRule(
  key: string,
  match: (item: SourceInventoryItem) => boolean,
): CoverageRule {
  return { type: 'child-of', key, match };
}

export function taxonomyRule(
  path: readonly string[],
  match: (item: SourceInventoryItem) => boolean,
): CoverageRule {
  return { type: 'taxonomy', path, match };
}

/**
 * Map a source item to a specific emitted record. Evaluated BEFORE the name
 * auto-match, so it serves two cases:
 *
 *   - an emitted record whose NAME differs from the source heading text, so
 *     the auto-match cannot claim it — e.g. the SRD's "Lightfoot" subrace
 *     heading vs the emitted `ancestry:lightfoot-halfling` record named
 *     "Lightfoot Halfling";
 *   - DUPLICATE source captions that must map to different records, where
 *     the auto-match would claim both for one record — e.g. the p5
 *     Dragonborn and p44 Sorcerer "Draconic Ancestry" tables.
 */
export function recordRule(
  key: string,
  match: (item: SourceInventoryItem) => boolean,
): CoverageRule {
  return { type: 'record', key, match };
}

/**
 * Build source-positioned ownership rules for the class spell-list groups.
 * The parser supplies the group heading coordinates; names are used only to
 * resolve the already-emitted spell keys for review evidence.
 */
export function spellListStructuredFieldRules(
  entries: readonly SpellClassLevelEntry[],
  records: readonly CoverageRecordRef[],
): readonly CoverageRule[] {
  const keyByName = new Map<string, string>();
  for (const record of records) {
    if (record.kind !== 'spell') continue;
    keyByName.set(normalizeName(record.name), record.key);
  }
  const groups = new Map<string, SpellClassLevelEntry[]>();
  for (const entry of entries) {
    const key = `${entry.groupSourcePage}:${entry.groupSourceLineIndex}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [entry]);
    else group.push(entry);
  }
  const levelRules = [...groups.values()].map((group) => {
    const first = group[0];
    const evidence: SpellListCoverageEvidence = {
      sourceClass: first.casterClass,
      spellLevel: first.level,
      memberCount: group.length,
      spellKeys: group.map(
        (entry) =>
          keyByName.get(normalizeName(entry.spellName)) ??
          `unresolved:${normalizeName(entry.spellName)}`,
      ),
    };
    return {
      type: 'structured-field' as const,
      field: 'spell.data.classes' as const,
      evidence,
      match: (item: SourceInventoryItem) =>
        item.page === first.groupSourcePage &&
        item.lineIndex === first.groupSourceLineIndex,
    };
  });
  const classGroups = new Map<string, SpellClassLevelEntry[]>();
  for (const entry of entries) {
    const key = `${entry.classSourcePage}:${entry.classSourceLineIndex}`;
    const group = classGroups.get(key);
    if (group === undefined) classGroups.set(key, [entry]);
    else group.push(entry);
  }
  const classRules = [...classGroups.values()].map((group) => {
    const first = group[0];
    return {
      type: 'structured-field' as const,
      field: 'spell.data.classes' as const,
      evidence: {
        sourceClass: first.casterClass,
        spellLevel: null,
        memberCount: group.length,
        spellKeys: group.map(
          (entry) =>
            keyByName.get(normalizeName(entry.spellName)) ??
            `unresolved:${normalizeName(entry.spellName)}`,
        ),
      },
      match: (item: SourceInventoryItem) =>
        item.page === first.classSourcePage &&
        item.lineIndex === first.classSourceLineIndex,
    };
  });
  return [...classRules, ...levelRules];
}

/**
 * Normalize text for name matching: case-fold, straighten curly quotes,
 * collapse whitespace. Hyphen clusters are already collapsed at the
 * extraction boundary (extract.ts `normalizePdfHyphenCluster`).
 */
function normalizeName(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function statusForRule(rule: CoverageRule): CoverageStatus {
  switch (rule.type) {
    case 'ignore':
      return { kind: 'ignored', reason: rule.reason };
    case 'known-gap':
      return { kind: 'known-gap', beadId: rule.beadId };
    case 'child-of':
      return { kind: 'child-of', key: rule.key };
    case 'taxonomy':
      return {
        kind: 'taxonomy',
        field: 'creature.familyPath',
        path: rule.path,
      };
    case 'record':
      return { kind: 'record', key: rule.key };
    case 'structured-field':
      return {
        kind: 'structured-field',
        field: rule.field,
        evidence: rule.evidence,
      };
  }
}

function resolutionForRule(rule: CoverageRule): CoverageResolution {
  switch (rule.type) {
    case 'ignore':
      return { kind: 'curated-ignore', reason: rule.reason };
    case 'known-gap':
      return { kind: 'curated-known-gap', beadId: rule.beadId };
    case 'child-of':
      return { kind: 'curated-child-of', ownerKey: rule.key };
    case 'taxonomy':
      return {
        kind: 'curated-taxonomy',
        field: 'creature.familyPath',
        path: rule.path,
      };
    case 'record':
      return { kind: 'curated-record', ownerKey: rule.key };
    case 'structured-field':
      return { kind: 'curated-structured-field', field: rule.field };
  }
}

function recordHasTaxonomyPath(
  record: CoverageRecordRef,
  expectedPath: readonly string[],
): boolean {
  if (
    record.kind !== 'creature' ||
    typeof record.data !== 'object' ||
    record.data === null ||
    Array.isArray(record.data)
  ) {
    return false;
  }
  const familyPath = (record.data as { familyPath?: unknown }).familyPath;
  return (
    Array.isArray(familyPath) &&
    expectedPath.every((segment, index) => familyPath[index] === segment)
  );
}

/**
 * Evaluate coverage for every inventory item. See the module header for the
 * resolution order. Entries come back sorted by (page, lineIndex).
 */
export function evaluateSourceCoverage(
  inventory: readonly SourceInventoryItem[],
  records: readonly CoverageRecordRef[],
  rules: readonly CoverageRule[],
): readonly SourceCoverageEntry[] {
  const keysByName = new Map<string, string[]>();
  for (const record of records) {
    const name = normalizeName(record.name);
    const existing = keysByName.get(name);
    if (existing === undefined) keysByName.set(name, [record.key]);
    else existing.push(record.key);
  }
  for (const keys of keysByName.values()) keys.sort();

  const statBlockKeyByName = new Map<string, string>();
  for (const record of records) {
    if (record.kind === 'creature' || record.kind === 'stat-block') {
      statBlockKeyByName.set(normalizeName(record.name), record.key);
    }
  }

  let activeStatBlockKey: string | undefined;
  const entries = inventory.map((item): SourceCoverageEntry => {
    if (item.structure === 'stat-block') {
      activeStatBlockKey = statBlockKeyByName.get(normalizeName(item.text));
    } else if (
      item.tier === 'chapter' ||
      item.tier === 'section' ||
      item.tier === 'subsection' ||
      item.tier === 'leaf'
    ) {
      activeStatBlockKey = undefined;
    }

    // Explicit record mappings outrank the name auto-match: a curated rule
    // is more precise than the name heuristic, which cannot tell duplicate
    // source captions apart (the p5 vs p44 "Draconic Ancestry" tables) and
    // resolves duplicate record names lexicographically.
    for (const rule of rules) {
      if (rule.type === 'record' && rule.match(item)) {
        return {
          item,
          status: statusForRule(rule),
          resolution: resolutionForRule(rule),
        };
      }
    }
    if (item.structure === 'stat-block' && activeStatBlockKey !== undefined) {
      return {
        item,
        status: { kind: 'record', key: activeStatBlockKey },
        resolution: {
          kind: 'contextual-stat-block',
          ownerKey: activeStatBlockKey,
        },
      };
    }
    if (
      activeStatBlockKey !== undefined &&
      item.tier === 'sidebar' &&
      /^(Actions|Reactions|Legendary Actions)$/.test(item.text)
    ) {
      return {
        item,
        status: { kind: 'child-of', key: activeStatBlockKey },
        resolution: {
          kind: 'contextual-stat-block',
          ownerKey: activeStatBlockKey,
        },
      };
    }
    // The remaining curated rules (child-of/ignore/taxonomy/known-gap) also
    // outrank the unique-name auto-match below: a same-named-but-unrelated
    // record must not silently swallow a source item a curated rule already
    // classifies (eshyra-erf5.1 — see the module docstring).
    for (const rule of rules) {
      if (rule.type !== 'record' && rule.match(item)) {
        if (
          rule.type === 'taxonomy' &&
          !records.some((record) => recordHasTaxonomyPath(record, rule.path))
        ) {
          return {
            item,
            status: { kind: 'unaccounted' },
            resolution: { kind: 'unaccounted-default' },
          };
        }
        return {
          item,
          status: statusForRule(rule),
          resolution: resolutionForRule(rule),
        };
      }
    }
    const matchedKeys = keysByName.get(normalizeName(item.text)) ?? [];
    if (matchedKeys.length === 1) {
      return {
        item,
        status: { kind: 'record', key: matchedKeys[0] },
        resolution: {
          kind: 'unique-normalized-name',
          normalizedName: normalizeName(item.text),
          ownerKey: matchedKeys[0],
        },
      };
    }
    if (matchedKeys.length > 1) {
      return {
        item,
        status: { kind: 'ambiguous', candidateKeys: matchedKeys },
        resolution: {
          kind: 'ambiguous-normalized-name',
          normalizedName: normalizeName(item.text),
          candidateKeys: matchedKeys,
        },
      };
    }
    if (item.tier === 'chapter' || item.tier === 'section') {
      return {
        item,
        status: { kind: 'ignored', reason: 'document-structure' },
        resolution: {
          kind: 'document-structure-default',
          reason: 'document-structure',
        },
      };
    }
    return {
      item,
      status: { kind: 'unaccounted' },
      resolution: { kind: 'unaccounted-default' },
    };
  });

  return entries.sort(
    (a, b) => a.item.page - b.item.page || a.item.lineIndex - b.item.lineIndex,
  );
}

export class SourceInventoryCoverageError extends Error {
  constructor(unaccounted: readonly SourceCoverageEntry[]) {
    const lines = unaccounted.map(({ item }) => {
      const tier = item.tier ?? 'table';
      const section =
        item.section === null ? '' : ` (section: ${item.section})`;
      return `  p${item.page}#${item.lineIndex} [${tier}/${item.structure}] "${item.text}"${section}`;
    });
    super(
      `SRD source inventory has ${unaccounted.length} unaccounted item(s) — every source structure must be emitted, mapped to child data, ignored with a reason, or tracked as a known gap:\n${lines.join('\n')}`,
    );
    this.name = 'SourceInventoryCoverageError';
  }
}

export class StatBlockCoverageError extends Error {
  constructor(invalid: readonly SourceCoverageEntry[]) {
    const lines = invalid.map(
      ({ item, status }) =>
        `  p${item.page}#${item.lineIndex} "${item.text}" -> ${formatCoverageStatus(status)}`,
    );
    super(
      `SRD stat-block source inventory has ${invalid.length} invalid mapping(s) — every stat-block must resolve to a creature or stat-block record:\n${lines.join('\n')}`,
    );
    this.name = 'StatBlockCoverageError';
  }
}

/** Throw when any entry is unaccounted or a stat block maps to the wrong kind. */
export function assertSourceCoverage(
  entries: readonly SourceCoverageEntry[],
  options: {
    readonly statBlockExceptionReasons?: readonly string[];
  } = {},
): void {
  const invalidProvenance = entries.filter(({ status, resolution }) => {
    switch (resolution.kind) {
      case 'curated-record':
        return status.kind !== 'record' || status.key !== resolution.ownerKey;
      case 'curated-child-of':
        return status.kind !== 'child-of' || status.key !== resolution.ownerKey;
      case 'contextual-stat-block':
        return !(
          (status.kind === 'record' || status.kind === 'child-of') &&
          status.key === resolution.ownerKey
        );
      case 'unique-normalized-name':
        return status.kind !== 'record' || status.key !== resolution.ownerKey;
      case 'ambiguous-normalized-name':
        return (
          status.kind !== 'ambiguous' ||
          status.candidateKeys.join('|') !== resolution.candidateKeys.join('|')
        );
      case 'curated-structured-field':
        return (
          status.kind !== 'structured-field' ||
          status.field !== resolution.field
        );
      case 'curated-taxonomy':
        return (
          status.kind !== 'taxonomy' ||
          status.field !== resolution.field ||
          status.path.join('|') !== resolution.path.join('|')
        );
      case 'curated-ignore':
        return status.kind !== 'ignored' || status.reason !== resolution.reason;
      case 'curated-known-gap':
        return (
          status.kind !== 'known-gap' || status.beadId !== resolution.beadId
        );
      case 'document-structure-default':
        return status.kind !== 'ignored' || status.reason !== resolution.reason;
      case 'unaccounted-default':
        return status.kind !== 'unaccounted';
      default:
        return true;
    }
  });
  const coordinates = new Set<string>();
  const duplicateCoordinates = entries.filter(({ item }) => {
    const key = `${item.page}:${item.lineIndex}`;
    if (coordinates.has(key)) return true;
    coordinates.add(key);
    return false;
  });
  if (invalidProvenance.length > 0 || duplicateCoordinates.length > 0) {
    throw new Error(
      `SRD source coverage diagnostics are inconsistent: ${invalidProvenance.length} invalid resolutions, ${duplicateCoordinates.length} duplicate source coordinates`,
    );
  }
  const unaccounted = entries.filter((e) => e.status.kind === 'unaccounted');
  if (unaccounted.length > 0) {
    throw new SourceInventoryCoverageError(unaccounted);
  }
  const statBlockExceptionReasons = new Set(
    options.statBlockExceptionReasons ?? [],
  );
  const invalidStatBlocks = entries.filter(
    ({ item, status }) =>
      item.structure === 'stat-block' &&
      !(
        status.kind === 'ignored' &&
        statBlockExceptionReasons.has(status.reason)
      ) &&
      (status.kind !== 'record' ||
        (!status.key.startsWith('creature:') &&
          !status.key.startsWith('stat-block:'))),
  );
  if (invalidStatBlocks.length > 0) {
    throw new StatBlockCoverageError(invalidStatBlocks);
  }
}

/**
 * One-line status form used in the `source-coverage.json` artifact and the
 * sentinel regression tests: `record:<key>` | `child-of:<key>` |
 * `ambiguous:<key>|<key>` |
 * `taxonomy:creature.familyPath:<path>` | `ignored:<reason>` |
 * `known-gap:<beadId>` | `unaccounted`.
 */
export function formatCoverageStatus(status: CoverageStatus): string {
  switch (status.kind) {
    case 'record':
      return `record:${status.key}`;
    case 'child-of':
      return `child-of:${status.key}`;
    case 'ambiguous':
      return `ambiguous:${status.candidateKeys.join('|')}`;
    case 'taxonomy':
      return `taxonomy:${status.field}:${status.path.join(' > ')}`;
    case 'structured-field':
      return `structured-field:${status.field}`;
    case 'ignored':
      return `ignored:${status.reason}`;
    case 'known-gap':
      return `known-gap:${status.beadId}`;
    case 'unaccounted':
      return 'unaccounted';
  }
}

/** JSON shape of one `source-coverage.json` entry. */
export interface SourceCoverageReportEntry {
  readonly page: number;
  readonly lineIndex: number;
  readonly tier: string | null;
  readonly structure: string;
  readonly text: string;
  readonly section: string | null;
  readonly status: string;
  readonly resolution: CoverageResolution;
  readonly structuredFieldEvidence?: SpellListCoverageEvidence;
}

/**
 * A name that maps to multiple emitted record keys: the auto-match can only
 * resolve to the lexicographically-first key, so the rest are silently
 * shadowed. The reporter surfaces these so reviewers can decide whether each
 * collision needs an explicit `recordRule` disambiguation.
 */
export interface AmbiguousNameCollision {
  readonly normalizedName: string;
  readonly candidateKeys: readonly string[];
  readonly occurrences: readonly SourceCoverageDiagnosticOccurrence[];
  readonly explicitlyClaimedKeys: readonly string[];
  readonly unresolved: boolean;
}

export interface SourceCoverageDiagnosticOccurrence {
  readonly page: number;
  readonly lineIndex: number;
  readonly tier: string | null;
  readonly structure: string;
  readonly section: string | null;
  readonly context: string | null;
  readonly text: string;
  readonly status: string;
  readonly resolution: CoverageResolution;
  readonly ownerKey?: string;
  readonly candidateKeys?: readonly string[];
}

export type DuplicateSourceTextCategory =
  | 'explicitly-disambiguated'
  | 'same-owner-explicit'
  | 'auto-collapsed'
  | 'mixed-resolution'
  | 'unresolved-owner'
  | 'different-auto-owners';

export interface DuplicateSourceTextGroup {
  readonly normalizedText: string;
  readonly category: DuplicateSourceTextCategory;
  readonly occurrences: readonly SourceCoverageDiagnosticOccurrence[];
  readonly candidateKeys: readonly string[];
  readonly ownerKeys: readonly string[];
  readonly reasonCodes: readonly string[];
}

export interface SuspiciousOwnershipGroup extends DuplicateSourceTextGroup {
  readonly reasonCodes: readonly (
    | 'auto-collapsed'
    | 'different-auto-owners'
    | 'unresolved-owner'
    | 'mixed-explicit-and-automatic'
  )[];
}

/** JSON shape of the `source-coverage.json` artifact. */
export interface SourceCoverageReport {
  readonly summary: {
    readonly record: number;
    readonly childOf: number;
    readonly ambiguous: number;
    readonly taxonomy: number;
    readonly structuredField: number;
    readonly ignored: Readonly<Record<string, number>>;
    readonly knownGap: Readonly<Record<string, number>>;
    readonly unaccounted: number;
  };
  readonly diagnostics: {
    readonly recordNameCollisions: readonly AmbiguousNameCollision[];
    readonly duplicateSourceText: readonly DuplicateSourceTextGroup[];
    readonly suspiciousOwnership: readonly SuspiciousOwnershipGroup[];
    readonly unresolvedOwnership: readonly DuplicateSourceTextGroup[];
  };
  readonly entries: readonly SourceCoverageReportEntry[];
}

/**
 * Build the reviewer-facing coverage report from the evaluator's provenance.
 * Pure and deterministic — all diagnostic collections are sorted by normalized
 * text, source position, then key.
 *
 * The `ambiguous` section surfaces three classes of name collisions:
 * name auto-matcher:
 *
 *   - `shadowedRecords`: emitted records whose normalized name is shared with
 *     another record. The auto-match resolves to the lexicographically-first
 *     key; the rest are shadowed and can only be claimed by an explicit
 *     `recordRule`. Cross-kind name collisions (e.g. a class and a creature
 *     both named "Druid") appear here.
 *
 *   - `collapsedSourceItems`: groups of source inventory items that share the
 *     same normalized text and all auto-match to the same record key. Each
 *     group shows the count so reviewers can see how many source items are
 *     silently folded into one match (e.g. 12 per-class "Ability Score
 *     Improvement" headings all resolving to one feature key).
 *
 *   - `unresolvedSourceItems`: source headings with multiple candidate record
 *     keys after contextual and curated mappings. These entries carry an
 *     `ambiguous:` status and are excluded from the covered-record count.
 */
export function buildSourceCoverageReport(
  entries: readonly SourceCoverageEntry[],
  records: readonly CoverageRecordRef[],
): SourceCoverageReport {
  let record = 0;
  let childOf = 0;
  let ambiguous = 0;
  let taxonomy = 0;
  let structuredField = 0;
  let unaccounted = 0;
  const ignored = new Map<string, number>();
  const knownGap = new Map<string, number>();
  for (const { status } of entries) {
    switch (status.kind) {
      case 'record':
        record += 1;
        break;
      case 'child-of':
        childOf += 1;
        break;
      case 'ambiguous':
        ambiguous += 1;
        break;
      case 'taxonomy':
        taxonomy += 1;
        break;
      case 'structured-field':
        structuredField += 1;
        break;
      case 'ignored':
        ignored.set(status.reason, (ignored.get(status.reason) ?? 0) + 1);
        break;
      case 'known-gap':
        knownGap.set(status.beadId, (knownGap.get(status.beadId) ?? 0) + 1);
        break;
      case 'unaccounted':
        unaccounted += 1;
        break;
    }
  }
  const sortedCounts = (
    counts: ReadonlyMap<string, number>,
  ): Record<string, number> =>
    Object.fromEntries(
      [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );

  const occurrence = ({
    item,
    status,
    resolution,
  }: SourceCoverageEntry): SourceCoverageDiagnosticOccurrence => {
    const ownerKey =
      status.kind === 'record' || status.kind === 'child-of'
        ? status.key
        : undefined;
    const candidateKeys =
      status.kind === 'ambiguous' ? status.candidateKeys : undefined;
    return {
      page: item.page,
      lineIndex: item.lineIndex,
      tier: item.tier,
      structure: item.structure,
      section: item.section,
      context: item.context,
      text: item.text,
      status: formatCoverageStatus(status),
      resolution,
      ...(ownerKey === undefined ? {} : { ownerKey }),
      ...(candidateKeys === undefined ? {} : { candidateKeys }),
    };
  };
  const lexical = (a: string, b: string): number =>
    a < b ? -1 : a > b ? 1 : 0;
  const occurrenceSort = (
    a: SourceCoverageDiagnosticOccurrence,
    b: SourceCoverageDiagnosticOccurrence,
  ) =>
    a.page - b.page ||
    a.lineIndex - b.lineIndex ||
    lexical(
      a.ownerKey ?? a.candidateKeys?.join('|') ?? '',
      b.ownerKey ?? b.candidateKeys?.join('|') ?? '',
    );

  // ---- record-name collisions ----
  const nameToKeys = new Map<string, string[]>();
  for (const rec of records) {
    const name = normalizeName(rec.name);
    const list = nameToKeys.get(name);
    if (list === undefined) {
      nameToKeys.set(name, [rec.key]);
    } else {
      list.push(rec.key);
    }
  }
  const recordNameCollisions: AmbiguousNameCollision[] = [];
  for (const [normalizedName, keys] of [...nameToKeys.entries()].sort(
    ([a], [b]) => lexical(a, b),
  )) {
    if (keys.length > 1) {
      const candidateKeys = [...keys].sort();
      const occurrences = entries
        .filter(({ item }) => normalizeName(item.text) === normalizedName)
        .map(occurrence)
        .sort(occurrenceSort);
      const explicitlyClaimedKeys = [
        ...new Set(
          occurrences.flatMap((o) =>
            o.resolution.kind === 'curated-record' ||
            o.resolution.kind === 'curated-child-of'
              ? [o.resolution.ownerKey]
              : [],
          ),
        ),
      ].sort();
      recordNameCollisions.push({
        normalizedName,
        candidateKeys,
        occurrences,
        explicitlyClaimedKeys,
        unresolved: occurrences.some(
          (o) => o.resolution.kind === 'ambiguous-normalized-name',
        ),
      });
    }
  }

  // ---- duplicate source text ----
  const byText = new Map<string, SourceCoverageDiagnosticOccurrence[]>();
  for (const entry of entries) {
    const key = normalizeName(entry.item.text);
    const group = byText.get(key);
    if (group === undefined) byText.set(key, [occurrence(entry)]);
    else group.push(occurrence(entry));
  }
  const duplicateSourceText: DuplicateSourceTextGroup[] = [];
  for (const [normalizedText, occurrencesUnsorted] of [
    ...byText.entries(),
  ].sort(([a], [b]) => lexical(a, b))) {
    if (occurrencesUnsorted.length < 2) continue;
    const occurrences = [...occurrencesUnsorted].sort(occurrenceSort);
    const explicit = occurrences.filter((o) =>
      o.resolution.kind.startsWith('curated-'),
    );
    const automatic = occurrences.filter(
      (o) => o.resolution.kind === 'unique-normalized-name',
    );
    const unresolved = occurrences.some(
      (o) => o.resolution.kind === 'ambiguous-normalized-name',
    );
    const ownerKeys = [
      ...new Set(
        occurrences.flatMap((o) =>
          o.ownerKey === undefined ? [] : [o.ownerKey],
        ),
      ),
    ].sort();
    const candidateKeys = [
      ...new Set(occurrences.flatMap((o) => o.candidateKeys ?? [])),
    ].sort();
    let category: DuplicateSourceTextCategory;
    let reasonCodes: DuplicateSourceTextGroup['reasonCodes'];
    if (unresolved) {
      category = 'unresolved-owner';
      reasonCodes = ['unresolved-owner'];
    } else if (explicit.length === occurrences.length) {
      category =
        ownerKeys.length > 1
          ? 'explicitly-disambiguated'
          : 'same-owner-explicit';
      reasonCodes = [category];
    } else if (
      automatic.length === occurrences.length &&
      ownerKeys.length === 1
    ) {
      category = 'auto-collapsed';
      reasonCodes = ['auto-collapsed'];
    } else if (automatic.length === occurrences.length) {
      category = 'different-auto-owners';
      reasonCodes = ['different-auto-owners'];
    } else {
      category = 'mixed-resolution';
      reasonCodes = ['mixed-explicit-and-automatic'];
    }
    duplicateSourceText.push({
      normalizedText,
      category,
      occurrences,
      candidateKeys,
      ownerKeys,
      reasonCodes,
    });
  }
  const suspiciousOwnership = duplicateSourceText
    .filter(
      (group) =>
        group.category === 'auto-collapsed' ||
        group.category === 'different-auto-owners' ||
        group.category === 'unresolved-owner' ||
        group.category === 'mixed-resolution',
    )
    .map((group) => ({
      ...group,
      reasonCodes: group.reasonCodes as SuspiciousOwnershipGroup['reasonCodes'],
    }));
  const unresolvedOwnership = [
    ...duplicateSourceText.filter(
      (group) => group.category === 'unresolved-owner',
    ),
  ];
  const duplicateKeys = new Set(
    unresolvedOwnership.map((group) => group.normalizedText),
  );
  const standaloneUnresolved = new Map<
    string,
    SourceCoverageDiagnosticOccurrence[]
  >();
  for (const entry of entries) {
    if (entry.resolution.kind !== 'ambiguous-normalized-name') continue;
    const normalizedText = normalizeName(entry.item.text);
    if (duplicateKeys.has(normalizedText)) continue;
    const group = standaloneUnresolved.get(normalizedText);
    if (group === undefined)
      standaloneUnresolved.set(normalizedText, [occurrence(entry)]);
    else group.push(occurrence(entry));
  }
  for (const [normalizedText, occurrences] of [
    ...standaloneUnresolved.entries(),
  ].sort(([a], [b]) => lexical(a, b))) {
    const candidateKeys = [
      ...new Set(occurrences.flatMap((o) => o.candidateKeys ?? [])),
    ].sort();
    unresolvedOwnership.push({
      normalizedText,
      category: 'unresolved-owner',
      occurrences: occurrences.sort(occurrenceSort),
      candidateKeys,
      ownerKeys: [],
      reasonCodes: ['unresolved-owner'],
    });
  }

  return {
    summary: {
      record,
      childOf,
      ambiguous,
      taxonomy,
      structuredField,
      ignored: sortedCounts(ignored),
      knownGap: sortedCounts(knownGap),
      unaccounted,
    },
    diagnostics: {
      recordNameCollisions,
      duplicateSourceText,
      suspiciousOwnership,
      unresolvedOwnership,
    },
    entries: entries.map(({ item, status, resolution }) => ({
      page: item.page,
      lineIndex: item.lineIndex,
      tier: item.tier,
      structure: item.structure,
      text: item.text,
      section: item.section,
      status: formatCoverageStatus(status),
      resolution,
      ...(status.kind === 'structured-field'
        ? { structuredFieldEvidence: status.evidence }
        : {}),
    })),
  };
}

// ---------------------------------------------------------------------------
// Curated coverage rules for the vendored SRD 5.1 PDF (eshyra-4a7.1.3).
//
// Resolution order matters: explicit `record`-type rules run FIRST (a curated
// mapping outranks the name heuristic, so duplicate source captions can map
// to distinct records), then contextual stat-block ownership and unique-name
// auto-match, then the remaining rules apply first-match-wins. Multi-record
// name matches become visible ambiguous statuses. Rules are predicates over
// understood CLASSES of source
// structure, not per-item allowlists, so a new item of an already-understood
// shape is auto-accounted while a genuinely novel structure stays
// unaccounted and fails the import.
//
// Honesty contract (docs/importer-fix-protocol.md): `ignoreRule` is reserved
// for genuine non-content (structural headers whose content is represented
// elsewhere, documented intentional exclusions); anything that SHOULD become
// a record or structured child data carries a `knownGapRule` naming the bead
// that will close it — when that bead lands, its rule is deleted so the gate
// starts enforcing the new coverage.
// ---------------------------------------------------------------------------

/** The 12 class names; each renders at chapter tier, so it IS the `section`. */
const CLASS_CHAPTER_SECTIONS: ReadonlySet<string> = new Set([
  'Barbarian',
  'Bard',
  'Cleric',
  'Druid',
  'Fighter',
  'Monk',
  'Paladin',
  'Ranger',
  'Rogue',
  'Sorcerer',
  'Warlock',
  'Wizard',
]);

// --- Class feature-option subheading sets (eshyra-4a7.6) -------------------
// The SRD prints these as bold leaf headings inside a parent feature's body;
// the feature parser keeps the text in the parent record, so each maps
// child-of its owning feature in the coverage rules below.

/** Fighting Style options (Fighter / Paladin / Ranger Fighting Style feature). */
const FIGHTING_STYLE_OPTIONS: ReadonlySet<string> = new Set([
  'Archery',
  'Defense',
  'Dueling',
  'Great Weapon Fighting',
  'Protection',
  'Two-Weapon Fighting',
]);

/** Sorcerer Metamagic options (feature:sorcerer:metamagic). */
const METAMAGIC_OPTIONS: ReadonlySet<string> = new Set([
  'Careful Spell',
  'Distant Spell',
  'Empowered Spell',
  'Extended Spell',
  'Heightened Spell',
  'Quickened Spell',
  'Subtle Spell',
  'Twinned Spell',
]);

/** Monk ki options (feature:monk:ki). */
const MONK_KI_OPTIONS: ReadonlySet<string> = new Set([
  'Flurry of Blows',
  'Patient Defense',
  'Step of the Wind',
]);

/** Warlock Pact Boon options (feature:warlock:pact-boon). */
const WARLOCK_PACT_OPTIONS: ReadonlySet<string> = new Set([
  'Pact of the Chain',
  'Pact of the Blade',
  'Pact of the Tome',
]);

/**
 * The five p78 "Skills" per-ability leaf captions (child-of `rule:skills`,
 * eshyra-erf5.1). Constitution has no caption because the SRD lists no
 * skills under it.
 */
const SKILL_CAPTION_ABILITY_NAMES: ReadonlySet<string> = new Set([
  'Strength',
  'Dexterity',
  'Intelligence',
  'Wisdom',
  'Charisma',
]);

/** Spellcasting-feature boilerplate subsections, shared across caster classes. */
const SPELLCASTING_BOILERPLATE: ReadonlySet<string> = new Set([
  'Preparing and Casting Spells',
  'Ritual Casting',
  'Spellcasting Focus',
  'Spells Known of 1st Level and Higher',
  'Learning Spells of 1st Level and Higher',
]);

/**
 * The emitted feature whose body carries each class's spellcasting boilerplate
 * subsections (Preparing and Casting Spells, Ritual Casting, Spellcasting
 * Focus, …). `feature:<class>:spellcasting` is the canonical owner for
 * spellcasting classes; Warlock uses the SRD's `Pact Magic` feature name.
 */
const SPELLCASTING_BOILERPLATE_OWNER: ReadonlyMap<string, string> = new Map([
  ['Bard', 'feature:bard:spellcasting'],
  ['Cleric', 'feature:cleric:spellcasting'],
  ['Druid', 'feature:druid:spellcasting'],
  ['Paladin', 'feature:paladin:spellcasting'],
  ['Ranger', 'feature:ranger:spellcasting'],
  ['Sorcerer', 'feature:sorcerer:spellcasting'],
  ['Warlock', 'feature:warlock:pact-magic'],
  ['Wizard', 'feature:wizard:spellcasting'],
]);

/**
 * "<Race> Traits" subsection headings: the trait content is structured child
 * data on the matching ancestry record (`data.traits`).
 */
const RACE_TRAIT_HEADINGS: ReadonlyArray<readonly [string, string]> = [
  ['Dwarf Traits', 'ancestry:dwarf'],
  ['Elf Traits', 'ancestry:elf'],
  ['Halfling Traits', 'ancestry:halfling'],
  ['Human Traits', 'ancestry:human'],
  ['Dragonborn Traits', 'ancestry:dragonborn'],
  ['Gnome Traits', 'ancestry:gnome'],
  ['Half-Elf Traits', 'ancestry:half-elf'],
  ['Half-Orc Traits', 'ancestry:half-orc'],
  ['Tiefling Traits', 'ancestry:tiefling'],
];

/**
 * Equipment-chapter reference tables whose ROWS are emitted as `equipment`
 * records (with `cost`/`weight`/`capacity`/pack-contents child data), so the
 * table itself is intentionally not a `table` record.
 */
const EQUIPMENT_ROWS_AS_RECORDS_CAPTIONS: ReadonlySet<string> = new Set([
  'Armor',
  'Weapons',
  'Adventuring Gear',
  'Container Capacity',
  'Equipment Packs',
  'Tools',
  'Mounts and Other Animals',
  'Tack, Harness, and Drawn Vehicles',
  'Waterborne Vehicles',
]);

/**
 * The seven Circle of the Land terrain spell tables (p22): the SRD prints
 * bare terrain-word captions ("Arctic") while the emitted records carry
 * qualified names ("Circle of the Land (Arctic)"), so the name auto-match
 * cannot claim the captions (eshyra-4a7.3).
 */
const CIRCLE_OF_THE_LAND_TABLE_TERRAINS: ReadonlyArray<
  readonly [string, string]
> = [
  ['Arctic', 'table:circle-of-the-land-arctic'],
  ['Coast', 'table:circle-of-the-land-coast'],
  ['Desert', 'table:circle-of-the-land-desert'],
  ['Forest', 'table:circle-of-the-land-forest'],
  ['Grassland', 'table:circle-of-the-land-grassland'],
  ['Mountain', 'table:circle-of-the-land-mountain'],
  ['Swamp', 'table:circle-of-the-land-swamp'],
];

/**
 * Caption-less spell tables emitted from reviewed document-wide specs
 * (eshyra-o4j7). Printed captions auto-match their record names; these table
 * shapes need explicit header-to-record mappings.
 */
const SPELL_TABLE_INVENTORY_RECORDS: ReadonlyArray<
  readonly [page: number, text: string, key: string]
> = [
  [127, 'd10 Behavior', 'table:confusion-behavior'],
  [132, 'Material Duration', 'table:creation-material-duration'],
  [174, 'd100 Race', 'table:reincarnate-race'],
  [176, 'Knowledge Save Modifier', 'table:scrying-save-modifiers'],
  [186, 'Similar Off On', 'table:teleport-familiarity'],
];

/**
 * Magic-item tables emitted from reviewed document-wide specifications
 * (eshyra-4a7.3, eshyra-4a7.8). Each surfaces in the inventory as a table
 * structure whose text is either its printed caption or its column-header
 * line, located by the owning item heading recorded as `context`.
 */
const MAGIC_ITEM_TABLE_INVENTORY_RECORDS: ReadonlyArray<
  readonly [page: number, text: string, key: string]
> = [
  [208, 'Apparatus of the Crab Levers', 'table:apparatus-of-the-crab-levers'],
  [209, 'd10 Damage Type d10 Damage Type', 'table:armor-of-resistance'],
  [209, 'd100 Effect', 'table:bag-of-beans'],
  [210, 'Gray Bag of Tricks', 'table:gray-bag-of-tricks'],
  [211, 'Rust Bag of Tricks', 'table:rust-bag-of-tricks'],
  [211, 'Tan Bag of Tricks', 'table:tan-bag-of-tricks'],
  [211, 'Type Strength Rarity', 'table:belt-of-giant-strength'],
  [213, 'd20 Alignment', 'table:candle-of-invocation'],
  [213, 'd100 Size Capacity Flying Speed', 'table:carpet-of-flying'],
  [215, 'Cube of Force Faces', 'table:cube-of-force-faces'],
  [215, 'Spell or Item Charges Lost', 'table:cube-of-force-charges-lost'],
  [216, 'Playing Card Illusion', 'table:deck-of-illusions'],
  [217, 'Playing Card Card', 'table:deck-of-many-things'],
  [219, 'Dragon Resistance Dragon Resistance', 'table:dragon-scale-mail'],
  [220, 'd100 Effect', 'table:efreeti-bottle'],
  [220, 'Gem Summoned Elemental', 'table:elemental-gem'],
  [221, 'd100 Feather Token d100 Feather Token', 'table:feather-token'],
  [226, 'd100 Horn Berserkers Requirement', 'table:horn-of-valhalla'],
  [228, 'd100 Contents', 'table:iron-flask'],
  [229, 'd20 Golem Time Cost', 'table:manual-of-golems'],
  [231, 'd20 Bead of … Spell', 'table:necklace-of-prayer-beads'],
  [234, 'Type of Giant Strength Rarity', 'table:potion-of-giant-strength'],
  [234, 'Potions of Healing', 'table:potions-of-healing'],
  [235, 'd10 Damage Type d10 Damage Type', 'table:potion-of-resistance'],
  [237, 'd10 Damage Type Gem', 'table:ring-of-resistance'],
  [237, 'Spheres Lightning Damage', 'table:ring-of-shooting-stars'],
  [239, 'd100 Patch', 'table:robe-of-useful-items'],
  [242, 'Spell Scroll', 'table:spell-scroll'],
  [243, 'd100 Result', 'table:sphere-of-annihilation'],
  [244, 'Distance from Origin Damage', 'table:staff-of-power'],
  [245, 'Distance from Origin Damage', 'table:staff-of-the-magi'],
  [250, 'd100 Effect', 'table:wand-of-wonder'],
  [251, 'd100 Communication', 'table:sentient-magic-item-communication'],
  [251, 'd4 Senses', 'table:sentient-magic-item-senses'],
  [251, 'd100 Alignment d100 Alignment', 'table:sentient-magic-item-alignment'],
  [252, 'd10 Purpose', 'table:sentient-magic-item-special-purpose'],
];

/**
 * Coverage rules for the real SRD 5.1 import. Every rule carries a comment
 * naming the source structures it accounts for; the committed
 * `source-coverage.json` artifact shows the resulting per-item statuses.
 */
export const SRD_5_1_COVERAGE_RULES: readonly CoverageRule[] = [
  // Cross-kind and repeated rule names require source-context mappings. A
  // bare name match is intentionally non-covering when multiple records share
  // the normalized title.
  recordRule(
    'rule:spellcasting-chapter',
    (i) => i.page === 100 && i.text === 'Spellcasting',
  ),
  recordRule(
    'rule:darkvision',
    (i) => i.page === 86 && i.text === 'Darkvision',
  ),
  recordRule('rule:reactions', (i) => i.page === 91 && i.text === 'Reactions'),
  recordRule(
    'rule:casting-time-reactions',
    (i) => i.section === 'Spellcasting' && i.text === 'Reactions',
  ),
  recordRule(
    'spell:darkvision',
    (i) => i.section === 'Spellcasting' && i.text === 'Darkvision',
  ),
  recordRule(
    'spell:fly',
    (i) => i.section === 'Spellcasting' && i.text === 'Fly',
  ),
  recordRule(
    'spell:shield',
    (i) => i.section === 'Spellcasting' && i.text === 'Shield',
  ),
  recordRule('rule:fly', (i) => i.section === 'Monsters' && i.text === 'Fly'),
  recordRule(
    'rule:monsters-alignment',
    (i) => i.section === 'Monsters' && i.text === 'Alignment',
  ),
  recordRule(
    'rule:senses-darkvision',
    (i) => i.section === 'Monsters' && i.text === 'Darkvision',
  ),
  recordRule(
    'rule:actions',
    (i) =>
      i.section === 'Monsters' &&
      i.tier === 'subsection' &&
      i.text === 'Actions',
  ),
  recordRule(
    'rule:monsters-reactions',
    (i) =>
      i.section === 'Monsters' &&
      i.tier === 'subsection' &&
      i.text === 'Reactions',
  ),
  recordRule(
    'rule:legendary-actions',
    (i) =>
      i.section === 'Monsters' &&
      i.tier === 'subsection' &&
      i.text === 'Legendary Actions',
  ),
  // Pre-chapter legal front matter: the p1 "Legal Information" heading and
  // the p3 erratum line, both before the first chapter heading so their
  // `section` is null. Chapter-tier titles also carry a null section by
  // construction and are excluded here — the document-structure default
  // accounts for them.
  ignoreRule('front-matter', (i) => i.section === null && i.tier !== 'chapter'),
  // The SRD prints the Lightfoot Halfling subrace heading as bare "Lightfoot";
  // the emitted record is named "Lightfoot Halfling" so auto-match misses it.
  recordRule(
    'ancestry:lightfoot-halfling',
    (i) => i.section === 'Races' && i.text === 'Lightfoot',
  ),
  // Appendix MM-B NPC stat blocks whose names collide with non-creature
  // records. Explicit structure/page mappings must outrank the generic
  // lexicographic name auto-match.
  recordRule(
    'creature:acolyte',
    (i) =>
      i.section === 'Appendix MM-B: Nonplayer Characters' &&
      i.page === 395 &&
      i.structure === 'stat-block' &&
      i.text === 'Acolyte',
  ),
  recordRule(
    'creature:druid',
    (i) =>
      i.section === 'Appendix MM-B: Nonplayer Characters' &&
      i.page === 398 &&
      i.structure === 'stat-block' &&
      i.text === 'Druid',
  ),
  // Monsters chapter heading-only family/group labels (eshyra-4a7.10.2).
  // Each taxonomy rule is accepted only when at least one emitted creature
  // carries the matching source-derived familyPath (prefix matching lets the
  // chromatic/metallic parent headings account for their nested color paths).
  ...CREATURE_TAXONOMY_SPECS.map((spec) =>
    taxonomyRule(
      spec.familyPath,
      (i) =>
        i.section === 'Monsters' &&
        i.structure === 'heading' &&
        i.tier === spec.tier &&
        i.text === spec.heading,
    ),
  ),
  // Races p3 trait-category guidance (eshyra-4a7.10.1). Explicit mappings are
  // required for Alignment / Size / Speed / Languages: name auto-match would
  // otherwise claim these source headings for unrelated rules in later
  // chapters instead of the parent-qualified racial-traits records.
  recordRule(
    'rule:racial-traits',
    (i) => i.section === 'Races' && i.text === 'Racial Traits',
  ),
  recordRule(
    'rule:ability-score-increase',
    (i) => i.section === 'Races' && i.text === 'Ability Score Increase',
  ),
  recordRule('rule:age', (i) => i.section === 'Races' && i.text === 'Age'),
  recordRule(
    'rule:racial-traits-alignment',
    (i) => i.section === 'Races' && i.text === 'Alignment',
  ),
  // The Monsters stat-block interpretation chapter has its own "Size"
  // subsection. Once the racial-traits Size record exists, generic name
  // auto-match would otherwise choose `rule:racial-traits-size` for both
  // source headings. Keep the p254 Monsters heading on its original rule.
  recordRule(
    'rule:size',
    (i) =>
      i.section === 'Monsters' &&
      i.structure === 'heading' &&
      i.text === 'Size',
  ),
  recordRule(
    'rule:racial-traits-size',
    (i) => i.section === 'Races' && i.text === 'Size',
  ),
  recordRule(
    'rule:racial-traits-speed',
    (i) => i.section === 'Races' && i.text === 'Speed',
  ),
  recordRule(
    'rule:racial-traits-languages',
    (i) => i.section === 'Races' && i.text === 'Languages',
  ),
  recordRule(
    'rule:subraces',
    (i) => i.section === 'Races' && i.text === 'Subraces',
  ),
  // The caption reads "Typical Difficulty Classes" in source; the emitted
  // table record is named "Difficulty Classes".
  recordRule(
    'table:difficulty-classes',
    (i) => i.text === 'Typical Difficulty Classes',
  ),
  // The Cleric's "Destroy Undead" table caption (p17) collides by name with
  // the `feature:cleric:destroy-undead` heading; both normalize to "destroy
  // undead", and the name auto-match would claim the table-caption item for
  // the lexicographically-first key (the feature). Map the table-caption item
  // explicitly to the emitted `table:destroy-undead` record (eshyra-4a7.6);
  // the feature HEADING item still auto-matches the feature record.
  recordRule(
    'table:destroy-undead',
    (i) =>
      i.section === 'Cleric' &&
      i.structure === 'table-caption' &&
      i.text === 'Destroy Undead',
  ),
  // The two same-caption "Draconic Ancestry" tables (eshyra-4a7.3): the name
  // auto-match cannot tell them apart and would claim both captions for one
  // record, so each chapter's caption maps explicitly to its own emitted
  // record (record rules outrank the auto-match — see the resolution order
  // above).
  recordRule(
    'table:draconic-ancestry',
    (i) =>
      i.section === 'Races' &&
      i.structure === 'table-caption' &&
      i.text === 'Draconic Ancestry',
  ),
  recordRule(
    'table:draconic-bloodline-draconic-ancestry',
    (i) =>
      i.section === 'Sorcerer' &&
      i.structure === 'table-caption' &&
      i.text === 'Draconic Ancestry',
  ),
  // Document-wide tables (eshyra-4a7.3) whose emitted record name differs
  // from the source text, so the name auto-match cannot claim them.
  ...CIRCLE_OF_THE_LAND_TABLE_TERRAINS.map(([terrain, key]) =>
    recordRule(
      key,
      (i) =>
        i.section === 'Druid' &&
        i.structure === 'table-caption' &&
        i.text === terrain,
    ),
  ),
  ...SPELL_TABLE_INVENTORY_RECORDS.map(([page, text, key]) =>
    recordRule(
      key,
      (i) => i.section === 'Spellcasting' && i.page === page && i.text === text,
    ),
  ),
  ...MAGIC_ITEM_TABLE_INVENTORY_RECORDS.map(([page, text, key]) =>
    recordRule(
      key,
      (i) => i.section === 'Magic Items' && i.page === page && i.text === text,
    ),
  ),
  // "<Race> Traits" subsection headings — traits are child data on the
  // ancestry records.
  ...RACE_TRAIT_HEADINGS.map(([heading, key]) =>
    childOfRule(key, (i) => i.section === 'Races' && i.text === heading),
  ),
  // Embedded stat blocks outside the monster chapters (Avatar of Death p218,
  // Giant Fly p222) are now emitted as `stat-block` records (eshyra-4a7.4), so
  // the name auto-match claims their `structure: 'stat-block'` inventory items —
  // no rule needed here. A NEW unmatched inline stat block (not emitted, not in
  // the reviewed map) would fail `parseStatBlocks` closed before coverage runs.
  // Creature variant sidebars (eshyra-70xr) are now emitted as `variants` child
  // data on the creature each one modifies: Diseased Giant Rats (p378) on the
  // Giant Rat, Insect Swarms (p391) on the Swarm of Insects.
  childOfRule(
    'creature:giant-rat',
    (i) => i.text === 'Variant: Diseased Giant Rats',
  ),
  childOfRule(
    'creature:swarm-of-insects',
    (i) => i.text === 'Variant: Insect Swarms',
  ),
  // --- Class chapters (eshyra-4a7.6) -------------------------------------
  // The broad class-chapter known-gap is gone; every remaining class-chapter
  // structure is now explicitly accounted. Progression-table captions ("The
  // Barbarian" … "The Wizard"), Beast Shapes, and Destroy Undead auto-match
  // their emitted `table` records (PR1). The spell-slot/resource column-header
  // FRAGMENTS of those tables are table internals, represented by the emitted
  // table record:
  ignoreRule(
    'class-progression-table-internal',
    (i) =>
      i.section !== null &&
      CLASS_CHAPTER_SECTIONS.has(i.section) &&
      i.structure === 'table-shape',
  ),
  // Feature-OPTION subheadings the SRD prints as bold leaves inside a parent
  // feature's body; parseFeatures keeps that text in the parent feature record,
  // so each maps child-of its owning feature. Fighting Styles (Fighter /
  // Paladin / Ranger), Sorcerer Metamagic, Monk ki options, and Warlock Pact
  // Boons:
  ...['Fighter', 'Paladin', 'Ranger'].map((section) =>
    childOfRule(
      `feature:${section.toLowerCase()}:fighting-style`,
      (i) =>
        i.section === section &&
        i.structure === 'heading' &&
        FIGHTING_STYLE_OPTIONS.has(i.text),
    ),
  ),
  childOfRule(
    'feature:sorcerer:metamagic',
    (i) => i.section === 'Sorcerer' && METAMAGIC_OPTIONS.has(i.text),
  ),
  childOfRule(
    'feature:monk:ki',
    (i) => i.section === 'Monk' && MONK_KI_OPTIONS.has(i.text),
  ),
  childOfRule(
    'feature:warlock:pact-boon',
    (i) => i.section === 'Warlock' && WARLOCK_PACT_OPTIONS.has(i.text),
  ),
  // The Eldritch Invocations (the p48–50 Warlock leaf headings) all live in the
  // feature:warlock:eldritch-invocations body. They are bounded by page (the
  // Pact Boon block ends on p47) with the non-invocation headings inside that
  // page span excluded: "Pact of the Tome" (a Pact Boon, handled above),
  // "Expanded Spell List" (the Fiend patron's, handled below), and "Dark One's
  // Blessing" / "Dark One's Own Luck" (The Fiend patron's own p50 features,
  // interleaved in the two-column layout with the invocation list —
  // eshyra-erf5.1; confirmed each is its own emitted
  // `feature:the-fiend:dark-ones-*` record, not part of the invocations body).
  childOfRule(
    'feature:warlock:eldritch-invocations',
    (i) =>
      i.section === 'Warlock' &&
      i.tier === 'leaf' &&
      i.structure === 'heading' &&
      i.page >= 48 &&
      i.page <= 50 &&
      i.text !== 'Pact of the Tome' &&
      i.text !== 'Expanded Spell List' &&
      i.text !== 'Dark One’s Blessing' &&
      i.text !== 'Dark One’s Own Luck',
  ),
  // Spellcasting boilerplate subsections (Preparing and Casting Spells, Ritual
  // Casting, Spellcasting Focus, Spells/Learning Spells Known of 1st Level and
  // Higher) ride in the per-class owning feature body (see the owner map).
  ...[...SPELLCASTING_BOILERPLATE_OWNER].map(([section, ownerKey]) =>
    childOfRule(
      ownerKey,
      (i) => i.section === section && SPELLCASTING_BOILERPLATE.has(i.text),
    ),
  ),
  // Sorcerer Font of Magic subsections; Cleric Divine Domain / Channel Divinity
  // subsections — each in the named feature's body.
  childOfRule(
    'feature:sorcerer:font-of-magic',
    (i) =>
      i.section === 'Sorcerer' &&
      (i.text === 'Sorcery Points' || i.text === 'Flexible Casting'),
  ),
  childOfRule(
    'feature:cleric:divine-domain',
    (i) => i.section === 'Cleric' && i.text === 'Domain Spells',
  ),
  childOfRule(
    'feature:cleric:channel-divinity',
    (i) => i.section === 'Cleric' && i.text === 'Channel Divinity: Turn Undead',
  ),
  // The generic "Oath Spells" subsection (Paladin p32) explains the oath-spell
  // mechanic and rides in the Sacred Oath feature body.
  childOfRule(
    'feature:paladin:sacred-oath',
    (i) => i.section === 'Paladin' && i.text === 'Oath Spells' && i.page === 32,
  ),
  // Subclass spell-table intro prose: the table rows are emitted as `table`
  // records and linked from the subclass, while the one-paragraph prose under
  // these headings emits as source-bounded rule records.
  recordRule(
    'rule:oath-of-devotion-oath-spells',
    (i) => i.section === 'Paladin' && i.text === 'Oath Spells' && i.page === 33,
  ),
  recordRule(
    'rule:the-fiend-expanded-spell-list',
    (i) => i.section === 'Warlock' && i.text === 'Expanded Spell List',
  ),
  // The Oath of Devotion's "Tenets of Devotion" heading: its prose (the five
  // tenets) is now represented as a named section on subclass:oath-of-devotion
  // (eshyra-citg). The heading is child data on that subclass record.
  childOfRule(
    'subclass:oath-of-devotion',
    (i) => i.section === 'Paladin' && i.text === 'Tenets of Devotion',
  ),
  // The 8 subclass-group section headings (Martial Archetypes, Sacred Oaths,
  // Arcane Traditions, …) now own their overview prose as `rule` records named
  // after the heading (eshyra-i2v4), so each auto-matches its heading by name
  // here instead of falling through to the document-structure default.
  // Diseases and poisons now own their sample guidance as rule records below.
  // "Statistics for Objects" (p203) is the body of the emitted rule:objects
  // record (its AC/HP tables are separate emitted table records).
  childOfRule('rule:objects', (i) => i.text === 'Statistics for Objects'),
  // The Poisons price/type reference table (p204): its rows land on the
  // poison hazard records as `poisonType` + `price` child data.
  ignoreRule(
    'table-rows-emitted-as-records',
    (i) => i.text === 'Poisons' && i.structure === 'table-caption',
  ),
  // Acolyte background child structures (p61): the feature heading is
  // `data.feature` and the caption-less suggested-characteristics run is
  // `data.suggestedCharacteristics` (also emitted as 4 table records).
  childOfRule(
    'background:acolyte',
    (i) =>
      i.text === 'Feature: Shelter of the Faithful' ||
      (i.structure === 'table-shape' &&
        i.context === 'Suggested Characteristics'),
  ),
  // Armor-weight category prose (p63): represented as source-bounded rule
  // records separate from the individual armor equipment records.
  recordRule(
    'rule:light-armor',
    (i) => i.section === 'Equipment' && i.text === 'Light Armor',
  ),
  recordRule(
    'rule:medium-armor',
    (i) => i.section === 'Equipment' && i.text === 'Medium Armor',
  ),
  recordRule(
    'rule:heavy-armor-category',
    (i) => i.section === 'Equipment' && i.text === 'Heavy Armor',
  ),
  // Equipment reference tables whose rows ARE the equipment records, plus
  // the column fragments of those same physical tables that surface as
  // caption-less runs in the two-column layout.
  ignoreRule(
    'table-rows-emitted-as-records',
    (i) =>
      i.section === 'Equipment' &&
      (EQUIPMENT_ROWS_AS_RECORDS_CAPTIONS.has(i.text) ||
        i.structure === 'table-shape'),
  ),
  // Equipment prose around the armor/weapon tables and the p73 sidebar
  // (eshyra-4a7.10.1). The leaf-tier Donning/Weapons captions remain owned by
  // table records; these predicates target only prose headings.
  recordRule(
    'rule:getting-into-and-out-of-armor',
    (i) =>
      i.section === 'Equipment' && i.text === 'Getting Into and Out of Armor',
  ),
  recordRule(
    'rule:selling-treasure',
    (i) => i.section === 'Equipment' && i.text === 'Selling Treasure',
  ),
  recordRule(
    'rule:armor-guidance',
    (i) =>
      i.section === 'Equipment' && i.tier === 'section' && i.text === 'Armor',
  ),
  recordRule(
    'rule:adventuring-gear',
    (i) => i.section === 'Equipment' && i.text === 'Adventuring Gear',
  ),
  recordRule(
    'rule:equipment-packs',
    (i) => i.section === 'Equipment' && i.text === 'Equipment Packs',
  ),
  recordRule(
    'rule:tools',
    (i) =>
      i.section === 'Equipment' && i.tier === 'section' && i.text === 'Tools',
  ),
  recordRule(
    'rule:mounts-and-vehicles',
    (i) => i.section === 'Equipment' && i.text === 'Mounts and Vehicles',
  ),
  recordRule(
    'rule:trade-goods',
    (i) =>
      i.section === 'Equipment' &&
      i.tier === 'section' &&
      i.text === 'Trade Goods',
  ),
  recordRule(
    'rule:expenses',
    (i) =>
      i.section === 'Equipment' &&
      i.tier === 'section' &&
      i.text === 'Expenses',
  ),
  recordRule(
    'rule:expenses-lifestyle-expenses',
    (i) =>
      i.section === 'Equipment' &&
      i.tier === 'subsection' &&
      i.text === 'Lifestyle Expenses',
  ),
  recordRule(
    'rule:food-drink-and-lodging',
    (i) =>
      i.section === 'Equipment' &&
      i.tier === 'subsection' &&
      i.text === 'Food, Drink, and Lodging',
  ),
  recordRule(
    'rule:services',
    (i) =>
      i.section === 'Equipment' &&
      i.tier === 'subsection' &&
      i.text === 'Services',
  ),
  recordRule(
    'rule:diseases',
    (i) => i.tier === 'section' && i.text === 'Diseases',
  ),
  recordRule('rule:sample-diseases', (i) => i.text === 'Sample Diseases'),
  recordRule(
    'rule:poisons',
    (i) => i.tier === 'section' && i.text === 'Poisons',
  ),
  recordRule('rule:sample-poisons', (i) => i.text === 'Sample Poisons'),
  recordRule(
    'rule:weapons',
    (i) =>
      i.section === 'Equipment' &&
      i.structure === 'heading' &&
      i.tier === 'subsection' &&
      i.text === 'Weapons',
  ),
  recordRule(
    'rule:weapon-proficiency',
    (i) => i.section === 'Equipment' && i.text === 'Weapon Proficiency',
  ),
  recordRule(
    'rule:weapon-properties',
    (i) => i.section === 'Equipment' && i.text === 'Weapon Properties',
  ),
  recordRule(
    'rule:improvised-weapons',
    (i) => i.section === 'Equipment' && i.text === 'Improvised Weapons',
  ),
  recordRule(
    'rule:silvered-weapons',
    (i) => i.section === 'Equipment' && i.text === 'Silvered Weapons',
  ),
  recordRule(
    'rule:special-weapons',
    (i) => i.section === 'Equipment' && i.text === 'Special Weapons',
  ),
  recordRule(
    'rule:self-sufficiency',
    (i) => i.section === 'Equipment' && i.text === 'Self-Sufficiency',
  ),
  // Monsters pp320-321 Half-Dragon Template region (eshyra-4a7.10.3).
  // The subsection heading auto-matches its rule record by name; the two
  // caption-less table runs need explicit mappings to their synthesized names.
  recordRule(
    'table:half-dragon-damage-resistance',
    (i) =>
      i.section === 'Monsters' &&
      i.structure === 'table-shape' &&
      i.context === 'Half-Dragon Template' &&
      i.text === 'Color Damage Resistance',
  ),
  recordRule(
    'table:half-dragon-breath-weapon',
    (i) =>
      i.section === 'Monsters' &&
      i.structure === 'table-shape' &&
      i.context === 'Half-Dragon Template' &&
      i.text === 'Optional',
  ),
  // Magic Items pp251-252 "Sentient Magic Items" DM construction guidance
  // (eshyra-4a7.10.4). The region's prose headings auto-match the emitted rules
  // by name (Sentient Magic Items, Creating Sentient Magic Items, Abilities,
  // Communication, Special Purpose, Conflict); only the two collision titles
  // need explicit mappings. "Senses" emits the parent-qualified
  // `rule:creating-sentient-magic-items-senses`, which sorts before
  // `rule:senses` and would otherwise steal the Monsters stat-block "Senses"
  // heading by name auto-match — so both Senses headings are pinned. "Alignment"
  // emits `rule:creating-sentient-magic-items-alignment`, which sorts AFTER the
  // Beyond-1st-Level `rule:alignment` the bare name auto-matches, so the Magic
  // Items heading must be pinned to its own record. The four roll tables in this
  // region stay owned by the `table` kind (the `table:sentient-magic-item-*`
  // record rules above).
  recordRule(
    'rule:creating-sentient-magic-items-senses',
    (i) => i.section === 'Magic Items' && i.text === 'Senses',
  ),
  recordRule(
    'rule:senses',
    (i) =>
      i.section === 'Monsters' &&
      i.structure === 'heading' &&
      i.text === 'Senses',
  ),
  recordRule(
    'rule:creating-sentient-magic-items-alignment',
    (i) => i.section === 'Magic Items' && i.text === 'Alignment',
  ),
  // Appendix PH-C p364 "Outer Planes" same-name headings (eshyra-4a7.10.5).
  // The SRD prints the title "Outer Planes" twice: an h≈13.9 subsection under
  // "Beyond the Material" and an h≈12 sub-leaf below it. Both emit distinct
  // rule records (parent-qualified keys), but they share the normalized name
  // "outer planes", so the bare name auto-match would collapse BOTH source
  // headings onto the lexicographically-first key
  // (`rule:beyond-the-material-outer-planes`). Pin each heading to its
  // source-correct record by tier — the same disambiguation used for the
  // Equipment "Weapons" subsection vs. its leaf table caption, and the two
  // "Senses" headings.
  recordRule(
    'rule:beyond-the-material-outer-planes',
    (i) =>
      (i.section?.startsWith('Appendix PH-C') ?? false) &&
      i.structure === 'heading' &&
      i.tier === 'subsection' &&
      i.text === 'Outer Planes',
  ),
  recordRule(
    'rule:outer-planes-outer-planes',
    (i) =>
      (i.section?.startsWith('Appendix PH-C') ?? false) &&
      i.structure === 'heading' &&
      i.tier === 'leaf' &&
      i.text === 'Outer Planes',
  ),
  // Appendix PH-B deity-table column-group header (eshyra-4a7.10.5). The four
  // pantheon-prose headings and four "<Pantheon> Deities" captions auto-match
  // their emitted records; the deity tables themselves are reconstructed by
  // `parseDeityTables` and own the Deity/Alignment/Suggested Domains/Symbol
  // columns. The lone remaining inventory item is the right-side column-group
  // header the extractor surfaces as a standalone table-shape — a table
  // internal of those emitted tables, not its own record.
  ignoreRule(
    'deity-table-column-header',
    (i) =>
      (i.section?.startsWith('Appendix PH-B') ?? false) &&
      i.text === 'Suggested Domains Symbol',
  ),
  // p78 "Skills" per-ability bullet captions (eshyra-erf5.1). Ability Checks'
  // "Skills" subsection prints five h≈12 leaf captions ("Strength",
  // "Dexterity", "Intelligence", "Wisdom", "Charisma" — Constitution has none)
  // each followed by a bulleted skill list; `parseRules`'
  // `bodyLeadsWithBullet` deliberately excludes them from becoming their own
  // `rule` records because they are list scaffolding, not adjudication prose,
  // and `rule:skills` carries the reconstructed mapping as structured data
  // instead (see `SRD_5_1_SKILL_ABILITIES` / `buildSkillsByAbility`). Without
  // this rule the bare-name auto-match would silently count each caption as
  // covered by the unrelated p79+ "Using Each Ability" record of the same
  // name (`rule:strength`, `rule:dexterity`, ...), whose body never mentions
  // skills at all.
  childOfRule(
    'rule:skills',
    (i) =>
      i.section === 'Using Ability Scores' &&
      i.tier === 'leaf' &&
      i.structure === 'heading' &&
      SKILL_CAPTION_ABILITY_NAMES.has(i.text),
  ),
];
