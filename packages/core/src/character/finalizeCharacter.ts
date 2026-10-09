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
import {
  summarizePoolAssignment,
  validateRolledAbilityScoreSet,
} from './abilityAllocation.js';
import { assertSupportedCharacterBuild } from './characterBuild.js';
import {
  type CharacterCreationEngine,
  type CharacterDraft,
  effectiveBackground,
  getDnd5eCharacterCreationEngine,
  type MechanicalChoiceState,
  parseStartingEquipmentMode,
  type RequiredChoice,
  type StartingEquipmentMode,
} from './characterDraft.js';
import type { AbilityScoreName, CharacterCreationDraft } from './creation.js';
import type { SavingThrowDerived } from './derivedValues.js';
import { effectiveSpellcasting, spellsUnion } from './levelUpSpells.js';
import {
  normalizeProficiency,
  proficiencyReplacementId,
} from './proficiency.js';
import {
  getBundledDnd5eCharacterResolver,
  type ResolvedAncestryData,
  type ResolvedBackgroundData,
  type ResolvedClassData,
  type ResolvedLanguageGrant,
  type RulesPackCharacterResolver,
  STARTING_WEALTH_UNAVAILABLE_MESSAGE,
} from './rulesPackResolver.js';
import { computeAlwaysPrepared } from './spellPreparation.js';
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
/**
 * One durable option-catalog / list feature choice the character has made
 * (eshyra-ug4i.3): a Fighting Style, Metamagic, Eldritch Invocation, Pact Boon,
 * Hunter option and the like. `featureRef` is the owning `feature:` record,
 * `choiceId` the `choices[].id` within it, `optionIds` the selected option ids
 * (e.g. `pact-boon:pact-of-the-chain`), `level` the class level it was taken at.
 */
export interface CharacterFeatureChoice {
  readonly featureRef: string;
  readonly choiceId: string;
  readonly optionIds: readonly string[];
  readonly level: number;
}

/** Validate the shape of a sheet's optional `featureChoices` (old sheets omit it). */
export function validateCharacterSheetFeatureChoices(
  sheet: CharacterSheet,
): void {
  const entries: unknown = sheet.featureChoices;
  if (entries === undefined) return;
  if (!Array.isArray(entries)) {
    throw new Error('character sheet featureChoices must be an array');
  }
  for (const [index, entry] of entries.entries()) {
    const where = `character sheet featureChoices[${index}]`;
    if (entry === null || typeof entry !== 'object') {
      throw new Error(`${where} must be an object`);
    }
    const { featureRef, choiceId, optionIds, level } = entry as Record<
      string,
      unknown
    >;
    if (
      typeof featureRef !== 'string' ||
      !/^feature:[^\s]+$/.test(featureRef)
    ) {
      throw new Error(`${where}.featureRef must be a 'feature:' record ref`);
    }
    if (typeof choiceId !== 'string' || choiceId.length === 0) {
      throw new Error(`${where}.choiceId must be a non-empty string`);
    }
    if (
      !Array.isArray(optionIds) ||
      optionIds.length === 0 ||
      optionIds.some((id) => typeof id !== 'string' || id.length === 0) ||
      new Set(optionIds).size !== optionIds.length
    ) {
      throw new Error(`${where}.optionIds must be distinct non-empty strings`);
    }
    if (!Number.isInteger(level) || (level as number) < 1) {
      throw new Error(`${where}.level must be a positive integer`);
    }
  }
}

/** A spell designated by a class feature (Spell Mastery, Signature Spells). */
export interface CharacterSpellDesignation {
  readonly kind: 'spell-mastery' | 'signature-spell';
  /** The designated spell's own level. */
  readonly level: number;
  readonly spellRef: string;
}

/**
 * Structured spell state (eshyra-ug4i.2): which spells the character knows,
 * keeps in a spellbook or has prepared, distinguished by bucket. All entries are
 * canonical `spell:<slug>` refs. `cantrips` is always present once the field
 * exists; the other buckets appear only for classes that use them (`known`:
 * bard/sorcerer/ranger/warlock; `spellbook`: wizard; `prepared`: cleric, druid,
 * paladin, wizard). `CharacterSheet.spells` stays the derived union of every
 * bucket so existing consumers are unchanged.
 */
export interface CharacterSpellcasting {
  readonly cantrips: readonly string[];
  readonly known?: readonly string[];
  readonly spellbook?: readonly string[];
  readonly prepared?: readonly string[];
  /**
   * Domain/oath/circle spells that are always prepared and do not count against
   * the preparation limit (eshyra-odpc). Recomputed from the pack on every
   * long-rest preparation; absent until the first one.
   */
  readonly alwaysPrepared?: readonly string[];
  /** Warlock Mystic Arcanum picks, one per spell level. */
  readonly mysticArcanum?: readonly {
    readonly level: number;
    readonly spellRef: string;
  }[];
  readonly designations?: readonly CharacterSpellDesignation[];
}

const SPELL_REF_PATTERN = /^spell:[^\s]+$/;

/**
 * Validate the shape of a sheet's optional `spellcasting` (old sheets omit it).
 * When `resolveSpellKey` is supplied, every ref must also resolve to the pack's
 * canonical spell key. No ref may sit in two of cantrips/known/spellbook.
 */
export function validateCharacterSheetSpellcasting(
  sheet: CharacterSheet,
  resolveSpellKey?: (ref: string) => string | undefined,
): void {
  const value: unknown = sheet.spellcasting;
  if (value === undefined) return;
  const where = 'character sheet spellcasting';
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${where} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const checkRef = (ref: unknown, path: string): string => {
    if (typeof ref !== 'string' || !SPELL_REF_PATTERN.test(ref)) {
      throw new Error(`${where}.${path} must be a 'spell:' record ref`);
    }
    if (resolveSpellKey !== undefined && resolveSpellKey(ref) !== ref) {
      throw new Error(
        `${where}.${path} '${ref}' is not a canonical pack spell`,
      );
    }
    return ref;
  };
  const refList = (name: string, required: boolean): readonly string[] => {
    const list = record[name];
    if (list === undefined) {
      if (required) throw new Error(`${where}.${name} must be an array`);
      return [];
    }
    if (!Array.isArray(list)) {
      throw new Error(`${where}.${name} must be an array`);
    }
    const refs = list.map((ref, index) => checkRef(ref, `${name}[${index}]`));
    if (new Set(refs).size !== refs.length) {
      throw new Error(`${where}.${name} must not repeat a spell`);
    }
    return refs;
  };
  const cantrips = refList('cantrips', true);
  const known = refList('known', false);
  const spellbook = refList('spellbook', false);
  refList('prepared', false);
  refList('alwaysPrepared', false);
  const seen = new Set<string>();
  for (const ref of [...cantrips, ...known, ...spellbook]) {
    if (seen.has(ref)) {
      throw new Error(
        `${where}: '${ref}' appears in more than one of cantrips/known/spellbook`,
      );
    }
    seen.add(ref);
  }
  const arcanum = record.mysticArcanum;
  if (arcanum !== undefined) {
    if (!Array.isArray(arcanum)) {
      throw new Error(`${where}.mysticArcanum must be an array`);
    }
    for (const [index, entry] of arcanum.entries()) {
      const item = entry as Record<string, unknown> | null;
      if (
        item === null ||
        typeof item !== 'object' ||
        !Number.isInteger(item.level) ||
        (item.level as number) < 1 ||
        (item.level as number) > 9
      ) {
        throw new Error(`${where}.mysticArcanum[${index}].level must be 1-9`);
      }
      checkRef(item.spellRef, `mysticArcanum[${index}].spellRef`);
    }
  }
  const designations = record.designations;
  if (designations !== undefined) {
    if (!Array.isArray(designations)) {
      throw new Error(`${where}.designations must be an array`);
    }
    for (const [index, entry] of designations.entries()) {
      const item = entry as Record<string, unknown> | null;
      if (
        item === null ||
        typeof item !== 'object' ||
        (item.kind !== 'spell-mastery' && item.kind !== 'signature-spell') ||
        !Number.isInteger(item.level) ||
        (item.level as number) < 1 ||
        (item.level as number) > 9
      ) {
        throw new Error(
          `${where}.designations[${index}] must have kind spell-mastery|signature-spell and a level 1-9`,
        );
      }
      checkRef(item.spellRef, `designations[${index}].spellRef`);
    }
  }
}

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
  /** Player-facing identity and source-faithful choices for a custom background. */
  readonly backgroundCustomization?: {
    readonly name: string;
    readonly source: FinalizedRecordRef;
    readonly skillProficiencies: readonly string[];
    readonly toolProficiencies: readonly string[];
    readonly languages: readonly string[];
    readonly feature: FinalizedRecordRef;
  };
  /** Canonical player-selected feat refs, in acquisition order. */
  readonly feats?: readonly FinalizedRecordRef[];
  readonly abilityScores: Readonly<
    Record<AbilityScoreName, FinalizedAbilityScore>
  >;
  /** Immutable canonical F1 rolls; assignment is represented by abilityScores. */
  readonly rolledAbilityScores?: CharacterCreationDraft['rolledAbilityScores'];
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
  /**
   * Option-catalog feature choices made at level-up (fighting style, metamagic,
   * eldritch invocations, pact boon, hunter options), in acquisition order.
   * Optional: sheets that predate it, and characters who have made none, omit
   * it. Level-1 creation records its class-feature picks here too (level 1;
   * eshyra-nnj6.1, see creationClassChoices.ts).
   */
  readonly featureChoices?: readonly CharacterFeatureChoice[];
  /**
   * Structured spell buckets (eshyra-ug4i.2). Optional: absent on sheets that
   * predate it (their flat `spells` list is classified at the first level-up)
   * and on non-casters. When present, `spells` is its derived union.
   * Level-1 creation writes it for classes that cast at level 1 (eshyra-nnj6.1).
   */
  readonly spellcasting?: CharacterSpellcasting;
  readonly metadata: FinalizeMetadata;
}

/** Validate durable rolled creation evidence and its player-owned assignment. */
export function validateCharacterSheetRollEvidence(
  sheet: CharacterSheet,
): void {
  // Every store/registry path that persists or loads a sheet already calls this
  // validator, so the optional `featureChoices` shape check rides along here.
  validateCharacterSheetFeatureChoices(sheet);
  validateCharacterSheetSpellcasting(sheet);
  if (sheet.rolledAbilityScores === undefined) return;
  validateRolledAbilityScoreSet(sheet.rolledAbilityScores);
  const assigned = Object.fromEntries(
    ABILITY_SCORE_NAMES.map((name) => [name, sheet.abilityScores[name].base]),
  );
  if (
    !summarizePoolAssignment(
      sheet.rolledAbilityScores.map((roll) => roll.total),
      assigned,
    ).complete
  ) {
    throw new Error('finalized rolled scores do not match the rolled pool');
  }
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
      requireRecord(resolver.resolveAncestry(draft.selections.ancestry ?? '')),
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

function isStartingWealthResultLike(
  value: unknown,
): value is StartingWealthResult {
  return typeof value === 'object' && value !== null;
}

function validateFinalStartingAcquisition(
  draft: CharacterDraft,
  resolver: RulesPackCharacterResolver,
):
  | { readonly ok: true; readonly value: FinalStartingAcquisition }
  | { readonly ok: false; readonly error: string } {
  const mode =
    draft.selections.startingEquipmentMode === undefined
      ? 'packages'
      : parseStartingEquipmentMode(draft.selections.startingEquipmentMode);
  if (mode === undefined) {
    return { ok: false, error: 'invalid starting acquisition mode' };
  }
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
  // Fail on the truthful reason before asking for evidence: with no table in
  // the active stack there is no roll the draft could have made, and reporting
  // a missing roll would misdescribe why the mode is refused.
  if (!resolver.startingWealthAvailable()) {
    return { ok: false, error: STARTING_WEALTH_UNAVAILABLE_MESSAGE };
  }
  if (result === undefined) {
    return { ok: false, error: 'starting-wealth mode requires one roll' };
  }
  if (!isStartingWealthResultLike(result)) {
    return { ok: false, error: 'invalid starting-wealth evidence' };
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
  const sourceBackgroundRecord =
    selections.background !== undefined && resolver.resolveBackground
      ? optionalRecord(resolver.resolveBackground(selections.background))
      : undefined;
  const backgroundRecord = effectiveBackground(selections, resolver);
  const classRef = toRef(classRecord);
  const ancestryRef = toRef(ancestryRecord);
  const backgroundRef =
    sourceBackgroundRecord !== undefined
      ? toRef(sourceBackgroundRecord)
      : undefined;
  const custom = selections.backgroundCustomization;
  const customFeature = sourceBackgroundRecord?.feature;

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
    ...(custom !== undefined &&
    backgroundRef !== undefined &&
    customFeature !== undefined
      ? {
          backgroundCustomization: {
            name: custom.name.trim(),
            source: backgroundRef,
            skillProficiencies: [...custom.skillProficiencies],
            toolProficiencies: [...custom.toolProficiencies],
            languages: [...custom.languages],
            feature: toRef(customFeature),
          },
        }
      : {}),
    abilityScores,
    ...(selections.rolledAbilityScores === undefined
      ? {}
      : { rolledAbilityScores: selections.rolledAbilityScores }),
    proficiencyBonus: draft.derived.proficiencyBonus,
    maxHitPoints: draft.derived.maxHitPoints as number,
    savingThrows,
    ...(draft.derived.spellSaveDc !== undefined
      ? { spellSaveDc: draft.derived.spellSaveDc }
      : {}),
    ...(draft.derived.spellAttackModifier !== undefined
      ? { spellAttackModifier: draft.derived.spellAttackModifier }
      : {}),
    skillProficiencies: resolveProficiencySet(draft, engine, 'skills', [
      ...(ancestryRecord.skillProficiencies ?? []),
      ...(backgroundRecord?.skillProficiencies ?? []),
    ]),
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
    ...finalSpellState(
      selections.spells ?? [],
      classRecord,
      resolver,
      classFeatureState(engine.mechanicalChoices(draft)),
      selections.preparedSpells ?? [],
    ),
    ...classFeatureState(engine.mechanicalChoices(draft)),
    metadata,
  };
  return finalized;
}

/**
 * The level-1 class-feature picks the draft collected (eshyra-nnj6.1): the
 * subclass and the `featureChoices` entries, built from each satisfied choice's
 * application exactly as level-up persists them.
 */
function classFeatureState(
  entries: readonly MechanicalChoiceState[],
): Pick<CharacterSheet, 'subclass' | 'featureChoices'> {
  let subclass: FinalizedRecordRef | undefined;
  const picks: CharacterFeatureChoice[] = [];
  for (const entry of entries) {
    const application = entry.application;
    if (application === undefined) continue;
    if (application.kind === 'subclass') {
      subclass = application.subclass;
    } else {
      picks.push(application.featureChoice);
    }
  }
  return {
    ...(subclass !== undefined ? { subclass } : {}),
    ...(picks.length > 0 ? { featureChoices: picks } : {}),
  };
}

/**
 * Level-1 spell state (eshyra-nnj6.1). A class that casts at level 1 gets the
 * structured `spellcasting` buckets, classified by the same rule level-up uses
 * for a legacy flat list (`effectiveSpellcasting`): cantrips; known casters'
 * `known`; the Wizard's `spellbook`; other prepared casters' `prepared`. The
 * flat `spells` is the derived union of canonical refs. A class with no level-1
 * casting and no spells keeps the plain list. Always-prepared spells are
 * added by `finalSpellState`.
 */
function spellState(
  chosen: readonly string[],
  classRecord: ResolvedClassData,
  resolver: RulesPackCharacterResolver,
): Pick<CharacterSheet, 'spells' | 'spellcasting'> {
  const preparation = classRecord.spellPreparation;
  const spellcasting = classRecord.level1?.spellcasting;
  const castsAtLevel1 =
    spellcasting !== undefined &&
    (spellcasting.cantripsKnown !== undefined ||
      spellcasting.spellsKnown !== undefined ||
      spellcasting.slots !== undefined ||
      spellcasting.pactSlots !== undefined);
  if (preparation === undefined || (!castsAtLevel1 && chosen.length === 0)) {
    return { spells: [...chosen] };
  }
  const classified = effectiveSpellcasting(
    { spells: chosen } as CharacterSheet,
    classRecord,
    resolver,
  );
  if (!classified.ok) {
    // Unreachable: the draft already rejected unresolvable spells.
    throw new Error(`finalization invariant: ${classified.reason}`);
  }
  const base = classified.spellcasting ?? { cantrips: [] };
  const bucket =
    preparation.kind === 'known'
      ? 'known'
      : preparation.spellbookStartingSpells !== undefined
        ? 'spellbook'
        : 'prepared';
  const structured = { ...base, [bucket]: base[bucket] ?? [] };
  return {
    spells: [...spellsUnion(structured)],
    spellcasting: structured,
  };
}

/**
 * The wizard prepares from the spellbook at creation (eshyra-eb9n.1): the
 * draft-validated subset is written to `prepared`. Other classes are unchanged.
 */
function withWizardPrepared(
  state: Pick<CharacterSheet, 'spells' | 'spellcasting'>,
  classRecord: ResolvedClassData,
  resolver: RulesPackCharacterResolver,
  picks: readonly string[],
): Pick<CharacterSheet, 'spells' | 'spellcasting'> {
  if (
    state.spellcasting === undefined ||
    classRecord.spellPreparation?.spellbookStartingSpells === undefined
  ) {
    return state;
  }
  const prepared: string[] = [];
  for (const pick of picks) {
    const result = resolver.resolveSpell(pick);
    if (!result.ok) {
      throw new Error(`finalization invariant: unknown prepared spell ${pick}`);
    }
    prepared.push(result.record.key);
  }
  const spellcasting: CharacterSpellcasting = {
    ...state.spellcasting,
    prepared,
  };
  return { spells: [...spellsUnion(spellcasting)], spellcasting };
}

/**
 * Level-1 spell state plus the subclass's always-prepared spells (eshyra-kn38):
 * a prepared caster with a creation-time subclass (Life Domain) gets them in
 * `alwaysPrepared`, removed from `prepared` if also picked.
 */
function finalSpellState(
  chosen: readonly string[],
  classRecord: ResolvedClassData,
  resolver: RulesPackCharacterResolver,
  features: Pick<CharacterSheet, 'subclass' | 'featureChoices'>,
  wizardPrepared: readonly string[] = [],
): Pick<CharacterSheet, 'spells' | 'spellcasting'> {
  const state = withWizardPrepared(
    spellState(chosen, classRecord, resolver),
    classRecord,
    resolver,
    wizardPrepared,
  );
  let always: ReturnType<typeof computeAlwaysPrepared>;
  try {
    always = computeAlwaysPrepared(
      { ...features, level: 1 },
      classRecord,
      resolver,
    );
  } catch (error) {
    throw new Error(
      `finalization invariant: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (always.refs.length === 0 || state.spellcasting === undefined) {
    return state;
  }
  const { prepared, ...rest } = state.spellcasting;
  const spellcasting: CharacterSpellcasting = {
    ...rest,
    ...(prepared !== undefined
      ? { prepared: prepared.filter((ref) => !always.refs.includes(ref)) }
      : {}),
    alwaysPrepared: [...always.refs],
  };
  return { spells: [...spellsUnion(spellcasting)], spellcasting };
}

function assertProficiencyInvariant(
  draft: CharacterDraft,
  engine: CharacterCreationEngine,
  classRecord: ResolvedClassData,
  backgroundRecord: ResolvedBackgroundData | undefined,
  ancestryRecord: ResolvedAncestryData,
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
  const skills = resolveProficiencySet(draft, engine, 'skills', [
    ...(ancestryRecord.skillProficiencies ?? []),
    ...(backgroundRecord?.skillProficiencies ?? []),
  ]);
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
    const replacementId = proficiencyReplacementId(kind, value, occurrence - 1);
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
  return effectiveBackground(draft.selections, resolver);
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
    // A class-feature pick that teaches a language (Favored Enemy; eshyra-mdke).
    const application = entry.application;
    if (application?.kind === 'feature-choice') {
      for (const language of application.languages ?? []) {
        if (
          ![...languages].some(
            (l) => l.toLowerCase() === language.toLowerCase(),
          )
        ) {
          languages.add(language);
        }
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
