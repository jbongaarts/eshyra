import { findingByCanonicalId } from './findingRegistry.js';

export interface RuleKnownLimit {
  readonly limit: 'partial' | 'unimplemented' | 'deferred';
  readonly statement: string;
  readonly findingId: string;
  /** Audit view fields; the facade intentionally projects only the fields above. */
  readonly status: 'partial' | 'unimplemented' | 'design-blocked';
  readonly missing: string;
  readonly designOwner?: string;
  readonly externalClauses?: readonly {
    readonly clause: string;
    readonly findingId: string;
  }[];
}

export const RULE_KNOWN_LIMITS: Readonly<
  Record<string, readonly RuleKnownLimit[]>
> = Object.freeze({
  // R0 confirmed: no breath-duration or suffocation-countdown state exists;
  // adjust_hp applies the 0-HP transition and dying rules.
  'rule:suffocating': Object.freeze([
    Object.freeze({
      limit: 'partial' as const,
      statement:
        'Eshyra does not track how long a creature has held its breath or the suffocation round countdown; the DM tracks both from this rule. When the creature drops to 0 hit points, apply it with adjust_hp, which runs the dying rules.',
      findingId: 'readiness-integrity',
      status: 'partial' as const,
      missing:
        'Eshyra does not track how long a creature has held its breath or the suffocation round countdown; the DM tracks both from this rule. When the creature drops to 0 hit points, apply it with adjust_hp, which runs the dying rules.',
    }),
  ]),
  // R0 confirmed: ADR 0018 supports single-class characters only. A
  // multiclass character is refused; this interaction is not adjudicated.
  'rule:channel-divinity': Object.freeze([
    Object.freeze({
      limit: 'deferred' as const,
      statement:
        'Eshyra supports single-class characters only under ADR 0018. A character with more than one class is refused, so this multiclass Channel Divinity interaction is deliberately unsupported and is not adjudicated.',
      findingId: 'engine-capability-ownership',
      status: 'design-blocked' as const,
      missing:
        'Eshyra supports single-class characters only under ADR 0018. A character with more than one class is refused, so this multiclass Channel Divinity interaction is deliberately unsupported and is not adjudicated.',
      designOwner: 'eshyra-2n1t.1',
    }),
  ]),
});

export function validateRuleKnownLimits(
  entries: Readonly<
    Record<string, readonly RuleKnownLimit[]>
  > = RULE_KNOWN_LIMITS,
): readonly string[] {
  const errors: string[] = [];
  for (const [key, limits] of Object.entries(entries))
    for (const limit of limits) {
      if (findingByCanonicalId(limit.findingId) === undefined)
        errors.push(`${key}: unknown findingId '${limit.findingId}'`);
      for (const clause of limit.externalClauses ?? [])
        if (findingByCanonicalId(clause.findingId) === undefined)
          errors.push(
            `${key}: unknown external findingId '${clause.findingId}'`,
          );
    }
  return errors;
}
