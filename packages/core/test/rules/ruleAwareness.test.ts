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
  RULE_ADJUDICATION_CONTEXT,
  validateRuleAdjudicationContext,
} from '../../src/rules/ruleAdjudicationContext.js';
import {
  ruleAwareness,
  ruleStatements,
} from '../../src/rules/ruleAwareness.js';
import {
  RULE_KNOWN_LIMITS,
  validateRuleKnownLimits,
} from '../../src/rules/ruleKnownLimits.js';
import { resolveRulesStack } from '../../src/rules/stack.js';
import { RulesPackError } from '../../src/rules/types.js';

const stack = resolveRulesStack({ base: getBundledDnd5eSrdPack() });
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
  it('keeps the capability, adjudication, and limit channels independent (synthetic)', () => {
    // Synthetic representability evidence (design invariant 1): no real rule
    // is known to carry all three, and no binding is added to fake one.
    const key = 'rule:ability-checks';
    const context = {
      tools: ['lookup_rules'],
      dmContext: 'Synthetic context.',
    };
    const limit = {
      limit: 'partial' as const,
      statement: 'Synthetic limit.',
      findingId: 'readiness-integrity',
    };
    const bare = ruleAwareness(key, stack, manifestSource, {
      adjudicationContext: {},
      knownLimits: {},
    });
    const withContext = ruleAwareness(key, stack, manifestSource, {
      adjudicationContext: { [key]: context },
      knownLimits: {},
    });
    const withBoth = ruleAwareness(key, stack, manifestSource, {
      adjudicationContext: { [key]: context },
      knownLimits: { [key]: [limit] },
    });
    expect(withBoth.capabilities.outcome).toBe('bound');
    expect(withBoth.adjudicationContext).toEqual(context);
    expect(withBoth.knownLimits).toEqual([limit]);
    // Adding an entry to one channel changes nothing another returns.
    expect(withContext.capabilities).toEqual(bare.capabilities);
    expect(withContext.knownLimits).toEqual(bare.knownLimits);
    expect(withBoth.capabilities).toEqual(bare.capabilities);
    expect(withBoth.adjudicationContext).toEqual(
      withContext.adjudicationContext,
    );
    expect(withBoth.relationships).toEqual(bare.relationships);
    // A missing relationship manifest removes relationships only.
    const noManifest = ruleAwareness(key, stack, () => undefined, {
      adjudicationContext: { [key]: context },
      knownLimits: { [key]: [limit] },
    });
    expect(noManifest.relationshipArtifact.state).toBe('absent');
    expect(noManifest.relationships).toEqual([]);
    expect(noManifest.capabilities).toEqual(withBoth.capabilities);
    expect(noManifest.adjudicationContext).toEqual(context);
    expect(noManifest.knownLimits).toEqual([limit]);
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
    expect(lair.adjudicationContext).toBeUndefined();
    expect(lair.knownLimits).toEqual([]);
  });

  it('carries adjudication context and known limits into the discovery packet (probes P1/P2)', () => {
    for (const key of ['rule:cover', 'rule:opportunity-attacks']) {
      const candidate = packetCandidateFor(key);
      expect(candidate?.ruleAdjudicationContext).toEqual(
        ruleStatements(key).adjudicationContext,
      );
    }
    expect(
      packetCandidateFor('rule:cover')?.ruleAdjudicationContext?.tools,
    ).toContain('resolve_check');
    expect(
      packetCandidateFor('rule:opportunity-attacks')?.ruleAdjudicationContext
        ?.tools,
    ).toContain('spend_turn_resource');
    expect(packetCandidateFor('rule:suffocating')?.ruleKnownLimits).toEqual(
      ruleStatements('rule:suffocating').knownLimits,
    );
    const lair = packetCandidateFor('rule:a-legendary-creatures-lair');
    expect(lair?.ruleAdjudicationContext).toBeUndefined();
    expect(lair?.ruleKnownLimits).toBeUndefined();
  });

  it('renders the statement channels into the model-facing packet message only when present', () => {
    const cover = renderedFor('rule:cover');
    expect(cover).toContain('### Eshyra adjudication context');
    expect(cover).toContain('- tools: lookup_rules, resolve_check');
    expect(cover).toContain('not rules text');
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
    expect(lair).not.toContain('### Eshyra adjudication context');
    expect(lair).not.toContain('### Eshyra known limits');
  });

  it('routes creature conditions to the correct target domain', () => {
    for (const key of [
      'rule:being-prone',
      'rule:falling',
      'rule:grappling',
      'rule:shoving-a-creature',
    ]) {
      const context = ruleStatements(key).adjudicationContext;
      expect(context?.tools).toEqual(
        expect.arrayContaining(['add_condition', 'update_combatant']),
      );
      expect(context?.dmContext).toContain('character');
      expect(context?.dmContext).toContain('encounter combatant');
      expect(context?.dmContext).toContain('update_combatant');
      expect(context?.dmContext).toContain('addCondition {id:');
    }
    const prone = ruleStatements('rule:being-prone').adjudicationContext;
    expect(prone?.tools).toContain('remove_condition');
    expect(prone?.dmContext).toContain('removeCondition "prone"');
    // Sibling class: HP writes. adjust_hp and stabilize_character address
    // characters; encounter combatants take HP through update_combatant.
    for (const key of ['rule:knocking-a-creature-out']) {
      const context = ruleStatements(key).adjudicationContext;
      expect(context?.tools).toEqual(
        expect.arrayContaining(['adjust_hp', 'update_combatant']),
      );
      expect(context?.dmContext).toContain('encounter combatant');
      expect(context?.dmContext).toContain('update_combatant with hpDelta');
    }
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

  it('does not map graded exhaustion onto add_condition', () => {
    // domainMutations.ts addCondition no-ops on an existing id, and rest.ts
    // applyExhaustion requires {id:'exhaustion', level:1..6}; SRD food, water,
    // and forced march each impose (further) exhaustion levels.
    for (const key of ['rule:food', 'rule:water', 'rule:speed']) {
      const statements = ruleStatements(key);
      expect(statements.adjudicationContext?.tools).not.toContain(
        'add_condition',
      );
      expect(statements.adjudicationContext?.dmContext).not.toContain(
        'add_condition',
      );
      const [limit] = statements.knownLimits;
      expect(limit?.findingId).toBe('readiness-integrity');
      expect(limit?.statement).toContain('level: 1');
      // The increment is disclosed as unpersistable; canonical state is never
      // delegated to the DM (ADR 0020 §2).
      expect(limit?.statement).toContain('cannot currently be persisted');
      expect(limit?.statement).not.toMatch(/DM tracks/);
    }
  });

  it('maps rules by their source procedure, not their name', () => {
    // rule:hit-points is the monster HP-construction passage (Hit Dice by
    // size, Constitution modifier x Hit Dice), which no exposed tool carries;
    // it must not map to live HP mutation (adjust_hp / update_combatant).
    expect(
      ruleStatements('rule:hit-points').adjudicationContext,
    ).toBeUndefined();
    // rule:interacting-with-objects is the environment passage (a GM-set DC
    // Strength check to force a lever), not combat's free object interaction.
    const objects = ruleStatements(
      'rule:interacting-with-objects',
    ).adjudicationContext;
    expect(objects?.tools).not.toContain('spend_turn_resource');
    expect(objects?.dmContext).toMatch(
      /resolve_check with kind ability_check and vs/,
    );
  });

  it('keeps each mapping to the source procedure and the tool contract', () => {
    const ctx = (key: string) => ruleStatements(key).adjudicationContext;
    // Cover: resolve_check modifiers apply to the roller; vs is a bare AC/DC.
    expect(ctx('rule:cover')?.dmContext).toContain("AC in resolve_check's vs");
    expect(ctx('rule:cover')?.dmContext).not.toMatch(/modifier to AC/);
    // Readying a spell casts it (slot spent) at Ready time.
    expect(ctx('action:ready')?.tools).toContain('spend_spell_slot');
    expect(ctx('action:ready')?.dmContext).toContain('spellRef');
    // Grapple escape/release removes the condition on both target domains.
    expect(ctx('rule:grappling')?.dmContext).toMatch(
      /remove_condition or update_combatant removeCondition "grappled"/,
    );
    // Initiative is rolled between surprise and turns.
    expect(ctx('rule:combat-step-by-step')?.tools).toContain('resolve_check');
    // Damage only on a hit that deals damage; two-weapon damage modifier rule.
    expect(ctx('rule:making-an-attack')?.dmContext).toContain(
      'on a hit that deals damage',
    );
    expect(ctx('rule:two-weapon-fighting')?.dmContext).toContain(
      'omit the ability modifier unless it is negative',
    );
    // Knockout: the character path holds only while the target is dying;
    // instant death from massive damage is a disclosed trap.
    expect(ctx('rule:knocking-a-creature-out')?.dmContext).toContain(
      'if it leaves the character dying',
    );
    expect(
      ruleStatements('rule:knocking-a-creature-out').knownLimits[0]?.statement,
    ).toContain('instant death');
    // Water: two levels at once when exhaustion already exists.
    expect(ruleStatements('rule:water').knownLimits[0]?.statement).toContain(
      'two levels at once',
    );
    // Charges follow the reset_usage/needsRolledRestore/restore_usage contract.
    expect(ctx('rule:charges')?.tools).toContain('roll');
    expect(ctx('rule:charges')?.dmContext).toContain('needsRolledRestore');
    // A readied spell ends existing concentration; its own is a disclosed trap.
    expect(ctx('action:ready')?.dmContext).toContain(
      'When a character readies',
    );
    expect(ctx('action:ready')?.tools).toContain('end_effect');
    expect(ruleStatements('action:ready').knownLimits[0]?.statement).toContain(
      'not a tracked effect',
    );
    // Shove, like grapple, replaces an attack of the Attack action.
    expect(ctx('rule:shoving-a-creature')?.tools).toContain(
      'spend_turn_resource',
    );
    // Critical hits double damage dice through resolve_damage.
    expect(ctx('rule:rolling-1-or-20')?.dmContext).toContain('critical: true');
    // Ammunition stays recoverable (dropped, then claim_item for half).
    const ammo = ruleStatements('rule:weapon-properties').knownLimits[0];
    expect(ammo?.statement).toContain('disposition dropped');
    expect(ammo?.statement).toContain('claim_item');
  });

  it('uses the retained hiding check total for later searches', () => {
    // SRD rule:hiding: "Until you are discovered or you stop hiding, that
    // check’s total is contested" by an active searcher's Perception check.
    const context = ruleStatements('rule:hiding').adjudicationContext;
    expect(context?.tools).toEqual(['lookup_rules', 'resolve_check', 'calc']);
    expect(context?.tools).not.toContain('resolve_contest');
    expect(context?.dmContext).toContain('retain its total');
    expect(context?.dmContext).toMatch(
      /resolve_check.*vs set to that retained Stealth total/,
    );
    expect(context?.dmContext).toContain('passive_score');
  });

  it('validates tool and finding identities in its authored datasets', () => {
    expect(
      validateRuleAdjudicationContext(
        new Set(DEFAULT_TOOLS.map((tool) => tool.name)),
      ),
    ).toEqual([]);
    expect(validateRuleKnownLimits()).toEqual([]);
    expect(RULE_ADJUDICATION_CONTEXT['rule:cover']?.tools).toContain(
      'resolve_check',
    );
    expect(RULE_KNOWN_LIMITS['rule:suffocating']?.[0]?.findingId).toBe(
      'readiness-integrity',
    );
  });
});
