import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSeededRng,
  getDnd5eCharacterCreationEngine,
  rollAbilityScoreSet,
  UnsupportedCharacterBuildError,
} from '@eshyra/core/internal';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFileCharacterDraftStore,
  draftFileStem,
} from '../src/characterDraftStore.js';

const engine = getDnd5eCharacterCreationEngine();
const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lw-drafts-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop() as string, { recursive: true, force: true });
  }
});

describe('draftFileStem', () => {
  it('lowercases and replaces path-hostile characters', () => {
    expect(draftFileStem('Mira the Brave')).toBe('mira-the-brave');
    expect(draftFileStem('pc/../etc')).toBe('pc-etc');
    expect(draftFileStem('  ')).toBe('draft');
  });
});

describe('file character draft store', () => {
  it('round-trips a draft through save/load', () => {
    const store = createFileCharacterDraftStore(tempDir());
    let draft = engine.createDraft({ id: 'hero-1', mode: 'concept-first' });
    draft = engine.setIdentity(draft, { name: 'Mira' });
    draft = engine.setClass(draft, 'Wizard');
    store.save(draft);

    const loaded = store.load('hero-1');
    expect(loaded?.identity.name).toBe('Mira');
    expect(loaded?.selections.className).toBe('Wizard');
    expect(loaded?.creationMode).toBe('concept-first');
  });

  it('round-trips all six canonical rolled-score evidence objects', () => {
    const store = createFileCharacterDraftStore(tempDir());
    let draft = engine.createDraft({ id: 'roller', mode: 'ability-first' });
    draft = engine.setAbilityScoreMethod(draft, 'rolled');
    const evidence = rollAbilityScoreSet(createSeededRng(42));
    draft = engine.setRolledAbilityScores(draft, evidence);
    store.save(draft);

    const loaded = engine.recomputeDraft(store.load('roller') as typeof draft);
    expect(loaded.selections.rolledAbilityScores).toEqual(evidence);
    expect(JSON.stringify(loaded.selections.rolledAbilityScores)).toBe(
      JSON.stringify(evidence),
    );
  });

  it('normalizes valid legacy rolls and diagnoses malformed legacy evidence', () => {
    const draft = engine.createDraft({ id: 'legacy', mode: 'ability-first' });
    const legacy = Array.from({ length: 6 }, () => ({
      rolls: [2, 2, 5, 6],
      dropped: 2,
      total: 13,
    }));
    const normalized = engine.recomputeDraft({
      ...draft,
      selections: {
        ...draft.selections,
        abilityScoreMethod: 'rolled',
        rolledAbilityScores: legacy,
      },
    } as unknown as typeof draft);
    expect(
      normalized.selections.rolledAbilityScores?.[0].droppedIndices,
    ).toEqual([1]);

    const malformed = engine.recomputeDraft({
      ...draft,
      selections: {
        ...draft.selections,
        abilityScoreMethod: 'rolled',
        rolledAbilityScores: [{ rolls: [0], dropped: 0, total: 0 }],
      },
    } as unknown as typeof draft);
    expect(malformed.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'rolledAbilityScores',
          severity: 'error',
        }),
      ]),
    );
  });

  it('returns undefined for an unknown draft id', () => {
    const store = createFileCharacterDraftStore(tempDir());
    expect(store.load('nope')).toBeUndefined();
  });

  it('rejects multiclass-shaped fields from a hand-edited draft before parsing can discard them', () => {
    const dir = tempDir();
    const store = createFileCharacterDraftStore(dir);
    const draft = engine.createDraft({ id: 'hero-1', mode: 'concept-first' });
    writeFileSync(
      join(dir, 'hero-1.json'),
      JSON.stringify({ ...draft, classes: ['Fighter', 'Wizard'] }),
    );

    expect(() => store.load('hero-1')).toThrow(UnsupportedCharacterBuildError);
  });

  it.each([
    ['classes', ['Fighter', 'Wizard']],
    ['classLevels', { 'class:fighter': 1, 'class:wizard': 1 }],
    ['targetClass', 'Wizard'],
  ])('rejects %s nested in hand-edited draft selections', (field, value) => {
    const dir = tempDir();
    const store = createFileCharacterDraftStore(dir);
    const draft = engine.createDraft({ id: 'hero-1', mode: 'concept-first' });
    writeFileSync(
      join(dir, 'hero-1.json'),
      JSON.stringify({
        ...draft,
        selections: { ...draft.selections, [field]: value },
      }),
    );

    expect(() => store.load('hero-1')).toThrow(UnsupportedCharacterBuildError);
  });

  it('lists stored draft ids in sorted order', () => {
    const store = createFileCharacterDraftStore(tempDir());
    store.save(engine.createDraft({ id: 'beta', mode: 'concept-first' }));
    store.save(engine.createDraft({ id: 'alpha', mode: 'concept-first' }));
    expect(store.list()).toEqual(['alpha', 'beta']);
  });

  it('returns an empty list when the directory is absent', () => {
    const store = createFileCharacterDraftStore(
      join(tempDir(), 'does-not-exist-yet'),
    );
    expect(store.list()).toEqual([]);
  });
});
