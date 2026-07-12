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
 *     generated pack metadata supplies (equipment fixed grants, fixed ancestry +
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
import { assertSupportedCharacterBuild } from './characterBuild.js';
import type { StartingEquipmentMode } from './characterDraft.js';
import {
  type CharacterCreationEngine,
  type CharacterDraft,
  getDnd5eCharacterCreationEngine,
  type RequiredChoice,
} from './characterDraft.js';
import type { AbilityScoreName } from './creation.js';
import type { SavingThrowDerived } from './derivedValues.js';
import { normalizeProficiency } from './proficiency.js';
import {
  getBundledDnd5eCharacterResolver,
  type ResolvedBackgroundData,
  type ResolvedClassData,
  type ResolvedLanguageGrant,
  type RulesPackCharacterResolver,
} from './rulesPackResolver.js';
import type { StartingWealthResult } from './srdStartingWealth.js';
import { validateStartingWealthResult } from './srdStartingWealth.js';

/** D&D 5e coin denominations carried by a character, not inventory rows. */
export interface CharacterWallet {
  readonly cp: number;
  readonly sp: number;
  readonly ep: number;
  readonly gp: number;
  readonly pp: number;
}

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
  /**
   * The stable cross-campaign registry identity this sheet was attached from
   * (ADR 0012). Set on a campaign-local sheet when a registry character is
   * imported into a campaign, linking the playable instance back to the
   * continuing character. Unset on a freshly created, not-yet-attached sheet.
   */
  readonly globalCharacterId?: string;
  /** ISO-8601 timestamp the sheet was attached into a campaign (ADR 0012). */
  readonly importedAt?: string;
  /**
   * The registry revision number that was checked out when this sheet was
   * attached (ADR 0012, eshyra-lupf.14.3). Records the point on the character's
   * linear timeline the campaign took custody from; sync-back commits a *new*
   * revision built from the campaign sheet regardless of this value. Unset on a
   * freshly created, not-yet-attached sheet.
   */
  readonly sourceRevision?: number;
}

/**
 * The canonical, serializable character sheet produced from a complete draft —
 * the core-owned, rules-pack-bound authority for a character's build-defining
 * facts (ADR 0011). Self-contained: every rules reference carries its frozen
 * key, and the `schemaVersion` / `system` / `rulesPackId` / `recipeId` fields
 * plus `metadata` capture provenance and pack binding. Persisted by the
 * core {@link CharacterSheetStore}; the live `character` row projects a few of
 * its columns for the per-turn path.
 */
export interface CharacterSheet {
  readonly schemaVersion: 1;
  readonly system: string;
  readonly rulesPackId: string;
  readonly recipeId: string;
  readonly creationMode: string;
  readonly startingEquipmentMode?: StartingEquipmentMode;
  readonly level: number;
  readonly identity: { readonly name: string; readonly concept?: string };
  readonly class: FinalizedRecordRef;
  readonly subclass?: FinalizedRecordRef;
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
  /**
   * Structured coin carried by the character. This is continuity state on the
   * sheet, distinct from inventory item rows and prose starting equipment.
   * Legacy sheets with no wallet are treated as an empty wallet by currency
   * helpers until the first wallet mutation persists the field.
   */
  readonly wallet?: CharacterWallet;
  readonly languages: readonly string[];
  readonly spells: readonly string[];
  readonly metadata: FinalizeMetadata;
}

/** Outcome of {@link finalizeCharacterDraft}. */
export type FinalizeCharacterResult =
  | { readonly ok: true; readonly character: CharacterSheet }
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
  assertSupportedCharacterBuild(draft, {
    operation: 'character-creation finalization',
    resolver,
  });
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

  const acquisition = validateFinalStartingAcquisition(draft, resolver);
  if (!acquisition.ok)
    return { ok: false, missing, errors: [acquisition.error] };
  try {
    assertProficiencyInvariant(
      draft,
      engine,
      classRecordForDraft(draft, resolver),
      backgroundRecordForDraft(draft, resolver),
    );
  } catch (error) {
    return {
      ok: false,
      missing,
      errors: [
        error instanceof Error ? error.message : 'invalid proficiency choices',
      ],
    };
  }

  return {
    ok: true,
    character: buildFinalizedCharacter(
      draft,
      metadata,
      resolver,
      engine,
      acquisition.value,
    ),
  };
}

type FinalStartingAcquisition =
  | { readonly mode: 'packages'; readonly walletGp: number }
  | {
      readonly mode: 'starting-wealth';
      readonly walletGp: number;
      readonly result: StartingWealthResult;
    };

function validateFinalStartingAcquisition(
  draft: CharacterDraft,
  resolver: RulesPackCharacterResolver,
):
  | { readonly ok: true; readonly value: FinalStartingAcquisition }
  | { readonly ok: false; readonly error: string } {
  const mode = draft.selections.startingEquipmentMode ?? 'packages';
  const result = draft.selections.startingWealth;
  if (mode === 'packages') {
    if (result !== undefined) {
      return {
        ok: false,
        error: 'starting-wealth evidence cannot be present in package mode',
      };
    }
    const background = backgroundRecordForDraft(draft, resolver);
    const walletGp = (background?.equipmentGrants ?? []).reduce(
      (sum, grant) => sum + (grant.currencyGp ?? 0),
      0,
    );
    if (!Number.isSafeInteger(walletGp) || walletGp < 0) {
      return {
        ok: false,
        error: 'package currency is outside the safe integer range',
      };
    }
    return { ok: true, value: { mode, walletGp } };
  }
  if (result === undefined) {
    return { ok: false, error: 'starting-wealth mode requires one roll' };
  }
  if (
    Object.entries(draft.selections.choices ?? {}).some(
      ([id, values]) => id.startsWith('class.equipment.') && values.length > 0,
    )
  ) {
    return {
      ok: false,
      error: 'starting-wealth mode cannot include package equipment',
    };
  }
  const classResult = resolver.resolveClass(draft.selections.className ?? '');
  if (!classResult.ok) return { ok: false, error: classResult.message };
  if (result.classKey !== classResult.record.key) {
    return {
      ok: false,
      error: 'starting-wealth result does not match selected class',
    };
  }
  try {
    validateStartingWealthResult(result, resolver);
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'invalid starting-wealth evidence',
    };
  }
  return { ok: true, value: { mode, walletGp: result.totalGp, result } };
}

function buildFinalizedCharacter(
  draft: CharacterDraft,
  metadata: FinalizeMetadata,
  resolver: RulesPackCharacterResolver,
  engine: CharacterCreationEngine,
  acquisition: FinalStartingAcquisition,
): CharacterSheet {
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

  const finalized: CharacterSheet = {
    schemaVersion: 1,
    system: 'dnd5e-srd',
    rulesPackId: draft.rulesPackId,
    recipeId: draft.recipeId,
    creationMode: draft.creationMode,
    ...(selections.startingEquipmentMode !== undefined
      ? { startingEquipmentMode: selections.startingEquipmentMode }
      : {}),
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
    skillProficiencies: resolveProficiencySet(
      draft,
      engine,
      'skills',
      backgroundRecord?.skillProficiencies ?? [],
    ),
    toolProficiencies: resolveProficiencySet(draft, engine, 'tools', [
      ...(classRecord.toolProficiencies ?? []),
      ...(backgroundRecord?.toolProficiencies ?? []),
    ]),
    armorProficiencies: [...(classRecord.armorProficiencies ?? [])],
    weaponProficiencies: [...(classRecord.weaponProficiencies ?? [])],
    equipment: collectEquipment(draft, engine, classRecord, backgroundRecord),
    wallet: walletForDraft(acquisition),
    languages: collectLanguages(
      draft,
      engine,
      ancestryRecord.languages,
      backgroundRecord?.languages,
    ),
    spells: [...(selections.spells ?? [])],
    metadata,
  };
  return finalized;
}

function assertProficiencyInvariant(
  draft: CharacterDraft,
  engine: CharacterCreationEngine,
  classRecord: ResolvedClassData,
  backgroundRecord: ResolvedBackgroundData | undefined,
): void {
  const generated = new Set(
    engine
      .mechanicalChoices(draft)
      .filter((entry) => isReplacementChoiceId(entry.choice.id))
      .map((entry) => entry.choice.id),
  );
  for (const id of Object.keys(draft.selections.choices ?? {})) {
    if (isReplacementChoiceId(id) && !generated.has(id)) {
      throw new Error(
        `finalization invariant: stale proficiency replacement '${id}'`,
      );
    }
  }
  const skills = resolveProficiencySet(
    draft,
    engine,
    'skills',
    backgroundRecord?.skillProficiencies ?? [],
  );
  const tools = resolveProficiencySet(draft, engine, 'tools', [
    ...(classRecord.toolProficiencies ?? []),
    ...(backgroundRecord?.toolProficiencies ?? []),
  ]);
  for (const [kind, values] of [
    ['skill', skills],
    ['tool', tools],
  ] as const) {
    const normalized = values.map(normalizeProficiency);
    if (new Set(normalized).size !== normalized.length) {
      throw new Error(
        `finalization invariant: unresolved duplicate ${kind} proficiency`,
      );
    }
  }
}

function resolveProficiencySet(
  draft: CharacterDraft,
  engine: CharacterCreationEngine,
  kind: 'skills' | 'tools',
  fixed: readonly string[],
): readonly string[] {
  const entries = engine
    .mechanicalChoices(draft)
    .filter((entry) => entry.choice.kind === kind);
  const ordinary = entries
    .filter((entry) => !isReplacementChoiceId(entry.choice.id))
    .flatMap((entry) => entry.selected);
  const replacements = new Map(
    entries
      .filter((entry) => isReplacementChoiceId(entry.choice.id))
      .map((entry) => [entry.choice.id, entry] as const),
  );
  const result: string[] = [];
  const seen = new Set<string>();
  const ordinaryKeys = new Set(
    [...fixed, ...ordinary].map(normalizeProficiency),
  );
  const occurrences = new Map<string, number>();
  for (const value of [...fixed, ...ordinary]) {
    const key = normalizeProficiency(value);
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
      continue;
    }
    const replacementId = `proficiency-replacement.${kind}.${slug(value)}.${occurrence - 1}`;
    const replacement = replacements.get(replacementId);
    const replacementValue = replacement?.selected[0];
    if (
      replacement === undefined ||
      !replacement.satisfied ||
      replacementValue === undefined ||
      seen.has(normalizeProficiency(replacementValue))
    ) {
      throw new Error(
        `finalization invariant: unresolved duplicate ${kind} proficiency`,
      );
    }
    seen.add(normalizeProficiency(replacementValue));
    result.push(replacementValue);
  }
  if (result.length !== fixed.length + ordinary.length) {
    throw new Error(`finalization invariant: ${kind} grant count changed`);
  }
  if (
    replacements.size !==
    [...fixed, ...ordinary].length - ordinaryKeys.size
  ) {
    throw new Error(
      `finalization invariant: ${kind} replacement count changed`,
    );
  }
  return result;
}

function isReplacementChoiceId(id: string): boolean {
  return id.startsWith('proficiency-replacement.');
}

function slug(value: string): string {
  return normalizeProficiency(value).replace(/ /g, '-');
}

function classRecordForDraft(
  draft: CharacterDraft,
  resolver: RulesPackCharacterResolver,
): ResolvedClassData {
  const result = resolver.resolveClass(draft.selections.className ?? '');
  if (!result.ok)
    throw new Error('finalization invariant: class did not resolve');
  return result.record;
}

function backgroundRecordForDraft(
  draft: CharacterDraft,
  resolver: RulesPackCharacterResolver,
): ResolvedBackgroundData | undefined {
  if (draft.selections.background === undefined) return undefined;
  const result = resolver.resolveBackground(draft.selections.background);
  return result.ok ? result.record : undefined;
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
  if (draft.selections.startingEquipmentMode === 'starting-wealth') {
    return [];
  }
  const chosenById = new Map(
    engine
      .mechanicalChoices(draft)
      .filter((entry) => entry.choice.kind === 'equipment')
      .map((entry) => [entry.choice.id, entry.selected] as const),
  );
  const equipment: string[] = [];
  (classRecord.startingEquipment?.entries ?? []).forEach((entry, index) => {
    if (typeof entry === 'string') {
      equipment.push(...(chosenById.get(`class.equipment.${index}`) ?? []));
      return;
    }
    if (entry.kind === 'fixed') {
      equipment.push(entry.text);
      return;
    }
    equipment.push(...(chosenById.get(`class.equipment.${index}`) ?? []));
  });
  if (backgroundRecord?.equipmentGrants !== undefined) {
    for (const grant of backgroundRecord.equipmentGrants) {
      equipment.push(
        `${grant.quantity > 1 ? `${grant.quantity} ` : ''}${grant.name}`,
      );
    }
  } else if (backgroundRecord?.equipment !== undefined) {
    equipment.push(backgroundRecord.equipment);
  }
  return equipment;
}

function walletForDraft(
  acquisition: FinalStartingAcquisition,
): CharacterWallet {
  return { cp: 0, sp: 0, ep: 0, gp: acquisition.walletGp, pp: 0 };
}

/** Fixed ancestry + background languages merged with the player's chosen ones. */
function collectLanguages(
  draft: CharacterDraft,
  engine: CharacterCreationEngine,
  ancestryLanguages: readonly ResolvedLanguageGrant[] | undefined,
  backgroundLanguages: string | readonly ResolvedLanguageGrant[] | undefined,
): readonly string[] {
  const languages = new Set<string>();
  for (const language of fixedLanguages(ancestryLanguages)) {
    languages.add(language);
  }
  for (const language of fixedLanguages(backgroundLanguages)) {
    languages.add(language);
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

function fixedLanguages(
  value: string | readonly ResolvedLanguageGrant[] | undefined,
): readonly string[] {
  return Array.isArray(value) ? value.flatMap((grant) => grant.fixed) : [];
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
