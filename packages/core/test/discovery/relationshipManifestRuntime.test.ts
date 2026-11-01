import { describe, expect, it } from 'vitest';
import type {
  ModelClient,
  ModelCompleteInput,
  ModelCompleteResult,
  RecordRelationshipManifestSource,
  RunTurnDeps,
} from '../../src/internal.js';
import {
  buildRecordRelationshipManifest,
  bundledDnd5eSrdRecordRelationshipManifestSource,
  createDefaultToolRegistry,
  createSeededRng,
  getBundledDnd5eSrdPack,
  getTurnTrace,
  openScene,
  readDiscoveryShadowEvidence,
  runDiscoveryStages,
  runTurn,
  writeCampaignRulesBinding,
} from '../../src/internal.js';
import type { ToolContext } from '../../src/orchestrator/toolRegistry.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from '../support/db.js';

/**
 * Generalized contract for L2-F2 (`eshyra-o9bd.16.2`, `eshyra-o9bd.16.6.1`):
 * a relationship manifest installed with a campaign's rules pack is the same
 * association at every consumer boundary. `lookup_rules`, offline
 * `runDiscoveryStages`, and the runtime `runTurn` shadow and intervene
 * captures must all honour one per-pack source, not fall back to the bundled
 * default when the add-on's own manifest was installed.
 *
 * One synthetic add-on owns its own `/source` record-key declaration and
 * links to the canonical `class:barbarian`. The same source function is
 * supplied to every consumer. The absent-manifest control proves the bundled
 * default still reports the add-on manifest absent and does not traverse.
 */

const ADDON_RECORD_KEY = 'feature:l2-audit-linked-feature';
const ADDON_RECORD_NAME = 'L2 Audit Linked Feature';
const LINKED_KEY = 'class:barbarian';
const AT = '2026-05-20T10:00:00.000Z';
const TURN = 'l2-manifest-runtime';

class CapturingModel implements ModelClient {
  readonly seen: ModelCompleteInput[] = [];
  complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    this.seen.push(input);
    return Promise.resolve({ text: 'You consider the feature.' });
  }
}

function addonFixture() {
  const base = getBundledDnd5eSrdPack();
  const reference = base.records.find(
    (record) => record.key === 'feature:barbarian:rage',
  );
  if (reference === undefined) {
    throw new Error('canonical feature:barbarian:rage record is missing');
  }
  const record = {
    ...reference,
    key: ADDON_RECORD_KEY,
    name: ADDON_RECORD_NAME,
  };
  const addon = {
    meta: {
      ...base.meta,
      packId: 'rules:l2-audit-own-manifest',
      role: 'addon',
      version: '1.0.0',
      order: 1,
      compatibleBaseSystems: [
        { systemId: base.meta.systemId, versions: [base.meta.version] },
      ],
    },
    records: [record],
  };
  const addonManifest = buildRecordRelationshipManifest([
    {
      kind: 'feature',
      pointerPrefix: '/source',
      linkField: 'data.source',
      disposition: 'reference',
      relation: 'granted-by',
      targetResolution: 'record-key',
      reason:
        'Contract fixture reuses the canonical Rage feature source field.',
    },
  ]);
  const bundled = bundledDnd5eSrdRecordRelationshipManifestSource();
  // The installed association: the add-on's own manifest, bundled default for
  // everything else. This is the single per-pack source every consumer gets.
  const installedSource: RecordRelationshipManifestSource = (pack) =>
    pack === addon ? addonManifest : bundled(pack);
  const resolveRulesPack = (binding: { packId: string }) =>
    binding.packId === addon.meta.packId ? addon : undefined;
  return { base, addon, installedSource, resolveRulesPack };
}

function seedCampaign(fixture: ReturnType<typeof addonFixture>) {
  const db = freshDbWithSession();
  openScene(db, {
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    sceneId: 'scene-0',
    title: 'Manifest contract',
    at: '2026-05-20T09:00:00.000Z',
  });
  writeCampaignRulesBinding(db, {
    base: {
      systemId: fixture.base.meta.systemId,
      packId: fixture.base.meta.packId,
      version: fixture.base.meta.version,
    },
    addons: [
      {
        systemId: fixture.addon.meta.systemId,
        packId: fixture.addon.meta.packId,
        version: fixture.addon.meta.version,
      },
    ],
    resolvedAt: AT,
  });
  return db;
}

function lookupContext(
  db: ReturnType<typeof seedCampaign>,
  fixture: ReturnType<typeof addonFixture>,
  source: RecordRelationshipManifestSource | undefined,
): ToolContext {
  return {
    db,
    rng: createSeededRng(42),
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: TURN,
    at: AT,
    resolveRulesPack: fixture.resolveRulesPack,
    ...(source === undefined ? {} : { relationshipManifestSource: source }),
  };
}

function lookupAwareness(
  fixture: ReturnType<typeof addonFixture>,
  source: RecordRelationshipManifestSource | undefined,
) {
  const db = seedCampaign(fixture);
  const result = createDefaultToolRegistry().invoke(
    'lookup_rules',
    { kind: 'feature', ref: ADDON_RECORD_KEY },
    lookupContext(db, fixture, source),
  );
  if (!result.ok) throw new Error(`lookup_rules failed: ${result.error}`);
  return (
    result.data as {
      ruleAwareness: {
        relationshipArtifact: { packId: string; state: string };
        relationships: readonly { targetRecordKey: string }[];
      };
    }
  ).ruleAwareness;
}

function offlineTrace(
  fixture: ReturnType<typeof addonFixture>,
  source: RecordRelationshipManifestSource | undefined,
) {
  const db = seedCampaign(fixture);
  return runDiscoveryStages({
    db,
    scenario: { playerInput: ADDON_RECORD_NAME, stateFields: {} },
    rulesPackResolver: fixture.resolveRulesPack,
    ...(source === undefined ? {} : { relationshipManifestSource: source }),
  });
}

async function runtimeTurn(
  fixture: ReturnType<typeof addonFixture>,
  discoveryMode: 'shadow' | 'intervene',
  source: RecordRelationshipManifestSource | undefined,
) {
  const db = seedCampaign(fixture);
  const model = new CapturingModel();
  const deps: RunTurnDeps = {
    db,
    model,
    registry: createDefaultToolRegistry(),
    resolveRulesPack: fixture.resolveRulesPack,
    discoveryMode,
    ...(source === undefined ? {} : { relationshipManifestSource: source }),
  };
  const result = await runTurn(deps, {
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: TURN,
    playerInput: ADDON_RECORD_NAME,
    seed: 42,
    at: AT,
  });
  const trace = getTurnTrace(db, {
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: TURN,
  });
  const evidence = readDiscoveryShadowEvidence(trace?.discoveryShadow);
  return {
    ok: result.ok,
    evidence,
    promptText: JSON.stringify(model.seen[0]?.messages ?? []),
  };
}

describe('installed relationship manifest is honoured by every consumer', () => {
  const fixture = addonFixture();

  it('lookup_rules, offline discovery, and runtime agree the add-on manifest is present', () => {
    const lookup = lookupAwareness(fixture, fixture.installedSource);
    expect(lookup.relationshipArtifact).toEqual({
      packId: fixture.addon.meta.packId,
      state: 'present',
    });
    expect(lookup.relationships.map((r) => r.targetRecordKey)).toContain(
      LINKED_KEY,
    );

    const offline = offlineTrace(fixture, fixture.installedSource);
    expect(offline.expansion.relationshipArtifactByProducer).toContainEqual({
      packId: fixture.addon.meta.packId,
      state: 'present',
    });
    expect(
      offline.expansion.traversals.map((t) => t.targetRecordKey),
    ).toContain(LINKED_KEY);
  });

  for (const discoveryMode of ['shadow', 'intervene'] as const) {
    it(`runTurn in ${discoveryMode} mode keeps the installed manifest and reaches the linked record`, async () => {
      const turn = await runtimeTurn(
        fixture,
        discoveryMode,
        fixture.installedSource,
      );
      expect(turn.ok).toBe(true);
      const shadow = turn.evidence;
      expect(shadow?.trace).toBeDefined();
      const expansion = shadow?.trace?.expansion;
      expect(expansion?.relationshipArtifactByProducer).toContainEqual({
        packId: fixture.addon.meta.packId,
        state: 'present',
      });
      expect(
        expansion?.traversalEvents.map((t) => t.targetRecordKey),
      ).toContain(LINKED_KEY);
      if (discoveryMode === 'intervene') {
        expect(shadow?.delivery).toMatchObject({
          mode: 'intervened',
          injected: true,
        });
        expect(turn.promptText).toContain(`## Candidate ${LINKED_KEY}`);
      } else {
        expect(turn.promptText).not.toContain(`## Candidate ${LINKED_KEY}`);
      }
    });
  }

  it('absent-manifest control: bundled default reports the add-on absent and never traverses', async () => {
    const lookup = lookupAwareness(fixture, undefined);
    expect(lookup.relationshipArtifact).toEqual({
      packId: fixture.addon.meta.packId,
      state: 'absent',
    });
    expect(lookup.relationships).toEqual([]);

    const offline = offlineTrace(fixture, undefined);
    expect(offline.expansion.relationshipArtifactByProducer).toContainEqual({
      packId: fixture.addon.meta.packId,
      state: 'absent',
    });
    expect(offline.expansion.traversals).toEqual([]);

    for (const discoveryMode of ['shadow', 'intervene'] as const) {
      const turn = await runtimeTurn(fixture, discoveryMode, undefined);
      expect(
        turn.evidence?.trace?.expansion.relationshipArtifactByProducer,
      ).toContainEqual({
        packId: fixture.addon.meta.packId,
        state: 'absent',
      });
      expect(turn.evidence?.trace?.expansion.traversalEvents).toEqual([]);
      expect(turn.promptText).not.toContain(`## Candidate ${LINKED_KEY}`);
    }
  });
});
