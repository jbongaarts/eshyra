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
const MAX_CHOICE_ROUNDS = 5;
// Option lists longer than this are paged and searchable so that a choice such
// as Magical Secrets (~300 spells) does not flood the terminal.
const OPTION_PAGE_SIZE = 40;

type LevelUpChoiceOption = NonNullable<
  LevelUpRequiredChoice['options']
>[number];

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
  deps: Pick<PlayDeps, 'characterRng' | 'io' | 'now'>,
  db: Db,
  sessionId: string,
): Promise<void> {
  const store = createSqliteCharacterSheetStore(db, deps.now);
  // No resolver: level-up derives class rules from the campaign's binding.
  const base = {
    store,
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
  let preview: ReturnType<typeof runGuidedLevelUp> = initial;
  const askedOptional = new Set<string>();
  // Choices can unlock further choices (a Hunter option after choosing the
  // Hunter subclass; a refused pick re-asked), so collect until the preview
  // settles. Each pass asks only for supported choices not yet answered.
  for (let round = 0; ; round += 1) {
    if (preview.outcome === 'needs-choices') {
      if (round > 0) {
        printMissingChoices(deps.io, preview.requiredChoices);
      }
      const collected = await collectSupportedChoices(
        deps.io,
        preview.requiredChoices,
        choices,
      );
      if (collected === undefined) {
        deps.io.write('Level-up cancelled.');
        return;
      }
      choices = collected;
      for (const choice of preview.requiredChoices) {
        if (choice.optional === true) askedOptional.add(choice.id);
      }
    }
    preview = runGuidedLevelUp(db, {
      ...base,
      choices,
      hitPointChoice: { method: 'fixed-average' },
    });
    if (preview.outcome === 'preview') {
      // Optional choices (e.g. an invocation replacement) never block, so offer
      // each once before settling on the preview.
      const optional = preview.requiredChoices.filter(
        (choice) =>
          choice.optional === true &&
          choice.status === 'supported' &&
          !askedOptional.has(choice.id),
      );
      if (optional.length === 0) break;
      for (const choice of optional) askedOptional.add(choice.id);
      const collected = await collectSupportedChoices(
        deps.io,
        optional,
        choices,
      );
      if (collected === undefined) {
        deps.io.write('Level-up cancelled.');
        return;
      }
      choices = collected;
      continue;
    }
    if (preview.outcome !== 'needs-choices') break;
    if (round >= MAX_CHOICE_ROUNDS) {
      printMissingChoices(deps.io, preview.requiredChoices);
      return;
    }
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

// Exported for direct testing of the paged option prompt (synthetic long lists).
export async function collectSupportedChoices(
  io: CliIO,
  requiredChoices: readonly LevelUpRequiredChoice[],
  answered: LevelUpChoiceSelections,
): Promise<LevelUpChoiceSelections | undefined> {
  const choices: Record<string, readonly string[]> = { ...answered };
  for (const choice of requiredChoices) {
    if (choice.status !== 'supported') {
      continue;
    }
    // A previously answered choice is re-asked only when it is still required
    // (the engine refused it), which the caller signals by re-listing it.
    const view: OptionListView = { filter: undefined, offset: 0 };
    let answer: string | undefined;
    for (;;) {
      describeChoice(io, choice, view);
      answer = await io.prompt(`${choice.id}> `);
      if (answer === undefined) {
        return undefined;
      }
      if (!applyListNavigation(io, choice, view, answer.trim())) break;
    }
    if (answer.trim().length === 0) {
      if (choice.optional === true) {
        delete choices[choice.id];
        continue;
      }
      return undefined;
    }
    choices[choice.id] =
      choice.kind === 'ability-score-improvement' || (choice.choose ?? 1) > 1
        ? answer
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        : [answer.trim()];
  }
  return choices;
}

function describeChoice(
  io: CliIO,
  choice: LevelUpRequiredChoice,
  view: OptionListView,
): void {
  io.write(
    `${choice.label}${choice.optional === true ? ' [optional; blank to skip]' : ''}`,
  );
  if (choice.options !== undefined && choice.options.length > 0) {
    const paged = choice.options.length > OPTION_PAGE_SIZE;
    const matches = filterOptions(choice.options, view.filter);
    const shown = paged
      ? matches.slice(view.offset, view.offset + OPTION_PAGE_SIZE)
      : matches;
    if (paged) {
      const filterNote =
        view.filter === undefined ? '' : ` matching "${view.filter}"`;
      const first = shown.length === 0 ? 0 : view.offset + 1;
      io.write(
        `  ${choice.options.length} options${filterNote}; showing ${first}-${view.offset + shown.length} of ${matches.length}.`,
      );
    }
    for (const option of shown) {
      io.write(
        `  ${option.id} - ${option.name}${option.level !== undefined ? ` (${option.level === 0 ? 'cantrip' : `level ${option.level}`})` : ''}${option.prerequisite !== undefined ? ` (requires: ${option.prerequisite})` : ''}`,
      );
    }
    if (paged) {
      io.write(`  (type 'search ' to filter, 'more' for the next page)`);
    }
    if (choice.spellChoice?.mode === 'replace') {
      io.write(
        `  Spells you can give up: ${(choice.spellChoice.heldRefs ?? []).join(', ')}`,
      );
      io.write('  (enter "old-spell-id, new-spell-id")');
    } else if (choice.spellChoice?.mode === 'prepare') {
      io.write(
        `  (enter up to ${choice.choose} spell ids separated by commas)`,
      );
    } else if ((choice.choose ?? 1) > 1) {
      io.write('  (enter ids separated by commas)');
    }
  } else if (choice.from !== undefined && choice.from.length > 0) {
    io.write(choice.from.join(', '));
  }
}

interface OptionListView {
  /** Active case-insensitive substring filter over option id and name. */
  filter: string | undefined;
  /** Index into the filtered options of the first option on the page. */
  offset: number;
}

function filterOptions(
  options: readonly LevelUpChoiceOption[],
  filter: string | undefined,
): readonly LevelUpChoiceOption[] {
  if (filter === undefined) return options;
  const needle = filter.toLowerCase();
  return options.filter(
    (option) =>
      option.id.toLowerCase().includes(needle) ||
      option.name.toLowerCase().includes(needle),
  );
}

/**
 * Handles the paging and search commands for long option lists. Returns true
 * when the input was a navigation command (the caller re-prompts the same
 * choice without recording an answer); false when it is an answer.
 */
function applyListNavigation(
  io: CliIO,
  choice: LevelUpRequiredChoice,
  view: OptionListView,
  input: string,
): boolean {
  const options = choice.options;
  if (options === undefined || options.length <= OPTION_PAGE_SIZE) return false;
  const search = /^search(?:\s+(.*))?$/i.exec(input);
  if (search !== null) {
    const text = search[1]?.trim() ?? '';
    view.filter = text.length === 0 ? undefined : text;
    view.offset = 0;
    return true;
  }
  if (/^more$/i.test(input)) {
    const total = filterOptions(options, view.filter).length;
    if (view.offset + OPTION_PAGE_SIZE >= total) {
      io.write('No more options.');
    } else {
      view.offset += OPTION_PAGE_SIZE;
    }
    return true;
  }
  return false;
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
