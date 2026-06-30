/**
 * Structured class progression + cross-reference enrichment for the D&D 5e SRD
 * 5.1 importer (eshyra-4a7.6).
 *
 * PR1 emitted every class progression table as a reviewed `table` record. This
 * module turns those same parsed rows into the queryable structures the
 * DM/runtime needs for level advancement, and wires the class/subclass/feature
 * cross-references:
 *
 *   - `class.data.progression`: one entry per level with `proficiencyBonus`,
 *     parsed `features` (linked to the class's `feature` records by name, with
 *     repeated-use parentheticals preserved as `detail`), class `resources`
 *     (Rages, Sneak Attack, Ki Points, Sorcery Points, …), and `spellcasting`
 *     (cantrips/spells known, Pact Magic columns, and the per-level spell-slot
 *     map). Derived from the parsed `TableExtraction` rows — NOT re-parsed from
 *     emitted JSON.
 *   - `class.data.progressionTableRef` + `class.data.features`.
 *   - `subclass.data.spellTableRefs` for the four subclasses with spell tables.
 *   - `feature.data.tableRefs` for Destroy Undead / Beast Shapes, trimming the
 *     flattened table rows out of those two feature descriptions while keeping
 *     the prose that introduces the table.
 *
 * Feature bodies stay the canonical home for feature prose; progression rows
 * only reference feature keys, never duplicate descriptions.
 */

import type { RulesRecord } from '../../../src/rules/types.js';
import {
  classSpellcastingCreationFact,
  classStartingEquipmentCreationFact,
} from './creationFacts.js';
import type { TableExtraction } from './types.js';

/** Class-resource columns surfaced under `progression[].resources`. */
const RESOURCE_COLUMNS: ReadonlySet<string> = new Set([
  'Rages',
  'Rage Damage',
  'Sneak Attack',
  'Martial Arts',
  'Ki Points',
  'Unarmored Movement',
  'Sorcery Points',
]);

/** Named spellcasting columns surfaced directly under `spellcasting`. */
const SPELL_NAMED_COLUMNS: ReadonlySet<string> = new Set([
  'Cantrips Known',
  'Spells Known',
  'Spell Slots',
  'Slot Level',
  'Invocations Known',
]);

/** Per-spell-level slot columns, nested under `spellcasting.slots`. */
const SLOT_COLUMNS: ReadonlyMap<string, number> = new Map([
  ['1st', 1],
  ['2nd', 2],
  ['3rd', 3],
  ['4th', 4],
  ['5th', 5],
  ['6th', 6],
  ['7th', 7],
  ['8th', 8],
  ['9th', 9],
]);

type Scalar = string | number | null;

/**
 * Typed per-level advancement entry (eshyra-o9bd.2). A discriminated union so a
 * level-up engine never has to infer from display names: every progression row
 * is fully classified at generation time, source-backed and fail-closed (an
 * unclassifiable marker throws rather than emitting a raw label).
 */
type AdvancementEntry =
  | {
      readonly kind: 'featureGrant';
      readonly ref: string;
      readonly name: string;
      readonly detail?: string;
    }
  | {
      readonly kind: 'subclassFeatureSlot';
      readonly slotName: string;
      readonly subclassLevel: number;
    }
  | {
      readonly kind: 'featureImprovement';
      readonly targetRefs: readonly string[];
      readonly label: string;
    }
  | {
      readonly kind: 'resourceProgression';
      readonly resource: string;
      readonly value: number | string;
    }
  | {
      readonly kind: 'spellcastingProgression';
      readonly cantripsKnown?: number;
      readonly spellsKnown?: number;
      readonly slots?: Readonly<Record<string, number>>;
      readonly pactSlots?: { readonly count: number; readonly level: number };
      readonly invocationsKnown?: number;
    };

interface ProgressionRow {
  readonly level: number;
  readonly proficiencyBonus: string;
  readonly advancement: readonly AdvancementEntry[];
}

/**
 * Source-backed classification of the frozen progression rows that carry no
 * deterministic feature ref, from docs/design/srd-level-up-row-classification.md
 * (eshyra-fxrs / PR #336). Improvement markers map to the base feature(s) they
 * improve; aliases map to an existing feature record whose label differs.
 * Subclass-feature-slot rows are detected structurally (an unresolved "… feature"
 * marker) and need no map. Any other unresolved marker is a fail-closed error.
 */
const FEATURE_IMPROVEMENTS: ReadonlyMap<string, readonly string[]> = new Map([
  ['divine intervention improvement', ['feature:cleric:divine-intervention']],
  ['wild shape improvement', ['feature:druid:wild-shape']],
  ['unarmored movement improvement', ['feature:monk:unarmored-movement']],
  [
    'aura improvements',
    ['feature:paladin:aura-of-protection', 'feature:paladin:aura-of-courage'],
  ],
  [
    'favored enemy and natural explorer improvements',
    ['feature:ranger:favored-enemy', 'feature:ranger:natural-explorer'],
  ],
  ['natural explorer improvement', ['feature:ranger:natural-explorer']],
  ['favored enemy improvement', ['feature:ranger:favored-enemy']],
]);

/**
 * Stable label mismatches: a row label that names an existing feature record
 * whose normalized name does not match. "Signature Spell" → the plural record;
 * "Thieves Cant" → the apostrophe'd record split out by the folded eshyra-o9bd.3.
 */
const FEATURE_ALIASES: ReadonlyMap<string, string> = new Map([
  ['signature spell', 'feature:wizard:signature-spells'],
  ['thieves cant', 'feature:rogue:thieves-cant'],
]);

function camelCase(label: string): string {
  const words = label.trim().split(/\s+/);
  return words
    .map((w, i) =>
      i === 0
        ? w.toLowerCase()
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join('');
}

/** "1st" -> 1, "20th" -> 20. */
function levelNumber(ordinal: string): number {
  return Number.parseInt(ordinal, 10);
}

/**
 * Normalize a source cell to a queryable scalar: blank -> null (not
 * applicable), a pure integer -> number, everything else (dice, "1/2",
 * "+10 ft.", "1st", "Unlimited", "+2") -> the verbatim string.
 */
function normalizeCell(cell: string): Scalar {
  const text = cell.trim();
  if (text.length === 0) return null;
  if (/^\d+$/.test(text)) return Number.parseInt(text, 10);
  return text;
}

function normalizeName(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Split a Features cell into entries on top-level commas (a parenthetical like
 * "(two uses)" or "(CR 1/2)" never splits), then lift the trailing
 * parenthetical into `detail` and resolve `ref` against the class's feature
 * records by normalized name.
 */
function splitTopLevelCommas(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/**
 * Classify a Features cell into typed advancement entries. Each comma-separated
 * marker becomes a `featureGrant` (ref resolved by name or alias),
 * `featureImprovement` (mapped base feature refs), or `subclassFeatureSlot` (an
 * unresolved "… feature" marker). An unresolved marker that fits none of these
 * is a fail-closed error — the importer refuses to emit a raw, untyped label.
 */
function parseFeatureAdvancement(
  cell: string,
  level: number,
  classKey: string,
  featureKeyByName: ReadonlyMap<string, string>,
): AdvancementEntry[] {
  const text = cell.trim();
  if (text.length === 0) return [];
  const entries: AdvancementEntry[] = [];
  for (const raw of splitTopLevelCommas(text)) {
    const segment = raw.trim();
    if (segment.length === 0) continue;
    const paren = /^(.*\S)\s*\(([^()]+)\)$/.exec(segment);
    const name = (paren ? paren[1] : segment).trim();
    const detail = paren ? paren[2].trim() : undefined;
    const normalized = normalizeName(name);

    const ref =
      featureKeyByName.get(normalized) ?? FEATURE_ALIASES.get(normalized);
    if (ref !== undefined) {
      entries.push({
        kind: 'featureGrant',
        ref,
        name,
        ...(detail !== undefined ? { detail } : {}),
      });
      continue;
    }

    const improvementRefs = FEATURE_IMPROVEMENTS.get(normalized);
    if (improvementRefs !== undefined) {
      entries.push({
        kind: 'featureImprovement',
        targetRefs: [...improvementRefs],
        label: name,
      });
      continue;
    }

    if (/\bfeature$/i.test(name)) {
      entries.push({
        kind: 'subclassFeatureSlot',
        slotName: name,
        subclassLevel: level,
      });
      continue;
    }

    throw new Error(
      `Unclassified class progression marker "${name}" at ${classKey} level ${level}. ` +
        'Add a feature ref, alias, or improvement mapping (see ' +
        'docs/design/srd-typed-class-progression.md), or confirm it is a subclass slot.',
    );
  }
  return entries;
}

/** Coerce a progression cell to an integer, or throw if it is non-numeric. */
function requireInt(value: Scalar, column: string, classKey: string): number {
  if (typeof value === 'number') return value;
  throw new Error(
    `Expected an integer in column "${column}" for ${classKey}, got ${JSON.stringify(value)}.`,
  );
}

/** "1st" -> 1 for the Warlock pact "Slot Level" column. */
function parseSlotLevel(value: Scalar): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const match = /^(\d+)/.exec(value.trim());
    if (match !== null) return Number.parseInt(match[1], 10);
  }
  return undefined;
}

/**
 * Build a `spellcastingProgression` entry from a row's spellcasting/slot
 * columns, or `undefined` when the row has no usable spellcasting data (so a
 * non-caster level, or a caster's pre-spellcasting levels like Ranger 1, emits
 * no entry rather than a `null` placeholder). Non-applicable (blank) cells are
 * omitted, never emitted as null.
 */
function buildSpellcastingEntry(
  named: Readonly<Record<string, Scalar>>,
  slots: Readonly<Record<string, number>>,
  classKey: string,
): Extract<AdvancementEntry, { kind: 'spellcastingProgression' }> | undefined {
  const cantripsKnown = named.cantripsKnown;
  const spellsKnown = named.spellsKnown;
  const pactCount = named.spellSlots;
  const pactLevel = parseSlotLevel(named.slotLevel ?? null);
  const invocations = named.invocationsKnown;

  const entry: {
    kind: 'spellcastingProgression';
    cantripsKnown?: number;
    spellsKnown?: number;
    slots?: Record<string, number>;
    pactSlots?: { count: number; level: number };
    invocationsKnown?: number;
  } = { kind: 'spellcastingProgression' };

  if (cantripsKnown !== null && cantripsKnown !== undefined) {
    entry.cantripsKnown = requireInt(cantripsKnown, 'Cantrips Known', classKey);
  }
  if (spellsKnown !== null && spellsKnown !== undefined) {
    entry.spellsKnown = requireInt(spellsKnown, 'Spells Known', classKey);
  }
  if (Object.keys(slots).length > 0) {
    entry.slots = slots;
  }
  if (
    pactCount !== null &&
    pactCount !== undefined &&
    pactLevel !== undefined
  ) {
    entry.pactSlots = {
      count: requireInt(pactCount, 'Spell Slots', classKey),
      level: pactLevel,
    };
  }
  if (invocations !== null && invocations !== undefined) {
    entry.invocationsKnown = requireInt(
      invocations,
      'Invocations Known',
      classKey,
    );
  }

  const hasData =
    entry.cantripsKnown !== undefined ||
    entry.spellsKnown !== undefined ||
    entry.slots !== undefined ||
    entry.pactSlots !== undefined ||
    entry.invocationsKnown !== undefined;
  return hasData ? entry : undefined;
}

/**
 * Map one class progression `TableExtraction` to typed `progression` rows. Each
 * row is `{ level, proficiencyBonus, advancement[] }`, where `advancement` is a
 * discriminated union of feature grants, subclass-feature slots, feature
 * improvements, resource progressions, and a spellcasting progression — in a
 * stable order (features, then resources in column order, then spellcasting).
 */
export function deriveClassProgression(
  table: TableExtraction,
  classKey: string,
  featureKeyByName: ReadonlyMap<string, string>,
): ProgressionRow[] {
  const cols = table.columns;
  const idx = (name: string) => cols.indexOf(name);
  const levelIdx = idx('Level');
  const bonusIdx = idx('Proficiency Bonus');
  const featuresIdx = idx('Features');
  return table.rows.map((row): ProgressionRow => {
    const cells = row.map((c) => String(c));
    const level = levelNumber(cells[levelIdx] ?? '');
    const resourceEntries: AdvancementEntry[] = [];
    const named: Record<string, Scalar> = {};
    const slots: Record<string, number> = {};
    cols.forEach((col, i) => {
      if (i === levelIdx || i === bonusIdx || i === featuresIdx) return;
      const value = normalizeCell(cells[i] ?? '');
      if (RESOURCE_COLUMNS.has(col)) {
        if (value !== null) {
          resourceEntries.push({
            kind: 'resourceProgression',
            resource: camelCase(col),
            value,
          });
        }
      } else if (SPELL_NAMED_COLUMNS.has(col)) {
        named[camelCase(col)] = value;
      } else if (SLOT_COLUMNS.has(col)) {
        if (typeof value === 'number') {
          slots[String(SLOT_COLUMNS.get(col))] = value;
        }
      }
    });

    const featureEntries =
      featuresIdx >= 0
        ? parseFeatureAdvancement(
            cells[featuresIdx] ?? '',
            level,
            classKey,
            featureKeyByName,
          )
        : [];
    const spellcasting = buildSpellcastingEntry(named, slots, classKey);

    return {
      level,
      proficiencyBonus: cells[bonusIdx] ?? '',
      advancement: [
        ...featureEntries,
        ...resourceEntries,
        ...(spellcasting !== undefined ? [spellcasting] : []),
      ],
    };
  });
}

/** class:<slug> -> table:the-<slug> progression-table key. */
function progressionTableKeyForClass(classKey: string): string {
  const slug = classKey.slice('class:'.length);
  return `table:the-${slug}`;
}

/**
 * Reviewed map of subclasses to the `table` records that carry their
 * spell/expanded-spell lists (eshyra-4a7.6). The Circle of the Land subclass
 * owns all seven terrain tables.
 */
const SUBCLASS_SPELL_TABLE_REFS: ReadonlyMap<string, readonly string[]> =
  new Map([
    ['subclass:life-domain', ['table:life-domain-spells']],
    ['subclass:oath-of-devotion', ['table:oath-of-devotion-spells']],
    ['subclass:the-fiend', ['table:fiend-expanded-spells']],
    [
      'subclass:circle-of-the-land',
      [
        'table:circle-of-the-land-arctic',
        'table:circle-of-the-land-coast',
        'table:circle-of-the-land-desert',
        'table:circle-of-the-land-forest',
        'table:circle-of-the-land-grassland',
        'table:circle-of-the-land-mountain',
        'table:circle-of-the-land-swamp',
      ],
    ],
  ]);

/**
 * Reviewed map of features to the `table` records they own, plus the exact
 * embedded-table span to trim from each feature's description (caption +
 * header + rows), keyed by start marker and an optional end marker. The intro
 * prose that introduces the table is preserved.
 */
const FEATURE_TABLE_REFS: ReadonlyMap<
  string,
  {
    readonly tableRefs: readonly string[];
    readonly trimStart: string;
    readonly trimEnd?: string;
  }
> = new Map([
  [
    'feature:cleric:destroy-undead',
    {
      tableRefs: ['table:destroy-undead'],
      // The flattened table runs from its column header to the end of the body.
      trimStart: 'Cleric Level Destroys Undead of CR',
    },
  ],
  [
    'feature:druid:wild-shape',
    {
      tableRefs: ['table:beast-shapes'],
      // The flattened table is embedded mid-body; keep the prose on both sides.
      trimStart: 'Beast Shapes Max.',
      trimEnd: 'Giant eagle',
    },
  ],
]);

/** Remove an embedded table span from a description, collapsing the seam. */
function trimEmbeddedTable(
  description: string,
  trimStart: string,
  trimEnd?: string,
): string {
  const startIdx = description.indexOf(trimStart);
  if (startIdx < 0) return description; // fail-safe: leave prose untouched
  const endIdx =
    trimEnd === undefined
      ? description.length
      : (() => {
          const found = description.indexOf(trimEnd, startIdx);
          return found < 0 ? -1 : found + trimEnd.length;
        })();
  if (endIdx < 0) return description;
  const joined = `${description.slice(0, startIdx)}${description.slice(endIdx)}`;
  return joined
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,])/g, '$1')
    .trim();
}

function asObj(data: unknown): Record<string, unknown> {
  return (data ?? {}) as Record<string, unknown>;
}

function withData(
  record: RulesRecord,
  extra: Record<string, unknown>,
): RulesRecord {
  return { ...record, data: { ...asObj(record.data), ...extra } };
}

function descriptionOf(record: RulesRecord): string {
  return String(asObj(record.data).description ?? '');
}

function prefixBeforeMarker(
  key: string,
  description: string,
  marker: string,
): string {
  const idx = description.indexOf(marker);
  if (idx < 0) {
    throw new Error(
      `Expected ${key} description to contain "${marker}" while canonicalizing spellcasting feature prose.`,
    );
  }
  return description.slice(0, idx).trim();
}

function appendLabeledSection(
  description: string,
  label: string,
  section: string,
): string {
  return `${description.trim()} ${label} ${section.trim()}`.trim();
}

interface SpellcastingSectionMove {
  readonly ownerKey: string;
  readonly sectionKey: string;
  readonly sectionLabel: string;
  readonly trimSectionAt?: string;
}

const SPELLCASTING_SECTION_MOVES: readonly SpellcastingSectionMove[] = [
  {
    ownerKey: 'feature:cleric:spellcasting',
    sectionKey: 'feature:cleric:cantrips',
    sectionLabel: 'Cantrips',
    trimSectionAt: 'Preparing and Casting Spells',
  },
  {
    ownerKey: 'feature:druid:spellcasting',
    sectionKey: 'feature:druid:cantrips',
    sectionLabel: 'Cantrips',
    trimSectionAt: 'Preparing and Casting Spells',
  },
  {
    ownerKey: 'feature:sorcerer:spellcasting',
    sectionKey: 'feature:sorcerer:cantrips',
    sectionLabel: 'Cantrips',
    trimSectionAt: 'Spell Slots',
  },
  {
    ownerKey: 'feature:wizard:spellcasting',
    sectionKey: 'feature:wizard:cantrips',
    sectionLabel: 'Cantrips',
  },
  {
    ownerKey: 'feature:wizard:spellcasting',
    sectionKey: 'feature:wizard:spellbook',
    sectionLabel: 'Spellbook',
    trimSectionAt: 'Preparing and Casting Spells',
  },
];

/**
 * Canonicalize class spellcasting prose ownership (eshyra-o9bd.4). The feature
 * parser emits first-level spellcasting subsections as separate feature records
 * when a class table grants "Cantrips" or "Spellbook" separately. For a
 * playable model, `feature:<class>:spellcasting` is the canonical owner of the
 * complete spellcasting mechanics; subordinate records keep only their own
 * subsection text.
 */
function canonicalizeSpellcastingFeatureDescriptions(
  featureRecords: readonly RulesRecord[],
): RulesRecord[] {
  const byKey = new Map(featureRecords.map((record) => [record.key, record]));
  const extraByKey = new Map<string, Record<string, unknown>>();

  for (const move of SPELLCASTING_SECTION_MOVES) {
    const owner = byKey.get(move.ownerKey);
    const section = byKey.get(move.sectionKey);
    if (owner === undefined || section === undefined) {
      continue;
    }

    const sectionDescription = descriptionOf(section);
    const ownerDescription = String(
      extraByKey.get(move.ownerKey)?.description ?? descriptionOf(owner),
    );
    extraByKey.set(move.ownerKey, {
      description: appendLabeledSection(
        ownerDescription,
        move.sectionLabel,
        sectionDescription,
      ),
    });

    if (move.trimSectionAt !== undefined) {
      extraByKey.set(move.sectionKey, {
        description: prefixBeforeMarker(
          move.sectionKey,
          sectionDescription,
          move.trimSectionAt,
        ),
      });
    }
  }

  return featureRecords.map((record) => {
    const extra = extraByKey.get(record.key);
    return extra === undefined ? record : withData(record, extra);
  });
}

const SNEAK_ATTACK_KEY = 'feature:rogue:sneak-attack';
const THIEVES_CANT_KEY = 'feature:rogue:thieves-cant';
const THIEVES_CANT_NAME = 'Thieves’ Cant';

/**
 * Split Rogue's Thieves' Cant into its own level-1 feature (eshyra-o9bd.3, folded
 * into eshyra-o9bd.2). The SRD feature splitter swallows the "Thieves' Cant"
 * heading into `feature:rogue:sneak-attack`; this lifts that prose into a
 * standalone `feature:rogue:thieves-cant` record so Rogue's level-1 progression
 * can grant both as feature refs. Fail-closed: throws if the embedded heading is
 * not found, rather than silently leaving the progression's Thieves' Cant ref
 * dangling. Returns a new list; inputs are not mutated.
 */
function splitRogueThievesCant(
  featureRecords: readonly RulesRecord[],
): RulesRecord[] {
  const result: RulesRecord[] = [];
  let foundSneakAttack = false;
  let split = false;
  for (const feature of featureRecords) {
    if (feature.key !== SNEAK_ATTACK_KEY) {
      result.push(feature);
      continue;
    }
    foundSneakAttack = true;
    const description = String(asObj(feature.data).description ?? '');
    const markerIdx = description.indexOf(THIEVES_CANT_NAME);
    if (markerIdx < 0) {
      result.push(feature);
      continue;
    }
    const sneakDescription = description
      .slice(0, markerIdx)
      .replace(/\s+([.,])/g, '$1')
      .trim();
    const cantDescription = description
      .slice(markerIdx + THIEVES_CANT_NAME.length)
      .trim();
    result.push(withData(feature, { description: sneakDescription }));
    result.push({
      ...feature,
      key: THIEVES_CANT_KEY,
      name: THIEVES_CANT_NAME,
      data: { source: 'class:rogue', level: 1, description: cantDescription },
    });
    split = true;
  }
  // Fail-closed only when Sneak Attack is present but the embedded heading is
  // gone (the source changed) — a partial fixture without Rogue's Sneak Attack
  // simply has nothing to split.
  if (foundSneakAttack && !split) {
    throw new Error(
      `Expected ${SNEAK_ATTACK_KEY} to carry an embedded "${THIEVES_CANT_NAME}" ` +
        'heading to split into its own feature (eshyra-o9bd.2/.3).',
    );
  }
  return result;
}

/**
 * Enrich the class-chapter records (eshyra-4a7.6): add structured progression +
 * table/feature refs to classes, spell-table refs to subclasses, and table
 * refs (with description trimming) to the two feature-owned class tables.
 * Returns new record arrays; inputs are not mutated.
 */
export function enrichClassChapterRecords(input: {
  readonly classRecords: readonly RulesRecord[];
  readonly subclassRecords: readonly RulesRecord[];
  readonly featureRecords: readonly RulesRecord[];
  readonly tables: readonly TableExtraction[];
}): {
  readonly classRecords: RulesRecord[];
  readonly subclassRecords: RulesRecord[];
  readonly featureRecords: RulesRecord[];
} {
  const tableByName = new Map(input.tables.map((t) => [t.name, t]));

  // Split Rogue's Thieves' Cant into its own feature first, so the expanded
  // feature list flows through name-indexing, the rogue class's data.features,
  // and the FEATURE_TABLE_REFS pass below.
  const baseFeatureRecords = canonicalizeSpellcastingFeatureDescriptions(
    splitRogueThievesCant(input.featureRecords),
  );

  // Per-class: feature keys (data.features) and a normalized-name -> key map for
  // progression ref resolution. Subclass features are grouped separately so the
  // subclass feature list can be filled too.
  const classFeatureKeys = new Map<string, string[]>();
  const classFeatureKeyByName = new Map<string, Map<string, string>>();
  const subclassFeatureKeys = new Map<string, string[]>();
  const pushTo = <V>(map: Map<string, V[]>, key: string, value: V): void => {
    const list = map.get(key);
    if (list === undefined) map.set(key, [value]);
    else list.push(value);
  };
  for (const feature of baseFeatureRecords) {
    const source = String(asObj(feature.data).source ?? '');
    if (source.startsWith('class:')) {
      pushTo(classFeatureKeys, source, feature.key);
      let byName = classFeatureKeyByName.get(source);
      if (byName === undefined) {
        byName = new Map();
        classFeatureKeyByName.set(source, byName);
      }
      byName.set(normalizeName(feature.name), feature.key);
    } else if (source.startsWith('subclass:')) {
      pushTo(subclassFeatureKeys, source, feature.key);
    }
  }

  const classRecords = input.classRecords.map((cls) => {
    const tableKey = progressionTableKeyForClass(cls.key);
    const tableName = `The ${cls.name}`;
    const table = tableByName.get(tableName);
    const spellcasting = classSpellcastingCreationFact(cls.key);
    const startingEquipment = classStartingEquipmentCreationFact(cls.key);
    const features = (classFeatureKeys.get(cls.key) ?? [])
      .slice()
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const byName = classFeatureKeyByName.get(cls.key) ?? new Map();
    const extra: Record<string, unknown> = {};
    if (table !== undefined) {
      extra.progressionTableRef = tableKey;
      extra.progression = deriveClassProgression(table, cls.key, byName);
    }
    if (features.length > 0) extra.features = features;
    if (spellcasting !== undefined) {
      extra.spellcastingAbility = spellcasting.ability;
      extra.spellPreparation = {
        kind: spellcasting.preparation,
        ...(spellcasting.spellbookStartingSpells !== undefined
          ? { spellbookStartingSpells: spellcasting.spellbookStartingSpells }
          : {}),
        ...(spellcasting.preparationFormula !== undefined
          ? { preparationFormula: spellcasting.preparationFormula }
          : {}),
        sourceText: spellcasting.sourceText,
      };
    }
    const existingStartingEquipment = asObj(cls.data).startingEquipment;
    if (
      startingEquipment !== undefined &&
      typeof asObj(existingStartingEquipment).text === 'string'
    ) {
      extra.startingEquipment = {
        ...asObj(existingStartingEquipment),
        entries: startingEquipment.entries,
      };
    }
    return Object.keys(extra).length > 0 ? withData(cls, extra) : cls;
  });

  const subclassRecords = input.subclassRecords.map((sub) => {
    const extra: Record<string, unknown> = {};
    const spellTableRefs = SUBCLASS_SPELL_TABLE_REFS.get(sub.key);
    if (spellTableRefs !== undefined)
      extra.spellTableRefs = [...spellTableRefs];
    const subFeatures = (subclassFeatureKeys.get(sub.key) ?? [])
      .slice()
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (subFeatures.length > 0 && asObj(sub.data).features === undefined) {
      extra.features = subFeatures;
    }
    return Object.keys(extra).length > 0 ? withData(sub, extra) : sub;
  });

  const featureRecords = baseFeatureRecords.map((feature) => {
    const spec = FEATURE_TABLE_REFS.get(feature.key);
    if (spec === undefined) return feature;
    const description = trimEmbeddedTable(
      String(asObj(feature.data).description ?? ''),
      spec.trimStart,
      spec.trimEnd,
    );
    return withData(feature, {
      description,
      tableRefs: [...spec.tableRefs],
    });
  });

  return { classRecords, subclassRecords, featureRecords };
}
