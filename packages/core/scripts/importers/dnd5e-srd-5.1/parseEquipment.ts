/**
 * Equipment-table parser for the D&D 5e SRD 5.1 importer.
 *
 * SRD 5.1 presents equipment as tabular data, not stat-block prose. This parser
 * projects the Equipment-chapter tables (plus the separate Mounts and Vehicles
 * section) into per-item records:
 *   - the Armor table   (Armor, Cost, Armor Class, Strength, Stealth, Weight)
 *   - the Weapons table  (Name, Cost, Damage, Weight, Properties)
 *   - the Tools table    (Item, Cost, Weight — artisan's tools, instruments, …)
 *   - the Adventuring Gear table (Item, Cost, Weight) + Container Capacity
 *   - the Equipment Packs prose bundles (category `pack`)
 *   - the Mounts and Vehicles section (mounts, tack/harness/drawn vehicles,
 *     waterborne vehicles) — parsed from a separate slice (see
 *     `parseMountsAndVehicles`).
 *
 * Extracted-text shape (the real vendored PDF, loreweaver-3n6): the SRD 5.1
 * Armor and Weapons tables are laid out as two *physical columns* on the page,
 * and the PDF text extractor reads each physical column top-to-bottom. The
 * result is that each table's cells arrive split into a LEFT column-block and a
 * RIGHT column-block, with descriptive prose interleaved between them:
 *
 *   Armor:   left  = "Padded 5 gp 11 + Dex modifier"   (Name Cost ArmorClass)
 *            right = "— Disadvantage 8 lb."            (Strength Stealth Weight)
 *   Weapons: left  = "Dagger 2 gp 1d4 piercing"        (Name Cost Damage)
 *            right = "1 lb. Finesse, light, thrown (range 20/60)" (Weight Props)
 *
 * Both blocks preserve row order, so each table is reconstructed by collecting
 * its left rows and right rows and zipping them positionally — the same
 * column-block reconstruction `parseTables.ts` uses for the treasure tables.
 * The Tools table, by contrast, extracts row-major ("Smith's tools 20 gp 8 lb.")
 * and is parsed line-by-line.
 *
 * Adventuring Gear (loreweaver-4zu): the gear table is the hardest of the
 * Equipment chapter. Its two physical columns extract such that the LEFT
 * column's item NAMES arrive first as one bare run ("Abacus", "Acid (vial)",
 * …, "Holy water (flask)"), then the LEFT column's cost/weight cells arrive
 * interleaved — line by line, by vertical position — with the RIGHT column's
 * *complete* rows ("Hourglass 25 gp 1 lb."). Four of the left names are
 * category headers with NO cost cell at all (Ammunition, Arcane focus, Druidic
 * focus, Holy symbol), so the name run (56) is longer than the left-value run
 * (52). Reconstruction (`collectGear`): collect the left name run; collect the
 * left values as the leading bare "<cost> <weight>" token of each line in the
 * interleave region; collect the right complete rows as the remainder of each
 * line; remove the four reviewed category-header names from the name run; then
 * the de-headered names and the left values MUST be equal in length and are
 * zipped positionally (both preserve top-to-bottom column order). A length
 * mismatch throws `EquipmentColumnMismatchError('Gear', …)` rather than
 * guessing (ADR 0007). The Container Capacity table that follows is attached as
 * a verbatim `capacity` field to the matching gear record via a reviewed
 * name-alias map; an unmatched container row fails closed
 * (`ContainerCapacityError`).
 */

import type { EquipmentExtraction, PageText } from './types.js';

/**
 * Thrown when a split-column table's left and right column-blocks do not pair
 * one-to-one. The Armor and Weapons tables are reconstructed by zipping their
 * left rows (Name/Cost/AC or Name/Cost/Damage) with their right rows
 * (Strength/Stealth/Weight or Weight/Properties) positionally; the Adventuring
 * Gear table zips its de-headered left names with its left cost/weight values.
 * Each is only sound when both blocks have the same length. A mismatch means
 * the extraction drifted (a row was dropped, an extra line matched a
 * column-block shape, the page layout changed, or a gear category header was
 * added/removed); rather than guess the alignment and emit plausible but wrong
 * records, the parser fails closed per the SRD importer policy (ADR 0007). The
 * message names the table and both counts.
 */
export class EquipmentColumnMismatchError extends Error {
  constructor(
    public readonly table: 'Armor' | 'Weapon' | 'Gear',
    public readonly leftCount: number,
    public readonly rightCount: number,
  ) {
    super(
      `${table} table column mismatch: left=${leftCount} right=${rightCount}. ` +
        'The split-column extraction drifted; refusing to zip mismatched blocks.',
    );
    this.name = 'EquipmentColumnMismatchError';
  }
}

/**
 * Thrown when a Container Capacity row names a container that does not match any
 * Adventuring Gear item (after the reviewed name-alias normalization). The
 * Container Capacity table is a fixed, reviewed set of 13 containers that all
 * also appear in the gear table; an unmatched row means the extraction drifted
 * or the alias map is stale. Per ADR 0007 the parser fails closed rather than
 * silently dropping a capacity it could not attach.
 */
export class ContainerCapacityError extends Error {
  constructor(public readonly container: string) {
    super(
      `Container Capacity row "${container}" matched no Adventuring Gear item. ` +
        'The gear/container extraction drifted or the alias map is stale; ' +
        'refusing to drop an unattached capacity.',
    );
    this.name = 'ContainerCapacityError';
  }
}

interface FlatLine {
  readonly line: string;
  readonly page: number;
  readonly height?: number;
}

function flatten(pages: readonly PageText[]): readonly FlatLine[] {
  const out: FlatLine[] = [];
  for (const page of pages) {
    for (let index = 0; index < page.lines.length; index++) {
      out.push({
        line: page.lines[index].trim(),
        page: page.pageNumber,
        height: page.lineHeights?.[index],
      });
    }
  }
  return out;
}

type ArmorType = 'light' | 'medium' | 'heavy' | 'shield';

/**
 * Classify an armor's weight class from its Armor Class cell. This is more
 * robust than tracking the table's "Light Armor"/"Medium Armor"/… sub-headers:
 * the SRD 5.1 PDF prints those same strings as body-prose section headings
 * interleaved with the table (a "Heavy Armor" description heading sits between
 * the Padded row and the page-2 Leather row), so a running sub-header state
 * misassigns the rows that straddle a page. The AC cell, by contrast, is a
 * stable 5e signature: light armor adds Dex with no cap ("11 + Dex modifier"),
 * medium caps it ("14 + Dex modifier (max 2)"), heavy is a flat number ("18"),
 * and a shield is a bonus ("+2").
 */
function armorTypeFromAc(ac: string): ArmorType {
  if (/^\+\d+$/.test(ac)) return 'shield';
  if (/\(max \d+\)/.test(ac)) return 'medium';
  if (/\+ Dex modifier$/.test(ac)) return 'light';
  return 'heavy';
}

// A currency cell, e.g. "2 gp", "1,500 gp", "5 sp". The leading number may
// carry thousands separators.
const COST = /\d{1,3}(?:,\d{3})*\s*(?:cp|sp|ep|gp|pp)/i;
const COST_ANCHORED = new RegExp(`\\b(${COST.source})`, 'i');
// A weight cell, e.g. "1 lb.", "1/4 lb.", "3 lb", "1½ lb.". Fractions appear
// for light gear/weapons (dart, sling bullets, etc.) as both ASCII ("1/2") and
// the vulgar-fraction glyphs the SRD typesets ("½", "¼", "¾").
const WEIGHT_CELL = /(?:\d+(?:\/\d+)?[½¼¾]?|[½¼¾])(?:\.\d+)?\s*lb\.?/i;
const WEIGHT_OR_DASH = new RegExp(`^(${WEIGHT_CELL.source}|[—–-])`, 'i');

// Armor LEFT-block row tail: everything after "<name> <cost> " must be exactly
// an Armor Class cell — a base AC ("18"), a Dex-modifier AC ("11 + Dex
// modifier", "14 + Dex modifier (max 2)"), or a shield bonus ("+2"). Anchoring
// the whole tail to an AC token (and nothing trailing) is what distinguishes an
// armor left-row from a weapon left-row or a gear/tool row — and the AC token
// shapes are unique to the Armor table across the whole Equipment chapter, so
// armor left-rows can be collected globally without a region scan.
const ARMOR_AC_TOKEN = /^(?:\d+(?: \+ Dex modifier(?: \(max \d+\))?)?|\+\d+)$/;
// Armor RIGHT-block row: "<Strength> <Stealth> <Weight>", where Strength is
// "Str N" or a dash, Stealth is "Disadvantage" or a dash, and Weight is a
// weight cell. This shape is unique to the Armor table, so right rows are also
// collected globally.
const ARMOR_RIGHT =
  /^(Str \d+|[—–-])\s+(Disadvantage|[—–-])\s+(\d+(?:\/\d+)?(?:\.\d+)?\s*lb\.?)$/i;

// Weapon sub-headers and the weapon column-header. Used to bound the weapon
// LEFT-block region.
const WEAPON_FIRST_SUBHEADER = /^Simple Melee Weapons$/i;
const GEAR_TITLE = /^Adventuring Gear$/i;
// The four Weapons-table sub-headers group every weapon row into the
// SRD's proficiency category (simple/martial) and engagement range
// (melee/ranged) — eshyra-erf5.3.1. They appear in this fixed order and each
// exactly once; a weapon row is classified by the nearest preceding one.
const WEAPON_SUBHEADERS: ReadonlyArray<{
  readonly test: RegExp;
  readonly category: 'simple' | 'martial';
  readonly range: 'melee' | 'ranged';
}> = [
  { test: /^Simple Melee Weapons$/i, category: 'simple', range: 'melee' },
  { test: /^Simple Ranged Weapons$/i, category: 'simple', range: 'ranged' },
  { test: /^Martial Melee Weapons$/i, category: 'martial', range: 'melee' },
  { test: /^Martial Ranged Weapons$/i, category: 'martial', range: 'ranged' },
];
// Weapon LEFT-block row tail: everything after "<name> <cost> " must be exactly
// a damage cell ("1d8 slashing", "1 piercing") or a dash (the Net has no
// damage). The trailing-dash form collides with gear/tool rows that have a "—"
// weight cell, so weapon left-rows are collected only within the bounded weapon
// region (first weapon sub-header → "Adventuring Gear"), never globally.
const WEAPON_DAMAGE_TOKEN =
  /^((\d+d\d+|\d+) (bludgeoning|piercing|slashing)|[—–-])$/i;
const WEAPON_DAMAGE_PARTS = /^(\d+d\d+|\d+) (bludgeoning|piercing|slashing)$/i;

// Tools table column header and the row that closes it. The Tools table
// extracts row-major; "Vehicles (land or water)" is the final table line (its
// cost/weight are "*", pointing at the Mounts and Vehicles section) and marks
// the end of the parseable rows.
const TOOLS_COLUMN_HEADER = /^Item Cost Weight$/i;
const VEHICLES_ROW = /^Vehicles \(land or water\)/i;
// Tools row tail: "<name> <cost> <weight-or-dash>" with nothing trailing.
const TOOL_TAIL = new RegExp(`^(${WEIGHT_CELL.source}|[—–-])$`, 'i');

/** Locate the cost cell; everything before it is the item name. */
function splitNameAndCost(
  line: string,
): { name: string; cost: string; rest: string } | undefined {
  const match = COST_ANCHORED.exec(line);
  if (match === null || match.index === 0) {
    return undefined;
  }
  const name = line.slice(0, match.index).trim();
  if (name.length === 0) {
    return undefined;
  }
  return {
    name,
    cost: normalize(match[1]),
    rest: line.slice(match.index + match[1].length).trim(),
  };
}

function normalize(cell: string): string {
  return cell.replace(/\s+/g, ' ').trim();
}

function normalizeDescriptionName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const SHARED_DESCRIPTION_TARGETS: ReadonlyMap<string, readonly string[]> =
  new Map([
    ['arcane focus', ['Crystal', 'Orb', 'Rod', 'Staff', 'Wand']],
    [
      'druidic focus',
      ['Sprig of mistletoe', 'Totem', 'Wooden staff', 'Yew wand'],
    ],
    ['holy symbol', ['Amulet', 'Emblem', 'Reliquary']],
    [
      'artisans tools',
      [
        'Alchemist’s supplies',
        'Brewer’s supplies',
        "Calligrapher's supplies",
        'Carpenter’s tools',
        'Cartographer’s tools',
        'Cobbler’s tools',
        'Cook’s utensils',
        'Glassblower’s tools',
        'Jeweler’s tools',
        'Leatherworker’s tools',
        'Mason’s tools',
        'Painter’s supplies',
        'Potter’s tools',
        'Smith’s tools',
        'Tinker’s tools',
        'Weaver’s tools',
        'Woodcarver’s tools',
      ],
    ],
    ['gaming set', ['Dice set', 'Playing card set']],
    [
      'musical instrument',
      [
        'Bagpipes',
        'Drum',
        'Dulcimer',
        'Flute',
        'Horn',
        'Lute',
        'Lyre',
        'Pan flute',
        'Shawm',
        'Viol',
      ],
    ],
    ['rope', ['Rope, hempen (50 feet)', 'Rope, silk (50 feet)']],
    ['tent', ['Tent, two-person']],
  ]);

const DESCRIPTION_LEAD_IN = /^(.{1,40}?)\.\s+(.+)$/;
const DESCRIPTION_REGION_BOUNDARY =
  /^(?:Item|Cost Weight.*|Container Capacity|Equipment Packs|Tools|Mounts and Vehicles)$/;

function startsWithLowercase(text: string): boolean {
  return /^[a-z]/.test(text.trim());
}

function activeDescriptionIsDangling(
  currentNames: readonly string[],
  descriptions: ReadonlyMap<
    string,
    { readonly page: number; readonly parts: string[] }
  >,
): boolean {
  return currentNames.some((name) => {
    const parts = descriptions.get(name)?.parts;
    const last = parts?.[parts.length - 1]?.trim();
    return last !== undefined && /\b(?:and|or|the|of the|with)$/i.test(last);
  });
}

// The SHARED_DESCRIPTION_TARGETS labels that name a gameplay-relevant SRD
// equipment group (eshyra-erf5.3.2), as opposed to labels that merely share
// generic description prose for unrelated reasons ("rope", "tent" — two rope
// lengths or a two-person tent, not a proficiency/filter category).
const EQUIPMENT_GROUP_LABELS: ReadonlySet<string> = new Set([
  'arcane focus',
  'druidic focus',
  'holy symbol',
  'artisans tools',
  'gaming set',
  'musical instrument',
]);

/**
 * Tag each item that belongs to one of the SRD's named gameplay-relevant
 * equipment groups (arcane focus, druidic focus, holy symbol, artisan's
 * tools, gaming set, musical instrument) with a stable kebab-case
 * `equipmentGroup` (eshyra-erf5.3.2). Reuses `SHARED_DESCRIPTION_TARGETS` —
 * the same reviewed label -> member-name mapping already used to attach
 * shared description prose — as the source of truth for group membership
 * (filtered to `EQUIPMENT_GROUP_LABELS`, since that map also covers unrelated
 * shared-description pairs like "rope"/"tent"), so the two concerns cannot
 * drift apart. This is a pure name -> group lookup, independent of whether
 * the description prose itself was found in a given fixture.
 */
function attachEquipmentGroups(
  items: readonly EquipmentExtraction[],
): EquipmentExtraction[] {
  const groupByName = new Map<string, string>();
  for (const [label, names] of SHARED_DESCRIPTION_TARGETS) {
    if (!EQUIPMENT_GROUP_LABELS.has(label)) continue;
    const group = label.replace(/\s+/g, '-');
    for (const name of names) {
      groupByName.set(normalizeDescriptionName(name), group);
    }
  }
  return items.map((item) => {
    const group = groupByName.get(normalizeDescriptionName(item.name));
    return group === undefined ? item : { ...item, equipmentGroup: group };
  });
}

function attachDescriptions(
  items: readonly EquipmentExtraction[],
  flat: readonly FlatLine[],
): EquipmentExtraction[] {
  const targets = new Map<string, string[]>();
  for (const item of items) {
    if (item.category === 'pack') continue;
    const key = normalizeDescriptionName(item.name);
    const bucket = targets.get(key);
    if (bucket === undefined) targets.set(key, [item.name]);
    else bucket.push(item.name);
  }
  for (const [label, names] of SHARED_DESCRIPTION_TARGETS) {
    targets.set(label, [...names]);
  }

  const descriptions = new Map<
    string,
    { readonly page: number; readonly parts: string[] }
  >();
  let currentNames: readonly string[] = [];
  for (const { line, page, height } of flat) {
    if (DESCRIPTION_REGION_BOUNDARY.test(line)) {
      currentNames = [];
      continue;
    }
    if (height !== undefined && height >= 10.3) {
      if (!activeDescriptionIsDangling(currentNames, descriptions)) {
        currentNames = [];
      }
      continue;
    }
    if (height !== undefined && height < 9.3) continue;
    const leadIn = DESCRIPTION_LEAD_IN.exec(line);
    if (leadIn !== null) {
      const names = targets.get(normalizeDescriptionName(leadIn[1]));
      if (names !== undefined && startsWithLowercase(leadIn[1])) {
        for (const name of currentNames) {
          descriptions.get(name)?.parts.push(line);
        }
        continue;
      }
      if (names !== undefined) {
        currentNames = names;
        for (const name of names) {
          descriptions.set(name, { page, parts: [line] });
        }
        continue;
      }
    }
    for (const name of currentNames) {
      descriptions.get(name)?.parts.push(line);
    }
  }

  return items.map((item) => {
    const description = descriptions.get(item.name);
    if (description === undefined) return item;
    return {
      ...item,
      description: normalize(description.parts.join(' ')),
      descriptionSourcePage: description.page,
    };
  });
}

/** Split a trailing property list on commas into trimmed, non-empty entries. */
function splitProperties(tail: string): string[] {
  const trimmed = tail.trim();
  if (trimmed.length === 0 || /^[—–-]+$/.test(trimmed)) {
    return [];
  }
  return trimmed
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export class WeaponPropertyShapeError extends Error {
  constructor(public readonly property: string) {
    super(
      `Unsupported SRD weapon property ${JSON.stringify(property)}; refusing an open-string deterministic projection.`,
    );
    this.name = 'WeaponPropertyShapeError';
  }
}

const SIMPLE_WEAPON_PROPERTIES = new Set([
  'finesse',
  'heavy',
  'light',
  'loading',
  'reach',
  'special',
  'two-handed',
]);

/** Parse the closed grammar printed by every row of the SRD Weapons table. */
export function parseWeaponProperties(
  properties: readonly string[],
): readonly Record<string, unknown>[] {
  return properties.map((source) => {
    const normalized = source.toLowerCase();
    if (SIMPLE_WEAPON_PROPERTIES.has(normalized)) {
      return { kind: normalized, source };
    }
    const range = /^(ammunition|thrown) \(range (\d+)\/(\d+)\)$/i.exec(source);
    if (range !== null) {
      return {
        kind: range[1].toLowerCase(),
        normalRangeFeet: Number(range[2]),
        longRangeFeet: Number(range[3]),
        source,
      };
    }
    const versatile = /^versatile \((\d+d\d+)\)$/i.exec(source);
    if (versatile !== null) {
      return { kind: 'versatile', alternateDamageDie: versatile[1], source };
    }
    throw new WeaponPropertyShapeError(source);
  });
}

interface ArmorLeft {
  readonly name: string;
  readonly cost: string;
  readonly ac: string;
  readonly armorType: ArmorType;
  readonly page: number;
}

interface ArmorRight {
  readonly strengthRequirement?: number;
  readonly stealthDisadvantage: boolean;
  readonly weight: string;
}

/**
 * Collect the Armor table by zipping its two column-blocks. Both the left rows
 * (Name/Cost/AC) and the right rows (Strength/Stealth/Weight) are identified by
 * shapes unique to the Armor table, so a single document-order pass collects
 * both. Each row's weight class comes from its AC cell (`armorTypeFromAc`), not
 * from the table sub-headers, which the body prose duplicates.
 */
function collectArmor(flat: readonly FlatLine[]): EquipmentExtraction[] {
  const left: ArmorLeft[] = [];
  const right: ArmorRight[] = [];

  for (const { line, page } of flat) {
    const rightMatch = ARMOR_RIGHT.exec(line);
    if (rightMatch !== null) {
      const strength = /^Str (\d+)$/i.exec(rightMatch[1]);
      right.push({
        ...(strength === null
          ? {}
          : { strengthRequirement: Number.parseInt(strength[1], 10) }),
        stealthDisadvantage: /Disadvantage/i.test(rightMatch[2]),
        weight: normalize(rightMatch[3]),
      });
      continue;
    }
    const split = splitNameAndCost(line);
    if (split !== undefined && ARMOR_AC_TOKEN.test(split.rest)) {
      const ac = normalize(split.rest);
      left.push({
        name: split.name,
        cost: split.cost,
        ac,
        armorType: armorTypeFromAc(ac),
        page,
      });
    }
  }

  if (left.length !== right.length) {
    throw new EquipmentColumnMismatchError('Armor', left.length, right.length);
  }

  return left.map((row, i) => {
    const tail = right[i];
    return {
      name: row.name,
      category: 'armor',
      cost: row.cost,
      ac: row.ac,
      armorType: row.armorType,
      stealthDisadvantage: tail.stealthDisadvantage,
      ...(tail.strengthRequirement === undefined
        ? {}
        : { strengthRequirement: tail.strengthRequirement }),
      ...(tail.weight === undefined ? {} : { weight: tail.weight }),
      sourcePage: row.page,
    };
  });
}

interface WeaponLeft {
  readonly name: string;
  readonly cost: string;
  readonly damageDie?: string;
  readonly damageType?: string;
  readonly weaponCategory: 'simple' | 'martial';
  readonly weaponRange: 'melee' | 'ranged';
  readonly page: number;
}

interface WeaponRight {
  readonly weight?: string;
  readonly properties: readonly string[];
}

/**
 * Collect the Weapons table by zipping its two column-blocks. The left rows
 * (Name/Cost/Damage) are bounded to the weapon region (first weapon sub-header
 * up to the "Adventuring Gear" title) because the Net's dash-damage row shares
 * a shape with gear/tool dash rows; the right rows (Weight/Properties) form a
 * single contiguous run immediately after that title (the right physical column
 * of the weapons page extracts after the gear heading).
 */
function collectWeapons(flat: readonly FlatLine[]): EquipmentExtraction[] {
  const startIdx = flat.findIndex((f) => WEAPON_FIRST_SUBHEADER.test(f.line));
  const gearIdx = flat.findIndex((f) => GEAR_TITLE.test(f.line));
  if (startIdx === -1 || gearIdx === -1 || gearIdx <= startIdx) {
    return [];
  }

  const left: WeaponLeft[] = [];
  // `startIdx` is, by definition, the position of "Simple Melee Weapons" — the
  // first WEAPON_SUBHEADERS entry — so the loop's very first iteration always
  // overwrites these before any weapon row can be reached; the initial values
  // are never actually read.
  let currentCategory: 'simple' | 'martial' = 'simple';
  let currentRange: 'melee' | 'ranged' = 'melee';
  for (let i = startIdx; i < gearIdx; i++) {
    const { line, page } = flat[i];
    const subheader = WEAPON_SUBHEADERS.find((h) => h.test.test(line));
    if (subheader !== undefined) {
      currentCategory = subheader.category;
      currentRange = subheader.range;
      continue;
    }
    const split = splitNameAndCost(line);
    if (split === undefined || !WEAPON_DAMAGE_TOKEN.test(split.rest)) {
      continue;
    }
    const dmg = WEAPON_DAMAGE_PARTS.exec(split.rest);
    left.push({
      name: split.name,
      cost: split.cost,
      weaponCategory: currentCategory,
      weaponRange: currentRange,
      ...(dmg === null
        ? {}
        : { damageDie: dmg[1], damageType: dmg[2].toLowerCase() }),
      page,
    });
  }

  // The right column-block is the first contiguous run of weight/properties
  // lines after the gear title.
  const right: WeaponRight[] = [];
  let started = false;
  for (let i = gearIdx + 1; i < flat.length; i++) {
    const match = WEIGHT_OR_DASH.exec(flat[i].line);
    if (match === null) {
      if (started) break;
      continue;
    }
    started = true;
    const weightCell = WEIGHT_CELL.test(match[1])
      ? normalize(match[1])
      : undefined;
    right.push({
      ...(weightCell === undefined ? {} : { weight: weightCell }),
      properties: splitProperties(flat[i].line.slice(match[0].length)),
    });
  }

  if (left.length !== right.length) {
    throw new EquipmentColumnMismatchError('Weapon', left.length, right.length);
  }

  return left.map((row, i) => {
    const tail = right[i];
    return {
      name: row.name,
      category: 'weapon',
      cost: row.cost,
      weaponCategory: row.weaponCategory,
      weaponRange: row.weaponRange,
      ...(row.damageDie === undefined ? {} : { damageDie: row.damageDie }),
      ...(row.damageType === undefined ? {} : { damageType: row.damageType }),
      properties: [...tail.properties],
      weaponProperties: parseWeaponProperties(tail.properties),
      ...(tail.weight === undefined ? {} : { weight: tail.weight }),
      sourcePage: row.page,
    };
  });
}

/**
 * Collect the Tools table. It extracts row-major, so each "<name> <cost>
 * <weight>" line is a record; the category sub-headers (Artisan's tools,
 * Gaming set, Musical instrument) carry no cost cell and are skipped. The table
 * is bounded by its column header and the closing "Vehicles (land or water)"
 * row.
 */
function collectTools(flat: readonly FlatLine[]): EquipmentExtraction[] {
  const headerIdx = flat.findIndex((f) => TOOLS_COLUMN_HEADER.test(f.line));
  if (headerIdx === -1) {
    return [];
  }
  const out: EquipmentExtraction[] = [];
  for (let i = headerIdx + 1; i < flat.length; i++) {
    const { line, page } = flat[i];
    if (VEHICLES_ROW.test(line)) {
      break;
    }
    const split = splitNameAndCost(line);
    if (split === undefined || !TOOL_TAIL.test(split.rest)) {
      continue;
    }
    const weight = WEIGHT_CELL.test(split.rest)
      ? normalize(split.rest)
      : undefined;
    out.push({
      name: split.name,
      category: 'tool',
      cost: split.cost,
      ...(weight === undefined ? {} : { weight }),
      sourcePage: page,
    });
  }
  return out;
}

// === Adventuring Gear =====================================================

// The four Adventuring Gear category-header rows carry no cost/weight cell;
// they label the sub-items below them (Arrows, Crystal, Sprig of mistletoe,
// Amulet, …). They appear in the left name run but have no left value, so they
// are removed before the de-headered names are zipped with the values. This is
// a reviewed name-set baseline (the header structure is small and fixed); if it
// drifts the length check in `collectGear` fails closed.
const GEAR_CATEGORY_HEADERS: ReadonlySet<string> = new Set([
  'Ammunition',
  'Arcane focus',
  'Druidic focus',
  'Holy symbol',
]);

// Section titles that bound the gear name run / value region. The name run
// begins at the bare "Item" column header (unique to the gear table — the Tools
// and Mounts tables print "Item Cost …") and ends at the first cost-bearing
// line. The value/right-row interleave region ends at "Equipment Packs" (the
// left column's values run on, by vertical position, past the gear right rows
// and the Container Capacity rows, but stop before the Packs prose).
const GEAR_ITEM_HEADER = /^Item$/;
const GEAR_VALUE_REGION_END = /^(Equipment Packs|Tools)$/;
// A left value is the leading "<cost> <weight-or-dash>" of a line in the
// interleave region. The remainder (if any) is a right-column complete row.
const GEAR_LEFT_VALUE = new RegExp(
  `^(${COST.source})\\s+(${WEIGHT_CELL.source}|[—–-])`,
  'i',
);
// The literal left column-header that prefixes the first interleaved line
// ("Cost Weight Hourglass 25 gp 1 lb.").
const GEAR_COST_WEIGHT_HEADER = /^Cost Weight\s*/;
const BACKPACK_STRAP_FOOTNOTE =
  /^\*?\s*You can also strap items, such as a bedroll or a coil of rope,/;
const BACKPACK_STRAP_FOOTNOTE_END = /^to the outside of a backpack\.$/;
// A Container Capacity row: "<name>[*] <capacity>", where the capacity cell
// carries a volume/mass-of-contents phrase and (unlike a gear row) no cost.
const CONTAINER_ROW =
  /^([A-Za-z][A-Za-z,'’ ]*?)\*?\s+((?:\d|[½¼¾]).*(?:cubic|gallon|pint|ounce|pounds of gear|liquid|solid).*)$/i;
// Reviewed alias map: Container Capacity names that differ from their gear-item
// name. Only "Bottle" (gear lists it as "Bottle, glass") differs; the other 12
// containers match by name after the trailing "*" is stripped.
const CONTAINER_NAME_ALIASES: ReadonlyMap<string, string> = new Map([
  ['Bottle', 'Bottle, glass'],
]);

interface GearLeftValue {
  readonly cost: string;
  readonly weight?: string;
  readonly page: number;
}

/**
 * Collect the Adventuring Gear table and attach the Container Capacity cells.
 *
 * See the file header for the extracted-text shape. In one document-order pass
 * over the interleave region this collects (a) the left column's bare values,
 * (b) the right column's complete rows, and (c) the Container Capacity rows.
 * The left name run is collected separately (it precedes the values). The four
 * reviewed category headers are removed from the names, the de-headered names
 * and the left values are length-checked and zipped, and the capacities are
 * attached to their matching gear records.
 */
function collectGear(flat: readonly FlatLine[]): EquipmentExtraction[] {
  const headerIdx = flat.findIndex(
    (f, i) =>
      GEAR_ITEM_HEADER.test(f.line) &&
      i + 1 < flat.length &&
      !COST_ANCHORED.test(flat[i + 1].line),
  );
  if (headerIdx === -1) {
    return [];
  }

  // Left name run: contiguous non-empty, cost-free lines after the "Item"
  // header, up to the first line that carries a cost cell.
  const names: { name: string; page: number }[] = [];
  let i = headerIdx + 1;
  for (; i < flat.length; i++) {
    const { line, page } = flat[i];
    if (line.length === 0) continue;
    if (COST_ANCHORED.test(line)) break;
    names.push({ name: line, page });
  }

  const endIdx = flat.findIndex(
    (f, idx) => idx >= i && GEAR_VALUE_REGION_END.test(f.line),
  );
  const regionEnd = endIdx === -1 ? flat.length : endIdx;

  const leftValues: GearLeftValue[] = [];
  const rightRows: EquipmentExtraction[] = [];
  const capacities = new Map<string, string>();
  let backpackStrapFootnote:
    | { readonly text: string; readonly page: number }
    | undefined;
  let backpackStrapFootnoteParts:
    | { readonly parts: string[]; readonly page: number }
    | undefined;
  for (let j = i; j < regionEnd; j++) {
    const { line, page } = flat[j];
    if (line.length === 0) continue;
    let rest = line;
    if (GEAR_COST_WEIGHT_HEADER.test(rest)) {
      rest = rest.replace(GEAR_COST_WEIGHT_HEADER, '');
    } else {
      const value = GEAR_LEFT_VALUE.exec(rest);
      if (value !== null) {
        const weight = WEIGHT_CELL.test(value[2])
          ? normalize(value[2])
          : undefined;
        leftValues.push({
          cost: normalize(value[1]),
          ...(weight === undefined ? {} : { weight }),
          page,
        });
        rest = rest.slice(value[0].length).trim();
      }
    }
    if (rest.length === 0) continue;
    // A right-column gear row: "<name> <cost> <weight-or-dash>".
    const split = splitNameAndCost(rest);
    if (split !== undefined && WEIGHT_OR_DASH.test(split.rest)) {
      const weight = WEIGHT_CELL.test(split.rest)
        ? normalize(split.rest)
        : undefined;
      rightRows.push({
        name: split.name,
        category: 'gear',
        cost: split.cost,
        ...(weight === undefined ? {} : { weight }),
        sourcePage: page,
      });
      continue;
    }
    // Otherwise it may be a Container Capacity row; everything else (the
    // "Container Capacity" header, the footnote) is ignored.
    const container = CONTAINER_ROW.exec(rest);
    if (container !== null) {
      const name = container[1].trim();
      const resolved = CONTAINER_NAME_ALIASES.get(name) ?? name;
      capacities.set(resolved, normalize(container[2]));
      continue;
    }
    if (BACKPACK_STRAP_FOOTNOTE.test(rest)) {
      backpackStrapFootnoteParts = {
        parts: [rest.replace(/^\*\s*/, '')],
        page,
      };
      continue;
    }
    if (
      backpackStrapFootnoteParts !== undefined &&
      BACKPACK_STRAP_FOOTNOTE_END.test(rest)
    ) {
      backpackStrapFootnoteParts.parts.push(rest);
      backpackStrapFootnote = {
        text: normalize(backpackStrapFootnoteParts.parts.join(' ')),
        page: backpackStrapFootnoteParts.page,
      };
      backpackStrapFootnoteParts = undefined;
    }
  }

  const items = names.filter(({ name }) => !GEAR_CATEGORY_HEADERS.has(name));
  if (items.length !== leftValues.length) {
    throw new EquipmentColumnMismatchError(
      'Gear',
      items.length,
      leftValues.length,
    );
  }

  const gear: EquipmentExtraction[] = items.map((item, idx) => {
    const value = leftValues[idx];
    return {
      name: item.name,
      category: 'gear',
      cost: value.cost,
      ...(value.weight === undefined ? {} : { weight: value.weight }),
      sourcePage: item.page,
    };
  });
  gear.push(...rightRows);

  // Attach capacities; every Container Capacity row must match a gear item.
  const byName = new Map(gear.map((g, idx) => [g.name, idx] as const));
  for (const [name, capacity] of capacities) {
    const idx = byName.get(name);
    if (idx === undefined) {
      throw new ContainerCapacityError(name);
    }
    gear[idx] = { ...gear[idx], capacity };
  }

  if (backpackStrapFootnote !== undefined) {
    const idx = byName.get('Backpack');
    if (idx === undefined) {
      throw new ContainerCapacityError('Backpack');
    }
    gear[idx] = {
      ...gear[idx],
      description: backpackStrapFootnote.text,
      descriptionSourcePage: backpackStrapFootnote.page,
    };
  }

  return gear;
}

// === Equipment Packs ======================================================

// The Equipment Packs prose lists each pack as "<Name> Pack (<cost>). Includes
// <contents…>." wrapped across several lines. A new pack begins at any line
// matching this shape; lines between are continuation text joined with spaces.
const PACK_START = /^(.+? Pack) \((\d{1,3}(?:,\d{3})*\s*gp)\)\.\s*(.*)$/;
const PACKS_TITLE = /^Equipment Packs$/;
const PACKS_END = /^Tools$/;

/**
 * Collect the Equipment Packs as `category: 'pack'` records. Each pack carries
 * its verbatim bundled price as `cost` and the contents sentence as
 * `description`. The contents are prose, not a structured table, so they are
 * preserved verbatim (re-flowed) rather than parsed into a contents list.
 */
function collectEquipmentPacks(
  flat: readonly FlatLine[],
): EquipmentExtraction[] {
  const titleIdx = flat.findIndex((f) => PACKS_TITLE.test(f.line));
  if (titleIdx === -1) {
    return [];
  }
  const endIdx = flat.findIndex(
    (f, idx) => idx > titleIdx && PACKS_END.test(f.line),
  );
  const regionEnd = endIdx === -1 ? flat.length : endIdx;

  const out: EquipmentExtraction[] = [];
  let current:
    | { name: string; cost: string; page: number; parts: string[] }
    | undefined;
  const flush = (): void => {
    if (current === undefined) return;
    out.push({
      name: current.name,
      category: 'pack',
      cost: current.cost,
      description: normalize(current.parts.join(' ')),
      sourcePage: current.page,
    });
  };
  for (let j = titleIdx + 1; j < regionEnd; j++) {
    const { line, page } = flat[j];
    if (line.length === 0) continue;
    const start = PACK_START.exec(line);
    if (start !== null) {
      flush();
      current = {
        name: normalize(start[1]),
        cost: normalize(start[2]),
        page,
        parts: start[3].length > 0 ? [start[3]] : [],
      };
      continue;
    }
    // Continuation of the current pack's contents. Lines before the first pack
    // (the introductory paragraph) are skipped because `current` is undefined.
    if (current !== undefined) {
      current.parts.push(line);
    }
  }
  flush();
  return out;
}

// === Mounts and Vehicles ==================================================

// The three Mounts-and-Vehicles sub-tables, each identified by its column
// header. Mounts add a Speed and Carrying Capacity column; waterborne vehicles
// add a Speed (in mph) column; the tack/harness/drawn-vehicle table is plain
// cost/weight (emitted as `gear`).
const MOUNTS_HEADER = /^Item Cost Speed Capacity$/;
const TACK_TITLE = /^Tack, Harness, and Drawn Vehicles$/;
const TACK_HEADER = /^Item Cost Weight$/;
const WATERBORNE_TITLE = /^Waterborne Vehicles$/;
const WATERBORNE_HEADER = /^Item Cost Speed$/;
const SPEED_FT = /\d+(?:\/\d+)?[½¼¾]?\s*ft\.?/i;
const SPEED_MPH = /\d+(?:\/\d+)?[½¼¾]?\s*mph/i;
const CAPACITY_LB = /\d{1,3}(?:,\d{3})*[½¼¾]?\s*lb\.?/i;
const MOUNT_ROW = new RegExp(
  `^(.+?)\\s+(${COST.source})\\s+(${SPEED_FT.source})\\s+(${CAPACITY_LB.source})$`,
  'i',
);
const WATERBORNE_ROW = new RegExp(
  `^(.+?)\\s+(${COST.source})\\s+(${SPEED_MPH.source})$`,
  'i',
);
// The "Saddle" sub-header groups four variants printed by bare adjective; each
// is qualified to "Saddle, <variant>" so the standalone record name is
// meaningful. Reviewed fixed set (loreweaver-4zu).
const SADDLE_VARIANTS: ReadonlySet<string> = new Set([
  'Exotic',
  'Military',
  'Pack',
  'Riding',
]);

/** Collect the Mounts and Other Animals table (cost / speed / capacity). */
function collectMounts(flat: readonly FlatLine[]): EquipmentExtraction[] {
  const headerIdx = flat.findIndex((f) => MOUNTS_HEADER.test(f.line));
  if (headerIdx === -1) {
    return [];
  }
  const out: EquipmentExtraction[] = [];
  for (let j = headerIdx + 1; j < flat.length; j++) {
    const { line, page } = flat[j];
    if (line.length === 0) continue;
    const row = MOUNT_ROW.exec(line);
    if (row === null) break;
    out.push({
      name: normalize(row[1]),
      category: 'mount',
      cost: normalize(row[2]),
      speed: normalize(row[3]),
      carryingCapacity: normalize(row[4]),
      sourcePage: page,
    });
  }
  return out;
}

/**
 * Collect the Tack, Harness, and Drawn Vehicles table as `category: 'gear'`.
 * The non-priced "Barding ×4 ×2" multiplier row (cost/weight are relative to
 * the equivalent armor, not absolute) is skipped; the "Saddle" sub-header's
 * four variants are qualified to "Saddle, <variant>".
 */
function collectTack(flat: readonly FlatLine[]): EquipmentExtraction[] {
  const titleIdx = flat.findIndex((f) => TACK_TITLE.test(f.line));
  if (titleIdx === -1) {
    return [];
  }
  const headerIdx = flat.findIndex(
    (f, idx) => idx > titleIdx && TACK_HEADER.test(f.line),
  );
  if (headerIdx === -1) {
    return [];
  }
  const out: EquipmentExtraction[] = [];
  for (let j = headerIdx + 1; j < flat.length; j++) {
    const { line, page } = flat[j];
    if (line.length === 0) continue;
    if (WATERBORNE_TITLE.test(line)) break;
    // Rows with no cost cell (the "Saddle" sub-header, "Barding ×4 ×2") are
    // skipped: the former labels the variants below it, the latter is a
    // multiplier note rather than a priced line item.
    const split = splitNameAndCost(line);
    if (split === undefined || !WEIGHT_OR_DASH.test(split.rest)) {
      continue;
    }
    const weight = WEIGHT_CELL.test(split.rest)
      ? normalize(split.rest)
      : undefined;
    const name = SADDLE_VARIANTS.has(split.name)
      ? `Saddle, ${split.name}`
      : split.name;
    out.push({
      name,
      category: 'gear',
      cost: split.cost,
      ...(weight === undefined ? {} : { weight }),
      sourcePage: page,
    });
  }
  return out;
}

/** Collect the Waterborne Vehicles table (cost / speed in mph). */
function collectWaterborne(flat: readonly FlatLine[]): EquipmentExtraction[] {
  const titleIdx = flat.findIndex((f) => WATERBORNE_TITLE.test(f.line));
  if (titleIdx === -1) {
    return [];
  }
  const headerIdx = flat.findIndex(
    (f, idx) => idx > titleIdx && WATERBORNE_HEADER.test(f.line),
  );
  if (headerIdx === -1) {
    return [];
  }
  const out: EquipmentExtraction[] = [];
  for (let j = headerIdx + 1; j < flat.length; j++) {
    const { line, page } = flat[j];
    if (line.length === 0) continue;
    const row = WATERBORNE_ROW.exec(line);
    if (row === null) break;
    out.push({
      name: normalize(row[1]),
      category: 'vehicle',
      cost: normalize(row[2]),
      speed: normalize(row[3]),
      sourcePage: page,
    });
  }
  return out;
}

/**
 * Parse the Mounts and Vehicles section from its own narrowed `PageText[]`
 * (the `mountsAndVehicles` slice — this section sits after the Equipment
 * chapter's `endHeading`, so it is not part of the Equipment slice). Returns
 * mounts (`category: 'mount'`), tack/harness/drawn vehicles (`category:
 * 'gear'`), and waterborne vehicles (`category: 'vehicle'`), sorted by name.
 */
export function parseMountsAndVehicles(
  pages: readonly PageText[],
): EquipmentExtraction[] {
  const flat = flatten(pages);
  const out: EquipmentExtraction[] = [
    ...collectMounts(flat),
    ...collectTack(flat),
    ...collectWaterborne(flat),
  ];
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

/**
 * Parse equipment entries from the narrowed Equipment-section `PageText[]`.
 * Returns an `EquipmentExtraction[]` sorted by name. The Mounts and Vehicles
 * section is parsed separately via `parseMountsAndVehicles` (it lives outside
 * the Equipment slice) and concatenated by the orchestrator.
 */
export function parseEquipment(
  pages: readonly PageText[],
): EquipmentExtraction[] {
  const flat = flatten(pages);
  const out = attachEquipmentGroups(
    attachDescriptions(
      [
        ...collectArmor(flat),
        ...collectWeapons(flat),
        ...collectTools(flat),
        ...collectGear(flat),
        ...collectEquipmentPacks(flat),
      ],
      flat,
    ),
  );
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}
