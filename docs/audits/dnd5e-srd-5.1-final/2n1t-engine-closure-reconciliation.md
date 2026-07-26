# Reconciliation of closed `eshyra-2n1t` engine beads

This document preserves historical closure decisions. It does not reopen,
close, or modify any bead. The closed epic's F1–F10 names are a different
taxonomy from the pack's qualified `engine:F1`–`engine:F10` families. The
classifications below were re-derived from each bead's own description,
acceptance/contract text, notes, and close reason, then compared with the
current pack hooks and the 2026-07-24 audit evidence.

| Bead | Classification | Per-bead argument and recommendation |
| --- | --- | --- |
| `eshyra-2n1t` | PREMATURE / OVERSTATED UMBRELLA CLOSURE | Its close PR was titled “Complete SRD audit and engine gaps”, claimed source-grounded executable mechanics for all 240 magic items, reported zero deep-audit findings, and named this epic and `eshyra-o9bd.18` as complete. The later audit found projected clauses mistaken for complete executable inputs, including legendary actions without budget or option costs. Narrow child acceptance can be genuine while this global umbrella claim is false. Keep the historical bead closed; route the broader clause-capability work under `eshyra-olc5`. |
| `eshyra-2n1t.1` | DIFFERENT SCOPE OR TAXONOMY | The description and close reason are a product boundary decision: ADR 0018 defers multiclassing and requires a fail-closed single-class validator. That is a prerequisite policy, not an implementation of a pack `engine:F*` hook. Keep closed and do not convert the intentional design boundary into an engine defect. |
| `eshyra-2n1t.2` | DIFFERENT SCOPE OR TAXONOMY | Its description asks whether optional feats and custom backgrounds are supported, and its close notes say the SRD feat/custom-background path was implemented. This is character creation/advancement policy and validation, not the pack's execution-readiness families. Keep closed; any remaining source clause gets its exact capability owner separately. |
| `eshyra-2n1t.3` | DIFFERENT SCOPE OR TAXONOMY | The bead's description and close reason concern dice notation, keep/drop, advantage/disadvantage cancellation, and roll-tool documentation. Pack `engine:F1` instead names condition/eligibility relations and seeded selection hooks. The dice primitive may support those hooks, but the bead never accepted ownership of the relation/selection contract. Keep closed; do not infer pack F1 completeness from matching F1 labels. |
| `eshyra-2n1t.4` | INCOMPLETE INTEGRATION | Its description is specifically a per-combatant turn budget with action, bonus-action, reaction, free interaction, surprise, and spell-timing state, and its close reason says that state machine merged. Pack `engine:F2` additionally requires activation ownership, controlled-entity commands, item activation, and source-defined budgets. The primitive exists, but the committed pack still has hooks that are not wired to it. Keep the bead closed for its accepted turn-budget scope; route missing clause integration to the qualified F2 owner. |
| `eshyra-2n1t.5` | INCOMPLETE INTEGRATION | Its description and close reason establish concentration/active-effect state, damage-save evidence, incapacitation breaks, timers, and cleanup. Pack `engine:F3` also requires cross-record duration, repeat-trigger, persistent-actor, and created-entity lifecycle integration. The close reason proves a substantial primitive landed, not that every projected/source clause reaches it. Keep closed; continue the broader integration under the qualified F3 owner. |
| `eshyra-2n1t.6` | INCOMPLETE INTEGRATION | Its description and acceptance are deliberately limited to single-class spell-slot counters, expenditure validation, Pact Magic separation, and the F7 restore hook. Pack `engine:F4` requires canonical caster-of-record execution, class-list eligibility, stored/item spells, spell effects, and copying in addition to slot gates. The stated slot acceptance was met, but the primitive is not the complete pack execution path. Keep closed; route spellbook copying and asset-cost integration to `eshyra-o9bd.19.5.5.3`. |
| `eshyra-2n1t.7` | INCOMPLETE INTEGRATION | Its description and close notes cover durable usage counters, recharge, legendary per-round state, attunement, inspiration, and reset primitives. Pack `engine:F5` additionally covers every item-instance duration, cooldown, curse, containment, portal, card-pool, and persistent-state clause. The code has real primitives while the committed pack still has engine-pending clauses; that is incomplete integration, not proof that the bead's narrower acceptance was unmet. Keep closed; route containment, portal, and card-pool state to `eshyra-o9bd.19.5.6.3`. |
| `eshyra-2n1t.8` | INCOMPLETE INTEGRATION | Its description and close reason cover the HP write path, death/dying/stable/dead state, death saves, instant-death overflow, and temporary HP. Its own notes explicitly leave the suffocation countdown partial. Pack `engine:F6` includes healing restrictions, recurring damage, curses, poison/disease, suffocation, and complete condition lifecycle. The shipped state machine is real but not fully integrated with those source clauses. Keep closed for its accepted slice; route the remaining clauses to qualified F6. |
| `eshyra-2n1t.9` | INCOMPLETE INTEGRATION | Its description/acceptance require a durable single-class Hit Dice pool, short/long rest gates, F4/F5/F6 orchestration, and tested persistence; its close notes document those hooks and verification. Pack `engine:F7` also includes elapsed timers, dawn/reset triggers, declared windows, timed curses, and planar-return clocks. The rest primitive exists, but the later clause set is broader. Keep closed; route planar-return and declared-window clocks to `eshyra-o9bd.19.5.8.3`. |
| `eshyra-2n1t.10` | DIFFERENT SCOPE OR TAXONOMY | Its description and close reason cover character-build closures: ability scores, backgrounds, level-up HP, Constitution recalculation, and single-class guards. Pack `engine:F8` is the broader checks/saves/attacks/DCs/derived-modifier execution family. Some code is reusable, but this bead did not accept the pack's combat-resolution ownership. Keep closed; do not treat character-build completion as F8 family completion. |
| `eshyra-2n1t.11` | INCOMPLETE INTEGRATION | Its description and close notes establish deterministic checks, contests, damage, calculations, and roll transforms, with explicit boundaries for model-adjudicated clauses. Pack `engine:F9` additionally requires source-complete geometry, point-origin areas, riders, half-damage branches, pit variants, object interaction, and movement/targeting variants. The read-only primitives exist, but the pack/source clauses are not all projected and wired. Keep closed for the accepted resolution toolkit; continue exact integration under qualified F9. |
| `eshyra-2n1t.12` | INCOMPLETE INTEGRATION | Its description asks for wallet context and canonical earn/spend/convert writes, while its close reason only says that implementation was pushed. Pack `engine:F10` includes downtime, currency, inventory, XP, property, spell-copy costs, and retained asset creation. Currency is a genuine overlap, but it is not the whole F10 ledger/asset surface. Keep closed for the narrow currency slice; route the missing procedures to qualified F10 and the proposed cross-family asset owner. |
| `eshyra-2n1t.13` | DIFFERENT SCOPE OR TAXONOMY | Its description and acceptance require a shared fail-closed validator for multiclass-shaped persistence, creation, progression, spell slots, and Hit Dice. Its close reason says nested draft and advancement inputs now fail closed. This is a cross-cutting schema/domain precondition used by several families, not a pack `engine:F1`–`engine:F10` capability itself. Keep closed and retain it as a prerequisite; do not count it as execution-family completeness. |
| `eshyra-b69j.13` | DIFFERENT SCOPE OR TAXONOMY | Its description/acceptance and close reason concern guided level-1 skills, tools, languages, equipment, editable choice groups, and finalization navigation. That is a character-creation interaction flow; it neither claimed nor supplied the complete pack F10 inventory/property/asset boundary. Keep closed and link it only where a future row proves an exact creation-flow overlap. |
| `eshyra-o9bd.18.7` | PREMATURE CLOSURE — IMPORTER/COMPILER PROJECTION | Its description is the importer/audit epic for deterministic pack modeling, but the committed projection omits or silently partially projects source clauses later identified by the audit. That is an importer/compiler completeness defect, not merely downstream engine work; the close-time completeness claim was therefore premature. Keep the historical bead closed and route source projection repair separately from engine execution. |
| `eshyra-o9bd.18.7.8` | STALE READINESS MAPPING | Its description and acceptance require classification of rule records, child implementation beads, and readiness output distinguishing acceptable prose from actionable mechanics. Its close notes document the corrected rule census, execution-boundary dispositions, and explicit routing to `eshyra-2n1t`. That mapping was correct for the then-current rule-procedure taxonomy but cannot enumerate the later magic-item/source-clause capability inventory. Keep closed as a historical classification; replace its readiness mapping with the bootstrap/authoritative clause ledgers. |

## How the reconciliation distinguishes narrow acceptance from premature closure

The narrow child acceptances for `.1`–`.13`, `b69j.13`, and `.18.7.8` remain
historically meaningful where their table entries say so: a primitive, policy,
interaction flow, or readiness mapping can genuinely have landed. That does
not validate the umbrella epic's global “all engine gaps complete” claim.
`eshyra-2n1t` is therefore a premature/overstated umbrella closure, and
`eshyra-o9bd.18.7` is a premature importer/compiler projection closure. The
remaining engine-child rows classify broader missing wiring as incomplete
integration, while `.18.7.8` is a stale readiness mapping. No bead is reopened
or modified by this artifact.

## Corrective ownership

The bootstrap ledger assigns qualified primitives to the open
`eshyra-o9bd.19.5.2` through `.11` family epics where an exact owner exists.
Four cross-family primitives had no exact existing owner —
spellbook-copy/asset-cost, containment/portal/card-pool, planar-return/deadline
clock, and retained-asset/provenance. The ledger recorded them as proposed, and
the supervisor has since created them as `eshyra-o9bd.19.5.5.3`, `.19.5.6.3`,
`.19.5.8.3` and `.19.5.11.3`, each blocked by its family's decomposition task.
The corrective overlaps are explicit: `eshyra-2n1t.6` routes spell copying to
`eshyra-o9bd.19.5.5.3`; `.7` routes containment/portal/card-pool state to
`eshyra-o9bd.19.5.6.3`; `.9` routes planar-return/deadline clocks to
`eshyra-o9bd.19.5.8.3`; and `.12` routes retained-asset/provenance semantics to
`eshyra-o9bd.19.5.11.3`.

No old bead is reopened, closed, or modified here. The authoritative ledger
(`eshyra-o9bd.19.5.12`) and its decomposition gate remain follow-up work.
