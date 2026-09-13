import { describe, expect, it } from 'vitest';
import {
  RULE_DETERMINISTIC_CAPABILITY_BINDINGS as AUDIT_BINDINGS,
  RULE_DETERMINISTIC_CAPABILITY_CONTRACTS as AUDIT_CONTRACTS,
  RULE_DETERMINISTIC_CAPABILITY_DISPOSITIONS as AUDIT_DISPOSITIONS,
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
        { x: contract },
        [{ ruleKey: 'same', capability: 'x' }],
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

  it('keeps the owner preflight authoritative over a ledger declaration', () => {
    // `capabilities()` in packet.ts returns the ledger declaration only when
    // the candidate has no capability-preflight routes of its own, because an
    // `available`/`blocked` preflight is the capability owner's subject-
    // specific observation and a binding declares identity and limits only.
    //
    // That branch is latent TODAY, and this pins exactly why: no magic-item
    // key is bound, so no candidate can currently reach the packet with both.
    // If a magic-item binding is ever added this fails, and whoever adds it
    // has to look at the precedence branch rather than discover later that a
    // real preflight was silently replaced by a weaker declaration. The guard
    // is the honest claim available here: the interaction itself has no
    // executable case until such a binding exists.
    const boundKeys = RULE_DETERMINISTIC_CAPABILITY_BINDINGS.map(
      ({ ruleKey }) => ruleKey,
    );
    expect(boundKeys.filter((key) => key.startsWith('magic-item:'))).toEqual(
      [],
    );
    // And the record kind that DOES carry preflights keeps them (R6 asserts
    // the statuses); this states the membership fact R6 depends on.
    expect(boundKeys.every((key) => key.startsWith('rule:'))).toBe(true);
  });

  it('R7 pins the exact ledger membership the audit bundle now re-exports', () => {
    // After the move the audit bundle re-exports these very objects, so
    // comparing the two names asserts a tautology and can never fail. The
    // checkable claim is the MEMBERSHIP ITSELF, pinned as literals: if a row
    // is added, dropped or re-keyed, this fails and a reviewer has to say so
    // deliberately. The audit bundle is still exercised, through the aliased
    // import proving the re-export resolves to the one definition.
    expect(Object.keys(AUDIT_CONTRACTS).sort()).toEqual([
      'derived-magic-item-clauses-v1',
      'resolve-check-v1',
      'resolve-concentration-v1',
      'resolve-spell-upcast-v1',
    ]);
    expect(
      [...AUDIT_BINDINGS].map(({ ruleKey, capability }) => [
        ruleKey,
        capability,
      ]),
    ).toEqual([
      ['rule:ability-checks', 'resolve-check-v1'],
      ['rule:advantage-and-disadvantage', 'resolve-check-v1'],
      ['rule:attack-rolls', 'resolve-check-v1'],
      ['rule:modifiers-to-the-roll', 'resolve-check-v1'],
      ['rule:proficiency-bonus', 'resolve-check-v1'],
      ['rule:saving-throws', 'resolve-check-v1'],
      ['rule:concentration', 'resolve-concentration-v1'],
      ['rule:casting-a-spell-at-a-higher-level', 'resolve-spell-upcast-v1'],
    ]);
    expect(Object.keys(AUDIT_DISPOSITIONS).sort()).toEqual([
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
    ]);
    // Every audit name resolves to the single runtime definition.
    expect(AUDIT_CONTRACTS).toBe(RULE_DETERMINISTIC_CAPABILITY_CONTRACTS);
    expect(AUDIT_BINDINGS).toBe(RULE_DETERMINISTIC_CAPABILITY_BINDINGS);
    expect(AUDIT_DISPOSITIONS).toBe(RULE_DETERMINISTIC_CAPABILITY_DISPOSITIONS);
  });
});
