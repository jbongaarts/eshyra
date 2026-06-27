# ADR 0012: Character Continuity and Custody Across Campaigns

- **Status:** Accepted
- **Date:** 2026-06-27
- **Bead:** eshyra-lupf.14.2

## Context

ADR 0011 made the canonical character sheet core-owned and rules-pack-bound, and
located the authoritative playable sheet in the campaign database's
`character_sheet` table. It deliberately deferred one question: a character is
not only a campaign-local thing. The CLI already has a cross-campaign character
library (`<dataRoot>/characters/*.json`): characters are created once and
imported into a campaign for play. ADR 0011's per-campaign store has no home for
that library, and "switch the CLI to the core store" therefore has two
incompatible shapes.

The deeper question is **custody**: who owns a character while they are *not*
actively adventuring, and how does a character move between campaigns?

Two tempting models are both wrong for the long term:

- **Campaign-only.** Lock a character to one campaign. This forces creation
  inside a campaign and discards build-before-campaign and stable-roster UX. It
  also makes legacy-JSON migration arbitrary (which campaign?).
- **Template vault / clone.** Treat the cross-campaign store as reusable
  templates that are *copied* into campaigns. This silently forks identity: the
  moment a character is in two campaigns there are two "real" copies and no
  continuity. Players generally want a character's experiences — XP, level,
  equipment, money, and who they have met — to **carry forward**.

## Decision

### 1. A character is a continuing, cross-campaign entity; campaigns take custody

A character has a stable global identity and a personal, linear timeline.
Campaigns are episodes/realms the character participates in. A campaign takes
**custody** of the character while they adventure there; it is not allowed to
silently fork them.

### 2. Two scopes, one authority at a time (no cross-DB write races)

- **Character registry** (core-owned, data-root SQLite, e.g.
  `<dataRoot>/characters.db`): the authority for a character **between**
  campaigns. Keyed by a stable `globalCharacterId`, it persists the canonical
  `CharacterSheet` document (binding columns + `sheet_json`).
- **Campaign `character_sheet`** (ADR 0011, per-campaign): the authoritative
  playable instance **during** play. Leveling, HP, money, spells, conditions,
  and the progression ledger mutate the campaign sheet, not the registry entry.

The registry owns the character when idle; a campaign owns the working instance
while the character is attached there. There is never simultaneous write
authority across two databases.

### 3. Attach is copy-with-provenance, not clone

Importing a registry character into a campaign asserts the campaign rules
binding matches (fail closed on mismatch, per ADR 0011 §3), copies the sheet
into the campaign `character_sheet` table, projects identity/class/level/`hp_max`
into the live `character` row, and **stamps the campaign sheet with the source
`globalCharacterId`** so the playable instance is linked back to the continuing
identity. Cross-pack import is not an import; it is a future explicit
conversion / new-sheet operation.

### 4. Deferred (not designed away)

This decision establishes the model; the following are explicitly **out of scope
for `eshyra-lupf.14.2`** but must not be precluded:

- **Custody lifecycle (`eshyra-lupf.14.3`):** linear revision history; exit →
  commit a new registry revision from the campaign sheet; prevent silent
  double-attach to multiple active campaigns; explicit, rare alternate-timeline
  fork. `.14.2` reserves the `globalCharacterId` linkage; it does not build
  revisions or sync-back.
- **Currency (`eshyra-lupf.15`):** money is not yet modeled (the sheet carries
  only prose `equipment`). A structured, pack-bound wallet is continuity state
  that travels with the character; it is a known gap, not part of this bead.
- **Character chronicle (`eshyra-lupf.16`):** a character carries subjective,
  portable memory (relationships, scars, debts, subjective knowledge) distinct
  from a campaign's objective world canon. A `CharacterChronicle`, separate from
  the mechanical sheet, is a future concern; prior-campaign world facts must not
  be blindly merged into new campaigns.

## Consequences

- `.14.2` adds a core `CharacterRegistryStore` (distinct in name from the
  per-campaign `CharacterSheetStore`, even where they share low-level helpers),
  migrates the legacy JSON library into it, and rewires CLI creation/import to
  registry → campaign attach with `globalCharacterId` provenance.
- The per-campaign `character_sheet` store (`.14.1`) is unchanged and correct: it
  is the during-play authority the custody model needs.
- Progression (`.2`) and the level-up engine (`.8`) operate on the campaign
  sheet; their results are what a later exit/sync commits back to the registry.
- `FinalizedCharacter` is removed in favor of `CharacterSheet`.

## Out of scope

- Revision history, exit/sync-back, double-attach prevention, and alternate
  timelines (the custody lifecycle bead).
- Structured currency and the portable character chronicle (their own epics).
- Cross-pack character conversion.
