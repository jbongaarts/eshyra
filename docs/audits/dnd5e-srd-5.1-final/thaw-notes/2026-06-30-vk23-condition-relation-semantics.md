# Thaw Note — vk23 Relation-Aware Condition Mechanics

**Date:** 2026-06-30
**Beads:** eshyra-qqyj
**Epic:** eshyra-ajpc
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md`

## Reason for thaw

The vk23 gameplay audit found that `mechanics.conditions` collected raw
condition-name mentions without distinguishing what the source text actually
says about the condition. That is useful as a search hint but unsafe as
deterministic game-state logic: a tool that treats any mention as "apply this
condition" would misfire on advantage clauses, immunity clauses, targeting
exclusions, and incidental prose. Concrete examples from the audit:

- `spell:shield` surfaced `invisible` because the prose says "An invisible
  barrier...", not because Shield applies the Invisible condition.
- `spell:sleep` surfaced `charmed` (from an immunity clause: "creatures immune
  to being charmed aren't affected") and `unconscious` (the actual effect:
  "falls unconscious until the spell ends") with no way to tell them apart.
- `spell:color-spray` surfaced `unconscious` from a targeting-order exclusion
  ("ignoring unconscious creatures") alongside `blinded`, the actual effect.
- `creature:death-dog`'s Two-Headed trait surfaced all six conditions it has
  *advantage* against, indistinguishable from conditions it imposes.
- `action:dodge` surfaced `incapacitated` from "you lose this benefit if you
  are incapacitated" — a prerequisite, not something Dodge applies.

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` —
      `mechanicsProjections.ts`: `parseConditions` now classifies each
      condition mention's relation to the source text instead of emitting a
      bare `{ condition }`.
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` —
      regenerated through the importer; every existing `mechanics.conditions`
      entry gains a `relation` field. No entries were added or removed and no
      record's condition *set* changed (verified by diffing the parsed JSON,
      not just the text diff).
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json`
- [x] `docs/audits/dnd5e-srd-5.1-final/` — this thaw note and refreshed
      `freeze-manifest.json` hash for `records.json`.
- [x] Other: `packages/core/src/rules/kindSchemas.ts` now validates
      `mechanics.conditions[].relation` against a fixed enum;
      `packages/core/test/importers/dnd5e-srd-5.1/mechanicsProjections.test.ts`
      has the eshyra-qqyj regression coverage.

## Source PDF changed?

No. The source PDF remains SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.

## Pack records changed?

Yes, but only additively within the existing `mechanics.conditions` shape.
Record counts are unchanged (same per-kind counts as before). Verified by
parsing both the pre- and post-change `records.json` and comparing every
`{condition, ...}` entry: 514 condition-mechanics entries before and after
(2 of those are an unrelated `equipment` choice's `condition: "if proficient"`
field, not a D&D condition), the per-record condition *name* sets are
identical, and every entry now has a `relation`.

Relation distribution across the regenerated pack:

- `applies`: 328
- `mention`: 102
- `advantage`: 54
- `immune`: 14
- `removes`: 8
- `exclusion`: 5
- `disadvantage`: 1

All five named audit examples were spot-checked against the new output:
Shield's `invisible` → `mention`; Sleep's `charmed` → `immune`, `unconscious`
→ `applies`; Color Spray's `unconscious` → `exclusion`, `blinded` →
`applies`; Death Dog Two-Headed's six conditions → `advantage`; Dodge's
`incapacitated` → `exclusion`. Several other records changed from the old
unconditional mention to a correct non-`applies` relation as a direct
consequence of the same classifier (e.g. `creature:ghost`'s Possession
immunity-to-being-charmed-and-frightened clause, several "is no longer
restrained" swallow-creature traits now `removes`) — these are the expected,
source-confirmed fallout of the same minimal fix, not a new root cause.

## Importer changed?

Yes. `parseConditions` now splits the input text into sentences and, for each
matched condition name, classifies every sentence that mentions it against an
ordered set of regexes (`removes`, `immune`, `advantage`, `disadvantage`,
`exclusion`, `applies`, else `mention`). When a condition is mentioned in more
than one sentence with different relations (e.g. Sleep's `unconscious`:
mentioned once as an exclusion, once as the actual effect), the strongest
state-mutating relation found (`applies` first, then `removes`, then the
non-mutating relations) wins — a separate aggregation priority from the
per-sentence match order, which is tuned to avoid false positives within a
single sentence (e.g. so "...or knocked unconscious" inside an advantage list
isn't misread as an `applies` phrase).

The `applies`/`removes` patterns (the two state-mutating relations) all
require the condition word to sit directly adjacent to a trigger phrase
("becomes X", "is/are X", "no longer X", etc.) — no wildcard matching — so the
bug this thaw fixes (raw mentions treated as authoritative) cannot resurface
through these two relations. `immune`/`advantage`/`disadvantage` use a
same-sentence wildcard to handle SRD list phrasing ("immune to being charmed
and frightened"; "advantage ... against being blinded, charmed, ... or
knocked unconscious"); this can occasionally bucket a condition into the
wrong *non-mutating* relation when a sentence chains an unrelated clause after
"immune"/"unaffected by" (e.g. `spell:freedom-of-movement`'s `unaffected by
difficult terrain, and ... cause the target to be paralyzed or restrained`
classifies `paralyzed`/`restrained` as `immune` via the wildcard, not because
that exact phrase says "immune", though the spell does grant practical
immunity to those effects). That tradeoff was accepted deliberately: it never
produces a false `applies`, which is the safety property this bead exists to
guarantee.

No source extractor behavior changed.

## Commands run

```
npx vitest run packages/core/test/importers/dnd5e-srd-5.1/mechanicsProjections.test.ts
npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
npm run verify:dnd5e-srd-pack
npx vitest run packages/core/test/importers/dnd5e-srd-5.1/ packages/core/test/rulesPack.test.ts packages/core/test/srdGeneratedPack.test.ts packages/core/test/dnd5eSrdAuditBundle.test.ts
npm run audit-bundle:dnd5e-srd
npm run verify:dnd5e-srd-freeze -- --base origin/main
npm run check
npm run typecheck
npm run test
npm run verify:worktree
```

All passed.

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated with the
  new `records.json` SHA-256.

## Audit bundle path

Regenerated locally at `.audit-bundles/dnd5e-srd-audit-bundle` (gitignored).
`npm run audit-bundle:dnd5e-srd` reports 0 playability/choice-prose/overlay
findings; it does not currently audit `mechanics.conditions` relation
correctness (no audit gate added by this thaw — out of scope, see follow-up).

## Reviewer sign-off notes

Confirm `verify:dnd5e-srd-pack` shows the committed pack matches importer
output exactly, `verify:dnd5e-srd-freeze -- --base origin/main` passes, and
that the condition-set-parity claim above (514 entries before/after, no
per-record set changes) is the only structural change — i.e. this is purely
an additive `relation` field, not a re-detection of which conditions are
mentioned.
