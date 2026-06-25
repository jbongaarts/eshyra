# First Combat Regression Recipe

This recipe follows the first Claude combat playtest after `eshyra-l3b3`, but
does not require the live RNG stream to reproduce the same branch. Exact
mechanical-path assertions belong in
`packages/core/test/combatRegressionFixture.test.ts`, which uses a test-only
roll plan.

## Deterministic Fixture

The fixture forces this path:

- Bob wins initiative.
- Bob's first attack misses.
- Goblin attacks miss.
- Bob's second attack hits.
- Bob's damage kills `ci-enc-goblins-1-goblin-1`.
- `ci-enc-goblins-1-goblin-2` critically hits Bob.
- Damage drops Bob to 0 HP.
- Bob receives a dying condition.
- Bob makes a death save and succeeds.

The assertions check mechanical invariants rather than exact prose:

- Rolls are executed by the `roll` tool.
- Player-visible rolls are rendered by the code-owned ledger.
- Monster HP/death is backed by `update_combatant`.
- Bob's HP/condition changes are backed by character state tools.
- Combatant ids are stable after `start_encounter`.
- Rejected candidates do not persist state.
- Successful retries do not duplicate combat instances or combatant rows.

## Live RNG Playtest

Use the same watchtower hollow / two-goblin scenario with real RNG. Treat the
transcript as branch-tolerant:

- If Bob attacks, the player attack roll is visible.
- If Bob hits, the damage roll is visible.
- If a goblin attacks Bob, the enemy attack roll is visible.
- If Bob takes damage, the damage roll and HP/state change are visible.
- If Bob reaches 0 HP, unconscious/dying state and death-save flow are visible.
- If Bob kills both goblins, combat ends cleanly and state reflects both enemies
  defeated.

No part of this recipe is blocked on `eshyra-d8ap.2`; combatant state has landed
and the deterministic fixture depends on it.
