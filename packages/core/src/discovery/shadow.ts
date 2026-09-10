import type { AdventureModule } from '../adventure/types.js';
import type { TraceJsonValue } from '../memory/turnTrace.js';
import type { Db } from '../persistence/db.js';
import type { CampaignRulesPackResolver } from '../state/campaignRecordLookup.js';
import {
  memoizeCampaignRulesPackResolver,
  resolveStrictCampaignRulesStack,
} from '../state/campaignRecordLookup.js';
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
  readonly stage: 'scenario' | 'stack' | 'blockers' | 'discovery';
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
  /**
   * Resolver for packs the campaign binds that core does not bundle.
   *
   * The capture MEMOIZES it, so every resolution this capture triggers — its
   * own strict stack, B3's call into the real deterministic lookup, and the
   * discovery run — is built from the same pack objects. Nothing contracts a
   * `CampaignRulesPackResolver` to be pure or to keep answering; without the
   * memo the blocker statuses could qualify one source resolution while the
   * persisted trace described another.
   */
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
  const base = {
    capturedAt: input.capturedAt,
    campaignPosition: input.campaignPosition,
  };
  // EVERY shadow-only operation is inside this one guard, tracking which part
  // was running — the adventure-source read included, because the resolver is
  // caller-supplied and nothing contracts it to succeed. That makes this
  // function TOTAL: it always returns a capture, so the orchestrator's
  // observation point needs no guard of its own and cannot destabilize a turn.
  // A failure is still reported; an empty capture that reads as a green
  // nothing would be the worse outcome.
  let stage: ShadowFailure['stage'] = 'scenario';
  let blockerRepairs: readonly BlockerRepairObservation[] = [];
  let scenarioRecord: ShadowScenarioRecord = {
    playerInput: input.playerInput,
    stateFieldRoots: [],
    itemInstances: [],
    adventureSeatNotes: [],
  };
  try {
    // The caller hands in a memoized resolver, so this reads the adventure
    // source the real turn already resolved rather than a second time.
    const module =
      input.adventure === undefined
        ? undefined
        : input.resolveAdventureModule?.(input.adventure.moduleId);
    scenarioRecord = {
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
    // The stack is resolved ONCE and threaded through, and the resolver behind
    // it is memoized, so the blocker probes and the discovery run cannot end up
    // qualifying and tracing two different resolutions of the campaign's packs.
    stage = 'stack';
    // The B3 probe deliberately calls the real deterministic lookup, which
    // resolves the stack itself; that call is the discriminator and must not be
    // replaced by a pinned stack. Memoizing the resolver keeps it honest
    // anyway: it still resolves, but from the packs everything else here saw.
    const resolveRulesPack = memoizeCampaignRulesPackResolver(
      input.resolveRulesPack,
    );
    const stack = resolveStrictCampaignRulesStack(input.db, resolveRulesPack);
    stage = 'blockers';
    blockerRepairs = observeBlockerRepairs({
      db: input.db,
      stack,
      tools: input.tools,
      ...(resolveRulesPack === undefined ? {} : { resolveRulesPack }),
      adventureResolverSupplied: input.resolveAdventureModule !== undefined,
    });
    stage = 'discovery';
    const trace = runDiscoveryStages({
      db: input.db,
      scenario,
      stack,
      campaignPosition: input.campaignPosition,
      campaignRuleSeam: input.campaignRuleSeam,
      ...(resolveRulesPack === undefined
        ? {}
        : { rulesPackResolver: resolveRulesPack }),
    });
    return {
      ...base,
      blockerRepairs,
      scenario: scenarioRecord,
      trace: projectDiscoveryTrace(trace),
    };
  } catch (error) {
    return {
      ...base,
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
 * The runtime capability events of one accepted turn, for M10.
 *
 * `use_item` is the only runtime path that reaches
 * `assertMagicItemOperationReady` — it is the sole caller of
 * `preflightCampaignItemOperation` — so it is the only tool that can carry one.
 *
 * What is read is the PREFLIGHT EVENT, never the tool's terminal result. The
 * two are different facts: a capability can report `available` and the use can
 * still fail afterwards on live state, and inferring the capability's outcome
 * from the tool's would erase that invocation entirely. `useItem` therefore
 * reports its preflight on success, on refusal, and on a downstream failure
 * that happened after the capability was consulted; each carries the identity,
 * revision, subject and status the capability committed under.
 *
 * `not-a-capability-outcome` is left for a `use_item` that failed BEFORE the
 * preflight ran — an unresolvable pack ref, a missing attunement, a quarantined
 * instance. Nothing was invoked, so there is nothing for M10 to compare.
 *
 * The pre-model inventory binding is consulted only where no preflight event
 * was reported, and is then LABELLED as a snapshot: the model may have changed
 * the instance before invoking the tool, and a snapshot that merely usually
 * agrees is not identity.
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
      const identity = {
        tool: call.tool,
        ...(typeof instanceId === 'string' ? { instanceId } : {}),
        ...(typeof operationId === 'string' ? { operationId } : {}),
      };
      const event = preflightEvent(call.result.data);
      if (event === undefined) {
        const snapshot = bindingSubject(instanceId, bindings);
        return {
          ...identity,
          ...snapshot.identity,
          subjectSource: snapshot.source,
          outcome: 'not-a-capability-outcome',
          detail: call.result.ok
            ? 'the tool reported no readiness preflight'
            : `${call.result.code}: ${call.result.message}`,
        };
      }
      // A preflight that named no subject leaves the identity unproved even
      // though the event itself is real, so the snapshot is recorded and
      // labelled rather than being passed off as the runtime's own answer.
      const subject =
        event.subject === undefined
          ? bindingSubject(instanceId, bindings)
          : { identity: event.subject, source: 'runtime-result' as const };
      return {
        ...identity,
        ...subject.identity,
        subjectSource: subject.source,
        capabilityId: event.capabilityId,
        ...(event.capabilityRevision === undefined
          ? {}
          : { capabilityRevision: event.capabilityRevision }),
        outcome: event.outcome,
        ...(call.result.ok
          ? {}
          : { detail: `${call.result.code}: ${call.result.message}` }),
      };
    });
}

/**
 * The preflight as the runtime reported it, wherever it rides: nested on a
 * successful `useItem` result, or as the error payload of a refusal or of a
 * failure that happened after the capability was consulted.
 */
function preflightEvent(data: unknown):
  | {
      readonly subject?: {
        readonly recordKey: string;
        readonly variantId?: string;
      };
      readonly capabilityId: string;
      readonly capabilityRevision?: string;
      readonly outcome: 'available' | 'blocked';
    }
  | undefined {
  const preflight = field(data, 'capabilityPreflight') ?? data;
  const capabilityId = field(preflight, 'capabilityId');
  const status = field(preflight, 'status');
  if (
    typeof capabilityId !== 'string' ||
    (status !== 'available' && status !== 'blocked')
  )
    return undefined;
  const revision = field(preflight, 'revision');
  const subject = field(preflight, 'subject');
  const recordKey = field(subject, 'recordKey');
  const variantId = field(subject, 'variantId');
  return {
    ...(typeof recordKey === 'string'
      ? {
          subject: {
            recordKey,
            ...(typeof variantId === 'string' ? { variantId } : {}),
          },
        }
      : {}),
    capabilityId,
    ...(typeof revision === 'string' ? { capabilityRevision: revision } : {}),
    outcome: status,
  };
}

/** The pre-model snapshot, used only where no runtime outcome named a subject. */
function bindingSubject(
  instanceId: unknown,
  bindings: readonly ShadowItemInstanceBinding[],
): {
  readonly identity: { recordKey?: string; variantId?: string };
  readonly source: 'pre-model-binding' | 'unavailable';
} {
  const binding =
    typeof instanceId === 'string'
      ? bindings.find((item) => item.instanceId === instanceId)
      : undefined;
  if (binding === undefined) return { identity: {}, source: 'unavailable' };
  return {
    identity: {
      recordKey: binding.recordKey,
      ...(binding.variantId === undefined
        ? {}
        : { variantId: binding.variantId }),
    },
    source: 'pre-model-binding',
  };
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class DiscoveryShadowSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscoveryShadowSchemaError';
  }
}

/**
 * Fail-closed structural validation of a stored v1 row.
 *
 * The TypeScript union that makes "neither a trace nor a failure" impossible
 * lives only in memory; the SQLite JSON boundary erases every guarantee, so
 * without this a row of `{"schema":"discovery-shadow-v1"}` would be cast
 * straight back into evidence and measured as a green nothing. Checking only
 * the common fields is not enough either: a row missing
 * `ruleJoin.requestedRuleRecordKeys` would pass a shallow check and then make
 * M5 spread `undefined`, and an arbitrary `outcome` string would be accepted as
 * stage accounting.
 *
 * The rule applied below is therefore: **every field M1-M11 or baseline
 * qualification dereferences is validated, with its enum and its cross-field
 * invariant.** Fields nothing consumes are not invented here.
 */

type Check = (value: unknown, path: string) => void;

function failAt(path: string, detail: string): never {
  throw new DiscoveryShadowSchemaError(
    `recorded ${DISCOVERY_SHADOW_SCHEMA} evidence is malformed at ${path}: ${detail}`,
  );
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (!isObject(value)) failAt(path, 'expected an object');
  return value;
}

function asArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) failAt(path, 'expected an array');
  return value;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== 'string') failAt(path, 'expected a string');
  return value;
}

function asNumber(value: unknown, path: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value))
    failAt(path, 'expected a finite number');
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') failAt(path, 'expected a boolean');
  return value;
}

function asEnum(
  value: unknown,
  path: string,
  allowed: readonly string[],
): string {
  const text = asString(value, path);
  if (!allowed.includes(text))
    failAt(path, `'${text}' is not one of ${allowed.join(', ')}`);
  return text;
}

function optional(value: unknown, path: string, check: Check): void {
  if (value !== undefined && value !== null) check(value, path);
}

function each(value: unknown, path: string, check: Check): void {
  asArray(value, path).forEach((item, index) => {
    check(item, `${path}[${index}]`);
  });
}

function strings(value: unknown, path: string): void {
  each(value, path, (item, at) => {
    asString(item, at);
  });
}

const STAGE_OUTCOMES = ['ran', 'skipped', 'failed-to-run'] as const;
const RULING_SCOPES = ['none', 'requested-ambiguities', 'all-active'] as const;
const CAPABILITY_STATUSES = [
  'available',
  'blocked',
  'not-evaluated-offline',
] as const;
const BANDS = ['must-consider', 'related', 'exploratory'] as const;
const BLOCKER_IDS = ['B1', 'B2', 'B3', 'B4', 'B5'] as const;
const BLOCKER_STATUSES = [
  'repaired',
  'unrepaired',
  'not-discriminable',
] as const;
const CAPABILITY_OUTCOMES = [
  'available',
  'blocked',
  'not-a-capability-outcome',
] as const;
const SUBJECT_SOURCES = [
  'runtime-result',
  'pre-model-binding',
  'unavailable',
] as const;
const AUDIT_ACTIONS = ['accept', 'repair', 'retry', 'fail'] as const;
const FAILURE_STAGES = ['scenario', 'stack', 'blockers', 'discovery'] as const;

/** M3 reads each route's class/trigger/signal identity; M1/M2 read the rest. */
function checkRoutes(value: unknown, path: string): void {
  each(value, path, (route, at) => {
    const fields = asObject(route, at);
    asString(fields.routeClass, `${at}.routeClass`);
    asString(fields.trigger, `${at}.trigger`);
    asString(fields.signalId, `${at}.signalId`);
    asObject(fields.evidence, `${at}.evidence`);
  });
}

/**
 * The ambiguity identity M5 consumes, in every place it consumes one.
 *
 * `unqueriedAmbiguityIds` and `unresolvedAmbiguityIds` both read `id` and then
 * `.filter((id) => typeof id === 'string')`. Validating only that the container
 * is an array of objects would let `{}` or `{id: 7}` be stored and then simply
 * vanish from the measurement — the same "malformed identity becomes absence"
 * defect the reader exists to prevent.
 */
function checkAmbiguityIdentity(value: unknown, path: string): void {
  asString(asObject(value, path).id, `${path}.id`);
}

/** The jhpt-owned projection identity the packet carries as evidence. */
function checkRuleIdentity(value: unknown, path: string): void {
  asString(asObject(value, path).ruleIdentity, `${path}.ruleIdentity`);
}

/** M4 deep-equals a declared traversal against these. */
function checkTraversals(value: unknown, path: string): void {
  each(value, path, (traversal, at) => {
    const fields = asObject(traversal, at);
    for (const key of [
      'sourceRecordKey',
      'linkField',
      'relation',
      'targetRecordKey',
    ])
      asString(fields[key], `${at}.${key}`);
  });
}

function checkDrops(value: unknown, path: string): void {
  each(value, path, (drop, at) => {
    const fields = asObject(drop, at);
    asString(fields.candidateKey, `${at}.candidateKey`);
    asEnum(fields.band, `${at}.band`, BANDS);
    asString(fields.reason, `${at}.reason`);
    checkRoutes(fields.routes, `${at}.routes`);
  });
}

function checkStage(value: unknown, path: string): Record<string, unknown> {
  const stage = asObject(value, path);
  asString(stage.stage, `${path}.stage`);
  asArray(stage.outputsProduced, `${path}.outputsProduced`);
  for (const key of ['produced', 'modified', 'carriedForward'])
    strings(stage[key], `${path}.${key}`);
  each(stage.losses, `${path}.losses`, (loss, at) => {
    const fields = asObject(loss, at);
    asString(fields.reason, `${at}.reason`);
    asObject(fields.detail, `${at}.detail`);
  });
  const outcome = asEnum(stage.outcome, `${path}.outcome`, STAGE_OUTCOMES);
  const failedToRun = asBoolean(stage.failedToRun, `${path}.failedToRun`);
  // Section 13.3 gives these two one meaning; a row where they disagree would
  // let a failed stage read as a pass in exactly one of the two places a
  // measurement looks.
  if (failedToRun !== (outcome === 'failed-to-run'))
    failAt(
      `${path}.failedToRun`,
      `is ${String(failedToRun)} while outcome is '${outcome}'`,
    );
  return stage;
}

function checkCandidateStage(value: unknown, path: string, banded: boolean) {
  const stage = checkStage(value, path);
  each(stage.outputsProduced, `${path}.outputsProduced`, (item, at) => {
    const fields = asObject(item, at);
    asString(fields.candidateKey, `${at}.candidateKey`);
    asString(fields.targetKind, `${at}.targetKind`);
    checkRoutes(fields.routes, `${at}.routes`);
    checkTraversals(fields.traversals, `${at}.traversals`);
    strings(fields.campaignRuleIdentities, `${at}.campaignRuleIdentities`);
    strings(fields.campaignRulingIdentities, `${at}.campaignRulingIdentities`);
    if (banded) asEnum(fields.band, `${at}.band`, BANDS);
  });
  return stage;
}

function checkRuleJoin(value: unknown, path: string): void {
  const stage = checkCandidateStage(value, path, false);
  for (const key of [
    'requestedRuleRecordKeys',
    'requestedAmbiguityIds',
    'returnedRuleIdentities',
    'returnedAmbiguityIds',
    'placedRuleIdentities',
    'unplacedRuleIdentities',
    'surfacedCandidateKeys',
    'resolvedAmbiguityIds',
  ])
    strings(stage[key], `${path}.${key}`);
  asEnum(stage.rulingQueryScope, `${path}.rulingQueryScope`, RULING_SCOPES);
  asBoolean(stage.ruleQueryExecuted, `${path}.ruleQueryExecuted`);
  asBoolean(stage.rulingQueryExecuted, `${path}.rulingQueryExecuted`);
  each(stage.placedRules, `${path}.placedRules`, (placed, at) => {
    const fields = asObject(placed, at);
    asString(fields.ruleIdentity, `${at}.ruleIdentity`);
    asString(fields.governingRecordKey, `${at}.governingRecordKey`);
  });
  // M5 reads these ids and filters non-strings, so a malformed identity would
  // become an ABSENCE from `unresolvedAmbiguityIds` rather than a rejection.
  each(
    stage.unresolvedAmbiguities,
    `${path}.unresolvedAmbiguities`,
    checkAmbiguityIdentity,
  );
}

function checkPacket(value: unknown, path: string): void {
  const stage = checkStage(value, path);
  asBoolean(stage.byteBudgetExceeded, `${path}.byteBudgetExceeded`);
  checkDrops(stage.byteOverflow, `${path}.byteOverflow`);
  checkDrops(stage.dropped, `${path}.dropped`);
  const packet = asObject(stage.packet, `${path}.packet`);
  asNumber(packet.bytes, `${path}.packet.bytes`);
  asArray(packet.projectionLimitNotes, `${path}.packet.projectionLimitNotes`);
  if (packet.modelUsageClaim !== null)
    failAt(`${path}.packet.modelUsageClaim`, 'expected the non-claim `null`');
  each(packet.candidates, `${path}.packet.candidates`, (item, at) => {
    const candidate = asObject(item, at);
    const identity = asObject(candidate.identity, `${at}.identity`);
    for (const key of ['key', 'kind', 'name'])
      asString(identity[key], `${at}.identity.${key}`);
    const provenance = asObject(candidate.provenance, `${at}.provenance`);
    asString(provenance.sourceRef, `${at}.provenance.sourceRef`);
    asString(provenance.source, `${at}.provenance.source`);
    if (!('license' in provenance))
      failAt(`${at}.provenance.license`, 'is absent');
    asObject(candidate.sourceProse, `${at}.sourceProse`);
    checkRoutes(candidate.routes, `${at}.routes`);
    checkTraversals(candidate.traversals, `${at}.traversals`);
    each(candidate.ambiguities, `${at}.ambiguities`, checkAmbiguityIdentity);
    for (const key of ['campaignRules', 'campaignRulings'])
      each(candidate[key], `${at}.${key}`, checkRuleIdentity);
    asArray(candidate.projectionLimits, `${at}.projectionLimits`);
    optional(candidate.capability, `${at}.capability`, (raw, where) => {
      const capability = asObject(raw, where);
      asEnum(capability.status, `${where}.status`, CAPABILITY_STATUSES);
      asString(capability.capabilityId, `${where}.capabilityId`);
      optional(capability.operationId, `${where}.operationId`, (x, w) => {
        asString(x, w);
      });
      optional(capability.variantId, `${where}.variantId`, (x, w) => {
        asString(x, w);
      });
      // M10 requires the identity a capability committed under before it will
      // compare anything, so a malformed revision must not read as absence.
      optional(capability.revision, `${where}.revision`, (x, w) => {
        asString(x, w);
      });
    });
  });
}

function checkTrace(value: unknown, path: string): void {
  const trace = asObject(value, path);
  checkStage(trace.signals, `${path}.signals`);
  each(
    (trace.signals as Record<string, unknown>).outputsProduced,
    `${path}.signals.outputsProduced`,
    (item, at) => {
      const signal = asObject(item, at);
      asString(signal.signalId, `${at}.signalId`);
      asString(signal.kind, `${at}.kind`);
      asString(signal.proposes, `${at}.proposes`);
    },
  );
  for (const key of [
    'unconsumedStateFields',
    'stateBindings',
    'ambiguousNames',
  ])
    asArray((trace.signals as Record<string, unknown>)[key], `${path}.${key}`);
  strings(
    (trace.signals as Record<string, unknown>).oracleSuppliedSignalLabels,
    `${path}.signals.oracleSuppliedSignalLabels`,
  );

  const candidates = checkCandidateStage(
    trace.candidates,
    `${path}.candidates`,
    false,
  );
  strings(candidates.unresolvedTargets, `${path}.candidates.unresolvedTargets`);
  for (const key of ['expansion', 'ruleExpansion']) {
    const stage = checkCandidateStage(trace[key], `${path}.${key}`, false);
    checkTraversals(stage.traversals, `${path}.${key}.traversals`);
  }
  checkRuleJoin(trace.ruleJoin, `${path}.ruleJoin`);
  checkRuleJoin(trace.lateRuleJoin, `${path}.lateRuleJoin`);
  const dedup = checkCandidateStage(trace.dedup, `${path}.dedup`, false);
  for (const key of ['routeCountBeforeDedup', 'routeCountAfterDedup'])
    for (const [name, count] of Object.entries(
      asObject(dedup[key], `${path}.dedup.${key}`),
    ))
      asNumber(count, `${path}.dedup.${key}.${name}`);
  const retention = checkCandidateStage(
    trace.retention,
    `${path}.retention`,
    true,
  );
  checkDrops(retention.dropped, `${path}.retention.dropped`);
  checkDrops(retention.overflow, `${path}.retention.overflow`);
  asBoolean(retention.overflowed, `${path}.retention.overflowed`);
  checkPacket(trace.packet, `${path}.packet`);

  strings(trace.unexpandedPromotions, `${path}.unexpandedPromotions`);
  strings(trace.stageOrder, `${path}.stageOrder`);
  const stack = asObject(trace.stack, `${path}.stack`);
  const packIdentity: Check = (raw, where) => {
    const pack = asObject(raw, where);
    for (const key of ['systemId', 'packId', 'version', 'role'])
      asString(pack[key], `${where}.${key}`);
  };
  packIdentity(stack.base, `${path}.stack.base`);
  each(stack.addons, `${path}.stack.addons`, packIdentity);
}

function assertV1(stored: Record<string, unknown>): void {
  asString(stored.campaignPosition, 'campaignPosition');
  asString(stored.capturedAt, 'capturedAt');
  if (stored.modelUsageClaim !== null)
    failAt('modelUsageClaim', 'expected the recorded non-claim `null`');

  const scenario = asObject(stored.scenario, 'scenario');
  asString(scenario.playerInput, 'scenario.playerInput');
  strings(scenario.stateFieldRoots, 'scenario.stateFieldRoots');
  strings(scenario.adventureSeatNotes, 'scenario.adventureSeatNotes');
  each(scenario.itemInstances, 'scenario.itemInstances', (item, at) => {
    const binding = asObject(item, at);
    asString(binding.instanceId, `${at}.instanceId`);
    asString(binding.recordKey, `${at}.recordKey`);
    optional(binding.variantId, `${at}.variantId`, (x, w) => {
      asString(x, w);
    });
  });
  optional(scenario.adventure, 'scenario.adventure', (raw, where) => {
    const seat = asObject(raw, where);
    asString(seat.moduleId, `${where}.moduleId`);
    for (const key of ['locationId', 'encounterId'])
      optional(seat[key], `${where}.${key}`, (x, w) => {
        asString(x, w);
      });
  });

  // Baseline qualification reads these, so a malformed one would let a capture
  // be read as a baseline on a status nothing produced.
  each(stored.blockerRepairs, 'blockerRepairs', (item, at) => {
    const observation = asObject(item, at);
    asEnum(observation.blockerId, `${at}.blockerId`, BLOCKER_IDS);
    asEnum(observation.status, `${at}.status`, BLOCKER_STATUSES);
    asString(observation.owner, `${at}.owner`);
    asString(observation.evidence, `${at}.evidence`);
    strings(observation.gates, `${at}.gates`);
  });

  const runtime = asObject(stored.runtime, 'runtime');
  each(
    runtime.capabilityInvocations,
    'runtime.capabilityInvocations',
    (item, at) => {
      const fields = asObject(item, at);
      asString(fields.tool, `${at}.tool`);
      asEnum(fields.outcome, `${at}.outcome`, CAPABILITY_OUTCOMES);
      asEnum(fields.subjectSource, `${at}.subjectSource`, SUBJECT_SOURCES);
      for (const key of [
        'instanceId',
        'operationId',
        'recordKey',
        'variantId',
        'capabilityId',
        'capabilityRevision',
      ])
        optional(fields[key], `${at}.${key}`, (x, w) => {
          asString(x, w);
        });
    },
  );
  each(runtime.auditAttempts, 'runtime.auditAttempts', (item, at) => {
    const fields = asObject(item, at);
    asNumber(fields.attempt, `${at}.attempt`);
    asString(fields.verdict, `${at}.verdict`);
    asEnum(fields.action, `${at}.action`, AUDIT_ACTIONS);
    strings(fields.missingTools, `${at}.missingTools`);
    if (fields.retryCause !== null)
      asString(fields.retryCause, `${at}.retryCause`);
  });

  const hasTrace = stored.trace !== undefined && stored.trace !== null;
  const hasFailure = stored.failure !== undefined && stored.failure !== null;
  if (hasTrace === hasFailure)
    failAt(
      'trace/failure',
      hasTrace
        ? 'it carries both a trace and a failure'
        : 'it carries neither a trace nor a failure',
    );
  if (hasFailure) {
    const failure = asObject(stored.failure, 'failure');
    asEnum(failure.stage, 'failure.stage', FAILURE_STAGES);
    asString(failure.message, 'failure.message');
    return;
  }
  checkTrace(stored.trace, 'trace');
}

/**
 * Read shadow evidence back off a recorded turn trace.
 *
 * A stored value carrying a schema tag this build does not know is an error,
 * not an absence: measuring it as if it were absent would report a green
 * nothing for a capture that exists. Same-version corruption fails closed the
 * same way, through {@link assertV1}.
 */
export function readDiscoveryShadowEvidence(
  stored: TraceJsonValue | undefined,
): DiscoveryShadowEvidence | undefined {
  if (stored === undefined || stored === null) return undefined;
  if (!isObject(stored))
    throw new DiscoveryShadowSchemaError(
      'recorded discovery shadow evidence is not a JSON object',
    );
  const schema = stored.schema;
  if (schema !== DISCOVERY_SHADOW_SCHEMA)
    throw new DiscoveryShadowSchemaError(
      `recorded discovery shadow evidence has schema '${String(schema)}', not '${DISCOVERY_SHADOW_SCHEMA}'`,
    );
  assertV1(stored);
  return stored as unknown as DiscoveryShadowEvidence;
}
