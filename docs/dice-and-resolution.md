# Dice Grammar & Deterministic Resolution (F1 + F9)

Beads: `eshyra-2n1t.3` (F1 dice grammar) and `eshyra-2n1t.11` (F9 deterministic
resolution & derived math). Source requirements:
`docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-8-execution-boundary-classification.md`
§4 (families F1/F9) and the SRD rule texts named per formula below.

F1 and F9 are one coordinated surface: F1 defines the canonical dice
representation; F9's resolution primitives consume that representation
directly — never by reparsing prose, and never losing the distinction between
**rolled facts** (individual dice) and **derived outcomes** (composed totals,
comparisons, formulas).

## Layering

```
dice.ts        F1 — grammar + one canonical roll result (rolled/kept/dropped/
               natural/modifier/total). Pure; RNG-injected.
character      Character creation is a non-tool consumer: it rolls `4d6dl1`
               through dice.ts and durably keeps the complete indexed evidence.
resolution.ts  F9 — d20 resolution (checks/saves/attacks/contests) and damage
               composition over dice.ts results. Pure; RNG-injected.
calc.ts        F9 — fail-closed registry of named non-roll formulas. Pure.
tool*.ts       Thin tool wrappers: `roll`, `resolve_check`, `resolve_contest`,
               `resolve_damage`, `calc`. All read-only (`mutates: false`).
ledger/trace   playerVisibleRollLedger.ts renders player-visible entries from
               tool results; turnTraceProjection.ts records every resolution
               in `rulesResolution` for audit/replay.
```

Design stance: **typed, fail-closed primitives, not a generic expression
engine.** Each gameplay operation with real semantics (advantage, proficiency
multipliers, crit doubling, resistance) is a typed input the engine owns, not
a string the model composes. Unknown formulas, out-of-range values, and
meaningless combinations (e.g. keep-count ≥ dice-count, keep/drop on damage
packets) are rejected with structured errors.

## F1 — dice grammar and the canonical roll result

Grammar (case-insensitive, whitespace tolerated):

```
[N]d<M>[kh<X>|kl<X>|dh<X>|dl<X>][+K|-K]
```

- `NdM` — N dice (1–100, default 1) with M faces (2–1000).
- `khX`/`klX` — keep the X highest / lowest dice. `dhX`/`dlX` — drop the X
  highest / lowest. Requires `N ≥ 2`; a keep of `X ≥ N` or a drop of `X ≥ N`
  is rejected (identity keeps and total drops are model confusion, not valid
  play). `2d20kh1` is advantage, `2d20kl1` disadvantage, `4d6dl1` the
  ability-score method.
- `+K`/`-K` — flat modifier.

`DiceRoll` is the single canonical representation both F1 and F9 use:

- `rolls` — **every** die rolled, in roll order (the rolled facts; audit and
  the player ledger always see the dice that were dropped).
- `kept` / `keptIndices`, `dropped` / `droppedIndices` — the code-owned
  selection. Ties select deterministically (equal values keep the
  earlier-rolled die for `kh`, likewise for `kl`), so replay is exact.
- `natural` — sum of kept dice, before any modifier. For a single-die d20
  roll this is the natural die (nat 1/20 detection).
- `modifier`, `total` — `total = natural + modifier`, always.

### Character creation

Rolled D&D ability generation calls the shared library directly with
`4d6dl1`; it is not a model-facing combat roll and does not pass through the
`roll` tool or player-visible roll ledger. Each of the six results durably
stores all four raw dice, kept and dropped values, their indices, the keep/drop
clause, and natural/modified totals. The player assigns the resulting totals to
abilities afterward, with duplicate values consumed by multiplicity. Revisiting,
previewing, assigning, saving, resuming, and finalizing reuse the immutable
evidence. Only an explicit reroll replaces it. Character creation has no
separate keep/drop algorithm or tie policy.

## F9 — resolution primitives

### Declared modifiers (shared by every d20 resolution and damage packets)

```ts
{ label: string, value: integer, source?: string }
```

The *choice* of modifiers is the DM model's ruling; the arithmetic and the
record of identity/provenance are code-owned. Bounds: ≤ 20 modifiers per
list, `|value| ≤ 100`, non-empty label. Modifiers are echoed verbatim into
the result, the ledger, and the turn trace, in declaration order.

### `resolve_check` — ability checks, saving throws, attacks

Inputs: `kind` (`ability_check` | `saving_throw` | `attack`), declared
modifiers, optional `proficiency { bonus, multiplier: none|half|normal|double }`,
`advantage` / `disadvantage` booleans, optional `vs` (DC or AC).

- **Advantage/disadvantage is typed, not spelled.** The engine rolls
  `2d20kh1` / `2d20kl1` / `1d20` itself. Declaring both flags cancels to a
  straight roll (SRD `advantage-and-disadvantage`: no stacking, both →
  neither). The result records the declared flags and the effective
  `advantageState` after cancellation.
- **The canonical selection survives into the resolution.** `D20Resolution`
  carries `kept`/`dropped` and their indices straight from the `DiceRoll`,
  so a tied advantage pair (`[17, 17]`) still identifies exactly which die
  was kept — required for exact audit replay; the ledger marks the dropped
  die by position.
- **Proficiency applies once, multiplied first.** `applied =
  floor(bonus × {0, ½, 1, 2})` (SRD `proficiency-bonus`: apply once; halving
  rounds down). A second proficiency entry is impossible by construction —
  it is a single typed field, not a list entry.
- `total = natural + Σmodifiers + proficiencyApplied`.
- **vs-DC/AC resolution honors nat 1/20 for attacks only** (SRD
  `rolling-1-or-20`): natural 20 → hit + `critical: true` regardless of AC;
  natural 1 → miss regardless. Checks and saves have no auto success/failure;
  they compare `total ≥ dc` (SRD meets-it-beats-it).
- With `vs` omitted the result carries the composed total only (DC setting
  can legitimately come after the roll — that stays a ruling).

### `resolve_contest` — opposed checks

Two sides, each with the full check-input shape (modifiers, proficiency,
adv/dis). Side A rolls first, then side B (fixed order — replay identical).
Higher total wins; **tie → `tie`, the situation stays as it was** (SRD
`contests`). No nat-1/20 semantics.

### `resolve_damage` — damage composition

Input: packets `[{ dice, type, label?, modifiers? }]`, `critical?`, optional
`targets [{ label, resistances?, vulnerabilities?, immunities? }]`.

- Keep/drop notation is rejected in damage packets (no SRD damage roll keeps
  or drops dice).
- **Crit doubles dice, in the engine.** `critical: true` doubles each
  packet's dice *count* before rolling (SRD `critical-hits`: roll all damage
  dice twice); modifiers are added once. The model never rewrites a dice
  expression.
- **Packets are declaration/audit structure, not rules structure.** One
  `resolve_damage` call is one damage instance. Each packet keeps its raw
  signed `contribution` (dice natural + notation modifier + declared
  modifiers) for the audit trail, but all rules math happens on the
  **per-type aggregates** (`byType`): contributions of the same damage type
  sum first, then never-negative clamps the aggregate (SRD `damage-rolls` —
  so a penalty on the weapon packet offsets same-type sneak/smite dice in
  the same instance, and a negative aggregate of one type never eats another
  type's damage), and resistance rounding applies once per type. How the
  caller partitions the instance into packets can therefore never change
  any total (metamorphic tests pin this).
- **Roll once, apply to every target** (SRD `damage-rolls`). Per target and
  per type aggregate: immunity → 0; else resistance → `floor(v/2)`; then
  vulnerability → `×2` (SRD `damage-resistance-and-vulnerability`: after all
  other modifiers, resistance before vulnerability, each at most once —
  "at most once" is structural: per-type aggregation plus deduplicated
  target sets).
- Which resistances apply stays a ruling; the model declares them per
  target, the engine owns the arithmetic.

### `calc` — named non-roll formulas (fail-closed registry)

Only registered formulas run; unknown names error with the known list. Each
formula validates its own typed integer/boolean inputs and returns named
outputs plus a human-readable `explanation` of the arithmetic. Initial
registry (each verified against the committed SRD pack text):

| formula | rule key | arithmetic |
|---|---|---|
| `passive_score` | `passive-checks` | 10 + modifiers, +5 advantage / −5 disadvantage (both → neither) |
| `carry_capacity` | `lifting-and-carrying`, `mounts-and-vehicles` | Str×15; push/drag/lift ×2; size doubling per category above Medium, Tiny halves; vehicle pull ×5 base capacity |
| `encumbrance_thresholds` | `variant-encumbrance` | encumbered > 5×Str; heavily > 10×Str; max = 15×Str |
| `jump_distance` | `jumping` | long = Str score ft (standing half); high = 3 + Str mod ft, floor 0 (standing half, round down) |
| `fall_damage_dice` | `falling` | `min(⌊feet/10⌋, 20)`d6 bludgeoning — returns the dice expression to roll |
| `grapple_escape_dc` | `grapple-rules-for-monsters` | 10 + monster's Str (Athletics) modifier |
| `days_without_food_limit` | `food` | max(1, 3 + Con modifier) |
| `forced_march_dc` | `speed` | 10 + hours past 8 |
| `group_check_outcome` | `group-checks` | success iff successes ≥ half the group (2×successes ≥ size) |

Formulas whose inputs need structured record plumbing that does not exist yet
(upcast scaling from spell `scaling` data → F4 interplay) are **not**
registered half-typed; they land with their data source (child beads).

## Invariants (tested)

1. `total = natural + modifier` (dice) and `total = natural + Σmodifiers +
   proficiencyApplied` (d20 resolution) — always, including under crit,
   cancellation, and keep/drop.
2. `rolls` always contains every die generated, in RNG draw order; `kept ∪
   dropped = rolls` exactly (multiset), and indices reconstruct the
   selection.
3. Same seed + same arguments ⇒ byte-identical tool results; the turn trace
   (`rulesResolution`) carries original dice, the kept/dropped selection
   **with indices** (unambiguous even when advantage dice tie), natural,
   declared modifiers, and outcome, so a trace replay never needs model
   output.
4. Advantage/disadvantage never stack and always cancel pairwise; the
   effective state is engine-computed and recorded.
5. Nat-1/20 overrides apply to attacks only, and only at the vs-AC
   comparison; the natural die is never mutated.
6. Proficiency contributes at most once per resolution; `half` rounds down;
   `none` contributes 0 even when doubled (SRD: 0 × n = 0).
7. Damage: modifiers before resistance; resistance (floor half) before
   vulnerability (double); immunity wins; never-negative and all
   resistance/vulnerability math on per-type aggregates (so packet
   partitioning is mechanically irrelevant — proven metamorphically);
   identical rolled dice across all targets of one resolution.
8. Read-only: none of these tools writes canon; applying damage/HP remains
   an explicit `adjust_hp`/`update_combatant` call that cites the resolution
   from the same turn.
9. Fail-closed: malformed grammar, identity/total keep-drop, unknown
   formulas, unknown damage types, out-of-range values, and duplicate-type
   resistance declarations are structured errors, not best-effort guesses.

## What deliberately stays with the DM model

Input selection (which modifiers, which resistances, cover degree, DC
choice), attack counting, movement magnitudes, and all narrative geometry —
per the execution-boundary classification's boundary rule 1. The engine owns
every number that follows from those choices.
