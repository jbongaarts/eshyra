# ADR-0020 SRD Candidate Pack — successor record (eshyra-o9bd.19.6.7.13)

This record replaces [the PR #698 candidate record](./2026-11-01-o9bd-19-6-1-candidate-pack.md) as current candidate evidence. That record is kept as history. It describes the candidate after the second independent audit (`eshyra-o9bd.19.6.7`) and its repairs. It is a bounded input to acceptance (`eshyra-o9bd.19.6.4`). It does not claim universal clause, mechanic, deterministic-execution, source-coverage, or discovery completeness, and a missing binding is not evidence of completeness.

## Candidate identity

The candidate is the merge commit of the PR that adds this record. The PR changes only audit documents and the candidate-gate record path. The pack, the engine and the vendored source are byte-identical to `main` at `73083baf00d76f90f93708ba5e68d2c34008938a` (the merge of PR #716).

| Artifact (`packages/core/data/rules-packs/rules__dnd5e-srd-5.1/`) | SHA-256 |
| --- | --- |
| `records.json` | `a90984cc31e94b719d47bd03ec56251fc0cf442436000dcacd8df01b0c4be579` |
| `manifest.json` | `36e6e529ea7b88f10eec3985cd1888bb42d7cc3b958f5eb266d60ee65c39070a` |
| `field-provenance.json` | `ee02f18990cd387e7431096bcc5d66c65178eb921045572ea75e285fb7621711` |
| `record-relationships.json` | `b9a27e2311743e91c330cb94c16a8f61f75e2850c787c9d3d0e5a45651ccccbf` |
| `source-coverage.json` | `67781d4f5792bed8fa54dccca0c4089ccb4c0f524bbb2ae34f38edcaec455406` |
| `source-inventory.json` | `48134b09cb7626aeff5f3c51659f5856ea7f8dbc0021702db1e866e76c3707f2` |
| `source-region-ledger.json` | `da84d3b0313a026fa8a5567388f189e65695e7a461550e7fe7524c17d4066d5a` |

The vendored source `packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf` has SHA-256 `2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`, as recorded in its `manifest.json`.

## Reproduction

From the repository root at the candidate commit:

```sh
npm run verify:dnd5e-srd-pack
npm run audit-bundle:dnd5e-srd -- <bundle-dir> <zip-copy-path>
```

`verify:dnd5e-srd-pack` checks that the committed pack equals importer output. The audit bundle reruns the bounded candidate gates. G-capabilities needs the `dolt` binary, because one capability's evidence is a Dolt-gated test; without Dolt that gate fails closed rather than crediting an unexecuted test. The bundle is reproducible in content, not in bytes: it embeds a timestamp and absolute paths.

## What changed since the PR #698 record

**First independent audit (`eshyra-o9bd.16`).** It found 13 blockers, repaired in PRs #699–#703. The consolidated report is `2026-11-01-o9bd-16-independent-candidate-audit.md` (PR #704).

**Second independent cross-model audit (`eshyra-o9bd.19.6.7`).** Five auditors reviewed `6812cc0b`. Every claimed finding was re-verified and dispositioned on the bead. The repaired blockers:

| Finding | Bead | PR | Repair |
| --- | --- | --- | --- |
| A2-F1 death saves ignored saving-throw bonuses (SRD p.98) | `.7.6` | #710 | `record_death_save` takes a bounded `saveBonus`. Natural 1 and 20 are judged on the natural roll alone. |
| A2-F2 DM guidance never routed elapsed time through `advance_time` | `.7.7` | #712 | `advance_time` is DM-directed and not explicit-action gated. The protocol and tool texts name every elapsed-time path. Combat rounds do not advance world time, and this is disclosed. |
| A2-F3 a restored or forked campaign copy could overwrite a newer character head | `.7.8` | #711 | A synced-revision stamp in the campaign database. Head-checked atomic registry writes. Custody re-taken across close-and-recap. **Single writer per campaign database** (below). |
| A2-F4 level-up HP minimum attributed to SRD 5.1 | `.7.9` | #713 | The minimum of 1 HP per level is kept and credited to the 2018 PHB errata (below). |
| A3-F1/F2 `source-prose` carrying composition or substitution | `.7.10` | #715 | Producer-reported composition becomes generated scoped `source-derived` declarations. The Iron Flask cell is printed `1–50`. |
| A3-F3 creature attacks dropping printed damage components | `.7.11` | #716 | Flat-plus-dice and U+2013 minus are parsed. Any unprojected damage is disclosed in band. |
| A4-F1 `refresh-effect-v1` declaration contradicted the engine | `.7.12` | #714 | The ruling, typed-present and typed-absent item-power, and item-grant cases are declared as the code behaves. |

A1-F1 (discovery limits in the PR #698 record) was refuted as stated. This successor record carries its residual currency correction.

## Decisions recorded during repair

- **Official errata as separate authority (user, 2026-11-06).** The engine keeps a minimum of 1 HP gained per level, from the 2018 Player's Handbook errata ("add the total (minimum of 1)"). SRD 5.1 p.56 omits it. The minimum is credited to the errata in the code, the `level-up-v1` declaration and the tests, and never to SRD 5.1. The pack and its provenance stay faithful to the printed SRD.
- **Single writer per campaign database (user, 2026-11-06; ADR 0012).** One writing process per physical campaign database, enforced by a crash-released OS lock at every campaign-mutating CLI entrypoint. Concurrent readers are supported. Concurrent campaign writers are refused and are out of contract.

## Positive capability evidence

`packages/core/src/rules/deterministicCapabilityLedger.ts` is the authority for the positively selected capabilities in force. It is backed by the capability inventory in `deterministicCapabilityInventory.ts`. The ledger bindings describe bounded support and its evidence. The absence of a binding is not a completeness result. Engine-pending magic-item clauses remain the generated, unselected backlog. The DM adjudicates them, and this candidate does not claim to execute them.

## Explicit unresolved limits

- **Undeclared nested condition-name leaves (`eshyra-o9bd.19.3.5`).** Top-level `mechanics.conditions[].condition` references are declared record-name relationships for actions, feats, features, hazards and spells, and resolve (for example `spell:animal-friendship` → `condition:charmed`). Condition names nested elsewhere are not declared. Examples are creature action and trait mechanics (for example `creature:aboleth` Enslave → charmed), ancestry traits, magic-item effects and equipment use profiles. Discovery does not follow those leaves. The condition remains available by name mention or direct `lookup_rules`. This is a discovery limitation, not missing source text or incorrect state.
- **Remaining undeclared record-key leaves (`eshyra-ry69`).** Data leaves equal to an existing record key, at shapes no declaration covers, are neither declared references nor declared non-references. Expansion is one hop over declared shapes only. The referenced record remains available by name mention or `lookup_rules`.
- **Adjudicated-by-design and engine-pending readiness clauses.** These remain DM-adjudicated where classified. A clause is not executable merely because a record or binding exists.
- **Magic-item `operation.excludes` enforcement (`eshyra-kbzm`).** The field is validated but not generally enforced by `useItem`.
- **Pipes of the Sewers variable spend (`eshyra-j9rc`).** Real-pack spend evidence is not yet reachable. The current truthful refusal remains.
- **Roll-evidence binding decision (`eshyra-o9bd.19.5.14`).** Undecided. Selected mutation tools take caller-supplied rolls and do not verify that they came from the roll tool. Each declaration states this.
- **Djinni scimitar rider (`eshyra-roge`).** "Plus 3 (1d6) lightning or thunder damage (djinni's choice)" is not projected. The attack carries `hitDamageNotProjected` with the printed clause.
- **Refresh with `durationOverride` but no duration (`eshyra-m86j`).** On an item-power effect it is accepted and records nothing. The `refresh-effect-v1` declaration states this.
- **Death-save bonus persistence (`eshyra-212h`).** `saveBonus` and `bonusSources` are returned with the result but not stored as a structured per-save record.
- **Custody residuals.**
  - A legacy campaign copy with no synced-revision stamp is not detected as stale until it is stamped.
  - `/quit` releasing a stale copy is a silent no-op (`eshyra-nwu2`).
  - The campaign writer lock is advisory among cooperating Eshyra processes, and gives no guarantee on network filesystems with broken file locks.
- **Open non-blocking findings from the first audit.** `eshyra-du32` (the capability ledger should use own-key membership) and `eshyra-7z0z` (importer name fallback for empty bodies).
- **Re-freeze state (`eshyra-o9bd.14`).** The freeze guard is inactive during the re-audit. `THAW_NOTE_CHECK_ENABLED` is `false`, and the `freeze-manifest.json` hashes predate the re-audit, so `npm run verify:dnd5e-srd-freeze` reports mismatches. Byte-level reproducibility is checked by `npm run verify:dnd5e-srd-pack`. The formal re-freeze, refreshed hashes and guard re-enablement belong to `eshyra-o9bd.14` and `eshyra-2zyy`.
- **Later evaluation.** Held-out and bounded live-play evaluation remains with `eshyra-o9bd.19.15`.

## Downstream

- A bounded re-audit of the second-audit repairs at this candidate, if the project owner wants one before acceptance.
- Acceptance and re-freeze authorization: `eshyra-o9bd.19.6.4`, the project owner's decision.
- Formal regeneration and re-freeze: `eshyra-o9bd.14`, then `eshyra-2zyy`.

## Non-claims

This record makes no universal clause, mechanic, deterministic-execution, source-completeness or discovery-completeness claim. It does not authorize re-freeze.
