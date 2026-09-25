/**
 * Multiclassing-prerequisites parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` narrowed to the SRD's "Multiclassing"
 * section (the orchestrator in `index.ts` narrows it via `sliceSection` using
 * the `multiclassing` anchor); output is a `ClassPrimaryAbilityIndex` mapping
 * each base-class name to its primary/key abilities.
 *
 * Why this parser exists (loreweaver-0m9.5.19 / ADR 0007 normalization-mapping):
 * the SRD 5.1 "Class Features" block does not print a per-class primary-ability
 * line, so `parseClasses` emits `primaryAbilities: []`. The canonical source for
 * per-class key abilities is the Multiclassing section's "Prerequisites" listing
 * ("Barbarian — Strength 13", "Fighter — Strength 13 or Dexterity 13",
 * "Monk — Dexterity 13 and Wisdom 13", …). This parser reads that listing and
 * the class emitter (`classExtractionsToRecords`) merges the result into the
 * class records' `data.primaryAbilities`. The value is extracted from the source
 * text, not authored from model knowledge: only the class-name and ability-name
 * vocabularies are constants (mirroring how `parseConditions`/`parseHazards`
 * key off known names), while the actual ability→class association comes from
 * the prerequisites rows.
 *
 * Detection: a prerequisites row begins with one of the 12 SRD 5.1 base-class
 * names and lists an ability minimum on the same line (e.g.
 * "Fighter Strength 13 or Dexterity 13"). pdfjs joins the table's two columns
 * (Class | Ability Score Minimum) into a single extracted line, so the row is
 * matched as `<Class> <abilities…>`. A line that merely repeats a class name
 * without an ability+score (e.g. a stray heading) is ignored — the digit
 * requirement keeps a bare "Wizard" or a "Wizard Spells" list header out of the
 * map. First occurrence of each class wins, so a later prose mention cannot
 * override the table row.
 */

import type { ClassPrimaryAbilityIndex, PageText } from './types.js';

/** The 12 SRD 5.1 base classes, as they appear in the prerequisites listing. */
const BASE_CLASS_NAMES: readonly string[] = [
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
];

/**
 * The six 5e ability names. The prerequisites listing writes them in full
 * ("Strength 13", not "Str 13"), so full-name matching is sufficient and avoids
 * false positives on unrelated abbreviations.
 */
const ABILITY_PATTERN =
  /Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma/g;

/** Collapse internal whitespace runs to single spaces and trim. */
function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

/**
 * Extract the ability names from a prerequisites row's value text, in source
 * order, de-duplicated. "Strength 13 or Dexterity 13" → ['Strength',
 * 'Dexterity']; "Dexterity 13 and Wisdom 13" → ['Dexterity', 'Wisdom'];
 * "Intelligence 13" → ['Intelligence'].
 */
function extractAbilities(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(ABILITY_PATTERN)) {
    const ability = match[0];
    if (!out.includes(ability)) {
      out.push(ability);
    }
  }
  return out;
}

/**
 * Parse the Multiclassing prerequisites listing from the narrowed
 * Multiclassing-section `PageText[]`. Returns a class-name → (ability-list,
 * source page) map. Classes with no prerequisites row in the slice are simply
 * absent (the emitter leaves their `primaryAbilities` empty per ADR 0007).
 * Returns an empty map when the slice carries no recognizable rows. The
 * source page (eshyra-o9bd.19.2.2.3.1 F4) is field-level provenance for
 * `class.data.primaryAbilities` — every row in the SRD 5.1 corpus prints on
 * p56, but the page is read from the source, never hard-coded.
 */
export function parseMulticlassing(
  pages: readonly PageText[],
): ClassPrimaryAbilityIndex {
  const map = new Map<string, { abilities: string[]; page: number }>();
  for (const pageText of pages) {
    for (const raw of pageText.lines) {
      const line = normalizeLine(raw);
      const className = BASE_CLASS_NAMES.find(
        (name) => line === name || line.startsWith(`${name} `),
      );
      if (className === undefined) continue;
      // First occurrence wins: the prerequisites table row precedes any later
      // prose mention of the same class.
      if (map.has(className)) continue;
      const rest = line.slice(className.length);
      // Require an ability-score number so a bare class heading or a class-spell
      // list header ("Wizard Spells") is not mistaken for a prerequisites row.
      if (!/\d/.test(rest)) continue;
      const abilities = extractAbilities(rest);
      if (abilities.length === 0) continue;
      map.set(className, { abilities, page: pageText.pageNumber });
    }
  }
  return map;
}
