import { describe, expect, it } from 'vitest';
import type { DiscoveryCandidate } from '../../src/internal.js';
import {
  deduplicateCandidates,
  expandTypedRelationships,
  getBundledDnd5eSrdPack,
  joinCampaignRules,
  measureDiscovery,
  resolveDiscoveryCandidates,
  resolveRulesStack,
  retainCandidates,
  runDiscoveryStages,
} from '../../src/internal.js';
import { freshDbWithSession } from '../support/db.js';

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
  it('reports a must-consider overflow through the trace instead of throwing, and blames the losing stage', () => {
    const db = freshDbWithSession();
    try {
      // Two direct-state-ref candidates are both must-consider, so a budget of
      // one forces a genuine must-consider overflow.
      const trace = runDiscoveryStages({
        db,
        scenario: {
          playerInput: 'no rule name appears in this sentence',
          stateFields: { first: 'rule:cover', second: 'rule:concentration' },
        },
        budget: { maxCandidates: 1 },
      });

      // The run completes and the evidence survives: throwing here would
      // destroy the overflow record that design section 6.3 requires.
      expect(trace.retention.overflowed).toBe(true);
      expect(trace.retention.overflow).toHaveLength(1);
      expect(trace.retention.overflow[0].candidateKey).toBe('rule:cover');
      expect(trace.retention.overflow[0].routes.length).toBeGreaterThan(0);
      expect(trace.retention.overflow[0].reason.length).toBeGreaterThan(0);

      const measurements = measureDiscovery(trace, {
        mustIncludeTargetRefs: ['rule:cover', 'rule:concentration'],
      });
      // M6 is observable as failed, which it never could be while the harness
      // threw on overflow.
      expect(measurements.m6.overflowed).toBe(true);
      expect(measurements.m6.allMustConsiderRetained).toBe(false);
      // M2 blames the stage that dropped it, not the first stage that saw it.
      expect(measurements.m1['rule:cover']).toBe(false);
      expect(measurements.m2['rule:cover']).toBe('retention');
      expect(measurements.m2['rule:concentration']).toBeNull();
      // M3 distinguishes "dropped before the packet" from "lost a route".
      expect(measurements.m3['rule:cover'].droppedBeforePacket).toBe(true);
      expect(measurements.m3['rule:cover'].lost).toEqual([]);
      expect(measurements.m3['rule:concentration'].lost).toEqual([]);
      expect(
        measurements.m3['rule:concentration'].producedAcrossStages,
      ).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('records a packet byte-budget overrun without discarding the trace', () => {
    const db = freshDbWithSession();
    try {
      const trace = runDiscoveryStages({
        db,
        scenario: {
          playerInput: 'nothing',
          stateFields: { first: 'creature:adult-black-dragon' },
        },
        budget: { maxPacketBytes: 1 },
      });
      expect(trace.packet.byteBudgetExceeded).toBe(true);
      expect(
        trace.packet.losses.some(
          (loss) => loss.reason === 'packet-byte-budget-exceeded',
        ),
      ).toBe(true);
      expect(trace.packet.packet.candidates.length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('matches a required source substring against real prose', () => {
    const db = freshDbWithSession();
    try {
      const trace = runDiscoveryStages({
        db,
        scenario: {
          playerInput: 'nothing',
          stateFields: { first: 'rule:concentration' },
        },
      });
      // M9 searches the record's real prose strings. No substring the corpus
      // declares today contains a character JSON encoding would alter, so this
      // is a positive check on the matcher rather than a regression guard for
      // a live defect; searching prose removes the latent trap.
      const measurements = measureDiscovery(trace, {
        requiredFacts: [
          {
            targetRef: 'rule:concentration',
            exactSubstring:
              'You lose concentration on a spell if you are incapacitated',
          },
        ],
      });
      expect(measurements.m9.missing).toEqual([]);
    } finally {
      db.close();
    }
  });
});
