// Adventure module subsystem. An adventure module is immutable authored
// *scenario* content (scenario-scale), distinct from a campaign template /
// setting (setting-scale, the `world/` `ModulePack`), from rules packs
// (mechanical truth), and from a campaign instance (mutable play state). See
// ADR 0012 (docs/adr/0012-…) and epic eshyra-eh54.
//
// Hard rule: these records are authored *definitions* of what a scenario
// contains — possible objectives, secrets, scenes, clocks, endings. They carry
// NO play progress. Whether an objective is complete, a secret revealed, or a
// clock advanced is campaign instance state recorded by the campaign-owned
// adventure run / module binding (eshyra-eh54.4), never written back here.
//
// License and provenance metadata reuse the shared content primitives
// (`PackLicense` from `world/`, `RecordProvenance` from `rules/`) rather than
// re-declaring them; rules-system requirements reuse `ModuleRulesRequirements`.

import type { RecordProvenance } from '../rules/types.js';
import type { ModuleRulesRequirements, PackLicense } from '../world/types.js';

/** Inclusive level range a module is authored for. */
export interface LevelRange {
  readonly min: number;
  readonly max: number;
}

/** Inclusive party-size range a module assumes. */
export interface PartySizeRange {
  readonly min: number;
  readonly max: number;
}

/**
 * A campaign-template/setting this module is compatible with. `settingPackId`
 * names the setting pack; `anchorLocationId`, if present, names a location
 * inside that setting the scenario is seated at. Both are cross-pack references
 * resolved against loaded setting content by the loader (eshyra-eh54.3), not by
 * this subsystem's internal validator.
 */
export interface SettingCompatibilityRef {
  readonly settingPackId: string;
  readonly anchorLocationId?: string;
}

/** An opening hook that can pull a party into the scenario. */
export interface AdventureHook {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  /** Optional NPC that delivers the hook; resolves to a module `npcs` entry. */
  readonly originNpcId?: string;
  /** Optional location the hook originates from; resolves to a `locations` entry. */
  readonly originLocationId?: string;
}

export interface AdventureExit {
  readonly direction: string;
  readonly toLocationId: string;
  /** Optional human/condition gate on using the exit (authored, advisory). */
  readonly requirement?: string;
}

/** A keyed location in the scenario. */
export interface AdventureLocation {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly description: string;
  readonly exits: readonly AdventureExit[];
  readonly tags: readonly string[];
}

/**
 * Scene kinds are advisory categorization for the runtime/context builder, not
 * a state machine. A module supports nonlinear exploration; scenes do not
 * impose a strict order.
 */
export type SceneKind =
  | 'social'
  | 'exploration'
  | 'combat'
  | 'transition'
  | 'mixed';

/**
 * A scene wires together the locations, NPCs, objectives, encounters, and
 * secrets relevant to one beat of play. All id arrays are intra-module
 * references resolved by {@link validateAdventureModule}.
 */
export interface AdventureScene {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly kind: SceneKind;
  readonly locationIds: readonly string[];
  readonly npcIds: readonly string[];
  readonly objectiveIds: readonly string[];
  readonly encounterIds: readonly string[];
  readonly secretIds: readonly string[];
}

/** An NPC *role* within the scenario (distinct from a setting's standing NPC). */
export interface AdventureNpc {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly disposition: string;
  readonly summary: string;
  /** DM-only characterization; not narrated to the player verbatim. */
  readonly secret: string;
  /** Optional home location; resolves to a `locations` entry when present. */
  readonly locationId?: string;
}

/**
 * A creature slot in an encounter. `rulesRef` is the provider-neutral key into
 * the campaign's resolved rules stack (e.g. `creature:goblin`); it is resolved
 * against the rules pack by the loader (eshyra-eh54.3), not copied here.
 */
export interface AdventureEncounterCreature {
  readonly rulesRef: string;
  readonly count: number;
  readonly role: string;
}

export interface AdventureEncounter {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly creatures: readonly AdventureEncounterCreature[];
  /** Optional staged location; resolves to a `locations` entry when present. */
  readonly locationId?: string;
  /** Authored reward text for overcoming the encounter. */
  readonly reward: string;
}

/**
 * A treasure/reward definition. `rulesRef`, when present, references a
 * rules-pack `magic-item`/`equipment` record (resolved by the loader); plain
 * coin/value rewards may omit it.
 */
export interface AdventureTreasure {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly rulesRef?: string;
  /** Optional placement; resolves to a `locations` entry when present. */
  readonly locationId?: string;
}

/**
 * An authored secret/clue. `revealable*` lists name where the secret *can* be
 * revealed — they are authored possibilities, NOT a reveal-state flag. Whether
 * it has actually been revealed is campaign state (eshyra-eh54.4).
 */
export interface AdventureSecret {
  readonly id: string;
  readonly title: string;
  /** DM-only text describing the secret. */
  readonly dmText: string;
  readonly revealableLocationIds: readonly string[];
  readonly revealableSceneIds: readonly string[];
}

/**
 * An authored objective definition. Carries success/failure *conditions*, not
 * a completion status. Whether it is met/failed is campaign state.
 */
export interface AdventureObjective {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly optional: boolean;
  readonly successCondition: string;
  readonly failureCondition?: string;
  readonly relatedSceneIds: readonly string[];
  readonly relatedLocationIds: readonly string[];
}

/**
 * A clock or threat definition: a fixed number of `segments` and the authored
 * condition that advances it. The current fill level is campaign state, never
 * stored on the module.
 */
export interface AdventureClock {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly segments: number;
  readonly advanceWhen: string;
  readonly resultWhenFilled: string;
  /** Optional objective this clock pressures; resolves to an `objectives` entry. */
  readonly linkedObjectiveId?: string;
}

/**
 * A reference to a rules-pack random table (e.g. `table:wild-magic`). The table
 * itself lives in the rules pack; this only names it. Resolved by the loader.
 */
export interface AdventureRandomTableRef {
  readonly id: string;
  readonly title: string;
  readonly rulesRef: string;
}

/** An authored progression marker grouping objectives. */
export interface AdventureMilestone {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly objectiveIds: readonly string[];
}

export type EndingKind = 'success' | 'failure' | 'partial' | 'neutral';

/** An authored possible ending for the scenario. */
export interface AdventureEndingState {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly kind: EndingKind;
  /** Authored human/condition description of how this ending is reached. */
  readonly condition: string;
}

/**
 * Root record for an immutable authored adventure module (scenario-scale).
 *
 * Every child collection is an authored *definition*. There are no progress or
 * status fields anywhere in this shape by design: play progress is recorded in
 * the campaign-owned adventure run / module binding (eshyra-eh54.4), keeping
 * the module re-bindable and the authored intent legible against actual play
 * (ADR 0012).
 */
export interface AdventureModule {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly intendedLevels: LevelRange;
  readonly intendedPartySize: PartySizeRange;
  readonly rulesRequirements: ModuleRulesRequirements;
  readonly settingCompatibility: readonly SettingCompatibilityRef[];
  readonly startingSituation: string;
  /** Entry scene for a fresh run; resolves to a `scenes` entry. */
  readonly startingSceneId: string;
  readonly hooks: readonly AdventureHook[];
  readonly locations: readonly AdventureLocation[];
  readonly scenes: readonly AdventureScene[];
  readonly npcs: readonly AdventureNpc[];
  readonly encounters: readonly AdventureEncounter[];
  readonly treasure: readonly AdventureTreasure[];
  readonly secrets: readonly AdventureSecret[];
  readonly objectives: readonly AdventureObjective[];
  readonly clocksOrThreats: readonly AdventureClock[];
  readonly randomTables: readonly AdventureRandomTableRef[];
  readonly milestones: readonly AdventureMilestone[];
  readonly endingStates: readonly AdventureEndingState[];
  readonly provenance: RecordProvenance;
  readonly license: PackLicense;
}
