/**
 * Shared vocabulary for playable choice modeling on feature records
 * (eshyra-o9bd.9).
 *
 * A class- or subclass-granted feature gained at character creation or level-up
 * may require the player to make a build choice — pick a subclass, a Fighting
 * Style, Metamagic options, a favored enemy, an ability-score-improvement-vs-feat,
 * and so on. The frozen pack carried these as PROSE only (the feature
 * `description`), which a creation/level-up engine cannot apply without guessing.
 *
 * This module is the single source of truth for the structured shape those
 * choices take and the closed category vocabulary. Both the schema validator
 * (`kindSchemas.validateDnd5eFeature`) and the `choice-coverage` audit gate
 * (`srdPlayabilityAudit`) import from here so the generated pack and the gate
 * cannot drift.
 *
 * A `choices[]` entry is EITHER:
 *   - a STRUCTURED choice — a `choose` count plus an optional `from` (a discrete
 *     option list, structured filter, or a free-text restriction), with an
 *     optional inline `options[]` catalog for source-backed named menus; or
 *   - a named OUT-OF-SCOPE marker — `unsupported.reason`, used when a choice is
 *     intentionally not modeled yet so the gap is explicit, never silent.
 *
 * Exactly one of those two shapes is present per entry (enforced by the schema).
 */

/** The closed set of player-choice categories the pack models on features. */
export const FEATURE_CHOICE_CATEGORIES = [
  'subclass',
  'cantrip',
  'spell',
  'asiOrFeat',
  'fightingStyle',
  'metamagic',
  'invocation',
  'favoredEnemy',
  'naturalExplorer',
  'language',
  'skill',
  'expertise',
  'channelDivinity',
  'other',
] as const;

export type FeatureChoiceCategory = (typeof FEATURE_CHOICE_CATEGORIES)[number];

/** A named out-of-scope marker: the choice exists but is not modeled yet. */
export interface FeatureChoiceUnsupported {
  /** Why the choice is out of scope (names the missing model/data). */
  readonly reason: string;
}

/**
 * A proficiency grant (eshyra-olc5.7.1). `grant` is the verbatim SRD phrase;
 * the typed fields are present only when the whole phrase parses into the
 * closed vocabulary (lowercase ability names, canonical SRD skill names,
 * armor categories). `scope: 'all-saving-throws'` marks Diamond Soul.
 */
export interface ProficiencyGrantEffect {
  readonly kind: 'proficiency';
  readonly grant: string;
  readonly scope?: 'all-saving-throws';
  readonly savingThrows?: readonly string[];
  readonly skills?: readonly string[];
  readonly armor?: readonly string[];
}

/** One source-backed option in an inline feature option catalog. */
export interface FeatureChoiceOption {
  /** Stable option id, suitable for persistence as the selected value. */
  readonly id: string;
  /** SRD option label, e.g. "Archery" or "Pact of the Chain". */
  readonly name: string;
  /** Verbatim SRD prose for the option body. */
  readonly text: string;
  /** Verbatim SRD prerequisite text, when the option prints one. */
  readonly prerequisite?: string;
  /** Structured prerequisite clauses parsed from the prerequisite prose. */
  readonly prerequisites?: readonly (
    | {
        readonly kind: 'level';
        readonly classRef: string;
        readonly level: number;
      }
    | {
        readonly kind: 'pactBoon';
        /** The `feature:` record whose choice offers the required option. */
        readonly featureRef: string;
        /** The required option's inline id within that feature's choices. */
        readonly ref: string;
      }
    | { readonly kind: 'cantrip'; readonly ref: string }
  )[];
  /**
   * Extra creation forms this option grants a summoning spell it is held
   * alongside (eshyra-olv1), e.g. Pact of the Chain's special familiar forms
   * for `spell:find-familiar`. Curated and source-guarded by the importer.
   */
  readonly summonFormExtensions?: readonly {
    readonly spell: string;
    readonly forms: readonly {
      readonly name: string;
      readonly creatureRef: string;
    }[];
  }[];
  /**
   * Typed mechanics this option's own text grants: proficiency effects
   * (eshyra-olc5.7.1; consumed by character/proficiencyGrants.ts) and/or
   * spell grants moved off the parent feature (eshyra-o9bd.19.3.1, e.g. Pact
   * of the Chain's find familiar). Either field may be absent; the kind schema
   * validates which shapes appear.
   */
  readonly mechanics?: {
    readonly effects?: readonly ProficiencyGrantEffect[];
    readonly spellGrants?: readonly { readonly spell: string }[];
  };
  /** Human-readable source label for this option's source text. */
  readonly source: string;
}

/** A single structured player choice carried on a feature record. */
export interface FeatureChoice {
  /** Stable, kebab-case id unique within the feature (e.g. "fighting-style"). */
  readonly id: string;
  readonly category: FeatureChoiceCategory;
  /** Player-facing prompt (verbatim or lightly derived from the SRD text). */
  readonly prompt: string;
  /** Character level at which the choice is made (mirrors the feature level). */
  readonly level: number;
  /** How many options to pick. Present iff this is a structured choice. */
  readonly choose?: number;
  /** Legal option ids / labels, a structured filter, or a free-text restriction. */
  readonly from?: readonly string[] | Record<string, unknown> | string;
  /** Inline source-backed option catalog, when the parent feature owns one. */
  readonly options?: readonly FeatureChoiceOption[];
  /** Present iff the choice is intentionally out of scope; names why. */
  readonly unsupported?: FeatureChoiceUnsupported;
  /**
   * The choice applies only when `optionId` of the SIBLING choice `choiceId`
   * (same feature) is picked in the same acquisition (eshyra-mdke), e.g.
   * Favored Enemy's "two races of humanoid" alternative. Otherwise the choice
   * is not offered and does not block.
   */
  readonly requiresOption?: FeatureChoiceRequiresOption;
  /** True when an empty selection is allowed (the choice may be skipped). */
  readonly optional?: true;
}

/** Trigger of a conditional feature choice: a sibling choice's option id. */
export interface FeatureChoiceRequiresOption {
  readonly choiceId: string;
  readonly optionId: string;
}

const CATEGORY_SET: ReadonlySet<string> = new Set(FEATURE_CHOICE_CATEGORIES);

/** Narrowing guard for the closed category vocabulary. */
export function isFeatureChoiceCategory(
  value: string,
): value is FeatureChoiceCategory {
  return CATEGORY_SET.has(value);
}
