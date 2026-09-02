import type { RulesAmbiguity } from '../rules/types.js';
import {
  assertMagicItemOperationReady,
  ItemExecutionReadinessError,
  MAGIC_ITEM_OPERATION_READINESS_CAPABILITY,
} from '../state/itemExecutionReadiness.js';
import {
  deriveItemOperationReadinessInput,
  ItemStateError,
} from '../state/itemState.js';
import type {
  CapabilityPreflight,
  ContextPacket,
  DiscoveryCandidate,
  OfflineCapabilityDeclaration,
  PacketCandidate,
  PacketTrace,
  ProjectionLimitNote,
  RetentionOverflow,
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
/**
 * Every place a typed save projection lives, with the JSON pointer that
 * addresses it. Creature actions carry their own nested `mechanics`, so a
 * detector that looked only at `data.mechanics.saves` silently produced no
 * note for `creature:adult-black-dragon` Acid Breath — the exact case design
 * section 7.2 names as a worked example of a required disclosure.
 */
function saveProjections(data: Obj): readonly {
  pointer: string;
  saves: readonly unknown[];
  area: unknown;
  localProse: string;
}[] {
  const found: {
    pointer: string;
    saves: readonly unknown[];
    area: unknown;
    localProse: string;
  }[] = [];
  const push = (pointer: string, holder: Obj | undefined, scope: unknown) => {
    const mechanics = object(holder?.mechanics);
    if (mechanics === undefined || !Array.isArray(mechanics.saves)) return;
    found.push({
      pointer: `${pointer}/mechanics/saves`,
      saves: mechanics.saves,
      area: mechanics.area,
      // Scoped to this projection's own prose. A record-wide test let one
      // action's success branch raise a spurious note on a sibling action
      // whose save has no damage at all (Frightful Presence borrowing Acid
      // Breath's "half as much").
      localProse: prose(scope).join('\n'),
    });
  };
  push('/data', data, data);
  for (const field of ['actions', 'legendaryActions', 'reactions'] as const) {
    const entries = data[field];
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry, index) => {
      push(`/data/${field}/${index}`, object(entry), entry);
    });
  }
  return found;
}

/**
 * Bounded, linear-time area recognizer.
 *
 * The previous expression used an unanchored `\d+` before `-foot` over
 * arbitrary record prose, which CodeQL correctly flagged as a polynomial
 * regular expression on uncontrolled data: a long run of digits that never
 * reaches `-foot` costs quadratic work across start positions. Distances in
 * the corpus are at most a few digits, so the repetition is bounded and the
 * match is linear.
 *
 * The separator is `[ -]` because the corpus writes both forms: the Adult
 * Black Dragon's "60-foot line" and Fireball's "20-foot-radius sphere". An
 * earlier revision accepted only whitespace, so Fireball — one of the two
 * worked examples design section 7.2 names — never produced its required
 * area disclosure.
 */
const AREA_PROSE = /\d{1,4}-foot[ -](?:radius|line|cone|cube|sphere)/iu;
const SUCCESS_BRANCH_PROSE = /half as much|successful one/iu;

function projectionLimits(
  candidate: DiscoveryCandidate,
): ProjectionLimitNote[] {
  const record = candidate.entry?.record;
  const data = object(record?.data);
  if (record === undefined || data === undefined) return [];
  const text = prose(record.data).join('\n');
  const notes: ProjectionLimitNote[] = [];
  const projections = saveProjections(data);
  for (const projection of projections) {
    if (
      !projection.saves.some(
        (item) => object(item)?.damageOnSuccess === undefined,
      ) ||
      !SUCCESS_BRANCH_PROSE.test(projection.localProse)
    )
      continue;
    notes.push({
      kind: 'success-branch',
      note: 'The typed save projection omits the source success branch; source prose remains authoritative context.',
      evidence: { path: projection.pointer, missing: 'damageOnSuccess' },
      preservedProse: projection.localProse,
    });
  }
  if (
    AREA_PROSE.test(text) &&
    projections.every((projection) => projection.area === undefined) &&
    object(data.mechanics)?.area === undefined
  )
    notes.push({
      kind: 'area',
      note: 'The source describes an area, but no typed mechanics.area projection exists.',
      evidence: { missing: 'mechanics.area' },
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
/**
 * Capability presentation for one candidate.
 *
 * The only capability this offline phase can positively establish is W13's
 * `MAGIC_ITEM_OPERATION_READINESS_CAPABILITY`, whose declared operation is
 * `assertMagicItemOperationReady` and which explicitly excludes executing the
 * item operation or supplying missing item semantics. A green readiness
 * preflight is therefore reported AS that readiness capability. It is not
 * promoted into a different, execution-shaped capability: an earlier revision
 * relabelled a green single-use economy as `magic-item-single-use-spend` while
 * copying the readiness contract's revision, inputs, and exclusions, which
 * asserted an execution commitment no contract backs and no code here
 * performs. If a single-use spend capability is wanted, it needs its own
 * contract bound to the real `use_item` execution and state-effect boundary.
 *
 * The preflight runs ONLY for a candidate carrying a `capability-preflight`
 * route, and only for the operation and variant that route selected. Falling
 * back to a scenario-global `operationId` would preflight unrelated magic
 * items that merely happen to be in context.
 */
function capability(
  candidate: DiscoveryCandidate,
  declarations: readonly OfflineCapabilityDeclaration[],
): CapabilityPreflight | undefined {
  const route = candidate.routes.find(
    (item) => item.routeClass === 'capability-preflight',
  );
  const operationId =
    typeof route?.evidence.operationId === 'string'
      ? route.evidence.operationId
      : undefined;
  const variantId =
    typeof route?.evidence.variantId === 'string'
      ? route.evidence.variantId
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
  const contract = MAGIC_ITEM_OPERATION_READINESS_CAPABILITY;
  try {
    const readinessInput = deriveItemOperationReadinessInput(
      candidate.entry.record,
      variantId,
      operationId,
    );
    assertMagicItemOperationReady(
      candidate.entry.record,
      variantId,
      readinessInput,
    );
    return {
      status: 'available',
      // The contract's own identity and operation, quoted rather than
      // restated (design section 7.1).
      capabilityId: contract.operationId,
      revision: contract.revision,
      operationId,
      variantId,
      readinessInput,
      inputs: contract.requiredInputs,
      exclusions: contract.exclusions,
      residualInterpretation: contract.residualDmInterpretation.join(' '),
    };
  } catch (error) {
    // A record that declares no such operation raises ItemStateError from the
    // derivation. That is a blocked preflight, not a harness crash: letting it
    // escape would tear down packet construction for every other candidate.
    if (
      !(error instanceof ItemExecutionReadinessError) &&
      !(error instanceof ItemStateError)
    )
      throw error;
    return {
      status: 'blocked',
      capabilityId: contract.operationId,
      revision: contract.revision,
      operationId,
      variantId,
      blockingClauseIds: [
        ...error.message.matchAll(
          /([\w:-]{1,120}\/c\d{1,3}(?:-[\w-]{1,120})?)/gu,
        ),
      ].map((match) => match[1]),
      message: error.message,
      inputs: contract.requiredInputs,
      exclusions: [
        'A blocked readiness contract cannot be treated as an executable capability.',
        ...contract.exclusions,
      ],
      residualInterpretation:
        'An engine owner must resolve the named readiness clauses. ' +
        contract.residualDmInterpretation.join(' '),
    };
  }
}
function packetCandidate(
  candidate: DiscoveryCandidate,
  declarations: readonly OfflineCapabilityDeclaration[],
): PacketCandidate {
  if (candidate.routes.length === 0)
    throw new Error(
      `route-free candidate '${candidate.candidateKey}' cannot enter context packet`,
    );
  if (candidate.entry === undefined) {
    const holder = candidate.adventureEntity ?? {};
    const entity = object(holder.entity) ?? {};
    const provenance = object(holder.provenance);
    return {
      identity: {
        key: candidate.candidateKey,
        kind: 'adventure-entity',
        name: String(entity.name ?? candidate.candidateKey),
      },
      // The authored module's real authority metadata, not a placeholder.
      provenance: {
        sourceRef: String(provenance?.sourceRef ?? ''),
        locator:
          typeof provenance?.locator === 'string'
            ? provenance.locator
            : undefined,
        source: String(holder.moduleId ?? 'adventure-module'),
        license: holder.license ?? null,
      },
      sourceProse: entity,
      routes: candidate.routes,
      traversals: candidate.traversals,
      ambiguities: [],
      campaignRules: candidate.campaignRules,
      campaignRulings: candidate.campaignRulings,
      projectionLimits: [],
    };
  }
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
    capability: capability(candidate, declarations),
    projectionLimits: projectionLimits(candidate),
  };
}
/**
 * Build the packet, enforcing BOTH budgets with the same contract.
 *
 * The byte budget was previously diagnostic only: the packet was built in full,
 * every candidate retained, and a flag set afterwards. That failed the section
 * 6.3 contract, which is about the packet budget — M6 must fail and the
 * overflow record must name the affected candidates and their routes. Bytes
 * are charged in retention rank order (must-consider first), so a byte budget
 * behaves exactly like the candidate-count budget: related and exploratory
 * candidates are dropped with recorded reasons, and a must-consider candidate
 * that cannot fit is an explicit overflow that fails the probe.
 */
export function buildContextPacket(
  retained: RetentionTrace,
  declarations: readonly OfflineCapabilityDeclaration[] = [],
  maxPacketBytes = 512_000,
): PacketTrace {
  const built = retained.outputsProduced.map((candidate) => ({
    band: candidate.band,
    candidate,
    packet: packetCandidate(candidate, declarations),
  }));
  const kept: PacketCandidate[] = [];
  const byteDropped: RetentionTrace['dropped'][number][] = [];
  const byteOverflow: RetentionOverflow[] = [];
  let bytes = 2; // the enclosing "[]" of the serialized candidate list
  for (const item of built) {
    // Each entry costs its own serialization plus the separating comma.
    const cost =
      Buffer.byteLength(JSON.stringify(item.packet), 'utf8') +
      (kept.length === 0 ? 0 : 1);
    if (bytes + cost <= maxPacketBytes) {
      kept.push(item.packet);
      bytes += cost;
      continue;
    }
    const record = {
      candidateKey: item.candidate.candidateKey,
      band: item.band,
      routes: item.candidate.routes,
      reason: `packet byte budget: candidate needs ${cost} bytes, ${maxPacketBytes - bytes} remain`,
    };
    byteDropped.push(record);
    if (item.band === 'must-consider') byteOverflow.push(record);
  }
  const packet: ContextPacket = {
    candidates: kept,
    bytes: Buffer.byteLength(JSON.stringify(kept), 'utf8'),
    projectionLimitNotes: kept.flatMap(
      (candidate) => candidate.projectionLimits,
    ),
    modelUsageClaim: null,
  };
  const dropped = [...retained.dropped, ...byteDropped];
  return {
    stage: 'packet',
    inputsConsumed: retained.outputsProduced.map((candidate) => ({
      candidateKey: candidate.candidateKey,
    })),
    outputsProduced: kept,
    losses: dropped.map((item) => ({
      reason: item.reason,
      detail: item as unknown as Record<string, unknown>,
    })),
    produced: kept.map((candidate) => candidate.identity.key),
    modified: [],
    carriedForward: [],
    outcome:
      kept.length === 0 && dropped.length === 0 ? 'failed-to-run' : 'ran',
    failedToRun: kept.length === 0 && dropped.length === 0,
    packet,
    byteBudgetExceeded: byteOverflow.length > 0 || byteDropped.length > 0,
    byteOverflow,
    dropped,
  };
}
