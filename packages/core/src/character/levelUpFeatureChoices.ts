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
//   - Expertise (eshyra-ug4i.1), the asiOrFeat feat variant and Channel Divinity
//     are not handled here; the engine keeps them fail-closed. Every
//     spell/cantrip choice (including the Pact of the Tome / Book of Ancient
//     Secrets conditional ones) lives in levelUpSpells.ts (eshyra-ug4i.2).
//   - Feature improvements (eshyra-ghzh.1) are dispositioned by TARGET feature
//     in classifyFeatureImprovements: a target whose pack record carries a
//     favoredEnemy / naturalExplorer list choice (Ranger 6/10/14) is a player
//     decision, collected as one extra pick on that existing choice and
//     persisted as a SEPARATE level-tagged featureChoices entry (the level-1
//     entry is never rewritten); a fixed set of targets whose improved effect
//     no deterministic consumer reads (Wild Shape, Divine Intervention, Unarmored
//     Movement, the Paladin auras) is model-adjudicated and never blocks; any
//     other target stays an unsupported, fail-closed descriptor. Legacy sheets
//     with no recorded level-1 pick (created before eshyra-nnj6.1) proceed with
//     an empty exclusion set. Favored Enemy's "two races of humanoid"
//     alternative and its associated language are structured in the pack
//     (eshyra-mdke): `humanoid-races` is a conditional choice
//     (`requiresOption` on the sibling `favored-enemy` option `humanoids`) and
//     `favored-enemy-language` is an optional `language` choice. Both are
//     collected at creation/level 1 and on the 6th/14th-level improvement
//     pick; the language is persisted as a featureChoices entry AND appended
//     to `sheet.languages`. Which languages "your favored enemies" speak stays
//     DM-adjudicated; the pack bounds the menu.

import type { FeatureChoice } from '../rules/featureChoices.js';
import type {
  CharacterFeatureChoice,
  CharacterSheet,
} from './finalizeCharacter.js';
import {
  choiceInstanceKey,
  descriptorId,
  featureSlug,
  type HandledChoiceInstances,
} from './levelUpChoiceCoverage.js';
import type {
  LevelUpAppliedChoice,
  LevelUpChoiceOption,
  LevelUpChoiceSelections,
  LevelUpRequiredChoice,
} from './levelUpEngine.js';
import type {
  ResolvedFeatureData,
  ResolvedFeatureImprovement,
  RulesPackCharacterResolver,
} from './rulesPackResolver.js';

export { descriptorId, featureSlug } from './levelUpChoiceCoverage.js';

/** Choice categories this slice collects as structured list choices. */
const LIST_CHOICE_CATEGORIES: ReadonlySet<string> = new Set([
  'fightingStyle',
  'metamagic',
  'invocation',
  'favoredEnemy',
  'naturalExplorer',
  'language',
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
 * Spell/cantrip choices that exist only because of one option of a sibling list
 * choice (SRD: "If you choose Pact of the Tome, choose three cantrips..."). The
 * spell-selection module (levelUpSpells.ts, eshyra-ug4i.2) owns their
 * descriptors and fires them only when the triggering option is picked in this
 * very level-up; this table lets the list path mark the owning feature covered
 * so the legacy unsupported fallback for it is dropped.
 */
const CONDITIONAL_CHOICES: Readonly<Record<string, true>> = {
  'pact-of-the-tome-cantrips': true,
  'book-of-ancient-secrets-rituals': true,
};

/**
 * Targets of a `featureImprovement` row whose improved effect is a range / limit
 * / uses change that no deterministic engine capability consumes (verified:
 * nothing reads Wild Shape limits, aura range, the Divine Intervention roll, or
 * Monk 9 vertical/liquid movement). Acknowledged at level-up; the effect stays
 * DM-adjudicated and discoverable via lookup_rules.
 */
const MODEL_ADJUDICATED_IMPROVEMENT_TARGETS: ReadonlySet<string> = new Set([
  'feature:cleric:divine-intervention',
  'feature:druid:wild-shape',
  'feature:monk:unarmored-movement',
  'feature:paladin:aura-of-protection',
  'feature:paladin:aura-of-courage',
]);

const IMPROVEMENT_PLAYER_CATEGORIES: ReadonlySet<string> = new Set([
  'favoredEnemy',
  'naturalExplorer',
]);

export interface ClassifiedFeatureImprovement {
  readonly label: string;
  readonly targetRefs: readonly string[];
  /** `unsupported` when any target matches no recognized disposition. */
  readonly disposition: 'player-decision' | 'model-adjudicated' | 'unsupported';
  /** The existing list choices an extra pick is collected on (player-decision). */
  readonly picks: readonly {
    readonly feature: ResolvedFeatureData;
    readonly choice: FeatureChoice;
  }[];
}

/**
 * Disposition each improvement row of the target level by its target features
 * (not by a class/level list). One unrecognized target makes the whole row
 * unsupported so nothing is silently dropped.
 */
export function classifyFeatureImprovements(
  improvements: readonly ResolvedFeatureImprovement[],
  resolver: RulesPackCharacterResolver,
): readonly ClassifiedFeatureImprovement[] {
  return improvements.map((improvement) => {
    const picks: {
      feature: ResolvedFeatureData;
      choice: FeatureChoice;
    }[] = [];
    let recognized = true;
    for (const ref of improvement.targetRefs) {
      const feature = featureOf(resolver, ref);
      const listChoices = (feature?.choices ?? []).filter(isListChoice);
      // A feature qualifies by its favoredEnemy / naturalExplorer choice; its
      // conditional / optional siblings (humanoid races, associated language;
      // eshyra-mdke) are collected with it.
      if (
        feature !== undefined &&
        listChoices.some((choice) =>
          IMPROVEMENT_PLAYER_CATEGORIES.has(choice.category),
        )
      ) {
        for (const choice of listChoices) picks.push({ feature, choice });
      } else if (!MODEL_ADJUDICATED_IMPROVEMENT_TARGETS.has(ref)) {
        recognized = false;
      }
    }
    return {
      label: improvement.label,
      targetRefs: improvement.targetRefs,
      disposition: !recognized
        ? 'unsupported'
        : picks.length > 0
          ? 'player-decision'
          : 'model-adjudicated',
      picks,
    };
  });
}

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

function isListChoice(choice: FeatureChoice): boolean {
  return (
    choice.unsupported === undefined &&
    LIST_CHOICE_CATEGORIES.has(choice.category) &&
    Array.isArray(choice.from) &&
    typeof choice.choose === 'number'
  );
}

/**
 * A conditional choice (`requiresOption`, eshyra-mdke) applies only when its
 * trigger option of the sibling choice is picked in this very acquisition; an
 * unconditional choice always applies.
 */
function triggerSatisfied(
  ctx: Pick<FeatureChoiceDetectionContext, 'selections' | 'toLevel'>,
  feature: ResolvedFeatureData,
  choice: FeatureChoice,
): boolean {
  const trigger = choice.requiresOption;
  if (trigger === undefined) return true;
  const siblingKey = descriptorId(ctx.toLevel, feature.key, trigger.choiceId);
  return (ctx.selections[siblingKey] ?? []).includes(trigger.optionId);
}

/** Option ids a sibling choice's `requiresOption` names: re-pickable even when
 *  held (a later "additional favored enemy" may again be two humanoid races). */
function reusableOptionIds(
  feature: ResolvedFeatureData,
  choice: FeatureChoice,
): ReadonlySet<string> {
  return new Set(
    (feature.choices ?? []).flatMap((sibling) =>
      sibling.requiresOption?.choiceId === choice.id
        ? [sibling.requiresOption.optionId]
        : [],
    ),
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
  /** Every list choice instance processed (new, grown, repeated, replaced). */
  readonly handledInstances: HandledChoiceInstances;
} {
  const choices: LevelUpRequiredChoice[] = [];
  const covered = new Set<string>();
  const handled = new Set<string>();
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
        handled.add(choiceInstanceKey(ref, choice.id));
        if (!triggerSatisfied(ctx, feature, choice)) continue;
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
      if (CONDITIONAL_CHOICES[choice.id] === true) covered.add(ref); // owned by levelUpSpells.ts
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
      handled.add(choiceInstanceKey(ref, choice.id));
      if (grown > 0 && !introduced.has(`${ref}\0${choice.id}`)) {
        choices.push(listDescriptor(ctx, feature, choice, grown));
      }
      const held = [...heldOptionIds(ctx.sheet, ref, choice)];
      if (held.length > 0) {
        choices.push(replacementDescriptor(ctx, feature, choice, held));
      }
    }
  }
  return {
    choices,
    coveredFeatureRefs: covered,
    handledInstances: handled,
  };
}

/**
 * Descriptors for the target row's improvement rows: one supported "choose 1
 * additional" list descriptor per player-decision pick (options minus those
 * already held on that feature + choice), and an unsupported descriptor naming
 * the row and target refs for any unrecognized row. Model-adjudicated rows emit
 * no descriptor.
 */
export function detectFeatureImprovementDescriptors(
  ctx: FeatureChoiceDetectionContext,
  improvements: readonly ResolvedFeatureImprovement[],
): {
  readonly choices: readonly LevelUpRequiredChoice[];
  readonly handledInstances: HandledChoiceInstances;
} {
  const choices: LevelUpRequiredChoice[] = [];
  const handled = new Set<string>();
  const classified = classifyFeatureImprovements(improvements, ctx.resolver);
  for (const row of classified) {
    if (row.disposition === 'unsupported') {
      choices.push({
        id: `level.${ctx.toLevel}.feature-improvement.${featureSlug(row.label)}`,
        kind: 'class-feature-choice',
        status: 'unsupported',
        label: row.label,
        reason:
          `level ${ctx.toLevel} improves ${row.targetRefs.join(', ')} ` +
          `('${row.label}')`,
        unsupportedReason: `Feature improvement '${row.label}' (${row.targetRefs.join(', ')}) matches no player-decision or model-adjudicated disposition; deterministic application of the level-specific change is not implemented.`,
      });
      continue;
    }
    for (const { feature, choice } of row.picks) {
      handled.add(choiceInstanceKey(feature.key, choice.id));
      if (!triggerSatisfied(ctx, feature, choice)) continue;
      // Conditional / optional siblings keep their own pick count; the base
      // list choice gains exactly one additional pick.
      const sibling =
        choice.requiresOption !== undefined || choice.optional === true;
      const base = listDescriptor(
        ctx,
        feature,
        choice,
        sibling ? (choice.choose as number) : 1,
      );
      choices.push({
        ...base,
        ...(sibling
          ? {}
          : { label: `${feature.name}: choose 1 additional (${choice.id})` }),
        reason: `level ${ctx.toLevel} '${row.label}': ${choice.prompt}`,
      });
    }
  }
  return { choices, handledInstances: handled };
}

export function selectedOptionIds(
  selections: LevelUpChoiceSelections,
  toLevel: number,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const [key, values] of Object.entries(selections)) {
    if (key.startsWith(`level.${toLevel}.feature.`)) {
      for (const value of newPicks(key, values)) ids.add(value);
    }
  }
  return ids;
}

/** The options a selection adds: a replacement's first entry is the option it
 *  gives up, never a pick (so replacing Book of Ancient Secrets away does not
 *  trigger its rituals, nor satisfy a prerequisite). */
function newPicks(
  descriptorKey: string,
  values: readonly string[],
): readonly string[] {
  return descriptorKey.endsWith('.replace') ? values.slice(1) : values;
}

function listDescriptor(
  ctx: FeatureChoiceDetectionContext,
  feature: ResolvedFeatureData,
  choice: FeatureChoice,
  count: number,
): LevelUpRequiredChoice {
  const held = new Set(heldOptionIds(ctx.sheet, feature.key, choice));
  for (const id of reusableOptionIds(feature, choice)) held.delete(id);
  if (choice.category === 'language') {
    for (const language of ctx.sheet.languages ?? []) {
      held.add(language);
    }
  }
  const options = optionsOf(choice).filter(
    (option) =>
      !held.has(option.id) &&
      !(
        choice.category === 'language' &&
        [...held].some((h) => h.toLowerCase() === option.id.toLowerCase())
      ),
  );
  return {
    id: descriptorId(ctx.toLevel, feature.key, choice.id),
    kind:
      choice.category === 'fightingStyle'
        ? 'fighting-style'
        : 'class-feature-choice',
    status: 'supported',
    ...(choice.optional === true ? { optional: true } : {}),
    ...(choice.category === 'language'
      ? { languageChoice: true as const }
      : {}),
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
  // The growth pick and the replacement of the same feature choice are
  // separate descriptors; together they must not pick one option twice.
  const baseId = choice.id.replace(/\.replace$/, '');
  for (const siblingId of [baseId, `${baseId}.replace`]) {
    if (siblingId === choice.id) continue;
    const sibling = newPicks(siblingId, allSelections[siblingId] ?? []);
    const shared = picks.find((id) => sibling.includes(id));
    if (shared !== undefined) {
      return {
        ok: false,
        reason: `'${shared}' is also picked by ${siblingId}; an option can be taken only once`,
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
  if (choice.languageChoice === true) {
    const known = new Set(
      (sheet.languages ?? []).map((language) => language.toLowerCase()),
    );
    const duplicate = picks.find((id) => known.has(id.toLowerCase()));
    if (duplicate !== undefined) {
      return {
        ok: false,
        reason: `the character already knows ${duplicate}`,
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
      ...(choice.languageChoice === true ? { languages: [...picks] } : {}),
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

/** Languages learned by applied choices, appended to the sheet (deduped). */
export function applyLanguagesToSheet(
  existing: readonly string[] | undefined,
  applied: readonly LevelUpAppliedChoice[],
): readonly string[] {
  const next = [...(existing ?? [])];
  const seen = new Set(next.map((language) => language.toLowerCase()));
  for (const choice of applied) {
    for (const language of choice.languages ?? []) {
      if (seen.has(language.toLowerCase())) continue;
      seen.add(language.toLowerCase());
      next.push(language);
    }
  }
  return next;
}
