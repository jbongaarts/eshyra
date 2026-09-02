import { describe, expect, it } from 'vitest';
import type { DiscoveryCandidate } from '../../src/internal.js';
import {
  deduplicateCandidates,
  expandTypedRelationships,
  getBundledDnd5eSrdPack,
  joinCampaignRules,
  MAGIC_ITEM_OPERATION_READINESS_CAPABILITY,
  measureDiscovery,
  resolveDiscoveryCandidates,
  resolveRulesStack,
  retainCandidates,
  runDiscoveryStages,
} from '../../src/internal.js';
import { freshDbWithSession } from '../support/db.js';
import {
  installVariantReadinessAddon,
  PENDING_VARIANT_ID,
  READY_VARIANT_ID,
  VARIANT_READINESS_ITEM_KEY,
  VARIANT_READINESS_OPERATION,
} from './support/variantReadinessAddon.js';

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

  it('makes a byte budget fail mandatory retention with candidate-level evidence', () => {
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
      // The byte budget is a real retention budget, not a diagnostic flag: a
      // must-consider candidate it cannot hold is an overflow under design
      // section 6.3, and the record names the candidate and its routes.
      expect(trace.packet.byteBudgetExceeded).toBe(true);
      expect(trace.packet.byteOverflow).toHaveLength(1);
      expect(trace.packet.byteOverflow[0].candidateKey).toBe(
        'creature:adult-black-dragon',
      );
      expect(trace.packet.byteOverflow[0].band).toBe('must-consider');
      expect(trace.packet.byteOverflow[0].routes.length).toBeGreaterThan(0);
      expect(trace.packet.byteOverflow[0].reason).toContain('byte budget');

      const measurements = measureDiscovery(trace, {
        mustIncludeTargetRefs: ['creature:adult-black-dragon'],
      });
      expect(measurements.m6.overflowed).toBe(true);
      expect(measurements.m6.allMustConsiderRetained).toBe(false);
      expect(measurements.m6.overflow[0].candidateKey).toBe(
        'creature:adult-black-dragon',
      );
      // M7 sees the byte-driven drop with its reason, and M2 blames the packet.
      expect(measurements.m7.drops.map((drop) => drop.candidateKey)).toContain(
        'creature:adult-black-dragon',
      );
      expect(measurements.m2['creature:adult-black-dragon']).toBe('packet');
    } finally {
      db.close();
    }
  });

  it('drops only related and exploratory candidates when the budget still fits the mandatory set', () => {
    const db = freshDbWithSession();
    try {
      const full = runDiscoveryStages({
        db,
        scenario: {
          playerInput: 'nothing',
          stateFields: { first: 'condition:incapacitated' },
        },
      });
      const mustConsiderBytes = full.packet.packet.candidates
        .filter(
          (candidate) => candidate.identity.key === 'condition:incapacitated',
        )
        .reduce(
          (total, candidate) =>
            total + Buffer.byteLength(JSON.stringify(candidate), 'utf8'),
          2,
        );
      const trimmed = runDiscoveryStages({
        db,
        scenario: {
          playerInput: 'nothing',
          stateFields: { first: 'condition:incapacitated' },
        },
        budget: { maxPacketBytes: mustConsiderBytes },
      });
      // The mandatory candidate survives; related expansion is what gives way,
      // and every drop carries a reason (M7).
      expect(trimmed.packet.byteOverflow).toEqual([]);
      expect(
        trimmed.packet.packet.candidates.map((item) => item.identity.key),
      ).toContain('condition:incapacitated');
      expect(trimmed.packet.dropped.length).toBeGreaterThan(0);
      for (const drop of trimmed.packet.dropped)
        expect(drop.reason.length).toBeGreaterThan(0);
      expect(
        measureDiscovery(trimmed, {
          mustIncludeTargetRefs: ['condition:incapacitated'],
        }).m6.overflowed,
      ).toBe(false);
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
  it('quotes the W13 capability contract instead of restating it', () => {
    const db = freshDbWithSession();
    try {
      const trace = runDiscoveryStages({
        db,
        scenario: {
          playerInput: 'nothing',
          stateFields: {
            itemRecord: 'magic-item:ammunition-1-2-or-3',
            operationId: 'hit-target',
          },
        },
      });
      const candidate = trace.packet.packet.candidates.find(
        (item) => item.identity.key === 'magic-item:ammunition-1-2-or-3',
      );
      expect(candidate?.capability?.status).toBe('available');
      // Sourced from the contract W13 landed, so the packet cannot drift away
      // from the capability it claims to describe (design section 7.1).
      expect(candidate?.capability?.revision).toBe(
        MAGIC_ITEM_OPERATION_READINESS_CAPABILITY.revision,
      );
      expect(candidate?.capability?.inputs).toEqual(
        MAGIC_ITEM_OPERATION_READINESS_CAPABILITY.requiredInputs,
      );
      expect(candidate?.capability?.exclusions).toEqual(
        MAGIC_ITEM_OPERATION_READINESS_CAPABILITY.exclusions,
      );
    } finally {
      db.close();
    }
  });

  it('reports a blocked preflight for an engine-pending operation', () => {
    const db = freshDbWithSession();
    try {
      const trace = runDiscoveryStages({
        db,
        scenario: {
          playerInput: 'nothing',
          stateFields: {
            itemRecord: 'magic-item:cube-of-force',
            operationId: 'press-face-1',
          },
        },
      });
      const candidate = trace.packet.packet.candidates.find(
        (item) => item.identity.key === 'magic-item:cube-of-force',
      );
      // P7's premise: a jhpt ruling never makes an engine-pending readiness
      // clause green, and readiness runs ahead of the ambiguity in use_item.
      expect(candidate?.capability?.status).toBe('blocked');
      expect(candidate?.capability?.message?.length ?? 0).toBeGreaterThan(0);
      expect(candidate?.ambiguities.map((item) => item.id)).toContain(
        'ambiguity:cube-of-force-same-face-duration-reset',
      );
    } finally {
      db.close();
    }
  });
  it('preflights only the candidate the capability route selected', () => {
    const db = freshDbWithSession();
    try {
      const trace = runDiscoveryStages({
        db,
        scenario: {
          playerInput: 'nothing',
          stateFields: {
            itemRecord: 'magic-item:ammunition-1-2-or-3',
            operationId: 'hit-target',
            // An unrelated magic item merely present in context. A
            // scenario-global operationId fallback would preflight this too
            // and report a capability for an item nothing selected.
            alsoCarried: 'magic-item:cube-of-force',
          },
        },
      });
      const selected = trace.packet.packet.candidates.find(
        (item) => item.identity.key === 'magic-item:ammunition-1-2-or-3',
      );
      const unrelated = trace.packet.packet.candidates.find(
        (item) => item.identity.key === 'magic-item:cube-of-force',
      );
      expect(selected?.capability?.status).toBe('available');
      expect(unrelated).toBeDefined();
      expect(unrelated?.capability).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('reports the readiness capability itself, not an execution capability', () => {
    const db = freshDbWithSession();
    try {
      const trace = runDiscoveryStages({
        db,
        scenario: {
          playerInput: 'nothing',
          stateFields: {
            itemRecord: 'magic-item:ammunition-1-2-or-3',
            operationId: 'hit-target',
          },
        },
      });
      const candidate = trace.packet.packet.candidates.find(
        (item) => item.identity.key === 'magic-item:ammunition-1-2-or-3',
      );
      // A green readiness preflight establishes the readiness capability and
      // nothing more. Relabelling it as a single-use SPEND would assert an
      // execution commitment no contract backs and no code here performs.
      expect(candidate?.capability?.capabilityId).toBe(
        MAGIC_ITEM_OPERATION_READINESS_CAPABILITY.operationId,
      );
      expect(candidate?.capability?.capabilityId).not.toBe(
        'magic-item-single-use-spend',
      );
    } finally {
      db.close();
    }
  });

  it('gates the preflight on the selected variant', () => {
    const db = freshDbWithSession();
    try {
      const resolver = installVariantReadinessAddon(
        db,
        '2026-09-01T00:00:00.000Z',
      );
      const run = (variantId: string) =>
        runDiscoveryStages({
          db,
          rulesPackResolver: resolver,
          scenario: {
            playerInput: 'nothing',
            stateFields: {
              itemRecord: VARIANT_READINESS_ITEM_KEY,
              operationId: VARIANT_READINESS_OPERATION,
              variantId,
            },
          },
        }).packet.packet.candidates.find(
          (item) => item.identity.key === VARIANT_READINESS_ITEM_KEY,
        )?.capability;

      // Same record, same operation, different variant. Passing
      // variantId = undefined (as an earlier revision hardcoded) cannot tell
      // these apart and would report one answer for both.
      const ready = run(READY_VARIANT_ID);
      const pending = run(PENDING_VARIANT_ID);
      expect(ready?.variantId).toBe(READY_VARIANT_ID);
      expect(pending?.variantId).toBe(PENDING_VARIANT_ID);
      expect(ready?.status).toBe('available');
      expect(pending?.status).toBe('blocked');
    } finally {
      db.close();
    }
  });

  it('lets an active campaign rule surface governing material by itself', () => {
    const db = freshDbWithSession();
    try {
      const trace = runDiscoveryStages({
        db,
        scenario: {
          // Nothing here mentions or references the governed record.
          playerInput: 'we continue the negotiation',
          stateFields: { campaignPosition: 'turn-12', actor: 'pc-1' },
        },
        campaignRuleSeam: {
          activeRulesAtPosition: () => [
            {
              ruleIdentity: 'house-rule-components',
              ruleKind: 'house-rule',
              status: 'active',
              origin: 'player',
              provenance: 'campaign history',
              effectivePosition: 'turn-12',
              supersededBy: null,
              scope: 'material components',
              governingRecordKeys: ['spell:fireball'],
            },
          ],
          activeRulingsForAmbiguities: () => [],
        },
      });
      // campaign-rule is a discovery ROUTE: the governing record enters as a
      // must-consider candidate even though no other route reached it.
      expect(trace.ruleJoin.surfacedCandidateKeys).toEqual(['spell:fireball']);
      const candidate = trace.packet.packet.candidates.find(
        (item) => item.identity.key === 'spell:fireball',
      );
      expect(candidate).toBeDefined();
      expect(candidate?.routes.map((route) => route.routeClass)).toEqual([
        'campaign-rule',
      ]);
      expect(candidate?.campaignRules[0].ruleIdentity).toBe(
        'house-rule-components',
      );
      const measurements = measureDiscovery(trace, {
        mustIncludeTargetRefs: ['spell:fireball'],
      });
      expect(measurements.m1['spell:fireball']).toBe(true);
      expect(measurements.m5.returned).toEqual(['house-rule-components']);
      expect(measurements.m5.matched).toEqual(['house-rule-components']);
      expect(measurements.m5.unplaced).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('records an unplaceable rule and leaves its ambiguity unresolved', () => {
    const db = freshDbWithSession();
    try {
      const trace = runDiscoveryStages({
        db,
        scenario: {
          playerInput: 'nothing',
          stateFields: { itemRecord: 'magic-item:cube-of-force' },
        },
        campaignRuleSeam: {
          activeRulesAtPosition: () => [],
          activeRulingsForAmbiguities: () => [
            {
              ruleIdentity: 'ruling-nowhere',
              ruleKind: 'ruling',
              status: 'active',
              origin: 'dm',
              provenance: 'campaign history',
              effectivePosition: 'turn-1',
              supersededBy: null,
              scope: 'ambiguity:cube-of-force-same-face-duration-reset',
              governingRecordKeys: ['rules-record:does-not-exist'],
              ambiguityId: 'ambiguity:cube-of-force-same-face-duration-reset',
              selectedInterpretationId: 'same-face-resets',
            },
          ],
        },
      });
      const measurements = measureDiscovery(trace);
      expect(measurements.m5.returned).toEqual(['ruling-nowhere']);
      expect(measurements.m5.unplaced).toEqual(['ruling-nowhere']);
      // An unplaced ruling never reached the packet, so it cannot be reported
      // as resolving the ambiguity: the uncertainty is preserved (8.2 R7).
      expect(measurements.m5.unresolvedAmbiguityIds).toContain(
        'ambiguity:cube-of-force-same-face-duration-reset',
      );
      expect(
        trace.ruleJoin.losses.some((loss) => loss.reason === 'unplaced-rule'),
      ).toBe(true);
    } finally {
      db.close();
    }
  });

  it('expands typed links from a must-consider seed but not an exploratory one', () => {
    const seed = (routeClass: 'direct-state-ref' | 'situation-cue') => ({
      candidateKey: 'condition:incapacitated',
      targetKind: 'rules-record' as const,
      entry: stack.recordsByKey.get('condition:incapacitated'),
      routes: [{ routeClass, trigger: 'seed', evidence: {}, signalId: 'seed' }],
      traversals: [],
      campaignRules: [],
      campaignRulings: [],
    });
    const dodgeReached = (candidates: readonly DiscoveryCandidate[]) =>
      expandTypedRelationships(candidates, stack).outputsProduced.some(
        (item) => item.candidateKey === 'action:dodge',
      );

    // Identical typed link, two different origin bands.
    expect(dodgeReached([seed('direct-state-ref')])).toBe(true);
    expect(dodgeReached([seed('situation-cue')])).toBe(false);

    const skipped = expandTypedRelationships([seed('situation-cue')], stack);
    expect(skipped.losses.map((loss) => loss.reason)).toContain(
      'expansion-origin-not-must-consider',
    );
  });

  it('recognizes areas in linear time on adversarial prose', () => {
    const db = freshDbWithSession();
    try {
      // A long digit run that never reaches "-foot" is the shape CodeQL
      // flagged as polynomial. The bounded recognizer must return promptly.
      const started = Date.now();
      runDiscoveryStages({
        db,
        scenario: {
          playerInput: `${'9'.repeat(60_000)} feet of nothing`,
          stateFields: { first: 'rule:cover' },
        },
      });
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      db.close();
    }
  });
  it('expands the neighbourhood of a record the campaign rule alone made must-consider', () => {
    const db = freshDbWithSession();
    try {
      const trace = runDiscoveryStages({
        db,
        scenario: {
          // Nothing here names or references the governed record.
          playerInput: 'the party proceeds',
          stateFields: { campaignPosition: 'turn-1', actor: 'pc-1' },
        },
        campaignRuleSeam: {
          activeRulesAtPosition: () => [
            {
              ruleIdentity: 'house-rule-incapacitation',
              ruleKind: 'house-rule',
              status: 'active',
              origin: 'player',
              provenance: 'campaign history',
              effectivePosition: 'turn-1',
              supersededBy: null,
              scope: 'incapacitation',
              governingRecordKeys: ['condition:incapacitated'],
            },
          ],
          activeRulingsForAmbiguities: () => [],
        },
      });
      const keys = new Set(
        trace.packet.packet.candidates.map((item) => item.identity.key),
      );
      const governed = trace.packet.packet.candidates.find(
        (item) => item.identity.key === 'condition:incapacitated',
      );

      // Must-consider through campaign-rule alone.
      expect(governed?.routes.map((route) => route.routeClass)).toContain(
        'campaign-rule',
      );
      expect(trace.ruleJoin.surfacedCandidateKeys).toEqual([
        'condition:incapacitated',
      ]);

      // Design amendment 12.1.1: it receives the one-hop Related neighbourhood
      // that section 6.3 grants must-consider material. Before the second
      // pass, expansion had already finished and this was unreachable.
      expect(keys).toContain('action:dodge');
      expect(trace.ruleExpansion.traversals).toContainEqual({
        sourceRecordKey: 'action:dodge',
        linkField: 'data.mechanics.conditions',
        relation: 'exclusion',
        targetRecordKey: 'condition:incapacitated',
      });

      // One hop only. feature:barbarian:danger-sense is a hop-1 neighbour and
      // carries `data.source: class:barbarian`; a cascading second pass would
      // pull the class in.
      expect(keys).toContain('feature:barbarian:danger-sense');
      expect(keys).not.toContain('class:barbarian');
      for (const traversal of trace.ruleExpansion.traversals)
        expect(
          traversal.sourceRecordKey === 'condition:incapacitated' ||
            traversal.targetRecordKey === 'condition:incapacitated',
          `${traversal.sourceRecordKey} -> ${traversal.targetRecordKey} is not one hop from the promoted record`,
        ).toBe(true);
    } finally {
      db.close();
    }
  });

  it('runs the second expansion pass only for candidates the join promoted', () => {
    const db = freshDbWithSession();
    try {
      // No campaign rule at all: nothing is promoted, so the second pass has
      // no seeds and adds no traversals, while the first pass still worked.
      const trace = runDiscoveryStages({
        db,
        scenario: {
          playerInput: 'nothing',
          stateFields: { first: 'condition:incapacitated' },
        },
      });
      expect(trace.expansion.traversals.length).toBeGreaterThan(0);
      expect(trace.ruleExpansion.traversals).toEqual([]);
      expect(trace.ruleJoin.surfacedCandidateKeys).toEqual([]);
    } finally {
      db.close();
    }
  });
});
