# Model-Tier Evaluation

The practical model question is not "Claude versus Codex." The first combat
playtest happened after `eshyra-l3b3`, so comparisons against earlier sessions
are confounded by runtime changes, different session content, and different RNG
paths. The useful question is which model tier is required for each Eshyra role:

- primary DM: cheapest or most available tier that still produces good accepted
  play;
- auditor: cheapest reliable tier that avoids false accepts and false rejects;
- total pairing cost: accepted-turn cost after retries, not just per-call token
  price.

The core model-tier harness in `packages/core/src/model/evaluation.ts` provides
three deterministic pieces:

- `FIRST_COMBAT_MODEL_TIER_SCENARIO`: a short post-`l3b3` scenario covering Sela
  dialogue, investigation expectations, watchtower travel, torch/hollow entry,
  goblin ambush, player attack, enemy attack, and a death-save or aware-check
  branch.
- `MODEL_TIER_EVALUATION_PHASES`: the staged pairing matrix for fixed-primary
  auditor sweeps, fixed-auditor primary-DM sweeps, and cheapest viable pairings.
- `runModelTierEvaluationMatrix`: aggregation over one or more pair runs,
  separating mechanical correctness, usage/cost, and table feel.

The scenario uses deterministic roll fixtures for combat comparison. Live RNG
playtests are still useful as branch-tolerant smoke tests, but they should not
decide model-tier suitability because a small model difference can shift the
roll stream.

## Staged Matrix

Phase 1 holds the primary DM constant and varies the auditor:

- Opus primary + Haiku auditor
- Opus primary + Sonnet auditor
- Opus primary + Opus auditor as a ceiling/control when useful
- GPT premium primary + GPT mini auditor
- GPT premium primary + stronger GPT auditor tier

Phase 2 holds the best auditor constant and varies the primary DM:

- Opus primary
- Sonnet primary
- Haiku primary in constrained modes only
- lower GPT primary tier when available

Phase 3 evaluates cheapest viable pairings only after runtime behavior is stable
enough that missing system affordances are not mistaken for model weakness:

- Sonnet + Haiku
- Sonnet + Sonnet
- lower GPT primary + mini auditor

## Metrics

Mechanical correctness is reported separately from table feel. Required metrics
include:

- first-pass audit accept rate;
- primary DM call and retry counts;
- auditor call count;
- expensive primary-DM calls per accepted turn;
- auditor rejection causes;
- auditor false rejects and false accepts;
- JSON/parse failures;
- tool correctness;
- player-visible roll compliance;
- combatant-state correctness;
- unsupported inference count.

Usage is split by primary DM and auditor where available. This is what tests the
important cost hypothesis: a stronger auditor can be cheaper overall if it
reduces false rejects enough to avoid expensive primary-DM retries.

Table feel is qualitative by design. Keep notes such as NPC voice, pacing,
clarity, and tension in the table-feel section so they can be compared without
masking mechanical failures.

## Running Pairings

The core harness is provider-neutral. A runner should:

1. Bind concrete provider adapters for the primary DM and auditor candidate.
2. Run every pairing on the same git commit.
3. Use the scenario's deterministic roll fixture for combat.
4. Collect the turn metrics from `runTurn`, `ModelUsageStore`, audit records,
   trace data, and human/fixture judgements for table feel.
5. Pass each pairing's collected `ModelTierPairRun` into
   `runModelTierEvaluationMatrix`.

Do not require Bob to naturally reach 0 HP under live RNG. The deterministic
fixture owns that branch.

