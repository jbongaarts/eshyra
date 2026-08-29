/**
 * Stateful character-creation draft + pure engine (eshyra-b69j.5).
 *
 * The legacy `validateCharacterDraft` path in `creation.ts` validates a fully
 * specified draft in one shot and throws on the first batch of errors — it
 * cannot represent a half-built character, preserve prior answers across edits,
 * or tell the user *why* a derived value is not ready. This module is the
 * incremental replacement the guided wizard needs (the core failure modes from
 * eshyra-4jiu):
 *
 *   - a serializable {@link CharacterDraft} that holds partial answers;
 *   - a pure {@link CharacterCreationEngine} (no terminal I/O, no DB) whose
 *     setters return a new draft with derived values, diagnostics, and the set
 *     of stale dependent choices recomputed every time;
 *   - incremental, dependency-aware validation that waits for prerequisites
 *     instead of emitting cascade nonsense (no "HP must be -4" before a class
 *     and Constitution exist).
 *
 * Scope: this slice owns the engine and its validation/derived seams. Ancestry
 * ability bonuses (eshyra-b69j.12), the full derived-value set (eshyra-b69j.6),
 * equipment/skill choices (eshyra-b69j.13), and the wizard flows
 * (eshyra-b69j.8/.9) build on top of it. The engine is D&D-specific for now,
 * per the epic's "minimal envelope + D&D-typed selections" guidance; the recipe
 * boundary (eshyra-b69j.4) keeps a second system possible later.
 */

import { DEFAULT_DND5E_SRD_BINDING } from '../rules/binding.js';
import {
  ABILITY_SCORE_NAMES,
  FREE_ENTRY_MAX_SCORE,
  FREE_ENTRY_MIN_SCORE,
  isPlausibleFreeEntryScore,
  POINT_BUY_BUDGET,
  pointBuyCost,
  STANDARD_ARRAY,
} from './abilities.js';
import {
  normalizeRolledAbilityScoreSet,
  type RolledAbilityScore,
  summarizePoolAssignment,
} from './abilityAllocation.js';
import { assertSupportedCharacterBuild } from './characterBuild.js';
import type {
  AbilityScoreMethod,
  AbilityScoreName,
  AbilityScores,
  CharacterCreationDraft,
} from './creation.js';
import {
  type CharacterDerivedValues,
  deriveLevel1Values,
  LEVEL_1_PROFICIENCY_BONUS,
} from './derivedValues.js';
import {
  normalizeProficiency,
  proficiencyReplacementId,
} from './proficiency.js';
import {
  enumerateLevel1RequiredChoices,
  type Level1RequiredChoice,
  type Level1RequiredChoiceKind,
} from './requiredChoices.js';
import {
  getBundledDnd5eCharacterResolver,
  type ResolvedAncestryData,
  type ResolvedBackgroundData,
  type ResolvedClassData,
  type RulesPackCharacterResolver,
  STARTING_WEALTH_UNAVAILABLE_MESSAGE,
} from './rulesPackResolver.js';
import { SRD_5_1_SKILLS } from './srdCreationChoices.js';
import {
  type StartingWealthResult,
  validateStartingWealthResult,
} from './srdStartingWealth.js';

export type StartingEquipmentMode = 'packages' | 'starting-wealth';

export function parseStartingEquipmentMode(
  value: unknown,
): StartingEquipmentMode | undefined {
  return value === 'packages' || value === 'starting-wealth'
    ? value
    : undefined;
}

export type { StartingWealthResult } from './srdStartingWealth.js';

/** Source-bounded selections for the SRD custom-background optional rule. */
export interface BackgroundCustomization {
  readonly name: string;
  readonly skillProficiencies: readonly string[];
  readonly toolProficiencies: readonly string[];
  readonly languages: readonly string[];
  /** Canonical inline feature ref (or its exact source name while editing). */
  readonly feature: string;
}

/** Severity of an incremental draft diagnostic. */
export type DraftDiagnosticSeverity = 'error' | 'warning' | 'pending';

/**
 * One incremental diagnostic. `pending` means a check is blocked on a missing
 * prerequisite (named in {@link dependsOn}) — it is informational, not a user
 * error, and never blocks finalization the way an `error` does.
 */
export interface CharacterCreationDiagnostic {
  /** Stable field id (e.g. `class`, `abilityScores.constitution`, `spells`). */
  readonly field: string;
  readonly severity: DraftDiagnosticSeverity;
  readonly message: string;
  /** The current offending value, when one applies. */
  readonly value?: unknown;
  /** Prerequisite fields this check is waiting on (for `pending`). */
  readonly dependsOn?: readonly string[];
}

/** A required choice that is not yet satisfied. */
export interface RequiredChoice {
  readonly field: string;
  readonly label: string;
}

/**
 * Derived values for a (possibly partial) draft. Computed by the shared
 * deterministic derivation in `derivedValues.ts` (eshyra-b69j.6).
 */
export type CharacterDraftDerived = CharacterDerivedValues;

/** Identity fields, all optional while the draft is in progress. */
export interface CharacterDraftIdentity {
  readonly name?: string;
  readonly concept?: string;
  readonly description?: string;
  readonly pronouns?: string;
}

/**
 * D&D-typed selections. Values are stored as the user entered them (display
 * name or canonical ref); resolution happens during recompute so prior answers
 * are never silently rewritten.
 */
export interface Dnd5eDraftSelections {
  readonly className?: string;
  readonly ancestry?: string;
  readonly background?: string;
  readonly backgroundCustomization?: BackgroundCustomization;
  readonly abilityScoreMethod?: AbilityScoreMethod;
  readonly baseAbilityScores?: Partial<Record<AbilityScoreName, number>>;
  /** Immutable canonical F1 evidence for the rolled score pool. */
  readonly rolledAbilityScores?: readonly RolledAbilityScore[];
  readonly spells?: readonly string[];
  /**
   * Selected options for the structured level-1 mechanical choices (skills,
   * tools, equipment, languages), keyed by the choice id from
   * {@link enumerateLevel1RequiredChoices} (e.g. `class.skills`,
   * `class.equipment.0`, `ancestry.languages`). Collected by the
   * equipment/proficiency flow (eshyra-b69j.13).
   */
  readonly choices?: Readonly<Record<string, readonly string[]>>;
  readonly startingEquipmentMode?: StartingEquipmentMode;
  readonly startingWealth?: StartingWealthResult;
}

/**
 * Serializable work-in-progress character. Distinct from the legacy
 * fully-specified `CharacterCreationDraft` (the finalization input): this holds
 * partial answers plus recomputed derived/diagnostics/stale state.
 */
export interface CharacterDraft {
  readonly id: string;
  readonly rulesPackId: string;
  readonly recipeId: string;
  readonly creationMode: string;
  readonly level: number;
  readonly identity: CharacterDraftIdentity;
  readonly selections: Dnd5eDraftSelections;
  readonly derived: CharacterDraftDerived;
  /** Selection fields whose current value is invalid under live prerequisites. */
  readonly stale: readonly string[];
  readonly diagnostics: readonly CharacterCreationDiagnostic[];
}

/** Input to {@link CharacterCreationEngine.createDraft}. */
export interface CreateDraftInput {
  readonly id: string;
  readonly mode: string;
  readonly level?: number;
  readonly rulesPackId?: string;
  readonly recipeId?: string;
  readonly identity?: CharacterDraftIdentity;
  readonly selections?: Dnd5eDraftSelections;
}

/** Result of projecting a draft into a finalizable legacy draft. */
export type FinalizableDraftResult =
  | { readonly ok: true; readonly draft: CharacterCreationDraft }
  | {
      readonly ok: false;
      readonly missing: readonly RequiredChoice[];
      readonly errors: readonly CharacterCreationDiagnostic[];
    };

/**
 * A structured level-1 mechanical choice plus the draft's current answer to it.
 * `selected` is the stored option set; `satisfied` is true once the selection
 * matches the choice's required count and every value is a valid option.
 */
export interface MechanicalChoiceState {
  readonly choice: Level1RequiredChoice;
  readonly selected: readonly string[];
  readonly satisfied: boolean;
}

/**
 * The required-choice kinds the equipment/proficiency flow (eshyra-b69j.13)
 * collects and gates on. Spellcasting choices (cantrips/spells/ability) are
 * handled on their own draft fields and step, and `ability_increase` flows
 * through the ability-score path, so they are intentionally excluded here.
 */
const MECHANICAL_CHOICE_KINDS: ReadonlySet<Level1RequiredChoiceKind> = new Set([
  'skills',
  'tools',
  'equipment',
  'languages',
]);

/**
 * Pure character-creation domain layer. Every setter returns a new, fully
 * recomputed draft; nothing here touches the terminal or the database.
 */
export interface CharacterCreationEngine {
  createDraft(input: CreateDraftInput): CharacterDraft;
  /** Rehydrate persisted state against the active resolver and engine rules. */
  recomputeDraft(draft: CharacterDraft): CharacterDraft;
  setIdentity(
    draft: CharacterDraft,
    patch: Partial<CharacterDraftIdentity>,
  ): CharacterDraft;
  setClass(draft: CharacterDraft, value: string | undefined): CharacterDraft;
  setAncestry(draft: CharacterDraft, value: string | undefined): CharacterDraft;
  setBackground(
    draft: CharacterDraft,
    value: string | undefined,
  ): CharacterDraft;
  setBackgroundCustomization(
    draft: CharacterDraft,
    value: BackgroundCustomization | undefined,
  ): CharacterDraft;
  setAbilityScoreMethod(
    draft: CharacterDraft,
    method: AbilityScoreMethod | undefined,
  ): CharacterDraft;
  setAbilityScore(
    draft: CharacterDraft,
    ability: AbilityScoreName,
    value: number | undefined,
  ): CharacterDraft;
  setAbilityScores(
    draft: CharacterDraft,
    scores: Partial<Record<AbilityScoreName, number>>,
  ): CharacterDraft;
  setRolledAbilityScores(
    draft: CharacterDraft,
    rolls: readonly RolledAbilityScore[] | undefined,
  ): CharacterDraft;
  setSpells(
    draft: CharacterDraft,
    spells: readonly string[] | undefined,
  ): CharacterDraft;
  /**
   * Set (or clear, with `undefined`) the selected options for a structured
   * mechanical choice by its id (e.g. `class.skills`, `class.equipment.0`).
   * Pure storage — membership/count are reported by {@link mechanicalChoices}.
   */
  setChoice(
    draft: CharacterDraft,
    choiceId: string,
    values: readonly string[] | undefined,
  ): CharacterDraft;
  setStartingEquipmentMode(
    draft: CharacterDraft,
    mode: StartingEquipmentMode,
  ): CharacterDraft;
  setStartingWealth(
    draft: CharacterDraft,
    result: StartingWealthResult | undefined,
  ): CharacterDraft;
  /**
   * The structured level-1 mechanical choices (skills, tools, equipment,
   * languages) implied by the chosen class/ancestry/background, each with its
   * current selection and whether it is satisfied. Empty until a class resolves.
   */
  mechanicalChoices(draft: CharacterDraft): readonly MechanicalChoiceState[];
  /** Recompute and return the draft's diagnostics. */
  validate(draft: CharacterDraft): readonly CharacterCreationDiagnostic[];
  /** Recompute and return the draft's derived values. */
  computeDerived(draft: CharacterDraft): CharacterDraftDerived;
  /** Required choices not yet satisfied. */
  missingRequiredChoices(draft: CharacterDraft): readonly RequiredChoice[];
  /** True when the draft has no errors and no missing required choices. */
  isFinalizable(draft: CharacterDraft): boolean;
  /** Project a finalizable draft into the legacy finalization input. */
  toFinalizableDraft(draft: CharacterDraft): FinalizableDraftResult;
}

const DEFAULT_LEVEL = 1;

/**
 * The highest spell level a level-1 character can choose: cantrips (level 0) and
 * 1st-level spells. Guided creation is level-1 only (see {@link DEFAULT_LEVEL}
 * and `deriveLevel1Values`), so a chosen spell above this is never legal,
 * independent of class.
 */
const LEVEL_1_MAX_SPELL_LEVEL = 1;

/**
 * Whether a single base score is valid under the active method: an integer, and
 * within the method's per-score bounds (point-buy 8–15, manual/rolled the
 * plausibility range; standard-array values are enforced as a set, not here).
 */
function isValidBaseScore(
  value: number,
  method: AbilityScoreMethod | undefined,
): boolean {
  if (!Number.isInteger(value)) {
    return false;
  }
  if (method === 'point_buy') {
    return pointBuyCost(value) !== undefined;
  }
  if (method === 'manual' || method === 'rolled') {
    return isPlausibleFreeEntryScore(value);
  }
  return true;
}

/**
 * The ancestry ability-score increases to feed derived-value computation for a
 * resolved ancestry: the fixed bonuses from generated pack metadata. The
 * Half-Elf's "two of your choice +1" increases are a player choice the wizard
 * collects; once threaded into selections they are appended here. Returns an
 * empty list for an unmodeled ancestry, so derived scores fall back to the base
 * scores rather than erroring.
 */
function ancestryAbilityScoreIncreases(
  ancestry: ResolvedAncestryData | undefined,
): NonNullable<
  Parameters<typeof deriveLevel1Values>[0]['abilityScoreIncreases']
> {
  return ancestry?.abilityScoreIncreases?.flatMap((entry) => entry.fixed) ?? [];
}

/** Apply a validated custom-background selection to its canonical source. */
export function effectiveBackground(
  selections: Dnd5eDraftSelections,
  resolver: RulesPackCharacterResolver,
): ResolvedBackgroundData | undefined {
  if (selections.background === undefined) return undefined;
  const result = resolver.resolveBackground(selections.background);
  if (!result.ok) return undefined;
  const custom = selections.backgroundCustomization;
  if (custom === undefined) return result.record;
  const feature = result.record.feature;
  return {
    ...result.record,
    name: custom.name.trim(),
    skillProficiencies: [...custom.skillProficiencies],
    toolProficiencies: [...custom.toolProficiencies],
    languages: [
      {
        fixed: [...custom.languages],
        sourceText: 'Custom background language selections',
      },
    ],
    ...(feature === undefined ? {} : { feature }),
  };
}

function validateBackgroundCustomization(
  selections: Dnd5eDraftSelections,
  background: ResolvedBackgroundData | undefined,
  resolver: RulesPackCharacterResolver,
  diagnostics: CharacterCreationDiagnostic[],
): void {
  const custom = selections.backgroundCustomization;
  if (custom === undefined) return;
  const fail = (message: string, value?: unknown) =>
    diagnostics.push({
      field: 'backgroundCustomization',
      severity: 'error',
      message,
      ...(value === undefined ? {} : { value }),
    });
  if (background === undefined) {
    fail('custom background requires a canonical source background');
    return;
  }
  if (custom.name.trim().length === 0)
    fail('custom background name is required');
  const skills = new Set(custom.skillProficiencies);
  if (
    custom.skillProficiencies.length !== 2 ||
    skills.size !== 2 ||
    [...skills].some((skill) => !SRD_5_1_SKILLS.includes(skill))
  ) {
    fail('custom background must choose exactly two distinct SRD skills');
  }
  const tools = new Set(custom.toolProficiencies);
  const languages = new Set(custom.languages);
  const languageDomain = new Set(
    Array.isArray(background.languages)
      ? background.languages.flatMap((grant) => [
          ...grant.fixed,
          ...(grant.from ?? []),
        ])
      : [],
  );
  if (
    tools.size !== custom.toolProficiencies.length ||
    [...tools].some((tool) => !resolver.listToolProficiencies().includes(tool))
  ) {
    fail('custom background contains an unknown or duplicate tool proficiency');
  }
  if (
    languages.size !== custom.languages.length ||
    [...languages].some((language) => !languageDomain.has(language))
  ) {
    fail('custom background contains an unknown or duplicate source language');
  }
  if (custom.toolProficiencies.length + custom.languages.length !== 2) {
    fail('custom background must choose exactly two total tools and languages');
  }
  const feature = background.feature;
  if (
    feature === undefined ||
    (custom.feature !== feature.key && custom.feature !== feature.name)
  ) {
    fail(
      'custom background feature must be a structured feature from its source background',
    );
  }
}

function castsAtLevel1(classRecord: ResolvedClassData | undefined): boolean {
  const spellcasting = classRecord?.level1?.spellcasting;
  if (spellcasting === undefined) {
    return false;
  }
  return (
    spellcasting.cantripsKnown !== undefined ||
    spellcasting.spellsKnown !== undefined ||
    spellcasting.slots !== undefined ||
    spellcasting.pactSlots !== undefined
  );
}

function level1SpellcastingAbility(classRecord: ResolvedClassData | undefined) {
  return castsAtLevel1(classRecord)
    ? classRecord?.spellcastingAbility
    : undefined;
}

const REQUIRED_CHOICE_LABELS: Readonly<Record<string, string>> = {
  name: 'Character name',
  class: 'Class',
  ancestry: 'Ancestry',
  abilityScoreMethod: 'Ability score method',
  abilityScores: 'Ability scores',
};

/**
 * Build a character-creation engine over a rules-pack resolver. Defaults to the
 * bundled D&D 5e SRD resolver; tests can inject an explicit resolver.
 */
export function createCharacterCreationEngine(
  resolver: RulesPackCharacterResolver = getBundledDnd5eCharacterResolver(),
): CharacterCreationEngine {
  function recompute(draft: CharacterDraft): CharacterDraft {
    assertSupportedCharacterBuild(draft, {
      operation: 'character-creation draft validation',
      resolver,
    });
    const diagnostics: CharacterCreationDiagnostic[] = [];
    const stale: string[] = [];
    const rawMode = (draft.selections as Record<string, unknown>)
      .startingEquipmentMode;
    const parsedMode =
      rawMode === undefined ? 'packages' : parseStartingEquipmentMode(rawMode);
    if (parsedMode === undefined) {
      diagnostics.push({
        field: 'startingEquipmentMode',
        severity: 'error',
        message:
          'starting acquisition mode must be packages or starting-wealth',
        value: rawMode,
      });
    }
    let selections = {
      ...draft.selections,
      startingEquipmentMode: parsedMode ?? 'packages',
    };
    if (selections.rolledAbilityScores !== undefined) {
      try {
        selections = {
          ...selections,
          rolledAbilityScores: normalizeRolledAbilityScoreSet(
            selections.rolledAbilityScores,
          ),
        };
      } catch (error) {
        diagnostics.push({
          field: 'rolledAbilityScores',
          severity: 'error',
          message: `rolled ability evidence is invalid: ${(error as Error).message}`,
        });
        selections = { ...selections, rolledAbilityScores: undefined };
      }
    }

    const classRecord = resolveClass(selections.className);
    if (selections.className !== undefined && classRecord === undefined) {
      diagnostics.push({
        field: 'class',
        severity: 'error',
        message: `unknown class: ${selections.className}`,
        value: selections.className,
      });
    }

    const ancestryRecord = resolveAncestry(selections.ancestry);
    if (selections.ancestry !== undefined && ancestryRecord === undefined) {
      diagnostics.push({
        field: 'ancestry',
        severity: 'error',
        message: `unknown ancestry: ${selections.ancestry}`,
        value: selections.ancestry,
      });
    }

    const backgroundRecord = resolveBackground(selections.background);
    validateBackgroundCustomization(
      selections,
      backgroundRecord,
      resolver,
      diagnostics,
    );

    const validAbilityScores = validateAbilityScores(selections, diagnostics);

    const derived = deriveLevel1Values({
      validAbilityScores,
      classRecord,
      abilityScoreIncreases: ancestryAbilityScoreIncreases(ancestryRecord),
      spellcastingAbility: level1SpellcastingAbility(classRecord),
    });

    emitHitPointsPending(
      selections,
      classRecord,
      derived.maxHitPoints,
      diagnostics,
    );

    validateSpells(selections, classRecord, diagnostics, stale);
    validateStartingEquipment(selections, diagnostics);

    const next = { ...draft, derived, diagnostics, stale };
    const generatedReplacementIds = new Set(
      mechanicalChoices(next)
        .filter((entry) => isReplacementChoiceId(entry.choice.id))
        .map((entry) => entry.choice.id),
    );
    const choices = Object.fromEntries(
      Object.entries(selections.choices ?? {}).filter(
        ([id]) => !isReplacementChoiceId(id) || generatedReplacementIds.has(id),
      ),
    );
    return { ...next, selections: { ...selections, choices } };
  }

  function validateStartingEquipment(
    selections: Dnd5eDraftSelections,
    diagnostics: CharacterCreationDiagnostic[],
  ): void {
    const mode = selections.startingEquipmentMode ?? 'packages';
    if (mode === 'starting-wealth') {
      // No table in the active stack means the mode itself is unavailable, so
      // report that rather than a missing or inconsistent roll.
      if (!resolver.startingWealthAvailable()) {
        diagnostics.push({
          field: 'startingEquipmentMode',
          severity: 'error',
          message: STARTING_WEALTH_UNAVAILABLE_MESSAGE,
        });
      } else if (selections.startingWealth === undefined) {
        diagnostics.push({
          field: 'startingWealth',
          severity: 'error',
          message: 'starting-wealth mode requires one roll',
        });
      } else {
        try {
          validateStartingWealthResult(selections.startingWealth, resolver);
          const classRecord = resolveClass(selections.className);
          if (
            classRecord !== undefined &&
            selections.startingWealth.classKey !== classRecord.key
          ) {
            throw new Error(
              'starting-wealth result does not match selected class',
            );
          }
        } catch (error) {
          diagnostics.push({
            field: 'startingWealth',
            severity: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'invalid starting-wealth result',
          });
        }
      }
    } else if (selections.startingWealth !== undefined) {
      diagnostics.push({
        field: 'startingWealth',
        severity: 'error',
        message: 'starting-wealth evidence cannot be present in package mode',
      });
    }
  }

  function resolveClass(value: string | undefined) {
    if (value === undefined) {
      return undefined;
    }
    const result = resolver.resolveClass(value);
    return result.ok ? result.record : undefined;
  }

  function resolveAncestry(
    value: string | undefined,
  ): ResolvedAncestryData | undefined {
    if (value === undefined) {
      return undefined;
    }
    const result = resolver.resolveAncestry(value);
    return result.ok ? result.record : undefined;
  }

  function resolveBackground(
    value: string | undefined,
  ): ResolvedBackgroundData | undefined {
    if (value === undefined) {
      return undefined;
    }
    const result = resolver.resolveBackground(value);
    return result.ok ? result.record : undefined;
  }

  /**
   * The structured level-1 mechanical choices (skills, tools, equipment,
   * languages) for the current class/ancestry/background, each paired with the
   * draft's stored selection and whether it satisfies the choice. Returns an
   * empty list until a class resolves (the choices derive from it).
   */
  function mechanicalChoices(
    draft: CharacterDraft,
  ): readonly MechanicalChoiceState[] {
    assertSupportedCharacterBuild(draft, {
      operation: 'character-creation draft validation',
      resolver,
    });
    const classRecord = resolveClass(draft.selections.className);
    if (classRecord === undefined) {
      return [];
    }
    const all = enumerateLevel1RequiredChoices({
      classData: classRecord,
      ancestry: resolveAncestry(draft.selections.ancestry),
      background: effectiveBackground(draft.selections, resolver),
      abilityModifiers: draft.derived.abilityModifiers,
    });
    const stored = draft.selections.choices ?? {};
    const mechanical = all.filter((choice) =>
      MECHANICAL_CHOICE_KINDS.has(choice.kind),
    );
    const choices = (
      draft.selections.startingEquipmentMode === 'starting-wealth'
        ? mechanical.filter((choice) => choice.kind !== 'equipment')
        : mechanical
    ).map((choice) => ({
      choice,
      selected: stored[choice.id] ?? [],
      satisfied: isChoiceSatisfied(choice, stored[choice.id] ?? []),
    }));
    return appendProficiencyReplacements(
      choices,
      classRecord,
      effectiveBackground(draft.selections, resolver),
      stored,
      resolver,
    );
  }

  function appendProficiencyReplacements(
    choices: readonly MechanicalChoiceState[],
    classRecord: ResolvedClassData,
    background: ResolvedBackgroundData | undefined,
    stored: Readonly<Record<string, readonly string[]>>,
    resolver: RulesPackCharacterResolver,
  ): readonly MechanicalChoiceState[] {
    const result = [...choices];
    for (const kind of ['skills', 'tools'] as const) {
      const ordinaryEntries = result.filter(
        (entry) => entry.choice.kind === kind,
      );
      if (ordinaryEntries.some((entry) => !entry.satisfied)) continue;
      const grants = [
        ...(kind === 'skills' ? (background?.skillProficiencies ?? []) : []),
        ...(kind === 'tools' ? (classRecord.toolProficiencies ?? []) : []),
        ...(kind === 'tools' ? (background?.toolProficiencies ?? []) : []),
        ...ordinaryEntries.flatMap((entry) => entry.selected),
      ];
      const ordinaryKeys = new Set(grants.map(normalizeProficiency));
      const occurrences = new Map<string, number>();
      const duplicates: { key: string; label: string; occurrence: number }[] =
        [];
      for (const grant of grants) {
        const key = normalizeProficiency(grant);
        const occurrence = (occurrences.get(key) ?? 0) + 1;
        occurrences.set(key, occurrence);
        if (occurrence > 1)
          duplicates.push({ key, label: grant, occurrence: occurrence - 1 });
      }
      const domain = normalizeDomain(
        kind === 'skills' ? SRD_5_1_SKILLS : resolver.listToolProficiencies(),
      );
      const validReplacements = new Set<string>();
      for (const duplicate of duplicates) {
        const id = proficiencyReplacementId(
          kind,
          duplicate.label,
          duplicate.occurrence,
        );
        const from = domain.filter(
          (value) =>
            !ordinaryKeys.has(normalizeProficiency(value)) &&
            !validReplacements.has(normalizeProficiency(value)),
        );
        const selected = stored[id] ?? [];
        const choice = {
          id,
          kind,
          source: 'background' as const,
          status: 'structured' as const,
          label: `Replace duplicate ${kind.slice(0, -1)} proficiency (${duplicate.label})`,
          choose: 1,
          from,
        };
        const satisfied = isChoiceSatisfied(choice, selected);
        result.push({ choice, selected, satisfied });
        if (satisfied) validReplacements.add(normalizeProficiency(selected[0]));
      }
    }
    return result;
  }

  function normalizeDomain(values: readonly string[]): readonly string[] {
    const seen = new Set<string>();
    return values.filter((value) => {
      const key = normalizeProficiency(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function isReplacementChoiceId(id: string): boolean {
    return id.startsWith('proficiency-replacement.');
  }

  /**
   * Emit per-score diagnostics and return the subset of scores that are valid
   * (integer, and within point-buy range when that method is selected). Derived
   * value computation runs off these validated scores.
   */
  function validateAbilityScores(
    selections: Dnd5eDraftSelections,
    diagnostics: CharacterCreationDiagnostic[],
  ): Partial<Record<AbilityScoreName, number>> {
    const base = selections.baseAbilityScores ?? {};
    const method = selections.abilityScoreMethod;
    const validAbilityScores: Partial<Record<AbilityScoreName, number>> = {};

    for (const name of ABILITY_SCORE_NAMES) {
      const value = base[name];
      if (value === undefined) {
        continue;
      }
      if (!Number.isInteger(value)) {
        diagnostics.push({
          field: `abilityScores.${name}`,
          severity: 'error',
          message: 'ability score must be an integer',
          value,
        });
        continue;
      }
      if (method === 'point_buy' && pointBuyCost(value) === undefined) {
        diagnostics.push({
          field: `abilityScores.${name}`,
          severity: 'error',
          message:
            'point-buy score must be between 8 and 15 before ancestry bonuses',
          value,
        });
        continue;
      }
      if (
        (method === 'manual' || method === 'rolled') &&
        !isPlausibleFreeEntryScore(value)
      ) {
        diagnostics.push({
          field: `abilityScores.${name}`,
          severity: 'error',
          message: `ability score must be between ${FREE_ENTRY_MIN_SCORE} and ${FREE_ENTRY_MAX_SCORE}`,
          value,
        });
        continue;
      }
      validAbilityScores[name] = value;
    }

    validateScoreMethodTotals(selections, base, diagnostics);
    return validAbilityScores;
  }

  function validateScoreMethodTotals(
    selections: Dnd5eDraftSelections,
    base: Partial<Record<AbilityScoreName, number>>,
    diagnostics: CharacterCreationDiagnostic[],
  ): void {
    const method = selections.abilityScoreMethod;
    const values = ABILITY_SCORE_NAMES.map((name) => base[name]);
    const allPresent = values.every(
      (value): value is number =>
        value !== undefined && Number.isInteger(value),
    );
    if (!allPresent) {
      return;
    }

    if (method === 'point_buy') {
      const costs = values.map((value) => pointBuyCost(value));
      if (costs.some((cost) => cost === undefined)) {
        return; // per-score range errors already reported
      }
      let total = 0;
      for (const cost of costs) {
        total += cost ?? 0;
      }
      if (total > POINT_BUY_BUDGET) {
        diagnostics.push({
          field: 'abilityScores',
          severity: 'error',
          message: `point-buy total exceeds ${POINT_BUY_BUDGET}: ${total}`,
          value: total,
        });
      }
      return;
    }

    if (method === 'standard_array') {
      const sorted = [...values].sort((left, right) => right - left);
      if (!STANDARD_ARRAY.every((score, index) => sorted[index] === score)) {
        diagnostics.push({
          field: 'abilityScores',
          severity: 'error',
          message: 'standard-array scores must be 15, 14, 13, 12, 10, and 8',
        });
      }
      return;
    }

    if (method === 'rolled') {
      const rolls = selections.rolledAbilityScores;
      if (rolls === undefined) {
        diagnostics.push({
          field: 'rolledAbilityScores',
          severity: 'error',
          message: 'roll six ability scores before assigning them',
        });
        return;
      }
      try {
        const canonical = normalizeRolledAbilityScoreSet(rolls);
        const assignment = summarizePoolAssignment(
          canonical.map((roll) => roll.total),
          base,
        );
        if (!assignment.complete) {
          diagnostics.push({
            field: 'abilityScores',
            severity: 'error',
            message: 'rolled scores must use the rolled pool by multiplicity',
            value: base,
          });
        }
      } catch {
        // The evidence-specific diagnostic was emitted during recompute.
      }
    }
  }

  /**
   * Surface a `pending` notice when HP could not be computed yet, naming the
   * missing prerequisite(s). Cascade-guarded: silent on a wholly empty draft
   * and never stacked on top of an existing class error.
   */
  function emitHitPointsPending(
    selections: Dnd5eDraftSelections,
    classRecord: unknown,
    maxHitPoints: number | undefined,
    diagnostics: CharacterCreationDiagnostic[],
  ): void {
    if (maxHitPoints !== undefined) {
      return;
    }

    const constitution = selections.baseAbilityScores?.constitution;
    const constitutionValid =
      constitution !== undefined &&
      isValidBaseScore(constitution, selections.abilityScoreMethod);

    const classErrored =
      selections.className !== undefined && classRecord === undefined;
    const started =
      selections.className !== undefined || constitution !== undefined;
    if (classErrored || !started) {
      return;
    }

    const dependsOn: string[] = [];
    if (classRecord === undefined) {
      dependsOn.push('class');
    }
    if (!constitutionValid) {
      dependsOn.push('abilityScores.constitution');
    }
    diagnostics.push({
      field: 'maxHitPoints',
      severity: 'pending',
      message:
        'Hit points will be calculated after class and Constitution are known.',
      dependsOn,
    });
  }

  function validateSpells(
    selections: Dnd5eDraftSelections,
    classRecord: { name: string } | undefined,
    diagnostics: CharacterCreationDiagnostic[],
    stale: string[],
  ): void {
    const spells = selections.spells ?? [];
    if (spells.length === 0) {
      return;
    }
    if (classRecord === undefined) {
      diagnostics.push({
        field: 'spells',
        severity: 'pending',
        message: 'Spell validation is waiting for class selection.',
        dependsOn: ['class'],
      });
      return;
    }
    let invalid = false;
    for (const spell of spells) {
      const result = resolver.resolveSpell(spell);
      if (!result.ok) {
        diagnostics.push({
          field: 'spells',
          severity: 'error',
          message: `unknown spell: ${spell}`,
          value: spell,
        });
        invalid = true;
        continue;
      }
      const record = result.record;
      // Spell level is intrinsic to the spell (generated data), so an
      // out-of-reach spell is illegal regardless of class — check it first.
      if (record.level > LEVEL_1_MAX_SPELL_LEVEL) {
        diagnostics.push({
          field: 'spells',
          severity: 'error',
          message: `${record.name} is a level-${record.level} spell; a level-1 character can choose only cantrips and 1st-level spells.`,
          value: spell,
        });
        invalid = true;
        continue;
      }
      if (!record.classes.includes(classRecord.name)) {
        diagnostics.push({
          field: 'spells',
          severity: 'error',
          message: `${record.name} is not on the ${classRecord.name} spell list.`,
          value: spell,
        });
        invalid = true;
      }
    }
    if (invalid) {
      stale.push('spells');
    }
  }

  function missingRequiredChoices(
    draft: CharacterDraft,
  ): readonly RequiredChoice[] {
    assertSupportedCharacterBuild(draft, {
      operation: 'character-creation draft validation',
      resolver,
    });
    const missing: string[] = [];
    const { selections, identity } = draft;

    if ((identity.name ?? '').trim().length === 0) {
      missing.push('name');
    }
    if (resolveClass(selections.className) === undefined) {
      missing.push('class');
    }
    if (resolveAncestry(selections.ancestry) === undefined) {
      missing.push('ancestry');
    }
    if (selections.abilityScoreMethod === undefined) {
      missing.push('abilityScoreMethod');
    }
    if (!hasCompleteValidScores(draft)) {
      missing.push('abilityScores');
    }

    return missing.map((field) => ({
      field,
      label: REQUIRED_CHOICE_LABELS[field] ?? field,
    }));
  }

  function hasCompleteValidScores(draft: CharacterDraft): boolean {
    const base = draft.selections.baseAbilityScores ?? {};
    const allPresent = ABILITY_SCORE_NAMES.every((name) => {
      const value = base[name];
      return value !== undefined && Number.isInteger(value);
    });
    if (!allPresent) {
      return false;
    }
    return !draft.diagnostics.some(
      (diagnostic) =>
        diagnostic.severity === 'error' &&
        diagnostic.field.startsWith('abilityScores'),
    );
  }

  function isFinalizable(draft: CharacterDraft): boolean {
    return (
      missingRequiredChoices(draft).length === 0 &&
      !draft.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    );
  }

  function toFinalizableDraft(draft: CharacterDraft): FinalizableDraftResult {
    assertSupportedCharacterBuild(draft, {
      operation: 'character-creation finalization',
      resolver,
    });
    const missing = missingRequiredChoices(draft);
    const errors = draft.diagnostics.filter(
      (diagnostic) => diagnostic.severity === 'error',
    );
    if (missing.length > 0 || errors.length > 0) {
      return { ok: false, missing, errors };
    }

    const base = draft.selections.baseAbilityScores ?? {};
    const abilityScores = {} as Record<AbilityScoreName, number>;
    for (const name of ABILITY_SCORE_NAMES) {
      abilityScores[name] = base[name] as number;
    }

    const finalizable: CharacterCreationDraft = {
      name: (draft.identity.name ?? '').trim(),
      ancestry: resolveAncestry(draft.selections.ancestry)?.name as string,
      className: resolveClass(draft.selections.className)?.name as string,
      level: draft.level,
      abilityScoreMethod: draft.selections
        .abilityScoreMethod as AbilityScoreMethod,
      abilityScores: abilityScores as AbilityScores,
      ...(draft.selections.abilityScoreMethod !== 'rolled' ||
      draft.selections.rolledAbilityScores === undefined
        ? {}
        : { rolledAbilityScores: draft.selections.rolledAbilityScores }),
      maxHitPoints: draft.derived.maxHitPoints as number,
      spells: [...(draft.selections.spells ?? [])],
    };
    return { ok: true, draft: finalizable };
  }

  function withSelections(
    draft: CharacterDraft,
    patch: Partial<Dnd5eDraftSelections>,
  ): CharacterDraft {
    return recompute({
      ...draft,
      selections: { ...draft.selections, ...patch },
    });
  }

  return {
    createDraft(input: CreateDraftInput): CharacterDraft {
      assertSupportedCharacterBuild(input, {
        operation: 'character-creation draft creation',
        resolver,
      });
      return recompute({
        id: input.id,
        rulesPackId: input.rulesPackId ?? DEFAULT_DND5E_SRD_BINDING.base.packId,
        recipeId: input.recipeId ?? 'dnd5e-srd',
        creationMode: input.mode,
        level: input.level ?? DEFAULT_LEVEL,
        identity: { ...input.identity },
        selections: {
          startingEquipmentMode: 'packages',
          ...input.selections,
        },
        derived: {
          proficiencyBonus: LEVEL_1_PROFICIENCY_BONUS,
          abilityModifiers: {},
          finalAbilityScores: {},
          savingThrows: {},
        },
        stale: [],
        diagnostics: [],
      });
    },

    recomputeDraft(draft): CharacterDraft {
      assertSupportedCharacterBuild(draft, {
        operation: 'character-creation draft resume',
        resolver,
      });
      return recompute({
        ...draft,
        selections: {
          startingEquipmentMode: 'packages',
          ...draft.selections,
        },
      });
    },

    setIdentity(draft, patch): CharacterDraft {
      return recompute({
        ...draft,
        identity: { ...draft.identity, ...patch },
      });
    },

    setClass(draft, value): CharacterDraft {
      return withSelections(draft, {
        className: value,
        ...(value !== draft.selections.className
          ? { startingWealth: undefined }
          : {}),
      });
    },

    setAncestry(draft, value): CharacterDraft {
      return withSelections(draft, { ancestry: value });
    },

    setBackground(draft, value): CharacterDraft {
      return withSelections(draft, {
        background: value,
        ...(value !== draft.selections.background
          ? { backgroundCustomization: undefined }
          : {}),
      });
    },

    setBackgroundCustomization(draft, value): CharacterDraft {
      return withSelections(draft, {
        backgroundCustomization:
          value === undefined
            ? undefined
            : {
                ...value,
                skillProficiencies: [...value.skillProficiencies],
                toolProficiencies: [...value.toolProficiencies],
                languages: [...value.languages],
              },
      });
    },

    setAbilityScoreMethod(draft, method): CharacterDraft {
      return withSelections(draft, {
        abilityScoreMethod: method,
        ...(method === 'rolled' ? {} : { rolledAbilityScores: undefined }),
      });
    },

    setAbilityScore(draft, ability, value): CharacterDraft {
      const base = { ...(draft.selections.baseAbilityScores ?? {}) };
      if (value === undefined) {
        delete base[ability];
      } else {
        base[ability] = value;
      }
      return withSelections(draft, { baseAbilityScores: base });
    },

    setAbilityScores(draft, scores): CharacterDraft {
      return withSelections(draft, { baseAbilityScores: { ...scores } });
    },

    setRolledAbilityScores(draft, rolls): CharacterDraft {
      const canonical =
        rolls === undefined ? undefined : normalizeRolledAbilityScoreSet(rolls);
      return withSelections(draft, {
        rolledAbilityScores: canonical,
        baseAbilityScores: {},
      });
    },

    setSpells(draft, spells): CharacterDraft {
      return withSelections(draft, {
        spells: spells === undefined ? undefined : [...spells],
      });
    },

    setChoice(draft, choiceId, values): CharacterDraft {
      const choices = { ...(draft.selections.choices ?? {}) };
      if (values === undefined || values.length === 0) {
        delete choices[choiceId];
      } else {
        choices[choiceId] = [...values];
      }
      return withSelections(draft, { choices });
    },

    setStartingEquipmentMode(draft, mode): CharacterDraft {
      const choices = { ...(draft.selections.choices ?? {}) };
      if (mode === 'starting-wealth') {
        for (const id of Object.keys(choices)) {
          if (id.startsWith('class.equipment.')) delete choices[id];
        }
      }
      return withSelections(draft, {
        startingEquipmentMode: mode,
        choices,
        ...(mode === 'packages' ? { startingWealth: undefined } : {}),
      });
    },

    setStartingWealth(draft, result): CharacterDraft {
      return withSelections(draft, { startingWealth: result });
    },

    mechanicalChoices,

    validate(draft): readonly CharacterCreationDiagnostic[] {
      return recompute(draft).diagnostics;
    },

    computeDerived(draft): CharacterDraftDerived {
      return recompute(draft).derived;
    },

    missingRequiredChoices,
    isFinalizable,
    toFinalizableDraft,
  };
}

/**
 * Whether a stored selection satisfies a structured choice: the right number of
 * distinct options, each a legal option of the choice. A choice without a known
 * `choose` count (none of the mechanical kinds today) is treated as satisfied so
 * it never blocks; an empty `from` (open pool) skips the membership check.
 */
function isChoiceSatisfied(
  choice: Level1RequiredChoice,
  selected: readonly string[],
): boolean {
  if (choice.choose === undefined) {
    return true;
  }
  const distinct = new Set(selected);
  if (distinct.size !== choice.choose) {
    return false;
  }
  if (choice.from === undefined || choice.from.length === 0) {
    return true;
  }
  const options = new Set(choice.from);
  return [...distinct].every((value) => options.has(value));
}

let cachedEngine: CharacterCreationEngine | undefined;

/** Shared engine over the bundled D&D 5e SRD resolver. */
export function getDnd5eCharacterCreationEngine(): CharacterCreationEngine {
  cachedEngine ??= createCharacterCreationEngine();
  return cachedEngine;
}
