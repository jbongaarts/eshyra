# Portable Character Chronicle

Tracking epic: `eshyra-lupf.16`.

This document defines the first version of Eshyra's character-scoped chronicle:
portable subjective memory attached to a continuing character identity, separate
from both the mechanical `CharacterSheet` and campaign-owned world canon.

## Goal

A continuing character should carry personal history across campaigns:
relationships, scars, debts, vows, titles, reputations, lessons learned,
subjective knowledge, and a record of campaign participation. Those memories can
inform play when the character enters another campaign, but they must not become
objective facts in that campaign's world just because the character remembers
them.

Example: Mira remembers King Aldren betrayed her in Campaign A. When Mira enters
Campaign B, the prompt may say "Mira remembers King Aldren's betrayal in a prior
campaign." It must not add King Aldren to Campaign B's campaign bible, overlay
lore, NPC tables, or module canon.

## Existing Boundaries

- `CharacterSheet` is mechanical continuity: class, level, HP max, proficiencies,
  spells, wallet, and other rules-pack-bound state. It stays mechanical-only.
- The character registry (`characters.db`) owns continuing identity between
  campaigns through `globalCharacterId`, revisions, and custody.
- A campaign database owns objective campaign canon during play: module canon,
  live state, campaign overlay lore, scene summaries, session recaps, arc
  summaries, and the campaign bible.
- ADR 0014 separates campaign overlay lore from decorative prose and rumors.
  Chronicle records add another layer: character-subjective facts.

## Model

`CharacterChronicle` is a registry-scoped record set keyed by
`globalCharacterId`. It is not embedded in `CharacterSheet`, because:

- chronicle records are not rules-pack-bound mechanics;
- players need to curate visibility/portability without rewriting sheet
  revisions;
- a character's memories can grow from many campaigns and should be queryable by
  source/provenance.

Each chronicle record should carry:

- `id`: stable per-character chronicle record id.
- `globalCharacterId`: continuing character identity.
- `category`: constrained vocabulary such as `relationship`, `scar`, `debt`,
  `vow`, `title`, `reputation`, `subjective-knowledge`,
  `campaign-participation`, or `other`.
- `text`: player/DM-facing summary of the memory or personal fact.
- `source`: provenance object with `campaignId`, `sessionId`, optional
  `turnId`, optional `sceneId`, and timestamp.
- `portability`: `portable`, `campaign-local`, or `archived`.
- `visibility`: `player-visible`, `dm-only`, or `private`.
- `truthStatus`: the character's relationship to the claim, not objective
  campaign truth: `remembered`, `believed`, `rumored`, `confirmed-by-character`,
  `disputed`, or `unknown`.
- `relatedRefs`: optional references to sheet/campaign entities, e.g.
  `character:pc-1`, `npc:<campaign-local-id>`, or rules refs, always scoped by
  source when campaign-local.
- `createdAt` / `updatedAt`.

The first storage implementation is append/update friendly and uses two
registry DB tables:

- `character_chronicle_record`: current record text and curation flags.
- `character_chronicle_event`: append-only audit of creation/curation changes.

`createCharacterChronicleStore` exposes the registry-backed append/list/get/update
API. The required invariant is that chronicle data lives in the registry DB, not
campaign DBs, and references campaign data through provenance rather than copying
campaign canon.

## Context Semantics

Chronicle context must render in a separate prompt section, for example:

```text
## Character Chronicle
- Mira remembers owing a life debt to Tamsin from campaign emberfall.
- Mira believes King Aldren betrayed her in campaign old-crown.
```

It must not be merged into:

- `campaign_bible`;
- `campaign_overlay_lore`;
- module context;
- `world_query` results as objective world facts.

The model may use chronicle entries to shape narration, ask follow-up questions,
or let the character recognize personal history. If the player wants a memory to
become true in the current campaign, that still requires current-campaign play
and the normal campaign canon tools.

## Capture Policy

Automatic capture is intentionally conservative. The engine may propose or append
chronicle records only when the source is character-scoped, such as:

- a level-up, scar, curse, vow, debt, title, or reputation explicitly attached to
  the character;
- a relationship the character formed;
- a subjective belief or secret the character learned;
- campaign participation history, e.g. "Mira adventured in The Hollow Beneath
  Emberfall and survived the lantern vault."

The engine must not blindly transform campaign bible entries, arc summaries, or
overlay lore into chronicle records. Objective campaign facts remain in the
campaign. Chronicle capture should either be explicitly player-authored/curated
or derived from character-attributed evidence with provenance.

The first release-time capture hook follows that boundary: `releaseCharacterFromCampaign`
can accept explicitly selected chronicle records and append them to the linked
registry character after sync-back succeeds. The hook stamps the release
campaign as provenance, but it does not read `campaign_bible`, overlay lore, arc
summaries, or world state to invent records automatically.

## Implementation Breakdown

The epic is decomposed into these child beads:

- `eshyra-lupf.16.2` — Add `CharacterChronicle` registry model and store.
- `eshyra-lupf.16.3` — Capture portable chronicle facts on campaign release.
- `eshyra-lupf.16.4` — Inject chronicle context without asserting world canon.
- `eshyra-lupf.16.1` — Add CLI chronicle inspection and curation.

The storage/model bead comes first. Release capture and context injection depend
on that model. CLI curation can follow once records exist.

## Non-Goals

- No automatic merge of prior-campaign world canon into a new campaign.
- No campaign-bible migration or cross-campaign world unification.
- No private multi-human player channels in the first version.
- No mechanical state in the chronicle; mechanics stay on `CharacterSheet` and
  campaign/live state.
- No cross-pack conversion policy; chronicle text is system-agnostic, but any
  mechanics referenced by a record must remain scoped to the source pack/campaign.
