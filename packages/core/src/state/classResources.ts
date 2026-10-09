// Pack-bound class resource capacities (eshyra-2llo.1). Selected expendable
// class resources (Rage, Ki, Sorcery Points) derive their counter maximum from
// the class table's `resourceProgression` column at the character's level
// rather than from a model-declared economy. See
// docs/design/character-progression.md "Class resource capacities".

import type {
  ResolvedClassLevel,
  ResolvedClassResource,
} from '../character/rulesPackResolver.js';
import type { UsageResetKind } from './usageCounters.js';

export interface ClassResourceBinding {
  readonly classKey: string;
  /** Pack `resourceProgression` resource name. */
  readonly resource: string;
  readonly counterKey: string;
  readonly displayName: string;
  /** Normalized ability names (`ability:` key suffixes) naming this resource. */
  readonly aliases: readonly string[];
  readonly reset: UsageResetKind;
}

export const CLASS_RESOURCE_BINDINGS: readonly ClassResourceBinding[] = [
  {
    // Rage: "you must finish a long rest before you can rage again."
    classKey: 'class:barbarian',
    resource: 'rages',
    counterKey: 'ability:rage',
    displayName: 'Rage',
    aliases: ['rage', 'rages'],
    reset: 'long_rest',
  },
  {
    // Ki: "unavailable until you finish a short or long rest".
    classKey: 'class:monk',
    resource: 'kiPoints',
    counterKey: 'ability:ki',
    displayName: 'Ki',
    aliases: ['ki', 'ki-points'],
    reset: 'short_or_long_rest',
  },
  {
    // Font of Magic: "You regain all spent sorcery points when you finish a
    // long rest."
    classKey: 'class:sorcerer',
    resource: 'sorceryPoints',
    counterKey: 'ability:sorcery-points',
    displayName: 'Sorcery Points',
    aliases: ['sorcery-points', 'font-of-magic'],
    reset: 'long_rest',
  },
];

/** The binding a (class, normalized ability name) pair names, if any. */
export function findClassResourceBinding(
  classKey: string,
  normalizedAbility: string,
): ClassResourceBinding | undefined {
  return CLASS_RESOURCE_BINDINGS.find(
    (binding) =>
      binding.classKey === classKey &&
      (binding.aliases.includes(normalizedAbility) ||
        binding.counterKey === `ability:${normalizedAbility}`),
  );
}

export function classResourceBindingsFor(
  classKey: string,
): readonly ClassResourceBinding[] {
  return CLASS_RESOURCE_BINDINGS.filter(
    (binding) => binding.classKey === classKey,
  );
}

/** The bound resource's capacity at a class level. A missing pack column is
 *  treated like the '—' marker (no such resource at this level). */
export type ClassResourceCapacity =
  | { readonly kind: 'count'; readonly value: number }
  | { readonly kind: 'unlimited' }
  | { readonly kind: 'none' };

export function classResourceCapacity(
  binding: ClassResourceBinding,
  row: Pick<ResolvedClassLevel, 'resources'>,
): ClassResourceCapacity {
  const value: ResolvedClassResource | undefined =
    row.resources[binding.resource];
  if (value === undefined || value.kind === 'none') return { kind: 'none' };
  if (value.kind === 'unlimited') return { kind: 'unlimited' };
  if (
    value.kind === 'count' &&
    Number.isInteger(value.value) &&
    value.value >= 1
  ) {
    return { kind: 'count', value: value.value };
  }
  return { kind: 'none' };
}

/** Compact, ledger-friendly rendering of a capacity. */
export function describeClassResourceCapacity(
  capacity: ClassResourceCapacity,
): number | 'unlimited' | 'none' {
  return capacity.kind === 'count' ? capacity.value : capacity.kind;
}
