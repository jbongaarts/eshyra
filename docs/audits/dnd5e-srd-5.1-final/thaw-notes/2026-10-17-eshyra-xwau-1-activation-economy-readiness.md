# Thaw note: per-clause activation-economy readiness

Bead: `eshyra-xwau.1` (parent `eshyra-xwau`; capability `eshyra-olc5.9`)

The audit found no operation or state-machine activate/deactivate transition
that is left without a typed activation cost although its own SRD text prints
the action type for that exact operation. The earlier faithful-or-absent
corpus (`eshyra-o9bd.19.4.6.x`) already typed every such operation, and every
operation that stays untyped is dispositioned individually in
`magicItemActivationCostLedger.ts` (the printed phrase governs another
operation, a spell's own casting time per `rule:spells`, or is ambiguous). No
core-rule exception was applied: the Potion of Healing line "Drinking or
administering a potion takes an action" is scoped to that equipment entry, and
the single-valued `activation.cost` vocabulary already carries `consume` for
every drink operation. A transition has no cost field of its own; it is driven
by an operation (`transitions[].via`) whose typed cost `use_item` already spends
through the same turn-resource path.

The pack therefore changes only in derived `executionReadiness` data. The
compiler now removes the four F2 activation-economy hooks from a clause's
`missingHooks` only when that clause's operation, state-machine `via`
operations, or sole referencing operation carries a typed action /
bonus-action / reaction cost. The hooks are not added to
`LANDED_MAGIC_ITEM_ENGINE_HOOKS`; untyped clauses keep them.

Generated change (all inside `executionReadiness.clauses`, no operation,
effect, economy or state-machine record changed): 166 clauses lose one
activation hook (43 operation, 11 state-machine, 108 + 3 effect clauses, plus
one clause that becomes green), and exactly one clause moves engine-pending to
green (Staff of Swarming Insects insect-cloud payload). Green clauses 226 to
227, engine-pending 790 to 789, total 1377 unchanged; the 19 ready operations
are unchanged.

Updated `records.json` SHA-256:

`6b85d51011dad239dbd0474e1029769d8b6b29cbef44833aaa03b3ac7ef3ad75`
