import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  aliasIndex,
  capabilityIdentitiesForHook,
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
    for (const row of underived) {
      expect(row.underivedReason).toMatchObject({
        blockedBy: { kind: 'bead', ref: 'eshyra-o9bd.19.1.7' },
      });
      expect(row.underivedReason?.cause).toMatch(
        /^(requires-audit-prose-reconciliation|requires-clause-ir|requires-external-source|requires-engine-capability)$/,
      );
      expect(row.owningDerivationBead).toBe('eshyra-o9bd.19.1.7');
      expect(row.invariant).toEqual({
        kind: 'source-semantic-preservation',
        dimensions: [
          'branches',
          'alternatives',
          'timing',
          'lifecycle',
          'termination',
        ],
        evidence: {
          kind: 'audit-finding',
          locator: row.obligation.authority,
        },
      });
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

    const templatedReason = structuredClone(registry);
    const templatedRow = templatedReason.rows.find(
      (row) => row.membershipStatus === 'underived',
    );
    if (templatedRow === undefined)
      throw new Error('fixture must contain an underived row');
    templatedRow.underivedReason = {
      cause: 'not-a-real-cause',
      blockedBy: { kind: 'bead', ref: 'eshyra-o9bd.19.1.6.9' },
    } as never;
    expect(() => validateFindingRegistry(templatedReason)).toThrow(
      /blocking cause|resolve to eshyra-o9bd.19.1.7/i,
    );

    const templated = structuredClone(registry);
    for (const row of templated.rows) {
      row.invariant = {
        kind: 'source-semantic-preservation',
        dimensions: ['branches'],
        evidence: {
          kind: 'audit-finding',
          locator: row.obligation.authority,
        },
      };
    }
    expect(() => validateFindingRegistry(templated)).not.toThrow();

    const invalidInvariant = structuredClone(registry);
    invalidInvariant.rows[0].invariant = {
      kind: 'source-semantic-preservation',
      dimensions: ['branches', 'branches'],
      evidence: {
        kind: 'audit-finding',
        locator: invalidInvariant.rows[0].obligation.authority,
      },
    };
    expect(() => validateFindingRegistry(invalidInvariant)).toThrow(
      /dimensions contains duplicates/i,
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

  it('uses a closed multi-valued hook relation and fails closed when indeterminate', () => {
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
    expect(
      capabilityIdentitiesForHook(
        'F10',
        'currency, property, inventory, and XP ledger outcomes',
      ).map((identity) => identity.primitive),
    ).toEqual([
      'canonical-currency-mutation',
      'retained-inventory-property-xp-asset-creation',
    ]);
    expect(
      capabilityIdentitiesForHook(
        'F5',
        'per-item storage, charge, and reset state',
      ).map((identity) => identity.primitive),
    ).toEqual([
      'per-instance-usage-and-charge-spend',
      'recharge-and-reset-scheduling',
    ]);
    expect(
      capabilityIdentitiesForHook(
        'F9',
        'size-scaled quantity cost and area targeting',
      ).map((identity) => identity.primitive),
    ).toEqual([
      'capacity-and-variant-arithmetic',
      'point-origin-area-geometry-and-targeting',
    ]);
    expect(() =>
      capabilityIdentityForHook(
        'F10',
        'currency, property, inventory, and XP ledger outcomes',
      ),
    ).toThrow(/multiple primitives/);

    const auditedMultiPrimitiveHooks = [
      [
        'F10',
        'currency, property, inventory, and XP ledger outcomes',
        [
          'canonical-currency-mutation',
          'retained-inventory-property-xp-asset-creation',
        ],
      ],
      [
        'F4',
        'class spell-list eligibility and casting/copying procedure',
        [
          'caster-of-record-and-canonical-spell-execution',
          'spellbook-copy-cost-and-asset-ledger',
        ],
      ],
      [
        'F4',
        'shared spell-slot, spell-casting, and caster-of-record execution',
        [
          'caster-of-record-and-canonical-spell-execution',
          'spell-slot-gate-and-upcast-transform',
        ],
      ],
      [
        'F5',
        'duration budget and conditional periodic recharge',
        [
          'per-instance-usage-and-charge-spend',
          'recharge-and-reset-scheduling',
        ],
      ],
      [
        'F5',
        'per-item storage, charge, and reset state',
        [
          'per-instance-usage-and-charge-spend',
          'recharge-and-reset-scheduling',
        ],
      ],
      [
        'F9',
        'area targeting and forced movement',
        [
          'point-origin-area-geometry-and-targeting',
          'forced-movement-contest-and-object-interaction',
        ],
      ],
      [
        'F9',
        'checks, saves, damage, movement, and destruction outcomes',
        [
          'damage-rider-and-half-damage-branch-resolution',
          'forced-movement-contest-and-object-interaction',
        ],
      ],
      [
        'F9',
        'damage, range, cover, and forced movement',
        [
          'damage-rider-and-half-damage-branch-resolution',
          'forced-movement-contest-and-object-interaction',
        ],
      ],
      [
        'F9',
        'damage, saving throws, and targeting',
        [
          'damage-rider-and-half-damage-branch-resolution',
          'point-origin-area-geometry-and-targeting',
        ],
      ],
      [
        'F9',
        'geometry, targeting, movement, and contest resolution',
        [
          'point-origin-area-geometry-and-targeting',
          'forced-movement-contest-and-object-interaction',
        ],
      ],
      [
        'F9',
        'saving throw, damage, and attack targeting consequences',
        [
          'damage-rider-and-half-damage-branch-resolution',
          'point-origin-area-geometry-and-targeting',
        ],
      ],
      [
        'F9',
        'size-scaled quantity cost and area targeting',
        [
          'capacity-and-variant-arithmetic',
          'point-origin-area-geometry-and-targeting',
        ],
      ],
      [
        'F9',
        'variant targeting, movement, and capacity arithmetic',
        [
          'capacity-and-variant-arithmetic',
          'point-origin-area-geometry-and-targeting',
          'forced-movement-contest-and-object-interaction',
        ],
      ],
    ] as const;
    for (const [engine, hook, primitives] of auditedMultiPrimitiveHooks) {
      expect(
        capabilityIdentitiesForHook(engine, hook).map(
          (identity) => identity.primitive,
        ),
        `${engine}/${hook}`,
      ).toEqual(primitives);
    }
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
      registry.rows.map((row) => row.canonicalId),
    );
    expect(findingRegistryClosureReady(allDerived)).toBe(false);

    const packOnlyDerived = structuredClone(registry);
    const packRow = packOnlyDerived.rows.find(
      (row) => row.membershipDerivation.generator === 'pack-record-kind',
    );
    if (packRow === undefined) throw new Error('fixture needs a pack row');
    packRow.membershipStatus = 'derived';
    packRow.underivedReason = undefined;
    packRow.owningDerivationBead = undefined;
    expect(findingRegistryClosureBlockers(packOnlyDerived)).toContain(
      packRow.canonicalId,
    );

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

    const nestedArray = structuredClone(registry);
    Object.assign(
      nestedArray.rows[0].target.selector.members[0] as unknown as Record<
        string,
        unknown
      >,
      { nested: [{ entries: [{ total: 1 }] }] },
    );
    expect(() => validateFindingRegistry(nestedArray)).toThrow(
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
