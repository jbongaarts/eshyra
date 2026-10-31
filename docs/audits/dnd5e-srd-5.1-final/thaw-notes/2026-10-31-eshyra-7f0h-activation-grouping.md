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

## Review repair (eshyra-7f0h.3)

Repairs Sol review finding S1 on PR #694 (eshyra-7f0h.2): the Candle's
`cast-gate` became executable with an action cost but no bound spell identity,
so use_item recorded it as a non-spell item action and a bonus-action spell
could be cast in the same turn. Decision (supervisor): type the printed spell
and keep the operation truthfully refused until spell execution is owned, as
the pack already does for Cubic Gate's `cast-gate`.

Source changes (`magicItemCandleLifecycle.ts`):

- `cast-gate` operation gains `effects: ['c2-cast-gate']`.
- New castSpell effect `c2-cast-gate` with `spellRef: 'spell:gate'`, merged
  with the existing `c2-residual-invocation-zone` effect from the residual
  family.
- New clause `c2-effect-cast-gate` (tag C2, block `effects`, engine-pending on
  F4 `canonical spell execution`).

Generated records: only `records.json` changes among the pack files, and only
in the Candle of Invocation record (+40 lines): the `cast-gate` operation's
`effects`, the castSpell effect (its duration `1 minute` and concentration
`true` are derived from `spell:gate`, "Concentration, up to 1 minute", as for
the other timed spell effects), and the new engine-pending clause. No record is
added or removed. Pack verification (`npm run verify:dnd5e-srd-pack`): records
added 0, removed 0, changed 0; committed pack matches importer output exactly.

Updated `records.json` SHA-256:

`84c326453f92ba93e3599fbb5d5f90b449eed0ff75cfea7547d7e712561cc0b5`

Clause counts (corrected from the original section above): engine-pending 749
to 750 (`c2-effect-cast-gate`), green 260 unchanged, adjudicated-by-design 358
unchanged, design-blocked 1 unchanged, total 1368 to 1369. The ready set falls
from 40 to 39: `cast-gate` is no longer newly ready. Newly ready operations are
now `move-levers` (Apparatus), `light` and `snuff` (Candle). Operation census
350 (unchanged); legacy backlog candidates 797 to 798 (+1 `c2-effect-cast-gate`, the F4 engine-hook clause; the backlog test pins were updated to 798 and the new fingerprint).

Semi-structured boundary inventory (`docs/inventories/o9bd-18-8-8-semi-structured-boundary.{json,md}`)
regenerated: row count 1865 unchanged; magic-item population counts +1 for
clause/engine/hook fields, and `spell:gate` joins the castSpell `spellRef`
samples (`spell:web` drops out of the sample set). Written with the script's
own CLI (`npx tsx packages/core/scripts/inventory-semi-structured-boundary.ts`),
which calls `writeCommittedOutputs()`; `--check` passes afterwards.

Evidence (`candleAndApparatus.test.ts`, unmodified pack, real readiness):

- `cast-gate` on a fresh candle in combat is refused by readiness, naming
  `c2-effect-cast-gate` and `canonical spell execution`; the candle row, its
  unlit state and the turn's action are unchanged; `light` then succeeds and
  spends that action.
- `cast-gate` after snuff, and after a burn while lit, is refused by the same
  readiness gate (previously the state-machine guard). The state-machine guard
  for `cast-gate` is therefore not reachable through use_item until spell
  execution is owned; it remains typed in the pack.
- `planItemTurnResource` on the real pack's `cast-gate` operation binds
  `spellRef: 'spell:gate'` with `source: 'activation-cost'`, so once owned the
  cast is accounted as a spell.
- Negative proof: with the F4 engineHooks entry removed from the source (pack
  regenerated), three Candle tests fail because `cast-gate` becomes executable.
  The source was restored and the pack regenerated; the records diff returned
  to the same +40 lines.

Test pins updated to actual values (none weakened; each still asserts every
item it counted):

- `srdGeneratedPack.test.ts`: clause total 1368 to 1369; readiness
  engine-pending 749 to 750, green/adjudicated/design-blocked unchanged.
- `magicItemTriage.test.ts`: operation-bound castSpell duration check 94 to 95
  (the new `spell:gate` effect, whose timed duration is verified).
- `magicItemOperationSourceAgreement.test.ts`: `Candle of Invocation||cast-gate`
  removed from the executable operation READY set (39 entries).
- `itemState.test.ts`: the bundled pending-operation refusal on the granted
  candle now asserts the readiness refusal (same intent: refused before any
  mutation; state, inventory row and attunement unchanged).
