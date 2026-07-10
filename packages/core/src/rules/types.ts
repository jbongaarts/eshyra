import type { PackLicense, PackLicenseClass } from '../world/types.js';

export type RulesPackRole = 'base' | 'addon';

export type RulesRecordKind =
  | 'ability'
  | 'action'
  | 'ancestry'
  | 'background'
  | 'class'
  | 'condition'
  | 'creature'
  | 'equipment'
  | 'feat'
  // `feature` is class/subclass-granted (Action Surge, Rage, ...), distinct
  // from the player-selected `feat`. See ADR 0009.
  | 'feature'
  | 'hazard'
  | 'magic-item'
  | 'rule'
  | 'spell'
  // `stat-block` is an abbreviated, canonical combat stat block defined INLINE
  // under another entry (e.g. Avatar of Death inside the Deck of Many Things
  // magic item, Giant Fly inside the Figurine of Wondrous Power). It is its own
  // addressable kind — name-resolvable like a `creature` — but its schema is
  // deliberately permissive where these abbreviated blocks diverge from a full
  // creature: derived/textual hit points and an optional challenge rating. Full
  // creatures stay on the strict `creature` kind; containers point at a
  // stat-block via `magic-item` `data.statBlockRefs`. See eshyra-4a7.4.
  | 'stat-block'
  // `subclass` (Champion, Life domain, School of Evocation, ...) is its own
  // addressable kind; it links to its parent base `class` via
  // `data.parentClass`. See ADR 0009.
  | 'subclass'
  | 'table';

export type RulesPackLicense = PackLicense;
export type RulesPackLicenseClass = PackLicenseClass;

export interface CompatibleBaseSystem {
  readonly systemId: string;
  readonly versions: readonly string[];
}

/**
 * Describes the upstream source corpus a rules pack was extracted from.
 * Importers populate this once per pack; per-record locators live on
 * `RulesRecord.provenance`. Exactly one of `sourceUrl` or `sourceIdentity`
 * must be set: `sourceUrl` for fetchable/canonical web sources,
 * `sourceIdentity` for vendored local corpora.
 */
export interface RulesPackSource {
  readonly sourceTitle: string;
  readonly sourceVersion: string;
  readonly sourceUrl?: string;
  readonly sourceIdentity?: string;
  /** SHA-256 (or equivalent) digest of the canonical source artifact. */
  readonly sourceHash?: string;
  /** ISO-8601 date the source artifact was published or snapshotted. */
  readonly sourceDate?: string;
  /**
   * Free-text policy describing how per-record `provenance` is populated for
   * this pack (e.g. "every record names the SRD page it was extracted from").
   */
  readonly recordProvenancePolicy: string;
}

/**
 * Per-record pointer back into the pack's source corpus. `sourceRef` must
 * match the owning pack's `meta.source.sourceUrl` or `meta.source.sourceIdentity`.
 * `locator` is a human-readable position in the source (page, section,
 * anchor) and is recommended but optional for sources that lack stable
 * locators.
 */
export interface RecordProvenance {
  readonly sourceRef: string;
  readonly locator?: string;
  readonly note?: string;
}

/** A precise source location that gives rise to an unresolved rules question. */
export interface RulesAmbiguitySource {
  readonly locator: string;
  readonly clauseId: string;
}

export interface RulesAmbiguityInterpretation {
  readonly id: string;
  readonly summary: string;
}

/**
 * An ambiguity in the authoritative source itself. This is immutable pack
 * semantics, not a campaign ruling: downstream runtime may resolve it only by
 * recording campaign-owned prose outside the rules pack.
 */
export interface RulesAmbiguity {
  readonly id: string;
  readonly question: string;
  readonly source: readonly RulesAmbiguitySource[];
  readonly affects: readonly string[];
  readonly interpretations: readonly RulesAmbiguityInterpretation[];
  readonly canonicalResolution: null;
  readonly runtimeDisposition: {
    readonly status: 'engine-pending';
    readonly owner: 'campaign-ruling';
  };
}

export interface RulesPackMeta {
  readonly packId: string;
  readonly title: string;
  readonly description: string;
  readonly role: RulesPackRole;
  readonly systemId: string;
  readonly version: string;
  readonly compatibleBaseSystems?: readonly CompatibleBaseSystem[];
  readonly order?: number;
  readonly dependsOn?: readonly string[];
  readonly license: RulesPackLicense;
  readonly source: RulesPackSource;
}

export interface RulesRecord {
  readonly systemId: string;
  readonly kind: RulesRecordKind;
  readonly key: string;
  /**
   * Display name. Usually the SRD heading verbatim, but importers
   * occasionally normalize or retitle a heading for disambiguation (e.g.
   * `rule:armor-guidance`) — do not assume this string is always a literal
   * quote of the source. See eshyra-o9bd.18.8.7.
   */
  readonly name: string;
  readonly data: unknown;
  /** Short human label for display (e.g. "SRD 5.1 p. 142"). Derived from `provenance`. */
  readonly source: string;
  readonly license: RulesPackLicense;
  readonly provenance: RecordProvenance;
  readonly overrides?: readonly string[];
}

export interface RulesPack {
  readonly meta: RulesPackMeta;
  readonly records: readonly RulesRecord[];
}

export class RulesPackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RulesPackError';
  }
}
