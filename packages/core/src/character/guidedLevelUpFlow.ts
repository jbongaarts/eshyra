/**
 * Guided level-up orchestration (eshyra-lupf.10).
 *
 * This is the UI-agnostic flow that the CLI/session command layer renders in
 * eshyra-lupf.11. It validates level-up eligibility, surfaces required choices,
 * previews the deterministic change set, and commits only after explicit
 * confirmation. It never asks the model to infer mechanics.
 */

import type { Db } from '../persistence/db.js';
import {
  DEFAULT_DND5E_SRD_BINDING,
  readCampaignRulesBinding,
} from '../rules/binding.js';
import { resolveCharacterId } from '../state/activeCharacter.js';
import type { LevelUpEligibility } from '../state/levelUpEligibility.js';
import { getLevelUpEligibility } from '../state/levelUpEligibility.js';
import type { CharacterSheetStore } from './characterSheetStore.js';
import type { CharacterSheet } from './finalizeCharacter.js';
import {
  type ApplyLevelUpResult,
  applyLevelUp,
  type LevelUpChangeSet,
  type LevelUpChoiceSelections,
  LevelUpEngineError,
  type LevelUpRequiredChoice,
  previewLevelUpChangeSet,
} from './levelUpEngine.js';
import {
  getBundledDnd5eCharacterResolver,
  type RulesPackCharacterResolver,
} from './rulesPackResolver.js';

export type GuidedLevelUpOutcome =
  | 'not-eligible'
  | 'needs-choices'
  | 'blocked'
  | 'preview'
  | 'cancelled'
  | 'committed';

export type GuidedLevelUpResult =
  | {
      readonly outcome: 'not-eligible';
      readonly characterId: string;
      readonly eligibility: LevelUpEligibility;
    }
  | {
      readonly outcome: 'needs-choices' | 'blocked';
      readonly characterId: string;
      readonly eligibility: LevelUpEligibility;
      readonly requiredChoices: readonly LevelUpRequiredChoice[];
    }
  | {
      readonly outcome: 'preview' | 'cancelled';
      readonly characterId: string;
      readonly eligibility: LevelUpEligibility;
      readonly requiredChoices: readonly LevelUpRequiredChoice[];
      readonly changeSet: LevelUpChangeSet;
    }
  | {
      readonly outcome: 'committed';
      readonly characterId: string;
      readonly eligibility: LevelUpEligibility;
      readonly requiredChoices: readonly LevelUpRequiredChoice[];
      readonly changeSet: LevelUpChangeSet;
      readonly sheet: CharacterSheet;
      readonly applyResult: ApplyLevelUpResult;
    };

export interface GuidedLevelUpInput {
  readonly store: CharacterSheetStore;
  readonly characterId?: string;
  readonly resolver?: RulesPackCharacterResolver;
  readonly choices?: LevelUpChoiceSelections;
  /**
   * `undefined` means "show the preview and wait for the caller to ask again";
   * `false` means the player saw the preview and declined; `true` commits.
   */
  readonly confirm?: boolean;
  readonly source: string;
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
}

export function runGuidedLevelUp(
  db: Db,
  input: GuidedLevelUpInput,
): GuidedLevelUpResult {
  const characterId = resolveCharacterId(db, input.characterId);
  const eligibility = getLevelUpEligibility(db, characterId);
  if (!eligibility.eligible) {
    return { outcome: 'not-eligible', characterId, eligibility };
  }

  const resolver = input.resolver ?? getBundledDnd5eCharacterResolver();
  const binding = readCampaignRulesBinding(db) ?? DEFAULT_DND5E_SRD_BINDING;
  const sheet = input.store.load(characterId);
  if (sheet === undefined) {
    throw new LevelUpEngineError(
      `no character sheet stored for '${characterId}'`,
    );
  }
  if (sheet.level !== eligibility.currentLevel) {
    throw new LevelUpEngineError(
      `level-up sheet/live level mismatch for '${characterId}': sheet is level ${sheet.level}, live progression is level ${eligibility.currentLevel}`,
    );
  }

  const preview = previewLevelUpChangeSet(sheet, {
    resolver,
    binding,
    choices: input.choices,
  });
  if (!preview.ok) {
    return {
      outcome: hasUnsupportedChoice(preview.requiredChoices)
        ? 'blocked'
        : 'needs-choices',
      characterId,
      eligibility,
      requiredChoices: preview.requiredChoices,
    };
  }

  if (input.confirm === undefined) {
    return {
      outcome: 'preview',
      characterId,
      eligibility,
      requiredChoices: preview.requiredChoices,
      changeSet: preview.changeSet,
    };
  }
  if (!input.confirm) {
    return {
      outcome: 'cancelled',
      characterId,
      eligibility,
      requiredChoices: preview.requiredChoices,
      changeSet: preview.changeSet,
    };
  }

  const applyResult = applyLevelUp(db, {
    store: input.store,
    characterId,
    resolver,
    choices: input.choices,
    source: input.source,
    provenance: input.provenance,
    sessionId: input.sessionId,
    at: input.at,
  });
  return {
    outcome: 'committed',
    characterId,
    eligibility,
    requiredChoices: preview.requiredChoices,
    changeSet: applyResult.changeSet,
    sheet: applyResult.sheet,
    applyResult,
  };
}

function hasUnsupportedChoice(
  choices: readonly LevelUpRequiredChoice[],
): boolean {
  return choices.some((choice) => choice.status === 'unsupported');
}
