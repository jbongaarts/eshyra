import {
  createSqliteCharacterSheetStore,
  type Db,
  getLevelUpEligibility,
  getProgressionState,
  type LevelUpChangeSet,
  type LevelUpChoiceSelections,
  type LevelUpRequiredChoice,
  listProgressionEvents,
  runGuidedLevelUp,
  UnsupportedCharacterBuildError,
} from '@eshyra/core';
import type { CliIO, PlayDeps } from './playTypes.js';

const RECENT_EVENT_LIMIT = 5;

export function showProgression(io: CliIO, db: Db): void {
  const state = getProgressionState(db);
  const eligibility = getLevelUpEligibility(db, state.characterId);
  io.write(
    `Progression for ${state.characterId}: level ${state.level}, ${state.currentXp} XP.`,
  );
  io.write(
    `Advancement: ${eligibility.mode}; ${eligibility.eligible ? `eligible for level ${eligibility.targetLevel} (${eligibility.pendingLevels} pending)` : 'not eligible to level up'}.`,
  );

  const recent = listProgressionEvents(db, state.characterId).slice(
    -RECENT_EVENT_LIMIT,
  );
  if (recent.length === 0) {
    io.write('Recent progression events: none.');
    return;
  }
  io.write('Recent progression events:');
  for (const event of recent) {
    const detail =
      event.kind === 'xp-award'
        ? `+${event.amount ?? 0} XP`
        : event.kind === 'milestone-award'
          ? (event.milestoneLabel ?? event.source)
          : `level ${event.resultingLevel}`;
    io.write(`  - ${event.kind}: ${detail} (${event.occurredAt})`);
  }
}

export async function runLevelUpCommand(
  deps: Pick<PlayDeps, 'characterResolver' | 'io' | 'now'>,
  db: Db,
  sessionId: string,
): Promise<void> {
  const store = createSqliteCharacterSheetStore(db, deps.now);
  const base = {
    store,
    resolver: deps.characterResolver,
    source: 'play-command',
    provenance: 'cli:/levelup',
    sessionId,
    at: deps.now(),
  };

  let initial: ReturnType<typeof runGuidedLevelUp>;
  try {
    initial = runGuidedLevelUp(db, base);
  } catch (error) {
    if (error instanceof UnsupportedCharacterBuildError) {
      deps.io.write(error.message);
      return;
    }
    throw error;
  }
  if (initial.outcome === 'not-eligible') {
    deps.io.write(
      `Not eligible to level up: current level ${initial.eligibility.currentLevel}, target level ${initial.eligibility.targetLevel}.`,
    );
    return;
  }
  if (initial.outcome === 'blocked') {
    printBlockedChoices(deps.io, initial.requiredChoices);
    return;
  }

  let choices: LevelUpChoiceSelections = {};
  if (initial.outcome === 'needs-choices') {
    const collected = await collectSupportedChoices(
      deps.io,
      initial.requiredChoices,
    );
    if (collected === undefined) {
      deps.io.write('Level-up cancelled.');
      return;
    }
    choices = collected;
  }

  const preview = runGuidedLevelUp(db, { ...base, choices });
  if (preview.outcome === 'needs-choices') {
    printMissingChoices(deps.io, preview.requiredChoices);
    return;
  }
  if (preview.outcome === 'blocked') {
    printBlockedChoices(deps.io, preview.requiredChoices);
    return;
  }
  if (preview.outcome === 'not-eligible') {
    deps.io.write('Not eligible to level up.');
    return;
  }
  if (preview.outcome !== 'preview') {
    deps.io.write('Level-up could not be previewed.');
    return;
  }

  printPreview(deps.io, preview.changeSet);
  const answer = await deps.io.prompt('Apply level-up? [y/N] ');
  if (answer === undefined || !/^y(es)?$/i.test(answer.trim())) {
    deps.io.write('Level-up cancelled.');
    return;
  }

  const committed = runGuidedLevelUp(db, {
    ...base,
    choices,
    confirm: true,
    at: deps.now(),
  });
  if (committed.outcome !== 'committed') {
    deps.io.write('Level-up could not be committed.');
    return;
  }
  deps.io.write(
    `Level-up applied: level ${committed.changeSet.level.from} -> ${committed.changeSet.level.to}.`,
  );
}

async function collectSupportedChoices(
  io: CliIO,
  requiredChoices: readonly LevelUpRequiredChoice[],
): Promise<LevelUpChoiceSelections | undefined> {
  const choices: Record<string, readonly string[]> = {};
  for (const choice of requiredChoices) {
    if (choice.status !== 'supported') {
      continue;
    }
    if (choice.from !== undefined && choice.from.length > 0) {
      io.write(`${choice.label}: ${choice.from.join(', ')}`);
    } else {
      io.write(choice.label);
    }
    const answer = await io.prompt(`${choice.id}> `);
    if (answer === undefined || answer.trim().length === 0) {
      return undefined;
    }
    choices[choice.id] = [answer.trim()];
  }
  return choices;
}

function printMissingChoices(
  io: CliIO,
  choices: readonly LevelUpRequiredChoice[],
): void {
  io.write('Level-up needs choices:');
  for (const choice of choices) {
    io.write(`  - ${choice.label} (${choice.id})`);
  }
}

function printBlockedChoices(
  io: CliIO,
  choices: readonly LevelUpRequiredChoice[],
): void {
  io.write('Level-up blocked:');
  for (const choice of choices) {
    io.write(
      `  - ${choice.label}: ${choice.unsupportedReason ?? choice.reason}`,
    );
  }
}

function printPreview(io: CliIO, changeSet: LevelUpChangeSet): void {
  io.write(
    `Level-up preview: level ${changeSet.level.from} -> ${changeSet.level.to}.`,
  );
  io.write(
    `HP max: ${changeSet.hitPoints.maxHitPoints.from} -> ${changeSet.hitPoints.maxHitPoints.to} (+${changeSet.hitPoints.increment}).`,
  );
  if (changeSet.featuresGained.length > 0) {
    io.write(`Features gained: ${changeSet.featuresGained.join(', ')}.`);
  }
}
