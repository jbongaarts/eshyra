import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildMagicItemLegacyCapabilityBacklog,
  getBundledDnd5eSrdPack,
  type RulesPack,
  RulesPackError,
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
    expect(backlog.candidates).toHaveLength(798);
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

    // eshyra-o9bd.19.4.5.8 (faithful-or-absent): the goat-of-terror aura
    // effect moved to an adjudicated clause, so its engine-hook candidate left
    // the set (795 -> 794); review 19.4.5.9 S3 then withheld the Dimensional
    // Shackles restriction the same way (794 -> 793); eshyra-o9bd.19.4.6.2
    // withheld the Cloak of Displacement state machine (two independent
    // suppression lifetimes no single typed graph states), so its M5 engine-
    // hook candidate left the set (793 -> 792); eshyra-o9bd.19.4.6.4 withheld
    // the Necklace of Prayer Beads necklace-wide pool (the printed gate is per
    // magic bead), so its F5 candidate left the set (792 -> 791).
    // eshyra-o9bd.19.4.6.6 (non-effect triage): the 66 block-level candidates
    // of the withheld state machines (25), spellStore (17), rollManipulation
    // (14), containment (9) and the Orb of Dragonkind grant (1) left the set
    // (DM-adjudicated, no capability planned); the operations those blocks
    // used to block keep one operation-bound candidate each with the block's
    // hooks (+78) so no operation became executable, and the Efreeti Bottle
    // stopper cooldown added one economy candidate (791 -> 804). The three
    // stored-level spellStore cores (Ring of Spell Storing, Ioun Stone
    // Reserve, Rod of Absorption) keep their block candidates. No other
    // identity changed. eshyra-o9bd.19.4.6.8 (review 19.4.6.7 S2): the Staff of
    // Swarming Insects, Helm of Brilliance and Ring of Shooting Stars machines
    // (repeatable or independently-timed instances) are DM-adjudicated, so
    // their three block candidates left the set while three operation-bound
    // candidates keep the operations blocked and the typed insect-cloud and
    // ball-lightning effects add two (804 -> 806). eshyra-olc5.8 withholds
    // Ring of X-ray Vision's residual risk effect as an exact adjudicated
    // clause, removing its one engine-hook candidate (806 -> 805). Cloak of
    // the Bat's cast-polymorph operation adds one spell-linked castSpell
    // candidate from the spell record (+1); Rope of Entanglement's typed
    // restraint payload becomes an exact adjudicated clause (-1), net 805.
    // eshyra-olc5.11.4 removes Cube of Force spell-contact-loss as an item
    // operation: item_state_event cannot deduct its table-defined charge loss,
    // so the external condition has no operation-bound capability (-1).
    // eshyra-olc5.12.2 adds the Efreeti Bottle remove-stopper operation as one
    // operation-bound candidate that carries the landed paid-operation hook
    // (804 -> 805); the grant-anchored cooldown hook landed on two existing
    // economy clauses, which were already candidates. eshyra-olc5.15 adds the
    // Ring of Djinni Summoning's green stateMachine clause for its typed
    // djinni-dies transition (m4-lifecycle-ring-of-djinni-summoning), which
    // carries the landed external-event hook like the other green hook-backed
    // clauses (805 -> 806); the Ring's entityGrant clause was already a
    // candidate and keeps its identity. eshyra-xt6m.1.1 moves the Gem's F4
    // responsibility from the quantity clause to the exact castSpell effect
    // clause; its legacy candidate identity changes while the candidate set
    // remains 806 rows. eshyra-7f0h replaces the Apparatus of the Crab's 11
    // per-lever operation-bound candidates with the single move-levers one
    // (-10; its only hook is the landed paid-operation hook) and adds the
    // Candle of Invocation's lit/unlit state-machine clause (+1): 806 -> 797.
    // eshyra-7f0h.3 (review repair of S1): the Candle's cast-gate castSpell
    // effect carries one engine-pending F4 clause (c2-effect-cast-gate), a new
    // legacy engine-hook candidate (797 -> 798); no other identity changed.
    expect(fingerprint).toBe(
      'dc9e17141a25218951d8ba917369f4acadd7eb482db3acfddde50505157ba990',
    );
    expect(
      backlog.candidates.map(({ candidateId }) => candidateId),
    ).not.toContain('magic-item:dancing-sword/m5-complex-dancing-sword');
    expect(backlog.candidates.map(({ candidateId }) => candidateId)).toContain(
      'magic-item:dancing-sword/triage-stateMachine-op-launch-sword',
    );
    expect(
      backlog.candidates.map(({ candidateId }) => candidateId),
    ).not.toContain(
      'magic-item:cloak-of-displacement/m5-cloak-of-displacement',
    );
    expect(
      backlog.candidates.map(({ candidateId }) => candidateId),
    ).not.toContain(
      'magic-item:dimensional-shackles/c2-residual-dimensional-movement-block',
    );
    expect(
      backlog.candidates.map(({ candidateId }) => candidateId),
    ).not.toContain(
      'magic-item:figurine-of-wondrous-power/c2-residual-goat-terror-aura',
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

  function malformedPack(
    mutate: (clause: Record<string, unknown>) => Record<string, unknown>,
  ): RulesPack {
    const pack = getBundledDnd5eSrdPack();
    const record = pack.records.find(
      ({ key }) => key === 'magic-item:ammunition-1-2-or-3',
    );
    expect(record).toBeDefined();
    const data = record?.data as {
      executionReadiness: { clauses: Record<string, unknown>[] };
    };
    return {
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
                      ? mutate(clause)
                      : clause,
                  ),
                },
              },
            }
          : entry,
      ),
    };
  }

  it.each([
    [
      'an unknown readiness value',
      (clause: Record<string, unknown>) => ({
        ...clause,
        readiness: 'unrecognized',
      }),
    ],
    [
      'an unknown engine family',
      (clause: Record<string, unknown>) => ({
        ...clause,
        engineHooks: [
          ...(clause.engineHooks as Record<string, unknown>[]),
          { engine: 'F99', hook: 'unknown' },
        ],
      }),
    ],
    [
      'a duplicate engine hook',
      (clause: Record<string, unknown>) => ({
        ...clause,
        engineHooks: [
          ...(clause.engineHooks as Record<string, unknown>[]),
          (clause.engineHooks as Record<string, unknown>[])[0],
        ],
      }),
    ],
    [
      'a missing hook outside the declared engine hooks',
      (clause: Record<string, unknown>) => ({
        ...clause,
        missingHooks: [
          ...(clause.missingHooks as Record<string, unknown>[]),
          { engine: 'F1', hook: 'not-declared' },
        ],
      }),
    ],
    [
      'missing hooks paired with green readiness',
      (clause: Record<string, unknown>) => ({ ...clause, readiness: 'green' }),
    ],
  ])('fails closed on %s', (_label, mutate) => {
    const malformed = malformedPack(mutate);

    expect(() => buildMagicItemLegacyCapabilityBacklog(malformed)).toThrow(
      RulesPackError,
    );
  });
});
