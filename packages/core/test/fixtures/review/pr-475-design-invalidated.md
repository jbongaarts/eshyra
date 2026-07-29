<!-- eshyra-design-invalidated:v1 -->

# STOP WORK — `DESIGN_INVALIDATED`

| Field | Value |
| --- | --- |
| PR | #475 — Source-clause semantic IR and completeness contracts |
| Head SHA | `68e5253f0a41aae5a4aff95564c38ceff8d08f79` |
| Owning bead | `eshyra-o9bd.19.1.1` |
| Status | **DESIGN_INVALIDATED** |

## Defect-class history

Fourteen defect classes across the cycle, the last three at the reviewed head: CAPTURED satisfying on a missing or unknown obligation ID; `choice`/`variant` alternatives passing with a disconnected exclusion graph; and evidence equality depending on JSON property insertion order.

The deepest one: **the obligation registry was asked to be authoritative while nothing underwrote its authority**, because the source census it needed is deferred. Mutable contract tables, an evidence taxonomy with no home for known-missing clauses, and unprovable scope membership were symptoms of that, not independent bugs.

## Why the threshold was crossed

Each round produced a **new defect class** after a material contract change and a fresh full review. The failures differed across the three PRs, but share one cause: **unsettled concepts were generalized across the corpus before their trust boundaries were proven by a small number of concrete source-to-execution examples.**

Patching the same design again would repeat it. Successor work inverts the order — prove the boundary on five real procedures first, generalize afterwards.

## What happens now

- **No further substantive commits** will be made on this branch.
- **The branch is retained** as historical and salvage evidence. It is not deleted.
- **This PR must not be merged.** It is closed unmerged, not superseded by a green build.
- Existing review findings stay open and unresolved. They are the evidence record.
- No approval or completion checkpoint is published for this work.
- Downstream beads have been repointed at the successors below and must not treat this artifact as an accepted contract.

## Successor structure

| Foundation | Bead | Owns |
| --- | --- | --- |
| F1 | `eshyra-o9bd.19.1.14` | Source-obligation identity and discharge, proven on five real procedures |
| F2 | `eshyra-o9bd.19.1.15` | Truthful audit-fact registry, making no executable-membership claim |
| F3 | `eshyra-o9bd.19.1.7`, `eshyra-o9bd.19.1.8` | Exact finding membership (existing beads, reused) |
| F4 | `eshyra-o9bd.19.1.16` | Capability evidence semantics — what each evidence type does and does not prove |
| F5 | `eshyra-olc5.5` | Bootstrap capability inventory, rebuilt as a consumer of accepted identities |

The first successor session begins with **F1 only**. Foundations 2–5 must not be designed in implementation detail until the source-obligation proof stabilizes.

## Salvage

**Design input only** — ADR reasoning on clause-level completeness; the CAPTURED / PROJECTED / SUPPORTED / DISCOVERABLE separation; structured failure vocabulary; cardinality and fail-closed predicates; the T1–T8 adversarial cases; the worked examples showing why projector-authored obligations are unsafe; and one-obligation-per-clause as a hypothesis to re-test.

**Do not presume survives** — the universal obligation identity, the contract composition model, or the evaluator architecture. Treat this PR as a design spike, not an accepted clause IR.

---

The owning bead carries the full defect-class list, the disproven assumptions, and the salvage classification. It is **not** closed as successfully completed.
Closed unmerged under `DESIGN_INVALIDATED`. The branch is retained as historical and salvage evidence and is not deleted. See the `eshyra-design-invalidated:v1` stop-work comment above for the defect-class history, salvage classification, and successor bead structure. This PR must not be merged or reopened for incremental fixes.
