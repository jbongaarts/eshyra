import { describe, expect, it } from 'vitest';
import {
  type CharacterDraft,
  finalizeCharacterDraft,
  getBundledDnd5eCharacterResolver,
  getDnd5eCharacterCreationEngine,
} from '../src/internal.js';

/**
 * Level-1 spell counts and wizard preparation at creation (eshyra-eb9n.1),
 * against the real bundled SRD pack.
 */
const engine = getDnd5eCharacterCreationEngine();
const resolver = getBundledDnd5eCharacterResolver();
const META = { createdAt: '2026-10-09T00:00:00.000Z', source: 'test' } as const;

function baseDraft(className: string): CharacterDraft {
  let draft = engine.createDraft({ id: 'hero', mode: 'concept-first' });
  draft = engine.setIdentity(draft, { name: 'Test Hero' });
  draft = engine.setClass(draft, className);
  draft = engine.setAncestry(draft, 'Human');
  draft = engine.setAbilityScoreMethod(draft, 'point_buy');
  draft = engine.setAbilityScores(draft, {
    strength: 15,
    dexterity: 14,
    constitution: 13,
    intelligence: 12,
    wisdom: 10,
    charisma: 8,
  });
  for (let guard = 0; guard < 40; guard += 1) {
    const next = engine
      .mechanicalChoices(draft)
      .find((e) => !e.satisfied && e.choice.status === 'structured');
    if (next === undefined) break;
    draft = engine.setChoice(
      draft,
      next.choice.id,
      (next.choice.from ?? []).slice(0, next.choice.choose ?? 0),
    );
  }
  return draft;
}

function names(className: string, level: number, n: number): string[] {
  return resolver
    .listSpells()
    .filter((s) => s.level === level && s.classes.includes(className))
    .slice(0, n)
    .map((s) => s.name);
}

const withSpells = (
  draft: CharacterDraft,
  className: string,
  cantrips: number,
  level1: number,
) =>
  engine.setSpells(draft, [
    ...names(className, 0, cantrips),
    ...names(className, 1, level1),
  ]);

const finalizes = (draft: CharacterDraft) =>
  finalizeCharacterDraft(draft, META).ok;
const problems = (draft: CharacterDraft) => {
  const result = finalizeCharacterDraft(draft, META);
  return result.ok
    ? []
    : [...result.missing.map((m) => m.label), ...result.errors];
};

describe('wizard spell counts and preparation', () => {
  it('finalizes 3 cantrips + 6 spellbook + prepared within INT+1', () => {
    let draft = withSpells(baseDraft('Wizard'), 'Wizard', 3, 6);
    draft = engine.setPreparedSpells(draft, names('Wizard', 1, 2));
    const result = finalizeCharacterDraft(draft, META);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sc = result.character.spellcasting;
    expect(sc?.cantrips).toHaveLength(3);
    expect(sc?.spellbook).toHaveLength(6);
    expect(sc?.prepared).toHaveLength(2);
  });

  it('refuses a five-spell spellbook and requires a preparation', () => {
    let draft = withSpells(baseDraft('Wizard'), 'Wizard', 3, 5);
    draft = engine.setPreparedSpells(draft, names('Wizard', 1, 1));
    expect(problems(draft).join(' ')).toMatch(/spellbook \(5 chosen\)/);
    draft = withSpells(baseDraft('Wizard'), 'Wizard', 3, 6);
    expect(problems(draft).join(' ')).toMatch(/Prepare between 1 and 2/);
  });

  it('refuses preparing over the limit or outside the spellbook', () => {
    const spellbook = withSpells(baseDraft('Wizard'), 'Wizard', 3, 6);
    const over = engine.setPreparedSpells(spellbook, names('Wizard', 1, 3));
    expect(finalizes(over)).toBe(false);
    expect(problems(over).join(' ')).toMatch(/Too many prepared/);
    const outside = engine.setPreparedSpells(spellbook, [
      names('Wizard', 1, 7)[6] as string,
    ]);
    expect(finalizes(outside)).toBe(false);
    expect(problems(outside).join(' ')).toMatch(/not in your spellbook/);
  });

  it('marks the preparation stale when the spellbook changes', () => {
    let draft = withSpells(baseDraft('Wizard'), 'Wizard', 3, 6);
    draft = engine.setPreparedSpells(draft, names('Wizard', 1, 1));
    expect(draft.stale).not.toContain('preparedSpells');
    const [dropped] = names('Wizard', 1, 1);
    const swapped = engine.setSpells(draft, [
      ...names('Wizard', 0, 3),
      ...names('Wizard', 1, 7)
        .filter((n) => n !== dropped)
        .slice(0, 6),
    ]);
    expect(swapped.stale).toContain('preparedSpells');
    expect(finalizes(swapped)).toBe(false);
  });
});

describe('known and prepared-list casters', () => {
  it('sorcerer: 4 cantrips + 2 known, wrong counts refused', () => {
    const base = baseDraft('Sorcerer');
    expect(finalizes(withSpells(base, 'Sorcerer', 4, 2))).toBe(true);
    expect(finalizes(withSpells(base, 'Sorcerer', 3, 2))).toBe(false);
    expect(finalizes(withSpells(base, 'Sorcerer', 4, 1))).toBe(false);
    expect(finalizes(withSpells(base, 'Sorcerer', 5, 2))).toBe(false);
    expect(finalizes(withSpells(base, 'Sorcerer', 4, 3))).toBe(false);
    expect(finalizes(base)).toBe(false);
  });

  it('cleric: 0 prepared and over-limit refused; Life Domain bless not counted', () => {
    let base = baseDraft('Cleric');
    base = engine.setChoice(base, 'class.subclass', ['Life Domain']);
    const cantrips = names('Cleric', 0, 3);
    expect(finalizes(engine.setSpells(base, cantrips))).toBe(false);
    // WIS 11 -> limit 1.
    expect(
      finalizes(engine.setSpells(base, [...cantrips, 'Bane', 'Command'])),
    ).toBe(false);
    expect(finalizes(engine.setSpells(base, [...cantrips, 'Bane']))).toBe(true);
    // Bless is always prepared under Life Domain, so it does not use a slot.
    const result = finalizeCharacterDraft(
      engine.setSpells(base, [...cantrips, 'Bless', 'Bane']),
      META,
    );
    expect(result.ok).toBe(true);
  });

  it('fighter (non-caster) is unaffected', () => {
    expect(finalizes(baseDraft('Fighter'))).toBe(true);
  });
});

describe('bard creation (eshyra-qga6)', () => {
  it('offers the open skill choice and finalizes a Bard', () => {
    const draft = withSpells(baseDraft('Bard'), 'Bard', 2, 4);
    const skills = engine
      .mechanicalChoices(draft)
      .find((entry) => entry.choice.id === 'class.skills');
    expect(skills?.choice.from).toHaveLength(18);
    expect(skills?.satisfied).toBe(true);
    expect(problems(draft)).toEqual([]);
  });
});
