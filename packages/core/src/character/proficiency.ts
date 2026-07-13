/** Canonical creation-time proficiency key normalization. */
export function normalizeProficiency(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function proficiencyReplacementId(
  kind: 'skills' | 'tools',
  duplicatedValue: string,
  occurrence: number,
): string {
  if (!Number.isSafeInteger(occurrence) || occurrence < 1) {
    throw new Error('proficiency replacement occurrence must be positive');
  }
  const slug = normalizeProficiency(duplicatedValue).replace(/ /g, '-');
  return `proficiency-replacement.${kind}.${slug}.${occurrence}`;
}
