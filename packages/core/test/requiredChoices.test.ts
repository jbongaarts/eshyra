import { describe, expect, it } from 'vitest';
import {
  enumerateLevel1RequiredChoices,
  getBundledDnd5eCharacterResolver,
  type Level1RequiredChoice,
} from '../src/internal.js';

const resolver = getBundledDnd5eCharacterResolver();

function classData(name: string) {
  const result = resolver.resolveClass(name);
  if (!result.ok) {
    throw new Error(`class not resolved: ${name}`);
  }
  return result.record;
}

function ancestry(name: string) {
  const result = resolver.resolveAncestry(name);
  if (!result.ok) {
    throw new Error(`ancestry not resolved: ${name}`);
  }
  return result.record;
}

function background(name: string) {
  const result = resolver.resolveBackground(name);
  if (!result.ok) {
    throw new Error(`background not resolved: ${name}`);
  }
  return result.record;
}

function byId(
  choices: readonly Level1RequiredChoice[],
  id: string,
): Level1RequiredChoice | undefined {
  return choices.find((c) => c.id === id);
}

describe('enumerateLevel1RequiredChoices', () => {
  it('enumerates a martial class as a structured skill choice plus prose-only gaps', () => {
    const choices = enumerateLevel1RequiredChoices({
      classData: classData('Fighter'),
    });

    const skills = byId(choices, 'class.skills');
    expect(skills).toMatchObject({
      kind: 'skills',
      status: 'structured',
      choose: 2,
    });
    expect(skills?.from).toContain('Athletics');

    // Fighter is not a level-1 spellcaster.
    expect(choices.some((c) => c.kind === 'cantrips')).toBe(false);
    expect(choices.some((c) => c.kind === 'spellcasting_ability')).toBe(false);

    // Starting equipment choose-one groups are now structured (overlay,
    // eshyra-b69j.12.3). Fighter has four such groups.
    const equipment = choices.filter((c) => c.kind === 'equipment');
    expect(equipment).toHaveLength(4);
    expect(equipment.every((c) => c.status === 'structured')).toBe(true);
    expect(equipment.every((c) => c.choose === 1)).toBe(true);
    expect(equipment.every((c) => c.blockingBead === undefined)).toBe(true);
    // The first group offers chain mail vs the leather-armor bundle.
    const first = byId(choices, 'class.equipment.0');
    expect(first?.from).toEqual([
      'chain mail',
      'leather armor, longbow, and 20 arrows',
    ]);
  });

  it('marks a Wizard cantrips and spellbook structured, with no ability gap', () => {
    const choices = enumerateLevel1RequiredChoices({
      classData: classData('Wizard'),
    });

    expect(byId(choices, 'class.cantrips')).toMatchObject({
      kind: 'cantrips',
      status: 'structured',
      choose: 3,
    });
    // Wizard picks a fixed-size starting spellbook (six 1st-level spells) — now
    // structured from the spellcasting overlay (eshyra-b69j.12.2).
    expect(byId(choices, 'class.spells')).toMatchObject({
      kind: 'spells',
      status: 'structured',
      choose: 6,
    });
    // The spellcasting ability is now an auto-resolved overlay fact, so it is no
    // longer surfaced as a prose-only required choice.
    expect(byId(choices, 'class.spellcastingAbility')).toBeUndefined();
    expect(choices.some((c) => c.kind === 'spellcasting_ability')).toBe(false);

    // "A spellbook" is a fixed grant, so it is not surfaced as a choice; the
    // three choose-one groups are structured and each cite their (a)/(b) prose.
    const equipment = choices.filter((c) => c.kind === 'equipment');
    expect(equipment).toHaveLength(3);
    expect(equipment.every((c) => c.status === 'structured')).toBe(true);
    expect(equipment.every((c) => /\(a\)/i.test(c.sourceText ?? ''))).toBe(
      true,
    );
    expect(equipment.some((c) => /spellbook/i.test(c.sourceText ?? ''))).toBe(
      false,
    );
  });

  it('structures a prepared full caster spell count from the ability modifier', () => {
    // Cleric prepares (Wisdom modifier + level) spells. With WIS 16 (+3) at
    // level 1 that is 4, supplied via abilityModifiers.
    const choices = enumerateLevel1RequiredChoices({
      classData: classData('Cleric'),
      abilityModifiers: { wisdom: 3 },
    });
    expect(byId(choices, 'class.spells')).toMatchObject({
      kind: 'spells',
      status: 'structured',
      choose: 4,
    });
    expect(byId(choices, 'class.spells')?.label).toMatch(/Wisdom modifier/i);

    // Without modifiers the choice stays structured but carries no fixed count.
    const noMods = enumerateLevel1RequiredChoices({
      classData: classData('Cleric'),
    });
    const spells = byId(noMods, 'class.spells');
    expect(spells?.status).toBe('structured');
    expect(spells?.choose).toBeUndefined();
    expect(spells?.label).toMatch(/Wisdom modifier \+ level/i);
  });

  it('marks a known caster cantrips and spells both structured', () => {
    const choices = enumerateLevel1RequiredChoices({
      classData: classData('Bard'),
    });
    expect(byId(choices, 'class.cantrips')).toMatchObject({
      status: 'structured',
      choose: 2,
    });
    // Bard knows a fixed number of spells (structured on the progression row).
    expect(byId(choices, 'class.spells')).toMatchObject({
      status: 'structured',
      choose: 4,
    });
    // The spellcasting ability is resolved from the overlay, not a prose gap.
    expect(byId(choices, 'class.spellcastingAbility')).toBeUndefined();
  });

  it('emits no spellcasting choices for a class that casts only from level 2', () => {
    // Ranger's level-1 progression carries an (empty) spellcasting row but no
    // level-1 cantrips, spells, or slots, so it must not surface spell choices.
    const choices = enumerateLevel1RequiredChoices({
      classData: classData('Ranger'),
    });
    expect(choices.some((c) => c.kind === 'spells')).toBe(false);
    expect(choices.some((c) => c.kind === 'cantrips')).toBe(false);
    expect(choices.some((c) => c.kind === 'spellcasting_ability')).toBe(false);
  });

  it('does not surface a fixed ancestry ability increase as a choice', () => {
    const choices = enumerateLevel1RequiredChoices({
      classData: classData('Fighter'),
      ancestry: ancestry('Elf'),
      background: background('Acolyte'),
    });

    // Elf's +2 Dexterity is a fixed increase, applied automatically in derived
    // values (eshyra-b69j.12.1) — it is not a prompt-worthy required choice.
    expect(byId(choices, 'ancestry.abilityIncrease')).toBeUndefined();

    // Elf's languages (Common + Elvish) are fixed — granted automatically, not
    // surfaced as a choice (overlay, eshyra-b69j.12.4).
    expect(byId(choices, 'ancestry.languages')).toBeUndefined();

    // Acolyte's "Two of your choice" is now a structured language choice.
    const languages = byId(choices, 'background.languages');
    expect(languages).toMatchObject({
      kind: 'languages',
      source: 'background',
      status: 'structured',
      choose: 2,
    });
    expect(languages?.blockingBead).toBeUndefined();
    expect(languages?.sourceText).toBe('Two of your choice');
    // The choosable pool is the SRD standard languages minus the languages Elf
    // already grants (Common + Elvish) — see the combined-exclusion test below.
    expect(languages?.from).toContain('Dwarvish');
    expect(languages?.from).not.toContain('Common');
    expect(languages?.from).not.toContain('Elvish');
  });

  it('surfaces a free ancestry language pick as a structured choice', () => {
    // Half-Elf grants Common + Elvish fixed plus one of the player's choice.
    const choices = enumerateLevel1RequiredChoices({
      classData: classData('Fighter'),
      ancestry: ancestry('Half-Elf'),
    });
    const languages = byId(choices, 'ancestry.languages');
    expect(languages).toMatchObject({
      kind: 'languages',
      source: 'ancestry',
      status: 'structured',
      choose: 1,
    });
    // The two fixed languages are excluded from the choosable pool.
    expect(languages?.from).not.toContain('Common');
    expect(languages?.from).not.toContain('Elvish');
    expect(languages?.from).toContain('Dwarvish');
    expect(languages?.sourceText).toMatch(/one extra language of your choice/i);
  });

  it('excludes the combined ancestry+background fixed languages from every free pick', () => {
    // Half-Elf grants Common + Elvish (fixed) plus one choice; Acolyte grants
    // two choices. A character with both already has Common + Elvish, so NEITHER
    // free pick may offer them — the pool spans both sources, not just the same
    // overlay entry's own fixed set.
    const choices = enumerateLevel1RequiredChoices({
      classData: classData('Fighter'),
      ancestry: ancestry('Half-Elf'),
      background: background('Acolyte'),
    });

    const ancestryLangs = byId(choices, 'ancestry.languages');
    expect(ancestryLangs?.from).not.toContain('Common');
    expect(ancestryLangs?.from).not.toContain('Elvish');

    const backgroundLangs = byId(choices, 'background.languages');
    expect(backgroundLangs?.choose).toBe(2);
    // The key regression: Acolyte's pool must drop the Half-Elf's fixed grants.
    expect(backgroundLangs?.from).not.toContain('Common');
    expect(backgroundLangs?.from).not.toContain('Elvish');
    // Other standard languages remain available.
    expect(backgroundLangs?.from).toContain('Dwarvish');
  });

  it('surfaces the Half-Elf ability increase as a structured choice', () => {
    const choices = enumerateLevel1RequiredChoices({
      classData: classData('Fighter'),
      ancestry: ancestry('Half-Elf'),
    });

    const abilityIncrease = byId(choices, 'ancestry.abilityIncrease');
    expect(abilityIncrease).toMatchObject({
      kind: 'ability_increase',
      source: 'ancestry',
      status: 'structured',
      choose: 2,
    });
    // "two other ability scores of your choice" excludes the fixed Charisma +2.
    expect(abilityIncrease?.from).toEqual([
      'Strength',
      'Dexterity',
      'Constitution',
      'Intelligence',
      'Wisdom',
    ]);
    expect(abilityIncrease?.blockingBead).toBeUndefined();
    expect(abilityIncrease?.sourceText).toMatch(/two other ability scores/i);
  });

  it('omits ancestry/background choices when those records are not supplied', () => {
    const choices = enumerateLevel1RequiredChoices({
      classData: classData('Fighter'),
    });
    expect(choices.some((c) => c.source === 'ancestry')).toBe(false);
    expect(choices.some((c) => c.source === 'background')).toBe(false);
  });
});
