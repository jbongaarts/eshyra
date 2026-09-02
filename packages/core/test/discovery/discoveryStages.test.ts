import { describe, expect, it } from 'vitest';
import type { DiscoveryCandidate } from '../../src/internal.js';
import {
  deduplicateCandidates,
  expandTypedRelationships,
  getBundledDnd5eSrdPack,
  joinCampaignRules,
  resolveDiscoveryCandidates,
  resolveRulesStack,
  retainCandidates,
} from '../../src/internal.js';

describe('offline discovery stage boundaries', () => {
  const stack = resolveRulesStack({ base: getBundledDnd5eSrdPack() });
  it('expands the real reverse condition relationship and preserves both endpoints', () => {
    const signals = {
      stage: 'signals',
      inputsConsumed: [],
      losses: [],
      failedToRun: false,
      unconsumedStateFields: [],
      stateBindings: [],
      ambiguousNames: [],
      oracleSuppliedSignalLabels: [],
      outputsProduced: [
        {
          signalId: 's1',
          kind: 'state-ref' as const,
          proposes: 'condition:incapacitated',
          evidence: {},
        },
      ],
    };
    const candidates = resolveDiscoveryCandidates(signals, stack, {
      playerInput: '',
      stateFields: {},
    });
    const expanded = expandTypedRelationships(
      candidates.outputsProduced,
      stack,
    );
    const condition = expanded.outputsProduced.find(
      (item) => item.candidateKey === 'condition:incapacitated',
    );
    expect(condition?.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ routeClass: 'typed-relationship' }),
      ]),
    );
    expect(expanded.traversals).toContainEqual({
      sourceRecordKey: 'action:dodge',
      linkField: 'data.mechanics.conditions',
      relation: 'exclusion',
      targetRecordKey: 'condition:incapacitated',
    });
    expect(
      expanded.outputsProduced.some(
        (item) => item.candidateKey === 'action:dodge',
      ),
    ).toBe(true);
  });

  it('deduplicates by key without losing distinct routes', () => {
    const base: DiscoveryCandidate = {
      candidateKey: 'rule:cover',
      targetKind: 'rules-record',
      entry: stack.recordsByKey.get('rule:cover'),
      routes: [],
      traversals: [],
      campaignRules: [],
      campaignRulings: [],
    };
    const one = {
      ...base,
      routes: [
        {
          routeClass: 'situation-cue' as const,
          trigger: 'geometry',
          evidence: {},
          signalId: 'a',
        },
      ],
    };
    const two = {
      ...base,
      routes: [
        {
          routeClass: 'explicit-name-or-alias' as const,
          trigger: 'cover',
          evidence: {},
          signalId: 'b',
        },
      ],
    };
    const trace = deduplicateCandidates([one, two]);
    expect(trace.outputsProduced[0].routes).toHaveLength(2);
    expect(trace.routeCountBeforeDedup['rule:cover']).toBe(2);
    expect(trace.routeCountAfterDedup['rule:cover']).toBe(2);
  });

  it('records must-consider overflow with every dropped route', () => {
    const make = (key: string): DiscoveryCandidate => ({
      ...baseCandidate(key),
      routes: [
        {
          routeClass: 'direct-state-ref',
          trigger: 'state',
          evidence: {},
          signalId: key,
        },
      ],
    });
    const baseCandidate = (key: string): DiscoveryCandidate => ({
      candidateKey: key,
      targetKind: 'rules-record',
      entry: stack.recordsByKey.get(key),
      routes: [],
      traversals: [],
      campaignRules: [],
      campaignRulings: [],
    });
    const trace = retainCandidates(
      [make('rule:cover'), make('rule:concentration')],
      { maxCandidates: 1 },
    );
    expect(trace.overflowed).toBe(true);
    expect(trace.overflow[0].candidateKey).toBe('rule:cover');
    expect(trace.overflow[0].routes).toHaveLength(1);
  });

  it('joins a read-only campaign rule beside its governed record', () => {
    const candidate: DiscoveryCandidate = {
      candidateKey: 'spell:fireball',
      targetKind: 'rules-record',
      entry: stack.recordsByKey.get('spell:fireball'),
      routes: [
        {
          routeClass: 'explicit-name-or-alias',
          trigger: 'fireball',
          evidence: {},
          signalId: 's1',
        },
      ],
      traversals: [],
      campaignRules: [],
      campaignRulings: [],
    };
    const trace = joinCampaignRules([candidate], {
      activeRulesAtPosition: () => [
        {
          ruleIdentity: 'house-rule-1',
          ruleKind: 'house-rule',
          status: 'active',
          origin: 'player',
          provenance: 'campaign',
          effectivePosition: 'turn-1',
          supersededBy: null,
          scope: 'spell components',
          governingRecordKeys: ['spell:fireball'],
        },
      ],
      activeRulingsForAmbiguities: () => [],
    });
    expect(trace.outputsProduced[0].campaignRules[0].ruleIdentity).toBe(
      'house-rule-1',
    );
    expect(trace.placedRules).toEqual([
      { ruleIdentity: 'house-rule-1', governingRecordKey: 'spell:fireball' },
    ]);
  });
});
