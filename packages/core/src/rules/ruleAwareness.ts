import {
  type CapabilityLedgerLookup,
  DETERMINISTIC_CAPABILITY_LEDGER,
} from './deterministicCapabilityLedger.js';
import {
  type RecordRelationshipManifestSource,
  type RelationshipArtifactState,
  type RelationshipResolution,
  relationshipIndexFromStack,
  resolveRecordRelationships,
} from './recordRelationships.js';
import { RULE_ADJUDICATION_CONTEXT } from './ruleAdjudicationContext.js';
import { RULE_KNOWN_LIMITS, type RuleKnownLimit } from './ruleKnownLimits.js';
import type { ResolvedRulesStack } from './stack.js';

export interface RuleAwareness {
  readonly relationshipArtifact: RelationshipArtifactState;
  readonly relationships: readonly RelationshipResolution[];
  readonly capabilities: CapabilityLedgerLookup;
  readonly adjudicationContext?: Pick<
    (typeof RULE_ADJUDICATION_CONTEXT)[string],
    'tools' | 'dmContext'
  >;
  readonly knownLimits: readonly Pick<
    RuleKnownLimit,
    'limit' | 'statement' | 'findingId' | 'externalClauses'
  >[];
}

export interface RuleAwarenessDatasets {
  readonly adjudicationContext?: Readonly<
    Record<string, RuleAwareness['adjudicationContext']>
  >;
  readonly knownLimits?: Readonly<Record<string, readonly RuleKnownLimit[]>>;
}

const relationshipIndexCache = new WeakMap<
  ResolvedRulesStack,
  ReturnType<typeof relationshipIndexFromStack>
>();

function relationshipIndexForStack(stack: ResolvedRulesStack) {
  let index = relationshipIndexCache.get(stack);
  if (index === undefined) {
    index = relationshipIndexFromStack(stack);
    relationshipIndexCache.set(stack, index);
  }
  return index;
}

export function ruleAwareness(
  recordKey: string,
  stack: ResolvedRulesStack,
  relationshipManifestSource: RecordRelationshipManifestSource,
  datasets: RuleAwarenessDatasets = {},
): RuleAwareness {
  const entry = stack.recordsByKey.get(recordKey);
  const pack = entry?.pack ?? stack.base;
  const manifest = relationshipManifestSource(pack);
  const relationships =
    entry === undefined || manifest === undefined
      ? []
      : resolveRecordRelationships(
          manifest,
          entry.record,
          relationshipIndexForStack(stack),
        );
  const adjudicationContext = (datasets.adjudicationContext ??
    RULE_ADJUDICATION_CONTEXT)[recordKey];
  return {
    relationshipArtifact: {
      packId: pack.meta.packId,
      state: manifest === undefined ? 'absent' : 'present',
    },
    relationships,
    capabilities: DETERMINISTIC_CAPABILITY_LEDGER.lookup(recordKey),
    ...(adjudicationContext === undefined
      ? {}
      : {
          adjudicationContext: {
            tools: adjudicationContext.tools,
            dmContext: adjudicationContext.dmContext,
          },
        }),
    knownLimits: (
      (datasets.knownLimits ?? RULE_KNOWN_LIMITS)[recordKey] ?? []
    ).map(({ limit, statement, findingId, externalClauses }) => ({
      limit,
      statement,
      findingId,
      ...(externalClauses === undefined ? {} : { externalClauses }),
    })),
  };
}
