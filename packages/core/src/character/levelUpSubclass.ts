// Pure subclass-resolution helpers shared by level-up (levelUpEngine.ts) and
// level-1 character creation (creationClassChoices.ts, eshyra-nnj6.1). Kept
// free of persistence/engine imports so characterDraft.ts can use them without
// an import cycle through the level-up engine.

import type {
  ResolvedSubclassData,
  RulesPackCharacterResolver,
} from './rulesPackResolver.js';

/**
 * Subclass-selection features by their pack feature-ref suffix (the segment
 * after the last `:`), keyed per the frozen SRD class records. Reaching the
 * level that grants one of these requires the player to choose a subclass —
 * Arcane Tradition, Martial Archetype, Divine Domain, and so on.
 */
export const SUBCLASS_FEATURE_SUFFIXES: ReadonlySet<string> = new Set([
  'primal-path',
  'bard-college',
  'divine-domain',
  'druid-circle',
  'martial-archetype',
  'monastic-tradition',
  'sacred-oath',
  'ranger-archetype',
  'roguish-archetype',
  'sorcerous-origin',
  'otherworldly-patron',
  'arcane-tradition',
]);

/** The subclass of `classKey` named by `selection` (key or name, any case). */
export function resolveSubclassSelection(
  selection: string,
  classKey: string,
  resolver: RulesPackCharacterResolver,
): ResolvedSubclassData | undefined {
  const normalized = selection.trim().toLowerCase();
  return resolver
    .listSubclasses()
    .filter((subclass) => subclass.parentClass === classKey)
    .find(
      (subclass) =>
        subclass.key.toLowerCase() === normalized ||
        subclass.name.toLowerCase() === normalized,
    );
}

/** The subclass's feature refs granted exactly at `targetLevel`. */
export function subclassFeatureRefsForLevel(
  subclass: ResolvedSubclassData,
  targetLevel: number,
  resolver: RulesPackCharacterResolver,
): readonly string[] {
  const subclassFeatureSet = new Set(subclass.features);
  return resolver
    .listFeatures()
    .filter(
      (feature) =>
        feature.source === subclass.key &&
        feature.level === targetLevel &&
        subclassFeatureSet.has(feature.key),
    )
    .map((feature) => feature.key);
}
