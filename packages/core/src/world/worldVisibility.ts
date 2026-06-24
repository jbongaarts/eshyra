import type {
  ModuleWorldTargetType,
  WorldEntityVisibility,
  WorldQueryResult,
} from './types.js';

const NPC_DM_ONLY_FIELDS: readonly string[] = ['secret'];

/**
 * Classify a resolved world entity's visibility based on its type and field
 * values. Rules are structural, not overlay-dependent: `npc` always has a
 * DM-only `secret` field; `lore` with `scope === 'dm'` is entirely DM-only.
 */
export function classifyVisibility(
  type: ModuleWorldTargetType,
  resolved: Record<string, unknown>,
): { visibility: WorldEntityVisibility; dmOnlyFields: readonly string[] } {
  if (type === 'lore' && resolved.scope === 'dm') {
    return { visibility: 'dm', dmOnlyFields: [] };
  }
  if (type === 'npc') {
    return { visibility: 'mixed', dmOnlyFields: NPC_DM_ONLY_FIELDS };
  }
  return { visibility: 'public', dmOnlyFields: [] };
}

/**
 * Project a successful world-query result into a player-safe view by stripping
 * DM-only fields. Returns the filtered `resolved` record, or `undefined` if the
 * entire entity is DM-only. Template, overlay, and provenance data are always
 * DM-internal and are not included.
 */
export function toPlayerSafeView(
  result: Extract<WorldQueryResult, { ok: true; resolved: unknown }>,
): Record<string, unknown> | undefined {
  if (result.visibility === 'dm') return undefined;
  if (result.dmOnlyFields.length === 0) return result.resolved;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result.resolved)) {
    if (!result.dmOnlyFields.includes(key)) {
      safe[key] = value;
    }
  }
  return safe;
}
