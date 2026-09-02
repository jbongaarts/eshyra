import type { RulesAmbiguity } from '../rules/types.js';
import {
  assertMagicItemOperationReady,
  ItemExecutionReadinessError,
} from '../state/itemExecutionReadiness.js';
import { deriveItemOperationReadinessInput } from '../state/itemState.js';
import type {
  CapabilityPreflight,
  ContextPacket,
  DiscoveryCandidate,
  OfflineCapabilityDeclaration,
  PacketCandidate,
  PacketTrace,
  ProjectionLimitNote,
  RetentionTrace,
} from './types.js';

type Obj = Record<string, unknown>;
function object(value: unknown): Obj | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Obj)
    : undefined;
}
function prose(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(prose);
  if (value !== null && typeof value === 'object')
    return Object.values(value).flatMap(prose);
  return [];
}
function ambiguities(candidate: DiscoveryCandidate): readonly RulesAmbiguity[] {
  const mechanics = object(object(candidate.entry?.record.data)?.mechanics);
  if (!Array.isArray(mechanics?.ambiguities)) return [];
  return mechanics.ambiguities.filter(
    (item): item is RulesAmbiguity =>
      typeof item === 'object' && item !== null && !Array.isArray(item),
  );
}
function projectionLimits(
  candidate: DiscoveryCandidate,
): ProjectionLimitNote[] {
  const record = candidate.entry?.record;
  const data = object(record?.data);
  if (record === undefined || data === undefined) return [];
  const text = prose(record.data).join('\n');
  const mechanics = object(data.mechanics);
  const notes: ProjectionLimitNote[] = [];
  const saves = Array.isArray(mechanics?.saves) ? mechanics.saves : [];
  if (
    saves.some((item) => object(item)?.damageOnSuccess === undefined) &&
    /half as much|successful one|success/iu.test(text)
  )
    notes.push({
      kind: 'success-branch',
      note: 'The typed save projection omits the source success branch; source prose remains authoritative context.',
      evidence: { path: '/data/mechanics/saves', missing: 'damageOnSuccess' },
      preservedProse: text,
    });
  if (
    /(?:\d+)-foot\s+(?:radius|line|cone|cube|sphere)/iu.test(text) &&
    mechanics?.area === undefined
  )
    notes.push({
      kind: 'area',
      note: 'The source describes an area, but no typed mechanics.area projection exists.',
      evidence: { missing: 'data.mechanics.area' },
      preservedProse: text,
    });
  const readiness = object(data.executionReadiness);
  const pending = Array.isArray(readiness?.clauses)
    ? readiness.clauses.filter((item) => object(item)?.readiness !== 'green')
    : [];
  if (pending.length > 0)
    notes.push({
      kind: 'execution-readiness',
      note: 'The record has engine-pending readiness clauses; typed projections are not a capability.',
      evidence: { clauses: pending },
      preservedProse: text,
    });
  return notes;
}
function singleUseEconomy(
  record: { data: unknown },
  input: { economyIds: ReadonlySet<string> },
): boolean {
  const economies = object(object(object(record.data)?.mechanics)?.economies);
  if (economies === undefined) return false;
  return [...input.economyIds].some(
    (id) => object(economies[id])?.kind === 'single-use',
  );
}
function capability(
  candidate: DiscoveryCandidate,
  state: Readonly<Record<string, unknown>>,
  declarations: readonly OfflineCapabilityDeclaration[],
): CapabilityPreflight | undefined {
  const route = candidate.routes.find(
    (item) => item.routeClass === 'capability-preflight',
  );
  const operationId =
    typeof route?.evidence.operationId === 'string'
      ? route.evidence.operationId
      : typeof state.operationId === 'string'
        ? state.operationId
        : undefined;
  if (
    candidate.entry?.record.kind !== 'magic-item' ||
    operationId === undefined
  ) {
    const declaration = declarations.find(
      (item) => item.candidateKey === candidate.candidateKey,
    );
    return declaration === undefined
      ? undefined
      : {
          status: 'not-evaluated-offline',
          capabilityId: declaration.capabilityId,
          revision: declaration.revision,
          inputs: declaration.inputs,
          exclusions: declaration.exclusions,
          residualInterpretation: declaration.residualInterpretation,
        };
  }
  try {
    const readinessInput = deriveItemOperationReadinessInput(
      candidate.entry.record,
      undefined,
      operationId,
    );
    assertMagicItemOperationReady(
      candidate.entry.record,
      undefined,
      readinessInput,
    );
    return {
      status: 'available',
      // Derived from the record's own bound economy, never from a literal
      // record key: keying capability identity off one probe's record would
      // tune the harness to the fixture it is supposed to be evidence for.
      capabilityId: singleUseEconomy(candidate.entry.record, readinessInput)
        ? 'magic-item-single-use-spend'
        : 'magic-item-operation-readiness',
      revision: 'derived-magic-item-clauses-v1',
      operationId,
      readinessInput,
      inputs: ['item record', 'operation id', 'bound operation mechanics'],
      exclusions: [
        'This preflight does not prove complete item semantics or execute state mutations.',
      ],
      residualInterpretation:
        'The DM and state owner retain interpretation outside the bounded readiness contract.',
    };
  } catch (error) {
    if (!(error instanceof ItemExecutionReadinessError)) throw error;
    return {
      status: 'blocked',
      capabilityId: 'magic-item-operation-readiness',
      revision: 'derived-magic-item-clauses-v1',
      operationId,
      blockingClauseIds: [
        ...error.message.matchAll(/([\w:-]+\/c\d+(?:-[\w-]+)?)/gu),
      ].map((match) => match[1]),
      message: error.message,
      inputs: ['item record', 'operation id', 'bound operation mechanics'],
      exclusions: [
        'A blocked readiness contract cannot be treated as an executable capability.',
      ],
      residualInterpretation:
        'An engine owner must resolve the named readiness clauses.',
    };
  }
}
function packetCandidate(
  candidate: DiscoveryCandidate,
  state: Readonly<Record<string, unknown>>,
  declarations: readonly OfflineCapabilityDeclaration[],
): PacketCandidate {
  if (candidate.routes.length === 0)
    throw new Error(
      `route-free candidate '${candidate.candidateKey}' cannot enter context packet`,
    );
  if (candidate.entry === undefined)
    return {
      identity: {
        key: candidate.candidateKey,
        kind: 'adventure-entity',
        name: String(candidate.adventureEntity?.name ?? candidate.candidateKey),
      },
      provenance: {
        sourceRef: 'adventure-module',
        source: 'adventure-module',
        license: null,
      },
      sourceProse: candidate.adventureEntity ?? {},
      routes: candidate.routes,
      traversals: candidate.traversals,
      ambiguities: [],
      campaignRules: candidate.campaignRules,
      campaignRulings: candidate.campaignRulings,
      projectionLimits: [],
    };
  const record = candidate.entry.record;
  return {
    identity: { key: record.key, kind: record.kind, name: record.name },
    provenance: {
      sourceRef: record.provenance.sourceRef,
      locator: record.provenance.locator,
      source: record.source,
      license: candidate.entry.license,
    },
    sourceProse: { data: object(record.data) ?? {} },
    routes: candidate.routes,
    traversals: candidate.traversals,
    ambiguities: ambiguities(candidate),
    campaignRules: candidate.campaignRules,
    campaignRulings: candidate.campaignRulings,
    capability: capability(candidate, state, declarations),
    projectionLimits: projectionLimits(candidate),
  };
}
export function buildContextPacket(
  retained: RetentionTrace,
  state: Readonly<Record<string, unknown>> = {},
  maxPacketBytes = 512_000,
  declarations: readonly OfflineCapabilityDeclaration[] = [],
): PacketTrace {
  const packetCandidates = retained.outputsProduced.map((candidate) =>
    packetCandidate(candidate, state, declarations),
  );
  const packet: ContextPacket = {
    candidates: packetCandidates,
    bytes: Buffer.byteLength(JSON.stringify(packetCandidates), 'utf8'),
    projectionLimitNotes: packetCandidates.flatMap(
      (candidate) => candidate.projectionLimits,
    ),
    modelUsageClaim: null,
  };
  // Exceeding the byte budget is recorded, never thrown: throwing would
  // destroy the trace that is the sole evidence surface, and a byte overflow
  // that silently vanished would be indistinguishable from a packet that fit.
  const byteBudgetExceeded = packet.bytes > maxPacketBytes;
  return {
    stage: 'packet',
    inputsConsumed: retained.outputsProduced.map((candidate) => ({
      candidateKey: candidate.candidateKey,
    })),
    outputsProduced: packetCandidates,
    losses: [
      ...retained.dropped.map((item) => ({
        reason: item.reason,
        detail: item as unknown as Record<string, unknown>,
      })),
      ...(byteBudgetExceeded
        ? [
            {
              reason: 'packet-byte-budget-exceeded',
              detail: { bytes: packet.bytes, maxPacketBytes },
            },
          ]
        : []),
    ],
    failedToRun: packetCandidates.length === 0 && retained.dropped.length === 0,
    packet,
    byteBudgetExceeded,
    dropped: retained.dropped,
  };
}
