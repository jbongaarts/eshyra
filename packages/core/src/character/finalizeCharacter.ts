/**
 * Finalize a guided-creation draft into a canonical, playable character record
 * (eshyra-b69j.14) — the capstone of the guided creation epic.
 *
 * The incremental {@link CharacterDraft} is work-in-progress: partial answers,
 * live diagnostics, mechanical choices stored by id. This module turns a
 * *complete* draft into a single, serializable {@link FinalizedCharacter}
 * snapshot — the portable artifact a campaign can later import for play/audit.
 * It folds together everything the earlier slices produced:
 *
 *   - identity, class, ancestry, background (canonical names + frozen record
 *     keys), level, and the rules-pack / recipe ids for provenance;
 *   - base and final ability scores, modifiers, saving throws, proficiency
 *     bonus, max HP, and spell save DC / attack (eshyra-b69j.6/.12.1/.12.2);
 *   - the level-1 mechanical choices — skills, tools, equipment, languages —
 *     selected through the engine (eshyra-b69j.13), merged with the fixed grants
 *     the source-cited overlays supply (equipment fixed grants, fixed ancestry +
 *     background languages);
 *   - chosen spells.
 *
 * Finalization is gated: an incomplete draft (missing identity/class/ancestry/
 * ability scores, an unsatisfied mechanical choice, or any error diagnostic)
 * cannot finalize and returns the actionable list of what is missing. This is
 * the single source of truth for "is this character done?", reused by the CLI's
 * finalize step.
 */

import { ABILITY_SCORE_NAMES } from './abilities.js';
import {
  type CharacterCreationEngine,
  type CharacterDraft,
  getDnd5eCharacterCreationEngine,
  type RequiredChoice,
} from './characterDraft.js';
import type { AbilityScoreName } from './creation.js';
import type { SavingThrowDerived } from './derivedValues.js';
import {
  getBundledDnd5eCharacterResolver,
  type ResolvedBackgroundData,
  type ResolvedClassData,
  type RulesPackCharacterResolver,
} from './rulesPackResolver.js';
import { getClassStartingEquipment } from './srdClassStartingEquipment.js';
import {
  getAncestryLanguages,
  getBackgroundLanguages,
} from './srdLanguages.js';

/** A resolved rules record reference: canonical key plus display name. */
export interface FinalizedRecordRef {
  readonly key: string;
  readonly name: string;
}

/** Per-ability final number set on a finalized character. */
export interface FinalizedAbilityScore {
  readonly base: number;
  readonly final: number;
  readonly modifier: number;
}

/** Provenance for a finalized character — enough to re-audit later. */
export interface FinalizeMetadata {
  /** ISO-8601 timestamp the character was finalized. */
  readonly createdAt: string;
  /** Free-text origin (e.g. `create-character:concept-first`). */
  readonly source?: string;
}

/**
 * The canonical, serializable level-1 character record produced from a complete
 * draft. Self-contained: every rules reference carries its frozen key, and the
 * pack/recipe ids plus `metadata` capture provenance.
 */
export interface FinalizedCharacter {
  readonly schemaVersion: 1;
  readonly system: string;
  readonly rulesPackId: string;
  readonly recipeId: string;
  readonly creationMode: string;
  readonly level: number;
  readonly identity: { readonly name: string; readonly concept?: string };
  readonly class: FinalizedRecordRef;
  readonly ancestry: FinalizedRecordRef;
  readonly background?: FinalizedRecordRef;
  readonly abilityScores: Readonly<
    Record<AbilityScoreName, FinalizedAbilityScore>
  >;
  readonly proficiencyBonus: number;
  readonly maxHitPoints: number;
  readonly savingThrows: Readonly<Record<AbilityScoreName, SavingThrowDerived>>;
  readonly spellSaveDc?: number;
  readonly spellAttackModifier?: number;
  /** Background fixed skills + the player's chosen class skill proficiencies. */
  readonly skillProficiencies: readonly string[];
  /** Class + background fixed tools + the player's chosen tool proficiencies. */
  readonly toolProficiencies: readonly string[];
  /** Class fixed armor proficiencies. */
  readonly armorProficiencies: readonly string[];
  /** Class fixed weapon proficiencies. */
  readonly weaponProficiencies: readonly string[];
  /**
   * Class starting equipment (fixed grants + chosen options) followed by the
   * background's equipment package as a single verbatim entry, when present.
   */
  readonly equipment: readonly string[];
  readonly languages: readonly string[];
  readonly spells: readonly string[];
  readonly metadata: FinalizeMetadata;
}

/** Outcome of {@link finalizeCharacterDraft}. */
export type FinalizeCharacterResult =
  | { readonly ok: true; readonly character: FinalizedCharacter }
  | {
      readonly ok: false;
      readonly missing: readonly RequiredChoice[];
      readonly errors: readonly string[];
    };

/**
 * Finalize a complete draft into a {@link FinalizedCharacter}, or report what is
 * missing. Completeness is the union of the engine's base gate
 * (identity/class/ancestry/ability scores, no error diagnostics) and every
 * level-1 mechanical choice (skills/tools/equipment/languages) being satisfied.
 */
export function finalizeCharacterDraft(
  draft: CharacterDraft,
  metadata: FinalizeMetadata,
  resolver: RulesPackCharacterResolver = getBundledDnd5eCharacterResolver(),
  engine: CharacterCreationEngine = getDnd5eCharacterCreationEngine(),
): FinalizeCharacterResult {
  const base = engine.toFinalizableDraft(draft);
  const missing: RequiredChoice[] = base.ok ? [] : [...base.missing];
  const errors: string[] = base.ok
    ? []
    : base.errors.map((diagnostic) => diagnostic.message);

  const pendingChoices = engine
    .mechanicalChoices(draft)
    .filter((entry) => !entry.satisfied);
  for (const entry of pendingChoices) {
    missing.push({ field: entry.choice.id, label: entry.choice.label });
  }

  if (missing.length > 0 || errors.length > 0) {
    return { ok: false, missing, errors };
  }

  return {
    ok: true,
    character: buildFinalizedCharacter(draft, metadata, resolver, engine),
  };
}

function buildFinalizedCharacter(
  draft: CharacterDraft,
  metadata: FinalizeMetadata,
  resolver: RulesPackCharacterResolver,
  engine: CharacterCreationEngine,
): FinalizedCharacter {
  const selections = draft.selections;
  const classRecord = requireRecord(
    resolver.resolveClass(selections.className ?? ''),
  );
  const ancestryRecord = requireRecord(
    resolver.resolveAncestry(selections.ancestry ?? ''),
  );
  const backgroundRecord =
    selections.background !== undefined && resolver.resolveBackground
      ? optionalRecord(resolver.resolveBackground(selections.background))
      : undefined;
  const classRef = toRef(classRecord);
  const ancestryRef = toRef(ancestryRecord);
  const backgroundRef =
    backgroundRecord !== undefined ? toRef(backgroundRecord) : undefined;

  const base = selections.baseAbilityScores ?? {};
  const abilityScores = {} as Record<AbilityScoreName, FinalizedAbilityScore>;
  for (const name of ABILITY_SCORE_NAMES) {
    abilityScores[name] = {
      base: base[name] as number,
      final: draft.derived.finalAbilityScores[name] as number,
      modifier: draft.derived.abilityModifiers[name] as number,
    };
  }

  const savingThrows = {} as Record<AbilityScoreName, SavingThrowDerived>;
  for (const name of ABILITY_SCORE_NAMES) {
    savingThrows[name] = draft.derived.savingThrows[name] as SavingThrowDerived;
  }

  const finalized: FinalizedCharacter = {
    schemaVersion: 1,
    system: 'dnd5e-srd',
    rulesPackId: draft.rulesPackId,
    recipeId: draft.recipeId,
    creationMode: draft.creationMode,
    level: draft.level,
    identity: {
      name: (draft.identity.name ?? '').trim(),
      ...(draft.identity.concept !== undefined
        ? { concept: draft.identity.concept }
        : {}),
    },
    class: classRef,
    ancestry: ancestryRef,
    ...(backgroundRef !== undefined ? { background: backgroundRef } : {}),
    abilityScores,
    proficiencyBonus: draft.derived.proficiencyBonus,
    maxHitPoints: draft.derived.maxHitPoints as number,
    savingThrows,
    ...(draft.derived.spellSaveDc !== undefined
      ? { spellSaveDc: draft.derived.spellSaveDc }
      : {}),
    ...(draft.derived.spellAttackModifier !== undefined
      ? { spellAttackModifier: draft.derived.spellAttackModifier }
      : {}),
    skillProficiencies: dedupe([
      // Background grants fixed skills; the class grants skill *choices*.
      ...(backgroundRecord?.skillProficiencies ?? []),
      ...selectedOfKind(draft, engine, 'skills'),
    ]),
    toolProficiencies: dedupe([
      ...(classRecord.toolProficiencies ?? []),
      ...(backgroundRecord?.toolProficiencies ?? []),
      ...selectedOfKind(draft, engine, 'tools'),
    ]),
    armorProficiencies: [...(classRecord.armorProficiencies ?? [])],
    weaponProficiencies: [...(classRecord.weaponProficiencies ?? [])],
    equipment: collectEquipment(draft, engine, classRecord, backgroundRecord),
    languages: collectLanguages(
      draft,
      engine,
      ancestryRef.key,
      backgroundRef?.key,
    ),
    spells: [...(selections.spells ?? [])],
    metadata,
  };
  return finalized;
}

/** Selected options across every mechanical choice of a kind, in choice order. */
function selectedOfKind(
  draft: CharacterDraft,
  engine: CharacterCreationEngine,
  kind: 'skills' | 'tools',
): readonly string[] {
  return engine
    .mechanicalChoices(draft)
    .filter((entry) => entry.choice.kind === kind)
    .flatMap((entry) => entry.selected);
}

/**
 * Class starting equipment (fixed grants + chosen options, in SRD order) plus
 * the background's equipment package as a single verbatim entry when present.
 */
function collectEquipment(
  draft: CharacterDraft,
  engine: CharacterCreationEngine,
  classRecord: ResolvedClassData,
  backgroundRecord: ResolvedBackgroundData | undefined,
): readonly string[] {
  const chosenById = new Map(
    engine
      .mechanicalChoices(draft)
      .filter((entry) => entry.choice.kind === 'equipment')
      .map((entry) => [entry.choice.id, entry.selected] as const),
  );
  const equipment: string[] = [];
  const overlay = getClassStartingEquipment(classRecord.key);
  if (overlay === undefined) {
    equipment.push(...[...chosenById.values()].flat());
  } else {
    overlay.entries.forEach((entry, index) => {
      if (entry.kind === 'fixed') {
        equipment.push(entry.text);
        return;
      }
      equipment.push(...(chosenById.get(`class.equipment.${index}`) ?? []));
    });
  }
  if (backgroundRecord?.equipment !== undefined) {
    equipment.push(backgroundRecord.equipment);
  }
  return equipment;
}

/** Order-preserving de-duplication. */
function dedupe(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

/** Fixed ancestry + background languages merged with the player's chosen ones. */
function collectLanguages(
  draft: CharacterDraft,
  engine: CharacterCreationEngine,
  ancestryKey: string,
  backgroundKey: string | undefined,
): readonly string[] {
  const languages = new Set<string>();
  for (const language of getAncestryLanguages(ancestryKey)?.fixed ?? []) {
    languages.add(language);
  }
  if (backgroundKey !== undefined) {
    for (const language of getBackgroundLanguages(backgroundKey)?.fixed ?? []) {
      languages.add(language);
    }
  }
  for (const entry of engine.mechanicalChoices(draft)) {
    if (entry.choice.kind === 'languages') {
      for (const language of entry.selected) {
        languages.add(language);
      }
    }
  }
  return [...languages];
}

/** The canonical key+name reference for a resolved record. */
function toRef(record: {
  readonly key: string;
  readonly name: string;
}): FinalizedRecordRef {
  return { key: record.key, name: record.name };
}

function requireRecord<T>(result: {
  readonly ok: boolean;
  readonly record?: T;
}): T {
  if (!result.ok || result.record === undefined) {
    // Unreachable: the completeness gate already proved class/ancestry resolve.
    throw new Error('finalizeCharacterDraft: required record did not resolve');
  }
  return result.record;
}

function optionalRecord<T>(result: {
  readonly ok: boolean;
  readonly record?: T;
}): T | undefined {
  return result.ok ? result.record : undefined;
}
