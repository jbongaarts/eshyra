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
// Deriver: spell / cantrip selection (eshyra-o9bd.9.3)
// ---------------------------------------------------------------------------

interface SpellcastingRow {
  readonly cantripsKnown?: number;
  readonly spellsKnown?: number;
}

/** The class features that actually grant a spell/cantrip selection — the
 * "Spellcasting" feature, the Warlock's "Pact Magic", and "Mystic Arcanum".
 * Every other feature, even at a caster level, makes no spell-known choice. */
const SPELL_FEATURE_SUFFIXES = [
  ':spellcasting',
  ':pact-magic',
  ':mystic-arcanum',
] as const;

/** The class's spellcastingProgression entry at `level`, if any. */
function spellcastingAt(cls: RulesRecord, level: number): SpellcastingRow | null {
  const progression = dataOf(cls).progression;
  if (!Array.isArray(progression)) return null;
  for (const row of progression) {
    const r = row as { level?: unknown; advancement?: unknown };
    if (r.level !== level || !Array.isArray(r.advancement)) continue;
    for (const entry of r.advancement) {
      const e = entry as Record<string, unknown>;
      if (e.kind === 'spellcastingProgression') return e as SpellcastingRow;
    }
  }
  return null;
}

function spellListRestriction(cls: RulesRecord): string {
  return `the ${cls.name.toLowerCase()} spell list`;
}

/**
 * Attach cantrip / spell selection choices to caster Spellcasting features.
 *
 * The choice modeled is the one made WHEN the feature is gained: `choose` is the
 * initial count from the class's `spellcastingProgression` row at the feature's
 * grant level (cantrips known, spells known, or — for the Wizard spellbook — the
 * starting-spellbook count). Per-level increases are separate level-up events
 * already carried by the later progression rows, so they are not re-modeled
 * here. `from` is the class spell-list restriction; the authoritative option set
 * is each spell's `data.classes` membership, so it is named rather than inlined.
 *
 * Categories mirror the SRD caster type, matching the `choice-coverage` gate's
 * prose detection exactly: a cantrip choice when the class knows cantrips at that
 * level; a spell choice for KNOWN casters (spells known) or the Wizard spellbook;
 * prepared casters without a spellbook (Cleric/Druid/Paladin) get no spell-known
 * choice because they prepare from the full list rather than choosing known
 * spells. The Warlock's Mystic Arcanum is a distinct single-spell pick.
 */
function deriveSpellChoices(
  input: DeriveFeatureChoicesInput,
  granted: ReadonlySet<string>,
): Map<string, DerivedChoice[]> {
  const out = new Map<string, DerivedChoice[]>();
  const classByKey = new Map(input.classRecords.map((c) => [c.key, c]));

  for (const feature of input.featureRecords) {
    if (!granted.has(feature.key)) continue;
    // Only the class's actual spell-acquisition features carry a spell/cantrip
    // selection. Without this guard every granted feature at a caster level
    // (Metamagic, Expertise, an ASI, …) would wrongly inherit the spellcasting
    // row that sits at the same level.
    if (!SPELL_FEATURE_SUFFIXES.some((s) => feature.key.endsWith(s))) continue;
    const source = featureSource(feature);
    if (source === null) continue;
    const cls = classByKey.get(source);
    if (cls === undefined) continue;
    const level = featureLevel(feature);
    const choices: DerivedChoice[] = [];

    // Mystic Arcanum: a single spell of a fixed level from the class list.
    if (feature.key.endsWith(':mystic-arcanum')) {
      choices.push({
        id: 'arcanum',
        category: 'spell',
        prompt: `Choose one 6th-level spell from ${spellListRestriction(cls)} as your arcanum.`,
        level,
        choose: 1,
        from: spellListRestriction(cls),
      });
      out.set(feature.key, choices);
      continue;
    }

    const row = spellcastingAt(cls, level);
    if (row === null) continue;
    const prep = dataOf(cls).spellPreparation as
      | { kind?: unknown; spellbookStartingSpells?: unknown }
      | undefined;
    const prepKind = prep?.kind;
    const spellbookStart =
      typeof prep?.spellbookStartingSpells === 'number'
        ? prep.spellbookStartingSpells
        : null;

    if (typeof row.cantripsKnown === 'number') {
      choices.push({
        id: 'cantrips',
        category: 'cantrip',
        prompt: `Choose your starting cantrips from ${spellListRestriction(cls)}.`,
        level,
        choose: row.cantripsKnown,
        from: spellListRestriction(cls),
      });
    }

    // Known casters choose their spells known; the Wizard chooses the spells in
    // their starting spellbook. Prepared casters without a spellbook do not.
    const spellChoose =
      prepKind === 'known' && typeof row.spellsKnown === 'number'
        ? row.spellsKnown
        : spellbookStart;
    if (spellChoose !== null && spellChoose !== undefined) {
      choices.push({
        id: 'spells',
        category: 'spell',
        prompt: `Choose your starting spells from ${spellListRestriction(cls)}.`,
        level,
        choose: spellChoose,
        from: spellListRestriction(cls),
      });
    }

    if (choices.length > 0) out.set(feature.key, choices);
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
  const choiceMap = mergeChoiceMaps([
    deriveSubclassChoices(input, granted),
    deriveSpellChoices(input, granted),
  ]);

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
