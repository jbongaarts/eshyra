// Level-up Expertise picks (eshyra-ug4i.1): rogue 6, bard 3 and 10.
//
// Expertise is a choice among the character's OWN held proficiencies, not an
// option catalog, so it is not a `LIST_CHOICE_CATEGORIES` category. This module
// derives the required-choice descriptor from the pack's
// `characterStateFilter`, validates the player's picks (exactly `choose`,
// distinct, each currently eligible) and builds the applied choice the engine
// persists on `CharacterSheet.featureChoices` (choiceId 'expertise').
//
// Not here: rogue level-1 expertise (character creation, eshyra-nnj6), and any
// mechanical effect. The pick is recorded; doubling the proficiency bonus stays
// the caller's `multiplier: 'double'` on the check tool until a deterministic
// skill-bonus derivation exists.

import type { FeatureChoice } from '../rules/featureChoices.js';
import type { CharacterSheet } from './finalizeCharacter.js';
import type {
  LevelUpAppliedChoice,
  LevelUpChoiceOption,
  LevelUpRequiredChoice,
} from './levelUpEngine.js';
import { descriptorId } from './levelUpFeatureChoices.js';
import type { RulesPackCharacterResolver } from './rulesPackResolver.js';

/**
 * Picks a REPEATED expertise grant adds. The pack repeats only the feature ref
 * at the later level (its `choices[].choose` describes the first grant), so the
 * SRD prose is the authority: Rogue "At 6th level, you can choose two more of
 * your proficiencies (in skills or with thieves' tools)"; Bard "At 10th level,
 * you can choose another two skill proficiencies".
 */
const REPEATED_EXPERTISE_PICKS = 2;

export const EXPERTISE_CHOICE_ID = 'expertise';

const isExpertiseFeatureRef = (ref: string): boolean =>
  ref.slice(ref.lastIndexOf(':') + 1) === 'expertise';

/** Option ids already holding expertise, across every expertise feature. */
export function characterExpertise(sheet: CharacterSheet): ReadonlySet<string> {
  const held = new Set<string>();
  for (const entry of sheet.featureChoices ?? []) {
    if (
      entry.choiceId === EXPERTISE_CHOICE_ID &&
      isExpertiseFeatureRef(entry.featureRef)
    ) {
      for (const id of entry.optionIds) held.add(id);
    }
  }
  return held;
}

/** Case, apostrophe and punctuation agnostic: "Thieves’ Tools" -> "thievestools". */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

interface ExpertiseFilter {
  readonly proficiencyTypes: readonly string[];
  readonly tools: readonly string[];
}

function expertiseFilter(choice: FeatureChoice): ExpertiseFilter | undefined {
  const from = choice.from;
  if (from === null || typeof from !== 'object' || Array.isArray(from)) {
    return undefined;
  }
  const record = from as Record<string, unknown>;
  const strings = (value: unknown): readonly string[] | undefined =>
    value === undefined
      ? []
      : Array.isArray(value) && value.every((v) => typeof v === 'string')
        ? (value as string[])
        : undefined;
  const proficiencyTypes = strings(record.proficiencyTypes);
  const tools = strings(record.tools);
  if (
    record.kind !== 'characterStateFilter' ||
    proficiencyTypes === undefined ||
    tools === undefined ||
    proficiencyTypes.some((type) => type !== 'skill')
  ) {
    return undefined;
  }
  return { proficiencyTypes, tools };
}

function eligibleOptions(
  sheet: CharacterSheet,
  filter: ExpertiseFilter,
): readonly LevelUpChoiceOption[] {
  const taken = characterExpertise(sheet);
  const options: LevelUpChoiceOption[] = [];
  if (filter.proficiencyTypes.includes('skill')) {
    for (const skill of sheet.skillProficiencies) {
      options.push({ id: `skill:${skill}`, name: skill });
    }
  }
  for (const tool of filter.tools) {
    const held = sheet.toolProficiencies.find(
      (name) => normalizeName(name) === normalizeName(tool),
    );
    if (held !== undefined) options.push({ id: `tool:${tool}`, name: held });
  }
  return options.filter((option) => !taken.has(option.id));
}

export interface ExpertiseDetectionContext {
  readonly sheet: CharacterSheet;
  readonly toLevel: number;
  readonly targetFeatureRefs: readonly string[];
  readonly heldFeatureRefs: ReadonlySet<string>;
  readonly resolver: RulesPackCharacterResolver;
}

/** Expertise descriptors for the features granted at this level-up. */
export function detectExpertiseDescriptors(ctx: ExpertiseDetectionContext): {
  readonly choices: readonly LevelUpRequiredChoice[];
  readonly coveredFeatureRefs: ReadonlySet<string>;
} {
  const choices: LevelUpRequiredChoice[] = [];
  const covered = new Set<string>();
  const features = ctx.resolver.listFeatures();
  for (const ref of new Set(ctx.targetFeatureRefs)) {
    if (!isExpertiseFeatureRef(ref)) continue;
    const feature = features.find((candidate) => candidate.key === ref);
    for (const choice of feature?.choices ?? []) {
      if (feature === undefined || choice.category !== 'expertise') continue;
      covered.add(ref);
      const count = ctx.heldFeatureRefs.has(ref)
        ? REPEATED_EXPERTISE_PICKS
        : choice.choose;
      const filter = expertiseFilter(choice);
      const base = {
        id: descriptorId(ctx.toLevel, ref, choice.id),
        kind: 'expertise' as const,
        label: `${feature.name}: choose ${count ?? '?'} proficiencies`,
        featureRef: ref,
        reason: `level ${ctx.toLevel} ${choice.prompt}`,
      };
      if (typeof count !== 'number' || filter === undefined) {
        choices.push({
          ...base,
          status: 'unsupported',
          unsupportedReason: `Expertise choice '${choice.id}' on '${ref}' has no recognised count/characterStateFilter; deterministic application is not implemented.`,
        });
        continue;
      }
      const options = eligibleOptions(ctx.sheet, filter);
      if (options.length < count) {
        choices.push({
          ...base,
          status: 'unsupported',
          choose: count,
          unsupportedReason: `Expertise needs ${count} eligible proficiencies but the sheet holds only ${options.length} without expertise; the sheet's proficiencies are incomplete, so no picks are guessed.`,
        });
        continue;
      }
      choices.push({
        ...base,
        status: 'supported',
        choose: count,
        from: options.map((option) => option.id),
        options,
        featureChoice: { featureRef: ref, choiceId: choice.id },
      });
    }
  }
  return { choices, coveredFeatureRefs: covered };
}

export type ExpertiseResolution =
  | { readonly ok: true; readonly applied: LevelUpAppliedChoice }
  | { readonly ok: false; readonly reason: string };

/** Validate an expertise selection and build the applied choice. */
export function resolveExpertiseSelection(
  choice: LevelUpRequiredChoice,
  selected: readonly string[],
  targetLevel: number,
): ExpertiseResolution {
  const ref = choice.featureChoice;
  if (ref === undefined) {
    return { ok: false, reason: 'not an expertise descriptor' };
  }
  const expected = choice.choose ?? 0;
  if (selected.length !== expected) {
    return {
      ok: false,
      reason: `expected exactly ${expected} selection(s), received ${selected.length}`,
    };
  }
  if (new Set(selected).size !== selected.length) {
    return { ok: false, reason: 'selections must be distinct' };
  }
  const eligible = new Set(choice.from ?? []);
  for (const id of selected) {
    if (!eligible.has(id)) {
      return {
        ok: false,
        reason: `'${id}' is not an eligible proficiency (not held, or already has expertise)`,
      };
    }
  }
  return {
    ok: true,
    applied: {
      id: choice.id,
      kind: 'expertise',
      value: selected.join(', '),
      label: choice.label,
      featureRefs: [],
      featureChoice: {
        featureRef: ref.featureRef,
        choiceId: ref.choiceId,
        optionIds: [...selected],
        level: targetLevel,
      },
    },
  };
}
