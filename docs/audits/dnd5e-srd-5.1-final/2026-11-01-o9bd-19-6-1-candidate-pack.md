# ADR-0020 SRD Candidate Pack — eshyra-o9bd.19.6.1

## Candidate identity

The candidate is the committed rules-pack directory at the merge commit of this PR:

- `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/`

This record describes that candidate as a bounded input to the next gates. It does not claim universal clause, mechanic, deterministic-execution, source-coverage, or discovery completeness. A missing binding is not evidence of completeness.

## Reproduction

The approved source input is the vendored SRD 5.1 PDF. Its SHA-256 is `2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`, as recorded in `packages/core/sources/dnd5e-srd-5.1/manifest.json`. From the repository root, regenerate to a scratch directory and compare the committed pack:

```sh
npm run import:dnd5e-srd -- --out /tmp/eshyra-srd-candidate
npm run verify:dnd5e-srd-pack
```

The importer prints its generated artifact census; this record does not duplicate generated totals. The verification command checks that committed output matches importer output.

## Prerequisite reflection

This table was compiled from `bd show eshyra-o9bd.19.6.1`, each prerequisite's `bd show` close reason, and `finding-registry.json`. Registry status is the audit-fact disposition; it does not assert whether the current pack violates or satisfies a row.

| Prerequisite bead | Closing PR(s) in bead record | Owned registry rows and status |
| --- | --- | --- |
| `eshyra-o9bd.19.4.1` | #651 | `spell-completeness` (narrowed); `point-origin-areas` (accepted); `magic-missile-projectiles` (accepted); `spell-mechanics-depth` (narrowed) |
| `eshyra-o9bd.19.4.6` | #656 | — |
| `eshyra-o9bd.19.3.1` | #649 | `damage-alternatives` (accepted); `choice-behavior` (accepted); `pit-variants` (accepted); `invocation-effects` (accepted); `bulette-alternative` (accepted); `targeting-qualifiers` (accepted); `option-losses` (narrowed) |
| `eshyra-o9bd.19.3.3` | #652 | `language-universe-policy` (accepted); `equipment-report` (accepted); `ancestry-omissions` (narrowed); `background-equipment` (accepted) |
| `eshyra-o9bd.19.4.3` | #648 | `creature-completeness` (narrowed); `half-damage-branches` (accepted); `legendary-economy` (accepted); `multi-save-entries` (accepted); `creature-ongoing-riders` (accepted) |
| `eshyra-o9bd.19.3.4` | #582, #589, #594–#596, #598–#600 | `rule-corpus-procedures` (narrowed); `condition-structure-no-regression` (narrowed); `rules-prose-readiness` (narrowed) |
| `eshyra-o9bd.19.1.11` | #475 branch (close record cites commit `efde702`) | — |
| `eshyra-o9bd.19.2.1` | #504, #566–#569; #570 | `source-authority-opus-f19` (accepted); `source-authority-opus-f20` (accepted); `source-authority-sol-cap-008` (accepted); `source-authority-fable-f1` (accepted); `source-authority-fable-f5` (accepted); `source-authority-fable-f7` (accepted); `animal-friendship-authority` (accepted) |
| `eshyra-o9bd.19.4.5` | #653 | `magic-item-effects` (narrowed) |
| `eshyra-o9bd.19.6.5` | Authority migration; no PR recorded | — |
| `eshyra-o9bd.19.3.2` | #644 | `phantom-feature-resources` (accepted); `class-feature-completeness` (narrowed); `indomitable-scaling` (accepted); `arcane-recovery-reset` (accepted); `natural-recovery-reset` (accepted); `ki-abilities` (narrowed); `divine-sense-uses` (accepted) |
| `eshyra-o9bd.19.2.2` | #571, #573, #574, #576, #578 | `locator-completeness` (accepted); `ambiguous-coverage` (accepted); `rock-gnome-boundary` (accepted); `spellcasting-granularity` (accepted); `vehicle-tool-row` (accepted); `wererat-crossbow` (accepted); `source-provenance-fields` (accepted); `container-continuation` (accepted) |
| `eshyra-o9bd.19.4.4` | #696 | `hazard-and-healing-potion` (narrowed); `hazard-completeness` (narrowed); `hazard-success-branches` (accepted); `sphere-prose` (accepted) |
| `eshyra-o9bd.19.2.4` | #655 | `display-name-qualification` (accepted); `canonical-discovery` (accepted); `rule-key-duplication` (accepted) |
| `eshyra-o9bd.19.2.3` | #654 | `advancement-qualifiers` (accepted); `proficiency-grants` (narrowed); `choice-identifiers` (narrowed); `madness-durations` (accepted); `damage-field-shape` (narrowed); `equipment-taxonomy` (accepted); `table-empty-cells` (accepted) |
| `eshyra-o9bd.19.4.2` | #646 | `druid-dryad-attacks` (accepted); `unicode-minus-damage` (accepted); `ranged-notation` (accepted); `creature-statblock-mechanics` (narrowed) |

## Positive capability evidence

`packages/core/src/rules/deterministicCapabilityLedger.ts` (eshyra-o9bd.19.5.12) is the authority for positively selected capabilities in force. The ledger bindings describe bounded support and their evidence. Absence of a binding is not a completeness result. Engine-pending magic-item clauses remain the generated unselected backlog; the DM adjudicates them, and this candidate does not claim to execute them.

## Explicit unresolved limits

- **Undeclared condition-name reference leaves — `eshyra-o9bd.19.3.5`.** Bounded nested condition-name leaves are outside the current relationship declaration gate. One-hop expansion does not continue from an imposing record to its imposed condition record. The condition remains available by name mention or direct `lookup_rules`; this is a discovery limitation, not a claim of missing source text or incorrect state.
- **Adjudicated-by-design and engine-pending readiness clauses.** These remain DM-adjudicated where classified; engine-pending clauses are not executable merely because a record or binding exists.
- **Magic-item `operation.excludes` runtime enforcement — `eshyra-kbzm`.** The field is validated but not generally enforced by `useItem`; the Candle's unlit-only cast-gate state machine enforces that item's only current use.
- **Pipes of the Sewers variable-spend evidence — `eshyra-j9rc`.** Real-pack spend/refusal/regain evidence is not yet available because grant lifecycle, controlled-entity action budget, and cooldown/identity ownership currently prevent reaching cost validation. The current truthful refusal remains.
- **Undecided roll-evidence binding — `eshyra-o9bd.19.5.14`.** The open decision governs whether selected mutation tools must consume same-turn roll-tool evidence or remain model-audited; this candidate does not resolve that trust-boundary choice.
- **Re-freeze state — `eshyra-o9bd.14`.** The thaw-note policy check is suspended during the re-audit; the hash check remains active. The formal re-freeze and refreshed hashes belong to .14.

Open downstream work includes `eshyra-o9bd.19.6.3.1` (candidate audit bundle and bounded gates), `eshyra-o9bd.19.6.4` (accept independent audit and authorize re-freeze), and `eshyra-o9bd.16` (independent audit). The held-out and bounded live-play evaluation in `eshyra-o9bd.19.15` also remains open as a later transition phase. `eshyra-olc5` remains an open epic for bounded deterministic capabilities; its children are currently closed, and the ledger remains the authority for capability bindings in force.

## Non-claims

This record makes no universal clause, mechanic, deterministic-execution, source-completeness, or discovery-completeness claim. Passing this record authorizes only the next gates, including `eshyra-o9bd.19.6.3`; it does not authorize re-freeze.
