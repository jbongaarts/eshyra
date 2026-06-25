import {
  type CharacterDraft,
  getBundledDnd5eCharacterResolver,
  getDnd5eCharacterCreationEngine,
} from '@eshyra/core/internal';
import { describe, expect, it } from 'vitest';
import type { CharacterDraftStore } from '../src/characterDraftStore.js';
import type { CharacterWizardDeps } from '../src/characterWizard.js';
import {
  parseCreateCharacterArgs,
  runCreateCharacter,
} from '../src/createCharacter.js';
import type { CliIO } from '../src/playTypes.js';

function scriptedIO(answers: ReadonlyArray<string>): {
  io: CliIO;
  lines: string[];
} {
  const lines: string[] = [];
  let next = 0;
  return {
    lines,
    io: {
      write: (l) => lines.push(l),
      prompt: async () => (next < answers.length ? answers[next++] : undefined),
    },
  };
}

function memoryStore(
  seed: ReadonlyArray<CharacterDraft> = [],
): CharacterDraftStore {
  const saved = new Map<string, CharacterDraft>(seed.map((d) => [d.id, d]));
  return {
    save: (draft) => {
      saved.set(draft.id, draft);
    },
    load: (id) => saved.get(id),
    list: () => [...saved.keys()].sort(),
  };
}

function makeDeps(
  answers: ReadonlyArray<string>,
  store: CharacterDraftStore,
): { deps: CharacterWizardDeps; lines: string[] } {
  const { io, lines } = scriptedIO(answers);
  return {
    lines,
    deps: {
      io,
      engine: getDnd5eCharacterCreationEngine(),
      resolver: getBundledDnd5eCharacterResolver(),
      store,
    },
  };
}

describe('parseCreateCharacterArgs', () => {
  it('defaults to concept-first', () => {
    expect(parseCreateCharacterArgs([])).toEqual({
      ok: true,
      args: { mode: 'concept-first', draftId: undefined, resumeId: undefined },
    });
  });

  it('parses mode, id, and resume flags', () => {
    expect(
      parseCreateCharacterArgs(['--mode', 'ability-first', '--id', 'hero']),
    ).toEqual({
      ok: true,
      args: { mode: 'ability-first', draftId: 'hero', resumeId: undefined },
    });
    expect(parseCreateCharacterArgs(['--resume', 'hero'])).toMatchObject({
      ok: true,
      args: { resumeId: 'hero' },
    });
  });

  it('rejects an unknown mode and unknown flags', () => {
    expect(parseCreateCharacterArgs(['--mode', 'speedrun']).ok).toBe(false);
    expect(parseCreateCharacterArgs(['--bogus']).ok).toBe(false);
    expect(parseCreateCharacterArgs(['--mode']).ok).toBe(false);
  });
});

describe('runCreateCharacter', () => {
  it('reports a usage error for bad args without starting the wizard', async () => {
    const { deps, lines } = makeDeps([], memoryStore());
    const code = await runCreateCharacter(deps, ['--mode', 'nope']);
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/Unknown mode/);
  });

  it('errors when resuming a missing draft and lists available ids', async () => {
    const engine = getDnd5eCharacterCreationEngine();
    const existing = engine.createDraft({ id: 'real', mode: 'concept-first' });
    const { deps, lines } = makeDeps([], memoryStore([existing]));
    const code = await runCreateCharacter(deps, ['--resume', 'ghost']);
    expect(code).toBe(1);
    const out = lines.join('\n');
    expect(out).toMatch(/No saved draft found for id "ghost"/);
    expect(out).toMatch(/Available drafts: real/);
  });

  it('resumes an existing draft and continues from its saved state', async () => {
    const engine = getDnd5eCharacterCreationEngine();
    let seeded = engine.createDraft({ id: 'cont', mode: 'concept-first' });
    seeded = engine.setIdentity(seeded, { name: 'Mira' });
    seeded = engine.setClass(seeded, 'Wizard');
    const store = memoryStore([seeded]);

    // Enter past the settled name and class, set ancestry, then quit.
    const { deps } = makeDeps(['', '', 'Elf', 'quit'], store);
    const code = await runCreateCharacter(deps, ['--resume', 'cont']);
    expect(code).toBe(0);
    expect(store.load('cont')?.selections.ancestry).toBe('Elf');
    expect(store.load('cont')?.identity.name).toBe('Mira');
  });

  it('starts a fresh draft under an explicit id', async () => {
    const store = memoryStore();
    const { deps } = makeDeps(['Aldric', 'quit'], store);
    const code = await runCreateCharacter(deps, ['--id', 'aldric']);
    expect(code).toBe(0);
    expect(store.load('aldric')?.identity.name).toBe('Aldric');
  });
});
