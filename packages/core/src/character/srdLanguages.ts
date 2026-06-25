/**
 * Source-backed language overlay for ancestries and backgrounds
 * (eshyra-b69j.12.4).
 *
 * In the frozen generated pack (`rules:dnd5e-srd-5.1`) language grants live only
 * as prose: an ancestry's "Languages" trait (e.g. ancestry:elf — "You can
 * speak, read, and write Common and Elvish.") and a background's free-text
 * `data.languages` (e.g. background:acolyte — "Two of your choice"). The CLI
 * must not parse that prose to discover a core mechanical choice
 * (`docs/design/character-creation-cli.md`), so the guided flow cannot enumerate
 * granted vs chosen languages from the pack alone.
 *
 * The pack is a frozen, hash-pinned, signed-off artifact
 * (`docs/audits/dnd5e-srd-5.1-final/`; guard via
 * `npm run verify:dnd5e-srd-freeze`), so the gap is NOT filled by re-running the
 * importer or regenerating the pack — that would require a thaw + re-audit.
 * Instead this module is the sanctioned deterministic, consumer-side metadata
 * overlay described in
 * `docs/design/character-creation-level1-metadata-inventory.md` and the same
 * pattern as the ancestry/spellcasting/equipment overlays: authored, SRD-cited
 * tables keyed by the frozen `ancestry:*` / `background:*` record keys. It
 * mutates nothing in the pack; it is ordinary character-creation code (not
 * importer-fix-protocol work). Each entry's `sourceText` is the verbatim SRD
 * language sentence it was authored from — for an ancestry, a prefix of the
 * pack's "Languages" trait text; for a background, the exact `data.languages`.
 */

/**
 * The SRD 5.1 standard languages (the "Standard Languages" table). These are the
 * languages a "language of your choice" normally draws from at character
 * creation; exotic languages (Abyssal, Celestial, Draconic, Infernal, …)
 * generally require special access and are out of scope for a default pick.
 */
export const SRD_STANDARD_LANGUAGES: readonly string[] = [
  'Common',
  'Dwarvish',
  'Elvish',
  'Giant',
  'Gnomish',
  'Goblin',
  'Halfling',
  'Orc',
];

/** Structured language grant for one ancestry or background. */
export interface LanguageGrant {
  /** Languages granted outright, with no player choice. */
  readonly fixed: readonly string[];
  /** Number of free-choice languages, present only when the source grants any. */
  readonly choose?: number;
  /** Verbatim SRD language prose this entry was authored from. */
  readonly sourceText: string;
}

/** Build a fixed-only grant. */
function known(sourceText: string, ...fixed: readonly string[]): LanguageGrant {
  return { fixed, sourceText };
}

/** Build a grant with a fixed set plus N free choices. */
function choose(
  sourceText: string,
  count: number,
  ...fixed: readonly string[]
): LanguageGrant {
  return { fixed, choose: count, sourceText };
}

/**
 * Languages per ancestry, keyed by the frozen pack's canonical `ancestry:<slug>`
 * record key. Source: D&D 5e SRD 5.1, each ancestry's "Languages" trait — the
 * `sourceText` is the trait's opening language sentence (a verbatim prefix of
 * the pack trait text, which continues with non-mechanical flavor for some
 * ancestries).
 */
const ANCESTRY_LANGUAGES: Readonly<Record<string, LanguageGrant>> = {
  'ancestry:dragonborn': known(
    'You can speak, read, and write Common and Draconic.',
    'Common',
    'Draconic',
  ),
  'ancestry:dwarf': known(
    'You can speak, read, and write Common and Dwarvish.',
    'Common',
    'Dwarvish',
  ),
  'ancestry:elf': known(
    'You can speak, read, and write Common and Elvish.',
    'Common',
    'Elvish',
  ),
  'ancestry:gnome': known(
    'You can speak, read, and write Common and Gnomish.',
    'Common',
    'Gnomish',
  ),
  'ancestry:half-elf': choose(
    'You can speak, read, and write Common, Elvish, and one extra language of your choice.',
    1,
    'Common',
    'Elvish',
  ),
  'ancestry:half-orc': known(
    'You can speak, read, and write Common and Orc.',
    'Common',
    'Orc',
  ),
  'ancestry:halfling': known(
    'You can speak, read, and write Common and Halfling.',
    'Common',
    'Halfling',
  ),
  'ancestry:high-elf': known(
    'You can speak, read, and write Common and Elvish.',
    'Common',
    'Elvish',
  ),
  'ancestry:hill-dwarf': known(
    'You can speak, read, and write Common and Dwarvish.',
    'Common',
    'Dwarvish',
  ),
  'ancestry:human': choose(
    'You can speak, read, and write Common and one extra language of your choice.',
    1,
    'Common',
  ),
  'ancestry:lightfoot-halfling': known(
    'You can speak, read, and write Common and Halfling.',
    'Common',
    'Halfling',
  ),
  'ancestry:rock-gnome': known(
    'You can speak, read, and write Common and Gnomish.',
    'Common',
    'Gnomish',
  ),
  'ancestry:tiefling': known(
    'You can speak, read, and write Common and Infernal.',
    'Common',
    'Infernal',
  ),
};

/**
 * Languages per background, keyed by the frozen pack's canonical
 * `background:<slug>` record key. Source: D&D 5e SRD 5.1, each background's
 * language line — `sourceText` is the exact `data.languages` string.
 */
const BACKGROUND_LANGUAGES: Readonly<Record<string, LanguageGrant>> = {
  'background:acolyte': choose('Two of your choice', 2),
};

/**
 * The structured language grant for an ancestry, looked up by its frozen
 * canonical record key (e.g. `ancestry:half-elf`), or `undefined` for an
 * unmodeled key. Keyed only by canonical key so it stays pinned to the frozen
 * records and never matches on mutable prose.
 */
export function getAncestryLanguages(
  ancestryKey: string,
): LanguageGrant | undefined {
  return ANCESTRY_LANGUAGES[ancestryKey];
}

/**
 * The structured language grant for a background, looked up by its frozen
 * canonical record key (e.g. `background:acolyte`), or `undefined` for an
 * unmodeled key.
 */
export function getBackgroundLanguages(
  backgroundKey: string,
): LanguageGrant | undefined {
  return BACKGROUND_LANGUAGES[backgroundKey];
}

/**
 * The languages a free choice may draw from: the SRD standard languages minus
 * any already granted as `fixed` (you cannot pick a language you already have).
 */
export function chooseableLanguages(
  fixed: readonly string[],
): readonly string[] {
  const taken = new Set(fixed);
  return SRD_STANDARD_LANGUAGES.filter((language) => !taken.has(language));
}
