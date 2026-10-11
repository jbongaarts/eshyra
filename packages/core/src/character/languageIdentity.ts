/**
 * The one bounded language identity used at every comparison boundary
 * (eshyra-o9bd.19.3.3.5): creation validation, class-feature language choices,
 * finalization, and durable-sheet progression. A language is one language
 * regardless of case or whitespace; no synonym/dialect ontology.
 */

/** Identity of a language name: trimmed, whitespace-collapsed, lowercased. */
export function languageKey(language: string): string {
  return language.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The spelling to persist for a language: the canonical spelling when its
 * identity equals a known canonical name (default domain, fixed grants, SRD
 * tables, class-feature options), else the trimmed whitespace-collapsed input.
 */
export function canonicalLanguageName(
  language: string,
  known: Iterable<string>,
): string {
  const key = languageKey(language);
  for (const name of known) {
    if (languageKey(name) === key) return name;
  }
  return language.trim().replace(/\s+/g, ' ');
}

/**
 * The SRD 5.1 Exotic Languages table (p.59, `table:exotic-languages`), the
 * canonical spellings for languages admitted with GM permission. Together with
 * the Standard Languages table it is the canonical-spelling source for
 * case/whitespace variants; it grants nothing by itself.
 */
export const SRD_5_1_EXOTIC_LANGUAGES: readonly string[] = [
  'Abyssal',
  'Celestial',
  'Deep Speech',
  'Draconic',
  'Infernal',
  'Primordial',
  'Sylvan',
  'Undercommon',
];
