import type {
  ResolvedRulesStack,
  RulesStackRecordEntry,
  RulesStackRecordSource,
} from './stack.js';
import { normalizeRulesRecordName } from './stack.js';
import type {
  RulesPackLicense,
  RulesPackMeta,
  RulesRecord,
  RulesRecordKind,
} from './types.js';

export type RulesLookupInput =
  | {
      readonly kind: RulesRecordKind;
      readonly ref: string;
      readonly name?: never;
    }
  | {
      readonly kind: RulesRecordKind;
      readonly name: string;
      readonly ref?: never;
    };

export type RulesLookupResult =
  | {
      readonly ok: true;
      readonly record: RulesRecord;
      readonly pack: RulesPackMeta;
      readonly license: RulesPackLicense;
      readonly overrideChain: readonly RulesStackRecordSource[];
    }
  | {
      readonly ok: false;
      readonly code: 'not_found';
      readonly message: string;
    }
  | {
      readonly ok: false;
      readonly code: 'ambiguous';
      readonly message: string;
      /**
       * Canonical keys of every record of this kind sharing the looked-up name,
       * sorted and capped for prompt/tool safety. The caller re-queries by one
       * of these keys (`ref`) to resolve deterministically (ADR 0013).
       */
      readonly candidateKeys: readonly string[];
    };

export type RulesLookupHit = Extract<RulesLookupResult, { readonly ok: true }>;

/** Cap on candidate keys surfaced in an ambiguous result (prompt safety). */
export const RULES_LOOKUP_AMBIGUOUS_CANDIDATE_CAP = 12;

export function lookupRulesRecord(
  stack: ResolvedRulesStack,
  input: RulesLookupInput,
): RulesLookupResult {
  const kindIndex = stack.recordsByKind.get(input.kind);

  if (input.ref !== undefined) {
    const entry = kindIndex?.byKey.get(input.ref);
    return entry === undefined ? notFound(input) : found(entry);
  }

  const matches = kindIndex?.byName.get(normalizeRulesRecordName(input.name));
  if (matches === undefined || matches.length === 0) {
    return notFound(input);
  }
  if (matches.length === 1) {
    return found(matches[0] as (typeof matches)[number]);
  }

  const allKeys = matches.map((entry) => entry.record.key).sort();
  const candidateKeys = allKeys.slice(0, RULES_LOOKUP_AMBIGUOUS_CANDIDATE_CAP);
  const overflow = allKeys.length - candidateKeys.length;
  const shown = candidateKeys.join(', ');
  const suffix = overflow > 0 ? ` (+${overflow} more)` : '';
  return {
    ok: false,
    code: 'ambiguous',
    message:
      `Multiple rules ${input.kind} records share the name ${input.name}. ` +
      `Re-query by one of these keys (ref): ${shown}${suffix}.`,
    candidateKeys,
  };
}

function found(entry: RulesStackRecordEntry): RulesLookupResult {
  return {
    ok: true,
    record: entry.record,
    pack: entry.pack.meta,
    license: entry.license,
    overrideChain: entry.overrideChain,
  };
}

function notFound(input: RulesLookupInput): RulesLookupResult {
  return {
    ok: false,
    code: 'not_found',
    message: `No rules ${input.kind} found for ${describeLookupInput(input)}.`,
  };
}

function describeLookupInput(input: RulesLookupInput): string {
  if (input.ref !== undefined) {
    return `ref ${input.ref}`;
  }

  return `name ${input.name}`;
}
