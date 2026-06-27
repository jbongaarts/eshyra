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

## Custody lifecycle (eshyra-lupf.14.3)

The lifecycle deferred above is now built on the `.14.2` registry. It adds two
tables to the registry database and a core orchestration layer
(`characterCustody.ts`) over the registry store and the per-campaign databases.

- **Linear revision history.** `character_revision` is an append-only, 1-based
  timeline per `globalCharacterId`. Revision 1 is the initial **register**; each
  campaign **sync-back** appends the next revision built from the campaign sheet.
  The `character_registry` head row mirrors the latest revision for fast loads.
- **Custody is the cross-DB write lock.** `character_custody` holds at most one
  row per character, present exactly while a campaign is its active writer.
  SQLite cannot transact across the registry and per-campaign databases, so the
  helpers never try to; they order writes (attach the durable campaign sheet
  *before* recording custody; the campaign sheet is the source a later sync-back
  commits from) so a crash leaves a recoverable state, and custody makes "exactly
  one writer at a time" enforceable rather than relying on a shared transaction.
- **Checkout records source revision + custody.** Attaching stamps the campaign
  sheet with the checked-out revision (`metadata.sourceRevision`) and takes
  custody. Sync-back strips the per-attachment provenance
  (`globalCharacterId` / `importedAt` / `sourceRevision`) so the registry stores
  clean canonical sheets, and skips the append when the sheet is unchanged so
  idle sessions do not spam identical revisions.
- **Double-attach is prevented; continuity is the way out.** Checking a
  character out while a *different* campaign holds custody fails closed
  (`CharacterCustodyError`). Re-checkout into the same campaign is idempotent
  only for the **same party slot** — attaching one continuing identity as a
  second `pc-<n>` in the same campaign is rejected, not silently duplicated. The
  resolution to a cross-campaign clash is to **release** the character from the
  first campaign — its progress carries forward — not to fork.
- **Ownership is enforced on both ends of the lock.** Only the custody holder
  may sync back or release: `syncBackCharacterFromCampaign` /
  `releaseCharacterFromCampaign` take the `(campaignId, characterId)` of the
  caller and no-op when it does not match the live custody record, so a stale
  campaign database can never revert the timeline or drop a lock another campaign
  now holds. The CLI releases custody on `/quit` and, on resume,
  `acquireCustodyOnResume` re-takes the lock for each already-attached character
  (without re-attaching, so per-turn HP/conditions survive). Resume fails closed
  when the character is in active play elsewhere or the registry head has
  advanced past this campaign's copy — so the "one active writer" guard holds for
  the whole session and a character moves between campaigns as one continuing
  identity.
- **Fork is the discouraged escape hatch, not the movement mechanism.** The
  design goal is to *avoid* forking: a character is one continuing entity whose
  experiences carry forward, and moving it between campaigns is release →
  re-checkout. `forkCharacterTimeline` copies a chosen revision into a brand-new
  `globalCharacterId` (revision 1, with `parent` provenance) and explicitly
  **breaks continuity**; it exists only for the unusual "parallel what-if copy"
  case, satisfying the ADR requirement that an alternate timeline be *possible*
  while never being the default path.

## Timeline conflict-resolution UX (eshyra-lupf.14.4)

`.14.3` ships the custody lifecycle as core APIs wired into play/quit, and resume
deliberately **fails closed** in two situations: the character is in active play
in another campaign, or the registry head has advanced past this campaign's copy
(the character adventured elsewhere since this campaign last held it). `.14.3`
surfaces both only as a raw `CharacterCustodyError`. `.14.4` turns the second of
those — the *stale-copy* conflict — into an explicit, user-facing choice, while
keeping the first (held-elsewhere) a hard stop. The resolutions below are the
policy this epic implements (`.4.2`/`.4.4`) and designs (`.4.5`); the load-bearing
invariant is unchanged from `.14.3`: **no path silently merges or rewrites a
character's timeline.**

### The conflict

On resume, for each registry-linked campaign character, `checkCustodyResumable`
classifies the situation:

- **held elsewhere** — another campaign currently holds custody. This is not a
  timeline conflict; it is a live-writer conflict. It stays **fail-closed**: the
  only resolution is to exit the other campaign (release carries progress
  forward). `.14.4` does not add a "steal custody" choice.
- **stale copy** — the character is idle, but the registry head sheet differs
  from this campaign's copy because the character advanced in another campaign
  after this one last released it. `.14.3` failed closed here too; `.14.4`
  replaces that dead end with the choices below.
- **in sync / not linked** — no conflict; resume proceeds as today.

### Resolutions for a stale-copy conflict

1. **Cancel (default, fail-closed).** Decline to resume. Nothing is mutated;
   the campaign does not start. This is the safe default and what a non-
   interactive / EOF resume does — `.14.4` never auto-picks a mutating option.
2. **Catch up to head (primary happy path, `.4.2`).** Adopt the character's
   latest registry revision into this campaign: replace the campaign-local
   `character_sheet` with the registry head, re-stamp provenance
   (`globalCharacterId`, `sourceRevision = head`, `importedAt`), re-project the
   live `character` row, and acquire custody. This is a **checkout of the newer
   revision**, not a merge: the campaign discards its own stale copy and takes
   the registry's current truth. It appends **no** new registry revision (it is
   adopting head, not advancing it). The campaign's prior local mechanical state
   for that character (its stale sheet) is overwritten — the character's
   experiences elsewhere are canonical and carry in wholesale.
3. **Fork an alternate timeline (`.4.4`).** Branch the *campaign's* current
   revision (or a chosen revision) into a brand-new `globalCharacterId` via
   `forkCharacterTimeline`, attach the fork, and play on as an explicitly
   separate character. This **breaks continuity** on purpose: the original
   continuing identity is untouched and the fork is independent thereafter. It is
   the escape hatch for "I want to keep playing this campaign's version of the
   character as its own person," not a way to rejoin the main timeline.
4. **Future detour / out-of-order continuity (design-only, `.4.5`).** Play this
   campaign forward from its stale copy, explicitly understanding it as an
   out-of-order branch whose mechanical outcome is **not** automatically applied
   to the character's main timeline. Reconciliation, if any, is manual and
   later. This is deliberately **not** called "rejoin": Eshyra cannot honestly
   auto-merge XP, inventory, level, spells, HP, conditions, or campaign-local
   consequences across divergent branches. See
   `docs/design/character-future-detour.md`.

### No automatic mechanical merge

None of the resolutions merge mechanical state. Catch-up *replaces* with head;
fork *branches* a new identity; future-detour *defers* reconciliation to a manual
human decision. There is no code path that takes two divergent sheets and
produces a single reconciled sheet automatically — that is an explicit non-goal,
because any automatic rule (max of each stat? sum XP? union inventory?) would
silently invent canon the player never chose.

### Catch-up continuity narration

A catch-up can leave a jarring gap: the party last saw the character at the stale
revision, and they resume changed (higher level, new gear, scars). Bridging that
in fiction is **optional** and **selectable** (`.4.3`), and never required for the
mechanical catch-up to succeed:

- **player-provided** — the player writes a one-line in-fiction explanation
  ("Kael returns from the northern campaign hardened and re-equipped").
- **DM-generated** — the model is asked for a short bridge given the prior local
  revision, the new head, and the current scene; the player can accept or skip.
- **none** — skip the bridge entirely; only the mechanical catch-up happens.

### Mid-scene / combat resumes

Catching a character up mid-scene — especially mid-combat — can change initiative,
HP, and available actions underneath an active encounter. Catch-up at a scene
boundary is normal; catch-up while a scene/combat is open requires an **explicit
warning and confirmation** before proceeding (`.4.2`/`.4.3`). The warning is
informational, not a hard block: the player may still choose to proceed, cancel,
or fork instead.

## Out of scope

- Structured currency and the portable character chronicle (their own epics).
- Cross-pack character conversion.
- **Automatic** timeline merge/rejoin in any form (an explicit non-goal above).
- A custody-steal / force-resume path for the *held-elsewhere* conflict — it
  stays fail-closed; release from the other campaign is the resolution.
