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
  CreatureCategory,
  CreatureExtraction,
  CreatureLegendaryActions,
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
const CHALLENGE_PATTERN = /^Challenge\s+([0-9/]+)/;
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
      out.push({
        line: normalizeLine(line),
        page: page.pageNumber,
        ...(height === undefined ? {} : { height }),
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
 * such as "(hover)" is ignored.
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

// Lines printed larger than stat-block content (>= ~12pt) are structural
// headings — SRD creature-group headings ("Angels" ~14pt, "Black Dragon"
// ~12pt), running page headers ("Monsters (B)" ~18pt), and leaked creature
// names (~26pt). Stat-block body and section headers ("Actions") are <= 10.8pt,
// so this threshold strips heading noise from the narrative body without
// touching any real entry text (eshyra-yevt). Applied only when the extractor
// supplied a height.
const MIN_STRUCTURAL_HEADING_HEIGHT = 11.5;

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
    return (
      ENTRY_TERMINAL_PUNCTUATION.test(trimmed) || SPELL_LIST_LINE.test(trimmed)
    );
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

  const lines: string[] = [];
  for (let i = challengeIdx + 1; i < body.length; i++) {
    const entry = body[i];
    if (
      entry.height !== undefined &&
      entry.height >= MIN_STRUCTURAL_HEADING_HEIGHT
    ) {
      continue; // structural heading (group/running header / leaked name)
    }
    const trimmed = entry.line.trim();
    if (trimmed.length > 0) lines.push(trimmed);
  }

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
  } = {};
  if (traits.length > 0) out.traits = traits;
  if (actions.length > 0) out.actions = actions;
  if (reactions.length > 0) out.reactions = reactions;
  if (legendaryEntries.length > 0 || legendaryIntro.length > 0) {
    const description = legendaryIntro.join(' ').trim();
    out.legendaryActions = {
      ...(description.length > 0 ? { description } : {}),
      entries: legendaryEntries,
    };
  }
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
  readonly name: string;
  readonly meta: MetaParse;
}

interface StatBlockFields {
  readonly armorClass?: number;
  readonly hitPoints?: number;
  readonly speed?: Record<string, number>;
  readonly challengeRating?: string;
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
  let armorClass: number | undefined;
  let hitPoints: number | undefined;
  let speed: Record<string, number> | undefined;
  let challengeRating: string | undefined;
  let abilityScores: CreatureAbilityScores | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (armorClass === undefined) {
      const m = AC_PATTERN.exec(line);
      if (m !== null) {
        armorClass = Number.parseInt(m[1], 10);
        continue;
      }
    }
    if (hitPoints === undefined) {
      const m = HP_PATTERN.exec(line);
      if (m !== null) {
        hitPoints = Number.parseInt(m[1], 10);
        continue;
      }
    }
    if (speed === undefined) {
      const m = SPEED_PATTERN.exec(line);
      if (m !== null) {
        speed = parseSpeed(m[1]);
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
      }
    }
  }

  return { armorClass, hitPoints, speed, challengeRating, abilityScores };
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
    candidates.push({
      nameIdx,
      metaIdx,
      name: flat[nameIdx].line.trim(),
      meta,
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
    const bodyLines = flat.slice(candidate.metaIdx + 1, bodyEnd);
    const body = bodyLines.map((f) => f.line);
    const fields = readStatBlock(body);

    // Not a creature unless the structural signature is present.
    if (
      fields.armorClass === undefined ||
      fields.hitPoints === undefined ||
      fields.abilityScores === undefined
    ) {
      continue;
    }
    // Confirmed creature: Speed and Challenge are mandatory in a real stat
    // block, so their absence is a parse error, not a non-creature.
    const sourcePage = flat[candidate.metaIdx].page;
    if (fields.speed === undefined) {
      throw new Error(
        `creature "${candidate.name}" at page ${sourcePage} is missing a Speed line`,
      );
    }
    if (fields.challengeRating === undefined) {
      throw new Error(
        `creature "${candidate.name}" at page ${sourcePage} is missing a Challenge line`,
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
      armorClass: fields.armorClass,
      hitPoints: fields.hitPoints,
      speed: fields.speed,
      challengeRating: fields.challengeRating,
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
