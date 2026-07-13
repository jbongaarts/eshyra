import { describe, expect, it } from 'vitest';
import { getDnd5eCharacterCreationEngine } from '../src/internal.js';

describe('creation proficiency replacement invariants', () => {
  it('reserves later ordinary grants and earlier valid replacements', () => {
    const engine = getDnd5eCharacterCreationEngine();
    let draft = engine.createDraft({
      id: 'replacements',
      mode: 'concept-first',
    });
    draft = engine.setClass(draft, 'Cleric');
    draft = engine.setBackground(draft, 'Acolyte');
    draft = engine.setChoice(draft, 'class.skills', ['Insight', 'Religion']);
    const first = engine
      .mechanicalChoices(draft)
      .find(
        (entry) =>
          entry.choice.id === 'proficiency-replacement.skills.insight.1',
      );
    const second = engine
      .mechanicalChoices(draft)
      .find(
        (entry) =>
          entry.choice.id === 'proficiency-replacement.skills.religion.1',
      );
    expect(first?.choice.from).not.toContain('Religion');
    expect(second?.choice.from).not.toContain('Insight');
    draft = engine.setChoice(draft, first?.choice.id ?? '', ['Acrobatics']);
    const recomputedSecond = engine
      .mechanicalChoices(draft)
      .find((entry) => entry.choice.id === second?.choice.id);
    expect(recomputedSecond?.choice.from).not.toContain('Acrobatics');
  });

  it('does not reserve an invalid stored replacement or retain obsolete ids', () => {
    const engine = getDnd5eCharacterCreationEngine();
    let draft = engine.createDraft({ id: 'stale', mode: 'concept-first' });
    draft = engine.setClass(draft, 'Cleric');
    draft = engine.setBackground(draft, 'Acolyte');
    draft = engine.setChoice(draft, 'class.skills', ['History', 'Insight']);
    draft = engine.setChoice(
      draft,
      'proficiency-replacement.skills.insight.1',
      ['Religion'],
    );
    const replacement = engine
      .mechanicalChoices(draft)
      .find(
        (entry) =>
          entry.choice.id === 'proficiency-replacement.skills.insight.1',
      );
    expect(replacement?.satisfied).toBe(false);
    expect(replacement?.choice.from).not.toContain('Religion');
    draft = engine.setClass(draft, 'Fighter');
    draft = engine.setBackground(draft, undefined);
    expect(Object.keys(draft.selections.choices ?? {})).not.toContain(
      'proficiency-replacement.skills.insight.1',
    );
  });
});
