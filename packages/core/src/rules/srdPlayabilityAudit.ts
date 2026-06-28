/**
 * Playable-model audit gates for the D&D 5e SRD rules pack (eshyra-o9bd.11).
 *
 * `srdAudit.ts` answers "is the source represented somewhere?" (archival /
 * source-complete bar). These gates answer the stricter re-audit question: can
 * the generated pack DRIVE character creation and level-up without consumer-side
 * hardcoding or prose guessing (the *complete-accurate-playable* bar of epic
 * eshyra-o9bd)?
 *
 * Each gate turns a known playable-model deficiency into a machine-checkable
 * finding, so the modeling beads (eshyra-o9bd.2/.3/.5/.6) have an objective
 * definition of done: the gate is RED against the current thawed pack and goes
 * GREEN when the owning bead lands. Every finding carries its owning `bead` so a
 * report reads as a punch list.
 *
 * These are intentionally SEPARATE from `auditSrdStructure`: the structure audit
 * feeds the strict freeze-bundle gate and its categories are pinned empty on the
 * committed pack. Folding RED playable-model findings into it would break those
 * green assertions. This module is the additive, re-audit-only surface.
 *
 * Gate coverage status (2026-06-28, verified against the committed pack):
 *   - untyped-progression-marker  — GREEN (typed advancement[]) → eshyra-o9bd.2
 *   - null-spellcasting-value     — GREEN (non-applicable values omitted) → eshyra-o9bd.2
 *   - missing-class-feature-record— GREEN (Thieves' Cant owned) → eshyra-o9bd.3
 *   - overlay-dependence          — GREEN (creation facts emitted) → eshyra-o9bd.5
 *   - proficiency-note-bleed      — GREEN (already lifted to proficiencyNotes) → eshyra-o9bd.6 regression guard
 *
 * Deferred to their owning modeling beads (their gate is that bead's own
 * acceptance check and needs its modeling decisions):
 *   - feature/table de-flatten + tableRefs completeness → eshyra-o9bd.8
 *   - choice-coverage (every level-1/level-up choice structured) → eshyra-o9bd.9
 *
 * Everything is pure and deterministic; findings are sorted for diffable output.
 */

import type { RulesPack, RulesRecord } from './types.js';

// ---------------------------------------------------------------------------
// Finding model
// ---------------------------------------------------------------------------

export type SrdPlayabilityCategory =
  | 'untyped-progression-marker'
  | 'null-spellcasting-value'
  | 'missing-class-feature-record'
  | 'overlay-dependence'
  | 'proficiency-note-bleed';

export interface SrdPlayabilityFinding {
  readonly category: SrdPlayabilityCategory;
  /** Owning record key. */
  readonly key: string;
  readonly kind: string;
  readonly name: string;
  /** Actionable description naming the offending field/value. */
  readonly detail: string;
  /** The modeling bead responsible for driving this finding to zero. */
  readonly bead: string;
}

export interface SrdPlayabilityAudit {
  readonly packId: string;
  readonly findings: readonly SrdPlayabilityFinding[];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function dataObject(record: RulesRecord): Record<string, unknown> | null {
  const data = record.data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }
  return data as Record<string, unknown>;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function nonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function sortFindings(
  findings: readonly SrdPlayabilityFinding[],
): readonly SrdPlayabilityFinding[] {
  return [...findings].sort((a, b) => {
    if (a.category !== b.category) return a.category < b.category ? -1 : 1;
    if (a.key !== b.key) return a.key < b.key ? -1 : 1;
    return a.detail < b.detail ? -1 : a.detail > b.detail ? 1 : 0;
  });
}

// A class progression row, read defensively off the generated `data`. Rows
// carry a typed `advancement[]` discriminated union (eshyra-o9bd.2).
interface ProgressionRow {
  readonly level?: unknown;
  readonly advancement?: unknown;
}

/** The advancement-entry kinds the level-up engine knows how to apply. */
const KNOWN_ADVANCEMENT_KINDS: ReadonlySet<string> = new Set([
  'featureGrant',
  'subclassFeatureSlot',
  'featureImprovement',
  'resourceProgression',
  'spellcastingProgression',
]);

// Numeric spellcasting fields whose `null` placeholder a level-up engine
// cannot apply (the Ranger level-1 `spellsKnown: null` class).
const SPELLCASTING_NUMERIC_FIELDS = [
  'cantripsKnown',
  'spellsKnown',
  'spellsPrepared',
  'invocationsKnown',
] as const;

function classProgressionRows(record: RulesRecord): ProgressionRow[] | null {
  if (record.kind !== 'class') return null;
  const data = dataObject(record);
  if (data === null || !Array.isArray(data.progression)) return null;
  return data.progression as ProgressionRow[];
}

function rowLevelLabel(row: ProgressionRow): string {
  return typeof row.level === 'number' ? String(row.level) : '(unknown)';
}

function rowAdvancement(row: ProgressionRow): Record<string, unknown>[] {
  if (!Array.isArray(row.advancement)) return [];
  return row.advancement
    .map(asObject)
    .filter((e): e is Record<string, unknown> => e !== null);
}

const PROFICIENCY_FIELDS = [
  'armorProficiencies',
  'weaponProficiencies',
  'toolProficiencies',
  'savingThrowProficiencies',
] as const;

// A mechanical caveat keyword (Druid metal restriction style), distinct from a
// benign clarifier like "(a) a shield". The bare alternation of literals with
// word boundaries has no quantifier ambiguity, so it scans linearly.
const MECHANICAL_NOTE_KEYWORD =
  /\b(?:will not|won't|cannot|can't|made of|except|but not|unless|instead of|in place of)\b/i;

/**
 * True when `token` contains a parenthetical group carrying a mechanical
 * caveat. Parentheticals are extracted with linear `indexOf` scans rather than
 * a `\(...\)` regex, which avoids the polynomial backtracking CodeQL flags on
 * inputs with many unmatched '(' characters.
 */
function hasMechanicalParenNote(token: string): boolean {
  let from = 0;
  while (true) {
    const open = token.indexOf('(', from);
    if (open === -1) return false;
    const close = token.indexOf(')', open + 1);
    if (close === -1) return false;
    if (MECHANICAL_NOTE_KEYWORD.test(token.slice(open + 1, close))) {
      return true;
    }
    from = close + 1;
  }
}

// ---------------------------------------------------------------------------
// Gate: untyped progression markers (eshyra-o9bd.2)
// ---------------------------------------------------------------------------

function checkUntypedProgressionMarkers(
  record: RulesRecord,
): SrdPlayabilityFinding[] {
  const rows = classProgressionRows(record);
  if (rows === null) return [];
  const findings: SrdPlayabilityFinding[] = [];
  for (const row of rows) {
    // Every row must carry a typed advancement[] array (no row should fall back
    // to an untyped feature list). A missing array is itself a finding so the
    // gate cannot pass vacuously when the schema is wrong.
    if (!Array.isArray(row.advancement)) {
      findings.push({
        category: 'untyped-progression-marker',
        key: record.key,
        kind: record.kind,
        name: record.name,
        bead: 'eshyra-o9bd.2',
        detail: `level ${rowLevelLabel(row)} has no typed advancement[] array`,
      });
      continue;
    }
    for (const entry of rowAdvancement(row)) {
      const entryKind = asString(entry.kind);
      if (entryKind !== null && KNOWN_ADVANCEMENT_KINDS.has(entryKind)) {
        continue;
      }
      findings.push({
        category: 'untyped-progression-marker',
        key: record.key,
        kind: record.kind,
        name: record.name,
        bead: 'eshyra-o9bd.2',
        detail: `level ${rowLevelLabel(row)} advancement entry has an unknown/missing kind ${JSON.stringify(entry.kind)}`,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Gate: null spellcasting placeholders (eshyra-o9bd.2)
// ---------------------------------------------------------------------------

function checkNullSpellcasting(record: RulesRecord): SrdPlayabilityFinding[] {
  const rows = classProgressionRows(record);
  if (rows === null) return [];
  const findings: SrdPlayabilityFinding[] = [];
  for (const row of rows) {
    for (const entry of rowAdvancement(row)) {
      if (entry.kind !== 'spellcastingProgression') continue;
      for (const field of SPELLCASTING_NUMERIC_FIELDS) {
        if (field in entry && entry[field] === null) {
          findings.push({
            category: 'null-spellcasting-value',
            key: record.key,
            kind: record.kind,
            name: record.name,
            bead: 'eshyra-o9bd.2',
            detail: `level ${rowLevelLabel(row)} spellcastingProgression.${field} is null (malformed placeholder a level-up engine cannot apply)`,
          });
        }
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Gate: missing class feature record (eshyra-o9bd.3)
// ---------------------------------------------------------------------------

/**
 * Every feature granted or improved by a class progression row must resolve to
 * a `feature:` record the pack owns. A dangling `featureGrant`/`featureImprovement`
 * ref means a missing feature record — the Rogue Thieves' Cant class
 * (eshyra-o9bd.3). Replaces the old name-heuristic with real ref reachability.
 */
function checkMissingClassFeatureRecords(
  pack: RulesPack,
): SrdPlayabilityFinding[] {
  const featureKeys = new Set(
    pack.records.filter((r) => r.kind === 'feature').map((r) => r.key),
  );
  const findings: SrdPlayabilityFinding[] = [];
  for (const record of pack.records) {
    const rows = classProgressionRows(record);
    if (rows === null) continue;
    for (const row of rows) {
      for (const entry of rowAdvancement(row)) {
        const refs: string[] = [];
        if (entry.kind === 'featureGrant') {
          const ref = asString(entry.ref);
          if (ref !== null) refs.push(ref);
        } else if (
          entry.kind === 'featureImprovement' &&
          Array.isArray(entry.targetRefs)
        ) {
          for (const target of entry.targetRefs) {
            const ref = asString(target);
            if (ref !== null) refs.push(ref);
          }
        }
        for (const ref of refs) {
          if (featureKeys.has(ref)) continue;
          findings.push({
            category: 'missing-class-feature-record',
            key: record.key,
            kind: record.kind,
            name: record.name,
            bead: 'eshyra-o9bd.3',
            detail: `level ${rowLevelLabel(row)} references '${ref}', but no feature record owns it`,
          });
        }
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Gate: overlay dependence (eshyra-o9bd.5)
// ---------------------------------------------------------------------------

function isSpellcastingClass(rows: readonly ProgressionRow[]): boolean {
  return rows.some((row) =>
    rowAdvancement(row).some(
      (entry) => entry.kind === 'spellcastingProgression',
    ),
  );
}

function hasStructuredStartingEquipment(value: unknown): boolean {
  const obj = asObject(value);
  if (obj === null) return false;
  // The frozen pack carries `startingEquipment.entries` as PROSE strings (e.g.
  // "(a) a quarterstaff or (b) a dagger") plus a `text` blob — neither is
  // machine-readable. Structured equipment is the existing overlay's shape
  // (srdClassStartingEquipment.ts): an `entries[]` of typed objects, each a
  // choose-one group `{ kind: 'choice', options[] }` or a fixed grant
  // `{ kind: 'fixed', text }`. eshyra-o9bd.5 absorbs the overlay into this
  // field, so the gate goes green exactly when the pack adopts that shape.
  if (!Array.isArray(obj.entries) || obj.entries.length === 0) return false;
  return obj.entries.every((entry) => {
    const e = asObject(entry);
    if (e === null) return false;
    if (e.kind === 'choice') return nonEmptyArray(e.options);
    if (e.kind === 'fixed') return asString(e.text) !== null;
    return false;
  });
}

/**
 * Required machine-readable character-creation facts that today live only in
 * the consumer-side overlays (srdAncestryAbilityScoreIncreases / srdLanguages /
 * srdClassSpellcasting / srdClassStartingEquipment) because the pack lacks them.
 * eshyra-o9bd.5 absorbs each into generated pack data.
 */
function checkOverlayDependence(record: RulesRecord): SrdPlayabilityFinding[] {
  const findings: SrdPlayabilityFinding[] = [];
  const push = (detail: string): void => {
    findings.push({
      category: 'overlay-dependence',
      key: record.key,
      kind: record.kind,
      name: record.name,
      bead: 'eshyra-o9bd.5',
      detail,
    });
  };

  if (record.kind === 'ancestry') {
    const data = dataObject(record);
    if (data === null) return findings;
    if (!nonEmptyArray(data.abilityScoreIncreases)) {
      push(
        'ancestry has no structured abilityScoreIncreases (ASIs are prose-only)',
      );
    }
    if (!nonEmptyArray(data.languages)) {
      push(
        'ancestry has no structured languages grant (languages are prose-only)',
      );
    }
    return findings;
  }

  if (record.kind === 'background') {
    const data = dataObject(record);
    if (data === null) return findings;
    if (!nonEmptyArray(data.languages)) {
      push(
        'background has no structured languages grant (languages are prose-only)',
      );
    }
    return findings;
  }

  if (record.kind === 'class') {
    const data = dataObject(record);
    if (data === null) return findings;
    const rows = Array.isArray(data.progression)
      ? (data.progression as ProgressionRow[])
      : [];
    if (
      isSpellcastingClass(rows) &&
      asString(data.spellcastingAbility) === null
    ) {
      push(
        'spellcasting class has no spellcastingAbility (ability/prep formula is overlay-only)',
      );
    }
    if (!hasStructuredStartingEquipment(data.startingEquipment)) {
      push(
        'startingEquipment is prose-only (entries are not typed choice/fixed grants)',
      );
    }
    return findings;
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Gate: proficiency-note bleed (eshyra-o9bd.6 regression guard)
// ---------------------------------------------------------------------------

function checkProficiencyNoteBleed(
  record: RulesRecord,
): SrdPlayabilityFinding[] {
  if (record.kind !== 'class') return [];
  const data = dataObject(record);
  if (data === null) return [];
  const findings: SrdPlayabilityFinding[] = [];
  for (const field of PROFICIENCY_FIELDS) {
    const tokens = data[field];
    if (!Array.isArray(tokens)) continue;
    for (const token of tokens) {
      if (typeof token === 'string' && hasMechanicalParenNote(token)) {
        findings.push({
          category: 'proficiency-note-bleed',
          key: record.key,
          kind: record.kind,
          name: record.name,
          bead: 'eshyra-o9bd.6',
          detail: `${field} token "${token}" carries a parenthetical mechanical note; lift it to proficiencyNotes`,
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Aggregate + reporting
// ---------------------------------------------------------------------------

/**
 * Run every playable-model gate over the pack and return the combined, sorted
 * findings. Empty means the pack passes the playable-model bar that the
 * gates currently cover.
 */
export function auditSrdPlayability(
  pack: RulesPack,
): readonly SrdPlayabilityFinding[] {
  const findings: SrdPlayabilityFinding[] = [];
  for (const record of pack.records) {
    findings.push(...checkUntypedProgressionMarkers(record));
    findings.push(...checkNullSpellcasting(record));
    findings.push(...checkOverlayDependence(record));
    findings.push(...checkProficiencyNoteBleed(record));
  }
  findings.push(...checkMissingClassFeatureRecords(pack));
  return sortFindings(findings);
}

/** True when the pack has any playable-model finding — use for re-freeze gating. */
export function srdPlayabilityHasFindings(
  findings: readonly SrdPlayabilityFinding[],
): boolean {
  return findings.length > 0;
}

/** Count findings per category, for baseline/report use. */
export function countSrdPlayabilityByCategory(
  findings: readonly SrdPlayabilityFinding[],
): Readonly<Record<SrdPlayabilityCategory, number>> {
  const counts: Record<SrdPlayabilityCategory, number> = {
    'untyped-progression-marker': 0,
    'null-spellcasting-value': 0,
    'missing-class-feature-record': 0,
    'overlay-dependence': 0,
    'proficiency-note-bleed': 0,
  };
  for (const finding of findings) {
    counts[finding.category] += 1;
  }
  return counts;
}

/** Human-readable punch-list report grouped by category, with owning beads. */
export function formatSrdPlayabilityReport(
  packId: string,
  findings: readonly SrdPlayabilityFinding[],
): string {
  const lines: string[] = [];
  lines.push(`SRD playable-model audit for pack: ${packId}`);
  lines.push(`Findings: ${findings.length}`);
  lines.push('');
  if (findings.length === 0) {
    lines.push('  (no findings — playable-model gates pass)');
    return `${lines.join('\n')}\n`;
  }
  const byCategory = new Map<SrdPlayabilityCategory, SrdPlayabilityFinding[]>();
  for (const finding of findings) {
    const bucket = byCategory.get(finding.category) ?? [];
    bucket.push(finding);
    byCategory.set(finding.category, bucket);
  }
  for (const category of [...byCategory.keys()].sort()) {
    const bucket = byCategory.get(category) ?? [];
    lines.push(`${category}: ${bucket.length} (owner: ${bucket[0]?.bead})`);
    for (const finding of bucket) {
      lines.push(`  ${finding.key} — ${finding.detail}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
