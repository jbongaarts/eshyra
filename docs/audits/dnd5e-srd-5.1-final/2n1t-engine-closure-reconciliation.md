# Reconciliation of closed `eshyra-2n1t` engine beads

This document preserves the historical closure decisions. It does not reopen,
close, or modify any bead. The closed epic's F1–F10 names are a different
taxonomy from the pack's qualified `engine:F1`–`engine:F10` families.

| Bead | Classification | Evidence and conclusion |
| --- | --- | --- |
| `eshyra-2n1t` | DIFFERENT SCOPE OR TAXONOMY | The epic explicitly covered dice grammar, spell-slot economy, character-build gaps, derived math, currency, and related engine work. Its F1/F4/F8/F9/F10 labels are not the pack hook families. It correctly closed its PR and runtime scope, but that closure cannot certify the later clause-capability inventory. Recommendation: keep closed; continue new provider-neutral capability work under `eshyra-olc5`. |
| `eshyra-2n1t.1` | DIFFERENT SCOPE OR TAXONOMY | This was the multiclass product decision and it accepted a single-class v1 boundary through ADR 0018. It did not claim coverage of pack `engine:F1`–`engine:F10` hooks or magic-item clauses. Recommendation: keep closed; do not misclassify the deliberate design boundary as an engine defect. |
| `eshyra-2n1t.2` | DIFFERENT SCOPE OR TAXONOMY | This was the creation-variant policy for optional feats and custom backgrounds. Its acceptance concerns deterministic character creation, not pack execution-readiness families. Recommendation: keep closed; preserve the policy and route any new source-semantic gaps separately. |
| `eshyra-b69j.13` | DIFFERENT SCOPE OR TAXONOMY | PR #311 implemented guided level-1 equipment and proficiency choices. Its acceptance is a character-creation interaction flow; it neither claimed nor supplied the complete F10 inventory/asset execution boundary. Recommendation: keep closed; link it only as historical context where a future ledger row proves an exact runtime overlap. |
| `eshyra-o9bd.18.7` | DIFFERENT SCOPE OR TAXONOMY | This importer/audit epic closed its nine child modeling slices and verified pack regeneration and audit gates. Its scope was deterministic gameplay modeling and pack semantics, while provider-neutral engine execution was explicitly handed to the old `eshyra-2n1t` epic. The later audit demonstrates a broader clause-capability contract, not that this epic's stated importer scope was unmet. Recommendation: keep closed; use `eshyra-o9bd.19` and `eshyra-olc5` for the separated pack/engine contract. |
| `eshyra-o9bd.18.7.8` | STALE READINESS MAPPING | The bead correctly classified 335 rules and routed 21 implementation-required, 47 partial, and 10 design-blocked procedures to engine work, but its readiness artifact was built against the earlier rule-procedure taxonomy and did not enumerate the later magic-item/source-clause capability requirements. Existing rule code and the artifact's boundary classification show the code-side distinction; the committed pack's current readiness projection still cannot reveal all missing clauses. Recommendation: keep the historical classification closed and let `eshyra-o9bd.19.5.12` replace the stale mapping; do not cite this closure as proof of zero engine-pending clauses. |

## Why no category is `PREMATURE CLOSURE`

The evidence supports a narrower conclusion for each bead: the stated
acceptance was met within its recorded scope, or its readiness mapping is
stale relative to the later clause-complete contract. The 794 engine-pending
magic-item snapshot is evidence against using those closures as a global
completeness claim; it is not, by itself, evidence that each historical
acceptance was objectively unmet.

## Corrective ownership

The bootstrap ledger assigns the qualified engine families to the existing
`eshyra-o9bd.19.5.2` through `.11` family epics under `eshyra-olc5`. No old
bead is reopened or duplicated here. The authoritative ledger and its
decomposition gate remain the supervisor's follow-up work.
