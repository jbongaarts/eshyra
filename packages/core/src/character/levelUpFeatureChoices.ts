// Option-catalog / list feature choices at level-up (eshyra-ug4i.3).
//
// A class or subclass feature gained (or grown) at a level-up may carry a
// structured `choices[]` entry whose `from` is a discrete option list: a
// Fighting Style, Metamagic options, Eldritch Invocations, a Pact Boon, a
// Hunter option. This module derives the required-choice descriptors for them
// from the generated rules pack, validates the player's selections against the
// pack's option catalog and structured prerequisites, and builds the applied
// choice the engine persists on `CharacterSheet.featureChoices`.
//
// Scope and what is deliberately NOT here:
//   - Mechanical effects of a chosen option (Archery's +2, an invocation's
//     benefit) are NOT implemented; they stay DM-adjudicated until a later
//     bead selects them as deterministic capabilities.
//   - Expertise (eshyra-ug4i.1), every spell/cantrip category (eshyra-ug4i.2),
//     the asiOrFeat feat variant and Channel Divinity are not handled here; the
//     engine keeps them fail-closed.
//   - Feature improvements (Ranger Favored Enemy / Natural Explorer growth at
//     6/10/14) are carried by the pack only as `featureImprovement` rows with no
//     option structure, so the engine keeps emitting them as unsupported.

import type { FeatureChoice } from '../rules/featureChoices.js';
import type {
  CharacterFeatureChoice,
  CharacterSheet,
} from './finalizeCharacter.js';
import type {
  LevelUpAppliedChoice,
  LevelUpChoiceOption,
  LevelUpChoiceSelections,
  LevelUpRequiredChoice,
} from './levelUpEngine.js';
import type {
  ResolvedFeatureData,
  RulesPackCharacterResolver,
} from './rulesPackResolver.js';

/** Choice categories this slice collects as structured list choices. */
const LIST_CHOICE_CATEGORIES: ReadonlySet<string> = new Set([
  'fightingStyle',
  'metamagic',
  'invocation',
  'favoredEnemy',
  'naturalExplorer',
  'other',
]);

/**
 * Picks gained when an already-held feature is granted AGAIN by a later
 * progression row. The pack repeats only the feature ref (its `choices[].choose`
 * still describes the first grant), so the SRD prose is the authority:
 * Metamagic - "You gain two ... options at 3rd level. You gain another one at
 * 10th and 17th level." A repeated grant of a category absent here is emitted
 * unsupported rather than guessed.
 */
const REPEATED_GRANT_PICKS: Readonly<Record<string, number>> = {
  metamagic: 1,
};

/**
 * Choices that exist only because of one option of a sibling list choice
 * (SRD: "If you choose Pact of the Tome, choose three cantrips..."). They are
 * surfaced as unsupported (owned by eshyra-ug4i.2) only when the triggering
 * option is picked in this very level-up, so a Chain/Blade warlock never
 * blocks on them. A pick held from an earlier level-up was already resolved (or
 * blocked) at that level.
 */
const CONDITIONAL_CHOICES: Readonly<
  Record<string, { readonly triggerOption: string; readonly label: string }>
> = {
  'pact-of-the-tome-cantrips': {
    triggerOption: 'pact-boon:pact-of-the-tome',
    label: 'Pact of the Tome cantrips',
  },
  'book-of-ancient-secrets-rituals': {
    triggerOption: 'eldritch-invocation:book-of-ancient-secrets',
    label: 'Book of Ancient Secrets rituals',
  },
};

export interface FeatureChoiceDetectionContext {
  readonly sheet: CharacterSheet;
  readonly classKey: string;
  readonly fromLevel: number;
  readonly toLevel: number;
  /** Feature refs granted at the target level (class row + subclass features). */
  readonly targetFeatureRefs: readonly string[];
  /** Feature refs granted at any earlier level (class rows + subclass features). */
  readonly heldFeatureRefs: ReadonlySet<string>;
  /** `invocationsKnown` on the from/to rows, when the class carries it. */
  readonly invocationsKnown: {
    readonly from: number | undefined;
    readonly to: number | undefined;
  };
  readonly resolver: RulesPackCharacterResolver;
  readonly selections: LevelUpChoiceSelections;
}

export function featureSlug(featureRef: string): string {
  return featureRef
    .replace(/^feature:/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function descriptorId(
  toLevel: number,
  featureRef: string,
  choiceId: string,
): string {
  return `level.${toLevel}.feature.${featureSlug(featureRef)}.${choiceId}`;
}

function isListChoice(choice: FeatureChoice): boolean {
  return (
    choice.unsupported === undefined &&
    LIST_CHOICE_CATEGORIES.has(choice.category) &&
    Array.isArray(choice.from) &&
    typeof choice.choose === 'number'
  );
}

function optionsOf(choice: FeatureChoice): readonly LevelUpChoiceOption[] {
  const byId = new Map((choice.options ?? []).map((o) => [o.id, o]));
  return (choice.from as readonly string[]).map((id) => {
    const option = byId.get(id);
    return {
      id,
      name: option?.name ?? id,
      ...(option?.prerequisite !== undefined
        ? { prerequisite: option.prerequisite }
        : {}),
      ...(option?.prerequisites !== undefined
        ? { prerequisites: option.prerequisites }
        : {}),
    };
  });
}

/**
 * Option ids already held that block re-taking `choice`. Fighting Style options
 * may not be repeated across ANY fighting-style choice ("You can't take a
 * Fighting Style option more than once, even if you later get to choose
 * again"); every other category blocks only within the same feature + choice.
 */
function heldOptionIds(
  sheet: CharacterSheet,
  featureRef: string,
  choice: FeatureChoice,
): ReadonlySet<string> {
  const held = new Set<string>();
  for (const entry of sheet.featureChoices ?? []) {
    const sameChoice =
      entry.featureRef === featureRef && entry.choiceId === choice.id;
    if (sameChoice || choice.category === 'fightingStyle') {
      if (
        sameChoice ||
        entry.optionIds.every((id) => id.startsWith('fighting-style:'))
      ) {
        for (const id of entry.optionIds) held.add(id);
      }
    }
  }
  return held;
}

function featureOf(
  resolver: RulesPackCharacterResolver,
  ref: string,
): ResolvedFeatureData | undefined {
  return resolver.listFeatures().find((feature) => feature.key === ref);
}

/**
 * Required-choice descriptors for option-catalog list choices at this level-up:
 * newly granted features, count growth of held features (repeated grant;
 * progression `invocationsKnown` delta), the optional invocation replacement,
 * and conditional choices triggered by an option selected in this level-up.
 * Also reports which feature refs the structured path covered, so the engine
 * falls back to its legacy fail-closed descriptor for any it did not.
 */
export function detectFeatureChoiceDescriptors(
  ctx: FeatureChoiceDetectionContext,
): {
  readonly choices: readonly LevelUpRequiredChoice[];
  readonly coveredFeatureRefs: ReadonlySet<string>;
} {
  const choices: LevelUpRequiredChoice[] = [];
  const covered = new Set<string>();
  const seen = new Set<string>();
  const introduced = new Set<string>(); // featureRef\0choiceId handled as new/grown

  for (const ref of ctx.targetFeatureRefs) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    const feature = featureOf(ctx.resolver, ref);
    if (feature === undefined) continue;
    const repeated = ctx.heldFeatureRefs.has(ref);
    for (const choice of feature.choices ?? []) {
      if (isListChoice(choice)) {
        covered.add(ref);
        introduced.add(`${ref}\0${choice.id}`);
        const count = repeated
          ? REPEATED_GRANT_PICKS[choice.category]
          : (choice.choose as number);
        choices.push(
          count === undefined
            ? unsupportedRepeatedGrant(ctx, feature, choice)
            : listDescriptor(ctx, feature, choice, count),
        );
        continue;
      }
      const conditional = CONDITIONAL_CHOICES[choice.id];
      if (conditional !== undefined) {
        covered.add(ref);
        if (
          selectedOptionIds(ctx.selections, ctx.toLevel).has(
            conditional.triggerOption,
          )
        ) {
          choices.push({
            id: descriptorId(ctx.toLevel, ref, choice.id),
            kind: 'spell-selection',
            status: 'unsupported',
            label: conditional.label,
            featureRef: ref,
            reason: `${conditional.label}: ${choice.prompt}`,
            unsupportedReason:
              'This spell selection is owned by the level-up spell-selection work (eshyra-ug4i.2) and is not implemented yet.',
          });
        }
      }
    }
  }

  // Invocation growth: the feature is already held and the progression row's
  // invocationsKnown column rose (warlock 5/7/9/12/15/18).
  const grown =
    (ctx.invocationsKnown.to ?? 0) - (ctx.invocationsKnown.from ?? 0);
  for (const ref of ctx.heldFeatureRefs) {
    const feature = featureOf(ctx.resolver, ref);
    for (const choice of feature?.choices ?? []) {
      if (feature === undefined || !isListChoice(choice)) continue;
      if (choice.category !== 'invocation') continue;
      if (grown > 0 && !introduced.has(`${ref}\0${choice.id}`)) {
        choices.push(listDescriptor(ctx, feature, choice, grown));
      }
      const held = [...heldOptionIds(ctx.sheet, ref, choice)];
      if (held.length > 0) {
        choices.push(replacementDescriptor(ctx, feature, choice, held));
      }
    }
  }
  return { choices, coveredFeatureRefs: covered };
}

function selectedOptionIds(
  selections: LevelUpChoiceSelections,
  toLevel: number,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const [key, values] of Object.entries(selections)) {
    if (key.startsWith(`level.${toLevel}.feature.`)) {
      for (const value of values) ids.add(value);
    }
  }
  return ids;
}

function listDescriptor(
  ctx: FeatureChoiceDetectionContext,
  feature: ResolvedFeatureData,
  choice: FeatureChoice,
  count: number,
): LevelUpRequiredChoice {
  const held = heldOptionIds(ctx.sheet, feature.key, choice);
  const options = optionsOf(choice).filter((option) => !held.has(option.id));
  return {
    id: descriptorId(ctx.toLevel, feature.key, choice.id),
    kind:
      choice.category === 'fightingStyle'
        ? 'fighting-style'
        : 'class-feature-choice',
    status: 'supported',
    label: `${feature.name}: choose ${count} (${choice.id})`,
    choose: count,
    from: options.map((option) => option.id),
    options,
    featureRef: feature.key,
    featureChoice: { featureRef: feature.key, choiceId: choice.id },
    reason: `level ${ctx.toLevel} ${choice.prompt}`,
  };
}

function unsupportedRepeatedGrant(
  ctx: FeatureChoiceDetectionContext,
  feature: ResolvedFeatureData,
  choice: FeatureChoice,
): LevelUpRequiredChoice {
  return {
    id: descriptorId(ctx.toLevel, feature.key, choice.id),
    kind: 'class-feature-choice',
    status: 'unsupported',
    label: `${feature.name} (${choice.id})`,
    featureRef: feature.key,
    reason: `level ${ctx.toLevel} grants '${feature.key}' again, which adds picks`,
    unsupportedReason: `The pack repeats '${feature.key}' without stating how many '${choice.category}' options the repeated grant adds; deterministic application is not implemented.`,
  };
}

function replacementDescriptor(
  ctx: FeatureChoiceDetectionContext,
  feature: ResolvedFeatureData,
  choice: FeatureChoice,
  held: readonly string[],
): LevelUpRequiredChoice {
  const options = optionsOf(choice).filter(
    (option) => !held.includes(option.id),
  );
  return {
    id: `${descriptorId(ctx.toLevel, feature.key, choice.id)}.replace`,
    kind: 'class-feature-choice',
    status: 'supported',
    optional: true,
    label: `${feature.name}: optionally replace one known option [old, new]`,
    choose: 2,
    from: options.map((option) => option.id),
    options,
    featureRef: feature.key,
    featureChoice: {
      featureRef: feature.key,
      choiceId: choice.id,
      replacement: true,
      heldOptionIds: held,
    },
    reason:
      'When you gain a level in this class, you can choose one of the invocations you know and replace it with another invocation that you could learn at that level.',
  };
}

export type FeatureChoiceResolution =
  | { readonly ok: true; readonly applied?: LevelUpAppliedChoice }
  | { readonly ok: false; readonly reason: string };

/**
 * Validate one feature-choice descriptor's selection against the post-level-up
 * state and build the applied choice. A refused selection names the offending
 * option and the rule it breaks; unknown prerequisite kinds fail closed.
 */
export function resolveFeatureChoiceSelection(
  choice: LevelUpRequiredChoice,
  selected: readonly string[],
  sheet: CharacterSheet,
  targetLevel: number,
  resolver: RulesPackCharacterResolver,
  allSelections: LevelUpChoiceSelections,
): FeatureChoiceResolution {
  const ref = choice.featureChoice;
  if (ref === undefined) {
    return { ok: false, reason: 'not a feature choice descriptor' };
  }
  if (choice.optional === true && selected.length === 0) {
    return { ok: true };
  }
  const expected = choice.choose ?? 1;
  if (selected.length !== expected) {
    return {
      ok: false,
      reason: `expected exactly ${expected} selection(s), received ${selected.length}`,
    };
  }
  if (new Set(selected).size !== selected.length) {
    return { ok: false, reason: 'selections must be distinct' };
  }
  const optionsById = new Map(
    (choice.options ?? []).map((option) => [option.id, option]),
  );
  const picks = ref.replacement === true ? selected.slice(1) : selected;
  let replaces: string | undefined;
  if (ref.replacement === true) {
    replaces = selected[0] as string;
    if (!(ref.heldOptionIds ?? []).includes(replaces)) {
      return {
        ok: false,
        reason: `'${replaces}' is not currently held, so it cannot be replaced`,
      };
    }
  }
  const inLevel = selectedOptionIds(allSelections, targetLevel);
  for (const id of picks) {
    const option = optionsById.get(id);
    if (option === undefined) {
      return {
        ok: false,
        reason: `'${id}' is not a legal option (already held or not in the catalog)`,
      };
    }
    const unmet = unmetPrerequisite(
      option,
      sheet,
      targetLevel,
      resolver,
      inLevel,
    );
    if (unmet !== undefined) {
      return {
        ok: false,
        reason: `option '${id}' prerequisite not met: ${unmet}`,
      };
    }
  }
  return {
    ok: true,
    applied: {
      id: choice.id,
      kind:
        choice.kind === 'fighting-style'
          ? 'fighting-style'
          : 'class-feature-choice',
      value: selected.join(', '),
      label: choice.label,
      featureRefs: [],
      featureChoice: {
        featureRef: ref.featureRef,
        choiceId: ref.choiceId,
        optionIds: picks,
        level: targetLevel,
        ...(replaces !== undefined ? { replaces } : {}),
      },
    },
  };
}

function unmetPrerequisite(
  option: LevelUpChoiceOption,
  sheet: CharacterSheet,
  targetLevel: number,
  resolver: RulesPackCharacterResolver,
  inLevelOptionIds: ReadonlySet<string>,
): string | undefined {
  if (option.prerequisite !== undefined && option.prerequisites === undefined) {
    return `'${option.prerequisite}' has no structured form (refused)`;
  }
  for (const pre of option.prerequisites ?? []) {
    const kind = (pre as { kind: string }).kind;
    if (pre.kind === 'level') {
      if (pre.classRef !== sheet.class.key || targetLevel < pre.level) {
        return `${pre.classRef} level ${pre.level} (will be level ${targetLevel})`;
      }
    } else if (pre.kind === 'pactBoon') {
      const held = (sheet.featureChoices ?? []).some(
        (entry) =>
          entry.featureRef === pre.featureRef &&
          entry.optionIds.includes(pre.ref),
      );
      if (!held && !inLevelOptionIds.has(pre.ref)) {
        return `requires ${pre.ref}`;
      }
    } else if (pre.kind === 'cantrip') {
      const known = sheet.spells.some((spell) => {
        const resolved = resolver.resolveSpell(spell);
        return resolved.ok && resolved.record.key === pre.ref;
      });
      if (!known) {
        return `requires the ${pre.ref} cantrip`;
      }
    } else {
      return `unknown prerequisite kind '${kind}' (refused)`;
    }
  }
  return undefined;
}

/** Apply one applied feature choice to the sheet's `featureChoices` (immutably). */
export function applyFeatureChoicesToSheet(
  existing: readonly CharacterFeatureChoice[] | undefined,
  applied: readonly LevelUpAppliedChoice[],
): readonly CharacterFeatureChoice[] | undefined {
  let next = [...(existing ?? [])];
  let touched = false;
  for (const choice of applied) {
    const fc = choice.featureChoice;
    if (fc === undefined) continue;
    touched = true;
    if (fc.replaces !== undefined) {
      next = next.map((entry) =>
        entry.featureRef === fc.featureRef &&
        entry.choiceId === fc.choiceId &&
        entry.optionIds.includes(fc.replaces as string)
          ? {
              ...entry,
              optionIds: entry.optionIds.map((id) =>
                id === fc.replaces ? (fc.optionIds[0] as string) : id,
              ),
            }
          : entry,
      );
    } else {
      next.push({
        featureRef: fc.featureRef,
        choiceId: fc.choiceId,
        optionIds: [...fc.optionIds],
        level: fc.level,
      });
    }
  }
  return touched ? next : existing;
}
