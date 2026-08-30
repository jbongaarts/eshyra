import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type CharacterDraft,
  type CharacterRegistryStore,
  type CharacterSheet,
  createCampaign,
  createCharacterRegistryStore,
  createDefaultToolRegistry,
  createSeededRng,
  createSqliteCharacterSheetStore,
  type Db,
  DoltRepo,
  EMBERFALL_HOLLOW,
  ensureCharacterRegistrySchema,
  getArcSummary,
  getBundledDnd5eCharacterResolver,
  getCampaign,
  getCampaignBible,
  getDnd5eCharacterCreationEngine,
  getOpenSession,
  getSession,
  getSessionRecap,
  initSchema,
  listSessions,
  type ModelClient,
  ModelClientError,
  openDatabase,
  type RunTurnInput,
  type RunTurnResult,
  readCampaignRulesBinding,
  registerNewCharacter,
  runTurn,
  startSession,
} from '@eshyra/core';
import {
  appendSceneLog,
  assembleContext,
  awardXp,
  DEFAULT_MEMORY_CONFIG,
  DND5E_SRD_PACK_ID,
  DND5E_SRD_SYSTEM_ID,
  getClosedSessionsInOpenArc,
  getOpenArc,
  getOpenScene,
  listAdventureRuns,
  listBundledAdventureModules,
  listClosedArcSummaries,
  listCombatants,
  mutateState,
  openScene,
  recordTurnTrace,
  renderContextMessage,
} from '@eshyra/core/internal';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterDraftStore } from '../src/characterDraftStore.js';
import {
  type CliIO,
  doltCheckpointRunner,
  type PlayDeps,
  runDemo,
  runPlay,
} from '../src/play.js';

const FAKE_ARC_SUMMARY = 'FAKE_ARC_SUMMARY';
// Real Dolt subprocesses can exceed Vitest's 5s default under full-suite load.
const DOLT_TEST_TIMEOUT_MS = 30_000;

const ROUTED_FAKE_BIBLE_JSON =
  '```bible_json\n' +
  '{"worldFacts":["Emberfall sits on a fault line"],"majorNpcs":["Mira the runesmith"],"factions":["Lantern Court"],"openThreads":["The chalk sigil is unsolved"]}\n' +
  '```';

function routedFakeModel(routes: {
  bible: () => string | Promise<string>;
  summary: () => string | Promise<string>;
}): ModelClient {
  return {
    complete: async (input) => {
      if (input.system?.includes('extract structured world facts')) {
        return { text: await routes.bible() };
      }
      return { text: await routes.summary() };
    },
  };
}

/**
 * An in-memory database whose `close()` is a no-op, so a test can assert on
 * persisted state after `runPlay` returns (runPlay closes its db on exit).
 *
 * Seeds a valid ability-scores object so `readStateSnapshot` passes the
 * live-state shape validator even when tests skip character creation.
 */
function makeDb(): { db: Db; dispose: () => void } {
  const real = openDatabase(':memory:');
  initSchema(real);
  // Seed valid ability scores for tests that skip character creation.
  mutateState(real, {
    target: 'character',
    field: 'ability_scores_json',
    op: 'set',
    value: {
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    },
    provenance: 'test:init',
    sessionId: 'bootstrap',
    at: new Date(0).toISOString(),
  });
  const db = new Proxy(real, {
    get(target, prop) {
      if (prop === 'close') {
        return () => {};
      }
      const value = Reflect.get(target, prop) as unknown;
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  }) as unknown as Db;
  return { db, dispose: () => real.close() };
}

/** A scripted {@link CliIO}: prompts return queued answers, then EOF. */
function scriptedIO(answers: ReadonlyArray<string>): {
  io: CliIO;
  lines: string[];
} {
  const lines: string[] = [];
  let next = 0;
  return {
    lines,
    io: {
      write: (line) => lines.push(line),
      prompt: async () => (next < answers.length ? answers[next++] : undefined),
    },
  };
}

// The real bundled adventure modules (The Hollow Beneath Emberfall), used to
// drive the session-start selector without hand-authoring a module fixture.
const HOLLOW_MODULES = listBundledAdventureModules();
const HOLLOW_MODULE_ID = 'eshyra:hollow-beneath-emberfall';

function finalizedCharacter(
  name = 'Mira',
  className = 'Fighter',
): CharacterSheet {
  return {
    schemaVersion: 1,
    system: 'dnd5e-srd',
    rulesPackId: DND5E_SRD_PACK_ID,
    recipeId: 'dnd5e-srd-level-1',
    creationMode: 'concept-first',
    level: 1,
    identity: { name },
    class: { key: `class:${className.toLowerCase()}`, name: className },
    ancestry: { key: 'ancestry:human', name: 'Human' },
    abilityScores: {
      strength: { base: 15, final: 16, modifier: 3 },
      dexterity: { base: 14, final: 15, modifier: 2 },
      constitution: { base: 14, final: 15, modifier: 2 },
      intelligence: { base: 10, final: 11, modifier: 0 },
      wisdom: { base: 10, final: 11, modifier: 0 },
      charisma: { base: 8, final: 9, modifier: -1 },
    },
    proficiencyBonus: 2,
    maxHitPoints: 12,
    savingThrows: {
      strength: { modifier: 5, proficient: true },
      dexterity: { modifier: 2, proficient: false },
      constitution: { modifier: 4, proficient: true },
      intelligence: { modifier: 0, proficient: false },
      wisdom: { modifier: 0, proficient: false },
      charisma: { modifier: -1, proficient: false },
    },
    skillProficiencies: [],
    toolProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    equipment: [],
    languages: ['Common'],
    spells: [],
    metadata: { createdAt: '2026-06-26T00:00:00.000Z', source: 'test' },
  };
}

function memoryDraftStore(): CharacterDraftStore {
  const saved = new Map<string, CharacterDraft>();
  return {
    save: (draft) => {
      saved.set(draft.id, draft);
    },
    load: (id) => saved.get(id),
    list: () => [...saved.keys()].sort(),
  };
}

function memoryFinalizedStore(
  seed: Readonly<Record<string, CharacterSheet>> = {
    mira: finalizedCharacter(),
  },
): CharacterRegistryStore {
  const db = openDatabase(':memory:');
  ensureCharacterRegistrySchema(db);
  const registry = createCharacterRegistryStore(db);
  for (const [globalCharacterId, sheet] of Object.entries(seed)) {
    registerNewCharacter(registry, { globalCharacterId, sheet });
  }
  return registry;
}

/**
 * A fake `runTurn` that exercises the orchestrator's observable contract
 * without a model: it opens a scene if none is open and appends the player +
 * DM lines, so scene-tail / resume behaviour is real.
 */
async function fakeRunTurn(
  deps: { db: Db },
  input: RunTurnInput,
): Promise<RunTurnResult> {
  let scene = getOpenScene(deps.db, {
    campaignId: input.campaignId,
    sessionId: input.sessionId,
  });
  if (scene === undefined) {
    scene = openScene(deps.db, {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      sceneId: `${input.sessionId}-scene-1`,
      title: 'Emberfall Square',
      at: input.at,
    });
  }
  const narration = `DM: you said "${input.playerInput}"`;
  for (const [role, content] of [
    ['player', input.playerInput],
    ['dm', narration],
  ] as const) {
    appendSceneLog(deps.db, {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      sceneId: scene.sceneId,
      turnId: input.turnId,
      role,
      content,
      at: input.at,
    });
  }
  return {
    ok: true,
    turnId: input.turnId,
    narration,
    toolCalls: [],
    sceneId: scene.sceneId,
    modelRounds: 1,
    error: undefined,
    isRateLimit: false,
  };
}

function baseDeps(
  db: Db,
  io: CliIO,
  runTurn: PlayDeps['runTurn'] = fakeRunTurn,
  makeCheckpointRunner: PlayDeps['makeCheckpointRunner'] = () => undefined,
  listAdventureModules: PlayDeps['listAdventureModules'] = () => [],
): PlayDeps {
  let ids = 0;
  let clock = 0;
  return {
    io,
    openDb: () => db,
    model: routedFakeModel({
      bible: () => ROUTED_FAKE_BIBLE_JSON,
      summary: () => FAKE_ARC_SUMMARY,
    }),
    registry: createDefaultToolRegistry(),
    runTurn,
    pack: EMBERFALL_HOLLOW,
    listAdventureModules,
    characterDraftStore: memoryDraftStore(),
    characterRegistry: memoryFinalizedStore(),
    characterEngine: getDnd5eCharacterCreationEngine(),
    characterResolver: getBundledDnd5eCharacterResolver(),
    characterRng: createSeededRng(1),
    now: () => new Date(Date.UTC(2026, 4, 20, 0, 0, clock++)).toISOString(),
    nextId: (prefix) => `${prefix}-${++ids}`,
    seed: () => 1,
    makeCheckpointRunner,
    memoryConfig: { ...DEFAULT_MEMORY_CONFIG },
  };
}

async function xpAwardingTurn(
  deps: { db: Db },
  input: RunTurnInput,
): Promise<RunTurnResult> {
  if (/gain xp/i.test(input.playerInput)) {
    awardXp(deps.db, 300, 'test award', {
      provenance: 'test:award-xp',
      sessionId: input.sessionId,
      at: input.at,
    });
  }
  return fakeRunTurn(deps, input);
}

describe('runPlay', () => {
  it('creates a campaign, plays turns, and graceful-exits through the close pipeline', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO([
      'import',
      'mira',
      'look around',
      'open the door',
      '/quit',
    ]);

    const code = await runPlay(baseDeps(db, io), { dbPath: 'demo.db' });

    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('Created campaign');
    expect(out).toContain('Character creation complete');
    expect(out).toContain(EMBERFALL_HOLLOW.meta.title);
    expect(out).toContain('Started session');
    expect(out).toContain('DM: you said "look around"');
    expect(out).toContain('DM: you said "open the door"');
    expect(out).toContain('closed and recapped');

    // Graceful exit ran the close pipeline: session closed, recap written
    // with content drawn from played scene narration (not a factual stub).
    const session = listSessions(db, { campaignId: campaignId(db) })[0];
    expect(getOpenSession(db, { campaignId: campaignId(db) })).toBeUndefined();
    const recap = getSessionRecap(db, {
      campaignId: campaignId(db),
      sessionId: session.sessionId,
    });
    expect(recap).toBeDefined();
    expect(recap?.recap).toContain('DM: you said "look around"');
    expect(recap?.recap).toContain('DM: you said "open the door"');
    expect(recap?.sourceSceneIds.length).toBeGreaterThan(0);
    expect(
      db
        .prepare(
          `SELECT name, class_name, hp_max FROM character WHERE id = 'pc-1'`,
        )
        .get(),
    ).toEqual({ name: 'Mira', class_name: 'Fighter', hp_max: 12 });

    // The unmanaged play-time campaign created above persists the default
    // D&D SRD rules binding — runPlay relies on the DB binding/defaulting, not
    // any external registry metadata, for system identity.
    const binding = readCampaignRulesBinding(db);
    expect(binding?.base.systemId).toBe(DND5E_SRD_SYSTEM_ID);
    expect(binding?.base.packId).toBe(DND5E_SRD_PACK_ID);

    dispose();
  });

  it('persists recap content the next session can read via assembleContext', async () => {
    // The bead acceptance is that a closed session's recap is tied to played
    // content AND that later sessions surface it through context assembly.
    const { db, dispose } = makeDb();
    const { io } = scriptedIO([
      '/defer',
      'look around',
      'open the door',
      '/quit',
    ]);
    await runPlay(baseDeps(db, io), { dbPath: 'demo.db' });

    const cid = campaignId(db);
    // Stage a fresh session as if the player re-opened the campaign next time.
    startSession(db, {
      campaignId: cid,
      sessionId: 'next-session',
      startedAt: '2026-05-21T00:00:00.000Z',
    });

    const ctx = assembleContext({
      db,
      campaignId: cid,
      sessionId: 'next-session',
      playerInput: 'I think back to last time…',
    });

    // The prior session's real narration carries forward — not a stub recap.
    expect(ctx.recentSessionRecaps.length).toBe(1);
    expect(ctx.recentSessionRecaps[0]?.recap).toContain(
      'DM: you said "look around"',
    );
    expect(ctx.recentSessionRecaps[0]?.recap).toContain(
      'DM: you said "open the door"',
    );
    // The rendered context the DM model sees mentions the carried narration.
    const rendered = renderContextMessage(ctx);
    expect(rendered).toContain('## Recent Sessions');
    expect(rendered).toContain('DM: you said "look around"');
    dispose();
  });

  it('rolls accepted state deltas from turn traces into the session recap', async () => {
    // The bead acceptance also requires accepted-mutation continuity. The
    // orchestrator writes a turn_trace per turn; the close composer aggregates
    // their acceptedStateDelta into the recap's stateDelta column. We bypass
    // the live orchestrator here by recording traces inline from a fake turn.
    const { db, dispose } = makeDb();
    const traceTurn = async (
      deps: { db: Db },
      input: RunTurnInput,
    ): Promise<RunTurnResult> => {
      const result = await fakeRunTurn(deps, input);
      recordTurnTrace(deps.db, {
        campaignId: input.campaignId,
        sessionId: input.sessionId,
        turnId: input.turnId,
        consentScope: 'private',
        playerInput: input.playerInput,
        retrievedContext: [],
        promptProfile: 'premium_dm',
        modelOutput: result.narration,
        toolCalls: [],
        rulesResolution: null,
        acceptedStateDelta: [
          {
            target: 'plot_flags',
            field: `seen-${input.turnId}`,
            op: 'set',
            value: true,
          },
        ],
        rejectedCandidates: [],
        finalNarration: result.narration,
        memoryUpdates: [],
        humanCorrections: [],
        qualityFlags: [],
        createdAt: input.at,
      });
      return result;
    };

    await runPlay(
      baseDeps(
        db,
        scriptedIO(['/defer', 'poke the lever', '/quit']).io,
        traceTurn,
      ),
      { dbPath: 'demo.db' },
    );

    const cid = campaignId(db);
    const session = listSessions(db, { campaignId: cid })[0];
    const recap = getSessionRecap(db, {
      campaignId: cid,
      sessionId: session.sessionId,
    });
    expect(recap?.stateDelta).toHaveLength(1);
    expect(recap?.stateDelta[0]).toMatchObject({
      target: 'plot_flags',
      op: 'set',
      value: true,
    });
    dispose();
  });

  it('uses finalized-character import for D&D session zero without the legacy HP prompt', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO([
      'import',
      'mira',
      'look around',
      '/quit',
    ]);

    const code = await runPlay(baseDeps(db, io), { dbPath: 'demo.db' });

    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('Registered characters:');
    expect(out).toContain('Character creation complete');
    expect(out).not.toContain('Level-1 max HP:');
    expect(out).toContain('DM: you said "look around"');
    expect(
      db
        .prepare(
          `SELECT name, class_name, ancestry, hp_max, ability_scores_json
           FROM character WHERE id = 'pc-1'`,
        )
        .get(),
    ).toEqual({
      name: 'Mira',
      class_name: 'Fighter',
      ancestry: 'Human',
      hp_max: 12,
      ability_scores_json: JSON.stringify({
        strength: 16,
        dexterity: 15,
        constitution: 15,
        intelligence: 11,
        wisdom: 11,
        charisma: 9,
      }),
    });
    dispose();
  });

  it('handles /progression inside the play session', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO([
      'import',
      'mira',
      '/progression',
      '/quit',
    ]);

    const code = await runPlay(baseDeps(db, io), { dbPath: 'demo.db' });

    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('Progression for pc-1: level 1, 0 XP.');
    expect(out).toContain('Advancement: xp; not eligible to level up.');
    expect(out).toContain('Recent progression events: none.');
    dispose();
  });

  it('handles /wallet and /money inside the play session', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO([
      'import',
      'mira',
      '/wallet',
      '/money gain gp 12',
      '/money spend gp 5',
      '/money convert 7 gp pp',
      '/wallet',
      '/quit',
    ]);

    const code = await runPlay(baseDeps(db, io), { dbPath: 'demo.db' });

    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('Wallet: 0 cp, 0 sp, 0 ep, 0 gp, 0 pp.');
    expect(out).toContain('Wallet: 0 cp, 0 sp, 0 ep, 7 gp, 0 pp.');
    expect(out).toContain('gain: +12 gp ->');
    expect(out).toContain('spend: -5 gp ->');
    expect(out).toContain(
      'Money command failed: 7 gp cannot convert exactly to pp',
    );
    expect(createSqliteCharacterSheetStore(db).load('pc-1')?.wallet).toEqual({
      cp: 0,
      sp: 0,
      ep: 0,
      gp: 7,
      pp: 0,
    });
    const walletEvents = db
      .prepare('SELECT kind FROM character_wallet_event ORDER BY id')
      .all() as Array<{ kind: string }>;
    expect(walletEvents.map((event) => event.kind)).toEqual(['gain', 'spend']);
    dispose();
  });

  it('applies /levelup from the play session after an XP award', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO([
      'import',
      'mira',
      'gain xp',
      '/levelup',
      'fixed',
      'y',
      '/quit',
    ]);

    const code = await runPlay(baseDeps(db, io, xpAwardingTurn), {
      dbPath: 'demo.db',
    });

    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('Level-up preview: level 1 -> 2.');
    expect(out).toContain('Level-up applied: level 1 -> 2.');
    expect(
      db.prepare(`SELECT level, hp_max FROM character WHERE id = 'pc-1'`).get(),
    ).toEqual({ level: 2, hp_max: 20 });
    const levelUpEvents = db
      .prepare(
        `SELECT kind, resulting_level FROM progression_event WHERE kind = 'level-up'`,
      )
      .all() as Array<{ kind: string; resulting_level: number }>;
    expect(levelUpEvents).toEqual([{ kind: 'level-up', resulting_level: 2 }]);
    dispose();
  });

  it('surfaces /levelup blockers clearly', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO([
      'import',
      'ezra',
      'gain xp',
      '/levelup',
      '/quit',
    ]);
    const deps = baseDeps(db, io, xpAwardingTurn);

    const code = await runPlay(
      {
        ...deps,
        characterRegistry: memoryFinalizedStore({
          ezra: finalizedCharacter('Ezra', 'Wizard'),
        }),
      },
      { dbPath: 'demo.db' },
    );

    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('Level-up blocked:');
    expect(out).toContain('Choose a subclass');
    expect(out).toContain(
      'deterministic spell application is not implemented yet',
    );
    expect(
      db.prepare(`SELECT level FROM character WHERE id = 'pc-1'`).get(),
    ).toEqual({ level: 1 });
    dispose();
  });

  it('does not start a session when input ends before character creation is accepted', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO([]);

    const code = await runPlay(baseDeps(db, io), { dbPath: 'demo.db' });

    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('Character creation required');
    expect(getOpenSession(db, { campaignId: campaignId(db) })).toBeUndefined();
    dispose();
  });

  it('allows play only through the explicit character creation deferral path', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO(['/defer', 'look around', '/quit']);

    const code = await runPlay(baseDeps(db, io), { dbPath: 'demo.db' });

    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('Character creation deferred');
    expect(out).toContain('DM: you said "look around"');
    expect(
      db
        .prepare(`SELECT name, class_name FROM character WHERE id = 'pc-1'`)
        .get(),
    ).toEqual({ name: null, class_name: null });
    dispose();
  });

  it('rolls the campaign arc up after N session closes', async () => {
    // Multi-arc semantics: arc-1 rolls over only after N=5 closed sessions.
    // Share one baseDeps so the nextId counter produces unique session IDs across calls.
    const { db, dispose } = makeDb();
    const sharedDeps = baseDeps(db, scriptedIO([]).io);

    // Run 5 sessions, capturing the output of the final one.
    let lastLines: string[] = [];
    for (let i = 0; i < 5; i++) {
      const { io, lines } = scriptedIO(['/defer', 'look around', '/quit']);
      await runPlay({ ...sharedDeps, io }, { dbPath: 'demo.db' });
      lastLines = lines;
    }

    const cid = campaignId(db);
    // The 5th close triggered rollover: arc-1 should now be closed.
    const arc = getArcSummary(db, { campaignId: cid, arcId: 'arc-1' });
    expect(arc).toBeDefined();
    expect(arc?.sourceSessionIds).toHaveLength(5);
    expect(arc?.summary).toBe(FAKE_ARC_SUMMARY);

    // The extracted bible from the routed fake model lands in campaign_bible.
    const bible = getCampaignBible(db, { campaignId: cid });
    expect(bible).toBeDefined();
    expect(bible?.worldFacts.map((e) => e.text)).toContain(
      'Emberfall sits on a fault line',
    );
    expect(bible?.majorNpcs.map((e) => e.text)).toContain('Mira the runesmith');
    expect(bible?.factions.map((e) => e.text)).toContain('Lantern Court');
    expect(bible?.openThreads.map((e) => e.text)).toContain(
      'The chalk sigil is unsolved',
    );

    // The 5th session's output contains the rollover announcement.
    expect(lastLines.join('\n')).toContain('Arc arc-1 closed; opened arc-2.');

    dispose();
  });

  it('skips arc rollup and warns when the model errors at the Nth session close', async () => {
    // Multi-arc semantics: rollover is only attempted at N=5 closes.
    // Run N-1=4 sessions with the good model, then the 5th with a broken one.
    // Share one baseDeps so nextId produces unique session IDs across calls.
    const { db, dispose } = makeDb();
    const sharedDeps = baseDeps(db, scriptedIO([]).io);

    for (let i = 0; i < 4; i++) {
      const { io } = scriptedIO(['/defer', '/quit']);
      await runPlay({ ...sharedDeps, io }, { dbPath: 'demo.db' });
    }

    // 5th session: model always throws.
    const { io: badIo, lines } = scriptedIO(['/defer', 'look around', '/quit']);
    const code = await runPlay(
      {
        ...sharedDeps,
        io: badIo,
        model: {
          complete: async () => {
            throw new ModelClientError('provider down');
          },
        },
      },
      { dbPath: 'demo.db' },
    );

    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('closed and recapped');
    expect(out).toContain(
      'Arc rollup skipped (bible extraction failed): provider down.',
    );

    const cid = campaignId(db);
    // arc_summary row was NOT written.
    expect(
      getArcSummary(db, { campaignId: cid, arcId: 'arc-1' }),
    ).toBeUndefined();
    // arc-1 stays open.
    const arcRow = db
      .prepare(
        'SELECT status FROM campaign_arc WHERE campaign_id = ? AND arc_id = ?',
      )
      .get(cid, 'arc-1') as { status: string } | undefined;
    expect(arcRow?.status).toBe('open');
    // Session closed and recap written despite the arc rollup failure.
    expect(getOpenSession(db, { campaignId: cid })).toBeUndefined();
    const sessions = listSessions(db, { campaignId: cid });
    const lastSession = sessions[sessions.length - 1];
    expect(
      getSessionRecap(db, {
        campaignId: cid,
        sessionId: lastSession.sessionId,
      }),
    ).toBeDefined();

    dispose();
  });

  it('retries the bible call once and recovers when the second attempt succeeds', async () => {
    // Multi-arc semantics: bible is only called at N=5 closes.
    // Run N-1=4 sessions with the good model, then the 5th with the retry model.
    // Share one baseDeps so nextId produces unique session IDs across calls.
    const { db, dispose } = makeDb();
    const sharedDeps = baseDeps(db, scriptedIO([]).io);

    for (let i = 0; i < 4; i++) {
      const { io } = scriptedIO(['/defer', '/quit']);
      await runPlay({ ...sharedDeps, io }, { dbPath: 'demo.db' });
    }

    let bibleCallCount = 0;
    const { io: retryIo, lines } = scriptedIO([
      '/defer',
      'look around',
      '/quit',
    ]);
    const code = await runPlay(
      {
        ...sharedDeps,
        io: retryIo,
        model: routedFakeModel({
          bible: () => {
            bibleCallCount++;
            if (bibleCallCount === 1) {
              throw new ModelClientError('first attempt fails');
            }
            return ROUTED_FAKE_BIBLE_JSON;
          },
          summary: () => FAKE_ARC_SUMMARY,
        }),
      },
      { dbPath: 'demo.db' },
    );

    expect(code).toBe(0);
    expect(bibleCallCount).toBe(2);
    const out = lines.join('\n');
    expect(out).toContain('closed and recapped');
    // Retry succeeded silently: no skip warning written.
    expect(out).not.toContain('Arc rollup skipped');

    const cid = campaignId(db);
    const arc = getArcSummary(db, { campaignId: cid, arcId: 'arc-1' });
    expect(arc?.summary).toBe(FAKE_ARC_SUMMARY);
    const bible = getCampaignBible(db, { campaignId: cid });
    expect(bible?.worldFacts.map((e) => e.text)).toContain(
      'Emberfall sits on a fault line',
    );
    dispose();
  });

  it('skips the rollup and warns when bible extraction fails twice', async () => {
    // Multi-arc semantics: bible is only called at N=5 closes.
    // Run N-1=4 sessions with the good model, then the 5th with a bible-failing model.
    // Share one baseDeps so nextId produces unique session IDs across calls.
    const { db, dispose } = makeDb();
    const sharedDeps = baseDeps(db, scriptedIO([]).io);

    for (let i = 0; i < 4; i++) {
      const { io } = scriptedIO(['/defer', '/quit']);
      await runPlay({ ...sharedDeps, io }, { dbPath: 'demo.db' });
    }

    const { io: badIo, lines } = scriptedIO(['/defer', 'look around', '/quit']);
    const code = await runPlay(
      {
        ...sharedDeps,
        io: badIo,
        model: routedFakeModel({
          bible: () => {
            throw new ModelClientError('bible provider down');
          },
          summary: () => FAKE_ARC_SUMMARY,
        }),
      },
      { dbPath: 'demo.db' },
    );

    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('closed and recapped');
    expect(out).toContain(
      'Arc rollup skipped (bible extraction failed): bible provider down.',
    );

    const cid = campaignId(db);
    // Session closed and recap written despite the bible failure.
    expect(getOpenSession(db, { campaignId: cid })).toBeUndefined();
    const sessions = listSessions(db, { campaignId: cid });
    const lastSession = sessions[sessions.length - 1];
    expect(
      getSessionRecap(db, {
        campaignId: cid,
        sessionId: lastSession.sessionId,
      }),
    ).toBeDefined();
    // No arc_summary row was written because the bible call failed both attempts.
    expect(
      getArcSummary(db, { campaignId: cid, arcId: 'arc-1' }),
    ).toBeUndefined();
    dispose();
  });

  it('skips the rollup and warns when arc summary fails after bible succeeded', async () => {
    // Multi-arc semantics: arc summary is only called at N=5 closes.
    // Run N-1=4 sessions with the good model, then the 5th with a summary-failing model.
    // Share one baseDeps so nextId produces unique session IDs across calls.
    const { db, dispose } = makeDb();
    const sharedDeps = baseDeps(db, scriptedIO([]).io);

    for (let i = 0; i < 4; i++) {
      const { io } = scriptedIO(['/defer', '/quit']);
      await runPlay({ ...sharedDeps, io }, { dbPath: 'demo.db' });
    }

    const { io: badIo, lines } = scriptedIO(['/defer', 'look around', '/quit']);
    const code = await runPlay(
      {
        ...sharedDeps,
        io: badIo,
        model: routedFakeModel({
          bible: () => ROUTED_FAKE_BIBLE_JSON,
          summary: () => {
            throw new ModelClientError('summary provider down');
          },
        }),
      },
      { dbPath: 'demo.db' },
    );

    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('closed and recapped');
    expect(out).toContain(
      'Arc rollup skipped (arc summary failed): summary provider down.',
    );

    const cid = campaignId(db);
    // No arc_summary row was written despite the bible succeeding — the
    // contract is atomic: both must succeed or neither writes.
    expect(
      getArcSummary(db, { campaignId: cid, arcId: 'arc-1' }),
    ).toBeUndefined();
    // Also no campaign_bible row, since rollupArcSummary is what writes it.
    expect(getCampaignBible(db, { campaignId: cid })).toBeUndefined();
    dispose();
  });

  // --- New multi-arc lifecycle tests ---

  it('rolls over at the Nth session close', async () => {
    // Drive N=5 runPlay invocations, then assert arc-1 is closed, arc-2 is open.
    // Share one baseDeps so nextId produces unique session IDs across all 5 calls.
    const { db, dispose } = makeDb();
    const sharedDeps = baseDeps(db, scriptedIO([]).io);

    let lastLines: string[] = [];
    for (let i = 0; i < 5; i++) {
      const { io, lines } = scriptedIO(['/defer', '/quit']);
      await runPlay({ ...sharedDeps, io }, { dbPath: 'demo.db' });
      lastLines = lines;
    }

    const cid = campaignId(db);

    // arc-1 is closed with a summary covering 5 sessions.
    const arc1Row = db
      .prepare(
        'SELECT arc_id, status, sequence_no FROM campaign_arc WHERE campaign_id = ? AND arc_id = ?',
      )
      .get(cid, 'arc-1') as
      | { arc_id: string; status: string; sequence_no: number }
      | undefined;
    expect(arc1Row?.status).toBe('closed');

    const arc1Summary = getArcSummary(db, { campaignId: cid, arcId: 'arc-1' });
    expect(arc1Summary).toBeDefined();
    expect(arc1Summary?.sourceSessionIds).toHaveLength(5);

    // arc-2 is now open.
    const arc2Row = db
      .prepare(
        'SELECT arc_id, status FROM campaign_arc WHERE campaign_id = ? AND arc_id = ?',
      )
      .get(cid, 'arc-2') as { arc_id: string; status: string } | undefined;
    expect(arc2Row?.status).toBe('open');

    // The 5th session's output contains the rollover announcement.
    expect(lastLines.join('\n')).toContain('Arc arc-1 closed; opened arc-2.');

    dispose();
  });

  it('does not roll over before the Nth session', async () => {
    // Drive N-1=4 runPlay invocations, assert arc-1 is still open and no arc_summary exists.
    // Share one baseDeps so nextId produces unique session IDs across all 4 calls.
    const { db, dispose } = makeDb();
    const sharedDeps = baseDeps(db, scriptedIO([]).io);

    for (let i = 0; i < 4; i++) {
      const { io } = scriptedIO(['/defer', '/quit']);
      await runPlay({ ...sharedDeps, io }, { dbPath: 'demo.db' });
    }

    const cid = campaignId(db);

    // No arc_summary row exists yet.
    expect(
      getArcSummary(db, { campaignId: cid, arcId: 'arc-1' }),
    ).toBeUndefined();

    // arc-1 is still open.
    const arc1Row = db
      .prepare(
        'SELECT status FROM campaign_arc WHERE campaign_id = ? AND arc_id = ?',
      )
      .get(cid, 'arc-1') as { status: string } | undefined;
    expect(arc1Row?.status).toBe('open');

    // All 4 closed sessions are stamped with arc_id='arc-1'.
    const sessions = listSessions(db, { campaignId: cid });
    expect(sessions).toHaveLength(4);
    for (const s of sessions) {
      const row = db
        .prepare(
          'SELECT arc_id FROM campaign_session WHERE campaign_id = ? AND session_id = ?',
        )
        .get(cid, s.sessionId) as { arc_id: string } | undefined;
      expect(row?.arc_id).toBe('arc-1');
    }

    dispose();
  });

  it('rolls over again at 2*N sessions', async () => {
    // Use a smaller threshold (N=3) so 2*N=6 invocations cover two full rollovers.
    // This keeps runtime manageable while exercising the double-rollover path.
    // Share one baseDeps so nextId produces unique session IDs across all 6 calls.
    const { db, dispose } = makeDb();
    const N = 3;
    const sharedDeps = baseDeps(db, scriptedIO([]).io);

    for (let i = 0; i < 2 * N; i++) {
      const { io } = scriptedIO(['/defer', '/quit']);
      await runPlay(
        {
          ...sharedDeps,
          io,
          memoryConfig: { arcRolloverThreshold: N, recapWindowSize: 5 },
        },
        { dbPath: 'demo.db' },
      );
    }

    const cid = campaignId(db);

    // Two arc_summary rows: arc-1 and arc-2, each with N source sessions.
    const summaries = listClosedArcSummaries(db, { campaignId: cid });
    expect(summaries).toHaveLength(2);
    expect(summaries[0]?.arcId).toBe('arc-1');
    expect(summaries[0]?.sourceSessionIds).toHaveLength(N);
    expect(summaries[1]?.arcId).toBe('arc-2');
    expect(summaries[1]?.sourceSessionIds).toHaveLength(N);

    // arc-1 and arc-2 are closed.
    for (const arcId of ['arc-1', 'arc-2']) {
      const row = db
        .prepare(
          'SELECT status FROM campaign_arc WHERE campaign_id = ? AND arc_id = ?',
        )
        .get(cid, arcId) as { status: string } | undefined;
      expect(row?.status).toBe('closed');
    }

    // arc-3 is open with no stamped sessions yet.
    const openArc = getOpenArc(db, { campaignId: cid });
    expect(openArc?.arcId).toBe('arc-3');

    const sessionsInArc3 = getClosedSessionsInOpenArc(db, { campaignId: cid });
    expect(sessionsInArc3).toHaveLength(0);

    dispose();
  });

  it('feeds prior bible and closed arc summaries into the extractor on the second rollover', async () => {
    // Documents the 06b.1 contract: the first rollover sees neither block
    // (no prior bible row, no closed arcs yet); the second rollover passes
    // both — the previously-extracted bible's entries appear as
    // "## previously known bible" and the closed arc-1 summary appears
    // as "## closed arc summaries".
    const { db, dispose } = makeDb();
    const N = 3;
    const sharedDeps = baseDeps(db, scriptedIO([]).io);

    const bibleCallContents: string[] = [];
    const capturingModel: ModelClient = {
      complete: async (input) => {
        if (input.system?.includes('extract structured world facts')) {
          bibleCallContents.push(input.messages[0]?.content ?? '');
          return { text: ROUTED_FAKE_BIBLE_JSON };
        }
        return { text: FAKE_ARC_SUMMARY };
      },
    };

    for (let i = 0; i < 2 * N; i++) {
      const { io } = scriptedIO(['/defer', '/quit']);
      await runPlay(
        {
          ...sharedDeps,
          io,
          model: capturingModel,
          memoryConfig: { arcRolloverThreshold: N, recapWindowSize: 5 },
        },
        { dbPath: 'demo.db' },
      );
    }

    // Exactly two bible calls — one per rollover.
    expect(bibleCallContents).toHaveLength(2);

    const first = bibleCallContents[0];
    expect(first).not.toContain('## previously known bible');
    expect(first).not.toContain('## closed arc summaries');

    const second = bibleCallContents[1];
    expect(second).toContain('## previously known bible');
    // The bible written by the first rollover (from ROUTED_FAKE_BIBLE_JSON)
    // must round-trip back into the extractor input.
    expect(second).toContain('- Emberfall sits on a fault line');
    expect(second).toContain('- Mira the runesmith');
    expect(second).toContain('- Lantern Court');
    expect(second).toContain('- The chalk sigil is unsolved');
    expect(second).toContain('## closed arc summaries');
    expect(second).toContain(`- arc-1: ${FAKE_ARC_SUMMARY}`);

    dispose();
  });

  it('skips rollover and warns when the model errors during rollover', async () => {
    // Drive N-1=4 successful invocations, then the Nth with a model that throws on the bible call.
    // Share one baseDeps so nextId produces unique session IDs across all 5 calls.
    const { db, dispose } = makeDb();
    const sharedDeps = baseDeps(db, scriptedIO([]).io);

    for (let i = 0; i < 4; i++) {
      const { io } = scriptedIO(['/defer', '/quit']);
      await runPlay({ ...sharedDeps, io }, { dbPath: 'demo.db' });
    }

    // 5th (Nth) session: bible call throws.
    const { io: failIo, lines } = scriptedIO(['/defer', '/quit']);
    const code = await runPlay(
      {
        ...sharedDeps,
        io: failIo,
        model: {
          complete: async () => {
            throw new ModelClientError('provider down');
          },
        },
      },
      { dbPath: 'demo.db' },
    );

    expect(code).toBe(0);
    const out = lines.join('\n');

    // The final session is fully closed and recapped.
    expect(out).toContain('closed and recapped');

    // No arc_summary row for arc-1.
    const cid = campaignId(db);
    expect(
      getArcSummary(db, { campaignId: cid, arcId: 'arc-1' }),
    ).toBeUndefined();

    // arc-1 is still open.
    const arc1Row = db
      .prepare(
        'SELECT status FROM campaign_arc WHERE campaign_id = ? AND arc_id = ?',
      )
      .get(cid, 'arc-1') as { status: string } | undefined;
    expect(arc1Row?.status).toBe('open');

    // The 5th session is stamped with arc_id='arc-1'.
    const sessions = listSessions(db, { campaignId: cid });
    const lastSession = sessions[sessions.length - 1];
    const sessionRow = db
      .prepare(
        'SELECT arc_id FROM campaign_session WHERE campaign_id = ? AND session_id = ?',
      )
      .get(cid, lastSession.sessionId) as { arc_id: string } | undefined;
    expect(sessionRow?.arc_id).toBe('arc-1');

    // Skip warning present; rollover announcement absent.
    expect(out).toContain(
      'Arc rollup skipped (bible extraction failed): provider down.',
    );
    expect(out).not.toContain('Arc arc-1 closed; opened arc-2.');
    // Session closed and recap written despite the rollover failure.
    expect(getOpenSession(db, { campaignId: cid })).toBeUndefined();
    expect(
      getSessionRecap(db, {
        campaignId: cid,
        sessionId: lastSession.sessionId,
      }),
    ).toBeDefined();

    dispose();
  });

  it('recovers on the next session after a transient rollover failure', async () => {
    // Documented graceful-degradation path: rollover model call fails at the
    // Nth close → arc-1 stays open with N stamped sessions. The next session
    // (N+1) closes, gets stamped onto the still-open arc-1, and at close time
    // the rollover retries — this time with N+1 source sessions.
    const { db, dispose } = makeDb();
    const sharedDeps = baseDeps(db, scriptedIO([]).io);

    // 4 successful pre-rollover sessions.
    for (let i = 0; i < 4; i++) {
      const { io } = scriptedIO(['/defer', '/quit']);
      await runPlay({ ...sharedDeps, io }, { dbPath: 'demo.db' });
    }

    // 5th (Nth) session: model fails during the rollover step.
    const { io: failIo, lines: failLines } = scriptedIO(['/defer', '/quit']);
    await runPlay(
      {
        ...sharedDeps,
        io: failIo,
        model: {
          complete: async () => {
            throw new ModelClientError('provider down');
          },
        },
      },
      { dbPath: 'demo.db' },
    );

    const cid = campaignId(db);

    // Sanity: rollover was skipped at session 5; arc-1 still open with 5 stamped closed sessions.
    expect(failLines.join('\n')).toContain(
      'Arc rollup skipped (bible extraction failed): provider down.',
    );
    expect(
      getArcSummary(db, { campaignId: cid, arcId: 'arc-1' }),
    ).toBeUndefined();
    expect(getClosedSessionsInOpenArc(db, { campaignId: cid })).toHaveLength(5);

    // 6th (N+1) session: model recovers. The threshold check kicks in again
    // with 6 closed sessions stamped to arc-1.
    const { io: okIo, lines: okLines } = scriptedIO(['/defer', '/quit']);
    const code = await runPlay(
      { ...sharedDeps, io: okIo },
      { dbPath: 'demo.db' },
    );

    expect(code).toBe(0);
    expect(okLines.join('\n')).toContain('Arc arc-1 closed; opened arc-2.');

    // arc-1 is now closed with N+1 = 6 source sessions in the summary.
    const arc1Row = db
      .prepare(
        'SELECT status FROM campaign_arc WHERE campaign_id = ? AND arc_id = ?',
      )
      .get(cid, 'arc-1') as { status: string } | undefined;
    expect(arc1Row?.status).toBe('closed');

    const arc1Summary = getArcSummary(db, { campaignId: cid, arcId: 'arc-1' });
    expect(arc1Summary).toBeDefined();
    expect(arc1Summary?.sourceSessionIds).toHaveLength(6);

    // arc-2 is now open with no closed sessions stamped to it yet.
    const openArc = getOpenArc(db, { campaignId: cid });
    expect(openArc?.arcId).toBe('arc-2');
    expect(getClosedSessionsInOpenArc(db, { campaignId: cid })).toHaveLength(0);

    dispose();
  });

  it('throws on invalid memoryConfig', async () => {
    // Validation runs at runPlay entry so a misconfigured deployment fails
    // loud instead of silently rolling over on every close (threshold=0) or
    // assembling an empty recap window every turn (recapWindowSize=0).
    const { db, dispose } = makeDb();
    const { io } = scriptedIO([]);
    await expect(
      runPlay(
        {
          ...baseDeps(db, io),
          memoryConfig: { arcRolloverThreshold: 0, recapWindowSize: 5 },
        },
        { dbPath: 'demo.db' },
      ),
    ).rejects.toThrow(/arcRolloverThreshold/);
    dispose();
  });

  it('honors memoryConfig.recapWindowSize by passing it to runTurn as recentSessionLimit', async () => {
    // Close 5 sessions so there are 5 recaps available.
    // Then run a 6th session with recapWindowSize=3 and assert via assembleContext
    // that only 3 recaps are returned (omittedSessionCount=2).
    const { db, dispose } = makeDb();
    const sharedDeps = baseDeps(db, scriptedIO([]).io);

    for (let i = 0; i < 5; i++) {
      const { io } = scriptedIO(['/defer', '/quit']);
      await runPlay({ ...sharedDeps, io }, { dbPath: 'demo.db' });
    }

    const cid = campaignId(db);

    // Start a 6th session (don't drive a full runPlay turn — just stage the
    // session and call assembleContext directly with the custom limit).
    const sid6 = 'test-session-6';
    startSession(db, {
      campaignId: cid,
      sessionId: sid6,
      startedAt: new Date().toISOString(),
    });

    const ctx3 = assembleContext({
      db,
      campaignId: cid,
      sessionId: sid6,
      playerInput: 'what happened before?',
      recentSessionLimit: 3,
    });

    expect(ctx3.recentSessionRecaps).toHaveLength(3);
    expect(ctx3.omittedSessionCount).toBe(2);

    // Verify that without the limit (or with a larger limit) all 5 recaps appear.
    const ctx5 = assembleContext({
      db,
      campaignId: cid,
      sessionId: sid6,
      playerInput: 'what happened before?',
      recentSessionLimit: 5,
    });
    expect(ctx5.recentSessionRecaps).toHaveLength(5);
    expect(ctx5.omittedSessionCount).toBe(0);

    dispose();
  });

  it('quits gracefully when input ends (EOF) before any turn', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO(['/defer']); // EOF after launch.

    const code = await runPlay(baseDeps(db, io), { dbPath: 'demo.db' });

    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('closed and recapped');
    expect(getOpenSession(db, { campaignId: campaignId(db) })).toBeUndefined();
    dispose();
  });

  it('offers Resume for an open session and replays the scene tail', async () => {
    const { db, dispose } = makeDb();
    seedOpenSession(db);
    const { io, lines } = scriptedIO(['/defer', 'resume', '/quit']);

    await runPlay(baseDeps(db, io), { dbPath: 'demo.db' });

    const out = lines.join('\n');
    expect(out).toContain('An unfinished session is open: crashed-session');
    expect(out).toContain('— Recent scene: Emberfall Square —');
    expect(out).toContain('player: search the rubble');
    expect(out).toContain('Resuming session crashed-session');
    dispose();
  });

  it("replays the DM's last output as a recap when resuming an existing campaign in a new session (eshyra-w8f2)", async () => {
    const { db, dispose } = makeDb();
    // First session: play a turn so the DM records output, then quit to close
    // it cleanly. This leaves the campaign with prior DM output but no open
    // session.
    await runPlay(
      baseDeps(db, scriptedIO(['/defer', 'look around', '/quit']).io),
      { dbPath: 'demo.db' },
    );

    // Second session over the same campaign: no session is open, so launch
    // starts a new one — and must first replay the DM's last words.
    const { io, lines } = scriptedIO(['/defer', '/quit']);
    await runPlay(baseDeps(db, io), { dbPath: 'demo.db' });

    const out = lines.join('\n');
    expect(out).toContain('— Resuming campaign. The DM last said: —');
    expect(out).toContain('DM: you said "look around"');
    dispose();
  });

  it('does not replay a recap for a brand-new campaign with no prior DM output (eshyra-w8f2)', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO(['/defer', '/quit']);

    await runPlay(baseDeps(db, io), { dbPath: 'demo.db' });

    expect(lines.join('\n')).not.toContain(
      'Resuming campaign. The DM last said',
    );
    dispose();
  });

  it('offers the adventure-module selector on a fresh campaign and binds the choice (eshyra-47ob)', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO(['/defer', '1', '/quit']);

    await runPlay(
      baseDeps(
        db,
        io,
        fakeRunTurn,
        () => undefined,
        () => HOLLOW_MODULES,
      ),
      { dbPath: 'demo.db' },
    );

    const out = lines.join('\n');
    expect(out).toContain('Choose an adventure to begin this campaign:');
    expect(out).toContain('The Hollow Beneath Emberfall');
    expect(out).toContain('Beginning adventure: The Hollow Beneath Emberfall.');

    const runs = listAdventureRuns(db, { campaignId: campaignId(db) });
    expect(runs.map((r) => r.moduleId)).toEqual([HOLLOW_MODULE_ID]);
    expect(runs[0]?.status).toBe('active');
    dispose();
  });

  it('re-prompts on an out-of-range answer, then binds the valid choice (eshyra-47ob)', async () => {
    const { db, dispose } = makeDb();
    // '9' is out of the [0–1] range for a one-module list; the selector
    // re-prompts and '1' selects.
    const { io, lines } = scriptedIO(['/defer', '9', '1', '/quit']);

    await runPlay(
      baseDeps(
        db,
        io,
        fakeRunTurn,
        () => undefined,
        () => HOLLOW_MODULES,
      ),
      { dbPath: 'demo.db' },
    );

    const out = lines.join('\n');
    expect(out).toContain("'9' is not one of 0–1");
    expect(
      listAdventureRuns(db, { campaignId: campaignId(db) }).map(
        (r) => r.moduleId,
      ),
    ).toEqual([HOLLOW_MODULE_ID]);
    dispose();
  });

  it('rejects a numeric-prefixed answer like "1abc" as malformed rather than parsing it as 1 (eshyra-47ob)', async () => {
    const { db, dispose } = makeDb();
    // '1abc' must NOT be accepted as choice 1 (a bare Number.parseInt would);
    // 'abc' is plainly non-numeric. Both re-prompt; '1' then selects.
    const { io, lines } = scriptedIO(['/defer', '1abc', 'abc', '1', '/quit']);

    await runPlay(
      baseDeps(
        db,
        io,
        fakeRunTurn,
        () => undefined,
        () => HOLLOW_MODULES,
      ),
      { dbPath: 'demo.db' },
    );

    const out = lines.join('\n');
    expect(out).toContain("'1abc' is not one of 0–1");
    expect(out).toContain("'abc' is not one of 0–1");
    // Only the explicit '1' bound a run — '1abc' did not silently bind one.
    expect(
      listAdventureRuns(db, { campaignId: campaignId(db) }).map(
        (r) => r.moduleId,
      ),
    ).toEqual([HOLLOW_MODULE_ID]);
    dispose();
  });

  it('keeps the default and binds nothing when the player declines with 0 (eshyra-47ob)', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO(['/defer', '0', '/quit']);

    await runPlay(
      baseDeps(
        db,
        io,
        fakeRunTurn,
        () => undefined,
        () => HOLLOW_MODULES,
      ),
      { dbPath: 'demo.db' },
    );

    const out = lines.join('\n');
    expect(out).toContain('Choose an adventure to begin this campaign:');
    expect(out).not.toContain('Beginning adventure:');
    expect(listAdventureRuns(db, { campaignId: campaignId(db) })).toEqual([]);
    dispose();
  });

  it('passes the selected adventure module to the real turn orchestrator (eshyra-seoh)', async () => {
    const { db, dispose } = makeDb();
    const { io } = scriptedIO([
      '/defer',
      '1',
      'look toward the watchtower',
      '/quit',
    ]);
    let turnContext = '';
    let turnModelCalls = 0;
    const model: ModelClient = {
      complete: async (input) => {
        if (input.system?.includes('extract structured world facts')) {
          return { text: ROUTED_FAKE_BIBLE_JSON };
        }
        turnContext = input.messages[0]?.content ?? '';
        if (turnModelCalls++ === 0) {
          return {
            text: [
              '```tool_call',
              '{"tool":"start_encounter","args":{"encounterId":"enc-mouth-ambush"}}',
              '```',
            ].join('\n'),
          };
        }
        return { text: 'The watchtower mouth looms ahead.' };
      },
    };
    const modulesById = new Map(
      HOLLOW_MODULES.map(({ module }) => [module.id, module]),
    );

    await runPlay(
      {
        ...baseDeps(
          db,
          io,
          runTurn,
          () => undefined,
          () => HOLLOW_MODULES,
        ),
        model,
        resolveAdventureModule: (moduleId) => modulesById.get(moduleId),
      },
      { dbPath: 'demo.db' },
    );

    expect(turnContext).toContain('## Adventure Module (DM-only)');
    expect(turnContext).toContain('The Hollow Beneath Emberfall');
    expect(listCombatants(db, campaignId(db))).toHaveLength(2);
    dispose();
  });

  it('does not offer the selector when no adventure modules are installed (eshyra-47ob)', async () => {
    const { db, dispose } = makeDb();
    // baseDeps defaults listAdventureModules to an empty list.
    const { io, lines } = scriptedIO(['/defer', '/quit']);

    await runPlay(baseDeps(db, io), { dbPath: 'demo.db' });

    expect(lines.join('\n')).not.toContain('Choose an adventure');
    expect(listAdventureRuns(db, { campaignId: campaignId(db) })).toEqual([]);
    dispose();
  });

  it('does not offer the selector when resuming a campaign with prior DM output (eshyra-47ob)', async () => {
    const { db, dispose } = makeDb();
    // First session plays a turn (records DM output) and closes cleanly.
    await runPlay(
      baseDeps(db, scriptedIO(['/defer', 'look around', '/quit']).io),
      { dbPath: 'demo.db' },
    );

    // Second session: modules are now available, but prior DM output exists, so
    // the new-session selector must not fire.
    const { io, lines } = scriptedIO(['/defer', '/quit']);
    await runPlay(
      baseDeps(
        db,
        io,
        fakeRunTurn,
        () => undefined,
        () => HOLLOW_MODULES,
      ),
      { dbPath: 'demo.db' },
    );

    expect(lines.join('\n')).not.toContain('Choose an adventure');
    expect(listAdventureRuns(db, { campaignId: campaignId(db) })).toEqual([]);
    dispose();
  });

  it('does not re-offer the selector when a run is already bound but no turns were played (eshyra-47ob)', async () => {
    const { db, dispose } = makeDb();
    // First launch: select a module, then quit before any turn — a run is bound
    // but there is no DM output yet.
    await runPlay(
      baseDeps(
        db,
        scriptedIO(['/defer', '1', '/quit']).io,
        fakeRunTurn,
        () => undefined,
        () => HOLLOW_MODULES,
      ),
      { dbPath: 'demo.db' },
    );
    expect(listAdventureRuns(db, { campaignId: campaignId(db) })).toHaveLength(
      1,
    );

    // Second launch: lastDmOutput is still undefined, but the existing run must
    // suppress a second prompt and a duplicate binding.
    const { io, lines } = scriptedIO(['/defer', '/quit']);
    await runPlay(
      baseDeps(
        db,
        io,
        fakeRunTurn,
        () => undefined,
        () => HOLLOW_MODULES,
      ),
      { dbPath: 'demo.db' },
    );

    expect(lines.join('\n')).not.toContain('Choose an adventure');
    expect(listAdventureRuns(db, { campaignId: campaignId(db) })).toHaveLength(
      1,
    );
    dispose();
  });

  it('closes and recaps an open session when the player chooses close', async () => {
    const { db, dispose } = makeDb();
    seedOpenSession(db);
    const { io, lines } = scriptedIO(['/defer', 'close', '/quit']);

    await runPlay(baseDeps(db, io), { dbPath: 'demo.db' });

    expect(lines.join('\n')).toContain(
      'Session crashed-session closed and recapped',
    );
    expect(
      getSession(db, { campaignId: 'camp', sessionId: 'crashed-session' })
        ?.status,
    ).toBe('closed');
    // A fresh session was started for continued play.
    expect(getOpenSession(db, { campaignId: 'camp' })?.sessionId).not.toBe(
      'crashed-session',
    );
    dispose();
  });

  it('reports a failed turn and keeps playing without applying it', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO(['/defer', 'risky move', '/quit']);
    const failingRunTurn = vi.fn(
      async (_deps: unknown, input: RunTurnInput): Promise<RunTurnResult> => ({
        ok: false,
        turnId: input.turnId,
        narration: '',
        toolCalls: [],
        sceneId: undefined,
        modelRounds: 0,
        error: 'model boom',
        isRateLimit: false,
      }),
    );

    const code = await runPlay(
      baseDeps(db, io, failingRunTurn as unknown as PlayDeps['runTurn']),
      { dbPath: 'demo.db' },
    );

    expect(code).toBe(0);
    expect(failingRunTurn).toHaveBeenCalledOnce();
    const out = lines.join('\n');
    expect(out).toContain('could not be completed');
    expect(out).toContain('model boom');
    expect(out).toContain('closed and recapped');
    dispose();
  });

  it('displays rate-limit message rather than generic failed-turn message when isRateLimit=true', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO(['/defer', 'risky move', '/quit']);
    const rateLimitRunTurn = vi.fn(
      async (_deps: unknown, input: RunTurnInput): Promise<RunTurnResult> => ({
        ok: false,
        turnId: input.turnId,
        narration: '',
        toolCalls: [],
        sceneId: undefined,
        modelRounds: 0,
        error:
          "You've hit your session limit · resets 2:30am (America/Chicago)",
        isRateLimit: true,
      }),
    );

    const code = await runPlay(
      baseDeps(db, io, rateLimitRunTurn as unknown as PlayDeps['runTurn']),
      { dbPath: 'demo.db' },
    );

    expect(code).toBe(0);
    expect(rateLimitRunTurn).toHaveBeenCalledOnce();
    const out = lines.join('\n');
    expect(out).toContain('Model provider rate limit reached.');
    expect(out).toContain('Try again later.');
    expect(out).not.toContain('could not be completed');
    expect(out).toContain('closed and recapped');
    dispose();
  });

  it('includes retry-after hint in rate-limit message when retryAfterSeconds is set', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO(['/defer', 'risky move', '/quit']);
    const rateLimitRunTurn = vi.fn(
      async (_deps: unknown, input: RunTurnInput): Promise<RunTurnResult> => ({
        ok: false,
        turnId: input.turnId,
        narration: '',
        toolCalls: [],
        sceneId: undefined,
        modelRounds: 0,
        error: 'Anthropic API rate limit: 429',
        isRateLimit: true,
        retryAfterSeconds: 30,
      }),
    );

    const code = await runPlay(
      baseDeps(db, io, rateLimitRunTurn as unknown as PlayDeps['runTurn']),
      { dbPath: 'demo.db' },
    );

    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('Model provider rate limit reached.');
    expect(out).toContain('Try again in 30s.');
    expect(out).not.toContain('could not be completed');
    dispose();
  });

  it('checkpoints the campaign on graceful exit and reports the id', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO(['/defer', 'explore', '/quit']);
    const run = vi.fn((_liveDbPath: string, message: string) => {
      expect(message).toContain('session');
      return 'checkpoint-abc123';
    });

    const code = await runPlay(
      baseDeps(db, io, fakeRunTurn, (dbPath) => ({ liveDbPath: dbPath, run })),
      { dbPath: 'campaign.db' },
    );

    expect(code).toBe(0);
    expect(run).toHaveBeenCalledOnce();
    // The runner is handed the actual campaign DB path to snapshot.
    expect(run.mock.calls[0][0]).toBe('campaign.db');
    expect(lines.join('\n')).toContain('(checkpoint checkpoint-abc123)');
    dispose();
  });

  it('closes gracefully without a checkpoint when Dolt is unavailable', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO(['/defer', '/quit']);

    await runPlay(
      baseDeps(db, io, fakeRunTurn, () => undefined),
      {
        dbPath: 'campaign.db',
      },
    );

    const out = lines.join('\n');
    expect(out).toContain('closed and recapped');
    expect(out).toMatch(/Dolt is not available/i);
    expect(getOpenSession(db, { campaignId: campaignId(db) })).toBeUndefined();
    dispose();
  });

  it('still closes the session when the checkpoint itself fails', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO(['/defer', '/quit']);

    const code = await runPlay(
      baseDeps(db, io, fakeRunTurn, (dbPath) => ({
        liveDbPath: dbPath,
        run: () => {
          throw new Error('dolt exploded');
        },
      })),
      { dbPath: 'campaign.db' },
    );

    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('checkpoint failed');
    expect(out).toContain('dolt exploded');
    // The session is still closed — the close pipeline ran before the
    // checkpoint, so a checkpoint failure never strands an open session.
    expect(getOpenSession(db, { campaignId: campaignId(db) })).toBeUndefined();
    dispose();
  });
});

describe('runDemo', () => {
  it('reports /wallet as unavailable in a fresh sheetless demo instead of crashing', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO(['/wallet', '/quit']);

    const code = await runDemo(baseDeps(db, io), {
      dbPath: 'demo.db',
      turnCap: 5,
    });

    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('Wallet unavailable: no character sheet stored');
    expect(out).toContain('closed and recapped');
    dispose();
  });

  it('creates a bounded demo campaign and stops at the turn cap', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO([
      'look around',
      'open the door',
      'third turn',
    ]);

    const code = await runDemo(baseDeps(db, io), {
      dbPath: 'demo.db',
      turnCap: 2,
    });

    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('Demo campaign');
    expect(out).toContain('Bounded demo: 2 turns');
    expect(out).toContain('DM: you said "look around"');
    expect(out).toContain('DM: you said "open the door"');
    // The cap stops the loop before the third input is ever read.
    expect(out).toContain('Demo turn cap reached (2/2)');
    expect(out).not.toContain('third turn');
    expect(out).toContain('closed and recapped');
    dispose();
  });

  it('reuses an existing demo campaign on a later run', async () => {
    const { db, dispose } = makeDb();
    const firstDeps = baseDeps(db, scriptedIO(['first turn']).io);
    // First run creates the demo campaign and plays one turn.
    await runDemo(firstDeps, {
      dbPath: 'demo.db',
      turnCap: 5,
    });

    // A second run on the same db reuses the campaign rather than recreating.
    const { io, lines } = scriptedIO(['/quit']);
    const code = await runDemo(
      { ...firstDeps, io },
      {
        dbPath: 'demo.db',
        turnCap: 5,
      },
    );

    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('Demo campaign:'); // the "existing campaign" branch
    expect(out).not.toContain("Demo campaign '"); // not the "created" branch
    dispose();
  });
});

describe.skipIf(!DoltRepo.available())(
  'runPlay Dolt checkpoint integration',
  () => {
    it(
      'writes a real Dolt checkpoint of the campaign on graceful exit',
      async () => {
        const root = mkdtempSync(join(tmpdir(), 'lw-play-cp-'));
        const dbPath = join(root, 'campaign.db');
        const db = openDatabase(dbPath);
        initSchema(db);
        const { io, lines } = scriptedIO(['/defer', 'look around', '/quit']);

        const code = await runPlay(
          { ...baseDeps(db, io), makeCheckpointRunner: doltCheckpointRunner },
          { dbPath },
        );

        expect(code).toBe(0);
        // A real Dolt commit hash was produced and reported.
        expect(lines.join('\n')).toMatch(/\(checkpoint [0-9a-z]+\)/);
      },
      DOLT_TEST_TIMEOUT_MS,
    );
  },
);

function campaignId(db: Db): string {
  const campaign = getCampaign(db);
  if (campaign === undefined) {
    throw new Error('expected a campaign to exist');
  }
  return campaign.campaignId;
}

/** Seed a campaign with an open session + open scene — i.e. a crashed run. */
function seedOpenSession(db: Db): void {
  createCampaign(db, { campaignId: 'camp', pack: EMBERFALL_HOLLOW });
  startSession(db, {
    campaignId: 'camp',
    sessionId: 'crashed-session',
    startedAt: '2026-05-19T00:00:00.000Z',
  });
  openScene(db, {
    campaignId: 'camp',
    sessionId: 'crashed-session',
    sceneId: 'scene-1',
    title: 'Emberfall Square',
    at: '2026-05-19T00:01:00.000Z',
  });
  appendSceneLog(db, {
    campaignId: 'camp',
    sessionId: 'crashed-session',
    sceneId: 'scene-1',
    turnId: 'turn-1',
    role: 'player',
    content: 'search the rubble',
    at: '2026-05-19T00:02:00.000Z',
  });
}
