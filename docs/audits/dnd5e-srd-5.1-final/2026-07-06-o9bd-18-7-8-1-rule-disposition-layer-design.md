# eshyra-o9bd.18.7.8.1 — Rule-record disposition & coverage layer design

Date: 2026-07-06. Bead: `eshyra-o9bd.18.7.8.1`. Status: **design** —
implementation follows this document.

Inputs: the corrected classification artifact
`docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-8-rule-classification.md`
(PR #400, commit `068bff3`): 335 rules, census PROC 175 / REF 96 / DEF 33 /
TABLE 19 / DUP 12, 13 PROC families, primary-disposition rule "PROC
dominates hybrids".

## 1. Goals and non-goals

Goals:

1. Fail-closed, exact-membership semantic disposition for every `rule:*`
   record, enforced at audit-bundle build time exactly like the existing
   `GAMEPLAY_READINESS_DISPOSITIONS` / `ACCEPTED_*` membership gates.
2. A **separate** implementation-coverage register for engine procedures,
   so "classified as engine-procedure" can never read as "done".
3. Readiness output that distinguishes acceptable prose, table-backed,
   duplicates, and the four coverage states of deterministic procedures.

Non-goals: projecting rule procedures as per-record `mechanics.effects`
(rejected by the 18.7.8 artifact); implementing the engine procedures
themselves; changing the pack or importer output.

## 2. Data model

Location: `packages/core/scripts/create-dnd5e-srd-audit-bundle/cli.ts`,
alongside the existing membership gates (same enforcement path, same
review ergonomics). Types may live in a sibling module if the file grows
unwieldy, but the constants stay export-adjacent to the other gates.

```ts
export type RuleDispositionClass =
  | 'reference-prose'     // artifact REF
  | 'definition'          // artifact DEF
  | 'engine-procedure'    // artifact PROC (incl. PROC+TABLE hybrids)
  | 'table-backed'        // artifact TABLE (pure)
  | 'duplicate';          // artifact DUP

export type RuleProcedureFamily =
  | 'core-d20' | 'combat-core' | 'movement-environment'
  | 'spellcasting' | 'rest-death-hp' | 'build-advancement'
  | 'downtime-economy' | 'objects-hazards' | 'monster-conventions'
  | 'magic-item-procedures' | 'templates' | 'gear-payload'
  | 'perception-senses';

export interface RuleDisposition {
  readonly class: RuleDispositionClass;
  /** Required iff class === 'engine-procedure'. */
  readonly family?: RuleProcedureFamily;
  /**
   * Required for 'definition'/'reference-prose' rows whose text contains
   * deterministic content: names what covers it. Either another rule key
   * (which must be engine-procedure or table-backed), a record-data
   * pointer ('record-data:<kind>.<field>'), or a table ref.
   * Its presence is what makes retaining DEF/REF legitimate.
   */
  readonly deterministicOwner?: string;
  /** Required iff class === 'duplicate': must resolve to a non-duplicate rule key. */
  readonly canonicalOwner?: string;
  /**
   * DEPRECATED by the 2026-07-06 execution-boundary revision: whole-row
   * exemption is not allowed. External ownership is clause-level and lives
   * in RuleProcedureCoverage.externalClauses; every engine-procedure key
   * appears in ENGINE_PROCEDURE_COVERAGE regardless of cross-bead clauses.
   */
  readonly crossBead?: never;
  /** True for hybrid PROC+TABLE rows: tableRefs must exist AND coverage is still required. */
  readonly tableEvidence?: boolean;
}

export const RULE_DISPOSITIONS: Readonly<Record<string, RuleDisposition>>;
// exactly 335 keys, transcribed from the artifact matrix
```

Coverage is a **separate constant** — deliberately not a field of
`RuleDisposition`, so a classification edit can never silently create or
destroy coverage claims:

```ts
export type RuleCoverageStatus =
  | 'implemented'
  | 'model-adjudicated-supported' // reviewed, evidence-backed terminal status:
                                  // DM-model adjudication over the primitive
                                  // tool surface is the intended architecture
                                  // for this rule (2026-07-06 execution-
                                  // boundary artifact) — NOT a synonym of
                                  // unimplemented
  | 'partial' | 'unimplemented' | 'design-blocked';

export interface RuleProcedureCoverage {
  readonly status: RuleCoverageStatus;
  /** Required for 'implemented' and 'partial': repo-relative code path(s). */
  readonly runtimeOwner?: readonly string[];
  /** Required for 'implemented': test file(s) exercising the behavior. */
  readonly evidence?: readonly string[];
  /**
   * Required for 'model-adjudicated-supported': the registered tool names
   * relied on (checked against DEFAULT_TOOLS so a tool removal fails the
   * register) and what must be retrievable/structured at play time.
   */
  readonly primitives?: readonly string[];
  readonly contextRequirement?: string;
  /** Optional for 'model-adjudicated-supported': e.g. "F2 budget improves enforcement". */
  readonly dependencyNote?: string;
  /** Required for 'partial': the exact missing semantics (may name a shared
   *  primitive family such as F9 derived-math or F10 currency surface). */
  readonly missing?: string;
  /** Required for 'design-blocked': the bead that owns the design decision. */
  readonly designOwner?: string;
  /**
   * Clause-level external ownership (replaces the row-level crossBead
   * exemption): each externally owned clause keeps the row visible and
   * never auto-upgrades on bead closure — the transition to covered
   * requires new runtime/pack evidence in a reviewed diff.
   */
  readonly externalClauses?: readonly { clause: string; bead: string }[];
}

export const ENGINE_PROCEDURE_COVERAGE:
  Readonly<Record<string, RuleProcedureCoverage>>;
// exactly ALL engine-procedure keys (no exemptions; external ownership is
// clause-level inside the coverage row)
```

## 3. Fail-closed validation (build-time, in the audit bundle)

All of the following are hard failures, mirroring the existing
stale/unreviewed membership errors:

1. **New-rule detection**: a pack `rule:*` key absent from
   `RULE_DISPOSITIONS` fails ("unreviewed rule record").
2. **Stale-key detection**: a disposition key absent from the pack fails
   ("remove from RULE_DISPOSITIONS").
3. **Class invariants**: `engine-procedure` requires `family`;
   `duplicate` requires `canonicalOwner` resolving to an existing,
   non-duplicate key; `table-backed` and `tableEvidence` rows require the
   pack record to actually carry non-empty `tableRefs`; a
   `deterministicOwner` that names a rule key must resolve to an
   engine-procedure or table-backed row.
4. **Coverage completeness**: every `engine-procedure` key must appear in
   `ENGINE_PROCEDURE_COVERAGE` (no exemptions); every coverage key must be
   such a disposition key (no orphans). A newly promoted rule therefore
   fails until someone writes an explicit coverage row — `unimplemented` is
   the honest transitional default, but it must be written, not assumed.
5. **Status invariants**: `implemented` requires non-empty `runtimeOwner`
   and `evidence` (paths existence-checked against the repo tree);
   `model-adjudicated-supported` requires non-empty `primitives` (each name
   present in `DEFAULT_TOOLS`) and `contextRequirement`; `partial` requires
   `missing` (and `runtimeOwner` when code partially owns it);
   `design-blocked` requires `designOwner`; `externalClauses` beads must be
   real bead-id shapes, and their presence never changes the row's status.
6. **Census check**: recomputed counts for BOTH registers are asserted
   against pinned expected counts (updated only in reviewed diffs): the
   semantic census (PROC 175/REF 96/DEF 33/TABLE 19/DUP 12) and the
   coverage census seeded from the execution-boundary artifact
   (0 implemented / 107 model-adjudicated-supported / 37 partial /
   21 implementation-required→unimplemented / 10 design-blocked, corrected
   2026-07-06 revision — provisional until PR #406 review; do not pin
   before that merge).

## 4. Readiness report shape

`buildGameplayReadinessReport` gains a `rules` section:

```
rules:
  reference-prose: n         // acceptable, permanent
  definition: n              // acceptable, owners recorded
  table-backed: n            // acceptable, evidence checked
  duplicate: n               // acceptable, canonical owners resolve
  engine-procedure:
    implemented: n                     // green (code-owned, evidence)
    model-adjudicated-supported: n     // green-by-design, own bucket —
                                       // never merged with implemented
    partial: n               // actionable gap list (key + missing)
    unimplemented: n         // transitional only: new/promoted rules
    design-blocked: n        // list (key + designOwner)
    external-clauses: n      // clause-level list (key + clause + bead)
```

`implemented` and `model-adjudicated-supported` are the two green buckets,
reported separately. `partial`, `unimplemented`, and `design-blocked` are
the actionable readiness gaps this layer exists to keep visible; external
clauses stay listed until runtime/pack evidence lands in a reviewed diff.
CI policy: registry-integrity failures (missing/stale/malformed rows) fail
every build; truthful readiness gaps stay visible in the report and fail
only the final readiness/re-freeze gate (eshyra-2zyy era), so incremental
registry introduction remains possible. The report never collapses
`engine-procedure` into a single number.

## 5. Seeding and review protocol

- Memberships are transcribed from the artifact matrix (the artifact stays
  the evidence corpus; the constants are the enforcement). Transcription
  is mechanical — a Codex task — and the census check (§3.6) catches
  transcription drift.
- Initial coverage rows come from the execution-boundary classification
  (`2026-07-06-o9bd-18-7-8-execution-boundary-classification.md`, PR #406
  corrected revision) — NOT from all-`unimplemented` seeding and not from
  the raw 18.7.8.3 inventory: the boundary artifact already resolves which
  #402 rows are model-adjudicated-supported versus genuine gaps, and maps
  partial rows' `missing` to families F1–F10.
- Future reclassification (e.g. a DEF row later found deterministic)
  is a reviewed diff: change the disposition row, and validation forces
  the corresponding coverage row in the same commit.

## 6. Testing

- Unit tests for each validation failure mode (new key, stale key, missing
  family, dangling canonicalOwner, tableRefs mismatch, missing coverage,
  implemented-without-evidence, orphan coverage) — mirroring
  `srdMembershipCorrections.test.ts` patterns.
- A committed-pack test asserting the full 335-key parity and the pinned
  census.
- Path-existence checks for `runtimeOwner`/`evidence` run in tests (not at
  audit runtime) to keep the bundle build hermetic.

## 7. Implementation slices (for Codex, after this design is approved)

1. Types + constants skeleton + validation functions + unit tests.
2. Mechanical transcription of the 335 dispositions from the artifact
   (script-assisted; verify with the census check).
3. Coverage seeding: all engine-procedure keys `unimplemented` (or from
   the 18.7.8.3 inventory if it exists by then).
4. Readiness-report wiring + report snapshot test.
5. Audit-bundle assertion wiring (fail-closed on gaps in CI).
