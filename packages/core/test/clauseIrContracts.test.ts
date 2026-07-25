import { describe, expect, it } from 'vitest';
import {
  CLAUSE_COMPLETENESS_CONTRACTS,
  type Clause,
  evaluateClauseCompleteness,
  getClauseCompletenessContract,
  RECORD_FAMILY_COMPLETENESS_CONTRACTS,
} from '../src/rules/clauseIr/index.js';

const sourceSpan = {
  sourceRef: 'fixture:rules',
  locator: 'p. 1, paragraph 2',
  start: 10,
  end: 36,
  text: 'The target makes a saving throw.',
};

function makeClause(overrides: Partial<Clause> = {}): Clause {
  return {
    identity: {
      id: 'clause:fixture:save',
      canonicalKey: 'fixture:save',
      revision: 'fixture-v1',
    },
    sourceSpans: [sourceSpan],
    provenance: {
      sourceRef: 'fixture:rules',
      extraction: 'curated-specification',
      evidence: ['fixture:source-clause'],
    },
    semanticOwner: { id: 'projector:fixture', kind: 'projector' },
    recordOwner: { family: 'spell', key: 'spell:fixture' },
    kind: 'save',
    trigger: {
      id: 'trigger:fixture',
      summary: 'when activated',
      sourceText: 'When activated',
    },
    eligibility: {
      id: 'eligibility:fixture',
      summary: 'a valid target',
      sourceText: 'a target',
    },
    activationCost: {
      kind: 'action',
      amount: 1,
      trigger: null,
      sourceText: 'As an action',
    },
    targets: { mode: 'single', count: 1, description: 'one target' },
    geometry: null,
    checks: [],
    attacks: [],
    saves: [
      {
        id: 'save:fixture',
        ability: 'Dexterity',
        dc: 'spell DC',
        purpose: 'avoid damage',
      },
    ],
    alternatives: [],
    branches: {
      success: {
        id: 'branch:success',
        outcome: 'half damage',
        condition: null,
      },
      failure: {
        id: 'branch:failure',
        outcome: 'full damage',
        condition: null,
      },
      partialSuccess: null,
    },
    damage: [
      {
        id: 'damage:fixture',
        damageType: 'fire',
        amount: '2d6',
        on: 'failure',
      },
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
    requiredEngineCapabilities: ['engine:F1', 'engine:F9'],
    readiness: {
      disposition: 'complete',
      dimensions: {
        captured: true,
        projected: true,
        supported: true,
        discoverable: true,
      },
      note: null,
    },
    regressionEvidence: [
      {
        id: 'test:fixture',
        kind: 'test',
        assertion: 'the save keeps both outcomes',
        locator: 'clauseIrContracts.test.ts',
      },
    ],
    ...overrides,
  };
}

describe('source-clause completeness contracts', () => {
  it('registers a schema contract for every mechanics-bearing record family', () => {
    const families = RECORD_FAMILY_COMPLETENESS_CONTRACTS.map(
      ({ family }) => family,
    );

    expect(families).toEqual([
      'rule',
      'feature',
      'spell',
      'creature',
      'hazard',
      'equipment',
      'magic-item',
      'ancestry',
      'background',
      'condition',
      'action',
      'feat',
      'class',
      'subclass',
      'table',
    ]);
    expect(
      RECORD_FAMILY_COMPLETENESS_CONTRACTS.every(
        ({ requiredClauseKinds, clauseContracts }) =>
          requiredClauseKinds.length > 0 &&
          clauseContracts.length === requiredClauseKinds.length,
      ),
    ).toBe(true);
  });

  it('names a contract for every required clause kind', () => {
    const kinds = [
      'attack',
      'save',
      'check',
      'branch',
      'action-economy',
      'resource',
      'duration',
      'state-transition',
      'geometry',
      'choice',
      'variant',
      'entity-lifecycle',
      'ledger',
      'model-adjudication',
    ] as const;

    for (const kind of kinds) {
      expect(getClauseCompletenessContract(kind).kind).toBe(kind);
      expect(
        getClauseCompletenessContract(kind).requiredFields.length,
      ).toBeGreaterThan(0);
    }
    expect(Object.keys(CLAUSE_COMPLETENESS_CONTRACTS)).toEqual(
      expect.arrayContaining(kinds),
    );
  });

  it('represents captured, projected, supported, and discoverable independently', () => {
    const clause = makeClause({
      readiness: {
        disposition: 'engine-pending',
        dimensions: {
          captured: true,
          projected: true,
          supported: false,
          discoverable: false,
        },
        note: 'The deterministic owner is not available yet.',
      },
    });

    expect(clause.readiness.dimensions).toEqual({
      captured: true,
      projected: true,
      supported: false,
      discoverable: false,
    });
    const result = evaluateClauseCompleteness(
      clause,
      getClauseCompletenessContract('save'),
    );
    expect(result.status).toBe('incomplete');
    if (result.status === 'incomplete') {
      expect(result.reasons.map(({ code }) => code)).toEqual(
        expect.arrayContaining([
          'dimension-not-supported',
          'dimension-not-discoverable',
        ]),
      );
    }
  });

  it('rejects a superficially populated clause when its required branch is missing', () => {
    const completeAtoms = makeClause({ kind: 'save' });
    const partialProjection = makeClause({
      branches: {
        ...completeAtoms.branches,
        failure: null,
      },
    });

    const result = evaluateClauseCompleteness(
      partialProjection,
      getClauseCompletenessContract('save'),
    );

    expect(result.status).toBe('incomplete');
    if (result.status === 'incomplete') {
      expect(result.reasons).toContainEqual({
        code: 'missing-branch',
        branch: 'failure',
        message: 'required failure branch is absent from the save contract',
      });
    }
  });

  it('lets a projector mark deterministic partial representation only as explicit incomplete', () => {
    const incompleteClause = makeClause({
      readiness: {
        disposition: 'incomplete',
        dimensions: {
          captured: true,
          projected: true,
          supported: false,
          discoverable: true,
        },
        note: 'The source clause is recognized but its timing is not represented.',
      },
    });

    expect(incompleteClause.readiness.disposition).toBe('incomplete');
    expect(
      evaluateClauseCompleteness(
        incompleteClause,
        getClauseCompletenessContract('save'),
      ).status,
    ).toBe('incomplete');
  });
});
