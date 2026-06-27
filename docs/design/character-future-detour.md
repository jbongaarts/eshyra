# Character "future detour" / out-of-order continuity (design)

- **Status:** Design-only (no implementation). Bead: eshyra-lupf.14.4.5.
- **Parent policy:** ADR 0012 §"Timeline conflict-resolution UX
  (eshyra-lupf.14.4)".

This document defines the most advanced — and deliberately **unimplemented** —
resume conflict resolution: the *future detour*. It exists so the option is
designed honestly rather than improvised later, and so the implemented
resolutions (cancel, catch-up-to-head, explicit fork) are not quietly stretched
to cover a case they cannot serve correctly.

## What a future detour is

A character has one linear registry timeline (ADR 0012). A *future detour* is
the situation where a player resumes an **older** campaign whose copy of the
character is behind the registry head — the character has already adventured
*ahead* in another campaign — and the player wants to **keep playing the older
campaign anyway**, in that campaign's earlier-state version of the character,
without throwing away the later adventures.

Read chronologically against the character's lived timeline, the older
campaign's continued play happens *out of order*: the player is filling in events
that, from the character's perspective, sit before adventures that have already
been recorded at later revisions. Hence "future detour" — the campaign you left
running is now, relative to the character, a detour back into their past while
their future is already partly written.

## What a future detour is NOT

- **Not a catch-up.** Catch-up adopts the registry head and discards the stale
  local copy; the older campaign would then be played with the *advanced*
  character. A future detour deliberately keeps playing the *earlier* state.
- **Not a "temporary fork that auto-rejoins."** The word *rejoin* is avoided on
  purpose. It implies Eshyra can later take the detour's mechanical outcome and
  merge it back into the main timeline automatically. It cannot (see below).
- **Not an automatic merge of any kind.** No XP, inventory, level, spells, HP,
  conditions, or campaign-local consequences from the detour are ever applied to
  the character's main timeline by code.

A future detour is therefore best described to the user as: *"play this older
campaign as a branch in the character's past; later, you — not the system —
decide how, or whether, to reconcile what happened here with the rest of the
character's story."*

## Why automatic reconciliation is rejected

Two divergent sheets cannot be merged into one canonical sheet without inventing
canon the player never chose. Every mechanical axis fails a different way:

- **XP / level:** summing double-counts shared milestones; taking the max
  discards the detour's growth; neither is "what happened."
- **Inventory / currency:** union duplicates items and money; last-writer-wins
  silently destroys one branch's loot.
- **HP / conditions:** these are point-in-time encounter state, meaningless to
  carry across a branch boundary.
- **Spells / known abilities:** branches may have made incompatible build
  choices (different subclass picks, feats), which no rule can reconcile.
- **Campaign-local consequences:** an NPC the detour killed may be alive in the
  main timeline; world facts diverge and are not even commensurable.

Because there is no honest automatic rule, reconciliation is a **human authoring
decision**, made later, with full visibility into both branches — exactly the
kind of judgment Eshyra routes to a person, not a tool.

## Data the system would need to make a detour intelligible later

Even though play is deferred, a future detour is only useful if a later human
reconciliation can understand what diverged. The following provenance would be
recorded at the moment a player chooses "future detour" (none of this is built
yet; it is the schema/decision surface for whoever implements it):

| Field | Purpose |
| --- | --- |
| `sourceGlobalCharacterId` | The continuing character this detour branches from. |
| `sourceRevision` | The revision the older campaign's copy sits at (the branch point). |
| `headRevisionAtDetour` | The registry head at the time the detour was chosen (records how far ahead the main timeline already was). |
| `detourBranchId` | A stable id for the detour branch itself (so multiple detours are distinguishable). |
| `parentCampaignId` | The campaign being played out-of-order. |
| `intendedChronologicalPlacement` | Where, in the character's lived order, the player intends these events to sit (e.g. "before revision N"). Free-form/advisory; the system does not enforce it. |
| `warningsAcknowledgedAt` | Timestamp proving the player was warned the detour does not auto-reconcile. |
| `reconciliationStatus` | `unreconciled` (default) → later `reconciled` / `abandoned`, set only by an explicit human action. |

## Does this require registry schema branching support first?

**Yes — and that is the gate.** The current registry (`character_revision`) is a
strictly **linear**, append-only, 1-based timeline per `globalCharacterId`
(ADR 0012). It has exactly enough branching to model a *fork*: a fork starts a
**new** `globalCharacterId` at revision 1 with `parent` provenance, which is a
clean cut, not a branch that tracks an intent to reconcile.

A future detour is different: it wants to play forward *as the same character*
while recording that this play is an out-of-order branch pending manual
reconciliation. The linear schema cannot represent "an unreconciled branch of an
existing identity" — there is no place for a branch node, a reconciliation
status, or the detour provenance table above.

So the implementation order is fixed: **a registry branching model must be
designed and added before a future detour can be implemented.** Two candidate
shapes, both deferred:

1. **Detour-as-fork-with-backref.** Reuse the existing fork (new
   `globalCharacterId`, revision 1, `parent`), but add a `detour` provenance row
   that marks the fork as an unreconciled out-of-order branch of the source and
   stores the table above. Cheapest; piggybacks on shipped fork mechanics; the
   "same character" feeling is only a UI affordance over two real identities.
2. **First-class branch nodes.** Extend `character_revision` (or a sibling table)
   so a revision can have a non-linear parent and a branch label, making detours
   true branches of one identity. More faithful; a larger schema and invariant
   change; risks complicating the linear fast-path that per-turn loads depend on.

Choosing between these is itself future design work and explicitly out of scope
here. Until that decision and the schema land, the resume UX offers only cancel,
catch-up, and explicit fork; a player who wants out-of-order play today
approximates it with an explicit fork and their own notes.

## Summary of the decision

- Future detour = out-of-order branch of an existing character; **not** a
  temporary fork that auto-rejoins.
- Detour mechanical state is **never** auto-applied to the main timeline;
  reconciliation is manual, later, and human.
- Automatic merge of XP, inventory, level, spells, HP, conditions, and
  campaign-local consequences is explicitly rejected.
- Implementing it **requires registry branching support first**; the linear
  revision schema cannot represent an unreconciled branch of one identity.
- Therefore future detour ships as documentation only for now; the live resume
  conflict UX is cancel / catch-up-to-head / explicit fork.
