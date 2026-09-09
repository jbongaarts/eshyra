import type { ToolInputSchema } from '../model/toolSchema.js';
import { validateToolInput } from '../model/toolSchemaValidation.js';
import type { Db } from '../persistence/db.js';
import { getBundledDnd5eSrdPack } from '../rules/bundledSrdPack.js';
import { lookupRulesRecord } from '../rules/lookup.js';
import type { ResolvedRulesStack } from '../rules/stack.js';
import type { RulesRecord } from '../rules/types.js';
import {
  type CampaignRulesPackResolver,
  lookupCampaignRecord,
} from '../state/campaignRecordLookup.js';
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
 *
 * The bar every probe here must clear: **the historical broken implementation
 * of the defect must not be able to produce `repaired`.** It is not enough to
 * observe a path that happens to work today — an earlier revision of B3 read
 * the strict stack, which was never the side B3 broke, so the pre-repair
 * deterministic consumers would have satisfied it unchanged. A probe must
 * exercise the responsibility the repair actually changed, or say it cannot.
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
  readonly db: Db;
  readonly stack: ResolvedRulesStack;
  readonly tools: BlockerToolSchemaSource;
  readonly resolveRulesPack?: CampaignRulesPackResolver;
  /** Whether THIS turn was given an adventure-module resolver. */
  readonly adventureResolverSupplied: boolean;
}

const STARTING_WEALTH_KEY = 'table:starting-wealth-by-class';

/**
 * What B3 gates, per design section 9.6 as corrected by its Erratum 1
 * (2026-09-09, raised on the PR #539 review).
 *
 * As first written, section 9.6 named "the deterministic-agreement measurement
 * (section 13 M11)", but section 13.1 defines M11 as auditor retry count and
 * M12 as accepted state-effect agreement. Encoding the un-corrected M-number
 * here would have persisted one side of a contradiction into every capture,
 * while `measureRuntimeDiscovery().m11` implements the section 13.1 definition.
 * The gate is therefore named by WHAT it gates; M12 is a Phase 3 measurement,
 * so B3 gates no Phase 2 measurement and a Phase 2 capture is not disqualified
 * as a baseline by B3's status.
 */
const DETERMINISTIC_AGREEMENT_GATE =
  'the deterministic-agreement measurement (design section 13.1 M12, accepted state-effect agreement; a Phase 3 measurement, per section 9.6 Erratum 1)';

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

/**
 * B2's defect was that normal CLI play never handed `runTurn` the resolver,
 * although the resolver existed and a direct caller could always supply one.
 * A capture taken inside core therefore cannot observe B2's repair at all: a
 * turn constructed with a resolver looks identical before and after the CLI
 * was fixed. Reporting `repaired` because THIS caller injected one would
 * upgrade "this capture happens not to hit the defect" into "the repair was in
 * place", which is exactly what a baseline marker must never do.
 *
 * What the capture can say truthfully is whether adventure context reached
 * this turn at all — recorded here and, machine-readably, as the shadow
 * scenario's `adventure` seat and `adventureModuleResolved`. A capture with no
 * adventure context carries no adventure-context evidence for B2 to invalidate.
 */
function observeB2(input: BlockerRepairProbeInput): BlockerRepairObservation {
  return {
    blockerId: 'B2',
    owner: 'eshyra-seoh',
    gates: ['adventure-context evidence (probe P9)'],
    status: 'not-discriminable',
    evidence: `this turn ${input.adventureResolverSupplied ? 'was' : 'was not'} supplied an adventure-module resolver by its caller, which is a fact about this caller and not about the CLI handoff B2 repaired; core cannot observe that handoff`,
  };
}

/**
 * B3 broke the DETERMINISTIC CONSUMERS, not strict lookup: `lookupCampaignRecord`
 * selected a base pack by `packId` alone, ignored every add-on, and fell back
 * to the bundled D&D SRD. Strict model-facing lookup already resolved the exact
 * stack. So a probe that reads the strict stack proves nothing — the historical
 * broken consumers would have produced the same strict stack.
 *
 * The discriminating question is whether the shared deterministic entry point
 * now returns the SAME record the exact stack resolves. An add-on override is
 * the case where the two answers differ: the pre-repair base-only selection
 * returns the base record, the repaired resolution returns the add-on's. With
 * no override in the campaign's stack the two coincide, so the probe reports
 * `not-discriminable` — and where they coincide, B3 could not have corrupted
 * this capture either.
 *
 * The call to `lookupCampaignRecord` resolves the stack a second time, which is
 * the price of exercising the real entry point rather than a re-implementation
 * of it. It is paid only by a campaign that binds an add-on override, and only
 * while shadow mode is enabled.
 */
function observeB3(input: BlockerRepairProbeInput): BlockerRepairObservation {
  const base = {
    blockerId: 'B3' as const,
    owner: 'eshyra-6vpw',
    gates: [DETERMINISTIC_AGREEMENT_GATE],
  };
  const override = findAddonOverride(input.stack);
  if (override === undefined)
    return {
      ...base,
      status: 'not-discriminable',
      evidence: `no record in the resolved stack is owned by an add-on that overrides a base record (${input.stack.addons.length} add-on(s) bound), so an exact stack and a base-only selection resolve the same records here`,
    };
  const deterministic = lookupCampaignRecord(
    input.db,
    override.kind,
    override.key,
    input.resolveRulesPack,
  );
  const asResolved = JSON.stringify(override.resolved);
  const asBase = JSON.stringify(override.base);
  if (asResolved === asBase)
    return {
      ...base,
      status: 'not-discriminable',
      evidence: `add-on override '${override.key}' is byte-identical to the base record it overrides, so it cannot distinguish an exact stack from a base-only selection`,
    };
  const actual =
    deterministic === undefined ? undefined : JSON.stringify(deterministic);
  return {
    ...base,
    status: actual === asResolved ? 'repaired' : 'unrepaired',
    evidence:
      actual === asResolved
        ? `the deterministic lookup of '${override.key}' returns the add-on's overriding record, which a base-only selection could not produce`
        : `the deterministic lookup of '${override.key}' returns ${actual === asBase ? 'the BASE record, as the pre-repair base-only selection did' : actual === undefined ? 'nothing' : 'a record that is neither the add-on override nor the base record'}`,
  };
}

/** The record identity a B3 probe can discriminate on: an add-on override. */
function findAddonOverride(stack: ResolvedRulesStack):
  | {
      readonly key: string;
      readonly kind: RulesRecord['kind'];
      readonly resolved: RulesRecord;
      readonly base: RulesRecord;
    }
  | undefined {
  if (stack.addons.length === 0) return undefined;
  const baseByKey = new Map(
    stack.base.records.map((record) => [record.key, record]),
  );
  for (const entry of stack.recordsByKey.values()) {
    if (entry.pack.meta.packId === stack.base.meta.packId) continue;
    const baseRecord = baseByKey.get(entry.record.key);
    if (baseRecord === undefined) continue;
    return {
      key: entry.record.key,
      kind: entry.record.kind,
      resolved: entry.record,
      base: baseRecord,
    };
  }
  return undefined;
}

/**
 * B4's required next state is that the record is removed from SRD AUTHORITY,
 * not merely absent from whatever pack this campaign happens to bind. So the
 * probe reads both: the bundled SRD pack, which is the authority the repair
 * owns, and the campaign's resolved stack, which is what this capture would
 * actually have surfaced. Presence in either leaves B4 unrepaired.
 */
function observeB4(input: BlockerRepairProbeInput): BlockerRepairObservation {
  const inStack = lookupRulesRecord(input.stack, {
    kind: 'table',
    ref: STARTING_WEALTH_KEY,
  });
  const inSrdAuthority = getBundledDnd5eSrdPack().records.some(
    (record) => record.key === STARTING_WEALTH_KEY,
  );
  const base = {
    blockerId: 'B4' as const,
    owner: 'eshyra-o9bd.19.2.1',
    gates: [`treating ${STARTING_WEALTH_KEY} as SRD authority, at any time`],
  };
  if (inSrdAuthority)
    return {
      ...base,
      status: 'unrepaired',
      evidence: `${STARTING_WEALTH_KEY} is still present in the bundled SRD pack, which is the authority B4 removes it from`,
    };
  return {
    ...base,
    status: inStack.ok ? 'unrepaired' : 'repaired',
    evidence: inStack.ok
      ? `${STARTING_WEALTH_KEY} is absent from the bundled SRD pack but present in this campaign's resolved stack, supplied by pack '${inStack.pack.packId}'`
      : `${STARTING_WEALTH_KEY} is absent from both the bundled SRD pack and this campaign's resolved stack`,
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
