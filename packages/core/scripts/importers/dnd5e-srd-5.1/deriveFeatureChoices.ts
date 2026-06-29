/**
 * Derive structured player choices on class/subclass feature records
 * (eshyra-o9bd.9).
 *
 * The frozen pack carried every creation/level-up build choice (subclass,
 * Fighting Style, Metamagic, favored enemy, ASI-vs-feat, …) as PROSE only — the
 * feature `description`. A creation/level-up engine cannot apply that without
 * guessing. This post-emit pass reads the assembled class/subclass/feature
 * records and attaches a `data.choices[]` array (the shape validated by
 * `validateDnd5eFeature` / `featureChoices.ts`) to every feature that confers a
 * choice, so the `choice-coverage` audit gate goes green.
 *
 * Only structural ANCHORS are matched here (ADR 0007): the feature a choice
 * hangs off is identified from the class progression / subclass graph or from
 * SRD-stable phrasing in the feature body; every field VALUE (option lists,
 * counts, level) is read from the records, never invented. A choice that the
 * SRD 5.1 pack cannot yet enumerate is emitted as a named out-of-scope marker
 * (`unsupported.reason`) rather than omitted, so a gap is always explicit.
 *
 * Each modeling slice (eshyra-o9bd.9.2–.9.6) adds one deriver below; they are
 * composed per feature so a single feature can carry several choices.
 */

import type { FeatureChoiceCategory } from '../../../src/rules/featureChoices.js';
import type { RulesRecord } from '../../../src/rules/types.js';

export interface DeriveFeatureChoicesInput {
  readonly classRecords: readonly RulesRecord[];
  readonly subclassRecords: readonly RulesRecord[];
  readonly featureRecords: readonly RulesRecord[];
}

interface DerivedChoice {
  readonly id: string;
  readonly category: FeatureChoiceCategory;
  readonly prompt: string;
  readonly level: number;
  readonly choose?: number;
  readonly from?: readonly string[] | string;
  readonly unsupported?: { readonly reason: string };
}

// ---------------------------------------------------------------------------
// Shared record helpers
// ---------------------------------------------------------------------------

function dataOf(record: RulesRecord): Record<string, unknown> {
  return record.data as Record<string, unknown>;
}

function featureLevel(record: RulesRecord): number {
  const level = dataOf(record).level;
  return typeof level === 'number' ? level : 1;
}

function featureSource(record: RulesRecord): string | null {
  const source = dataOf(record).source;
  return typeof source === 'string' ? source : null;
}

/** Feature keys granted by any class progression row (`featureGrant`). The
 * in-scope universe: a feature a player actually gains at creation/level-up. */
function grantedFeatureKeys(
  classRecords: readonly RulesRecord[],
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const cls of classRecords) {
    const progression = dataOf(cls).progression;
    if (!Array.isArray(progression)) continue;
    for (const row of progression) {
      const advancement = (row as { advancement?: unknown }).advancement;
      if (!Array.isArray(advancement)) continue;
      for (const entry of advancement) {
        const e = entry as { kind?: unknown; ref?: unknown };
        if (e.kind === 'featureGrant' && typeof e.ref === 'string') {
          keys.add(e.ref);
        }
      }
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Deriver: subclass selection (eshyra-o9bd.9.2)
// ---------------------------------------------------------------------------

/** The class's subclass-feature slot label (e.g. "Martial Archetype feature")
 * minus the trailing " feature" — the SRD name of the subclass group the
 * selector feature introduces. Read from the typed progression, so it tracks
 * the source rather than a hard-coded list. */
function subclassSlotBase(cls: RulesRecord): string | null {
  const progression = dataOf(cls).progression;
  if (!Array.isArray(progression)) return null;
  for (const row of progression) {
    const advancement = (row as { advancement?: unknown }).advancement;
    if (!Array.isArray(advancement)) continue;
    for (const entry of advancement) {
      const e = entry as { kind?: unknown; slotName?: unknown };
      if (e.kind === 'subclassFeatureSlot' && typeof e.slotName === 'string') {
        return e.slotName.replace(/ feature$/, '');
      }
    }
  }
  return null;
}

/**
 * Attach a `subclass` choice to the base-class feature that introduces the
 * subclass group. The selector feature is found structurally: among the class's
 * granted base-class features, the one whose name equals the subclass-slot base
 * (e.g. "Martial Archetype") or has it as a trailing word (Barbarian's
 * "Primal Path" for slot base "Path"). The `from` list is the parent class's
 * subclass record keys — read from the graph, not invented.
 */
function deriveSubclassChoices(
  input: DeriveFeatureChoicesInput,
  granted: ReadonlySet<string>,
): Map<string, DerivedChoice[]> {
  const out = new Map<string, DerivedChoice[]>();

  const subclassesByParent = new Map<string, string[]>();
  for (const sub of input.subclassRecords) {
    const parent = dataOf(sub).parentClass;
    if (typeof parent !== 'string') continue;
    const bucket = subclassesByParent.get(parent) ?? [];
    bucket.push(sub.key);
    subclassesByParent.set(parent, bucket);
  }

  const featuresByKey = new Map(input.featureRecords.map((f) => [f.key, f]));

  for (const cls of input.classRecords) {
    const subclassKeys = subclassesByParent.get(cls.key);
    if (subclassKeys === undefined || subclassKeys.length === 0) continue;
    const base = subclassSlotBase(cls);
    if (base === null) continue;
    // Selector = granted base-class feature whose name is the slot base or ends
    // with it as a word.
    const selector = input.featureRecords.find(
      (f) =>
        granted.has(f.key) &&
        featureSource(f) === cls.key &&
        (f.name === base || f.name.endsWith(` ${base}`)),
    );
    if (selector === undefined || !featuresByKey.has(selector.key)) continue;
    const from = [...subclassKeys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const bucket = out.get(selector.key) ?? [];
    bucket.push({
      id: 'subclass',
      category: 'subclass',
      prompt: `Choose your ${selector.name}.`,
      level: featureLevel(selector),
      choose: 1,
      from,
    });
    out.set(selector.key, bucket);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Compose + apply
// ---------------------------------------------------------------------------

/** Merge per-feature choice lists from every deriver into one map. */
function mergeChoiceMaps(
  maps: readonly Map<string, DerivedChoice[]>[],
): Map<string, DerivedChoice[]> {
  const merged = new Map<string, DerivedChoice[]>();
  for (const map of maps) {
    for (const [key, choices] of map) {
      const bucket = merged.get(key) ?? [];
      bucket.push(...choices);
      merged.set(key, bucket);
    }
  }
  return merged;
}

/**
 * Return a new feature-record array with `data.choices` populated wherever a
 * deriver matched. Insertion order places `choices` after `tableRefs` to match
 * the `validateDnd5eFeature` field order; features with no derived choice pass
 * through unchanged (no empty `choices` array, keeping the pack byte-stable for
 * unmodeled features).
 */
export function deriveFeatureChoices(
  input: DeriveFeatureChoicesInput,
): RulesRecord[] {
  const granted = grantedFeatureKeys(input.classRecords);
  const choiceMap = mergeChoiceMaps([deriveSubclassChoices(input, granted)]);

  return input.featureRecords.map((feature) => {
    const choices = choiceMap.get(feature.key);
    if (choices === undefined || choices.length === 0) return feature;
    const data = dataOf(feature);
    const { tableRefs, ...rest } = data;
    const nextData: Record<string, unknown> =
      tableRefs === undefined
        ? { ...data, choices }
        : { ...rest, tableRefs, choices };
    return { ...feature, data: nextData };
  });
}
