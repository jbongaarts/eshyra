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
 *   - choice-coverage             — GREEN (all modeling slices landed) → eshyra-o9bd.9
 *
 * The choice-coverage gate (eshyra-o9bd.9.1) lands the schema (`feature.data.choices[]`),
 * the named out-of-scope marker convention, and the detector. Its five modeling
 * slices (eshyra-o9bd.9.2 subclass · .9.3 spells/cantrips · .9.4 ASI-vs-feat ·
 * .9.5 fighting-style/metamagic/invocations/terrain-enemy · .9.6 subclass-feature
 * options) have all landed via the `deriveFeatureChoices` importer pass, so every
 * granted class-feature build choice now carries a structured `choices[]` entry
 * or a named out-of-scope marker. The committed pack clears epic bar #9.
 *
 * Deferred to its owning modeling beads (their gate is that bead's own
 * acceptance check and needs its modeling decisions):
 *   - feature/table de-flatten + tableRefs completeness → eshyra-o9bd.8
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
  | 'proficiency-note-bleed'
  | 'choice-coverage';

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

function hasStructuredSpellPreparation(value: unknown): boolean {
  return asObject(value) !== null;
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
    if (isSpellcastingClass(rows)) {
      if (asString(data.spellcastingAbility) === null) {
        push(
          'spellcasting class has no spellcastingAbility (ability/prep formula is overlay-only)',
        );
      }
      if (!hasStructuredSpellPreparation(data.spellPreparation)) {
        push(
          'spellcasting class has no structured spellPreparation (prepared/known/spellbook metadata is overlay-only)',
        );
      }
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
// Gate: choice coverage (eshyra-o9bd.9)
// ---------------------------------------------------------------------------

/**
 * A prose signal that a class feature requires a player build choice at
 * creation/level-up, with the choice `category` it implies and the modeling
 * bead that owns making it structured. The gate is RED while a matched feature
 * carries no `choices` entry of that category (structured or a named
 * `unsupported` marker); the owning slice flips it GREEN.
 *
 * Detection is intentionally generous: a false positive is resolved the same
 * way as a true one — model the choice or mark it out of scope — so over-
 * detection only lengthens the punch list, never hides a gap. Known
 * choice-bearing features are pinned in the audit tests so the important cases
 * cannot be silently under-detected.
 */
interface ChoiceSignal {
  readonly category: string;
  readonly bead: string;
  readonly test: RegExp;
}

// Subclass selection is detected STRUCTURALLY (checkSubclassChoiceCoverage),
// not by prose keyword: the SRD selector features word the choice too
// inconsistently ("choose a path", "Choose one domain", "such as Champion") to
// match reliably, and a missed class would let the slice pass with a gap. The
// signals below are description heuristics tuned to the actual SRD phrasing of
// each choice so the known choice-bearing features cannot be under-detected.
const CHOICE_SIGNALS: readonly ChoiceSignal[] = [
  // Cantrip / spell selection on a caster feature ("cantrips of your choice",
  // "spells of your choice"). Clerics/Druids/Paladins PREPARE from the full
  // list (no spells-known choice), so their Spellcasting prose matches `cantrip`
  // but not `spell` — which is the correct distinction.
  {
    category: 'cantrip',
    bead: 'eshyra-o9bd.9.3',
    test: /\bcantrips?\b[^.]*\bof your choice\b/i,
  },
  {
    category: 'spell',
    bead: 'eshyra-o9bd.9.3',
    test: /\bspells?\b[^.]*\bof your choice\b/i,
  },
  // Ability Score Improvement vs feat.
  {
    category: 'asiOrFeat',
    bead: 'eshyra-o9bd.9.4',
    test: /increase (?:one ability score|two ability scores)|ability scores? of your choice/i,
  },
  // Fighting Style / Metamagic / Eldritch Invocations / Ranger terrain-enemy.
  {
    category: 'fightingStyle',
    bead: 'eshyra-o9bd.9.5',
    test: /\bfighting style\b/i,
  },
  {
    category: 'metamagic',
    bead: 'eshyra-o9bd.9.5',
    test: /\bmetamagic\b/i,
  },
  {
    category: 'invocation',
    bead: 'eshyra-o9bd.9.5',
    test: /\beldritch invocations?\b/i,
  },
  // Tightened to the ACT of choosing the enemy/terrain so foe-slayer /
  // primeval-awareness (which only reference an already-chosen favored
  // enemy/terrain) are not mistaken for choices.
  {
    category: 'favoredEnemy',
    bead: 'eshyra-o9bd.9.5',
    test: /choose [^.]*\bfavored enem(?:y|ies)\b|select two races/i,
  },
  {
    category: 'naturalExplorer',
    bead: 'eshyra-o9bd.9.5',
    test: /choose [^.]*\bfavored terrain\b/i,
  },
  // Subclass-feature options. Channel Divinity menus are matched by name;
  // Expertise is matched by its prose ("choose two of your skill
  // proficiencies") because the feature body never says "expertise".
  {
    category: 'channelDivinity',
    bead: 'eshyra-o9bd.9.6',
    test: /\bchannel divinity\b/i,
  },
  {
    category: 'expertise',
    bead: 'eshyra-o9bd.9.6',
    test: /choose [^.]*\bskill proficiencies\b/i,
  },
];

/** Class-feature keys granted by any class progression row, with the earliest
 * grant level — the in-scope universe for choice coverage (a feature the player
 * actually gains at creation or level-up). */
function grantedClassFeatureLevels(pack: RulesPack): Map<string, number> {
  const levels = new Map<string, number>();
  for (const record of pack.records) {
    const rows = classProgressionRows(record);
    if (rows === null) continue;
    for (const row of rows) {
      const level = typeof row.level === 'number' ? row.level : null;
      for (const entry of rowAdvancement(row)) {
        if (entry.kind !== 'featureGrant') continue;
        const ref = asString(entry.ref);
        if (ref === null || level === null) continue;
        const prior = levels.get(ref);
        if (prior === undefined || level < prior) levels.set(ref, level);
      }
    }
  }
  return levels;
}

/** The set of choice categories a feature record already addresses (structured
 * or via an `unsupported` marker). */
function modeledChoiceCategories(record: RulesRecord): ReadonlySet<string> {
  const data = dataObject(record);
  const out = new Set<string>();
  if (data === null || !Array.isArray(data.choices)) return out;
  for (const entry of data.choices) {
    const obj = asObject(entry);
    const category = obj === null ? null : asString(obj.category);
    if (category !== null) out.add(category);
  }
  return out;
}

/**
 * Subclass selection is a player choice at the level the class first picks its
 * archetype/domain/path. It is checked per class rather than by feature prose:
 * a class that owns subclass records (by `parentClass`) must have at least one
 * GRANTED feature carrying a structured `subclass` choice (or an out-of-scope
 * marker). This is robust where the selector feature's prose varies
 * ("Primal Path", "Divine Domain", "such as Champion"). The owning slice
 * (eshyra-o9bd.9.2) attaches the choice to the selector feature; the gate only
 * verifies the class collectively covers it.
 */
function checkSubclassChoiceCoverage(pack: RulesPack): SrdPlayabilityFinding[] {
  const subclassParents = new Set<string>();
  for (const record of pack.records) {
    if (record.kind !== 'subclass') continue;
    const data = dataObject(record);
    const parent = data === null ? null : asString(data.parentClass);
    if (parent !== null) subclassParents.add(parent);
  }
  const granted = grantedClassFeatureLevels(pack);
  // Granted feature keys grouped by their grantor class key.
  const grantedByClass = new Map<string, RulesRecord[]>();
  for (const record of pack.records) {
    if (record.kind !== 'feature' || !granted.has(record.key)) continue;
    const data = dataObject(record);
    const source = data === null ? null : asString(data.source);
    if (source === null) continue;
    const bucket = grantedByClass.get(source) ?? [];
    bucket.push(record);
    grantedByClass.set(source, bucket);
  }
  const findings: SrdPlayabilityFinding[] = [];
  for (const record of pack.records) {
    if (record.kind !== 'class' || !subclassParents.has(record.key)) continue;
    const features = grantedByClass.get(record.key) ?? [];
    const covered = features.some((feature) =>
      modeledChoiceCategories(feature).has('subclass'),
    );
    if (covered) continue;
    findings.push({
      category: 'choice-coverage',
      key: record.key,
      kind: record.kind,
      name: record.name,
      bead: 'eshyra-o9bd.9.2',
      detail:
        "subclass selection is prose-only (no granted feature carries a structured 'subclass' choice or named unsupported marker)",
    });
  }
  return findings;
}

/**
 * Every player build choice a class feature confers at creation/level-up must
 * be machine-readable: a structured `choices[]` entry of the matching category,
 * or a named out-of-scope marker. A feature still carrying the choice only in
 * its prose `description` is a finding (eshyra-o9bd.9). Findings are bucketed to
 * the owning modeling slice so the report reads as a punch list.
 */
function checkChoiceCoverage(pack: RulesPack): SrdPlayabilityFinding[] {
  const granted = grantedClassFeatureLevels(pack);
  const findings: SrdPlayabilityFinding[] = [];
  for (const record of pack.records) {
    if (record.kind !== 'feature') continue;
    if (!granted.has(record.key)) continue;
    const data = dataObject(record);
    const description = data === null ? null : asString(data.description);
    if (description === null) continue;
    const modeled = modeledChoiceCategories(record);
    for (const signal of CHOICE_SIGNALS) {
      if (!signal.test.test(description)) continue;
      if (modeled.has(signal.category)) continue;
      findings.push({
        category: 'choice-coverage',
        key: record.key,
        kind: record.kind,
        name: record.name,
        bead: signal.bead,
        detail: `level ${granted.get(record.key)} '${signal.category}' choice is prose-only (no structured choices[] entry or named unsupported marker)`,
      });
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
  findings.push(...checkChoiceCoverage(pack));
  findings.push(...checkSubclassChoiceCoverage(pack));
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
    'choice-coverage': 0,
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
