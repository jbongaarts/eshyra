import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  aliasIndex,
  capabilityIdentityForHook,
  checkBeadReferences,
  evaluateMembershipQuery,
  findingRegistryClosureBlockers,
  findingRegistryClosureReady,
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

  it('distinguishes executable membership from prose-scoped membership', () => {
    const registry = loadFindingRegistry();
    const derived = registry.rows.filter(
      (row) => row.membershipStatus === 'derived',
    );
    expect(derived).toHaveLength(0);

    const underived = registry.rows.filter(
      (row) => row.membershipStatus === 'underived',
    );
    expect(underived).toHaveLength(68);
    expect(new Set(underived.map((row) => row.underivedReason)).size).toBe(
      underived.length,
    );
    for (const row of underived) {
      expect(row.underivedReason).toBeTruthy();
      expect(row.underivedReason).not.toContain(row.canonicalId);
      expect(row.owningDerivationBead).toBe('eshyra-o9bd.19.1.7');
    }
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

    const duplicateReason = structuredClone(registry);
    const underivedRows = duplicateReason.rows.filter(
      (row) => row.membershipStatus === 'underived',
    );
    underivedRows[1].underivedReason = underivedRows[0].underivedReason;
    expect(() => validateFindingRegistry(duplicateReason)).toThrow(
      /underivedReason is shared/i,
    );

    const templatedReason = structuredClone(registry);
    const templatedRow = templatedReason.rows.find(
      (row) => row.membershipStatus === 'underived',
    );
    if (templatedRow === undefined)
      throw new Error('fixture must contain an underived row');
    templatedRow.underivedReason = `Membership for ${templatedRow.canonicalId} remains underived.`;
    expect(() => validateFindingRegistry(templatedReason)).toThrow(
      /canonicalId template/i,
    );

    const titleReasonTemplates = structuredClone(registry);
    const reasonRows = titleReasonTemplates.rows.filter(
      (row) => row.membershipStatus === 'underived',
    );
    reasonRows[0].underivedReason =
      'The audit-derived membership boundary for spell preparation quotation limits still requires reconciliation against the named review evidence; the checked-in identities are not closure evidence.';
    reasonRows[1].underivedReason =
      'The audit-derived membership boundary for manifest provenance lineage still requires reconciliation against the named review evidence; the checked-in identities are not closure evidence.';
    expect(() => validateFindingRegistry(titleReasonTemplates)).toThrow(
      /underivedReason contains a shared template/i,
    );

    const titleInvariantTemplates = structuredClone(registry);
    const invariantRows = titleInvariantTemplates.rows.slice(0, 2);
    invariantRows[0].invariant =
      'The repair must preserve spell preparation quotation limits while satisfying the source-backed obligation at the exact audited target.';
    invariantRows[1].invariant =
      'The repair must preserve manifest provenance lineage while satisfying the source-backed obligation at the exact audited target.';
    expect(() => validateFindingRegistry(titleInvariantTemplates)).toThrow(
      /invariant contains a shared template/i,
    );

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
  }, 15000);

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

  it('qualifies every capability membership with the ledger identity and family owner', () => {
    const registry = loadFindingRegistry();
    const engine = registry.rows.find(
      (row) => row.canonicalId === 'engine-capability-ownership',
    );
    if (engine === undefined) throw new Error('missing engine capability row');
    expect(engine.target.kind).toBe('capability');
    expect(engine.target.selector.members.length).toBeGreaterThan(0);
    expect(
      new Set(
        engine.target.selector.members.map(
          (member) => member.capability?.capabilityId,
        ),
      ),
    ).toEqual(
      new Set(Array.from({ length: 10 }, (_, index) => `engine:F${index + 1}`)),
    );
    expect(
      engine.target.selector.members.every((member) => {
        const capability = member.capability;
        const expectedOwner =
          capability === undefined
            ? undefined
            : {
                'engine:F1': 'eshyra-o9bd.19.5.2',
                'engine:F2': 'eshyra-o9bd.19.5.3',
                'engine:F3': 'eshyra-o9bd.19.5.4',
                'engine:F4': 'eshyra-o9bd.19.5.5',
                'engine:F5': 'eshyra-o9bd.19.5.6',
                'engine:F6': 'eshyra-o9bd.19.5.7',
                'engine:F7': 'eshyra-o9bd.19.5.8',
                'engine:F8': 'eshyra-o9bd.19.5.9',
                'engine:F9': 'eshyra-o9bd.19.5.10',
                'engine:F10': 'eshyra-o9bd.19.5.11',
              }[capability.capabilityId];
        return (
          capability !== undefined &&
          capability.hookSelector?.engine ===
            capability.capabilityId.slice('engine:'.length) &&
          capability.primitive.length > 0 &&
          capability.owningBead === expectedOwner
        );
      }),
    ).toBe(true);
  });

  it('rejects unqualified families, unknown primitives, missing owners, and wrong owners', () => {
    const registry = loadFindingRegistry();
    const engine = registry.rows.find(
      (row) => row.canonicalId === 'engine-capability-ownership',
    );
    if (engine === undefined) throw new Error('missing engine capability row');
    const memberIndex = engine.target.selector.members.findIndex(
      (member) => member.capability !== undefined,
    );
    if (memberIndex < 0) throw new Error('fixture needs a capability member');

    const cases = [
      {
        name: 'unqualified family',
        mutate: (capability: Record<string, unknown>) =>
          Object.assign(capability, { capabilityId: 'F1' }),
        error: /engine:F1\.\.engine:F10/,
      },
      {
        name: 'unknown primitive',
        mutate: (capability: Record<string, unknown>) =>
          Object.assign(capability, { primitive: 'unknown-primitive' }),
        error: /primitive is unknown/,
      },
      {
        name: 'missing owner',
        mutate: (capability: Record<string, unknown>) =>
          Reflect.deleteProperty(capability, 'owningBead'),
        error: /owningBead must be a non-empty string/,
      },
      {
        name: 'wrong owner',
        mutate: (capability: Record<string, unknown>) =>
          Object.assign(capability, { owningBead: 'eshyra-olc5' }),
        error: /owningBead must be the engine:F/,
      },
    ];

    for (const testCase of cases) {
      const malformed = structuredClone(registry);
      const malformedEngine = malformed.rows.find(
        (row) => row.canonicalId === 'engine-capability-ownership',
      );
      if (malformedEngine === undefined)
        throw new Error(`missing engine row for ${testCase.name}`);
      const targetMember = malformedEngine.target.selector.members[memberIndex];
      const baselineMember =
        malformedEngine.baselineMembership.members[memberIndex];
      if (
        targetMember.capability === undefined ||
        baselineMember.capability === undefined
      )
        throw new Error(`fixture lost capability for ${testCase.name}`);
      testCase.mutate(
        targetMember.capability as unknown as Record<string, unknown>,
      );
      testCase.mutate(
        baselineMember.capability as unknown as Record<string, unknown>,
      );
      expect(() => validateFindingRegistry(malformed), testCase.name).toThrow(
        testCase.error,
      );
    }
  });

  it('uses a closed hook relation, including the F2 legendary-action primitive', () => {
    expect(
      capabilityIdentityForHook(
        'F2',
        'legendary action allowance and option cost',
      ).primitive,
    ).toBe('legendary-action-allowance-and-option-cost');
    for (const hook of [
      'legendary action allowance and option costs',
      'unrelated action economy',
      'unknown hook',
    ]) {
      expect(() => capabilityIdentityForHook('F2', hook)).toThrow(
        /unknown hook/,
      );
    }
    expect(() => capabilityIdentityForHook('F10', 'currency mutation')).toThrow(
      /unknown hook/,
    );
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

    expect(
      registry.rows
        .filter((row) => row.membershipDerivation.generator.startsWith('pack-'))
        .every((row) => row.membershipStatus === 'underived'),
    ).toBe(true);
  });

  it('blocks closure while membership remains underived', () => {
    const registry = loadFindingRegistry();
    const blockers = findingRegistryClosureBlockers(registry);
    expect(findingRegistryClosureReady(registry)).toBe(false);
    const underivedIds = registry.rows
      .filter((row) => row.membershipStatus === 'underived')
      .map((row) => row.canonicalId);
    expect(blockers).toEqual(underivedIds);

    const allDerived = structuredClone(registry);
    allDerived.rows = allDerived.rows.map((row) => ({
      ...row,
      membershipStatus: 'derived' as const,
      underivedReason: undefined,
      owningDerivationBead: undefined,
    }));
    expect(findingRegistryClosureBlockers(allDerived)).toEqual(
      underivedIds.filter((canonicalId) => {
        const row = allDerived.rows.find(
          (candidate) => candidate.canonicalId === canonicalId,
        );
        return row?.membershipDerivation.generator.startsWith('audited-');
      }),
    );
    expect(findingRegistryClosureReady(allDerived)).toBe(false);

    const deletedRow = registry.rows.at(-1);
    if (deletedRow === undefined) throw new Error('fixture must have rows');
    const deletedObligation = {
      version: 1 as const,
      rows: registry.rows.slice(0, -1),
    };
    const deletedBlockers = findingRegistryClosureBlockers(deletedObligation);
    expect(deletedBlockers).toContain(`missing:${deletedRow.canonicalId}`);
    expect(deletedBlockers).not.toEqual([]);
    expect(findingRegistryClosureReady(deletedObligation)).toBe(false);
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

  it('rejects reasons that share a template across rows', () => {
    // The guard this protects has failed three times in this program, each time
    // by a required field being filled mechanically: one identical
    // exemplarJustification across 61 rows, round-robin audit aliases in the
    // capability ledger, and title-substituted reasons here. Equality checks
    // miss all three, so the guard normalises row-specific tokens away and
    // compares the residual skeleton. Without this test a later change could
    // relax TEMPLATE_COLLISION_LIMIT or blunt the normaliser and nothing would
    // notice.
    const registry = loadFindingRegistry();
    const underived = registry.rows.filter(
      (row) => row.membershipStatus === 'underived',
    );
    const [first, second] = underived;

    // This is the checked-in pattern from the failed revision: the subject is
    // paraphrased rather than copied from title, so literal-token stripping
    // cannot catch it.
    const templated = {
      ...registry,
      rows: registry.rows.map((row) => {
        if (row.canonicalId === first.canonicalId)
          return {
            ...row,
            underivedReason:
              'The audit-derived membership boundary for spell preparation quotation limits still requires reconciliation against the named review evidence; the checked-in identities are not closure evidence.',
          };
        if (row.canonicalId === second.canonicalId)
          return {
            ...row,
            underivedReason:
              'The audit-derived membership boundary for manifest provenance lineage still requires reconciliation against the named review evidence; the checked-in identities are not closure evidence.',
          };
        return row;
      }),
    };

    expect(() => validateFindingRegistry(templated)).toThrow(
      /shared template across rows/,
    );
  });

  it('does not store hand-copied totals', () => {
    const registry = loadFindingRegistry();
    expect(JSON.stringify(registry)).not.toMatch(
      /"(?:count|total|storedCount|storedTotal)"\s*:/i,
    );

    const nestedMember = structuredClone(registry);
    Object.assign(
      nestedMember.rows[0].target.selector.members[0] as unknown as Record<
        string,
        unknown
      >,
      { total: 1 },
    );
    expect(() => validateFindingRegistry(nestedMember)).toThrow(
      /hand-copied total/,
    );

    const nestedCapability = structuredClone(registry);
    const capabilityRow = nestedCapability.rows.find(
      (row) => row.canonicalId === 'engine-capability-ownership',
    );
    if (capabilityRow === undefined)
      throw new Error('fixture must contain a capability row');
    Object.assign(
      capabilityRow.target.selector.capabilityCatalog?.[0] as unknown as Record<
        string,
        unknown
      >,
      { storedCount: 1 },
    );
    expect(() => validateFindingRegistry(nestedCapability)).toThrow(
      /hand-copied total/,
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
