import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  AbilityScoreName,
  CampaignPosition,
  CampaignRule,
  CharacterSheet,
  Db,
  FinalizedAbilityScore,
} from '../src/internal.js';
import {
  appendSceneLog,
  assembleCampaignRulesContext,
  assembleContext,
  closeOpenArcAndOpenNext,
  closeScene,
  createCharacterChronicleStore,
  createDefaultToolRegistry,
  createSeededRng,
  createSqliteCharacterSheetStore,
  DND5E_SRD_PACK_ID,
  DND5E_SRD_SYSTEM_ID,
  ensureCharacterRegistrySchema,
  formatCampaignPosition,
  memoryDrilldown,
  mutateState,
  openArcIfMissing,
  openDatabase,
  openScene,
  createCampaignRule as persistCampaignRule,
  revokeCampaignRule as persistRevokeCampaignRule,
  supersedeCampaignRule as persistSupersedeCampaignRule,
  recordSceneSummary,
  renderContextMessage,
  rollupSessionRecap,
  stampSessionWithOpenArc,
  startAdventureRun,
} from '../src/internal.js';
import { resolveStrictCampaignRulesStack } from '../src/state/campaignRecordLookup.js';
import {
  NEARBY_INVENTORY_MAX_BYTES,
  utf8ByteLength,
} from '../src/state/inventoryIdentity.js';
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

const campaignPosition = (ordinal: number): CampaignPosition => ({
  sessionId: `session-${ordinal}`,
  turnId: `turn-${ordinal}`,
  ordinal,
});

function campaignRule(
  identity: string,
  ordinal: number,
  overrides: Partial<CampaignRule> = {},
): CampaignRule {
  return {
    ruleIdentity: identity,
    campaignId: CAMPAIGN,
    ruleKind: 'house-rule',
    status: 'active',
    origin: 'player-approved',
    provenance: { kind: 'house-rule', rationale: 'test' },
    effectivePosition: campaignPosition(ordinal),
    temporalMode: { mode: 'prospective' },
    supersededBy: null,
    scope: 'test',
    governingRecordKeys: ['record:test'],
    prose: `Prose for ${identity}`,
    ...overrides,
  };
}

type CreateOptions = Parameters<typeof persistCampaignRule>[2];
type RevokeInput = Parameters<typeof persistRevokeCampaignRule>[1];
type SupersedeInput = Parameters<typeof persistSupersedeCampaignRule>[1];

function createCampaignRule(
  db: Parameters<typeof persistCampaignRule>[0],
  value: CampaignRule,
  options: Omit<CreateOptions, 'currentPosition'> & {
    currentPosition?: CampaignPosition;
  } = {},
): CampaignRule {
  return persistCampaignRule(db, value, {
    ...options,
    currentPosition: options.currentPosition ?? value.effectivePosition,
  });
}

function revokeCampaignRule(
  db: Parameters<typeof persistRevokeCampaignRule>[0],
  input: Omit<RevokeInput, 'currentPosition'> & {
    currentPosition?: CampaignPosition;
  },
): CampaignRule {
  return persistRevokeCampaignRule(db, {
    ...input,
    currentPosition: input.currentPosition ?? input.revokedPosition,
  });
}

function supersedeCampaignRule(
  db: Parameters<typeof persistSupersedeCampaignRule>[0],
  input: Omit<SupersedeInput, 'currentPosition'> & {
    currentPosition?: CampaignPosition;
  },
): CampaignRule {
  return persistSupersedeCampaignRule(db, {
    ...input,
    currentPosition: input.currentPosition ?? input.successor.effectivePosition,
  });
}

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
  it('projects position-active rules, source associations, and immutable ambiguities', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    const packPath = new URL(
      '../data/rules-packs/rules__dnd5e-srd-5.1/records.json',
      import.meta.url,
    );
    const packBefore = readFileSync(packPath);
    createCampaignRule(db, campaignRule('future-rule', 4));
    createCampaignRule(db, campaignRule('ordered-z', 1));
    createCampaignRule(db, campaignRule('ordered-a', 1));
    const oldRule = campaignRule('superseded-rule', 1);
    createCampaignRule(db, oldRule);
    supersedeCampaignRule(db, {
      campaignId: CAMPAIGN,
      ruleIdentity: oldRule.ruleIdentity,
      successor: campaignRule('successor-rule', 3),
    });
    const revokedRule = campaignRule('revoked-rule', 1);
    createCampaignRule(db, revokedRule);
    revokeCampaignRule(db, {
      campaignId: CAMPAIGN,
      ruleIdentity: revokedRule.ruleIdentity,
      revokedPosition: campaignPosition(3),
    });

    const atOne = assembleCampaignRulesContext(
      db,
      CAMPAIGN,
      formatCampaignPosition(campaignPosition(1)),
      resolveStrictCampaignRulesStack(db),
    );
    expect(atOne.rules.map((rule) => rule.ruleIdentity)).toEqual([
      'ordered-a',
      'ordered-z',
      'revoked-rule',
      'superseded-rule',
    ]);
    expect(
      atOne.rules.find((rule) => rule.ruleIdentity === 'superseded-rule'),
    ).toMatchObject({
      governingRecordKeys: ['record:test'],
    });
    expect(
      atOne.rules.some((rule) => rule.ruleIdentity === 'future-rule'),
    ).toBe(false);
    expect(atOne.ambiguities.map(({ ambiguity }) => ambiguity.id)).toEqual([
      'ambiguity:create-undead-ghast-wight-composition',
      'ambiguity:cube-of-force-same-face-duration-reset',
      'ambiguity:find-familiar-permanent-dismissal-after-zero-hp',
    ]);
    for (const { ambiguity, ruling } of atOne.ambiguities) {
      expect(ambiguity.question).toEqual(expect.any(String));
      expect(ambiguity.interpretations.length).toBeGreaterThan(0);
      expect(ruling).toBeUndefined();
    }

    const later = assembleCampaignRulesContext(
      db,
      CAMPAIGN,
      formatCampaignPosition(campaignPosition(4)),
      resolveStrictCampaignRulesStack(db),
    );
    expect(later.rules.map((rule) => rule.ruleIdentity)).toContain(
      'successor-rule',
    );
    expect(later.rules.map((rule) => rule.ruleIdentity)).toContain(
      'future-rule',
    );
    expect(later.rules.map((rule) => rule.ruleIdentity)).not.toContain(
      'superseded-rule',
    );
    expect(later.rules.map((rule) => rule.ruleIdentity)).not.toContain(
      'revoked-rule',
    );

    const familiar = later.ambiguities.find(({ ambiguity }) =>
      ambiguity.id.includes('find-familiar'),
    );
    if (familiar === undefined) throw new Error('missing familiar ambiguity');
    const interpretation = familiar.ambiguity.interpretations[0];
    if (interpretation === undefined) throw new Error('missing interpretation');
    const ruling = campaignRule('familiar-ruling', 3, {
      ruleKind: 'ruling',
      provenance: {
        kind: 'ambiguity',
        ambiguityId: familiar.ambiguity.id,
        selectedInterpretationId: interpretation.id,
      },
      governingRecordKeys: ['spell:find-familiar'],
    });
    createCampaignRule(db, ruling, {
      validation: { ambiguity: familiar.ambiguity },
    });
    const resolved = assembleCampaignRulesContext(
      db,
      CAMPAIGN,
      formatCampaignPosition(campaignPosition(4)),
      resolveStrictCampaignRulesStack(db),
    );
    const resolvedFamiliar = resolved.ambiguities.find(
      ({ ambiguity }) => ambiguity.id === familiar.ambiguity.id,
    );
    expect(resolvedFamiliar?.ruling).toMatchObject({
      ambiguityId: familiar.ambiguity.id,
      selectedInterpretationId: interpretation.id,
      governingRecordKeys: ['spell:find-familiar'],
    });
    expect(resolvedFamiliar?.ambiguity.question).toBe(
      familiar.ambiguity.question,
    );

    const unresolvedMessage = renderContextMessage(
      assembleContext({
        db,
        campaignId: CAMPAIGN,
        campaignPosition: formatCampaignPosition(campaignPosition(1)),
        sessionId: SESSION,
        playerInput: 'continue',
      }),
    );
    expect(unresolvedMessage).toContain(
      'UNRESOLVED: do not assert a canonical answer or silently choose an interpretation.',
    );
    const resolvedMessage = renderContextMessage(
      assembleContext({
        db,
        campaignId: CAMPAIGN,
        campaignPosition: formatCampaignPosition(campaignPosition(4)),
        sessionId: SESSION,
        playerInput: 'continue',
      }),
    );
    expect(resolvedMessage).toContain(
      `Active ruling familiar-ruling (${interpretation.id})`,
    );
    expect(resolvedMessage).toContain(interpretation.summary);
    const packAfter = readFileSync(packPath);
    expect(packBefore).toEqual(packAfter);
    db.close();
  }, 120000);

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
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
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
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
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
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
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
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
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
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
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
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
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
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
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
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
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
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
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
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
      sessionId: SESSION,
      playerInput: 'continue',
    });

    expect(ctx.state.character.name).toBe('Mira');
    expect(ctx.state.character.hpCurrent).toBe(7);
    expect(ctx.state.inventory.map((i) => i.name)).toContain('Iron Sword');
    expect(ctx.state.plotFlags.met_barkeep).toBe(true);
    db.close();
  });

  it('exposes only deterministically co-located unheld rows with claimable ids', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    db.prepare(
      "UPDATE clock SET current_location_id='market' WHERE id=1",
    ).run();
    const insert = db.prepare(
      `INSERT INTO inventory(
         id, character_id, name, quantity, location, world_location_id,
         properties_json, provenance, session_id, updated_at,
         unheld_disposition
       ) VALUES (?, NULL, ?, ?, NULL, ?, ?, 'test', ?, ?, ?)`,
    );
    insert.run(
      'claimable-ring',
      'Found Ring',
      1,
      'market',
      '{"engraved":true}',
      SESSION,
      '2026-05-20T10:00:00.000Z',
      'dropped',
    );
    const hugePayload = `NEARBY_SECRET_${'x'.repeat(10_000)}`;
    db.prepare(
      `UPDATE inventory SET properties_json=? WHERE id='claimable-ring'`,
    ).run(JSON.stringify({ engraved: true, hugePayload }));
    db.prepare(
      `INSERT INTO item_state(
         inventory_id, state_json, provenance, session_id, updated_at
       ) VALUES ('claimable-ring', ?, 'test', ?, ?)`,
    ).run(
      JSON.stringify({ custom: { hugePayload } }),
      SESSION,
      '2026-05-20T10:00:00.000Z',
    );
    db.prepare(
      `INSERT INTO inventory(
         id, character_id, name, properties_json, provenance, session_id,
         updated_at
       ) VALUES ('legacy-review', 'pc-1', 'Legacy Review', ?, 'test', ?, ?)`,
    ).run('{}', SESSION, '2026-05-20T10:00:00.000Z');
    db.prepare(
      `INSERT INTO inventory_adoption_review(
         inventory_id, requested_pack_ref, review_kind, reason, provenance,
         session_id, updated_at
       ) VALUES ('legacy-review', 'magic-item:orb-of-dragonkind',
                 'legacy-attunement', ?, 'test', ?, ?)`,
    ).run(
      `RECONCILE_ME ${'bounded'.repeat(100)} HIDDEN_REASON_TAIL`,
      SESSION,
      '2026-05-20T10:00:00.000Z',
    );
    db.prepare(
      `INSERT INTO inventory(
         id, character_id, name, properties_json, provenance, session_id,
         updated_at, pack_ref
       ) VALUES (
         'held-proof', 'pc-1', 'Held Proof', ?, 'test', ?, ?,
         'magic-item:held-proof'
       )`,
    ).run(
      JSON.stringify({ heldPayload: 'HELD_PROPERTIES_UNCHANGED' }),
      SESSION,
      '2026-05-20T10:00:00.000Z',
    );
    db.prepare(
      `INSERT INTO item_state(
         inventory_id, state_json, provenance, session_id, updated_at
       ) VALUES ('held-proof', ?, 'test', ?, ?)`,
    ).run(
      JSON.stringify({
        packRef: 'magic-item:held-proof',
        custom: { marker: 'HELD_STATE_UNCHANGED' },
      }),
      SESSION,
      '2026-05-20T10:00:00.000Z',
    );
    insert.run(
      'remote-crate',
      'Remote Crate',
      1,
      'docks',
      '{}',
      SESSION,
      '2026-05-20T10:00:00.000Z',
      'dropped',
    );
    insert.run(
      'unknown-cache',
      'Unknown Cache',
      1,
      null,
      '{}',
      SESSION,
      '2026-05-20T10:00:00.000Z',
      null,
    );
    for (const disposition of ['sold', 'lost'])
      insert.run(
        `${disposition}-item`,
        `${disposition} item`,
        1,
        'market',
        '{}',
        SESSION,
        '2026-05-20T10:00:00.000Z',
        disposition,
      );

    const context = assembleContext({
      db,
      campaignId: CAMPAIGN,
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
      sessionId: SESSION,
      playerInput: 'I pick up the ring.',
    });
    expect(context.state.nearbyInventory.map((item) => item.id)).toEqual([
      'claimable-ring',
    ]);
    const rendered = renderContextMessage(context);
    expect(rendered).toContain('claim_item');
    expect(rendered).toContain('id=claimable-ring');
    expect(rendered).not.toContain('properties=');
    expect(rendered).not.toContain('NEARBY_SECRET_');
    expect(context.state.inventory[0]).toMatchObject({
      id: 'held-proof',
      properties: { heldPayload: 'HELD_PROPERTIES_UNCHANGED' },
      state: { custom: { marker: 'HELD_STATE_UNCHANGED' } },
    });
    expect(rendered).toContain('HELD_STATE_UNCHANGED');
    expect(rendered).toContain('Legacy Review x1 [id=legacy-review]');
    expect(rendered).toContain(
      'adoption=gm-review-required; requestedPackRef=magic-item:orb-of-dragonkind',
    );
    expect(rendered).toContain(
      'reviewKind=legacy-attunement; requiredResolution=discard-legacy-attunement; reason=RECONCILE_ME',
    );
    expect(rendered).not.toContain('HIDDEN_REASON_TAIL');
    expect(context.state.nearbyInventory[0]).not.toHaveProperty('properties');
    expect(context.state.nearbyInventory[0]).not.toHaveProperty('state');
    const listed = createDefaultToolRegistry().invoke(
      'list_nearby_items',
      {},
      {
        db,
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        turnId: 'turn-1',
        at: '2026-05-20T10:00:00.000Z',
        rng: createSeededRng(1),
      },
    );
    expect(listed.ok).toBe(true);
    expect(JSON.stringify(listed)).not.toContain('NEARBY_SECRET_');
    if (listed.ok) {
      const item = (listed.data as { items: Record<string, unknown>[] })
        .items[0];
      expect(item).not.toHaveProperty('properties');
      expect(item).not.toHaveProperty('state');
    }
    expect(rendered).not.toContain('remote-crate');
    expect(rendered).not.toContain('unknown-cache');
    expect(rendered).not.toContain('sold-item');
    expect(rendered).not.toContain('lost-item');
    db.close();
  });

  it('signals truncation and paginates every nearby id without remote leakage', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    db.prepare(
      "UPDATE clock SET current_location_id='market' WHERE id=1",
    ).run();
    const insert = db.prepare(
      `INSERT INTO inventory(
         id, character_id, name, location, world_location_id, properties_json,
         provenance, session_id, updated_at, unheld_disposition
       ) VALUES (?, NULL, ?, NULL, ?, '{}', 'test', ?, ?, ?)`,
    );
    for (let index = 1; index <= 22; index += 1) {
      const id = `item-${String(index).padStart(2, '0')}`;
      insert.run(
        id,
        id,
        'market',
        SESSION,
        '2026-05-20T10:00:00.000Z',
        'dropped',
      );
    }
    insert.run(
      'remote',
      'Remote',
      'docks',
      SESSION,
      '2026-05-20T10:00:00.000Z',
      'dropped',
    );
    insert.run(
      'unknown',
      'Unknown',
      null,
      SESSION,
      '2026-05-20T10:00:00.000Z',
      null,
    );
    const context = assembleContext({
      db,
      campaignId: CAMPAIGN,
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
      sessionId: SESSION,
      playerInput: 'look around',
    });
    expect(context.state.nearbyInventory).toHaveLength(20);
    expect(context.state.nearbyInventoryTruncated).toBe(true);
    expect(renderContextMessage(context)).toContain('list_nearby_items');

    const registry = createDefaultToolRegistry();
    const toolContext = {
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      turnId: 'turn-1',
      at: '2026-05-20T10:00:00.000Z',
      rng: createSeededRng(1),
    };
    const first = registry.invoke(
      'list_nearby_items',
      { limit: 7 },
      toolContext,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.error.message);
    const firstData = first.data as {
      items: Array<{ id: string }>;
      nextCursor: string;
    };
    const second = registry.invoke(
      'list_nearby_items',
      { limit: 20, cursor: firstData.nextCursor },
      toolContext,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.error.message);
    const ids = [
      ...firstData.items,
      ...(second.data as { items: Array<{ id: string }> }).items,
    ].map((item) => item.id);
    expect(ids).toEqual(
      Array.from(
        { length: 22 },
        (_, index) => `item-${String(index + 1).padStart(2, '0')}`,
      ),
    );
    expect(ids).not.toContain('remote');
    expect(ids).not.toContain('unknown');

    db.prepare('UPDATE clock SET current_location_id=NULL WHERE id=1').run();
    expect(registry.invoke('list_nearby_items', {}, toolContext)).toMatchObject(
      {
        ok: true,
        data: { locationId: null, items: [] },
      },
    );
    db.exec(
      'DROP TRIGGER inventory_location_insert_guard; DROP TRIGGER inventory_location_update_guard;',
    );
    db.prepare(
      "UPDATE inventory SET world_location_id='   ' WHERE id='unknown'",
    ).run();
    db.prepare("UPDATE clock SET current_location_id='   ' WHERE id=1").run();
    expect(registry.invoke('list_nearby_items', {}, toolContext)).toMatchObject(
      { ok: true, data: { locationId: null, items: [] } },
    );
    expect(
      assembleContext({
        db,
        campaignId: CAMPAIGN,
        campaignPosition: formatCampaignPosition(campaignPosition(1)),
        sessionId: SESSION,
        playerInput: 'look around',
      }).state.nearbyInventory,
    ).toEqual([]);
    db.close();
  });

  it('bounds multibyte nearby context and tool pages without cutting identities', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    db.prepare(
      "UPDATE clock SET current_location_id='market' WHERE id=1",
    ).run();
    const insert = db.prepare(
      `INSERT INTO inventory(
         id, character_id, name, location, world_location_id, properties_json,
         provenance, session_id, updated_at, unheld_disposition
       ) VALUES (?, NULL, ?, NULL, ?, '{}', 'test', ?, ?, 'dropped')`,
    );
    const name = 'é'.repeat(120);
    for (let index = 1; index <= 20; index += 1) {
      const id = `multibyte-${String(index).padStart(2, '0')}`;
      insert.run(id, name, 'market', SESSION, '2026-05-20T10:00:00.000Z');
    }

    const context = assembleContext({
      db,
      campaignId: CAMPAIGN,
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
      sessionId: SESSION,
      playerInput: 'look around',
    });
    expect(context.state.nearbyInventory.length).toBeLessThan(20);
    expect(context.state.nearbyInventoryTruncated).toBe(true);
    expect(context.state.nearbyInventory[0]?.name).toBe(name);
    expect(
      utf8ByteLength(JSON.stringify(context.state.nearbyInventory)),
    ).toBeLessThanOrEqual(NEARBY_INVENTORY_MAX_BYTES);

    const result = createDefaultToolRegistry().invoke(
      'list_nearby_items',
      { limit: 20 },
      {
        db,
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        turnId: 'turn-1',
        at: '2026-05-20T10:00:00.000Z',
        rng: createSeededRng(1),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const data = result.data as { items: Array<{ id: string; name: string }> };
    expect(data.items.length).toBeLessThan(20);
    expect(data.items.every((item) => item.name === name)).toBe(true);
    expect(utf8ByteLength(JSON.stringify(data.items))).toBeLessThanOrEqual(
      NEARBY_INVENTORY_MAX_BYTES,
    );
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
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
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
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
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
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
      sessionId: SESSION,
      playerInput: 'continue',
      characterChronicle: chronicle,
    });
    const explicitCtx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
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
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
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
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
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
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
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
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
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
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
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
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
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
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
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
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
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
      campaignPosition: formatCampaignPosition(campaignPosition(1)),
      sessionId: SESSION,
      playerInput: 'look around',
      resolveAdventureModule: () => undefined,
    });

    expect(ctx.adventures).toEqual([]);
    db.close();
  });
});
