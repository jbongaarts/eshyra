import {
  type CharacterDraft,
  type CharacterRegistryStore,
  type CharacterSheet,
  createSeededRng,
  getBundledDnd5eCharacterResolver,
  getDnd5eCharacterCreationEngine,
} from '@eshyra/core/internal';
import { describe, expect, it } from 'vitest';
import type { CharacterDraftStore } from '../src/characterDraftStore.js';
import type { CharacterWizardDeps } from '../src/characterWizard.js';
import {
  type CreateCharacterOptions,
  newDraftId,
  parseCreateCharacterArgs,
  runCreateCharacter,
} from '../src/createCharacter.js';
import type { CliIO } from '../src/playTypes.js';

function memoryCharacterStore(): CharacterRegistryStore & {
  readonly saved: Map<string, CharacterSheet>;
} {
  const saved = new Map<string, CharacterSheet>();
  return {
    saved,
    save: (id, character) => {
      saved.set(id, character);
    },
    load: (id) => saved.get(id),
    list: () => [...saved.keys()].sort(),
  };
}

const FIXED_NOW = '2026-06-26T00:00:00.000Z';
const finalizeOpts = (
  characterStore: CharacterRegistryStore,
): CreateCharacterOptions => ({ characterStore, now: () => FIXED_NOW });

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
      rng: createSeededRng(7),
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

  it('renders the stable unsupported-build message when a resumed draft is multiclass-shaped', async () => {
    const engine = getDnd5eCharacterCreationEngine();
    const invalid = {
      ...engine.createDraft({ id: 'cont', mode: 'concept-first' }),
      classes: ['Fighter', 'Wizard'],
    } as CharacterDraft;
    const { deps, lines } = makeDeps([], memoryStore([invalid]));

    const code = await runCreateCharacter(deps, ['--resume', 'cont']);

    expect(code).toBe(1);
    expect(lines).toContain(
      'character-creation draft resume was refused: Eshyra currently supports one class only.',
    );
  });

  it('starts a fresh draft under an explicit id', async () => {
    const store = memoryStore();
    const { deps } = makeDeps(['Aldric', 'quit'], store);
    const code = await runCreateCharacter(deps, ['--id', 'aldric']);
    expect(code).toBe(0);
    expect(store.load('aldric')?.identity.name).toBe('Aldric');
  });

  it('gives each --id-less run a distinct draft id (no cross-run overwrite)', async () => {
    // The real bug: each CLI run is a fresh process, so a per-process counter
    // would reuse `character-1` and overwrite the prior run's saved draft. A
    // shared store across two runs must end up with two separate drafts.
    const store = memoryStore();

    const first = makeDeps(['Aldric', 'quit'], store);
    await runCreateCharacter(first.deps, []);
    const second = makeDeps(['Brielle', 'quit'], store);
    await runCreateCharacter(second.deps, []);

    expect(store.list()).toHaveLength(2);
    const names = store
      .list()
      .map((id) => store.load(id)?.identity.name)
      .sort();
    expect(names).toEqual(['Aldric', 'Brielle']);

    // The generated id is surfaced so the player can resume it.
    expect(first.lines.join('\n')).toMatch(
      /New draft id: character-.*--resume/,
    );
  });
});

describe('runCreateCharacter — finalization (eshyra-b69j.14)', () => {
  // A complete concept-first Fighter + Human run: identity, class, ancestry,
  // skip background, point-buy scores, the class skill + four equipment groups,
  // the Human language, skip spells, finish at review.
  const COMPLETE_RUN = [
    'Grok',
    'Fighter',
    'Human',
    '', // background skip
    'point_buy',
    'str 15',
    'dex 14',
    'con 13',
    'int 12',
    'wis 10',
    'cha 8',
    'done',
    'Athletics',
    'Perception',
    '1',
    '1',
    '1',
    '1',
    'Dwarvish',
    '', // spells skip
    '', // review → finish
  ] as const;

  it('writes a finalized record when the wizard completes', async () => {
    const store = memoryStore();
    const characters = memoryCharacterStore();
    const { deps, lines } = makeDeps(COMPLETE_RUN, store);
    const code = await runCreateCharacter(
      deps,
      ['--id', 'grok'],
      finalizeOpts(characters),
    );
    expect(code).toBe(0);

    const record = characters.saved.get('grok');
    expect(record).toBeDefined();
    expect(record?.identity.name).toBe('Grok');
    expect(record?.class.name).toBe('Fighter');
    expect(record?.ancestry.name).toBe('Human');
    expect(record?.skillProficiencies).toEqual(['Athletics', 'Perception']);
    expect(record?.metadata.createdAt).toBe(FIXED_NOW);
    expect(lines.join('\n')).toMatch(/Finalized Grok/);
  });

  it('does not finalize when the player quits before finishing', async () => {
    const store = memoryStore();
    const characters = memoryCharacterStore();
    const { deps } = makeDeps(['Grok', 'Fighter', 'quit'], store);
    const code = await runCreateCharacter(
      deps,
      ['--id', 'grok'],
      finalizeOpts(characters),
    );
    expect(code).toBe(0);
    // Quitting leaves only the resumable draft — no finalized record.
    expect(characters.saved.size).toBe(0);
  });
});

describe('newDraftId', () => {
  it('is unique across calls and uses only path-safe characters', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newDraftId()));
    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(id).toMatch(/^character-[a-z0-9-]+$/);
    }
  });
});
