/**
 * Link owner records (magic items, economy/reference rules) back to the `table`
 * records that belong to their entry (eshyra-o9bd.8).
 *
 * Ownership is a reviewed, curated relationship (`SRD_5_1_TABLE_OWNERS`) rather
 * than something derived from extraction, because most of these tables are
 * generic document tables with no embedded owner anchor. This post-emit pass
 * adds a sorted `data.tableRefs` array to each owner so an option/variant table
 * is reachable as structured data, while the source-preserving table `rows`
 * stay the sole representation of the table itself (the prose is already
 * de-flattened by `stripEmbeddedTableProse`).
 */

import { SRD_5_1_TABLE_OWNERS } from '../../../src/rules/srdAudit.js';
import type { RulesRecord } from '../../../src/rules/types.js';

export class OwnedTableLinkError extends Error {
  override readonly name = 'OwnedTableLinkError';
}

/**
 * Add `data.tableRefs` to every owner named in `SRD_5_1_TABLE_OWNERS`.
 *
 * Wires only the mappings whose table and owner records are both present, so
 * reduced fixtures (and partial packs) that omit a source region simply skip
 * that link. A present table whose key resolves to a non-table record is still
 * a hard error. Completeness — every owned table actually reachable from its
 * expected owner on the full pack — is enforced separately by the
 * `table-owner-link` audit gate. Refs merged onto an owner are de-duplicated
 * and sorted; records not named as an owner pass through unchanged.
 */
export function linkOwnedTables(
  records: readonly RulesRecord[],
): RulesRecord[] {
  const byKey = new Map(records.map((record) => [record.key, record]));
  const refsByOwner = new Map<string, Set<string>>();

  for (const [tableKey, ownerKey] of Object.entries(SRD_5_1_TABLE_OWNERS)) {
    const table = byKey.get(tableKey);
    const owner = byKey.get(ownerKey);
    if (table === undefined || owner === undefined) continue;
    if (table.kind !== 'table') {
      throw new OwnedTableLinkError(
        `owned table key ${tableKey} (owner ${ownerKey}) resolved to a ${table.kind} record`,
      );
    }
    const refs = refsByOwner.get(ownerKey) ?? new Set<string>();
    refs.add(tableKey);
    refsByOwner.set(ownerKey, refs);
  }

  return records.map((record) => {
    const owned = refsByOwner.get(record.key);
    if (owned === undefined) return record;
    const data = record.data as Record<string, unknown>;
    const existing = Array.isArray(data.tableRefs)
      ? data.tableRefs.filter((ref): ref is string => typeof ref === 'string')
      : [];
    const merged = new Set<string>([...existing, ...owned]);
    return {
      ...record,
      data: { ...data, tableRefs: [...merged].sort() },
    };
  });
}
