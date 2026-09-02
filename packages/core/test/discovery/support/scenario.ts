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

export function scenarioForFixture(
  fixture: DiagnosticFixture,
  _execution: FixtureExecution,
  module?: AdventureModule,
): DiscoveryRunInput['scenario'] {
  const adventure = !isNone(fixture.adventureState)
    ? (fixture.adventureState as Record<string, unknown>)
    : undefined;
  return {
    playerInput: fixture.playerInput,
    stateFields: fixture.campaignState,
    declaredCapabilities:
      _execution.expectedCapabilityStatus.status === 'implemented'
        ? [
            {
              capabilityId:
                _execution.expectedCapabilityStatus.capabilityId ??
                'declared-capability',
              candidateKey:
                fixture.mustIncludeTargets.find(
                  (target) => target.targetKind === 'rules-record',
                )?.recordKey ?? '',
              revision: _execution.expectedCapabilityStatus.revision,
              inputs: _execution.expectedCapabilityStatus.inputs,
              exclusions: _execution.expectedCapabilityStatus.exclusions,
              residualInterpretation:
                _execution.expectedCapabilityStatus.residualInterpretation,
            },
          ]
        : [],
    itemInstances: fixture.mustIncludeTargets
      .filter(
        (target) =>
          target.targetKind === 'rules-record' &&
          target.recordKey.startsWith('magic-item:'),
      )
      .map((target) => ({
        instanceId: String(
          fixture.campaignState.inventoryInstance ??
            fixture.campaignState.itemInstance ??
            'diagnostic-item',
        ),
        recordKey: target.recordKey,
      })),
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

export function moduleForFixture(
  fixture: DiagnosticFixture,
): AdventureModule | undefined {
  if (isNone(fixture.adventureState)) return undefined;
  return loadAdventureModuleFromDir(
    'packages/core/data/adventure-modules/eshyra_hollow-beneath-emberfall',
  );
}

export { oracleCampaignRuleSeam };
