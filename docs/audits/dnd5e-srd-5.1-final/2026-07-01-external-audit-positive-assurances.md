# 2026-07-01 External Audit — Positive Assurances

**Bead:** `eshyra-o9bd.18.10` (child of epic `eshyra-o9bd.18`, "Close 2026-07-01
D&D SRD audit findings")

**Purpose:** preserve the high-value positive results from the 2026-07-01
external max-effort review so future agents do not re-litigate already-verified
clean areas while fixing the findings tracked under `eshyra-o9bd.18`'s other
children. This is a **positive-assurance record, not a re-freeze**: see
[Scope and non-closure](#scope-and-non-closure) below.

## Exact artifact reviewed

| | |
| --- | --- |
| Reviewers | ChatGPT (manual review) + Codex GPT-5.5 + Claude Fable-5, each performing an independent full-coverage pass |
| Repo commit reviewed | `beb9a21bf0a746e7359477b2062b6dec9a5b06ea` ("Merge PR #381: eshyra-erf5 Close remaining audit-round follow-ups (erf5.5, erf5.6, erf5.7, 5c7f)") |
| Audit bundle | `dnd5e-srd-audit-bundle-070126.zip` (regenerated at commit `beb9a21`; not committed to git, consistent with the existing bundle-is-regenerable convention — see `README.md` §12) |
| Durable harness | `~/src/dnd5e-srd-audit-harness-070126/` (scripted checks: `consistency.py`, `corpus.py`, `digit_check.py`, `page_coverage.py`, `record_check.py`, `spell_lists.py`, plus their JSON reports) |
| Records covered | All 1,812 records, all 403 source PDF pages, checked bidirectionally |

This is a distinct, later review than the one recorded in the existing
`README.md` (audited commit `0f5b3dc`, 2026-06-17); this document does not
supersede or edit that file.

## Positive assurances (verified clean)

The following areas were independently checked against the source PDF and
found faithful. Nothing below needs re-verification by a future agent working
an `eshyra-o9bd.18.*` finding bead — treat a contrary future finding in one of
these areas as a regression, not a pre-existing gap.

- **Every spell** (319 records): name, level/school line, ritual tag, casting
  time, range, components/material text, duration, higher-levels text,
  description, damage dice, save abilities, and attack flags all verified
  against source. Concentration flags verified correct **except**
  `spell:protection-from-evil-and-good`, which was found incorrect by this
  round and has since been fixed (`eshyra-o9bd.18.2`, PR #383).
- **Class spell lists** (pp. 105–113): exact bidirectional parity — 70
  class/level groups, 778 memberships, 0 discrepancies in either direction.
- **Every creature** (317 records): all ability scores, speeds, saving
  throws, skills, senses, languages, damage immunities/resistances,
  challenge rating, and trait/action/reaction/legendary-action text verified;
  attack average/dice/DC internal consistency clean pack-wide.
- **Every equipment row, magic item** (type/rarity/attunement/description),
  **table record**, **condition/rule/feature/hazard/background/ancestry**
  reviewed; numeric fidelity (every digit-bearing token) reported as
  essentially perfect.
- **Modeling strengths** noted by the reviewers: typed per-level class
  advancement, structured starting-equipment refs/filter catalogs, 22 typed
  table projections, structured ancestry ASI/languages, exhaustion levels,
  and complete deck/flask/apparatus tables.

## Residual findings from this same round

The same 2026-07-01 round also surfaced the defects tracked as the other
children of `eshyra-o9bd.18` — this document intentionally does not restate
their detail (run `bd show eshyra-o9bd.18` for the current child list and
`bd memories o9bd` for the running audit-state note). At the time this
document was written, open children include:

- `eshyra-o9bd.18.6` (epic) — creature statline semantics (AC parentheticals,
  HP dice formulas, `(hover)`, lycanthrope form-conditional AC/speed).
- `eshyra-o9bd.18.7` (epic) — deterministic gameplay-modeling gaps.
- `eshyra-o9bd.18.8` (epic) — residual source/coverage/provenance/discoverability
  findings, including the 67 hyphen-space dehyphenation artifacts and two minor
  prose-gap footnotes.
- `eshyra-o9bd.18.9` (epic) — gate blind spots exposed by this same audit round
  (e.g. owned-region-without-emitted-prose, creature statline gates).

Already-fixed findings from this round (`eshyra-o9bd.18.1`, `.18.2`, `.18.3`,
`.18.4`, `.18.5`) are recorded in
[`thaw-notes/2026-07-02-o9bd18-audit-findings-batch1.md`](./thaw-notes/2026-07-02-o9bd18-audit-findings-batch1.md)
and
[`thaw-notes/2026-07-02-o9bd-18-3-condition-relation-safety.md`](./thaw-notes/2026-07-02-o9bd-18-3-condition-relation-safety.md).

## Scope and non-closure

Recording these positive assurances closes **only** `eshyra-o9bd.18.10`. It
does **not**:

- Close, or provide evidence toward closing, any other `eshyra-o9bd.18.*`
  finding bead — each of those remains open until its own acceptance criteria
  are independently met and verified.
- Re-freeze the `rules:dnd5e-srd-5.1` artifact. The artifact remains in
  `thawed-reaudit` status per `freeze-manifest.json`; re-freeze is tracked
  separately (`eshyra-o9bd.14` / `eshyra-2zyy`).
- Assert that areas outside this round's stated scope (e.g. anything not
  listed above) are clean — absence of a finding here is not a claim of
  verification.

A future agent starting work on any `eshyra-o9bd.18.*` child should still
independently re-verify the committed pack state first, per the standing
workflow lesson: earlier audit rounds have repeatedly named deficiencies that
a later snapshot had already fixed.
