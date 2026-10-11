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
 * identity equals a known canonical name supplied by the caller from the pack
 * and the draft (fixed grants, default domains, class-feature languages, GM
 * approvals), else the trimmed whitespace-collapsed input.
 */
export function canonicalLanguageName(
  language: string,
  known: Iterable<string>,
): string {
  const key = languageKey(language);
  for (const name of known) {
    if (languageKey(name) === key) return displayLanguage(name);
  }
  return displayLanguage(language);
}

function displayLanguage(language: string): string {
  return language.trim().replace(/\s+/g, ' ');
}
