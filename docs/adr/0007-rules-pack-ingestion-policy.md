# ADR 0007: Rules-Pack Ingestion Policy and Model-Assistance Boundary

Status: accepted

Date: 2026-05-25

Refined by: [ADR 0017](0017-rules-pack-compiler-and-executable-curation-architecture.md).
The source-authority and model-assistance boundary below (§2–§4) remains in
force. ADR 0017 refines the §1 goal statement: the pack must be a semantic
substrate for the model/engine execution boundary, not only a reference
corpus with mechanical automation deferred to a separate track. Read ADR 0017
and `docs/rules-pack-compiler.md` before compiler/curator work.

## Context

The deterministic rules-pack ingestion pipeline (beads epic `loreweaver-0m9`)
replaces small hand-coded fixtures (`dnd5eSrd.ts`, `pathfinder2eRemaster.ts`)
with importer-generated rules records. That replacement raises a load-bearing
question that earlier ADRs do not answer: **where does the authoritative bit of
every rules record come from?**

The question is newly urgent because models — including the coding agents that
help develop importers — have training-data knowledge of the rules systems being
ingested. Without an explicit policy it is easy for a record to be authored from
model memory rather than extracted from the licensed source, making the pack
neither reproducible nor auditable and undermining the license posture required
by ADR 0001.

The earlier `loreweaver-0m9` issues landed the structures this policy governs:

- **`loreweaver-0m9.1`** — `RulesPackSource` on `RulesPackMeta` (source title,
  version, URL or vendored identity, SHA-256 hash, provenance policy) and
  `RecordProvenance` on `RulesRecord` (per-record `sourceRef` + optional
  locator), both in `packages/core/src/rules/types.ts`.
- **`loreweaver-0m9.2`** — Per-kind baseline validators and per-(system, kind)
  structured-field validators in `packages/core/src/rules/kindSchemas.ts`;
  pack-level validation enforcing source manifest coherence and provenance
  cross-reference in `packages/core/src/rules/validate.ts`.
- **`loreweaver-0m9.3`** — On-disk generated data layout
  (`packages/core/data/rules-packs/<packId-safe>/manifest.json` +
  `records.json`) and the loader `packages/core/src/rules/packLoader.ts` that
  sorts records, merges files, and runs `validateRulesPack` on every load.

ADR 0001 establishes that bundled/public content must be open-licensed,
public-domain, original, or publisher-licensed, and that fair use is not the
permission model. ADR 0005 and ADR 0006 apply this to the D&D SRD 5.1/5.2 and
Pathfinder 2e Remaster corpora respectively, including the decision to vendor
source corpora in-repo (project decision recorded in beads `loreweaver-0m9`
session notes 2026-05-25). This ADR records the cross-cutting pipeline policy
that those system-specific ADRs presuppose.

## Decision

Authoritative rules-pack content is produced by **deterministic code running
over licensed source material vendored in-repo**. A model's training-data
knowledge of rules systems is not an authoritative source and must not be used
to author or fill in pack records.

### 1. Reference completeness vs. mechanical automation completeness

The goal of pack ingestion is **reference completeness**: every rules element
that exists in the licensed source corpus is reachable by key for DM lookup,
has accurate field values, and carries full provenance back to the source
artifact.

This is distinct from **mechanical automation completeness**: a runnable rules
engine that can resolve every spell interaction, condition stack, action economy
edge case, and so on without consulting a human or the DM model. Mechanical
automation is a separate, layered concern that can grow at its own pace on top
of complete reference data. Importer scope targets reference completeness first.
Mechanical correctness of derived computations (e.g. a computed `modifier` from
a stat block) is desirable but secondary to having the source-accurate field
values present.

> **Refined by [ADR 0017](0017-rules-pack-compiler-and-executable-curation-architecture.md).**
> Playtesting during the D&D SRD thaw (`eshyra-o9bd`) showed the
> reference-first / automation-later split is too clean: the agreed
> model/engine execution boundary requires the pack to carry a source-grounded
> **semantic substrate** (typed effects, formulas, usage/recharge contracts,
> operation definitions, explicit engine-hook requirements) — not only accurate
> prose reachable by key. Reference completeness and semantic readiness are
> distinct correctness dimensions tracked separately, not sequential
> milestones. This paragraph's "reference completeness first" ordering is
> superseded to that extent; the source-authority rule (§2–§4) it rests on is
> not.

### 2. Allowed model-assistance uses

Models (including coding agents) may assist with the ingestion pipeline in the
following roles:

- **Writing parser code.** Developing scripts that extract structured records
  from a vendored source artifact (PDF, HTML, markdown, or structured data
  file). The model authors code; the code runs deterministically over the
  source.
- **Proposing normalization mappings.** Suggesting how a source field maps to
  the Eshyra schema — for example, "the SRD 5.1 'speed' object maps to our
  `speed` field as a string-keyed number map." A human reviews and merges the
  mapping; the importer encodes it in code.
- **Auditing importer output.** Running structural or semantic checks over
  importer-generated records and flagging anomalies (missing expected fields,
  suspicious values, apparent out-of-range numbers) for human review. The model
  flags; a human decides.
- **Generating diff explanations.** Describing what changed between two source
  versions (e.g. SRD 5.1 vs. 5.2 spell text deltas) to inform importer updates.
- **Suggesting test cases.** Identifying categories of records or edge-case
  record shapes that coverage tests should assert.

In all of these roles the model is a development tool, not a data source.

### 3. Disallowed model-assistance uses

The following uses are disallowed regardless of model capability or convenience:

- **Authoring authoritative record content from training-data knowledge.** A
  model may not produce the canonical field values for a record by recalling
  what it knows about the rules system (e.g. "Fire Bolt is a cantrip, range
  120 ft, 1d10 fire damage..."). Even if the output is factually correct, it is
  not reproducible from the vendored source and cannot be audited.
- **Filling gaps the source artifact does not contain.** Where the source does
  not specify a field, the importer must leave that field absent or null. A
  model may not supply a plausible value from general knowledge.
- **Renormalizing existing pack records from model knowledge.** If a record's
  field values need correction, the fix must trace back to the source artifact,
  not to a model re-reading the record and substituting what it believes the
  correct value is.
- **Substituting for the importer round-trip when the source is unavailable.**
  If the vendored source artifact is missing or inaccessible, the correct
  response is to obtain and vendor the source, not to reconstruct records from
  model memory.

### 4. Future custom / local / helper models

**Audit helper models** running over importer output are permitted: a local
model enforcing unit consistency, a denylist checker, a structural QA pass. The
model's output in these cases is a flag list for human review, not authoritative
record content.

**Local or custom model substitution for the primary DM** is out of scope per
ADR 0001. That ADR explicitly rejects "custom/local model as primary DM" on the
grounds that the primary quality requirement is frontier-level general
reasoning. Pack content quality cannot compensate for DM-model quality
reduction; the two concerns are separate.

## Consequences

- Every record in a bundled pack is **fully reproducible** from the vendored
  source artifact by running the importer. No out-of-band knowledge is required.
- The importer code is reviewable in isolation from the generated data. A PR
  that changes record content must show the corresponding importer change that
  produced it.
- Pack policy is **enforceable in CI**: the audit tooling introduced in
  `loreweaver-0m9.10` can detect records lacking provenance, records whose
  `provenance.sourceRef` does not match `meta.source.sourceUrl` /
  `meta.source.sourceIdentity`, and records that fail per-kind schema checks.
  These invariants are already enforced by `validateRulesPack` (in
  `packages/core/src/rules/validate.ts`) on every load.
- A contributor cannot legitimately submit a PR that adds records without
  showing the deterministic importer step that produced them.
- **New rules systems require their own importer and ADR** before records may
  be bundled. The ADR establishes the source corpus, license posture, and
  excluded categories; the importer implements the extraction. Shipping records
  without both steps violates this policy.

## Rejected Alternatives

- **Model as the source of truth for rules.** Rejected: model output is not
  reproducible (results vary across model versions, sampling parameters, and
  prompt wording), not independently auditable, and does not satisfy the
  open-license / provenance requirement of ADR 0001. A pack produced this way
  cannot be verified against a published source.
- **Fetch source at build time instead of vendoring.** Rejected: a
  build-time network dependency makes the build non-reproducible if the remote
  URL moves, changes, or becomes unavailable. Vendoring allows the source to be
  hashed and pinned; the hash is stored in `RulesPackSource.sourceHash`. This
  matches the in-repo vendoring decision recorded in beads `loreweaver-0m9`
  session notes 2026-05-25, referenced consistently in ADR 0005 and ADR 0006.
- **Hand-author records for kinds that change rarely, skipping a
  deterministic importer.** Rejected: hand-authored records have the same
  reproducibility and auditability problem as model-authored ones at smaller
  scale. There is no stable category of "rarely changed" records that can safely
  skip the importer round-trip — the set changes as source versions evolve, and
  the audit tooling has no way to distinguish legitimately hand-authored records
  from accidentally diverged ones.
- **Treat community data packs (Foundry modules, wiki exports) as
  authoritative sources.** Rejected: community packs are secondary derivatives
  whose normalization decisions and license chains are not independently
  verifiable as matching the primary published source. They may be useful as
  structural cross-checks (see ADR 0006 on Archives of Nethys), but the
  authoritative source is always the licensed primary artifact.
