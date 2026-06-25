import { parseToolCalls } from '../orchestrator/protocol.js';
import type {
  ModelClient,
  ModelCompleteInput,
  ModelMessage,
} from './client.js';
import type { ModelProfileName } from './profiles.js';

export const EVALUATION_DIMENSIONS = [
  'continuity',
  'canonPreservation',
  'npcConsistency',
  'rulesAdjudication',
  'structuredOutputReliability',
  'memoryUpdateQuality',
  'toolUseReliability',
] as const;

export type EvaluationDimension = (typeof EVALUATION_DIMENSIONS)[number];

export type EvaluationScores = Record<EvaluationDimension, number>;

export interface EvaluationTurn {
  playerInput: string;
}

export interface EvaluationScenario {
  id: string;
  name: string;
  turns: EvaluationTurn[];
  expected: Partial<Record<EvaluationDimension, string[]>>;
}

export interface EvaluationTurnRecord {
  scenarioId: string;
  turnIndex: number;
  input: ModelCompleteInput;
  output: string;
  latencyMs: number;
  costUsd: number;
}

export interface EvaluationScenarioReport {
  id: string;
  name: string;
  scores: EvaluationScores;
  turns: EvaluationTurnRecord[];
  transcript: ModelMessage[];
}

export interface PremiumDmEvaluationThreshold {
  minAverageScore: number;
  minDimensionScore: number;
  maxCostUsdPerTurn: number;
  maxAverageLatencyMs: number;
}

export const PREMIUM_DM_EVALUATION_THRESHOLD: PremiumDmEvaluationThreshold = {
  minAverageScore: 0.85,
  minDimensionScore: 0.8,
  maxCostUsdPerTurn: 1,
  maxAverageLatencyMs: 60_000,
};

export interface EvaluationCostInput {
  profile: ModelProfileName;
  scenario: EvaluationScenario;
  turn: EvaluationTurn;
  output: string;
  latencyMs: number;
  turnIndex: number;
}

export interface EvaluateModelProfileInput {
  profile: ModelProfileName;
  model: ModelClient;
  scenarios: EvaluationScenario[];
  costEstimator?: (input: EvaluationCostInput) => number;
  now?: () => number;
}

export interface EvaluationCostReport {
  totalUsd: number;
  perTurnUsd: number;
  /** Scenario-level cost; each scripted scenario represents an eval session. */
  perSessionUsd: number;
}

export interface EvaluationLatencyReport {
  totalMs: number;
  averagePerTurnMs: number;
  perTurnMs: number[];
}

export interface EvaluationReport {
  profile: ModelProfileName;
  scenarios: EvaluationScenarioReport[];
  aggregate: { scores: EvaluationScores; averageScore: number };
  cost: EvaluationCostReport;
  latency: EvaluationLatencyReport;
  threshold: PremiumDmEvaluationThreshold | undefined;
  passed: boolean;
}

const zeroScores = (): EvaluationScores =>
  Object.fromEntries(
    EVALUATION_DIMENSIONS.map((dimension) => [dimension, 0]),
  ) as EvaluationScores;

const clampScore = (score: number): number => Math.max(0, Math.min(1, score));

function scoreNeedles(
  text: string,
  needles: readonly string[] | undefined,
): number {
  if (needles === undefined || needles.length === 0) {
    return 0;
  }
  const normalized = text.toLowerCase();
  const matches = needles.filter((needle) =>
    normalized.includes(needle.toLowerCase()),
  ).length;
  return clampScore(matches / needles.length);
}

function hasJsonObject(text: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
      continue;
    }
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      // Keep scanning for another structured object in the response.
    }
  }
  return false;
}

function scoreToolUse(
  text: string,
  expectedTools: readonly string[] | undefined,
): number {
  if (expectedTools === undefined || expectedTools.length === 0) {
    return 0;
  }
  const calls = parseToolCalls(text)
    .filter((call) => call.ok)
    .map((call) => (call.ok ? call.tool : ''));
  const matches = expectedTools.filter((tool) => calls.includes(tool)).length;
  return clampScore(matches / expectedTools.length);
}

function scoreScenario(
  scenario: EvaluationScenario,
  transcript: readonly ModelMessage[],
): EvaluationScores {
  const text = transcript.map((message) => message.content).join('\n');
  const scores = zeroScores();

  for (const dimension of EVALUATION_DIMENSIONS) {
    if (dimension === 'toolUseReliability') {
      scores[dimension] = scoreToolUse(text, scenario.expected[dimension]);
    } else if (dimension === 'structuredOutputReliability') {
      const expectedScore = scoreNeedles(text, scenario.expected[dimension]);
      scores[dimension] = hasJsonObject(text) ? expectedScore : 0;
    } else {
      scores[dimension] = scoreNeedles(text, scenario.expected[dimension]);
    }
  }

  return scores;
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function aggregateScores(
  reports: readonly EvaluationScenarioReport[],
): EvaluationScores {
  const aggregate = zeroScores();
  for (const dimension of EVALUATION_DIMENSIONS) {
    aggregate[dimension] = average(
      reports.map((report) => report.scores[dimension]),
    );
  }
  return aggregate;
}

function passesPremiumThreshold(
  scores: EvaluationScores,
  cost: EvaluationCostReport,
  latency: EvaluationLatencyReport,
): boolean {
  const values = EVALUATION_DIMENSIONS.map((dimension) => scores[dimension]);
  return (
    average(values) >= PREMIUM_DM_EVALUATION_THRESHOLD.minAverageScore &&
    values.every(
      (score) => score >= PREMIUM_DM_EVALUATION_THRESHOLD.minDimensionScore,
    ) &&
    cost.perTurnUsd <= PREMIUM_DM_EVALUATION_THRESHOLD.maxCostUsdPerTurn &&
    latency.averagePerTurnMs <=
      PREMIUM_DM_EVALUATION_THRESHOLD.maxAverageLatencyMs
  );
}

export async function evaluateModelProfile(
  input: EvaluateModelProfileInput,
): Promise<EvaluationReport> {
  const now = input.now ?? (() => Date.now());
  const scenarios: EvaluationScenarioReport[] = [];
  const allTurns: EvaluationTurnRecord[] = [];

  for (const scenario of input.scenarios) {
    const transcript: ModelMessage[] = [];
    const turnRecords: EvaluationTurnRecord[] = [];

    for (const [turnIndex, turn] of scenario.turns.entries()) {
      transcript.push({ role: 'user', content: turn.playerInput });
      const modelInput: ModelCompleteInput = {
        system:
          `Eshyra model evaluation harness for profile ${input.profile}. ` +
          `Scenario: ${scenario.name}.`,
        messages: [...transcript],
      };
      const startedAt = now();
      const result = await input.model.complete(modelInput);
      const output = result.text;
      const latencyMs = now() - startedAt;
      const costUsd =
        input.costEstimator?.({
          profile: input.profile,
          scenario,
          turn,
          output,
          latencyMs,
          turnIndex,
        }) ?? 0;

      const record: EvaluationTurnRecord = {
        scenarioId: scenario.id,
        turnIndex,
        input: modelInput,
        output,
        latencyMs,
        costUsd,
      };
      transcript.push({ role: 'assistant', content: output });
      turnRecords.push(record);
      allTurns.push(record);
    }

    scenarios.push({
      id: scenario.id,
      name: scenario.name,
      scores: scoreScenario(scenario, transcript),
      turns: turnRecords,
      transcript,
    });
  }

  const scores = aggregateScores(scenarios);
  const allScoreValues = EVALUATION_DIMENSIONS.map(
    (dimension) => scores[dimension],
  );
  const totalUsd = allTurns.reduce((sum, turn) => sum + turn.costUsd, 0);
  const perTurnMs = allTurns.map((turn) => turn.latencyMs);
  const cost = {
    totalUsd,
    perTurnUsd: average(allTurns.map((turn) => turn.costUsd)),
    perSessionUsd:
      input.scenarios.length === 0 ? 0 : totalUsd / input.scenarios.length,
  };
  const latency = {
    totalMs: perTurnMs.reduce((sum, value) => sum + value, 0),
    averagePerTurnMs: average(perTurnMs),
    perTurnMs,
  };
  const threshold =
    input.profile === 'premium_dm'
      ? PREMIUM_DM_EVALUATION_THRESHOLD
      : undefined;

  return {
    profile: input.profile,
    scenarios,
    aggregate: { scores, averageScore: average(allScoreValues) },
    cost,
    latency,
    threshold,
    passed:
      threshold === undefined
        ? true
        : passesPremiumThreshold(scores, cost, latency),
  };
}

export type ModelTierEvaluationRole = 'primary_dm' | 'auditor';

export type ModelTierEvaluationPhaseId =
  | 'phase-1-auditor-sweep'
  | 'phase-2-primary-dm-sweep'
  | 'phase-3-cheapest-viable-pairings';

export type ModelTierProvider = 'anthropic' | 'openai';

export interface ModelTierCandidate {
  readonly id: string;
  readonly provider: ModelTierProvider;
  readonly model: string;
  readonly tier: 'premium' | 'standard' | 'economy' | 'ceiling';
  readonly role: ModelTierEvaluationRole;
  readonly notes?: string;
}

export interface ModelTierPairing {
  readonly id: string;
  readonly phase: ModelTierEvaluationPhaseId;
  readonly primaryDm: ModelTierCandidate;
  readonly auditor: ModelTierCandidate;
  readonly hypothesis: string;
}

export interface ModelTierEvaluationPhase {
  readonly id: ModelTierEvaluationPhaseId;
  readonly name: string;
  readonly fixedRole: ModelTierEvaluationRole | 'cheapest_viable_pair';
  readonly goal: string;
  readonly pairings: readonly ModelTierPairing[];
}

export type ModelTierScenarioTurnKind =
  | 'dialogue'
  | 'travel'
  | 'exploration'
  | 'combat'
  | 'save_or_check';

export interface ModelTierScenarioTurn {
  readonly id: string;
  readonly kind: ModelTierScenarioTurnKind;
  readonly playerInput: string;
  readonly expectedMechanics: readonly string[];
  readonly tableFeelFocus: readonly string[];
}

export interface ModelTierRollFixture {
  readonly id: string;
  readonly dice: string;
  readonly reason: string;
  readonly visibility: 'player_visible' | 'dm_only';
  readonly category:
    | 'attack'
    | 'damage'
    | 'initiative'
    | 'saving_throw'
    | 'death_save'
    | 'ability_check'
    | 'other';
  readonly rolls: readonly number[];
  readonly modifier: number;
}

export interface ModelTierEvaluationScenario {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly turns: readonly ModelTierScenarioTurn[];
  readonly rollFixture: readonly ModelTierRollFixture[];
  readonly notes: readonly string[];
}

export interface ModelTierUsageEstimate {
  readonly primaryDmTokens: number | null;
  readonly auditorTokens: number | null;
  readonly primaryDmUsd: number | null;
  readonly auditorUsd: number | null;
}

export interface ModelTierTurnMetrics {
  readonly turnId: string;
  readonly accepted: boolean;
  readonly firstPassAccepted: boolean;
  readonly primaryDmCallCount: number;
  readonly auditorCallCount: number;
  readonly primaryDmRetryCount: number;
  readonly auditRejectionCauses: readonly string[];
  readonly auditorFalseRejects: number;
  readonly auditorFalseAccepts: number;
  readonly jsonOrParseFailures: number;
  readonly toolCorrectness: number;
  readonly playerVisibleRollCompliance: number;
  readonly combatantStateCorrectness: number;
  readonly unsupportedInferenceCount: number;
  readonly usage: ModelTierUsageEstimate;
  readonly mechanicalNotes: readonly string[];
  readonly tableFeelNotes: readonly string[];
}

export interface ModelTierPairRun {
  readonly pairingId: string;
  readonly scenarioId: string;
  readonly turns: readonly ModelTierTurnMetrics[];
}

export interface ModelTierMechanicalSummary {
  readonly acceptedTurnCount: number;
  readonly totalTurnCount: number;
  readonly firstPassAuditAcceptRate: number;
  readonly totalPrimaryDmCalls: number;
  readonly totalAuditorCalls: number;
  readonly totalPrimaryDmRetries: number;
  readonly expensivePrimaryDmCallsPerAcceptedTurn: number;
  readonly auditorFalseRejects: number;
  readonly auditorFalseAccepts: number;
  readonly jsonOrParseFailures: number;
  readonly toolCorrectnessAverage: number;
  readonly playerVisibleRollComplianceAverage: number;
  readonly combatantStateCorrectnessAverage: number;
  readonly unsupportedInferenceCount: number;
  readonly auditRejectionCauses: readonly string[];
}

export interface ModelTierUsageSummary {
  readonly primaryDmTokens: number | null;
  readonly auditorTokens: number | null;
  readonly primaryDmUsd: number | null;
  readonly auditorUsd: number | null;
  readonly totalUsd: number | null;
}

export interface ModelTierTableFeelSummary {
  readonly notes: readonly string[];
}

export interface ModelTierPairReport {
  readonly pairing: ModelTierPairing;
  readonly scenario: ModelTierEvaluationScenario;
  readonly mechanical: ModelTierMechanicalSummary;
  readonly usage: ModelTierUsageSummary;
  readonly tableFeel: ModelTierTableFeelSummary;
}

export interface RunModelTierEvaluationInput {
  readonly scenario?: ModelTierEvaluationScenario;
  readonly pairings?: readonly ModelTierPairing[];
  readonly executePairing: (
    pairing: ModelTierPairing,
    scenario: ModelTierEvaluationScenario,
  ) => Promise<ModelTierPairRun> | ModelTierPairRun;
}

export interface ModelTierEvaluationMatrixReport {
  readonly scenario: ModelTierEvaluationScenario;
  readonly reports: readonly ModelTierPairReport[];
}

const candidate = (
  role: ModelTierEvaluationRole,
  provider: ModelTierProvider,
  model: string,
  tier: ModelTierCandidate['tier'],
  notes?: string,
): ModelTierCandidate => ({
  id: `${provider}:${model}:${role}`,
  provider,
  model,
  tier,
  role,
  ...(notes === undefined ? {} : { notes }),
});

const opusPrimary = candidate(
  'primary_dm',
  'anthropic',
  'claude-opus-4-8',
  'premium',
  'Fixed premium primary DM control for auditor sweeps.',
);
const opusAuditor = candidate(
  'auditor',
  'anthropic',
  'claude-opus-4-8',
  'ceiling',
  'Ceiling/control auditor only when useful.',
);
const sonnetPrimary = candidate(
  'primary_dm',
  'anthropic',
  'claude-sonnet',
  'standard',
  'Candidate lower primary-DM tier.',
);
const sonnetAuditor = candidate(
  'auditor',
  'anthropic',
  'claude-sonnet',
  'standard',
  'Candidate stronger auditor than Haiku.',
);
const haikuPrimary = candidate(
  'primary_dm',
  'anthropic',
  'claude-haiku',
  'economy',
  'Constrained-mode primary-DM experiment.',
);
const haikuAuditor = candidate(
  'auditor',
  'anthropic',
  'claude-haiku',
  'economy',
  'Cheap auditor candidate.',
);
const gptPremiumPrimary = candidate(
  'primary_dm',
  'openai',
  'gpt-5.5',
  'premium',
  'OpenAI premium primary-DM candidate.',
);
const gptMiniAuditor = candidate(
  'auditor',
  'openai',
  'gpt-5.4-mini',
  'economy',
  'OpenAI mini auditor candidate.',
);
const gptStrongAuditor = candidate(
  'auditor',
  'openai',
  'stronger-gpt-auditor-tier',
  'standard',
  'Placeholder for the strongest available GPT auditor tier at evaluation time.',
);
const gptLowerPrimary = candidate(
  'primary_dm',
  'openai',
  'lower-gpt-primary-tier',
  'standard',
  'Placeholder for cheaper GPT primary-DM tiers available at evaluation time.',
);

const pairing = (
  id: string,
  phase: ModelTierEvaluationPhaseId,
  primaryDm: ModelTierCandidate,
  auditor: ModelTierCandidate,
  hypothesis: string,
): ModelTierPairing => ({ id, phase, primaryDm, auditor, hypothesis });

export const MODEL_TIER_EVALUATION_PHASES: readonly ModelTierEvaluationPhase[] =
  [
    {
      id: 'phase-1-auditor-sweep',
      name: 'Hold primary DM constant, vary auditor',
      fixedRole: 'primary_dm',
      goal: 'Measure whether stronger auditors reduce false accepts, false rejects, and expensive primary-DM retries.',
      pairings: [
        pairing(
          'opus-haiku-auditor',
          'phase-1-auditor-sweep',
          opusPrimary,
          haikuAuditor,
          'Cheap auditor baseline.',
        ),
        pairing(
          'opus-sonnet-auditor',
          'phase-1-auditor-sweep',
          opusPrimary,
          sonnetAuditor,
          'Test whether a stronger auditor lowers total accepted-turn cost.',
        ),
        pairing(
          'opus-opus-auditor-control',
          'phase-1-auditor-sweep',
          opusPrimary,
          opusAuditor,
          'Ceiling/control for subtle evidence reasoning.',
        ),
        pairing(
          'gpt-premium-mini-auditor',
          'phase-1-auditor-sweep',
          gptPremiumPrimary,
          gptMiniAuditor,
          'OpenAI mini auditor baseline.',
        ),
        pairing(
          'gpt-premium-stronger-auditor',
          'phase-1-auditor-sweep',
          gptPremiumPrimary,
          gptStrongAuditor,
          'Test whether a stronger GPT auditor reduces total retries.',
        ),
      ],
    },
    {
      id: 'phase-2-primary-dm-sweep',
      name: 'Hold best auditor constant, vary primary DM',
      fixedRole: 'auditor',
      goal: 'Find the cheapest/most available primary DM tier that still produces good accepted play.',
      pairings: [
        pairing(
          'opus-primary-best-auditor',
          'phase-2-primary-dm-sweep',
          opusPrimary,
          sonnetAuditor,
          'Premium primary-DM baseline with best available auditor from phase 1.',
        ),
        pairing(
          'sonnet-primary-best-auditor',
          'phase-2-primary-dm-sweep',
          sonnetPrimary,
          sonnetAuditor,
          'Test whether Sonnet-class primary DM is sufficient.',
        ),
        pairing(
          'haiku-primary-best-auditor',
          'phase-2-primary-dm-sweep',
          haikuPrimary,
          sonnetAuditor,
          'Test Haiku-class primary DM only for constrained modes.',
        ),
        pairing(
          'gpt-lower-primary-best-auditor',
          'phase-2-primary-dm-sweep',
          gptLowerPrimary,
          gptStrongAuditor,
          'Test lower GPT primary tiers once a reliable auditor is chosen.',
        ),
      ],
    },
    {
      id: 'phase-3-cheapest-viable-pairings',
      name: 'Evaluate cheapest viable pairings',
      fixedRole: 'cheapest_viable_pair',
      goal: 'Compare plausible low-cost pairings only after runtime affordances are stable.',
      pairings: [
        pairing(
          'sonnet-haiku',
          'phase-3-cheapest-viable-pairings',
          sonnetPrimary,
          haikuAuditor,
          'Cheapest plausible Anthropic split if Haiku audit is reliable enough.',
        ),
        pairing(
          'sonnet-sonnet',
          'phase-3-cheapest-viable-pairings',
          sonnetPrimary,
          sonnetAuditor,
          'Balanced standard-tier Anthropic pairing.',
        ),
        pairing(
          'lower-gpt-mini',
          'phase-3-cheapest-viable-pairings',
          gptLowerPrimary,
          gptMiniAuditor,
          'Cheapest plausible GPT pairing if available.',
        ),
      ],
    },
  ];

export const MODEL_TIER_EVALUATION_PAIRINGS: readonly ModelTierPairing[] =
  MODEL_TIER_EVALUATION_PHASES.flatMap((phase) => phase.pairings);

export const FIRST_COMBAT_MODEL_TIER_SCENARIO: ModelTierEvaluationScenario = {
  id: 'first-combat-model-tier',
  name: 'First combat model-tier evaluation',
  description:
    'Deterministic post-l3b3 scenario for primary-DM and auditor tier evaluation.',
  turns: [
    {
      id: 'sela-authority-dialogue',
      kind: 'dialogue',
      playerInput:
        'I ask Warden Sela, as the village authority, what happened at the watchtower.',
      expectedMechanics: ['world_query for Warden Sela or module authority'],
      tableFeelFocus: ['Sela feels authoritative', 'the report is actionable'],
    },
    {
      id: 'sela-investigation-expectations',
      kind: 'dialogue',
      playerInput:
        'I ask what I should expect if I investigate the watchtower.',
      expectedMechanics: ['no unsupported exact facts without evidence'],
      tableFeelFocus: [
        'clear stakes',
        'useful but not over-revealing guidance',
      ],
    },
    {
      id: 'travel-watchtower',
      kind: 'travel',
      playerInput: 'I travel to the old watchtower.',
      expectedMechanics: ['scene/location transition is state-backed'],
      tableFeelFocus: ['travel pace is concise', 'arrival preserves tension'],
    },
    {
      id: 'torch-hollow-entry',
      kind: 'exploration',
      playerInput: 'I light a torch and enter the hollow under the watchtower.',
      expectedMechanics: [
        'torch or light action is state-backed when relevant',
      ],
      tableFeelFocus: ['sensory description supports tactical choices'],
    },
    {
      id: 'goblin-ambush',
      kind: 'combat',
      playerInput: 'The goblins ambush me. Start combat.',
      expectedMechanics: [
        'start_encounter creates live combatants',
        'initiative roll is player-visible',
      ],
      tableFeelFocus: [
        'ambush is tense without hiding player-facing mechanics',
      ],
    },
    {
      id: 'bob-player-attack',
      kind: 'combat',
      playerInput: 'Bob attacks goblin-1 with his longsword.',
      expectedMechanics: [
        'player attack roll is visible',
        'damage roll is visible on hit',
        'combatant HP change is state-backed',
      ],
      tableFeelFocus: ['hit or miss narration matches the roll'],
    },
    {
      id: 'goblin-enemy-attack',
      kind: 'combat',
      playerInput: 'Resolve the goblins attacking Bob.',
      expectedMechanics: [
        'enemy attack against Bob is visible',
        'enemy damage against Bob is visible on hit',
        'Bob HP change is state-backed',
      ],
      tableFeelFocus: ['enemy turn is clear and fair'],
    },
    {
      id: 'bob-death-save-or-check',
      kind: 'save_or_check',
      playerInput:
        'If Bob is at 0 HP, make his death save; otherwise make an aware Perception check.',
      expectedMechanics: [
        'death save or aware ability check is player-visible',
        'no hidden roll leaks unrelated ambush information',
      ],
      tableFeelFocus: ['the stakes are understandable'],
    },
  ],
  rollFixture: [
    {
      id: 'initiative',
      dice: '1d20+2',
      reason: 'Bob initiative',
      visibility: 'player_visible',
      category: 'initiative',
      rolls: [15],
      modifier: 2,
    },
    {
      id: 'first-player-attack-miss',
      dice: '1d20+5',
      reason: 'Bob first longsword attack against goblin-1',
      visibility: 'player_visible',
      category: 'attack',
      rolls: [3],
      modifier: 5,
    },
    {
      id: 'goblin-attack-miss',
      dice: '1d20+4',
      reason: 'goblin-1 scimitar attack against Bob',
      visibility: 'player_visible',
      category: 'attack',
      rolls: [6],
      modifier: 4,
    },
    {
      id: 'second-player-attack-hit',
      dice: '1d20+5',
      reason: 'Bob second longsword attack against goblin-1',
      visibility: 'player_visible',
      category: 'attack',
      rolls: [13],
      modifier: 5,
    },
    {
      id: 'player-damage-kills-goblin-1',
      dice: '1d8+3',
      reason: 'Bob longsword damage against goblin-1',
      visibility: 'player_visible',
      category: 'damage',
      rolls: [4],
      modifier: 3,
    },
    {
      id: 'goblin-critical-hit',
      dice: '1d20+4',
      reason: 'goblin-2 critical scimitar attack against Bob',
      visibility: 'player_visible',
      category: 'attack',
      rolls: [20],
      modifier: 4,
    },
    {
      id: 'goblin-critical-damage',
      dice: '2d6+4',
      reason: 'goblin-2 critical damage against Bob',
      visibility: 'player_visible',
      category: 'damage',
      rolls: [3, 3],
      modifier: 4,
    },
    {
      id: 'death-save-success',
      dice: '1d20',
      reason: 'Bob death save',
      visibility: 'player_visible',
      category: 'death_save',
      rolls: [15],
      modifier: 0,
    },
  ],
  notes: [
    'Run all pairings on the same commit with deterministic roll fixtures.',
    'Do not compare Claude-vs-Codex playtests across l3b3; that comparison is confounded by runtime changes and differing session content.',
    'Use live RNG only as branch-tolerant smoke coverage, never as the deterministic comparison branch.',
  ],
};

function averageMetric(values: readonly number[]): number {
  return values.length === 0 ? 0 : average(values);
}

function sumNullable(values: readonly (number | null)[]): number | null {
  let total = 0;
  for (const value of values) {
    if (value === null) {
      return null;
    }
    total += value;
  }
  return total;
}

function summarizeUsage(
  turns: readonly ModelTierTurnMetrics[],
): ModelTierUsageSummary {
  const primaryDmTokens = sumNullable(
    turns.map((turn) => turn.usage.primaryDmTokens),
  );
  const auditorTokens = sumNullable(
    turns.map((turn) => turn.usage.auditorTokens),
  );
  const primaryDmUsd = sumNullable(
    turns.map((turn) => turn.usage.primaryDmUsd),
  );
  const auditorUsd = sumNullable(turns.map((turn) => turn.usage.auditorUsd));
  return {
    primaryDmTokens,
    auditorTokens,
    primaryDmUsd,
    auditorUsd,
    totalUsd:
      primaryDmUsd === null || auditorUsd === null
        ? null
        : primaryDmUsd + auditorUsd,
  };
}

export function summarizeModelTierPairRun(
  pairing: ModelTierPairing,
  scenario: ModelTierEvaluationScenario,
  run: ModelTierPairRun,
): ModelTierPairReport {
  const acceptedTurns = run.turns.filter((turn) => turn.accepted);
  const acceptedTurnCount = acceptedTurns.length;
  const totalPrimaryDmCalls = run.turns.reduce(
    (sum, turn) => sum + turn.primaryDmCallCount,
    0,
  );
  const totalPrimaryDmRetries = run.turns.reduce(
    (sum, turn) => sum + turn.primaryDmRetryCount,
    0,
  );
  const tableFeelNotes = run.turns.flatMap((turn) => turn.tableFeelNotes);
  const mechanical: ModelTierMechanicalSummary = {
    acceptedTurnCount,
    totalTurnCount: run.turns.length,
    firstPassAuditAcceptRate: averageMetric(
      run.turns.map((turn) => (turn.firstPassAccepted ? 1 : 0)),
    ),
    totalPrimaryDmCalls,
    totalAuditorCalls: run.turns.reduce(
      (sum, turn) => sum + turn.auditorCallCount,
      0,
    ),
    totalPrimaryDmRetries,
    expensivePrimaryDmCallsPerAcceptedTurn:
      acceptedTurnCount === 0 ? 0 : totalPrimaryDmCalls / acceptedTurnCount,
    auditorFalseRejects: run.turns.reduce(
      (sum, turn) => sum + turn.auditorFalseRejects,
      0,
    ),
    auditorFalseAccepts: run.turns.reduce(
      (sum, turn) => sum + turn.auditorFalseAccepts,
      0,
    ),
    jsonOrParseFailures: run.turns.reduce(
      (sum, turn) => sum + turn.jsonOrParseFailures,
      0,
    ),
    toolCorrectnessAverage: averageMetric(
      run.turns.map((turn) => turn.toolCorrectness),
    ),
    playerVisibleRollComplianceAverage: averageMetric(
      run.turns.map((turn) => turn.playerVisibleRollCompliance),
    ),
    combatantStateCorrectnessAverage: averageMetric(
      run.turns.map((turn) => turn.combatantStateCorrectness),
    ),
    unsupportedInferenceCount: run.turns.reduce(
      (sum, turn) => sum + turn.unsupportedInferenceCount,
      0,
    ),
    auditRejectionCauses: [
      ...new Set(run.turns.flatMap((turn) => turn.auditRejectionCauses)),
    ].sort(),
  };
  return {
    pairing,
    scenario,
    mechanical,
    usage: summarizeUsage(run.turns),
    tableFeel: { notes: tableFeelNotes },
  };
}

export async function runModelTierEvaluationMatrix(
  input: RunModelTierEvaluationInput,
): Promise<ModelTierEvaluationMatrixReport> {
  const scenario = input.scenario ?? FIRST_COMBAT_MODEL_TIER_SCENARIO;
  const pairings = input.pairings ?? MODEL_TIER_EVALUATION_PAIRINGS;
  const reports: ModelTierPairReport[] = [];
  for (const pair of pairings) {
    const run = await input.executePairing(pair, scenario);
    reports.push(summarizeModelTierPairRun(pair, scenario, run));
  }
  return { scenario, reports };
}
