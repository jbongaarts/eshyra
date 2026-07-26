import { describe, expect, it } from 'vitest';
import {
  type Clause,
  createObligationId,
  createObligationRegistry,
  evaluateClauseCompleteness,
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
  id = createObligationId(span.sourceRef, span.locator, facet),
): SourceObligationRecord {
  return {
    obligationId: id,
    origin: 'source-extraction',
    evidence: [{ kind: 'source-span', ...span }],
    requiredFacets: [facet],
  };
}

function registry(...facets: SemanticFacet[]) {
  return createObligationRegistry(
    facets.map((facet, index) =>
      record(
        facet,
        createObligationId(span.sourceRef, `${span.locator}::${index}`, facet),
      ),
    ),
  );
}

function makeClause(
  obligationRegistry = registry('save'),
  overrides: Partial<Clause> = {},
): Clause {
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
    sourceObligationIds: obligationRegistry.records.map(
      ({ obligationId }) => obligationId,
    ),
    trigger: {
      id: 'trigger',
      summary: 'activation',
      sourceText: 'when activated',
    },
    eligibility: {
      id: 'eligibility',
      summary: 'target',
      sourceText: 'a target',
    },
    activationCost: {
      kind: 'action',
      amount: 1,
      trigger: null,
      sourceText: 'as an action',
    },
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
    branches: {
      success: {
        id: 'branch:success',
        outcome: 'half effect',
        condition: null,
      },
      failure: {
        id: 'branch:failure',
        outcome: 'full effect',
        condition: null,
      },
      partialSuccess: null,
    },
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
      { capability: 'engine:save', owningBead: 'eshyra-cap-save' },
    ],
    readiness: {
      captured: obligationRegistry.records.flatMap(({ evidence }) => evidence),
      supported: [{ capability: 'engine:save', owningBead: 'eshyra-cap-save' }],
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

describe('source-clause canonical facet contracts', () => {
  it('does not let the selected kind define source obligations', () => {
    const obligations = registry('save-without-damage');
    const result = evaluateClauseCompleteness(
      makeClause(obligations, { kind: 'attack', damage: [] }),
      obligations,
      resolvers,
    );
    expect(result.semantic.status).toBe('complete');
    expect(result.dimensions.projected).toBe('satisfied');
  });

  it('uses source multiplicity so one projected atom cannot discharge two obligations', () => {
    const obligations = registry('save', 'save');
    const result = evaluateClauseCompleteness(
      makeClause(obligations),
      obligations,
      resolvers,
    );
    expect(result.semantic.status).toBe('incomplete');
    expect(result.semantic.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'wrong-cardinality', field: 'saves' }),
      ]),
    );
  });

  it('represents save-with-damage and save-without-damage without a universal damage rule', () => {
    const damaging = registry('save-with-damage');
    expect(
      evaluateClauseCompleteness(makeClause(damaging), damaging, resolvers)
        .semantic.status,
    ).toBe('complete');
    const nonDamaging = registry('save-without-damage');
    expect(
      evaluateClauseCompleteness(
        makeClause(nonDamaging, { damage: [] }),
        nonDamaging,
        resolvers,
      ).semantic.status,
    ).toBe('complete');
  });

  it('represents alternate saves, attack damage modes, and conditional alternatives', () => {
    const alternateSave = registry('save-with-alternate-outcomes');
    expect(
      evaluateClauseCompleteness(
        makeClause(alternateSave, {
          branches: {
            success: { id: 'success', outcome: 'one', condition: null },
            failure: { id: 'failure', outcome: 'two', condition: null },
            partialSuccess: {
              id: 'partial',
              outcome: 'three',
              condition: null,
            },
          },
        }),
        alternateSave,
        resolvers,
      ).semantic.status,
    ).toBe('complete');
    const attack = registry('attack-with-one-damage-mode');
    expect(
      evaluateClauseCompleteness(
        makeClause(attack, {
          kind: 'attack',
          saves: [],
          attacks: [
            {
              id: 'attack:1',
              attackType: 'melee',
              defense: 'armor-class',
              attackBonus: '+5',
              purpose: 'hit',
            },
          ],
        }),
        attack,
        resolvers,
      ).semantic.status,
    ).toBe('complete');
    const conditional = registry('attack-with-conditional-alternatives');
    expect(
      evaluateClauseCompleteness(
        makeClause(conditional, {
          kind: 'attack',
          alternatives: [
            {
              id: 'a',
              label: 'if near',
              mutuallyExclusiveWith: ['b'],
              clauseIds: [],
            },
            {
              id: 'b',
              label: 'otherwise',
              mutuallyExclusiveWith: ['a'],
              clauseIds: [],
            },
          ],
        }),
        conditional,
        resolvers,
      ).semantic.status,
    ).toBe('complete');
  });

  it('represents reset/no-reset resources, concentration/no-concentration duration, and lifecycle/no-lifecycle effects', () => {
    const reset = registry('resource-use', 'resource-with-reset');
    expect(
      evaluateClauseCompleteness(
        makeClause(reset, {
          recurrence: { interval: 'uses', reset: 'long-rest' },
          ledgerChanges: [
            {
              id: 'ledger:1',
              ledger: 'uses',
              operation: 'decrease',
              amount: '1',
            },
          ],
        }),
        reset,
        resolvers,
      ).semantic.status,
    ).toBe('complete');
    const noReset = registry('resource-use', 'resource-without-reset');
    expect(
      evaluateClauseCompleteness(
        makeClause(noReset, {
          recurrence: null,
          ledgerChanges: [
            {
              id: 'ledger:1',
              ledger: 'uses',
              operation: 'decrease',
              amount: '1',
            },
          ],
        }),
        noReset,
        resolvers,
      ).semantic.status,
    ).toBe('complete');
    const concentration = registry('duration', 'duration-with-concentration');
    expect(
      evaluateClauseCompleteness(
        makeClause(concentration, {
          duration: { amount: '1', unit: 'minute', concentration: true },
        }),
        concentration,
        resolvers,
      ).semantic.status,
    ).toBe('complete');
    const noConcentration = registry(
      'duration',
      'duration-without-concentration',
    );
    expect(
      evaluateClauseCompleteness(
        makeClause(noConcentration, {
          duration: { amount: '1', unit: 'minute', concentration: false },
        }),
        noConcentration,
        resolvers,
      ).semantic.status,
    ).toBe('complete');
    const lifecycle = registry('effect', 'effect-with-lifecycle');
    expect(
      evaluateClauseCompleteness(
        makeClause(lifecycle, {
          stateTransitions: [
            {
              id: 'state:1',
              state: 'frightened',
              from: null,
              to: 'active',
              condition: null,
            },
          ],
        }),
        lifecycle,
        resolvers,
      ).semantic.status,
    ).toBe('complete');
    const noLifecycle = registry('effect', 'effect-without-lifecycle');
    expect(
      evaluateClauseCompleteness(
        makeClause(noLifecycle),
        noLifecycle,
        resolvers,
      ).semantic.status,
    ).toBe('complete');
  });

  it('keeps capture/project/readiness independent and derives projected from evaluation', () => {
    const obligations = registry('save');
    const result = evaluateClauseCompleteness(
      makeClause(obligations, {
        readiness: { captured: [], supported: [], discoverable: [] },
        requiredEngineCapabilities: [],
        damage: [],
      }),
      obligations,
      resolvers,
    );
    expect(result.semantic.status).toBe('incomplete');
    expect(result.readiness.captured.status).toBe('failed');
    expect(result.readiness.projected.status).toBe('satisfied');
    expect(result.readiness.supported.status).toBe('failed');
    expect(result.readiness.discoverable.status).toBe('failed');
  });

  it('preserves cardinality regression coverage for empty required collections', () => {
    const obligations = registry('save');
    const result = evaluateClauseCompleteness(
      makeClause(obligations, { saves: [], damage: [] }),
      obligations,
      resolvers,
    );
    expect(result.semantic.status).toBe('incomplete');
    expect(result.semantic.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'wrong-cardinality', field: 'saves' }),
      ]),
    );
  });

  it('does not store a mutable disposition on the clause', () => {
    const clause = makeClause();
    expect('disposition' in clause).toBe(false);
    expect('dimensions' in clause.readiness).toBe(false);
  });
});
