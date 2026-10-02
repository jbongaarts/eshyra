import { findingByCanonicalId } from './findingRegistry.js';

/**
 * A blocking engine-capability gap (design A5): a governing clause requires an
 * engine-owned step (ADR 0020 §3) that no registered tool performs. A known
 * limit only discloses the gap; it never satisfies or retires it. Each gap is
 * owned by an open bead that blocks the owning rules work
 * (`eshyra-o9bd.19.3.4`) until the capability lands or accepted authority
 * changes the requirement.
 */
export interface EngineCapabilityGap {
  /** The missing deterministic operation, stated as Eshyra's gap. */
  readonly operation: string;
  /** The open bead that owns the missing capability. */
  readonly ownerBead: string;
  readonly findingId: 'engine-capability-ownership';
}

export const ENGINE_CAPABILITY_GAPS = Object.freeze({
  'retained-check-total-resolution': Object.freeze({
    operation:
      'Resolve a retained d20 check total against a later opposing check (tie leaves the situation unchanged) and against passive scores.',
    ownerBead: 'eshyra-o9bd.19.5.10.3',
    findingId: 'engine-capability-ownership' as const,
  }),
  'graded-exhaustion-increase': Object.freeze({
    operation:
      'Raise an existing exhaustion level by a source-declared number of levels, atomically.',
    ownerBead: 'eshyra-o9bd.19.5.7.3',
    findingId: 'engine-capability-ownership' as const,
  }),
  'nonlethal-knockout': Object.freeze({
    operation:
      'Apply a melee knockout to a character as unconscious and stable in one step, including when the damage would otherwise kill outright.',
    ownerBead: 'eshyra-o9bd.19.5.7.6',
    findingId: 'engine-capability-ownership' as const,
  }),
  'ammunition-recovery-count': Object.freeze({
    operation:
      'Determine and apply the recoverable half of a character’s expended ammunition after a battle.',
    ownerBead: 'eshyra-o9bd.19.5.11.4',
    findingId: 'engine-capability-ownership' as const,
  }),
} satisfies Record<string, EngineCapabilityGap>);

export type EngineCapabilityGapId = keyof typeof ENGINE_CAPABILITY_GAPS;

export interface RuleKnownLimit {
  readonly limit: 'partial' | 'unimplemented' | 'deferred';
  readonly statement: string;
  readonly findingId: string;
  /**
   * Registered tools that participate in the affected clause (invariant 12).
   * Required for every non-deferred limit; read-only resolution tools
   * qualify, and no state-writing tool is required.
   */
  readonly participants?: readonly string[];
  /** Blocking engine-capability gaps the limit discloses (design A5). */
  readonly capabilityGaps?: readonly EngineCapabilityGapId[];
  /** Historical design-decision bead, kept as history, never as identity. */
  readonly designOwner?: string;
  readonly externalClauses?: readonly {
    readonly clause: string;
    readonly findingId: string;
    /** Historical owning bead; history only. `findingId` is the identity. */
    readonly bead: string;
  }[];
}

function exhaustionLevelLimit(
  cause: string,
  sourceSpecific = '',
): RuleKnownLimit {
  return Object.freeze({
    limit: 'partial' as const,
    participants: Object.freeze(['add_condition']),
    capabilityGaps: Object.freeze(['graded-exhaustion-increase' as const]),
    statement: `Exhaustion from ${cause} is graded. add_condition can record it only for a character with no exhaustion yet, and must then pass {id: "exhaustion", level: 1}, because long-rest recovery requires a level from 1 to 6. add_condition ignores an exhaustion condition the character already has, and no exposed tool raises an existing exhaustion level, so a further level from this rule cannot currently be persisted.${sourceSpecific}`,
    findingId: 'readiness-integrity',
  });
}

/** Source-grounded limits re-derived against current runtime behavior under R0. */
export const RULE_KNOWN_LIMITS: Readonly<
  Record<string, readonly RuleKnownLimit[]>
> = Object.freeze({
  // R0 confirmed: ADR 0018 §6 and closed bead eshyra-2n1t.1 defer class-feature grants obtained by gaining another class. Source clause: 'When you gain a new level in a class, you get its features for that level.'
  'rule:class-features': Object.freeze([
    Object.freeze({
      limit: 'deferred',
      statement:
        'Eshyra’s single-class character boundary under ADR 0018 leaves class-feature grants from a second class deferred. A character combining classes is refused, and the DM does not adjudicate those additional feature grants from this prose.',
      findingId: 'engine-capability-ownership',
      designOwner: 'eshyra-2n1t.1',
    }),
  ]),
  // R0 rewritten: packages/core/src/state/activeEffects.ts addEffect tracks the charm duration, but packages/core/src/orchestrator/toolAdjustHp.ts adjustHpTool cannot trigger the source repeat save when the charmed creature takes damage.
  'rule:conflict': Object.freeze([
    Object.freeze({
      participants: Object.freeze(['adjust_hp', 'resolve_check', 'end_effect']),
      limit: 'partial',
      statement:
        'Damage to a creature charmed by a sentient item permits another saving throw, but adjust_hp does not trigger that save from the tracked effect. After applying damage, resolve the repeat save with resolve_check and, if it succeeds, end the charm with end_effect.',
      findingId: 'readiness-integrity',
    }),
  ]),
  // R0 confirmed: this source example explicitly combines cleric 6/fighter 1 for XP; ADR 0018 §6 and closed bead eshyra-2n1t.1 defer total-level XP across classes.
  'rule:experience-points': Object.freeze([
    Object.freeze({
      limit: 'deferred',
      statement:
        'Eshyra’s single-class progression under ADR 0018 does not apply XP thresholds to levels split between classes. A character combining classes is refused, and the DM does not adjudicate that total-level XP example.',
      findingId: 'engine-capability-ownership',
      designOwner: 'eshyra-2n1t.1',
    }),
  ]),
  // R0 confirmed: ADR 0018 §6 and closed bead eshyra-2n1t.1 defer combining Extra Attack grants from different classes. Source clause: 'If you gain the Extra Attack class feature from more than one class, the features don’t add together.'
  'rule:extra-attack': Object.freeze([
    Object.freeze({
      limit: 'deferred',
      statement:
        'Eshyra’s single-class combat progression under ADR 0018 leaves the Extra Attack combination from multiple classes deferred. A character combining classes is refused, and the DM does not adjudicate the combined attack count from this prose.',
      findingId: 'engine-capability-ownership',
      designOwner: 'eshyra-2n1t.1',
    }),
  ]),
  // R0 confirmed: ADR 0018 §6 and closed bead eshyra-2n1t.1 defer mixed-class Hit Dice and hit-point progression. Source clause: 'You gain the hit points from your new class as described for levels after 1st.'
  'rule:hit-points-and-hit-dice': Object.freeze([
    Object.freeze({
      limit: 'deferred',
      statement:
        'Eshyra’s single-class progression under ADR 0018 leaves mixed-class hit points and Hit Dice deferred. A character combining classes is refused, and the DM does not adjudicate the mixed progression from this prose.',
      findingId: 'engine-capability-ownership',
      designOwner: 'eshyra-2n1t.1',
    }),
  ]),
  // R0 confirmed: ADR 0018 §6 and closed bead eshyra-2n1t.1 defer additional-class choice, prerequisites, and progression. Source clause: 'Multiclassing allows you to gain levels in multiple classes.'
  'rule:multiclassing': Object.freeze([
    Object.freeze({
      limit: 'deferred',
      statement:
        'Eshyra’s build boundary under ADR 0018 supports one class, so the additional-class choice and its prerequisites remain deferred. A character combining classes is refused, and the DM does not adjudicate additional-class advancement from this prose.',
      findingId: 'engine-capability-ownership',
      designOwner: 'eshyra-2n1t.1',
    }),
  ]),
  // R0 confirmed: ADR 0018 §6 and closed bead eshyra-2n1t.1 defer proficiency bonus across multiple class levels. Source clause: 'Your proficiency bonus is always based on your total character level, as shown in the Character Advancement table, not your level in a'
  'rule:multiclassing-proficiency-bonus': Object.freeze([
    Object.freeze({
      limit: 'deferred',
      statement:
        'Eshyra’s one-class level model under ADR 0018 leaves proficiency bonus across several class levels deferred. A character combining classes is refused, and the DM does not adjudicate a bonus from split class levels.',
      findingId: 'engine-capability-ownership',
      designOwner: 'eshyra-2n1t.1',
    }),
  ]),
  // R0 rewritten: packages/core/src/orchestrator/toolSpendTurnResource.ts spendTurnResourceTool charges an Attack action without checking the source net clause limiting that action to one attack; toolResolveCheck.ts resolveCheckTool resolves each attack independently.
  'rule:special-weapons': Object.freeze([
    Object.freeze({
      participants: Object.freeze(['spend_turn_resource', 'resolve_check']),
      limit: 'partial',
      statement:
        'A net attack limits the Attack action to one attack, but spend_turn_resource does not enforce that limit. Make only one net attack with resolve_check even if a feature grants additional attacks.',
      findingId: 'readiness-integrity',
    }),
  ]),
  // R0 confirmed: ADR 0018 §6 and closed bead eshyra-2n1t.1 defer combined multiclass spell slots and class-associated casting. Source clause: 'Your capacity for spellcasting depends partly on your combined levels in all your spellcasting classes and partly on your individual le'
  'rule:spellcasting': Object.freeze([
    Object.freeze({
      limit: 'deferred',
      statement:
        'Eshyra’s single-class spellcasting under ADR 0018 leaves combined slots and class-associated spells deferred. A character combining classes is refused, and the DM does not adjudicate multiclass spellcasting from this prose.',
      findingId: 'engine-capability-ownership',
      designOwner: 'eshyra-2n1t.1',
    }),
  ]),
  // R0 confirmed: the source limits this rule to characters who gain the feature from a second class; ADR 0018 §6 and closed bead eshyra-2n1t.1 defer it.
  'rule:channel-divinity': Object.freeze([
    Object.freeze({
      limit: 'deferred',
      statement:
        'Eshyra supports single-class characters only under ADR 0018. A character with more than one class is refused, so this multiclass Channel Divinity interaction is deliberately unsupported and is not adjudicated.',
      findingId: 'engine-capability-ownership',
      designOwner: 'eshyra-2n1t.1',
    }),
  ]),
  // R0 re-derived after combatant death lifecycle landed.
  'rule:suffocating': Object.freeze([
    Object.freeze({
      participants: Object.freeze([
        'set_suffocation',
        'calc',
        'update_combatant',
      ]),
      limit: 'partial',
      statement:
        'For a character whose breath runs out, apply set_suffocation with event drop at the start of its turn, then record event breathe when it can breathe again; derive the durations with calc breath_hold_duration and suffocation_survival_rounds. For an encounter combatant, opt into player-character death rules with update_combatant deathRules, then use set_suffocation with event drop and event breathe.',
      findingId: 'readiness-integrity',
    }),
  ]),
  // R0 new trap (review @5e2b74ad): the source keeps the hider's Stealth
  // total and contests it against a later active search (a tie leaves the
  // hider hidden) and compares it with passive Perception. toolResolveContest.ts
  // rolls both sides; resolution.ts resolveD20 resolves `total >= vs` with vs
  // limited to 1..99; calc passive_score computes the score but compares
  // nothing. No tool performs either comparison.
  'rule:hiding': Object.freeze([
    Object.freeze({
      participants: Object.freeze(['resolve_contest', 'resolve_check', 'calc']),
      capabilityGaps: Object.freeze([
        'retained-check-total-resolution' as const,
      ]),
      limit: 'partial' as const,
      statement:
        'No tool resolves a search against a hider’s retained Stealth total: resolve_contest rolls both sides, so it would reroll the hider, and resolve_check counts a total equal to vs as success and accepts vs only from 1 to 99, while this rule leaves the hider hidden on a tie. No tool compares a passive Perception score from calc passive_score with that total either. These comparisons cannot currently be resolved deterministically.',
      findingId: 'readiness-integrity',
    }),
  ]),
  // A5 (user decision 2026-10-01): set_surprised previously left the
  // Stealth-vs-passive-Perception comparison to the DM. The comparison is the
  // retained-total resolution gap (one Stealth total per hider against each
  // observer's passive score); calc passive_score computes a score and
  // compares nothing, and set_surprised (toolSetSurprised.ts) only records.
  'rule:surprise': Object.freeze([
    Object.freeze({
      participants: Object.freeze(['calc', 'set_surprised']),
      capabilityGaps: Object.freeze([
        'retained-check-total-resolution' as const,
      ]),
      limit: 'partial' as const,
      statement:
        'Deciding who is surprised needs each hider’s Stealth total compared with each observer’s passive Perception score. calc passive_score computes a score but compares nothing, and set_surprised only records an outcome, so who is surprised cannot currently be determined deterministically.',
      findingId: 'readiness-integrity',
    }),
  ]),
  // R0 new trap (second pass), rewritten under A5: casting does not track the
  // held energy, so toolAdjustHp.ts / toolUpdateCombatant.ts report no
  // concentration save for it. activeEffects.ts EFFECT_KIND_PROFILES lets a
  // 'spell-effect' come from source kind 'ruling' and declare concentration
  // (no spell-record binding), so the held energy can be tracked; damage then
  // reports the save (activeEffects.test.ts 'update_combatant concentration
  // wiring') and toolResolveConcentration.ts resolves it. Bounded, not a gap.
  'action:ready': Object.freeze([
    Object.freeze({
      participants: Object.freeze([
        'start_effect',
        'adjust_hp',
        'update_combatant',
        'resolve_concentration',
        'end_effect',
      ]),
      limit: 'partial' as const,
      statement:
        'Casting a readied spell does not track the concentration that holds its energy, so until it is tracked adjust_hp and update_combatant report no concentration save for it. Track the held energy with start_effect as a spell-effect from source kind ruling, with the caster as concentrationOwner, lasting until the spell is released or the readied action lapses; adjust_hp or update_combatant then reports the save when the caster takes damage, resolve_concentration resolves it, and a failed save ends the effect, so the spell dissipates. When the spell is released, end the effect with end_effect.',
      findingId: 'readiness-integrity',
    }),
  ]),
  // R0 new trap (Sol review F3): hpLifecycle.ts applyDamage turns overflow
  // >= hp_max into instant death and toolAdjustHp.ts has no nonlethal option;
  // hpLifecycle.ts stabilizeCharacter refuses any state but dying.
  'rule:knocking-a-creature-out': Object.freeze([
    Object.freeze({
      participants: Object.freeze(['adjust_hp', 'stabilize_character']),
      capabilityGaps: Object.freeze(['nonlethal-knockout' as const]),
      limit: 'partial' as const,
      statement:
        'adjust_hp applies instant death when damage beyond 0 hit points equals or exceeds the character’s hit point maximum, even when the attacker chooses to knock the character out, and stabilize_character stabilizes only a dying character. A nonlethal knockout of a character killed outright by that damage cannot currently be recorded.',
      findingId: 'readiness-integrity',
    }),
  ]),
  // R0 rewritten (graded exhaustion): add_condition no-ops on an existing id;
  // rest.ts requires {id:'exhaustion', level:1..6}. A further level cannot be
  // persisted. Shared by the food, water, and forced-march procedures.
  'rule:food': Object.freeze([exhaustionLevelLimit('lack of food')]),
  'rule:water': Object.freeze([
    exhaustionLevelLimit(
      'inadequate water',
      ' When the character already has exhaustion, this rule imposes two levels at once, and neither can currently be persisted.',
    ),
  ]),
  'rule:speed': Object.freeze([exhaustionLevelLimit('a forced march')]),
  // R0 confirmed: the source says an Unarmored Defense feature from a second class is not gained; ADR 0018 §6 and closed bead eshyra-2n1t.1 defer the interaction.
  'rule:unarmored-defense': Object.freeze([
    Object.freeze({
      limit: 'deferred',
      statement:
        'Eshyra’s single-class feature model under ADR 0018 leaves the interaction between multiple Unarmored Defense grants deferred. A character combining classes is refused, and the DM does not adjudicate which AC formula applies from this prose.',
      findingId: 'engine-capability-ownership',
      designOwner: 'eshyra-2n1t.1',
    }),
  ]),
  // R0 rewritten: packages/core/src/orchestrator/toolResolveCheck.ts resolveCheckTool resolves ranged attacks without the source ammunition expenditure; packages/core/src/orchestrator/toolRemoveItem.ts removeItemTool requires an explicit inventory mutation.
  'rule:weapon-properties': Object.freeze([
    Object.freeze({
      participants: Object.freeze([
        'resolve_check',
        'remove_item',
        'claim_item',
      ]),
      capabilityGaps: Object.freeze(['ammunition-recovery-count' as const]),
      limit: 'partial',
      statement:
        'resolve_check does not spend ammunition for an attack with the ammunition property. For a character, spend one piece after each such attack with remove_item and disposition dropped, which keeps expended ammunition as claimable rows at the battle location; after the battle, claim_item claims whole rows, but no tool determines how many of the expended pieces are recoverable, so that recovery cannot currently be applied. Apply the loading restriction before another attack with that weapon.',
      findingId: 'readiness-integrity',
    }),
  ]),
});

export function validateRuleKnownLimits(
  registeredToolNames: ReadonlySet<string>,
  entries: Readonly<
    Record<string, readonly RuleKnownLimit[]>
  > = RULE_KNOWN_LIMITS,
  gaps: Readonly<Record<string, EngineCapabilityGap>> = ENGINE_CAPABILITY_GAPS,
): readonly string[] {
  const errors: string[] = [];
  const referencedGaps = new Set<string>();
  for (const [key, limits] of Object.entries(entries))
    for (const limit of limits) {
      if (findingByCanonicalId(limit.findingId) === undefined)
        errors.push(`${key}: unknown findingId '${limit.findingId}'`);
      for (const clause of limit.externalClauses ?? [])
        if (findingByCanonicalId(clause.findingId) === undefined)
          errors.push(
            `${key}: unknown external findingId '${clause.findingId}'`,
          );
      // Invariant 12: a trap limit identifies the tools participating in the
      // affected clause, by registered name, in its own statement. Read-only
      // resolution tools qualify; no state writer is required. A deferred
      // limit is the ADR 0018 scope boundary and names none.
      const participants = limit.participants ?? [];
      if (limit.limit !== 'deferred' && participants.length === 0)
        errors.push(`${key}: ${limit.limit} known limit names no participant`);
      for (const tool of participants) {
        if (!registeredToolNames.has(tool))
          errors.push(`${key}: participant '${tool}' is not a registered tool`);
        if (!limit.statement.includes(tool))
          errors.push(`${key}: statement does not name participant '${tool}'`);
      }
      // A5: a blocking gap is owned, never discharged by its disclosure. An
      // ADR 0018 deferral is accepted authority narrowing the requirement,
      // not a gap.
      for (const gapId of limit.capabilityGaps ?? []) {
        referencedGaps.add(gapId);
        if (limit.limit === 'deferred')
          errors.push(
            `${key}: a deferred limit cannot carry capability gap '${gapId}'`,
          );
        if (gaps[gapId] === undefined)
          errors.push(`${key}: unknown capability gap '${gapId}'`);
      }
    }
  for (const [gapId, gap] of Object.entries(gaps)) {
    if (!referencedGaps.has(gapId))
      errors.push(`capability gap '${gapId}' is disclosed by no known limit`);
    if (!/^eshyra-[a-z0-9]+(\.[0-9]+)*$/.test(gap.ownerBead))
      errors.push(
        `capability gap '${gapId}': ownerBead '${gap.ownerBead}' is not a bead id`,
      );
    if (findingByCanonicalId(gap.findingId) === undefined)
      errors.push(
        `capability gap '${gapId}': unknown findingId '${gap.findingId}'`,
      );
    if (gap.operation.trim() === '')
      errors.push(`capability gap '${gapId}': operation is empty`);
  }
  return errors;
}
