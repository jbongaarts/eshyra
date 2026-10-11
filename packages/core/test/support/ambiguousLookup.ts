import { expect } from 'vitest';
import { createDefaultToolRegistry } from '../../src/index.js';
import type { ModelToolResult } from '../../src/model/client.js';
import { freshDbWithSession } from './db.js';

/**
 * Real ambiguous `lookup_rules` failures (source-distinct passages and
 * same-kind feature collisions), produced by the actual tool, for the
 * error-with-data transport invariant exercised through each public model
 * boundary (eshyra-o9bd.19.2.4.5).
 */
export const AMBIGUOUS_LOOKUP_CASES = [
  { kind: 'rule', name: 'Darkvision' },
  { kind: 'feature', name: 'Spellcasting' },
  { kind: 'feature', name: 'Ability Score Improvement' },
] as const;

export interface AmbiguousCandidateCard {
  key: string;
  kind: string;
  name: string;
  source: string;
  locator?: string;
}

export interface AmbiguousLookup {
  /** The neutral result exactly as the real tool returned it. */
  result: Extract<ModelToolResult['result'], { ok: false }>;
  candidateKeys: string[];
  candidates: AmbiguousCandidateCard[];
}

export function realAmbiguousLookup(
  kind: string,
  name: string,
): AmbiguousLookup {
  const db = freshDbWithSession();
  try {
    const result = createDefaultToolRegistry().invoke(
      'lookup_rules',
      { kind, name, systemId: 'dnd5e-srd' },
      {
        db,
        rng: () => 0.5,
        campaignId: 'campaign-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        at: '2026-05-20T10:00:00.000Z',
      } as never,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ambiguous lookup failure');
    const data = result.data as {
      candidateKeys: string[];
      candidates: AmbiguousCandidateCard[];
    };
    expect(data.candidates.length).toBeGreaterThan(1);
    return {
      result,
      candidateKeys: data.candidateKeys,
      candidates: data.candidates,
    };
  } finally {
    db.close();
  }
}

/** Assert a provider-side error payload carries every shown candidate card. */
export function expectProviderPayloadQualified(
  payload: unknown,
  lookup: AmbiguousLookup,
): void {
  const p = payload as {
    ok: boolean;
    code: string;
    message: string;
    data?: {
      candidateKeys?: string[];
      candidates?: AmbiguousCandidateCard[];
    };
  };
  expect(p.ok).toBe(false);
  expect(p.code).toBe(lookup.result.code);
  expect(p.message).toBe(lookup.result.message);
  expect(p.data?.candidateKeys).toEqual(lookup.candidateKeys);
  expect(p.data?.candidates).toEqual(lookup.candidates);
  for (const card of lookup.candidates) {
    expect(card.kind).toBeTruthy();
    expect(card.source).toBeTruthy();
  }
}
