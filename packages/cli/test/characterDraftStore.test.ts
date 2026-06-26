import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type FinalizedCharacter,
  getDnd5eCharacterCreationEngine,
} from '@eshyra/core/internal';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFileCharacterDraftStore,
  createFileFinalizedCharacterStore,
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

  it('returns undefined for an unknown draft id', () => {
    const store = createFileCharacterDraftStore(tempDir());
    expect(store.load('nope')).toBeUndefined();
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

describe('file finalized-character store', () => {
  it('writes a finalized record to a stable per-id path', () => {
    const dir = tempDir();
    const store = createFileFinalizedCharacterStore(dir);
    const record = {
      schemaVersion: 1,
      system: 'dnd5e-srd',
      identity: { name: 'Mira' },
      class: { key: 'class:wizard', name: 'Wizard' },
    } as unknown as FinalizedCharacter;

    const path = store.save('mira', record);
    expect(path).toBe(join(dir, 'mira.json'));
    const written = JSON.parse(
      readFileSync(path, 'utf8'),
    ) as FinalizedCharacter;
    expect(written.identity.name).toBe('Mira');
    expect(written.class.name).toBe('Wizard');
    expect(store.load('mira')?.identity.name).toBe('Mira');
  });

  it('lists finalized character ids in sorted order', () => {
    const store = createFileFinalizedCharacterStore(tempDir());
    const record = {
      schemaVersion: 1,
      system: 'dnd5e-srd',
      identity: { name: 'Mira' },
      class: { key: 'class:wizard', name: 'Wizard' },
    } as unknown as FinalizedCharacter;
    store.save('beta', record);
    store.save('alpha', record);

    expect(store.list()).toEqual(['alpha', 'beta']);
    expect(store.load('missing')).toBeUndefined();
  });
});
