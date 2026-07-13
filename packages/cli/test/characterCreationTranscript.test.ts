import {
  type CharacterDraft,
  createSeededRng,
  getBundledDnd5eCharacterResolver,
  getDnd5eCharacterCreationEngine,
} from '@eshyra/core/internal';
import { describe, expect, it } from 'vitest';
import type { CharacterDraftStore } from '../src/characterDraftStore.js';
import {
  type CharacterWizardDeps,
  runCharacterWizard,
} from '../src/characterWizard.js';
import { runCreateCharacter } from '../src/createCharacter.js';
import type { CliIO } from '../src/playTypes.js';

function scriptedIO(answers: readonly string[]): {
  readonly io: CliIO;
  readonly lines: string[];
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

function memoryStore(
  seed: readonly CharacterDraft[] = [],
): CharacterDraftStore & {
  readonly saved: Map<string, CharacterDraft>;
} {
  const saved = new Map(seed.map((draft) => [draft.id, draft]));
  return {
    saved,
    save: (draft) => {
      saved.set(draft.id, draft);
    },
    load: (id) => saved.get(id),
    list: () => [...saved.keys()].sort(),
  };
}

function deps(
  answers: readonly string[],
  store = memoryStore(),
): {
  readonly deps: CharacterWizardDeps;
  readonly lines: string[];
  readonly store: ReturnType<typeof memoryStore>;
} {
  const { io, lines } = scriptedIO(answers);
  return {
    lines,
    store,
    deps: {
      io,
      engine: getDnd5eCharacterCreationEngine(),
      resolver: getBundledDnd5eCharacterResolver(),
      store,
      rng: createSeededRng(11),
    },
  };
}

const transcript = (lines: readonly string[]): string => lines.join('\n');

describe('guided character creation CLI transcripts (eshyra-b69j.15)', () => {
  it('recovers from an invalid ancestry without losing prior choices', async () => {
    const { deps: d, lines } = deps([
      'Mira',
      'Fighter',
      'Bogusfolk',
      'Human',
      'quit',
      'n',
    ]);

    const result = await runCharacterWizard(d, {
      mode: 'concept-first',
      draftId: 'ancestry-recovery',
    });

    const out = transcript(lines);
    expect(out).toMatch(/No ancestry matches "Bogusfolk"/);
    expect(result.draft.selections.className).toBe('Fighter');
    expect(result.draft.selections.ancestry).toBe('Human');
  });

  it('rejects point-buy range and integer errors as the score is entered', async () => {
    const { deps: d, lines } = deps([
      'Mira',
      'Fighter',
      'Human',
      '',
      'point_buy',
      'str 16',
      'str 15',
      'int nope',
      'int 12',
      'dex 14',
      'con 13',
      'wis 10',
      'cha 8',
      'done',
      'quit',
      'n',
    ]);

    const result = await runCharacterWizard(d, {
      mode: 'concept-first',
      draftId: 'score-recovery',
    });

    const out = transcript(lines);
    expect(out).toMatch(/between 8 and 15/);
    expect(out).toMatch(/Intelligence score must be a whole number/);
    expect(result.draft.selections.baseAbilityScores?.strength).toBe(15);
    expect(result.draft.selections.baseAbilityScores?.intelligence).toBe(12);
  });

  it('catches a cleared name at review without dropping class and ancestry', async () => {
    const { deps: d, lines } = deps([
      'Mira',
      'Fighter',
      'Human',
      'set name',
      'review',
      'quit',
      'n',
    ]);

    const result = await runCharacterWizard(d, {
      mode: 'concept-first',
      draftId: 'missing-name',
    });

    const out = transcript(lines);
    expect(out).toContain('Still needed:');
    expect(out).toMatch(/Name/);
    expect(result.draft.identity.name).toBe('');
    expect(result.draft.selections.className).toBe('Fighter');
    expect(result.draft.selections.ancestry).toBe('Human');
  });

  it('shows HP as pending until class and Constitution are known', async () => {
    const { deps: d, lines } = deps([
      'Thalia',
      'point_buy',
      'con 14',
      'str 15',
      'dex 14',
      'int 12',
      'wis 10',
      'cha 8',
      'done',
      '', // keep package acquisition mode
      'review',
      'quit',
      'n',
    ]);

    const result = await runCharacterWizard(d, {
      mode: 'ability-first',
      draftId: 'hp-pending',
    });

    const out = transcript(lines);
    expect(result.draft.derived.maxHitPoints).toBeUndefined();
    expect(out).toContain('Still needed:');
    expect(out).toMatch(/Class/);
    expect(out).not.toContain('Max HP:');
    expect(out).not.toMatch(/maxHitPoints: .*error/i);
  });

  it('saves a draft and resumes it through the create-character command', async () => {
    const store = memoryStore();
    const first = deps(['Mira', 'Wizard', 'save', 'quit'], store);
    const firstCode = await runCreateCharacter(first.deps, [
      '--id',
      'resume-transcript',
    ]);
    expect(firstCode).toBe(0);
    expect(transcript(first.lines)).toContain('Draft saved.');

    const second = deps(['', '', 'Elf', 'quit', 'y'], store);
    const secondCode = await runCreateCharacter(second.deps, [
      '--resume',
      'resume-transcript',
    ]);

    expect(secondCode).toBe(0);
    const resumed = store.load('resume-transcript');
    expect(resumed?.identity.name).toBe('Mira');
    expect(resumed?.selections.className).toBe('Wizard');
    expect(resumed?.selections.ancestry).toBe('Elf');
  });

  it('review shows pending level-1 choices before finalization', async () => {
    const { deps: d, lines } = deps([
      'Grok',
      'Fighter',
      'Human',
      '',
      'point_buy',
      'str 15',
      'dex 14',
      'con 13',
      'int 12',
      'wis 10',
      'cha 8',
      'done',
      '',
      'review',
      'quit',
      'n',
    ]);

    const result = await runCharacterWizard(d, {
      mode: 'concept-first',
      draftId: 'pending-choices',
    });

    const out = transcript(lines);
    expect(result.outcome).toBe('quit');
    expect(out).toContain('Still needed (choices):');
    expect(out).toMatch(/skills|starting equipment|language/);
    expect(out).toContain('Draft is not finalizable yet');
  });
});
