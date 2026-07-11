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
} from './rulesPackResolver.js';

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
  readonly abilityScoreMethod?: AbilityScoreMethod;
  readonly baseAbilityScores?: Partial<Record<AbilityScoreName, number>>;
  readonly spells?: readonly string[];
  /**
   * Selected options for the structured level-1 mechanical choices (skills,
   * tools, equipment, languages), keyed by the choice id from
   * {@link enumerateLevel1RequiredChoices} (e.g. `class.skills`,
   * `class.equipment.0`, `ancestry.languages`). Collected by the
   * equipment/proficiency flow (eshyra-b69j.13).
   */
  readonly choices?: Readonly<Record<string, readonly string[]>>;
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
    const { selections } = draft;

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

    return { ...draft, derived, diagnostics, stale };
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
      background: resolveBackground(draft.selections.background),
      abilityModifiers: draft.derived.abilityModifiers,
    });
    const stored = draft.selections.choices ?? {};
    return all
      .filter((choice) => MECHANICAL_CHOICE_KINDS.has(choice.kind))
      .map((choice) => {
        const selected = stored[choice.id] ?? [];
        return {
          choice,
          selected,
          satisfied: isChoiceSatisfied(choice, selected),
        };
      });
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
        selections: { ...input.selections },
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

    setIdentity(draft, patch): CharacterDraft {
      return recompute({
        ...draft,
        identity: { ...draft.identity, ...patch },
      });
    },

    setClass(draft, value): CharacterDraft {
      return withSelections(draft, { className: value });
    },

    setAncestry(draft, value): CharacterDraft {
      return withSelections(draft, { ancestry: value });
    },

    setBackground(draft, value): CharacterDraft {
      return withSelections(draft, { background: value });
    },

    setAbilityScoreMethod(draft, method): CharacterDraft {
      return withSelections(draft, { abilityScoreMethod: method });
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
