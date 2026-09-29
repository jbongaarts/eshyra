# Rule-record runtime statements (finding `opus:F-09`)

Owning bead: `eshyra-o9bd.19.3.4`. Finding-registry row:
`rules-prose-readiness` (`opus:F-09`), invariant "Rules prose has an in-band
readiness disposition". Related row owned by the same bead:
`rule-corpus-procedures` (`sol:CAP-001`), "The rule corpus has executable
procedures".

Status: **proposed, revision 2** (addresses the PR #589 review at
`97da90f2`). This document asks for design authorization under
`docs/design-and-pr-review-policy.md` ("Design authorization"). No
implementation lands with it.

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
> a positively selected capability, the adjudication context the DM needs,
> or a known limit. Absence of a statement stays "no statement". It never
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

- `rule:long-rest`: the audit records `unimplemented` — "F7: 8 h gate, 1/24 h,
  ≥1 HP requirement, full HP + half-HD restore, resource reset orchestration".
  The DM never sees that Eshyra does not orchestrate a long rest.
- `rule:cover` (probe P1): the DM never sees that the cover bonus has to
  arrive as a declared `resolve_check` modifier.
- `rule:armor-class` is a duplicate of `rule:armor-guidance`, but discovery
  has no edge between the two.

## 3. Decisions

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

- **`duplicate-of` (4 candidates):** `rule:armor-class` → `rule:armor-guidance`,
  and `rule:senses-{blindsight,darkvision,truesight}` → `rule:{blindsight,
  darkvision,truesight}`. Each edge is emitted only after its two passages are
  compared against the source PDF text and shown to state the same rule. The
  verification is recorded with the curated spec, not inferred from the audit
  `canonicalOwner`.
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

**R4 — Eshyra side: three independent channels, not one disposition.**
`ENGINE_PROCEDURE_COVERAGE` is split, as transition design §5.4 requires, into
three separately owned runtime datasets. None of them is derived from another.

| Channel | Owner module | Content | Source rows today |
|---|---|---|---|
| capabilities | `src/rules/deterministicCapabilityLedger.ts` (**unchanged contract**) | positively selected bindings, plus the existing `not-positively-selected` rows | `implemented` rows |
| adjudication context | new `src/rules/ruleAdjudicationContext.ts` | tools the DM uses (validated against `DEFAULT_TOOLS`) + reviewed model-facing `dmContext` | `model-adjudicated-supported` rows; also any row where residual DM interpretation needs context, even one that has a capability |
| known limits | new `src/rules/ruleKnownLimits.ts` | `limit: partial \| unimplemented \| deferred`, model-facing `statement`, durable `findingId`, optional `externalClauses[{clause, findingId}]` | `partial`, `unimplemented`, `design-blocked` rows and `externalClauses` |

- The capability ledger keeps its narrow, capability-only contract. It gains
  no adjudication or limit outcomes.
- A rule may appear in any combination of channels. Four `partial` rows
  already have Eshyra runtime owners today, so a capability, residual
  adjudication, and a known limit can coexist on one rule. The model must be
  able to represent that.
- `design-blocked` becomes `limit: 'deferred'`, with a `statement` written from
  ADR 0018 §6. Today these rows carry only a closed-bead `designOwner`, which
  stays as history, not identity.
- `dmContext` and `statement` are **model-facing text** that replaces the
  current internal shorthand ("F2 turn budget", "hooks F4/F5"). Each rewrite is
  reviewed against the source record, and no legacy note is exposed verbatim.
- The audit bundle imports all three datasets, so there is one definition of
  each (the `eshyra-o9bd.19.1.4` pattern).

**R5 — One read-only facade.** A new `ruleAwareness(recordKey, stack)` in
`src/rules/` assembles, for consumers:

```ts
interface RuleAwareness {
  relationships: readonly ResolvedRelationship[]; // from the pack manifest, record-relationships-v1
  capabilities: CapabilityLedgerLookup;           // from the ledger, unchanged
  adjudicationContext?: RuleAdjudicationContext;  // independent channel
  knownLimits: readonly RuleKnownLimit[];         // independent channel
}
```

The facade only reads and combines. It owns no data and never derives one
channel from another. If every channel is empty, it says so, and that is a
statement about Eshyra only, never "no mechanics", "unsupported", or "safe"
(ADR 0020 §3).

**R6 — Live exposure through `lookup_rules`.** A successful `lookup_rules`
result for any record gains a separate `ruleAwareness` envelope beside, and
outside, the authoritative source `record`. Today the result carries `record`,
`card`, `sourcePack`, `license`, and `overrideChain`, and does not resolve the
relationship manifest. The envelope carries the facade output, so resolved
relationships and all three channels reach the live DM. The source `record`
remains exactly the pack record: provenance stays separate from
Eshyra-authored annotation. The tool description tells the model the envelope
is Eshyra-authored and is not rules text. The discovery packet consumes the
same facade, replacing its direct ledger call in `dispositionField`.

## 4. Invariants

1. **Channels are independent.** No channel's presence, absence, or content is
   computed from another's. Adding an entry to one channel cannot remove or
   change what another returns for the same key. Permanent evidence: a
   facade test where one key has a capability, adjudication context, and a
   known limit together, and each channel is populated independently.
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
8. **Relationships resolve.** `duplicate-of` declarations fall under the
   committed-pack resolution gate added in PR #582.

## 5. Evidence plan: vertical first

Prove the design on real rows through **both** real consumers
(`lookup_rules` and the discovery packet) before moving the remaining rows.

| Row | Exercised | Evidence |
|---|---|---|
| `rule:armor-class` → `rule:armor-guidance` | source-verified `duplicate-of`, visible live | `lookup_rules` envelope carries the resolved relationship (**permanent**: durable tool contract) |
| `rule:long-rest` | known limit, `unimplemented` | `lookup_rules` envelope carries the limit statement and `findingId` (**permanent**) |
| `rule:armor-guidance` | capability-adjacent row with a `partial` limit + `externalClauses` | channels coexist; `findingId`s resolve |
| `rule:cover` | adjudication context only | probe P1 packet carries `tools` + `dmContext` |
| `rule:opportunity-attacks` | adjudication context | probe P2 packet |
| `rule:channel-divinity` | known limit, `deferred` (new ADR 0018 statement) | facade/packet |
| a `reference-prose` key | empty envelope | text makes no support or absence claim |

The two `lookup_rules` cases are permanent because they protect a durable
model-facing tool contract. The channel-independence test (invariant 1) is
permanent. No corpus-wide completeness test is added.

Generalization, in the same bead but a later PR, rewrites the remaining
`dmContext`/`statement` texts and moves the rest of the rows. The row census
comes from the generated registries, not hand-copied counts.

## 6. Decisions recorded from review

- **Q1 — `lookup_rules` exposure: yes, broadened.** Adopted as R6: a separate
  envelope carrying resolved relationships and all three independent channels,
  not only a ledger statement.
- **Q2 — `sol:CAP-001`: narrowed.** The row becomes `narrowed`, with this
  reasoning: *deterministic execution exists only through positively selected
  bounded capabilities, while known limitations remain explicit rule-awareness
  and adjudication facts. `eshyra-olc5` owns work only when a deterministic
  capability is selected, and a known limit does not itself create an engine
  obligation.* This is not replaced by any exhaustive "set of known-limit rows"
  claim. `opus:F-09` changes only once the vertical slice lands.

## 7. Exclusions

- No pack readiness, status, or classification field (R2).
- No pack edge from an audit pointer alone; no `record-data:` edges (R3).
- No widening of the capability ledger contract (R4).
- No new capability selection or binding. That belongs to the `eshyra-olc5`
  capability lane.
- No change to magic-item `executionReadiness` or `itemExecutionReadiness.ts`.
- No per-clause decomposition of rule prose.
- No condition→condition edges. That is a separate item on this bead.

## 8. Next state

- **If authorized:** implement the §5 vertical slice as one PR, including the
  Q2 registry update for `sol:CAP-001`. The bead stays `in_progress`.
- **If the vertical slice fails** (for example, the envelope reads as rules
  authority in live turns, or a `duplicate-of` pair does not survive source
  comparison): stop, record the failure on the bead, and revise this design
  before moving any more rows.
- **On success:** a generalization PR, then the `opus:F-09` registry update.
