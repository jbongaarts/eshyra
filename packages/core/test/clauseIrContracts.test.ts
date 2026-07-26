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
    sourceObligations: [
      {
        id: 'obligation:save',
        sourceText: 'The target makes a saving throw.',
        sourceSpanLocators: ['p. 1, paragraph 2'],
        contractKind: 'save',
        requirements: [],
      },
    ],
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
        getClauseCompletenessContract(kind).requirements.length,
      ).toBeGreaterThan(0);
    }
    expect(Object.keys(CLAUSE_COMPLETENESS_CONTRACTS)).toEqual(
      expect.arrayContaining(kinds),
    );
  });

  it('represents captured, projected, supported, and discoverable independently', () => {
    const clause = makeClause({
      readiness: {
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
    expect(result.semantic.status).toBe('complete');
    expect(result.readiness).toEqual({
      captured: { status: 'satisfied' },
      projected: { status: 'satisfied' },
      supported: { status: 'failed' },
      discoverable: { status: 'failed' },
    });
  });

  it('fails closed when source obligations compose save, duration, repeat, and termination semantics', () => {
    const composedSourceClause = makeClause({
      sourceSpans: [
        {
          ...sourceSpan,
          text: 'The target makes a save, repeats it each round, lasts 1 minute, and ends when it succeeds.',
        },
      ],
      sourceObligations: [
        {
          id: 'obligation:save',
          sourceText: 'The target makes a save.',
          sourceSpanLocators: ['p. 1, paragraph 2'],
          contractKind: 'save',
          requirements: [],
        },
        {
          id: 'obligation:duration',
          sourceText:
            'The effect lasts 1 minute and ends when the target succeeds.',
          sourceSpanLocators: ['p. 1, paragraph 2'],
          contractKind: 'duration',
          requirements: [],
        },
        {
          id: 'obligation:repeat-save',
          sourceText: 'The target repeats the save each round.',
          sourceSpanLocators: ['p. 1, paragraph 2'],
          contractKind: 'save',
          requirements: [
            {
              id: 'requirement:repeat-save',
              sourceText: 'the save repeats each round',
              predicate: {
                kind: 'field',
                field: 'repeatChecks',
                cardinality: 'non-empty',
              },
            },
          ],
        },
      ],
      duration: null,
      termination: null,
      repeatChecks: [],
    });

    const result = evaluateClauseCompleteness(
      composedSourceClause,
      getClauseCompletenessContract('save'),
    );

    expect(result.semantic.status).toBe('incomplete');
    expect(result.semantic.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          obligationId: 'obligation:duration',
          field: 'duration',
          code: 'missing-field',
        }),
        expect.objectContaining({
          obligationId: 'obligation:duration',
          field: 'termination',
          code: 'missing-field',
        }),
        expect.objectContaining({
          obligationId: 'obligation:repeat-save',
          field: 'repeatChecks',
          code: 'empty-required-collection',
        }),
      ]),
    );
  });

  it('rejects empty required collections instead of treating them as present', () => {
    const emptySave = makeClause({ saves: [], damage: [] });
    const result = evaluateClauseCompleteness(
      emptySave,
      getClauseCompletenessContract('save'),
    );

    expect(result.semantic.status).toBe('incomplete');
    expect(
      result.semantic.reasons.map(({ code, field }) => ({ code, field })),
    ).toEqual(
      expect.arrayContaining([
        { code: 'empty-required-collection', field: 'saves' },
        { code: 'empty-required-collection', field: 'damage' },
      ]),
    );
  });

  it('supports source-backed cross-field alternatives with fail-closed cardinality', () => {
    const attackContract = getClauseCompletenessContract('attack');
    const bothAttackModes = makeClause({
      kind: 'attack',
      attacks: [
        {
          id: 'attack:fixture',
          attackType: 'spell',
          defense: 'armor-class',
          attackBonus: '+5',
          purpose: 'hit the target',
        },
      ],
      sourceObligations: [
        {
          id: 'obligation:attack',
          sourceText: 'The attack uses either an attack roll or a save.',
          sourceSpanLocators: ['p. 1, paragraph 2'],
          contractKind: 'attack',
          requirements: [],
        },
      ],
      saves: [
        {
          id: 'save:fixture',
          ability: 'Dexterity',
          dc: 'spell DC',
          purpose: 'avoid damage',
        },
      ],
    });
    const result = evaluateClauseCompleteness(bothAttackModes, attackContract);

    expect(result.semantic.status).toBe('incomplete');
    expect(result.semantic.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'unsatisfied-alternative',
          requirementId: 'attack-or-save',
        }),
      ]),
    );
  });

  it('rejects missing source obligations even when the selected kind is populated', () => {
    const result = evaluateClauseCompleteness(
      makeClause({
        sourceObligations: [] as unknown as Clause['sourceObligations'],
      }),
      getClauseCompletenessContract('save'),
    );

    expect(result.semantic.status).toBe('incomplete');
    expect(result.semantic.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing-source-obligation' }),
      ]),
    );
  });

  it('returns structured failures from the evaluator instead of a mutable disposition', () => {
    const incompleteClause = makeClause({
      readiness: {
        dimensions: {
          captured: true,
          projected: true,
          supported: false,
          discoverable: true,
        },
        note: 'The source clause is recognized but its timing is not represented.',
      },
      duration: null,
    });

    const result = evaluateClauseCompleteness(
      incompleteClause,
      getClauseCompletenessContract('save'),
    );

    expect(result.semantic.status).toBe('complete');
    expect(result.semantic.reasons).toEqual([]);
    expect(result.readiness.supported.status).toBe('failed');
    expect('disposition' in incompleteClause.readiness).toBe(false);
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

    expect(result.semantic.status).toBe('incomplete');
    expect(result.semantic.reasons).toContainEqual(
      expect.objectContaining({
        code: 'missing-branch',
        branch: 'failure',
      }),
    );
  });
});
