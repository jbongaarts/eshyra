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
// Deriver: Ability Score Improvement vs feat (eshyra-o9bd.9.4)
// ---------------------------------------------------------------------------

const ABILITY_SCORES = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
] as const;

/**
 * Attach an `asiOrFeat` choice to each Ability Score Improvement feature.
 *
 * Two entries, matching the SRD 5.1 reality: the ASI itself is structured —
 * distribute 2 points among the six ability scores (both on one score for +2,
 * or one each on two scores for +1/+1, never above 20). The optional feat
 * variant is a named out-of-scope marker because the SRD 5.1 feat list is a
 * single feat (Grappler) and is not modeled as selectable structured options;
 * the marker keeps the choice explicit rather than silently dropping it.
 */
function deriveAsiChoices(
  input: DeriveFeatureChoicesInput,
  granted: ReadonlySet<string>,
): Map<string, DerivedChoice[]> {
  const out = new Map<string, DerivedChoice[]>();
  for (const feature of input.featureRecords) {
    if (!granted.has(feature.key)) continue;
    if (!feature.key.endsWith(':ability-score-improvement')) continue;
    const level = featureLevel(feature);
    out.set(feature.key, [
      {
        id: 'ability-score-improvement',
        category: 'asiOrFeat',
        prompt:
          'Increase one ability score by 2, or two ability scores by 1 (no score above 20): distribute 2 points among your ability scores.',
        level,
        choose: 2,
        from: [...ABILITY_SCORES],
      },
      {
        id: 'feat',
        category: 'asiOrFeat',
        prompt:
          'Optionally forgo the ability score increase to take a feat (optional rule).',
        level,
        unsupported: {
          reason:
            'The optional feat variant is not modeled as structured options; the SRD 5.1 feat list contains only Grappler.',
        },
      },
    ]);
  }
  return out;
}


// ---------------------------------------------------------------------------
// Deriver: option-list choices — Fighting Style / Metamagic / Invocations /
// favored enemy / favored terrain (eshyra-o9bd.9.5)
// ---------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};

function featureDescription(record: RulesRecord): string {
  const description = dataOf(record).description;
  return typeof description === 'string' ? description : '';
}

/** Parse the pick count from "Choose one …" / "you gain two … of your choice"
 * phrasing near `keyword`. Returns null when no count word is found. */
function parseChooseCount(description: string, keyword: RegExp): number | null {
  const source = keyword.source;
  const re = new RegExp(
    `(?:choose|gain)\\s+(one|two|three|four|five)\\b[^.]*?(?:${source})`,
    'i',
  );
  const match = description.match(re);
  if (match === null) return null;
  return NUMBER_WORDS[match[1].toLowerCase()] ?? null;
}

/** Parse the comma/“or”-delimited option list that follows `anchor:` up to the
 * first sentence end — the Favored Enemy / Favored Terrain pattern. */
function parseColonList(description: string, anchor: string): string[] {
  const at = description.toLowerCase().indexOf(anchor.toLowerCase());
  if (at === -1) return [];
  const after = description.slice(at + anchor.length);
  const end = after.indexOf('.');
  const segment = end === -1 ? after : after.slice(0, end);
  return segment
    .split(',')
    .map((s) => s.replace(/^\s*(?:or|and)\s+/i, '').trim())
    .filter((s) => s.length > 0);
}

interface OptionListSpec {
  readonly suffix: string;
  readonly category: FeatureChoiceCategory;
  readonly id: string;
  readonly countKeyword: RegExp;
  /** Either a colon-anchored enumerated list, or a named restriction pool. */
  readonly listAnchor?: string;
  readonly restriction?: string;
  readonly prompt: (choose: number) => string;
}

// The option labels for Fighting Style / Metamagic / Invocations are inline
// title-case headings in flattened prose (or, for Invocations, printed in a
// separate section). They cannot be enumerated without hard-coding option
// VALUES (ADR 0007 allows only structural anchors). So those carry the reliably
// parsed `choose` count plus a named option pool; Favored Enemy / Terrain print
// a clean colon-delimited list, which IS enumerated into `from`.
const OPTION_LIST_SPECS: readonly OptionListSpec[] = [
  {
    suffix: ':fighting-style',
    category: 'fightingStyle',
    id: 'fighting-style',
    countKeyword: /following options|fighting style/,
    restriction: 'a Fighting Style option from this feature',
    prompt: (n) => `Choose ${n === 1 ? 'a' : n} Fighting Style option.`,
  },
  {
    suffix: ':metamagic',
    category: 'metamagic',
    id: 'metamagic',
    countKeyword: /metamagic/,
    restriction: 'a Metamagic option from this feature',
    prompt: (n) => `Choose ${n} Metamagic option${n === 1 ? '' : 's'}.`,
  },
  {
    suffix: ':eldritch-invocations',
    category: 'invocation',
    id: 'eldritch-invocations',
    countKeyword: /eldritch invocations/,
    restriction: 'an Eldritch Invocation you qualify for',
    prompt: (n) =>
      `Choose ${n} Eldritch Invocation${n === 1 ? '' : 's'} you qualify for.`,
  },
  {
    suffix: ':favored-enemy',
    category: 'favoredEnemy',
    id: 'favored-enemy',
    countKeyword: /favored enemy/,
    listAnchor: 'favored enemy:',
    prompt: (n) =>
      `Choose ${n === 1 ? 'a' : n} favored enemy type (or two humanoid races).`,
  },
  {
    suffix: ':natural-explorer',
    category: 'naturalExplorer',
    id: 'favored-terrain',
    countKeyword: /favored terrain/,
    listAnchor: 'favored terrain:',
    prompt: (n) => `Choose ${n === 1 ? 'a' : n} favored terrain type.`,
  },
];

function deriveOptionListChoices(
  input: DeriveFeatureChoicesInput,
  granted: ReadonlySet<string>,
): Map<string, DerivedChoice[]> {
  const out = new Map<string, DerivedChoice[]>();
  for (const feature of input.featureRecords) {
    if (!granted.has(feature.key)) continue;
    const spec = OPTION_LIST_SPECS.find((s) => feature.key.endsWith(s.suffix));
    if (spec === undefined) continue;
    const description = featureDescription(feature);
    const choose = parseChooseCount(description, spec.countKeyword) ?? 1;
    const from =
      spec.listAnchor !== undefined
        ? parseColonList(description, spec.listAnchor)
        : spec.restriction;
    const choice: DerivedChoice = {
      id: spec.id,
      category: spec.category,
      prompt: spec.prompt(choose),
      level: featureLevel(feature),
      choose,
      ...(from !== undefined && (Array.isArray(from) ? from.length > 0 : true)
        ? { from }
        : {}),
    };
    out.set(feature.key, [choice]);
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
    deriveAsiChoices(input, granted),
    deriveOptionListChoices(input, granted),
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
