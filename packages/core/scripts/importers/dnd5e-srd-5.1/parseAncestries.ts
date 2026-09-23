/**
 * Race / ancestry parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` already narrowed to the races section of
 * the SRD (see `sections.ts`); output is an `AncestryExtraction[]`, sorted by
 * name, with one entry per race AND one per subrace.
 *
 * SRD 5.1 uses the term "race"; per ADR 0005 the importer normalizes the
 * record kind to `ancestry` while preserving the source term in record data
 * (`emit.ts` sets `data.source = 'race'`).
 *
 * Subrace decision (recorded on loreweaver-0m9.5.6): parent races and subraces
 * are emitted as **separate** records, and each subrace record is
 * **self-contained / flattened** — its trait list already combines the
 * parent's shared traits with the subrace's own additions, so a name lookup of
 * e.g. "Hill Dwarf" resolves to a fully usable record without resolving the
 * parent. `subraceOf` names the parent; the parent lists its children in
 * `subraces`. "Flattened" means parent traits followed by subrace traits, each
 * kept as its own verbatim entry — never text-joined, even when a subrace
 * trait repeats a parent trait's label (eshyra-o9bd.19.2.1.3.1: the source
 * prints e.g. "Ability Score Increase" once in the parent race block and again
 * in the subrace block, as two separately printed sentences, so the flattened
 * list keeps both as distinct entries rather than composing one joined
 * sentence that was never printed as a single span).
 *
 * Boundary detection mirrors the conservative known-name approach used by the
 * condition / hazard / action parsers: a line is a race or subrace heading only
 * when it exactly equals one of the known SRD 5.1 race / subrace names. This is
 * deterministic and resistant to false positives from body prose (which never
 * appears as a bare heading-only line). Trait sub-entries inside a block are
 * detected by the SRD's "Label. body" paragraph shape.
 */

import type { AncestryExtraction, AncestryTrait, PageText } from './types.js';

interface FlatLine {
  readonly line: string;
  readonly page: number;
}

function flatten(pages: readonly PageText[]): readonly FlatLine[] {
  const out: FlatLine[] = [];
  for (const page of pages) {
    for (const line of page.lines) {
      out.push({ line, page: page.pageNumber });
    }
  }
  return out;
}

// The nine SRD 5.1 races. Used as exact full-line heading anchors.
const KNOWN_RACES: readonly string[] = [
  'Dwarf',
  'Elf',
  'Halfling',
  'Human',
  'Dragonborn',
  'Gnome',
  'Half-Elf',
  'Half-Orc',
  'Tiefling',
];

interface KnownSubrace {
  /** Exact heading text as printed in the SRD. */
  readonly sourceName: string;
  /** Canonical record display name. Usually the heading, except bare halflings. */
  readonly recordName: string;
  readonly parent: string;
}

// Known PHB subraces and their parent races. The SRD 5.1 PDF itself only
// publishes one subrace per race-with-subraces (Hill Dwarf, High Elf,
// Lightfoot Halfling, Rock Gnome); the others (Mountain Dwarf, Wood Elf,
// Dark Elf/Drow, Stout Halfling, Forest Gnome) live in the PHB and appear
// here so the parser still detects them in synthetic fixtures or a future
// SRD revision that adds them. The orchestrator's coverage gate is
// `EXPECTED_SRD_5_1_ANCESTRY_NAMES` (the actual SRD 5.1 13-name set),
// kept separately in `index.ts`. Most record names are kept verbatim from
// the source headings; the bare halfling headings are parent-qualified so
// canonical name/key lookups match user-facing terms.
const KNOWN_SUBRACES: readonly KnownSubrace[] = [
  { sourceName: 'Hill Dwarf', recordName: 'Hill Dwarf', parent: 'Dwarf' },
  {
    sourceName: 'Mountain Dwarf',
    recordName: 'Mountain Dwarf',
    parent: 'Dwarf',
  },
  { sourceName: 'High Elf', recordName: 'High Elf', parent: 'Elf' },
  { sourceName: 'Wood Elf', recordName: 'Wood Elf', parent: 'Elf' },
  {
    sourceName: 'Dark Elf (Drow)',
    recordName: 'Dark Elf (Drow)',
    parent: 'Elf',
  },
  {
    sourceName: 'Lightfoot',
    recordName: 'Lightfoot Halfling',
    parent: 'Halfling',
  },
  {
    sourceName: 'Stout',
    recordName: 'Stout Halfling',
    parent: 'Halfling',
  },
  { sourceName: 'Forest Gnome', recordName: 'Forest Gnome', parent: 'Gnome' },
  { sourceName: 'Rock Gnome', recordName: 'Rock Gnome', parent: 'Gnome' },
];

const RACE_SET = new Set(KNOWN_RACES);
const SUBRACE_BY_SOURCE_NAME = new Map(
  KNOWN_SUBRACES.map((s) => [s.sourceName, s]),
);
const SUBRACE_BY_RECORD_NAME = new Map(
  KNOWN_SUBRACES.map((s) => [s.recordName, s]),
);

// "Label. body" trait line: a short Title-Case noun-phrase label, then a
// period, a space, and body text. Labels are letters with single internal
// separators (space, ASCII or typographic apostrophe U+2019, slash, parens,
// hyphen); commas and digits in the label position break the match (so body
// sentences are not mis-promoted). The typographic apostrophe is required for
// the Rock Gnome's "Artificer’s Lore." label (eshyra-o9bd.19.2.1.3.1): the PDF
// extraction uses U+2019, not ASCII "'", so without it the label line falls
// through to plain body text and bleeds into the preceding trait.
const TRAIT_LABEL_RE = /^([A-Z][A-Za-z]+(?:[ '’/()-][A-Za-z]+)*)\.\s+(\S.*)$/;

// Sentence-starter words that begin benefit prose, never a trait label. Mirrors
// the body-prose guard in parseFeats so a wrapped body sentence ending mid-line
// ("Your size is Medium. You ...") is not promoted to a bogus trait.
const PROSE_STARTERS = new Set([
  'You',
  'Your',
  'The',
  'A',
  'An',
  'This',
  'These',
  'When',
  'While',
  'If',
  'As',
  'Once',
  'At',
  'In',
  'On',
  'For',
  'To',
  'By',
  'With',
  'Choose',
]);

function matchTraitLabel(line: string): { label: string; body: string } | null {
  const m = TRAIT_LABEL_RE.exec(line.trim());
  if (m === null) return null;
  const label = m[1].trim();
  const words = label.split(/\s+/);
  if (label.length > 40 || words.length > 6) return null;
  if (PROSE_STARTERS.has(words[0])) return null;
  return { label, body: m[2].trim() };
}

// Sentence-terminal punctuation. A real trait paragraph ends with one of these,
// and the SRD always breaks to a fresh line before the next "Label." heading.
// So a "Label. body"-shaped line is only a new trait when the open trait's
// prose has actually ended; following an *unterminated* body line it is a
// wrapped continuation of that body, not a heading. The SRD Languages line
// wraps this way ("…read, and write" / "Common and Dwarvish. Dwarvish is full
// of…"), as does the Dragonborn Draconic Ancestry trait ("…from the Draconic" /
// "Ancestry table. Your breath weapon…"); both continuation lines look like
// "Label." headings and were promoted to bogus traits before this guard.
const TERMINAL_PUNCTUATION = /[.!?:)”"']$/;

/** True when the open trait body's last non-blank line ends a sentence. */
function bodyIsSentenceComplete(body: readonly string[]): boolean {
  for (let i = body.length - 1; i >= 0; i--) {
    const trimmed = body[i].trim();
    if (trimmed.length === 0) continue;
    return TERMINAL_PUNCTUATION.test(trimmed);
  }
  return true;
}

// The races section contains exactly one table: the Dragonborn "Draconic
// Ancestry" breath-weapon table, which the PDF interleaves between the Speed
// trait and the Draconic Ancestry trait. Its caption, column header, and rows
// ("Black Acid 5 by 30 ft. line (Dex. save)" …) are not "Label. body" trait
// lines, so they would otherwise be appended to the open Speed trait body.
// Drop the whole table so it never bleeds into a trait.
const BREATH_WEAPON_TABLE_CAPTION = 'Draconic Ancestry';
const BREATH_WEAPON_TABLE_HEADER = 'Dragon Damage Type Breath Weapon';
const BREATH_WEAPON_TABLE_ROW = /\((?:Str|Dex|Con|Int|Wis|Cha)\.\s*save\)/;

function stripBreathWeaponTable(lines: readonly string[]): string[] {
  const kept: string[] = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (
      trimmed === BREATH_WEAPON_TABLE_HEADER ||
      BREATH_WEAPON_TABLE_ROW.test(trimmed)
    ) {
      // Remove the bare table caption kept just before the header line.
      const last = kept[kept.length - 1];
      if (last !== undefined && last.trim() === BREATH_WEAPON_TABLE_CAPTION) {
        kept.pop();
      }
      continue;
    }
    kept.push(raw);
  }
  return kept;
}

/** Re-flow wrapped lines into paragraph-separated prose (blank line = break). */
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

interface RawBlock {
  readonly name: string;
  readonly description: string;
  readonly traits: readonly AncestryTrait[];
  readonly sourcePage: number;
}

interface Boundary {
  readonly idx: number;
  readonly name: string;
  readonly isRace: boolean;
  readonly parent?: string;
}

/** Parse a single race/subrace block body into description + traits. */
function parseBlock(
  name: string,
  bodyLines: readonly string[],
  sourcePage: number,
): RawBlock {
  // Drop a leading "<Name> Traits" sub-header line if present, then strip the
  // interleaved Draconic Ancestry breath-weapon table (Dragonborn only).
  const lines = stripBreathWeaponTable(
    bodyLines.filter(
      (l) => l.trim() !== `${name} Traits` && l.trim() !== `${name} Traits.`,
    ),
  );

  // Find the first trait-label line; everything before it is flavor/description.
  let firstTraitIdx = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (matchTraitLabel(lines[i]) !== null) {
      firstTraitIdx = i;
      break;
    }
  }

  const description = joinParagraphs(lines.slice(0, firstTraitIdx));

  const traits: AncestryTrait[] = [];
  let currentLabel: string | null = null;
  let currentBody: string[] = [];
  const flushTrait = () => {
    if (currentLabel !== null) {
      traits.push({
        name: currentLabel,
        text: joinParagraphs(currentBody),
      });
    }
    currentLabel = null;
    currentBody = [];
  };
  for (let i = firstTraitIdx; i < lines.length; i++) {
    const match = matchTraitLabel(lines[i]);
    // A "Label." line only opens a new trait when the current one is sentence-
    // complete; otherwise it is a wrapped continuation of the open trait body.
    if (
      match !== null &&
      (currentLabel === null || bodyIsSentenceComplete(currentBody))
    ) {
      flushTrait();
      currentLabel = match.label;
      currentBody = [match.body];
    } else if (currentLabel !== null) {
      currentBody.push(lines[i]);
    }
  }
  flushTrait();

  return { name, description, traits, sourcePage };
}

function findTrait(
  traits: readonly AncestryTrait[],
  name: string,
): AncestryTrait | undefined {
  return traits.find((t) => t.name === name);
}

function parseSize(traits: readonly AncestryTrait[]): string | undefined {
  const size = findTrait(traits, 'Size');
  if (size === undefined) return undefined;
  const m = /\b(Tiny|Small|Medium|Large|Huge|Gargantuan)\b/.exec(size.text);
  return m?.[1];
}

function parseSpeed(traits: readonly AncestryTrait[]): number | undefined {
  const speed = findTrait(traits, 'Speed');
  if (speed === undefined) return undefined;
  const m = /(\d+)\s*(?:feet|ft\.?)/i.exec(speed.text);
  return m ? Number.parseInt(m[1], 10) : undefined;
}

/**
 * Flatten parent + subrace traits into a self-contained list. Parent traits
 * come first (minus the parent's "Subrace" pointer trait); every subrace trait
 * is appended after them, in subrace document order, as its own entry —
 * including when a subrace trait's label repeats a parent trait's label (e.g.
 * both print an "Ability Score Increase" trait). The SRD prints each of those
 * two sentences in a different, separately printed section (the shared race
 * block and the subrace block), so composing them into one joined sentence
 * would fabricate a span the source never prints; the duplicate label is
 * intended (eshyra-o9bd.19.2.1.3.1).
 */
function mergeTraits(
  parent: readonly AncestryTrait[],
  child: readonly AncestryTrait[],
): AncestryTrait[] {
  const merged: AncestryTrait[] = parent
    .filter((t) => t.name !== 'Subrace')
    .map((t) => ({ ...t }));
  for (const trait of child) {
    merged.push({ ...trait });
  }
  return merged;
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * Parse race + subrace entries from the narrowed races-section `PageText[]`.
 * Returns an `AncestryExtraction[]` sorted by name; parents and subraces are
 * each their own entry, and subrace entries carry flattened (parent + own)
 * traits.
 */
export function parseAncestries(
  pages: readonly PageText[],
): AncestryExtraction[] {
  const flat = flatten(pages);
  if (flat.length === 0) return [];

  // First pass: locate race / subrace heading lines (exact full-line match).
  const boundaries: Boundary[] = [];
  for (let i = 0; i < flat.length; i++) {
    const trimmed = flat[i].line.trim();
    if (RACE_SET.has(trimmed)) {
      boundaries.push({ idx: i, name: trimmed, isRace: true });
    } else {
      const subrace = SUBRACE_BY_SOURCE_NAME.get(trimmed);
      if (subrace !== undefined) {
        boundaries.push({
          idx: i,
          name: subrace.recordName,
          isRace: false,
          parent: subrace.parent,
        });
      }
    }
  }
  if (boundaries.length === 0) return [];

  // Second pass: parse each block body up to the next boundary.
  const raceBlocks = new Map<string, RawBlock>();
  const subraceBlocks = new Map<string, RawBlock>();
  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    const bodyStart = b.idx + 1;
    const bodyEnd = boundaries[i + 1]?.idx ?? flat.length;
    const bodyLines = flat.slice(bodyStart, bodyEnd).map((f) => f.line);
    const block = parseBlock(b.name, bodyLines, flat[b.idx].page);
    if (b.isRace) {
      raceBlocks.set(b.name, block);
    } else {
      subraceBlocks.set(b.name, block);
    }
  }

  // Build child lists for each parent, preserving document order.
  const childrenOf = new Map<string, string[]>();
  for (const b of boundaries) {
    if (b.isRace) continue;
    const parent = b.parent;
    if (parent === undefined) continue;
    const list = childrenOf.get(parent) ?? [];
    list.push(b.name);
    childrenOf.set(parent, list);
  }

  const out: AncestryExtraction[] = [];

  // Parent race records.
  for (const [name, block] of raceBlocks) {
    const subraces = childrenOf.get(name);
    out.push({
      name,
      description: block.description,
      traits: block.traits,
      ...(parseSize(block.traits) !== undefined
        ? { size: parseSize(block.traits) }
        : {}),
      ...(parseSpeed(block.traits) !== undefined
        ? { speed: parseSpeed(block.traits) }
        : {}),
      ...(subraces !== undefined && subraces.length > 0 ? { subraces } : {}),
      sourcePage: block.sourcePage,
    });
  }

  // Subrace records (flattened with parent traits).
  for (const [name, block] of subraceBlocks) {
    const parentName = SUBRACE_BY_RECORD_NAME.get(name)?.parent;
    const parentBlock =
      parentName !== undefined ? raceBlocks.get(parentName) : undefined;
    const flattened =
      parentBlock !== undefined
        ? mergeTraits(parentBlock.traits, block.traits)
        : [...block.traits];
    out.push({
      name,
      description: block.description,
      traits: flattened,
      ...(parseSize(flattened) !== undefined
        ? { size: parseSize(flattened) }
        : {}),
      ...(parseSpeed(flattened) !== undefined
        ? { speed: parseSpeed(flattened) }
        : {}),
      ...(parentName !== undefined ? { subraceOf: parentName } : {}),
      sourcePage: block.sourcePage,
    });
  }

  out.sort(byName);
  return out;
}
