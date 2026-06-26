/**
 * Persistence for guided-character-creation drafts (eshyra-b69j.10).
 *
 * A draft is a serializable, pre-finalization {@link CharacterDraft} (the live
 * derived/diagnostics fields are recomputed on resume by the engine, so only the
 * identity/selections/mode/level need round-trip fidelity). Drafts live under
 * `<dataRoot>/drafts/characters/<id>.json`, outside the campaign databases.
 *
 * The store is a small interface so the wizard can be driven by an in-memory
 * store in tests; {@link createFileCharacterDraftStore} is the on-disk
 * implementation, writing atomically (temp file + rename) like the campaign
 * registry so a reader never sees a partial file.
 */

import { randomBytes } from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { CharacterDraft, FinalizedCharacter } from '@eshyra/core';

/** Read/write access to resumable character-creation drafts. */
export interface CharacterDraftStore {
  /** Persist (overwrite) the draft under its id. */
  save(draft: CharacterDraft): void;
  /** Load a draft by id, or `undefined` when none is stored. */
  load(id: string): CharacterDraft | undefined;
  /** The ids of every stored draft, in stable (sorted) order. */
  list(): readonly string[];
}

/**
 * Reduce a draft id to a safe, collision-resistant file stem: lowercase, with
 * every character outside `[a-z0-9-_]` replaced by `-`. Ids are wizard-generated
 * (slug of the character name or an explicit `--id`), so this only guards
 * against path-hostile characters rather than reshaping normal ids.
 */
export function draftFileStem(id: string): string {
  const stem = id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return stem.length > 0 ? stem : 'draft';
}

/** A character-draft store backed by JSON files under `dir`. */
export function createFileCharacterDraftStore(
  dir: string,
): CharacterDraftStore {
  return {
    save(draft: CharacterDraft): void {
      mkdirSync(dir, { recursive: true });
      const path = join(dir, `${draftFileStem(draft.id)}.json`);
      const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
      renameSync(tmp, path);
    },

    load(id: string): CharacterDraft | undefined {
      const path = join(dir, `${draftFileStem(id)}.json`);
      let raw: string;
      try {
        raw = readFileSync(path, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return undefined;
        }
        throw error;
      }
      return JSON.parse(raw) as CharacterDraft;
    },

    list(): readonly string[] {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return [];
        }
        throw error;
      }
      return entries
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.slice(0, -'.json'.length))
        .sort();
    },
  };
}

/** Persistence for finalized, playable character records (eshyra-b69j.14). */
export interface FinalizedCharacterStore {
  /** Persist a finalized character under an id; returns the written path. */
  save(id: string, character: FinalizedCharacter): string;
}

/** A finalized-character store backed by JSON files under `dir`. */
export function createFileFinalizedCharacterStore(
  dir: string,
): FinalizedCharacterStore {
  return {
    save(id: string, character: FinalizedCharacter): string {
      mkdirSync(dir, { recursive: true });
      const path = join(dir, `${draftFileStem(id)}.json`);
      const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(character, null, 2)}\n`, 'utf8');
      renameSync(tmp, path);
      return path;
    },
  };
}
