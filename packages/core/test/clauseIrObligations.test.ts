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

function record(
  facet: SemanticFacet,
  locator = span.locator,
): SourceObligationRecord {
  return {
    obligationId: createObligationId(span.sourceRef, locator, facet),
    origin: 'source-extraction',
    evidence: [{ kind: 'source-span', ...span, locator }],
    requiredFacets: [facet],
  };
}

function clause(
  obligationId: string,
  owner = { family: 'spell' as const, key: 'one' },
): Clause {
  return {
    identity: {
      id: `clause:${owner.key}`,
      canonicalKey: owner.key,
      revision: 'v1',
    },
    sourceSpans: [span],
    provenance: {
      sourceRef: span.sourceRef,
      extraction: 'structural-parser',
      evidence: ['test'],
    },
    semanticOwner: { id: 'projector:test', kind: 'projector' },
    recordOwner: owner,
    kind: 'save',
    sourceObligationIds: [obligationId],
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

function scope(
  registry: ReturnType<typeof createObligationRegistry>,
  ids: readonly string[],
) {
  return createObligationScope(registry, {
    scopeId: 'spell:one',
    applicability: {
      family: 'spell',
      recordKey: 'one',
      status: 'applicable',
      evidence: [{ kind: 'source-span', ...span }],
    },
    obligationIds: ids,
  });
}

describe('obligation-boundary threat model', () => {
  it('uses registry membership and exposes an obligation the projector never declares', () => {
    const records = [record('save', 'save'), record('duration', 'duration')];
    const registry = createObligationRegistry(records);
    const result = evaluateObligationClosure(
      registry,
      [clause(records[0].obligationId)],
      scope(
        registry,
        records.map(({ obligationId }) => obligationId),
      ),
    );
    expect(result.obligations[1].status).toBe('UNCLAIMED');
  });

  it('rejects a raw scope-shaped object and wrong-record claims', () => {
    const registry = createObligationRegistry([record('save')]);
    const validated = scope(registry, [registry.records[0].obligationId]);
    expect(() =>
      evaluateObligationClosure(
        registry,
        [clause(registry.records[0].obligationId)],
        { ...validated } as never,
      ),
    ).toThrow(/createObligationScope/);
    const result = evaluateObligationClosure(
      registry,
      [
        clause(registry.records[0].obligationId, {
          family: 'spell',
          key: 'other',
        }),
      ],
      validated,
    );
    expect(result.obligations[0].status).toBe('UNCLAIMED');
    expect(result.unexpectedClaims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'wrong-record-owner' }),
      ]),
    );
  });

  it('rejects source identity divergence and distinguishes repeated source occurrences', () => {
    expect(() =>
      createObligationRegistry([record('save', 'synthetic-locator')]),
    ).not.toThrow();
    expect(() =>
      createObligationRegistry([
        {
          ...record('save'),
          obligationId: createObligationId(
            span.sourceRef,
            'synthetic-locator',
            'save',
          ),
        },
      ]),
    ).toThrow(/diverges/);
    const second = record('save', `${span.locator}#occurrence-2`);
    const registry = createObligationRegistry([record('save'), second]);
    expect(registry.records).toHaveLength(2);
  });

  it('rejects audit-only and known-missing evidence as CAPTURED', () => {
    const auditEvidence = {
      kind: 'audit-finding' as const,
      findingId: 'audit:missing',
      sourceRef: span.sourceRef,
      locator: span.locator,
    };
    const registry = createObligationRegistry([
      { ...record('save'), origin: 'audit-finding', evidence: [auditEvidence] },
    ]);
    const projected = clause(registry.records[0].obligationId);
    const result = evaluateClauseCompleteness(
      {
        ...projected,
        readiness: { ...projected.readiness, captured: [auditEvidence] },
      },
      registry,
    );
    expect(result.semantic.status).toBe('incomplete');
    expect(result.semantic.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'non-capturable-evidence' }),
      ]),
    );
  });

  it('deep-freezes registry and scope authority', () => {
    const registry = createObligationRegistry([record('save')]);
    const validated = scope(registry, [registry.records[0].obligationId]);
    expect(Object.isFrozen(registry.records[0])).toBe(true);
    expect(Object.isFrozen(registry.records[0].evidence)).toBe(true);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.applicability)).toBe(true);
    expect(() => {
      (registry.records[0].requiredFacets as SemanticFacet[]).push('duration');
    }).toThrow();
    expect(() => {
      (validated.obligationIds as string[]).push('unexpected');
    }).toThrow();
  });

  it('keeps the old fail-closed contract protections', () => {
    const registry = createObligationRegistry([record('save-with-damage')]);
    const projected = clause(registry.records[0].obligationId);
    expect(
      evaluateClauseCompleteness(
        { ...projected, saves: [], damage: [] },
        registry,
      ).semantic.status,
    ).toBe('incomplete');
    const selected = evaluateClauseCompleteness(projected, registry, {
      contractId: 'permissive',
    });
    expect(selected.semantic.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid-contract-selection' }),
      ]),
    );
  });
});
