# Importer Agent Instructions

This directory contains the deterministic rules-pack **compiler** (historically
and still called the "importer" on these paths). It is no longer just
`PDF -> JSON`: it is a source-grounded compiler with an executable-curation
stage that must make the pack a *semantic substrate* for the model/engine
execution boundary — not only a reference corpus. Importer/compiler changes are
regression-sensitive.

Read and follow, before touching compiler/curator code:

- `docs/rules-pack-compiler.md` — the architecture and operating guide (what the
  system is, the technique decision hierarchy, curated-input rules,
  current-thaw and future-system guidance). This is the reasoning; do not
  duplicate it here.
- [ADR 0017](../../../../docs/adr/0017-rules-pack-compiler-and-executable-curation-architecture.md)
  (refines [ADR 0007](../../../../docs/adr/0007-rules-pack-ingestion-policy.md))
  — the decision.
- `docs/importer-fix-protocol.md` — the required workflow for regression-sensitive
  changes.

Mandatory local rules (see the guide for the reasoning behind each):

1. **Generated pack files are outputs; never hand-edit them.** Change compiler
   inputs (parser, curated spec, source manifest) and regenerate; committed
   output must match regenerated output exactly.
2. **Source-grounded curated semantic specifications are valid compiler inputs;
   model memory is not.** A curated spec is authoritative only when it is
   source-derived, source-tied (locator/clause id), deterministic,
   schema-validated, reference-resolving, and fails loudly on source drift.
3. **Prefer repeated grammar → shared parser; irregular semantics → declarative
   curated spec; a true exception → narrow procedural code.** Do not force
   irregular mechanics through heroic generic parsing to avoid explicit curation.
4. **Preserve provenance and source grounding** on every record.
5. **Make source drift fail loudly** (coverage/census/fingerprint checks), never
   silently preserve stale semantics.
6. **Use parity / conservation checks for exhaustive reviewed memberships**
   (every source element present, no stale/unknown keys, pinned census asserted).
7. **Keep the three layers separate:** immutable pack semantics (compiler-owned),
   mutable live state (campaign DB), and engine execution ownership (shared
   services / F-family hooks). Records subscribe to engine services; they never
   reimplement them.
8. **During the thaw, prefer completing the agreed complete/accurate/playable bar
   over speculative abstraction or unbounded enrichment.** A compiler bead may
   record/emit an engine hook, but must not build unrelated engine subsystems.
9. **For new systems, reuse the compiler contracts and audit principles — not
   D&D document heuristics.** No cross-system generalization on a sample size of
   one.
10. **Continue following the importer fix protocol** for regression-sensitive
    changes: treat tests/audit expectations as contracts, identify affected
    record IDs and add coverage before changing parsers, explain every generated
    diff, and track intentionally-deferred scope in a follow-up bead.
