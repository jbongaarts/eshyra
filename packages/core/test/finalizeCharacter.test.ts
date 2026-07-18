import { describe, expect, it } from 'vitest';
import {
  type CharacterDraft,
  createSeededRng,
  finalizeCharacterDraft,
  getDnd5eCharacterCreationEngine,
  rollAbilityScoreSet,
  rollStartingWealth,
  UnsupportedCharacterBuildError,
} from '../src/internal.js';

/**
 * finalizeCharacterDraft (eshyra-b69j.14) gates on completeness and folds the
 * draft + derived values + mechanical choices (eshyra-b69j.13) into a single
 * canonical record. These tests drive it through the real engine and bundled
 * SRD resolver.
 */

const engine = getDnd5eCharacterCreationEngine();
const META = { createdAt: '2026-06-26T00:00:00.000Z', source: 'test' } as const;

/** A fully-complete Fighter + Human draft (every required choice made). */
function completeDraft(): CharacterDraft {
  let draft = engine.createDraft({ id: 'hero', mode: 'concept-first' });
  draft = engine.setIdentity(draft, { name: 'Grok', concept: 'stoic guard' });
  draft = engine.setClass(draft, 'Fighter');
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
  // Satisfy every mechanical choice (skills, four equipment groups, Human
  // language) by taking each choice's first valid option(s).
  for (const entry of engine.mechanicalChoices(draft)) {
    const need = entry.choice.choose ?? 0;
    const picks = (entry.choice.from ?? []).slice(0, need);
    draft = engine.setChoice(draft, entry.choice.id, picks);
  }
  return draft;
}

describe('finalizeCharacterDraft', () => {
  it('finalizes a source-bounded custom background with durable identity and choices', () => {
    let draft = completeDraft();
    draft = engine.setBackground(draft, 'background:acolyte');
    draft = engine.setBackgroundCustomization(draft, {
      name: 'Temple Archivist',
      skillProficiencies: ['Arcana', 'History'],
      toolProficiencies: [],
      languages: ['Elvish', 'Dwarvish'],
      feature: 'background:acolyte#feature:shelter-of-the-faithful',
    });
    for (const entry of engine.mechanicalChoices(draft)) {
      if (!entry.satisfied) {
        draft = engine.setChoice(
          draft,
          entry.choice.id,
          (entry.choice.from ?? []).slice(0, entry.choice.choose ?? 0),
        );
      }
    }
    const result = finalizeCharacterDraft(draft, META);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.character.background).toEqual({
      key: 'background:acolyte',
      name: 'Acolyte',
    });
    expect(result.character.backgroundCustomization).toMatchObject({
      name: 'Temple Archivist',
      skillProficiencies: ['Arcana', 'History'],
      toolProficiencies: [],
      languages: ['Elvish', 'Dwarvish'],
      feature: {
        key: 'background:acolyte#feature:shelter-of-the-faithful',
        name: 'Shelter of the Faithful',
      },
    });
    expect(result.character.skillProficiencies).toEqual(
      expect.arrayContaining(['Arcana', 'History']),
    );
    expect(result.character.languages).toEqual(
      expect.arrayContaining(['Elvish', 'Dwarvish']),
    );
    expect(result.character.equipment).toContain('holy symbol');
  });

  it('rejects invalid custom-background counts, domains, and invented features', () => {
    const cases = [
      {
        name: 'Bad Skills',
        skillProficiencies: ['Arcana'],
        toolProficiencies: [],
        languages: ['Elvish', 'Dwarvish'],
        feature: 'background:acolyte#feature:shelter-of-the-faithful',
      },
      {
        name: 'Bad Total',
        skillProficiencies: ['Arcana', 'History'],
        toolProficiencies: [],
        languages: ['Elvish'],
        feature: 'background:acolyte#feature:shelter-of-the-faithful',
      },
      {
        name: 'Invented',
        skillProficiencies: ['Arcana', 'History'],
        toolProficiencies: [],
        languages: ['Elvish', 'Dwarvish'],
        feature: 'feature:my-cool-mechanic',
      },
    ] as const;
    for (const custom of cases) {
      let draft = engine.setBackground(completeDraft(), 'Acolyte');
      draft = engine.setBackgroundCustomization(draft, custom);
      expect(
        draft.diagnostics.some(
          (diagnostic) =>
            diagnostic.field === 'backgroundCustomization' &&
            diagnostic.severity === 'error',
        ),
      ).toBe(true);
      expect(finalizeCharacterDraft(draft, META).ok).toBe(false);
    }
  });

  it('preserves immutable roll evidence through assignment and finalization', () => {
    let draft = completeDraft();
    draft = engine.setAbilityScoreMethod(draft, 'rolled');
    const evidence = rollAbilityScoreSet(createSeededRng(20260714));
    draft = engine.setRolledAbilityScores(draft, evidence);
    draft = engine.setAbilityScores(draft, {
      strength: evidence[0].total,
      dexterity: evidence[1].total,
      constitution: evidence[2].total,
      intelligence: evidence[3].total,
      wisdom: evidence[4].total,
      charisma: evidence[5].total,
    });
    const before = JSON.stringify(draft.selections.rolledAbilityScores);
    const preview = engine.toFinalizableDraft(draft);
    expect(preview.ok).toBe(true);
    expect(JSON.stringify(draft.selections.rolledAbilityScores)).toBe(before);

    const finalized = finalizeCharacterDraft(draft, META);
    expect(finalized.ok).toBe(true);
    if (finalized.ok) {
      expect(JSON.stringify(finalized.character.rolledAbilityScores)).toBe(
        before,
      );
    }

    const reassigned = engine.setAbilityScores(draft, {
      strength: evidence[1].total,
      dexterity: evidence[0].total,
      constitution: evidence[2].total,
      intelligence: evidence[3].total,
      wisdom: evidence[4].total,
      charisma: evidence[5].total,
    });
    expect(JSON.stringify(reassigned.selections.rolledAbilityScores)).toBe(
      before,
    );
  });

  it('blocks an empty draft and lists the base missing fields', () => {
    const draft = engine.createDraft({ id: 'x', mode: 'concept-first' });
    const result = finalizeCharacterDraft(draft, META);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fields = result.missing.map((m) => m.field);
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

  it('blocks a draft that is complete except for mechanical choices', () => {
    let draft = engine.createDraft({ id: 'x', mode: 'concept-first' });
    draft = engine.setIdentity(draft, { name: 'Grok' });
    draft = engine.setClass(draft, 'Fighter');
    draft = engine.setAncestry(draft, 'Human');
    draft = engine.setAbilityScoreMethod(draft, 'point_buy');
    draft = engine.setAbilityScores(draft, {
      strength: 15,
      dexterity: 13,
      constitution: 13,
      intelligence: 12,
      wisdom: 10,
      charisma: 8,
    });
    const result = finalizeCharacterDraft(draft, META);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fields = result.missing.map((m) => m.field);
      // Base fields are satisfied; the class skills + equipment + Human language
      // choices block finalization.
      expect(fields).toContain('class.skills');
      expect(fields).toContain('class.equipment.0');
      expect(fields).toContain('ancestry.languages');
      expect(fields).not.toContain('name');
    }
  });

  it('finalizes a complete draft into a canonical record', () => {
    const result = finalizeCharacterDraft(completeDraft(), META);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const c = result.character;
    expect(c.schemaVersion).toBe(1);
    expect(c.system).toBe('dnd5e-srd');
    // Provenance / rules-pack ids are preserved.
    expect(c.rulesPackId).toBe('rules:dnd5e-srd-5.1');
    expect(c.recipeId).toBe('dnd5e-srd');
    expect(c.metadata).toEqual(META);
    // Identity + canonical refs (key + name).
    expect(c.identity).toEqual({ name: 'Grok', concept: 'stoic guard' });
    expect(c.class).toEqual({ key: 'class:fighter', name: 'Fighter' });
    expect(c.ancestry).toEqual({ key: 'ancestry:human', name: 'Human' });
    // Derived values from the engine.
    expect(c.proficiencyBonus).toBe(2);
    expect(c.maxHitPoints).toBe(12); // Fighter d10 + final CON 14 (+2)
    // Human grants +1 to every score: STR 15→16, CON 13→14.
    expect(c.abilityScores.strength).toEqual({
      base: 15,
      final: 16,
      modifier: 3,
    });
    expect(c.abilityScores.constitution).toEqual({
      base: 13,
      final: 14,
      modifier: 2,
    });
    // Mechanical choices folded in.
    expect(c.skillProficiencies).toHaveLength(2);
    // Class fixed armor/weapon proficiencies are preserved.
    expect(c.armorProficiencies).toEqual(['All armor', 'shields']);
    expect(c.weaponProficiencies).toEqual([
      'Simple weapons',
      'martial weapons',
    ]);
    // Equipment merges chosen options with the class's fixed grants (Fighter has
    // none fixed, so just the four chosen options; no background here).
    expect(c.equipment.length).toBe(4);
    // Languages: Human's fixed Common plus the one chosen language.
    expect(c.languages).toContain('Common');
    expect(c.languages.length).toBe(2);
  });

  it('finalizes starting wealth without package equipment or currency', () => {
    let draft = completeDraft();
    draft = engine.setStartingEquipmentMode(draft, 'starting-wealth');
    draft = engine.setStartingWealth(
      draft,
      rollStartingWealth('class:fighter', createSeededRng(7)),
    );
    const result = finalizeCharacterDraft(draft, META);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.character.startingEquipmentMode).toBe('starting-wealth');
      expect(result.character.equipment).toEqual([]);
      expect(result.character.wallet?.gp).toBe(120);
    }
  });

  it('finalizes a Hill Dwarf Monk duplicate tool grant with a replacement', () => {
    let draft = engine.createDraft({ id: 'monk-tools', mode: 'concept-first' });
    draft = engine.setIdentity(draft, { name: 'Korin' });
    draft = engine.setClass(draft, 'Monk');
    draft = engine.setAncestry(draft, 'Hill Dwarf');
    draft = engine.setAbilityScoreMethod(draft, 'point_buy');
    draft = engine.setAbilityScores(draft, {
      strength: 15,
      dexterity: 13,
      constitution: 13,
      intelligence: 9,
      wisdom: 14,
      charisma: 8,
    });
    for (let pass = 0; pass < 4; pass += 1) {
      for (const entry of engine.mechanicalChoices(draft)) {
        if (entry.satisfied) continue;
        const values =
          entry.choice.kind === 'tools' &&
          (entry.choice.from ?? []).includes('Smith’s tools')
            ? ['Smith’s tools']
            : (entry.choice.from ?? []).slice(0, entry.choice.choose ?? 0);
        draft = engine.setChoice(draft, entry.choice.id, values);
      }
    }
    const result = finalizeCharacterDraft(draft, META);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.character.toolProficiencies).toContain('Smith’s tools');
      expect(result.character.toolProficiencies).toContain(
        'Alchemist’s supplies',
      );
    }
  });

  it('returns normal failures for malformed persisted wealth evidence', () => {
    let valid = engine.setStartingEquipmentMode(
      completeDraft(),
      'starting-wealth',
    );
    valid = engine.setStartingWealth(
      valid,
      rollStartingWealth('class:fighter', createSeededRng(7)),
    );

    const corruptedDrafts = [
      {
        ...valid,
        selections: { ...valid.selections, startingWealth: null },
      },
      {
        ...valid,
        selections: {
          ...valid.selections,
          startingWealth: {
            ...valid.selections.startingWealth,
            classKey: undefined,
          },
        },
      },
      {
        ...valid,
        selections: {
          ...valid.selections,
          startingWealth: { ...valid.selections.startingWealth, roll: null },
        },
      },
    ] as unknown as CharacterDraft[];

    for (const draft of corruptedDrafts) {
      expect(() => finalizeCharacterDraft(draft, META)).not.toThrow();
      expect(finalizeCharacterDraft(draft, META).ok).toBe(false);
    }
  });

  it('refuses multiclass-shaped draft state before finalization can flatten it', () => {
    const draft = {
      ...completeDraft(),
      classes: ['Fighter', 'Wizard'],
    };
    expect(() => finalizeCharacterDraft(draft as CharacterDraft, META)).toThrow(
      UnsupportedCharacterBuildError,
    );
  });

  it('preserves background fixed skills/equipment and class fixed proficiencies', () => {
    let draft = engine.createDraft({ id: 'cleric', mode: 'concept-first' });
    draft = engine.setIdentity(draft, { name: 'Sister Vael' });
    draft = engine.setClass(draft, 'Cleric');
    draft = engine.setAncestry(draft, 'Hill Dwarf'); // fixed languages only
    draft = engine.setBackground(draft, 'Acolyte');
    draft = engine.setAbilityScoreMethod(draft, 'point_buy');
    draft = engine.setAbilityScores(draft, {
      strength: 13,
      dexterity: 12,
      constitution: 14,
      intelligence: 10,
      wisdom: 15,
      charisma: 8,
    });
    for (let pass = 0; pass < 3; pass += 1) {
      for (const entry of engine.mechanicalChoices(draft)) {
        const need = entry.choice.choose ?? 0;
        if (!entry.satisfied) {
          draft = engine.setChoice(
            draft,
            entry.choice.id,
            (entry.choice.from ?? []).slice(0, need),
          );
        }
      }
    }
    const result = finalizeCharacterDraft(draft, META);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const c = result.character;
    // Acolyte grants Insight + Religion as FIXED skills — must be present even
    // though the player never "chose" them.
    expect(c.skillProficiencies).toEqual(
      expect.arrayContaining(['Insight', 'Religion']),
    );
    // Cleric fixed armor/weapon proficiencies are preserved.
    expect(c.armorProficiencies.length).toBeGreaterThan(0);
    expect(c.weaponProficiencies).toContain('Simple weapons');
    // The background equipment package appears as a verbatim entry.
    expect(c.equipment.some((e) => /holy symbol/i.test(e))).toBe(true);
    expect(c.background).toEqual({
      key: 'background:acolyte',
      name: 'Acolyte',
    });
  });

  it('merges fixed equipment grants (Wizard spellbook) into the record', () => {
    let draft = engine.createDraft({ id: 'w', mode: 'concept-first' });
    draft = engine.setIdentity(draft, { name: 'Mage' });
    draft = engine.setClass(draft, 'Wizard');
    draft = engine.setAncestry(draft, 'High Elf'); // fixed languages only
    draft = engine.setAbilityScoreMethod(draft, 'point_buy');
    draft = engine.setAbilityScores(draft, {
      strength: 8,
      dexterity: 14,
      constitution: 14,
      intelligence: 15,
      wisdom: 10,
      charisma: 10,
    });
    for (const entry of engine.mechanicalChoices(draft)) {
      const need = entry.choice.choose ?? 0;
      draft = engine.setChoice(
        draft,
        entry.choice.id,
        (entry.choice.from ?? []).slice(0, need),
      );
    }
    const result = finalizeCharacterDraft(draft, META);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // "A spellbook" is a fixed grant and must appear even though it is not a
    // choice the player makes.
    expect(result.character.equipment).toContain('A spellbook');
    // High Elf languages are fixed (Common + Elvish) with no free pick.
    expect(result.character.languages).toEqual(
      expect.arrayContaining(['Common', 'Elvish']),
    );
    // Wizard is a spellcaster: spell save DC is computed (INT 15 +1 High Elf = 16).
    expect(result.character.spellSaveDc).toBe(13);
  });
});
