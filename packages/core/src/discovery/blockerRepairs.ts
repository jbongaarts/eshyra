import type { ToolInputSchema } from '../model/toolSchema.js';
import { validateToolInput } from '../model/toolSchemaValidation.js';
import { lookupRulesRecord } from '../rules/lookup.js';
import type { ResolvedRulesStack } from '../rules/stack.js';
import type { RulesRecord } from '../rules/types.js';
import {
  assertMagicItemOperationReady,
  ItemExecutionReadinessError,
} from '../state/itemExecutionReadiness.js';

/**
 * Capture-time observation of the five pre-experiment blockers (design
 * section 9), recorded on every shadow capture.
 *
 * Design section 9.6 makes shadow evidence gathered before the applicable
 * repair "diagnostic only", never a baseline. A reader can only apply that
 * rule if the capture itself says which repairs were in force when it was
 * taken, so each probe OBSERVES the live condition rather than trusting a
 * bead's closure state or a constant compiled into this file.
 *
 * `not-discriminable` is a truthful third state, in the same sense design
 * section 13.3 gives `skipped`: the capture could not distinguish the repaired
 * condition from the broken one, so the probe reports that instead of a pass.
 * It is never evidence of repair.
 */
export type BlockerRepairStatus =
  | 'repaired'
  | 'unrepaired'
  | 'not-discriminable';

export interface BlockerRepairObservation {
  readonly blockerId: 'B1' | 'B2' | 'B3' | 'B4' | 'B5';
  readonly owner: string;
  readonly status: BlockerRepairStatus;
  /** What was observed, in the terms of the probe that observed it. */
  readonly evidence: string;
  /**
   * What section 9.6 forbids treating as a baseline while this blocker is
   * unrepaired. Empty for a blocker that gates nothing beyond itself.
   */
  readonly gates: readonly string[];
}

/** Structural view of the tool registry, so discovery imports no orchestrator. */
export interface BlockerToolSchemaSource {
  get(name: string): { readonly inputSchema: ToolInputSchema } | undefined;
}

export interface BlockerRepairProbeInput {
  readonly stack: ResolvedRulesStack;
  readonly tools: BlockerToolSchemaSource;
  /** Whether THIS turn was given an adventure-module resolver. */
  readonly adventureResolverSupplied: boolean;
}

const STARTING_WEALTH_KEY = 'table:starting-wealth-by-class';

/**
 * B5's probe pair. The two records differ ONLY in the clause's scope kind, and
 * the clause itself is green, so the control returns cleanly and a throw can be
 * attributed to nothing but the unrecognized scope. Matching the thrown message
 * instead would pin the probe to prose the owner is free to reword.
 */
function readinessProbeRecord(scopeKind: string): RulesRecord {
  return {
    systemId: 'discovery-blocker-probe',
    kind: 'magic-item',
    key: 'magic-item:discovery-blocker-probe',
    name: 'Discovery blocker probe',
    source: 'discovery blocker probe',
    data: {
      executionReadiness: {
        source: 'derived-magic-item-clauses-v1',
        clauses: [
          {
            clauseId: 'magic-item:discovery-blocker-probe/c1',
            scope: { kind: scopeKind },
            readiness: 'green',
            representation: { block: 'operations', operationId: 'probe' },
          },
        ],
      },
    },
  } as unknown as RulesRecord;
}

function probeReadinessScope(scopeKind: string): 'threw' | 'returned' {
  try {
    assertMagicItemOperationReady(readinessProbeRecord(scopeKind), undefined, {
      operationId: 'probe',
      economyIds: new Set<string>(),
      operationEffectIds: new Set<string>(),
      effectIds: new Set<string>(),
      usesStateMachine: false,
      usesSpellStore: false,
    });
    return 'returned';
  } catch (error) {
    if (error instanceof ItemExecutionReadinessError) return 'threw';
    throw error;
  }
}

function observeB1(input: BlockerRepairProbeInput): BlockerRepairObservation {
  const tool = input.tools.get('lookup_rules');
  const base = {
    blockerId: 'B1' as const,
    owner: 'eshyra-l3e5',
    gates: ['stat-block probe evidence'],
  };
  if (tool === undefined)
    return {
      ...base,
      status: 'not-discriminable',
      evidence:
        'the turn registry declares no lookup_rules tool, so the registry gate B1 describes could not be exercised',
    };
  // The defect was that ToolRegistry.invoke rejected the call before the tool
  // body ran, so the probe runs the registry's own schema gate rather than
  // reading the enum, and the control proves the gate accepts a kind that was
  // never in question.
  const statBlock = validateToolInput(tool.inputSchema, {
    kind: 'stat-block',
    ref: 'stat-block:giant-fly',
  });
  const control = validateToolInput(tool.inputSchema, {
    kind: 'spell',
    ref: 'spell:fireball',
  });
  if (control !== undefined)
    return {
      ...base,
      status: 'not-discriminable',
      evidence: `the lookup_rules schema gate rejected the control kind 'spell' (${control}), so a stat-block rejection would not isolate B1`,
    };
  return {
    ...base,
    status: statBlock === undefined ? 'repaired' : 'unrepaired',
    evidence:
      statBlock === undefined
        ? "the lookup_rules schema gate accepts kind 'stat-block'"
        : `the lookup_rules schema gate rejects kind 'stat-block': ${statBlock}`,
  };
}

function observeB2(input: BlockerRepairProbeInput): BlockerRepairObservation {
  return {
    blockerId: 'B2',
    owner: 'eshyra-seoh',
    gates: ['adventure-context evidence (probe P9)'],
    status: input.adventureResolverSupplied ? 'repaired' : 'unrepaired',
    evidence: input.adventureResolverSupplied
      ? 'this turn was supplied an adventure-module resolver'
      : 'this turn was given no adventure-module resolver, so its adventure context is empty by construction',
  };
}

/**
 * B3 asks whether the deterministic consumers resolve the campaign's exact
 * stack instead of a base-only bundled fallback. The discriminating evidence
 * is the campaign's own binding: with ordered add-ons resolved, the pre-repair
 * base-only selection could not have produced this stack. A campaign bound to
 * a single base pack cannot discriminate, because the repaired and broken
 * resolutions coincide there — and where they coincide, B3 cannot have
 * corrupted the capture either.
 */
function observeB3(input: BlockerRepairProbeInput): BlockerRepairObservation {
  const base = {
    blockerId: 'B3' as const,
    owner: 'eshyra-6vpw',
    gates: ['deterministic-agreement measurement (M11)'],
  };
  if (input.stack.addons.length === 0)
    return {
      ...base,
      status: 'not-discriminable',
      evidence: `the campaign resolves a single base pack ('${input.stack.base.meta.packId}' @ '${input.stack.base.meta.version}') with no add-ons, so an exact stack and a base-only selection resolve the same records`,
    };
  let overridden = 0;
  for (const entry of input.stack.recordsByKey.values())
    if (entry.pack.meta.packId !== input.stack.base.meta.packId)
      overridden += 1;
  return {
    ...base,
    status: overridden > 0 ? 'repaired' : 'not-discriminable',
    evidence:
      overridden > 0
        ? `${overridden} record(s) in the resolved stack are owned by an add-on rather than the base pack, which a base-only selection could not produce`
        : `the campaign binds ${input.stack.addons.length} add-on(s) but none owns a record in the resolved stack, so the exact stack and a base-only selection are indistinguishable here`,
  };
}

function observeB4(input: BlockerRepairProbeInput): BlockerRepairObservation {
  const hit = lookupRulesRecord(input.stack, {
    kind: 'table',
    ref: STARTING_WEALTH_KEY,
  });
  return {
    blockerId: 'B4',
    owner: 'eshyra-o9bd.19.2.1',
    gates: [`treating ${STARTING_WEALTH_KEY} as SRD authority, at any time`],
    status: hit.ok ? 'unrepaired' : 'repaired',
    evidence: hit.ok
      ? `${STARTING_WEALTH_KEY} is present in the resolved stack, supplied by pack '${hit.pack.packId}'`
      : `${STARTING_WEALTH_KEY} is absent from the resolved stack`,
  };
}

function observeB5(): BlockerRepairObservation {
  const base = {
    blockerId: 'B5' as const,
    owner: 'eshyra-uiax',
    gates: ['capability-agreement evidence (probe P8)'],
  };
  if (probeReadinessScope('parent') === 'threw')
    return {
      ...base,
      status: 'not-discriminable',
      evidence:
        "the readiness control record with scope kind 'parent' also threw, so an unrecognized-scope throw would not isolate B5",
    };
  const failsClosed = probeReadinessScope('unrecognized-probe-scope');
  return {
    ...base,
    status: failsClosed === 'threw' ? 'repaired' : 'unrepaired',
    evidence:
      failsClosed === 'threw'
        ? 'an unrecognized execution-readiness scope kind fails closed while a parent scope does not'
        : 'an unrecognized execution-readiness scope kind was skipped rather than failing closed',
  };
}

export function observeBlockerRepairs(
  input: BlockerRepairProbeInput,
): readonly BlockerRepairObservation[] {
  return [
    observeB1(input),
    observeB2(input),
    observeB3(input),
    observeB4(input),
    observeB5(),
  ];
}
