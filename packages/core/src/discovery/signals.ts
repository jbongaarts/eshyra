/**
 * Stage 1 of the offline discovery pilot. The cue table below is deliberately
 * tiny and structured: it is evidence about this pilot, not a model of how
 * rules become relevant. A missing cue is evidence about the pilot, never the
 * rules corpus. `auditor-missing-target` is a declared route with no extractor
 * in this phase because no diagnostic fixture exercises it.
 */
import { normalizeRulesRecordName } from '../rules/stack.js';
import {
  RULES_RECORD_KINDS,
  type RulesRecord,
  type RulesRecordKind,
} from '../rules/types.js';
import {
  declaredItemOperationIds,
  ItemStateError,
} from '../state/itemState.js';
import type {
  AmbiguousNameObservation,
  DiscoveryScenario,
  DiscoverySignal,
  ScenarioStateBinding,
  SignalsTrace,
} from './types.js';

const KEY_RE = new RegExp(`^(?:${RULES_RECORD_KINDS.join('|')}):.+$`);
const OBSTACLE_WORDS = ['low wall', 'high wall', 'pillar', 'tree', 'rock'];

function shape(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(${value.length})`;
  return typeof value;
}

function leafEntries(
  value: unknown,
  path: string,
): readonly { path: string; value: unknown }[] {
  if (value === null || typeof value !== 'object') return [{ path, value }];
  const entries: { path: string; value: unknown }[] = [];
  if (Array.isArray(value)) {
    value.forEach((child, index) => {
      entries.push(...leafEntries(child, `${path}/${index}`));
    });
  } else {
    for (const [key, child] of Object.entries(value))
      entries.push(...leafEntries(child, `${path}/${key}`));
  }
  return entries;
}

function signal(
  kind: DiscoverySignal['kind'],
  proposes: string,
  evidence: Record<string, unknown>,
  index: number,
  operationId?: string,
): DiscoverySignal {
  return { signalId: `signal-${index}`, kind, proposes, evidence, operationId };
}

function cueSignals(
  scenario: DiscoveryScenario,
  index: number,
): DiscoverySignal[] {
  const result: DiscoverySignal[] = [];
  const state = scenario.stateFields;
  const combat = state.combat as Record<string, unknown> | undefined;
  if (
    typeof combat === 'object' &&
    combat !== null &&
    !Array.isArray(combat) &&
    typeof combat.geometry === 'string' &&
    OBSTACLE_WORDS.some((word) =>
      (combat.geometry as string).toLowerCase().includes(word),
    )
  ) {
    result.push(
      signal(
        'situation-cue',
        'rule:cover',
        {
          cueId: 'geometry-obstacle',
          path: '/combat/geometry',
          input: combat.geometry,
        },
        index++,
      ),
    );
  }
  const movement = state.movementIntent as Record<string, unknown> | undefined;
  if (
    typeof movement === 'object' &&
    movement !== null &&
    !Array.isArray(movement) &&
    movement.from === 'melee reach' &&
    movement.to === 'outside reach'
  ) {
    result.push(
      signal(
        'situation-cue',
        'rule:opportunity-attacks',
        {
          cueId: 'movement-out-of-reach',
          path: '/movementIntent',
          input: movement,
        },
        index++,
      ),
    );
  }
  const effects = state.activeEffects;
  const conditions = state.conditions;
  if (
    Array.isArray(effects) &&
    effects.some(
      (effect) =>
        typeof effect === 'object' &&
        effect !== null &&
        !Array.isArray(effect) &&
        (effect as Record<string, unknown>).kind === 'concentration',
    ) &&
    Array.isArray(conditions) &&
    conditions.length > 0
  ) {
    result.push(
      signal(
        'situation-cue',
        'rule:concentration',
        {
          cueId: 'concentration-under-condition',
          paths: ['/activeEffects', '/conditions'],
          input: { effects, conditions },
        },
        index++,
      ),
    );
  }
  return result;
}

function nameSignals(
  scenario: DiscoveryScenario,
  byKind: ReadonlyMap<
    RulesRecordKind,
    { byName: ReadonlyMap<string, readonly { record: { key: string } }[]> }
  >,
  index: number,
): { signals: DiscoverySignal[]; ambiguous: AmbiguousNameObservation[] } {
  const normalizedInput = normalizeRulesRecordName(
    scenario.playerInput,
  ).replace(/[^\p{L}\p{N}: -]/gu, ' ');
  const tokens = normalizedInput.split(/\s+/u).filter(Boolean);
  const signals: DiscoverySignal[] = [];
  const ambiguous: AmbiguousNameObservation[] = [];
  const seen = new Set<string>();
  for (const kind of RULES_RECORD_KINDS) {
    const names = byKind.get(kind)?.byName;
    if (names === undefined) continue;
    for (const [rawName, entries] of names) {
      const nameTokens = rawName.split(/\s+/u).filter(Boolean);
      if (nameTokens.length === 0 || nameTokens.length > tokens.length)
        continue;
      const found = Array.from(
        { length: tokens.length - nameTokens.length + 1 },
        (_, i) => tokens.slice(i, i + nameTokens.length).join(' ') === rawName,
      ).some(Boolean);
      if (!found) continue;
      const keys = [
        ...new Set(entries.map((entry) => entry.record.key)),
      ].sort();
      const evidence = {
        input: scenario.playerInput,
        matchedName: rawName,
        kind,
      };
      if (keys.length === 1) {
        const key = keys[0];
        if (!seen.has(key)) {
          signals.push(signal('name-mention', key, evidence, index++));
          seen.add(key);
        }
      } else {
        ambiguous.push({ name: rawName, keys, evidence });
      }
    }
  }
  return { signals, ambiguous };
}

/**
 * One (record, variant) identity the campaign genuinely holds pre-model,
 * enumerated for capability preflight. `path` is kept only for the resulting
 * signal's evidence trail — the leaf that first named this target — never for
 * identity: a target's identity is `recordKey` + `variantId`, so a record
 * reached by two different leaves is still preflighted once (see
 * `capabilityTargetKey`).
 */
interface CapabilityTarget {
  readonly path: string;
  readonly recordKey: string;
  readonly variantId?: string;
}

function capabilityTargetKey(
  recordKey: string,
  variantId: string | undefined,
): string {
  return `${recordKey}::${variantId ?? ''}`;
}

/**
 * Every operation id `record` declares for `variantId`, or an empty list if
 * the record cannot be read as a magic item under that variant.
 *
 * Offline discovery cannot fully validate a live campaign row before this
 * runs — an inventory item's own `variantId` could name a variant the record
 * no longer declares, or the "record" a state leaf named could be any kind at
 * all, not just `magic-item` (`declaredItemOperationIds` reads `mechanics`
 * generically; most record kinds simply declare no `operations` and no
 * `stateMachine`, so they fall out as an empty list without erroring). Either
 * way, a caller enumerating operations to preflight must not let one
 * unreadable target abort every other candidate's discovery, so this treats
 * `ItemStateError` (which also covers `MagicItemVariantError`; see
 * `mechanicsFor` in `itemState.ts`) as "declares no operations" rather than
 * letting it propagate.
 */
function operationIdsFor(
  record: RulesRecord,
  variantId: string | undefined,
): readonly string[] {
  try {
    return declaredItemOperationIds(record, variantId);
  } catch (error) {
    if (error instanceof ItemStateError) return [];
    throw error;
  }
}

export function extractDiscoverySignals(
  scenario: DiscoveryScenario,
  stack: {
    recordsByKey: ReadonlyMap<string, { record: RulesRecord }>;
    recordsByKind: ReadonlyMap<
      RulesRecordKind,
      { byName: ReadonlyMap<string, readonly { record: { key: string } }[]> }
    >;
  },
): SignalsTrace {
  const signals: DiscoverySignal[] = [];
  const consumed = new Set<string>();
  const bindings: ScenarioStateBinding[] = [];
  // First leaf path that named each literal record key directly (as opposed
  // to an opaque item-instance id resolved through `bindings` below) — the
  // second half of "an item instance the scenario binds (and each
  // state-referenced item record)" that F1's repair enumerates over.
  const stateReferencedItemPaths = new Map<string, string>();
  const leaves = Object.entries(scenario.stateFields).flatMap(([key, value]) =>
    leafEntries(value, `/${key}`),
  );
  let index = 0;
  for (const leaf of leaves) {
    if (typeof leaf.value === 'string' && KEY_RE.test(leaf.value)) {
      signals.push(
        signal(
          'state-ref',
          leaf.value,
          { path: leaf.path, value: leaf.value },
          index++,
        ),
      );
      consumed.add(leaf.path);
      if (!stateReferencedItemPaths.has(leaf.value))
        stateReferencedItemPaths.set(leaf.value, leaf.path);
    }
    const binding = scenario.itemInstances?.find(
      (item) => item.instanceId === leaf.value,
    );
    if (binding !== undefined) {
      bindings.push({ path: leaf.path, ...binding });
      signals.push(
        signal(
          'state-ref',
          binding.recordKey,
          {
            path: leaf.path,
            instanceId: binding.instanceId,
            recordKey: binding.recordKey,
          },
          index++,
        ),
      );
      consumed.add(leaf.path);
    }
  }
  // Capability preflight (W10 F1 repair, `eshyra-o9bd.19.12.9`): availability
  // is a property of a record the campaign genuinely holds plus the item's
  // own state, never a prediction of which operation the model will invoke
  // next — so this enumerates every operation the record declares for a
  // target that is genuinely present pre-model, instead of waiting for an
  // `/operationId` leaf real campaign state deliberately never carries.
  //
  // Two independent sources feed `capabilityTargets`, deduped onto one
  // (record, variant) identity each so a record reached both ways is
  // preflighted once, not twice:
  //
  // - a bound item INSTANCE (`bindings`, built above from
  //   `scenario.itemInstances`) carries its own `variantId` exactly as
  //   `useItem` receives it — the instance's actual variant. Variants
  //   themselves are never enumerated: that would preflight item states the
  //   campaign is not in.
  // - a record key named directly in state (`stateReferencedItemPaths`) has
  //   no instance to carry a variant of its own, so the one scenario-global
  //   `variantId` state field, when present, is the only variant identity
  //   available for it — the same fallback the pre-repair code used, just no
  //   longer gated on an `/operationId` leaf's presence.
  //
  // A record reached ONLY by name-mention (the player's words, not the
  // campaign's state) contributes no target here: naming an item is not the
  // campaign holding it, and preflighting on a mention would be exactly the
  // "predict the model's choice" mistake this repair removes, moved one hop
  // earlier.
  const capabilityTargets = new Map<string, CapabilityTarget>();
  for (const binding of bindings) {
    const key = capabilityTargetKey(binding.recordKey, binding.variantId);
    if (!capabilityTargets.has(key))
      capabilityTargets.set(key, {
        path: binding.path,
        recordKey: binding.recordKey,
        variantId: binding.variantId,
      });
  }
  const globalVariantId =
    typeof scenario.stateFields.variantId === 'string'
      ? scenario.stateFields.variantId
      : undefined;
  for (const [recordKey, path] of stateReferencedItemPaths) {
    const key = capabilityTargetKey(recordKey, globalVariantId);
    if (!capabilityTargets.has(key))
      capabilityTargets.set(key, {
        path,
        recordKey,
        variantId: globalVariantId,
      });
  }
  for (const target of capabilityTargets.values()) {
    const record = stack.recordsByKey.get(target.recordKey)?.record;
    if (record === undefined) continue;
    for (const operationId of operationIdsFor(record, target.variantId)) {
      signals.push(
        signal(
          'capability-preflight',
          target.recordKey,
          {
            path: target.path,
            operationId,
            itemRecord: target.recordKey,
            ...(target.variantId === undefined
              ? {}
              : { variantId: target.variantId }),
          },
          index++,
          operationId,
        ),
      );
    }
  }
  const adventure = scenario.adventure;
  if (adventure !== undefined) {
    const location =
      adventure.locationId === undefined
        ? undefined
        : adventure.module.locations.find(
            (candidate) => candidate.id === adventure.locationId,
          );
    if (location !== undefined)
      signals.push(
        signal(
          'adventure-ref',
          `${adventure.moduleId}#location:${location.id}`,
          {
            moduleId: adventure.moduleId,
            entityKind: 'location',
            entityId: location.id,
          },
          index++,
        ),
      );
    const encounter =
      adventure.encounterId === undefined
        ? undefined
        : adventure.module.encounters.find(
            (candidate) => candidate.id === adventure.encounterId,
          );
    if (encounter !== undefined) {
      signals.push(
        signal(
          'adventure-ref',
          `${adventure.moduleId}#encounter:${encounter.id}`,
          {
            moduleId: adventure.moduleId,
            entityKind: 'encounter',
            entityId: encounter.id,
          },
          index++,
        ),
      );
      for (const creature of encounter.creatures)
        signals.push(
          signal(
            'adventure-ref',
            creature.rulesRef,
            {
              moduleId: adventure.moduleId,
              entityKind: 'encounter',
              entityId: encounter.id,
              rulesRef: creature.rulesRef,
            },
            index++,
          ),
        );
    }
  }
  const names = nameSignals(scenario, stack.recordsByKind, index);
  signals.push(...names.signals);
  index += names.signals.length;
  signals.push(...cueSignals(scenario, index));
  index += signals.length;
  const allSignals = [...signals];
  for (const injected of scenario.oracleSignals ?? [])
    allSignals.push({
      ...injected,
      signalId: injected.signalId ?? `oracle-${allSignals.length}`,
      oracleSupplied: true,
    });
  return {
    stage: 'signals',
    inputsConsumed: leaves
      .filter((leaf) => consumed.has(leaf.path))
      .map((leaf) => ({ path: leaf.path })),
    outputsProduced: allSignals,
    losses: [],
    produced: allSignals.map((signal) => signal.signalId),
    modified: [],
    carriedForward: [],
    outcome: allSignals.length === 0 ? 'failed-to-run' : 'ran',
    failedToRun: allSignals.length === 0,
    unconsumedStateFields: leaves
      .filter((leaf) => !consumed.has(leaf.path))
      .map((leaf) => ({ path: leaf.path, valueShape: shape(leaf.value) })),
    stateBindings: bindings,
    ambiguousNames: names.ambiguous,
    oracleSuppliedSignalLabels: allSignals
      .filter((item) => item.oracleSupplied && item.oracleLabel !== undefined)
      .map((item) => item.oracleLabel as string),
  };
}
