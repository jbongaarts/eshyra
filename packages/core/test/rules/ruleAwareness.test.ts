import { describe, expect, it } from 'vitest';
import { expandTypedRelationships } from '../../src/discovery/expansion.js';
import { buildContextPacket } from '../../src/discovery/packet.js';
import { renderContextPacketMessage } from '../../src/discovery/packetMessage.js';
import { retainCandidates } from '../../src/discovery/retention.js';
import { DEFAULT_TOOLS } from '../../src/orchestrator/tools.js';
import {
  bundledDnd5eSrdRecordRelationshipManifestSource,
  getBundledDnd5eSrdPack,
} from '../../src/rules/bundledSrdPack.js';
import {
  ruleAwareness,
  ruleStatements,
} from '../../src/rules/ruleAwareness.js';
import {
  ENGINE_CAPABILITY_GAPS,
  RULE_KNOWN_LIMITS,
  type RuleKnownLimit,
  validateRuleKnownLimits,
} from '../../src/rules/ruleKnownLimits.js';
import { resolveRulesStack } from '../../src/rules/stack.js';
import { RulesPackError } from '../../src/rules/types.js';

const stack = resolveRulesStack({ base: getBundledDnd5eSrdPack() });
const registeredTools = new Set(DEFAULT_TOOLS.map((tool) => tool.name));
const manifestSource = bundledDnd5eSrdRecordRelationshipManifestSource();

function packetTraceFor(recordKey: string) {
  const entry = stack.recordsByKey.get(recordKey);
  if (entry === undefined) throw new Error(`missing record ${recordKey}`);
  return buildContextPacket(
    retainCandidates([
      {
        candidateKey: recordKey,
        targetKind: 'rules-record',
        entry,
        routes: [
          {
            routeClass: 'explicit-name-or-alias',
            trigger: 'test',
            evidence: {},
            signalId: 'test',
          },
        ],
        traversals: [],
        campaignRules: [],
        campaignRulings: [],
      },
    ]),
    [],
    50_000_000,
  );
}

function packetCandidateFor(recordKey: string) {
  return packetTraceFor(recordKey).packet.candidates.find(
    ({ identity }) => identity.key === recordKey,
  );
}

function renderedFor(recordKey: string): string {
  const trace = packetTraceFor(recordKey);
  return renderContextPacketMessage({
    retention: { overflow: [] },
    packet: {
      packet: trace.packet,
      byteOverflow: trace.byteOverflow,
      dropped: trace.dropped,
    },
  }).text;
}

describe('rule awareness', () => {
  it('keeps capability and known-limit channels independent (synthetic)', () => {
    const key = 'rule:ability-checks';
    const partial = {
      limit: 'partial' as const,
      statement: 'Synthetic partial limit.',
      findingId: 'readiness-integrity',
    };
    const deferred = {
      limit: 'deferred' as const,
      statement: 'Synthetic deferred limit.',
      findingId: 'engine-capability-ownership',
    };
    const bare = ruleAwareness(key, stack, manifestSource, { knownLimits: {} });
    const withBoth = ruleAwareness(key, stack, manifestSource, {
      knownLimits: { [key]: [partial, deferred] },
    });
    expect(withBoth.capabilities.outcome).toBe('bound');
    expect(withBoth.knownLimits).toEqual([partial, deferred]);
    expect(withBoth.capabilities).toEqual(bare.capabilities);
    expect(withBoth.relationships).toEqual(bare.relationships);
    const noManifest = ruleAwareness(key, stack, () => undefined, {
      knownLimits: { [key]: [partial, deferred] },
    });
    expect(noManifest.relationshipArtifact.state).toBe('absent');
    expect(noManifest.relationships).toEqual([]);
    expect(noManifest.capabilities).toEqual(withBoth.capabilities);
    expect(noManifest.knownLimits).toEqual([partial, deferred]);
  });

  it('refuses a key the stack does not hold rather than naming another producer', () => {
    expect(() =>
      ruleAwareness('rule:no-such-rule', stack, manifestSource),
    ).toThrow(RulesPackError);
  });

  it('preserves the declared action:hide ruleRef relationship', () => {
    const result = ruleAwareness('action:hide', stack, manifestSource);
    expect(result.relationshipArtifact).toEqual({
      packId: stack.base.meta.packId,
      state: 'present',
    });
    expect(result.relationships).toContainEqual(
      expect.objectContaining({
        outcome: 'resolved',
        sourceRecordKey: 'action:hide',
        pointer: '/mechanics/effects/*/ruleRef',
        relation: 'governing-rule',
      }),
    );
  });

  it('matches discovery relationship resolutions for the same stack and source', () => {
    const awareness = ruleAwareness('action:hide', stack, manifestSource);
    const expansion = expandTypedRelationships([], stack, {
      relationshipManifestSource: manifestSource,
    });
    expect(awareness.relationships).toEqual(
      expansion.relationshipResolutions.filter(
        (resolution) => resolution.sourceRecordKey === 'action:hide',
      ),
    );
  });

  it('retires the stale long-rest limit and leaves reference prose empty', () => {
    const longRest = ruleAwareness('rule:long-rest', stack, manifestSource);
    expect(longRest.capabilities.outcome).toBe('not-positively-selected');
    expect(longRest.knownLimits).toEqual([]);

    const lair = ruleAwareness(
      'rule:a-legendary-creatures-lair',
      stack,
      manifestSource,
    );
    expect(lair.capabilities.outcome).toBe('no-statement');
    expect(lair.knownLimits).toEqual([]);
  });

  it('carries known limits into the discovery packet', () => {
    expect(packetCandidateFor('rule:suffocating')?.ruleKnownLimits).toEqual(
      ruleStatements('rule:suffocating').knownLimits,
    );
    expect(
      packetCandidateFor('rule:a-legendary-creatures-lair')?.ruleKnownLimits,
    ).toBeUndefined();
  });

  it('renders the statement channels into the model-facing packet message only when present', () => {
    const suffocating = renderedFor('rule:suffocating');
    expect(suffocating).toContain('### Eshyra known limits');
    expect(suffocating).toContain('(finding: readiness-integrity)');
    // Source-fidelity: the SRD rule forbids HP regain and stabilization until
    // the creature can breathe again, and no runtime gate enforces it.
    expect(suffocating).toContain(
      'does not gate stabilization or HP recovery on renewed breathing',
    );
    expect(suffocating).toContain('do not call stabilize_character');
    expect(suffocating).not.toMatch(
      /held its breath|suffocation round countdown/i,
    );
    const lair = renderedFor('rule:a-legendary-creatures-lair');
    expect(lair).not.toContain('### Eshyra known limits');
  });

  it('scopes suffocation HP guidance by target domain', () => {
    const [limit] = ruleStatements('rule:suffocating').knownLimits;
    // adjust_hp / stabilize_character address characters only; encounter
    // combatants take HP through update_combatant hpDelta.
    expect(limit?.statement).toContain(
      'When a character drops to 0 hit points',
    );
    expect(limit?.statement).not.toMatch(/When the creature drops/);
    // Encounter combatants: updateCombatant defaults 0 HP to 'dead' and
    // CombatantStatus has no dying state, so the source's dying transition is
    // disclosed as unrepresentable, never offered as an update_combatant path.
    expect(limit?.statement).toContain('encounter combatant');
    expect(limit?.statement).toContain('cannot be recorded');
    expect(limit?.statement).toContain(
      'to dead unless another status is given',
    );
    expect(limit?.statement).not.toMatch(/unconscious/);
  });

  it('discloses that add_condition cannot raise graded exhaustion', () => {
    // domainMutations.ts addCondition no-ops on an existing id, and rest.ts
    // applyExhaustion requires {id:'exhaustion', level:1..6}; SRD food, water,
    // and forced march each impose (further) exhaustion levels.
    for (const key of ['rule:food', 'rule:water', 'rule:speed']) {
      const [limit] = ruleStatements(key).knownLimits;
      expect(limit?.findingId).toBe('readiness-integrity');
      expect(limit?.statement).toContain('level: 1');
      // The increment is disclosed as unpersistable; canonical state is never
      // delegated to the DM (ADR 0020 §2).
      expect(limit?.statement).toContain('cannot currently be persisted');
      expect(limit?.statement).not.toMatch(/DM tracks/);
    }
  });

  it('discloses the unresolvable fixed-total hiding comparison', () => {
    // SRD rule:hiding: the retained Stealth total is contested by a later
    // search (a tie keeps the hider hidden) and compared with passive
    // Perception; no deterministic tool performs either comparison.
    const [limit] = ruleStatements('rule:hiding').knownLimits;
    expect(limit?.findingId).toBe('readiness-integrity');
    expect(limit?.statement).toContain(
      'cannot currently be resolved deterministically',
    );
    expect(limit?.statement).toContain('resolve_contest rolls both sides');
    expect(limit?.statement).not.toMatch(/compare (it|the totals?) yourself/i);
  });

  it('preserves the knockout, ready, water, and ammunition known limits', () => {
    expect(
      ruleStatements('rule:knocking-a-creature-out').knownLimits[0]?.statement,
    ).toContain('instant death');
    expect(ruleStatements('rule:water').knownLimits[0]?.statement).toContain(
      'two levels at once',
    );
    // A5 re-evaluation: the held energy can be tracked as a ruling-sourced
    // concentration effect, so the save stays engine-owned (DC included)
    // through resolve_concentration; the DM never computes the DC.
    const ready = ruleStatements('action:ready').knownLimits[0]?.statement;
    expect(ready).toContain(
      'start_effect as a spell-effect from source kind ruling',
    );
    expect(ready).toContain('resolve_concentration resolves it');
    expect(ready).not.toMatch(/whichever is higher|half the damage/);
    const ammo = ruleStatements('rule:weapon-properties').knownLimits[0];
    expect(ammo?.statement).toContain('disposition dropped');
    expect(ammo?.statement).toContain('claim_item');
    expect(ammo?.statement).toContain(
      'no tool determines how many of the expended pieces are recoverable',
    );
    expect(ammo?.statement).not.toMatch(/recover half of/);
  });

  it('validates finding identities in known limits', () => {
    expect(validateRuleKnownLimits(registeredTools)).toEqual([]);
    expect(RULE_KNOWN_LIMITS['rule:suffocating']?.[0]?.findingId).toBe(
      'readiness-integrity',
    );
  });

  it('owns every blocking capability gap a known limit discloses (A5)', () => {
    // Identity-pinned (invariant 6): which limits disclose which gaps. A gap
    // leaves this map only when its capability lands or authority changes.
    const gapsByKey = Object.fromEntries(
      Object.entries(RULE_KNOWN_LIMITS).flatMap(([key, limits]) => {
        const gaps = limits.flatMap((limit) => limit.capabilityGaps ?? []);
        return gaps.length === 0 ? [] : [[key, gaps]];
      }),
    );
    expect(gapsByKey).toEqual({
      'rule:food': ['graded-exhaustion-increase'],
      'rule:hiding': ['retained-check-total-resolution'],
      'rule:knocking-a-creature-out': ['nonlethal-knockout'],
      'rule:speed': ['graded-exhaustion-increase'],
      'rule:suffocating': [
        'suffocation-recovery-gate',
        'combatant-dying-state',
      ],
      'rule:surprise': ['retained-check-total-resolution'],
      'rule:water': ['graded-exhaustion-increase'],
      'rule:weapon-properties': ['ammunition-recovery-count'],
    });
    for (const gap of Object.values(ENGINE_CAPABILITY_GAPS))
      expect(gap.findingId).toBe('engine-capability-ownership');

    const limit = (overrides: Partial<RuleKnownLimit>): RuleKnownLimit => ({
      limit: 'partial',
      statement: 'Synthetic limit naming resolve_check.',
      findingId: 'readiness-integrity',
      participants: ['resolve_check'],
      ...overrides,
    });
    // A disclosed gap with no registered owner is not a disposition.
    expect(
      validateRuleKnownLimits(
        registeredTools,
        { 'rule:x': [limit({ capabilityGaps: ['nonlethal-knockout'] })] },
        {},
      ),
    ).toEqual(["rule:x: unknown capability gap 'nonlethal-knockout'"]);
    // An owned gap no limit discloses, or an owner that is not a bead.
    expect(
      validateRuleKnownLimits(
        registeredTools,
        {},
        {
          orphan: {
            operation: 'Synthetic operation.',
            ownerBead: 'TBD',
            findingId: 'engine-capability-ownership',
          },
        },
      ),
    ).toEqual([
      "capability gap 'orphan' is disclosed by no known limit",
      "capability gap 'orphan': ownerBead 'TBD' is not a bead id",
    ]);
    // An ADR 0018 deferral narrows the requirement; it is never a gap.
    expect(
      validateRuleKnownLimits(registeredTools, {
        'rule:x': [
          limit({
            limit: 'deferred',
            participants: [],
            capabilityGaps: ['nonlethal-knockout'],
          }),
        ],
      }).filter((error) => error.startsWith('rule:x')),
    ).toEqual([
      "rule:x: a deferred limit cannot carry capability gap 'nonlethal-knockout'",
    ]);
  });

  it('identifies participating tools without requiring a state writer (invariant 12)', () => {
    // rule:hiding is a resolution-only trap: every participant is read-only,
    // and the validator admits it.
    const [hiding] = RULE_KNOWN_LIMITS['rule:hiding'] ?? [];
    expect(hiding?.participants).toEqual([
      'resolve_contest',
      'resolve_check',
      'calc',
    ]);
    for (const name of hiding?.participants ?? [])
      expect(DEFAULT_TOOLS.find((tool) => tool.name === name)?.mutates).toBe(
        false,
      );
    expect(
      validateRuleKnownLimits(
        registeredTools,
        { 'rule:hiding': RULE_KNOWN_LIMITS['rule:hiding'] ?? [] },
        {
          'retained-check-total-resolution':
            ENGINE_CAPABILITY_GAPS['retained-check-total-resolution'],
        },
      ),
    ).toEqual([]);

    const base: RuleKnownLimit = {
      limit: 'partial',
      statement: 'Synthetic limit naming resolve_check.',
      findingId: 'readiness-integrity',
    };
    expect(
      validateRuleKnownLimits(
        registeredTools,
        {
          'rule:none': [base],
          'rule:unregistered': [
            {
              ...base,
              statement: 'Names no_such_tool.',
              participants: ['no_such_tool'],
            },
          ],
          'rule:unnamed': [{ ...base, participants: ['calc'] }],
        },
        {},
      ),
    ).toEqual([
      'rule:none: partial known limit names no participant',
      "rule:unregistered: participant 'no_such_tool' is not a registered tool",
      "rule:unnamed: statement does not name participant 'calc'",
    ]);
  });

  it('offers no substitute for a missing deterministic operation', () => {
    // Targeted regressions for substitutes the gaps invite (ADR 0020 §2/§3):
    // skipping or hand-tracking engine-owned death saves, and removing and
    // re-adding exhaustion at a model-computed level.
    const suffocating =
      ruleStatements('rule:suffocating').knownLimits[0]?.statement;
    expect(suffocating).toContain('record_death_save is not gated');
    expect(suffocating).not.toMatch(/skip|in prose|yourself|narrat/i);
    for (const key of ['rule:food', 'rule:water', 'rule:speed'])
      expect(ruleStatements(key).knownLimits[0]?.statement).not.toMatch(
        /remove_condition|re-?add|level: [2-6]/,
      );
  });
});
