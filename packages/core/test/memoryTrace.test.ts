import { describe, expect, it } from 'vitest';
import {
  getTurnTrace,
  initSchema,
  listTurnTraces,
  openDatabase,
  recordTurnTrace,
} from '../src/internal.js';
import { discoverMigrations } from '../src/persistence/migrationRunner.js';

describe('structured turn traces', () => {
  it('preserves a pre-0027 row and decodes its new evidence field as absent', () => {
    const db = openDatabase(':memory:');
    const migrations = discoverMigrations();
    for (const migration of migrations) {
      if (migration.version >= 27) continue;
      db.exec(migration.sql);
    }
    db.prepare(
      `INSERT INTO turn_trace(
         campaign_id, session_id, turn_id, consent_scope, player_input,
         acting_character_id, retrieved_context_json, prompt_profile,
         model_output, tool_calls_json, rules_resolution_json,
         accepted_state_delta_json, rejected_candidates_json, final_narration,
         memory_updates_json, human_corrections_json, quality_flags_json,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'campaign-legacy',
      'session-legacy',
      'turn-legacy',
      'private',
      'Continue.',
      null,
      '[]',
      'default',
      'You continue.',
      '[]',
      '{}',
      '[]',
      '[]',
      'You continue.',
      '[]',
      '[]',
      '[]',
      '2026-05-19T05:00:00.000Z',
    );
    const migration = migrations.find((candidate) => candidate.version === 27);
    if (migration === undefined) throw new Error('missing migration 0027');
    db.exec(migration.sql);

    const trace = getTurnTrace(db, {
      campaignId: 'campaign-legacy',
      sessionId: 'session-legacy',
      turnId: 'turn-legacy',
    });
    expect(trace).not.toHaveProperty('campaignRulesEvidence');
    db.close();
  });

  it('records a consent-scoped turn trace separate from public content', () => {
    const db = openDatabase(':memory:');
    initSchema(db);

    recordTurnTrace(db, {
      campaignId: 'campaign-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      consentScope: 'private',
      playerInput: 'I search the ruined shrine.',
      retrievedContext: [{ kind: 'scene_summary', id: 'scene-1' }],
      promptProfile: 'premium_dm',
      modelOutput: 'The shrine smells of rain and old ash.',
      toolCalls: [{ name: 'lookup_rules', args: { name: 'Perception' } }],
      rulesResolution: { check: 'Wisdom (Perception)', dc: 13, result: 16 },
      acceptedStateDelta: [
        {
          target: 'plot_flags',
          field: 'found_shrine_tracks',
          op: 'set',
          value: true,
        },
      ],
      rejectedCandidates: [{ reason: 'unsupported canon claim' }],
      finalNarration: 'You find fresh bootprints near the altar.',
      memoryUpdates: [{ type: 'scene_summary', id: 'scene-2' }],
      humanCorrections: ['The shrine is dedicated to the moon, not the sun.'],
      qualityFlags: ['canon_checked', 'rules_checked'],
      createdAt: '2026-05-19T05:00:00.000Z',
    });

    expect(
      getTurnTrace(db, {
        campaignId: 'campaign-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
      }),
    ).toEqual({
      campaignId: 'campaign-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      consentScope: 'private',
      playerInput: 'I search the ruined shrine.',
      retrievedContext: [{ kind: 'scene_summary', id: 'scene-1' }],
      promptProfile: 'premium_dm',
      modelOutput: 'The shrine smells of rain and old ash.',
      toolCalls: [{ name: 'lookup_rules', args: { name: 'Perception' } }],
      rulesResolution: { check: 'Wisdom (Perception)', dc: 13, result: 16 },
      acceptedStateDelta: [
        {
          target: 'plot_flags',
          field: 'found_shrine_tracks',
          op: 'set',
          value: true,
        },
      ],
      rejectedCandidates: [{ reason: 'unsupported canon claim' }],
      finalNarration: 'You find fresh bootprints near the altar.',
      memoryUpdates: [{ type: 'scene_summary', id: 'scene-2' }],
      humanCorrections: ['The shrine is dedicated to the moon, not the sun.'],
      qualityFlags: ['canon_checked', 'rules_checked'],
      createdAt: '2026-05-19T05:00:00.000Z',
    });

    const traceTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'turn_trace'",
      )
      .get();
    const publicPackTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pack_content'",
      )
      .get();

    expect(traceTable).toEqual({ name: 'turn_trace' });
    expect(publicPackTable).toBeUndefined();

    const traceColumns = db
      .prepare('PRAGMA table_info(turn_trace)')
      .all() as Array<{
      name: string;
    }>;
    expect(traceColumns.map((column) => column.name)).toContain(
      'campaign_rules_evidence',
    );

    const legacyCompatible = getTurnTrace(db, {
      campaignId: 'campaign-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
    });
    expect(legacyCompatible).not.toHaveProperty('campaignRulesEvidence');

    const campaignRulesEvidence = {
      position: 'cp1~000000000002~session-1~turn-2',
      rules: [
        {
          ruleIdentity: 'rule:trace-evidence',
          ruleKind: 'house-rule',
          status: 'active',
          provenance: 'house-rule',
          effectivePosition: 'cp1~000000000002~session-1~turn-2',
          governingRecordKeys: ['record:test'],
        },
      ],
      rulings: [],
      unresolvedAmbiguityIds: ['ambiguity:test'],
      conflictingAmbiguityIds: [],
    };
    recordTurnTrace(db, {
      campaignId: 'campaign-1',
      sessionId: 'session-1',
      turnId: 'turn-2',
      consentScope: 'private',
      playerInput: 'Continue.',
      retrievedContext: [],
      promptProfile: 'premium_dm',
      modelOutput: 'You continue.',
      toolCalls: [],
      rulesResolution: {},
      campaignRulesEvidence,
      acceptedStateDelta: [],
      rejectedCandidates: [],
      finalNarration: 'You continue.',
      memoryUpdates: [],
      humanCorrections: [],
      qualityFlags: [],
      createdAt: '2026-05-19T05:01:00.000Z',
    });
    expect(
      getTurnTrace(db, {
        campaignId: 'campaign-1',
        sessionId: 'session-1',
        turnId: 'turn-2',
      })?.campaignRulesEvidence,
    ).toEqual(campaignRulesEvidence);
    expect(
      listTurnTraces(db, {
        campaignId: 'campaign-1',
        sessionId: 'session-1',
      })[1]?.campaignRulesEvidence,
    ).toEqual(campaignRulesEvidence);

    db.close();
  });
});
