import { describe, expect, it } from 'vitest';
import {
  BASE_REQUIREMENTS,
  type Clause,
  ENGINE_CAPABILITY_OWNERS,
  evaluateClauseCompleteness,
  type ObligationSource,
  type SemanticFacet,
  type SourceObligationRecord,
} from '../src/rules/clauseIr/index.js';

const span = {
  sourceRef: 'srd-5.1',
  locator: 'p.104#fireball',
  start: 10,
  end: 42,
  text: 'The target makes a saving throw.',
} as const;

function record(
  facet: SemanticFacet,
  locator = span.locator,
  origin: SourceObligationRecord['origin'] = 'source-extraction',
): SourceObligationRecord {
  const obligationId = `obl:::${span.sourceRef}:::${locator}:::${facet}`;
  return {
    obligationId,
    origin,
    evidence:
      origin === 'source-extraction'
        ? [{ kind: 'source-span', ...span, locator }]
        : origin === 'curated-specification'
          ? [
              {
                kind: 'authoritative-input',
                sourceRef: span.sourceRef,
                locator,
                inputId: 'curated:fireball',
                digest: 'sha256:fixture',
              },
            ]
          : [
              {
                kind: 'audit-finding',
                findingId: 'audit:missing',
                sourceRef: span.sourceRef,
                locator,
              },
            ],
    requiredFacets: [facet],
  };
}

type FixtureObligationSource = ObligationSource & {
  readonly records: readonly SourceObligationRecord[];
};

function source(
  facet: SemanticFacet,
  locator = span.locator,
  origin: SourceObligationRecord['origin'] = 'source-extraction',
): FixtureObligationSource {
  const records = [record(facet, locator, origin)];
  return {
    records,
    get: (obligationId) =>
      records.find((record) => record.obligationId === obligationId),
  };
}

function makeClause(
  obligations = source('save'),
  overrides: Partial<Clause> = {},
): Clause {
  const obligation = obligations.records[0];
  return {
    identity: { id: 'clause:fixture', canonicalKey: 'fixture', revision: 'v1' },
    sourceSpans: [span],
    provenance: {
      sourceRef: span.sourceRef,
      extraction: 'structural-parser',
      evidence: ['fixture'],
    },
    semanticOwner: { id: 'projector:fixture', kind: 'projector' },
    recordOwner: { family: 'spell', key: 'spell:fixture' },
    kind: 'save',
    sourceObligationIds:
      obligation === undefined ? [] : [obligation.obligationId],
    trigger: {
      id: 'trigger',
      summary: 'activation',
      sourceText: 'when activated',
    },
    eligibility: null,
    activationCost: null,
    targets: { mode: 'single', count: 1, description: 'one target' },
    geometry: null,
    checks: [],
    attacks: [],
    saves: [
      {
        id: 'save:1',
        ability: 'Dexterity',
        dc: '15',
        purpose: 'avoid the effect',
      },
    ],
    alternatives: [],
    branches: { success: null, failure: null, partialSuccess: null },
    damage: [
      { id: 'damage:1', damageType: 'fire', amount: '2d6', on: 'failure' },
    ],
    healing: [],
    grants: [],
    ledgerChanges: [],
    stateTransitions: [],
    duration: null,
    recurrence: null,
    repeatChecks: [],
    immunityWindows: [],
    termination: null,
    executionOwner: { kind: 'engine', id: 'save-resolution' },
    requiredEngineCapabilities: [
      {
        capability: 'engine:F1',
        owningBead: ENGINE_CAPABILITY_OWNERS['engine:F1'],
      },
    ],
    readiness: {
      captured: obligation?.evidence ?? [],
      supported: [
        {
          capability: 'engine:F1',
          owningBead: ENGINE_CAPABILITY_OWNERS['engine:F1'],
        },
      ],
      discoverable: [{ resolverId: 'rules-index', path: 'spell:fixture' }],
    },
    regressionEvidence: [
      {
        id: 'test:fixture',
        kind: 'test',
        assertion: 'fixture',
        locator: 'test',
      },
    ],
    ...overrides,
  };
}

const resolvers = {
  sourceEvidenceResolver: { resolve: () => ({ status: 'resolved' as const }) },
  capabilityResolver: {
    resolve: (reference: { capability: string; owningBead: string }) => ({
      status: 'resolved' as const,
      capability: reference.capability,
      owningBead: reference.owningBead,
      implemented: true,
    }),
  },
  discoveryResolver: {
    resolve: () => ({
      status: 'resolved' as const,
      clauseId: 'clause:fixture',
    }),
  },
};

function complete(
  facet: SemanticFacet,
  overrides: Partial<Clause> = {},
): { clause: Clause; result: ReturnType<typeof evaluateClauseCompleteness> } {
  const obligations = source(facet);
  const clause = makeClause(obligations, overrides);
  return {
    clause,
    result: evaluateClauseCompleteness(clause, obligations, resolvers),
  };
}

describe('source-clause canonical contracts', () => {
  it('enforces one obligation per clause while allowing many facets on that obligation', () => {
    const obligations = source('save');
    const obligation = obligations.records[0];
    if (obligation === undefined) throw new Error('fixture obligation missing');
    const composed = {
      ...obligation,
      requiredFacets: ['save', 'duration'] as const,
    };
    const composedSource: FixtureObligationSource = {
      records: [composed],
      get: (obligationId) =>
        obligationId === composed.obligationId ? composed : undefined,
    };
    const clause = makeClause(composedSource, {
      duration: { amount: '1', unit: 'minute', concentration: false },
    });
    expect(
      evaluateClauseCompleteness(clause, composedSource, resolvers).semantic
        .status,
    ).toBe('complete');
    expect(
      evaluateClauseCompleteness(
        {
          ...clause,
          sourceObligationIds: [
            clause.sourceObligationIds[0],
            'obl:::srd-5.1:::other:::duration',
          ],
        },
        composedSource,
        resolvers,
      ).semantic.reasons,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'multiple-obligation-references' }),
      ]),
    );
  });

  it('applies unremovable canonical base requirements to every facet', () => {
    expect(BASE_REQUIREMENTS).toHaveLength(5);
    const fields: Array<[keyof Clause, unknown]> = [
      ['identity', { id: '', canonicalKey: 'fixture', revision: 'v1' }],
      ['sourceSpans', []],
      [
        'provenance',
        { sourceRef: '', extraction: 'structural-parser', evidence: [] },
      ],
      ['semanticOwner', { id: '', kind: 'projector' }],
      ['recordOwner', { family: 'spell', key: '' }],
    ];
    for (const [field, value] of fields) {
      const { result } = complete('save', {
        [field]: value,
      } as Partial<Clause>);
      expect(result.semantic.status, field).toBe('incomplete');
      expect(result.semantic.reasons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'invalid-base-field', field }),
        ]),
      );
    }
  });

  it('rejects contradictory provenance and semantic-owner authority', () => {
    for (const overrides of [
      {
        provenance: {
          sourceRef: 'other-source',
          extraction: 'structural-parser' as const,
          evidence: ['fixture'],
        },
      },
      {
        provenance: {
          sourceRef: span.sourceRef,
          extraction: 'not-a-real-extractor' as never,
          evidence: ['fixture'],
        },
      },
      {
        semanticOwner: {
          id: 'projector:fixture',
          kind: 'not-an-owner' as never,
        },
      },
      {
        semanticOwner: { id: 'model:fixture', kind: 'projector' as const },
      },
    ] as const) {
      const { result } = complete('save', overrides as Partial<Clause>);
      expect(result.semantic.status).toBe('incomplete');
      expect(result.semantic.reasons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'invalid-base-field' }),
        ]),
      );
    }
  });

  it.each([
    ['save-with-damage', 'saves', { saves: [] }],
    ['save-without-damage', 'saves', { saves: [], damage: [] }],
    ['save-with-alternate-outcomes', 'saves', { saves: [] }],
    ['attack-with-one-damage-mode', 'attacks', { attacks: [] }],
    ['attack-with-conditional-alternatives', 'attacks', { attacks: [] }],
    [
      'resource-with-reset',
      'ledgerChanges',
      {
        ledgerChanges: [],
        recurrence: { interval: 'uses', reset: 'long-rest' },
      },
    ],
    [
      'resource-without-reset',
      'ledgerChanges',
      { ledgerChanges: [], recurrence: null },
    ],
    ['duration-with-concentration', 'duration', { duration: null }],
    ['duration-without-concentration', 'duration', { duration: null }],
    [
      'effect-with-lifecycle',
      'stateTransitions',
      { damage: [], stateTransitions: [] },
    ],
    [
      'effect-without-lifecycle',
      'damage',
      { damage: [], stateTransitions: [] },
    ],
  ] as const)('requires the base facet for %s', (facet, field, overrides) => {
    const { result } = complete(facet, overrides as Partial<Clause>);
    expect(result.semantic.status, field).toBe('incomplete');
    expect(result.semantic.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ...(field === 'damage'
            ? { code: 'unsatisfied-alternative' }
            : { field }),
        }),
      ]),
    );
  });

  it('represents recurrence and immunity windows as canonical facets', () => {
    expect(
      complete('recurrence', {
        recurrence: { interval: 'round', reset: 'round' },
      }).result.semantic.status,
    ).toBe('complete');
    expect(
      complete('immunity-window', {
        immunityWindows: [
          { subject: 'target', immunity: 'fire', duration: null },
        ],
      }).result.semantic.status,
    ).toBe('complete');
    expect(
      complete('recurrence', { recurrence: null }).result.semantic.status,
    ).toBe('incomplete');
  });

  it('requires symmetric exclusion partitions and projected atom bindings', () => {
    const valid = {
      a: {
        id: 'a',
        label: 'near',
        mutuallyExclusiveWith: ['b'],
        clauseIds: ['damage:1'],
      },
      b: {
        id: 'b',
        label: 'far',
        mutuallyExclusiveWith: ['a'],
        clauseIds: ['save:1'],
      },
    };
    expect(
      complete('attack-with-conditional-alternatives', {
        attacks: [
          {
            id: 'attack:1',
            attackType: 'melee',
            defense: 'armor-class',
            attackBonus: '+5',
            purpose: 'hit',
          },
        ],
        alternatives: Object.values(valid),
      }).result.semantic.status,
    ).toBe('complete');
    expect(
      complete('attack-with-conditional-alternatives', {
        alternatives: [
          { ...valid.a, mutuallyExclusiveWith: ['b'], clauseIds: [] },
          valid.b,
        ],
      }).result.semantic.status,
    ).toBe('incomplete');
    expect(
      complete('attack-with-conditional-alternatives', {
        alternatives: [{ ...valid.a, mutuallyExclusiveWith: [] }, valid.b],
      }).result.semantic.reasons,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid-alternative-graph' }),
      ]),
    );
  });

  it('requires branches to bind source spans and projected atoms', () => {
    const branch = {
      id: 'success',
      outcome: 'half damage',
      condition: null,
      sourceSpan: span,
      projectedAtomIds: ['damage:1'],
    };
    expect(
      complete('save-with-alternate-outcomes', {
        branches: {
          success: branch,
          failure: { ...branch, id: 'failure', outcome: 'full damage' },
          partialSuccess: null,
        },
      }).result.semantic.status,
    ).toBe('complete');
    expect(
      complete('save-with-alternate-outcomes', {
        branches: {
          success: { ...branch, projectedAtomIds: [] },
          failure: null,
          partialSuccess: null,
        },
      }).result.semantic.status,
    ).toBe('incomplete');
  });

  it('keeps semantic completeness independent from unsupported readiness', () => {
    const { result } = complete('save', {
      requiredEngineCapabilities: [],
      readiness: {
        captured: [{ kind: 'source-span', ...span }],
        supported: [],
        discoverable: [],
      },
    });
    expect(result.semantic.status).toBe('complete');
    expect(result.readiness.projected.status).toBe('satisfied');
    expect(result.readiness.supported.status).toBe('failed');
    expect(result.readiness.discoverable.status).toBe('failed');
  });

  it('assigns every capability failure only to SUPPORTED', () => {
    expect(
      complete('save', {
        requiredEngineCapabilities: [
          { capability: 'engine:save' as never, owningBead: 'eshyra-cap-save' },
        ],
      }).result.semantic.status,
    ).toBe('complete');
    expect(
      complete('save', {
        requiredEngineCapabilities: [
          {
            capability: 'engine:F1',
            owningBead: ENGINE_CAPABILITY_OWNERS['engine:F1'],
          },
        ],
        readiness: {
          captured: [{ kind: 'source-span', ...span }],
          supported: [],
          discoverable: [{ resolverId: 'rules-index', path: 'spell:fixture' }],
        },
      }).result.semantic.status,
    ).toBe('complete');
    const { result } = complete('save', {
      readiness: {
        captured: [{ kind: 'source-span', ...span }],
        supported: [],
        discoverable: [{ resolverId: 'rules-index', path: 'spell:fixture' }],
      },
    });
    expect(result.semantic.status).toBe('complete');
    expect(result.readiness.projected.status).toBe('satisfied');
    expect(result.readiness.supported.status).toBe('failed');
  });

  it.each([
    ['unqualified', 'eshyra-olc5.f1'],
    ['wrong owner', 'eshyra-o9bd.19.5.3'],
    ['stale owner', 'eshyra-o9bd.19.5.1'],
    ['nonexistent owner', 'eshyra-o9bd.19.5.999'],
  ])(
    'rejects %s capability ownership by exact identity',
    (_label, owningBead) => {
      const { result } = complete('save', {
        requiredEngineCapabilities: [{ capability: 'engine:F1', owningBead }],
        readiness: {
          captured: [{ kind: 'source-span', ...span }],
          supported: [{ capability: 'engine:F1', owningBead }],
          discoverable: [{ resolverId: 'rules-index', path: 'spell:fixture' }],
        },
      });
      expect(result.semantic.status).toBe('complete');
      expect(result.readiness.supported.status).toBe('failed');
    },
  );

  it('accepts the actual reparented family epic for a capability', () => {
    const { result } = complete('save');
    expect(result.readiness.supported.status).toBe('satisfied');
  });

  it('restricts CAPTURED to source or authoritative evidence', () => {
    const obligations = source('save', span.locator, 'audit-finding');
    const clause = makeClause(obligations, {
      readiness: {
        captured: obligations.records[0].evidence,
        supported: [{ capability: 'engine:F1', owningBead: 'eshyra-olc5.f1' }],
        discoverable: [],
      },
    });
    const result = evaluateClauseCompleteness(clause, obligations, resolvers);
    expect(result.semantic.status).toBe('incomplete');
    expect(result.semantic.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'non-capturable-evidence' }),
      ]),
    );
  });

  it('binds branch and alternative outcomes to scalar mechanics', () => {
    const duration = {
      amount: '1',
      unit: 'minute' as const,
      concentration: false,
    };
    const branch = {
      id: 'success',
      outcome: 'duration applies',
      condition: null,
      sourceSpan: span,
      projectedAtomIds: ['scalar:duration'],
    };
    expect(
      complete('duration', {
        duration,
        branches: { success: branch, failure: null, partialSuccess: null },
      }).result.semantic.status,
    ).toBe('complete');

    const alternatives = [
      {
        id: 'short',
        label: 'short duration',
        mutuallyExclusiveWith: ['long'],
        clauseIds: ['scalar:duration'],
      },
      {
        id: 'long',
        label: 'long duration',
        mutuallyExclusiveWith: ['short'],
        clauseIds: ['scalar:duration'],
      },
    ];
    expect(
      complete('choice', { duration, alternatives }).result.semantic.status,
    ).toBe('complete');
  });
});
