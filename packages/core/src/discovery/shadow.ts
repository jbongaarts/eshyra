import type { AdventureModule } from '../adventure/types.js';
import type { TraceJsonValue } from '../memory/turnTrace.js';
import type { Db } from '../persistence/db.js';
import type { CampaignRulesPackResolver } from '../state/campaignRecordLookup.js';
import { resolveStrictCampaignRulesStack } from '../state/campaignRecordLookup.js';
import type {
  BlockerRepairObservation,
  BlockerToolSchemaSource,
} from './blockerRepairs.js';
import { observeBlockerRepairs } from './blockerRepairs.js';
import { runDiscoveryStages } from './harness.js';
import type { RuntimeDiscoveryObservations } from './measurements.js';
import type { ProjectedDiscoveryTrace } from './traceProjection.js';
import { projectDiscoveryTrace } from './traceProjection.js';
import type {
  CampaignRuleReadSeam,
  DiscoveryScenario,
  RuntimeAuditAttempt,
  RuntimeCapabilityInvocation,
} from './types.js';

/**
 * Phase 2 runtime shadow mode (design section 12.2, bead `eshyra-o9bd.19.11`).
 *
 * Discovery runs on a real turn between `assembleContext` and
 * `renderContextMessage` and records what it would have proposed. It changes
 * NOTHING the DM receives: nothing here touches the assembled context, the
 * rendered message, the tool registry, or campaign state, and injecting the
 * packet is W10's decision, not this one.
 *
 * The capture is deliberately failure-tolerant. An observation point that can
 * abort a player's turn is worse than no observation point, so a shadow failure
 * is RECORDED as a failure — never swallowed into a green-looking empty
 * capture, and never rethrown into the turn.
 */

export const DISCOVERY_SHADOW_SCHEMA = 'discovery-shadow-v1';

export interface ShadowItemInstanceBinding {
  readonly instanceId: string;
  readonly recordKey: string;
  readonly variantId?: string;
}

export interface ShadowAdventureSeat {
  readonly moduleId: string;
  readonly locationId?: string;
  readonly encounterId?: string;
}

export interface ShadowScenarioRecord {
  readonly playerInput: string;
  readonly actingCharacterId?: string;
  /** JSON-pointer roots of the live state the run was given, never its values. */
  readonly stateFieldRoots: readonly string[];
  readonly itemInstances: readonly ShadowItemInstanceBinding[];
  readonly adventure?: ShadowAdventureSeat;
  /** Whether the declared adventure module actually resolved. */
  readonly adventureModuleResolved?: boolean;
  /**
   * Why the turn's adventure context was seated only partly, or not at all.
   * Recorded rather than left as a silent absence, because an unseated run and
   * a campaign with no adventure look identical in the trace otherwise.
   */
  readonly adventureSeatNotes: readonly string[];
}

export interface ShadowFailure {
  /** Which part of the capture was running when it failed. */
  readonly stage: 'stack' | 'blockers' | 'discovery';
  readonly message: string;
}

interface DiscoveryShadowCaptureBase {
  readonly capturedAt: string;
  readonly campaignPosition: string;
  readonly blockerRepairs: readonly BlockerRepairObservation[];
  readonly scenario: ShadowScenarioRecord;
}

/**
 * A capture carries EITHER a trace or a failure, never neither. Two optional
 * fields would make "no trace and no failure" representable, and that shape is
 * exactly the green-looking nothing design section 13.3 forbids.
 */
export type DiscoveryShadowCapture = DiscoveryShadowCaptureBase &
  (
    | { readonly trace: ProjectedDiscoveryTrace; readonly failure?: undefined }
    | { readonly trace?: undefined; readonly failure: ShadowFailure }
  );

export type DiscoveryShadowEvidence = DiscoveryShadowCapture & {
  readonly schema: typeof DISCOVERY_SHADOW_SCHEMA;
  readonly runtime: RuntimeDiscoveryObservations;
  /**
   * Design section 12.3: presence in a packet is never evidence that the model
   * used the material. Shadow mode injects nothing at all, so the non-claim is
   * recorded explicitly rather than left to a reader's restraint.
   */
  readonly modelUsageClaim: null;
};

export interface ShadowDiscoveryInput {
  readonly db: Db;
  /** Canonical chronology anchor the seam is bound to; a human turn label will not parse. */
  readonly campaignPosition: string;
  readonly capturedAt: string;
  readonly playerInput: string;
  readonly actingCharacterId?: string;
  /** The live state snapshot, walked generically by the signals stage. */
  readonly stateFields: Readonly<Record<string, unknown>>;
  readonly itemInstances: readonly ShadowItemInstanceBinding[];
  readonly adventure?: ShadowAdventureSeat;
  readonly adventureSeatNotes?: readonly string[];
  readonly resolveAdventureModule?: (
    moduleId: string,
  ) => AdventureModule | undefined;
  readonly resolveRulesPack?: CampaignRulesPackResolver;
  /**
   * The jhpt read seam, already bound to `campaignPosition` by its owner.
   * Discovery is handed a seam and never reaches for the campaign-rule store
   * to build one (design section 8.4).
   */
  readonly campaignRuleSeam: CampaignRuleReadSeam;
  readonly tools: BlockerToolSchemaSource;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function captureDiscoveryShadow(
  input: ShadowDiscoveryInput,
): DiscoveryShadowCapture {
  const module =
    input.adventure === undefined
      ? undefined
      : input.resolveAdventureModule?.(input.adventure.moduleId);
  const scenarioRecord: ShadowScenarioRecord = {
    playerInput: input.playerInput,
    ...(input.actingCharacterId === undefined
      ? {}
      : { actingCharacterId: input.actingCharacterId }),
    stateFieldRoots: Object.keys(input.stateFields).map((key) => `/${key}`),
    itemInstances: input.itemInstances,
    ...(input.adventure === undefined
      ? {}
      : {
          adventure: input.adventure,
          adventureModuleResolved: module !== undefined,
        }),
    adventureSeatNotes: input.adventureSeatNotes ?? [],
  };
  const scenario: DiscoveryScenario = {
    playerInput: input.playerInput,
    ...(input.actingCharacterId === undefined
      ? {}
      : { actingCharacterId: input.actingCharacterId }),
    stateFields: input.stateFields,
    itemInstances: input.itemInstances,
    ...(input.adventure === undefined || module === undefined
      ? {}
      : {
          adventure: {
            moduleId: input.adventure.moduleId,
            ...(input.adventure.locationId === undefined
              ? {}
              : { locationId: input.adventure.locationId }),
            ...(input.adventure.encounterId === undefined
              ? {}
              : { encounterId: input.adventure.encounterId }),
            module,
          },
        }),
  };
  // The stack is resolved once, up front: both the blocker probes and the run
  // must report on the SAME stack, or the recorded repair state would describe
  // a different resolution than the evidence it qualifies.
  //
  // Everything after this point is inside one guard, tracking which part was
  // running. That makes this function TOTAL: it always returns a capture, so
  // the orchestrator's observation point needs no guard of its own and cannot
  // destabilize a turn. A failure is still reported — an empty capture that
  // reads as a green nothing would be the worse outcome.
  let stage: ShadowFailure['stage'] = 'stack';
  let blockerRepairs: readonly BlockerRepairObservation[] = [];
  try {
    const stack = resolveStrictCampaignRulesStack(
      input.db,
      input.resolveRulesPack,
    );
    stage = 'blockers';
    blockerRepairs = observeBlockerRepairs({
      stack,
      tools: input.tools,
      adventureResolverSupplied: input.resolveAdventureModule !== undefined,
    });
    stage = 'discovery';
    const trace = runDiscoveryStages({
      db: input.db,
      scenario,
      campaignPosition: input.campaignPosition,
      campaignRuleSeam: input.campaignRuleSeam,
      ...(input.resolveRulesPack === undefined
        ? {}
        : { rulesPackResolver: input.resolveRulesPack }),
    });
    return {
      capturedAt: input.capturedAt,
      campaignPosition: input.campaignPosition,
      blockerRepairs,
      scenario: scenarioRecord,
      trace: projectDiscoveryTrace(trace),
    };
  } catch (error) {
    return {
      capturedAt: input.capturedAt,
      campaignPosition: input.campaignPosition,
      blockerRepairs,
      scenario: scenarioRecord,
      failure: { stage, message: message(error) },
    };
  }
}

/** Structural view of one executed tool call, so discovery imports no orchestrator. */
export interface ShadowExecutedToolCall {
  readonly tool: string;
  readonly args?: unknown;
  readonly result:
    | { readonly ok: true; readonly data?: unknown }
    | {
        readonly ok: false;
        readonly code: string;
        readonly message: string;
        readonly data?: unknown;
      };
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/**
 * The runtime capability outcomes of one accepted turn, for M10.
 *
 * `use_item` is the only runtime path that reaches
 * `assertMagicItemOperationReady` — it is the sole caller of
 * `preflightCampaignItemOperation` — so it is the only tool whose outcome can
 * be a capability outcome.
 *
 * A failed `use_item` is only a BLOCKED capability when it carries the
 * preflight payload. Without it the failure came from somewhere else — a
 * missing attunement, an unresolvable pack ref, or an operation that passed the
 * preflight and then failed on live state — and in that last case the tool
 * result cannot say whether the capability was consulted at all. Recording
 * those as `not-a-capability-outcome` keeps M10 from crediting or blaming a
 * capability for an outcome that was never its own.
 */
export function observeRuntimeCapabilityInvocations(
  toolCalls: readonly ShadowExecutedToolCall[],
  bindings: readonly ShadowItemInstanceBinding[],
): readonly RuntimeCapabilityInvocation[] {
  return toolCalls
    .filter((call) => call.tool === 'use_item')
    .map((call): RuntimeCapabilityInvocation => {
      const instanceId = field(call.args, 'instanceId');
      const operationId = field(call.args, 'operationId');
      const binding =
        typeof instanceId === 'string'
          ? bindings.find((item) => item.instanceId === instanceId)
          : undefined;
      const identity = {
        tool: call.tool,
        ...(typeof instanceId === 'string' ? { instanceId } : {}),
        ...(typeof operationId === 'string' ? { operationId } : {}),
        ...(binding === undefined ? {} : { recordKey: binding.recordKey }),
      };
      if (call.result.ok) return { ...identity, outcome: 'available' };
      const preflight = call.result.data;
      const capabilityId = field(preflight, 'capabilityId');
      if (
        field(preflight, 'status') === 'blocked' &&
        typeof capabilityId === 'string'
      )
        return {
          ...identity,
          capabilityId,
          outcome: 'blocked',
          detail: call.result.message,
        };
      return {
        ...identity,
        outcome: 'not-a-capability-outcome',
        detail: `${call.result.code}: ${call.result.message}`,
      };
    });
}

export function completeDiscoveryShadowEvidence(
  capture: DiscoveryShadowCapture,
  runtime: {
    readonly toolCalls: readonly ShadowExecutedToolCall[];
    readonly auditAttempts: readonly RuntimeAuditAttempt[];
  },
): DiscoveryShadowEvidence {
  return {
    ...capture,
    schema: DISCOVERY_SHADOW_SCHEMA,
    runtime: {
      capabilityInvocations: observeRuntimeCapabilityInvocations(
        runtime.toolCalls,
        capture.scenario.itemInstances,
      ),
      auditAttempts: runtime.auditAttempts,
    },
    modelUsageClaim: null,
  };
}

/**
 * Hand the evidence to the existing turn-trace seam. The seam stores an opaque
 * JSON value on purpose: the shape belongs to discovery, and duplicating it
 * inside `memory/turnTrace.ts` would make the memory module an owner of
 * discovery's schema.
 *
 * The round-trip is not ceremony. The packet carries projected source prose
 * straight from the rules pack, whose optional fields are `undefined` rather
 * than absent, so the object is not a `TraceJsonValue` until it has been
 * through `JSON`. Asserting the type instead would put a value in the column
 * that never satisfied it.
 */
export function encodeDiscoveryShadowEvidence(
  evidence: DiscoveryShadowEvidence,
): TraceJsonValue {
  return JSON.parse(JSON.stringify(evidence)) as TraceJsonValue;
}

export class DiscoveryShadowSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscoveryShadowSchemaError';
  }
}

/**
 * Read shadow evidence back off a recorded turn trace. A stored value carrying
 * a schema tag this build does not know is an error, not an absence: measuring
 * it as if it were absent would report a green nothing for a capture that
 * exists.
 */
export function readDiscoveryShadowEvidence(
  stored: TraceJsonValue | undefined,
): DiscoveryShadowEvidence | undefined {
  if (stored === undefined || stored === null) return undefined;
  const schema = field(stored, 'schema');
  if (schema !== DISCOVERY_SHADOW_SCHEMA)
    throw new DiscoveryShadowSchemaError(
      `recorded discovery shadow evidence has schema '${String(schema)}', not '${DISCOVERY_SHADOW_SCHEMA}'`,
    );
  return stored as unknown as DiscoveryShadowEvidence;
}
