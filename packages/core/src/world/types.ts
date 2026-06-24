// E2 World subsystem. A module pack is an immutable authored campaign template.
// Campaign creation forks the template into a per-campaign SQLite DB; the
// authored files are never written back, so a campaign can be re-forked. Live
// divergence from the template is recorded as overlay facts (E3
// `overlay_facts`) and resolved at read time by `worldQuery`.

/** License class governing how a pack may be shipped, hosted, and shared. */
export type PackLicenseClass =
  | 'open'
  | 'public-domain'
  | 'original'
  | 'publisher-licensed'
  | 'user-private';

export type PackType = 'adventure' | 'setting' | 'bestiary' | 'mixed';

/**
 * License and allowed-use metadata. Attribution alone is not a permission
 * model: shipping/hosting/sharing is decided from the explicit policy flags,
 * not from `attributionText`. Mirrors the policy field set in
 * `docs/architecture-report.md`.
 */
export interface PackLicense {
  readonly licenseClass: PackLicenseClass;
  readonly licenseName: string;
  readonly attributionText: string;
  readonly requiresAttribution: boolean;
  readonly commercialUseAllowed: boolean;
  readonly hostedUseAllowed: boolean;
  readonly redistributionAllowed: boolean;
  readonly publicSharingAllowed: boolean;
  readonly derivativeAllowed: boolean;
  readonly containsUserSuppliedText: boolean;
  readonly containsTrademarkedSettingMaterial: boolean;
  readonly sourceMaterialDescription: string;
  readonly provenancePolicy: string;
  readonly outputRestrictions: string;
}

/**
 * Rules-system requirements a module declares against a campaign's rules
 * binding. `baseSystemId` must match the campaign's base rules system;
 * `baseVersions`, if present, constrains acceptable base versions; required
 * add-on pack ids must be present in the campaign binding's add-on stack.
 */
export interface ModuleRulesRequirements {
  readonly baseSystemId: string;
  readonly baseVersions?: readonly string[];
  readonly requiredAddonPackIds?: readonly string[];
  readonly optionalAddonPackIds?: readonly string[];
}

export interface ModuleMeta {
  readonly packId: string;
  readonly title: string;
  readonly packType: PackType;
  readonly description: string;
  /** Location id the player starts in; must resolve to a `locations[]` entry. */
  readonly startingLocationId: string;
  readonly license: PackLicense;
  readonly rulesRequirements: ModuleRulesRequirements;
}

export interface LocationExit {
  readonly direction: string;
  readonly toLocationId: string;
}

export interface Location {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly description: string;
  readonly exits: readonly LocationExit[];
  readonly encounterIds: readonly string[];
  readonly npcIds: readonly string[];
  readonly tags: readonly string[];
}

/**
 * A creature slot in an encounter. `rulesRef` is the provider-neutral key
 * into the campaign's resolved rules stack (e.g. `creature:goblin`) and
 * replaces the historical D&D-only `srdRef` field.
 */
export interface EncounterCreature {
  readonly rulesRef: string;
  readonly count: number;
  readonly role: string;
}

export interface Encounter {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly locationId: string;
  readonly creatures: readonly EncounterCreature[];
  readonly reward: string;
}

export interface Npc {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly locationId: string;
  readonly disposition: string;
  readonly summary: string;
  /** DM-only information; not narrated to the player verbatim. */
  readonly secret: string;
}

/** A plot-advancement trigger. `when` is a human/condition description the
 * orchestrator evaluates; effects are advisory plot beats, not state writes. */
export interface Trigger {
  readonly id: string;
  readonly when: string;
  readonly effect: string;
  readonly once: boolean;
}

export type LoreScope = 'public' | 'dm';

export interface Lore {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly scope: LoreScope;
}

export interface ModulePack {
  readonly meta: ModuleMeta;
  readonly locations: readonly Location[];
  readonly encounters: readonly Encounter[];
  readonly npcs: readonly Npc[];
  readonly triggers: readonly Trigger[];
  readonly lore: readonly Lore[];
}

/** Resolvable world target kinds for `worldQuery`. */
export type WorldTargetType =
  | 'location'
  | 'encounter'
  | 'npc'
  | 'lore'
  | 'meta'
  | 'overlay_lore'
  | 'search';

export type ModuleWorldTargetType = Exclude<
  WorldTargetType,
  'overlay_lore' | 'search'
>;

/**
 * Whether a resolved world entity is safe for player-facing surfaces.
 * - `public`: all fields are safe for players.
 * - `dm`: the entire entity is DM-only (e.g. lore with `scope: 'dm'`).
 * - `mixed`: some fields are DM-only; see `dmOnlyFields` for which ones.
 */
export type WorldEntityVisibility = 'public' | 'dm' | 'mixed';

export interface WorldQueryTarget {
  readonly type: WorldTargetType;
  /** Required for every type except `meta` (the singleton pack metadata). */
  readonly id?: string;
  /** Compact discovery terms for `search` or overlay lore filtering. */
  readonly query?: string;
  readonly locationId?: string;
  readonly npcId?: string;
  readonly subject?: string;
  readonly kind?: string;
  readonly tags?: readonly string[];
  readonly includeInvalidated?: boolean;
  readonly limit?: number;
}

/** One overlay field that diverged the template for a target. */
export interface WorldOverlay {
  readonly field: string;
  readonly value: unknown;
  readonly provenance: string;
  readonly sessionId: string;
  readonly updatedAt: string;
}

export interface WorldCanonEvidence {
  readonly tier:
    | 'module_canon'
    | 'campaign_state'
    | 'campaign_overlay_lore'
    | 'scene_fact'
    | 'decorative_color'
    | 'rumor_belief'
    | 'tool_result';
  readonly source: string;
  readonly id?: string;
  readonly truthStatus?: string;
  readonly visibility?: 'player_visible' | 'dm_only' | 'mixed';
  readonly summary: string;
}

export interface WorldSearchResult {
  readonly tier: WorldCanonEvidence['tier'];
  readonly type: WorldTargetType;
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  readonly truthStatus?: string;
  readonly visibility?: 'player_visible' | 'dm_only' | 'mixed';
}

export type WorldQueryResult =
  | {
      readonly ok: true;
      readonly type: ModuleWorldTargetType;
      readonly id?: string;
      /** Template values with latest-wins overlay fields applied. */
      readonly resolved: Record<string, unknown>;
      readonly template: Record<string, unknown>;
      readonly overlays: readonly WorldOverlay[];
      readonly overlayLore: readonly WorldCanonEvidence[];
      readonly evidence: readonly WorldCanonEvidence[];
      readonly visibility: WorldEntityVisibility;
      /** Field names within `resolved` that are DM-only. Empty for fully public or fully DM-only entities. */
      readonly dmOnlyFields: readonly string[];
    }
  | {
      readonly ok: true;
      readonly type: 'overlay_lore';
      readonly id?: string;
      readonly records: readonly WorldCanonEvidence[];
      readonly evidence: readonly WorldCanonEvidence[];
    }
  | {
      readonly ok: true;
      readonly type: 'search';
      readonly query?: string;
      readonly results: readonly WorldSearchResult[];
      readonly evidence: readonly WorldCanonEvidence[];
    }
  | {
      readonly ok: false;
      readonly code: 'not_found';
      readonly message: string;
    };
