import { describe, expect, it } from 'vitest';
import {
  aliasIndex,
  checkBeadReferences,
  executeMembershipQuery,
  loadFindingRegistry,
  validateFindingRegistry,
} from '../src/rules/findingRegistry.js';

function expectedAliases(): string[] {
  return [
    ...Array.from(
      { length: 12 },
      (_, index) => `indep:${String(index + 1).padStart(3, '0')}`,
    ),
    ...Array.from(
      { length: 35 },
      (_, index) => `opus:F-${String(index + 1).padStart(2, '0')}`,
    ),
    ...Array.from(
      { length: 14 },
      (_, index) => `sol:CAP-${String(index + 1).padStart(3, '0')}`,
    ),
    ...Array.from({ length: 8 }, (_, index) => `fable:F${index + 1}`),
    'opus:residual-unverified-effects-semantics',
  ].sort();
}

describe('finding registry v1', () => {
  it('loads and validates the checked-in schema', () => {
    const registry = loadFindingRegistry();
    expect(registry.version).toBe(1);
    expect(() => validateFindingRegistry(registry)).not.toThrow();
  });

  it('resolves every review alias exactly once', () => {
    const index = aliasIndex();
    expect([...index.keys()].sort()).toEqual(expectedAliases());
    expect(index.get('sol:CAP-002')?.status).toBe('narrowed');
  });

  it('requires reasoning for every non-accepted row and protects CAP-002', () => {
    const registry = loadFindingRegistry();
    for (const row of registry.rows) {
      if (row.status !== 'accepted') expect(row.statusReasoning).toBeTruthy();
    }
    const cap002 = registry.rows.find((row) =>
      row.aliases.includes('sol:CAP-002'),
    );
    expect(cap002?.statusReasoning).toMatch(
      /no-regression|typed condition effects/i,
    );
  });

  it('rejects a non-accepted row without status reasoning', () => {
    const registry = loadFindingRegistry();
    const malformed = {
      ...registry,
      rows: registry.rows.map((row) => {
        if (row.status === 'accepted') return row;
        const { statusReasoning: _statusReasoning, ...withoutReasoning } = row;
        return withoutReasoning;
      }),
    };
    expect(() => validateFindingRegistry(malformed)).toThrow(
      /statusReasoning.*(?:required|non-empty)/i,
    );
  });

  it('uses a discriminating query per row unless sharing is justified', () => {
    const registry = loadFindingRegistry();
    const queryRows = new Map<string, typeof registry.rows>();
    for (const row of registry.rows) {
      const rows = queryRows.get(row.membershipQuery) ?? [];
      rows.push(row);
      queryRows.set(row.membershipQuery, rows);
    }
    for (const [query, rows] of queryRows) {
      if (rows.length > 1) {
        expect(rows.every((row) => row.sharedQueryJustification)).toBe(true);
      }
      expect(query).toMatch(/^finding:/);
    }
    expect(queryRows.size).toBe(registry.rows.length);
  });

  it('executes every named membership query against the committed pack', () => {
    const registry = loadFindingRegistry();
    for (const row of registry.rows) {
      const result = executeMembershipQuery(row.membershipQuery);
      if (row.zeroMemberPolicy === undefined)
        expect(result.length).toBeGreaterThan(0);
      expect(result.every((member) => member.recordKey.length > 0)).toBe(true);
      expect(
        result.every(
          (member) =>
            member.sourceSpan !== undefined ||
            member.clauseId !== undefined ||
            member.path !== undefined,
        ),
      ).toBe(true);
    }
  });

  it('returns nested identities instead of whole records for readiness clauses', () => {
    const members = executeMembershipQuery(
      'finding:engine-capability-ownership',
    );
    expect(members.length).toBeGreaterThan(0);
    expect(members.every((member) => member.clauseId)).toBe(true);
    expect(
      members.every((member) => member.recordKey && member.sourceSpan),
    ).toBe(true);
  });

  it('rejects a duplicate canonical ID', () => {
    const registry = loadFindingRegistry();
    const malformed = {
      ...registry,
      rows: [
        registry.rows[0],
        { ...registry.rows[1], canonicalId: registry.rows[0].canonicalId },
        ...registry.rows.slice(2),
      ],
    };
    expect(() => validateFindingRegistry(malformed)).toThrow(
      /duplicate canonicalId/,
    );
  });

  it('does not store hand-copied totals', () => {
    const registry = loadFindingRegistry();
    expect(JSON.stringify(registry)).not.toMatch(
      /"(?:count|total|storedCount|storedTotal)"\s*:/i,
    );
  });

  it('checks owning beads without making bd a suite prerequisite', () => {
    const result = checkBeadReferences();
    if (!result.skipped) expect(result.missing).toEqual([]);
  });
});
