export interface RuleAdjudicationContext {
  readonly tools: readonly string[];
  readonly dmContext: string;
  /** Audit projection fields share this object so the audit has one owner. */
  readonly status: 'model-adjudicated-supported';
  readonly primitives: readonly string[];
  readonly contextRequirement: string;
}

/** Runtime-owned guidance for the bounded slice; these are not rules text. */
export const RULE_ADJUDICATION_CONTEXT: Readonly<
  Record<string, RuleAdjudicationContext>
> = Object.freeze({
  // R0 confirmed: cover remains a DM degree-of-cover judgment; declared
  // modifiers are applied through resolve_check.
  'rule:cover': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'resolve_check']),
    dmContext:
      'The DM chooses the degree of cover. Pass the +2 or +5 AC and Dexterity saving throw bonuses as declared modifiers to resolve_check. Total cover means the target cannot be targeted directly.',
    status: 'model-adjudicated-supported',
    primitives: Object.freeze(['lookup_rules', 'resolve_check']),
    contextRequirement:
      'The DM chooses the degree of cover. Pass the +2 or +5 AC and Dexterity saving throw bonuses as declared modifiers to resolve_check. Total cover means the target cannot be targeted directly.',
  }),
  // R0 confirmed: trigger and exclusions are adjudicated; the reaction spend
  // is recorded through spend_turn_resource.
  'rule:opportunity-attacks': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'roll', 'spend_turn_resource']),
    dmContext:
      'The DM rules whether movement triggers an opportunity attack and applies the exclusions, including Disengage, teleportation, and movement that does not use the creature’s movement, action, or reaction. Spend the reaction with spend_turn_resource.',
    status: 'model-adjudicated-supported',
    primitives: Object.freeze(['lookup_rules', 'roll', 'spend_turn_resource']),
    contextRequirement:
      'The DM rules whether movement triggers an opportunity attack and applies the exclusions, including Disengage, teleportation, and movement that does not use the creature’s movement, action, or reaction. Spend the reaction with spend_turn_resource.',
  }),
  // R0 rewritten: pack charge economies and live spend/reset tools exist;
  // only disclosure timing remains for DM adjudication.
  'rule:charges': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'spend_usage',
      'reset_usage',
      'restore_usage',
    ]),
    dmContext:
      'When the rule calls for it, identify or attunement reveals the item’s remaining charges; an attuned creature also learns how many charges were regained. Use the item record for its charge maximum and reset economy, and the usage tools for expenditure and restoration.',
    status: 'model-adjudicated-supported',
    primitives: Object.freeze([
      'lookup_rules',
      'spend_usage',
      'reset_usage',
      'restore_usage',
    ]),
    contextRequirement:
      'When the rule calls for it, identify or attunement reveals the item’s remaining charges; an attuned creature also learns how many charges were regained. Use the item record for its charge maximum and reset economy, and the usage tools for expenditure and restoration.',
  }),
});

export function validateRuleAdjudicationContext(
  registeredToolNames: ReadonlySet<string>,
  entries: Readonly<
    Record<string, RuleAdjudicationContext>
  > = RULE_ADJUDICATION_CONTEXT,
): readonly string[] {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(entries)) {
    if (value.dmContext.trim() === '')
      errors.push(`${key}: dmContext is empty`);
    for (const tool of value.tools)
      if (!registeredToolNames.has(tool))
        errors.push(`${key}: tool '${tool}' is not registered`);
  }
  return errors;
}
