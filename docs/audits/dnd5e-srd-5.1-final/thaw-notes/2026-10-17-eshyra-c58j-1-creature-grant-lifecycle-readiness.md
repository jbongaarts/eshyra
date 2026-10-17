# Thaw note: per-clause ownership of creature-grant lifecycle and identity hooks

Bead: `eshyra-c58j.1` (parent `eshyra-c58j`; readiness half of `eshyra-xt6m`;
capability `eshyra-olc5.12`)

`start_effect` binds a typed `kind: 'creature'` entity grant with grant
identity, variant admission, actor links, printed timer / 0-hit-point /
concentration endings, persistent-actor durability, grant-ended cooldown
anchors, bind credits, consumption receipts, destroy tombstones and retired ids
(PRs #665/#669). The compiler now removes the F3 `encounter combatant,
persistent actor, and owned-entity lifecycle` hook and the F5 `item-instance
cooldown and owned-entity identity link` hook from an `entityGrant` clause
only when `creatureGrantLifecycleOwned` holds (no containment block; runtime
owner encounter-combatant or persistent-actor; every grant is a creature grant;
every grant prints at least one ending and every printed ending is
engine-computed: a fixed timer, 0 hit points, or the concentration break). The
hooks are not added to `LANDED_MAGIC_ITEM_ENGINE_HOOKS`.

The F2 `controlled-entity command action budget` hook is not engine-owned:
control stays DM-adjudicated (decision on `eshyra-c58j` / `eshyra-olc5.12`).
For an owned grant it leaves the engine-pending entityGrant clause and is carried
by a new `m4-control-<item>` adjudicated clause (no engine hook, like every
adjudicated clause) whose `sourceText` is the verbatim printed control sentence
(checked by the clause integrity check). F4 on the
Elemental Gem quantity clause stays: it names spell execution, which the
runtime does not perform.

Generated change (only `executionReadiness`; no operation, effect, economy or
grant record changed): seven items (Bowl of Commanding Water Elementals,
Brazier of Commanding Fire Elementals, Censer of Controlling Air Elementals,
Stone of Controlling Earth Elementals, Elemental Gem, Horn of Valhalla, Ring of
Djinni Summoning) each gain one adjudicated control clause and their entityGrant
clause goes engine-pending to green. Counts: engine-pending 789 to 782, green
227 to 234, adjudicated-by-design 360 to 367, total 1377 to 1384. Hook counts:
F3 lifecycle 16 to 9, F5 identity link 16 to 9, F2 control budget 15 to 8.
Newly ready operations: Horn of Valhalla blow-horn, Ring of Djinni Summoning
summon-djinni (13 to 15), each with a real-pack, no-waiver conformance test.
Nine grant-bearing items keep the hooks (see
`magicItemGrantOwnership.test.ts`).

The semi-structured boundary inventory (`docs/inventories/o9bd-18-8-8-*`) was
regenerated (1859 rows unchanged; per-field counts only).

Updated `records.json` SHA-256:

`14650f7d66ee5306508c42a9df9b95214b64fa49704c5a25d6707e27dd996e3d`
