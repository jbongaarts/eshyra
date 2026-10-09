// Level-up spell selection (eshyra-ug4i.2). Design:
// docs/design/character-progression.md ("Spell selection").
//
// Derives the spell-related required-choice descriptors for one level-up step
// from the generated rules pack, validates the player's selections, and builds
// the structured result the engine persists on `CharacterSheet.spellcasting`.
//
// What a level-up carries, per SRD 5.1 (each bullet re-derived from the class's
// Spellcasting / Pact Magic prose and progression table in the pack):
//   - cantrips: the `cantripsKnown` delta, from the class cantrip list;
//   - known casters (bard, sorcerer, ranger, warlock): the `spellsKnown` delta
//     from the class list at a level the class can cast at the TARGET level,
//     plus one optional replacement of a known spell;
//   - wizard: two spells added to the spellbook every level;
//   - feature spell choices due at this level: Magical Secrets (and the repeats
//     at 14/18), College of Lore's Additional Magical Secrets, Mystic Arcanum,
//     Spell Mastery, Signature Spells, Pact of the Tome cantrips and Book of
//     Ancient Secrets rituals (the last two only when the triggering option is
//     picked in this very level-up);
//   - prepared casters (cleric, druid, paladin, wizard): NO blocker. Preparation
//     is a long-rest action; the level-up offers one OPTIONAL 'prepare'
//     descriptor that sets the prepared list within the class formula limit.
//
// Fail closed: a spell filter key this module does not understand, a feature
// that grants a spell without a structured choice, an unresolved legacy spell
// entry, or a count it cannot account for is surfaced as an UNSUPPORTED
// descriptor naming the cause - never ignored.
//
// Out of scope here: DM-adjudicated spell effects, the long-rest preparation
// tool, and creation-time recording of the structured field (eshyra-nnj6).

import type { FeatureChoice } from '../rules/featureChoices.js';
import { abilityModifier, abilityNameFromToken } from './abilities.js';
import type { AbilityScoreName } from './creation.js';
import type {
  CharacterSheet,
  CharacterSpellcasting,
  CharacterSpellDesignation,
} from './finalizeCharacter.js';
import {
  choiceInstanceKey,
  descriptorId,
  type HandledChoiceInstances,
} from './levelUpChoiceCoverage.js';
import type {
  LevelUpAppliedChoice,
  LevelUpChoiceOption,
  LevelUpChoiceSelections,
  LevelUpRequiredChoice,
} from './levelUpEngine.js';
import { selectedOptionIds } from './levelUpFeatureChoices.js';
import type {
  ResolvedClassData,
  ResolvedFeatureData,
  ResolvedLevelSpellcasting,
  ResolvedPreparationFormula,
  ResolvedSpellData,
  RulesPackCharacterResolver,
} from './rulesPackResolver.js';

/** Where a learned spell is stored on `CharacterSheet.spellcasting`. */
export type SpellBucket =
  | 'cantrips'
  | 'known'
  | 'spellbook'
  | 'prepared'
  | 'mysticArcanum'
  | 'ritualBook'
  | 'designations';

export type SpellDesignationKind = CharacterSpellDesignation['kind'];

/** One resolved placement of a spell in a sheet bucket. */
export interface SpellPlacement {
  readonly bucket: SpellBucket;
  readonly spellRef: string;
  /** Arcanum / designation level (the spell's own level). */
  readonly level?: number;
  readonly designationKind?: SpellDesignationKind;
}

/**
 * Set on a spell descriptor: how its selection is interpreted and stored.
 * `learn` adds the picks to `bucket` (a `known` pick that is a cantrip is stored
 * in `cantrips`); `replace` takes `[oldRef, newRef]` and swaps within `known`;
 * `prepare` replaces the whole prepared list with up to `choose` refs.
 */
export interface LevelUpSpellChoiceRef {
  readonly mode: 'learn' | 'replace' | 'prepare';
  readonly bucket: SpellBucket;
  /** `replace`: the held spells that may be given up. */
  readonly heldRefs?: readonly string[];
  /** `learn` into `mysticArcanum`: the arcanum spell level. */
  readonly arcanumLevel?: number;
  /** `learn` into `designations`. */
  readonly designationKind?: SpellDesignationKind;
}

/** The resolved effect of one spell choice, carried on the applied choice. */
export interface AppliedSpellChoice {
  readonly additions: readonly SpellPlacement[];
  readonly removals: readonly SpellPlacement[];
}

/** The ledger record of what a level-up did to the structured spell state. */
export interface LevelUpSpellSelections {
  /** The legacy flat `spells` list was classified into buckets by this level-up. */
  readonly classifiedFromLegacy?: true;
  readonly changes: Readonly<
    Partial<
      Record<
        SpellBucket,
        {
          readonly added: readonly string[];
          readonly removed: readonly string[];
        }
      >
    >
  >;
  /** The sheet's `spellcasting` after this level-up. */
  readonly resulting: CharacterSpellcasting;
}

/** The recognised keys of a pack `spellFilter` (see rules/featureChoices.ts). */
const FILTER_KEYS: ReadonlySet<string> = new Set([
  'kind',
  'classLists',
  'spellLevels',
  'minSpellLevel',
  'maxSpellLevel',
  'castableLevelsOnly',
  'includeCantrips',
  'ritualOnly',
  'mustBeInSpellbook',
  'mustBePreparedToCast',
  'alwaysPrepared',
  'countsAsClassSpell',
  'countsAgainstKnown',
  'requiresFeatureOption',
]);

interface SpellFilter {
  readonly classLists?: 'any' | readonly string[];
  readonly spellLevels?: readonly number[];
  readonly minSpellLevel?: number;
  readonly maxSpellLevel?:
    | number
    | { readonly classRef: string; readonly atLevel: number };
  readonly castableLevelsOnly?: boolean;
  readonly includeCantrips?: boolean;
  readonly ritualOnly?: boolean;
  readonly mustBeInSpellbook?: boolean;
  readonly countsAgainstKnown?: boolean;
  readonly requiresFeatureOption?: string;
}

type ParsedFilter =
  | { readonly ok: true; readonly filter: SpellFilter }
  | { readonly ok: false; readonly reason: string };

/**
 * Parse a choice's `from` into a spell filter. An unknown key or malformed value
 * fails closed (the caller emits an unsupported descriptor naming it) because
 * ignoring a constraint could offer an illegal spell.
 */
export function parseSpellFilter(from: unknown): ParsedFilter {
  if (
    from === null ||
    typeof from !== 'object' ||
    Array.isArray(from) ||
    (from as Record<string, unknown>).kind !== 'spellFilter'
  ) {
    return { ok: false, reason: "the choice's 'from' is not a spellFilter" };
  }
  const raw = from as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!FILTER_KEYS.has(key)) {
      return { ok: false, reason: `unknown spellFilter key '${key}'` };
    }
  }
  const isNumberList = (v: unknown): v is number[] =>
    Array.isArray(v) && v.every((n) => Number.isInteger(n));
  const bad = (key: string) => ({
    ok: false as const,
    reason: `spellFilter key '${key}' has an unsupported value`,
  });
  if (
    raw.classLists !== undefined &&
    raw.classLists !== 'any' &&
    !(
      Array.isArray(raw.classLists) &&
      raw.classLists.every((c) => typeof c === 'string')
    )
  ) {
    return bad('classLists');
  }
  if (raw.spellLevels !== undefined && !isNumberList(raw.spellLevels)) {
    return bad('spellLevels');
  }
  for (const key of ['minSpellLevel'] as const) {
    if (raw[key] !== undefined && !Number.isInteger(raw[key])) return bad(key);
  }
  const max = raw.maxSpellLevel;
  if (
    max !== undefined &&
    !Number.isInteger(max) &&
    !(
      max !== null &&
      typeof max === 'object' &&
      typeof (max as Record<string, unknown>).classRef === 'string' &&
      Number.isInteger((max as Record<string, unknown>).atLevel)
    )
  ) {
    return bad('maxSpellLevel');
  }
  for (const key of [
    'castableLevelsOnly',
    'includeCantrips',
    'ritualOnly',
    'mustBeInSpellbook',
    'countsAgainstKnown',
  ] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== 'boolean')
      return bad(key);
  }
  if (
    raw.requiresFeatureOption !== undefined &&
    typeof raw.requiresFeatureOption !== 'string'
  ) {
    return bad('requiresFeatureOption');
  }
  return { ok: true, filter: raw as SpellFilter };
}

/** Highest spell level the class can cast with the slots of `level`'s row. */
export function highestCastableLevel(
  resolver: RulesPackCharacterResolver,
  classRef: string,
  level: number,
): number {
  const row = resolver.resolveClassLevel(classRef, level);
  if (!row.ok) return 0;
  return castableCeiling(row.record.spellcasting);
}

function castableCeiling(
  spellcasting: ResolvedLevelSpellcasting | undefined,
): number {
  if (spellcasting === undefined) return 0;
  const slotLevels = Object.keys(spellcasting.slots ?? {}).map(Number);
  return Math.max(0, spellcasting.pactSlots?.level ?? 0, ...slotLevels);
}

interface FilterEnv {
  readonly resolver: RulesPackCharacterResolver;
  readonly classKey: string;
  readonly toLevel: number;
  readonly spellbook: readonly string[];
  /** Spells to leave out (everything already held, when learning). */
  readonly excluded: ReadonlySet<string>;
}

type EvaluatedFilter =
  | { readonly ok: true; readonly spells: readonly ResolvedSpellData[] }
  | { readonly ok: false; readonly reason: string };

/**
 * The one shared spell-filter evaluator: the legal spells for `filter` at the
 * target level. "Castable" is spell level 1..the highest slot level (warlock:
 * pact slot level) at the TARGET level, which is also how `maxSpellLevel
 * {classRef, atLevel}` is read - SRD: "A spell you choose must be of a level
 * you can cast", and a choice is always made at the target level (the pack's
 * `atLevel` only describes the first grant; Magical Secrets repeats at 14/18).
 */
export function evaluateSpellFilter(
  filter: SpellFilter,
  env: FilterEnv,
): EvaluatedFilter {
  let classNames: ReadonlySet<string> | undefined;
  if (filter.classLists !== undefined && filter.classLists !== 'any') {
    const names = new Set<string>();
    for (const ref of filter.classLists) {
      const cls = env.resolver.resolveClass(ref);
      if (!cls.ok) {
        return { ok: false, reason: `class list '${ref}' does not resolve` };
      }
      names.add(cls.record.name);
    }
    classNames = names;
  }
  const castable = highestCastableLevel(
    env.resolver,
    env.classKey,
    env.toLevel,
  );
  let cap = Number.POSITIVE_INFINITY;
  if (typeof filter.maxSpellLevel === 'number') cap = filter.maxSpellLevel;
  else if (filter.maxSpellLevel !== undefined) {
    cap = highestCastableLevel(
      env.resolver,
      filter.maxSpellLevel.classRef,
      env.toLevel,
    );
  }
  const spellbook = new Set(env.spellbook);
  const cantripsAllowed =
    filter.includeCantrips === true || filter.spellLevels?.includes(0) === true;
  const spells = env.resolver.listSpells().filter((spell) => {
    if (env.excluded.has(spell.key)) return false;
    if (
      classNames !== undefined &&
      !spell.classes.some((name) => classNames.has(name))
    ) {
      return false;
    }
    if (filter.ritualOnly === true && spell.ritual !== true) return false;
    if (filter.mustBeInSpellbook === true && !spellbook.has(spell.key)) {
      return false;
    }
    if (spell.level === 0) return cantripsAllowed;
    if (
      filter.spellLevels !== undefined &&
      !filter.spellLevels.includes(spell.level)
    ) {
      return false;
    }
    if (spell.level < (filter.minSpellLevel ?? 1)) return false;
    if (spell.level > cap) return false;
    if (filter.castableLevelsOnly === true && spell.level > castable) {
      return false;
    }
    return true;
  });
  spells.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  return { ok: true, spells };
}

function optionsOfSpells(
  spells: readonly ResolvedSpellData[],
): readonly LevelUpChoiceOption[] {
  return spells.map((spell) => ({
    id: spell.key,
    name: spell.name,
    level: spell.level,
  }));
}

// ---------------------------------------------------------------------------
// Sheet state: legacy classification and bucket arithmetic
// ---------------------------------------------------------------------------

export type EffectiveSpellcasting =
  | {
      readonly ok: true;
      /** `undefined` for a non-caster, or a caster who knows no spells yet. */
      readonly spellcasting: CharacterSpellcasting | undefined;
      /** True when the legacy flat `spells` list was just classified. */
      readonly classified: boolean;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * The structured spell state the level-up works from. A sheet with a
 * `spellcasting` field uses it as is. A legacy sheet (flat `spells` only) is
 * classified deterministically: every entry must resolve to a pack spell (else
 * the level-up is refused naming the entry - never guessed); level 0 goes to
 * `cantrips`; leveled spells go to `known` (known casters), `spellbook` (the
 * wizard, whose spellbook size is pack data) or `prepared` (other prepared
 * casters).
 */
export function effectiveSpellcasting(
  sheet: CharacterSheet,
  classRecord: ResolvedClassData,
  resolver: RulesPackCharacterResolver,
): EffectiveSpellcasting {
  if (sheet.spellcasting !== undefined) {
    return { ok: true, spellcasting: sheet.spellcasting, classified: false };
  }
  const preparation = classRecord.spellPreparation;
  if (preparation === undefined || sheet.spells.length === 0) {
    return { ok: true, spellcasting: undefined, classified: false };
  }
  const cantrips: string[] = [];
  const leveled: string[] = [];
  for (const entry of sheet.spells) {
    const resolved = resolver.resolveSpell(entry);
    if (!resolved.ok) {
      return {
        ok: false,
        reason: `legacy spell entry '${entry}' does not resolve to a pack spell; it cannot be classified, so the level-up is refused`,
      };
    }
    const bucket = resolved.record.level === 0 ? cantrips : leveled;
    if (!bucket.includes(resolved.record.key)) bucket.push(resolved.record.key);
  }
  const spellcasting: CharacterSpellcasting =
    preparation.kind === 'known'
      ? { cantrips, known: leveled }
      : preparation.spellbookStartingSpells !== undefined
        ? { cantrips, spellbook: leveled }
        : { cantrips, prepared: leveled };
  return { ok: true, spellcasting, classified: true };
}

/** `sheet.spells`: the derived union of every bucket, canonical refs. */
export function spellsUnion(sc: CharacterSpellcasting): readonly string[] {
  return [
    ...new Set([
      ...sc.cantrips,
      ...(sc.known ?? []),
      ...(sc.spellbook ?? []),
      ...(sc.prepared ?? []),
      ...(sc.alwaysPrepared ?? []),
      ...(sc.mysticArcanum ?? []).map((entry) => entry.spellRef),
      ...(sc.ritualBook ?? []),
    ]),
  ];
}

/**
 * Ownership is per destination: a Book of Ancient Secrets ritual lives in its
 * own `ritualBook` bucket and does not count as an ordinarily known/prepared
 * spell (SRD p.48: such a spell can still be learned by another means), so the
 * ordinary held set excludes ritualBook-only entries, and the ritualBook held
 * set is only the ritual book itself.
 */
function heldRefsOf(sc: CharacterSpellcasting | undefined): Set<string> {
  if (sc === undefined) return new Set();
  return new Set(spellsUnion({ ...sc, ritualBook: undefined }));
}

function heldRitualRefsOf(sc: CharacterSpellcasting | undefined): Set<string> {
  return new Set(sc?.ritualBook ?? []);
}

/** Apply placements (removals first) to a spellcasting state, immutably. */
export function applySpellPlacements(
  base: CharacterSpellcasting | undefined,
  applied: readonly LevelUpAppliedChoice[],
): CharacterSpellcasting {
  const list = (key: 'cantrips' | 'known' | 'spellbook' | 'prepared') => [
    ...(base?.[key] ?? []),
  ];
  const buckets = {
    cantrips: list('cantrips'),
    known: list('known'),
    spellbook: list('spellbook'),
    prepared: list('prepared'),
  };
  const present = new Set<string>(
    (['known', 'spellbook', 'prepared'] as const).filter(
      (key) => base?.[key] !== undefined,
    ),
  );
  let arcanum = [...(base?.mysticArcanum ?? [])];
  let ritualBook = [...(base?.ritualBook ?? [])];
  let designations = [...(base?.designations ?? [])];
  const spellChoices = applied.flatMap((choice) =>
    choice.spellChoice === undefined ? [] : [choice.spellChoice],
  );
  for (const choice of spellChoices) {
    for (const removal of choice.removals) {
      if (removal.bucket === 'mysticArcanum') {
        arcanum = arcanum.filter((e) => e.spellRef !== removal.spellRef);
      } else if (removal.bucket === 'ritualBook') {
        ritualBook = ritualBook.filter((ref) => ref !== removal.spellRef);
      } else if (removal.bucket === 'designations') {
        designations = designations.filter(
          (e) => e.spellRef !== removal.spellRef,
        );
      } else {
        buckets[removal.bucket] = buckets[removal.bucket].filter(
          (ref) => ref !== removal.spellRef,
        );
      }
    }
  }
  for (const choice of spellChoices) {
    for (const addition of choice.additions) {
      if (addition.bucket === 'mysticArcanum') {
        arcanum.push({
          level: addition.level as number,
          spellRef: addition.spellRef,
        });
      } else if (addition.bucket === 'ritualBook') {
        if (!ritualBook.includes(addition.spellRef)) {
          ritualBook.push(addition.spellRef);
        }
      } else if (addition.bucket === 'designations') {
        designations.push({
          kind: addition.designationKind as SpellDesignationKind,
          level: addition.level as number,
          spellRef: addition.spellRef,
        });
      } else {
        if (addition.bucket !== 'cantrips') present.add(addition.bucket);
        if (!buckets[addition.bucket].includes(addition.spellRef)) {
          buckets[addition.bucket].push(addition.spellRef);
        }
      }
    }
  }
  return {
    cantrips: buckets.cantrips,
    ...(present.has('known') ? { known: buckets.known } : {}),
    ...(present.has('spellbook') ? { spellbook: buckets.spellbook } : {}),
    ...(present.has('prepared') ? { prepared: buckets.prepared } : {}),
    ...(arcanum.length > 0 ? { mysticArcanum: arcanum } : {}),
    ...(ritualBook.length > 0 ? { ritualBook } : {}),
    ...(designations.length > 0 ? { designations } : {}),
    ...(base?.alwaysPrepared !== undefined
      ? { alwaysPrepared: base.alwaysPrepared }
      : {}),
  };
}

/**
 * The structured result of this level-up's spell choices (for the ledger and
 * the sheet), or `undefined` when nothing about the spell state changed.
 */
export function buildSpellSelections(
  effective: EffectiveSpellcasting & { ok: true },
  applied: readonly LevelUpAppliedChoice[],
): LevelUpSpellSelections | undefined {
  const spellApplied = applied.filter((c) => c.spellChoice !== undefined);
  if (spellApplied.length === 0 && !effective.classified) return undefined;
  const changes: Partial<
    Record<SpellBucket, { added: string[]; removed: string[] }>
  > = {};
  const entry = (bucket: SpellBucket) => {
    changes[bucket] ??= { added: [], removed: [] };
    return changes[bucket] as { added: string[]; removed: string[] };
  };
  for (const choice of spellApplied) {
    for (const p of choice.spellChoice?.additions ?? []) {
      entry(p.bucket).added.push(p.spellRef);
    }
    for (const p of choice.spellChoice?.removals ?? []) {
      entry(p.bucket).removed.push(p.spellRef);
    }
  }
  return {
    ...(effective.classified ? { classifiedFromLegacy: true as const } : {}),
    changes,
    resulting: applySpellPlacements(effective.spellcasting, applied),
  };
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export interface SpellDetectionContext {
  readonly sheet: CharacterSheet;
  readonly classKey: string;
  readonly classRecord: ResolvedClassData;
  readonly toLevel: number;
  readonly fromSpellcasting: ResolvedLevelSpellcasting | undefined;
  readonly toSpellcasting: ResolvedLevelSpellcasting | undefined;
  /** Feature refs granted at the target level (class row + subclass features). */
  readonly targetFeatureRefs: readonly string[];
  /** Feature refs granted at any earlier level. */
  readonly heldFeatureRefs: ReadonlySet<string>;
  readonly resolver: RulesPackCharacterResolver;
  readonly selections: LevelUpChoiceSelections;
}

function classSlug(classKey: string): string {
  return classKey.replace(/^class:/, '');
}

function isBaseSpellcastingFeature(ref: string, classKey: string): boolean {
  const slug = classSlug(classKey);
  return (
    ref === `feature:${slug}:spellcasting` ||
    ref === `feature:${slug}:pact-magic`
  );
}

function baseFeature(
  ctx: Pick<SpellDetectionContext, 'classKey' | 'resolver'>,
): ResolvedFeatureData | undefined {
  return ctx.resolver
    .listFeatures()
    .find((feature) => isBaseSpellcastingFeature(feature.key, ctx.classKey));
}

function baseChoice(
  ctx: Pick<SpellDetectionContext, 'classKey' | 'resolver'>,
  id: string,
): FeatureChoice | undefined {
  return baseFeature(ctx)?.choices?.find((choice) => choice.id === id);
}

function unsupported(
  id: string,
  label: string,
  reason: string,
  unsupportedReason: string,
  featureRef?: string,
): LevelUpRequiredChoice {
  return {
    id,
    kind: 'spell-selection',
    status: 'unsupported',
    label,
    reason,
    unsupportedReason,
    ...(featureRef !== undefined ? { featureRef } : {}),
  };
}

function normalizeSpell(
  resolver: RulesPackCharacterResolver,
  value: string,
): string | undefined {
  const resolved = resolver.resolveSpell(value);
  return resolved.ok ? resolved.record.key : undefined;
}

/** In-level spellbook additions already selected (for same-level preparation). */
function pendingSpellbookPicks(
  ctx: Pick<SpellDetectionContext, 'resolver' | 'selections' | 'toLevel'>,
): readonly string[] {
  const picked = ctx.selections[`level.${ctx.toLevel}.spells.spellbook`] ?? [];
  return picked.flatMap((value) => {
    const key = normalizeSpell(ctx.resolver, value);
    return key === undefined ? [] : [key];
  });
}

interface DueFeatureChoice {
  readonly feature: ResolvedFeatureData;
  readonly choice: FeatureChoice;
}

/**
 * Spell/cantrip feature choices due at this level-up (every feature except the
 * base spellcasting feature, whose choices the bucket descriptors own). A choice
 * is due when its `level` is the target level; a feature granted AGAIN at the
 * target level with no choice printed at that level (Magical Secrets at 14/18)
 * contributes all its choices; a conditional choice (`requiresFeatureOption`)
 * is due only when its trigger option is picked in this very level-up.
 */
function dueFeatureSpellChoices(ctx: SpellDetectionContext): {
  readonly due: readonly DueFeatureChoice[];
  /** Spell/cantrip choice instances evaluated here, due or decided not due. */
  readonly handled: ReadonlySet<string>;
} {
  const due: DueFeatureChoice[] = [];
  const handled = new Set<string>();
  const pickedNow = selectedOptionIds(ctx.selections, ctx.toLevel);
  const target = new Set(ctx.targetFeatureRefs);
  const refs = new Set([...ctx.targetFeatureRefs, ...ctx.heldFeatureRefs]);
  for (const ref of refs) {
    if (isBaseSpellcastingFeature(ref, ctx.classKey)) continue;
    const feature = ctx.resolver
      .listFeatures()
      .find((candidate) => candidate.key === ref);
    const spellChoices = (feature?.choices ?? []).filter(
      (choice) => choice.category === 'spell' || choice.category === 'cantrip',
    );
    if (feature === undefined || spellChoices.length === 0) continue;
    const exact = spellChoices.filter(
      (choice) =>
        choice.level === ctx.toLevel && requiredTrigger(choice) === undefined,
    );
    const repeatedGrant = target.has(ref) && ctx.heldFeatureRefs.has(ref);
    // A first grant (target, not held) whose unconditional choice is not
    // printed at this level is NOT a decision to skip it: leave it unhandled
    // so the coverage invariant blocks rather than dropping a build choice.
    const firstGrant = target.has(ref) && !ctx.heldFeatureRefs.has(ref);
    for (const choice of spellChoices) {
      const trigger = requiredTrigger(choice);
      if (trigger !== undefined) {
        // Conditional: evaluated either way (due only when picked now).
        handled.add(choiceInstanceKey(ref, choice.id));
        if (pickedNow.has(trigger)) due.push({ feature, choice });
        continue;
      }
      if (choice.level === ctx.toLevel) {
        handled.add(choiceInstanceKey(ref, choice.id));
        due.push({ feature, choice });
      } else if (repeatedGrant && exact.length === 0) {
        handled.add(choiceInstanceKey(ref, choice.id));
        due.push({ feature, choice });
      } else if (!firstGrant) {
        handled.add(choiceInstanceKey(ref, choice.id));
      }
    }
  }
  return { due, handled };
}

function requiredTrigger(choice: FeatureChoice): string | undefined {
  const from = choice.from;
  if (from === null || typeof from !== 'object' || Array.isArray(from)) {
    return undefined;
  }
  const value = (from as Record<string, unknown>).requiresFeatureOption;
  return typeof value === 'string' ? value : undefined;
}

/**
 * Required-choice descriptors for the spell side of one level-up. See the
 * module header for the per-class derivation.
 */
export function detectSpellDescriptors(ctx: SpellDetectionContext): {
  readonly choices: readonly LevelUpRequiredChoice[];
  readonly handledInstances: HandledChoiceInstances;
} {
  const out: LevelUpRequiredChoice[] = [];
  const handled = new Set<string>();
  const prefix = `level.${ctx.toLevel}.spells`;
  const effective = effectiveSpellcasting(
    ctx.sheet,
    ctx.classRecord,
    ctx.resolver,
  );
  if (!effective.ok) {
    // Nothing is handled: the unsupported descriptor blocks the level-up and
    // the coverage invariant reports any instance it leaves unevaluated.
    return {
      choices: [
        unsupported(
          `${prefix}.legacy-classification`,
          'Classify existing spells',
          effective.reason,
          `${effective.reason}. A legacy flat spell list must resolve entirely before it can be classified into known/spellbook/prepared buckets; unresolved entries are never guessed.`,
        ),
      ],
      handledInstances: handled,
    };
  }
  const sc = effective.spellcasting;
  const held = heldRefsOf(sc);
  const heldRituals = heldRitualRefsOf(sc);
  const spellbook = [...(sc?.spellbook ?? []), ...pendingSpellbookPicks(ctx)];
  const env = (excluded: ReadonlySet<string>): FilterEnv => ({
    resolver: ctx.resolver,
    classKey: ctx.classKey,
    toLevel: ctx.toLevel,
    spellbook,
    excluded,
  });
  const preparation = ctx.classRecord.spellPreparation;
  const casts = ctx.classRecord.spellcastingAbility !== undefined;

  // Feature choices first: bard Magical Secrets counts against spells known.
  const { due: dueFeatures, handled: featureHandled } =
    dueFeatureSpellChoices(ctx);
  for (const key of featureHandled) handled.add(key);
  // Base Spellcasting / Pact Magic choices: each is handled only when the
  // branch that evaluates it below actually ran.
  const base = baseFeature(ctx);
  const handleBase = (choiceId: string): void => {
    if (base !== undefined && ctx.targetFeatureRefs.includes(base.key)) {
      handled.add(choiceInstanceKey(base.key, choiceId));
    }
  };
  let secretsCountingAgainstKnown = 0;
  for (const { choice } of dueFeatures) {
    const parsed = parseSpellFilter(choice.from);
    if (
      parsed.ok &&
      parsed.filter.countsAgainstKnown === true &&
      parsed.filter.requiresFeatureOption === undefined
    ) {
      secretsCountingAgainstKnown += choice.choose ?? 0;
    }
  }

  if (casts && ctx.toSpellcasting !== undefined) {
    // (a) cantrips
    handleBase('cantrips');
    const cantripDelta =
      (ctx.toSpellcasting.cantripsKnown ?? 0) -
      (ctx.fromSpellcasting?.cantripsKnown ?? 0);
    if (cantripDelta > 0) {
      out.push(
        learnFromBase(
          ctx,
          `${prefix}.cantrips`,
          'cantrips',
          'cantrips',
          cantripDelta,
          {
            bucket: 'cantrips',
            excluded: held,
            env,
            label: `Choose ${cantripDelta} new cantrip(s)`,
          },
        ),
      );
    }
    // (b) known casters
    if (preparation?.kind === 'known') {
      handleBase('spells');
      handleBase('spell-replacement');
      const knownDelta =
        (ctx.toSpellcasting.spellsKnown ?? 0) -
        (ctx.fromSpellcasting?.spellsKnown ?? 0);
      const ordinary = knownDelta - secretsCountingAgainstKnown;
      if (ordinary < 0) {
        out.push(
          unsupported(
            `${prefix}.known`,
            'Spells known',
            `level ${ctx.toLevel} grants ${secretsCountingAgainstKnown} feature picks that count against spells known but spells known grows by only ${knownDelta}`,
            'The spells-known growth does not cover the feature picks that count against it; deterministic accounting is not possible.',
          ),
        );
      } else if (ordinary > 0) {
        out.push(
          learnFromBase(ctx, `${prefix}.known`, 'spells', 'known', ordinary, {
            bucket: 'known',
            excluded: held,
            env,
            label: `Choose ${ordinary} new spell(s) known`,
          }),
        );
      }
      const replacement = replacementDescriptor(ctx, prefix, sc, held, env);
      if (replacement !== undefined) out.push(replacement);
    }
    // (c) wizard spellbook growth
    if (preparation?.spellbookStartingSpells !== undefined) {
      handleBase('spellbook-growth');
      const growth = baseChoice(ctx, 'spellbook-growth');
      if (growth === undefined) {
        out.push(
          unsupported(
            `${prefix}.spellbook`,
            'Spellbook growth',
            `level ${ctx.toLevel} adds spells to the spellbook`,
            "The class keeps a spellbook but its pack record carries no 'spellbook-growth' choice.",
          ),
        );
      } else {
        out.push(
          learnFromBase(
            ctx,
            `${prefix}.spellbook`,
            'spellbook-growth',
            'spellbook',
            growth.choose ?? 0,
            {
              bucket: 'spellbook',
              excluded: held,
              env,
              label: `Add ${growth.choose ?? 0} spell(s) to your spellbook`,
            },
          ),
        );
      }
    }
    // (e) prepared casters: optional, never a blocker
    if (preparation?.kind === 'prepared') {
      handleBase('prepared-spells');
      out.push(prepareDescriptor(ctx, prefix, preparation, sc, spellbook));
    }
    if (preparation === undefined) {
      out.push(
        unsupported(
          `${prefix}.unclassified`,
          'Spellcasting',
          `level ${ctx.toLevel} spellcasting for a class with no spell-preparation model`,
          'The class record carries no spellPreparation, so its spell state cannot be classified.',
        ),
      );
    }
  }

  // (d) feature spell choices
  for (const due of dueFeatures) {
    out.push(featureSpellDescriptor(ctx, due, held, heldRituals, env));
  }

  return { choices: out, handledInstances: handled };
}

interface LearnOptions {
  readonly bucket: SpellBucket;
  readonly excluded: ReadonlySet<string>;
  readonly env: (excluded: ReadonlySet<string>) => FilterEnv;
  readonly label: string;
  readonly featureRef?: string;
  readonly arcanumLevel?: number;
  readonly designationKind?: SpellDesignationKind;
}

function learnFromBase(
  ctx: SpellDetectionContext,
  id: string,
  baseChoiceId: string,
  _bucketName: string,
  count: number,
  options: LearnOptions,
): LevelUpRequiredChoice {
  const choice = baseChoice(ctx, baseChoiceId);
  if (choice === undefined) {
    return unsupported(
      id,
      options.label,
      `level ${ctx.toLevel}: ${options.label}`,
      `The class's spellcasting feature carries no '${baseChoiceId}' choice, so the legal spells cannot be derived.`,
    );
  }
  return learnDescriptor(ctx, id, choice, count, options);
}

function learnDescriptor(
  ctx: SpellDetectionContext,
  id: string,
  choice: FeatureChoice,
  count: number,
  options: LearnOptions,
): LevelUpRequiredChoice {
  const parsed = parseSpellFilter(choice.from);
  if (!parsed.ok) {
    return unsupported(
      id,
      options.label,
      `level ${ctx.toLevel}: ${choice.prompt}`,
      `${parsed.reason}; the choice is not applied rather than ignoring a constraint.`,
      options.featureRef,
    );
  }
  const evaluated = evaluateSpellFilter(
    parsed.filter,
    options.env(options.excluded),
  );
  if (!evaluated.ok) {
    return unsupported(
      id,
      options.label,
      `level ${ctx.toLevel}: ${choice.prompt}`,
      evaluated.reason,
      options.featureRef,
    );
  }
  if (evaluated.spells.length < count) {
    return unsupported(
      id,
      options.label,
      `level ${ctx.toLevel}: ${choice.prompt}`,
      `Only ${evaluated.spells.length} legal spell(s) exist for a choice of ${count}.`,
      options.featureRef,
    );
  }
  const ref: LevelUpSpellChoiceRef = {
    mode: 'learn',
    bucket: options.bucket,
    ...(options.arcanumLevel !== undefined
      ? { arcanumLevel: options.arcanumLevel }
      : {}),
    ...(options.designationKind !== undefined
      ? { designationKind: options.designationKind }
      : {}),
  };
  return {
    id,
    kind: 'spell-selection',
    status: 'supported',
    label: options.label,
    choose: count,
    from: evaluated.spells.map((spell) => spell.key),
    options: optionsOfSpells(evaluated.spells),
    spellChoice: ref,
    reason: `level ${ctx.toLevel}: ${choice.prompt}`,
    ...(options.featureRef !== undefined
      ? { featureRef: options.featureRef }
      : {}),
  };
}

function replacementDescriptor(
  ctx: SpellDetectionContext,
  prefix: string,
  sc: CharacterSpellcasting | undefined,
  held: ReadonlySet<string>,
  env: (excluded: ReadonlySet<string>) => FilterEnv,
): LevelUpRequiredChoice | undefined {
  const choice = baseChoice(ctx, 'spell-replacement');
  if (choice === undefined) return undefined;
  const id = `${prefix}.replace`;
  const parsed = parseSpellFilter(choice.from);
  if (!parsed.ok) {
    return unsupported(
      id,
      'Replace a known spell',
      `level ${ctx.toLevel}: ${choice.prompt}`,
      parsed.reason,
    );
  }
  const className = ctx.classRecord.name;
  const replaceable = (sc?.known ?? []).filter((ref) => {
    const spell = ctx.resolver.resolveSpell(ref);
    // The OLD spell need not be on the native class list (Magical Secrets
    // picks are class spells for this character); only the NEW spell is
    // filtered by class list/level. `known` never holds cantrips or
    // ritualBook-only spells.
    return spell.ok && spell.record.level > 0;
  });
  if (replaceable.length === 0) return undefined;
  const evaluated = evaluateSpellFilter(parsed.filter, env(held));
  if (!evaluated.ok) {
    return unsupported(
      id,
      'Replace a known spell',
      `level ${ctx.toLevel}: ${choice.prompt}`,
      evaluated.reason,
    );
  }
  return {
    id,
    kind: 'spell-selection',
    status: 'supported',
    optional: true,
    label: `Optionally replace one known ${className} spell [old, new]`,
    choose: 2,
    from: evaluated.spells.map((spell) => spell.key),
    options: optionsOfSpells(evaluated.spells),
    spellChoice: { mode: 'replace', bucket: 'known', heldRefs: replaceable },
    reason: choice.prompt,
  };
}

function modifierAfterAsi(
  sheet: CharacterSheet,
  ability: AbilityScoreName,
  selections: LevelUpChoiceSelections,
  toLevel: number,
): number {
  const picked = selections[`level.${toLevel}.ability-score-improvement`] ?? [];
  const names = picked.map((value) => abilityNameFromToken(value));
  let score = sheet.abilityScores[ability].final;
  if (
    (names.length === 1 || names.length === 2) &&
    names.every((name) => name !== undefined) &&
    new Set(names).size === names.length &&
    names.includes(ability)
  ) {
    score = Math.min(20, score + (names.length === 1 ? 2 : 1));
  }
  return abilityModifier(score);
}

/** The legal prepared-spell option set and count limit for one class level. */
export type PreparationBasis =
  | {
      readonly ok: true;
      readonly limit: number;
      readonly spells: readonly ResolvedSpellData[];
      readonly formula: ResolvedPreparationFormula;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * The single computation of what a prepared caster may prepare: the class's
 * `prepared-spells` feature choice (evaluated by the shared spell-filter
 * evaluator at `level`; wizard: spellbook only; castable spell levels only) and
 * the count limit `max(minimum, mod + floor(level / divisor))`. Shared by the
 * level-up `prepare` descriptor and the long-rest preparation operation
 * (eshyra-odpc) so the formula and option set cannot drift apart.
 * `modifierOf` supplies the ability modifier (level-up passes the post-ASI one).
 */
export function evaluatePreparationBasis(args: {
  readonly resolver: RulesPackCharacterResolver;
  readonly classKey: string;
  readonly preparation: NonNullable<ResolvedClassData['spellPreparation']>;
  readonly level: number;
  readonly spellbook: readonly string[];
  readonly modifierOf: (ability: AbilityScoreName) => number | undefined;
}): PreparationBasis {
  const choice = baseChoice(args, 'prepared-spells');
  const formula = args.preparation.preparationFormula;
  if (formula === undefined || choice === undefined) {
    return {
      ok: false,
      reason:
        'The class record carries no structured prepared-spell formula/choice.',
    };
  }
  const ability = formula.ability as AbilityScoreName;
  const mod = args.modifierOf(ability);
  if (mod === undefined) {
    return {
      ok: false,
      reason: `Unknown preparation ability '${formula.ability}'.`,
    };
  }
  const parsed = parseSpellFilter(choice.from);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const evaluated = evaluateSpellFilter(parsed.filter, {
    resolver: args.resolver,
    classKey: args.classKey,
    toLevel: args.level,
    spellbook: args.spellbook,
    excluded: new Set(),
  });
  if (!evaluated.ok) return { ok: false, reason: evaluated.reason };
  const limit = Math.max(
    formula.minimum,
    mod + Math.floor(args.level / formula.classLevelDivisor),
  );
  return { ok: true, limit, spells: evaluated.spells, formula };
}

function prepareDescriptor(
  ctx: SpellDetectionContext,
  prefix: string,
  preparation: NonNullable<ResolvedClassData['spellPreparation']>,
  sc: CharacterSpellcasting | undefined,
  spellbook: readonly string[],
): LevelUpRequiredChoice {
  const id = `${prefix}.prepare`;
  const basis = evaluatePreparationBasis({
    resolver: ctx.resolver,
    classKey: ctx.classKey,
    preparation,
    level: ctx.toLevel,
    spellbook,
    modifierOf: (ability) =>
      ctx.sheet.abilityScores[ability] === undefined
        ? undefined
        : modifierAfterAsi(ctx.sheet, ability, ctx.selections, ctx.toLevel),
  });
  if (!basis.ok) {
    return unsupported(
      id,
      'Prepare spells',
      `level ${ctx.toLevel}: prepared spells`,
      basis.reason,
    );
  }
  const { limit, formula } = basis;
  return {
    id,
    kind: 'spell-selection',
    status: 'supported',
    optional: true,
    label: `Prepare up to ${limit} spell(s) (optional; preparation can also change after a long rest)`,
    choose: limit,
    from: basis.spells.map((spell) => spell.key),
    options: optionsOfSpells(basis.spells),
    spellChoice: { mode: 'prepare', bucket: 'prepared' },
    reason: `Prepare ${formula.ability} modifier + ${
      formula.classLevelDivisor === 1
        ? 'class level'
        : `class level / ${formula.classLevelDivisor}`
    } spells (minimum ${formula.minimum}); currently prepared: ${(sc?.prepared ?? []).length}.`,
  };
}

function featureSpellDescriptor(
  ctx: SpellDetectionContext,
  due: DueFeatureChoice,
  held: ReadonlySet<string>,
  heldRituals: ReadonlySet<string>,
  env: (excluded: ReadonlySet<string>) => FilterEnv,
): LevelUpRequiredChoice {
  const { feature, choice } = due;
  const id = descriptorId(ctx.toLevel, feature.key, choice.id);
  const label = `${feature.name}: choose ${choice.choose ?? '?'} (${choice.id})`;
  const fail = (why: string) =>
    unsupported(
      id,
      label,
      `level ${ctx.toLevel}: ${choice.prompt}`,
      why,
      feature.key,
    );
  if (choice.unsupported !== undefined) {
    return fail(
      `Pack marks the choice unsupported: ${choice.unsupported.reason}`,
    );
  }
  if (typeof choice.choose !== 'number') {
    return fail('The choice carries no structured pick count.');
  }
  const parsed = parseSpellFilter(choice.from);
  if (!parsed.ok) return fail(parsed.reason);
  const filter = parsed.filter;
  let bucket: SpellBucket = 'known';
  let arcanumLevel: number | undefined;
  let designationKind: SpellDesignationKind | undefined;
  if (feature.key === 'feature:warlock:mystic-arcanum') {
    arcanumLevel =
      filter.spellLevels?.length === 1 ? filter.spellLevels[0] : undefined;
    if (arcanumLevel === undefined) {
      return fail('Mystic Arcanum choice does not name a single spell level.');
    }
    bucket = 'mysticArcanum';
  } else if (choice.id === 'book-of-ancient-secrets-rituals') {
    // SRD: the rituals "appear in the book and don't count against the number
    // of spells you know" -- a dedicated bucket, never a known spell.
    bucket = 'ritualBook';
  } else if (
    feature.key === 'feature:wizard:spell-mastery' ||
    feature.key === 'feature:wizard:signature-spells'
  ) {
    designationKind =
      feature.key === 'feature:wizard:spell-mastery'
        ? 'spell-mastery'
        : 'signature-spell';
    bucket = 'designations';
  } else if (filter.mustBeInSpellbook === true) {
    return fail(
      'A spellbook-restricted choice with no known destination bucket is not supported.',
    );
  }
  // Learned spells may not already be held; a designation chooses FROM the
  // spellbook, so only an earlier designation of the same kind is excluded.
  const excluded: ReadonlySet<string> =
    bucket === 'designations'
      ? new Set(
          (ctx.sheet.spellcasting?.designations ?? [])
            .filter((entry) => entry.kind === designationKind)
            .map((entry) => entry.spellRef),
        )
      : bucket === 'ritualBook'
        ? heldRituals
        : held;
  return learnDescriptor(ctx, id, choice, choice.choose, {
    bucket,
    excluded,
    env,
    label,
    featureRef: feature.key,
    ...(arcanumLevel !== undefined ? { arcanumLevel } : {}),
    ...(designationKind !== undefined ? { designationKind } : {}),
  });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type SpellChoiceResolution =
  | { readonly ok: true; readonly applied?: LevelUpAppliedChoice }
  | { readonly ok: false; readonly reason: string };

/**
 * Validate one spell descriptor's selection and build the applied choice: exact
 * count, distinct, resolvable, drawn from the descriptor's legal list (which the
 * shared filter evaluator produced), and distinct from the picks of every other
 * spell descriptor of this level-up. A replacement's old ref must be a held
 * known spell.
 */
export function resolveSpellChoiceSelection(args: {
  readonly choice: LevelUpRequiredChoice;
  readonly selected: readonly string[];
  readonly sheet: CharacterSheet;
  readonly classRecord: ResolvedClassData;
  readonly resolver: RulesPackCharacterResolver;
  readonly requiredChoices: readonly LevelUpRequiredChoice[];
  readonly selections: LevelUpChoiceSelections;
}): SpellChoiceResolution {
  const { choice, selected, resolver } = args;
  const ref = choice.spellChoice;
  if (ref === undefined) {
    return { ok: false, reason: 'not a spell choice descriptor' };
  }
  if (choice.optional === true && selected.length === 0) return { ok: true };
  const effective = effectiveSpellcasting(
    args.sheet,
    args.classRecord,
    resolver,
  );
  if (!effective.ok) return { ok: false, reason: effective.reason };
  const sc = effective.spellcasting;

  const keys: string[] = [];
  for (const value of selected) {
    const key = normalizeSpell(resolver, value);
    if (key === undefined) {
      return {
        ok: false,
        reason: `'${value}' is not a spell in the rules pack`,
      };
    }
    keys.push(key);
  }
  const expected = choice.choose ?? 1;
  if (ref.mode === 'prepare') {
    if (keys.length < 1 || keys.length > expected) {
      return {
        ok: false,
        reason: `expected 1 to ${expected} prepared spell(s), received ${keys.length}`,
      };
    }
  } else if (keys.length !== expected) {
    return {
      ok: false,
      reason: `expected exactly ${expected} selection(s), received ${keys.length}`,
    };
  }
  if (new Set(keys).size !== keys.length) {
    return { ok: false, reason: 'selections must be distinct' };
  }
  const legal = new Set(choice.from ?? []);
  const picks = ref.mode === 'replace' ? keys.slice(1) : keys;
  for (const key of picks) {
    if (!legal.has(key)) {
      return {
        ok: false,
        reason: `'${key}' is not a legal choice (already held, wrong list, or not a level you can cast at level ${args.sheet.level + 1})`,
      };
    }
  }
  let oldRef: string | undefined;
  if (ref.mode === 'replace') {
    oldRef = keys[0] as string;
    if (!(ref.heldRefs ?? []).includes(oldRef)) {
      return {
        ok: false,
        reason: `'${oldRef}' is not a known spell that can be replaced`,
      };
    }
  }
  // Sibling distinctness: one spell cannot be learned twice by two descriptors.
  if (ref.mode !== 'prepare') {
    for (const other of args.requiredChoices) {
      if (
        other.id === choice.id ||
        other.status !== 'supported' ||
        other.spellChoice === undefined ||
        other.spellChoice.mode === 'prepare'
      ) {
        continue;
      }
      const otherKeys = (args.selections[other.id] ?? []).flatMap((value) => {
        const key = normalizeSpell(resolver, value);
        return key === undefined ? [] : [key];
      });
      const otherPicks =
        other.spellChoice.mode === 'replace' ? otherKeys.slice(1) : otherKeys;
      // Ownership is per destination: a ritualBook inscription and an ordinary
      // known/spellbook pick of the same spell are independent acquisitions.
      if (isRitualDestination(other.spellChoice) !== isRitualDestination(ref)) {
        continue;
      }
      const shared = picks.find((key) => otherPicks.includes(key));
      if (shared !== undefined) {
        return {
          ok: false,
          reason: `'${shared}' is also picked by ${other.id}; a spell can be learned only once`,
        };
      }
    }
  }

  const additions: SpellPlacement[] = [];
  const removals: SpellPlacement[] = [];
  if (ref.mode === 'replace') {
    removals.push({ bucket: 'known', spellRef: oldRef as string });
    additions.push({ bucket: 'known', spellRef: picks[0] as string });
  } else if (ref.mode === 'prepare') {
    const previous = sc?.prepared ?? [];
    for (const old of previous) {
      if (!keys.includes(old))
        removals.push({ bucket: 'prepared', spellRef: old });
    }
    for (const key of keys) {
      if (!previous.includes(key)) {
        additions.push({ bucket: 'prepared', spellRef: key });
      }
    }
  } else {
    for (const key of picks) {
      const level = resolver.resolveSpell(key);
      const spellLevel = level.ok ? level.record.level : 0;
      if (ref.bucket === 'known') {
        additions.push({
          bucket: spellLevel === 0 ? 'cantrips' : 'known',
          spellRef: key,
        });
      } else if (ref.bucket === 'mysticArcanum') {
        additions.push({
          bucket: 'mysticArcanum',
          spellRef: key,
          level: ref.arcanumLevel,
        });
      } else if (ref.bucket === 'designations') {
        additions.push({
          bucket: 'designations',
          spellRef: key,
          level: spellLevel,
          designationKind: ref.designationKind,
        });
      } else {
        additions.push({ bucket: ref.bucket, spellRef: key });
      }
    }
  }
  return {
    ok: true,
    applied: {
      id: choice.id,
      kind: 'spell-selection',
      value: keys.join(', '),
      label: choice.label,
      featureRefs: [],
      spellChoice: { additions, removals },
    },
  };
}

function isRitualDestination(ref: LevelUpSpellChoiceRef): boolean {
  return ref.mode === 'learn' && ref.bucket === 'ritualBook';
}

/** Spell data the guided flow can display for an option id. */
export function spellOptionLabel(option: LevelUpChoiceOption): string {
  return option.level === undefined
    ? option.name
    : `${option.name} (${option.level === 0 ? 'cantrip' : `level ${option.level}`})`;
}
