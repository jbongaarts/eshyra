# Independent candidate audit: `eshyra-o9bd.16` (2026-11-01)

## What this document is

This document consolidates the independent ADR-0020 re-audit of the candidate
SRD 5.1 rules pack. The audit sits between candidate generation
(`eshyra-o9bd.19.6.3`) and acceptance (`eshyra-o9bd.19.6.4`). It records:

- each lane's result;
- every finding, with its disposition and owning bead;
- the follow-up repair reviews;
- the limits and non-claims that a clean result does **not** override.

Durable, field-by-field evidence lives in the bead notes named below. This
document summarizes those notes and points to them. Where the two disagree,
the bead notes and the exact code at the named SHAs are correct.

**Authority:** [ADR 0020](../../adr/0020-rules-pack-as-rule-awareness-infrastructure-with-bounded-deterministic-capabilities.md)
and the nine-condition truthfulness bar in section 5.9 of the
[integrated transition design](../rules-awareness-transition/2026-07-30-integrated-transition-design.md).
The bar's conditions are:

1. source fidelity;
2. truthful provenance;
3. deterministic reproducibility;
4. truthful in-band scope;
5. durable finding dispositions;
6. correctness of positively selected capabilities;
7. no known source invention;
8. no unowned live runtime safety contract;
9. explicit unresolved discovery and adjudication limits.

The bar does **not** require any of the following:

- global deterministic closure;
- universal discovery completeness;
- zero engine-pending clauses;
- any other corpus-wide negative.

## Auditor, target, and method

- **Auditor:** GPT-6.1-Sol at high effort, read-only. It is independent of the
  implementers (Claude Sonnet 5.5, Claude Haiku 5.5, GPT-6 Luna, and the
  Claude Captain). It made no repository edits, Git writes, or GitHub actions.
- **Target:** the exact candidate on `main` at `b57e0fdf`, whose pack bytes are
  those of `fcc76eae`. The L2 bounded re-audit ran at `8100e635`, after the L2
  repairs merged.
- **Lanes:** five independent lanes, each a child bead of `eshyra-o9bd.16`. At
  most two ran at a time.
- **Finding format:** every finding records:
  - its lane;
  - BLOCKER or NON-BLOCKER;
  - concrete evidence: a record key or file:line, plus an SRD page and quote
    where a printed rule governs (software-contract findings such as L2-F2
    and L4-F3 cite code and observed behavior instead);
  - its registry alias when it recurs a known class;
  - a suggested owner.
- **Limits:** every lane recorded explicit LIMITS. A clean lane means no blocker
  was found within its denominator. It does not mean completeness.
- **Repairs:** each repair went through a Sol final review. When that review
  returned findings, the repair was fixed, then re-reviewed or confirmed in a
  bounded pass, and merged only on a clean verdict with every required check
  green, CodeQL included.

## Results by dimension

| Lane | Dimension | Bead | Result | Repair |
|---|---|---|---|---|
| L1 | Source fidelity and provenance | `eshyra-o9bd.16.1` | 5 blockers | `eshyra-o9bd.16.7`, PR #701 (`b6566fc5`) |
| L2 | Discovery | `eshyra-o9bd.16.2` | 2 blockers | `eshyra-o9bd.16.6`, PR #699 (`8100e635`) |
| L2′ | Discovery, bounded re-audit after repair | `eshyra-o9bd.16.9` | No blockers | — |
| L3 | Adjudication support and semantic modelling | `eshyra-o9bd.16.3` | 3 blockers | `eshyra-o9bd.16.8`, PR #700 (`8a30d968`) |
| L4 | Deterministic capability correctness | `eshyra-o9bd.16.4` | 2 blockers, 1 non-blocker | `eshyra-o9bd.16.10`, PR #702 (`8b069ab2`) |
| L5 | State integrity and runtime ownership | `eshyra-o9bd.16.5` | 1 blocker | `eshyra-o9bd.16.11`, PR #703 (`6ef35383`) |

Reproducibility (`npm run verify:dnd5e-srd-pack`) passed at the candidate and
at every repaired pack head.

All 13 blockers are repaired and merged. Every repair PR received a clean
final Sol verdict at its exact merged head. Repaired `main` is at `6ef35383`.

## Findings and dispositions

### L1: source fidelity and provenance (PR #701)

- **L1-F1 (BLOCKER).** Some retained prose and table cells cited incomplete
  record locators: table continuations and inherited or flattened spans.
  - **Fix:** `eshyra-o9bd.16.7.3` widened 11 locators, gave table runs their own
    source-region ledger entries, and added a content-span completeness gate.
  - **Review:** `.16.7.4` found one surviving sibling. Copied Dragon Ancestor
    option citations still read p.44, but their rows are printed on p.45.
    `.16.7.5` re-cites copied options to the page their row is printed on.
  - **Status:** repaired; re-review `.16.7.6` was clean.
  - **Recurrence:** `indep:008` and `sol:CAP-010`.
- **L1-F2 (BLOCKER).** Compiler-composed option, variant, and table displays
  were classified as verbatim `source-prose`.
  - **Fix:** `.16.7.2` moved field provenance to record-scoped declarations
    (`field-provenance-v2`, with `recordKeys`).
  - **Review:** `.16.7.4` found a sibling. Descriptions with a printed table
    spliced out of their *interior* also kept the verbatim class.
    `.16.7.5` makes the table-strip producer report internal splices, and the
    compiler derives scoped `source-derived` declarations from that report;
    nothing is hand-listed. That reclassified 17 records: the 2 witnesses plus
    15 siblings. A trailing or leading trim that leaves a contiguous quotation
    stays `source-prose`.
  - **Status:** repaired; re-review `.16.7.6` was clean.
- **L1-F3 (BLOCKER).** Spell `rollModifier` projections named the wrong actor.
  - **Fix:** `.16.7.1` re-assigned Guiding Bolt and Irresistible Dance to the
    attackers against the target. Holy Aura's unrepresentable
    chosen-recipient modifier is omitted (fail-closed), with its source prose
    kept. Foresight gained its source-backed (p.147) projection.
  - **Status:** repaired.
- **L1-F4 (BLOCKER).** Empty Body falsely granted force resistance.
  - **Fix:** `.16.7.1` omits the resistance (fail-closed).
  - **Status:** repaired.
- **L1-F5 (BLOCKER).** Saving-throw damage in the same sentence as an attack was
  emitted as unconditional `hitDamage`.
  - **Fix:** `.16.7.1` moved it to `saves[0].damageOnFailure` for the 14-attack
    cohort and its siblings. The review screened all 514 attack objects.
  - **Status:** repaired.

### L2: discovery (PR #699)

- **L2-F1 (BLOCKER).** Non-condition typed-reference discovery gaps were not
  disclosed.
  - **Fix:** `.16.6.2` declared four reference families and disclosed the
    remaining undeclared leaves.
  - **Status:** repaired.
- **L2-F2 (BLOCKER).** Runtime shadow and intervention dropped the installed
  relationship-manifest source.
  - **Fix:** `.16.6.1`.
  - **Status:** repaired.
- **Re-audit:** the bounded re-audit `.16.9` found no blocker, and the
  disclosures remain accurate.

### L3: adjudication support and semantic modelling (PR #700)

- **L3-F1 (BLOCKER).** Passive projections with no hook were green without a
  runtime consumer.
  - **Fix:** `.16.8.1` empties the passive-effect consumer set. 92 clauses moved
    from green to engine-pending, and the generated magic-item capability
    backlog grows from 798 to 890 accordingly.
  - **Status:** repaired. This is a truthfulness correction, not a capability
    loss.
- **L3-F2 (BLOCKER).** The context packet called intentional DM adjudication
  "engine-pending".
  - **Fix:** `.16.8.2` reports the clause-level category meanings.
  - **Status:** repaired.
- **L3-F3 (BLOCKER).** `spend_usage`'s description contradicted its live input
  contract for class resources.
  - **Fix:** `.16.8.3`.
  - **Status:** repaired.

### L4: deterministic capability correctness (PR #702)

- **L4-F1 (BLOCKER).** Consuming the last Elemental Gem in a stack erased grants
  that earlier units had already paid for.
  - **Fix:** `.16.10.1` keeps those credits redeemable when a consumption
    receipt retires the stack (destruction itself chooses and redeems
    nothing). A later grant binding on the destroyed source chooses the
    named credit, or the oldest open one, and redeems it atomically with the
    effect insertion.
  - **Status:** repaired.
- **L4-F2 (BLOCKER).** `use_item` did not fail closed on unrecognized operation
  arguments.
  - **Fix:** `.16.10.2`.
  - **Review:** `.16.10.3` found that refusals through the registry omitted the
    accepted keys the tool promises to list. The follow-up commit leaves the
    `args` object schema open, so the item-layer validator refuses every unknown
    name and lists the selected operation's accepted keys. The refusal cases
    assert that wording on both the registry path and the direct path, with
    two disclosed exceptions: the zero-cost composite Bag of Tricks case runs
    only on the direct path, because the registry schema refuses its
    `uses: 0` value first; and the non-object `args` refusal runs only on the
    registry path and asserts `invalid_args` and state conservation.
  - **Status:** repaired; bounded confirmation `.16.10.4` was clean.
- **L4-F3 (NON-BLOCKER).** Prototype-inherited keys bypass the capability
  ledger's unknown-identity checks.
  - **Status:** deferred to `eshyra-du32` (P2). No in-force consumer is
    affected.

### L5: state integrity and runtime ownership (PR #703)

- **L5-F1 (BLOCKER).** Checkpoint and replay restoration discarded the
  insertion order the runtime depends on. After a restore, mutation gates picked
  historical combatant projections and changed the order of paid bind credits.
  `replayStateHash` was identical before and after.
  - **Fix:** `.16.11` follows the migration 0029 precedent. Migration 0053 adds a
    persistent `insertion_order` to `encounter_combatant`, `combat_instance`,
    and `item_grant_bind_credit`, and every consumer now orders by it.
  - **Guard:** a structural test forbids SQL `rowid` in `packages/core/src`
    outside a justified allowlist.
  - **Evidence:** round-trip invariants exercise both restore paths.
  - **Limit:** a checkpoint captured before migration 0053 cannot recover
    chronology it never recorded.
  - **Status:** repaired; Sol review `.16.11.1` was clean. It re-ran both
    auditor reproducers, which now behave the same before and after restore.

### Other follow-ups filed during repair (not blockers)

- `eshyra-7z0z` (P3): `parseActions` and `parseFeats` fall back to the entry
  name when the body is empty; they should fail closed instead.

## Limits and non-claims

Each lane's full LIMITS section is in its bead notes. In summary:

- **L1** was an adversarial sample plus bounded corpus queries. It was not a
  word-for-word audit of 403 pages, 1,799 records, or 4,434 table cells.
  Short-string and page-level matching can miss a wrong owner whose text is
  identical, or a correctly anchored false combination.
- **L2 and L2′** enumerated only the declared shapes and the undeclared-leaf
  predicate. The condition-name and non-condition undeclared-shape limits, and
  the bounded expansion limit, remain disclosed limits. Arbitrary prose
  references and semantic relevance cannot be enumerated.
- **L3** used targeted suites and runtime probes against the unmodified pack. It
  is not a universal readiness or description audit.
- **L4** counted complete *declaration* populations: 115 capability entries and
  95 evidence files. It does not establish that every branch of the runtime is
  correct.
- **L5** inventoried 44 state modules (about 34k lines) by their write and
  transaction boundaries, and traced selected high-consequence paths. Its
  77-tool probe covers schema refusal only. It did not run a complete
  filesystem, concurrency, or Dolt fault campaign, and no live play.
- **Disclosed candidate limits** stay limits and were not converted into
  findings:
  - general enforcement of `operation.excludes`;
  - whether Pipes of the Sewers' variable spend is reachable;
  - the roll-evidence binding decision;
  - engine-pending and adjudicated clauses;
  - leaves of discovery condition references;
  - the freeze guard, which stays inactive until re-freeze (`eshyra-o9bd.14`);
  - later held-out and live-play evaluation.
- **No new registry rows.** These findings are recorded in beads and here.
  Whether they enter `finding-registry.json` as aliases is part of acceptance
  (`eshyra-o9bd.19.6.4`).

**This audit does not authorize re-freeze.** A clean result means only that,
once the repairs listed above merged, no unrepaired blocker remains against the
ADR-0020 bar within the stated denominators. Accepting these results and
certifying closure belong to `eshyra-o9bd.19.6.4`, which is the project owner's
decision. Formal regeneration and re-freeze belong to `eshyra-o9bd.14`.
