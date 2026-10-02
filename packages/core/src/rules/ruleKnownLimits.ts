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

export const ENGINE_CAPABILITY_GAPS: Readonly<
  Record<string, EngineCapabilityGap>
> = Object.freeze({});

export type EngineCapabilityGapId = string;

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
        'adjust_hp',
        'update_combatant',
      ]),
      limit: 'partial',
      statement:
        'Applying the suffocation drop to 0 hit points as damage through adjust_hp or update_combatant does not block healing or stabilization, so record the drop and the later breathing with set_suffocation instead. The drop comes at the start of the creature’s next turn after the survival interval from calc suffocation_survival_rounds expires, not when its breath runs out.',
      findingId: 'readiness-integrity',
    }),
  ]),
  // R0 re-derived after retained-check resolution landed in
  // eshyra-o9bd.19.5.10.3. resolve_contest and resolve_check remain traps for
  // a fixed retained total; use the retained-check tools instead.
  'rule:hiding': Object.freeze([
    Object.freeze({
      participants: Object.freeze([
        'resolve_contest',
        'resolve_check',
        'roll_retained_check',
        'resolve_retained_check',
      ]),
      limit: 'partial' as const,
      statement:
        'Record the hider’s check with roll_retained_check and compare later searches or passive scores with resolve_retained_check. resolve_contest always rolls both sides, and resolve_check treats a tie as success, so neither resolves a retained Stealth total under this rule’s tie semantics. The DM decides whether hiding applies and which creatures search or observe.',
      findingId: 'readiness-integrity',
    }),
  ]),
  // R0 re-derived after the deterministic retained-check path landed.
  'rule:surprise': Object.freeze([
    Object.freeze({
      participants: Object.freeze([
        'roll_retained_check',
        'resolve_retained_check',
        'set_surprised',
      ]),
      limit: 'partial' as const,
      statement:
        'A hider’s Stealth check is retained with roll_retained_check. resolve_check and resolve_contest cannot determine surprise: each roll compares one check against one target, and a fresh roll replaces a hider’s retained check. Surprise is determined only from passive comparisons recorded by resolve_retained_check and passed to set_surprised.',
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
  // R0 re-derived after eshyra-o9bd.19.5.7.6: adjust_hp can choose the
  // nonlethal state atomically with the damage; a later stabilize call cannot
  // undo an instant death already recorded.
  'rule:knocking-a-creature-out': Object.freeze([
    Object.freeze({
      participants: Object.freeze(['adjust_hp', 'stabilize_character']),
      limit: 'partial' as const,
      statement:
        'When the attacker chooses to knock a character out, pass knockOut=true to adjust_hp with the damage as it is dealt; a later stabilize_character call cannot undo an instant death already recorded.',
      findingId: 'readiness-integrity',
    }),
  ]),
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
  // R0 rewritten: resolve_check leaves expenditure to expend_ammunition and recovery to recover_ammunition; both are deterministic character inventory operations.
  'rule:weapon-properties': Object.freeze([
    Object.freeze({
      participants: Object.freeze([
        'resolve_check',
        'expend_ammunition',
        'recover_ammunition',
      ]),
      limit: 'partial',
      statement:
        'resolve_check does not spend ammunition for an attack with the ammunition property. For a character, spend one piece with expend_ammunition after each attack with an ammunition weapon. After the battle, recover_ammunition returns half the expended ammunition, rounded down, limited to what is still at the battlefield; it destroys the remaining present pieces and reports unavailable pieces. Apply the loading restriction before another attack with that weapon.',
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
