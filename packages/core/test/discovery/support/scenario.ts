import type {
  AdventureModule,
  DiscoveryRunInput,
  DiscoveryScenario,
} from '../../../src/internal.js';
import { loadAdventureModuleFromDir } from '../../../src/internal.js';
import type {
  DiagnosticFixture,
  FixtureExecution,
} from '../../diagnostics/fixtureContract.js';
import { oracleCampaignRuleSeam } from './oracleCampaignRules.js';

function isNone(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'none'
  );
}

/**
 * Scenario inputs the fixtures deliberately abbreviate, declared here rather
 * than harvested from the fixture's own expectations.
 *
 * An inventory instance's pack binding is ordinary campaign state: P8 names the
 * instance `ammunition-stack-1` but not the record it is bound to, because the
 * fixture records the minimal state for the scenario, not a full state
 * snapshot. Deriving that binding from `mustIncludeTargets` -- as an earlier
 * revision of this file did -- would hand the signals stage the very record key
 * it is supposed to discover, and the probe would pass on the answer. Every
 * binding used is surfaced in `signals.stateBindings`, and the probe test
 * asserts that it is.
 *
 * P7 needs no entry: its campaign state already carries
 * `itemRecord: magic-item:cube-of-force`, which the generic state walk finds.
 */
const DECLARED_ITEM_INSTANCES: Readonly<
  Record<string, readonly { instanceId: string; recordKey: string }[]>
> = {
  P8: [
    {
      instanceId: 'ammunition-stack-1',
      recordKey: 'magic-item:ammunition-1-2-or-3',
    },
  ],
};

/**
 * Capabilities a fixture expects that this offline harness does not evaluate.
 * The packet reports them as `not-evaluated-offline` naming the owning
 * workstream; it never fabricates an `implemented` status. Contract-declared
 * capability status is W13 (`eshyra-olc5.6`) and measurement M10, a Phase 2
 * concern -- M1-M9 are the Phase 1 gate.
 */
const DECLARED_OFFLINE_CAPABILITIES: Readonly<
  Record<string, readonly { capabilityId: string; candidateKey: string }[]>
> = {
  P4: [{ capabilityId: 'spell-upcast', candidateKey: 'spell:fireball' }],
  P5: [
    {
      capabilityId: 'concentration-lifecycle',
      candidateKey: 'rule:concentration',
    },
  ],
};

export function scenarioForFixture(
  fixture: DiagnosticFixture,
  execution: FixtureExecution,
  module?: AdventureModule,
): DiscoveryRunInput['scenario'] {
  const adventure = !isNone(fixture.adventureState)
    ? (fixture.adventureState as Record<string, unknown>)
    : undefined;
  const declared = DECLARED_OFFLINE_CAPABILITIES[fixture.probeId] ?? [];
  return {
    playerInput: fixture.playerInput,
    stateFields: fixture.campaignState,
    declaredCapabilities: declared.map((item) => ({
      capabilityId: item.capabilityId,
      candidateKey: item.candidateKey,
      revision: execution.expectedCapabilityStatus.revision,
      exclusions: [
        'Offline discovery does not evaluate contract-declared capability status; W13 (eshyra-olc5.6) owns the contract and M10 owns runtime agreement.',
      ],
      residualInterpretation:
        'Capability status for this candidate is not established by this phase.',
    })),
    itemInstances: DECLARED_ITEM_INSTANCES[fixture.probeId] ?? [],
    adventure:
      adventure === undefined || module === undefined
        ? undefined
        : {
            moduleId: String(adventure.moduleId),
            locationId:
              typeof adventure.locationId === 'string'
                ? adventure.locationId
                : undefined,
            encounterId:
              typeof adventure.encounterId === 'string'
                ? adventure.encounterId
                : undefined,
            module,
          },
  } satisfies DiscoveryScenario;
}

/** Probes whose scenario input carries a harness-declared binding, so the
 * probe report can label what was supplied rather than discovered. */
export function declaredBindingLabels(
  fixture: DiagnosticFixture,
): readonly string[] {
  return (DECLARED_ITEM_INSTANCES[fixture.probeId] ?? []).map(
    (item) => `scenario-state-binding:${item.instanceId}`,
  );
}

export function moduleForFixture(
  fixture: DiagnosticFixture,
): AdventureModule | undefined {
  if (isNone(fixture.adventureState)) return undefined;
  return loadAdventureModuleFromDir(
    'packages/core/data/adventure-modules/eshyra_hollow-beneath-emberfall',
  );
}

export { oracleCampaignRuleSeam };
