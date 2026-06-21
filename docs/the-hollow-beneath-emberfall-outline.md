# The Hollow Beneath Emberfall — Module Outline

Outline-level design for Eshyra's first-party starter adventure module
(eshyra-eh54.7.1). This is the **outline**, not the authored fixture — the full
`AdventureModule` JSON fixture is authored against this in eshyra-eh54.7.2, and a
runtime smoke path is added in eshyra-eh54.7.3.

## Purpose and scope

This is the gameplay hello-world: the smallest authored scenario that exercises
every load-bearing part of the adventure-module engine — keyed locations and
exits, NPC motives, first-class authored secrets with reveal sites, objectives
with success/failure conditions, a mix of social / exploration / combat
encounters, a threat clock, branching endings, and **player-driven divergence**
recorded as campaign progress without mutating the module source.

Keep it intentionally small. It is one delve, not a campaign arc. If a beat does
not demonstrate an engine capability, cut it.

### Naming (ADR 0012)

- **Emberfall** — the setting-scale village/region. A *campaign template*. This
  module does **not** author Emberfall; it only seats a scenario in it.
- **The Hollow Beneath Emberfall** — this *adventure module* (scenario-scale).
- **Ember Hollow** — informal shorthand only; not a separate place.
- **`EMBERFALL_HOLLOW`** — the legacy conflated sample
  (`packages/core/src/world/samples/emberfallHollow.ts`, a world `ModulePack`)
  that mixes setting and scenario. This outline supersedes it as a true
  `AdventureModule`; the legacy sample is reused only as a lore source until the
  Emberfall setting is split out by later eh54 work.

### Relationship to the four layers (ADR 0012)

| Layer | Owns | This module |
| --- | --- | --- |
| Rules pack | mechanical truth | references SRD 5.1 by `rulesRef` only |
| Campaign template / setting | Emberfall the place | depends on it via `settingCompatibility`; never redefines it |
| **Adventure module** | this authored scenario | the subject of this outline |
| Campaign instance | play history / progress | records reveals, outcomes, deviations at runtime (eh54.4/.5) |

## Module identity

Maps to the top-level `AdventureModule` fields (`packages/core/src/adventure/types.ts`).

- **id:** `eshyra:hollow-beneath-emberfall` (canonical title slug; distinct from
  the legacy `eshyra:emberfall-hollow` world sample id). The CLI audit resolver
  maps the `:` to a path-safe directory segment, so on disk this installs under
  `adventure-modules/eshyra_hollow-beneath-emberfall/` (eshyra-eh54.6 contract;
  the final install layout is fixed in eshyra-eh54.7.3).
- **title:** The Hollow Beneath Emberfall
- **summary:** A short cave-delve beneath Emberfall's ruined watchtower, where
  goblins have crept back into a place that was sealed for a reason.
- **intendedLevels:** `{ min: 1, max: 2 }` — a starter delve for fresh PCs.
- **intendedPartySize:** `{ min: 1, max: 4 }` — playable solo (one PC + the DM)
  up to a small party.
- **rulesRequirements:** `{ baseSystemId: 'dnd5e-srd' }`.
- **settingCompatibility:** `[{ settingPackId: 'eshyra:emberfall',
  anchorLocationId: 'emberfall-square' }]`. The anchor seats the scenario at the
  village square. (`eshyra:emberfall` is the intended Emberfall *setting* pack id
  once Emberfall is split from the legacy sample; the outline depends on it by
  reference only.)
- **startingSceneId:** `scene-arrival`.

## Premise

A recent tremor cracked the floor of Emberfall's long-abandoned watchtower and
reopened the stair into the cellar beneath it — the hollow. Goblins have moved
in and begun raiding the village's grain. Warden Sela hires the party to drive
them out. The real story is quieter: the goblins are not the point. They are
*digging*, drawn to a sealed door at the bottom of the hollow that someone shut
on purpose a long time ago. The scenario is about what the party learns, and
whether they reseal that door, open it, or simply leave.

## Starting hook

- **`hook-grain-raids`** — Warden Sela meets the party in Emberfall Square and
  asks them to clear the goblins from the hollow before the next raid empties the
  winter stores. (Origin NPC: `npc-warden-sela`; origin location:
  `loc-emberfall-square`.)

## Keyed locations (4)

Maps to `locations[]` with `exits[]`. Four keyed locations — within the 3–5
target — kept tight so exits form a clear, mostly-linear delve with one branch.

1. **`loc-emberfall-square`** — *Emberfall Square* (hub, social). Soot-streaked
   houses, a dry well, the leaning watchtower on the hill above. Exit: `north` →
   `loc-watchtower-mouth`. Tags: `safe`, `hub`.
2. **`loc-watchtower-mouth`** — *The Watchtower Mouth* (threshold, combat). The
   collapsed tower base opens onto a black stair. Exits: `south` →
   `loc-emberfall-square`; `down` → `loc-collapsed-stair` (the descent is the
   exploration obstacle). Tags: `threshold`.
3. **`loc-collapsed-stair`** — *The Collapsed Stair* (exploration obstacle). A
   half-fallen spiral of broken steps and loose rubble; the exploration
   challenge gates the deeper hollow. Exits: `up` → `loc-watchtower-mouth`;
   `down` → `loc-deep-hollow`. Tags: `hazard`.
4. **`loc-deep-hollow`** — *The Deep Hollow* (objective, social/combat). A wide
   cellar-cavern: the goblin camp, stolen Emberfall grain, and at the far wall a
   stone door the goblins are trying to pry open. Exit: `up` →
   `loc-collapsed-stair`. Tags: `objective`.

## NPC roles

Maps to `npcs[]`. Each carries a DM-only `secret`.

- **`npc-warden-sela`** — *Warden Sela*, village warden. Role: quest-giver.
  Disposition: wary but grateful. Home: `loc-emberfall-square`. **Secret:** she
  ordered the watchtower abandoned years ago; the goblins moved in because of
  that decision, and she dreads the village learning it. (Carried forward from
  the legacy sample lore.)
- **`npc-grik`** — *Grik*, a goblin forager who would rather talk than die.
  Role: antagonist who can become an informant. Disposition: hostile but
  bribable. Home: `loc-deep-hollow`. **Secret:** the goblins did not choose this
  place — something below "calls" in their dreams and they are digging toward it;
  Grik is terrified of it. Grik is the lever for player divergence (parley vs.
  fight).

The presence behind the sealed door is deliberately **not** an NPC. It is a
secret/threat only, to keep the starter scenario small and unresolved by design.

## Likely scenes

Maps to `scenes[]` (advisory grouping, not a state machine; the module supports
nonlinear play).

- **`scene-arrival`** (social) — Square; meet Sela, take or refuse the hook.
  Locations: `loc-emberfall-square`. NPCs: `npc-warden-sela`. Objectives:
  `obj-clear-the-hollow`. Secrets revealable here: `secret-sela-abandoned-tower`.
- **`scene-descent`** (exploration) — Mouth and collapsed stair; the descent
  obstacle. Locations: `loc-watchtower-mouth`, `loc-collapsed-stair`.
  Encounters: `enc-mouth-ambush`, `enc-collapsed-stair`.
- **`scene-the-warren`** (mixed: social or combat) — Deep hollow; confront the
  goblins, fight or parley with Grik. Locations: `loc-deep-hollow`. NPCs:
  `npc-grik`. Encounters: `enc-warren-standoff`. Secrets:
  `secret-not-a-natural-lair`.
- **`scene-the-sealed-door`** (exploration / decision) — The door at the back of
  the deep hollow; the central choice. Locations: `loc-deep-hollow`. Secrets:
  `secret-the-sealed-door`. Objectives: `obj-decide-the-door`.

## Objectives

Maps to `objectives[]` with success/failure conditions.

- **`obj-clear-the-hollow`** (required) — Stop the goblin raids on Emberfall.
  Success: the goblins no longer threaten the village (driven off, slain, or come
  to terms). Related scenes: `scene-arrival`, `scene-the-warren`.
- **`obj-learn-the-truth`** (optional) — Discover why the goblins really came.
  Success: the party learns the goblins are digging toward the sealed door.
  Related scenes: `scene-the-warren`, `scene-the-sealed-door`.
- **`obj-decide-the-door`** (required, branching) — Choose what to do with the
  sealed door. Success: the party reseals it, opens it, or deliberately leaves
  it — the choice drives the ending; there is no single "correct" resolution.
  Failure: the door is breached unintentionally (e.g. the threat clock fills).
  Related scenes: `scene-the-sealed-door`.

## Secrets and reveal sites

Maps to `secrets[]` with `revealableLocationIds` / `revealableSceneIds`. These
are authored possibilities; *whether* a secret is revealed is campaign state.

- **`secret-sela-abandoned-tower`** — Sela's old order to abandon the tower
  caused this. Revealable at: `loc-emberfall-square` / `scene-arrival` (pressing
  Sela) and `loc-deep-hollow` (old militia evidence below).
- **`secret-not-a-natural-lair`** — The hollow is the watchtower's sealed cellar,
  not a natural goblin lair. Revealable at: `loc-deep-hollow` /
  `scene-the-warren` (Grik or the worked-stone walls).
- **`secret-the-sealed-door`** — Something older than the goblins sealed the
  lowest door, and the goblins are digging toward it. Revealable at:
  `loc-deep-hollow` / `scene-the-sealed-door`.

## Encounters

Maps to `encounters[]`. The acceptance set: at least one social, one exploration
obstacle, and one combat-capable encounter — all three present.

- **`enc-mouth-ambush`** (combat) — Goblin sentries loose arrows from the rubble
  at the tower mouth before closing. Location: `loc-watchtower-mouth`. Creatures:
  `creature:goblin` ×2 (`rulesRef`, resolved via the campaign rules binding).
  Reward: a bent iron key to the goblins' grain cache.
- **`enc-collapsed-stair`** (exploration obstacle) — The broken stair must be
  descended without triggering a collapse; an ability check, not a fight.
  Location: `loc-collapsed-stair`. No creatures. A failure complicates the
  descent (noise alerts the warren, or a short fall) rather than ending the run.
- **`enc-warren-standoff`** (social or combat) — The goblin camp. Grik can be
  parleyed (information, safe passage, or a bribe) or it becomes a fight.
  Location: `loc-deep-hollow`. Creatures: `creature:goblin` ×3 (only if it turns
  to combat). This is the primary player-divergence point.

## Threat clock

Maps to `clocksOrThreats[]` (segment count is authored; live fill is campaign
state).

- **`clock-the-dig`** — *The Goblins Dig* — 4 segments. Advances when the party
  rests, delays, or noisily alerts the warren. When filled: the goblins breach
  the sealed door and the scenario tips toward the breached ending. Linked
  objective: `obj-decide-the-door`.

## Reward / treasure

Maps to `treasure[]`.

- **`treasure-grain-key`** — the bent iron key (also the `enc-mouth-ambush`
  reward) opening the recovered Emberfall grain cache; the social win with Sela.
- **`treasure-wardens-cache`** — a modest find in the cellar: a single
  `magic-item:potion-of-healing` (`rulesRef`) and a few coins. Kept small to suit
  level 1–2.

## Ending states

Maps to `endingStates[]`.

- **`end-resealed`** (success) — The goblins are dealt with and the door is
  resealed; Emberfall is safe and Sela offers the watchtower as a base. Condition:
  goblins resolved and the door resealed before `clock-the-dig` fills.
- **`end-truce`** (partial / neutral) — The goblins are driven off or bought off
  and the party leaves the door as it is; the raids stop but the hollow's deeper
  question is unanswered. Condition: goblins resolved, door neither resealed nor
  breached.
- **`end-breached`** (failure) — The door is opened or breached; whatever was
  sealed below is loosed, leaving an open thread for a later scenario. Condition:
  `clock-the-dig` fills, or the party opens the door.

## What this outline demonstrates (engine coverage checklist)

- Keyed locations with directional exits and a branch (square → mouth → stair →
  deep hollow).
- NPC motives, including a quest-giver with a guilty secret and an antagonist who
  can flip to informant.
- First-class authored secrets, each with explicit reveal sites, distinct from
  whether they have actually been revealed (campaign state).
- Objectives with success/failure conditions, including an explicitly branching
  one with no single correct resolution.
- One social, one exploration-obstacle, and one combat-capable encounter, with
  creatures referenced by `rulesRef` only.
- A threat clock whose live fill is campaign state and whose filling changes the
  ending.
- Player-driven divergence (fight vs. parley; reseal vs. open vs. leave) captured
  as campaign progress/deviations without mutating the module source.
- Setting reuse: the scenario leans on Emberfall (Sela, the watchtower, the
  forge-fire history) via `settingCompatibility` without authoring Emberfall
  itself.
