/**
 * SRD source-coverage evaluation (eshyra-4a7.1).
 *
 * Gate half of the source-coverage pair: takes the typography-derived
 * inventory (sourceInventory.ts) plus the emitted records and decides, for
 * every source item, exactly one accounting status:
 *
 *   - `record`     — an emitted top-level record covers it (name auto-match);
 *   - `child-of`   — represented as structured child data on a record;
 *   - `ignored`    — intentionally not a record, with a stable reason code;
 *   - `known-gap`  — SHOULD become a record/child but doesn't yet; carries the
 *                    bead id of the work that will close it. When that bead
 *                    lands, its rule is removed so the gate starts enforcing
 *                    the new coverage;
 *   - `unaccounted`— nothing claims it. `assertSourceCoverage` fails closed.
 *
 * Resolution order: explicit `record`-type rules first (a curated mapping is
 * more precise than the name heuristic, so it can disambiguate duplicate
 * source captions — e.g. the two "Draconic Ancestry" tables on p5 and p44
 * map to two different emitted records), then the name auto-match (an
 * emitted record claims its own heading without curation), then the caller's
 * remaining rules in order (first match wins), then the document-structure
 * default for chapter/section tiers, else unaccounted.
 *
 * Rules are PREDICATES with stable reason codes, not per-item lists: one rule
 * accounts for a whole class of source items (e.g. every spell-list header),
 * which keeps curation reviewable and means a NEW source item of an already
 * understood shape is auto-accounted while a genuinely novel one fails the
 * gate. Everything is pure and deterministic; entries are sorted in reading
 * order so reports diff cleanly.
 */

import type { SourceInventoryItem } from './sourceInventory.js';

export type CoverageStatus =
  | { readonly kind: 'record'; readonly key: string }
  | { readonly kind: 'child-of'; readonly key: string }
  | { readonly kind: 'ignored'; readonly reason: string }
  | { readonly kind: 'known-gap'; readonly beadId: string }
  | { readonly kind: 'unaccounted' };

/** Minimal record shape the evaluator needs (subset of RulesRecord). */
export interface CoverageRecordRef {
  readonly kind: string;
  readonly key: string;
  readonly name: string;
}

export interface SourceCoverageEntry {
  readonly item: SourceInventoryItem;
  readonly status: CoverageStatus;
}

export type CoverageRule =
  | {
      readonly type: 'ignore';
      readonly reason: string;
      readonly match: (item: SourceInventoryItem) => boolean;
    }
  | {
      readonly type: 'known-gap';
      readonly beadId: string;
      readonly match: (item: SourceInventoryItem) => boolean;
    }
  | {
      readonly type: 'child-of';
      readonly key: string;
      readonly match: (item: SourceInventoryItem) => boolean;
    }
  | {
      readonly type: 'record';
      readonly key: string;
      readonly match: (item: SourceInventoryItem) => boolean;
    };

export function ignoreRule(
  reason: string,
  match: (item: SourceInventoryItem) => boolean,
): CoverageRule {
  return { type: 'ignore', reason, match };
}

export function knownGapRule(
  beadId: string,
  match: (item: SourceInventoryItem) => boolean,
): CoverageRule {
  return { type: 'known-gap', beadId, match };
}

export function childOfRule(
  key: string,
  match: (item: SourceInventoryItem) => boolean,
): CoverageRule {
  return { type: 'child-of', key, match };
}

/**
 * Map a source item to a specific emitted record. Evaluated BEFORE the name
 * auto-match, so it serves two cases:
 *
 *   - an emitted record whose NAME differs from the source heading text, so
 *     the auto-match cannot claim it — e.g. the SRD's "Lightfoot" subrace
 *     heading vs the emitted `ancestry:lightfoot-halfling` record named
 *     "Lightfoot Halfling";
 *   - DUPLICATE source captions that must map to different records, where
 *     the auto-match would claim both for one record — e.g. the p5
 *     Dragonborn and p44 Sorcerer "Draconic Ancestry" tables.
 */
export function recordRule(
  key: string,
  match: (item: SourceInventoryItem) => boolean,
): CoverageRule {
  return { type: 'record', key, match };
}

/**
 * Normalize text for name matching: case-fold, straighten curly quotes,
 * collapse whitespace. Hyphen clusters are already collapsed at the
 * extraction boundary (extract.ts `normalizePdfHyphenCluster`).
 */
function normalizeName(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function statusForRule(rule: CoverageRule): CoverageStatus {
  switch (rule.type) {
    case 'ignore':
      return { kind: 'ignored', reason: rule.reason };
    case 'known-gap':
      return { kind: 'known-gap', beadId: rule.beadId };
    case 'child-of':
      return { kind: 'child-of', key: rule.key };
    case 'record':
      return { kind: 'record', key: rule.key };
  }
}

/**
 * Evaluate coverage for every inventory item. See the module header for the
 * resolution order. Entries come back sorted by (page, lineIndex).
 */
export function evaluateSourceCoverage(
  inventory: readonly SourceInventoryItem[],
  records: readonly CoverageRecordRef[],
  rules: readonly CoverageRule[],
): readonly SourceCoverageEntry[] {
  // name -> lexicographically-first record key. Duplicate names (e.g. the
  // per-class "Ability Score Improvement" features) resolve deterministically;
  // for accounting purposes any emitted record with the name covers the item.
  const keyByName = new Map<string, string>();
  for (const record of records) {
    const name = normalizeName(record.name);
    const existing = keyByName.get(name);
    if (existing === undefined || record.key < existing) {
      keyByName.set(name, record.key);
    }
  }

  const entries = inventory.map((item): SourceCoverageEntry => {
    // Explicit record mappings outrank the name auto-match: a curated rule
    // is more precise than the name heuristic, which cannot tell duplicate
    // source captions apart (the p5 vs p44 "Draconic Ancestry" tables) and
    // resolves duplicate record names lexicographically.
    for (const rule of rules) {
      if (rule.type === 'record' && rule.match(item)) {
        return { item, status: statusForRule(rule) };
      }
    }
    const matchedKey = keyByName.get(normalizeName(item.text));
    if (matchedKey !== undefined) {
      return { item, status: { kind: 'record', key: matchedKey } };
    }
    for (const rule of rules) {
      if (rule.type !== 'record' && rule.match(item)) {
        return { item, status: statusForRule(rule) };
      }
    }
    if (item.tier === 'chapter' || item.tier === 'section') {
      return {
        item,
        status: { kind: 'ignored', reason: 'document-structure' },
      };
    }
    return { item, status: { kind: 'unaccounted' } };
  });

  return entries.sort(
    (a, b) => a.item.page - b.item.page || a.item.lineIndex - b.item.lineIndex,
  );
}

export class SourceInventoryCoverageError extends Error {
  constructor(unaccounted: readonly SourceCoverageEntry[]) {
    const lines = unaccounted.map(({ item }) => {
      const tier = item.tier ?? 'table';
      const section =
        item.section === null ? '' : ` (section: ${item.section})`;
      return `  p${item.page}#${item.lineIndex} [${tier}/${item.structure}] "${item.text}"${section}`;
    });
    super(
      `SRD source inventory has ${unaccounted.length} unaccounted item(s) — every source structure must be emitted, mapped to child data, ignored with a reason, or tracked as a known gap:\n${lines.join('\n')}`,
    );
    this.name = 'SourceInventoryCoverageError';
  }
}

/** Throw when any entry is unaccounted; the import must fail closed. */
export function assertSourceCoverage(
  entries: readonly SourceCoverageEntry[],
): void {
  const unaccounted = entries.filter((e) => e.status.kind === 'unaccounted');
  if (unaccounted.length > 0) {
    throw new SourceInventoryCoverageError(unaccounted);
  }
}

/**
 * One-line status form used in the `source-coverage.json` artifact and the
 * sentinel regression tests: `record:<key>` | `child-of:<key>` |
 * `ignored:<reason>` | `known-gap:<beadId>` | `unaccounted`.
 */
export function formatCoverageStatus(status: CoverageStatus): string {
  switch (status.kind) {
    case 'record':
      return `record:${status.key}`;
    case 'child-of':
      return `child-of:${status.key}`;
    case 'ignored':
      return `ignored:${status.reason}`;
    case 'known-gap':
      return `known-gap:${status.beadId}`;
    case 'unaccounted':
      return 'unaccounted';
  }
}

/** JSON shape of one `source-coverage.json` entry. */
export interface SourceCoverageReportEntry {
  readonly page: number;
  readonly lineIndex: number;
  readonly tier: string | null;
  readonly structure: string;
  readonly text: string;
  readonly section: string | null;
  readonly status: string;
}

/**
 * A name that maps to multiple emitted record keys: the auto-match can only
 * resolve to the lexicographically-first key, so the rest are silently
 * shadowed. The reporter surfaces these so reviewers can decide whether each
 * collision needs an explicit `recordRule` disambiguation.
 */
export interface AmbiguousNameCollision {
  readonly normalizedName: string;
  readonly winnerKey: string;
  readonly shadowedKeys: readonly string[];
}

/**
 * Multiple source inventory items that share the same normalized text and all
 * auto-match to the same record key. The count shows how many source items are
 * collapsed into one auto-match result. Only groups with count > 1 are listed.
 */
export interface CollapsedSourceGroup {
  readonly text: string;
  readonly resolvedKey: string;
  readonly count: number;
}

/** JSON shape of the `source-coverage.json` artifact. */
export interface SourceCoverageReport {
  readonly summary: {
    readonly record: number;
    readonly childOf: number;
    readonly ignored: Readonly<Record<string, number>>;
    readonly knownGap: Readonly<Record<string, number>>;
    readonly unaccounted: number;
  };
  readonly ambiguous: {
    readonly shadowedRecords: readonly AmbiguousNameCollision[];
    readonly collapsedSourceItems: readonly CollapsedSourceGroup[];
  };
  readonly entries: readonly SourceCoverageReportEntry[];
}

/**
 * Build the reviewer-facing coverage report: a roll-up of statuses (per
 * ignore reason and per known-gap bead), an ambiguous-match diagnostic, and
 * every entry in reading order. Pure and deterministic — sub-summary keys are
 * sorted so the emitted JSON is byte-stable for identical input.
 *
 * The `ambiguous` section surfaces two classes of silent collisions in the
 * name auto-matcher:
 *
 *   - `shadowedRecords`: emitted records whose normalized name is shared with
 *     another record. The auto-match resolves to the lexicographically-first
 *     key; the rest are shadowed and can only be claimed by an explicit
 *     `recordRule`. Cross-kind name collisions (e.g. a class and a creature
 *     both named "Druid") appear here.
 *
 *   - `collapsedSourceItems`: groups of source inventory items that share the
 *     same normalized text and all auto-match to the same record key. Each
 *     group shows the count so reviewers can see how many source items are
 *     silently folded into one match (e.g. 12 per-class "Ability Score
 *     Improvement" headings all resolving to one feature key).
 */
export function buildSourceCoverageReport(
  entries: readonly SourceCoverageEntry[],
  records: readonly CoverageRecordRef[],
): SourceCoverageReport {
  let record = 0;
  let childOf = 0;
  let unaccounted = 0;
  const ignored = new Map<string, number>();
  const knownGap = new Map<string, number>();
  for (const { status } of entries) {
    switch (status.kind) {
      case 'record':
        record += 1;
        break;
      case 'child-of':
        childOf += 1;
        break;
      case 'ignored':
        ignored.set(status.reason, (ignored.get(status.reason) ?? 0) + 1);
        break;
      case 'known-gap':
        knownGap.set(status.beadId, (knownGap.get(status.beadId) ?? 0) + 1);
        break;
      case 'unaccounted':
        unaccounted += 1;
        break;
    }
  }
  const sortedCounts = (
    counts: ReadonlyMap<string, number>,
  ): Record<string, number> =>
    Object.fromEntries(
      [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );

  // ---- ambiguous: shadowed records ----
  // Collect all keys per normalized name, then report names with >1 key.
  const nameToKeys = new Map<string, string[]>();
  for (const rec of records) {
    const name = normalizeName(rec.name);
    const list = nameToKeys.get(name);
    if (list === undefined) {
      nameToKeys.set(name, [rec.key]);
    } else {
      list.push(rec.key);
    }
  }
  const shadowedRecords: AmbiguousNameCollision[] = [];
  for (const [normalizedName, keys] of [...nameToKeys.entries()].sort(
    ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
  )) {
    if (keys.length > 1) {
      const sortedKeys = [...keys].sort();
      shadowedRecords.push({
        normalizedName,
        winnerKey: sortedKeys[0],
        shadowedKeys: sortedKeys.slice(1),
      });
    }
  }

  // ---- ambiguous: collapsed source items ----
  // Rebuild keyByName (same logic as evaluateSourceCoverage) to identify
  // which record entries came from the name auto-match vs an explicit
  // recordRule (recordRule entries have a key that differs from what the
  // auto-match would have chosen for that text).
  const keyByName = new Map<string, string>();
  for (const rec of records) {
    const name = normalizeName(rec.name);
    const existing = keyByName.get(name);
    if (existing === undefined || rec.key < existing) {
      keyByName.set(name, rec.key);
    }
  }
  const autoMatchCounts = new Map<string, { text: string; count: number }>();
  for (const { item, status } of entries) {
    if (status.kind !== 'record') continue;
    const expectedKey = keyByName.get(normalizeName(item.text));
    if (expectedKey !== status.key) continue; // resolved by a recordRule
    const existing = autoMatchCounts.get(status.key);
    if (existing === undefined) {
      autoMatchCounts.set(status.key, { text: item.text, count: 1 });
    } else {
      existing.count += 1;
    }
  }
  const collapsedSourceItems: CollapsedSourceGroup[] = [
    ...autoMatchCounts.entries(),
  ]
    .filter(([, { count }]) => count > 1)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([resolvedKey, { text, count }]) => ({ text, resolvedKey, count }));

  return {
    summary: {
      record,
      childOf,
      ignored: sortedCounts(ignored),
      knownGap: sortedCounts(knownGap),
      unaccounted,
    },
    ambiguous: { shadowedRecords, collapsedSourceItems },
    entries: entries.map(({ item, status }) => ({
      page: item.page,
      lineIndex: item.lineIndex,
      tier: item.tier,
      structure: item.structure,
      text: item.text,
      section: item.section,
      status: formatCoverageStatus(status),
    })),
  };
}

// ---------------------------------------------------------------------------
// Curated coverage rules for the vendored SRD 5.1 PDF (eshyra-4a7.1.3).
//
// Resolution order matters: explicit `record`-type rules run FIRST (a curated
// mapping outranks the name heuristic, so duplicate source captions can map
// to distinct records), then the name auto-match (an emitted record claims
// its own heading without curation), then the remaining rules apply
// first-match-wins. Rules are predicates over understood CLASSES of source
// structure, not per-item allowlists, so a new item of an already-understood
// shape is auto-accounted while a genuinely novel structure stays
// unaccounted and fails the import.
//
// Honesty contract (docs/importer-fix-protocol.md): `ignoreRule` is reserved
// for genuine non-content (structural headers whose content is represented
// elsewhere, documented intentional exclusions); anything that SHOULD become
// a record or structured child data carries a `knownGapRule` naming the bead
// that will close it — when that bead lands, its rule is deleted so the gate
// starts enforcing the new coverage.
// ---------------------------------------------------------------------------

/** The 12 class names; each renders at chapter tier, so it IS the `section`. */
const CLASS_CHAPTER_SECTIONS: ReadonlySet<string> = new Set([
  'Barbarian',
  'Bard',
  'Cleric',
  'Druid',
  'Fighter',
  'Monk',
  'Paladin',
  'Ranger',
  'Rogue',
  'Sorcerer',
  'Warlock',
  'Wizard',
]);

// --- Class feature-option subheading sets (eshyra-4a7.6) -------------------
// The SRD prints these as bold leaf headings inside a parent feature's body;
// the feature parser keeps the text in the parent record, so each maps
// child-of its owning feature in the coverage rules below.

/** Fighting Style options (Fighter / Paladin / Ranger Fighting Style feature). */
const FIGHTING_STYLE_OPTIONS: ReadonlySet<string> = new Set([
  'Archery',
  'Defense',
  'Dueling',
  'Great Weapon Fighting',
  'Protection',
  'Two-Weapon Fighting',
]);

/** Sorcerer Metamagic options (feature:sorcerer:metamagic). */
const METAMAGIC_OPTIONS: ReadonlySet<string> = new Set([
  'Careful Spell',
  'Distant Spell',
  'Empowered Spell',
  'Extended Spell',
  'Heightened Spell',
  'Quickened Spell',
  'Subtle Spell',
  'Twinned Spell',
]);

/** Monk ki options (feature:monk:ki). */
const MONK_KI_OPTIONS: ReadonlySet<string> = new Set([
  'Flurry of Blows',
  'Patient Defense',
  'Step of the Wind',
]);

/** Warlock Pact Boon options (feature:warlock:pact-boon). */
const WARLOCK_PACT_OPTIONS: ReadonlySet<string> = new Set([
  'Pact of the Chain',
  'Pact of the Blade',
  'Pact of the Tome',
]);

/** Spellcasting-feature boilerplate subsections, shared across caster classes. */
const SPELLCASTING_BOILERPLATE: ReadonlySet<string> = new Set([
  'Preparing and Casting Spells',
  'Ritual Casting',
  'Spellcasting Focus',
  'Spells Known of 1st Level and Higher',
  'Learning Spells of 1st Level and Higher',
]);

/**
 * The emitted feature whose body actually carries each class's spellcasting
 * boilerplate subsections (Preparing and Casting Spells, Ritual Casting,
 * Spellcasting Focus, …). The owner is parser-determined and varies: classes
 * with a separate Cantrips feature fold the trailing boilerplate into it
 * (Cleric/Druid/Sorcerer), the Wizard folds it into Spellbook, the Warlock has
 * no Spellcasting feature so it rides in Pact Magic, and the rest keep it in
 * the Spellcasting feature. Verified against the emitted descriptions.
 */
const SPELLCASTING_BOILERPLATE_OWNER: ReadonlyMap<string, string> = new Map([
  ['Bard', 'feature:bard:spellcasting'],
  ['Cleric', 'feature:cleric:cantrips'],
  ['Druid', 'feature:druid:cantrips'],
  ['Paladin', 'feature:paladin:spellcasting'],
  ['Ranger', 'feature:ranger:spellcasting'],
  ['Sorcerer', 'feature:sorcerer:cantrips'],
  ['Warlock', 'feature:warlock:pact-magic'],
  ['Wizard', 'feature:wizard:spellbook'],
]);

/**
 * "<Race> Traits" subsection headings: the trait content is structured child
 * data on the matching ancestry record (`data.traits`).
 */
const RACE_TRAIT_HEADINGS: ReadonlyArray<readonly [string, string]> = [
  ['Dwarf Traits', 'ancestry:dwarf'],
  ['Elf Traits', 'ancestry:elf'],
  ['Halfling Traits', 'ancestry:halfling'],
  ['Human Traits', 'ancestry:human'],
  ['Dragonborn Traits', 'ancestry:dragonborn'],
  ['Gnome Traits', 'ancestry:gnome'],
  ['Half-Elf Traits', 'ancestry:half-elf'],
  ['Half-Orc Traits', 'ancestry:half-orc'],
  ['Tiefling Traits', 'ancestry:tiefling'],
];

/** Spell-list level headers inside the per-class spell lists (p105-113). */
const SPELL_LIST_LEVEL_HEADER =
  /^(?:Cantrips \(0 Level\)|[1-9](?:st|nd|rd|th) Level)$/;

/** Spell-list class headers ("Bard Spells" … "Wizard Spells", p105-113). */
const SPELL_LIST_CLASS_HEADER =
  /^(?:Bard|Cleric|Druid|Paladin|Ranger|Sorcerer|Warlock|Wizard) Spells$/;

/**
 * Equipment-chapter reference tables whose ROWS are emitted as `equipment`
 * records (with `cost`/`weight`/`capacity`/pack-contents child data), so the
 * table itself is intentionally not a `table` record.
 */
const EQUIPMENT_ROWS_AS_RECORDS_CAPTIONS: ReadonlySet<string> = new Set([
  'Armor',
  'Weapons',
  'Adventuring Gear',
  'Container Capacity',
  'Equipment Packs',
  'Tools',
  'Mounts and Other Animals',
  'Tack, Harness, and Drawn Vehicles',
  'Waterborne Vehicles',
]);

/**
 * The seven Circle of the Land terrain spell tables (p22): the SRD prints
 * bare terrain-word captions ("Arctic") while the emitted records carry
 * qualified names ("Circle of the Land (Arctic)"), so the name auto-match
 * cannot claim the captions (eshyra-4a7.3).
 */
const CIRCLE_OF_THE_LAND_TABLE_TERRAINS: ReadonlyArray<
  readonly [string, string]
> = [
  ['Arctic', 'table:circle-of-the-land-arctic'],
  ['Coast', 'table:circle-of-the-land-coast'],
  ['Desert', 'table:circle-of-the-land-desert'],
  ['Forest', 'table:circle-of-the-land-forest'],
  ['Grassland', 'table:circle-of-the-land-grassland'],
  ['Mountain', 'table:circle-of-the-land-mountain'],
  ['Swamp', 'table:circle-of-the-land-swamp'],
];

/**
 * Caption-less spell tables emitted from reviewed document-wide specs
 * (eshyra-o4j7). Printed captions auto-match their record names; these table
 * shapes need explicit header-to-record mappings.
 */
const SPELL_TABLE_INVENTORY_RECORDS: ReadonlyArray<
  readonly [page: number, text: string, key: string]
> = [
  [127, 'd10 Behavior', 'table:confusion-behavior'],
  [132, 'Material Duration', 'table:creation-material-duration'],
  [174, 'd100 Race', 'table:reincarnate-race'],
  [176, 'Knowledge Save Modifier', 'table:scrying-save-modifiers'],
  [186, 'Similar Off On', 'table:teleport-familiarity'],
];

/**
 * Magic-item tables emitted from reviewed document-wide specifications
 * (eshyra-4a7.3, eshyra-4a7.8). Each surfaces in the inventory as a table
 * structure whose text is either its printed caption or its column-header
 * line, located by the owning item heading recorded as `context`.
 */
const MAGIC_ITEM_TABLE_INVENTORY_RECORDS: ReadonlyArray<
  readonly [page: number, text: string, key: string]
> = [
  [208, 'Apparatus of the Crab Levers', 'table:apparatus-of-the-crab-levers'],
  [209, 'd10 Damage Type d10 Damage Type', 'table:armor-of-resistance'],
  [209, 'd100 Effect', 'table:bag-of-beans'],
  [210, 'Gray Bag of Tricks', 'table:gray-bag-of-tricks'],
  [211, 'Rust Bag of Tricks', 'table:rust-bag-of-tricks'],
  [211, 'Tan Bag of Tricks', 'table:tan-bag-of-tricks'],
  [211, 'Type Strength Rarity', 'table:belt-of-giant-strength'],
  [213, 'd20 Alignment', 'table:candle-of-invocation'],
  [213, 'd100 Size Capacity Flying Speed', 'table:carpet-of-flying'],
  [215, 'Cube of Force Faces', 'table:cube-of-force-faces'],
  [215, 'Spell or Item Charges Lost', 'table:cube-of-force-charges-lost'],
  [216, 'Playing Card Illusion', 'table:deck-of-illusions'],
  [217, 'Playing Card Card', 'table:deck-of-many-things'],
  [219, 'Dragon Resistance Dragon Resistance', 'table:dragon-scale-mail'],
  [220, 'd100 Effect', 'table:efreeti-bottle'],
  [220, 'Gem Summoned Elemental', 'table:elemental-gem'],
  [221, 'd100 Feather Token d100 Feather Token', 'table:feather-token'],
  [226, 'd100 Horn Berserkers Requirement', 'table:horn-of-valhalla'],
  [228, 'd100 Contents', 'table:iron-flask'],
  [229, 'd20 Golem Time Cost', 'table:manual-of-golems'],
  [231, 'd20 Bead of … Spell', 'table:necklace-of-prayer-beads'],
  [234, 'Type of Giant Strength Rarity', 'table:potion-of-giant-strength'],
  [234, 'Potions of Healing', 'table:potions-of-healing'],
  [235, 'd10 Damage Type d10 Damage Type', 'table:potion-of-resistance'],
  [237, 'd10 Damage Type Gem', 'table:ring-of-resistance'],
  [237, 'Spheres Lightning Damage', 'table:ring-of-shooting-stars'],
  [239, 'd100 Patch', 'table:robe-of-useful-items'],
  [242, 'Spell Scroll', 'table:spell-scroll'],
  [243, 'd100 Result', 'table:sphere-of-annihilation'],
  [244, 'Distance from Origin Damage', 'table:staff-of-power'],
  [245, 'Distance from Origin Damage', 'table:staff-of-the-magi'],
  [250, 'd100 Effect', 'table:wand-of-wonder'],
  [251, 'd100 Communication', 'table:sentient-magic-item-communication'],
  [251, 'd4 Senses', 'table:sentient-magic-item-senses'],
  [251, 'd100 Alignment d100 Alignment', 'table:sentient-magic-item-alignment'],
  [252, 'd10 Purpose', 'table:sentient-magic-item-special-purpose'],
];

const SENTIENT_MAGIC_ITEM_HEADINGS: ReadonlySet<string> = new Set([
  'Creating Sentient Magic Items', // p251-252 DM guidance after the A-Z items
  'Abilities',
  'Communication',
  'Special Purpose',
  'Conflict',
]);

/**
 * Coverage rules for the real SRD 5.1 import. Every rule carries a comment
 * naming the source structures it accounts for; the committed
 * `source-coverage.json` artifact shows the resulting per-item statuses.
 */
export const SRD_5_1_COVERAGE_RULES: readonly CoverageRule[] = [
  // Pre-chapter legal front matter: the p1 "Legal Information" heading and
  // the p3 erratum line, both before the first chapter heading so their
  // `section` is null. Chapter-tier titles also carry a null section by
  // construction and are excluded here — the document-structure default
  // accounts for them.
  ignoreRule('front-matter', (i) => i.section === null && i.tier !== 'chapter'),
  // The SRD prints the Lightfoot Halfling subrace heading as bare "Lightfoot";
  // the emitted record is named "Lightfoot Halfling" so auto-match misses it.
  recordRule(
    'ancestry:lightfoot-halfling',
    (i) => i.section === 'Races' && i.text === 'Lightfoot',
  ),
  // Races p3 trait-category guidance (eshyra-4a7.10.1). Explicit mappings are
  // required for Alignment / Size / Speed / Languages: name auto-match would
  // otherwise claim these source headings for unrelated rules in later
  // chapters instead of the parent-qualified racial-traits records.
  recordRule(
    'rule:racial-traits',
    (i) => i.section === 'Races' && i.text === 'Racial Traits',
  ),
  recordRule(
    'rule:ability-score-increase',
    (i) => i.section === 'Races' && i.text === 'Ability Score Increase',
  ),
  recordRule('rule:age', (i) => i.section === 'Races' && i.text === 'Age'),
  recordRule(
    'rule:racial-traits-alignment',
    (i) => i.section === 'Races' && i.text === 'Alignment',
  ),
  // The Monsters stat-block interpretation chapter has its own "Size"
  // subsection. Once the racial-traits Size record exists, generic name
  // auto-match would otherwise choose `rule:racial-traits-size` for both
  // source headings. Keep the p254 Monsters heading on its original rule.
  recordRule(
    'rule:size',
    (i) =>
      i.section === 'Monsters' &&
      i.structure === 'heading' &&
      i.text === 'Size',
  ),
  recordRule(
    'rule:racial-traits-size',
    (i) => i.section === 'Races' && i.text === 'Size',
  ),
  recordRule(
    'rule:racial-traits-speed',
    (i) => i.section === 'Races' && i.text === 'Speed',
  ),
  recordRule(
    'rule:racial-traits-languages',
    (i) => i.section === 'Races' && i.text === 'Languages',
  ),
  recordRule(
    'rule:subraces',
    (i) => i.section === 'Races' && i.text === 'Subraces',
  ),
  // The caption reads "Typical Difficulty Classes" in source; the emitted
  // table record is named "Difficulty Classes".
  recordRule(
    'table:difficulty-classes',
    (i) => i.text === 'Typical Difficulty Classes',
  ),
  // The Cleric's "Destroy Undead" table caption (p17) collides by name with
  // the `feature:cleric:destroy-undead` heading; both normalize to "destroy
  // undead", and the name auto-match would claim the table-caption item for
  // the lexicographically-first key (the feature). Map the table-caption item
  // explicitly to the emitted `table:destroy-undead` record (eshyra-4a7.6);
  // the feature HEADING item still auto-matches the feature record.
  recordRule(
    'table:destroy-undead',
    (i) =>
      i.section === 'Cleric' &&
      i.structure === 'table-caption' &&
      i.text === 'Destroy Undead',
  ),
  // The two same-caption "Draconic Ancestry" tables (eshyra-4a7.3): the name
  // auto-match cannot tell them apart and would claim both captions for one
  // record, so each chapter's caption maps explicitly to its own emitted
  // record (record rules outrank the auto-match — see the resolution order
  // above).
  recordRule(
    'table:draconic-ancestry',
    (i) =>
      i.section === 'Races' &&
      i.structure === 'table-caption' &&
      i.text === 'Draconic Ancestry',
  ),
  recordRule(
    'table:draconic-bloodline-draconic-ancestry',
    (i) =>
      i.section === 'Sorcerer' &&
      i.structure === 'table-caption' &&
      i.text === 'Draconic Ancestry',
  ),
  // Document-wide tables (eshyra-4a7.3) whose emitted record name differs
  // from the source text, so the name auto-match cannot claim them.
  ...CIRCLE_OF_THE_LAND_TABLE_TERRAINS.map(([terrain, key]) =>
    recordRule(
      key,
      (i) =>
        i.section === 'Druid' &&
        i.structure === 'table-caption' &&
        i.text === terrain,
    ),
  ),
  ...SPELL_TABLE_INVENTORY_RECORDS.map(([page, text, key]) =>
    recordRule(
      key,
      (i) => i.section === 'Spellcasting' && i.page === page && i.text === text,
    ),
  ),
  ...MAGIC_ITEM_TABLE_INVENTORY_RECORDS.map(([page, text, key]) =>
    recordRule(
      key,
      (i) => i.section === 'Magic Items' && i.page === page && i.text === text,
    ),
  ),
  // "<Race> Traits" subsection headings — traits are child data on the
  // ancestry records.
  ...RACE_TRAIT_HEADINGS.map(([heading, key]) =>
    childOfRule(key, (i) => i.section === 'Races' && i.text === heading),
  ),
  // Embedded stat blocks outside the monster chapters (Avatar of Death p218,
  // Giant Fly p222) are now emitted as `stat-block` records (eshyra-4a7.4), so
  // the name auto-match claims their `structure: 'stat-block'` inventory items —
  // no rule needed here. A NEW unmatched inline stat block (not emitted, not in
  // the reviewed map) would fail `parseStatBlocks` closed before coverage runs.
  // Creature variant sidebars (eshyra-70xr) are now emitted as `variants` child
  // data on the creature each one modifies: Diseased Giant Rats (p378) on the
  // Giant Rat, Insect Swarms (p391) on the Swarm of Insects.
  childOfRule(
    'creature:giant-rat',
    (i) => i.text === 'Variant: Diseased Giant Rats',
  ),
  childOfRule(
    'creature:swarm-of-insects',
    (i) => i.text === 'Variant: Insect Swarms',
  ),
  // Rules-chapter "Variant:" optional rules (Skills with Different Abilities
  // p78, Encumbrance p80) — documented intentional exclusion; see the
  // EXPECTED_SRD_5_1_RULE_KEYS baseline comment in index.ts.
  ignoreRule('variant-rule-excluded', (i) => /^Variant: /.test(i.text)),
  // --- Class chapters (eshyra-4a7.6) -------------------------------------
  // The broad class-chapter known-gap is gone; every remaining class-chapter
  // structure is now explicitly accounted. Progression-table captions ("The
  // Barbarian" … "The Wizard"), Beast Shapes, and Destroy Undead auto-match
  // their emitted `table` records (PR1). The spell-slot/resource column-header
  // FRAGMENTS of those tables are table internals, represented by the emitted
  // table record:
  ignoreRule(
    'class-progression-table-internal',
    (i) =>
      i.section !== null &&
      CLASS_CHAPTER_SECTIONS.has(i.section) &&
      i.structure === 'table-shape',
  ),
  // Feature-OPTION subheadings the SRD prints as bold leaves inside a parent
  // feature's body; parseFeatures keeps that text in the parent feature record,
  // so each maps child-of its owning feature. Fighting Styles (Fighter /
  // Paladin / Ranger), Sorcerer Metamagic, Monk ki options, and Warlock Pact
  // Boons:
  ...['Fighter', 'Paladin', 'Ranger'].map((section) =>
    childOfRule(
      `feature:${section.toLowerCase()}:fighting-style`,
      (i) =>
        i.section === section &&
        i.structure === 'heading' &&
        FIGHTING_STYLE_OPTIONS.has(i.text),
    ),
  ),
  childOfRule(
    'feature:sorcerer:metamagic',
    (i) => i.section === 'Sorcerer' && METAMAGIC_OPTIONS.has(i.text),
  ),
  childOfRule(
    'feature:monk:ki',
    (i) => i.section === 'Monk' && MONK_KI_OPTIONS.has(i.text),
  ),
  childOfRule(
    'feature:warlock:pact-boon',
    (i) => i.section === 'Warlock' && WARLOCK_PACT_OPTIONS.has(i.text),
  ),
  // The Eldritch Invocations (the p48–50 Warlock leaf headings) all live in the
  // feature:warlock:eldritch-invocations body. They are bounded by page (the
  // Pact Boon block ends on p47) with the two non-invocation headings inside
  // that page span excluded: "Pact of the Tome" (a Pact Boon, handled above)
  // and "Expanded Spell List" (the Fiend patron's, handled below).
  childOfRule(
    'feature:warlock:eldritch-invocations',
    (i) =>
      i.section === 'Warlock' &&
      i.tier === 'leaf' &&
      i.structure === 'heading' &&
      i.page >= 48 &&
      i.page <= 50 &&
      i.text !== 'Pact of the Tome' &&
      i.text !== 'Expanded Spell List',
  ),
  // Spellcasting boilerplate subsections (Preparing and Casting Spells, Ritual
  // Casting, Spellcasting Focus, Spells/Learning Spells Known of 1st Level and
  // Higher) ride in the per-class owning feature body (see the owner map).
  ...[...SPELLCASTING_BOILERPLATE_OWNER].map(([section, ownerKey]) =>
    childOfRule(
      ownerKey,
      (i) => i.section === section && SPELLCASTING_BOILERPLATE.has(i.text),
    ),
  ),
  // Sorcerer Font of Magic subsections; Cleric Divine Domain / Channel Divinity
  // subsections — each in the named feature's body.
  childOfRule(
    'feature:sorcerer:font-of-magic',
    (i) =>
      i.section === 'Sorcerer' &&
      (i.text === 'Sorcery Points' || i.text === 'Flexible Casting'),
  ),
  childOfRule(
    'feature:cleric:divine-domain',
    (i) => i.section === 'Cleric' && i.text === 'Domain Spells',
  ),
  childOfRule(
    'feature:cleric:channel-divinity',
    (i) => i.section === 'Cleric' && i.text === 'Channel Divinity: Turn Undead',
  ),
  // The generic "Oath Spells" subsection (Paladin p32) explains the oath-spell
  // mechanic and rides in the Sacred Oath feature body.
  childOfRule(
    'feature:paladin:sacred-oath',
    (i) => i.section === 'Paladin' && i.text === 'Oath Spells' && i.page === 32,
  ),
  // Subclass spell-table HEADINGS: the Oath of Devotion's own "Oath Spells"
  // (p33) and the Fiend patron's "Expanded Spell List" (p50) head spell tables
  // that ARE emitted as `table` records and linked from the subclass via
  // `data.spellTableRefs` (table:oath-of-devotion-spells /
  // table:fiend-expanded-spells), so the heading's content is represented.
  ignoreRule(
    'subclass-spell-table-heading',
    (i) =>
      (i.section === 'Paladin' && i.text === 'Oath Spells' && i.page === 33) ||
      (i.section === 'Warlock' && i.text === 'Expanded Spell List'),
  ),
  // The Oath of Devotion's "Tenets of Devotion" heading: its prose (the five
  // tenets) is now represented as a named section on subclass:oath-of-devotion
  // (eshyra-citg). The heading is child data on that subclass record.
  childOfRule(
    'subclass:oath-of-devotion',
    (i) => i.section === 'Paladin' && i.text === 'Tenets of Devotion',
  ),
  // The Rogue's "Thieves' Cant" level-1 feature is not emitted as its own
  // record; the SRD prints it as a subheading the feature parser folds into the
  // Sneak Attack feature body, so it is child-of that feature.
  childOfRule(
    'feature:rogue:sneak-attack',
    (i) => i.section === 'Rogue' && i.text === 'Thieves’ Cant',
  ),
  // The 8 subclass-group section headings (Martial Archetypes, Sacred Oaths,
  // Arcane Traditions, …) are section-tier navigation over the emitted subclass
  // records and fall through to the document-structure default below.
  // Per-class spell-list headers (p105-113): pure list structure; the lists
  // themselves are represented as `data.classes` on every spell record.
  ignoreRule(
    'spell-list-header',
    (i) =>
      SPELL_LIST_LEVEL_HEADER.test(i.text) ||
      SPELL_LIST_CLASS_HEADER.test(i.text),
  ),
  // Gamemastering group headings whose children are all emitted hazard
  // records (the 8 sample traps, 3 diseases, 14 poisons).
  ignoreRule('record-group-heading', (i) =>
    ['Sample Traps', 'Sample Diseases', 'Sample Poisons'].includes(i.text),
  ),
  // "Statistics for Objects" (p203) is the body of the emitted rule:objects
  // record (its AC/HP tables are separate emitted table records).
  childOfRule('rule:objects', (i) => i.text === 'Statistics for Objects'),
  // The Poisons price/type reference table (p204): its rows land on the
  // poison hazard records as `poisonType` + `price` child data.
  ignoreRule(
    'table-rows-emitted-as-records',
    (i) => i.text === 'Poisons' && i.structure === 'table-caption',
  ),
  // Acolyte background child structures (p61): the feature heading is
  // `data.feature` and the caption-less suggested-characteristics run is
  // `data.suggestedCharacteristics` (also emitted as 4 table records).
  childOfRule(
    'background:acolyte',
    (i) =>
      i.text === 'Feature: Shelter of the Faithful' ||
      (i.structure === 'table-shape' &&
        i.context === 'Suggested Characteristics'),
  ),
  // Armor-weight category headings (p63): represented as `armorType` child
  // data on every armor equipment record.
  ignoreRule('equipment-category-heading', (i) =>
    ['Light Armor', 'Medium Armor', 'Heavy Armor'].includes(i.text),
  ),
  // Equipment reference tables whose rows ARE the equipment records, plus
  // the column fragments of those same physical tables that surface as
  // caption-less runs in the two-column layout.
  ignoreRule(
    'table-rows-emitted-as-records',
    (i) =>
      i.section === 'Equipment' &&
      (EQUIPMENT_ROWS_AS_RECORDS_CAPTIONS.has(i.text) ||
        i.structure === 'table-shape'),
  ),
  // Equipment prose around the armor/weapon tables and the p73 sidebar
  // (eshyra-4a7.10.1). The leaf-tier Donning/Weapons captions remain owned by
  // table records; these predicates target only prose headings.
  recordRule(
    'rule:getting-into-and-out-of-armor',
    (i) =>
      i.section === 'Equipment' && i.text === 'Getting Into and Out of Armor',
  ),
  recordRule(
    'rule:weapons',
    (i) =>
      i.section === 'Equipment' &&
      i.structure === 'heading' &&
      i.tier === 'subsection' &&
      i.text === 'Weapons',
  ),
  recordRule(
    'rule:weapon-proficiency',
    (i) => i.section === 'Equipment' && i.text === 'Weapon Proficiency',
  ),
  recordRule(
    'rule:weapon-properties',
    (i) => i.section === 'Equipment' && i.text === 'Weapon Properties',
  ),
  recordRule(
    'rule:improvised-weapons',
    (i) => i.section === 'Equipment' && i.text === 'Improvised Weapons',
  ),
  recordRule(
    'rule:silvered-weapons',
    (i) => i.section === 'Equipment' && i.text === 'Silvered Weapons',
  ),
  recordRule(
    'rule:special-weapons',
    (i) => i.section === 'Equipment' && i.text === 'Special Weapons',
  ),
  recordRule(
    'rule:self-sufficiency',
    (i) => i.section === 'Equipment' && i.text === 'Self-Sufficiency',
  ),
  // Monsters pp320-321 Half-Dragon Template region (eshyra-4a7.10.3).
  // The subsection heading auto-matches its rule record by name; the two
  // caption-less table runs need explicit mappings to their synthesized names.
  recordRule(
    'table:half-dragon-damage-resistance',
    (i) =>
      i.section === 'Monsters' &&
      i.structure === 'table-shape' &&
      i.context === 'Half-Dragon Template' &&
      i.text === 'Color Damage Resistance',
  ),
  recordRule(
    'table:half-dragon-breath-weapon',
    (i) =>
      i.section === 'Monsters' &&
      i.structure === 'table-shape' &&
      i.context === 'Half-Dragon Template' &&
      i.text === 'Optional',
  ),
  // Unimported prose regions, tracked region-by-region in eshyra-4a7.10.
  knownGapRule(
    'eshyra-4a7.10',
    (i) =>
      // Monsters-chapter creature-family lore headings (Angels … Zombies,
      // the ten per-color dragon group intros). The Half-Dragon Template
      // subsection and its two tables are implemented above. Section-tier items
      // there are the alphabetical
      // "Monsters (A)" … navigation headings — left to the
      // document-structure default.
      (i.section === 'Monsters' &&
        i.structure === 'heading' &&
        (i.tier === 'subsection' || i.tier === 'leaf') &&
        i.text !== 'Half-Dragon Template') ||
      (i.section === 'Magic Items' &&
        SENTIENT_MAGIC_ITEM_HEADINGS.has(i.text)) ||
      (i.section?.startsWith('Appendix PH-B') ?? false) ||
      (i.section?.startsWith('Appendix PH-C') ?? false) ||
      i.text === 'Customizing NPCs',
  ),
];
