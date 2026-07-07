# eshyra-o9bd.18.7.7 — Magic-item mechanics & live-state contract design

Date: 2026-07-06 (revised same day: instance identity, multi-economy
cardinality, clause-level readiness; further revised same day: §5's clause
registry corrected to a dual-dimension representation-binding +
zero-or-more-engineHooks shape, per #407's F8 ownership correction). Epic:
`eshyra-o9bd.18.7.7`. Status: **design** — the shared architecture for
children .1/.2 and .4–.11; implementation follows per-child.

Inputs (do not re-derive):

- `2026-07-06-o9bd-18-7-7-3-magic-item-mechanics-inventory.md` (PR #407,
  **including its 2026-07-06 F8-ownership correction**) — clause-level
  owners for all 240 items (C1/C2/S/DB/M1–M11), including the corrected
  F2/F3/F4/F5/F6/F7/F8/F9/F10 engine-hook vocabulary (F1 is not clause-hook
  tagged by any #407 row today).
- `2026-07-06-o9bd-18-7-8-execution-boundary-classification.md` (PR #406,
  **final slow-time-arithmetic-exception revision, census 0/97/47/21/10**)
  — engine families F1–F10; the Hybrid Contract facts (math is tool-owned;
  `overlay_facts` is world-overlay lore, not a mechanics store; no DM
  currency surface; character/combatant condition entries are the apt
  durable mechanism for temporary states).
- Runtime evidence surveyed 2026-07-06: `inventory` DDL
  (`packages/core/data/schema.snapshot.sql` — `id TEXT PRIMARY KEY`,
  `character_id`, `quantity ≥ 0`, free-form `properties_json`);
  `giveItem` (`packages/core/src/state/domainMutations.ts`) upserts by
  model-chosen global id and **reassigns `character_id` on id collision**;
  the turn-context snapshot exposes `{id, name, quantity, location,
  properties}` per row (`contextAssembler.ts`).

## 1. The three-layer contract

Magic-item behavior decomposes into exactly three layers, and every child
bead must keep them separate:

1. **Pack data (immutable, importer-owned)** — typed
   `data.mechanics` on the `magic-item` record: what the item *can* do.
   Never stores play-state. Regenerated only by the importer under
   `docs/importer-fix-protocol.md`.
2. **Live per-instance state (campaign DB)** — charges remaining, toggle
   on/off, attunement, curse-attached, sworn enemy, stored spell levels,
   cooldown-until, occupancy of containers. Exists per *item instance* as
   defined by the §2 identity invariant (two wands of fireballs have
   independent charges).
3. **Engine hooks (F-families)** — reset events (dawn/dusk/short/long rest →
   F5/F7), temp HP and dying interactions (F6), concentration (F3), slot
   recovery/creation (F4), bonus-action grants (F2), adv/dis and derived
   math (F1/F9), currency-mediated outcomes (F10). Items *subscribe* to
   these; they never re-implement them.

## 2. Item-instance identity and stack semantics (the invariant)

**Problem being solved:** current inventory semantics are row-id +
`quantity`, the row id is a model-chosen **global** primary key, and
`give_item` upserts by that id (even stealing the row across characters on
collision). "Item state keyed by inventory row id" alone does not define
what an *instance* is when one row can hold `quantity > 1`, and nothing
stops the model from putting two Wands of Fireballs on one row.

**Decision — the stateful-singleton invariant:**

1. **An item instance is an inventory row, and the row id is the instance
   id.** Live item state is keyed 1:1 by inventory row id.
2. **Stateful ⇒ `quantity = 1`.** An item whose pack `mechanics` implies a
   per-instance mutable state document (any `economies` entry other than
   pure `at-will`/`single-use`, a `stateMachine`, `spellStore`, `curse`,
   `containment` occupancy, `entityGrant` cooldown, or
   `requiresAttunement`) is **stateful** and must occupy a singleton row.
   Enforced fail-closed on both sides: the item-state owner refuses to
   create or hold state for a row with `quantity ≠ 1`, and the instance
   mutation layer refuses to set `quantity > 1` on a row whose pack record
   is stateful.
3. **Stateless items may stack.** Mundane commodities and stateless magic
   items (pure passive effects without attunement, and single-use
   consumables whose only "state" is existence — e.g. potion-of-healing)
   keep row + `quantity` semantics; consumption is a quantity decrement /
   row removal, no state document.
4. **Type identity is separate from instance identity.** Every
   pack-recognized item row carries a first-class, validated `packRef`
   (e.g. `magic-item:wand-of-fireballs`) binding the instance to its
   immutable pack record. Row id ≠ pack key: two identical Wands of
   Fireballs are two rows with distinct row ids, the same `packRef`, and
   independent state documents.
5. **Instance ids are minted by the mutation layer, not the model.** For
   stateful items, the instance-granting mutation (the `give_item`
   successor path) mints a unique row id (`<packKey>#<short-suffix>`)
   instead of trusting the model to invent a globally unique id — the
   current upsert-by-model-chosen-id semantic (which silently merges or
   steals rows) is exactly what must not own instance creation. The model
   thereafter refers to instances by the row ids it sees in the
   turn-context snapshot.
6. **Explicit stack split exists.** When a stacked, stateless item becomes
   stateful (a curse attaches to one of three identical daggers; one
   potion is revealed to be something else), a `split` operation decrements
   the source row and mints a new singleton instance row that can then
   carry state. Mostly system-invoked at the moment state is first
   attached; also available as an explicit operation.
7. **Lifecycle preserves identity.** Transfer between characters moves the
   row (`character_id`) keeping row id and state document; consumption /
   destruction / removal deletes row and state atomically; depletion
   transitions (`destroyed` / `nonmagical` / `becomes:X`) are state-owner
   transitions tied to the economy that caused them. Checkpoint/replay:
   the state document lives in the same SQLite live store and is
   checkpointed with everything else; deterministic replay holds because
   every transition is a logged semantic tool call (never a free-form
   write), and recharge dice go through the seeded RNG.
8. **Migration/compatibility.** Existing rows for pack-recognized stateful
   items with `quantity > 1` are split into singleton rows at
   migration/first-touch; parseable transitional
   `properties_json.mechanics` state is lifted into the typed state
   document, anything else is flagged for GM review. Transitional state
   never counts green (§5).

**Storage (recommendation, resolving prior §7.2):** a dedicated
`item_state` table keyed by inventory row id (1:1, `ON DELETE CASCADE`),
not a column on `inventory` — cascade ties state lifetime to the instance,
keeps the hot inventory row narrow, gives validation a single write
boundary, and diffs cleanly under Dolt checkpoints. Final DDL stays with
the implementing child; the identity/cardinality invariant above is the
contract either way.

**The semantic mutation surface** (unchanged in spirit from the original
design, now operation-id-driven per §3): a DM tool `use_item` performs
*semantic* operations declared by the pack record — never raw writes — and
enforces the invariants (insufficient pool → error; attunement max 3 →
error; curse blocks unattune → error; stateful stacking → error). This is
the item-side analogue of `adjust_hp` clamping: the tool surface makes
silent violation impossible. Reset events are engine-driven, not
model-driven: the F5/F7 owners fire `dawn`/`dusk`/`short-rest`/`long-rest`/
`turn-start` events that walk item states and apply declared recharge
(seeded dice for `1d6+1` recharges, through the same RNG as `roll`).

**Transitional rule:** until `use_item` lands, children may document a
namespaced `properties_json.mechanics` convention so the DM model can at
least persist state durably via `give_item` upsert — but readiness must
not count any economy green on that basis; it is model-enforced state,
which is exactly the gap this design closes.

**Attunement (F5) is campaign-level, not item-level:** the 3-slot counter
and no-duplicate rule live with the character; item state carries only an
`attunedTo` field against its pack `requiresAttunement` data. Inter-item
attunement preconditions (hammer-of-thunderbolts) and alignment/class
gates evaluate at `attune` time.

## 3. Pack-side `mechanics` shapes (schema sketch)

One optional `mechanics` object on `magic-item` `data`, with orthogonal
blocks. All blocks optional; the fail-closed clause registry (§5) says
which items must carry which blocks — at clause granularity, not block
presence.

**Cardinality decision:** the original singular `useEconomy?: { kind: … }`
is replaced by **keyed multi-economy + operation binding**. The corpus
(#407) contains items with several independent pools (rod-of-lordly-might:
three separate 1/dawn abilities), charge pools shared by several effects
(staff-of-fire), duration budgets with partial regain (winged-boots), and
combined-use relationships across named properties
(staff-of-thunder-and-lightning). A single anonymous economy cannot
represent any of those faithfully.

```ts
type EconomyId = string; // stable kebab-case semantic id, reviewed with the
                         // registry: 'charges', 'drain-life', 'flight-budget'

interface MagicItemMechanics {
  activation?: ActivationSpec;      // item-level default; operations override
  economies?: Record<EconomyId, ItemEconomy>;   // C1 (18.7.7.1)
  operations?: ItemOperation[];     // the use-surface: what `use_item` targets
  effects?: MagicItemEffect[];      // C2 (18.7.7.2): bonuses, riders,
                                    // resist/immunity, adv/dis, save-DC'd
                                    // effects, spell grants — the reusable
                                    // payload vocabulary; M1 consumables and
                                    // M2/M3 passives reuse it wholesale
  stateMachine?: { /* M5: states, initial, transitions(via|timer|condition),
                      duration, termination */ };
  entityGrant?: { /* M4: statBlockRef, control, disobedienceChance,
                     duration, revertOn, onEntityDeath */ };
  containment?: { /* M6: capacity, occupancy, rupture, suffocation, exits */ };
  curse?: { /* M7: revealedBy, endedBy, blocksUnattune/Doff,
               effects, exclusiveState */ };
  randomProcedure?: { /* M8: tableRef|inlineDie, riskPercent, cumulative,
                         procedureNote */ };
  spellStore?: { /* M9: capacityLevels, casterOfRecord, storeOn, castOut */ };
  rollManipulation?: { /* M10: reroll | replace-fail | reflect | pb-double */ };
  interItem?: { /* M11: requiresItems, counters, nestingHazard */ };
}

interface ItemEconomy {
  kind: 'charges' | 'per-day' | 'cooldown' | 'budget' | 'doses'
      | 'single-use' | 'at-will';
  charges?: { max: number | DiceExpr };
  perDay?: { uses: number };
  cooldown?: { duration: DurationSpec };
  budget?: { total: DurationSpec; increment: DurationSpec };
  doses?: { count: DiceExpr };
  reset?: ResetSpec[];              // event subscription (F5/F7):
                                    // { at: 'dawn'|'dusk'|'short-rest'|
                                    //   'long-rest'|'hour'|'days'|'per-period',
                                    //   amount?: DiceExpr|'all'|DurationSpec,
                                    //   days?: number, period?: DurationSpec,
                                    //   onlyIfUnused?: boolean }
  onDepleted?: { roll?: 'd20'; destroyedOn?: number; regainOn?: number;
    loseProperty?: boolean;
    becomes?: 'destroyed' | 'nonmagical' | 'inert' | { itemRef: string } };
}

interface ItemOperation {
  id: string;                       // stable semantic id: 'cast-fireball',
                                    // 'drain-life', 'thunder-and-lightning'
  activation?: ActivationSpec;      // overrides item default
  cost?: { economy: EconomyId;      // one or MORE costs; several operations
           amount: number | DiceExpr | 'variable' }[]; // referencing the same
                                    // EconomyId = shared pool; disjoint ids =
                                    // independent pools
  excludes?: string[];              // mutual exclusion with other operation
                                    // ids (combined-use relationships)
  doesNotExpend?: EconomyId[];      // explicit non-expenditure carve-outs
  effects?: string[];               // effect ids from `effects` (C2 binding)
  note?: string;                    // ruling remainder, never forced to enums
}
```

`DiceExpr` reuses the `dice.ts` grammar (F1 extends it); `DurationSpec` is
`{ amount, unit: 'round'|'minute'|'hour'|'day' }` and is what F5/F7 reset
events and `update_clock` evaluate against. Where a clause is genuinely a
ruling (reaction triggers, "appropriate anatomy"), the shape carries prose
in a `note`/`procedureNote` field — do not force rulings into enums.

**Keyed live-state shape** (the `item_state` document; every key must be
licensed by the pack record it is validated against):

```ts
interface ItemInstanceState {
  packRef: string;                  // must equal the row's packRef
  attunedTo?: string;               // character id (F5 owns the 3-slot count)
  economies?: Record<EconomyId, {
    remaining: number;              // charges/uses/doses, or minutes for
                                    // budget kinds
    availableAt?: string;           // cooldown expiry (in-game clock)
    lastReset?: string;
  }>;
  machineState?: string;            // current M5 state name
  storedSpells?: { spellRef: string; level: number;
    saveDc: number; attackMod: number }[];        // M9 caster-of-record
  curse?: { attached: boolean; revealed: boolean };
  custom?: Record<string, unknown>; // per-shape bespoke state (e.g. the
                                    // deck's remaining-card set), validated
                                    // by that item's declared shape — NOT a
                                    // free-form escape hatch
}
```

## 4. Golden examples (implement these first, in this order)

Walked through the revised contract; together they exercise every
architecture shape without re-auditing the corpus:

1. **potion-of-healing** — M1+C2+S: *stateless stackable*. No `economies`;
   `consume` activation + `restoreHp` effect by rarity table. Three
   potions = one row, `quantity 3`; drinking decrements. Proves the
   stacking side of the §2 invariant and the simplest end-to-end path.
2. **staff-of-fire** — C1+C2+S: *one shared pool, several operations*.
   `economies: { charges: { kind:'charges', max:10, reset:[{at:'dawn',
   amount:'1d6+4'}], onDepleted:{ roll:'d20', destroyedOn:1 } } }`;
   operations `cast-burning-hands`/`cast-fireball`/`cast-wall-of-fire`
   cost 1/3/4 from the same `charges` economy. Stateful ⇒ singleton row;
   two staffs = two instances with independent `remaining`. The modal
   profile — ~40 items follow it exactly.
3. **rod-of-lordly-might** — C2+M5+C1+M3: *independent pools + form
   machine*. Three disjoint per-day economies (`drain-life`, `paralyze`,
   `terrify`, each `perDay:{uses:1}, reset:[{at:'dawn',amount:'all'}]`)
   each consumed by its own operation; the six-button form state machine
   is orthogonal `stateMachine` state; ram/compass/depth senses are
   at-will operations with no cost. Proves multiple independent economies
   on one item coexisting with M5 state.
4. **staff-of-thunder-and-lightning** — C1+C2: *combined-use
   relationships*. Five named properties, each its own 1/dawn economy
   (`lightning`, `thunder`, `lightning-strike`, `thunderclap`); the
   combined operation `thunder-and-lightning` has its own 1/dawn economy
   and declares `doesNotExpend: ['lightning','thunder']` per the source
   text. Proves stable per-property economy ids and explicit
   combined-use/non-expenditure semantics.
5. **winged-boots** — M3+C1: *duration budget with partial regain*.
   `economies: { 'flight-budget': { kind:'budget',
   budget:{ total:{amount:4,unit:'hour'}, increment:{amount:1,unit:'minute'} },
   reset:[{at:'per-period', period:{amount:12,unit:'hour'},
   amount:{amount:2,unit:'hour'}, onlyIfUnused:true}] } }`; the fly effect
   binds to the budget; 30-ft/round descent at expiry is the M3
   expiry clause. The hard budget case named by #407.
6. **flame-tongue** — M5 minimal: two-state toggle, C2 rider while active.
7. **figurine-of-wondrous-power (bronze griffon)** — M4+C1: entityGrant
   with duration 6 h, cooldown-economy 5 days, revert conditions; proves
   the pack-data vs live-combatant boundary (summoned creature is an
   encounter combatant, not pack state).
8. **oathbow** — M7: exclusiveState with source-backed replacement rule
   (dies-or-7th-dawn, one at a time), C2 riders keyed to the state.
9. **ring-of-spell-storing** — M9+M8: *state beyond economies*. No
   `economies`; `spellStore` capacity 5 levels; live `storedSpells` with
   caster-of-record DC/attack metadata; found with 1d6−1 levels (M8
   seeding). Designed against F4. Proves the keyed-state shape isn't
   economy-only.
10. **cube-of-force** — M5 hard: charges + per-face costs (six operations,
    one shared pool) + barrier state machine + table-driven charge losses.
11. **deck-of-many-things** — M8+M7+S flagship: *bespoke keyed state at
    the ceiling*. Declared-draw procedure; 1-hour inter-draw limit as a
    cooldown economy on the draw operation; the remaining/returned card
    set is validated `custom` state; card effects resolve as one-time
    GM-mediated events over engine surfaces (XP, currency → F10, curse
    states → M7). Do it last.

## 5. Validation & readiness — clause-level, not tag-level

Block presence is not evidence: a `stateMachine` block can exist while
representing one of three clauses #407 assigns to M5 on that item.
Tag-level checks ("C1 tag ⇒ `useEconomy` exists") therefore cannot prove
completeness. The gate is **clause-level**:

**Revision 2026-07-06 (dual-dimension correction):** the original single
`binding` field conflated two independent questions — "where does this
clause's *data* live in the pack/state model" and "does this clause depend
on an engine primitive that hasn't landed yet" — into one union, forcing a
clause to pick exactly one. That broke on #407's own corrected examples:
Robe of the Archmagi's spell-save-DC/attack bonus is simultaneously *pack
represented* (a C2 `effects` entry, per the #407 correction) *and*
*engine-pending* (F8's application hook hasn't landed) — the old shape could
prove one or the other, never both, so a represented-but-engine-pending
clause had no way to stay `engine-pending` instead of falsely reading
`green`/`red`. The corrected shape below carries exactly one reviewed
**representation** binding (unconditional — every clause has a pack/state
home or an explicit adjudicated/design-blocked disposition) plus zero or
more **engine dependencies** (conditional — only clauses that need an
unlanded Phase 1 primitive carry any):

1. **Reviewed clause registry** (`MAGIC_ITEM_CLAUSES`, transcribed once,
   mechanically, from the #407 artifact — the reviewed semantic source;
   CI never re-interprets prose). Every item key maps to a list of clause
   expectations with stable ids:

   ```ts
   type EngineFamily =
     | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7' | 'F8' | 'F9' | 'F10';
     // per the corrected #406/#407 vocabulary — every family #407 actually
     // tags a clause with (F1 is not: no #407 clause names an F1-hook
     // today; adding it back is a reviewed diff, not a silent omission).

   interface EngineHookBinding {
     engine: EngineFamily;
     hook: string;              // e.g. 'special-modifier application into
                                // derived spellSaveDc/spellAttackModifier'
   }

   interface PackBlockBinding {
     // M4–M11: the clause is one bespoke sub-block of a larger state shape,
     // not separately keyed (unlike economies/operations/effects below).
     block: 'stateMachine' | 'spellStore' | 'curse' | 'containment'
          | 'entityGrant' | 'randomProcedure' | 'rollManipulation'
          | 'interItem';
   }
   interface EconomyBinding { block: 'economies'; economyId: EconomyId }
   interface OperationBinding { block: 'operations'; operationId: string }
   interface EffectBinding { block: 'effects'; effectId: string }
   interface StructuredFieldBinding {
     // S: already-structured outside `mechanics` (§0 fields) — a table
     // reference, a `variants` entry, or an existing typed field the
     // clause reuses rather than duplicating into `mechanics`.
     block: 'structuredField';
     field: string;             // e.g. 'tableRefs', 'variants', 'damage'
     ref?: string;               // e.g. the specific table key
   }
   interface AdjudicatedBinding {
     // deliberate, reviewed model remainder — never graduates on its own;
     // changing this to a represented clause is a reviewed diff.
     adjudicated: true;
     note: string;
   }
   interface DesignBlockedBinding {
     // DB: a domain/architecture or source-data decision blocks even
     // designing the representation (orb-of-dragonkind's artifact Random
     // Properties — the table itself is absent from SRD 5.1).
     designBlocked: true;
     reason: string;
   }

   interface ItemClauseExpectation {
     id: string;             // 'staff-of-fire/charges',
                             // 'rod-of-lordly-might/drain-life',
                             // 'winged-boots/expiry-descent'
     tag: 'C1' | 'C2' | 'S' | 'DB' | 'M1' | … | 'M11';

     /** Exactly one reviewed representation/disposition binding. */
     representation:
       | PackBlockBinding
       | EconomyBinding
       | OperationBinding
       | EffectBinding
       | StructuredFieldBinding
       | AdjudicatedBinding
       | DesignBlockedBinding;

     /**
      * Zero or more engine dependencies. Present alongside a real
      * representation binding (not instead of one) whenever the clause's
      * runtime behavior needs a Phase 1 primitive that hasn't landed.
      * Empty/absent for clauses fully served by the current tool surface.
      */
     engineHooks?: EngineHookBinding[];
   }
   ```

   Illustrative instances (not the full registry — see #407 §2 for the
   exhaustive per-item clause list):

   ```ts
   // Armor of Vulnerability: pack-side C2 effect representation; F9 runtime
   // dependency for the deterministic vulnerability-damage-type math.
   {
     id: 'armor-of-vulnerability/vulnerability',
     tag: 'C2',
     representation: { block: 'effects', effectId: 'vulnerability-damage-type' },
     engineHooks: [{ engine: 'F9', hook: 'damage-resistance-and-vulnerability halve/double transform' }],
   }

   // Ring of X-ray Vision: C1 economy representation; F7 dependency for the
   // long-rest relationship (re-use before long rest is gated, not free).
   {
     id: 'ring-of-x-ray-vision/x-ray-vision-use',
     tag: 'C1',
     representation: { block: 'economies', economyId: 'x-ray-vision-use' },
     engineHooks: [{ engine: 'F7', hook: 'long-rest re-use gate' }],
   }

   // Robe of the Archmagi, post-#407-correction: pack-side C2 representation
   // of the spell-save-DC/attack bonus; F8 runtime application dependency.
   {
     id: 'robe-of-the-archmagi/spell-save-dc-attack-bonus',
     tag: 'C2',
     representation: { block: 'effects', effectId: 'spell-save-dc-attack-bonus' },
     engineHooks: [{ engine: 'F8', hook: 'special-modifier application into derived spellSaveDc/spellAttackModifier' }],
   }

   // A C1 reset economy with BOTH F5 and F7 dependencies (boots-of-speed's
   // "(F5/F7-hooks)" pairing in #407) — demonstrates cardinality > 1.
   {
     id: 'boots-of-speed/flight-budget',
     tag: 'C1',
     representation: { block: 'economies', economyId: 'flight-budget' },
     engineHooks: [
       { engine: 'F5', hook: 'per-use/per-period budget reset' },
       { engine: 'F7', hook: 'long-rest budget reset' },
     ],
   }

   // Orb of Dragonkind's artifact Random Properties: no representation is
   // possible yet — the source table itself is missing, not merely unowned.
   {
     id: 'orb-of-dragonkind/random-properties',
     tag: 'DB',
     representation: {
       designBlocked: true,
       reason: 'artifact Random Properties table absent from SRD 5.1 pack (verified #407 §0); GM-supplied content',
     },
   }
   ```

2. **Build-time integrity checks (normal CI, fail on violation):**
   (a) every #407 item key present in the registry, no stale/unknown keys;
   (b) pinned per-tag censuses from #407 asserted (drift = reviewed diff);
   (c) **representation integrity** — every clause's `representation`
   resolves: the named economy id / operation id / effect id / structured
   field **exists in the item's pack `mechanics` (or the named §0
   structured field, for `structuredField`)**, or the clause carries an
   explicit reviewed `adjudicated`/`designBlocked` disposition — this is
   what distinguishes "block exists" from "the clause is represented";
   (d) **engine dependency integrity** — every `engineHooks[]` entry names
   a family in the current `EngineFamily` union (itself checked against the
   corrected #406 family list — an engine family rename/removal is a
   reviewed diff, not a silent drift); (e) `DiceExpr` fields parse under the
   (F1-extended) grammar; tableRef'd blocks reference existing table
   records; every operation `cost` references a declared economy; every
   state-document key is licensed by the pack shape.
3. **Readiness report (gap-truthful, mirroring the #401 policy) — two
   independent dimensions, not one:** an item is **green** only when every
   clause's representation is satisfied AND every one of its `engineHooks`
   (if any) is satisfied by the landed tool/engine surface (`use_item` +
   item-state owner + the named F-family). A clause is never green merely
   because its representation exists — a represented clause with **any**
   unlanded engine dependency stays `engine-pending`, and a clause with
   **multiple** hooks (the boots-of-speed F5+F7 case) stays `engine-pending`
   until **all** are satisfied, not just one. Buckets: `green`,
   `engine-pending` (representation satisfied, ≥1 `engineHooks` entry not
   yet landed — checked against the registered tool/engine registry),
   `adjudicated-by-design` (explicit, reviewed model remainder —
   `AdjudicatedBinding`), `design-blocked` (`DesignBlockedBinding` — distinct
   from `adjudicated-by-design`: a decision/data gap blocks representation
   itself, not a deliberate ruling), `transitional` (state only in
   `properties_json` — **never green**), `red` (no resolvable
   representation and no reviewed disposition). Normal CI fails only on
   integrity errors (2); the readiness gaps stay visible until the
   re-freeze gate, which fails on any `red`/`transitional`.

## 6. Agent split & child ownership

Ownership against the existing children — **no new beads**; shared
infrastructure sits with the epic parent (`eshyra-o9bd.18.7.7`):

| Concern | Owner |
|---|---|
| §2 instance-identity invariant: singleton rule, `packRef`, id minting, `split`, migration; `item_state` storage decision | parent `eshyra-o9bd.18.7.7` (shared state-contract infrastructure) |
| `use_item` semantic tool core + operation dispatch + invariant enforcement | parent `eshyra-o9bd.18.7.7` |
| §5 clause registry + integrity checks + readiness buckets (framework) | parent `eshyra-o9bd.18.7.7`; per-item registry rows land with each child |
| `economies`/`operations` pack schema + importer projection of charge/per-day/cooldown/budget/dose data + economy live-state transitions | `eshyra-o9bd.18.7.7.1` (C1) |
| `effects` vocabulary + operation→effect binding | `eshyra-o9bd.18.7.7.2` (C2) |
| M1 consumables (stackable/stateless path, doses) | `.4` |
| M2+M3 passives (incl. budget-expiry clauses like winged-boots descent) | `.5` |
| M4 entity grants (combatant reuse decision) | `.6` |
| M5 state machines | `.7` |
| M6+M11 containment / inter-item | `.8` |
| M7 curses (incl. split-on-curse-attach flows) | `.9` |
| M8 random procedures (incl. deck bespoke `custom` state shape) | `.10` |
| M9+M10 spell storage / roll manipulation (F4 interop) | `.11` |
| Reset-event bus (dawn/dusk/rest events items subscribe to) | engine family **F5/F7** (external; #406 §4), not any 18.7.7 child |

- **Opus 4.8**: this contract's TS types + validators; `use_item` +
  item-state owner + identity invariant; M4/M5/M6/M7 shape finalization;
  deck-of-many-things and sphere-of-annihilation bespoke design; F4/F5
  integration points.
- **Codex GPT-5.5**: importer projection of `mechanics` blocks from prose
  for the regular profiles (staffs/wands/rings/potions — golden examples
  1–2 templatize ~140 items); clause-registry transcription from #407;
  schema tests; committed-pack depth assertions.

## 7. Resolved and remaining decisions

Resolved by this revision:

1. **`use_item` vocabulary** — operation-id-driven: the tool targets
   `{ instanceId, operationId, args }` against the pack-declared
   `operations` list (plus the generic lifecycle verbs `split`,
   `identify`, `activate`/`deactivate` for M5 items without bespoke
   operations). Attune/unattune are a **separate** character-scoped tool
   (F5 owns the slot counter).
2. **Item-state storage** — dedicated `item_state` table keyed by
   inventory row id (recommendation recorded in §2; final DDL with the
   implementing child).

Remaining (for the owning beads):

3. Whether summoned-entity live state (M4) reuses encounter combatants
   outside combat (likely yes, via persistent actors per the system-prompt
   actor rules) — decide with 18.7.7.6.
4. Variant structuring for ioun-stone / crystal-ball /
   ring-of-elemental-command: importer change (extend `variants` usage)
   before or with 18.7.7.5 — importer-fix-protocol applies.
5. Whether `spell-scroll`'s casting-check procedure lands with M1
   (18.7.7.4) or M9 (18.7.7.11) — the artifact tags both; pick one owner
   at kickoff.
6. Exact `give_item` evolution path: extend the existing tool with the
   minting/singleton rules vs. a parallel `grant_item` for pack-recognized
   items with `give_item` kept for ad-hoc/mundane grants — decide when the
   parent's instance layer is implemented (the §2 invariant holds either
   way).
