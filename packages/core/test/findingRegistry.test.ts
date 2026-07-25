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

  it('executes every named membership query against the committed pack', () => {
    const registry = loadFindingRegistry();
    const results = registry.rows.map((row) =>
      executeMembershipQuery(row.membershipQuery),
    );
    expect(results.every((result) => Array.isArray(result))).toBe(true);
    expect(results.some((result) => result.length > 0)).toBe(true);
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
