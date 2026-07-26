import { describe, expect, it } from 'vitest';
import {
  type Clause,
  createObligationId,
  createObligationRegistry,
  createObligationScope,
  evaluateClauseCompleteness,
  evaluateObligationClosure,
  type SemanticFacet,
  type SourceObligationRecord,
} from '../src/rules/clauseIr/index.js';

const span = {
  sourceRef: 'srd-5.1',
  locator: 'p.104#fireball',
  start: 1,
  end: 12,
  text: 'A source clause.',
} as const;
function record(facet: SemanticFacet, suffix = facet): SourceObligationRecord {
  return {
    obligationId: createObligationId(
      span.sourceRef,
      `${span.locator}::${suffix}`,
      facet,
    ),
    origin: 'source-extraction',
    evidence: [{ kind: 'source-span', ...span }],
    requiredFacets: [facet],
  };
}
function clause(ids: readonly string[]): Clause {
  return {
    identity: { id: 'clause:one', canonicalKey: 'one', revision: 'v1' },
    sourceSpans: [span],
    provenance: {
      sourceRef: span.sourceRef,
      extraction: 'structural-parser',
      evidence: ['test'],
    },
    semanticOwner: { id: 'projector:test', kind: 'projector' },
    recordOwner: { family: 'spell', key: 'one' },
    kind: 'save',
    sourceObligationIds: ids,
    trigger: null,
    eligibility: null,
    activationCost: null,
    targets: null,
    geometry: null,
    checks: [],
    attacks: [],
    saves: [{ id: 'save', ability: 'Dexterity', dc: '15', purpose: 'test' }],
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
    executionOwner: { kind: 'engine', id: 'save' },
    requiredEngineCapabilities: [],
    readiness: {
      captured: [{ kind: 'source-span', ...span }],
      supported: [],
      discoverable: [],
    },
    regressionEvidence: [],
  };
}

describe('obligation-boundary threat model', () => {
  it('T1: exposes an obligation the projector never declares', () => {
    const records = [record('save', 'one'), record('duration', 'two')];
    const registry = createObligationRegistry(records);
    const scope = createObligationScope(registry, {
      scopeId: 'spell:one',
      applicability: {
        family: 'spell',
        recordKey: 'one',
        status: 'applicable',
        evidence: [{ kind: 'source-span', ...span }],
      },
      obligationIds: records.map(({ obligationId }) => obligationId),
    });
    const result = evaluateObligationClosure(
      registry,
      [clause([records[0].obligationId])],
      scope,
    );
    expect(
      result.obligations.find(
        ({ obligationId }) => obligationId === records[1].obligationId,
      )?.status,
    ).toBe('UNCLAIMED');
  });

  it('T2: does not let a narrower selected kind escape a source facet', () => {
    const registry = createObligationRegistry([record('save-with-damage')]);
    const result = evaluateClauseCompleteness(
      {
        ...clause(registry.records.map(({ obligationId }) => obligationId)),
        kind: 'check',
        damage: [],
      },
      registry,
    );
    expect(result.semantic.status).toBe('incomplete');
    expect(result.semantic.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'damage' })]),
    );
  });

  it('T3: prevents the clause producer from weakening the registry requirement list', () => {
    const registry = createObligationRegistry([record('save')]);
    const projected = clause(
      registry.records.map(({ obligationId }) => obligationId),
    );
    expect('requirements' in projected).toBe(false);
    expect(
      evaluateClauseCompleteness({ ...projected, saves: [] }, registry).semantic
        .status,
    ).toBe('incomplete');
  });

  it('T4: rejects a permissive contract selection and still applies canonical requirements', () => {
    const registry = createObligationRegistry([record('save')]);
    const result = evaluateClauseCompleteness(
      {
        ...clause(registry.records.map(({ obligationId }) => obligationId)),
        saves: [],
      },
      registry,
      { contractId: 'permissive', additionalRequirements: [] },
    );
    expect(result.semantic.status).toBe('incomplete');
    expect(result.semantic.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid-contract-selection' }),
        expect.objectContaining({ field: 'saves' }),
      ]),
    );
  });

  it('T5: rejects readiness self-attestation without inspectable resolver evidence', () => {
    const registry = createObligationRegistry([record('save')]);
    const result = evaluateClauseCompleteness(
      clause(registry.records.map(({ obligationId }) => obligationId)),
      registry,
    );
    expect(result.readiness.supported.status).toBe('failed');
    expect(result.readiness.discoverable.status).toBe('failed');
    expect('dimensions' in clause([]).readiness).toBe(false);
  });

  it('T6: rejects a semantically contradictory facet contract at registry construction', () => {
    expect(() =>
      createObligationRegistry([
        {
          ...record('save-with-damage', 'contradictory'),
          requiredFacets: ['save-with-damage', 'save-without-damage'],
        },
      ]),
    ).toThrow(/contradictory/);
  });

  it('T7: keeps family applicability distinct from obligation closure', () => {
    const registry = createObligationRegistry([record('save')]);
    const scope = createObligationScope(registry, {
      scopeId: 'spell:empty',
      applicability: {
        family: 'spell',
        recordKey: 'empty',
        status: 'applicable',
        evidence: [{ kind: 'source-span', ...span }],
      },
      obligationIds: registry.records.map(({ obligationId }) => obligationId),
    });
    const result = evaluateObligationClosure(registry, [], scope);
    expect(result.applicability.status).toBe('applicable');
    expect(result.obligations[0].status).toBe('UNCLAIMED');
  });

  it('T8: fails closed for unknown or contradictory contract selection', () => {
    const registry = createObligationRegistry([record('save')]);
    const result = evaluateClauseCompleteness(
      clause(registry.records.map(({ obligationId }) => obligationId)),
      registry,
      { contractId: 'unknown-contract' },
    );
    expect(result.semantic.status).toBe('incomplete');
    expect(result.semantic.reasons[0]).toMatchObject({
      code: 'invalid-contract-selection',
    });
    expect(() =>
      createObligationRegistry([
        {
          ...record('duration-with-concentration', 'contradictory'),
          requiredFacets: [
            'duration-with-concentration',
            'duration-without-concentration',
          ],
        },
      ]),
    ).toThrow(/contradictory/);
  });

  it('validates origin-specific evidence instead of accepting a projector as authority', () => {
    expect(() =>
      createObligationRegistry([
        {
          ...record('save'),
          origin: 'source-extraction',
          evidence: [{ kind: 'code', path: 'projector.ts', symbol: 'project' }],
        },
      ]),
    ).toThrow(/authoritative evidence/);
  });
});
