import { describe, expect, it } from 'vitest';
import type {
  AbilityScoreName,
  CharacterSheet,
  FinalizedAbilityScore,
} from '../src/internal.js';
import { deriveSkillBonuses, renderSkillsLine } from '../src/internal.js';

const MODS: Record<AbilityScoreName, number> = {
  strength: 1,
  dexterity: 3,
  constitution: 2,
  intelligence: 0,
  wisdom: 2,
  charisma: -1,
};

function sheet(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const abilityScores = {} as Record<AbilityScoreName, FinalizedAbilityScore>;
  const savingThrows = {} as CharacterSheet['savingThrows'];
  for (const a of Object.keys(MODS) as AbilityScoreName[]) {
    abilityScores[a] = { base: 10, final: 10, modifier: MODS[a] };
    savingThrows[a] = { modifier: MODS[a], proficient: false };
  }
  return {
    schemaVersion: 1,
    system: 'dnd5e-srd',
    rulesPackId: 'rules:dnd5e-srd-5.1',
    recipeId: 'dnd5e-srd-character',
    creationMode: 'test',
    level: 1,
    identity: { name: 'T' },
    class: { key: 'class:rogue', name: 'Rogue' },
    ancestry: { key: 'ancestry:human', name: 'Human' },
    abilityScores,
    proficiencyBonus: 2,
    maxHitPoints: 8,
    savingThrows,
    skillProficiencies: [],
    toolProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    equipment: [],
    languages: [],
    spells: [],
    metadata: { createdAt: '2026-01-01T00:00:00.000Z' },
    ...overrides,
  };
}

const bonus = (s: CharacterSheet, skill: string): number | undefined =>
  deriveSkillBonuses(s).skills.find((x) => x.skill === skill)?.bonus;

describe('deriveSkillBonuses', () => {
  const rogue = sheet({
    skillProficiencies: ['Stealth', 'Perception'],
    featureChoices: [
      {
        featureRef: 'feature:rogue:expertise',
        choiceId: 'expertise',
        optionIds: ['skill:Stealth'],
        level: 1,
      },
    ],
  });

  it('doubles proficiency for expertise, adds once for proficient, none otherwise', () => {
    expect(bonus(rogue, 'Stealth')).toBe(3 + 4); // DEX + 2xPB
    expect(bonus(rogue, 'Perception')).toBe(2 + 2); // WIS + PB
    expect(bonus(rogue, 'Arcana')).toBe(0); // INT only
    expect(deriveSkillBonuses(rogue).skills).toHaveLength(18);
    expect(deriveSkillBonuses(rogue).passivePerception).toBe(14);
  });

  it('adds Jack of All Trades (half PB, down) to non-proficient skills only', () => {
    const bard = sheet({
      level: 2,
      class: { key: 'class:bard', name: 'Bard' },
      proficiencyBonus: 3,
      skillProficiencies: ['Persuasion'],
    });
    expect(bonus(bard, 'Arcana')).toBe(0 + 1);
    expect(bonus(bard, 'Stealth')).toBe(3 + 1);
    expect(bonus(bard, 'Persuasion')).toBe(-1 + 3);
    const lvl1 = sheet({ class: { key: 'class:bard', name: 'Bard' } });
    expect(bonus(lvl1, 'Arcana')).toBe(0);
  });

  it('adds Remarkable Athlete (half PB, up) to non-proficient Str/Dex only at champion 7', () => {
    const champion = (level: number, profs: string[] = []) =>
      sheet({
        level,
        class: { key: 'class:fighter', name: 'Fighter' },
        subclass: { key: 'subclass:champion', name: 'Champion' },
        proficiencyBonus: 3,
        skillProficiencies: profs,
      });
    expect(bonus(champion(7), 'Athletics')).toBe(1 + 2);
    expect(bonus(champion(7), 'Acrobatics')).toBe(3 + 2);
    expect(bonus(champion(7), 'Arcana')).toBe(0);
    expect(bonus(champion(7, ['Athletics']), 'Athletics')).toBe(1 + 3);
    expect(bonus(champion(6), 'Athletics')).toBe(1);
  });

  it('renders a compact skills line', () => {
    expect(renderSkillsLine(rogue)).toBe(
      'Skills: Perception +4, Stealth +7 (expertise); passive Perception 14',
    );
  });
});
