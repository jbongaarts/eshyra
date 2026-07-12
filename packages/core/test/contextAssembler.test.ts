import { describe, expect, it } from 'vitest';
import type {
  AbilityScoreName,
  CharacterSheet,
  Db,
  FinalizedAbilityScore,
} from '../src/internal.js';
import {
  appendSceneLog,
  assembleContext,
  closeOpenArcAndOpenNext,
  closeScene,
  createCharacterChronicleStore,
  createSqliteCharacterSheetStore,
  DND5E_SRD_PACK_ID,
  DND5E_SRD_SYSTEM_ID,
  ensureCharacterRegistrySchema,
  memoryDrilldown,
  mutateState,
  openArcIfMissing,
  openDatabase,
  openScene,
  recordSceneSummary,
  renderContextMessage,
  rollupSessionRecap,
  stampSessionWithOpenArc,
  startAdventureRun,
} from '../src/internal.js';
import { makeTestAdventureModule } from './support/adventureModuleFixture.js';
import { freshDbWithSession } from './support/db.js';

const CAMPAIGN = 'campaign-1';
const SESSION = 'session-2';
const ABILITIES: AbilityScoreName[] = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];

function logTurn(
  db: Db,
  sceneId: string,
  turnId: string,
  player: string,
  dm: string,
): void {
  appendSceneLog(db, {
    campaignId: CAMPAIGN,
    sessionId: SESSION,
    sceneId,
    turnId,
    role: 'player',
    content: player,
    at: '2026-05-20T10:00:00.000Z',
  });
  appendSceneLog(db, {
    campaignId: CAMPAIGN,
    sessionId: SESSION,
    sceneId,
    turnId,
    role: 'dm',
    content: dm,
    at: '2026-05-20T10:00:01.000Z',
  });
}

function testSheet(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const abilityScores = {} as Record<AbilityScoreName, FinalizedAbilityScore>;
  const savingThrows = {} as CharacterSheet['savingThrows'];
  for (const ability of ABILITIES) {
    abilityScores[ability] = { base: 10, final: 10, modifier: 0 };
    savingThrows[ability] = { modifier: 0, proficient: false };
  }
  return {
    schemaVersion: 1,
    system: DND5E_SRD_SYSTEM_ID,
    rulesPackId: DND5E_SRD_PACK_ID,
    recipeId: 'dnd5e-srd-character',
    creationMode: 'test',
    level: 1,
    identity: { name: 'Mira' },
    class: { key: 'class:fighter', name: 'Fighter' },
    ancestry: { key: 'ancestry:human', name: 'Human' },
    abilityScores,
    proficiencyBonus: 2,
    maxHitPoints: 12,
    savingThrows,
    skillProficiencies: [],
    toolProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    equipment: [],
    languages: ['Common'],
    spells: [],
    metadata: { createdAt: '2026-05-20T09:00:00.000Z' },
    ...overrides,
  };
}

describe('Context Assembler', () => {
  it('renders the acting character wallet, including legacy zero balances', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    const store = createSqliteCharacterSheetStore(db);
    store.save(
      'pc-1',
      testSheet({ wallet: { cp: 12, sp: 4, ep: 0, gp: 27, pp: 1 } }),
    );
    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'How much money do I have?',
    });
    expect(ctx.state.wallet).toEqual({ cp: 12, sp: 4, ep: 0, gp: 27, pp: 1 });
    expect(renderContextMessage(ctx)).toContain(
      'Wallet: 12 cp, 4 sp, 0 ep, 27 gp, 1 pp',
    );
    store.save('pc-1', testSheet());
    const legacy = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'How much money do I have?',
    });
    expect(legacy.state.wallet).toEqual({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
    db.close();
  });

  it('renders an unavailable wallet during bootstrap without a canonical sheet', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'How much money do I have?',
    });
    expect(ctx.state.wallet).toBeUndefined();
    expect(renderContextMessage(ctx)).toContain(
      'Wallet: unavailable (no canonical character sheet)',
    );
    db.close();
  });

  it('keeps the shared context usable for an unsupported canonical sheet', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    createSqliteCharacterSheetStore(db).save(
      'pc-1',
      testSheet({ system: 'pathfinder', rulesPackId: 'pathfinder-core' }),
    );
    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'What do I carry?',
    });
    expect(ctx.state.wallet).toBeUndefined();
    expect(renderContextMessage(ctx)).toContain(
      'Wallet: unavailable (no canonical character sheet)',
    );
    db.close();
  });

  it('renders an empty inventory explicitly in the bounded game state', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'What equipment do I have?',
    });

    expect(ctx.state.inventory).toEqual([]);
    expect(renderContextMessage(ctx)).toContain('Inventory: (empty)');
    db.close();
  });

  it('assembles only the bounded set and excludes older closed scenes', () => {
    const db = freshDbWithSession({ sessionId: SESSION });

    // An older, closed scene — its transcript must NOT appear in context.
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-old',
      title: 'The Crypt',
      at: '2026-05-20T09:00:00.000Z',
    });
    logTurn(db, 'scene-old', 'turn-1', 'old player line', 'old dm line');
    closeScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-old',
      at: '2026-05-20T09:30:00.000Z',
    });

    // The current, open scene — its transcript is the live context.
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-now',
      title: 'The Tavern',
      at: '2026-05-20T10:00:00.000Z',
    });
    logTurn(db, 'scene-now', 'turn-2', 'I greet the barkeep.', 'He nods.');

    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'I ask about the missing caravan.',
    });

    expect(ctx.scene?.sceneId).toBe('scene-now');
    expect(ctx.sceneTranscript.map((e) => e.content)).toEqual([
      'I greet the barkeep.',
      'He nods.',
    ]);
    const joined = ctx.sceneTranscript.map((e) => e.content).join('\n');
    expect(joined).not.toContain('old player line');
    expect(ctx.playerInput).toBe('I ask about the missing caravan.');
    db.close();
  });

  it('derives recent scene evidence only from accepted DM lines in the open scene', () => {
    const db = freshDbWithSession({ sessionId: SESSION });

    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-old',
      title: 'Emberfall Square',
      at: '2026-05-20T09:00:00.000Z',
    });
    logTurn(
      db,
      'scene-old',
      'turn-1',
      'I ask Sela what happened.',
      'Warden Sela says two scouts went north and did not return.',
    );
    closeScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-old',
      at: '2026-05-20T09:30:00.000Z',
    });

    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-now',
      title: 'Burned Houses',
      at: '2026-05-20T10:00:00.000Z',
    });
    logTurn(
      db,
      'scene-now',
      'turn-2',
      'I count the burned houses.',
      'You count three houses burned around Emberfall Square.',
    );

    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'What should I expect if I investigate?',
    });

    expect(ctx.recentSceneEvidence).toEqual([
      {
        tier: 'scene_fact',
        source: 'scene_log',
        sceneId: 'scene-now',
        turnId: 'turn-2',
        seq: 2,
        summary: 'You count three houses burned around Emberfall Square.',
      },
    ]);
    expect(
      ctx.recentSceneEvidence.some((entry) =>
        entry.summary.includes('two scouts'),
      ),
    ).toBe(false);
    db.close();
  });

  it('ages recent scene evidence out when the scene boundary changes', () => {
    const db = freshDbWithSession({ sessionId: SESSION });

    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-sela',
      title: 'Warden Sela',
      at: '2026-05-20T09:00:00.000Z',
    });
    logTurn(
      db,
      'scene-sela',
      'turn-1',
      'What happened here?',
      'Warden Sela says two scouts went north and did not return.',
    );
    closeScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-sela',
      at: '2026-05-20T09:30:00.000Z',
    });
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-road',
      title: 'North Road',
      at: '2026-05-20T10:00:00.000Z',
    });

    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'Remind me what Sela said.',
    });

    expect(ctx.recentSceneEvidence).toEqual([]);
    expect(renderContextMessage(ctx)).not.toContain('two scouts');
    db.close();
  });

  it('bounds long current-scene transcripts and leaves omitted entries drillable', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-now',
      title: 'The Tavern',
      at: '2026-05-20T10:00:00.000Z',
    });
    for (const n of [1, 2, 3, 4, 5]) {
      logTurn(db, 'scene-now', `turn-${n}`, `player line ${n}`, `dm line ${n}`);
    }

    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'continue',
      sceneTranscriptLimit: 4,
    });

    expect(ctx.sceneTranscript.map((e) => e.content)).toEqual([
      'player line 4',
      'dm line 4',
      'player line 5',
      'dm line 5',
    ]);
    expect(ctx.sceneTranscriptOmittedCount).toBe(6);
    expect(ctx.drilldownAvailable).toBe(true);

    const message = renderContextMessage(ctx);
    expect(message).not.toContain('player line 1');
    expect(message).toContain('6 earlier current-scene entr');
    expect(message).toContain('memory_drilldown');

    const drilldown = memoryDrilldown(db, {
      target: 'scene_log',
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-now',
      beforeSeq: ctx.sceneTranscript[0].seq,
      limit: 2,
    });
    expect(drilldown?.target).toBe('scene_log');
    expect(
      drilldown?.target === 'scene_log'
        ? drilldown.records.map((e) => e.content)
        : [],
    ).toEqual(['player line 3', 'dm line 3']);
    db.close();
  });

  it('snapshots full structured state', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    mutateState(db, {
      target: 'character',
      field: 'name',
      op: 'set',
      value: 'Mira',
      provenance: 'test',
      sessionId: SESSION,
      at: '2026-05-20T10:00:00.000Z',
    });
    mutateState(db, {
      target: 'character',
      field: 'hp_current',
      op: 'set',
      value: 7,
      provenance: 'test',
      sessionId: SESSION,
      at: '2026-05-20T10:00:00.000Z',
    });
    mutateState(db, {
      target: 'inventory',
      id: 'sword-1',
      field: 'name',
      op: 'set',
      value: 'Iron Sword',
      provenance: 'test',
      sessionId: SESSION,
      at: '2026-05-20T10:00:00.000Z',
    });
    // Inventory is owner-scoped: associate the item with the active PC the way
    // give_item does, otherwise the strict character_id read excludes it.
    db.prepare("UPDATE inventory SET character_id = 'pc-1' WHERE id = ?").run(
      'sword-1',
    );
    mutateState(db, {
      target: 'plot_flags',
      field: 'met_barkeep',
      op: 'set',
      value: true,
      provenance: 'test',
      sessionId: SESSION,
      at: '2026-05-20T10:00:00.000Z',
    });

    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'continue',
    });

    expect(ctx.state.character.name).toBe('Mira');
    expect(ctx.state.character.hpCurrent).toBe(7);
    expect(ctx.state.inventory.map((i) => i.name)).toContain('Iron Sword');
    expect(ctx.state.plotFlags.met_barkeep).toBe(true);
    db.close();
  });

  it('includes campaign bible and last session recap', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    rollupSessionRecap(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      recap: 'The party left the city gates.',
      stateDelta: [],
      createdAt: '2026-05-19T20:00:00.000Z',
    });

    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'continue',
    });

    expect(ctx.campaignBible).toBeUndefined();
    expect(ctx.recentSessionRecaps.map((r) => r.recap)).toContain(
      'The party left the city gates.',
    );
    db.close();
  });

  it('renders portable character chronicle separately from campaign canon', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    createSqliteCharacterSheetStore(db).save(
      'pc-1',
      testSheet({
        metadata: {
          createdAt: '2026-05-20T09:00:00.000Z',
          globalCharacterId: 'mira-global',
        },
      }),
    );
    const registryDb = openDatabase(':memory:');
    ensureCharacterRegistrySchema(registryDb);
    const chronicle = createCharacterChronicleStore(registryDb);
    chronicle.appendRecord({
      globalCharacterId: 'mira-global',
      category: 'relationship',
      text: 'Mira remembers owing Tamsin a life debt in Emberfall.',
      source: {
        campaignId: 'old-campaign',
        sessionId: 'old-session',
        at: '2026-05-19T20:00:00.000Z',
      },
      portability: 'portable',
      visibility: 'player-visible',
      truthStatus: 'remembered',
      relatedRefs: [
        {
          ref: 'npc:tamsin',
          scope: 'campaign',
          campaignId: 'old-campaign',
        },
      ],
    });
    chronicle.appendRecord({
      globalCharacterId: 'mira-global',
      id: 'chronicle-2',
      category: 'subjective-knowledge',
      text: 'Mira believes Tamsin serves a hidden patron.',
      source: {
        campaignId: 'old-campaign',
        sessionId: 'old-session',
        at: '2026-05-19T20:01:00.000Z',
      },
      portability: 'portable',
      visibility: 'dm-only',
      truthStatus: 'believed',
      relatedRefs: [],
    });
    chronicle.appendRecord({
      globalCharacterId: 'mira-global',
      category: 'subjective-knowledge',
      text: 'Mira privately suspects the old king betrayed her.',
      source: {
        campaignId: 'old-campaign',
        sessionId: 'old-session',
        at: '2026-05-19T20:00:00.000Z',
      },
      portability: 'portable',
      visibility: 'private',
      truthStatus: 'believed',
      relatedRefs: [],
    });

    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'continue',
      characterChronicle: chronicle,
    });
    const message = renderContextMessage(ctx);

    expect(ctx.campaignBible).toBeUndefined();
    expect(ctx.characterChronicle.map((record) => record.text)).toEqual([
      'Mira remembers owing Tamsin a life debt in Emberfall.',
      'Mira believes Tamsin serves a hidden patron.',
    ]);
    expect(message).toContain('## Character Chronicle');
    expect(message).toContain(
      'DM-only entries are for DM continuity only; do not reveal them verbatim',
    );
    expect(message).toContain(
      '[player-visible] remembered: Mira remembers owing Tamsin a life debt in Emberfall.',
    );
    expect(message).toContain(
      '[dm-only] believed: Mira believes Tamsin serves a hidden patron.',
    );
    expect(message).not.toContain('Campaign Bible\n- npc: Tamsin');
    expect(message).not.toContain('privately suspects');
    db.close();
    registryDb.close();
  });

  it('bounds character chronicle records in assembled context', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    createSqliteCharacterSheetStore(db).save(
      'pc-1',
      testSheet({
        metadata: {
          createdAt: '2026-05-20T09:00:00.000Z',
          globalCharacterId: 'mira-global',
        },
      }),
    );
    const registryDb = openDatabase(':memory:');
    ensureCharacterRegistrySchema(registryDb);
    const chronicle = createCharacterChronicleStore(registryDb);
    for (let n = 1; n <= 10; n++) {
      chronicle.appendRecord({
        globalCharacterId: 'mira-global',
        category: 'campaign-participation',
        text: `Portable memory ${n}.`,
        source: {
          campaignId: 'old-campaign',
          sessionId: `old-session-${n}`,
          at: `2026-05-19T20:${String(n).padStart(2, '0')}:00.000Z`,
        },
        portability: 'portable',
        visibility: 'player-visible',
        truthStatus: 'remembered',
        relatedRefs: [],
      });
    }

    const defaultCtx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'continue',
      characterChronicle: chronicle,
    });
    const explicitCtx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'continue',
      characterChronicle: chronicle,
      characterChronicleLimit: 3,
    });

    expect(defaultCtx.characterChronicle).toHaveLength(8);
    expect(explicitCtx.characterChronicle.map((record) => record.text)).toEqual(
      ['Portable memory 1.', 'Portable memory 2.', 'Portable memory 3.'],
    );
    db.close();
    registryDb.close();
  });

  it('returns arcSummaries[] in sequence_no order for closed arcs', () => {
    const db = freshDbWithSession({ sessionId: SESSION });

    // Open arc-1 and immediately close it to get arc-2 open.
    openArcIfMissing(db, {
      campaignId: CAMPAIGN,
      now: '2026-05-19T18:00:00.000Z',
    });
    closeOpenArcAndOpenNext(db, {
      campaignId: CAMPAIGN,
      arcId: 'arc-1',
      summary: 'Arc one summary.',
      sourceSessionIds: ['session-1'],
      campaignBible: {
        worldFacts: [],
        majorNpcs: [],
        factions: [],
        openThreads: [],
      },
      now: '2026-05-19T19:00:00.000Z',
    });
    // arc-2 is now open; close it to get arc-3 open.
    closeOpenArcAndOpenNext(db, {
      campaignId: CAMPAIGN,
      arcId: 'arc-2',
      summary: 'Arc two summary.',
      sourceSessionIds: ['session-2'],
      campaignBible: {
        worldFacts: [],
        majorNpcs: [],
        factions: [],
        openThreads: [],
      },
      now: '2026-05-19T20:00:00.000Z',
    });

    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'continue',
    });

    expect(ctx.arcSummaries.map((a) => a.arcId)).toEqual(['arc-1', 'arc-2']);
    db.close();
  });

  it('uses recapWindowSize=5 by default', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    for (let n = 1; n <= 6; n++) {
      rollupSessionRecap(db, {
        campaignId: CAMPAIGN,
        sessionId: `session-${n}`,
        recap: `Session ${n} happened.`,
        stateDelta: [],
        createdAt: `2026-05-1${n}T20:00:00.000Z`,
      });
    }

    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: 'session-7',
      playerInput: 'continue',
    });

    expect(ctx.recentSessionRecaps).toHaveLength(5);
    expect(ctx.omittedSessionCount).toBe(1);
    db.close();
  });

  it('K-recap window spans an arc boundary', () => {
    // Setup: arc-1 closed with 5 stamped sessions (s1..s5) and one arc_summary.
    // arc-2 is open with no sessions yet.
    // session_recap rows exist for s1..s5.
    const db = freshDbWithSession({ sessionId: 's1' });

    // Open arc-1.
    openArcIfMissing(db, {
      campaignId: CAMPAIGN,
      now: '2026-05-19T08:00:00.000Z',
    });

    // Create and stamp 5 sessions to arc-1.
    for (let n = 1; n <= 5; n++) {
      const sid = `s${n}`;
      if (n > 1) {
        // freshDbWithSession only creates s1; create the rest manually.
        db.prepare(
          `INSERT INTO campaign_session(campaign_id, session_id, status, started_at)
           VALUES (?, ?, 'closed', ?)`,
        ).run(CAMPAIGN, sid, `2026-05-${10 + n}T08:00:00.000Z`);
        db.prepare(
          `UPDATE campaign_session SET status='closed', closed_at=?
           WHERE campaign_id=? AND session_id=?`,
        ).run(`2026-05-${10 + n}T18:00:00.000Z`, CAMPAIGN, sid);
      } else {
        // Close s1 (already created by freshDbWithSession).
        db.prepare(
          `UPDATE campaign_session SET status='closed', closed_at=?
           WHERE campaign_id=? AND session_id=?`,
        ).run('2026-05-11T18:00:00.000Z', CAMPAIGN, sid);
      }
      stampSessionWithOpenArc(db, { campaignId: CAMPAIGN, sessionId: sid });
      rollupSessionRecap(db, {
        campaignId: CAMPAIGN,
        sessionId: sid,
        recap: `Recap for ${sid}.`,
        stateDelta: [],
        createdAt: `2026-05-${10 + n}T20:00:00.000Z`,
      });
    }

    // Close arc-1 and open arc-2.
    closeOpenArcAndOpenNext(db, {
      campaignId: CAMPAIGN,
      arcId: 'arc-1',
      summary: 'Arc one is done.',
      sourceSessionIds: ['s1', 's2', 's3', 's4', 's5'],
      campaignBible: {
        worldFacts: [],
        majorNpcs: [],
        factions: [],
        openThreads: [],
      },
      now: '2026-05-20T00:00:00.000Z',
    });

    // arc-2 is now open with no sessions. We're now in the first turn of arc-2's
    // first session. Use s5 as the current sessionId to stay in the arc-1 context.
    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: 's5',
      playerInput: 'continue',
    });

    // The no-forget guarantee: all 5 arc-1 sessions appear in the K=5 window.
    expect(ctx.arcSummaries).toHaveLength(1);
    expect(ctx.arcSummaries[0]?.arcId).toBe('arc-1');
    expect(ctx.recentSessionRecaps.map((r) => r.sessionId)).toEqual([
      's1',
      's2',
      's3',
      's4',
      's5',
    ]);
    db.close();
  });

  it('reports drilldown availability when older sessions are omitted', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    for (const n of [1, 2, 3]) {
      rollupSessionRecap(db, {
        campaignId: CAMPAIGN,
        sessionId: `session-${n}`,
        recap: `Session ${n} happened.`,
        stateDelta: [],
        createdAt: `2026-05-1${n}T20:00:00.000Z`,
      });
    }
    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'continue',
      recentSessionLimit: 1,
    });
    expect(ctx.recentSessionRecaps).toHaveLength(1);
    expect(ctx.omittedSessionCount).toBe(2);
    expect(ctx.drilldownAvailable).toBe(true);
    db.close();
  });

  it('works against an empty campaign', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'hello',
    });
    expect(ctx.campaignBible).toBeUndefined();
    expect(ctx.scene).toBeUndefined();
    expect(ctx.sceneTranscript).toEqual([]);
    expect(renderContextMessage(ctx)).toContain('hello');
    db.close();
  });

  it('renders a prompt message containing the bounded slices', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    recordSceneSummary(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-x',
      summary: 'irrelevant',
      salientRefs: [],
      sourceTurnIds: [],
      createdAt: '2026-05-20T09:00:00.000Z',
      updatedAt: '2026-05-20T09:00:00.000Z',
    });
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-now',
      title: 'The Tavern',
      at: '2026-05-20T10:00:00.000Z',
    });
    logTurn(db, 'scene-now', 'turn-1', 'I sit down.', 'The fire crackles.');

    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'I order food.',
    });
    const message = renderContextMessage(ctx);
    expect(message).toContain('The Tavern');
    expect(message).toContain('The fire crackles.');
    expect(message).toContain('I order food.');
    db.close();
  });

  it('omits adventure context when no resolver is supplied', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    startAdventureRun(db, {
      campaignId: CAMPAIGN,
      runId: 'run-1',
      moduleId: 'test-delve',
      provenance: 'test:adventure',
      sessionId: SESSION,
      updatedAt: '2026-06-20T00:00:00.000Z',
    });

    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'look around',
    });

    expect(ctx.adventures).toEqual([]);
    expect(renderContextMessage(ctx)).not.toContain('Adventure Module');
    db.close();
  });

  it('assembles a bounded module slice for an active run, seated at the live location', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    startAdventureRun(db, {
      campaignId: CAMPAIGN,
      runId: 'run-1',
      moduleId: 'test-delve',
      provenance: 'test:adventure',
      sessionId: SESSION,
      updatedAt: '2026-06-20T00:00:00.000Z',
    });
    // Campaign truth: the party is currently in the cellar.
    mutateState(db, {
      target: 'clock',
      field: 'current_location_id',
      op: 'set',
      value: 'loc-cellar',
      provenance: 'test:clock',
      sessionId: SESSION,
      at: '2026-06-20T00:00:00.000Z',
    });

    const module = makeTestAdventureModule();
    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'search the cellar',
      resolveAdventureModule: (id) => (id === module.id ? module : undefined),
    });

    expect(ctx.adventures).toHaveLength(1);
    const slice = ctx.adventures[0];
    expect(slice?.moduleId).toBe('test-delve');
    expect(slice?.currentScene?.id).toBe('scene-cellar');
    expect(slice?.currentLocation?.id).toBe('loc-cellar');

    const message = renderContextMessage(ctx);
    expect(message).toContain('## Adventure Module (DM-only)');
    expect(message).toContain('A Small Test Delve');
    expect(message).toContain('Into the Cellar');
    db.close();
  });

  it('skips runs whose module the resolver cannot supply', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    startAdventureRun(db, {
      campaignId: CAMPAIGN,
      runId: 'run-1',
      moduleId: 'missing-module',
      provenance: 'test:adventure',
      sessionId: SESSION,
      updatedAt: '2026-06-20T00:00:00.000Z',
    });

    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'look around',
      resolveAdventureModule: () => undefined,
    });

    expect(ctx.adventures).toEqual([]);
    db.close();
  });
});
