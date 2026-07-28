import { describe, expect, it } from 'vitest';
import {
  type Clause,
  evaluateClauseCompleteness,
  type ObligationSource,
  type SemanticFacet,
  type SourceObligationRecord,
} from '../src/rules/clauseIr/index.js';

const span = {
  sourceRef: 'srd-5.1',
  locator: 'p.104#fixture',
  start: 1,
  end: 12,
  text: 'A source clause.',
} as const;

function fixtureObligation(facet: SemanticFacet): SourceObligationRecord {
  return {
    obligationId: `obl:::${span.sourceRef}:::${span.locator}:::${facet}`,
    origin: 'source-extraction',
    evidence: [{ kind: 'source-span', ...span }],
    requiredFacets: [facet],
  };
}

function fixtureSource(record: SourceObligationRecord): ObligationSource {
  return {
    get: (obligationId) =>
      obligationId === record.obligationId ? record : undefined,
  };
}

function clause(obligationId: string): Clause {
  return {
    identity: {
      id: 'clause:fixture',
      canonicalKey: 'fixture',
      revision: 'v1',
    },
    sourceSpans: [span],
    provenance: {
      sourceRef: span.sourceRef,
      extraction: 'structural-parser',
      evidence: ['fixture'],
    },
    semanticOwner: { id: 'projector:fixture', kind: 'projector' },
    recordOwner: { family: 'spell', key: 'one' },
    kind: 'save',
    sourceObligationIds: [obligationId],
    trigger: null,
    eligibility: null,
    activationCost: null,
    targets: null,
    geometry: null,
    checks: [],
    attacks: [],
    saves: [
      {
        id: 'save:fixture',
        ability: 'Dexterity',
        dc: '15',
        purpose: 'fixture',
      },
    ],
    alternatives: [],
    branches: { success: null, failure: null, partialSuccess: null },
    damage: [],
    healing: [],
    grants: [],
    ledgerChanges: [],
    stateTransitions: [],
    duration: null,
    recurrence: null,
    repeatChecks: [],
    immunityWindows: [],
    termination: null,
    executionOwner: { kind: 'engine', id: 'fixture' },
    requiredEngineCapabilities: [],
    readiness: {
      captured: [{ kind: 'source-span', ...span }],
      supported: [],
      discoverable: [],
    },
    regressionEvidence: [],
  };
}

describe('obligation source boundary', () => {
  it('looks up the independently supplied obligation for per-clause evaluation', () => {
    const obligation = fixtureObligation('save');
    const result = evaluateClauseCompleteness(
      clause(obligation.obligationId),
      fixtureSource(obligation),
    );

    expect(result.semantic.status).toBe('complete');
  });

  it('fails closed when the source does not contain the clause obligation', () => {
    const obligation = fixtureObligation('save');
    const result = evaluateClauseCompleteness(clause(obligation.obligationId), {
      get: () => undefined,
    });

    expect(result.semantic.status).toBe('incomplete');
    expect(result.semantic.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'unknown-obligation' }),
      ]),
    );
  });

  it('does not construct or validate source authority', () => {
    const obligation = {
      ...fixtureObligation('save'),
      origin: 'not-a-validated-origin',
      requiredFacets: ['save'],
    } as unknown as SourceObligationRecord;

    const result = evaluateClauseCompleteness(
      clause(obligation.obligationId),
      fixtureSource(obligation),
    );

    expect(result.semantic.status).toBe('complete');
  });
});
