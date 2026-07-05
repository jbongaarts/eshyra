/**
 * Structured projection of creature `Spellcasting` / `Innate Spellcasting`
 * traits (eshyra-o9bd.18.7.3).
 *
 * The SRD prints these traits in two closed grammars:
 *
 *   - class-list form: "The acolyte is a 1st-level spellcaster. Its
 *     spellcasting ability is Wisdom (spell save DC 12, +4 to hit with spell
 *     attacks). The acolyte has following cleric spells prepared: Cantrips
 *     (at will): … 1st level (3 slots): …"
 *   - innate form: "The lamia's innate spellcasting ability is Charisma
 *     (spell save DC 13). It can innately cast the following spells,
 *     requiring no material components. At will: … 3/day each: … 1/day: …"
 *     plus the single-spell mephit variant ("The mephit can innately cast
 *     sleep, requiring no material components. Its innate spellcasting
 *     ability is Charisma." with the use limit in the trait name).
 *
 * The projection is fail-closed the same way `spellGrants` is
 * (eshyra-vk23.1): every captured spell token must resolve to a real
 * `spell:<slug>` record via the supplied resolver, and the whole trait text
 * after the list lead-in must be consumed by recognized groups. Any residue
 * or unresolved token makes the parse return `undefined`, leaving the trait
 * prose-only rather than emitting an incomplete spell list as authoritative
 * gameplay data.
 */

export type SpellRefResolver = (candidate: string) => string | undefined;

export interface CreatureSpellGroupSpell {
  readonly ref: string;
  /** Verbatim parenthetical qualifier, e.g. "self only", "any humanoid form". */
  readonly note?: string;
  /** True when the source marks the spell with `*` (see `footnote`). */
  readonly footnoteMarked?: boolean;
}

export interface CreatureSpellGroup {
  readonly frequency: 'cantrip' | 'at-will' | 'per-day' | 'slot-level';
  /** For `per-day`: the printed use count (the N in "N/day"). */
  readonly uses?: number;
  /** For `per-day`: true when printed as "N/day each" (per-spell uses). */
  readonly each?: boolean;
  /** For `slot-level`: the spell level and printed slot count. */
  readonly level?: number;
  readonly slots?: number;
  readonly spells: readonly CreatureSpellGroupSpell[];
}

export interface CreatureSpellcasting {
  readonly mode: 'innate' | 'prepared';
  readonly ability: string;
  readonly saveDC?: number;
  readonly attackBonus?: number;
  /** Class-list form only: the printed caster level. */
  readonly casterLevel?: number;
  /** Class-list form only: whose spell list is prepared ("cleric", "wizard"). */
  readonly listClass?: string;
  /** Printed component waiver, when any. */
  readonly componentRequirement?: 'no-material' | 'verbal-only' | 'none';
  readonly groups: readonly CreatureSpellGroup[];
  /** Verbatim `*` footnote sentence, when the list carries one. */
  readonly footnote?: string;
}

const ABILITY_RE =
  /\b(?:innate )?spellcasting ability is (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\b/;

const SAVE_DC_RE =
  /\(spell save DC (\d+)(?:, ([+-]\d+) to hit with spell attacks)?\)/;

const CASTER_LEVEL_RE = /\bis an? (\d+)(?:st|nd|rd|th)-level spellcaster\b/;

const LIST_CLASS_RE = /\bhas (?:the )?following ([a-z]+) spells prepared:/;

/**
 * One group header inside the flattened spell list. The list is re-flowed to
 * a single line, so headers are located by a global scan and each group's
 * spells are the text between its header and the next (or end of text).
 */
const GROUP_HEADER_RE =
  /(Cantrips \(at will\):|At will:|(\d+)\/day( each)?:|(\d+)(?:st|nd|rd|th) level \((\d+) slots?\):)/g;

const COMPONENT_REQUIREMENT_PATTERNS: readonly (readonly [
  RegExp,
  CreatureSpellcasting['componentRequirement'],
])[] = [
  [/requir(?:ing|es) no material components/, 'no-material'],
  [/needs? only verbal components/, 'verbal-only'],
  [/requiring only verbal components/, 'verbal-only'],
  [/requiring no components/, 'none'],
];

function parseComponentRequirement(
  text: string,
): CreatureSpellcasting['componentRequirement'] {
  for (const [pattern, value] of COMPONENT_REQUIREMENT_PATTERNS) {
    if (pattern.test(text)) return value;
  }
  return undefined;
}

/** Split a group's spell run on top-level commas (parentheticals protected). */
function splitSpellTokens(run: string): readonly string[] {
  const tokens: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of run) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      tokens.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  tokens.push(current);
  return tokens
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function parseSpellToken(
  token: string,
  resolve: SpellRefResolver,
): CreatureSpellGroupSpell | undefined {
  let rest = token.trim();
  let footnoteMarked = false;
  // "mage armor,*" / "stoneskin*" — the asterisk may follow a comma the
  // token-splitter already consumed.
  if (/\*$/.test(rest)) {
    footnoteMarked = true;
    rest = rest.replace(/,?\s*\*$/, '').trim();
  }
  let note: string | undefined;
  const noteMatch = /^(.*?)\s*\(([^)]+)\)$/.exec(rest);
  if (noteMatch !== null) {
    rest = noteMatch[1].trim();
    note = noteMatch[2].trim();
  }
  if (rest.length === 0) return undefined;
  const ref = resolve(rest);
  if (ref === undefined) return undefined;
  const spell: { ref: string; note?: string; footnoteMarked?: boolean } = {
    ref,
  };
  if (note !== undefined) spell.note = note;
  if (footnoteMarked) spell.footnoteMarked = true;
  return spell;
}

interface GroupHeaderMatch {
  readonly index: number;
  readonly length: number;
  readonly group: Omit<CreatureSpellGroup, 'spells'>;
}

function findGroupHeaders(text: string): readonly GroupHeaderMatch[] {
  const headers: GroupHeaderMatch[] = [];
  GROUP_HEADER_RE.lastIndex = 0;
  for (const match of text.matchAll(GROUP_HEADER_RE)) {
    const [full] = match;
    let group: Omit<CreatureSpellGroup, 'spells'>;
    if (full.startsWith('Cantrips')) {
      group = { frequency: 'cantrip' };
    } else if (full === 'At will:') {
      group = { frequency: 'at-will' };
    } else if (match[2] !== undefined) {
      group = {
        frequency: 'per-day',
        uses: Number(match[2]),
        ...(match[3] !== undefined ? { each: true } : {}),
      };
    } else {
      group = {
        frequency: 'slot-level',
        level: Number(match[4]),
        slots: Number(match[5]),
      };
    }
    headers.push({
      index: match.index,
      length: full.length,
      group,
    });
  }
  return headers;
}

/**
 * Parse the flattened spell-list region (everything from the first group
 * header to the end of the trait text). Returns `undefined` when any token
 * fails to resolve — fail-closed, the trait stays prose-only.
 */
function parseGroups(
  text: string,
  resolve: SpellRefResolver,
): { groups: CreatureSpellGroup[]; footnote?: string } | undefined {
  let body = text;
  let footnote: string | undefined;
  // A trailing "*The archmage casts these spells on itself before combat."
  // footnote would otherwise ride the last group's spell run.
  const footnoteMatch = /\s\*((?:The|It|She|He)\b.+)$/.exec(body);
  if (footnoteMatch !== null) {
    footnote = `*${footnoteMatch[1].trim()}`;
    body = body.slice(0, footnoteMatch.index);
  }
  const headers = findGroupHeaders(body);
  if (headers.length === 0) return undefined;
  const groups: CreatureSpellGroup[] = [];
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    const start = header.index + header.length;
    const end = i + 1 < headers.length ? headers[i + 1].index : body.length;
    const run = body.slice(start, end).trim();
    const tokens = splitSpellTokens(run);
    if (tokens.length === 0) return undefined;
    const spells: CreatureSpellGroupSpell[] = [];
    for (const token of tokens) {
      const spell = parseSpellToken(token, resolve);
      if (spell === undefined) return undefined;
      spells.push(spell);
    }
    groups.push({ ...header.group, spells });
  }
  return { groups, footnote };
}

/** The single-spell mephit form: "The mephit can innately cast <spell>[ (spell save DC N)], requiring …". */
const SINGLE_INNATE_RE =
  /can innately cast ([a-z][a-z' /-]+?)(?: \(spell save DC (\d+)\))?, requiring/;

/**
 * Parse a creature `Spellcasting` / `Innate Spellcasting` trait into a
 * structured projection, or `undefined` when the text does not match the
 * reviewed grammars or any spell fails to resolve.
 */
export function parseCreatureSpellcasting(
  name: string,
  text: string,
  resolve: SpellRefResolver | undefined,
): CreatureSpellcasting | undefined {
  if (resolve === undefined) return undefined;
  if (!/^(Innate )?Spellcasting\b/.test(name)) return undefined;
  const abilityMatch = ABILITY_RE.exec(text);
  if (abilityMatch === null) return undefined;
  const ability = abilityMatch[1].toLowerCase();
  const dcMatch = SAVE_DC_RE.exec(text);
  const casterLevelMatch = CASTER_LEVEL_RE.exec(text);
  const listClassMatch = LIST_CLASS_RE.exec(text);
  const mode: CreatureSpellcasting['mode'] =
    casterLevelMatch !== null || listClassMatch !== null
      ? 'prepared'
      : 'innate';
  const componentRequirement = parseComponentRequirement(text);

  let groups: CreatureSpellGroup[];
  let footnote: string | undefined;
  const headers = findGroupHeaders(text);
  if (headers.length > 0) {
    const parsed = parseGroups(text.slice(headers[0].index), resolve);
    if (parsed === undefined) return undefined;
    groups = parsed.groups;
    footnote = parsed.footnote;
    // The archmage prints extra always-on spells before the prepared list:
    // "can cast disguise self and invisibility at will and has the
    // following wizard spells prepared". Capture them as an at-will group.
    const extraAtWill =
      /\bcan cast ([a-z][a-z' /-]+(?: and [a-z][a-z' /-]+)*) at will\b/.exec(
        text.slice(0, headers[0].index),
      );
    if (extraAtWill !== null) {
      const spells: CreatureSpellGroupSpell[] = [];
      for (const token of extraAtWill[1].split(/ and /)) {
        const spell = parseSpellToken(token, resolve);
        if (spell === undefined) return undefined;
        spells.push(spell);
      }
      groups.unshift({ frequency: 'at-will', spells });
    }
  } else {
    // Single-spell innate form; the use limit rides the trait name
    // ("Innate Spellcasting (1/Day)"), projected separately as `usage`.
    const single = SINGLE_INNATE_RE.exec(text);
    if (single === null) return undefined;
    const spell = parseSpellToken(single[1], resolve);
    if (spell === undefined) return undefined;
    groups = [{ frequency: 'at-will', spells: [spell] }];
  }

  const result: {
    mode: CreatureSpellcasting['mode'];
    ability: string;
    saveDC?: number;
    attackBonus?: number;
    casterLevel?: number;
    listClass?: string;
    componentRequirement?: CreatureSpellcasting['componentRequirement'];
    groups: readonly CreatureSpellGroup[];
    footnote?: string;
  } = { mode, ability, groups };
  if (dcMatch !== null) {
    result.saveDC = Number(dcMatch[1]);
    if (dcMatch[2] !== undefined) result.attackBonus = Number(dcMatch[2]);
  } else {
    const singleDc = SINGLE_INNATE_RE.exec(text);
    if (singleDc?.[2] !== undefined) result.saveDC = Number(singleDc[2]);
  }
  if (casterLevelMatch !== null)
    result.casterLevel = Number(casterLevelMatch[1]);
  if (listClassMatch !== null) result.listClass = listClassMatch[1];
  if (componentRequirement !== undefined)
    result.componentRequirement = componentRequirement;
  if (footnote !== undefined) result.footnote = footnote;
  return result;
}
