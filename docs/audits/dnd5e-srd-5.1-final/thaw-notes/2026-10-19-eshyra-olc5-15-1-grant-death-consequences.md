# Thaw note: grant death consequences (Ring of Djinni, Staff of the Python, Efreeti Bottle)

Bead: `eshyra-olc5.15.1` (owning spec `eshyra-olc5.15`; follows `eshyra-c58j`,
stacked on `eshyra-olc5.14`)

PR #673 kept three grants pending because their curated `onEntityDeath` note was
stripped from the pack by triage and applied by no runtime. This change types and
executes the two source consequences and corrects the third.

- **Ring of Djinni Summoning** ("the ring becomes nonmagical if the djinni
  dies"): the record gains a two-state `stateMachine` (`magical`, `nonmagical`)
  with one external-event transition `condition: "the djinni dies"`,
  `becomes: "nonmagical"` (a verbatim span of the printed sentence). The DM
  adjudicates the death (as opposed to 0 hit points and a return home, an
  ordinary ending) and reports it through the existing `item_state_event` path;
  no new event channel. The transition writes `lifecycle: nonmagical` durably in
  the event's transaction (provenance and session recorded), ends every live
  grant bound to the instance in the same transaction (reason
  `source-removed`, detail `creature-died`), and works with no summon active. It
  schedules NO cooldown (see `applyItemCooldownAnchorEvent`: a nonmagical item
  has nothing to cool down); ordinary endings are unchanged and only start the
  24-hour cooldown. A second event finds no transition from `nonmagical` and is
  refused with no change. A later `summon-djinni` is refused by the existing
  nonmagical gate.
- **Staff of the Python** ("it dies and reverts to its staff form. The staff
  then shatters and is destroyed"): the `python-form` grant gains the typed
  `destroysItemOn: "reduced-to-0-hit-points"`. At bind time the flag is stored
  on the item-grant binding; `finalizeEnd` (the one choke point every ending
  reaches) destroys the source instance through `destroyInventoryItem`, after
  the effect has ended, whenever the ending reports `zero-hit-points`. The
  bonus-action reversion reports no such detail and leaves the staff intact.
  The Staff stays kept and readiness-refused (`owner-bonus-action-command` is
  DM-ended; mental-command control is adjudicated); the verbatim sentence stays
  in the adjudicated m5 span.
- **Efreeti Bottle**: the source prints no death-triggered item transition; the
  curated `onEntityDeath` ("resolve the efreeti's normal death; the bottle
  outcome remains spent") was a curation note and is removed. No item
  transition is added. The bottle-loses-magic outcomes are `table:efreeti-bottle`
  outcomes carried by that table and the random-procedure clause (unchanged).
- **Guard**: `MAGIC_ITEM_ENTITY_GRANT_KEYS_WITH_DEATH_CONSEQUENCE` is now empty
  (it remains the fail-closed mechanism for any untyped `onEntityDeath` note).

Schema additions (minimal, on existing shapes): state-machine transition
`becomes?: 'nonmagical'` (valid only with `condition`) and entity-grant
`destroysItemOn?: 'reduced-to-0-hit-points'` (must be one of the grant's
`revertOn`). A nonmagical lifecycle is additionally licensed by a transition
whose `becomes` destination is the instance's machine state.

Generated change: Ring record only, plus one Staff grant field. Ring: new
`stateMachine`; its entityGrant clause moves engine-pending to green; one
hook-free adjudicated control clause and one green `m4-lifecycle-...` clause
(landed hook `F5 external-event item lifecycle consequence`) are added. Staff:
`destroysItemOn` on the grant (no readiness change). Counts: engine-pending 783
to 782, green 233 to 235, adjudicated-by-design 366 to 367, total 1383 to 1385.
Newly ready operation: Ring of Djinni Summoning `summon-djinni` (it was ready at
c58j.1 before the guard). The legacy hook-backed backlog grows 805 to 806 (the
one new green clause).

Updated `records.json` SHA-256:

`2b535efeda49ac0ad82b5ef4e91012fc81db327813734273ebf54855f0028778`
