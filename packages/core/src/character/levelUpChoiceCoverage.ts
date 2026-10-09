// Generalized level-up choice-coverage invariant (eshyra-91o0).
//
// After every detector has run, each pack-modeled choice instance available at
// the target level on a feature the character gains must be covered by some
// emitted descriptor carrying that feature ref (supported OR unsupported).
// Detection used to be per-feature and silently skipped anything it did not
// recognize (subclass-granted Bonus Cantrip, Circle Spells, Lore proficiencies,
// ...). This pass is the single place that turns an uncovered instance into an
// explicit unsupported descriptor, so a new pack choice can never be skipped.

import type { FeatureChoice } from '../rules/featureChoices.js';
import type { LevelUpRequiredChoice } from './levelUpEngine.js';
import { descriptorId } from './levelUpFeatureChoices.js';
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

function isBaseSpellcastingRef(ref: string): boolean {
  return /^feature:[a-z0-9-]+:(?:spellcasting|pact-magic)$/.test(ref);
}

export function uncoveredChoiceDescriptors(ctx: {
  readonly toLevel: number;
  readonly targetFeatureRefs: readonly string[];
  readonly emitted: readonly LevelUpRequiredChoice[];
  readonly resolver: RulesPackCharacterResolver;
}): readonly LevelUpRequiredChoice[] {
  // A descriptor covers a feature by carrying its ref. The one exception is a
  // class's base Spellcasting / Pact Magic feature: levelUpSpells.ts owns its
  // whole choice set (cantrips, known, prepared, spellbook, replacement) under
  // `level.N.spells.*` ids that carry no featureRef, so it counts as covered
  // when that module emitted any descriptor at this level.
  const spellModuleEmitted = ctx.emitted.some((choice) =>
    choice.id.startsWith(`level.${ctx.toLevel}.spells.`),
  );
  const covered = new Set<string>();
  const emittedIds = new Set<string>();
  for (const choice of ctx.emitted) {
    emittedIds.add(choice.id);
    if (choice.featureRef !== undefined) covered.add(choice.featureRef);
  }
  const out: LevelUpRequiredChoice[] = [];
  const seen = new Set<string>();
  const features = ctx.resolver.listFeatures();
  for (const ref of ctx.targetFeatureRefs) {
    if (seen.has(ref) || covered.has(ref)) continue;
    seen.add(ref);
    const feature = features.find((entry) => entry.key === ref);
    if (feature === undefined) continue;
    if (spellModuleEmitted && isBaseSpellcastingRef(ref)) continue;
    for (const choice of choiceInstancesAtLevel(
      feature.choices ?? [],
      ctx.toLevel,
    )) {
      if (isUseTimeChoice(choice)) continue;
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
