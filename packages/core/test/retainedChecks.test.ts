import { describe, expect, it } from 'vitest';
import type { AdventureModule, ToolContext } from '../src/internal.js';
import {
  createDefaultToolRegistry,
  createSeededRng,
  listCombatants,
  startAdventureRun,
  startEncounter,
} from '../src/internal.js';
import { playerVisibleRollEntries } from '../src/orchestrator/playerVisibleRollLedger.js';
import type { ExecutedToolCall } from '../src/orchestrator/turnLoop.js';
import { deriveTraceFields } from '../src/orchestrator/turnTraceProjection.js';
import { makeTestAdventureModule } from './support/adventureModuleFixture.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const NOW = '2026-05-20T10:05:00.000Z';

function setup(startNow = true) {
  const db = freshDbWithSession();
  const base = makeTestAdventureModule();
  const module: AdventureModule = {
    ...base,
    encounters: [
      {
        id: 'enc-watch',
        name: 'Watch',
        description: 'A watch is posted.',
        creatures: [{ rulesRef: 'creature:goblin', count: 4, role: 'watch' }],
        locationId: 'loc-cellar',
        reward: 'None.',
      },
    ],
  };
  startAdventureRun(db, {
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    runId: 'run-watch',
    moduleId: module.id,
    provenance: 'test',
    sessionId: DEFAULT_TEST_SESSION_ID,
    updatedAt: NOW,
  });
  const registry = createDefaultToolRegistry();
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(13),
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: 'turn-1',
    at: NOW,
    resolveAdventureModule: (moduleId) =>
      moduleId === module.id ? module : undefined,
  };
  const start = () =>
    startEncounter(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      encounterId: 'enc-watch',
      resolveAdventureModule: ctx.resolveAdventureModule,
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
  if (startNow) start();
  const combatants = listCombatants(db, DEFAULT_TEST_CAMPAIGN_ID);
  return { db, registry, ctx, combatants, start };
}

function data(
  result: ReturnType<ReturnType<typeof createDefaultToolRegistry>['invoke']>,
) {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.data as RetainedToolData;
}

interface RetainedToolData {
  retainedCheckId: string;
  total: number;
  comparisons: Array<{
    comparisonId: string;
    total: number;
    noticed: boolean;
    resolution: { outputs: { score: number } };
  }>;
  surprised: Array<{ ref: string }>;
}

function combatantId(
  combatants: ReturnType<typeof listCombatants>,
  index: number,
): string {
  const combatant = combatants[index];
  if (combatant === undefined) throw new Error(`missing combatant ${index}`);
  return combatant.combatantId;
}

function hide(
  registry: ReturnType<typeof createDefaultToolRegistry>,
  ctx: ToolContext,
  id: string,
  label = 'hider',
) {
  return data(
    registry.invoke(
      'roll_retained_check',
      {
        kind: 'ability_check',
        reason: 'hide from the watch',
        label,
        participant: { combatantId: id },
        modifiers: [{ label: 'DEX', value: 0 }],
        visibility: 'player_visible',
      },
      ctx,
    ),
  );
}

describe('retained check tools', () => {
  it('persists a retained roll once and later search never rerolls it; higher search notices and a tie stays hidden', () => {
    const { db, registry, ctx, combatants } = setup();
    const retained = hide(registry, ctx, combatantId(combatants, 0));
    const before = db
      .prepare(
        'SELECT rolls_json, total FROM retained_check WHERE retained_check_id = ?',
      )
      .get(retained.retainedCheckId) as { rolls_json: string; total: number };
    const preview = createSeededRng(13);
    preview.nextInt(20); // retained check's first d20
    const searchNatural = preview.nextInt(20) + 1;
    const tie = data(
      registry.invoke(
        'resolve_retained_check',
        {
          retainedCheckId: retained.retainedCheckId,
          reason: 'listen',
          search: {
            label: 'searcher tie',
            participant: { combatantId: combatantId(combatants, 1) },
            modifiers: [
              { label: 'tie adjustment', value: before.total - searchNatural },
            ],
          },
        },
        ctx,
      ),
    );
    expect(tie.comparisons[0]).toMatchObject({
      total: before.total,
      noticed: false,
    });
    const higher = data(
      registry.invoke(
        'resolve_retained_check',
        {
          retainedCheckId: retained.retainedCheckId,
          reason: 'search',
          search: {
            label: 'searcher',
            participant: { combatantId: combatantId(combatants, 1) },
            modifiers: [{ label: 'search bonus', value: 100 }],
          },
        },
        ctx,
      ),
    );
    expect(higher.comparisons[0].noticed).toBe(true);
    expect(
      db
        .prepare(
          'SELECT rolls_json, total FROM retained_check WHERE retained_check_id = ?',
        )
        .get(retained.retainedCheckId),
    ).toEqual(before);
    expect(
      db
        .prepare(
          'SELECT count(*) AS n FROM retained_check_comparison WHERE retained_check_id = ?',
        )
        .get(retained.retainedCheckId),
    ).toMatchObject({ n: 2 });
    db.close();
  });

  it('compares each passive observer through calc passive_score, including advantage and disadvantage adjustments', () => {
    const { db, registry, ctx, combatants } = setup();
    const retained = hide(registry, ctx, combatantId(combatants, 0));
    const result = data(
      registry.invoke(
        'resolve_retained_check',
        {
          retainedCheckId: retained.retainedCheckId,
          reason: 'watch perception',
          passive: [
            {
              label: 'advantaged',
              participant: { combatantId: combatantId(combatants, 1) },
              modifier: 0,
              advantage: true,
            },
            {
              label: 'disadvantaged',
              participant: { combatantId: combatantId(combatants, 2) },
              modifier: 0,
              disadvantage: true,
            },
          ],
        },
        ctx,
      ),
    );
    expect(
      result.comparisons.map((item) => item.resolution.outputs.score),
    ).toEqual([15, 5]);
    expect(result.comparisons.map((item) => item.noticed)).toEqual([
      15 > retained.total,
      5 > retained.total,
    ]);
    db.close();
  });

  it('refuses an ended retained check', () => {
    const { db, registry, ctx, combatants } = setup();
    const retained = hide(registry, ctx, combatantId(combatants, 0));
    expect(
      registry.invoke(
        'end_retained_check',
        { retainedCheckId: retained.retainedCheckId, reason: 'stopped' },
        ctx,
      ).ok,
    ).toBe(true);
    expect(
      registry.invoke(
        'resolve_retained_check',
        {
          retainedCheckId: retained.retainedCheckId,
          reason: 'late search',
          passive: [{ label: 'watcher', modifier: 12 }],
        },
        ctx,
      ),
    ).toMatchObject({ ok: false, code: 'retained_check_ended' });
    db.close();
  });

  it('rejects a model-typed total without a retained check identity', () => {
    const { db, registry, ctx, combatants } = setup();
    const retained = hide(registry, ctx, combatantId(combatants, 0));
    expect(
      registry.invoke(
        'resolve_retained_check',
        {
          retainedCheckId: retained.retainedCheckId,
          reason: 'forged comparison',
          total: retained.total,
          passive: [{ label: 'observer', modifier: 10 }],
        },
        ctx,
      ),
    ).toMatchObject({ ok: false, code: 'invalid_args' });
    db.close();
  });

  it('derives surprise from all passive comparisons and rejects mismatched sets, missing identities, and free lists', () => {
    const { db, registry, ctx, combatants } = setup();
    const hiderA = hide(registry, ctx, combatantId(combatants, 0), 'hider A');
    const hiderB = hide(registry, ctx, combatantId(combatants, 1), 'hider B');
    const obsA = combatantId(combatants, 2);
    const obsB = combatantId(combatants, 3);
    const compare = (
      retainedCheckId: string,
      observers: Array<{ label: string; id?: string; modifier: number }>,
    ) =>
      data(
        registry.invoke(
          'resolve_retained_check',
          {
            retainedCheckId,
            reason: 'surprise check',
            passive: observers.map((o) => ({
              label: o.label,
              modifier: o.modifier,
              ...(o.id ? { participant: { combatantId: o.id } } : {}),
            })),
          },
          ctx,
        ),
      );
    const partialA = compare(hiderA.retainedCheckId, [
      { label: 'watch A', id: obsA, modifier: -100 },
    ]);
    const partialB = compare(hiderB.retainedCheckId, [
      { label: 'watch A', id: obsA, modifier: -100 },
      { label: 'watch B', id: obsB, modifier: -100 },
    ]);
    expect(
      registry.invoke(
        'set_surprised',
        {
          comparisonIds: [
            partialA.comparisons[0].comparisonId,
            ...partialB.comparisons.map(
              (comparison) => comparison.comparisonId,
            ),
          ],
        },
        ctx,
      ),
    ).toMatchObject({ ok: false, code: 'mismatched_observer_sets' });

    const missingHider = hide(
      registry,
      ctx,
      combatantId(combatants, 0),
      'missing identity hider',
    );
    const missing = compare(missingHider.retainedCheckId, [
      { label: 'unidentified', modifier: -100 },
    ]);
    expect(
      registry.invoke(
        'set_surprised',
        { comparisonIds: [missing.comparisons[0].comparisonId] },
        ctx,
      ),
    ).toMatchObject({ ok: false, code: 'missing_observer_identity' });
    expect(
      registry.invoke(
        'set_surprised',
        { characters: [], combatantIds: [obsA] },
        ctx,
      ).ok,
    ).toBe(false);

    const fullHiderA = hide(
      registry,
      ctx,
      combatantId(combatants, 0),
      'full hider A',
    );
    const fullHiderB = hide(
      registry,
      ctx,
      combatantId(combatants, 1),
      'full hider B',
    );
    const fullA = compare(fullHiderA.retainedCheckId, [
      { label: 'watch A', id: obsA, modifier: -100 },
      { label: 'watch B', id: obsB, modifier: 100 },
    ]);
    const fullB = compare(fullHiderB.retainedCheckId, [
      { label: 'watch A', id: obsA, modifier: -100 },
      { label: 'watch B', id: obsB, modifier: 100 },
    ]);
    const ids = [...fullA.comparisons, ...fullB.comparisons].map(
      (comparison) => comparison.comparisonId,
    );
    const surprise = data(
      registry.invoke('set_surprised', { comparisonIds: ids }, ctx),
    );
    expect(surprise.surprised.map((participant) => participant.ref)).toEqual([
      obsA,
    ]);
    db.close();
  });

  it('keeps the first-turn surprise restriction through the derived path', () => {
    const { db, registry, ctx, combatants } = setup();
    const hider = hide(registry, ctx, combatantId(combatants, 0));
    const comparisons = data(
      registry.invoke(
        'resolve_retained_check',
        {
          retainedCheckId: hider.retainedCheckId,
          reason: 'ambush',
          passive: [
            {
              label: 'surprised watcher',
              participant: { combatantId: combatantId(combatants, 1) },
              modifier: -100,
            },
          ],
        },
        ctx,
      ),
    );
    const id = comparisons.comparisons[0].comparisonId;
    expect(
      registry.invoke('set_surprised', { comparisonIds: [id] }, ctx).ok,
    ).toBe(true);
    expect(
      registry.invoke(
        'begin_turn',
        { combatantId: combatantId(combatants, 1), round: 1 },
        ctx,
      ).ok,
    ).toBe(true);
    expect(
      registry.invoke(
        'spend_turn_resource',
        {
          combatantId: combatantId(combatants, 1),
          resource: 'action',
          activity: 'attack',
        },
        ctx,
      ),
    ).toMatchObject({ ok: false });

    db.close();
  });

  it('projects retained rolls to the turn trace and player-visible ledger', () => {
    const { db, registry, ctx, combatants } = setup();
    const hider = hide(registry, ctx, combatantId(combatants, 0));
    const call = {
      tool: 'roll_retained_check',
      args: {},
      result: { ok: true, data: hider },
      mutates: true,
    } as ExecutedToolCall;
    const projected = deriveTraceFields([call], []);
    expect(projected.rulesResolution).toMatchObject({
      retainedChecks: [hider],
    });
    expect(playerVisibleRollEntries([call])).toHaveLength(1);
    db.close();
  });

  it('accepts a Stealth check rolled while sneaking up, before the encounter starts', () => {
    const { db, registry, ctx, start } = setup(false);
    const sneak = data(
      registry.invoke(
        'roll_retained_check',
        {
          kind: 'ability_check',
          reason: 'sneak up on the watch',
          label: 'party scout',
          participant: { character: 'pc-1' },
          modifiers: [{ label: 'DEX', value: 0 }],
        },
        ctx,
      ),
    );
    start();
    const watch = listCombatants(db, DEFAULT_TEST_CAMPAIGN_ID).map(
      (c) => c.combatantId,
    );
    const compared = data(
      registry.invoke(
        'resolve_retained_check',
        {
          retainedCheckId: sneak.retainedCheckId,
          reason: 'surprise',
          passive: watch.map((id, index) => ({
            label: `watch ${index}`,
            participant: { combatantId: id },
            modifier: -100,
          })),
        },
        ctx,
      ),
    );
    const surprised = data(
      registry.invoke(
        'set_surprised',
        { comparisonIds: compared.comparisons.map((c) => c.comparisonId) },
        ctx,
      ),
    );
    expect(surprised.surprised.map((p) => p.ref).sort()).toEqual(
      [...watch].sort(),
    );
    db.close();
  });
});
