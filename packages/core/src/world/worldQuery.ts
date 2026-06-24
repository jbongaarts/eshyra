import type { Db } from '../persistence/db.js';
import { jsonColumn } from '../persistence/jsonColumn.js';
import {
  type CampaignOverlayLoreRecord,
  queryCampaignOverlayLore,
} from './campaignOverlayLore.js';
import type {
  ModuleWorldTargetType,
  WorldCanonEvidence,
  WorldOverlay,
  WorldQueryResult,
  WorldQueryTarget,
  WorldSearchResult,
  WorldTargetType,
} from './types.js';
import { WorldModuleError } from './validate.js';
import { classifyVisibility } from './worldVisibility.js';

/** JSON codecs for the JSON-backed columns worldQuery reads. */
const templateDataColumn =
  jsonColumn<Record<string, unknown>>('module_*.data_json');
const overlayValueColumn = jsonColumn<unknown>('overlay_facts.value_json');

/**
 * Build the `overlay_facts` key that records a live divergence of a module
 * template field. Live writes go through `mutateState` with
 * `target: 'overlay_facts'` and `field` set to this key; `worldQuery` folds
 * matching overlay facts back over the template at read time.
 *
 * `meta` has no id; pass `''`. Rejects `:` in `id` or `field`: it is the key
 * segment delimiter, so allowing it would let two distinct `(id, field)` pairs
 * collapse onto one overlay key and silently overwrite each other.
 */
export function worldOverlayKey(
  type: WorldTargetType,
  id: string,
  field: string,
): string {
  if (id.includes(':')) {
    throw new WorldModuleError(
      `world overlay id must not contain ':' (got '${id}')`,
    );
  }
  if (field.includes(':')) {
    throw new WorldModuleError(
      `world overlay field must not contain ':' (got '${field}')`,
    );
  }
  return `world:${type}:${id}:${field}`;
}

/**
 * Escape SQL LIKE wildcards so an overlay-key prefix matches literally. Without
 * this, an overlay key for an id containing `_` (single-char wildcard) or `%`
 * (any-string wildcard) would fold over the wrong template record. Pairs with
 * `ESCAPE '\'` on the query. The backslash itself is escaped first.
 */
function escapeLikePrefix(prefix: string): string {
  return prefix.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const TABLE_BY_TYPE: Record<ModuleWorldTargetType, string> = {
  location: 'module_location',
  encounter: 'module_encounter',
  npc: 'module_npc',
  lore: 'module_lore',
  meta: 'module_meta',
};

interface OverlayRow {
  key: string;
  value_json: string;
  provenance: string;
  session_id: string;
  updated_at: string;
}

/**
 * Resolve a world target to template-plus-overlay truth so the model never
 * narrates a stale template. Reads the immutable forked template, then applies
 * the unique overlay fact stored for each diverged field. Returns the resolved
 * view, the raw template, and the overlay fields that diverged it.
 */
export function worldQuery(db: Db, target: WorldQueryTarget): WorldQueryResult {
  if (target.type === 'overlay_lore') {
    const records = queryCampaignOverlayLore(db, {
      id: target.id,
      query: target.query,
      locationId: target.locationId,
      npcId: target.npcId,
      subject: target.subject,
      kind: isOverlayLoreKind(target.kind) ? target.kind : undefined,
      tags: target.tags,
      includeInvalidated: target.includeInvalidated,
      limit: target.limit,
    }).map(overlayLoreEvidence);
    if (target.id !== undefined && records.length === 0) {
      return {
        ok: false,
        code: 'not_found',
        message: `no campaign overlay lore '${target.id}'`,
      };
    }
    return {
      ok: true,
      type: 'overlay_lore',
      id: target.id,
      records,
      evidence: records,
    };
  }

  if (
    target.type === 'search' ||
    (target.query !== undefined && target.query.trim().length > 0)
  ) {
    const results = worldSearch(db, target);
    return {
      ok: true,
      type: 'search',
      query: target.query,
      results,
      evidence: results.map((result) => ({
        tier: result.tier,
        source: result.source,
        id: result.id,
        truthStatus: result.truthStatus,
        visibility: result.visibility,
        summary: result.summary,
      })),
    };
  }

  const table = TABLE_BY_TYPE[target.type];
  const id = target.type === 'meta' ? '' : target.id;

  if (target.type !== 'meta' && (id === undefined || id.length === 0)) {
    return {
      ok: false,
      code: 'not_found',
      message: `world target ${target.type} requires an id`,
    };
  }

  const templateRow = (
    target.type === 'meta'
      ? db.prepare(`SELECT data_json FROM ${table} WHERE id = 1`).get()
      : db.prepare(`SELECT data_json FROM ${table} WHERE id = ?`).get(id)
  ) as { data_json: string } | undefined;

  if (templateRow === undefined) {
    return {
      ok: false,
      code: 'not_found',
      message: `no ${target.type} '${id ?? ''}' in the campaign template`,
    };
  }

  const template = templateDataColumn.decode(templateRow.data_json);

  const prefix = worldOverlayKey(target.type, id ?? '', '');
  const overlayRows = db
    .prepare(
      `SELECT key, value_json, provenance, session_id, updated_at
       FROM overlay_facts
       WHERE key LIKE ? ESCAPE '\\'`,
    )
    .all(`${escapeLikePrefix(prefix)}%`) as OverlayRow[];

  const overlays: WorldOverlay[] = [];
  const resolved: Record<string, unknown> = { ...template };
  for (const row of overlayRows) {
    const field = row.key.slice(prefix.length);
    if (field.length === 0) {
      continue;
    }
    const value = overlayValueColumn.decode(row.value_json);
    resolved[field] = value;
    overlays.push({
      field,
      value,
      provenance: row.provenance,
      sessionId: row.session_id,
      updatedAt: row.updated_at,
    });
  }

  const { visibility, dmOnlyFields } = classifyVisibility(
    target.type,
    resolved,
  );
  const overlayLore = queryCampaignOverlayLore(db, {
    locationId: target.type === 'location' ? id : undefined,
    npcId: target.type === 'npc' ? id : undefined,
    subject: target.type === 'lore' ? id : undefined,
    limit: 10,
  }).map(overlayLoreEvidence);
  const moduleEvidence: WorldCanonEvidence = {
    tier: 'module_canon',
    source: table,
    id: target.type === 'meta' ? 'meta' : id,
    summary:
      typeof resolved.name === 'string'
        ? resolved.name
        : typeof resolved.title === 'string'
          ? resolved.title
          : target.type,
  };
  const overlayEvidence = overlays.map((overlay): WorldCanonEvidence => {
    return {
      tier: 'campaign_state',
      source: 'overlay_facts',
      id: `${target.type}:${id ?? ''}:${overlay.field}`,
      summary: `${overlay.field}: ${String(overlay.value)}`,
    };
  });

  return {
    ok: true,
    type: target.type,
    id: target.type === 'meta' ? undefined : id,
    resolved,
    template,
    overlays,
    overlayLore,
    evidence: [moduleEvidence, ...overlayEvidence, ...overlayLore],
    visibility,
    dmOnlyFields,
  };
}

function worldSearch(db: Db, target: WorldQueryTarget): WorldSearchResult[] {
  const terms = normalizeSearchTerms(target.query ?? target.subject ?? '');
  const limit = Math.max(1, Math.min(target.limit ?? 20, 50));
  const moduleResults: WorldSearchResult[] = [];
  const constrainedType = target.type === 'search' ? undefined : target.type;
  for (const [type, table] of Object.entries(TABLE_BY_TYPE)) {
    if (type === 'meta') continue;
    if (constrainedType !== undefined && type !== constrainedType) continue;
    const rows = db
      .prepare(`SELECT id, data_json FROM ${table} ORDER BY id`)
      .all() as { id: string; data_json: string }[];
    for (const row of rows) {
      const data = templateDataColumn.decode(row.data_json);
      const label = labelFor(data, row.id);
      const summary = summaryFor(data, label);
      if (
        moduleSearchMatchesExplicitTarget(row.id, type, target) ||
        terms.length === 0 ||
        moduleSearchMatches(row.id, type, data, terms)
      ) {
        const { visibility } = classifyVisibility(
          type as ModuleWorldTargetType,
          data,
        );
        moduleResults.push({
          tier: 'module_canon',
          source: table,
          type: type as WorldTargetType,
          id: row.id,
          label,
          summary,
          visibility: visibilityToEvidenceVisibility(visibility),
        });
      }
    }
  }
  const overlayResults = queryCampaignOverlayLore(db, {
    subject: target.subject,
    locationId: target.locationId,
    npcId: target.npcId,
    kind: isOverlayLoreKind(target.kind) ? target.kind : undefined,
    tags: target.tags,
    includeInvalidated: target.includeInvalidated,
    limit,
  })
    .filter(
      (record) => terms.length === 0 || overlaySearchMatches(record, terms),
    )
    .map((record): WorldSearchResult => {
      return {
        tier:
          record.kind === 'rumor' ||
          record.truthStatus === 'rumored' ||
          record.truthStatus === 'reported' ||
          record.truthStatus === 'believed'
            ? 'rumor_belief'
            : 'campaign_overlay_lore',
        source: record.source,
        type: 'overlay_lore',
        id: record.id,
        label: record.subjectText,
        summary: record.fact,
        truthStatus: record.truthStatus,
        visibility: record.visibility,
      };
    });
  return interleaveSearchResults(moduleResults, overlayResults, limit);
}

function overlayLoreEvidence(
  record: CampaignOverlayLoreRecord,
): WorldCanonEvidence {
  return {
    tier:
      record.kind === 'rumor' ||
      record.truthStatus === 'rumored' ||
      record.truthStatus === 'reported' ||
      record.truthStatus === 'believed'
        ? 'rumor_belief'
        : 'campaign_overlay_lore',
    source: record.source,
    id: record.id,
    truthStatus: record.truthStatus,
    visibility: record.visibility,
    summary: `${record.subjectText}: ${record.fact}`,
  };
}

function labelFor(data: Record<string, unknown>, fallback: string): string {
  if (typeof data.name === 'string') return data.name;
  if (typeof data.title === 'string') return data.title;
  return fallback;
}

function summaryFor(data: Record<string, unknown>, fallback: string): string {
  if (typeof data.summary === 'string') return data.summary;
  if (typeof data.description === 'string') return data.description;
  if (typeof data.text === 'string') return data.text;
  return fallback;
}

function normalizeSearchTerms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 2);
}

function moduleSearchMatches(
  id: string,
  type: string,
  data: Record<string, unknown>,
  terms: readonly string[],
): boolean {
  const haystack = moduleSearchText(id, type, data);
  return terms.every((term) => haystack.includes(term));
}

function moduleSearchMatchesExplicitTarget(
  id: string,
  type: string,
  target: WorldQueryTarget,
): boolean {
  if (type === 'location' && target.locationId !== undefined) {
    return id === target.locationId;
  }
  if (type === 'npc' && target.npcId !== undefined) {
    return id === target.npcId;
  }
  return false;
}

function moduleSearchText(
  id: string,
  type: string,
  data: Record<string, unknown>,
): string {
  const text = [
    id,
    type,
    ...flattenSearchValues(data),
    ...moduleSearchAliases(type, data),
  ]
    .join(' ')
    .toLowerCase();
  return text;
}

function flattenSearchValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  if (Array.isArray(value)) return value.flatMap(flattenSearchValues);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, child]) => [key, ...flattenSearchValues(child)],
    );
  }
  return [];
}

function moduleSearchAliases(
  type: string,
  data: Record<string, unknown>,
): string[] {
  const aliases: string[] = [];
  if (type === 'npc') {
    const role = typeof data.role === 'string' ? data.role.toLowerCase() : '';
    if (/\b(warden|mayor|elder|captain|chief|leader|magistrate)\b/.test(role)) {
      aliases.push('authority figure local official');
    }
  }
  if (type === 'location') {
    const exits = Array.isArray(data.exits) ? data.exits : [];
    for (const exit of exits) {
      if (exit !== null && typeof exit === 'object') {
        const direction = (exit as Record<string, unknown>).direction;
        if (typeof direction === 'string') {
          aliases.push(`${direction} road ${direction} route`);
        }
      }
    }
  }
  return aliases;
}

function visibilityToEvidenceVisibility(
  visibility: ReturnType<typeof classifyVisibility>['visibility'],
): 'player_visible' | 'dm_only' | 'mixed' {
  if (visibility === 'public') return 'player_visible';
  if (visibility === 'dm') return 'dm_only';
  return 'mixed';
}

function interleaveSearchResults(
  moduleResults: readonly WorldSearchResult[],
  overlayResults: readonly WorldSearchResult[],
  limit: number,
): WorldSearchResult[] {
  const results: WorldSearchResult[] = [];
  const maxLength = Math.max(moduleResults.length, overlayResults.length);
  for (let index = 0; index < maxLength && results.length < limit; index += 1) {
    const moduleResult = moduleResults[index];
    if (moduleResult !== undefined) results.push(moduleResult);
    if (results.length >= limit) break;
    const overlayResult = overlayResults[index];
    if (overlayResult !== undefined) results.push(overlayResult);
  }
  return results;
}

function overlaySearchMatches(
  record: CampaignOverlayLoreRecord,
  terms: readonly string[],
): boolean {
  const haystack = [
    record.id,
    record.kind,
    record.subjectId,
    record.subjectText,
    record.locationId,
    record.npcId,
    record.fact,
    record.truthStatus,
    ...record.tags,
  ]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

function isOverlayLoreKind(
  value: unknown,
): value is CampaignOverlayLoreRecord['kind'] {
  return (
    value === 'rumor' ||
    value === 'clue' ||
    value === 'npc_detail' ||
    value === 'location_detail' ||
    value === 'quest_hook' ||
    value === 'threat_report' ||
    value === 'scene_consequence' ||
    value === 'player_created_detail' ||
    value === 'other'
  );
}
