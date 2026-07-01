/**
 * SRD class spell-list parity audit (eshyra-erf5.2).
 *
 * Class spell lists (p105-113) are correctly reflected in `spell:*` records'
 * `data.classes` today, but the source-coverage ledger accounts for most of
 * that page range as intentionally-ignored `spell-list-header` prose — a
 * structural-presence check, not a content-accuracy one. A future regression
 * in `applyClassLists` (or a hand-edit to a spell record) that drops, adds, or
 * mis-levels a class's spell could still pass every existing gate.
 *
 * This module re-scans the same source pages with `parseSpellClassLevelLists`
 * — the shared low-level primitive `parseSpellClassLists` is itself built on
 * (see parseSpells.ts) — and cross-checks that reconstruction against the
 * FINAL emitted `spell:*` records, catching four failure classes:
 *
 *   - missing: the source lists a spell under a class, but no spell record
 *     resolves to it, or the resolved record's `data.classes` omits that class.
 *   - extra: a spell record's `data.classes` names a class the source
 *     spell-list pages never actually list that spell under.
 *   - wrong-level: the source lists a spell under one level for a class, but
 *     the record's own `data.level` disagrees.
 *   - unresolved-source-name: a source spell-list name matches no emitted
 *     spell record at all (name drift / extraction failure), distinct from
 *     "missing" (which requires a resolvable record whose classes disagree).
 *
 * Pure and deterministic; findings are sorted for diffable reports.
 */

import type { RulesRecord } from '../../../src/rules/types.js';
import type { SpellClassLevelEntry } from './parseSpells.js';
import { normalizeSpellListName } from './parseSpells.js';

export type SpellListParityFindingKind =
  | 'missing'
  | 'extra'
  | 'wrong-level'
  | 'unresolved-source-name';

export interface SpellListParityFinding {
  readonly kind: SpellListParityFindingKind;
  readonly casterClass: string;
  readonly spellName: string;
  readonly detail: string;
}

interface SpellRecordFacts {
  readonly key: string;
  readonly name: string;
  readonly classes: readonly string[];
  readonly level: number | undefined;
}

function spellRecordFacts(record: RulesRecord): SpellRecordFacts {
  const data = (record.data ?? {}) as {
    classes?: unknown;
    level?: unknown;
  };
  return {
    key: record.key,
    name: record.name,
    classes: Array.isArray(data.classes)
      ? data.classes.filter((c): c is string => typeof c === 'string')
      : [],
    level: typeof data.level === 'number' ? data.level : undefined,
  };
}

/**
 * Cross-check the source-reconstructed class spell lists against the
 * emitted `spell:*` records. `spellRecords` must be every record of kind
 * `spell` in the pack.
 */
export function auditSpellListParity(
  sourceEntries: readonly SpellClassLevelEntry[],
  spellRecords: readonly RulesRecord[],
): readonly SpellListParityFinding[] {
  const findings: SpellListParityFinding[] = [];
  const factsByNormalizedName = new Map<string, SpellRecordFacts>();
  for (const record of spellRecords) {
    factsByNormalizedName.set(
      normalizeSpellListName(record.name),
      spellRecordFacts(record),
    );
  }

  // Every source-printed (class, spell) pair, for the "extra" pass below.
  const sourceMembership = new Set<string>();
  for (const entry of sourceEntries) {
    sourceMembership.add(
      `${entry.casterClass}::${normalizeSpellListName(entry.spellName)}`,
    );

    const facts = factsByNormalizedName.get(
      normalizeSpellListName(entry.spellName),
    );
    if (facts === undefined) {
      findings.push({
        kind: 'unresolved-source-name',
        casterClass: entry.casterClass,
        spellName: entry.spellName,
        detail: `no spell record matches the source spell-list name "${entry.spellName}"`,
      });
      continue;
    }
    if (!facts.classes.includes(entry.casterClass)) {
      findings.push({
        kind: 'missing',
        casterClass: entry.casterClass,
        spellName: entry.spellName,
        detail: `${facts.key}.data.classes is [${facts.classes.join(', ')}], missing ${entry.casterClass}`,
      });
    }
    if (facts.level !== entry.level) {
      findings.push({
        kind: 'wrong-level',
        casterClass: entry.casterClass,
        spellName: entry.spellName,
        detail: `source spell-list page groups it under level ${entry.level} for ${entry.casterClass}, but ${facts.key}.data.level is ${facts.level}`,
      });
    }
  }

  for (const record of spellRecords) {
    const facts = spellRecordFacts(record);
    for (const casterClass of facts.classes) {
      const key = `${casterClass}::${normalizeSpellListName(facts.name)}`;
      if (!sourceMembership.has(key)) {
        findings.push({
          kind: 'extra',
          casterClass,
          spellName: facts.name,
          detail: `${facts.key}.data.classes includes ${casterClass}, but the source spell-list pages never list it there`,
        });
      }
    }
  }

  return findings.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    if (a.casterClass !== b.casterClass) {
      return a.casterClass < b.casterClass ? -1 : 1;
    }
    return a.spellName < b.spellName ? -1 : a.spellName > b.spellName ? 1 : 0;
  });
}

export class SpellListParityError extends Error {
  constructor(public readonly findings: readonly SpellListParityFinding[]) {
    const lines = findings.map(
      (f) => `  [${f.kind}] ${f.casterClass} / ${f.spellName}: ${f.detail}`,
    );
    super(
      `SRD class spell-list parity check found ${findings.length} mismatch(es) ` +
        `between the source spell-list pages and the emitted spell records:\n${lines.join('\n')}`,
    );
    this.name = 'SpellListParityError';
  }
}

/** Throw when any parity finding exists. */
export function assertSpellListParity(
  findings: readonly SpellListParityFinding[],
): void {
  if (findings.length > 0) {
    throw new SpellListParityError(findings);
  }
}
