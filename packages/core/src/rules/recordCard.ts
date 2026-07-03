import type { RulesRecord, RulesRecordKind } from './types.js';

/**
 * Disambiguating grantor/owner link for a `feature` or `subclass` record
 * (eshyra-o9bd.18.8.6). `ref` is already a fully-qualified `kind:key` record
 * ref (e.g. `class:barbarian`, `subclass:champion` — see ADR 0009), so it is
 * directly usable as a `lookup_rules` `ref` argument with no further parsing.
 */
export interface RulesRecordCardParent {
  readonly ref: string;
  readonly relation: 'grantedBy' | 'parentClass';
  readonly level?: number;
}

/**
 * Kind-aware disambiguating summary of a rules record for DM-facing tool
 * output. The SRD legitimately repeats names within a kind (seven classes
 * each have a "Spellcasting" feature) and across kinds (the `Shield` spell
 * vs. the `shield` equipment item); `key` and `kind` are always the
 * unambiguous identity, and `parent` surfaces the grantor/owner context that
 * would otherwise require parsing an arbitrary per-kind `data` shape.
 */
export interface RulesRecordCard {
  readonly key: string;
  readonly kind: RulesRecordKind;
  readonly name: string;
  readonly source: string;
  readonly locator?: string;
  readonly parent?: RulesRecordCardParent;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function buildRulesRecordCard(record: RulesRecord): RulesRecordCard {
  return {
    key: record.key,
    kind: record.kind,
    name: record.name,
    source: record.source,
    locator: record.provenance.locator,
    parent: buildParent(record),
  };
}

function buildParent(record: RulesRecord): RulesRecordCardParent | undefined {
  if (!isPlainObject(record.data)) {
    return undefined;
  }
  const data = record.data;

  // Per ADR 0009: a `feature` links to its granting class/subclass through
  // `data.source` plus the `data.level` it's gained at.
  if (record.kind === 'feature' && typeof data.source === 'string') {
    const level = typeof data.level === 'number' ? data.level : undefined;
    return {
      ref: data.source,
      relation: 'grantedBy',
      ...(level !== undefined ? { level } : {}),
    };
  }

  // Per ADR 0009: a `subclass` links to its parent base class through
  // `data.parentClass`.
  if (record.kind === 'subclass' && typeof data.parentClass === 'string') {
    return { ref: data.parentClass, relation: 'parentClass' };
  }

  return undefined;
}
