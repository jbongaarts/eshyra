import { describe, expect, it } from 'vitest';
import {
  type CharacterDraft,
  getDnd5eCharacterCreationEngine,
} from '../src/internal.js';

const engine = getDnd5eCharacterCreationEngine();

function draftWithScores(): CharacterDraft {
  let draft = engine.createDraft({ id: 'd', mode: 'concept-first' });
  draft = engine.setAbilityScoreMethod(draft, 'point_buy');
  draft = engine.setAbilityScores(draft, {
    strength: 15,
    dexterity: 14,
    constitution: 14,
    intelligence: 10,
    wisdom: 10,
    charisma: 8,
  });
  return draft;
}

describe('character draft derived values (engine integration)', () => {
  it('recomputes HP when class is chosen, and again when Constitution changes', () => {
    let draft = draftWithScores();
    expect(draft.derived.maxHitPoints).toBeUndefined();

    draft = engine.setClass(draft, 'Fighter');
    // Fighter d10 + CON 14 (+2) = 12.
    expect(draft.derived.maxHitPoints).toBe(12);

    draft = engine.setAbilityScore(draft, 'constitution', 10);
    // CON 10 (+0) → 10.
    expect(draft.derived.maxHitPoints).toBe(10);
  });

  it('recomputes saving throws when the class changes', () => {
    let draft = draftWithScores();
    draft = engine.setClass(draft, 'Fighter');
    expect(draft.derived.savingThrows.constitution?.proficient).toBe(true);
    expect(draft.derived.savingThrows.charisma?.proficient).toBe(false);

    draft = engine.setClass(draft, 'Sorcerer');
    // Sorcerer saves are Constitution and Charisma.
    expect(draft.derived.savingThrows.charisma?.proficient).toBe(true);
    expect(draft.derived.savingThrows.strength?.proficient).toBe(false);
  });

  it('keeps no nonsense HP error while prerequisites are incomplete', () => {
    const draft = draftWithScores();
    // Scores present, class absent → HP pending, never an error.
    const pending = draft.diagnostics.find((d) => d.field === 'maxHitPoints');
    expect(pending?.severity).toBe('pending');
    expect(
      draft.diagnostics.some(
        (d) => d.field === 'maxHitPoints' && d.severity === 'error',
      ),
    ).toBe(false);
  });

  it('does not populate saving throws before a class is chosen', () => {
    const draft = draftWithScores();
    expect(draft.derived.savingThrows).toEqual({});
  });
});
