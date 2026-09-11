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
  CandidateDisposition,
  CapabilityPreflight,
  ContextPacket,
  DiscoveryCandidate,
  OfflineCapabilityDeclaration,
  PacketCandidate,
  PacketTrace,
  ProjectionLimitNote,
  RecordDataResidue,
  RetentionOverflow,
  RetentionTrace,
} from './types.js';

/**
 * Amendment A2 (`eshyra-o9bd.19.13`): a ruling reaches a bounded capability
 * only through the `eshyra-jhpt` read interface, and reaching it changes
 * nothing about readiness. Stated as an exclusion so a consumer of the packet
 * cannot read the ruling's presence as authorization.
 */
const CAMPAIGN_RULING_EXCLUSION =
  'A campaign ruling supplied through the eshyra-jhpt read interface selects an interpretation only; it does not satisfy, weaken, or green any clause of this readiness contract.';

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
 * W10's stated source/projection boundary (PR #543 review finding F2).
 *
 * The reviewer verified two things that force this design: `RulesRecord.data`
 * is typed `unknown` (`rules/types.ts`) with NO per-field provenance, so there
 * is no existing boundary to read out of the data — this constant states one,
 * for the first time, with its reasoning recorded here; and a field-name
 * allow/deny list (naming `ability`, `dice`, `damageOnSuccess`, ...) is
 * explicitly rejected as not being a provenance boundary either, because it
 * grows forever and still says nothing about material the importer has not
 * been taught to name yet.
 *
 * Instead: the rules-pack COMPILER already routes every derived value it
 * computes — as opposed to transcribes — into one of a small, closed set of
 * named containers. A key that matches one of these names, AT ANY DEPTH in a
 * record body, makes everything beneath it a typed projection; everything
 * else is source material the compiler extracted but did not interpret. This
 * is positional, not top-level-only, because the compiler nests containers
 * inside per-entry structures (`creature:adult-black-dragon`
 * `data.actions[5].mechanics` sits beside that action's own `.text`) — a
 * top-level-only rule would leave every nested container misclassified as
 * source prose, which is the same defect this constant exists to fix.
 *
 * Verified against the real `dnd5e-srd-5.1` pack (`records.json`, 1812
 * records) rather than taken on the spec's word:
 *
 * - `mechanics` — 2268 occurrences, both top-level (`spell`, `feat`, `feature`,
 *   `condition`, `hazard`, `magic-item`, `action`, `stat-block`) and nested
 *   three levels deep inside `creature` `actions`/`legendaryActions`/
 *   `reactions` entries. The spec-named container this repair was written
 *   against.
 * - `upcast` — 92 occurrences, always top-level on `spell` records
 *   (`data.upcast`, e.g. `fireball:higher-slot`). Spec-named.
 * - `executionReadiness` — 240 occurrences, always top-level on `magic-item`
 *   records (`derived-magic-item-clauses-v1` engine-hook clauses).
 *   Spec-named.
 * - `projection` — 22 occurrences, always top-level on `table` records
 *   (`kindSchemas.ts`'s table-projection validators: `beastShapeOptions`,
 *   `destroyUndead`, trade-goods and service-price rows, ...). NOT named by
 *   the review; found during verification. Structurally identical to
 *   `mechanics` — a `kind`-discriminated, importer-computed object — so
 *   omitting it would leave every table's derived rows misclassified as
 *   source prose, repeating the exact defect class this bead exists to fix.
 *   Added.
 * - `useProfile` — 35 occurrences, always top-level on `equipment` records
 *   (consumption kind, clause ids, owner attribution, structured semantics;
 *   `kindSchemas.ts` `validateEquipmentUseProfile`). Also not named by the
 *   review; also found during verification; also structurally identical in
 *   kind to `mechanics` (it even carries its own quoted source phrases, e.g.
 *   `clauses[].sourcePhrase`, exactly as `mechanics.scaling.sourceText` does
 *   — see the projection-quotes-source-text note below). Added.
 *
 * Nothing else in the corpus's 108 distinct top-level `data` keys carries this
 * shape: fields such as `armorClass`, `hitPoints`, `abilityScores`, or
 * `speed` are structured, but they are the compiler's direct transcription of
 * a stat block header, not an interpretation that could omit rule nuance the
 * way a save DC, a damage die, or a recharge clause can — W10's disclosure
 * obligation (design section 7.2) is about the latter. If a future importer
 * change adds a genuinely interpretive container under a different name, this
 * comment — and this constant, and nothing else — is where it is declared.
 *
 * A container can quote the very source text it was derived from (e.g.
 * `mechanics.scaling.sourceText`, `upcast.sourcePhrase`,
 * `useProfile.clauses[].sourcePhrase`). That string stays classified as
 * projection: it is the projection's own record of what it derived from, not
 * an independent source citation, and the record body's top-level prose
 * fields (`description`, `higherLevels`, `scalingSourceText`, ...) already
 * carry the same text as genuine source material. Pulling the quoted copy
 * back out case-by-case would be the first entry in the leaf-name list this
 * design forbids.
 */
// A plain readonly array, not a module-scope `Set`: `discoveryOwnership.ts`
// forbids discovery from holding a module-scope mutable container (it cannot
// tell a rule/ruling CACHE apart from a fixed lookup literal by syntax alone,
// so it bans the shape outright), and this constant is exactly the accepted
// alternative its own test fixture demonstrates.
const PROJECTION_CONTAINER_KEYS: readonly string[] = [
  'mechanics',
  'upcast',
  'executionReadiness',
  'projection',
  'useProfile',
];

function isPlainObject(value: unknown): value is Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** What `splitRecordBody` calls a shape it declined to classify, so a residue
 * entry says WHAT was unrepresentable rather than just WHERE. */
function residueShape(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'function') return 'function';
  if (typeof value === 'symbol') return 'symbol';
  if (typeof value === 'bigint') return 'bigint';
  const ctor = (value as { constructor?: { name?: string } })?.constructor;
  return `non-plain-object:${ctor?.name ?? 'unknown'}`;
}

interface Split {
  /** `undefined` means this value contributed nothing on this side. */
  readonly source: unknown;
  readonly projection: unknown;
}

/**
 * Partition one record-body value into source material and typed projection
 * along `PROJECTION_CONTAINER_KEYS`, recording anything it cannot classify as
 * residue rather than guessing.
 *
 * `projecting` is the walk's only piece of state: once a key matches a
 * container, every descendant inherits `projecting: true` and can never
 * become source again, which is what makes
 * `creature:adult-black-dragon`'s `data.actions[5].mechanics` fully projection
 * while its sibling `.text` stays source, at the SAME recursion depth. Arrays
 * stay index-aligned on both sides (an index with nothing on one side gets
 * `null` there, never a shift) because a JSON pointer's array index is
 * positional, and `sourceMaterial`/`projection` must stay independently
 * addressable at the pointers callers already use (M9's `typedPath` facts,
 * design section 7.1's `actions[i].text`).
 */
function splitRecordBody(
  value: unknown,
  pointer: string,
  projecting: boolean,
  residue: RecordDataResidue[],
): Split {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return projecting
      ? { source: undefined, projection: value }
      : { source: value, projection: undefined };
  if (Array.isArray(value)) {
    const sourceItems: unknown[] = [];
    const projectionItems: unknown[] = [];
    let sourceContributed = false;
    let projectionContributed = false;
    value.forEach((item, index) => {
      const child = splitRecordBody(
        item,
        `${pointer}/${index}`,
        projecting,
        residue,
      );
      sourceItems.push(child.source === undefined ? null : child.source);
      projectionItems.push(
        child.projection === undefined ? null : child.projection,
      );
      if (child.source !== undefined) sourceContributed = true;
      if (child.projection !== undefined) projectionContributed = true;
    });
    return {
      source: sourceContributed ? sourceItems : undefined,
      projection: projectionContributed ? projectionItems : undefined,
    };
  }
  if (isPlainObject(value)) {
    const sourceOut: Obj = {};
    const projectionOut: Obj = {};
    for (const [key, child] of Object.entries(value)) {
      const childProjecting =
        projecting || PROJECTION_CONTAINER_KEYS.includes(key);
      const result = splitRecordBody(
        child,
        `${pointer}/${key}`,
        childProjecting,
        residue,
      );
      if (result.source !== undefined) sourceOut[key] = result.source;
      if (result.projection !== undefined)
        projectionOut[key] = result.projection;
    }
    return {
      source: Object.keys(sourceOut).length > 0 ? sourceOut : undefined,
      projection:
        Object.keys(projectionOut).length > 0 ? projectionOut : undefined,
    };
  }
  // A shape plain JSON cannot represent (function, symbol, bigint, or a
  // non-plain object such as a Date or Map). The real pack is parsed JSON and
  // never produces one; this branch exists because `RulesRecord.data` is
  // typed `unknown`, and a defect that silently assigned this to either side
  // is exactly what the review forbids ("do not invent a third silent
  // default").
  residue.push({ pointer, shape: residueShape(value) });
  return { source: undefined, projection: undefined };
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
  // The jhpt projection, passed through: a ruling is on this candidate because
  // its own `governingRecordKeys` named this record, and discovery neither
  // re-derives that association nor reshapes what the owner returned.
  const rulings = candidate.campaignRulings;
  const rulingFields = rulings.length === 0 ? {} : { campaignRulings: rulings };
  const rulingExclusions =
    rulings.length === 0 ? [] : [CAMPAIGN_RULING_EXCLUSION];
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
      ...rulingFields,
      // The contract's own identity and operation, quoted rather than
      // restated (design section 7.1).
      capabilityId: contract.operationId,
      revision: contract.revision,
      operationId,
      variantId,
      readinessInput,
      inputs: contract.requiredInputs,
      exclusions: [...contract.exclusions, ...rulingExclusions],
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
      ...rulingFields,
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
        ...rulingExclusions,
      ],
      residualInterpretation:
        'An engine owner must resolve the named readiness clauses. ' +
        contract.residualDmInterpretation.join(' '),
    };
  }
}
/**
 * Run the W10 source/projection split (`splitRecordBody`) over one candidate's
 * record body and shape the result exactly like the pre-F2 `sourceProse` it
 * replaces: always wrapped the same way (an adventure entity unwrapped, a pack
 * record under `data`) and always present, even when a side is empty, so a
 * caller's JSON pointer resolves the same root it always did.
 */
function splitBody(
  body: Obj,
  pointerPrefix: string,
): {
  readonly sourceMaterial: Obj;
  readonly projection: Obj;
  readonly residue: readonly RecordDataResidue[];
} {
  const residue: RecordDataResidue[] = [];
  const result = splitRecordBody(body, pointerPrefix, false, residue);
  return {
    sourceMaterial: (result.source as Obj | undefined) ?? {},
    projection: (result.projection as Obj | undefined) ?? {},
    residue,
  };
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
    // Unwrapped, matching the entity's own shape: today's authored modules
    // carry none of `PROJECTION_CONTAINER_KEYS`, so this is a no-op split, not
    // dead code — a future authored container would be caught by the same
    // rule a pack record is, rather than by a second, kind-specific one.
    const split = splitBody(entity, '');
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
      sourceMaterial: split.sourceMaterial,
      projection: split.projection,
      residue: split.residue,
      routes: candidate.routes,
      traversals: candidate.traversals,
      ambiguities: [],
      campaignRules: candidate.campaignRules,
      campaignRulings: candidate.campaignRulings,
      projectionLimits: [],
    };
  }
  const record = candidate.entry.record;
  const split = splitBody(object(record.data) ?? {}, '/data');
  return {
    identity: { key: record.key, kind: record.kind, name: record.name },
    provenance: {
      sourceRef: record.provenance.sourceRef,
      locator: record.provenance.locator,
      source: record.source,
      license: candidate.entry.license,
    },
    sourceMaterial: { data: split.sourceMaterial },
    projection: { data: split.projection },
    residue: split.residue,
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
  // ONE decision per retained candidate, recorded AT the byte comparison that
  // makes it. An exclusion's reason is the budget arithmetic that excluded it,
  // authored here and nowhere else: the included-candidate list below says what
  // the packet holds, which cannot say why anything is missing from it.
  const decisions: CandidateDisposition[] = [];
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
      decisions.push({
        candidateKey: item.candidate.candidateKey,
        retained: true,
      });
      kept.push(item.packet);
      bytes += cost;
      continue;
    }
    const reason = `packet byte budget: candidate needs ${cost} bytes, ${maxPacketBytes - bytes} remain`;
    decisions.push({
      candidateKey: item.candidate.candidateKey,
      retained: false,
      reason,
    });
    const record = {
      candidateKey: item.candidate.candidateKey,
      band: item.band,
      routes: item.candidate.routes,
      reason,
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
    decisions,
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
