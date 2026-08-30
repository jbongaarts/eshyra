import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FindingRegistry } from '../src/internal.js';
import {
  aliasIndex,
  CANONICAL_FINDING_IDS,
  FINDING_ALIASES,
  findingByAlias,
  findingByCanonicalId,
  loadFindingRegistry,
  validateFindingRegistry,
} from '../src/internal.js';

const real = loadFindingRegistry();

function fixture(): FindingRegistry {
  return JSON.parse(JSON.stringify(real)) as FindingRegistry;
}

describe('finding registry', () => {
  it('loads the real registry with the fixed audit inventory', () => {
    expect(real.version).toBe(2);
    expect(real.explicitNonClaims.length).toBeGreaterThan(0);
    expect(real.rows).toHaveLength(68);
    expect(FINDING_ALIASES).toHaveLength(70);
    expect(new Set(real.rows.flatMap((row) => row.aliases)).size).toBe(70);
    expect(CANONICAL_FINDING_IDS).toHaveLength(68);
  });

  it('resolves every alias exactly once and round-trips lookups', () => {
    const index = aliasIndex(real);
    expect(index.size).toBe(70);
    for (const alias of FINDING_ALIASES)
      expect(index.get(alias)?.aliases).toContain(alias);
    expect(findingByAlias('opus:F-19', real)?.canonicalId).toBe(
      'source-authority-opus-f19',
    );
    expect(
      findingByCanonicalId('source-authority-opus-f19', real)?.aliases,
    ).toEqual(['opus:F-19']);
  });

  it('preserves status reasoning and non-accepted dispositions', () => {
    expect(real.rows.filter((row) => row.statusReasoning)).toHaveLength(4);
    expect(
      real.rows.find((row) => row.canonicalId === 'source-authority-opus-f19')
        ?.statusReasoning,
    ).toBe(
      'Reviewed empty current membership: the source-backed spellPreparation clause is absent from the current pack; preserve this source identity until the clause IR follow-up lands.',
    );
    expect(real.rows.filter((row) => row.status === 'narrowed')).toHaveLength(
      1,
    );
    expect(
      real.rows.filter((row) => row.status === 'disclosed-dependency'),
    ).toHaveLength(2);
    for (const row of real.rows.filter((row) => row.status !== 'accepted'))
      expect(row.statusReasoning).toBeTruthy();
  });

  it('rejects duplicate, missing, and unexpected canonical identities', () => {
    const duplicate = fixture();
    duplicate.rows[1] = { ...duplicate.rows[0] };
    expect(() => validateFindingRegistry(duplicate)).toThrow(
      /duplicate canonicalId/,
    );
    const missing = fixture();
    missing.rows = missing.rows.slice(1);
    expect(() => validateFindingRegistry(missing)).toThrow(
      /canonicalId set mismatch.*missing/,
    );
    const unexpected = fixture();
    unexpected.rows[0] = {
      ...unexpected.rows[0],
      canonicalId: 'unexpected-finding',
    };
    expect(() => validateFindingRegistry(unexpected)).toThrow(
      /canonicalId set mismatch.*unexpected/,
    );
  });

  it('rejects invalid relationships and status metadata', () => {
    const alias = fixture();
    alias.rows[0].provenance.auditFinding = 'opus:F-20';
    expect(() => validateFindingRegistry(alias)).toThrow(/auditFinding/);
    const status = fixture();
    status.rows[0].status = 'narrowed';
    status.rows[0].statusReasoning = undefined;
    expect(() => validateFindingRegistry(status)).toThrow(
      /requires statusReasoning/,
    );
    const duplicateAlias = fixture();
    duplicateAlias.rows[1].aliases = [...duplicateAlias.rows[0].aliases];
    expect(() => validateFindingRegistry(duplicateAlias)).toThrow(
      /duplicate alias/,
    );
    const version = fixture();
    version.version = 1 as 2;
    expect(() => validateFindingRegistry(version)).toThrow(
      /version must be exactly 2/,
    );
  });

  it.each([
    'baselineMembership',
    'target',
    'violation',
    'obligation',
    'capabilityId',
  ])('rejects forbidden field %s and names its owning foundations', (key) => {
    const invalid = fixture();
    (invalid.rows[0] as unknown as Record<string, unknown>)[key] = {};
    expect(() => validateFindingRegistry(invalid)).toThrow(
      /Foundation 3 \/ Foundation 4/,
    );
  });

  it('rejects unknown fields and stays independent of membership sources', () => {
    const invalid = fixture();
    (invalid.rows[0] as unknown as Record<string, unknown>).futureField = true;
    expect(() => validateFindingRegistry(invalid)).toThrow(
      /unknown row 0 field/,
    );
    const source = readFileSync(
      new URL('../src/rules/findingRegistry.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('node:child_process');
    expect(source).not.toContain('records.json');
  });
});
