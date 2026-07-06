# eshyra-o9bd.18.7.7 — Magic-item mechanics & live-state contract design

Date: 2026-07-06. Epic: `eshyra-o9bd.18.7.7`. Status: **design** — the
shared architecture for children .1/.2 and .4–.11; implementation follows
per-child.

Inputs (do not re-derive):

- `2026-07-06-o9bd-18-7-7-3-magic-item-mechanics-inventory.md` (PR #407) —
  clause-level owners for all 240 items (C1/C2/S/M1–M11).
- `2026-07-06-o9bd-18-7-8-execution-boundary-classification.md` (PR #406,
  **corrected revision**) — engine families F1–F10; the Hybrid Contract
  facts (math is tool-owned; `overlay_facts` is world-overlay lore, not a
  mechanics store; no DM currency surface; character/combatant condition
  entries are the apt durable mechanism for temporary states).

## 1. The three-layer contract

Magic-item behavior decomposes into exactly three layers, and every child
bead must keep them separate:

1. **Pack data (immutable, importer-owned)** — typed
   `data.mechanics` on the `magic-item` record: what the item *can* do.
   Never stores play-state. Regenerated only by the importer under
   `docs/importer-fix-protocol.md`.
2. **Live per-instance state (campaign DB)** — charges remaining, toggle
   on/off, attunement, curse-attached, sworn enemy, stored spell levels,
   cooldown-until, occupancy of containers. Exists per *inventory instance*
   (two wands of fireballs have independent charges).
3. **Engine hooks (F-families)** — reset events (dawn/dusk/short/long rest →
   F5/F7), temp HP and dying interactions (F6), concentration (F3), slot
   recovery/creation (F4), bonus-action grants (F2), adv/dis and derived
   math (F1/F9). Items *subscribe* to these; they never re-implement them.

## 2. Live-state ownership decision

**Facts (from the corrected #406 survey):** `give_item` upserts arbitrary
`properties` on inventory rows (durable, shown in the turn-context
snapshot), but the payload is free-form JSON — nothing validates a charge
decrement, prevents a 4th attunement, or runs a dawn recharge.
`overlay_facts` is off-limits for mechanics state. `mutate_state` is not
registered as a DM tool.

**Decision (recommended):** introduce a typed **item-state owner** rather
than standardizing on free-form `properties_json`:

- A dedicated `item_state` column or table keyed by inventory row id,
  holding a discriminated-union state document validated against the
  item's pack-side `mechanics` shapes (a charge state may exist only for an
  item whose pack record declares a use economy, etc.).
- A DM tool `use_item` (name per implementation) that performs *semantic*
  operations, not raw writes: `{ itemId, operation: "expendCharges" |
  "activate" | "deactivate" | "consumeDose" | "attune" | "unattune" |
  "storeSpell" | "castStored" | …, args }`. The tool enforces the
  invariants (insufficient charges → error; attunement max 3 → error;
  curse blocks unattune → error) and applies the state transition. This is
  the item-side analogue of `adjust_hp` clamping: the tool surface makes
  silent violation impossible.
- Reset events are engine-driven, not model-driven: the F5/F7 owners fire
  `dawn` / `dusk` / `short-rest` / `long-rest` / `turn-start` events that
  walk item states and apply declared recharge (seeded dice for `1d6+1`
  recharges, through the same RNG as `roll`).
- **Transitional rule:** until `use_item` lands, children may document a
  namespaced `properties_json.mechanics` convention so the DM model can at
  least persist state durably via `give_item` upsert — but readiness must
  not count any economy green on that basis; it is model-enforced state,
  which is exactly the gap this design closes.

**Attunement (F5) is campaign-level, not item-level:** the 3-slot counter
and no-duplicate rule live with the character; item rows carry only their
`requiresAttunement`/`attunementRequirement` pack data and an `attunedTo`
state field. Inter-item attunement preconditions (hammer-of-thunderbolts)
and alignment/class gates evaluate at `attune` time.

## 3. Pack-side `mechanics` shapes (schema sketch)

One optional `mechanics` object on `magic-item` `data`, with orthogonal
blocks. All blocks optional; the fail-closed membership register (§5) says
which items must carry which blocks.

```ts
interface MagicItemMechanics {
  activation?: {
    mode: 'passive' | 'action' | 'bonus-action' | 'reaction' | 'command-word'
        | 'consume' | 'apply' | 'plant' | 'throw';
    commandWord?: boolean;          // silence-gated (rule:command-word)
    requiresHeld?: boolean; requiresWorn?: boolean;
    reactionTrigger?: string;       // prose trigger, model-adjudicated
  };
  useEconomy?: {                    // C1 (18.7.7.1)
    kind: 'charges' | 'per-day' | 'cooldown' | 'budget' | 'single-use'
        | 'doses' | 'at-will';
    charges?: { max: number | DiceExpr; recharge?: { amount: DiceExpr | 'all';
      at: 'dawn' | 'dusk' | 'hour' | 'long-rest' | 'days'; days?: number };
      onLastCharge?: { roll: 'd20'; destroyedOn?: number; regainOn?: number;
      loseProperty?: boolean } };
    perDay?: { uses: number; resetAt: 'dawn' | 'dusk' | 'long-rest' };
    cooldown?: { duration: DurationSpec };      // 7 days, 1d12 hours, …
    budget?: { total: DurationSpec; increment: DurationSpec;
      regain?: { amount: DurationSpec; per: DurationSpec } }; // winged-boots
    doses?: { count: DiceExpr };
    depletion?: 'destroyed' | 'nonmagical' | 'inert' | { becomes: string };
  };
  effects?: MagicItemEffect[];      // C2 (18.7.7.2): bonuses, riders,
                                    // resist/immunity, adv/dis, save-DC'd
                                    // effects, spell grants — the reusable
                                    // payload vocabulary; M1 consumables and
                                    // M2/M3 passives reuse it wholesale
  stateMachine?: {                  // M5
    states: string[]; initial: string;
    transitions: { from: string; to: string; via: ActivationRef | 'timer'
      | 'condition'; note?: string }[];
    duration?: DurationSpec; termination?: string[];   // source-backed ends
  };
  entityGrant?: {                   // M4
    statBlockRef?: string; creatureRef?: string;
    control: 'obedient' | 'friendly' | 'contest' | 'independent';
    disobedienceChance?: number;    // obsidian steed 10%
    duration: DurationSpec; revertOn: string[];
    onEntityDeath?: 'item-destroyed' | 'item-nonmagical' | 'none';
  };
  containment?: { /* M6: capacity, occupancy, rupture, suffocation, exits */ };
  curse?: {                         // M7
    revealedBy: ('identify' | 'attunement')[];
    endedBy: string[];              // remove curse, The Fates, god…
    blocksUnattune?: boolean; blocksDoff?: boolean;
    effects: MagicItemEffect[];     // the drawbacks, same vocabulary
    exclusiveState?: { key: string; replaceRule: string }; // oathbow
  };
  randomProcedure?: {               // M8
    tableRef?: string; inlineDie?: DiceExpr;   // amulet-of-the-planes d100
    riskPercent?: number; cumulative?: boolean; // horn 20%, wind-fan
    procedureNote: string;          // declared-draw rules etc.
  };
  spellStore?: { /* M9: capacityLevels, casterOfRecord, storeOn, castOut */ };
  rollManipulation?: { /* M10: reroll | replace-fail | reflect | pb-double */ };
  interItem?: { requiresItems?: string[]; counters?: string[];
    nestingHazard?: 'astral-gate' };            // M11
}
```

`DiceExpr` reuses the `dice.ts` grammar (F1 extends it); `DurationSpec` is
`{ amount, unit: 'round'|'minute'|'hour'|'day' }` and is what F5/F7 reset
events and `update_clock` evaluate against. Where a clause is genuinely a
ruling (reaction triggers, "appropriate anatomy"), the shape carries prose
in a `note`/`procedureNote` field — do not force rulings into enums.

## 4. Golden examples (implement these first, in this order)

1. **potion-of-healing** — M1 + C2 + S: `consume` activation, doses=1,
   effect `restoreHp` by rarity table. Simplest end-to-end proof.
2. **staff-of-fire** — C1 + C2: charges 10, recharge 1d6+4@dawn,
   last-charge d20 destruction, spell grants w/ own DC, passive resistance.
   The modal magic item; ~40 items follow this exact profile.
3. **flame-tongue** — M5 minimal: two-state toggle, C2 rider while active.
4. **figurine-of-wondrous-power (bronze griffon)** — M4 + C1: entityGrant
   with duration 6 h, cooldown 5 days, revert conditions; proves the
   pack-data vs live-combatant boundary (summoned creature is an encounter
   combatant, not pack state).
5. **oathbow** — M7: exclusiveState with source-backed replacement rule
   (dies-or-7th-dawn, one at a time), C2 riders keyed to the state.
6. **cube-of-force** — M5 hard: charges + per-face costs + barrier state
   machine + table-driven charge losses.
7. **ring-of-spell-storing** — M9: designed against F4; stored levels are
   live state with caster-of-record metadata.
8. **deck-of-many-things** — M8 flagship: declared-draw procedure; card
   effects resolve as one-time GM-mediated events over engine surfaces
   (XP, currency-F10, curse states) — the design ceiling; do it last.

## 5. Validation & readiness

Mirror the 18.7.8.1 fail-closed pattern: a reviewed membership register
maps every magic-item key → required `mechanics` blocks (from the #407
clause table). Build-time validations: (a) every key present, no stale
keys; (b) an item whose #407 row carries C1 must have `useEconomy`, M5 →
`stateMachine`, etc.; (c) tableRef'd blocks must reference existing table
records; (d) DiceExpr fields parse under the (F1-extended) grammar;
(e) pinned per-block censuses. Readiness: an item is green only when every
clause-tag from #407 has its block present *and* the block's live-state
operations are tool-enforced (not transitional `properties_json`).

## 6. Agent split

- **Opus 4.8**: this contract's TS types + validators; `use_item` tool +
  item-state owner; M4/M5/M6/M7 shape finalization; deck-of-many-things and
  sphere-of-annihilation bespoke design; F4/F5 integration points.
- **Codex GPT-5.5**: importer projection of `mechanics` blocks from prose
  for the regular profiles (staffs/wands/rings/potions — golden examples 1–2
  templatize ~140 items); membership-register transcription from #407;
  schema tests; committed-pack depth assertions.

## 7. Unresolved decisions (for the owning beads)

1. `use_item` operation vocabulary final list, and whether attune/unattune
   is part of it or a separate tool (leaning separate: attunement is
   character-scoped, F5).
2. Item-state storage: dedicated table vs typed column on `inventory` —
   pick during F5 implementation; the contract above is agnostic.
3. Whether summoned-entity live state (M4) reuses encounter combatants
   outside combat (likely yes, via persistent actors per the system-prompt
   actor rules) — decide with 18.7.7.6.
4. Variant structuring for ioun-stone / crystal-ball /
   ring-of-elemental-command: importer change (extend `variants` usage)
   before or with 18.7.7.5 — importer-fix-protocol applies.
5. Whether `spell-scroll`'s casting-check procedure lands with M1 (18.7.7.4)
   or M9 (18.7.7.11) — the artifact tags both; pick one owner at kickoff.
