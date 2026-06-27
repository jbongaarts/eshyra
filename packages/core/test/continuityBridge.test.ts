import { describe, expect, it } from 'vitest';
import { ABILITY_SCORE_NAMES } from '../src/character/abilities.js';
import type { AbilityScoreName } from '../src/character/creation.js';
import type {
  CharacterSheet,
  FinalizedAbilityScore,
} from '../src/character/finalizeCharacter.js';
import {
  composeContinuityBridge,
  DND5E_SRD_PACK_ID,
  DND5E_SRD_SYSTEM_ID,
  summarizeSheetForBridge,
} from '../src/internal.js';
import type { ModelClient, ModelCompleteInput } from '../src/model/client.js';

function makeSheet(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const abilityScores = {} as Record<AbilityScoreName, FinalizedAbilityScore>;
  const savingThrows = {} as CharacterSheet['savingThrows'];
  for (const name of ABILITY_SCORE_NAMES) {
    abilityScores[name] = { base: 12, final: 12, modifier: 1 };
    savingThrows[name] = { modifier: 1, proficient: false };
  }
  return {
    schemaVersion: 1,
    system: DND5E_SRD_SYSTEM_ID,
    rulesPackId: DND5E_SRD_PACK_ID,
    recipeId: 'dnd5e-srd:concept-first',
    creationMode: 'concept-first',
    level: 5,
    identity: { name: 'Kael' },
    class: { key: 'class:fighter', name: 'Fighter' },
    ancestry: { key: 'ancestry:human', name: 'Human' },
    abilityScores,
    proficiencyBonus: 3,
    maxHitPoints: 44,
    savingThrows,
    skillProficiencies: [],
    toolProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    equipment: [],
    languages: ['Common'],
    spells: [],
    metadata: { createdAt: '2026-06-27T00:00:00.000Z' },
    ...overrides,
  };
}

/** A model stub that records the last call and returns canned text. */
function stubModel(text: string): {
  model: ModelClient;
  calls: ModelCompleteInput[];
} {
  const calls: ModelCompleteInput[] = [];
  return {
    calls,
    model: {
      complete: async (input) => {
        calls.push(input);
        return { text };
      },
    },
  };
}

describe('summarizeSheetForBridge', () => {
  it('renders a one-line mechanical summary', () => {
    expect(summarizeSheetForBridge(makeSheet())).toBe(
      'level 5 Human Fighter, 44 max HP',
    );
  });
});

describe('composeContinuityBridge', () => {
  it('feeds prior + new summaries and scene context to the model', async () => {
    const { model, calls } = stubModel(
      '  Kael returns, road-worn but steadier. ',
    );
    const text = await composeContinuityBridge(model, {
      characterName: 'Kael',
      priorSummary: summarizeSheetForBridge(makeSheet({ level: 1 })),
      newSummary: summarizeSheetForBridge(makeSheet()),
      sceneContext: 'Scene: The Tavern',
      campaignId: 'camp-a',
    });

    // Result is trimmed verbatim model text.
    expect(text).toBe('Kael returns, road-worn but steadier.');
    expect(calls).toHaveLength(1);
    const userContent = calls[0]?.messages[0]?.content ?? '';
    expect(userContent).toContain('Kael');
    expect(userContent).toContain('When the party last saw them');
    expect(userContent).toContain('Scene: The Tavern');
    expect(calls[0]?.trace?.extra?.purpose).toBe('continuity_bridge');
  });

  it('omits the prior-state line when no prior summary is given', async () => {
    const { model, calls } = stubModel('A bridge.');
    await composeContinuityBridge(model, {
      characterName: 'Kael',
      newSummary: 'level 5 Human Fighter, 44 max HP',
    });
    expect(calls[0]?.messages[0]?.content ?? '').not.toContain(
      'When the party last saw them',
    );
  });
});
