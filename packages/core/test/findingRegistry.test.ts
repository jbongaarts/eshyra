import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  aliasIndex,
  checkBeadReferences,
  evaluateMembershipQuery,
  generateMembershipSnapshot,
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
      expect(row.membershipDerivation.sourceScope).toBeTruthy();
      expect(row.membershipDerivation.currentMatch).toMatch(
        /^(required|may-be-missing-until-repair)$/,
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

    const withoutSmallPopulationJustification = structuredClone(registry);
    withoutSmallPopulationJustification.rows[0].exemplarJustification =
      undefined;
    expect(() =>
      validateFindingRegistry(withoutSmallPopulationJustification),
    ).toThrow(/exemplarJustification/i);

    const templated = structuredClone(registry);
    for (const row of templated.rows) {
      row.invariant = `The source-backed obligation for ${row.canonicalId} remains represented at the exact audited target.`;
    }
    expect(() => validateFindingRegistry(templated)).toThrow(
      /defect-specific|template/i,
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
      const evaluation = evaluateMembershipQuery(row.violation.queryId);
      expect(evaluation.expected).toEqual(row.baselineMembership.members);
      if (row.membershipDerivation.currentMatch === 'required') {
        expect(evaluation.current).toEqual(row.baselineMembership.members);
        expect(evaluation.missing).toHaveLength(0);
      } else {
        expect(evaluation.current.length).toBeLessThanOrEqual(
          evaluation.expected.length,
        );
      }
    }
  });

  it('represents ten required target cases with matching kinds and selectors', () => {
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
    const cases = [
      ['opus:F-19', 'clause', 'feature:bard:spellcasting', 'clauseId'],
      ['opus:F-20', 'path', 'manifest.json', 'artifactPath'],
      ['sol:CAP-008', 'clause', 'magic-item:bag-of-beans', 'clauseId'],
      ['sol:CAP-002', 'record', 'magic-item:bag-of-beans', 'recordKey'],
      ['sol:CAP-007', 'capability', 'magic-item:bag-of-beans', 'clauseId'],
      ['opus:F-30', 'relationship', 'creature:wererat', 'path'],
      ['opus:F-28', 'field', 'creature:druid', 'path'],
      ['opus:F-25', 'relationship', 'hazard:pits', 'path'],
      ['opus:F-08', 'record', 'spell:flaming-sphere', 'recordKey'],
      ['fable:F4', 'record', 'table:ability-scores-and-modifiers', 'recordKey'],
    ] as const;
    for (const [alias, kind, locus, nestedKey] of cases) {
      const row = byAlias(alias);
      expect(row.target.kind, alias).toBe(kind);
      expect(
        row.target.selector.members.some(
          (member) =>
            member.recordKey === locus || member.artifactPath === locus,
        ),
        alias,
      ).toBe(true);
      expect(
        row.target.selector.members.some(
          (member) => member[nestedKey] !== undefined,
        ),
        alias,
      ).toBe(true);
    }
    expect(byAlias('sol:CAP-002').status).toBe('narrowed');
    expect(byAlias('sol:CAP-007').obligation.evidenceKind).toBe('code');
    expect(
      byAlias('sol:CAP-007').baselineMembership.members.every(
        (member) => member.clauseId,
      ),
    ).toBe(true);
    expect(
      byAlias('sol:CAP-007').baselineMembership.members.length,
    ).toBeGreaterThan(byAlias('sol:CAP-008').baselineMembership.members.length);
  });

  it('derives corpus populations rather than retaining exemplars', () => {
    const registry = loadFindingRegistry();
    const records = requireRecords() as Array<{ key?: unknown }>;
    const row = (canonicalId: string) => {
      const result = registry.rows.find(
        (candidate) => candidate.canonicalId === canonicalId,
      );
      if (result === undefined) throw new Error(`missing row ${canonicalId}`);
      return result;
    };
    expect(
      row('rule-corpus-procedures').baselineMembership.members.length,
    ).toBe(
      records.filter(
        (record) =>
          typeof record.key === 'string' && record.key.startsWith('rule:'),
      ).length,
    );
    expect(row('spell-completeness').baselineMembership.members.length).toBe(
      records.filter(
        (record) =>
          typeof record.key === 'string' && record.key.startsWith('spell:'),
      ).length,
    );
    expect(row('engine-capability-ownership').target.kind).toBe('capability');
    expect(
      row('engine-capability-ownership').baselineMembership.members.every(
        (member) =>
          member.recordKey?.startsWith('magic-item:') && member.clauseId,
      ),
    ).toBe(true);
    for (const canonicalId of [
      'rule-corpus-procedures',
      'spell-completeness',
      'half-damage-branches',
      'audit-readiness-gate',
      'readiness-integrity',
      'engine-capability-ownership',
      'magic-item-effects',
    ]) {
      const finding = row(canonicalId);
      expect(generateMembershipSnapshot(finding)).toEqual(
        finding.baselineMembership.members,
      );
    }
    const evaluation = evaluateMembershipQuery(
      'finding:engine-capability-ownership',
    );
    expect(
      evaluation.currentStatus.every(
        (match) => match.status === 'engine-pending',
      ),
    ).toBe(true);
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
