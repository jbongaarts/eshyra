/**
 * Spell-entry parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` already narrowed to the spell-descriptions
 * section of the SRD; output is a `SpellExtraction[]` with stable shape and
 * ordering (sorted by name). The class-spell-list cross-reference is a
 * separate pass — see `parseSpellClassLists` in the same module.
 *
 * The parser is deliberately conservative: it identifies a spell entry by the
 * level-school marker line (e.g. "Conjuration cantrip" / "3rd-level abjuration"),
 * walks one line back to capture the name, and collects keyed metadata fields
 * (Casting Time, Range, Components, Duration) plus the description body. Each
 * spell boundary is the next marker; the parser does not try to detect a
 * "spells section ends here" marker on its own — the caller is responsible
 * for slicing input pages to the spell-descriptions range.
 */

import type {
  PageText,
  SpellCasterClass,
  SpellClassIndex,
  SpellExtraction,
} from './types.js';

const SCHOOLS = [
  'abjuration',
  'conjuration',
  'divination',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation',
] as const;
type School = (typeof SCHOOLS)[number];

const SCHOOL_PATTERN = SCHOOLS.join('|');

const CANTRIP_MARKER = new RegExp(
  `^(${SCHOOL_PATTERN}) cantrip(?: \\(ritual\\))?$`,
  'i',
);
const LEVELED_MARKER = new RegExp(
  `^(\\d+)(?:st|nd|rd|th)-level (${SCHOOL_PATTERN})(?: \\(ritual\\))?$`,
  'i',
);

const KEYED_FIELDS = [
  'Casting Time',
  'Range',
  'Components',
  'Duration',
] as const;
type KeyedField = (typeof KEYED_FIELDS)[number];

const CASTER_CLASSES: readonly SpellCasterClass[] = [
  'Bard',
  'Cleric',
  'Druid',
  'Paladin',
  'Ranger',
  'Sorcerer',
  'Warlock',
  'Wizard',
];

const CLASS_SECTION_HEADER = new RegExp(
  `^(${CASTER_CLASSES.join('|')}) Spells$`,
);
const CANTRIP_LEVEL_HEADER = /^Cantrips \(0 Level\)$/;
const NUMBERED_LEVEL_HEADER = /^(\d+)(?:st|nd|rd|th) Level$/;

interface FlatLine {
  readonly line: string;
  readonly page: number;
  readonly lineIndex: number;
}

/**
 * pdfjs emits every word-internal hyphen in the SRD 5.1 PDF as a cluster of
 * invisible presentation hyphens, corresponding to the embedded font's
 * discretionary-break ligature. The cluster mixes:
 *   - U+002D HYPHEN-MINUS (the only visible/ASCII member)
 *   - U+00AD SOFT HYPHEN
 *   - U+2010 HYPHEN
 *   - U+2011 NON-BREAKING HYPHEN
 * Because the non-ASCII members are invisible when rendered, the raw extracted
 * text for a leveled-marker heading such as `4th-level evocation` actually
 * carries the full cluster where the lone ASCII hyphen appears, and the
 * `LEVELED_MARKER` regex (which demands a single ASCII hyphen) never matches.
 * The effect: every leveled spell after a cantrip is silently absorbed into
 * that cantrip's body (loreweaver-qqc: Fire Bolt swallowed the entire F-* / G-*
 * leveled run up to the next cantrip "Guidance"), and reflowed description text
 * reads with ugly clusters where a `10-foot` should be. Collapsing any run of
 * these hyphen code points to a single ASCII hyphen normalizes both
 * heading-detection and body text in one place. Fixture inputs that already
 * carry a plain ASCII hyphen round-trip unchanged.
 *
 * The character class is written with explicit `\uXXXX` escapes so the source
 * never embeds the invisible code points this bug is about.
 */
const PDF_HYPHEN_CLUSTER_OR_HYPHEN_RUN = /[-\u00AD\u2010\u2011]+/g;

function normalizeHyphenCluster(line: string): string {
  return line.replace(PDF_HYPHEN_CLUSTER_OR_HYPHEN_RUN, '-');
}

function flatten(pages: readonly PageText[]): readonly FlatLine[] {
  const out: FlatLine[] = [];
  for (const page of pages) {
    for (const [lineIndex, line] of page.lines.entries()) {
      out.push({
        line: normalizeHyphenCluster(line),
        page: page.pageNumber,
        lineIndex: lineIndex + (page.sourceLineOffset ?? 0),
      });
    }
  }
  return out;
}

function isLevelSchoolMarker(line: string): boolean {
  return CANTRIP_MARKER.test(line) || LEVELED_MARKER.test(line);
}

interface MarkerParse {
  readonly level: number;
  readonly school: School;
  readonly ritual: boolean;
}

function parseLevelSchoolMarker(line: string): MarkerParse {
  const cantrip = CANTRIP_MARKER.exec(line);
  if (cantrip) {
    return {
      level: 0,
      school: cantrip[1].toLowerCase() as School,
      ritual: /\(ritual\)/i.test(line),
    };
  }
  const leveled = LEVELED_MARKER.exec(line);
  if (leveled) {
    return {
      level: Number.parseInt(leveled[1], 10),
      school: leveled[2].toLowerCase() as School,
      ritual: /\(ritual\)/i.test(line),
    };
  }
  throw new Error(`not a level-school marker: ${line}`);
}

interface KeyedFieldMatch {
  readonly field: KeyedField;
  readonly value: string;
}

/**
 * SRD 5.1 PDF typo: Contagion's metadata block uses "Component:" (singular)
 * for its V/S list — a single-spell typesetting error in the published PDF.
 * Mapping the singular form to the canonical Components field lets the spell
 * parse; every other spell uses the plural form.
 */
const KEYED_FIELD_ALIASES: ReadonlyMap<string, KeyedField> = new Map([
  ['Component', 'Components'],
]);

function matchKeyedField(line: string): KeyedFieldMatch | undefined {
  for (const key of KEYED_FIELDS) {
    const prefix = `${key}:`;
    if (line.startsWith(prefix)) {
      return { field: key, value: line.slice(prefix.length).trim() };
    }
  }
  for (const [alias, field] of KEYED_FIELD_ALIASES) {
    const prefix = `${alias}:`;
    if (line.startsWith(prefix)) {
      return { field, value: line.slice(prefix.length).trim() };
    }
  }
  return undefined;
}

interface MetadataParse {
  readonly castingTime: string;
  readonly range: string;
  readonly components: readonly string[];
  readonly componentMaterials?: string;
  readonly duration: string;
  readonly descriptionLines: readonly string[];
}

function parseMetadataAndBody(lines: readonly string[]): MetadataParse {
  const values: Partial<Record<KeyedField, string>> = {};
  let i = 0;
  let lastField: KeyedField | undefined;
  // Capture metadata: each field starts with its key; subsequent non-key,
  // non-blank lines are appended to the previous field's value (handling
  // wrapped lines like multi-line component materials).
  while (i < lines.length) {
    const line = lines[i];
    if (line.length === 0) {
      i++;
      continue;
    }
    const keyed = matchKeyedField(line);
    if (keyed !== undefined) {
      values[keyed.field] = keyed.value;
      lastField = keyed.field;
      i++;
      continue;
    }
    if (lastField !== undefined && allFieldsCaptured(values) === false) {
      // Continuation of the last keyed field's value.
      values[lastField] = `${values[lastField] ?? ''} ${line}`.trim();
      i++;
      continue;
    }
    // All metadata captured; remainder is the description body.
    break;
  }
  if (allFieldsCaptured(values) === false) {
    throw new Error(
      `incomplete spell metadata; got fields: ${Object.keys(values).join(', ') || '(none)'}`,
    );
  }
  const descriptionLines = lines.slice(i);
  const { components, materials } = parseComponents(
    values.Components as string,
  );
  return {
    castingTime: values['Casting Time'] as string,
    range: values.Range as string,
    components,
    ...(materials === undefined ? {} : { componentMaterials: materials }),
    duration: values.Duration as string,
    descriptionLines,
  };
}

function allFieldsCaptured(
  values: Partial<Record<KeyedField, string>>,
): boolean {
  return KEYED_FIELDS.every((k) => values[k] !== undefined);
}

const COMPONENT_TOKENS = new Set(['V', 'S', 'M']);

function parseComponents(value: string): {
  components: readonly string[];
  materials?: string;
} {
  // Split on the first `(` to separate the V/S/M list from any material text.
  const parenStart = value.indexOf('(');
  let listPart: string;
  let materialPart: string | undefined;
  if (parenStart === -1) {
    listPart = value;
  } else {
    listPart = value.slice(0, parenStart).trim();
    const tail = value.slice(parenStart + 1);
    const parenEnd = tail.lastIndexOf(')');
    materialPart = (parenEnd === -1 ? tail : tail.slice(0, parenEnd)).trim();
  }
  // Strip a trailing comma left by "V, S, M (..." after dropping the list part.
  const cleanedList = listPart.replace(/,\s*$/, '').trim();
  const tokens = cleanedList
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const token of tokens) {
    if (COMPONENT_TOKENS.has(token) === false) {
      throw new Error(
        `unknown spell component token: ${JSON.stringify(token)}`,
      );
    }
  }
  return {
    components: tokens,
    ...(materialPart === undefined || materialPart.length === 0
      ? {}
      : { materials: materialPart }),
  };
}

const HIGHER_LEVELS_MARKER = 'At Higher Levels.';
const CANTRIP_UPGRADE_MARKER = 'Cantrip Upgrade.';

function joinDescription(lines: readonly string[]): string {
  // Re-flow wrapped lines: collapse intra-paragraph newlines to spaces, keep
  // blank lines as paragraph separators. The SRD body wraps lines mid-sentence,
  // so a literal join with `\n` reproduces PDF wrap that isn't part of the
  // authored text.
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

function splitHigherLevels(description: string): {
  core: string;
  higherLevels?: string;
} {
  for (const marker of [HIGHER_LEVELS_MARKER, CANTRIP_UPGRADE_MARKER]) {
    const idx = description.indexOf(marker);
    if (idx !== -1) {
      const core = description.slice(0, idx).trim();
      const higher = description.slice(idx + marker.length).trim();
      return higher.length === 0 ? { core } : { core, higherLevels: higher };
    }
  }
  return { core: description };
}

function isLikelySpellName(line: string): boolean {
  if (line.length === 0 || line.length > 80) return false;
  if (isLevelSchoolMarker(line)) return false;
  if (matchKeyedField(line) !== undefined) return false;
  // First non-space character must be an uppercase letter; we accept letters,
  // digits, spaces, hyphens, slashes, apostrophes, and parens.
  if (/^[A-Z]/.test(line) === false) return false;
  return /^[A-Z][A-Za-z0-9 ,'’\-:/()]*$/.test(line);
}

/**
 * A confirmed spell entry: a level-school marker with a valid spell-name
 * predecessor. Used to delimit spell-body slices in two passes — the body of
 * entry N ends at entry N+1's `nameIdx` (exclusive), or at `flat.length` for
 * the last entry.
 */
interface SpellEntry {
  readonly markerIdx: number;
  readonly nameIdx: number;
  readonly name: string;
}

/**
 * Defense-in-depth: even if the caller passes content that wasn't sliced to
 * the spell-descriptions section, body collection stops at the first line
 * matching one of these patterns. Primary safety is the orchestrator in
 * `index.ts` which uses `sliceSection` (see `sections.ts`); these patterns
 * exist so a single-layer failure doesn't silently produce contaminated
 * spell records.
 */
const SPELL_BODY_STOP_PATTERNS: readonly RegExp[] = [
  new RegExp(`^(${CASTER_CLASSES.join('|')}) Spells$`),
  /^Spell Lists$/,
];

function findBodyEnd(
  flat: readonly FlatLine[],
  startInclusive: number,
  endExclusive: number,
): number {
  for (let i = startInclusive; i < endExclusive; i++) {
    const line = flat[i].line.trim();
    if (SPELL_BODY_STOP_PATTERNS.some((p) => p.test(line))) {
      return i;
    }
  }
  return endExclusive;
}

function findPrecedingNameIdx(
  flat: readonly FlatLine[],
  markerIdx: number,
): number | null {
  let i = markerIdx - 1;
  while (i >= 0 && flat[i].line.length === 0) {
    i--;
  }
  if (i < 0) return null;
  const candidate = flat[i].line.trim();
  if (isLikelySpellName(candidate) === false) return null;
  return i;
}

export function parseSpells(pages: readonly PageText[]): SpellExtraction[] {
  const flat = flatten(pages);

  // First pass: confirm each level-school marker has a valid spell-name line
  // immediately preceding it (skipping blanks). Markers without a valid name
  // are silently skipped — they may be markers inside body prose ("...a 3rd-
  // level evocation spell...") rather than headings.
  const entries: SpellEntry[] = [];
  flat.forEach((entry, i) => {
    if (isLevelSchoolMarker(entry.line) === false) return;
    const nameIdx = findPrecedingNameIdx(flat, i);
    if (nameIdx === null) return;
    entries.push({ markerIdx: i, nameIdx, name: flat[nameIdx].line.trim() });
  });

  // Second pass: each spell's body runs from (markerIdx + 1) up to (but not
  // including) the next entry's `nameIdx`. For the last entry, the body runs
  // through `flat.length`. This correctly preserves the final spell's last
  // line and handles any number of blank lines between one spell's body and
  // the next spell's name.
  const out: SpellExtraction[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const next = entries[i + 1];
    const bodyEnd = findBodyEnd(
      flat,
      entry.markerIdx + 1,
      next?.nameIdx ?? flat.length,
    );
    const body = flat.slice(entry.markerIdx + 1, bodyEnd).map((e) => e.line);

    const marker = parseLevelSchoolMarker(flat[entry.markerIdx].line);
    let metadata: MetadataParse;
    try {
      metadata = parseMetadataAndBody(body);
    } catch (err) {
      throw new Error(
        `failed to parse spell "${entry.name}" at page ${flat[entry.markerIdx].page}: ${(err as Error).message}`,
      );
    }

    const description = joinDescription(metadata.descriptionLines);
    const { core, higherLevels } = splitHigherLevels(description);

    out.push({
      name: entry.name,
      level: marker.level,
      school: marker.school,
      ritual: marker.ritual,
      castingTime: metadata.castingTime,
      range: metadata.range,
      components: metadata.components,
      ...(metadata.componentMaterials === undefined
        ? {}
        : { componentMaterials: metadata.componentMaterials }),
      duration: metadata.duration,
      description: core,
      ...(higherLevels === undefined ? {} : { higherLevels }),
      sourcePage: flat[entry.markerIdx].page,
    });
  }

  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

/**
 * Parse class spell lists (e.g. "Bard Spells", "Cleric Spells") and return a
 * spell-name → caster-classes index. Each class section starts with a header
 * line "<Class> Spells", followed by level subsection headers ("Cantrips (0
 * Level)" or "<N>th Level"), followed by spell-name-per-line entries.
 *
 * The caller is responsible for slicing input to the class-lists section.
 */
/** One spell-list entry as printed: a spell name under a class/level heading. */
export interface SpellClassLevelEntry {
  readonly spellName: string;
  readonly casterClass: SpellCasterClass;
  /** 0 for a cantrip, otherwise the printed "Nth Level" number. */
  readonly level: number;
  readonly sourcePage: number;
  readonly sourceLineIndex: number;
  readonly groupSourcePage: number;
  readonly groupSourceLineIndex: number;
  readonly classSourcePage: number;
  readonly classSourceLineIndex: number;
}

/**
 * Scan the SRD 5.1 per-class spell-list pages (p105-113) and return every
 * (spell name, class, level) triple exactly as printed, in reading order.
 * The lower-level primitive both `parseSpellClassLists` (which only needs
 * name -> classes, for `applyClassLists`) and the spell-list parity audit
 * (eshyra-erf5.2, which also needs level) are built on, so both read the same
 * scan instead of drifting apart.
 */
export function parseSpellClassLevelLists(
  pages: readonly PageText[],
): readonly SpellClassLevelEntry[] {
  const flat = flatten(pages);
  const out: SpellClassLevelEntry[] = [];
  let currentClass: SpellCasterClass | undefined;
  let currentLevel: number | undefined;
  let groupSourcePage: number | undefined;
  let groupSourceLineIndex: number | undefined;
  let classSourcePage: number | undefined;
  let classSourceLineIndex: number | undefined;
  for (const { line, page, lineIndex } of flat) {
    if (line.length === 0) {
      continue;
    }
    const classHeader = CLASS_SECTION_HEADER.exec(line);
    if (classHeader !== null) {
      currentClass = classHeader[1] as SpellCasterClass;
      currentLevel = undefined;
      classSourcePage = page;
      classSourceLineIndex = lineIndex;
      continue;
    }
    if (currentClass === undefined) continue;
    if (CANTRIP_LEVEL_HEADER.test(line)) {
      currentLevel = 0;
      groupSourcePage = page;
      groupSourceLineIndex = lineIndex;
      continue;
    }
    const numberedLevel = NUMBERED_LEVEL_HEADER.exec(line);
    if (numberedLevel !== null) {
      currentLevel = Number(numberedLevel[1]);
      groupSourcePage = page;
      groupSourceLineIndex = lineIndex;
      continue;
    }
    if (currentLevel === undefined) continue;
    if (isLikelySpellName(line) === false) {
      // Unknown line shape inside a class section; conservatively reset state
      // so we don't pick up unrelated text as spell names.
      currentLevel = undefined;
      continue;
    }
    if (
      groupSourcePage === undefined ||
      groupSourceLineIndex === undefined ||
      classSourcePage === undefined ||
      classSourceLineIndex === undefined
    ) {
      throw new Error(
        `spell-list entry "${line}" has no source class/level heading position`,
      );
    }
    out.push({
      spellName: line.trim(),
      casterClass: currentClass,
      level: currentLevel,
      sourcePage: page,
      sourceLineIndex: lineIndex,
      groupSourcePage,
      groupSourceLineIndex,
      classSourcePage,
      classSourceLineIndex,
    });
  }
  return out;
}

export function parseSpellClassLists(
  pages: readonly PageText[],
): SpellClassIndex {
  const index = new Map<string, Set<SpellCasterClass>>();
  for (const entry of parseSpellClassLevelLists(pages)) {
    let bucket = index.get(entry.spellName);
    if (bucket === undefined) {
      bucket = new Set();
      index.set(entry.spellName, bucket);
    }
    bucket.add(entry.casterClass);
  }
  return index;
}

/**
 * Apply class-list information to spell extractions. Spells missing from the
 * index keep an empty `classes` array on the eventual record; callers can
 * decide whether to warn.
 */
export function applyClassLists(
  spells: readonly SpellExtraction[],
  index: SpellClassIndex,
): {
  withClasses: SpellExtraction[];
  classes: ReadonlyMap<string, readonly SpellCasterClass[]>;
} {
  const out: SpellExtraction[] = spells.map((spell) => spell);
  const classes = new Map<string, readonly SpellCasterClass[]>();
  const classesByNormalizedName = new Map<string, Set<SpellCasterClass>>();
  const sourceNamesByNormalizedName = new Map<string, Set<string>>();
  for (const [sourceName, sourceClasses] of index) {
    const normalizedName = normalizeSpellListName(sourceName);
    let classBucket = classesByNormalizedName.get(normalizedName);
    if (classBucket === undefined) {
      classBucket = new Set();
      classesByNormalizedName.set(normalizedName, classBucket);
    }
    for (const casterClass of sourceClasses) {
      classBucket.add(casterClass);
    }
    let sourceNameBucket = sourceNamesByNormalizedName.get(normalizedName);
    if (sourceNameBucket === undefined) {
      sourceNameBucket = new Set();
      sourceNamesByNormalizedName.set(normalizedName, sourceNameBucket);
    }
    sourceNameBucket.add(sourceName);
  }

  const emittedNormalizedNames = new Set(
    out.map((spell) => normalizeSpellListName(spell.name)),
  );
  const unresolvedSourceNames = [...sourceNamesByNormalizedName.entries()]
    .filter(([normalizedName]) => !emittedNormalizedNames.has(normalizedName))
    .flatMap(([, sourceNames]) => [...sourceNames])
    .sort();
  if (unresolvedSourceNames.length > 0) {
    throw new SpellClassListCoverageError(unresolvedSourceNames);
  }

  for (const spell of out) {
    const bucket = classesByNormalizedName.get(
      normalizeSpellListName(spell.name),
    );
    const sorted: SpellCasterClass[] = bucket
      ? [...bucket].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      : [];
    classes.set(spell.name, sorted);
  }
  return { withClasses: out, classes };
}

export function normalizeSpellListName(name: string): string {
  return name.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
}

export class SpellClassListCoverageError extends Error {
  constructor(unresolvedSourceNames: readonly string[]) {
    super(
      `SRD spell-list entries did not resolve to emitted spell records: ${unresolvedSourceNames.join(', ')}`,
    );
    this.name = 'SpellClassListCoverageError';
  }
}
