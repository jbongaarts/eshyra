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

/**
 * Thrown when a choice the deriver must model cannot be read from the source —
 * e.g. a feature whose pick count is no longer parseable because the SRD
 * phrasing changed or the upstream extraction regressed. The deriver fails
 * closed (throws) rather than emitting a machine-readable choice with an
 * invented count, which would let the `choice-coverage` gate go green on wrong
 * data.
 */
export class FeatureChoiceDerivationError extends Error {
  override readonly name = 'FeatureChoiceDerivationError';
}

export interface DeriveFeatureChoicesInput {
  readonly classRecords: readonly RulesRecord[];
  readonly subclassRecords: readonly RulesRecord[];
  readonly featureRecords: readonly RulesRecord[];
  readonly optionSourceLabelsByFeatureKey?: ReadonlyMap<
    string,
    ReadonlyMap<string, string>
  >;
}

/** A machine-readable prepared-spell count (eshyra-vk23.2): the prepared total
 * is `max(minimum, abilityModifier + floor(classLevel / classLevelDivisor))`. */
interface PreparationFormula {
  readonly ability: string;
  readonly classLevelDivisor: number;
  readonly minimum: number;
}

interface DerivedChoice {
  readonly id: string;
  readonly category: FeatureChoiceCategory;
  readonly prompt: string;
  readonly level: number;
  readonly choose?: number;
  /** Prepared-caster daily count, in place of a fixed `choose` (eshyra-vk23.2). */
  readonly chooseFormula?: PreparationFormula;
  readonly from?: readonly string[] | Record<string, unknown> | string;
  readonly options?: readonly DerivedChoiceOption[];
  /** When the choice is made/repeated: omitted = at creation/when gained;
   * 'level-up' = each class level; 'daily-preparation' = each long rest. */
  readonly trigger?: 'level-up' | 'daily-preparation';
  /** True when the choice swaps a prior pick (known-caster level-up). */
  readonly replaces?: boolean;
  readonly unsupported?: { readonly reason: string };
}

/**
 * A structured, deterministic prerequisite clause on an option (eshyra-vk23.9),
 * so a tool gates the option from data instead of parsing the `prerequisite`
 * prose. Eldritch Invocation prerequisites are exactly three closed forms:
 *  - `level`   — a minimum class level, scoped to the granting class.
 *  - `pactBoon`— a required Pact Boon option, by its `pact-boon:` ref.
 *  - `cantrip` — a required cantrip, by its `spell:` ref.
 */
type PrerequisiteClause =
  | {
      readonly kind: 'level';
      readonly classRef: string;
      readonly level: number;
    }
  | { readonly kind: 'pactBoon'; readonly ref: string }
  | { readonly kind: 'cantrip'; readonly ref: string };

interface DerivedChoiceOption {
  readonly id: string;
  readonly name: string;
  readonly text: string;
  /** Verbatim prerequisite prose, preserved for DM context. */
  readonly prerequisite?: string;
  /** Structured, machine-readable parse of `prerequisite` (eshyra-vk23.9). */
  readonly prerequisites?: readonly PrerequisiteClause[];
  readonly source: string;
}

function optionSourceFor(
  input: DeriveFeatureChoicesInput,
  feature: RulesRecord,
  heading: string,
): string {
  return (
    input.optionSourceLabelsByFeatureKey?.get(feature.key)?.get(heading) ??
    feature.source
  );
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

function isBuildFeature(
  feature: RulesRecord,
  granted: ReadonlySet<string>,
): boolean {
  return (
    granted.has(feature.key) ||
    featureSource(feature)?.startsWith('subclass:') === true
  );
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
function spellcastingAt(
  cls: RulesRecord,
  level: number,
): SpellcastingRow | null {
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
 * A structured, deterministic spell-selection filter (eshyra-vk23.2). Replaces
 * free-text `from` strings ("the wizard spell list") so a tool resolves the
 * option set from data, never English. Recognized keys:
 *  - `classLists`: class keys whose spell lists are eligible, or 'any'.
 *  - `spellLevels`: exact eligible spell levels (0 = cantrip).
 *  - `minSpellLevel` / `maxSpellLevel`: level bounds; `maxSpellLevel` may be a
 *    number or `{ classRef, atLevel }` (the caster's max castable level there).
 *  - `castableLevelsOnly`: eligible levels are those the caster can cast at the
 *    current character level — for recurring (level-up / daily) choices whose
 *    ceiling scales rather than being fixed at the grant level.
 *  - `mustBeInSpellbook`, `includeCantrips`, `ritualOnly`, `countsAsClassSpell`,
 *    `countsAgainstKnown`, `requiresFeatureOption`, `alwaysPrepared`,
 *    `mustBePreparedToCast`.
 */
function spellFilter(value: Record<string, unknown>): Record<string, unknown> {
  return { kind: 'spellFilter', ...value };
}

/**
 * A structured filter over the character's OWN sheet state (eshyra-vk23.4),
 * for choices whose option pool is "your existing proficiencies" rather than a
 * static catalog — e.g. Expertise. Replaces the free-text `from: 'your skill
 * proficiencies'` so a tool reads the eligible pool from data. Keys:
 *  - `proficiencyTypes`: which categories of the character's current
 *    proficiencies are eligible ('skill', 'tool', …).
 *  - `tools`: specific tool proficiencies additionally eligible, by slug
 *    (Rogue Expertise also covers thieves' tools).
 */
function characterStateFilter(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return { kind: 'characterStateFilter', ...value };
}

/** A spell filter scoped to one class's spell list. */
function classSpellFilter(
  cls: RulesRecord,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return spellFilter({ classLists: [cls.key], ...extra });
}

/** Spells of a level the caster can currently cast, excluding cantrips — the
 * eligible set for recurring known/prepared choices (replacement, daily prep,
 * spellbook growth). */
function castableSpellFilter(cls: RulesRecord): Record<string, unknown> {
  return classSpellFilter(cls, { minSpellLevel: 1, castableLevelsOnly: true });
}

/** Warlock Mystic Arcanum tiers: one fixed-level spell unlocked at each level
 * (eshyra-vk23.2). SRD: 6th-level at 11th, 7th at 13th, 8th at 15th, 9th at
 * 17th. The Mystic Arcanum feature is granted once (11th); the higher tiers are
 * level-gated picks the same feature confers. */
const MYSTIC_ARCANUM_TIERS: ReadonlyArray<{
  readonly level: number;
  readonly spellLevel: number;
}> = [
  { level: 11, spellLevel: 6 },
  { level: 13, spellLevel: 7 },
  { level: 15, spellLevel: 8 },
  { level: 17, spellLevel: 9 },
];

const ORDINALS: Readonly<Record<number, string>> = {
  1: '1st',
  2: '2nd',
  3: '3rd',
  6: '6th',
  7: '7th',
  8: '8th',
  9: '9th',
};

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
    // The Wizard Spellbook is a real build choice (six 1st-level spells at
    // creation, +2 per level) but the SRD progression grants only the parent
    // Spellcasting feature, so the Spellbook record is not in `granted`. Handle
    // it explicitly, ahead of the build-feature guard (eshyra-vk23.2).
    if (feature.key === 'feature:wizard:spellbook') {
      const wizard = classByKey.get('class:wizard');
      const startCount =
        wizard === undefined
          ? null
          : ((
              dataOf(wizard).spellPreparation as {
                spellbookStartingSpells?: unknown;
              }
            )?.spellbookStartingSpells ?? null);
      if (wizard !== undefined && typeof startCount === 'number') {
        const spellbookLevel = featureLevel(feature);
        out.set(feature.key, [
          {
            id: 'spellbook-initial',
            category: 'spell',
            prompt: `Choose the ${startCount} 1st-level wizard spells in your starting spellbook.`,
            level: spellbookLevel,
            choose: startCount,
            from: classSpellFilter(wizard, { spellLevels: [1] }),
          },
          {
            id: 'spellbook-growth',
            category: 'spell',
            prompt:
              'Each time you gain a wizard level, add two wizard spells of your choice to your spellbook.',
            level: spellbookLevel,
            choose: 2,
            trigger: 'level-up',
            from: castableSpellFilter(wizard),
          },
        ]);
      }
      continue;
    }
    if (!isBuildFeature(feature, granted)) continue;
    const level = featureLevel(feature);

    if (feature.key === 'feature:bard:magical-secrets') {
      out.set(feature.key, [
        {
          id: 'magical-secrets',
          category: 'spell',
          prompt:
            'Choose two spells from any class; each must be a cantrip or of a level you can cast.',
          level,
          choose: 2,
          from: spellFilter({
            classLists: 'any',
            includeCantrips: true,
            maxSpellLevel: { classRef: 'class:bard', atLevel: level },
            countsAsClassSpell: 'class:bard',
            countsAgainstKnown: true,
          }),
        },
      ]);
      continue;
    }

    if (feature.key === 'feature:college-of-lore:additional-magical-secrets') {
      out.set(feature.key, [
        {
          id: 'additional-magical-secrets',
          category: 'spell',
          prompt:
            'Choose two spells from any class; each must be a cantrip or of a level you can cast.',
          level,
          choose: 2,
          from: spellFilter({
            classLists: 'any',
            includeCantrips: true,
            maxSpellLevel: { classRef: 'class:bard', atLevel: level },
            countsAsClassSpell: 'class:bard',
            countsAgainstKnown: false,
          }),
        },
      ]);
      continue;
    }

    if (feature.key === 'feature:warlock:pact-boon') {
      out.set(feature.key, [
        {
          id: 'pact-of-the-tome-cantrips',
          category: 'cantrip',
          prompt:
            "If you choose Pact of the Tome, choose three cantrips from any class's spell list.",
          level,
          choose: 3,
          from: spellFilter({
            classLists: 'any',
            spellLevels: [0],
            includeCantrips: true,
            countsAsClassSpell: 'class:warlock',
            countsAgainstKnown: false,
            requiresFeatureOption: 'pact-boon:pact-of-the-tome',
          }),
        },
      ]);
      continue;
    }

    if (feature.key === 'feature:warlock:eldritch-invocations') {
      out.set(feature.key, [
        {
          id: 'book-of-ancient-secrets-rituals',
          category: 'spell',
          prompt:
            'If you choose Book of Ancient Secrets, choose two 1st-level ritual spells from any class.',
          level,
          choose: 2,
          from: spellFilter({
            classLists: 'any',
            spellLevels: [1],
            ritualOnly: true,
            countsAgainstKnown: false,
            requiresFeatureOption:
              'eldritch-invocation:book-of-ancient-secrets',
          }),
        },
      ]);
      continue;
    }

    if (feature.key === 'feature:wizard:spell-mastery') {
      out.set(feature.key, [
        {
          id: 'spell-mastery-1st-level',
          category: 'spell',
          prompt: 'Choose a 1st-level wizard spell in your spellbook.',
          level,
          choose: 1,
          from: spellFilter({
            classLists: ['class:wizard'],
            spellLevels: [1],
            mustBeInSpellbook: true,
            mustBePreparedToCast: true,
          }),
        },
        {
          id: 'spell-mastery-2nd-level',
          category: 'spell',
          prompt: 'Choose a 2nd-level wizard spell in your spellbook.',
          level,
          choose: 1,
          from: spellFilter({
            classLists: ['class:wizard'],
            spellLevels: [2],
            mustBeInSpellbook: true,
            mustBePreparedToCast: true,
          }),
        },
      ]);
      continue;
    }

    if (feature.key === 'feature:wizard:signature-spells') {
      out.set(feature.key, [
        {
          id: 'signature-spells',
          category: 'spell',
          prompt: 'Choose two 3rd-level wizard spells in your spellbook.',
          level,
          choose: 2,
          from: spellFilter({
            classLists: ['class:wizard'],
            spellLevels: [3],
            mustBeInSpellbook: true,
            alwaysPrepared: true,
          }),
        },
      ]);
      continue;
    }

    // Only the class's actual spell-acquisition features carry a spell/cantrip
    // selection. Without this guard every granted feature at a caster level
    // (Metamagic, Expertise, an ASI, …) would wrongly inherit the spellcasting
    // row that sits at the same level.
    if (!SPELL_FEATURE_SUFFIXES.some((s) => feature.key.endsWith(s))) continue;
    const source = featureSource(feature);
    if (source === null) continue;
    const cls = classByKey.get(source);
    if (cls === undefined) continue;
    const choices: DerivedChoice[] = [];

    // Mystic Arcanum: one fixed-level spell from the warlock list at each of the
    // 11th/13th/15th/17th-level tiers (eshyra-vk23.2).
    if (feature.key.endsWith(':mystic-arcanum')) {
      for (const tier of MYSTIC_ARCANUM_TIERS) {
        const ord = ORDINALS[tier.spellLevel];
        choices.push({
          id: `arcanum-${tier.spellLevel}`,
          category: 'spell',
          prompt: `Choose one ${ord}-level spell from ${spellListRestriction(cls)} as your ${ord}-level arcanum.`,
          level: tier.level,
          choose: 1,
          from: classSpellFilter(cls, { spellLevels: [tier.spellLevel] }),
        });
      }
      out.set(feature.key, choices);
      continue;
    }

    const row = spellcastingAt(cls, level);
    if (row === null) continue;
    const prep = dataOf(cls).spellPreparation as
      | {
          kind?: unknown;
          preparationFormula?: PreparationFormula;
        }
      | undefined;
    const prepKind = prep?.kind;

    if (typeof row.cantripsKnown === 'number') {
      choices.push({
        id: 'cantrips',
        category: 'cantrip',
        prompt: `Choose your starting cantrips from ${spellListRestriction(cls)}.`,
        level,
        choose: row.cantripsKnown,
        from: classSpellFilter(cls, { spellLevels: [0] }),
      });
    }

    if (prepKind === 'prepared' && prep?.preparationFormula !== undefined) {
      // Prepared casters re-prepare each day; the count is a formula, not a
      // fixed number. The Wizard prepares from the spellbook; Cleric/Druid/
      // Paladin prepare from the full class spell list (eshyra-vk23.2).
      const isWizard = cls.key === 'class:wizard';
      choices.push({
        id: 'prepared-spells',
        category: 'spell',
        prompt: isWizard
          ? 'Prepare wizard spells from your spellbook each day (Intelligence modifier + wizard level).'
          : `Prepare spells from ${spellListRestriction(cls)} each day.`,
        level,
        chooseFormula: { ...prep.preparationFormula },
        trigger: 'daily-preparation',
        from: isWizard
          ? classSpellFilter(cls, {
              minSpellLevel: 1,
              castableLevelsOnly: true,
              mustBeInSpellbook: true,
            })
          : castableSpellFilter(cls),
      });
    } else if (prepKind === 'known' && typeof row.spellsKnown === 'number') {
      // Known casters choose a fixed number of spells known and may swap one for
      // another from the class list whenever they gain a level (eshyra-vk23.2).
      choices.push({
        id: 'spells',
        category: 'spell',
        prompt: `Choose your starting spells from ${spellListRestriction(cls)}.`,
        level,
        choose: row.spellsKnown,
        from: classSpellFilter(cls, {
          minSpellLevel: 1,
          maxSpellLevel: { classRef: cls.key, atLevel: level },
        }),
      });
      choices.push({
        id: 'spell-replacement',
        category: 'spell',
        prompt: `When you gain a level in this class, you can replace one ${cls.name.toLowerCase()} spell you know with another from ${spellListRestriction(cls)}.`,
        level,
        choose: 1,
        replaces: true,
        trigger: 'level-up',
        from: castableSpellFilter(cls),
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
    if (!isBuildFeature(feature, granted)) continue;
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

// SRD pick-count words. The indefinite article "a"/"an" counts as one ("Choose
// a type of favored enemy"), so the deriver reads the real source count rather
// than relying on a default.
const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  second: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};

const COUNT_WORD_ALTERNATION = Object.keys(NUMBER_WORDS).join('|');

function featureDescription(record: RulesRecord): string {
  const description = dataOf(record).description;
  return typeof description === 'string' ? description : '';
}

function optionSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function optionId(prefix: string, name: string): string {
  return `${prefix}:${optionSlug(name)}`;
}

/** Parse the pick count from "Choose one …" / "Choose a …" / "you gain two …"
 * phrasing near `keyword`. Returns null when no count word is found. */
function parseChooseCount(description: string, keyword: RegExp): number | null {
  const source = keyword.source;
  const re = new RegExp(
    `(?:choose|gain)\\s+(${COUNT_WORD_ALTERNATION})\\b[^.]*?(?:${source})`,
    'i',
  );
  const match = description.match(re);
  if (match === null) return null;
  return NUMBER_WORDS[match[1].toLowerCase()] ?? null;
}

/**
 * Parse the pick count or fail closed. Used for every feature whose choice
 * REQUIRES a count: a missing count means the source phrasing changed or the
 * extraction regressed, so the deriver throws with the feature key/name rather
 * than inventing a default that would let the gate pass on wrong data.
 */
function requireChooseCount(
  feature: RulesRecord,
  description: string,
  keyword: RegExp,
  label: string,
): number {
  const count = parseChooseCount(description, keyword);
  if (count === null) {
    throw new FeatureChoiceDerivationError(
      `Cannot parse a ${label} count for ${feature.key} (${feature.name}); ` +
        `no count word matched /${keyword.source}/ in the feature description. ` +
        'The SRD phrasing may have changed or the extraction regressed.',
    );
  }
  return count;
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

interface OptionCatalogSpec {
  readonly suffix: string;
  readonly category: FeatureChoiceCategory;
  readonly id: string;
  readonly countKeyword: RegExp;
  readonly optionIdPrefix: string;
  readonly headings: readonly string[];
  readonly headingStyle: 'bare' | 'period';
  readonly requireAllHeadings?: boolean;
  readonly prompt: (choose: number) => string;
}

interface ColonListSpec {
  readonly suffix: string;
  readonly category: FeatureChoiceCategory;
  readonly id: string;
  readonly countKeyword: RegExp;
  readonly listAnchor: string;
  readonly prompt: (choose: number) => string;
}

const OPTION_CATALOG_SPECS: readonly OptionCatalogSpec[] = [
  {
    suffix: ':fighting-style',
    category: 'fightingStyle',
    id: 'fighting-style',
    countKeyword: /following options|fighting style/,
    optionIdPrefix: 'fighting-style',
    headingStyle: 'bare',
    requireAllHeadings: false,
    headings: [
      'Archery',
      'Defense',
      'Dueling',
      'Great Weapon Fighting',
      'Protection',
      'Two-Weapon Fighting',
    ],
    prompt: (n) => `Choose ${n === 1 ? 'a' : n} Fighting Style option.`,
  },
  {
    suffix: ':metamagic',
    category: 'metamagic',
    id: 'metamagic',
    countKeyword: /metamagic/,
    optionIdPrefix: 'metamagic',
    headingStyle: 'bare',
    headings: [
      'Careful Spell',
      'Distant Spell',
      'Empowered Spell',
      'Extended Spell',
      'Heightened Spell',
      'Quickened Spell',
      'Subtle Spell',
      'Twinned Spell',
    ],
    prompt: (n) => `Choose ${n} Metamagic option${n === 1 ? '' : 's'}.`,
  },
  {
    suffix: ':eldritch-invocations',
    category: 'invocation',
    id: 'eldritch-invocations',
    countKeyword: /eldritch invocations/,
    optionIdPrefix: 'eldritch-invocation',
    headingStyle: 'bare',
    headings: [
      'Agonizing Blast',
      'Armor of Shadows',
      'Ascendant Step',
      'Beast Speech',
      'Beguiling Influence',
      'Bewitching Whispers',
      'Book of Ancient Secrets',
      'Chains of Carceri',
      'Devil’s Sight',
      'Dreadful Word',
      'Eldritch Sight',
      'Eldritch Spear',
      'Eyes of the Rune Keeper',
      'Fiendish Vigor',
      'Gaze of Two Minds',
      'Lifedrinker',
      'Mask of Many Faces',
      'Master of Myriad Forms',
      'Minions of Chaos',
      'Mire the Mind',
      'Misty Visions',
      'One with Shadows',
      'Otherworldly Leap',
      'Repelling Blast',
      'Sculptor of Flesh',
      'Sign of Ill Omen',
      'Thief of Five Fates',
      'Thirsting Blade',
      'Visions of Distant Realms',
      'Voice of the Chain Master',
      'Whispers of the Grave',
      'Witch Sight',
    ],
    prompt: (n) =>
      `Choose ${n} Eldritch Invocation${n === 1 ? '' : 's'} you qualify for.`,
  },
  {
    suffix: ':pact-boon',
    category: 'other',
    id: 'pact-boon',
    countKeyword: /following features/,
    optionIdPrefix: 'pact-boon',
    headingStyle: 'bare',
    headings: ['Pact of the Chain', 'Pact of the Blade', 'Pact of the Tome'],
    prompt: (n) => `Choose ${n === 1 ? 'a' : n} Pact Boon option.`,
  },
  {
    suffix: ':hunters-prey',
    category: 'other',
    id: 'hunters-prey',
    countKeyword: /following features/,
    optionIdPrefix: 'hunters-prey',
    headingStyle: 'period',
    headings: ['Colossus Slayer', 'Giant Killer', 'Horde Breaker'],
    prompt: (n) => `Choose ${n === 1 ? 'a' : n} Hunter's Prey option.`,
  },
  {
    suffix: ':defensive-tactics',
    category: 'other',
    id: 'defensive-tactics',
    countKeyword: /following features/,
    optionIdPrefix: 'defensive-tactics',
    headingStyle: 'period',
    headings: ['Escape the Horde', 'Multiattack Defense', 'Steel Will'],
    prompt: (n) => `Choose ${n === 1 ? 'a' : n} Defensive Tactics option.`,
  },
  {
    suffix: ':multiattack',
    category: 'other',
    id: 'multiattack',
    countKeyword: /following features/,
    optionIdPrefix: 'hunter-multiattack',
    headingStyle: 'period',
    headings: ['Volley', 'Whirlwind Attack'],
    prompt: (n) => `Choose ${n === 1 ? 'a' : n} Hunter Multiattack option.`,
  },
  {
    suffix: ':superior-hunters-defense',
    category: 'other',
    id: 'superior-hunters-defense',
    countKeyword: /following features/,
    optionIdPrefix: 'superior-hunters-defense',
    headingStyle: 'period',
    headings: ['Evasion', 'Stand Against the Tide', 'Uncanny Dodge'],
    prompt: (n) =>
      `Choose ${n === 1 ? 'a' : n} Superior Hunter's Defense option.`,
  },
];

const COLON_LIST_SPECS: readonly ColonListSpec[] = [
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

function headingPattern(heading: string, style: 'bare' | 'period'): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (style === 'period') return `${escaped}\\.`;
  return escaped;
}

// Eldritch Invocation prerequisites are a comma-separated list of typed
// clauses (eshyra-vk23.3). Parse them with an explicit grammar instead of
// guessing the body boundary from a capitalized-word lookahead: the old
// `/^Prerequisite:\s*(.+?)(?=\s(?:When|You|Choose|The|With|On)\b)/i` truncated
// "Pact of the Tome feature" at "Pact of" — the case-insensitive `The`
// alternative matched the lowercase "the" inside the clause — and leaked
// "the Tome feature ..." into the option body. The SRD invocation grammar is
// closed: a class level ("9th level"), a cantrip prerequisite ("eldritch blast
// cantrip"), or a pact-boon prerequisite ("Pact of the Tome|Blade|Chain
// feature"), optionally combined with commas.
const PREREQUISITE_CLAUSE =
  /\d+(?:st|nd|rd|th) level|Pact of the (?:Blade|Chain|Tome) feature\b|[A-Za-z][A-Za-z' ]*? cantrip\b/;
const PREREQUISITE_LINE = new RegExp(
  String.raw`^Prerequisite:\s*((?:${PREREQUISITE_CLAUSE.source})(?:,\s*(?:${PREREQUISITE_CLAUSE.source}))*)`,
);

const PACT_BOON_PREREQ_REF: Readonly<Record<string, string>> = {
  Blade: 'pact-boon:pact-of-the-blade',
  Chain: 'pact-boon:pact-of-the-chain',
  Tome: 'pact-boon:pact-of-the-tome',
};

/**
 * Parse the (already source-validated) prerequisite prose into structured
 * clauses (eshyra-vk23.9). The prose is the comma-separated grammar matched by
 * `PREREQUISITE_LINE`; each clause maps to a typed level / pact-boon / cantrip
 * requirement. `classRef` scopes a level requirement to the granting class (the
 * SRD: "a level prerequisite refers to your level in this class"). Throws on an
 * unrecognized clause so a parser regression fails closed rather than dropping a
 * gate.
 */
function parsePrerequisiteClauses(
  prose: string,
  classRef: string,
  feature: RulesRecord,
  heading: string,
): readonly PrerequisiteClause[] {
  const clauses: PrerequisiteClause[] = [];
  for (const raw of prose.split(',')) {
    const clause = raw.trim();
    if (clause.length === 0) continue;
    const level = /^(\d+)(?:st|nd|rd|th) level$/.exec(clause);
    if (level !== null) {
      clauses.push({ kind: 'level', classRef, level: Number(level[1]) });
      continue;
    }
    const pact = /^Pact of the (Blade|Chain|Tome) feature$/.exec(clause);
    if (pact !== null) {
      clauses.push({ kind: 'pactBoon', ref: PACT_BOON_PREREQ_REF[pact[1]] });
      continue;
    }
    const cantrip = /^(.+?) cantrip$/.exec(clause);
    if (cantrip !== null) {
      clauses.push({ kind: 'cantrip', ref: `spell:${optionSlug(cantrip[1])}` });
      continue;
    }
    throw new FeatureChoiceDerivationError(
      `Unrecognized prerequisite clause "${clause}" for ${feature.key} option ${heading}.`,
    );
  }
  return clauses;
}

function parseOptionCatalog(
  input: DeriveFeatureChoicesInput,
  feature: RulesRecord,
  description: string,
  spec: OptionCatalogSpec,
): readonly DerivedChoiceOption[] {
  type LocatedHeading = {
    readonly heading: string;
    readonly start: number;
    readonly bodyStart: number;
  };
  const located = spec.headings
    .map((heading) => {
      const re = new RegExp(
        `\\b${headingPattern(heading, spec.headingStyle)}\\s+`,
      );
      const match = description.match(re);
      return match === null
        ? null
        : {
            heading,
            start: match.index ?? -1,
            bodyStart: (match.index ?? 0) + match[0].length,
          };
    })
    .filter((entry): entry is LocatedHeading => entry !== null);
  if (located.length !== spec.headings.length) {
    const found = new Set(located.map((entry) => entry.heading));
    const missing = spec.headings.filter((heading) => !found.has(heading));
    if (spec.requireAllHeadings !== false) {
      throw new FeatureChoiceDerivationError(
        `Cannot parse option headings for ${feature.key} (${feature.name}); ` +
          `missing: ${missing.join(', ')}.`,
      );
    }
    if (located.length === 0) {
      throw new FeatureChoiceDerivationError(
        `Cannot parse any option headings for ${feature.key} (${feature.name}); ` +
          `missing: ${missing.join(', ')}.`,
      );
    }
  }

  const sorted = [...located].sort((a, b) => a.start - b.start);
  return sorted.map((entry, index) => {
    const next = sorted[index + 1]?.start ?? description.length;
    const rawBody = description.slice(entry.bodyStart, next).trim();
    const prerequisite = rawBody.startsWith('Prerequisite:')
      ? rawBody.match(PREREQUISITE_LINE)
      : null;
    if (rawBody.startsWith('Prerequisite:') && prerequisite === null) {
      throw new FeatureChoiceDerivationError(
        `Cannot parse option prerequisite for ${feature.key} (${feature.name}) option ${entry.heading}.`,
      );
    }
    const text =
      prerequisite === null
        ? rawBody
        : rawBody.slice(prerequisite[0].length).trim();
    if (text.length === 0) {
      throw new FeatureChoiceDerivationError(
        `Cannot parse option text for ${feature.key} (${feature.name}) option ${entry.heading}.`,
      );
    }
    if (prerequisite === null) {
      return {
        id: optionId(spec.optionIdPrefix, entry.heading),
        name: entry.heading,
        text,
        source: optionSourceFor(input, feature, entry.heading),
      };
    }
    const prereqProse = prerequisite[1].trim();
    const classRef = featureSource(feature);
    if (classRef === null) {
      throw new FeatureChoiceDerivationError(
        `Cannot scope level prerequisite for ${feature.key} option ${entry.heading} (feature has no source class).`,
      );
    }
    return {
      id: optionId(spec.optionIdPrefix, entry.heading),
      name: entry.heading,
      prerequisite: prereqProse,
      prerequisites: parsePrerequisiteClauses(
        prereqProse,
        classRef,
        feature,
        entry.heading,
      ),
      text,
      source: optionSourceFor(input, feature, entry.heading),
    };
  });
}

function deriveOptionListChoices(
  input: DeriveFeatureChoicesInput,
  granted: ReadonlySet<string>,
): Map<string, DerivedChoice[]> {
  const out = new Map<string, DerivedChoice[]>();
  const featureByKey = new Map(input.featureRecords.map((f) => [f.key, f]));
  for (const feature of input.featureRecords) {
    if (!isBuildFeature(feature, granted)) continue;
    if (feature.key === 'feature:champion:additional-fighting-style') {
      const fighterStyle = featureByKey.get('feature:fighter:fighting-style');
      const fightingStyleSpec = OPTION_CATALOG_SPECS.find(
        (spec) => spec.suffix === ':fighting-style',
      );
      if (fighterStyle === undefined || fightingStyleSpec === undefined) {
        throw new FeatureChoiceDerivationError(
          'Cannot derive Champion Additional Fighting Style without the Fighter Fighting Style catalog.',
        );
      }
      const description = featureDescription(feature);
      const choose = requireChooseCount(
        feature,
        description,
        /fighting style/,
        'fightingStyle',
      );
      const options = parseOptionCatalog(
        input,
        fighterStyle,
        featureDescription(fighterStyle),
        fightingStyleSpec,
      );
      out.set(feature.key, [
        {
          id: 'additional-fighting-style',
          category: 'fightingStyle',
          prompt:
            'Choose a second option from the Fighter Fighting Style class feature.',
          level: featureLevel(feature),
          choose,
          from: options.map((option) => option.id),
          options,
        },
      ]);
      continue;
    }

    const catalogSpec = OPTION_CATALOG_SPECS.find((s) =>
      feature.key.endsWith(s.suffix),
    );
    const description = featureDescription(feature);
    if (catalogSpec !== undefined) {
      const choose = requireChooseCount(
        feature,
        description,
        catalogSpec.countKeyword,
        catalogSpec.category,
      );
      const options = parseOptionCatalog(
        input,
        feature,
        description,
        catalogSpec,
      );
      out.set(feature.key, [
        {
          id: catalogSpec.id,
          category: catalogSpec.category,
          prompt: catalogSpec.prompt(choose),
          level: featureLevel(feature),
          choose,
          from: options.map((option) => option.id),
          options,
        },
      ]);
      continue;
    }

    const spec = COLON_LIST_SPECS.find((s) => feature.key.endsWith(s.suffix));
    if (spec === undefined) continue;
    const choose = requireChooseCount(
      feature,
      description,
      spec.countKeyword,
      spec.category,
    );
    // An enumerated list spec must actually yield options; an empty parse means
    // the colon-list phrasing changed, so fail closed rather than emit a choice
    // with no options.
    const from = parseColonList(description, spec.listAnchor);
    if (from.length === 0) {
      throw new FeatureChoiceDerivationError(
        `Cannot parse the '${spec.listAnchor}' option list for ${feature.key} ` +
          `(${feature.name}); the enumerated list is empty. The SRD phrasing ` +
          'may have changed or the extraction regressed.',
      );
    }
    const choice: DerivedChoice = {
      id: spec.id,
      category: spec.category,
      prompt: spec.prompt(choose),
      level: featureLevel(feature),
      choose,
      from,
    };
    out.set(feature.key, [choice]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deriver: subclass-feature options — Expertise / Channel Divinity
// (eshyra-o9bd.9.6)
// ---------------------------------------------------------------------------

/**
 * Attach the remaining subclass-/class-feature option choices.
 *
 * Expertise (Rogue, Bard) is a genuine build choice — pick which of your skill
 * proficiencies gain a doubled proficiency bonus — so it is structured: `choose`
 * is the parsed count and `from` names the eligible pool (the character's own
 * skill proficiencies, which are sheet state, so they are named rather than
 * inlined).
 *
 * Channel Divinity is NOT a build choice in SRD 5.1: the effects (Turn Undead
 * plus the chosen subclass's options) are GRANTED, and which to invoke is a
 * per-use decision. So every feature whose prose references Channel Divinity
 * carries a named out-of-scope marker, keeping the gate's finding explicit
 * without claiming a selection the SRD does not make at build time.
 */
function deriveSubclassFeatureChoices(
  input: DeriveFeatureChoicesInput,
  granted: ReadonlySet<string>,
): Map<string, DerivedChoice[]> {
  const out = new Map<string, DerivedChoice[]>();
  for (const feature of input.featureRecords) {
    if (!isBuildFeature(feature, granted)) continue;
    const description = featureDescription(feature);
    const level = featureLevel(feature);
    const choices: DerivedChoice[] = [];

    if (/choose [^.]*\bskill proficiencies\b/i.test(description)) {
      const choose = requireChooseCount(
        feature,
        description,
        /skill proficiencies/,
        'expertise',
      );
      // Rogue Expertise also covers thieves' tools ("one of your skill
      // proficiencies and your proficiency with thieves' tools"); Bard
      // Expertise is skills only (eshyra-vk23.4).
      const includesThievesTools = /thieves[’']?\s*tools/i.test(description);
      choices.push({
        id: 'expertise',
        category: 'expertise',
        prompt:
          'Choose which of your skill proficiencies gain Expertise (doubled proficiency bonus).',
        level,
        choose,
        from: characterStateFilter({
          proficiencyTypes: ['skill'],
          ...(includesThievesTools ? { tools: ['thieves-tools'] } : {}),
        }),
      });
    }

    if (/\bchannel divinity\b/i.test(description)) {
      choices.push({
        id: 'channel-divinity',
        category: 'channelDivinity',
        prompt: 'Channel Divinity effects available to this character.',
        level,
        unsupported: {
          reason:
            'Channel Divinity effects are granted by your class and chosen subclass (Turn Undead plus domain/oath options); which effect to invoke is a per-use decision, not a character-build choice.',
        },
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
    deriveAsiChoices(input, granted),
    deriveOptionListChoices(input, granted),
    deriveSpellChoices(input, granted),
    deriveSubclassFeatureChoices(input, granted),
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
