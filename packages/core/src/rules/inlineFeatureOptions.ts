/**
 * Resolver for addressable inline option IDs on SRD feature choices
 * (eshyra-ldqb).
 *
 * Several gameplay-significant SRD options (Fighting Styles, Metamagic,
 * Eldritch Invocations, Pact Boons, Hunter options, ...) are modeled as
 * source-backed entries nested under `feature.data.choices[].options[]`
 * rather than as first-class top-level records — that is the right shape for
 * source fidelity (an option only exists in the context of the choice that
 * offers it), but other parts of the same pack reference those options by id
 * across feature boundaries: an Eldritch Invocation's structured
 * `prerequisites[]` can require a specific Pact Boon
 * (`{ kind: 'pactBoon', ref: 'pact-boon:pact-of-the-blade' }`), and a
 * follow-up spell choice can require a specific prior pick
 * (`from.requiresFeatureOption: 'pact-boon:pact-of-the-tome'`).
 *
 * Every inline option id already follows a stable `<category>:<slug>`
 * address (assigned by `deriveFeatureChoices`/`parseOptionCatalog`), so the
 * deliberate modeling choice here is: keep options nested, and add this index
 * so deterministic tools (and the `unresolvable-inline-option-ref` audit gate
 * in `srdPlayabilityAudit.ts`) can resolve those addresses without scanning
 * every feature record by hand.
 */

import type { RulesPack, RulesRecord } from './types.js';

/** One occurrence of an inline option, as found nested under a feature's choices. */
export interface InlineFeatureOption {
  /** The option's stable address, e.g. "pact-boon:pact-of-the-blade". */
  readonly id: string;
  /** SRD option label, e.g. "Pact of the Blade". */
  readonly name: string;
  /** The `feature:` record key that owns the choice offering this option. */
  readonly featureKey: string;
  /** The owning choice's `id` within that feature's `choices[]`. */
  readonly choiceId: string;
}

/**
 * Inline option id -> every feature/choice that offers it. Most ids are
 * offered by exactly one choice, but some (e.g. `fighting-style:archery`) are
 * the same SRD option reprinted verbatim across several granting classes, so
 * a single id can resolve to more than one occurrence.
 */
export type InlineFeatureOptionIndex = ReadonlyMap<
  string,
  readonly InlineFeatureOption[]
>;

function asRecordObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Build the id -> occurrences index from every feature record's choices. */
export function buildInlineFeatureOptionIndex(
  records: readonly RulesRecord[],
): InlineFeatureOptionIndex {
  const index = new Map<string, InlineFeatureOption[]>();
  for (const record of records) {
    if (record.kind !== 'feature') continue;
    const data = asRecordObject(record.data);
    const choices = data === null ? null : data.choices;
    if (!Array.isArray(choices)) continue;
    for (const choiceValue of choices) {
      const choice = asRecordObject(choiceValue);
      const choiceId = choice === null ? null : asNonEmptyString(choice.id);
      const options = choice === null ? null : choice.options;
      if (choiceId === null || !Array.isArray(options)) continue;
      for (const optionValue of options) {
        const option = asRecordObject(optionValue);
        const id = option === null ? null : asNonEmptyString(option.id);
        const name = option === null ? null : asNonEmptyString(option.name);
        if (id === null || name === null) continue;
        const entry: InlineFeatureOption = {
          id,
          name,
          featureKey: record.key,
          choiceId,
        };
        const bucket = index.get(id);
        if (bucket === undefined) index.set(id, [entry]);
        else bucket.push(entry);
      }
    }
  }
  return index;
}

/** Convenience wrapper over {@link buildInlineFeatureOptionIndex} for a whole pack. */
export function buildInlineFeatureOptionIndexForPack(
  pack: RulesPack,
): InlineFeatureOptionIndex {
  return buildInlineFeatureOptionIndex(pack.records);
}

/** Resolve an inline option address, or `undefined` if it has no owner. */
export function resolveInlineFeatureOption(
  index: InlineFeatureOptionIndex,
  id: string,
): readonly InlineFeatureOption[] | undefined {
  return index.get(id);
}
