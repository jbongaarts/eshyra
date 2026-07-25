import { describe, expect, it } from 'vitest';
import {
  type CharacterDraft,
  createCharacterCreationEngine,
  getDnd5eCharacterCreationEngine,
  UnsupportedCharacterBuildError,
} from '../src/internal.js';

const engine = getDnd5eCharacterCreationEngine();

const POINT_BUY_SCORES = {
  strength: 15,
  dexterity: 14,
  constitution: 14,
  intelligence: 10,
  wisdom: 10,
  charisma: 8,
} as const;

function newDraft(): CharacterDraft {
  return engine.createDraft({ id: 'draft-1', mode: 'concept-first' });
}

function fullValidDraft(): CharacterDraft {
  let draft = newDraft();
  draft = engine.setIdentity(draft, { name: 'Mira' });
  draft = engine.setClass(draft, 'Fighter');
  draft = engine.setAncestry(draft, 'Human');
  draft = engine.setAbilityScoreMethod(draft, 'point_buy');
  draft = engine.setAbilityScores(draft, POINT_BUY_SCORES);
  return draft;
}

function errorFields(draft: CharacterDraft): string[] {
  return draft.diagnostics
    .filter((d) => d.severity === 'error')
    .map((d) => d.field);
}

describe('character creation draft engine', () => {
  it('creates an empty draft with default level and recipe metadata', () => {
    const draft = newDraft();
    expect(draft.level).toBe(1);
    expect(draft.recipeId).toBe('dnd5e-srd');
    expect(draft.rulesPackId).toBe('rules:dnd5e-srd-5.1');
    expect(draft.diagnostics).toEqual([]);
    expect(draft.derived.proficiencyBonus).toBe(2);
  });

  it('rehydrates invalid persisted acquisition modes as non-finalizable state', () => {
    const draft = {
      ...fullValidDraft(),
      selections: {
        ...fullValidDraft().selections,
        startingEquipmentMode: 'bogus',
      },
    } as CharacterDraft;
    const rehydrated = engine.recomputeDraft(draft);
    expect(rehydrated.selections.startingEquipmentMode).toBe('packages');
    expect(rehydrated.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'startingEquipmentMode',
          severity: 'error',
        }),
      ]),
    );
    expect(engine.isFinalizable(rehydrated)).toBe(false);
  });

  it.each([
    ['classes', ['Fighter', 'Wizard']],
    ['classLevels', { 'class:fighter': 1, 'class:wizard': 1 }],
    ['targetClass', 'Wizard'],
  ])(
    'rejects %s nested in creation input selections before it is spread',
    (field, value) => {
      expect(() =>
        engine.createDraft({
          id: 'draft-1',
          mode: 'concept-first',
          selections: {
            className: 'Fighter',
            [field]: value,
          },
        } as Parameters<typeof engine.createDraft>[0]),
      ).toThrow(UnsupportedCharacterBuildError);
    },
  );

  it('preserves prior answers when name changes', () => {
    let draft = fullValidDraft();
    draft = engine.setIdentity(draft, { name: 'Renamed' });
    expect(draft.identity.name).toBe('Renamed');
    expect(draft.selections.className).toBe('Fighter');
    expect(draft.selections.ancestry).toBe('Human');
    expect(draft.selections.baseAbilityScores).toEqual(POINT_BUY_SCORES);
    expect(engine.isFinalizable(draft)).toBe(true);
  });

  it('changing class preserves identity and scores but revalidates spells', () => {
    let draft = fullValidDraft();
    // Fire Bolt is a Wizard/Sorcerer cantrip — legal once class is a caster.
    draft = engine.setClass(draft, 'Wizard');
    draft = engine.setSpells(draft, ['Fire Bolt']);
    expect(errorFields(draft)).not.toContain('spells');

    // Switching to Fighter makes the previously legal spell illegal; identity
    // and ability scores are untouched.
    draft = engine.setClass(draft, 'Fighter');
    expect(draft.identity.name).toBe('Mira');
    expect(draft.selections.baseAbilityScores).toEqual(POINT_BUY_SCORES);
    expect(draft.selections.spells).toEqual(['Fire Bolt']);
    expect(errorFields(draft)).toContain('spells');
    expect(draft.stale).toContain('spells');
  });

  it('builds replacement domains from all ordinary grants before any replacement', () => {
    let draft = fullValidDraft();
    draft = engine.setClass(draft, 'Cleric');
    draft = engine.setBackground(draft, 'Acolyte');
    draft = engine.setChoice(draft, 'class.skills', ['History', 'Insight']);
    const replacement = engine
      .mechanicalChoices(draft)
      .find(
        (entry) =>
          entry.choice.id === 'proficiency-replacement.skills.insight.1',
      );
    expect(replacement?.satisfied).toBe(false);
    expect(replacement?.choice.from).not.toContain('Religion');
    expect(replacement?.choice.from).not.toContain('History');
    draft = engine.setChoice(draft, replacement?.choice.id ?? '', [
      'Acrobatics',
    ]);
    expect(
      engine
        .mechanicalChoices(draft)
        .find((entry) => entry.choice.id === replacement?.choice.id)?.satisfied,
    ).toBe(true);
  });

  it('changing ancestry preserves base scores but recomputes derived values', () => {
    let draft = fullValidDraft();
    // Human (set by fullValidDraft) raises every score by 1: STR 15→16 (+3),
    // DEX 14→15 (+2).
    expect(draft.derived.finalAbilityScores.strength).toBe(16);
    expect(draft.derived.abilityModifiers.dexterity).toBe(2);

    draft = engine.setAncestry(draft, 'Elf');
    // Base scores are never rewritten; only applied ancestry bonuses change.
    expect(draft.selections.baseAbilityScores).toEqual(POINT_BUY_SCORES);
    // Elf grants only +2 DEX: STR falls back to its base 15 (+2); DEX 14→16 (+3).
    expect(draft.derived.finalAbilityScores.strength).toBe(15);
    expect(draft.derived.finalAbilityScores.dexterity).toBe(16);
    expect(draft.derived.abilityModifiers.strength).toBe(2);
    expect(draft.derived.abilityModifiers.dexterity).toBe(3);
  });

  it('reports an invalid class without cascading', () => {
    let draft = newDraft();
    draft = engine.setClass(draft, 'Artificer');
    expect(errorFields(draft)).toEqual(['class']);
    // No HP nonsense and no spell cascade from the bad class.
    expect(draft.diagnostics.some((d) => d.field === 'maxHitPoints')).toBe(
      false,
    );
  });

  it('reports an invalid ancestry', () => {
    let draft = newDraft();
    draft = engine.setAncestry(draft, 'Gobbo');
    expect(errorFields(draft)).toContain('ancestry');
  });

  it('flags non-integer ability scores', () => {
    let draft = newDraft();
    draft = engine.setAbilityScoreMethod(draft, 'point_buy');
    draft = engine.setAbilityScore(draft, 'strength', 13.5);
    expect(errorFields(draft)).toContain('abilityScores.strength');
  });

  it('flags point-buy scores out of the 8–15 range', () => {
    let draft = newDraft();
    draft = engine.setAbilityScoreMethod(draft, 'point_buy');
    draft = engine.setAbilityScore(draft, 'strength', 17);
    const strengthError = draft.diagnostics.find(
      (d) => d.field === 'abilityScores.strength' && d.severity === 'error',
    );
    expect(strengthError?.message).toMatch(/between 8 and 15/);
  });

  it('flags an over-budget point-buy total once all six scores are present', () => {
    let draft = newDraft();
    draft = engine.setAbilityScoreMethod(draft, 'point_buy');
    draft = engine.setAbilityScores(draft, {
      strength: 15,
      dexterity: 15,
      constitution: 15,
      intelligence: 15,
      wisdom: 15,
      charisma: 15,
    });
    const totalError = draft.diagnostics.find(
      (d) => d.field === 'abilityScores' && d.severity === 'error',
    );
    expect(totalError?.message).toMatch(/exceeds 27/);
  });

  it('reports missing name as a required choice after other revisions', () => {
    let draft = newDraft();
    draft = engine.setClass(draft, 'Fighter');
    draft = engine.setAncestry(draft, 'Human');
    draft = engine.setAbilityScoreMethod(draft, 'point_buy');
    draft = engine.setAbilityScores(draft, POINT_BUY_SCORES);
    const missing = engine.missingRequiredChoices(draft).map((c) => c.field);
    expect(missing).toEqual(['name']);
    expect(engine.isFinalizable(draft)).toBe(false);
  });

  it('does not validate HP until class and Constitution are both valid', () => {
    let draft = newDraft();
    // Constitution present, class not yet chosen → pending, never an error.
    draft = engine.setAbilityScoreMethod(draft, 'point_buy');
    draft = engine.setAbilityScore(draft, 'constitution', 14);
    expect(draft.derived.maxHitPoints).toBeUndefined();
    const pending = draft.diagnostics.find((d) => d.field === 'maxHitPoints');
    expect(pending?.severity).toBe('pending');
    expect(pending?.dependsOn).toContain('class');
    expect(errorFields(draft)).not.toContain('maxHitPoints');
  });

  it('computes level-1 HP once class hit die and Constitution exist', () => {
    let draft = newDraft();
    draft = engine.setClass(draft, 'Fighter');
    draft = engine.setAbilityScoreMethod(draft, 'point_buy');
    draft = engine.setAbilityScore(draft, 'constitution', 14);
    // Fighter d10 + CON +2 = 12.
    expect(draft.derived.maxHitPoints).toBe(12);
    expect(draft.diagnostics.some((d) => d.field === 'maxHitPoints')).toBe(
      false,
    );
  });

  it('accepts a rolled score outside the point-buy range and recomputes its modifier', () => {
    let draft = newDraft();
    draft = engine.setAbilityScoreMethod(draft, 'rolled');
    // 18 is illegal for point buy but a legitimate 4d6-drop-lowest result.
    draft = engine.setAbilityScore(draft, 'strength', 18);
    expect(errorFields(draft)).not.toContain('abilityScores.strength');
    expect(draft.derived.abilityModifiers.strength).toBe(4);
  });

  it('rejects manual scores outside the plausibility range', () => {
    let draft = newDraft();
    draft = engine.setAbilityScoreMethod(draft, 'manual');
    draft = engine.setAbilityScore(draft, 'strength', 25);
    const error = draft.diagnostics.find(
      (d) => d.field === 'abilityScores.strength' && d.severity === 'error',
    );
    expect(error?.message).toMatch(/between 1 and 20/);
    // The out-of-range score is excluded from derived modifiers.
    expect(draft.derived.abilityModifiers.strength).toBeUndefined();
  });

  it('collects ability-first scores before class and uses them for HP later', () => {
    // Ability-first: scores entered first (no method total constraint), class last.
    let draft = newDraft();
    draft = engine.setAbilityScoreMethod(draft, 'rolled');
    draft = engine.setAbilityScore(draft, 'constitution', 16);
    expect(draft.derived.abilityModifiers.constitution).toBe(3);
    expect(draft.derived.maxHitPoints).toBeUndefined();

    // Editing one score at a time preserves the others.
    draft = engine.setAbilityScore(draft, 'strength', 15);
    expect(draft.selections.baseAbilityScores).toMatchObject({
      constitution: 16,
      strength: 15,
    });

    draft = engine.setClass(draft, 'Barbarian');
    // Barbarian d12 + CON +3 = 15.
    expect(draft.derived.maxHitPoints).toBe(15);
  });

  it('projects a finalizable draft into the legacy finalization input', () => {
    const result = engine.toFinalizableDraft(fullValidDraft());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft).toMatchObject({
        name: 'Mira',
        ancestry: 'Human',
        className: 'Fighter',
        level: 1,
        maxHitPoints: 12,
        abilityScores: POINT_BUY_SCORES,
      });
    }
  });

  it('refuses to project an incomplete draft and reports what is missing', () => {
    const result = engine.toFinalizableDraft(newDraft());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fields = result.missing.map((c) => c.field);
      expect(fields).toEqual(
        expect.arrayContaining([
          'name',
          'class',
          'ancestry',
          'abilityScoreMethod',
          'abilityScores',
        ]),
      );
    }
  });

  it('can be constructed with an explicit resolver', () => {
    const explicit = createCharacterCreationEngine();
    const draft = explicit.setClass(
      explicit.createDraft({ id: 'd', mode: 'concept-first' }),
      'Rogue',
    );
    expect(errorFields(draft)).not.toContain('class');
  });
});

describe('character creation mechanical choices (eshyra-b69j.13)', () => {
  it('enumerates skills and equipment choices once a class resolves', () => {
    let draft = newDraft();
    expect(engine.mechanicalChoices(draft)).toEqual([]); // no class yet

    draft = engine.setClass(draft, 'Fighter');
    const kinds = engine.mechanicalChoices(draft).map((m) => m.choice.kind);
    expect(kinds).toContain('skills');
    expect(kinds).toContain('equipment');
    // All start unsatisfied.
    expect(engine.mechanicalChoices(draft).every((m) => !m.satisfied)).toBe(
      true,
    );
  });

  it('marks a skill choice satisfied only at the exact count of valid options', () => {
    let draft = engine.setClass(newDraft(), 'Fighter');
    const skills = engine
      .mechanicalChoices(draft)
      .find((m) => m.choice.kind === 'skills');
    expect(skills?.choice.choose).toBe(2);
    const from = skills?.choice.from ?? [];

    // One pick is not enough.
    draft = engine.setChoice(draft, 'class.skills', [from[0] as string]);
    expect(
      engine
        .mechanicalChoices(draft)
        .find((m) => m.choice.id === 'class.skills')?.satisfied,
    ).toBe(false);

    // Two valid picks satisfy it.
    draft = engine.setChoice(draft, 'class.skills', [
      from[0] as string,
      from[1] as string,
    ]);
    expect(
      engine
        .mechanicalChoices(draft)
        .find((m) => m.choice.id === 'class.skills')?.satisfied,
    ).toBe(true);

    // An invalid option does not satisfy it.
    draft = engine.setChoice(draft, 'class.skills', [
      from[0] as string,
      'Underwater Basketweaving',
    ]);
    expect(
      engine
        .mechanicalChoices(draft)
        .find((m) => m.choice.id === 'class.skills')?.satisfied,
    ).toBe(false);
  });

  it('satisfies an equipment choose-one group with a single valid option', () => {
    let draft = engine.setClass(newDraft(), 'Wizard');
    const group = engine
      .mechanicalChoices(draft)
      .find((m) => m.choice.kind === 'equipment');
    const id = group?.choice.id as string;
    const option = group?.choice.from?.[0] as string;

    draft = engine.setChoice(draft, id, [option]);
    expect(
      engine.mechanicalChoices(draft).find((m) => m.choice.id === id)
        ?.satisfied,
    ).toBe(true);

    // Clearing it returns to unsatisfied and drops the stored selection.
    draft = engine.setChoice(draft, id, undefined);
    expect(draft.selections.choices?.[id]).toBeUndefined();
    expect(
      engine.mechanicalChoices(draft).find((m) => m.choice.id === id)
        ?.satisfied,
    ).toBe(false);
  });

  it('includes a background language choice in the mechanical choices', () => {
    let draft = engine.setClass(newDraft(), 'Fighter');
    draft = engine.setBackground(draft, 'Acolyte');
    const languages = engine
      .mechanicalChoices(draft)
      .find((m) => m.choice.id === 'background.languages');
    expect(languages?.choice.choose).toBe(2);
    expect(languages?.satisfied).toBe(false);

    const pool = languages?.choice.from ?? [];
    draft = engine.setChoice(draft, 'background.languages', [
      pool[0] as string,
      pool[1] as string,
    ]);
    expect(
      engine
        .mechanicalChoices(draft)
        .find((m) => m.choice.id === 'background.languages')?.satisfied,
    ).toBe(true);
  });
});

/**
 * Generated-rules-pack-backed validation of class, ancestry, and spell choices,
 * exercised from the engine (eshyra-b69j.11). Class/ancestry/spell records are
 * resolved against the bundled SRD pack — never a hand-authored catalog — and
 * spell legality checks both spell level and class availability from generated
 * data.
 */
describe('character creation rules-pack validation', () => {
  function fieldMessages(draft: CharacterDraft, field: string): string[] {
    return draft.diagnostics
      .filter((d) => d.severity === 'error' && d.field === field)
      .map((d) => d.message);
  }

  function spellPending(draft: CharacterDraft) {
    return draft.diagnostics.find(
      (d) => d.field === 'spells' && d.severity === 'pending',
    );
  }

  it('resolves class, ancestry, and spell choices by display name', () => {
    let draft = newDraft();
    draft = engine.setClass(draft, 'Fighter');
    // "High Elf" is the SRD 5.1 elf subrace (Wood Elf is not in SRD 5.1).
    draft = engine.setAncestry(draft, 'High Elf');
    expect(errorFields(draft)).not.toContain('class');
    expect(errorFields(draft)).not.toContain('ancestry');

    // Display-name lookup is case- and separator-insensitive.
    draft = engine.setClass(draft, 'wizard');
    draft = engine.setSpells(draft, ['magic missile', 'Fire Bolt']);
    expect(errorFields(draft)).not.toContain('class');
    expect(errorFields(draft)).not.toContain('spells');
  });

  it('accepts a level-1 spell and a cantrip on the class list', () => {
    let draft = newDraft();
    draft = engine.setClass(draft, 'Wizard');
    // Magic Missile (level 1) and Fire Bolt (cantrip) are both Wizard spells.
    draft = engine.setSpells(draft, ['Magic Missile', 'Fire Bolt']);
    expect(errorFields(draft)).not.toContain('spells');
  });

  it('rejects a spell above the level-1 reach with a level-specific message', () => {
    let draft = newDraft();
    draft = engine.setClass(draft, 'Wizard');
    // Fireball is a level-3 Wizard spell — legal class, unreachable level.
    draft = engine.setSpells(draft, ['Fireball']);
    const messages = fieldMessages(draft, 'spells');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/Fireball is a level-3 spell/);
    expect(messages[0]).toMatch(/cantrips and 1st-level spells/);
    expect(draft.stale).toContain('spells');
  });

  it('rejects a spell that is not on the chosen class spell list', () => {
    let draft = newDraft();
    draft = engine.setClass(draft, 'Wizard');
    // Cure Wounds is a level-1 spell, but only for Cleric/Druid/Bard/etc.
    draft = engine.setSpells(draft, ['Cure Wounds']);
    const messages = fieldMessages(draft, 'spells');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/Cure Wounds is not on the Wizard spell list/);
  });

  it('reports an unknown spell name', () => {
    let draft = newDraft();
    draft = engine.setClass(draft, 'Wizard');
    draft = engine.setSpells(draft, ['Frostbolt of Doom']);
    expect(fieldMessages(draft, 'spells')).toEqual([
      'unknown spell: Frostbolt of Doom',
    ]);
  });

  it('waits for class before validating spells instead of cascading', () => {
    let draft = newDraft();
    // Spells chosen before a class: a single pending diagnostic, no errors.
    draft = engine.setSpells(draft, ['Magic Missile', 'Fireball']);
    expect(errorFields(draft)).not.toContain('spells');
    const pending = spellPending(draft);
    expect(pending?.message).toMatch(/waiting for class/i);
    expect(pending?.dependsOn).toContain('class');

    // Once the class resolves, the over-level spell is caught.
    draft = engine.setClass(draft, 'Wizard');
    expect(errorFields(draft)).toContain('spells');
    expect(spellPending(draft)).toBeUndefined();
  });

  it('reports invalid class and ancestry names from the pack', () => {
    let draft = newDraft();
    draft = engine.setClass(draft, 'Artificer'); // not in SRD 5.1
    draft = engine.setAncestry(draft, 'Goblin'); // not a player ancestry here
    expect(fieldMessages(draft, 'class')[0]).toMatch(
      /unknown class: Artificer/,
    );
    expect(fieldMessages(draft, 'ancestry')[0]).toMatch(
      /unknown ancestry: Goblin/,
    );
  });
});
