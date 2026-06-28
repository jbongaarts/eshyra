# Thaw Note — Reopen the D&D SRD 5.1 artifact under the complete-accurate-playable bar

**Date:** 2026-06-28
**Bead:** eshyra-o9bd.1 (enabling step of epic **eshyra-o9bd**)
**Type:** Umbrella / governing thaw note for a multi-bead re-audit. Does **not**
itself change any importer, extractor, parser, generated pack record, source
ledger, or hash-pinned audit evidence file.

## Reason for thaw

The 2026-06 re-audit (epic **eshyra-o9bd**) re-examined the frozen importer and
exported rules-pack under a **new standard**: *complete, accurate, and
playable* — not merely *source-accounted*.

The prior final freeze
(`docs/audits/dnd5e-srd-5.1-final/`, 1811 records, 0 unaccounted source
structures, 0 known gaps, 0 unrepresented prose) was valid for its original bar:
reproducibility, source coverage, record counts, PDF-region ownership, and known
extraction regressions. Its methodology asked "is the source represented
somewhere?" — it did **not** prove the output can drive character creation,
level-up, spell choice, equipment grants, subclass choices, and advancement
without consumer-side hardcoding or prose guessing.

The proof that the pack is not yet self-sufficient is that several deterministic
overlays now live **outside** the generated pack precisely because the frozen
pack lacked machine-readable facts:

- `packages/core/src/character/srdAncestryAbilityScoreIncreases.ts`
- `packages/core/src/character/srdClassSpellcasting.ts`
- `packages/core/src/character/srdClassStartingEquipment.ts`
- `packages/core/src/character/srdLanguages.ts`

and that PR #336 found unresolved class-progression rows (subclass feature
slots, improvement labels, aliases, a malformed Ranger `spellsKnown: null`
placeholder) that a level-up engine cannot safely apply.

Verdict: reopen the importer for a **full thaw and re-freeze pass**. This note
is the governing authorization for that work and records the scope and the
re-freeze plan. It moves the audited artifact's recorded status from `frozen` to
`thawed-reaudit` (see `freeze-manifest.json`).

## What this note does and does not do

**Does:**

- Authorize the protected-path edit to `freeze-manifest.json` in this same PR
  (status field + re-audit pointers). That file is not hash-pinned in its own
  `files` list, so the hash check is unaffected.
- Record the epic scope, the per-child thaw convention, and the re-freeze gate
  so every child bead and its reviewer share one reference.

**Does not:**

- Change any importer/extractor/parser code, any generated record, any source
  ledger, the SRD PDF, or any hash-pinned audit evidence file
  (`README.md`, `provenance.md`, `evidence.json`, `record-counts.md`,
  `audit-methodology.md`, `known-source-typos.md`). Those remain byte-for-byte
  identical and their pinned hashes still pass.
- Weaken or substitute any existing regression test or audit expectation. The
  legacy gates stay green throughout the thaw; the new playable-model gates are
  **added** (eshyra-o9bd.11), not swapped in.

## Per-child thaw convention (important)

The freeze guard checks the *per-PR* diff (`git diff base...HEAD`): an active
thaw note must appear **in the same diff** as any protected-path change. Because
this umbrella note will already be on `main`, it will **not** appear in a later
child branch's diff and therefore does **not** authorize those changes.

Each child bead that modifies a frozen path (the importer, the generated pack,
the audit oracle, or the audit bundle) **must add its own dated thaw note** in
its PR, following `docs/importer-fix-protocol.md`, and — when it regenerates
output — update `freeze-manifest.json` hashes and the audit evidence
consistently. This note explains *why* the artifact is open; it does not replace
the per-change notes.

## Planned thaw scope (epic eshyra-o9bd)

Frozen paths expected to change across the epic's children:

- `packages/core/scripts/importers/dnd5e-srd-5.1/` — typed class progression,
  feature segmentation (Rogue Thieves' Cant, spellcasting), proficiency notes,
  table projections/links, structured ASIs/languages/equipment, typed choices.
- `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/` — regenerated records
  and source ledgers (importer output only; never hand-edited).
- `packages/core/src/rules/srdAudit.ts` — new playable-model audit gates
  (eshyra-o9bd.11), layered on the still-green legacy gates.
- `docs/audits/dnd5e-srd-5.1-final/` — refreshed evidence, manifests, and new
  modeling-usability reports (eshyra-o9bd.13); final re-freeze (eshyra-o9bd.14).

Child beads: eshyra-o9bd.2–.10 (modeling), .11 (gates), .12 (runtime smoke
tests), .13 (audit reports), .14 (regenerate + re-run audit + re-freeze), .15
(retire/convert overlays to oracle tests), .16 (max-effort re-audit).

## Re-freeze plan / gate (all must be green before eshyra-o9bd.14 re-freezes)

1. Legacy gates still green: reproducible importer, source coverage `0`, region
   ledger `0`, suspicious records `0`, hidden/control bytes `0`.
2. No consumer overlay required for core character creation (ASIs, languages,
   spellcasting ability/prep, starting equipment are generated pack data).
3. All class levels typed: no raw no-ref feature markers except typed subclass
   slots; no `null` numeric spellcasting placeholders.
4. All level-up rows classifiable/applicable (feature grants, subclass slots,
   feature improvements, resource increases, ASIs/feats, spellcasting changes).
5. No missing feature headings (Rogue Thieves' Cant-style cases fail).
6. No mixed mechanical note tokens (Druid metal restriction separated from
   proficiency arrays).
7. Feature/rule/spell/magic-item table links complete; no important standalone
   table unreachable from its owner.
8. No duplicate table linearization in primary prose unless deliberately modeled
   under a `sourceText` field.
9. Choice-coverage gate: every level-1/level-up player choice is structured or
   explicitly out-of-scope with a named unsupported marker.
10. Runtime smoke tests: create level-1 characters for every legal SRD
    class/ancestry/background path and level representatives through 20 using
    subclass selections where required — on generated pack data alone.

## Expected file changes (this PR)

- [x] `docs/audits/dnd5e-srd-5.1-final/thaw-notes/2026-06-28-reaudit-playable-bar-thaw.md` — this umbrella note
- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` — `status` → `thawed-reaudit` + re-audit pointers (not hash-pinned)
- [ ] `packages/core/sources/dnd5e-srd-5.1/` — unchanged
- [ ] `packages/core/scripts/importers/dnd5e-srd-5.1/` — unchanged (child beads)
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/` — unchanged (child beads)
- [ ] `docs/audits/dnd5e-srd-5.1-final/` (hash-pinned evidence) — unchanged (eshyra-o9bd.14)

## Source PDF changed?

No.

## Pack records changed?

No. No generated record, manifest, or source ledger is touched by this bead.

## Importer changed?

No. The importer/extractor/parser and the audit oracle are unchanged by this
enabling step; they are modified by the blocked child beads.

## Commands run

```
npm run verify:dnd5e-srd-freeze -- --base origin/main
npm run check
npm run typecheck
npm test
```

<!-- Exit codes pasted in the PR summary. -->

## Freeze manifest updated?

`status` field changed `frozen` → `thawed-reaudit` and informational re-audit
pointers added. No hash entry changed (no hash-pinned file changed), so the hash
check is unaffected.

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated (status + pointers only)

## Audit bundle path

Not regenerated. The audit bundle is refreshed and re-frozen by eshyra-o9bd.14
after the modeling beads land.

## Reviewer sign-off notes

Confirm this PR changes only (a) this umbrella thaw note and (b) the
`freeze-manifest.json` `status`/pointer fields — no hash-pinned file, no
generated record, no importer code, and no test or audit expectation is altered.
`verify:dnd5e-srd-freeze` should pass: hash check 13/13, thaw-policy satisfied by
this note. The freeze guard remains fully active; per-child thaw notes are still
required for every subsequent protected-path change.
