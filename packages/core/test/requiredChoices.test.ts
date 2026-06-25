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

    // Starting equipment options are prose-only, tracked by the equipment bead.
    const equipment = choices.filter((c) => c.kind === 'equipment');
    expect(equipment.length).toBeGreaterThan(0);
    expect(equipment.every((c) => c.status === 'unstructured')).toBe(true);
    expect(equipment.every((c) => c.blockingBead === 'eshyra-b69j.12.3')).toBe(
      true,
    );
    // The fixed "longbow ... 20 arrows" line is part of an option; a bare fixed
    // grant like Wizard's "A spellbook" must not appear as a choice (see below).
  });

  it('marks a prepared caster cantrips structured but spells/ability unstructured', () => {
    const choices = enumerateLevel1RequiredChoices({
      classData: classData('Wizard'),
    });

    expect(byId(choices, 'class.cantrips')).toMatchObject({
      kind: 'cantrips',
      status: 'structured',
      choose: 3,
    });
    // Wizard prepares from INT, a prose formula → unstructured.
    expect(byId(choices, 'class.spells')).toMatchObject({
      status: 'unstructured',
      blockingBead: 'eshyra-b69j.12.2',
    });
    expect(byId(choices, 'class.spellcastingAbility')).toMatchObject({
      kind: 'spellcasting_ability',
      status: 'unstructured',
      blockingBead: 'eshyra-b69j.12.2',
    });

    // "A spellbook" is a fixed grant, not an option line, so it is not a choice.
    const equipment = choices.filter((c) => c.kind === 'equipment');
    expect(equipment.every((c) => /\(a\)/i.test(c.sourceText ?? ''))).toBe(
      true,
    );
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
    // The spellcasting ability is still prose-only for every caster.
    expect(byId(choices, 'class.spellcastingAbility')?.status).toBe(
      'unstructured',
    );
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

    const languages = byId(choices, 'background.languages');
    expect(languages).toMatchObject({
      kind: 'languages',
      source: 'background',
      status: 'unstructured',
      blockingBead: 'eshyra-b69j.12.4',
    });
    expect(languages?.sourceText).toMatch(/choice/i);
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
