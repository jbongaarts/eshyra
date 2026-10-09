// Generalized level-up choice-coverage invariant (eshyra-91o0).
//
// After every detector has run, each pack-modeled choice INSTANCE
// (featureRef + choiceId) available at the target level on a feature the
// character gains must be accounted for. Detection used to be per-feature and
// silently skipped anything it did not recognize (subclass-granted Bonus
// Cantrip, Circle Spells, Lore proficiencies, ...). This pass is the single
// place that turns an unaccounted instance into an explicit unsupported
// descriptor, so a new pack choice can never be skipped.
//
// Contract: every detector reports the instances it took responsibility for
// at this level as `choiceInstanceKey(featureRef, choiceId)` keys, INCLUDING
// instances it evaluated and decided need no descriptor (a replacement with
// nothing held, a conditional spell choice whose trigger was not picked). The
// only thing that may account for instances by featureRef is an UNSUPPORTED
// descriptor carrying that ref, because it already blocks the level-up.

import type { FeatureChoice } from '../rules/featureChoices.js';
import type { LevelUpRequiredChoice } from './levelUpEngine.js';
import type { RulesPackCharacterResolver } from './rulesPackResolver.js';

/**
 * Choices that are NOT character-build decisions, so they never need a
 * level-up descriptor. Deliberately narrow and documented: the pack marks
 * Channel Divinity `channelDivinity` + `unsupported` precisely because SRD 5.1
 * grants the effects outright and which one to invoke is a per-use decision
 * (see deriveFeatureChoices.ts, deriveSubclassFeatureChoices).
 */
export function isUseTimeChoice(choice: FeatureChoice): boolean {
  return (
    choice.category === 'channelDivinity' && choice.unsupported !== undefined
  );
}

/**
 * The choice instances of a feature that are available at `toLevel`: the
 * entries printed for exactly that level when there are any (Mystic Arcanum
 * prints one per tier), otherwise every entry (a repeated or first grant uses
 * the entry as a template, per repeatedFeatureChoices.ts).
 */
export function choiceInstancesAtLevel(
  choices: readonly FeatureChoice[],
  toLevel: number,
): readonly FeatureChoice[] {
  const exact = choices.filter((choice) => choice.level === toLevel);
  return exact.length > 0 ? exact : choices;
}

export function featureSlug(featureRef: string): string {
  return featureRef
    .replace(/^feature:/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function descriptorId(
  toLevel: number,
  featureRef: string,
  choiceId: string,
): string {
  return `level.${toLevel}.feature.${featureSlug(featureRef)}.${choiceId}`;
}

/** Identity of one choice instance: `${featureRef}\0${choiceId}`. */
export function choiceInstanceKey(
  featureRef: string,
  choiceId: string,
): string {
  return `${featureRef}\0${choiceId}`;
}

/** The set of {@link choiceInstanceKey}s a detector took responsibility for. */
export type HandledChoiceInstances = ReadonlySet<string>;

export function uncoveredChoiceDescriptors(ctx: {
  readonly toLevel: number;
  readonly targetFeatureRefs: readonly string[];
  readonly emitted: readonly LevelUpRequiredChoice[];
  /** Instances the detectors handled (union of their reports). */
  readonly handled: HandledChoiceInstances;
  readonly resolver: RulesPackCharacterResolver;
}): readonly LevelUpRequiredChoice[] {
  // An unsupported descriptor carrying a featureRef already blocks the
  // level-up, so every instance on that feature counts as covered.
  const blockedRefs = new Set<string>();
  const emittedIds = new Set<string>();
  for (const choice of ctx.emitted) {
    emittedIds.add(choice.id);
    if (choice.featureRef !== undefined && choice.status === 'unsupported') {
      blockedRefs.add(choice.featureRef);
    }
  }
  const out: LevelUpRequiredChoice[] = [];
  const seen = new Set<string>();
  const features = ctx.resolver.listFeatures();
  for (const ref of ctx.targetFeatureRefs) {
    if (seen.has(ref) || blockedRefs.has(ref)) continue;
    seen.add(ref);
    const feature = features.find((entry) => entry.key === ref);
    if (feature === undefined) continue;
    for (const choice of choiceInstancesAtLevel(
      feature.choices ?? [],
      ctx.toLevel,
    )) {
      if (isUseTimeChoice(choice)) continue;
      if (ctx.handled.has(choiceInstanceKey(ref, choice.id))) continue;
      const id = descriptorId(ctx.toLevel, ref, choice.id);
      if (emittedIds.has(id)) continue;
      out.push({
        id,
        kind: 'class-feature-choice',
        status: 'unsupported',
        label: `${feature.name} (${choice.id})`,
        featureRef: ref,
        reason: `level ${ctx.toLevel} grants '${ref}', whose '${choice.category}' choice '${choice.id}' has no level-up handling`,
        unsupportedReason: `The pack models '${choice.id}' (${choice.category}) on '${ref}', but level-up does not collect or apply it; the level-up is blocked rather than skipping the choice.`,
      });
    }
  }
  return out;
}
