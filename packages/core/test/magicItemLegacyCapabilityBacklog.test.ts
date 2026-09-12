import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildMagicItemLegacyCapabilityBacklog,
  getBundledDnd5eSrdPack,
  MagicItemLegacyCapabilityBacklogError,
  type RulesPack,
} from '../src/internal.js';

describe('magic-item legacy capability backlog', () => {
  it('keeps every legacy engine-hook clause as an explicit, source-linked unselected candidate', () => {
    const backlog = buildMagicItemLegacyCapabilityBacklog(
      getBundledDnd5eSrdPack(),
    );

    expect(backlog).toMatchObject({
      scope: 'legacy-magic-item-engine-hooks-only',
      source: 'derived-magic-item-clauses-v1',
    });
    expect(backlog.candidates).toHaveLength(795);
    expect(
      new Set(backlog.candidates.map(({ candidateId }) => candidateId)).size,
    ).toBe(backlog.candidates.length);
    expect(
      backlog.candidates.find(
        ({ candidateId }) =>
          candidateId ===
          'magic-item:ammunition-1-2-or-3/c2-static-ammunition-rarity-attack-damage',
      ),
    ).toMatchObject({
      recordKey: 'magic-item:ammunition-1-2-or-3',
      clauseId:
        'magic-item:ammunition-1-2-or-3/c2-static-ammunition-rarity-attack-damage',
      source: {
        readinessRevision: 'derived-magic-item-clauses-v1',
        sourceRef:
          'https://dnd.wizards.com/resources/systems-reference-document',
      },
      legacyReadiness: 'engine-pending',
      disposition: 'unselected-backlog',
      evidence: {
        claimStrength: 'candidate-only-not-capability-execution-evidence',
      },
    });
    expect(
      backlog.candidates.every(({ evidence }) =>
        evidence.nonClaims.some((claim) =>
          claim.includes('audit-finding registry'),
        ),
      ),
    ).toBe(true);
  });

  it('retains the green-with-hook sibling while keeping missing hooks as unresolved detail', () => {
    const backlog = buildMagicItemLegacyCapabilityBacklog(
      getBundledDnd5eSrdPack(),
    );

    expect(backlog.candidates).toContainEqual(
      expect.objectContaining({
        candidateId: 'magic-item:candle-of-invocation/c1-burn-time',
        legacyReadiness: 'green',
        engineHooks: [{ engine: 'F5', hook: 'duration-budget accounting' }],
        missingHooks: [],
        disposition: 'unselected-backlog',
      }),
    );
  });

  it('pins the exact hook-backed identity set, not merely its denominator', () => {
    const backlog = buildMagicItemLegacyCapabilityBacklog(
      getBundledDnd5eSrdPack(),
    );
    const fingerprint = createHash('sha256')
      .update(
        backlog.candidates.map(({ candidateId }) => candidateId).join('\n'),
      )
      .digest('hex');

    expect(fingerprint).toBe(
      '62dd4d96f6c1b7e04bc946f62683ef1dac57d237dec378c525b8066f9a2fd5c2',
    );
    expect(backlog.candidates.map(({ candidateId }) => candidateId)).toContain(
      'magic-item:candle-of-invocation/c1-burn-time',
    );
  });

  it('reports the positive preflight contract separately from legacy candidates', () => {
    const backlog = buildMagicItemLegacyCapabilityBacklog(
      getBundledDnd5eSrdPack(),
    );

    expect(backlog.selectedCapabilities).toEqual([
      expect.objectContaining({
        revision: 'derived-magic-item-clauses-v1',
        operationId: 'assertMagicItemOperationReady',
        evidence: expect.objectContaining({
          claimStrength: 'declared-contract-not-capability-execution-evidence',
        }),
      }),
    ]);
  });

  it('fails closed when a legacy missing-hook row lacks stable identity', () => {
    const pack = getBundledDnd5eSrdPack();
    const record = pack.records.find(
      ({ key }) => key === 'magic-item:ammunition-1-2-or-3',
    );
    expect(record).toBeDefined();
    const data = record?.data as {
      executionReadiness: { clauses: Record<string, unknown>[] };
    };
    const malformed: RulesPack = {
      ...pack,
      records: pack.records.map((entry) =>
        entry === record
          ? {
              ...entry,
              data: {
                ...data,
                executionReadiness: {
                  ...data.executionReadiness,
                  clauses: data.executionReadiness.clauses.map((clause) =>
                    Array.isArray(clause.missingHooks) &&
                    clause.missingHooks.length > 0
                      ? { ...clause, clauseId: '' }
                      : clause,
                  ),
                },
              },
            }
          : entry,
      ),
    };

    expect(() => buildMagicItemLegacyCapabilityBacklog(malformed)).toThrow(
      MagicItemLegacyCapabilityBacklogError,
    );
  });
});
