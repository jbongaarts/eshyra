// Skill-proficiency feature choices at level-up (eshyra-91o0).
//
// A class/subclass feature gained at a level-up may carry a structured
// `category: 'skill'` choice whose `from` is a skill-name list (College of
// Lore Bonus Proficiencies: "three skills of your choice"). This module
// derives the required-choice descriptor, validates the selection (exact
// count, distinct, eligible, not already held) and builds the applied choice,
// which the engine persists BOTH as new `skillProficiencies` and as a
// `featureChoices` entry. Expertise is a different category and is not handled
// here.

import type { FeatureChoice } from '../rules/featureChoices.js';
import type { CharacterSheet } from './finalizeCharacter.js';
import {
  choiceInstanceKey,
  descriptorId,
  type HandledChoiceInstances,
} from './levelUpChoiceCoverage.js';
import type {
  LevelUpAppliedChoice,
  LevelUpRequiredChoice,
} from './levelUpEngine.js';
import type { RulesPackCharacterResolver } from './rulesPackResolver.js';

function isSkillListChoice(choice: FeatureChoice): boolean {
  return (
    choice.category === 'skill' &&
    choice.unsupported === undefined &&
    Array.isArray(choice.from) &&
    typeof choice.choose === 'number'
  );
}

function heldSkills(sheet: CharacterSheet): ReadonlySet<string> {
  return new Set(sheet.skillProficiencies.map((s) => s.toLowerCase()));
}

/**
 * Descriptors for skill choices on features GRANTED at this level-up. A
 * repeated grant of an already-held feature is left to the coverage invariant
 * (the pack does not state how many skills a repeat adds).
 */
export function detectSkillChoiceDescriptors(ctx: {
  readonly sheet: CharacterSheet;
  readonly toLevel: number;
  readonly targetFeatureRefs: readonly string[];
  readonly heldFeatureRefs: ReadonlySet<string>;
  readonly resolver: RulesPackCharacterResolver;
}): {
  readonly choices: readonly LevelUpRequiredChoice[];
  readonly handledInstances: HandledChoiceInstances;
} {
  const out: LevelUpRequiredChoice[] = [];
  const handled = new Set<string>();
  const seen = new Set<string>();
  const held = heldSkills(ctx.sheet);
  for (const ref of ctx.targetFeatureRefs) {
    if (seen.has(ref) || ctx.heldFeatureRefs.has(ref)) continue;
    seen.add(ref);
    const feature = ctx.resolver
      .listFeatures()
      .find((entry) => entry.key === ref);
    for (const choice of feature?.choices ?? []) {
      if (feature === undefined || !isSkillListChoice(choice)) continue;
      handled.add(choiceInstanceKey(ref, choice.id));
      const options = (choice.from as readonly string[])
        .filter((skill) => !held.has(skill.toLowerCase()))
        .map((skill) => ({ id: skill, name: skill }));
      out.push({
        id: descriptorId(ctx.toLevel, ref, choice.id),
        kind: 'class-feature-choice',
        status: 'supported',
        label: `${feature.name}: choose ${choice.choose} skill(s) (${choice.id})`,
        choose: choice.choose as number,
        from: options.map((option) => option.id),
        options,
        featureRef: ref,
        featureChoice: { featureRef: ref, choiceId: choice.id },
        skillChoice: true,
        reason: `level ${ctx.toLevel} ${choice.prompt}`,
      });
    }
  }
  return { choices: out, handledInstances: handled };
}

export type SkillChoiceResolution =
  | { readonly ok: true; readonly applied: LevelUpAppliedChoice }
  | { readonly ok: false; readonly reason: string };

/** Validate a skill selection and build the applied choice. */
export function resolveSkillChoiceSelection(
  choice: LevelUpRequiredChoice,
  selected: readonly string[],
  sheet: CharacterSheet,
  targetLevel: number,
): SkillChoiceResolution {
  const ref = choice.featureChoice;
  if (ref === undefined) {
    return { ok: false, reason: 'not a skill choice descriptor' };
  }
  const expected = choice.choose ?? 1;
  if (selected.length !== expected) {
    return {
      ok: false,
      reason: `expected exactly ${expected} skill(s), received ${selected.length}`,
    };
  }
  if (new Set(selected.map((s) => s.toLowerCase())).size !== selected.length) {
    return { ok: false, reason: 'selections must be distinct' };
  }
  const held = heldSkills(sheet);
  const eligible = new Map(
    (choice.from ?? []).map((skill) => [skill.toLowerCase(), skill]),
  );
  const canonical: string[] = [];
  for (const skill of selected) {
    const match = eligible.get(skill.toLowerCase());
    if (match === undefined) {
      return { ok: false, reason: `'${skill}' is not an eligible skill` };
    }
    if (held.has(match.toLowerCase())) {
      return { ok: false, reason: `'${match}' is already a held proficiency` };
    }
    canonical.push(match);
  }
  return {
    ok: true,
    applied: {
      id: choice.id,
      kind: 'class-feature-choice',
      value: canonical.join(', '),
      label: choice.label,
      featureRefs: [],
      skillProficiencies: canonical,
      featureChoice: {
        featureRef: ref.featureRef,
        choiceId: ref.choiceId,
        optionIds: canonical,
        level: targetLevel,
      },
    },
  };
}

/** Append newly chosen skill proficiencies to the sheet's list (immutably). */
export function applySkillProficienciesToSheet(
  existing: readonly string[],
  applied: readonly LevelUpAppliedChoice[],
): readonly string[] {
  const next = [...existing];
  for (const choice of applied) {
    for (const skill of choice.skillProficiencies ?? []) {
      if (!next.some((s) => s.toLowerCase() === skill.toLowerCase())) {
        next.push(skill);
      }
    }
  }
  return next;
}
