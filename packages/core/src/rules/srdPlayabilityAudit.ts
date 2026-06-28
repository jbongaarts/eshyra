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
 *   - untyped-progression-marker  — RED  (~47 rows)  → eshyra-o9bd.2
 *   - null-spellcasting-value     — RED  (Ranger L1) → eshyra-o9bd.2
 *   - missing-class-feature-record— RED  (Thieves' Cant) → eshyra-o9bd.3
 *   - overlay-dependence          — RED  (ASIs/languages/spellcasting/equipment) → eshyra-o9bd.5
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

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
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

// A class progression row, read defensively off the generated `data`.
interface ProgressionRow {
  readonly level?: unknown;
  readonly features?: unknown;
  readonly spellcasting?: unknown;
}

function classProgressionRows(record: RulesRecord): ProgressionRow[] | null {
  if (record.kind !== 'class') return null;
  const data = dataObject(record);
  if (data === null || !Array.isArray(data.progression)) return null;
  return data.progression as ProgressionRow[];
}

function rowLevelLabel(row: ProgressionRow): string {
  return typeof row.level === 'number' ? String(row.level) : '(unknown)';
}

function rowFeatures(row: ProgressionRow): Record<string, unknown>[] {
  if (!Array.isArray(row.features)) return [];
  return row.features
    .map(asObject)
    .filter((f): f is Record<string, unknown> => f !== null);
}

/**
 * A feature entry is "typed" when the level-up engine can apply it
 * deterministically: it either carries a feature `ref`, or it is an explicitly
 * typed subclass-feature slot (the structured shape eshyra-o9bd.2 introduces).
 */
function isTypedFeatureEntry(entry: Record<string, unknown>): boolean {
  if (asString(entry.ref) !== null) return true;
  if (entry.subclassFeatureSlot === true) return true;
  if (asString(entry.slotName) !== null) return true;
  if (entry.slot === 'subclass') return true;
  return false;
}

// Numeric spellcasting fields whose `null` placeholder a level-up engine
// cannot apply (the Ranger level-1 `spellsKnown: null` class).
const SPELLCASTING_NUMERIC_FIELDS = [
  'cantripsKnown',
  'spellsKnown',
  'spellsPrepared',
] as const;

const PROFICIENCY_FIELDS = [
  'armorProficiencies',
  'weaponProficiencies',
  'toolProficiencies',
  'savingThrowProficiencies',
] as const;

// A parenthetical that carries a mechanical caveat (Druid metal restriction
// style) rather than a benign clarifier. Kept conservative to avoid flagging
// ordinary parentheticals like "(a) a shield".
const MECHANICAL_PAREN_NOTE =
  /\([^)]*\b(?:will not|won't|cannot|can't|made of|except|but not|unless|instead of|in place of)\b[^)]*\)/i;

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
    for (const entry of rowFeatures(row)) {
      if (isTypedFeatureEntry(entry)) continue;
      const name = asString(entry.name) ?? '(unnamed)';
      findings.push({
        category: 'untyped-progression-marker',
        key: record.key,
        kind: record.kind,
        name: record.name,
        bead: 'eshyra-o9bd.2',
        detail: `level ${rowLevelLabel(row)} feature marker "${name}" has no feature ref and is not a typed subclass slot`,
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
    const spellcasting = asObject(row.spellcasting);
    if (spellcasting === null) continue;
    for (const field of SPELLCASTING_NUMERIC_FIELDS) {
      if (field in spellcasting && spellcasting[field] === null) {
        findings.push({
          category: 'null-spellcasting-value',
          key: record.key,
          kind: record.kind,
          name: record.name,
          bead: 'eshyra-o9bd.2',
          detail: `level ${rowLevelLabel(row)} spellcasting.${field} is null (malformed placeholder a level-up engine cannot apply)`,
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Gate: missing class feature record (eshyra-o9bd.3)
// ---------------------------------------------------------------------------

// The last `:`-segment of every feature key, slugged — the set of feature
// "headings" the pack actually owns as records.
function featureHeadingSlugs(pack: RulesPack): ReadonlySet<string> {
  const slugs = new Set<string>();
  for (const record of pack.records) {
    if (record.kind !== 'feature') continue;
    const segment = record.key.slice(record.key.lastIndexOf(':') + 1);
    slugs.add(slug(segment));
    slugs.add(slug(record.name));
  }
  return slugs;
}

/**
 * A no-ref progression marker that is not a generic subclass slot
 * ("... feature"), not an improvement, and not spellcasting/alias-shaped, yet
 * names no feature record the pack owns — i.e. a missing feature heading
 * (Rogue's Thieves' Cant). Distinct from the broad untyped-marker gate because
 * its fix is a NEW record (eshyra-o9bd.3), not just typing the marker.
 */
function checkMissingClassFeatureRecords(
  pack: RulesPack,
): SrdPlayabilityFinding[] {
  const owned = featureHeadingSlugs(pack);
  const findings: SrdPlayabilityFinding[] = [];
  for (const record of pack.records) {
    const rows = classProgressionRows(record);
    if (rows === null) continue;
    for (const row of rows) {
      for (const entry of rowFeatures(row)) {
        if (asString(entry.ref) !== null) continue;
        const name = asString(entry.name);
        if (name === null) continue;
        const lower = name.toLowerCase();
        if (lower.endsWith('feature')) continue; // subclass/archetype slot label
        if (lower.includes('improvement')) continue; // feature improvement
        if (lower.includes('spell')) continue; // spellcasting / Signature Spell alias
        if (owned.has(slug(name))) continue; // a record already owns this heading
        findings.push({
          category: 'missing-class-feature-record',
          key: record.key,
          kind: record.kind,
          name: record.name,
          bead: 'eshyra-o9bd.3',
          detail: `level ${rowLevelLabel(row)} marker "${name}" names no feature record (missing heading)`,
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Gate: overlay dependence (eshyra-o9bd.5)
// ---------------------------------------------------------------------------

function isSpellcastingClass(rows: readonly ProgressionRow[]): boolean {
  return rows.some((row) => asObject(row.spellcasting) !== null);
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
      if (typeof token === 'string' && MECHANICAL_PAREN_NOTE.test(token)) {
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
