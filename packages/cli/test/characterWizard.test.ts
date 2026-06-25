import {
  type CharacterDraft,
  getBundledDnd5eCharacterResolver,
  getDnd5eCharacterCreationEngine,
} from '@eshyra/core/internal';
import { describe, expect, it } from 'vitest';
import type { CharacterDraftStore } from '../src/characterDraftStore.js';
import {
  type CharacterWizardDeps,
  runCharacterWizard,
} from '../src/characterWizard.js';
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

function memoryStore(): CharacterDraftStore & {
  readonly saved: Map<string, CharacterDraft>;
} {
  const saved = new Map<string, CharacterDraft>();
  return {
    saved,
    save: (draft) => {
      saved.set(draft.id, draft);
    },
    load: (id) => saved.get(id),
    list: () => [...saved.keys()].sort(),
  };
}

function deps(answers: ReadonlyArray<string>): {
  deps: CharacterWizardDeps;
  lines: string[];
  store: ReturnType<typeof memoryStore>;
} {
  const { io, lines } = scriptedIO(answers);
  const store = memoryStore();
  return {
    lines,
    store,
    deps: {
      io,
      engine: getDnd5eCharacterCreationEngine(),
      resolver: getBundledDnd5eCharacterResolver(),
      store,
    },
  };
}

const text = (lines: readonly string[]): string => lines.join('\n');

describe('character wizard — concept-first happy path', () => {
  it('walks identity → class → ancestry → background → scores → review to completion', async () => {
    // Step order: identity, class, ancestry, background, ability-scores,
    // class-choices, spells-equipment, review.
    const {
      deps: d,
      lines,
      store,
    } = deps([
      'Mira', // identity name
      'Wizard', // class
      'High Elf', // ancestry
      '', // background (skip)
      'point_buy', // ability method
      // A valid 27-point build: 0+7+7+9+2+2 = 27.
      'str 8',
      'dex 14',
      'con 14',
      'int 15',
      'wis 10',
      'cha 10',
      'done', // ability scores complete
      '', // class-choices: Enter to continue
      'Fire Bolt, Magic Missile', // spells
      '', // review: Enter to finish
    ]);

    const result = await runCharacterWizard(d, {
      mode: 'concept-first',
      draftId: 'mira',
    });

    expect(result.outcome).toBe('completed');
    expect(result.draft.identity.name).toBe('Mira');
    expect(result.draft.selections.className).toBe('Wizard');
    expect(result.draft.selections.ancestry).toBe('High Elf');
    expect(result.draft.selections.spells).toEqual([
      'Fire Bolt',
      'Magic Missile',
    ]);
    // High Elf +1 INT pushes base 15 → 16; spell DC = 8 + 2 + 3 = 13.
    expect(result.draft.derived.spellSaveDc).toBe(13);
    // Completion persists the draft.
    expect(result.saved).toBe(true);
    expect(store.saved.has('mira')).toBe(true);
    // The exact mode label is shown.
    expect(text(lines)).toContain('Concept-first — I know what I want to play');
  });
});

describe('character wizard — resolver-backed choices', () => {
  it('accepts an unambiguous class prefix', async () => {
    const { deps: d } = deps(['Hero', 'wiz', 'Elf', '', 'point_buy', 'quit']);
    const result = await runCharacterWizard(d, {
      mode: 'concept-first',
      draftId: 'p',
    });
    expect(result.draft.selections.className).toBe('Wizard');
  });

  it('rejects an unknown class with actionable suggestions, no draft failure', async () => {
    const { deps: d, lines } = deps([
      'Hero',
      'Wizrd', // typo → no exact, no unique prefix
      'Wizard', // recover
      'Elf',
      '',
      'point_buy',
      'quit',
    ]);
    const result = await runCharacterWizard(d, {
      mode: 'concept-first',
      draftId: 'p',
    });
    expect(text(lines)).toMatch(/No class matches "Wizrd"|Did you mean/);
    // Despite the bad entry the draft recovered and recorded the valid class.
    expect(result.draft.selections.className).toBe('Wizard');
  });

  it('lists and searches options for a step', async () => {
    const { deps: d, lines } = deps([
      'list', // identity step has nothing to list
      'Hero',
      'list', // class list
      'search rog', // class search
      'Rogue',
      'quit',
    ]);
    await runCharacterWizard(d, { mode: 'concept-first', draftId: 'p' });
    const out = text(lines);
    expect(out).toContain('Wizard');
    expect(out).toContain('Rogue');
  });
});

describe('character wizard — navigation and corrections', () => {
  it('preserves prior answers across back and set', async () => {
    const { deps: d } = deps([
      'Mira', // identity
      'Fighter', // class
      'back', // → identity
      '', // keep existing name, advance
      'set class Wizard', // correct class via set (global command)
      '', // class step: Enter to advance (class already set)
      'Elf', // ancestry
      'quit',
    ]);
    const result = await runCharacterWizard(d, {
      mode: 'concept-first',
      draftId: 'p',
    });
    // Name survived the back navigation; class correction took effect.
    expect(result.draft.identity.name).toBe('Mira');
    expect(result.draft.selections.className).toBe('Wizard');
    expect(result.draft.selections.ancestry).toBe('Elf');
  });

  it('review shows completed fields, derived values, and what is missing', async () => {
    const { deps: d, lines } = deps([
      'Mira',
      'Fighter',
      'review', // mid-flow review (global)
      'quit',
    ]);
    await runCharacterWizard(d, { mode: 'concept-first', draftId: 'p' });
    const out = text(lines);
    expect(out).toContain('Draft review');
    expect(out).toContain('Mira');
    expect(out).toContain('Fighter');
    // Not finalizable yet (scores missing).
    expect(out).toMatch(/not finalizable yet|Still needed/);
  });
});

describe('character wizard — save, quit, and resume', () => {
  it('saves on explicit save and reports it', async () => {
    const { deps: d, lines, store } = deps(['Mira', 'save', 'quit']);
    await runCharacterWizard(d, { mode: 'concept-first', draftId: 'keep' });
    expect(store.saved.has('keep')).toBe(true);
    expect(text(lines)).toContain('Draft saved.');
  });

  it('offers to save on quit when there are unsaved changes', async () => {
    // The "unsaved changes? (y/n)" text is the prompt question (not a written
    // line), so assert on the persisted result and the post-save confirmation.
    const {
      deps: d,
      lines,
      store,
    } = deps([
      'Mira', // unsaved change
      'quit', // triggers save prompt
      'y', // yes, save
    ]);
    const result = await runCharacterWizard(d, {
      mode: 'concept-first',
      draftId: 'q',
    });
    expect(result.outcome).toBe('quit');
    expect(store.saved.has('q')).toBe(true);
    expect(text(lines)).toContain('Draft saved.');
  });

  it('does not prompt to save on quit when nothing changed', async () => {
    const { deps: d, lines } = deps(['quit']);
    const result = await runCharacterWizard(d, {
      mode: 'concept-first',
      draftId: 'q',
    });
    expect(result.outcome).toBe('quit');
    expect(text(lines)).not.toMatch(/unsaved changes/i);
  });

  it('resumes a saved draft without losing state', async () => {
    // First session: set a name and class, then save+quit.
    const first = deps(['Mira', 'Wizard', 'save', 'quit']);
    await runCharacterWizard(first.deps, {
      mode: 'concept-first',
      draftId: 'resume-me',
    });
    const stored = first.store.saved.get('resume-me');
    expect(stored?.selections.className).toBe('Wizard');

    // Second session: resume from the stored draft. The wizard restarts at the
    // first step with all prior state preserved — Enter steps past the settled
    // name and class, then we set ancestry and quit.
    const second = deps(['', '', 'Elf', 'quit']);
    const result = await runCharacterWizard(second.deps, {
      mode: stored?.creationMode ?? 'concept-first',
      draftId: 'resume-me',
      resume: stored,
    });
    expect(result.draft.identity.name).toBe('Mira');
    expect(result.draft.selections.className).toBe('Wizard');
    expect(result.draft.selections.ancestry).toBe('Elf');
  });

  it('persists unsaved work on end-of-input', async () => {
    // No quit; input simply runs out after a change.
    const { deps: d, store } = deps(['Mira']);
    const result = await runCharacterWizard(d, {
      mode: 'concept-first',
      draftId: 'eof',
    });
    expect(result.saved).toBe(true);
    expect(store.saved.get('eof')?.identity.name).toBe('Mira');
  });
});
