// Deterministic skill-bonus derivation (eshyra-b0hg.1).
//
// Pure derivation from a finalized sheet: ability modifier plus proficiency
// bonus x (2 expertise | 1 proficient | 0), plus the two SRD features that add
// to ability checks deterministically. The `resolve_check` tool contract is
// unchanged: the DM still declares modifiers; this feeds the model-facing
// sheet context so it declares the right ones.

import type { AbilityScoreName } from './creation.js';
import type { CharacterSheet } from './finalizeCharacter.js';
import { characterExpertise } from './levelUpExpertise.js';
import {
  SRD_5_1_SKILL_ABILITIES,
  SRD_5_1_SKILLS,
} from './srdCreationChoices.js';

export type SkillProficiencyLevel = 'none' | 'proficient' | 'expertise';

export interface DerivedSkillBonus {
  readonly skill: string;
  readonly ability: AbilityScoreName;
  readonly proficiency: SkillProficiencyLevel;
  readonly bonus: number;
  /** Which feature's half-proficiency term is included, if any. */
  readonly featureBonus?: 'Jack of All Trades' | 'Remarkable Athlete';
}

export interface DerivedSkills {
  readonly skills: readonly DerivedSkillBonus[];
  readonly passivePerception: number;
}

// SRD 5.1 Bard (p. 12), Jack of All Trades, 2nd level: "you can add half your
// proficiency bonus, rounded down, to any ability check you make that doesn't
// already include your proficiency bonus."
const JACK_OF_ALL_TRADES_LEVEL = 2;
// SRD 5.1 Fighter, Champion, Remarkable Athlete, 7th level: "you can add half
// your proficiency bonus (round up) to any Strength, Dexterity, or
// Constitution check you make that doesn't already use your proficiency bonus."
const REMARKABLE_ATHLETE_LEVEL = 7;

// Feature availability depends only on class/subclass and level, never on
// whether a named skill happens to consume the bonus (eshyra-b0hg.3).
const holdsJackOfAllTrades = (sheet: CharacterSheet): boolean =>
  sheet.class.key === 'class:bard' && sheet.level >= JACK_OF_ALL_TRADES_LEVEL;
const holdsRemarkableAthlete = (sheet: CharacterSheet): boolean =>
  sheet.subclass?.key === 'subclass:champion' &&
  sheet.level >= REMARKABLE_ATHLETE_LEVEL;

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const skillAbility = (skill: string): AbilityScoreName => {
  for (const [ability, skills] of Object.entries(SRD_5_1_SKILL_ABILITIES)) {
    if (skills.includes(skill)) return ability as AbilityScoreName;
  }
  throw new Error(`Unknown SRD skill: ${skill}`);
};

/**
 * The half-proficiency term an ability check gains from Jack of All Trades or
 * Remarkable Athlete, for a check that does not already include proficiency.
 * Shared by skill checks and raw ability checks (eshyra-r8en.1).
 */
export function halfProficiencyFeature(
  sheet: CharacterSheet,
  ability: AbilityScoreName,
):
  | {
      readonly name: 'Jack of All Trades' | 'Remarkable Athlete';
      readonly value: number;
    }
  | undefined {
  const pb = sheet.proficiencyBonus;
  const physical =
    ability === 'strength' ||
    ability === 'dexterity' ||
    ability === 'constitution';
  const jackAdd = holdsJackOfAllTrades(sheet) ? Math.floor(pb / 2) : 0;
  const athleteAdd =
    holdsRemarkableAthlete(sheet) && physical ? Math.ceil(pb / 2) : 0;
  if (jackAdd <= 0 && athleteAdd <= 0) return undefined;
  // One class sheet holds at most one of these; if both ever apply the larger
  // single term is used (they are the same "half proficiency").
  return athleteAdd > jackAdd
    ? { name: 'Remarkable Athlete', value: athleteAdd }
    : { name: 'Jack of All Trades', value: jackAdd };
}

export function deriveSkillBonuses(sheet: CharacterSheet): DerivedSkills {
  const proficient = new Set((sheet.skillProficiencies ?? []).map(norm));
  const expertise = new Set(
    [...characterExpertise(sheet)].map((id) => norm(id.replace(/^skill:/, ''))),
  );
  const pb = sheet.proficiencyBonus;

  const skills = SRD_5_1_SKILLS.map((skill): DerivedSkillBonus => {
    const ability = skillAbility(skill);
    const key = norm(skill);
    const level: SkillProficiencyLevel = expertise.has(key)
      ? 'expertise'
      : proficient.has(key)
        ? 'proficient'
        : 'none';
    let bonus =
      sheet.abilityScores[ability].modifier +
      pb * (level === 'expertise' ? 2 : level === 'proficient' ? 1 : 0);
    let featureBonus: DerivedSkillBonus['featureBonus'];
    if (level === 'none') {
      const feature = halfProficiencyFeature(sheet, ability);
      if (feature !== undefined) {
        bonus += feature.value;
        featureBonus = feature.name;
      }
    }
    return {
      skill,
      ability,
      proficiency: level,
      bonus,
      ...(featureBonus === undefined ? {} : { featureBonus }),
    };
  });

  const perception = skills.find((s) => s.skill === 'Perception');
  return { skills, passivePerception: 10 + (perception?.bonus ?? 0) };
}

const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

/** Compact model-facing skills line for the character sheet context. */
export function renderSkillsLine(sheet: CharacterSheet): string {
  const derived = deriveSkillBonuses(sheet);
  const held = derived.skills
    .filter((s) => s.proficiency !== 'none')
    .map(
      (s) =>
        `${s.skill} ${signed(s.bonus)}${s.proficiency === 'expertise' ? ' (expertise)' : ''}`,
    );
  const notes: string[] = [];
  if (holdsJackOfAllTrades(sheet)) {
    notes.push(
      `Jack of All Trades: +${Math.floor(sheet.proficiencyBonus / 2)} on other ability checks`,
    );
  }
  if (holdsRemarkableAthlete(sheet)) {
    notes.push(
      `Remarkable Athlete: +${Math.ceil(sheet.proficiencyBonus / 2)} on other Str/Dex/Con checks`,
    );
  }
  return `Skills: ${held.length > 0 ? held.join(', ') : 'none proficient'}; passive Perception ${derived.passivePerception}${notes.length > 0 ? `; ${notes.join('; ')}` : ''}`;
}
