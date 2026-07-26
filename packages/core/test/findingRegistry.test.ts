import { readFileSync } from 'node:fs';
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

describe('durable finding registry', () => {
  it('loads and validates the checked-in schema', () => {
    const registry = loadFindingRegistry();
    expect(registry.version).toBe(1);
    expect(registry.rows).toHaveLength(68);
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

  it('uses one exact durable target per row and never a generic search', () => {
    const registry = loadFindingRegistry();
    for (const row of registry.rows) {
      expect(row.obligation.obligationId).toMatch(/^obl:::/);
      expect(row.obligation.authority).not.toMatch(/^(?:pack|current-pack):/i);
      expect(row.target.selector.members).toEqual(
        row.baselineMembership.members,
      );
      expect(row.baselineMembership.capturedAtCommit).toMatch(
        /^[0-9a-f]{7,64}$/,
      );
      for (const member of row.baselineMembership.members) {
        expect(JSON.stringify(member)).not.toMatch(
          /\*|\?|substring|prefix|regex|contains/i,
        );
      }
    }
  });

  it('rejects malformed rows without status reasoning or exact selector identities', () => {
    const registry = loadFindingRegistry();
    const nonAccepted = registry.rows.find((row) => row.status !== 'accepted');
    if (nonAccepted === undefined)
      throw new Error('fixture must contain a non-accepted row');
    const withoutReasoning = {
      ...registry,
      rows: registry.rows.map((row) =>
        row === nonAccepted ? { ...row, statusReasoning: undefined } : row,
      ),
    };
    expect(() => validateFindingRegistry(withoutReasoning)).toThrow(
      /statusReasoning/i,
    );

    const generic = structuredClone(registry);
    generic.rows[0].target.selector.members[0].path = 'data.description~spell';
    expect(() => validateFindingRegistry(generic)).toThrow(
      /exact selector|structured data path/i,
    );
  });

  it('keeps violation queries separate from durable baseline membership', () => {
    const registry = loadFindingRegistry();
    expect(
      registry.rows.every((row) =>
        row.violation.queryId.startsWith('finding:'),
      ),
    ).toBe(true);
    expect(
      registry.rows.every(
        (row) =>
          row.violation.expectedAfterRepair === 'empty' ||
          row.violation.expectedAfterRepair === 'stable',
      ),
    ).toBe(true);
    expect(JSON.stringify(registry)).not.toMatch(/"currentMembership"/);
  });

  it('enumerates exact current identities for all rows', () => {
    const registry = loadFindingRegistry();
    for (const row of registry.rows) {
      const result = executeMembershipQuery(row.violation.queryId);
      if (
        row.statusReasoning?.startsWith('Reviewed empty current membership:')
      ) {
        expect(result).toHaveLength(0);
      } else {
        expect(result).toEqual(row.baselineMembership.members);
      }
    }
  });

  it('represents nested, artifact, narrowed, capability, and cross-kind cases', () => {
    const registry = loadFindingRegistry();
    const byAlias = (alias: string) => {
      const row = registry.rows.find((candidate) =>
        candidate.aliases.includes(alias),
      );
      if (row === undefined) throw new Error(`missing fixture alias ${alias}`);
      return row;
    };
    expect(
      byAlias('opus:F-20').baselineMembership.members[0].artifactPath,
    ).toBe('manifest.json');
    expect(
      byAlias('sol:CAP-008').baselineMembership.members[0].clauseId,
    ).toBeTruthy();
    expect(byAlias('sol:CAP-002').status).toBe('narrowed');
    expect(byAlias('sol:CAP-007').obligation.evidenceKind).toBe('code');
    expect(
      byAlias('opus:F-25').baselineMembership.members.map(
        (member) => member.recordKey,
      ),
    ).toEqual(['creature:bulette', 'hazard:pits']);
  });

  it('fails when any declared baseline member disappears', () => {
    const registry = loadFindingRegistry();
    const records = structuredClone(
      JSON.parse(
        JSON.stringify(
          // Keep this fixture derived from the checked-in pack rather than a copied count.
          requireRecords(),
        ),
      ),
    );
    records.splice(
      records.findIndex(
        (record: { key?: unknown }) => record.key === 'hazard:pits',
      ),
      1,
    );
    expect(() => validateFindingRegistry(registry, records)).toThrow(
      /lost one or more baseline membership identities/,
    );
  });

  it('rejects a duplicate canonical ID with a real set', () => {
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

function requireRecords(): unknown[] {
  // This keeps the test's mutation fixture tied to the same pack the registry evaluates.
  return JSON.parse(
    readFileSync(
      new URL(
        '../data/rules-packs/rules__dnd5e-srd-5.1/records.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as unknown[];
}
