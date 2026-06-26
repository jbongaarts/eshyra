import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import {
  DEFAULT_DND5E_SRD_BINDING,
  readCampaignRulesBinding,
} from '../rules/binding.js';
import {
  ensureCharacterRow,
  setActiveCharacterId,
} from '../state/activeCharacter.js';
import {
  type MutateStateInput,
  mutateStateBatch,
} from '../state/mutateState.js';
import {
  ABILITY_SCORE_NAMES,
  abilityModifier,
  FREE_ENTRY_MAX_SCORE,
  FREE_ENTRY_MIN_SCORE,
  isPlausibleFreeEntryScore,
  POINT_BUY_BUDGET,
  pointBuyCost,
  STANDARD_ARRAY,
} from './abilities.js';
import type { FinalizedCharacter } from './finalizeCharacter.js';
import type {
  CreatedPathfinderCharacter,
  PathfinderCharacterDraft,
} from './pathfinder2e.js';
import {
  PathfinderCharacterCreationError,
  validatePathfinderCharacterDraft,
} from './pathfinder2e.js';
import {
  getBundledDnd5eCharacterResolver,
  type ResolvedClassData,
  type RulesPackCharacterResolver,
} from './rulesPackResolver.js';

/**
 * The rules system the character creator is dispatching for. The string set
 * mirrors the `systemId` field on bundled rules packs; unsupported systems
 * surface a correction response rather than a thrown error.
 */
export type CharacterCreationSystem = 'dnd5e-srd' | 'pathfinder2e-remaster';

export type AbilityScoreName =
  | 'strength'
  | 'dexterity'
  | 'constitution'
  | 'intelligence'
  | 'wisdom'
  | 'charisma';

/**
 * How a character's base ability scores were produced. `point_buy` and
 * `standard_array` carry total/value constraints validated here; `manual`
 * (hand-entered) and `rolled` (dice-given or imported) are constraint-free
 * apart from a plausibility bound, but are still recorded distinctly so the
 * draft never treats a rolled 18 as if it had been point-bought.
 */
export type AbilityScoreMethod =
  | 'point_buy'
  | 'standard_array'
  | 'manual'
  | 'rolled';

export type AbilityScores = Readonly<Record<AbilityScoreName, number>>;

export interface CharacterCreationDraft {
  readonly name: string;
  readonly ancestry: string;
  readonly className: string;
  readonly level: number;
  readonly abilityScoreMethod: AbilityScoreMethod;
  readonly abilityScores: AbilityScores;
  readonly maxHitPoints: number;
  readonly spells: readonly string[];
}

export interface CreatedCharacter {
  readonly name: string;
  readonly ancestry: string;
  readonly className: string;
  readonly level: number;
  readonly abilityScores: AbilityScores;
  readonly maxHitPoints: number;
  readonly spells: readonly string[];
}

export interface CharacterCreationResult {
  readonly ok: true;
  readonly character: CreatedCharacter;
}

export interface CharacterCreationMutationMetadata {
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
}

export interface CompleteCharacterCreationInput {
  readonly draft: CharacterCreationDraft | PathfinderCharacterDraft;
  readonly sessionId: string;
  readonly at: string;
  readonly provenance?: string;
  readonly characterId?: string;
}

export type CompleteCharacterCreationResult =
  | {
      readonly ok: true;
      readonly character: CreatedCharacter;
      readonly mutationsApplied: number;
      readonly prompt: string;
    }
  | {
      readonly ok: false;
      readonly errors: readonly string[];
      readonly prompt: string;
    };

export interface ImportFinalizedCharacterInput {
  readonly character: FinalizedCharacter;
  readonly sessionId: string;
  readonly at: string;
  readonly provenance?: string;
  readonly characterId?: string;
}

export class CharacterCreationError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(`Invalid character creation draft: ${errors.join('; ')}`);
    this.name = 'CharacterCreationError';
    this.errors = errors;
  }
}

export function validateCharacterDraft(
  draft: CharacterCreationDraft,
  resolver: RulesPackCharacterResolver = getBundledDnd5eCharacterResolver(),
): CharacterCreationResult {
  const errors: string[] = [];
  const characterClass = validateClass(draft, resolver, errors);
  validateIdentity(draft, resolver, errors);
  validateAbilityScores(draft, errors);
  validateHitPoints(draft, characterClass, errors);
  validateSpells(draft, characterClass.name, resolver, errors);

  if (errors.length > 0) {
    throw new CharacterCreationError(errors);
  }

  return {
    ok: true,
    character: {
      name: draft.name.trim(),
      ancestry: draft.ancestry.trim(),
      className: characterClass.name,
      level: draft.level,
      abilityScores: draft.abilityScores,
      maxHitPoints: draft.maxHitPoints,
      spells: [...draft.spells],
    },
  };
}

export function buildCharacterCreationMutations(
  draft: CharacterCreationDraft,
  metadata: CharacterCreationMutationMetadata,
  resolver: RulesPackCharacterResolver = getBundledDnd5eCharacterResolver(),
  characterId = 'pc-1',
): MutateStateInput[] {
  const { character } = validateCharacterDraft(draft, resolver);
  return characterMutations(character, metadata, characterId);
}

export function completeCharacterCreation(
  db: Db,
  input: CompleteCharacterCreationInput,
  resolver: RulesPackCharacterResolver = getBundledDnd5eCharacterResolver(),
): CompleteCharacterCreationResult {
  const system = resolveCampaignSystem(db);

  if (system === 'pathfinder2e-remaster') {
    return completePathfinderCharacterCreation(db, input);
  }

  if (system !== 'dnd5e-srd') {
    return correctionResult([
      `character creation for rules system '${system}' is not yet implemented`,
    ]);
  }

  try {
    const { character } = validateCharacterDraft(
      input.draft as CharacterCreationDraft,
      resolver,
    );

    const charId = input.characterId ?? 'pc-1';
    const metadata = {
      provenance: input.provenance ?? 'character_creation:complete',
      sessionId: input.sessionId,
      at: input.at,
    };
    const mutations = characterMutations(character, metadata, charId);

    withTransaction(db, (txnDb) => {
      ensureCharacterRow(
        txnDb,
        charId,
        metadata.provenance,
        metadata.sessionId,
        metadata.at,
      );
      mutateStateBatch(txnDb, mutations);
      setActiveCharacterId(txnDb, charId);
    });

    return {
      ok: true,
      character,
      mutationsApplied: mutations.length,
      prompt: completionPrompt(character),
    };
  } catch (error) {
    if (error instanceof CharacterCreationError) {
      return correctionResult(error.errors);
    }

    throw error;
  }
}

export function importFinalizedCharacter(
  db: Db,
  input: ImportFinalizedCharacterInput,
): CompleteCharacterCreationResult {
  const system = resolveCampaignSystem(db);

  if (system !== 'dnd5e-srd') {
    return correctionResult([
      `finalized character import for rules system '${system}' is not yet implemented`,
    ]);
  }
  if (input.character.system !== 'dnd5e-srd') {
    return correctionResult([
      `finalized character system '${input.character.system}' is not compatible with this campaign`,
    ]);
  }

  const charId = input.characterId ?? 'pc-1';
  const metadata = {
    provenance: input.provenance ?? 'character_creation:import_finalized',
    sessionId: input.sessionId,
    at: input.at,
  };
  const character = finalizedCharacterProjection(input.character);
  const mutations = characterMutations(character, metadata, charId);

  withTransaction(db, (txnDb) => {
    ensureCharacterRow(
      txnDb,
      charId,
      metadata.provenance,
      metadata.sessionId,
      metadata.at,
    );
    mutateStateBatch(txnDb, mutations);
    setActiveCharacterId(txnDb, charId);
  });

  return {
    ok: true,
    character,
    mutationsApplied: mutations.length,
    prompt: completionPrompt(character),
  };
}

function completePathfinderCharacterCreation(
  db: Db,
  input: CompleteCharacterCreationInput,
): CompleteCharacterCreationResult {
  try {
    const { character } = validatePathfinderCharacterDraft(
      input.draft as PathfinderCharacterDraft,
    );

    const charId = input.characterId ?? 'pc-1';
    const metadata = {
      provenance: input.provenance ?? 'character_creation:complete',
      sessionId: input.sessionId,
      at: input.at,
    };
    const mutations = pathfinderCharacterMutations(character, metadata, charId);

    withTransaction(db, (txnDb) => {
      ensureCharacterRow(
        txnDb,
        charId,
        metadata.provenance,
        metadata.sessionId,
        metadata.at,
      );
      mutateStateBatch(txnDb, mutations);
      setActiveCharacterId(txnDb, charId);
    });

    const projection: CreatedCharacter = {
      name: character.name,
      ancestry: character.ancestry,
      className: character.className,
      level: character.level,
      abilityScores: character.abilityScores,
      maxHitPoints: character.maxHitPoints,
      spells: character.spells,
    };

    return {
      ok: true,
      character: projection,
      mutationsApplied: mutations.length,
      prompt: pathfinderCompletionPrompt(character),
    };
  } catch (error) {
    if (error instanceof PathfinderCharacterCreationError) {
      return correctionResult(error.errors);
    }
    throw error;
  }
}

function pathfinderCharacterMutations(
  character: CreatedPathfinderCharacter,
  metadata: CharacterCreationMutationMetadata,
  characterId: string,
): MutateStateInput[] {
  const base = {
    target: 'character',
    id: characterId,
    op: 'set',
    provenance: metadata.provenance,
    sessionId: metadata.sessionId,
    at: metadata.at,
  } as const;

  return [
    { ...base, field: 'name', value: character.name },
    { ...base, field: 'ancestry', value: character.ancestry },
    { ...base, field: 'class_name', value: character.className },
    { ...base, field: 'level', value: character.level },
    { ...base, field: 'hp_current', value: character.maxHitPoints },
    { ...base, field: 'hp_max', value: character.maxHitPoints },
    {
      ...base,
      field: 'ability_scores_json',
      value: JSON.stringify(character.abilityScores),
    },
    { ...base, field: 'conditions_json', value: JSON.stringify([]) },
  ];
}

function pathfinderCompletionPrompt(
  character: CreatedPathfinderCharacter,
): string {
  return `Character creation complete: ${character.name} is a level ${character.level} ${character.ancestry} ${character.className} (${character.background}; class feat ${character.classFeat}, ancestry feat ${character.ancestryFeat}).`;
}

/**
 * Resolve the rules system from the campaign's persisted binding, falling
 * back to D&D SRD when no binding row exists (legacy DBs at the current
 * schema version). Unknown systems surface as the raw systemId string so the
 * dispatcher can produce a clear correction message.
 */
function resolveCampaignSystem(db: Db): string {
  const binding = readCampaignRulesBinding(db) ?? DEFAULT_DND5E_SRD_BINDING;
  return binding.base.systemId;
}

function validateIdentity(
  draft: CharacterCreationDraft,
  resolver: RulesPackCharacterResolver,
  errors: string[],
): void {
  if (draft.name.trim().length === 0) {
    errors.push('character name is required');
  }
  if (resolver.resolveAncestry(draft.ancestry.trim()).ok === false) {
    errors.push(`unsupported SRD ancestry: ${draft.ancestry}`);
  }
  if (draft.level !== 1) {
    errors.push('character creation currently supports level 1 only');
  }
}

function correctionResult(
  errors: readonly string[],
): CompleteCharacterCreationResult {
  return {
    ok: false,
    errors,
    prompt: `Revise the character draft before persisting it: ${errors.join('; ')}`,
  };
}

function completionPrompt(character: CreatedCharacter): string {
  return `Character creation complete: ${character.name} is a level ${character.level} ${character.ancestry} ${character.className}.`;
}

function finalizedCharacterProjection(
  character: FinalizedCharacter,
): CreatedCharacter {
  return {
    name: character.identity.name,
    ancestry: character.ancestry.name,
    className: character.class.name,
    level: character.level,
    abilityScores: {
      strength: character.abilityScores.strength.final,
      dexterity: character.abilityScores.dexterity.final,
      constitution: character.abilityScores.constitution.final,
      intelligence: character.abilityScores.intelligence.final,
      wisdom: character.abilityScores.wisdom.final,
      charisma: character.abilityScores.charisma.final,
    },
    maxHitPoints: character.maxHitPoints,
    spells: character.spells,
  };
}

function characterMutations(
  character: CreatedCharacter,
  metadata: CharacterCreationMutationMetadata,
  characterId: string,
): MutateStateInput[] {
  const base = {
    target: 'character',
    id: characterId,
    op: 'set',
    provenance: metadata.provenance,
    sessionId: metadata.sessionId,
    at: metadata.at,
  } as const;

  return [
    { ...base, field: 'name', value: character.name },
    { ...base, field: 'ancestry', value: character.ancestry },
    { ...base, field: 'class_name', value: character.className },
    { ...base, field: 'level', value: character.level },
    { ...base, field: 'hp_current', value: character.maxHitPoints },
    { ...base, field: 'hp_max', value: character.maxHitPoints },
    {
      ...base,
      field: 'ability_scores_json',
      value: JSON.stringify(character.abilityScores),
    },
    { ...base, field: 'conditions_json', value: JSON.stringify([]) },
  ];
}

function validateClass(
  draft: CharacterCreationDraft,
  resolver: RulesPackCharacterResolver,
  errors: string[],
): ResolvedClassData {
  const result = resolver.resolveClass(draft.className);
  if (!result.ok) {
    errors.push(`unsupported SRD class: ${draft.className}`);
    return fallbackClass();
  }

  return result.record;
}

function validateAbilityScores(
  draft: CharacterCreationDraft,
  errors: string[],
): void {
  const scores = ABILITY_SCORE_NAMES.map((name) => draft.abilityScores[name]);
  if (scores.some((score) => !Number.isInteger(score))) {
    errors.push('ability scores must be integers');
    return;
  }

  switch (draft.abilityScoreMethod) {
    case 'point_buy':
      validatePointBuy(scores, errors);
      return;
    case 'standard_array':
      validateStandardArray(scores, errors);
      return;
    default:
      // `manual` / `rolled`: no total constraint, only a plausibility bound.
      validateFreeEntry(scores, errors);
  }
}

function validateFreeEntry(scores: readonly number[], errors: string[]): void {
  for (const score of scores) {
    if (!isPlausibleFreeEntryScore(score)) {
      errors.push(
        `ability score out of range (${FREE_ENTRY_MIN_SCORE}-${FREE_ENTRY_MAX_SCORE}): ${score}`,
      );
    }
  }
}

function validatePointBuy(scores: readonly number[], errors: string[]): void {
  let total = 0;
  for (const score of scores) {
    const cost = pointBuyCost(score);
    if (cost === undefined) {
      errors.push(
        `point-buy score must be between 8 and 15 before bonuses: ${score}`,
      );
      return;
    }
    total += cost;
  }

  if (total > POINT_BUY_BUDGET) {
    errors.push(`point-buy total exceeds ${POINT_BUY_BUDGET}: ${total}`);
  }
}

function validateStandardArray(
  scores: readonly number[],
  errors: string[],
): void {
  const actual = [...scores].sort((left, right) => right - left);
  if (!STANDARD_ARRAY.every((score, index) => actual[index] === score)) {
    errors.push('standard-array scores must be 15, 14, 13, 12, 10, and 8');
  }
}

function validateHitPoints(
  draft: CharacterCreationDraft,
  characterClass: ResolvedClassData,
  errors: string[],
): void {
  const expected =
    characterClass.hitDie + abilityModifier(draft.abilityScores.constitution);
  if (draft.maxHitPoints !== expected) {
    errors.push(`level-1 hit point maximum must be ${expected}`);
  }
}

function validateSpells(
  draft: Pick<CharacterCreationDraft, 'spells'>,
  className: string,
  resolver: RulesPackCharacterResolver,
  errors: string[],
): void {
  for (const spellNameOrRef of draft.spells) {
    const result = resolver.resolveSpell(spellNameOrRef);
    if (!result.ok) {
      errors.push(`unsupported SRD spell: ${spellNameOrRef}`);
      continue;
    }

    if (!result.record.classes.includes(className)) {
      errors.push(`${result.record.name} is not legal for ${className}`);
    }
  }
}

function fallbackClass(): ResolvedClassData {
  return {
    key: 'class:invalid',
    name: 'Invalid',
    hitDie: 0,
    primaryAbilities: [],
    savingThrowProficiencies: [],
  };
}
