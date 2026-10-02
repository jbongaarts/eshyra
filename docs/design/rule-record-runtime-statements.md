# Rule-record runtime statements (finding `opus:F-09`)

Owning bead: `eshyra-o9bd.19.3.4`. Finding-registry row:
`rules-prose-readiness` (`opus:F-09`), invariant "Rules prose has an in-band
readiness disposition". Related row owned by the same bead:
`rule-corpus-procedures` (`sol:CAP-001`), "The rule corpus has executable
procedures".

Status: **accepted (revision 4) + amendment A1 from the vertical slice +
amendment A2** (the `excluded` resolution outcome, from
`docs/design/condition-condition-relationships.md` C7) **+ amendment A3**
(positive-only statement channels, from the generalization, §3 after R4)
**+ amendment A4** (the adjudication-context channel is retired; §3 after A3)
**+ amendment A5** (a known limit discloses a blocking engine-capability gap
but never discharges it; §3 after A4)
(addresses the PR #589 reviews at `97da90f2`, `d05ed6ad`, and `34089ef9`).

## 1. Authority

In order:
[ADR 0020](../adr/0020-rules-pack-as-rule-awareness-infrastructure-with-bounded-deterministic-capabilities.md);
the integrated transition design
(`docs/audits/rules-awareness-transition/2026-07-30-integrated-transition-design.md`,
§§3, 4, 5.3, 5.4, 7); `AGENTS.md`; the owning bead.

The original F-09 framing (bead text dated 2026-07-25) called for "uniform
in-band readiness" across every record kind, with zero engine-pending clauses
at re-freeze. ADR 0020 and the §5.9 truthfulness bar **withdrew** that framing
(bd memory `adr-0020-transition-ownership-and-refreeze-bar`). This design does
not revive it. It reads F-09 under current authority as follows:

> A runtime consumer of a `rule:*` or `action:*` record can obtain, without
> reading an audit-only artifact, (a) the source relationships Eshyra has
> curated for that record and (b) Eshyra's own bounded statement about it:
> a positively selected capability or a known limit (A4 retired the
> adjudication context originally listed here; tool-contract knowledge lives
> in the tools' descriptions). Absence of a statement stays "no statement". It never
> means supported, safe, irrelevant, or mechanically empty.

## 2. Current state (verified on `main` @ `f1cdca92`)

The 325 `rule:*` records carry only `text` (plus `tableRefs` on 32 and
`skillsByAbility` on 1). The 10 `action:*` records carry `description` and
curated `mechanics`. Three
kinds of fact about them exist only in the audit-bundle script
`packages/core/scripts/create-dnd5e-srd-audit-bundle/ruleDispositions.ts`.

| Fact | Owner of truth | Where it lives | Runtime visible? |
|---|---|---|---|
| Classification: `RULE_DISPOSITIONS` — 175 engine-procedure, 96 reference-prose, 33 definition, 19 table-backed, 12 duplicate | the source (what the text *is*) | audit script | no |
| Canonical/deterministic owner pointers: 24 rows, 10 to a `rule:` key, 14 to `record-data:<kind>.<field>` | the source | audit script | no |
| Positive capability bindings: 8 rows bound to 3 contracts | Eshyra | `src/rules/deterministicCapabilityLedger.ts` (`eshyra-o9bd.19.1.4`) | **yes**, via ledger lookup and discovery packet |
| "Implemented but not positively selected": 31 rows | Eshyra | same ledger | **yes** (`not-positively-selected`) |
| Adjudication context: 108 `model-adjudicated-supported` rows (`primitives` + free-text `contextRequirement`) | Eshyra | audit script | no |
| Known limits: 16 `partial`, 2 `unimplemented`, 10 `design-blocked`, and 7 rows with `externalClauses`, each with a durable `findingId` | Eshyra | audit script | no |

Consequence: for 136 of 175 engine-procedure rows, and for all 160 other rows,
`DETERMINISTIC_CAPABILITY_LEDGER.lookup` returns `no-statement`. Examples:

- `rule:long-rest`: the audit still records `unimplemented`, but the claim is
  **stale**. `complete_long_rest` (`packages/core/src/orchestrator/toolRest.ts`)
  now enforces the qualification, ≥1 HP, and 24-hour gates and performs the
  HP, Hit Dice, and resource resets. The F7 bead (`eshyra-2n1t.9`) is closed.
  Promoting this row as-is would tell the DM something false. See R0.
- `rule:cover` (probe P1): the DM never sees that the cover bonus has to
  arrive as a declared `resolve_check` modifier.
- `rule:armor-class` is not a duplicate of `rule:armor-guidance`; the source
  passages state different rules (Amendment A1 below).

## 3. Decisions

**R0 — Legacy rows are candidate evidence, not runtime truth.**
`ENGINE_PROCEDURE_COVERAGE` and `RULE_DISPOSITIONS` are historical audit
artifacts, and at least some of their rows are stale (`rule:long-rest`,
`rule:short-rest`). No row moves into a runtime dataset mechanically. As each
row migrates, it is **re-derived** against the current source text and the
current runtime (tools, state modules, closed beads), and gets exactly one of
three outcomes:

- **confirmed** — the claim still holds, and it is rewritten as model-facing
  text;
- **rewritten** — the claim holds only in part, and only the surviving part is
  migrated;
- **retired** — the claim no longer holds, and nothing is migrated for it.

Each outcome records its evidence (code path, test, or bead) in the migrating
PR. Stale legacy rows are not corrected in place in the audit script; they are
superseded when the runtime dataset takes over.


**R1 — Split by owner of truth.** Facts about the source go in the pack.
Facts about Eshyra stay in runtime code under `src/`. Nothing about Eshyra's
capability, adjudication practice, or limits goes in pack data. The pack
describes the rules, and ADR 0020 §3 makes capability statements "statements
about Eshyra". An audit pointer is not source authority. A pack edge is
emitted only when the licensed source itself supports it (ADR 0007).

**R2 — No readiness label in the pack.** Rule records get no
`executionReadiness`, `readiness`, `status`, or classification field. D5 and
D7 of the transition design forbid turning projection or classification
presence into readiness. Magic-item `executionReadiness` stays as it is (§5.5)
and is not generalized.

**R3 — Source side: only source-verified relationships.**

- **`duplicate-of` (4 candidates considered):** `rule:armor-class` →
  `rule:armor-guidance`, and `rule:senses-{blindsight,darkvision,truesight}` →
  `rule:{blindsight,darkvision,truesight}`. Each candidate requires comparing
  both passages against the source PDF; none is emitted unless the comparison
  shows the same rule. The verification is recorded with the curated spec, not
  inferred from the audit `canonicalOwner`. Amendment A1 rejects all four.
- **Representation.** `record-relationships-v1` declares the meaning of leaves
  that record data already contains; it does not store edge instances. So:
  - The importer emits `data.duplicateOf: '<rule key>'` on each verified
    duplicate rule record, from a curated spec
    (`scripts/importers/dnd5e-srd-5.1/`) that records each pair's source
    comparison.
  - Field provenance declares `(rule, /duplicateOf)` as `compiler-projection`:
    it is a curated judgement about two passages, not verbatim or parsed
    source text.
  - Relationship manifest: `{ kind: 'rule', pointerPrefix: '/duplicateOf',
    disposition: 'reference', relation: 'duplicate-of', targetResolution:
    'record-key' }`.
  - `kindSchemas` validates `duplicateOf` as a `rule:` key that is not the
    record's own key. The committed-pack resolution gate (PR #582) proves it
    resolves.
  - The duplicate record's `text` is kept. Nothing is removed from the pack.
- **The six rule-key `deterministicOwner` pointers are not emitted as pack
  edges.** They are Eshyra execution interpretations. For example,
  `rule:cantrips` → `rule:spell-slots` is noted as "owned by the spell-slot
  economy engine procedure". A pointer may become a pack edge only if it is
  independently re-derived as a relationship the source actually states, under
  a source-appropriate relation name (for example, where one passage defers to
  another). That re-derivation is optional and per row. The audit pointer alone
  is never sufficient.
- **The 14 `record-data:` pointers are excluded.** Each names a field across a
  whole kind, not a record, and `resolveRecordRelationships` resolves only to
  one record.
- **Classification labels stay audit-only,** retained per §5.3 as an exact
  classification of `rule:*` records and nothing more.
- **Amendment A1 (vertical slice):** Source comparison rejected all four
  candidate pairs as duplicates. `rule:armor-class` (p. 80) says, “Depending
  on the armor you wear, you might add some or all of your Dexterity modifier
  to your Armor Class”; `rule:armor-guidance` (pp. 62–63) says armor determines
  base AC, with Dexterity rules in the Light/Medium Armor paragraphs.
  `rule:senses-darkvision` (p. 257) says it “can see in dim light within the
  radius as if it were bright light”; `rule:darkvision` (p. 86) lacks that
  clause. `rule:senses-truesight` adds “within the same range” to its Ethereal
  Plane clause, which `rule:truesight` lacks. `rule:senses-blindsight` adds
  the naturally-blind parenthetical stat-block convention. The pack text
  matches the PDF for all eight records. No `duplicate-of` edge is emitted.
  Whether a non-duplicate source relation, such as parallel definitions of a
  sense in another chapter, is warranted is deferred to a follow-up bead.

**R4 — Eshyra side: independent channels, not one disposition.** *(A4
retires the adjudication-context row below; the live channels are the
capability ledger and known limits. The table is kept as history.)*
`ENGINE_PROCEDURE_COVERAGE` is split, as transition design §5.4 requires, into
three separately owned runtime datasets. None of them is derived from another.

| Channel | Owner module | Content | Candidate legacy rows (re-derived under R0) |
|---|---|---|---|
| capabilities | `src/rules/deterministicCapabilityLedger.ts` (**unchanged contract**) | positively selected bindings, plus the existing `not-positively-selected` rows | `implemented` rows |
| adjudication context | new `src/rules/ruleAdjudicationContext.ts` | tools the DM uses (validated against `DEFAULT_TOOLS`) + reviewed model-facing `dmContext` | `model-adjudicated-supported` rows; also any row where residual DM interpretation needs context, even one that has a capability |
| known limits | new `src/rules/ruleKnownLimits.ts` | `limit: partial \| unimplemented \| deferred`, model-facing `statement`, durable `findingId`, optional `externalClauses[{clause, findingId}]` | `partial`, `unimplemented`, `design-blocked` rows and `externalClauses` |

- The capability ledger keeps its narrow, capability-only contract. It gains
  no adjudication or limit outcomes.
- A rule may appear in any combination of channels. ADR 0020 §4 requires that
  a bounded capability, residual adjudication, and a known limit can coexist.
  **No current rule is known to have all three.** The four `partial` rows that
  name runtime owners (`casting-a-spell-saving-throws`, `charges`,
  `experience-points`, `suffocating`) are **not** positively selected
  capabilities: ledger bindings require an `implemented` row, and none of
  these is bound. Coexistence evidence is therefore explicitly **synthetic
  representability evidence**. No binding is added to manufacture a test case.
- `design-blocked` becomes `limit: 'deferred'`, with a `statement` written from
  ADR 0018 §6. Today these rows carry only a closed-bead `designOwner`, which
  stays as history, not identity.
- `dmContext` and `statement` are **model-facing text** that replaces the
  current internal shorthand ("F2 turn budget", "hooks F4/F5"). Each rewrite is
  reviewed against the source record, and no legacy note is exposed verbatim.
- The audit bundle imports all three datasets, so there is one definition of
  each (the `eshyra-o9bd.19.1.4` pattern).

**Amendment A3 (generalization) — statement channels are positive and
bounded.** Two failed generalization attempts showed what an unconstrained
`dmContext` becomes: per-rule prose about what Eshyra does *not* track and
what "the DM decides". That is an open negative space. It can never be
complete, no finding owns it, and nothing detects it going stale when a
capability lands (the same failure R0 exists for: `rule:long-rest`). It also
restates the default: under ADR 0020 §3 every rule without a positively
selected capability is model-adjudicated, so saying so per row adds nothing.
ADR 0020 builds Eshyra's side from positive, bounded commitments; the two
statement channels follow the same rule.

- **Adjudication context is a positive tool mapping.** An entry exists only
  when at least one registered tool other than `lookup_rules` carries state or
  resolution that the rule governs. Its `dmContext` says how the rule maps onto
  those tools: which tool, for what, and the rule-specific input it takes (for
  example, the degree of cover as a declared `resolve_check` modifier). Every
  listed tool other than `lookup_rules` is named in the `dmContext`, and every
  tool named there is listed. It contains no statement of what Eshyra does not
  do, no generic "the DM decides" prose, and no restatement of the rule text
  (invariant 4). The validator enforces the tool rules, and rejects an entry
  with no tool other than `lookup_rules` and any `dmContext` asserting what
  "Eshyra does not" do.
- **A rule with nothing positive to state gets no entry.** When `lookup_rules`
  is the only relevant tool, the channel is empty, and invariant 3 already
  makes that empty channel a non-claim. R0's "retired" outcome covers the
  legacy `model-adjudicated-supported` label for such a row: nothing migrates.
- **Negatives live only in known limits, under a trap criterion.** A known
  limit states a specific clause of the rule that an existing Eshyra tool or
  tracked state participates in, where using that tool or state as it stands
  would contradict the clause or silently omit it (`rule:suffocating`:
  `stabilize_character` and HP recovery are not gated on breathing). Each
  carries a registered `findingId`, so the set is owned and bounded. A clause
  that no Eshyra tool or state touches is not a known limit: nothing misleads
  the DM, and the rule is adjudicated from its text by default. `deferred`
  limits are the ADR 0018 scope boundary (a character with more than one class
  is refused), a positive selected decision, and stay as they are.
- **Approved slice entries conform.** `rule:cover`,
  `rule:opportunity-attacks`, and `rule:charges` are rewritten to the tool
  mapping alone, keeping their approved tool sets except where the mapping
  corrects them (`rule:opportunity-attacks` resolves its attack through
  `resolve_check`, not `roll`). `rule:suffocating` keeps only its trap, split
  by target domain: for a character, `adjust_hp` applies the 0-HP transition
  and neither it nor `stabilize_character` is gated on breathing; for an
  encounter combatant, the source's 0-HP-and-dying transition is not
  representable (`update_combatant` defaults a combatant at 0 HP to `dead`,
  and combatant state has no dying status), and the limit says so without
  offering a substitute. Its breath-duration and countdown sentence is
  removed: no Eshyra tool or state touches that clause.
  `rule:channel-divinity` already meets the criteria and is unchanged.
- **Positive mappings are target-domain correct.** A mapping names the tool
  that can actually write the state for the rule's subject.
  `add_condition` / `remove_condition` address characters only;
  encounter combatants take conditions through `update_combatant`. A rule
  about any creature names both paths and says which applies to which target.
  A mapping also preserves the rule's own procedure and the tool's state
  contract. For example, a retained roll is compared as a fixed total
  (`resolve_check` with `vs`), never re-rolled through a tool that rolls
  both sides. *(Superseded: A4 retired positive mappings, and that example is
  wrong, because no tool compares a retained total; see A5 and `rule:hiding`.)*
  Graded exhaustion is not mapped onto `add_condition`, which
  ignores an existing condition id and so cannot raise a level. That gap is a
  known limit on the rules that impose exhaustion (`rule:food`, `rule:water`,
  `rule:speed`), and under A5 a blocking engine-capability gap.
- **A known limit never assigns canonical state to the DM.** The DM may
  adjudicate that a rule's outcome applies, but durable game state stays with
  Eshyra's deterministic state boundary (ADR 0020 §2). When no exposed tool can
  persist an outcome, the limit discloses that it cannot currently be
  persisted. It never tells the DM to hold the state in narrative or memory
  instead, and it never offers a lossy substitute state.
- **Audit projection is per channel, not per row status.** R4's channels are
  independent (invariant 1), so the audit bundle cannot reduce a key to one
  exclusive status. Each engine-procedure key materializes as the set of
  channel facts it has:
  - `implementation`: authored implementation evidence (`runtimeOwner` +
    `evidence`). This is the only fact the audit script still authors, and it
    is what the capability ledger's `implemented` input reads.
  - `adjudicationContext`: the runtime entry, by identity. *(Retired by A4.)*
  - `knownLimits`: every runtime limit for the key, each by identity and each
    carrying its own `findingId`. A key may have any number, as the runtime
    contract is an array.

  Any combination is admissible, including implementation evidence together
  with context and limits. A key with none of the three is reported as
  `no-runtime-statement`: a count of keys about which Eshyra makes no
  statement, never "unsupported" or "safe" (invariant 3). The readiness
  report counts each channel separately, so a key counted in several channels
  is expected. The audit script authors no Eshyra fact that a runtime channel
  owns, so one definition per fact holds (invariant 5).

**Amendment A4 (generalization) — the adjudication-context channel is
retired.** It supersedes R4's adjudication-context row, A3's
adjudication-context bullets, and every mention of adjudication context in
R5, R6, the invariants, and §5. A3's known-limit rules stand: the trap
criterion, target-domain correctness, and never assigning canonical state to
the DM.

*Why.* The transition design's §5.4 item 1 asked what must be *retrievable* at
play time, as input to discovery expectations. R4 and R6 turned that into
per-rule, model-facing prose about how tools behave, and A3 made it a positive
tool mapping. Six review cycles on the generalization PR kept finding defects
in exactly that prose: wrong source procedure, character-only tools named for
any creature, misstated tool arguments and side effects, and omitted steps. Almost every one was
tool-contract knowledge restated per rule, which duplicates the tool
descriptions and goes stale separately from the code. A per-rule restatement
of tool behavior is the wrong owner for that knowledge.

*Disposition: **retired**, with the responsibility re-homed (AGENTS.md,
"Permanent Test Evidence").*
- **Tool-contract knowledge → the tool's own description.** How a tool must be
  called and what it does lives once, next to its implementation, and reaches
  the DM on every call of that tool, for every rule. A description states only
  what its tool does. It never offers model-side arithmetic or comparison as a
  substitute for a deterministic operation the tool lacks (ADR 0020 §2). Where
  a rule needs such an operation and no tool owns it, a known limit on that
  rule discloses the gap, and the gap is owned as a blocking engine-capability
  gap (A5); for example `rule:hiding`'s retained Stealth total. Examples: `vs`
  is a bare AC/DC; modifiers apply to the roller and are engine-summed, so a
  target AC bonus such as cover is an equal negative roller modifier, and so
  is a term the source adds to a DC (the Charisma modifier in `rule:conflict`'s
  DC of 12 + that modifier);
  `resolve_contest` rolls both sides; `add_condition` and `adjust_hp` address
  characters only; `update_combatant` sets a combatant at 0 HP to `dead`
  unless another status is given. Each description change is checked against
  the tool's code.
- **Rule-specific traps → known limits,** unchanged (A3 criteria).
- **Retrievability → typed relationships and discovery probes.** When a real
  gap appears, that is, context that must reach the DM for a rule but does
  not, it is filed and closed as a relationship or a probe expectation. This
  PR adds none.

*Effects.*
- The runtime statement channels are the capability ledger and known limits.
- The `ruleAwareness` facade, the `lookup_rules` envelope, and the discovery
  packet carry capabilities, known limits, and relationships only.
- The audit projection carries `implementation` and `knownLimits`. A key with
  neither is `no-runtime-statement`, which makes no claim (invariant 3).
  Rules the legacy registry labelled `model-adjudicated-supported` are no
  exception: under ADR 0020 §3 model adjudication is the default and needs no
  statement.

**Amendment A5 (generalization review) — a known limit discloses; it does
not discharge.** It refines A3's known-limit rules, A4's sentence on missing
operations, and §6 Q2.

*Why.* A4 let a missing deterministic operation, such as `rule:hiding`'s
comparison against a retained Stealth total, be recorded as a known limit.
That is truthful, but incomplete. ADR 0020 §3 still requires deterministic
ownership of dice outcomes, arithmetic, atomic state mutation, resource
accounting, and state integrity, and §2 requires every adjudicated outcome
that changes the game to pass through those boundaries. Disclosing that a
step is missing does not perform it. Read as a terminal disposition, a known
limit would retire an obligation ADR 0020 keeps, and would let the DM bypass
deterministic ownership because the gap had been written down.

*Rule.* If a governing clause requires an engine-owned mechanical step and no
valid deterministic operation can perform it, the clause has a **blocking
engine-capability gap**. A known limit may disclose the gap truthfully, but
it does not satisfy or retire the obligation. The missing capability has an
open blocking bead, and the owning rules work stays blocked until the
capability is implemented or accepted authority explicitly changes the
requirement.

A known limit is **terminal (bounded)** only where the clause stays
adjudicable through a valid architecture: the DM interprets applicability and
meaning; every deterministic calculation and state effect the clause requires
has a valid tool or state path; and the statement only prevents misuse,
overclaim, or silent omission. A `deferred` limit is accepted authority
narrowing the requirement (ADR 0018: a character with more than one class is
refused), so it is a scope boundary, not a gap.

This applies only where the clause itself requires a deterministic step under
ADR 0020. It is not global deterministic closure. A gap is recorded where
re-derivation finds one, and A5 claims no census of every such gap in the
corpus. A clause that no tool or state touches still gets no known limit
(A3), so the absence of a limit or of a registered gap makes no claim
(invariant 3).

*Four things are kept apart.*
- **Truthful bounded limitation.** The statement names the trap and, where one
  exists, the valid tool path. For example, for `action:ready` the held energy
  is tracked as a ruling-sourced concentration effect, so
  `resolve_concentration` owns the save and its DC.
- **Blocking missing capability.** The statement says what cannot currently be
  executed, and stops there.
- **Model interpretation that remains valid.** Applicability, meaning, which
  modifiers apply, whether a trigger occurred, which creatures are observing,
  and reading a declared input such as an ability modifier.
- **Forbidden substitution.** Model-side arithmetic or comparison of
  mechanical values, model-held canonical state, skipping or hand-tracking an
  engine-owned step, or a lossy substitute state. No statement or tool
  description offers one as a fallback for a missing operation.

*Representation.*
- `ENGINE_CAPABILITY_GAPS` (`src/rules/ruleKnownLimits.ts`) registers each
  gap: the missing operation, its owning bead, and the finding
  `engine-capability-ownership` ("Required engine capabilities have qualified
  ownership"). Gaps are grouped by missing capability, not by rule: graded
  exhaustion is one gap disclosed by three rules.
- A known limit lists the gaps it discloses (`capabilityGaps`). The validator
  rejects an unregistered gap, a registered gap that no limit discloses, a gap
  on a `deferred` limit, and an owner that is not a bead id.
- The audit projection reports blocking gaps as their own list, and as
  `blocking-capability-gap` unresolved work with the owner. They are never
  folded into the known-limit lists or counted as a disposition.
- The model-facing statement shape is unchanged. The statement text is the
  disclosure.

*Lifecycle.* Each owning bead sits under the `eshyra-olc5` engine family
whose operation it adds, entering it by explicit selection, and blocks
`eshyra-o9bd.19.3.4`. Through that bead the gaps also hold the candidate-pack
chain (`eshyra-o9bd.19.6.1`). When a capability lands, its PR re-derives the
affected known limit under R0 and removes the gap entry, and the dependency
resolves. Recording a gap never closes its bead.

*Classification at this amendment,* re-derived for every known limit against
the source clause, the statement, each participating tool, and the real state
producer and consumer:

| Key | Class | Gap → owning bead |
|---|---|---|
| `rule:hiding` | blocking | `retained-check-total-resolution` → `eshyra-o9bd.19.5.10.3` |
| `rule:food`, `rule:water`, `rule:speed` | blocking | `graded-exhaustion-increase` → `eshyra-o9bd.19.5.7.3` |
| `rule:suffocating` | blocking | `suffocation-recovery-gate` → `eshyra-o9bd.19.5.7.4`; `combatant-dying-state` → `eshyra-o9bd.19.5.7.5` |
| `rule:knocking-a-creature-out` | blocking | `nonlethal-knockout` → `eshyra-o9bd.19.5.7.6` |
| `rule:weapon-properties` | blocking | `ammunition-recovery-count` → `eshyra-o9bd.19.5.11.4` |
| `action:ready` | bounded | none: a ruling-sourced concentration effect carries the save |
| `rule:conflict` | bounded | none: `resolve_check` takes the DC's Charisma term as a negative modifier, and `end_effect` ends the charm |
| `rule:special-weapons` | bounded | none: attack counting is model-adjudicated by the F2 design (`state/actionEconomy.ts`), and each attack resolves through `resolve_check` |
| the nine `deferred` multiclass limits | bounded | none: ADR 0018 scope boundary |

`rule:suffocating` also gains a disclosure it lacked: `record_death_save`
stabilizes on a third success and restores 1 hit point on a natural 20 with no
breathing gate. Death saves are engine-owned, so the DM cannot avoid the
contradiction by declining a call.

*Existing contracts this amendment does not change.* Two existing runtime
contracts have the DM supply a value that A5 treats as engine-owned.
`update_combatant`'s `reactionAllowance` takes the hydra's current reaction
total from the DM (accepted design `eshyra-2n1t.4`; bead
`eshyra-o9bd.19.3.4.6`, which blocks `eshyra-o9bd.19.3.4`). `set_surprised`
has the DM adjudicate Stealth against passive Perception, the same operation
as the hiding gap. Downgrading either to a disclosed gap would remove the only
path to hydra extra reactions or to surprise, so neither changes without an
explicit decision.

**R5 — One read-only facade.** A new
`ruleAwareness(recordKey, stack, relationshipManifestSource)` in `src/rules/`
assembles, for consumers:

```ts
interface RuleAwareness {
  // Producer-qualified: the WINNING stack entry's pack, looked up through the
  // same RecordRelationshipManifestSource discovery uses. No inheritance
  // across add-ons, overrides, or foreign packs.
  relationshipArtifact: RelationshipArtifactState;   // { packId, state: 'present' | 'absent' }
  relationships: readonly RelationshipResolution[];  // full union: resolved | unresolved-target | indeterminate | excluded (A2)
  capabilities: CapabilityLedgerLookup;              // from the ledger, unchanged
  knownLimits: readonly RuleKnownLimit[];            // independent channel (A4: adjudication context retired)
}
```

The manifest association is an **explicit input**, never recovered from
`stack`. A `RulesPack` carries only `meta` and `records`,
`CampaignRulesPackResolver` returns only a `RulesPack`, and a pack's
relationship manifest is associated with it separately
(`RecordRelationshipManifestSource`, as discovery already takes it). The facade
has no default for this parameter; its callers supply one (R6).

The facade only reads and combines. It owns no data and never derives one
channel from another. Relationship semantics are exactly those of
`recordRelationships.ts`: the facade calls `resolveRecordRelationships` with
the producing pack's own manifest. When that pack has no manifest,
`relationshipArtifact.state` is `'absent'` and `relationships` is empty
*because* it is absent, never as a silent default. Unresolved and
indeterminate occurrences are passed through, not filtered out. If every channel is empty, it says so, and that is a
statement about Eshyra only, never "no mechanics", "unsupported", or "safe"
(ADR 0020 §3).

**R6 — Live exposure through `lookup_rules`.** A successful `lookup_rules`
result for any record gains a separate `ruleAwareness` envelope beside, and
outside, the authoritative source `record`. Today the result carries `record`,
`card`, `sourcePack`, `license`, and `overrideChain`, and does not resolve the
relationship manifest. The envelope carries the facade output, so resolved
relationships, capabilities, and known limits reach the live DM (A4 retired
adjudication context).

**How the live path receives the manifest association.** It is one live
input, threaded exactly like `resolveRulesPack`:

- `RunTurnDeps` gains
  `relationshipManifestSource?: RecordRelationshipManifestSource`, next to
  `resolveRulesPack`. Whoever installs a campaign-bound pack supplies both from
  the same install, as the `lateAmbiguityAddon` fixture already does
  (`{ resolver, manifestSource }`).
- `ToolContext` gains the same field, which `lookup_rules` passes to the facade.
- Shadow/intervention discovery capture in `orchestrator.ts` receives the
  same value. Today it passes `resolveRulesPack` but no manifest source, so
  it falls back to the bundled-SRD-only default: the same gap on the discovery
  side, closed by the same input.
- One resolution function supplies the default when the dependency is
  omitted: `bundledDnd5eSrdRecordRelationshipManifestSource()`, the fail-safe
  discovery already uses. It recognizes only the bundled SRD pack object, so an
  add-on reports `absent` rather than inheriting SRD semantics. Tool context
  and discovery capture both take their value from that one function, so they
  cannot silently diverge. The source `record`
remains exactly the pack record: provenance stays separate from
Eshyra-authored annotation. The tool description tells the model the envelope
is Eshyra-authored and is not rules text. The discovery packet consumes the
same facade, replacing its direct ledger call in `dispositionField`. It
uses the facade's statement half (`ruleStatements`: capabilities and known
limits, per A4), which needs no stack or manifest, so
no packet caller can lose a statement channel for lack of a manifest
source. The packet's relationships already come from discovery expansion
under the same manifest source (invariant 11).

## 4. Invariants

1. **Channels are independent.** No channel's presence, absence, or content is
   computed from another's. Adding an entry to one channel cannot remove or
   change what another returns for the same key. Permanent evidence: a
   **synthetic** facade test, with injected datasets, where one key carries a
   capability and known limits together (A4: the adjudication-context channel
   is retired). It proves representability only, not a real selected
   capability.
2. **Capability ledger unchanged.** `DeterministicCapabilityLedger`'s outcome
   union and contract are not widened. Packet `capabilities[]` still comes
   only from `bound` contracts.
3. **Absence is not a claim.** An empty envelope or channel is never rendered
   as "no mechanics", "unsupported", or "safe".
4. **Source and annotation stay separate.** `lookup_rules`'s `record` is
   byte-identical to the pack record, and all Eshyra-authored material sits
   only in the envelope.
5. **One definition per dataset.** The audit bundle imports each runtime
   dataset. A test asserts object identity (`toBe`) so the check can fail.
6. **Identity-pinned membership.** Membership pins keys, not counts (§5.3
   required next state).
7. **Durable identity.** Every known limit and external clause carries a
   `findingId` that `findingByCanonicalId` resolves.
8. **Relationships resolve.** Any emitted relationship declarations fall
   under the committed-pack resolution gate added in PR #582. Amendment A1
   emits no `duplicate-of` declarations for the four compared pairs.
9. **Relationship failure semantics preserved across the full producer
   set.** The envelope's relationships are producer-qualified, carry explicit
   manifest `present`/`absent` state, and keep every resolution outcome
   unfiltered: `resolved`, `unresolved-target`, `indeterminate`, and (A2)
   `excluded`.
   Permanent evidence runs **through `lookup_rules` with the live input
   wired as in R6**, reusing the existing F1 fixtures (cases (a)–(d) in
   `recordRelationships.test.ts`), for each producer:
   - **bundled SRD record** → `present`, SRD semantics;
   - **add-on with no manifest** → `absent`, no inherited SRD semantics;
   - **add-on with its own manifest** (`lateAmbiguityAddon`, or F1 case (c))
     → `present`, resolved under its own declarations;
   - **override** → the winning producer's manifest governs, and the
     `overrideChain` losers contribute none.
10. **No stale promotion.** Every migrated row carries its R0 outcome and
    evidence.
11. **Consumer parity.** For the same stack and the same
    `relationshipManifestSource`, the relationships in `lookup_rules`'s
    envelope for a record equal the `relationshipResolutions` discovery
    produces for that record, and discovery capture and tool context in one
    turn receive the same manifest source.
12. **Statements are bounded (A3, A4, A5).** Every known limit meets the trap
    criterion, carries a registered `findingId`, and identifies the tool and
    state boundary that participates in the affected clause: each non-deferred
    limit lists its registered participating tools, and its statement names
    each one. A participant may be read-only, so a resolution-only trap such
    as `rule:hiding` needs no state-writing tool. Where a statement directs a
    state write, the writer it names is target-domain correct for the rule's
    subject. A limit never assigns canonical state to the DM, never offers a
    substitute for a missing deterministic operation, and does not restate
    the rule's source text. Tool-contract facts live in tool descriptions,
    not in rule statements (A4).
13. **A disclosure is not a discharge (A5).** Every blocking
    engine-capability gap that a known limit discloses is registered with an
    owning bead and the `engine-capability-ownership` finding, and the audit
    projection reports it as unresolved work of its own kind. Permanent
    evidence: the validator's gap checks, the identity-pinned map of the
    limits that carry gaps, and the report projection test.

## 5. Evidence plan: vertical first

Prove the design on real rows through **both** real consumers
(`lookup_rules` and the discovery packet) before moving the remaining rows.

Every row below goes through R0 re-derivation first. The "expected" column is
a hypothesis to test, not a result.

| Row | Expected after R0 | Evidence |
|---|---|---|
| `action:hide` `ruleRef` | existing declared record-key relationship resolves under the bundled SRD manifest | `lookup_rules` envelope carries the resolved relationship with `relationshipArtifact.state: 'present'` (**permanent**: durable tool contract); exact pointer is `/mechanics/effects/*/ruleRef` in `records.json` and `record-relationships.json`. `action:help` currently has no `ruleRef` leaf in the committed pack. |
| `rule:long-rest` | legacy `unimplemented` limit **retired** (`toolRest.ts`, `eshyra-2n1t.9`) | `lookup_rules` envelope carries **no** unimplemented limit (**permanent**: guards against stale promotion) |
| `rule:suffocating` | `partial` limit **confirmed** as a trap: HP recovery and stabilization are not gated on breathing (A3 retires the breath-countdown clause and splits the statement by target domain) | `lookup_rules` envelope carries the limit statement + `findingId` (**permanent**) |
| `rule:charges` | `partial` limit likely **rewritten** (expenditure landed with F5; pack-side charge data still external); its adjudication context is **retired by A4** (the `reset_usage` / `needsRolledRestore` / `restore_usage` sequence is in those tools' descriptions) | superseded |
| `rule:cover` | adjudication context confirmed; **retired by A4** (the cover fact moved to `resolve_check`'s description: a target AC bonus is an equal negative roller modifier, engine-summed) | superseded |
| `rule:opportunity-attacks` | adjudication context confirmed or rewritten; **retired by A4** | superseded |
| `rule:channel-divinity` | `deferred`, statement from ADR 0018 §6 | facade/packet |
| a `reference-prose` key | empty channels | envelope text makes no support or absence claim |
| full producer set (bundled / no-manifest add-on / own-manifest add-on / override) | per invariant 9 | `lookup_rules` through `ToolContext` wired with the R6 live input (**permanent**) |

The `lookup_rules` cases marked permanent protect a durable model-facing tool
contract. The channel-independence test (invariant 1) is
permanent. No corpus-wide completeness test is added.

Generalization follows the sequence in §8.

## 6. Decisions recorded from review

- **Q1 — `lookup_rules` exposure: yes, broadened.** Adopted as R6: a separate
  envelope carrying resolved relationships and the independent statement
  channels (capabilities and known limits after A4), not only a ledger
  statement.
- **Q2 — `sol:CAP-001`: narrowed.** The row becomes `narrowed`, with this
  reasoning: *deterministic execution exists only through positively selected
  bounded capabilities, while known limitations remain explicit rule-awareness
  and adjudication facts. `eshyra-olc5` owns work only when a deterministic
  capability is selected, and a known limit does not itself create an engine
  obligation.* *(Refined by A5: a known limit neither creates nor discharges
  an engine obligation. Where a governing rule requires an engine-owned step
  that no valid operation performs, `eshyra-olc5` owns that capability as a
  blocking gap, whether or not a known limit discloses it.)* This is not replaced by any exhaustive "set of known-limit rows"
  claim. It lands in the vertical-slice PR. `opus:F-09` changes only after
  generalization (§8).

## 7. Exclusions

- No pack readiness, status, or classification field (R2).
- No pack edge from an audit pointer alone; no `record-data:` edges (R3).
  Amendment A1 emits no duplicate-of edges for the four source-compared pairs;
  whether a non-duplicate relation for parallel sense definitions is warranted
  is deferred.
- No widening of the capability ledger contract (R4).
- No new capability selection or binding. That belongs to the `eshyra-olc5`
  capability lane.
- No change to magic-item `executionReadiness` or `itemExecutionReadiness.ts`.
- No per-clause decomposition of rule prose.
- No condition→condition edges. That is a separate item on this bead.

## 8. Next state

One sequence, in order:

1. **Authorization** of this design.
2. **Vertical-slice PR:** the §5 rows (each with its R0 outcome), the
   three channels (as landed in PR #594; A4 later retired adjudication
   context), the facade, the R6 manifest-source input (`RunTurnDeps` → `ToolContext` and discovery
   capture), and the `lookup_rules` envelope, plus the `sol:CAP-001` → `narrowed` registry
   update. The bead stays `in_progress`.
3. **Generalization PR(s):** re-derive and migrate the remaining legacy rows
   under R0. The census comes from the generated registries, not hand-copied
   counts.
4. **`opus:F-09` registry update,** after generalization lands. It cannot
   record F-09 as resolved while a blocking engine-capability gap (A5) is
   open; each gap's bead blocks `eshyra-o9bd.19.3.4`.

**On failure** at any step (for example, the envelope reads as rules
authority in live turns, a `duplicate-of` pair does not survive source
comparison, or R0 shows the legacy registry is too stale to seed from):
stop, record the failure on the bead, and revise this design before
continuing.
