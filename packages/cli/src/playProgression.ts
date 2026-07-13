import {
  createSqliteCharacterSheetStore,
  type Db,
  getLevelUpEligibility,
  getProgressionState,
  type LevelUpChangeSet,
  type LevelUpChoiceSelections,
  type LevelUpRequiredChoice,
  listProgressionEvents,
  rollDice,
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
  deps: Pick<PlayDeps, 'characterResolver' | 'characterRng' | 'io' | 'now'>,
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

  const preview = runGuidedLevelUp(db, {
    ...base,
    choices,
    hitPointChoice: { method: 'fixed-average' },
  });
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

  let hitPointChoice: import('@eshyra/core').LevelUpHitPointChoice = {
    method: 'fixed-average',
  };
  for (;;) {
    const hpAnswer = await deps.io.prompt(
      'Hit points: fixed average or roll? [fixed] ',
    );
    if (hpAnswer === undefined || /^(?:cancel|back)$/i.test(hpAnswer.trim())) {
      deps.io.write('Level-up cancelled.');
      return;
    }
    if (/^(?:roll|rolled)$/i.test(hpAnswer.trim())) {
      const hitDie = preview.changeSet.hitPoints.hitDie;
      const roll = rollDice(`1d${hitDie}`, deps.characterRng);
      hitPointChoice = { method: 'rolled', roll };
      break;
    }
    if (/^(?:fixed|fixed-average)?$/i.test(hpAnswer.trim())) break;
    deps.io.write('Choose fixed, roll, cancel, or back.');
  }
  const finalPreview = runGuidedLevelUp(db, {
    ...base,
    choices,
    hitPointChoice,
  });
  if (finalPreview.outcome !== 'preview') {
    deps.io.write('Level-up could not be previewed.');
    return;
  }
  printPreview(deps.io, finalPreview.changeSet);
  const answer = await deps.io.prompt('Apply level-up? [y/N] ');
  if (answer === undefined || !/^y(es)?$/i.test(answer.trim())) {
    deps.io.write('Level-up cancelled.');
    return;
  }

  const committed = runGuidedLevelUp(db, {
    ...base,
    choices,
    hitPointChoice,
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
    choices[choice.id] =
      choice.kind === 'ability-score-improvement'
        ? answer
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        : [answer.trim()];
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
    `HP max: ${changeSet.hitPoints.maxHitPoints.from} -> ${changeSet.hitPoints.maxHitPoints.to} (+${changeSet.hitPoints.increment}${changeSet.hitPoints.retroactiveConstitutionAdjustment ? `; retroactive ${changeSet.hitPoints.retroactiveConstitutionAdjustment >= 0 ? '+' : ''}${changeSet.hitPoints.retroactiveConstitutionAdjustment}` : ''}).`,
  );
  if (changeSet.hitPoints.method === 'rolled') {
    io.write(
      `HP: rolled ${changeSet.hitPoints.naturalRoll} on d${changeSet.hitPoints.hitDie} + Constitution ${changeSet.hitPoints.constitutionModifier} = ${changeSet.hitPoints.increment}.`,
    );
  } else {
    io.write(
      `HP: fixed average + Constitution ${changeSet.hitPoints.constitutionModifier} = ${changeSet.hitPoints.increment}.`,
    );
  }
  for (const increase of changeSet.abilityScoreIncreases ?? []) {
    io.write(
      `ASI: ${increase.ability} ${increase.finalScore.from} -> ${increase.finalScore.to} (modifier ${increase.modifier.from} -> ${increase.modifier.to}).`,
    );
  }
  if (changeSet.featuresGained.length > 0) {
    io.write(`Features gained: ${changeSet.featuresGained.join(', ')}.`);
  }
}
