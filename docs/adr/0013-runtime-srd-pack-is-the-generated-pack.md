# ADR 0013: The Runtime SRD Rules Pack Is the Generated Pack, Not the In-Code Placeholder

Status: proposed

Date: 2026-06-21

## Context

Eshyra has two different representations of the D&D 5e SRD 5.1 rules, and
gameplay currently binds to the wrong one.

1. **In-code placeholder** — `DND5E_SRD_RULES_PACK`
   (`packages/core/src/rules/dnd5eSrd.ts`), built from the hand-written
   `SRD_CATALOG` literal in `packages/core/src/rules/srd/data.ts`. It contains
   **three records**: one creature (`monster:goblin`), one spell, and one class.
   It has **no** equipment or magic-item records. This predates the SRD
   importer and was a bootstrapping stand-in.

2. **Generated pack** — the SRD importer artifact under
   `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/` (manifest + 1811
   records: creatures, spells, classes, equipment, magic-items, conditions,
   features, tables, etc.). Per the importer memory and ADR 0005/0007 this is a
   frozen, audited, one-time artifact and is **the durable rules product**. It
   is shipped to consumers (it is listed in `packages/core/package.json`
   `files`).

The problem: the runtime resolves rules against the **placeholder**, not the
generated pack. `toolLookupRules.ts` (the DM's `lookup_rules` tool) and the
default campaign rules binding both bind to `DND5E_SRD_RULES_PACK`. So a live
campaign can look up exactly one creature, one spell, and one class, and **no
items at all**.

This is also inconsistent with the design already written down: **ADR 0012
states** that "the bundled D&D SRD 5.1 pack lives under
`packages/core/data/rules-packs/` … and is read by the DM through the
`lookup_rules` tool." That is aspirational today — the tool reads the in-code
stub. This ADR aligns the code with that stated design.

### Why this surfaced now

Authoring the first adventure module (`eshyra-eh54.7.2`, The Hollow Beneath
Emberfall) and the follow-up to make its `rulesRef`s resolve (`eshyra-8bit`)
exposed the gap. The module references `creature:goblin` and
`magic-item:potion-of-healing`. Against the placeholder, the creature cannot
resolve (key is `monster:goblin`, and the ref convention expects a bare slug)
and the magic-item **cannot resolve at all** because the placeholder has no
items. `eshyra-8bit` cannot meaningfully "resolve module rulesRefs against the
real SRD stack" while the real stack is a three-record stub, so it is blocked on
this decision.

### What blocks a naive swap

Pointing the binding at `loadRulesPackFromDirectory(<generated dir>)` does **not**
work as-is. Two concrete obstacles were found by probing:

1. **`resolveRulesStack` enforces unique record _names_ per kind.** The real SRD
   legitimately repeats names within a kind — e.g. the `feature` "Ability Score
   Improvement" exists on every class
   (`feature:barbarian:ability-score-improvement`,
   `feature:bard:ability-score-improvement`, …). `resolveRulesStack` throws a
   `duplicate record name … for feature records` error, so the generated pack
   cannot even be resolved into a stack today. The name index assumes a
   uniqueness the real SRD does not have.

2. **`rulesRef` ↔ record-key addressing.** Generated record keys are
   `<kind>:<slug>` (e.g. `creature:goblin`, `magic-item:potion-of-healing`),
   while the adventure `rulesRef` convention (`references.ts`) splits on the
   first `:` into `(kind, bareSlug)` and looks up by `bareSlug`. `creature:goblin`
   therefore looks up `goblin`, which does not match the key `creature:goblin`.
   Lookups resolve only by the **full** key (`ref`) or by **name** today.

There is also packaging/perf surface (loading 1811 records at startup vs.
lazily) and test fallout (~7 test files assert against the placeholder's tiny
contents).

## Decision

**Make the generated SRD pack the rules pack the runtime resolves against, and
retire the in-code `DND5E_SRD_RULES_PACK` placeholder (and the `SRD_CATALOG`
literal behind it).**

Specifically:

1. **Runtime source.** The bundled base D&D SRD pack used by `toolLookupRules`
   and the default binding is loaded from
   `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/` via
   `loadRulesPackFromDirectory`, not constructed from `SRD_CATALOG`. The pack is
   loaded once and cached (lazily on first use) so module-load cost is not paid
   by editions that never play.

2. **Name uniqueness.** Relax the rules stack's name model so legitimately
   duplicated names within a kind are allowed. Records remain addressed
   canonically by `(kind, key)`; **name lookup becomes best-effort** — a name
   that is ambiguous within a kind resolves to a deterministic, documented
   choice (or reports ambiguity) rather than failing pack resolution. Pack
   resolution must never throw on a name collision that the audited SRD source
   actually contains.

3. **Placeholder removal.** Delete `DND5E_SRD_RULES_PACK` /`SRD_CATALOG` once
   nothing depends on them. Public/internal exports that re-export the constant
   are repointed at the loaded pack (or removed if no external consumer needs
   the symbol). The ~7 tests asserting stub contents are rewritten against the
   generated pack's real, stable records.

4. **Addressing convention is out of scope here.** The `rulesRef` ↔ key
   mismatch (obstacle 2) is owned by `eshyra-8bit`. This ADR only guarantees the
   runtime stack *contains* the real records (including items); `eshyra-8bit`
   then decides how an adventure `rulesRef` addresses them (bare-slug
   normalization in lookup is the leading candidate, since generated keys are
   `<kind>:<slug>` and the slug is unambiguous within a kind).

## Consequences

### Positive

- Gameplay resolves against the full, audited SRD (creatures, spells, classes,
  equipment, magic-items, conditions, …) instead of three records — the single
  biggest correctness gap in current rules lookup.
- Code matches ADR 0012's stated design (the data-dir pack is the DM's rules
  truth).
- Unblocks `eshyra-8bit`: The Hollow's `creature:goblin` and
  `magic-item:potion-of-healing` exist in the runtime stack to resolve against.
- One source of rules truth: the audited importer artifact. No drift between a
  hand-curated stub and the generated pack.

### Negative / risks

- Touches the hot rules-lookup path (`stack.ts`, `lookup.ts`,
  `toolLookupRules.ts`, `binding.ts`) — broad blast radius; the full suite must
  stay green.
- Relaxing name uniqueness is a semantic change to a load-bearing index; it must
  preserve key-addressed determinism and only soften the *name* path.
- Startup must load/parse 1811 records; mitigated by lazy + cached loading.
- Test churn (~7 files) and any snapshot/golden updates.
- Editions/packaging must continue to resolve the data dir at runtime in every
  shipped edition (already in `files`, but the no-config execution smoke should
  assert SRD lookup works post-pack-swap).

### Follow-ups

- `eshyra-t2ra` implements this decision.
- `eshyra-8bit` (blocked on `t2ra`) settles the `rulesRef` ↔ key addressing
  convention and adds a test resolving The Hollow Beneath Emberfall's refs
  against the real resolved SRD stack.
- Pathfinder has the same two-representation shape
  (`PATHFINDER2E_REMASTER_RULES_PACK`); applying the same treatment is deferred
  with the Pathfinder importer work and is not required by this ADR.
