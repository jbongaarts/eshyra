import { describe, expect, it } from 'vitest';
import type {
  EvaluationDimension,
  EvaluationScenario,
  ModelClient,
  ModelCompleteInput,
  ModelCompleteResult,
} from '../src/internal.js';
import {
  evaluateModelProfile,
  FIRST_COMBAT_MODEL_TIER_SCENARIO,
  MODEL_TIER_EVALUATION_PAIRINGS,
  MODEL_TIER_EVALUATION_PHASES,
  PREMIUM_DM_EVALUATION_THRESHOLD,
  runModelTierEvaluationMatrix,
} from '../src/internal.js';

class ScriptedModel implements ModelClient {
  private index = 0;
  readonly seen: ModelCompleteInput[] = [];

  constructor(private readonly replies: string[]) {}

  complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    this.seen.push(input);
    const reply = this.replies[this.index] ?? '';
    this.index += 1;
    return Promise.resolve({ text: reply });
  }
}

const DIMENSIONS: EvaluationDimension[] = [
  'continuity',
  'canonPreservation',
  'npcConsistency',
  'rulesAdjudication',
  'structuredOutputReliability',
  'memoryUpdateQuality',
  'toolUseReliability',
];

describe('model evaluation harness', () => {
  it('runs scripted scenarios and records profile quality, cost, and latency', async () => {
    const model = new ScriptedModel([
      [
        'Mira still carries the moonlit key.',
        '{"memoryUpdates":["Mira has the moonlit key"]}',
        '```tool_call',
        '{"tool":"lookup_rules","args":{"kind":"spell","name":"Mage Armor"}}',
        '```',
      ].join('\n'),
    ]);
    let now = 1000;
    const scenario: EvaluationScenario = {
      id: 'continuity-canon-rules',
      name: 'Long campaign continuity and tool use',
      turns: [
        {
          playerInput:
            'Mira uses the moonlit key and asks whether Mage Armor stacks with armor.',
        },
      ],
      expected: {
        continuity: ['moonlit key'],
        canonPreservation: ['Mira'],
        npcConsistency: ['Mira'],
        rulesAdjudication: ['Mage Armor'],
        structuredOutputReliability: ['memoryUpdates'],
        memoryUpdateQuality: ['moonlit key'],
        toolUseReliability: ['lookup_rules'],
      },
    };

    const report = await evaluateModelProfile({
      profile: 'premium_dm',
      model,
      scenarios: [scenario],
      costEstimator: () => 0.02,
      now: () => {
        now += 25;
        return now;
      },
    });

    expect(model.seen).toHaveLength(1);
    expect(model.seen[0].system).toContain('premium_dm');
    expect(report.profile).toBe('premium_dm');
    expect(report.threshold).toEqual(PREMIUM_DM_EVALUATION_THRESHOLD);
    expect(report.passed).toBe(true);
    expect(report.scenarios[0].scores).toEqual(
      Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, 1])),
    );
    expect(report.aggregate.scores).toEqual(
      Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, 1])),
    );
    expect(report.cost).toEqual({
      totalUsd: 0.02,
      perTurnUsd: 0.02,
      perSessionUsd: 0.02,
    });
    expect(report.latency).toEqual({
      totalMs: 25,
      averagePerTurnMs: 25,
      perTurnMs: [25],
    });
  });
});

describe('model-tier evaluation harness', () => {
  it('defines the post-combat deterministic scenario and roll fixture', () => {
    expect(FIRST_COMBAT_MODEL_TIER_SCENARIO.id).toBe('first-combat-model-tier');
    expect(
      FIRST_COMBAT_MODEL_TIER_SCENARIO.turns.map((turn) => turn.id),
    ).toEqual([
      'sela-authority-dialogue',
      'sela-investigation-expectations',
      'travel-watchtower',
      'torch-hollow-entry',
      'goblin-ambush',
      'bob-player-attack',
      'goblin-enemy-attack',
      'bob-death-save-or-check',
    ]);
    expect(
      FIRST_COMBAT_MODEL_TIER_SCENARIO.turns.map((turn) => turn.kind),
    ).toContain('save_or_check');
    expect(
      FIRST_COMBAT_MODEL_TIER_SCENARIO.rollFixture.map((roll) => roll.id),
    ).toEqual([
      'initiative',
      'first-player-attack-miss',
      'goblin-attack-miss',
      'second-player-attack-hit',
      'player-damage-kills-goblin-1',
      'goblin-critical-hit',
      'goblin-critical-damage',
      'death-save-success',
    ]);
    expect(FIRST_COMBAT_MODEL_TIER_SCENARIO.notes.join('\n')).toContain(
      'confounded by runtime changes',
    );
  });

  it('defines staged primary-DM and auditor pairings independently', () => {
    expect(MODEL_TIER_EVALUATION_PHASES.map((phase) => phase.id)).toEqual([
      'phase-1-auditor-sweep',
      'phase-2-primary-dm-sweep',
      'phase-3-cheapest-viable-pairings',
    ]);
    expect(MODEL_TIER_EVALUATION_PHASES[0].fixedRole).toBe('primary_dm');
    expect(MODEL_TIER_EVALUATION_PHASES[1].fixedRole).toBe('auditor');
    expect(MODEL_TIER_EVALUATION_PAIRINGS.map((pair) => pair.id)).toEqual(
      expect.arrayContaining([
        'opus-haiku-auditor',
        'opus-sonnet-auditor',
        'opus-opus-auditor-control',
        'gpt-premium-mini-auditor',
        'gpt-premium-stronger-auditor',
        'sonnet-primary-best-auditor',
        'haiku-primary-best-auditor',
        'sonnet-haiku',
        'sonnet-sonnet',
        'lower-gpt-mini',
      ]),
    );
    expect(
      MODEL_TIER_EVALUATION_PAIRINGS.every(
        (pair) =>
          pair.primaryDm.role === 'primary_dm' &&
          pair.auditor.role === 'auditor',
      ),
    ).toBe(true);
  });

  it('aggregates mechanical correctness separately from table feel and usage', async () => {
    const [pairing] = MODEL_TIER_EVALUATION_PAIRINGS;
    const report = await runModelTierEvaluationMatrix({
      pairings: [pairing],
      executePairing: (pair, scenario) => ({
        pairingId: pair.id,
        scenarioId: scenario.id,
        turns: [
          {
            turnId: 'sela-authority-dialogue',
            accepted: true,
            firstPassAccepted: true,
            primaryDmCallCount: 1,
            auditorCallCount: 1,
            primaryDmRetryCount: 0,
            auditRejectionCauses: [],
            auditorFalseRejects: 0,
            auditorFalseAccepts: 0,
            jsonOrParseFailures: 0,
            toolCorrectness: 1,
            playerVisibleRollCompliance: 1,
            combatantStateCorrectness: 1,
            unsupportedInferenceCount: 0,
            usage: {
              primaryDmTokens: 1000,
              auditorTokens: 200,
              primaryDmUsd: 0.1,
              auditorUsd: 0.01,
            },
            mechanicalNotes: [],
            tableFeelNotes: ['Sela felt authoritative.'],
          },
          {
            turnId: 'bob-player-attack',
            accepted: true,
            firstPassAccepted: false,
            primaryDmCallCount: 2,
            auditorCallCount: 2,
            primaryDmRetryCount: 1,
            auditRejectionCauses: ['missing_roll_visibility'],
            auditorFalseRejects: 1,
            auditorFalseAccepts: 0,
            jsonOrParseFailures: 0,
            toolCorrectness: 0.5,
            playerVisibleRollCompliance: 0,
            combatantStateCorrectness: 1,
            unsupportedInferenceCount: 2,
            usage: {
              primaryDmTokens: 2000,
              auditorTokens: 500,
              primaryDmUsd: 0.2,
              auditorUsd: 0.03,
            },
            mechanicalNotes: ['First candidate hid the attack roll.'],
            tableFeelNotes: ['Retry prose was clear but slower.'],
          },
        ],
      }),
    });

    expect(report.reports).toHaveLength(1);
    const pairReport = report.reports[0];
    expect(pairReport.mechanical).toMatchObject({
      acceptedTurnCount: 2,
      totalTurnCount: 2,
      firstPassAuditAcceptRate: 0.5,
      totalPrimaryDmCalls: 3,
      totalAuditorCalls: 3,
      totalPrimaryDmRetries: 1,
      expensivePrimaryDmCallsPerAcceptedTurn: 1.5,
      auditorFalseRejects: 1,
      auditorFalseAccepts: 0,
      jsonOrParseFailures: 0,
      toolCorrectnessAverage: 0.75,
      playerVisibleRollComplianceAverage: 0.5,
      combatantStateCorrectnessAverage: 1,
      unsupportedInferenceCount: 2,
      auditRejectionCauses: ['missing_roll_visibility'],
    });
    expect(pairReport.usage).toMatchObject({
      primaryDmTokens: 3000,
      auditorTokens: 700,
      auditorUsd: 0.04,
    });
    expect(pairReport.usage.primaryDmUsd).toBeCloseTo(0.3);
    expect(pairReport.usage.totalUsd).toBeCloseTo(0.34);
    expect(pairReport.tableFeel.notes).toEqual([
      'Sela felt authoritative.',
      'Retry prose was clear but slower.',
    ]);
  });
});
