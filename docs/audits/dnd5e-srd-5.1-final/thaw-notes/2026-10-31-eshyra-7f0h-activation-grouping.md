# Thaw note: Apparatus of the Crab and Candle of Invocation activation grouping

Bead: `eshyra-7f0h.1` (owning spec `eshyra-7f0h`)

## Reason for thaw

The printed text gives ONE action to a group of changes, so a per-change
operation could not carry a faithful cost:

- Apparatus of the Crab: "A creature in the compartment can use an action to
  move as many as two of the apparatus's levers up or down." The eleven
  `set-lever-N` operations each moved one lever, so typing the action would have
  billed one action per lever; they stayed untyped and engine-pending.
- Candle of Invocation: lighting requires an action; burning is a continuous
  burn-time deduction; the gate spell is the first-light alternative. The
  `burn` and `cast-gate` operations could not type the lighting action.

Decisions (supervisor, implemented as specified):

1. **Apparatus: one operation.** The eleven `set-lever-N` operations are
   replaced by `move-levers`, `activation: {cost: 'action'}`, with a new typed
   operation field `leverSelection: {tableRef:
   'table:apparatus-of-the-crab-levers', min: 1, max: 2}` (validator in
   `magicItemMechanics.ts`; item-local, not a selection framework).
   `use_item` gains an optional `levers: [{lever, direction}]` input: required
   for an operation with `leverSelection`, refused otherwise; it validates 1 to
   2 entries, DISTINCT integer lever numbers present in the table and direction
   `up|down`, before the single action is spent, and returns each selected
   row's printed Up/Down cell for the DM. A third lever is another call and
   another action (the existing turn-resource accounting). Levers return to
   neutral after each use, so no lever position is stored; the vehicle state is
   DM-adjudicated.
2. **Apparatus readiness.** The `move-levers` operation clause carries only the
   landed `F2: olc5.11 pack-tested paid item operation` hook. The lever effects
   (F5 complex state, F9 geometry/movement) stay DM-adjudicated through the
   existing hook-free adjudicated `m5-complex-apparatus-*` /
   `triage-stateMachine-0` clauses (their spans still cover "After each use, a
   lever goes back to its neutral position" and the table reference) and the
   green `S` table structured-field clause. No new adjudicated span was needed;
   the eleven per-lever activation clauses become one `activation-move-levers`
   clause with the printed sentence.
3. **Candle: lit/unlit state machine.** A kept (gate) machine, initial `unlit`,
   states `unlit`, `lit`, `snuffed`, `destroyed`: `light` (action) `unlit` or
   `snuffed` to `lit`; `snuff` (no cost printed, none typed) `lit` to
   `snuffed`; `cast-gate` (action: the lighting action; the gate spell's own
   casting time is also 1 action, so there is no conflict) `unlit` to
   `destroyed`. `snuffed` is the one state beyond the two-state sketch: it is
   what lets the first-light alternative be refused once the candle has ever
   been lit. New operation field `requiresState` (checked in `useItem` before
   any cost is spent): `burn` (burn-time, no action) is refused unless the
   candle is `lit`. The pre-existing `excludes: ['burn']` on `cast-gate` is
   declared but is NOT enforced anywhere at runtime; the `unlit`-only
   transition is what enforces "never lit, so never burned". The new machine is
   a separate set (`KEPT_GATE_MACHINES`) because a candle can be lit, snuffed
   and relit, so it is not a single-lifetime machine. Its clause is tagged `C1`
   (not `M5`) so the reviewed M5 census of 50 items is unchanged.
4. **Ledger.** The eleven Apparatus dispositions and the Candle `cast-gate`
   disposition are removed; `burn` keeps a disposition (burn-time deduction
   costs no action), `snuff` gets one (no action printed), and
   `TYPED_ACTIVATION_COST_EVIDENCE` gains `Apparatus of the Crab/move-levers`,
   `Candle of Invocation/light` and `Candle of Invocation/cast-gate`, each with
   its exact printed span. `magicItemActivationCensus.json` follows.

## Expected file changes

- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` (`magicItemCandleLifecycle.ts`
  new; `magicItemComplexStateMachines.ts`, `magicItemFaithfulOperations.ts`,
  `magicItemFaithfulLifecycles.ts`, `magicItemFamilyRegistry.ts`,
  `magicItemTriage.ts`, `magicItemCompiler.ts`,
  `magicItemActivationCostLedger.ts`, `magicItemActivationCensus.json`)
- [x] `packages/core/src/` (`rules/magicItemMechanics.ts`,
  `rules/magicItemVariants.ts`, `state/itemState.ts`,
  `orchestrator/toolUseItem.ts`)
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json`
- [x] `docs/inventories/o9bd-18-8-8-semi-structured-boundary.{json,md}`

## Generated change

Only `records.json` changes; no record is added or removed.

- Apparatus of the Crab: operations `set-lever-1` .. `set-lever-9`,
  `set-lever-10-up`, `set-lever-10-down` (11) removed; `move-levers` added.
- Candle of Invocation: operations `light` and `snuff` added; `stateMachine`
  added; `burn` gains `requiresState: 'lit'`; `cast-gate` gains
  `activation: {cost: 'action'}`.
- Clause counts: engine-pending 760 to 749 (the eleven Apparatus operation-bound
  clauses leave), green 258 to 260 (`triage-stateMachine-op-move-levers` and
  `c1-candle-lit-state`), adjudicated-by-design 368 to 358 (eleven
  `activation-set-lever-*` clauses become one `activation-move-levers`),
  design-blocked 1 (unchanged), total 1387 to 1368.
- Legacy hook-backed backlog candidates 806 to 797 (-11 Apparatus operation
  candidates, +1 `move-levers`, +1 Candle machine clause).
- Operation census 358 to 350 (-11 +1 +2).

Newly ready operations (4): Apparatus of the Crab `move-levers`; Candle of
Invocation `light`, `snuff` and `cast-gate` (`burn` was already ready). The
ready set grows from 36 to 40. Removed operations (11): the Apparatus
`set-lever-N` set (none was ready). The Candle `m9-cast-candle-spell`
spell-store clause and the `c2-residual-invocation-zone` light-zone effect stay
engine-pending, and the gate spell's effects stay DM-adjudicated.

Updated `records.json` SHA-256:

`37fa68943d690d38b79fbe36b05994849f420702eb83f836e7a8eaa610a3dede`

## Evidence

`candleAndApparatus.test.ts` (unmodified pack, no readiness waiver):
two distinct levers spend one action and return both printed cells; three
levers, the same lever twice, no levers, an unknown lever and a bad direction
are refused before the action is spent; a second use the same turn is refused
for lack of an action; burn while unlit is refused; light spends the action;
burn spends burn-time and no turn resource; snuff then burn and cast-gate are
refused; cast-gate on a fresh candle spends the action and destroys it.
`magicItemMechanicsSchema.test.ts` (`requiresState` / `leverSelection`
validator refusals), `magicItemActivationEconomy.test.ts` (ledger equality),
`itemTransitionTurnResource.test.ts` (the driven `cast-gate` transition into
the destroyed state).
