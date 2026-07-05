/**
 * Creature stat-block parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` already narrowed to the SRD's Monsters
 * section; output is a `CreatureExtraction[]` with stable shape, sorted by
 * name. The caller (the orchestrator in `index.ts`) is responsible for
 * narrowing the input to the monsters chapter via `sliceSection`.
 *
 * A stat block is identified by its meta line — the
 * "<Size> <type>[ (subtype)], <alignment>" line that immediately follows the
 * creature's name (e.g. "Small humanoid (goblinoid), neutral evil"). The
 * parser then reads the keyed stat lines that follow (Armor Class, Hit Points,
 * Speed, the STR/DEX/CON/INT/WIS/CHA ability-score row, Challenge). Each
 * keyed stat is identified by its own pattern via a first-match-wins scan,
 * not by positional adjacency — real SRD 5.1 two-column extraction can
 * interleave a prose line from the adjacent column between the
 * "STR DEX CON INT WIS CHA" header and the score row, so the score row is
 * recognized directly by its six "N (modifier)" cells (loreweaver-w8h).
 *
 * Two-tier confirmation (mirrors `parseSpells`):
 *   - A meta-line candidate is only confirmed as a creature when its body
 *     carries the structural signature of a stat block: an Armor Class line, a
 *     Hit Points line, AND a recognizable ability-score row. Body prose that
 *     merely reads like a meta line (e.g. "Large beasts, such as horses, …")
 *     lacks that signature and is silently skipped — defense-in-depth against
 *     a slice that wasn't perfectly narrowed.
 *   - A confirmed creature missing Speed or Challenge is a genuine malformed
 *     stat block, so the parser throws with the creature name + page rather
 *     than emit a record that can't satisfy the kindSchema.
 */

import { creatureTaxonomySpecForLine } from './creatureTaxonomy.js';
import { classifyTier } from './sourceInventory.js';
import type {
  CreatureAbilityScores,
  CreatureArmorClass,
  CreatureArmorClassVariant,
  CreatureCategory,
  CreatureExtraction,
  CreatureHitPoints,
  CreatureLegendaryActions,
  CreatureSpeedVariant,
  CreatureStatBlockEntry,
  CreatureVariant,
  PageText,
} from './types.js';

const SIZES = [
  'Tiny',
  'Small',
  'Medium',
  'Large',
  'Huge',
  'Gargantuan',
] as const;
const SIZE_PATTERN = SIZES.join('|');

// The 14 SRD creature types. Used to confirm a meta-line candidate really
// names a creature type rather than being an arbitrary "<Size> <word>, …"
// sentence fragment.
const CREATURE_TYPES = [
  'aberration',
  'beast',
  'celestial',
  'construct',
  'dragon',
  'elemental',
  'fey',
  'fiend',
  'giant',
  'humanoid',
  'monstrosity',
  'ooze',
  'plant',
  'undead',
] as const;
const TYPE_WORD = new RegExp(`\\b(?:${CREATURE_TYPES.join('|')})s?\\b`);

// "<Size> <typePhrase>[ (subtype)], <alignment>". The size word is capitalized
// and the type phrase lowercased exactly as the SRD prints them, so no `i`
// flag — that keeps body prose ("In combat, …") from matching. The type phrase
// is captured loosely and validated against TYPE_WORD; the optional
// parenthetical subtype is preserved on the emitted type (e.g. Goblin's
// "humanoid (goblinoid)" — loreweaver-2ze); a trailing period (if any) is
// stripped.
const META_PATTERN = new RegExp(
  `^(${SIZE_PATTERN})\\s+([^,()]+?)(?:\\s*\\(([^)]*)\\))?,\\s*(.+?)\\.?$`,
);

export const AC_PATTERN = /^Armor Class\s+(\d+)/;
const HP_PATTERN = /^Hit Points\s+(\d+)/;
export const SPEED_PATTERN = /^Speed\s+(.+)$/;
// Every SRD 5.1 creature prints its XP award alongside the CR ("Challenge 1/4
// (50 XP)"); the value is captured so encounter tooling never has to derive it
// — the CR-to-XP table alone cannot reconstruct CR 0, which the source prints
// as either "(0 XP)" or "(10 XP)" per creature (eshyra-o9bd.18.5).
const CHALLENGE_PATTERN = /^Challenge\s+([0-9/]+)(?:\s*\(([\d,]+)\s*XP\))?/;
const ABILITY_HEADER_PATTERN = /^STR\s+DEX\s+CON\s+INT\s+WIS\s+CHA$/i;
// Six "score (modifier)" cells, e.g. "8 (−1) 14 (+2) 10 (+0) …". Only the
// scores are captured; the parenthesized modifier may use a Unicode minus.
const ABILITY_SCORES_PATTERN = new RegExp(
  `^${Array(6).fill('(\\d+)\\s*\\([^)]*\\)').join('\\s+')}$`,
);

export interface FlatLine {
  readonly line: string;
  readonly page: number;
  /**
   * Font height of the source line when the extractor provided one
   * (`PageText.lineHeights`). Used to strip structural heading lines — SRD
   * creature-group headings ("Angels", "Dragons"), running page headers
   * ("Monsters (B)"), and leaked creature names — from the narrative body,
   * since those are printed larger than stat-block content (eshyra-yevt).
   * Undefined for fixture pages built without per-line heights.
   */
  readonly height?: number;
  /**
   * Vertical baseline gap from the previous line in the same column
   * (`PageText.lineGaps`). `null` marks a column/page discontinuity (the first
   * line of a column or page, with no in-column predecessor); `undefined` for
   * fixture pages built without gaps. Lets the narrative parser tell a stat
   * block's mechanical body from the trailing flavor paragraph the SRD prints
   * after it (same font height, so otherwise indistinguishable) and refuse
   * content that arrives across a column/page break (eshyra-76b7).
   */
  readonly gap?: number | null;
}

/**
 * Normalize a raw extracted line so the parser's character-class regexes
 * see clean ASCII text. The SRD 5.1 PDF encodes compound creature names
 * as three-character sequences — ASCII hyphen (U+002D) plus a SOFT HYPHEN
 * (U+00AD, a non-printing discretionary line-break mark) plus a
 * Unicode HYPHEN (U+2010) — which renders as one hyphen visually but
 * breaks the `isLikelyCreatureName` regex and silently drops
 * "Will-o'-Wisp", "Saber-Toothed Tiger", and "Half-Red Dragon Veteran"
 * (loreweaver-w8h). Strip U+00AD entirely (it's non-printing), fold
 * U+2010 onto the ASCII hyphen, and collapse the resulting hyphen run so
 * the canonical single-hyphen form is what the parser and output see.
 *
 * Hidden-Unicode hygiene: every U+00AD / U+2010 in this module is written
 * as an explicit `\uXXXX` escape so source files contain no invisible
 * presentation marks. The regex sources are likewise built from escapes.
 */
const SOFT_HYPHEN_RE = /\u00AD/g;
const UNICODE_HYPHEN_RE = /\u2010/g;
const HYPHEN_RUN_RE = /-{2,}/g;

function normalizeLine(line: string): string {
  return line
    .replace(SOFT_HYPHEN_RE, '')
    .replace(UNICODE_HYPHEN_RE, '-')
    .replace(HYPHEN_RUN_RE, '-');
}

export function flatten(pages: readonly PageText[]): readonly FlatLine[] {
  const out: FlatLine[] = [];
  for (const page of pages) {
    page.lines.forEach((line, idx) => {
      const height = page.lineHeights?.[idx];
      const gap = page.lineGaps?.[idx];
      out.push({
        line: normalizeLine(line),
        page: page.pageNumber,
        ...(height === undefined ? {} : { height }),
        ...(gap === undefined ? {} : { gap }),
      });
    });
  }
  return out;
}

export interface MetaParse {
  readonly size: string;
  readonly type: string;
  readonly alignment: string;
}

export function parseMetaLine(line: string): MetaParse | null {
  const match = META_PATTERN.exec(line.trim());
  if (match === null) return null;
  const baseType = match[2].trim();
  if (TYPE_WORD.test(baseType) === false) return null;
  // Preserve the parenthetical race/subtype qualifier on the emitted type so
  // "Small humanoid (goblinoid), neutral evil" yields "humanoid (goblinoid)"
  // rather than a bare "humanoid" (loreweaver-2ze). Validation runs against the
  // bare kind word; the subtype is reattached only when present.
  const subtype = match[3]?.trim();
  const type =
    subtype !== undefined && subtype.length > 0
      ? `${baseType} (${subtype})`
      : baseType;
  return {
    size: match[1],
    type,
    alignment: match[4].trim(),
  };
}

/** A creature name line is a short, capitalized, non-keyed line. */
function isLikelyCreatureName(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 60) return false;
  if (parseMetaLine(trimmed) !== null) return false;
  if (
    AC_PATTERN.test(trimmed) ||
    HP_PATTERN.test(trimmed) ||
    SPEED_PATTERN.test(trimmed) ||
    CHALLENGE_PATTERN.test(trimmed) ||
    ABILITY_HEADER_PATTERN.test(trimmed)
  ) {
    return false;
  }
  if (/^[A-Z]/.test(trimmed) === false) return false;
  return /^[A-Z][A-Za-z0-9 ,'’\-/()]*$/.test(trimmed);
}

export function findPrecedingNameIdx(
  flat: readonly FlatLine[],
  metaIdx: number,
): number | null {
  let i = metaIdx - 1;
  while (i >= 0 && flat[i].line.trim().length === 0) {
    i--;
  }
  if (i < 0) return null;
  if (isLikelyCreatureName(flat[i].line) === false) return null;
  return i;
}

/**
 * Parse a Speed value ("30 ft., climb 30 ft.") into a mode→feet map. The
 * leading unlabeled segment keys as `walk`; subsequent labeled segments
 * (climb, fly, swim, burrow) key on their label. Any trailing parenthetical
 * such as "(hover)" is ignored. This permissive form is used only by the
 * abbreviated inline `stat-block` parser (`parseStatBlocks`); full creature
 * statlines go through the strict `parseSpeedText` below, which preserves
 * hover and form-conditional parentheticals and fails closed on residue
 * (eshyra-o9bd.18.6.3).
 */
export function parseSpeed(text: string): Record<string, number> {
  const speed: Record<string, number> = {};
  for (const raw of text.split(',')) {
    const segment = raw.trim();
    if (segment.length === 0) continue;
    const match = segment.match(/^([A-Za-z][A-Za-z ]*?\s+)?(\d+)\s*ft/);
    if (match === null) continue;
    const label = match[1]?.trim().toLowerCase();
    const key = label !== undefined && label.length > 0 ? label : 'walk';
    speed[key] = Number.parseInt(match[2], 10);
  }
  return speed;
}

// ---------------------------------------------------------------------------
// Structured statline parsing (eshyra-o9bd.18.6). The AC / HP / Speed lines
// carry semantics beyond their leading integer — armor-source parentheticals,
// conditional/form-specific AC values, HP dice formulas, "(hover)", and
// form-conditional speed sets. Each parser below consumes the ENTIRE value
// text with anchored grammars and returns null on any residue, and
// `parseCreatures` throws on a null for a confirmed creature — so a statline
// shape the model cannot represent fails the import instead of being silently
// flattened. That fail-closed contract is the source side of the
// statline-completeness gate (eshyra-o9bd.18.6.4); the emitted `sourceText` /
// `speedSourceText` fields let the pack-level `creature-statline-fidelity`
// audit re-verify the structured fields against the printed line.
// ---------------------------------------------------------------------------

// One comma-separated AC segment: a value, an optional parenthetical, and an
// optional trailing condition ("in humanoid form", "while prone"). A
// condition must open with one of the reviewed SRD condition lead-ins so
// arbitrary trailing prose can never be silently absorbed as a "condition".
// The parenthetical is classified after the match: digits-first means an
// alternate AC value ("15 with mage armor"), otherwise it is the armor source
// ("natural armor", "chain mail, shield").
const AC_CONDITION = '(?:in|while|when|with)\\s\\S.*';
const AC_SEGMENT_PATTERN = new RegExp(
  `^(\\d+)(?:\\s*\\(([^()]+)\\))?(?:\\s+(${AC_CONDITION}))?$`,
);
const AC_PAREN_VARIANT_PATTERN = new RegExp(`^(\\d+)\\s+(${AC_CONDITION})$`);

/**
 * Split AC value text into comma-separated value segments. Only a top-level
 * comma followed by a digit starts a new segment, so a comma inside an armor
 * parenthetical ("chain mail, shield") or inside a condition never splits.
 */
function splitAcSegments(text: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0 && /^,\s*\d/.test(text.slice(i))) {
      segments.push(text.slice(start, i));
      start = i + 1;
    }
  }
  segments.push(text.slice(start));
  return segments.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Parse a full Armor Class value text ("14 (natural armor), 11 while prone")
 * into its structured form. Returns null when any part of the text falls
 * outside the reviewed SRD statline grammar, so nothing can be dropped
 * silently (eshyra-o9bd.18.6.1).
 */
export function parseArmorClassText(text: string): CreatureArmorClass | null {
  const sourceText = text.trim().replace(/\s+/g, ' ');
  if (sourceText.length === 0) return null;
  const segments = splitAcSegments(sourceText);
  if (segments.length === 0) return null;

  let base: { value: number; source?: string; condition?: string } | undefined;
  const variants: CreatureArmorClassVariant[] = [];

  for (let i = 0; i < segments.length; i++) {
    const match = AC_SEGMENT_PATTERN.exec(segments[i]);
    if (match === null) return null;
    const value = Number.parseInt(match[1], 10);
    const paren = match[2]?.trim();
    const condition = match[3]?.trim();
    let source: string | undefined;
    let parenVariant: CreatureArmorClassVariant | undefined;
    if (paren !== undefined) {
      const variantMatch = AC_PAREN_VARIANT_PATTERN.exec(paren);
      if (variantMatch !== null) {
        parenVariant = {
          value: Number.parseInt(variantMatch[1], 10),
          condition: variantMatch[2].trim(),
        };
      } else {
        source = paren;
      }
    }
    if (i === 0) {
      base = {
        value,
        ...(source !== undefined ? { source } : {}),
        ...(condition !== undefined ? { condition } : {}),
      };
      if (parenVariant !== undefined) {
        // A parenthesized alternate value binds to the base ("12 (15 with
        // mage armor)"); a base that ALSO carries a trailing condition after
        // such a parenthetical has no SRD precedent — fail closed.
        if (condition !== undefined) return null;
        variants.push(parenVariant);
      }
    } else {
      // A later segment is a conditional/alternate value and must say when it
      // applies ("11 while prone", "12 (natural armor) in wolf or hybrid
      // form"); a bare second value would be ambiguous — fail closed. A
      // nested parenthesized variant inside a variant has no SRD precedent.
      if (condition === undefined || parenVariant !== undefined) return null;
      variants.push({
        value,
        ...(source !== undefined ? { source } : {}),
        condition,
      });
    }
  }
  if (base === undefined) return null;
  return {
    value: base.value,
    ...(base.source !== undefined ? { source: base.source } : {}),
    ...(base.condition !== undefined ? { condition: base.condition } : {}),
    ...(variants.length > 0 ? { variants } : {}),
    sourceText,
  };
}

// "135 (18d10 + 36)" — the printed average plus the printed dice formula. The
// operator may be the PDF's Unicode minus (U+2212). Every SRD 5.1 creature
// prints both parts, so a bare integer fails closed (eshyra-o9bd.18.6.2).
const HP_VALUE_PATTERN = /^(\d+)\s*\((\d+d\d+(?:\s*[+−-]\s*\d+)?)\)$/;

/**
 * Parse a full Hit Points value text into `{ value, formula }`, preserving the
 * formula verbatim. Returns null on any other shape.
 */
export function parseHitPointsText(text: string): CreatureHitPoints | null {
  const match = HP_VALUE_PATTERN.exec(text.trim());
  if (match === null) return null;
  return { value: Number.parseInt(match[1], 10), formula: match[2] };
}

// A single speed mode segment. The label set is closed (the four SRD non-walk
// modes); an unknown label fails the whole line closed rather than keying an
// arbitrary word.
const SPEED_MODE_PATTERN = /^(?:(burrow|climb|fly|swim)\s+)?(\d+)\s*ft\.$/;
// A form-conditional speed parenthetical: one or more mode segments, then the
// condition ("40 ft., climb 30 ft. in bear or hybrid form").
const SPEED_VARIANT_PATTERN = /^(.+?\bft\.)\s+((?:in|while|when)\s.+)$/;

/** Strictly parse a comma-separated run of speed modes, or null. */
function parseSpeedModes(text: string): Record<string, number> | null {
  const speed: Record<string, number> = {};
  const segments = text.split(',').map((s) => s.trim());
  if (segments.some((s) => s.length === 0)) return null;
  for (const segment of segments) {
    const match = SPEED_MODE_PATTERN.exec(segment);
    if (match === null) return null;
    const key = match[1] ?? 'walk';
    if (key in speed) return null;
    speed[key] = Number.parseInt(match[2], 10);
  }
  return Object.keys(speed).length > 0 ? speed : null;
}

export interface ParsedSpeedLine {
  readonly speed: Record<string, number>;
  readonly hover?: true;
  readonly speedVariants?: readonly CreatureSpeedVariant[];
}

/**
 * Parse a full Speed value text into unconditional base modes plus the printed
 * "(hover)" flag and any form-conditional variant set (eshyra-o9bd.18.6.3).
 * Trailing parentheticals are peeled right-to-left, then the remainder must be
 * a strict mode run — so the Werebear's "(40 ft., climb 30 ft. in bear or
 * hybrid form)" becomes a variant instead of leaking a bogus unconditional
 * `climb: 30`. Returns null on any unrecognized content.
 */
export function parseSpeedText(text: string): ParsedSpeedLine | null {
  let rest = text.trim();
  let hover = false;
  const variants: CreatureSpeedVariant[] = [];
  for (;;) {
    const match = /^(.*\S)\s+\(([^()]+)\)$/.exec(rest);
    if (match === null) break;
    const paren = match[2].trim();
    if (paren === 'hover') {
      hover = true;
      rest = match[1];
      continue;
    }
    const variantMatch = SPEED_VARIANT_PATTERN.exec(paren);
    if (variantMatch === null) break;
    const modes = parseSpeedModes(variantMatch[1]);
    if (modes === null) break;
    variants.unshift({ condition: variantMatch[2].trim(), speed: modes });
    rest = match[1];
  }
  const speed = parseSpeedModes(rest);
  if (speed === null) return null;
  return {
    speed,
    ...(hover ? { hover: true } : {}),
    ...(variants.length > 0 ? { speedVariants: variants } : {}),
  };
}

export function parseAbilityScores(
  scoresLine: string,
): CreatureAbilityScores | null {
  const match = ABILITY_SCORES_PATTERN.exec(scoresLine.trim());
  if (match === null) return null;
  const n = (i: number): number => Number.parseInt(match[i], 10);
  return {
    strength: n(1),
    dexterity: n(2),
    constitution: n(3),
    intelligence: n(4),
    wisdom: n(5),
    charisma: n(6),
  };
}

// ---------------------------------------------------------------------------
// Narrative body sections (Traits, Actions, Reactions, Legendary Actions). After
// the Challenge line a 5e stat block prints a run of bold-lead-in named entries:
// an implicit Traits run, then header-delimited Actions / Reactions / Legendary
// Actions sections. This mirrors the proven `parseAncestries` "Label. body"
// splitter — a short Title-Case label, then a period and body, with a
// sentence-completeness guard so a wrapped body sentence that merely starts with
// a capitalized phrase ("Constitution saving throw. On a failure …") is not
// mis-promoted to a new entry (eshyra-yevt).
// ---------------------------------------------------------------------------

// "Name. body": a Title-Case label (letters with single internal space /
// apostrophe / slash / hyphen separators) plus an optional usage parenthetical
// ("(3/Day)", "(Recharge 5-6)", "(Costs 2 Actions)"), then a period, a space,
// and body text. The apostrophes (ASCII U+0027 and curly U+2019) let names like
// "Devil's Sight" match; the parenthetical is captured loosely so its digits and
// punctuation do not break the name.
const ENTRY_LABEL_RE =
  /^([A-Z][A-Za-z]+(?:[ '’/-][A-Za-z]+)*(?:\s*\([^)]*\))?)\.\s+(\S.*)$/;

// Words that begin body prose, never an entry name — guards against a wrapped
// sentence whose first word is capitalized being read as a label. Mirrors the
// parseAncestries / parseFeats prose-starter guard, extended with the stat-block
// attack-line lead-ins ("Hit:", "Melee", "Ranged").
const ENTRY_PROSE_STARTERS = new Set([
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
  'It',
  'Its',
  'He',
  'She',
  'They',
  'Each',
  'Any',
  'All',
  'Whenever',
  'Until',
  'After',
  'Before',
  'Hit',
  'Melee',
  'Ranged',
  'Some',
  'Of',
  'That',
  'Their',
  'Otherwise',
  'Make',
  'Roll',
]);

// Sentence-terminal punctuation. A real entry body ends with one of these and
// the SRD breaks to a fresh line before the next bold "Name." lead-in, so a
// "Name."-shaped line only opens a new entry once the open entry's prose has
// ended. Includes the curly close-quote (U+2019) and close-double-quote
// (U+201D) the PDF uses.
const ENTRY_TERMINAL_PUNCTUATION = /[.!?:)”"’']$/;

// A spell-list line inside an Innate Spellcasting / Spellcasting trait
// ("At will: …", "1/day each: …", "3rd level (3 slots): …"). These do NOT end
// in terminal punctuation, so without this the next trait after a spell list
// (e.g. the Deva's Magic Resistance) would be swallowed as a continuation. A
// trailing spell-list line is treated as a completed body so the next label
// opens a new entry.
const SPELL_LIST_LINE =
  /^(?:at will|cantrips?|\d+\s*\/\s*day|\d(?:st|nd|rd|th)(?:[ -]?level)?)\b/i;

// A spell-list group header ANYWHERE in a line ("… magic missile 2/day each:
// plane shift (self only),"): after re-flow a header regularly starts
// mid-line, so the backward tail scan in `entryBodyComplete` cannot rely on
// the line-anchored form above (eshyra-o9bd.18.7.3).
const SPELL_LIST_CONTENT =
  /(?:^|\s)(?:At will|Cantrips \(at will\)|\d+\s*\/\s*day(?: each)?|\d(?:st|nd|rd|th) level \(\d+ slots?\))\s*:/i;

// Lines printed larger than stat-block content (>= ~12pt) are structural
// headings — SRD creature-group headings ("Angels" ~14pt, "Black Dragon"
// ~12pt), running page headers ("Monsters (B)" ~18pt), and leaked creature
// names (~26pt). Stat-block body and section headers ("Actions") are <= 10.8pt,
// so this threshold strips heading noise from the narrative body without
// touching any real entry text (eshyra-yevt). Applied only when the extractor
// supplied a height.
const MIN_STRUCTURAL_HEADING_HEIGHT = 11.5;

// A line whose leading vertical gap (`FlatLine.gap`) is at least this multiple
// of its own font height starts a NEW paragraph rather than continuing the
// previous line. In SRD 5.1 stat blocks an intra-paragraph wrap sits ~1.2x the
// line height below its predecessor, while the flavor paragraph the SRD prints
// after the last action/reaction is set off by ~2.8x (≈27pt vs ≈9.8pt height).
// 1.6x sits cleanly between the two, so it fires on the flavor break without
// splitting a wrapped mechanical sentence (eshyra-76b7). Applied only when the
// extractor supplied a numeric gap (a `null` gap is a column/page break, handled
// separately); section headers and bold "Name." lead-ins are matched by text
// before this is consulted, so their (also-large) gaps are irrelevant here.
const PARAGRAPH_BREAK_GAP_RATIO = 1.6;

// Fallback absolute paragraph-break gap for fixture pages that supply gaps but
// no per-line height. Chosen between the intra-paragraph (~12pt) and flavor
// (~27pt) gaps of the real SRD body font.
const PARAGRAPH_BREAK_GAP_ABS = 18;

/**
 * True when `gap` (the line's leading vertical gap) marks a new paragraph within
 * the same column. A `null`/`undefined` gap is NOT a paragraph break here — it
 * is a column/page discontinuity the caller treats as a hard boundary.
 */
function isParagraphBreak(
  gap: number | null | undefined,
  height?: number,
): boolean {
  if (gap === null || gap === undefined) return false;
  const threshold =
    height !== undefined && height > 0
      ? height * PARAGRAPH_BREAK_GAP_RATIO
      : PARAGRAPH_BREAK_GAP_ABS;
  return gap >= threshold;
}

// Section header lines that switch the active narrative section. SRD 5.1 prints
// no in-body "Lair Actions" / "Regional Effects" headers (those appear only in
// the general Legendary Creatures rules on p260), but they are recognized as a
// stop boundary as defense-in-depth.
const ACTIONS_HEADER = 'Actions';
const REACTIONS_HEADER = 'Reactions';
const LEGENDARY_HEADER = 'Legendary Actions';
const DEFERRED_HEADERS = new Set(['Lair Actions', 'Regional Effects']);

// A boxed "Variant: <name>" sidebar caption (eshyra-70xr). Used both to stop a
// creature's narrative (so the sidebar body does not pollute it) and to start a
// variant extraction.
const VARIANT_CAPTION_RE = /^Variant:\s+(.+)$/;

interface EntryLabelMatch {
  readonly name: string;
  readonly body: string;
}

function matchEntryLabel(line: string): EntryLabelMatch | null {
  const m = ENTRY_LABEL_RE.exec(line.trim());
  if (m === null) return null;
  const name = m[1].trim();
  // Guard on the name WITHOUT its parenthetical: a real entry name is a short
  // noun phrase, while the usage qualifier ("Recharges after a Short or Long
  // Rest") can be long and must not count toward the word/length cap.
  const bare = name.replace(/\s*\([^)]*\)\s*$/, '');
  const words = bare.split(/\s+/);
  if (bare.length > 45 || words.length > 6) return null;
  if (ENTRY_PROSE_STARTERS.has(words[0])) return null;
  return { name, body: m[2].trim() };
}

/** True when the open entry body's last non-blank line ends an entry. */
function entryBodyComplete(body: readonly string[]): boolean {
  for (let i = body.length - 1; i >= 0; i--) {
    const trimmed = body[i].trim();
    if (trimmed.length === 0) continue;
    if (
      ENTRY_TERMINAL_PUNCTUATION.test(trimmed) ||
      SPELL_LIST_LINE.test(trimmed)
    ) {
      return true;
    }
    // A WRAPPED spell-list continuation ("… ray of enfeeblement," /
    // "… entangle") ends no sentence and does not itself start with a group
    // header, so the head-of-line checks above miss it and the trait printed
    // after the list (Night Hag / Unicorn "Magic Resistance", Oni "Magic
    // Weapons") was swallowed as a continuation (eshyra-o9bd.18.7.3). The
    // body is still complete when the open entry's TAIL is a spell list:
    // walk back — a group-header line found before any sentence-terminated
    // line means the dangling line is list content, not an unfinished
    // sentence.
    for (let j = i - 1; j >= 0; j--) {
      const prior = body[j].trim();
      if (prior.length === 0) continue;
      if (SPELL_LIST_CONTENT.test(prior)) return true;
      if (ENTRY_TERMINAL_PUNCTUATION.test(prior)) return false;
    }
    return false;
  }
  return true;
}

interface MutableEntry {
  readonly name: string;
  body: string[];
}

function toEntry(entry: MutableEntry): CreatureStatBlockEntry {
  // Re-flow wrapped lines; preserve a blank-line paragraph break as "\n\n"
  // (multi-paragraph entries like Enslave or the legendary-action intro).
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const raw of entry.body) {
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
  if (current.length > 0) paragraphs.push(current.join(' '));
  return { name: entry.name, text: paragraphs.join('\n\n').trim() };
}

interface NarrativeSections {
  readonly traits?: readonly CreatureStatBlockEntry[];
  readonly actions?: readonly CreatureStatBlockEntry[];
  readonly reactions?: readonly CreatureStatBlockEntry[];
  readonly legendaryActions?: CreatureLegendaryActions;
  /** Trailing flavor/description prose printed after the stat block. */
  readonly description?: string;
}

/** A post-Challenge narrative line carrying its paragraph-gap metadata. */
interface NarrativeLine {
  readonly text: string;
  readonly gap?: number | null;
  readonly height?: number;
}

// Markers that only mechanical stat-block prose carries — a save DC, an attack
// lead-in, a saving-throw clause, an attack "Hit:" rider, or dice notation. A
// trailing paragraph that contains any of these is a wrapped mechanical entry
// body, NOT flavor, so it is never split into `description` (eshyra-76b7). This
// is what keeps Djinni's column-wrapped Whirlwind escape clause ("…by
// succeeding on a DC 18 Strength check.") attached to its action while Giant
// Shark's mechanic-free description ("A giant shark is 30 feet long…") is split
// off. The same predicate backs the audit guard against lore/document prose
// bleeding the other way (see `srdAudit`). Kept deliberately specific so it
// never rejects legitimate descriptive prose (which carries no DC/dice/attack
// vocabulary).
const MECHANICAL_PROSE_MARKER =
  /\bDC\s*\d|Weapon Attack:|Spell Attack:|saving throw|\bHit:\s|\b\d+d\d+\b/;

/**
 * True when a narrative line opens a structured stat-block element — a section
 * header, a deferred/variant boundary, or a bold "Name." entry lead-in. Used to
 * find where the mechanical sections end so the trailing flavor paragraph can be
 * split off behind the LAST such line (eshyra-76b7).
 */
function isStructuralNarrativeLine(text: string): boolean {
  return (
    text === ACTIONS_HEADER ||
    text === REACTIONS_HEADER ||
    text === LEGENDARY_HEADER ||
    DEFERRED_HEADERS.has(text) ||
    VARIANT_CAPTION_RE.test(text) ||
    matchEntryLabel(text) !== null
  );
}

/**
 * Locate the trailing flavor paragraph and return the index in `lines` where it
 * begins, or -1 when there is none. The flavor block is the maximal suffix that
 * follows the LAST structured line (header or entry lead-in) and begins at an
 * in-column paragraph break (`isParagraphBreak`). Everything before it — the
 * last entry's own wrapped body — stays mechanical; everything from it on is
 * the SRD's descriptive prose. A `null`-gap (column/page discontinuity) line is
 * never a flavor start: foreign cross-boundary content is cut upstream, and a
 * creature's own flavor is set off by an in-column gap, not a column break.
 */
function findFlavorStart(lines: readonly NarrativeLine[]): number {
  let lastStructural = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isStructuralNarrativeLine(lines[i].text)) lastStructural = i;
  }
  let candidate = -1;
  let candidateFromColumnBreak = false;
  for (let i = lastStructural + 1; i < lines.length; i++) {
    const line = lines[i];
    if (isParagraphBreak(line.gap, line.height)) {
      candidate = i;
      break;
    }
    // A column/page break (`null` gap) can also start the trailing flavor when
    // the stat block's last mechanical line ended a sentence and the new column
    // opens a fresh capitalized sentence — e.g. Giant Shark, whose description
    // begins at the top of the next column (eshyra-76b7). Requiring the previous
    // line to be sentence-complete keeps a mid-sentence mechanical wrap across a
    // column (the previous line ends with no terminal punctuation) attached to
    // its entry. Foreign cross-slice content is already cut upstream
    // (`truncateAtForeignPageJump`), so a `null` gap here is an in-flow column
    // break, not appendix prose.
    if (
      line.gap === null &&
      i > 0 &&
      ENTRY_TERMINAL_PUNCTUATION.test(lines[i - 1].text) &&
      /^[A-Z]/.test(line.text)
    ) {
      candidate = i;
      candidateFromColumnBreak = true;
      break;
    }
  }
  if (candidate < 0) return -1;
  // A column-break candidate is weaker evidence than an in-column paragraph gap:
  // a mechanical action body can also wrap to the top of a new column right
  // after a complete sentence (Djinni's Whirlwind escape clause). Reject it when
  // the trailing block carries mechanical vocabulary so such a wrap stays with
  // its action. The in-column paragraph-break branch needs no such guard — the
  // larger gap is unambiguous SRD flavor typography, and real descriptions can
  // legitimately mention dice (Giant Fire Beetle's glands "shed light for 1d6
  // days"), which this marker would otherwise reject (eshyra-76b7).
  if (candidateFromColumnBreak) {
    const blockText = lines
      .slice(candidate)
      .map((l) => l.text)
      .join(' ');
    if (MECHANICAL_PROSE_MARKER.test(blockText)) return -1;
  }
  return candidate;
}

/**
 * Parse the Traits / Actions / Reactions / Legendary Actions sections from a
 * confirmed stat-block body. Input is the full FlatLine body (meta line
 * onward); parsing begins after the Challenge line and ignores structural
 * heading lines by font height.
 */
export function parseNarrativeSections(
  body: readonly FlatLine[],
): NarrativeSections {
  let challengeIdx = -1;
  for (let i = 0; i < body.length; i++) {
    if (CHALLENGE_PATTERN.test(body[i].line.trim())) {
      challengeIdx = i;
      break;
    }
  }
  if (challengeIdx < 0) return {};

  const collected: NarrativeLine[] = [];
  for (let i = challengeIdx + 1; i < body.length; i++) {
    const entry = body[i];
    if (
      entry.height !== undefined &&
      entry.height >= MIN_STRUCTURAL_HEADING_HEIGHT
    ) {
      continue; // structural heading (group/running header / leaked name)
    }
    const trimmed = entry.line.trim();
    if (trimmed.length > 0) {
      collected.push({ text: trimmed, gap: entry.gap, height: entry.height });
    }
  }

  // Split the trailing flavor paragraph (eshyra-76b7) off the mechanical body so
  // it lands in `description` instead of being appended to the last action /
  // reaction. The flavor lines are re-flowed into paragraphs on the same
  // in-column paragraph-break signal used to find the block's start.
  let description: string | undefined;
  const flavorStart = findFlavorStart(collected);
  if (flavorStart >= 0) {
    const flavorLines = collected.slice(flavorStart);
    const paragraphs: string[] = [];
    let para: string[] = [];
    for (let i = 0; i < flavorLines.length; i++) {
      const fl = flavorLines[i];
      if (i > 0 && isParagraphBreak(fl.gap, fl.height) && para.length > 0) {
        paragraphs.push(para.join(' '));
        para = [];
      }
      para.push(fl.text);
    }
    if (para.length > 0) paragraphs.push(para.join(' '));
    const joined = paragraphs.join('\n\n').trim();
    if (joined.length > 0) description = joined;
    collected.length = flavorStart;
  }

  const lines = collected.map((l) => l.text);

  const traits: CreatureStatBlockEntry[] = [];
  const actions: CreatureStatBlockEntry[] = [];
  const reactions: CreatureStatBlockEntry[] = [];
  const legendaryEntries: CreatureStatBlockEntry[] = [];
  const legendaryIntro: string[] = [];

  type Section = 'traits' | 'actions' | 'reactions' | 'legendary' | 'deferred';
  let section: Section = 'traits';
  let current: MutableEntry | null = null;

  const bucketFor = (s: Section): CreatureStatBlockEntry[] | null => {
    switch (s) {
      case 'traits':
        return traits;
      case 'actions':
        return actions;
      case 'reactions':
        return reactions;
      case 'legendary':
        return legendaryEntries;
      default:
        return null;
    }
  };
  const flush = () => {
    if (current !== null) {
      bucketFor(section)?.push(toEntry(current));
      current = null;
    }
  };

  for (const line of lines) {
    if (line === ACTIONS_HEADER) {
      flush();
      section = 'actions';
      continue;
    }
    if (line === REACTIONS_HEADER) {
      flush();
      section = 'reactions';
      continue;
    }
    if (line === LEGENDARY_HEADER) {
      flush();
      section = 'legendary';
      continue;
    }
    if (DEFERRED_HEADERS.has(line)) {
      flush();
      section = 'deferred';
      continue;
    }
    // A boxed "Variant: …" sidebar ends the creature's own narrative; its body
    // is extracted separately and attached as `variants` (eshyra-70xr), so the
    // variant's own bold-lead-in lines must not pollute this creature's traits /
    // actions (e.g. the Giant Rat's duplicate "Bite", the Swarm of Insects
    // additions printed under Swarm of Ravens).
    if (VARIANT_CAPTION_RE.test(line)) {
      flush();
      section = 'deferred';
      continue;
    }
    if (section === 'deferred') continue;

    const match = matchEntryLabel(line);
    if (
      match !== null &&
      (current === null || entryBodyComplete(current.body))
    ) {
      flush();
      current = { name: match.name, body: [match.body] };
    } else if (current !== null) {
      current.body.push(line);
    } else if (section === 'legendary') {
      // Intro paragraph printed before the first legendary option.
      legendaryIntro.push(line);
    }
    // A pre-entry line in any other section (none observed in SRD 5.1) is
    // dropped rather than misattributed.
  }
  flush();

  const out: {
    traits?: CreatureStatBlockEntry[];
    actions?: CreatureStatBlockEntry[];
    reactions?: CreatureStatBlockEntry[];
    legendaryActions?: CreatureLegendaryActions;
    description?: string;
  } = {};
  if (traits.length > 0) out.traits = traits;
  if (actions.length > 0) out.actions = actions;
  if (reactions.length > 0) out.reactions = reactions;
  if (legendaryEntries.length > 0 || legendaryIntro.length > 0) {
    const legendaryDescription = legendaryIntro.join(' ').trim();
    out.legendaryActions = {
      ...(legendaryDescription.length > 0
        ? { description: legendaryDescription }
        : {}),
      entries: legendaryEntries,
    };
  }
  if (description !== undefined) out.description = description;
  return out;
}

// ---------------------------------------------------------------------------
// Creature variant sidebars (eshyra-70xr). SRD 5.1 prints two boxed "Variant:"
// notes in the creature chapters. Each sits in the body of whatever creature
// precedes it, but modifies a specific creature, so a reviewed caption -> target
// map attaches it correctly: Diseased Giant Rats (in the Giant Rat's body)
// targets the Giant Rat; Insect Swarms (printed after Swarm of Ravens, the last
// swarm) targets the Swarm of Insects. A new "Variant:" caption in a creature
// chapter that is not in this map fails closed.
// ---------------------------------------------------------------------------
const CREATURE_VARIANT_TARGETS = new Map<string, string>([
  ['Diseased Giant Rats', 'Giant Rat'],
  ['Insect Swarms', 'Swarm of Insects'],
]);

interface VariantExtraction {
  readonly targetCreature: string;
  readonly name: string;
  readonly text: string;
  readonly sourcePage: number;
}

/**
 * Scan a flattened body for "Variant: …" sidebars and return each with the
 * creature it modifies (from the reviewed target map). The sidebar body runs
 * from the caption to the next structural heading (creature name by font height,
 * a meta line, another variant caption, or EOF); wrapped lines are re-joined.
 * Throws on a caption absent from the reviewed map.
 */
export function parseCreatureVariants(
  flat: readonly FlatLine[],
): VariantExtraction[] {
  const out: VariantExtraction[] = [];
  for (let i = 0; i < flat.length; i++) {
    const caption = VARIANT_CAPTION_RE.exec(flat[i].line.trim());
    if (caption === null) continue;
    const name = caption[1].trim();
    const target = CREATURE_VARIANT_TARGETS.get(name);
    if (target === undefined) {
      throw new Error(
        `creature variant "${flat[i].line.trim()}" at page ${flat[i].page} is not in the reviewed variant-target map (eshyra-70xr)`,
      );
    }
    // Collect the sidebar body until the next structural boundary.
    const bodyLines: string[] = [];
    for (let j = i + 1; j < flat.length; j++) {
      const entry = flat[j];
      const line = entry.line.trim();
      if (
        (entry.height !== undefined &&
          entry.height >= MIN_STRUCTURAL_HEADING_HEIGHT) ||
        VARIANT_CAPTION_RE.test(line) ||
        parseMetaLine(line) !== null ||
        // A creature name line immediately followed by its meta line (handles
        // fixtures built without per-line heights).
        (j + 1 < flat.length &&
          parseMetaLine(flat[j + 1].line.trim()) !== null &&
          isLikelyCreatureName(line))
      ) {
        break;
      }
      if (line.length > 0) bodyLines.push(line);
    }
    out.push({
      targetCreature: target,
      name,
      text: bodyLines.join(' ').trim(),
      sourcePage: flat[i].page,
    });
  }
  return out;
}

interface CreatureCandidate {
  readonly nameIdx: number;
  readonly metaIdx: number;
  /** First body line: `metaIdx + 1`, or `metaIdx + 2` when the printed
   * meta line wrapped and the alignment continuation was consumed. */
  readonly bodyStartIdx: number;
  readonly name: string;
  readonly meta: MetaParse;
}

/**
 * Alignment words that may continue a wrapped meta line. Lycanthropes'
 * long "(human, shapechanger)" subtype pushes the alignment past the
 * column width, so the SRD wraps it: Werewolf prints "Medium humanoid
 * (human, shapechanger), chaotic" / "evil" and Werebear "…, neutral" /
 * "good". Reading only the first line silently truncated both alignments
 * (caught by the region-ledger emission gate, eshyra-o9bd.18.9.2). A body
 * line can never start with these bare lowercase words — every real stat
 * block continues with "Armor Class …" — so consuming a whole line of
 * alignment vocabulary immediately after the meta line is safe.
 */
const ALIGNMENT_CONTINUATION_WORDS = new Set([
  'good',
  'evil',
  'neutral',
  'lawful',
  'chaotic',
  'unaligned',
  'any',
  'non-lawful',
  'non-good',
  'non-evil',
  'alignment',
  'or',
]);

function alignmentContinuation(line: string | undefined): string | null {
  if (line === undefined) return null;
  const trimmed = line.trim();
  if (trimmed.length === 0 || /[A-Z]/.test(trimmed)) return null;
  const words = trimmed.replace(/[.,]/g, '').split(/\s+/);
  return words.every((word) => ALIGNMENT_CONTINUATION_WORDS.has(word))
    ? trimmed.replace(/\.$/, '')
    : null;
}

interface StatBlockFields {
  /**
   * Verbatim AC value text (after the "Armor Class " label), with a value that
   * wraps onto following extracted lines re-joined — the three lycanthropes
   * with dual-form AC wrap "in <beast> and/or hybrid form" onto the next line
   * (eshyra-o9bd.18.6.1). Presence still confirms the stat-block signature.
   */
  readonly armorClassText?: string;
  /** Verbatim HP value text (after the "Hit Points " label). */
  readonly hitPointsText?: string;
  /** Verbatim Speed value text (after the "Speed " label). */
  readonly speedText?: string;
  readonly challengeRating?: string;
  readonly experiencePoints?: number;
  readonly abilityScores?: CreatureAbilityScores;
}

// ---------------------------------------------------------------------------
// Keyed defensive / sense fields (Saving Throws … Languages). In a 5e stat
// block these sit in a fixed-order run between the ability-score row and the
// Challenge line; everything after Challenge is the trait / action body, owned
// by a later slice (eshyra-4a7.5b). Two real SRD wrinkles make naive per-line
// capture wrong:
//   - A value WRAPS across extracted lines (Deva's "Damage Resistances radiant;
//     bludgeoning, piercing," + "and slashing from nonmagical attacks").
//   - The PDF column flow sometimes MERGES the next label onto the previous
//     value's last line (Wereboar's "… silvered weapons Senses passive
//     Perception 12"), so a label is not always at the start of a line.
// Both are handled by joining the bounded region into one string and slicing on
// label POSITIONS (mirrors `parseStatBlocks`' clean-text path), rather than
// anchoring to line starts. Bounding to (abilityRow, Challenge) keeps the
// ability table above and the trait prose below from contributing values.
// ---------------------------------------------------------------------------

/**
 * Emitted field -> the source labels that introduce it, longest/most-specific
 * first. Most fields use the SRD's plural label; a few stat blocks print the
 * singular form for a conditional (the Archmage's "Damage Resistance … (from
 * stoneskin)"), so the singular is accepted as an alias (eshyra-ez6v).
 */
const KEYED_FIELDS: ReadonlyArray<
  readonly [field: string, labels: readonly string[]]
> = [
  ['savingThrows', ['Saving Throws']],
  ['skills', ['Skills']],
  ['damageVulnerabilities', ['Damage Vulnerabilities', 'Damage Vulnerability']],
  ['damageResistances', ['Damage Resistances', 'Damage Resistance']],
  ['damageImmunities', ['Damage Immunities', 'Damage Immunity']],
  ['conditionImmunities', ['Condition Immunities', 'Condition Immunity']],
  ['senses', ['Senses']],
  ['languages', ['Languages']],
];

export interface CreatureKeyedFields {
  readonly savingThrows?: string;
  readonly skills?: string;
  readonly damageVulnerabilities?: string;
  readonly damageResistances?: string;
  readonly damageImmunities?: string;
  readonly conditionImmunities?: string;
  readonly senses?: string;
  readonly languages?: string;
}

/** First body line that is an ability-score row, or -1. */
function findAbilityRowIdx(lines: readonly string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (parseAbilityScores(lines[i].trim()) !== null) return i;
  }
  return -1;
}

/**
 * Extract the keyed defensive / sense fields from a confirmed stat-block body.
 * The scan is bounded to the lines strictly between the ability-score row and
 * the first following Challenge line, so neither the ability table above nor
 * the trait/action prose below can contribute a spurious value. Within that
 * region, each field's value runs from just after its label to the start of the
 * next field's label (in source position order), so wrapped and merged lines
 * are both reassembled correctly.
 */
export function extractCreatureKeyedFields(
  body: readonly string[],
): CreatureKeyedFields {
  const abilityIdx = findAbilityRowIdx(body);
  if (abilityIdx < 0) return {};
  let challengeIdx = -1;
  for (let i = abilityIdx + 1; i < body.length; i++) {
    if (CHALLENGE_PATTERN.test(body[i].trim())) {
      challengeIdx = i;
      break;
    }
  }
  const end = challengeIdx < 0 ? body.length : challengeIdx;

  const region = body
    .slice(abilityIdx + 1, end)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join(' ');

  // Locate the earliest occurrence of each present field's label.
  const found: Array<{ field: string; idx: number; labelLen: number }> = [];
  for (const [field, labels] of KEYED_FIELDS) {
    for (const label of labels) {
      const idx = region.indexOf(label);
      if (idx >= 0) {
        found.push({ field, idx, labelLen: label.length });
        break;
      }
    }
  }
  found.sort((a, b) => a.idx - b.idx);

  const out: Record<string, string> = {};
  for (let i = 0; i < found.length; i++) {
    const { field, idx, labelLen } = found[i];
    const valueEnd = i + 1 < found.length ? found[i + 1].idx : region.length;
    const value = region.slice(idx + labelLen, valueEnd).trim();
    if (value.length > 0) out[field] = value;
  }
  return out as CreatureKeyedFields;
}

/** Scan a stat-block body for the keyed stat lines. First match wins. */
function readStatBlock(lines: readonly string[]): StatBlockFields {
  let acIdx = -1;
  let hpIdx = -1;
  let hitPointsText: string | undefined;
  let speedText: string | undefined;
  let challengeRating: string | undefined;
  let experiencePoints: number | undefined;
  let abilityScores: CreatureAbilityScores | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (acIdx < 0) {
      if (AC_PATTERN.test(line)) {
        acIdx = i;
        continue;
      }
    }
    if (hpIdx < 0) {
      const m = HP_PATTERN.exec(line);
      if (m !== null) {
        hpIdx = i;
        hitPointsText = line.replace(/^Hit Points\s+/, '');
        continue;
      }
    }
    if (speedText === undefined) {
      const m = SPEED_PATTERN.exec(line);
      if (m !== null) {
        speedText = m[1].trim();
        continue;
      }
    }
    if (abilityScores === undefined) {
      // Score row is highly specific (six "N (modifier)" cells) so we can
      // recognize it directly without relying on positional adjacency to the
      // STR/DEX/… header line. Real SRD 5.1 column-aware extraction can
      // interleave a prose line from the adjacent column between the header
      // and the score row, which broke the older "header then next non-blank"
      // heuristic and silently dropped ~50% of stat blocks (loreweaver-w8h).
      const parsed = parseAbilityScores(line);
      if (parsed !== null) {
        abilityScores = parsed;
        continue;
      }
    }
    if (challengeRating === undefined) {
      const m = CHALLENGE_PATTERN.exec(line);
      if (m !== null) {
        challengeRating = m[1];
        if (m[2] !== undefined) {
          experiencePoints = Number.parseInt(m[2].replaceAll(',', ''), 10);
        }
      }
    }
  }

  // The AC value runs from its own line up to the Hit Points line: the three
  // lycanthropes with dual-form AC wrap the trailing "in <beast> and/or hybrid
  // form" clause onto the next extracted line (eshyra-o9bd.18.6.1). A joined
  // foreign line cannot slip through silently — the strict AC grammar in
  // `parseArmorClassText` fails the import on any unrecognized content.
  let armorClassText: string | undefined;
  if (acIdx >= 0) {
    const end = hpIdx > acIdx ? hpIdx : acIdx + 1;
    armorClassText = lines
      .slice(acIdx, end)
      .map((l) => l.trim())
      .join(' ')
      .replace(/^Armor Class\s+/, '');
  }

  return {
    armorClassText,
    hitPointsText,
    speedText,
    challengeRating,
    experiencePoints,
    abilityScores,
  };
}

/**
 * Truncate a creature body at the first line that jumps more than one page past
 * the running content page (eshyra-76b7). A real stat block is contiguous —
 * consecutive body lines stay on the same or the next page — so a larger jump
 * means foreign content from a later slice has been concatenated in. The worked
 * case: Ogre Zombie ends the Monsters chapter on p357, and the Appendix MM-A
 * intro prose ("This appendix contains statistics …") sits on p366 BEFORE the
 * first appendix creature (Ape). Without this cut that intro lands in Ogre
 * Zombie's body and is appended to its Morningstar action. The intro is the
 * appendix's, not a creature's; it is dropped here and intentionally not
 * attached to any creature (see the importer source-coverage notes).
 */
function truncateAtForeignPageJump(
  lines: readonly FlatLine[],
  anchorPage: number,
): readonly FlatLine[] {
  let prevPage = anchorPage;
  for (let k = 0; k < lines.length; k++) {
    if (lines[k].page - prevPage > 1) return lines.slice(0, k);
    prevPage = lines[k].page;
  }
  return lines;
}

/**
 * Parse creature stat blocks from a narrowed `PageText[]`. Returns a
 * `CreatureExtraction[]` sorted by name.
 *
 * The same stat-block grammar drives both the Monsters chapter / Appendix MM-A
 * (`category: 'monster'`, the default) and Appendix MM-B: Nonplayer Characters
 * (`category: 'npc'`, passed by the orchestrator for the MM-B slice —
 * loreweaver-bn0): an NPC stat block has the identical AC/HP/ability-table
 * signature, so the only difference is the provenance tag the caller supplies.
 * `category` is stamped onto every extraction this call returns.
 */
export function parseCreatures(
  pages: readonly PageText[],
  category: CreatureCategory = 'monster',
): CreatureExtraction[] {
  const flat = flatten(pages);

  // First pass: every meta-line candidate with a valid preceding name line.
  const candidates: CreatureCandidate[] = [];
  flat.forEach((entry, metaIdx) => {
    const meta = parseMetaLine(entry.line);
    if (meta === null) return;
    const nameIdx = findPrecedingNameIdx(flat, metaIdx);
    if (nameIdx === null) return;
    // A wrapped meta line continues its alignment on the next physical line
    // (Werewolf's "…, chaotic" / "evil"); consume it so the alignment is
    // complete and the continuation never leaks into the body.
    const continuation = alignmentContinuation(flat[metaIdx + 1]?.line);
    candidates.push({
      nameIdx,
      metaIdx,
      bodyStartIdx: continuation === null ? metaIdx + 1 : metaIdx + 2,
      name: flat[nameIdx].line.trim(),
      meta:
        continuation === null
          ? meta
          : { ...meta, alignment: `${meta.alignment} ${continuation}` },
    });
  });

  // Second pass: each candidate's body runs from its meta line to the next
  // candidate's name (exclusive), or to EOF for the last candidate.
  const out: CreatureExtraction[] = [];
  let taxonomyCursor = 0;
  let activeTaxonomy:
    | ReturnType<typeof creatureTaxonomySpecForLine>
    | undefined;
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    for (let j = taxonomyCursor; j < candidate.nameIdx; j++) {
      const entry = flat[j];
      const taxonomy = creatureTaxonomySpecForLine(entry.line, entry.height);
      if (taxonomy !== undefined) {
        activeTaxonomy = taxonomy;
      } else if (
        entry.line.trim() === 'Half-Dragon Template' &&
        classifyTier(entry.height) === 'subsection'
      ) {
        activeTaxonomy = undefined;
      }
    }
    taxonomyCursor = candidate.nameIdx + 1;
    const next = candidates[i + 1];
    const nextCandidateIdx = next?.nameIdx ?? flat.length;
    const templateBoundaryIdx = flat.findIndex(
      (entry, index) =>
        index > candidate.metaIdx &&
        index < nextCandidateIdx &&
        entry.line.trim() === 'Half-Dragon Template' &&
        classifyTier(entry.height) === 'subsection',
    );
    const bodyEnd =
      templateBoundaryIdx < 0 ? nextCandidateIdx : templateBoundaryIdx;
    const bodyLines = truncateAtForeignPageJump(
      flat.slice(candidate.bodyStartIdx, bodyEnd),
      flat[candidate.metaIdx].page,
    );
    const body = bodyLines.map((f) => f.line);
    const fields = readStatBlock(body);

    // Not a creature unless the structural signature is present.
    if (
      fields.armorClassText === undefined ||
      fields.hitPointsText === undefined ||
      fields.abilityScores === undefined
    ) {
      continue;
    }
    // Confirmed creature: Speed and Challenge are mandatory in a real stat
    // block, so their absence is a parse error, not a non-creature.
    const sourcePage = flat[candidate.metaIdx].page;
    if (fields.speedText === undefined) {
      throw new Error(
        `creature "${candidate.name}" at page ${sourcePage} is missing a Speed line`,
      );
    }
    if (fields.challengeRating === undefined) {
      throw new Error(
        `creature "${candidate.name}" at page ${sourcePage} is missing a Challenge line`,
      );
    }
    // Every SRD creature Challenge line prints its XP award; a missing value
    // means the line was mis-extracted, so fail closed (eshyra-o9bd.18.5).
    if (fields.experiencePoints === undefined) {
      throw new Error(
        `creature "${candidate.name}" at page ${sourcePage} has a Challenge line without an XP award`,
      );
    }
    // Structured statline parsing is fail-closed (eshyra-o9bd.18.6): a
    // confirmed creature whose AC / HP / Speed value text falls outside the
    // reviewed grammar throws rather than flattening or dropping semantics.
    const armorClass = parseArmorClassText(fields.armorClassText);
    if (armorClass === null) {
      throw new Error(
        `creature "${candidate.name}" at page ${sourcePage} has an Armor Class value outside the reviewed statline grammar: "${fields.armorClassText}" (eshyra-o9bd.18.6.1)`,
      );
    }
    const hitPoints = parseHitPointsText(fields.hitPointsText);
    if (hitPoints === null) {
      throw new Error(
        `creature "${candidate.name}" at page ${sourcePage} has a Hit Points value without the printed average + dice formula: "${fields.hitPointsText}" (eshyra-o9bd.18.6.2)`,
      );
    }
    const speedLine = parseSpeedText(fields.speedText);
    if (speedLine === null) {
      throw new Error(
        `creature "${candidate.name}" at page ${sourcePage} has a Speed value outside the reviewed statline grammar: "${fields.speedText}" (eshyra-o9bd.18.6.3)`,
      );
    }

    const keyed = extractCreatureKeyedFields(body);
    const narrative = parseNarrativeSections(bodyLines);

    out.push({
      name: candidate.name,
      category,
      ...(activeTaxonomy === undefined
        ? {}
        : { familyPath: [...activeTaxonomy.familyPath] }),
      size: candidate.meta.size,
      type: candidate.meta.type,
      alignment: candidate.meta.alignment,
      armorClass,
      hitPoints,
      speed: speedLine.speed,
      ...(speedLine.hover === true ? { hover: true as const } : {}),
      ...(speedLine.speedVariants !== undefined
        ? { speedVariants: speedLine.speedVariants }
        : {}),
      speedSourceText: fields.speedText,
      challengeRating: fields.challengeRating,
      experiencePoints: fields.experiencePoints,
      abilityScores: fields.abilityScores,
      ...keyed,
      ...narrative,
      sourcePage,
    });
    if (candidate.name === activeTaxonomy?.endCreature) {
      activeTaxonomy = undefined;
    }
  }

  // Attach variant sidebars to the creatures they modify (eshyra-70xr). A
  // variant's target must be among the parsed creatures; otherwise the reviewed
  // map is stale, so fail closed rather than silently drop the variant.
  const variants = parseCreatureVariants(flat);
  if (variants.length > 0) {
    const byTarget = new Map<string, CreatureVariant[]>();
    for (const v of variants) {
      const list = byTarget.get(v.targetCreature) ?? [];
      list.push({ name: v.name, text: v.text });
      byTarget.set(v.targetCreature, list);
    }
    for (const [target] of byTarget) {
      if (!out.some((c) => c.name === target)) {
        throw new Error(
          `creature variant target "${target}" was not parsed as a creature (eshyra-70xr)`,
        );
      }
    }
    for (let i = 0; i < out.length; i++) {
      const attached = byTarget.get(out[i].name);
      if (attached !== undefined) {
        out[i] = { ...out[i], variants: attached };
      }
    }
  }

  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}
