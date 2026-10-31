/**
 * Magic-item parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` already narrowed to the "Magic Items A-Z"
 * subsection. Each item is introduced by one or more title lines followed by a
 * category / rarity line, for example:
 *
 *   Adamantine Armor
 *   Armor (medium or heavy, but not hide), uncommon
 *
 * The parser reflows the whole item body into `description` text, including any
 * embedded item table. The document-wide table parser emits the reviewed
 * structured `table:*` record for that table, and `buildPack` then strips the
 * table's linearization back out of the owner's `description` so the structured
 * record is the sole representation (see `stripEmbeddedTableProse`, eshyra-3anh).
 *
 * Bounded spans (eshyra-4a7.2): every magic-item NAME renders at the leaf
 * heading tier (h≈12.0 in the real SRD), one tier above the h≈9.8 body. An
 * item body therefore ends at the next leaf-tier heading whose following line
 * has the shape of a category line. SRD 5.1 "Figurine of Wondrous Power"
 * (p221) prints its category as "Wondrous item, rarity by figurine"; that
 * source-specific rarity is accepted and its named figurines are emitted as
 * structured variants. The font-tier bound also guarantees that the preceding
 * Feather Token body stops before the Figurine heading.
 * The bound is gated on a genuinely multi-tier slice (`hasHeadingTiers`):
 * uniform-font fixture PDFs render every line at one body size, so they retain
 * the conservative bound-at-next-detected-entry fallback.
 */

import { hasHeadingTiers } from './parseSubclasses.js';
import type {
  MagicItemExtraction,
  MagicItemVariant,
  PageText,
} from './types.js';

interface FlatLine {
  readonly line: string;
  readonly page: number;
  /** Rendered max font height (PDF points), when the source carried it. */
  readonly height?: number;
}

interface EntryAnchor {
  readonly nameStart: number;
  readonly categoryStart: number;
  readonly categoryEnd: number;
  readonly name: string;
  readonly itemType: string;
  readonly rarity: string;
  readonly requiresAttunement: boolean;
  readonly attunementRequirement?: string;
}

interface CategorySpan {
  readonly end: number;
  readonly lines: readonly string[];
}

const ITEM_TYPE_PREFIX =
  /^(Armor|Potion|Ring|Rod|Scroll|Staff|Wand|Weapon|Wondrous item)\b/;
const ITEM_TYPE_WORD =
  /\b(Armor|Potion|Ring|Rod|Scroll|Staff|Wand|Weapon|Wondrous item)\b/gi;

const RARITY_WORD =
  /\b(common|uncommon|rare|very rare|legendary|artifact|rarity varies|rarity by figurine|varies)\b/i;

// Leaf-tier band (PDF user-space points) of a magic-item NAME heading in the
// real SRD (h≈12.0). Used only to bound an item body at the next item heading;
// section titles (h≈18) and body prose (h≈9.8) sit outside it.
const LEAF_HEADING_MIN_H = 11;
const LEAF_HEADING_MAX_H = 15;

// A real category line begins with an item-type word immediately followed by a
// subtype paren or the rarity comma ("Wondrous item, …", "Armor (plate), …",
// "Potion, …", "Wondrous item, rarity by figurine"). This is stricter than
// ITEM_TYPE_PREFIX on purpose: an embedded table header that merely starts with
// an item-type word — e.g. the Potion of Healing variants table caption
// "Potion of … Rarity HP Regained" — is NOT followed by `(` or `,`, so it is
// not mistaken for the start of a new item when bounding a body span.
const CATEGORY_LINE_START =
  /^(Armor|Potion|Ring|Rod|Scroll|Staff|Wand|Weapon|Wondrous item)\s*[(,]/;

const BODY_LABEL_PREFIX =
  /^(Actions|Armor Class|Challenge|Condition Immunities|Damage Immunities|Hit Points|Languages|Senses|Speed|STR DEX CON INT WIS CHA)\b/i;

const WRAPPED_TITLE_CONNECTOR =
  /(?:^|\s)(a|an|and|against|by|for|from|in|of|on|or|the|to|with|without)$/i;

const DAMAGE_TYPE_WORD =
  /\b(acid|cold|fire|force|lightning|necrotic|poison|psychic|radiant|thunder)\b/gi;

function flatten(pages: readonly PageText[]): readonly FlatLine[] {
  const out: FlatLine[] = [];
  for (const page of pages) {
    for (let i = 0; i < page.lines.length; i++) {
      out.push({
        line: page.lines[i],
        page: page.pageNumber,
        height: page.lineHeights?.[i],
      });
    }
  }
  return out;
}

/**
 * Is the line at `index` a magic-item NAME heading that starts a new entry —
 * a leaf-tier heading (h≈12.0) whose next non-empty line has the shape of a
 * category line? Returns false on a slice without genuine font tiers (uniform
 * fixtures), where every line lands in one band and the signal is meaningless.
 *
 * This is the deterministic span boundary: it catches a new item even when its
 * category does not fully parse (Figurine of Wondrous Power), while ignoring an
 * embedded sub-heading or table caption whose following line is table content,
 * not a category.
 */
function isItemHeadingBoundary(
  flat: readonly FlatLine[],
  index: number,
  tiersPresent: boolean,
): boolean {
  if (!tiersPresent) return false;
  const height = flat[index].height;
  if (
    height === undefined ||
    height < LEAF_HEADING_MIN_H ||
    height >= LEAF_HEADING_MAX_H
  ) {
    return false;
  }
  let next = index + 1;
  while (next < flat.length && flat[next].line.trim().length === 0) next++;
  return next < flat.length && CATEGORY_LINE_START.test(flat[next].line.trim());
}

function joinParagraphs(lines: readonly string[]): string {
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) {
      if (current.length > 0) {
        paragraphs.push(current.join(' '));
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) {
    paragraphs.push(current.join(' '));
  }
  return paragraphs.join('\n\n').trim();
}

function normalizeSpaces(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const FIGURINE_VARIANT =
  /\b(Bronze Griffon|Ebony Fly|Golden Lions|Ivory Goats|Marble Elephant|Obsidian Steed|Onyx Dog|Serpentine Owl|Silver Raven) \((Uncommon|Rare|Very Rare)\)\.\s*/g;

function extractFigurineVariants(description: string): MagicItemVariant[] {
  const matches = [...description.matchAll(FIGURINE_VARIANT)];
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? description.length;
    let text = description.slice(start, end).trim();
    if (match[1] === 'Ebony Fly') {
      text = text
        .replace(
          /\s+Giant Fly Large beast, unaligned Armor Class 11 Hit Points 19 \(3d10 \+ 3\) Speed 30 ft\., fly 60 ft\. STR DEX CON INT WIS CHA 14 \(\+2\) 13 \(\+1\) 13 \(\+1\) 2 \(−4\) 10 \(\+0\) 3 \(−4\) Senses darkvision 60 ft\., passive Perception 10 Languages —$/,
          '',
        )
        .trim();
    }
    return {
      name: match[1],
      rarity: match[2],
      text,
    };
  });
}

interface InlineVariantMarker {
  readonly name: string;
  readonly rarity: string;
  readonly marker: string;
}

interface InlineVariantSpec {
  readonly introduction: RegExp;
  readonly variants: readonly InlineVariantMarker[];
}

const INLINE_VARIANT_SPECS: ReadonlyMap<string, InlineVariantSpec> = new Map([
  [
    'Ioun Stone',
    {
      introduction:
        /Many types of Ioun stone exist, each type a distinct combination of shape and color\./,
      variants: [
        ['Absorption', 'Very Rare'],
        ['Agility', 'Very Rare'],
        ['Awareness', 'Rare'],
        ['Fortitude', 'Very Rare'],
        ['Greater Absorption', 'Legendary'],
        ['Insight', 'Very Rare'],
        ['Intellect', 'Very Rare'],
        ['Leadership', 'Very Rare'],
        ['Mastery', 'Legendary'],
        ['Protection', 'Rare'],
        ['Regeneration', 'Legendary'],
        ['Reserve', 'Rare'],
        ['Strength', 'Very Rare'],
        ['Sustenance', 'Rare'],
      ].map(([name, rarity]) => ({
        name,
        rarity,
        marker: `${name} (${rarity}).`,
      })),
    },
  ],
  [
    'Ring of Elemental Command',
    {
      introduction: /This ring is linked to one of the four Elemental Planes\./,
      variants: ['Air', 'Earth', 'Fire', 'Water'].map((plane) => ({
        name: `Ring of ${plane} Elemental Command`,
        rarity: 'Legendary',
        marker: `Ring of ${plane} Elemental Command.`,
      })),
    },
  ],
  [
    'Crystal Ball',
    {
      introduction:
        /The following crystal ball variants are legendary items and have additional properties\./,
      variants: ['Mind Reading', 'Telepathy', 'True Seeing'].map(
        (property) => ({
          name: `Crystal Ball of ${property}`,
          rarity: 'Legendary',
          marker: `Crystal Ball of ${property}.`,
        }),
      ),
    },
  ],
]);

/**
 * Lift the three reviewed inline-variant families into child data. Exact source
 * markers and pinned ordered memberships make source drift fail loudly: a
 * missing, duplicated, renamed, or reordered heading aborts compilation.
 */
function extractReviewedInlineVariants(
  itemName: string,
  description: string,
): MagicItemVariant[] {
  const spec = INLINE_VARIANT_SPECS.get(itemName);
  if (spec === undefined) return [];
  if (!spec.introduction.test(description)) {
    throw new Error(
      `magic-item variant extraction: expected introduction ${spec.introduction} not found in "${itemName}" description`,
    );
  }

  const starts = spec.variants.map((variant) => {
    const start = description.indexOf(variant.marker);
    const duplicate =
      start === -1
        ? -1
        : description.indexOf(variant.marker, start + variant.marker.length);
    if (start === -1 || duplicate !== -1) {
      throw new Error(
        `magic-item variant extraction: expected exactly one ${JSON.stringify(variant.marker)} marker in "${itemName}" description`,
      );
    }
    return start;
  });
  for (let index = 1; index < starts.length; index++) {
    if (starts[index] <= starts[index - 1]) {
      throw new Error(
        `magic-item variant extraction: reviewed variants are out of order in "${itemName}" description`,
      );
    }
  }

  return spec.variants.map((variant, index) => {
    const textStart = starts[index] + variant.marker.length;
    const textEnd = starts[index + 1] ?? description.length;
    const text = description.slice(textStart, textEnd).trim();
    if (text.length === 0) {
      throw new Error(
        `magic-item variant extraction: ${JSON.stringify(variant.name)} in "${itemName}" has no body text`,
      );
    }
    return { name: variant.name, rarity: variant.rarity, text };
  });
}

/**
 * Horn of Valhalla's four types (eshyra-olc5.14). The printed description says
 * "Four types of horn of Valhalla are known to exist" and "The GM chooses the
 * horn's type or determines it randomly"; the type table is
 * `table:horn-of-valhalla` (Horn Type | Berserkers Summoned | Requirement) and
 * the rarity line prints "rare (silver or brass), very rare (bronze), or
 * legendary (iron)". A horn's type is a persistent per-instance property, so it
 * is the instance's magic-item variant. Each row below is pinned: extraction
 * aborts if the rarity line or description drifts, and
 * `assertHornOfValhallaTypesMatchTable` aborts the emit if the table rows
 * differ, so the variants cannot silently diverge from the source.
 */
export const HORN_OF_VALHALLA_RARITY_LINE =
  'rare (silver or brass), very rare (bronze), or legendary (iron)';
export const HORN_OF_VALHALLA_TYPES = [
  {
    name: 'Silver',
    rarity: 'Rare',
    count: '2d4 + 2',
    requirement: 'None',
  },
  {
    name: 'Brass',
    rarity: 'Rare',
    count: '3d4 + 3',
    requirement: 'Proficiency with all simple weapons',
  },
  {
    name: 'Bronze',
    rarity: 'Very Rare',
    count: '4d4 + 4',
    requirement: 'Proficiency with all medium armor',
  },
  {
    name: 'Iron',
    rarity: 'Legendary',
    count: '5d4 + 5',
    requirement: 'Proficiency with all martial weapons',
  },
] as const;

function extractHornOfValhallaVariants(
  rarityLine: string,
  description: string,
): MagicItemVariant[] {
  if (rarityLine !== HORN_OF_VALHALLA_RARITY_LINE) {
    throw new Error(
      `magic-item variant extraction: expected Horn of Valhalla rarity line ${JSON.stringify(HORN_OF_VALHALLA_RARITY_LINE)}, found ${JSON.stringify(rarityLine)}`,
    );
  }
  for (const phrase of [
    'Four types of horn of Valhalla are known to exist',
    'The GM chooses the horn’s type or determines it randomly.',
  ]) {
    if (!description.includes(phrase)) {
      throw new Error(
        `magic-item variant extraction: expected ${JSON.stringify(phrase)} not found in "Horn of Valhalla" description`,
      );
    }
  }
  return HORN_OF_VALHALLA_TYPES.map(({ name, rarity, count, requirement }) => ({
    name,
    rarity,
    text: `Berserkers Summoned: ${count}. Requirement: ${requirement}.`,
  }));
}

/** Aborts when the emitted Horn of Valhalla table differs from the pinned
 *  types the variants were built from. */
export function assertHornOfValhallaTypesMatchTable(
  rows: readonly (readonly unknown[])[],
  columns: readonly string[],
): void {
  const expected = HORN_OF_VALHALLA_TYPES.map(
    ({ name, count, requirement }) => [name, count, requirement],
  );
  const actual = rows.map((row) => row.slice(1).map(String));
  if (
    columns.slice(1).join('|') !==
      'Horn Type|Berserkers Summoned|Requirement' ||
    JSON.stringify(actual) !== JSON.stringify(expected)
  ) {
    throw new Error(
      `magic-item variant extraction: Horn of Valhalla variants no longer match table:horn-of-valhalla (columns ${JSON.stringify(columns)}, rows ${JSON.stringify(actual)})`,
    );
  }
}

/** Source-pinned per-instance gem type and elemental mapping (SRD 5.1 p. 220). */
export const ELEMENTAL_GEM_TYPES = [
  {
    name: 'Blue Sapphire',
    tableGem: 'Blue sapphire',
    id: 'blue-sapphire',
    elemental: 'Air elemental',
    creature: 'air-elemental',
  },
  {
    name: 'Yellow Diamond',
    tableGem: 'Yellow diamond',
    id: 'yellow-diamond',
    elemental: 'Earth elemental',
    creature: 'earth-elemental',
  },
  {
    name: 'Red Corundum',
    tableGem: 'Red corundum',
    id: 'red-corundum',
    elemental: 'Fire elemental',
    creature: 'fire-elemental',
  },
  {
    name: 'Emerald',
    tableGem: 'Emerald',
    id: 'emerald',
    elemental: 'Water elemental',
    creature: 'water-elemental',
  },
] as const;

function extractElementalGemVariants(description: string): MagicItemVariant[] {
  const phrase =
    'The type of gem determines the elemental summoned by the spell.';
  if (!description.includes(phrase)) {
    throw new Error(
      `magic-item variant extraction: expected ${JSON.stringify(phrase)} not found in "Elemental Gem" description`,
    );
  }
  return ELEMENTAL_GEM_TYPES.map(({ name, elemental }) => ({
    name,
    rarity: 'Uncommon',
    text: `Summoned elemental: ${elemental}.`,
  }));
}

/** Aborts if table:elemental-gem no longer matches the pinned source mapping. */
export function assertElementalGemTypesMatchTable(
  rows: readonly (readonly unknown[])[],
  columns: readonly string[],
): void {
  const actual = rows.map((row) => row.map(String));
  const expected = ELEMENTAL_GEM_TYPES.map(({ tableGem, elemental }) => [
    tableGem,
    elemental,
  ]);
  if (
    columns.join('|') !== 'Gem|Summoned Elemental' ||
    JSON.stringify(actual) !== JSON.stringify(expected)
  ) {
    throw new Error(
      `magic-item variant extraction: Elemental Gem variants no longer match table:elemental-gem (columns ${JSON.stringify(columns)}, rows ${JSON.stringify(actual)})`,
    );
  }
}

/**
 * Bag of Tricks' three cloth colors (eshyra-olc5.16). The printed description
 * says "This ordinary bag, made from gray, rust, or tan cloth" and that the
 * fuzzy object "transforms into a creature you determine by rolling a d8 and
 * consulting the table that corresponds to the bag's color"; the tables are
 * `table:gray-bag-of-tricks`, `table:rust-bag-of-tricks` and
 * `table:tan-bag-of-tricks` (d8 | Creature). A bag's color is a persistent
 * per-instance property, so it is the instance's magic-item variant. The rows
 * below are pinned: extraction aborts if the description drifts, and
 * `assertBagOfTricksTablesMatch` aborts the emit if any table's rows differ.
 */
export const BAG_OF_TRICKS_TABLES = [
  {
    name: 'Gray',
    table: 'gray-bag-of-tricks',
    creatures: [
      'Weasel',
      'Giant rat',
      'Badger',
      'Boar',
      'Panther',
      'Giant badger',
      'Dire wolf',
      'Giant elk',
    ],
  },
  {
    name: 'Rust',
    table: 'rust-bag-of-tricks',
    creatures: [
      'Rat',
      'Owl',
      'Mastiff',
      'Goat',
      'Giant goat',
      'Giant boar',
      'Lion',
      'Brown bear',
    ],
  },
  {
    name: 'Tan',
    table: 'tan-bag-of-tricks',
    creatures: [
      'Jackal',
      'Ape',
      'Baboon',
      'Axe beak',
      'Black bear',
      'Giant weasel',
      'Giant hyena',
      'Tiger',
    ],
  },
] as const;

function extractBagOfTricksVariants(description: string): MagicItemVariant[] {
  for (const phrase of [
    'made from gray, rust, or tan cloth',
    'rolling a d8 and consulting the table that corresponds to the bag’s color',
  ]) {
    if (!description.includes(phrase)) {
      throw new Error(
        `magic-item variant extraction: expected ${JSON.stringify(phrase)} not found in "Bag of Tricks" description`,
      );
    }
  }
  return BAG_OF_TRICKS_TABLES.map(({ name, creatures }) => ({
    name,
    rarity: 'Uncommon',
    text: `d8 creatures: ${creatures.map((creature, index) => `${index + 1} ${creature}`).join('; ')}.`,
  }));
}

/** Aborts when any emitted Bag of Tricks color table (named "<Color> Bag of
 *  Tricks") differs from the pinned rows the variants were built from. */
export function assertBagOfTricksTablesMatch(
  tables: readonly {
    readonly name: string;
    readonly columns: readonly string[];
    readonly rows: readonly (readonly unknown[])[];
  }[],
): void {
  for (const { name, table, creatures } of BAG_OF_TRICKS_TABLES) {
    const found = tables.find(
      (candidate) => candidate.name === `${name} Bag of Tricks`,
    );
    if (found === undefined) {
      throw new Error(
        `magic-item variant extraction: table "${table}" is missing; the ${name} Bag of Tricks variant cannot be checked against it`,
      );
    }
    const actual = found.rows.map((row) => row.map(String));
    const expected = creatures.map((creature, index) => [
      String(index + 1),
      creature,
    ]);
    if (
      found.columns.join('|') !== 'd8|Creature' ||
      JSON.stringify(actual) !== JSON.stringify(expected)
    ) {
      throw new Error(
        `magic-item variant extraction: Bag of Tricks variants no longer match table:${table} (columns ${JSON.stringify(found.columns)}, rows ${JSON.stringify(actual)})`,
      );
    }
  }
}

function categoryTextFromLine(line: string): string | undefined {
  const text = line.trim();
  for (const match of text.matchAll(ITEM_TYPE_WORD)) {
    const index = match.index ?? 0;
    const candidate = text.slice(index);
    if (ITEM_TYPE_PREFIX.test(candidate) && RARITY_WORD.test(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function hasUnclosedParen(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')' && depth > 0) depth--;
  }
  return depth > 0;
}

function isCategoryContinuation(line: string): boolean {
  const text = line.trim();
  return (
    text.startsWith('(') ||
    /^(or\s+)?(common|uncommon|rare|very rare|legendary|artifact|rarity varies|varies)\b/i.test(
      text,
    ) ||
    /^(attunement|warlock|wizard|druid|cleric|paladin|sorcerer)\b/i.test(text)
  );
}

function isParentheticalCategoryContinuation(
  currentCategoryText: string,
  line: string,
): boolean {
  const text = line.trim();
  return (
    hasUnclosedParen(currentCategoryText) &&
    text.length > 0 &&
    /^[a-z]/.test(text) &&
    /\)/.test(text) &&
    !/[.!?:]$/.test(text)
  );
}

function categoryStartTextAt(
  flat: readonly FlatLine[],
  index: number,
): string | undefined {
  const direct = categoryTextFromLine(flat[index].line);
  if (direct !== undefined) return direct;

  const text = flat[index].line.trim();
  if (!ITEM_TYPE_PREFIX.test(text)) return undefined;
  const next = flat[index + 1]?.line.trim();
  if (next === undefined || !isCategoryContinuation(next)) return undefined;
  if (!RARITY_WORD.test(next)) return undefined;
  // The category metadata has begun on this line when it ends with a wrap
  // connector (comma / open paren / hyphen) or carries an unclosed paren, OR
  // when a top-level comma already opened the rarity field but the rarity
  // phrase itself wraps mid-word onto the next line. SRD 5.1 "Sword of
  // Sharpness" (p246) wraps as "Weapon (any sword that deals slashing
  // damage), very" / "rare (requires attunement)": the line ends with the
  // bare word "very" (no trailing punctuation, balanced parens), so the
  // connector test alone misses it and the item was swallowed into the
  // preceding "Sword of Life Stealing" body. The top-level comma without a
  // complete rarity word on the line is the deterministic signal that the
  // rarity continues on the following line.
  const endsWithConnector = hasUnclosedParen(text) || /[,(-]$/.test(text);
  const rarityPhraseWraps =
    firstTopLevelComma(text) !== -1 && !RARITY_WORD.test(text);
  if (!endsWithConnector && !rarityPhraseWraps) return undefined;
  return text;
}

function isCategoryStartAt(flat: readonly FlatLine[], index: number): boolean {
  return categoryStartTextAt(flat, index) !== undefined;
}

function categorySpan(
  flat: readonly FlatLine[],
  categoryStart: number,
): CategorySpan {
  const firstLine = categoryStartTextAt(flat, categoryStart);
  if (firstLine === undefined) {
    throw new Error('categorySpan called for a non-category line');
  }
  let end = categoryStart;
  const lines = [firstLine];
  let text = firstLine;
  while (end + 1 < flat.length) {
    const next = flat[end + 1].line.trim();
    if (isCategoryStartAt(flat, end + 1)) break;
    if (hasUnclosedParen(text)) {
      if (
        isCategoryContinuation(next) ||
        isParentheticalCategoryContinuation(text, next)
      ) {
        end++;
        lines.push(next);
        text = `${text} ${next}`;
        continue;
      }
      if (
        end + 2 < flat.length &&
        isSkippableInterleavedBodyLine(next) &&
        (isCategoryContinuation(flat[end + 2].line) ||
          isParentheticalCategoryContinuation(text, flat[end + 2].line))
      ) {
        end++;
        continue;
      }
      break;
    }
    if (isCategoryContinuation(next)) {
      end++;
      lines.push(next);
      text = `${text} ${next}`;
      continue;
    }
    break;
  }
  return { end, lines };
}

function hasOrdinaryNumber(text: string): boolean {
  return /(^|[^+\w])\d/.test(text);
}

function hasMultipleDamageTypes(text: string): boolean {
  if (/\bof\b/i.test(text)) return false;
  const matches = text.match(DAMAGE_TYPE_WORD);
  return matches !== null && matches.length >= 2;
}

function endsWithLowercaseNonConnector(text: string): boolean {
  if (!/[A-Za-z]$/.test(text)) return false;
  const words = text.match(/[A-Za-z]+/g);
  const last = words?.at(-1);
  return (
    last !== undefined &&
    /^[a-z]/.test(last) &&
    !WRAPPED_TITLE_CONNECTOR.test(text)
  );
}

function isSkippableInterleavedBodyLine(line: string): boolean {
  const text = line.trim();
  return (
    text.length === 0 ||
    text.startsWith('•') ||
    /^[a-z]/.test(text) ||
    BODY_LABEL_PREFIX.test(text) ||
    hasOrdinaryNumber(text) ||
    hasMultipleDamageTypes(text) ||
    endsWithLowercaseNonConnector(text)
  );
}

function looksLikeNameLine(line: string): boolean {
  const text = line.trim();
  if (text.length === 0) return false;
  if (/[.!?:]$/.test(text)) return false;
  if (/^[a-z]/.test(text)) return false;
  if (text.startsWith('•')) return false;
  if (BODY_LABEL_PREFIX.test(text)) return false;
  if (hasOrdinaryNumber(text)) return false;
  if (hasMultipleDamageTypes(text)) return false;
  if (endsWithLowercaseNonConnector(text)) return false;
  if (ITEM_TYPE_PREFIX.test(text) && RARITY_WORD.test(text)) return false;
  return true;
}

function shouldJoinWrappedNameLine(line: string): boolean {
  const text = line.trim();
  return (
    looksLikeNameLine(text) &&
    (WRAPPED_TITLE_CONNECTOR.test(text) || /[,(-]$/.test(text))
  );
}

function nameStartIndex(
  flat: readonly FlatLine[],
  categoryStart: number,
): number | undefined {
  let start = categoryStart - 1;
  let skipped = 0;
  while (
    start >= 0 &&
    skipped < 4 &&
    isSkippableInterleavedBodyLine(flat[start].line)
  ) {
    start--;
    skipped++;
  }
  if (start < 0 || !looksLikeNameLine(flat[start].line)) return undefined;
  while (start - 1 >= 0 && shouldJoinWrappedNameLine(flat[start - 1].line)) {
    start--;
  }
  return start;
}

function parseCategory(
  text: string,
): Omit<EntryAnchor, 'nameStart' | 'categoryStart' | 'categoryEnd' | 'name'> {
  const withoutAttunement = text.replace(
    /\s*\((requires attunement[^)]*)\)/i,
    '',
  );
  const attunementMatch = /\((requires attunement[^)]*)\)/i.exec(text);
  const requiresAttunement = attunementMatch !== null;
  const attunementText = attunementMatch?.[1]
    .replace(/^requires attunement\s*/i, '')
    .trim();
  const comma = firstTopLevelComma(withoutAttunement);
  const itemType =
    comma === -1 ? withoutAttunement.trim() : withoutAttunement.slice(0, comma);
  const rarity = comma === -1 ? '' : withoutAttunement.slice(comma + 1).trim();
  return {
    itemType: normalizeSpaces(itemType),
    rarity: normalizeSpaces(rarity.replace(/\s*,\s*$/, '')),
    requiresAttunement,
    ...(attunementText === undefined || attunementText.length === 0
      ? {}
      : { attunementRequirement: normalizeSpaces(attunementText) }),
  };
}

function firstTopLevelComma(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    if (ch === ')' && depth > 0) depth--;
    if (ch === ',' && depth === 0) return i;
  }
  return -1;
}

function findEntries(flat: readonly FlatLine[]): readonly EntryAnchor[] {
  const entries: EntryAnchor[] = [];
  for (let i = 0; i < flat.length; i++) {
    if (!isCategoryStartAt(flat, i)) continue;
    const start = nameStartIndex(flat, i);
    if (start === undefined) continue;
    const category = categorySpan(flat, i);
    const end = category.end;
    const categoryText = normalizeSpaces(
      category.lines.map((line) => line.trim()).join(' '),
    );
    entries.push({
      nameStart: start,
      categoryStart: i,
      categoryEnd: end,
      name: normalizeSpaces(
        flat
          .slice(start, i)
          .filter((f) => looksLikeNameLine(f.line))
          .map((f) => f.line.trim())
          .join(' '),
      ),
      ...parseCategory(categoryText),
    });
    i = end;
  }
  return entries;
}

export function parseMagicItems(
  pages: readonly PageText[],
): MagicItemExtraction[] {
  const flat = flatten(pages);
  const entries = findEntries(flat);
  const tiersPresent = hasHeadingTiers(flat.map((f) => f.height));
  const out: MagicItemExtraction[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const bodyStart = entry.categoryEnd + 1;
    // The body ends at the next DETECTED entry's name, or — on a genuinely
    // multi-tier slice — at the first item NAME heading after this body,
    // whichever comes first. The font-tier bound catches a real next item
    // whose category did not parse (so it is not a detected entry), e.g.
    // Figurine of Wondrous Power after Feather Token (eshyra-4a7.2).
    let bodyEnd = entries[i + 1]?.nameStart ?? flat.length;
    if (tiersPresent) {
      for (let k = bodyStart; k < bodyEnd; k++) {
        if (isItemHeadingBoundary(flat, k, tiersPresent)) {
          bodyEnd = k;
          break;
        }
      }
    }
    const description = joinParagraphs(
      flat.slice(bodyStart, bodyEnd).map((f) => f.line),
    );
    const variants =
      entry.name === 'Figurine of Wondrous Power'
        ? extractFigurineVariants(description)
        : entry.name === 'Horn of Valhalla'
          ? extractHornOfValhallaVariants(entry.rarity, description)
          : entry.name === 'Elemental Gem'
            ? extractElementalGemVariants(description)
            : entry.name === 'Bag of Tricks'
              ? extractBagOfTricksVariants(description)
              : extractReviewedInlineVariants(entry.name, description);
    out.push({
      name: entry.name,
      itemType: entry.itemType,
      rarity: entry.rarity,
      requiresAttunement: entry.requiresAttunement,
      ...(entry.attunementRequirement === undefined
        ? {}
        : { attunementRequirement: entry.attunementRequirement }),
      description: description.length > 0 ? description : entry.name,
      ...(variants.length === 0 ? {} : { variants }),
      sourcePage: flat[entry.nameStart].page,
    });
  }

  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}
