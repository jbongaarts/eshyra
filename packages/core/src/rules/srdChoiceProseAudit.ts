/**
 * Unstructured choice-bearing prose coverage gate for the D&D 5e SRD pack
 * (eshyra-ngcj.1).
 *
 * The existing `choice-coverage` gate in `srdPlayabilityAudit.ts` answers "does
 * a granted class feature carry a `choices[]` entry of the right CATEGORY?". It
 * goes green as soon as a category-tagged entry exists — even a generic one
 * whose `from` is a prose string ("a Metamagic option from this feature"). That
 * leaves a real gap: the OPTION CATALOG itself (the eight Metamagic options, the
 * three Pact Boons, the 32 Eldritch Invocations, the Hunter option menus, the
 * Fighting Styles) is still buried in the feature `description` prose, not
 * addressable as data.
 *
 * This gate closes that gap. It scans choice-bearing records (feature, class,
 * subclass, ancestry, background) for prose that announces a player build choice
 * — "one of the following", "choose two", "options", "of your choice", a named
 * menu (Metamagic / Fighting Style / Eldritch Invocations), spell-selection
 * prose, invocation "prerequisite" lines — and reports any record whose prose
 * carries such a signal but whose `data` does NOT yet carry a STRUCTURED option
 * catalog or filter that explains it.
 *
 * "Structured" deliberately means more than "a category-tagged choice exists":
 * a `choices[]` entry counts as resolving the prose only when its `from` is a
 * discrete option list (a non-empty array of option keys) or a structured filter
 * object, or it carries a non-empty `options[]` catalog. A bare prose `from`
 * string does not. So the modeling beads (eshyra-ngcj.2 option catalogs,
 * eshyra-ngcj.2.3 spell choices, eshyra-ngcj.5 ancestry/background) flip a
 * finding green by structuring the catalog, not by rewording the prose.
 *
 * Detection is deterministic and prose-only (no LLM). It is intentionally
 * generous: a false positive is resolved the same way as a true one — model the
 * catalog or add a narrow, documented allowlist entry — so over-detection only
 * lengthens the punch list, never hides a gap. This is a REPORT surface, kept
 * separate from `auditSrdStructure` (the freeze gate, pinned empty) and from the
 * green `auditSrdPlayability` aggregate, so adding RED findings here breaks no
 * existing green assertion.
 *
 * Everything is pure and deterministic; findings are sorted for diffable output.
 */

import type { RulesPack, RulesRecord } from './types.js';

// ---------------------------------------------------------------------------
// Finding model
// ---------------------------------------------------------------------------

export interface SrdChoiceProseFinding {
  /** Owning record key. */
  readonly key: string;
  readonly kind: string;
  readonly name: string;
  /** Source location (the record's `source` citation). */
  readonly source: string;
  /** The choice-prose signal labels that matched, sorted and de-duplicated. */
  readonly matchedPhrases: readonly string[];
  /** A short surrounding snippet of the first match, for actionability. */
  readonly snippet: string;
  /** The modeling area expected to resolve the finding. */
  readonly expectedModeling: string;
}

// ---------------------------------------------------------------------------
// Choice-prose signals
// ---------------------------------------------------------------------------

/**
 * A prose pattern announcing a player build choice whose option catalog/filter
 * should be structured. `label` names the matched phrase for the report;
 * `expected` is the modeling area a resolver should populate.
 *
 * Patterns avoid unbounded `[^.]*` runs spanning the whole description by
 * bounding the gap between anchor words, so they scan linearly.
 */
interface ChoiceProseSignal {
  readonly label: string;
  readonly test: RegExp;
  readonly expected: string;
  /**
   * The feature-choice categories whose STRUCTURED catalog resolves this signal.
   * A signal is "covered" on a record only when the record carries a structured
   * choice of one of these categories — so a record with one modeled choice but
   * a different unmodeled menu is NOT falsely cleared. An empty list marks a
   * generic menu with no specific category; it is covered only by a structured
   * catalog whose category is none of the categorized signals' (i.e. a generic
   * `other`/bespoke menu catalog — e.g. eshyra-ngcj.2.1's Pact Boon).
   */
  readonly categories: readonly string[];
}

const OPTION_CATALOG =
  'structured option catalog (choices[].from as discrete option keys)';
const SPELL_CHOICE = 'structured spell choice (choices[] spell/cantrip filter)';

const CHOICE_PROSE_SIGNALS: readonly ChoiceProseSignal[] = [
  // Enumerated "following"-style menus: Pact Boon, the four Hunter option
  // features, Metamagic ("two of the following Metamagic options"), Fighting
  // Style ("Choose one of the following options").
  {
    label: 'one of the following',
    test: /\b(?:one|two|three) of the following\b/i,
    expected: OPTION_CATALOG,
    categories: [],
  },
  {
    label: 'the following options',
    test: /\bthe following options\b/i,
    expected: OPTION_CATALOG,
    categories: [],
  },
  // Named option menus whose catalog is prose-only.
  {
    label: 'metamagic',
    test: /\bmetamagic\b/i,
    expected: OPTION_CATALOG,
    categories: ['metamagic'],
  },
  {
    label: 'fighting style',
    test: /\bfighting style\b/i,
    expected: OPTION_CATALOG,
    categories: ['fightingStyle'],
  },
  {
    label: 'eldritch invocation',
    test: /\beldritch invocations?\b/i,
    expected: OPTION_CATALOG,
    categories: ['invocation'],
  },
  // Invocation entries gate behind prerequisites that should be structured.
  {
    label: 'prerequisite',
    test: /\bprerequisite\b/i,
    expected: OPTION_CATALOG,
    categories: [],
  },
  // Spell-selection choices: Magical Secrets, Spell Mastery, Signature Spells,
  // prepared-caster spell lists, and any "additional spells of your choice"
  // caster prose. The negative lookahead excludes "choose expended spell slots"
  // (Arcane/Natural Recovery), which selects from current character state, not a
  // static spell catalog/filter this gate cares about.
  {
    label: 'spell selection',
    test: /\bchoose\b[^.\n]{0,40}\bspells?\b(?!\s+slots?\b)/i,
    expected: SPELL_CHOICE,
    categories: ['spell', 'cantrip'],
  },
  {
    label: 'additional spells of your choice',
    test: /\b(?:additional |more )?spells?\b[^.\n]{0,30}\bof your choice\b/i,
    expected: SPELL_CHOICE,
    categories: ['spell', 'cantrip'],
  },
];

/** Categories that a categorized signal claims; a generic menu is covered only
 * by a structured catalog OUTSIDE this set. */
const CATEGORIZED_SIGNAL_CATEGORIES: ReadonlySet<string> = new Set([
  'metamagic',
  'fightingStyle',
  'invocation',
  'spell',
  'cantrip',
]);

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

/**
 * Narrow, documented false positives: records whose choice-prose match is not a
 * missing option catalog. Each entry must carry a one-line reason. Keep this
 * list as small as the evidence demands — a real gap belongs in the report, not
 * here.
 */
export const CHOICE_PROSE_ALLOWLIST: ReadonlyMap<string, string> = new Map([
  [
    'feature:school-of-evocation:sculpt-spells',
    'The "choose a number of them equal to 1 + the spell’s level" prose is a per-cast targeting formula, not a build-time spell/option catalog.',
  ],
  [
    'ancestry:rock-gnome',
    'The Tinker "choose one of the following options" (Clockwork Toy / Fire Starter / Music Box) is a repeatable in-play device-construction choice, not a character-creation build catalog (eshyra-ngcj.5).',
  ],
]);

// ---------------------------------------------------------------------------
// Scanned records + structured-catalog detection
// ---------------------------------------------------------------------------

const SCANNED_KINDS: ReadonlySet<string> = new Set([
  'feature',
  'class',
  'subclass',
  'ancestry',
  'background',
]);

function dataObject(record: RulesRecord): Record<string, unknown> | null {
  const data = record.data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }
  return data as Record<string, unknown>;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function pushText(into: string[], value: unknown): void {
  if (typeof value === 'string' && value.trim().length > 0) into.push(value);
}

/**
 * The prose blocks of a record that can carry choice-announcing language. Pulls
 * the description plus the kind-specific prose carriers (ancestry traits,
 * background feature/characteristics). The structured `from`/`options` fields
 * are intentionally NOT scanned — they hold option keys, not prose, so the gate
 * keys off the human-readable text only.
 */
function scanProse(record: RulesRecord): string {
  const data = dataObject(record);
  if (data === null) return '';
  const blocks: string[] = [];
  pushText(blocks, data.description);
  pushText(blocks, data.text);
  if (record.kind === 'ancestry' && Array.isArray(data.traits)) {
    for (const trait of data.traits) {
      const t = asObject(trait);
      if (t !== null) pushText(blocks, t.text);
    }
  }
  if (record.kind === 'background') {
    const feature = asObject(data.feature);
    if (feature !== null) pushText(blocks, feature.text);
    pushText(blocks, data.suggestedCharacteristics);
  }
  return blocks.join('\n');
}

/**
 * True when a `choices[]` entry carries a STRUCTURED catalog/filter: a `from`
 * that is a discrete option array or a structured filter object, a non-empty
 * `options[]` catalog, or a `tableRef` pointing at an option table. A bare prose
 * `from` STRING does not count — that is exactly the prose-only state this gate
 * flags.
 */
function isStructuredChoice(choice: Record<string, unknown>): boolean {
  if (Array.isArray(choice.options) && choice.options.length > 0) return true;
  if (typeof choice.tableRef === 'string' && choice.tableRef.length > 0) {
    return true;
  }
  const from = choice.from;
  if (Array.isArray(from)) return from.length > 0;
  return asObject(from) !== null;
}

/**
 * The set of choice categories on a record that already carry a structured
 * catalog/filter. Used per-signal so one modeled choice cannot mask a different
 * unmodeled menu on the same record (the eshyra-ngcj.2.x robustness concern).
 */
function structuredChoiceCategories(record: RulesRecord): ReadonlySet<string> {
  const data = dataObject(record);
  const out = new Set<string>();
  if (data === null || !Array.isArray(data.choices)) return out;
  for (const entry of data.choices) {
    const choice = asObject(entry);
    if (choice === null || !isStructuredChoice(choice)) continue;
    // An untagged structured choice still counts as a generic catalog.
    out.add(asString(choice.category) ?? '');
  }
  return out;
}

/** Whether a categorized signal's category has a structured catalog. */
function categorizedSignalCovered(
  signal: ChoiceProseSignal,
  structured: ReadonlySet<string>,
): boolean {
  return signal.categories.some((category) => structured.has(category));
}

/** Whether the record carries a structured catalog for a bespoke menu (a
 * category NOT claimed by any categorized signal — e.g. a Pact Boon `other`
 * catalog, or an untagged/tableRef menu). */
function hasBespokeCatalog(structured: ReadonlySet<string>): boolean {
  for (const category of structured) {
    if (!CATEGORIZED_SIGNAL_CATEGORIES.has(category)) return true;
  }
  return false;
}

function snippetAround(text: string, match: RegExpMatchArray): string {
  const index = match.index ?? 0;
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + match[0].length + 60);
  const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${snippet}${suffix}`;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/**
 * Scan the pack for records carrying choice-bearing prose with no structured
 * option catalog/filter. Returns the sorted findings; empty means every scanned
 * record's build choices are either structured or explicitly allowlisted.
 */
export function auditSrdChoiceProse(
  pack: RulesPack,
): readonly SrdChoiceProseFinding[] {
  const findings: SrdChoiceProseFinding[] = [];
  for (const record of pack.records) {
    if (!SCANNED_KINDS.has(record.kind)) continue;
    if (CHOICE_PROSE_ALLOWLIST.has(record.key)) continue;
    const prose = scanProse(record);
    if (prose.length === 0) continue;
    const structured = structuredChoiceCategories(record);

    // Resolve coverage per signal so one modeled choice cannot clear an
    // unrelated unmodeled menu on the same record. Categorized signals
    // (metamagic, fighting style, …) need a structured catalog of their own
    // category. Generic menu signals ("one of the following") have no category,
    // so they are covered when EITHER a bespoke catalog exists (a Pact Boon
    // `other`/tableRef menu) OR every categorized menu on the record is already
    // covered (the generic phrase is just restating a covered categorized menu,
    // e.g. "two of the following Metamagic options").
    const matched = CHOICE_PROSE_SIGNALS.map(
      (signal) => [signal, prose.match(signal.test)] as const,
    ).filter((pair): pair is [ChoiceProseSignal, RegExpMatchArray] => {
      return pair[1] !== null;
    });
    const uncoveredCategorized = matched.filter(
      ([signal]) =>
        signal.categories.length > 0 &&
        !categorizedSignalCovered(signal, structured),
    );
    const genericCovered =
      hasBespokeCatalog(structured) ||
      (structured.size > 0 && uncoveredCategorized.length === 0);
    const uncovered = matched.filter(([signal]) => {
      if (signal.categories.length > 0) {
        return !categorizedSignalCovered(signal, structured);
      }
      return !genericCovered;
    });
    if (uncovered.length === 0) continue;

    const matchedPhrases = uncovered.map(([signal]) => signal.label);
    const expectedAreas = new Set(uncovered.map(([signal]) => signal.expected));
    const firstSnippet = snippetAround(prose, uncovered[0][1]);

    findings.push({
      key: record.key,
      kind: record.kind,
      name: record.name,
      source: record.source,
      matchedPhrases: [...new Set(matchedPhrases)].sort(),
      snippet: firstSnippet ?? '',
      expectedModeling: [...expectedAreas].sort().join('; '),
    });
  }
  return findings.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** True when the gate has any finding. */
export function srdChoiceProseHasFindings(
  findings: readonly SrdChoiceProseFinding[],
): boolean {
  return findings.length > 0;
}

/** Human-readable punch-list report. */
export function formatSrdChoiceProseReport(
  packId: string,
  findings: readonly SrdChoiceProseFinding[],
): string {
  const lines: string[] = [];
  lines.push(`SRD choice-bearing prose coverage gate for pack: ${packId}`);
  lines.push(`Findings: ${findings.length}`);
  lines.push('');
  if (findings.length === 0) {
    lines.push('  (no findings — every scanned build choice is structured)');
    return `${lines.join('\n')}\n`;
  }
  for (const finding of findings) {
    lines.push(`${finding.key} (${finding.kind}) — ${finding.name}`);
    lines.push(`  source: ${finding.source}`);
    lines.push(`  matched: ${finding.matchedPhrases.join(', ')}`);
    lines.push(`  expected: ${finding.expectedModeling}`);
    lines.push(`  snippet: ${finding.snippet}`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
