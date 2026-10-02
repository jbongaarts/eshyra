import type { CharacterConditionEntry } from './liveStateSchema.js';

/** Read the canonical or legacy exhaustion condition without changing state. */
export function exhaustionLevel(
  conditions: readonly CharacterConditionEntry[],
): number {
  const entry = conditions.find(
    (condition) =>
      condition.id === 'exhaustion' || condition.id === 'exhausted',
  );
  if (entry === undefined) return 0;
  if (
    !Number.isInteger(entry.level) ||
    (entry.level as number) < 1 ||
    (entry.level as number) > 6
  )
    throw new Error('malformed exhaustion state');
  return entry.level as number;
}

/** The exhaustion HP maximum is derived; `hp_max` remains the sheet value. */
export function effectiveHpMax(
  hpMax: number,
  conditions: readonly CharacterConditionEntry[],
): number {
  // Halving never makes the maximum 0 for a creature that has one: a
  // maximum of 0 would kill through the clamp, which the source does not say.
  return exhaustionLevel(conditions) >= 4
    ? Math.max(Math.min(hpMax, 1), Math.floor(hpMax / 2))
    : hpMax;
}

export function withExhaustionLevel(
  conditions: readonly CharacterConditionEntry[],
  level: number,
): CharacterConditionEntry[] {
  const next = conditions.filter(
    (condition) =>
      condition.id !== 'exhaustion' && condition.id !== 'exhausted',
  );
  if (level > 0) next.push({ id: 'exhaustion', level });
  return next;
}
