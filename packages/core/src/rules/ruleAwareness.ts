import {
  type CapabilityLedgerLookup,
  DETERMINISTIC_CAPABILITY_LEDGER,
} from './deterministicCapabilityLedger.js';
import {
  type RecordRelationshipManifestSource,
  type RelationshipArtifactState,
  type RelationshipResolution,
  resolveRecordRelationships,
} from './recordRelationships.js';
import {
  RULE_ADJUDICATION_CONTEXT,
  type RuleAdjudicationContext,
} from './ruleAdjudicationContext.js';
import { RULE_KNOWN_LIMITS, type RuleKnownLimit } from './ruleKnownLimits.js';
import type { ResolvedRulesStack } from './stack.js';
import { RulesPackError } from './types.js';

/** A known limit as consumers see it: history fields stay in the dataset. */
export type RuleKnownLimitStatement = Pick<
  RuleKnownLimit,
  'limit' | 'statement' | 'findingId'
> & {
  readonly externalClauses?: readonly {
    readonly clause: string;
    readonly findingId: string;
  }[];
};

/**
 * Eshyra's own statements about a record key (design R4): the three
 * independently owned channels. None depends on a pack, a stack, or a
 * relationship manifest, so a consumer without one still gets all three.
 */
export interface RuleStatements {
  readonly capabilities: CapabilityLedgerLookup;
  readonly adjudicationContext?: RuleAdjudicationContext;
  readonly knownLimits: readonly RuleKnownLimitStatement[];
}

export interface RuleAwareness extends RuleStatements {
  readonly relationshipArtifact: RelationshipArtifactState;
  readonly relationships: readonly RelationshipResolution[];
}

/** Injectable datasets, for the synthetic channel-independence evidence. */
export interface RuleAwarenessDatasets {
  readonly adjudicationContext?: Readonly<
    Record<string, RuleAdjudicationContext>
  >;
  readonly knownLimits?: Readonly<Record<string, readonly RuleKnownLimit[]>>;
}

export function ruleStatements(
  recordKey: string,
  datasets: RuleAwarenessDatasets = {},
): RuleStatements {
  const context = (datasets.adjudicationContext ?? RULE_ADJUDICATION_CONTEXT)[
    recordKey
  ];
  return {
    capabilities: DETERMINISTIC_CAPABILITY_LEDGER.lookup(recordKey),
    ...(context === undefined
      ? {}
      : {
          adjudicationContext: {
            tools: context.tools,
            dmContext: context.dmContext,
          },
        }),
    knownLimits: (
      (datasets.knownLimits ?? RULE_KNOWN_LIMITS)[recordKey] ?? []
    ).map(({ limit, statement, findingId, externalClauses }) => ({
      limit,
      statement,
      findingId,
      ...(externalClauses === undefined
        ? {}
        : {
            externalClauses: externalClauses.map(({ clause, findingId }) => ({
              clause,
              findingId,
            })),
          }),
    })),
  };
}

/**
 * Read-only facade (design R5). Relationships are resolved for the WINNING
 * stack entry's producing pack, through the manifest association the caller
 * supplies; an absent manifest is reported as `absent`, never replaced by
 * another pack's. The statement channels come from {@link ruleStatements}
 * and are never derived from the relationships or from each other.
 */
export function ruleAwareness(
  recordKey: string,
  stack: ResolvedRulesStack,
  relationshipManifestSource: RecordRelationshipManifestSource,
  datasets: RuleAwarenessDatasets = {},
): RuleAwareness {
  const entry = stack.recordsByKey.get(recordKey);
  // No producer to qualify: reporting some other pack's manifest state here
  // would be a claim about a record this stack does not hold.
  if (entry === undefined)
    throw new RulesPackError(
      `ruleAwareness: '${recordKey}' is not a record in the resolved stack`,
    );
  const manifest = relationshipManifestSource(entry.pack);
  return {
    relationshipArtifact: {
      packId: entry.pack.meta.packId,
      state: manifest === undefined ? 'absent' : 'present',
    },
    relationships:
      manifest === undefined
        ? []
        : resolveRecordRelationships(manifest, entry.record, stack),
    ...ruleStatements(recordKey, datasets),
  };
}
