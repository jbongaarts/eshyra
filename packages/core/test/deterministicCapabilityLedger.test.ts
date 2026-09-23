import { describe, expect, it } from 'vitest';
import {
  RULE_DETERMINISTIC_CAPABILITY_BINDINGS as AUDIT_BINDINGS,
  RULE_DETERMINISTIC_CAPABILITY_CONTRACTS as AUDIT_CONTRACTS,
  RULE_DETERMINISTIC_CAPABILITY_DISPOSITIONS as AUDIT_DISPOSITIONS,
  buildRuleDispositionReport,
} from '../scripts/create-dnd5e-srd-audit-bundle/ruleDispositions.js';
import {
  buildContextPacket,
  createDeterministicCapabilityLedger,
  DETERMINISTIC_CAPABILITY_LEDGER,
  getBundledDnd5eSrdPack,
  RULE_DETERMINISTIC_CAPABILITY_BINDINGS,
  RULE_DETERMINISTIC_CAPABILITY_CONTRACTS,
  RULE_DETERMINISTIC_CAPABILITY_DISPOSITIONS,
  RulesPackError,
  requireRuleDeterministicCapabilityContract,
  resolveRulesStack,
  retainCandidates,
  runDiscoveryStages,
} from '../src/internal.js';
import { freshDbWithSession } from './support/db.js';

const stack = resolveRulesStack({ base: getBundledDnd5eSrdPack() });

function packetFor(recordKey: string, dataOverride?: unknown) {
  const entry = stack.recordsByKey.get(recordKey);
  if (entry === undefined) throw new Error(`missing record ${recordKey}`);
  const record =
    dataOverride === undefined
      ? entry.record
      : { ...entry.record, data: dataOverride };
  return buildContextPacket(
    retainCandidates([
      {
        candidateKey: recordKey,
        targetKind: 'rules-record',
        entry: { ...entry, record },
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
  ).packet;
}

describe('runtime-owned deterministic capability ledger', () => {
  it('R1 resolves every bound rule identity to its exact contract revision', () => {
    const expected = new Map([
      ['rule:ability-checks', 'resolve-check-v1'],
      ['rule:advantage-and-disadvantage', 'resolve-check-v1'],
      ['rule:attack-rolls', 'resolve-check-v1'],
      ['rule:modifiers-to-the-roll', 'resolve-check-v1'],
      ['rule:proficiency-bonus', 'resolve-check-v1'],
      ['rule:saving-throws', 'resolve-check-v1'],
      ['rule:concentration', 'resolve-concentration-v1'],
      ['rule:casting-a-spell-at-a-higher-level', 'resolve-spell-upcast-v1'],
    ]);
    for (const [recordKey, revision] of expected) {
      const result = DETERMINISTIC_CAPABILITY_LEDGER.lookup(recordKey);
      expect(result).toMatchObject({ outcome: 'bound', recordKey });
      if (result.outcome === 'bound')
        expect(result.bindings.map(({ revision: actual }) => actual)).toEqual([
          revision,
        ]);
    }
  });

  it('R2 distinguishes a disposition from a record outside the ledger statement', () => {
    const disposition =
      DETERMINISTIC_CAPABILITY_LEDGER.lookup('rule:attunement');
    expect(disposition.outcome).toBe('not-positively-selected');
    if (disposition.outcome === 'not-positively-selected')
      expect(disposition.disposition.reason).toContain(
        'historical implemented row',
      );
    expect(
      DETERMINISTIC_CAPABILITY_LEDGER.lookup('creature:goblin').outcome,
    ).toBe('no-statement');
  });

  it('R3 presents concentration in a real context packet with quoted limits', () => {
    const packet = packetFor('rule:concentration');
    const candidate = packet.candidates.find(
      ({ identity }) => identity.key === 'rule:concentration',
    );
    expect(candidate?.capabilities).toContainEqual({
      status: 'not-evaluated-offline',
      capabilityId: 'resolve_concentration',
      revision: 'resolve-concentration-v1',
      inputs:
        RULE_DETERMINISTIC_CAPABILITY_CONTRACTS['resolve-concentration-v1']
          .requiredInputs,
      exclusions:
        RULE_DETERMINISTIC_CAPABILITY_CONTRACTS['resolve-concentration-v1']
          .exclusions,
      residualInterpretation:
        RULE_DETERMINISTIC_CAPABILITY_CONTRACTS[
          'resolve-concentration-v1'
        ].residualDmInterpretation.join(' '),
    });
  });

  it('R4 fails closed for unknown revisions and invalid ledger construction', () => {
    expect(() =>
      requireRuleDeterministicCapabilityContract('not-a-real-revision'),
    ).toThrow(RulesPackError);
    const contract =
      RULE_DETERMINISTIC_CAPABILITY_CONTRACTS['resolve-check-v1'];
    expect(() =>
      createDeterministicCapabilityLedger(
        { ...RULE_DETERMINISTIC_CAPABILITY_CONTRACTS },
        [{ ruleKey: 'x', capability: 'missing' }],
        {},
      ),
    ).toThrow(RulesPackError);
    expect(() =>
      createDeterministicCapabilityLedger(
        { 'resolve-check-v1': contract },
        [{ ruleKey: 'same', capability: 'resolve-check-v1' }],
        {
          same: {
            ruleKey: 'same',
            outcome: 'not-positively-selected',
            reason: 'r',
            replacingResponsibility: 'r',
            nextState: 'r',
          },
        },
      ),
    ).toThrow(RulesPackError);
  });

  it('R8 fails closed on duplicate bindings and registry-key/identity mismatches (F7)', () => {
    // A separate audit-only validator (validateRuleDeterministicCapabilityContracts
    // in the audit-bundle script) is not the runtime constructor's guarantee: a
    // runtime consumer must not depend on an audit-only path happening to run
    // before it reads DETERMINISTIC_CAPABILITY_LEDGER. These three invariants
    // must be enforced by the constructor itself, failing closed before any
    // lookup or packet presentation.
    const contract =
      RULE_DETERMINISTIC_CAPABILITY_CONTRACTS['resolve-check-v1'];

    // A registry key whose own contract.revision names a different identity:
    // a binding through this key would select 'mismatched-key' for lookup
    // while the packet would advertise 'resolve-check-v1' as the revision.
    expect(() =>
      createDeterministicCapabilityLedger(
        { 'mismatched-key': contract },
        [{ ruleKey: 'rule:x', capability: 'mismatched-key' }],
        {},
      ),
    ).toThrow(RulesPackError);

    // A duplicate identical (ruleKey, capability) binding: the same
    // candidate would present the same declared capability twice in one
    // context packet.
    expect(() =>
      createDeterministicCapabilityLedger(
        { 'resolve-check-v1': contract },
        [
          { ruleKey: 'rule:duplicate', capability: 'resolve-check-v1' },
          { ruleKey: 'rule:duplicate', capability: 'resolve-check-v1' },
        ],
        {},
      ),
    ).toThrow(RulesPackError);

    // A disposition map key whose own disposition.ruleKey names a different
    // record: a lookup by the map key would return a disposition
    // identifying a rule other than the one asked about.
    expect(() =>
      createDeterministicCapabilityLedger({}, [], {
        'rule:map-key': {
          ruleKey: 'rule:different-record',
          outcome: 'not-positively-selected',
          reason: 'r',
          replacingResponsibility: 'r',
          nextState: 'r',
        },
      }),
    ).toThrow(RulesPackError);

    // The default, module-level construction (the global
    // DETERMINISTIC_CAPABILITY_LEDGER's own registries) still satisfies
    // every invariant this constructor now enforces.
    expect(() => createDeterministicCapabilityLedger()).not.toThrow();
  });

  it('R5 does not infer a capability from typed mechanics', () => {
    const packet = packetFor('creature:goblin', {
      mechanics: { executionReadiness: { status: 'implemented' } },
    });
    const candidate = packet.candidates.find(
      ({ identity }) => identity.key === 'creature:goblin',
    );
    expect(candidate?.capabilities).toEqual([]);
    expect(candidate?.deterministicCapabilityDisposition).toBeUndefined();
    expect(
      DETERMINISTIC_CAPABILITY_LEDGER.lookup('creature:goblin').outcome,
    ).toBe('no-statement');
  });

  it('R6 preserves the existing magic-item preflight identities and statuses', () => {
    const db = freshDbWithSession();
    try {
      const available = runDiscoveryStages({
        db,
        scenario: {
          playerInput: 'nothing',
          stateFields: {
            itemRecord: 'magic-item:ammunition-1-2-or-3',
            operationId: 'hit-target',
          },
        },
      });
      const blocked = runDiscoveryStages({
        db,
        scenario: {
          playerInput: 'nothing',
          stateFields: { itemRecord: 'magic-item:cube-of-force' },
        },
      });
      const availableCandidate = available.packet.packet.candidates.find(
        ({ identity }) => identity.key === 'magic-item:ammunition-1-2-or-3',
      );
      const blockedCandidate = blocked.packet.packet.candidates.find(
        ({ identity }) => identity.key === 'magic-item:cube-of-force',
      );
      expect(
        availableCandidate?.capabilities.find(
          ({ operationId }) => operationId === 'hit-target',
        )?.status,
      ).toBe('available');
      expect(
        blockedCandidate?.capabilities.find(
          ({ operationId }) => operationId === 'press-face-1',
        )?.status,
      ).toBe('blocked');
    } finally {
      db.close();
    }
  });

  it('R7 the audit-bundle report re-emits the pre-move three-contract membership, not the runtime ledger four (F5)', () => {
    // Pre-move identities exactly as they stood in
    // git show origin/main:packages/core/scripts/create-dnd5e-srd-audit-bundle/ruleDispositions.ts
    // before PR #546 registered the magic-item readiness contract in the
    // shared runtime ledger. A pin authored AFTER that move (the four-row
    // set this test used to assert) ratifies the drift instead of detecting
    // it, so these literals come from the pre-move tree, not from re-reading
    // the current one.
    const PRE_MOVE_CONTRACT_REVISIONS = [
      'resolve-check-v1',
      'resolve-concentration-v1',
      'resolve-spell-upcast-v1',
    ];
    const PRE_MOVE_BINDINGS = [
      ['rule:ability-checks', 'resolve-check-v1'],
      ['rule:advantage-and-disadvantage', 'resolve-check-v1'],
      ['rule:attack-rolls', 'resolve-check-v1'],
      ['rule:modifiers-to-the-roll', 'resolve-check-v1'],
      ['rule:proficiency-bonus', 'resolve-check-v1'],
      ['rule:saving-throws', 'resolve-check-v1'],
      ['rule:concentration', 'resolve-concentration-v1'],
      ['rule:casting-a-spell-at-a-higher-level', 'resolve-spell-upcast-v1'],
    ];
    const PRE_MOVE_DISPOSITION_KEYS = [
      'rule:abilities',
      'rule:ability-scores-and-modifiers',
      'rule:attunement',
      'rule:backgrounds-equipment',
      'rule:backgrounds-proficiencies',
      'rule:beyond-1st-level',
      'rule:bonus-action',
      'rule:bonus-actions',
      'rule:constitution-hit-points',
      'rule:contests',
      'rule:critical-hits',
      'rule:damage-resistance-and-vulnerability',
      'rule:damage-rolls',
      'rule:death-saving-throws',
      'rule:falling-unconscious',
      'rule:gaining-inspiration',
      'rule:grapple-rules-for-monsters',
      'rule:group-checks',
      'rule:healing',
      'rule:instant-death',
      'rule:legendary-actions',
      'rule:limited-usage',
      'rule:other-activity-on-your-turn',
      'rule:passive-checks',
      'rule:reactions',
      'rule:spell-slots',
      'rule:stabilizing-a-creature',
      'rule:surprise',
      'rule:temporary-hit-points',
      'rule:using-inspiration',
      'rule:your-turn',
    ];

    // The checkable claim is the REPORT's membership, not the raw registry:
    // buildRuleDispositionReport().deterministicCapabilities is what F5 grew
    // from three identities to four. Comparing the report to the audit
    // bundle's own re-exported registry would be a tautology; these are the
    // real pre-move contract objects, asserted as identities (not a count).
    const report = buildRuleDispositionReport();
    expect(
      report.deterministicCapabilities.map((contract) => contract.revision),
    ).toEqual(PRE_MOVE_CONTRACT_REVISIONS);
    expect(report.deterministicCapabilities).toEqual(
      [...PRE_MOVE_CONTRACT_REVISIONS]
        .sort((a, b) => a.localeCompare(b))
        .map((revision) => RULE_DETERMINISTIC_CAPABILITY_CONTRACTS[revision]),
    );
    // Each reported row is the runtime's own object, not a second copy of it
    // (eshyra-o9bd.19.1.4 review round 1, finding X1: duplicating this data
    // is the defect that round fixed).
    for (const revision of PRE_MOVE_CONTRACT_REVISIONS) {
      expect(
        report.deterministicCapabilities.find(
          (contract) => contract.revision === revision,
        ),
      ).toBe(RULE_DETERMINISTIC_CAPABILITY_CONTRACTS[revision]);
    }

    // Bindings and dispositions were not touched by the move; re-asserted
    // here (identities, not counts) so this one re-grounded test still
    // catches drift in either alongside a future contracts change.
    expect(
      [...AUDIT_BINDINGS].map(({ ruleKey, capability }) => [
        ruleKey,
        capability,
      ]),
    ).toEqual(PRE_MOVE_BINDINGS);
    expect(Object.keys(AUDIT_DISPOSITIONS).sort()).toEqual(
      PRE_MOVE_DISPOSITION_KEYS,
    );

    // The runtime ledger still knows the magic-item revision even though
    // the report does not list it: absence from the report is a statement
    // about this report's reviewed scope (eshyra-o9bd.19.5.12 owns growing
    // it), never a claim that Eshyra's runtime ledger forgot the capability.
    expect(
      RULE_DETERMINISTIC_CAPABILITY_CONTRACTS['derived-magic-item-clauses-v1'],
    ).toBeDefined();
    expect(
      report.deterministicCapabilities.some(
        (contract) => contract.revision === 'derived-magic-item-clauses-v1',
      ),
    ).toBe(false);
    expect(Object.keys(AUDIT_CONTRACTS).sort()).toEqual([
      'derived-magic-item-clauses-v1',
      'resolve-check-v1',
      'resolve-concentration-v1',
      'resolve-spell-upcast-v1',
    ]);

    // Every audit name still resolves to the single runtime definition —
    // the report filters a VIEW over this one shared registry rather than
    // the audit bundle re-exporting, or the report computing from, a second
    // copy of it.
    expect(AUDIT_CONTRACTS).toBe(RULE_DETERMINISTIC_CAPABILITY_CONTRACTS);
    expect(AUDIT_BINDINGS).toBe(RULE_DETERMINISTIC_CAPABILITY_BINDINGS);
    expect(AUDIT_DISPOSITIONS).toBe(RULE_DETERMINISTIC_CAPABILITY_DISPOSITIONS);
  });
});
