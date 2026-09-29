# Rule-record runtime statements (finding `opus:F-09`)

Owning bead: `eshyra-o9bd.19.3.4`. Finding-registry row:
`rules-prose-readiness` (`opus:F-09`), invariant "Rules prose has an in-band
readiness disposition". Related row owned by the same bead:
`rule-corpus-procedures` (`sol:CAP-001`), "The rule corpus has executable
procedures".

Status: **proposed**. This document asks for design authorization under
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
Facts about Eshyra stay in runtime code under `src/`, next to the capability
ledger. Nothing about Eshyra's capability or limits goes in pack data. The
pack describes the rules, and ADR 0020 §3 makes capability statements
"statements about Eshyra". The transition design (§4) assigns deterministic
capability to runtime owners.

**R2 — No readiness label in the pack.** Rule records get no
`executionReadiness`, `readiness`, `status`, or classification field. D5 and
D7 of the transition design forbid turning projection or classification
presence into readiness. Magic-item `executionReadiness` stays as it is (§5.5)
and is not generalized.

**R3 — Source side: declared relationships, not labels.** The 10 `rule:`-key
owner pointers become pack relationships through the existing
`record-relationships-v1` manifest: `duplicate-of` for the 4 duplicates with a
rule-key owner (`rule:armor-class` and the three `rule:senses-*` rows), and
`deterministic-owner` for the other 6. They are emitted by
the importer from a curated spec moved out of the audit script, so the audit
script imports the spec rather than defining it. The 14 `record-data:` pointers
are **excluded**: each names a field across a whole kind, not a record, and
`resolveRecordRelationships` resolves only to one record (`record-key` or
`record-name`). The classification labels stay audit-only, retained per §5.3
as an exact classification of `rule:*` records and nothing more.

**R4 — Eshyra side: extend the ledger, don't add a second registry.**
`DeterministicCapabilityLedger.lookup` gains two outcomes beside `bound`,
`not-positively-selected`, and `no-statement`:

```ts
| { outcome: 'model-adjudicated'; recordKey; tools: readonly ToolName[]; dmContext: string }
| { outcome: 'known-limit'; recordKey; limit: 'partial' | 'unimplemented' | 'deferred';
    statement: string; findingId: string;
    externalClauses?: readonly { clause: string; findingId: string }[] }
```

- The rows move from `ENGINE_PROCEDURE_COVERAGE` into
  `src/rules/deterministicCapabilityLedger.ts` (or a sibling module that it
  imports). The audit script re-imports them, so there is one definition, as
  `eshyra-o9bd.19.1.4` did for bindings.
- `model-adjudicated` is the runtime name for `model-adjudicated-supported`.
  The word "supported" is dropped because it reads as green. `tools` are
  validated against `DEFAULT_TOOLS`, as the audit already does.
- `design-blocked` becomes `limit: 'deferred'`. Each of the 10 rows needs a
  `statement` written from ADR 0018 §6, because today they carry only a
  closed-bead `designOwner`. Bead pointers stay as history, not identity.
- `dmContext` and `statement` are **model-facing text**. They replace the
  current `contextRequirement`/`missing` notes, which use internal shorthand
  ("F2 turn budget", "hooks F4/F5"). Each rewrite is reviewed against the
  source record. No row is exposed with its legacy note verbatim.

**R5 — Consumers.** The discovery packet shows the new outcomes where it
already shows `deterministicCapabilityDisposition` (`packet.ts`
`dispositionField`), labelled as Eshyra-authored and non-source. `lookup_rules`
is an open decision (§6, Q1).

## 4. Invariants

1. **Disjoint and total over what it states.** Each key has at most one ledger
   outcome. `bound` and `not-positively-selected` cover exactly the
   `implemented` rows (as today), `model-adjudicated` covers only
   `model-adjudicated-supported` rows, and `known-limit` covers only
   `partial`/`unimplemented`/`design-blocked` rows. Any other key gets
   `no-statement`.
2. **Absence is not a claim.** `no-statement` must never be rendered as
   "no mechanics", "unsupported", or "safe". Its packet text must say it is a
   statement about Eshyra only (ADR 0020 §3).
3. **No green by recognition.** `model-adjudicated` is never presented as a
   capability. `capabilities[]` in the packet still comes only from `bound`
   contracts.
4. **One definition.** The audit bundle imports the runtime rows. A test
   asserts object identity (`toBe`), not deep equality, so the check can fail.
5. **Identity-pinned membership.** Membership tests pin keys, not counts, so
   an equal-sized reclassification fails (§5.3 required next state).
6. **Durable identity.** Every `known-limit` carries a finding-registry
   `findingId` that `findingByCanonicalId` resolves.
7. **Relationships resolve.** The new declarations are covered by the
   committed-pack gate added in PR #582: every declared reference resolves.

## 5. Evidence plan: vertical first

Prove the design on six real rows through the real consumer before moving the
other ~130. The vertical slice uses `runDiscoveryStages`, which builds the
packet, on the existing diagnostic probes where they apply.

| Row | Outcome exercised | Consumer evidence |
|---|---|---|
| `rule:cover` | `model-adjudicated` | probe P1 packet carries `tools` + `dmContext` |
| `rule:opportunity-attacks` | `model-adjudicated` | probe P2 packet |
| `rule:long-rest` | `known-limit` / `unimplemented` | packet for a long-rest seed |
| `rule:armor-guidance` | `known-limit` / `partial` + `externalClauses` | packet + `findingId` resolution |
| `rule:channel-divinity` | `known-limit` / `deferred` (new ADR 0018 statement) | packet |
| `rule:armor-class` → `rule:armor-guidance` | `duplicate-of` relationship | typed expansion reaches the canonical record |

The slice also includes a negative test: an unclassified key and a
`reference-prose` key both yield `no-statement`, and the packet text makes no
support claim.

Generalization, in the same bead but a later PR, rewrites the remaining
`dmContext`/`statement` texts and moves the rest of the rows. The row census
comes from the generated registries, not from hand-copied counts.

## 6. Open decisions

- **Q1 — `lookup_rules` exposure.** The packet runs offline/shadow today
  (W8/W9). Live play reaches rules through `lookup_rules`, so without it the
  DM sees none of this during real turns. **Recommendation:** include the
  ledger statement as a separate field on `rule:`/`action:` results in the
  vertical slice. This changes a model-facing tool contract, so it needs
  explicit approval.
- **Q2 — `sol:CAP-001` disposition.** "The rule corpus has executable
  procedures" asks for global deterministic closure, which ADR 0020 withdrew.
  **Recommendation:** set the row to `narrowed`, with reasoning that the
  surviving claim is the set of `known-limit` rows, each with its own
  `findingId`, owned by the `eshyra-olc5` capability lane where a capability
  is selected. Change `opus:F-09` only once the vertical slice lands.

## 7. Exclusions

- No pack readiness, status, or classification field (R2).
- No `record-data:` relationship edges (R3).
- No new capability selection or binding. That belongs to the `eshyra-olc5`
  capability lane.
- No change to magic-item `executionReadiness` or `itemExecutionReadiness.ts`.
- No per-clause decomposition of rule prose.
- No condition→condition edges. That is a separate item on this bead.

## 8. Next state

- **If authorized:** implement the §5 vertical slice as one PR. The bead
  stays `in_progress`.
- **If the vertical slice fails** (for example, the packet cannot present
  `dmContext` without it reading as authority): stop, record the failure on
  the bead, and revise this design before moving any more rows.
- **On success:** a generalization PR, then the Q2 registry updates.
