# ADR 0012: Four Content/State Layers — Rules Pack, Campaign Template, Adventure Module, Campaign Instance

Status: accepted

Date: 2026-06-20

## Context

Eshyra has working representations for mechanical rules content and for
authored world content, plus a per-campaign live store. It does **not** have a
first-class representation for a pre-written *adventure module* — an authored,
playable scenario such as a haunted mine or a keyed dungeon. Epic `eshyra-eh54`
("Add first-class adventure module support") exists to introduce that layer,
and the first task (`eshyra-eh54.1`) is to record the domain distinction
precisely enough to guide the schema, persistence, and runtime work that
follows.

This decision is needed now because the current world subsystem already
*conflates* two scopes under one record shape, and any schema work
(`eshyra-eh54.2`) that proceeds without a settled vocabulary will harden that
conflation.

### What exists today

There are three durable layers and one transient one already in the codebase.

1. **Rules pack** — mechanical truth.
   - `RulesPack` / `RulesRecord` / `RulesRecordKind`
     (`packages/core/src/rules/types.ts`), resolved into a flattened,
     name-addressable lookup by `resolveRulesStack`
     (`packages/core/src/rules/stack.ts`) and read by the DM through the
     `lookup_rules` tool (`packages/core/src/orchestrator/toolLookupRules.ts`).
   - The bundled D&D SRD 5.1 pack lives under
     `packages/core/data/rules-packs/` and is a frozen, audited importer
     artifact (ADR 0005, ADR 0007; `docs/audits/dnd5e-srd-5.1-final/`).
   - Records are addressed by `(kind, name)` / `(kind, ref)` only — there is no
     relational traversal (ADR 0009).

2. **World content** — authored content, but with an overloaded scope.
   - `ModulePack` / `ModuleMeta` / `PackType`
     (`packages/core/src/world/types.ts`). The file's own header calls a module
     pack "an immutable authored campaign template," yet `PackType` is
     `'adventure' | 'setting' | 'bestiary' | 'mixed'`. One record shape is being
     asked to be *both* a setting and an adventure.
   - The single bundled instance, `EMBERFALL_HOLLOW`
     (`packages/core/src/world/samples/emberfallHollow.ts`), is titled "The
     Hollow Beneath Emberfall" and declares `packType: 'adventure'`. It is in
     fact a short cave-delve scenario seated in the village of Emberfall — i.e.
     a *setting* (Emberfall) and a *scenario* (the hollow beneath it) collapsed
     into one pack.
   - At campaign creation the pack is forked into per-campaign SQLite
     `module_*` tables (`packages/core/src/persistence/schema.ts`,
     `forkModuleIntoCampaign`); the authored source is never written back.

3. **Campaign instance** — mutable per-campaign truth.
   - `CampaignInfo` / `createCampaign` / `getCampaign`
     (`packages/core/src/campaign/campaign.ts`), a single-campaign-per-database
     invariant, with the rules selection pinned via `CampaignRulesBinding`
     (`packages/core/src/rules/binding.ts`).
   - Live divergence from authored content is **not** written onto the
     forked `module_*` template rows. It is recorded separately as
     `overlay_facts` (keyed `world:<type>:<id>:<field>`) and the canonical
     mutable game state — `character`, `inventory`, `plot_flags`, `clock` — via
     `mutateState` (`packages/core/src/state/mutateState.ts`), then resolved at
     read time by `worldQuery` (`packages/core/src/world/worldQuery.ts`).

4. **Session/turn working memory** — transient. Sessions, turn traces, and
   generated recaps/summaries (`packages/core/src/session/`, memory
   composition). Out of scope for this ADR except to note it is *generated*, not
   authored, and is neither rules nor module source.

### The problem in one sentence

`PackType: 'adventure' | 'setting'` encodes a real distinction in a *field* of
a *single* type, which lets setting-scale and scenario-scale content share one
schema, one validation surface, and one fork path — so there is no structural
place for adventure-module concepts (hooks, scenes, secrets, objectives,
clocks/threats, ending states) to live without bolting them onto setting
content, and no structural guarantee that a broad setting like Emberfall stays
free of one-scenario responsibilities.

### Why a vocabulary decision must come before schema

`eshyra-eh54.2` will add a typed adventure-module schema. Without an agreed
distinction it is unclear whether that schema *extends* `ModulePack`, *replaces*
it, or *sits beside* it; whether Emberfall-the-setting and the hollow-delve are
one record or two; and where player divergence from an authored scenario is
allowed to land. Those are domain questions, not schema questions, and getting
them wrong is expensive to unwind once data and importers depend on the shape.

## Decision

Adopt a **four-way distinction** as the governing vocabulary for all authored
content and live state. Each layer has a distinct scope, a distinct
mutability rule, and a distinct home.

| Layer | Scope | Mutability | Home (today / target) |
|---|---|---|---|
| **Rules pack** | Mechanical truth for a game system | Immutable authored/imported source | `RulesPack` records, name-addressable lookup |
| **Campaign template** | A reusable **world/setting** (setting-scale) | Immutable authored source | World subsystem, `packType: 'setting'` content |
| **Adventure module** | An authored **playable scenario** (scenario-scale) | Immutable authored source | New first-class schema (`eshyra-eh54.2`) |
| **Campaign instance** | One user's actual play | Mutable live state | Per-campaign SQLite (`character`, `plot_flags`, `overlay_facts`, module-progress state) |

### 1. Definitions and scope

- A **rules pack** defines mechanical truth: how the game system works. Example:
  D&D SRD 5.1. It is consumed by reference, never copied into world or scenario
  content.
- A **campaign template** defines a reusable **world or setting**. It is
  **setting-scale**: the same general scope as The Grand Duchy of Karameikos,
  the Forgotten Realms, or Dragonlance. Example for Eshyra: **Emberfall** — the
  village, its region, its standing NPCs, factions, geography, and ambient lore.
- An **adventure module** defines an authored **playable scenario**. It is
  **scenario-scale**: the same general scope as Castle Amber or The Lost Mine of
  Phandelver. Example for Eshyra: a separate **Ember Hollow starter adventure** —
  the haunted cave-delve *beneath* Emberfall, with its hooks, keyed locations,
  encounters, secrets, objectives, and endings.
- A **campaign instance** defines actual play: the user's chosen rules binding,
  selected setting, bound module(s), runtime state, and history.

The load-bearing sentence:

> **Campaign templates are setting-scale; adventure modules are
> scenario-scale.** A setting is the world a campaign happens *in*; a module is
> a scenario a campaign happens *to*.

### 2. Authored source is immutable; play history is campaign state

Rules packs, campaign templates, and adventure modules are all **immutable
authored source**. None of the three is ever edited to record what happened in
play. This preserves the existing fork-and-overlay invariant the world
subsystem already relies on (`packages/core/src/world/types.ts` header), and
extends it to modules.

**Module progress is mutable campaign state, not module source.** Whether the
players found the sealed shrine, destroyed the old mill, bypassed an encounter,
completed an objective, revealed a secret, or advanced a threat clock is
recorded in the campaign instance — as discovered facts, altered facts,
completed objectives, revealed secrets, encounter outcomes, and clock state —
exactly as live world divergence is recorded today via `overlay_facts` and
`mutateState`. The concrete persistence shape for module progress is deferred to
`eshyra-eh54.4`; this ADR fixes only that it lands in campaign state, never on
the authored module.

### 3. Player divergence is recorded, never applied to source

When players act in ways the module did not anticipate, the divergence is
recorded as **campaign facts or explicit module deviations** in the campaign
instance. It is **never** applied as an edit to the source module. If the module
says "a sealed shrine lies under the old mill" and the players collapse the mill,
the module still says what it said; the campaign records that the mill is
collapsed and the shrine is now buried. This is the same discipline as the
current `overlay_facts` resolution in `worldQuery`, generalized to authored
scenario content.

This keeps modules **re-forkable** (a fresh campaign from the same module starts
clean) and keeps authored intent legible against actual play.

### 4. Relationship to the existing `world/ModulePack`

This ADR does **not** rename or delete `ModulePack` and does not itself change
any code. It establishes the target distinction the schema work will realize:

- The existing world subsystem is the home of **campaign-template (setting)**
  content. `packType: 'setting'` and `'bestiary'` content already fit there.
- **Adventure modules become a first-class concept** with their own schema
  (`eshyra-eh54.2`), richer than `ModulePack` (hooks, scenes, secrets,
  objectives, clocks/threats, ending states, milestones, provenance/license),
  rather than a `PackType` value on the setting shape.
- `EMBERFALL_HOLLOW` is the worked example of today's conflation. The target
  end-state (delivered across `eshyra-eh54.7` and its children, not here) is
  **Emberfall the setting** as a campaign template and a **separate Ember Hollow
  starter adventure** as the hello-world module. Until that split lands,
  `EMBERFALL_HOLLOW` keeps working unchanged; this ADR does not strand it.
- Whether `'adventure'` is eventually removed from `PackType`, and how the fork
  path and `worldQuery` extend to module progress, are sequencing decisions for
  `eshyra-eh54.2`/`.4`/`.5`. This ADR constrains only the vocabulary and the
  mutability/scope rules they must honor.

### 5. Examples (setting-scale vs module-scale)

To make the boundary checkable during schema and content work:

**Setting-scale (campaign template) content:**
- The region and its geography (Emberfall village, the surrounding vale, roads).
- Standing institutions and factions (the village council, a temple, a thieves'
  ring) that persist across many scenarios.
- Recurring NPCs defined by their place in the world, not by one scenario's plot.
- Ambient lore, history, and cosmology that outlive any single adventure.

**Scenario-scale (adventure module) content:**
- A specific playable problem with a beginning and possible endings (goblins
  have crept back into the hollow under the old watchtower).
- Hooks that pull the party in, keyed locations for *this* scenario, encounters,
  secrets, objectives, treasure, and threat clocks.
- NPC *roles within the scenario* (the captured scout, the cult leader),
  distinct from a recurring setting NPC.
- Defined ending states for the scenario.

A useful test: setting content answers "what is this world like, independent of
any quest?"; module content answers "what is the quest, and how can it end?" The
same NPC may appear in both — as a standing figure in the setting and in a
scenario-specific role in a module — and that is fine, because the module
references rather than copies.

## Consequences

- The epic's downstream beads inherit a fixed vocabulary. `eshyra-eh54.2`
  designs the adventure-module schema as a *new first-class* shape, not a
  `PackType` extension; `eshyra-eh54.4` puts module progress in campaign state;
  `eshyra-eh54.5` feeds bounded module context to the DM runtime; `eshyra-eh54.7`
  splits Emberfall-setting from the Ember Hollow starter module.
- The mutability and divergence rules are now stated obligations, not
  conventions: any module-progress design that mutates authored source, or any
  divergence design that edits module source instead of recording campaign
  facts, violates this ADR.
- `EMBERFALL_HOLLOW` is explicitly named as the example of the current
  conflation, giving the eventual split a documented rationale rather than an
  unexplained refactor.
- The four-way distinction is documentation, additive and non-breaking. No code,
  schema, export surface (`packages/core/src/index.ts`), or persisted data
  changes as a result of this ADR. The frozen starter-content sourcing work
  (`eshyra-eh54.8`, and the third-party-conversion gate noted in
  `eshyra-eh54`/ADR 0007) can remain blocked until the module destination
  actually exists.

## Rejected Alternatives

- **Keep `PackType: 'adventure' | 'setting'` and treat the distinction as a
  field, not a layer.** Rejected: it shares one schema, one validator, and one
  fork path between setting-scale and scenario-scale content, leaving no
  structural home for adventure-module concepts and no guarantee a setting stays
  free of one-scenario responsibilities. The whole point of the epic is that the
  field-level distinction has already proven insufficient.
- **Make adventure modules a new `RulesRecordKind`.** Rejected: rules records
  are name-addressed mechanical truth resolved through `lookup_rules` (ADR 0009);
  an adventure is authored narrative/structure that *references* rules, not a
  unit of mechanical truth. Modeling it as a rules kind would conflate the very
  layers this ADR separates.
- **Define only "module vs not-module" and leave setting/scenario informal.**
  Rejected: the conflation this ADR exists to fix is precisely setting-scale vs
  scenario-scale. Leaving it informal would let `eshyra-eh54.2` re-encode the
  ambiguity in the new schema.
- **Rename/replace `ModulePack` now as part of this ADR.** Rejected: this task
  is design/documentation (`eshyra-eh54.1`); doing the code split here would
  pre-empt the schema and sequencing decisions owned by `eshyra-eh54.2`/`.7` and
  risk stranding the working `EMBERFALL_HOLLOW` demo. The ADR sets direction; the
  schema beads execute it.
- **Apply player divergence by editing forked module content.** Rejected: it
  destroys re-forkability and erases authored intent, and it contradicts the
  existing `overlay_facts`/`worldQuery` design the world subsystem already
  depends on.
