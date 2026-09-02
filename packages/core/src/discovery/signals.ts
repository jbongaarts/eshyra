/**
 * Stage 1 of the offline discovery pilot. The cue table below is deliberately
 * tiny and structured: it is evidence about this pilot, not a model of how
 * rules become relevant. A missing cue is evidence about the pilot, never the
 * rules corpus. `auditor-missing-target` is a declared route with no extractor
 * in this phase because no diagnostic fixture exercises it.
 */
import { normalizeRulesRecordName } from '../rules/stack.js';
import { RULES_RECORD_KINDS, type RulesRecordKind } from '../rules/types.js';
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

export function extractDiscoverySignals(
  scenario: DiscoveryScenario,
  stack: {
    recordsByKind: ReadonlyMap<
      RulesRecordKind,
      { byName: ReadonlyMap<string, readonly { record: { key: string } }[]> }
    >;
  },
): SignalsTrace {
  const signals: DiscoverySignal[] = [];
  const consumed = new Set<string>();
  const bindings: ScenarioStateBinding[] = [];
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
    if (leaf.path.endsWith('/operationId') && typeof leaf.value === 'string') {
      const boundInstance = scenario.itemInstances?.find((item) =>
        Object.values(scenario.stateFields).includes(item.instanceId),
      );
      const itemRecord =
        typeof scenario.stateFields.itemRecord === 'string'
          ? scenario.stateFields.itemRecord
          : boundInstance?.recordKey;
      // The variant travels with the operation so the preflight derives and
      // gates on the same variant identity `useItem` supplies at runtime.
      const variantId =
        typeof scenario.stateFields.variantId === 'string'
          ? scenario.stateFields.variantId
          : boundInstance?.variantId;
      if (typeof itemRecord === 'string' && KEY_RE.test(itemRecord)) {
        signals.push(
          signal(
            'capability-preflight',
            itemRecord,
            {
              path: leaf.path,
              operationId: leaf.value,
              itemRecord,
              ...(variantId === undefined ? {} : { variantId }),
            },
            index++,
            leaf.value,
          ),
        );
        consumed.add(leaf.path);
      }
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
