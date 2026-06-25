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

  it('applies fixed ancestry ability increases to final scores and HP', () => {
    let draft = draftWithScores();
    draft = engine.setClass(draft, 'Fighter');
    // Base CON 14 → Fighter d10 + (+2) = 12; base STR 15 → final 15.
    expect(draft.derived.maxHitPoints).toBe(12);
    expect(draft.derived.finalAbilityScores.strength).toBe(15);

    draft = engine.setAncestry(draft, 'Hill Dwarf');
    // Hill Dwarf: +2 CON (14 → 16, mod +3) and +1 WIS (10 → 11).
    expect(draft.derived.finalAbilityScores.constitution).toBe(16);
    expect(draft.derived.finalAbilityScores.wisdom).toBe(11);
    // HP re-derives off the raised Constitution: d10 + 3 = 13.
    expect(draft.derived.maxHitPoints).toBe(13);
    expect(draft.derived.savingThrows.constitution?.modifier).toBe(5);
  });

  it('leaves base scores unchanged for an ancestry with no increase to a score', () => {
    let draft = draftWithScores();
    draft = engine.setAncestry(draft, 'Elf');
    // Elf grants only +2 DEX; everything else stays at its base score.
    expect(draft.derived.finalAbilityScores.dexterity).toBe(16);
    expect(draft.derived.finalAbilityScores.strength).toBe(15);
    expect(draft.derived.finalAbilityScores.constitution).toBe(14);
  });
});
