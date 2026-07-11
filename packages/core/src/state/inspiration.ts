// Inspiration boolean resource (eshyra-2n1t.7, engine family F5; source:
// docs/audits/dnd5e-srd-5.1-final/
// 2026-07-06-o9bd-18-7-8-execution-boundary-classification.md §4).
//
// SRD 5.1 semantics (gaining-inspiration, using-inspiration), code-owned so
// the resource can never be silently stockpiled or double-spent:
//
// - Inspiration is binary: you either have it or you do not, and you cannot
//   stockpile more (gaining-inspiration). Awarding it to a character who
//   already has it is refused.
// - Spending it grants advantage on one attack roll, saving throw, or
//   ability check (using-inspiration). The spend flips the durable boolean;
//   applying the advantage to the roll is F1's dice-grammar surface — until
//   that lands the DM applies it through the roll ruling.
// - A character with inspiration can gift it: they lose it, the recipient
//   gains it, and the no-stockpile cap binds the recipient too
//   (using-inspiration).
// - Whether a deed *earns* inspiration stays entirely a DM ruling; this
//   module owns only the resource state.

import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { resolveCharacterId } from './activeCharacter.js';
import type { LifeState } from './hpLifecycle.js';

export interface InspirationMutationContext {
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
}

export interface AwardInspirationInput extends InspirationMutationContext {
  /** Character ref; defaults to the acting character. */
  readonly characterRef?: string;
}

export interface SpendInspirationInput extends InspirationMutationContext {
  readonly characterRef?: string;
  /** Present iff the inspiration is gifted instead of spent: the receiving
   *  character's ref. */
  readonly giftTo?: string;
}

export interface InspirationResult {
  readonly characterId: string;
  readonly characterLabel: string;
  readonly inspiration: boolean;
}

export interface SpendInspirationResult extends InspirationResult {
  readonly outcome: 'spent' | 'gifted';
  /** For a spend: what the resource bought. */
  readonly advantageNote?: string;
  /** For a gift: the recipient's state. */
  readonly recipient?: InspirationResult;
}

export class InspirationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InspirationError';
  }
}

function readCharacter(
  db: Db,
  characterRef: string | undefined,
): { id: string; label: string; inspiration: boolean; lifeState: LifeState } {
  const charId = resolveCharacterId(db, characterRef);
  const row = db
    .prepare('SELECT name, life_state, inspiration FROM character WHERE id = ?')
    .get(charId) as
    | { name: string | null; life_state: LifeState; inspiration: number }
    | undefined;
  if (row === undefined) {
    throw new InspirationError(`no character row exists for '${charId}'`);
  }
  return {
    id: charId,
    label: row.name ?? charId,
    inspiration: row.inspiration === 1,
    lifeState: row.life_state,
  };
}

function writeInspiration(
  db: Db,
  characterId: string,
  value: boolean,
  ctx: InspirationMutationContext,
): void {
  db.prepare(
    `UPDATE character
     SET inspiration = ?, provenance = ?, session_id = ?, updated_at = ?
     WHERE id = ?`,
  ).run(value ? 1 : 0, ctx.provenance, ctx.sessionId, ctx.at, characterId);
}

export function awardInspiration(
  db: Db,
  input: AwardInspirationInput,
): InspirationResult {
  return withTransaction(db, (txnDb) => {
    const character = readCharacter(txnDb, input.characterRef);
    if (character.lifeState === 'dead') {
      throw new InspirationError(
        `character '${character.label}' is dead and cannot be inspired`,
      );
    }
    if (character.inspiration) {
      throw new InspirationError(
        `${character.label} already has inspiration — it cannot be stockpiled (you either have it or you do not)`,
      );
    }
    writeInspiration(txnDb, character.id, true, input);
    return {
      characterId: character.id,
      characterLabel: character.label,
      inspiration: true,
    };
  });
}

export function spendInspiration(
  db: Db,
  input: SpendInspirationInput,
): SpendInspirationResult {
  return withTransaction(db, (txnDb) => {
    const character = readCharacter(txnDb, input.characterRef);
    if (!character.inspiration) {
      throw new InspirationError(
        `${character.label} has no inspiration to ${input.giftTo === undefined ? 'spend' : 'gift'}`,
      );
    }

    if (input.giftTo === undefined) {
      writeInspiration(txnDb, character.id, false, input);
      return {
        characterId: character.id,
        characterLabel: character.label,
        inspiration: false,
        outcome: 'spent' as const,
        advantageNote:
          'advantage on one attack roll, saving throw, or ability check made now',
      };
    }

    const recipient = readCharacter(txnDb, input.giftTo);
    if (recipient.id === character.id) {
      throw new InspirationError(
        `${character.label} cannot gift inspiration to themselves`,
      );
    }
    if (recipient.lifeState === 'dead') {
      throw new InspirationError(
        `character '${recipient.label}' is dead and cannot be inspired`,
      );
    }
    if (recipient.inspiration) {
      throw new InspirationError(
        `${recipient.label} already has inspiration — it cannot be stockpiled, so the gift is refused`,
      );
    }
    writeInspiration(txnDb, character.id, false, input);
    writeInspiration(txnDb, recipient.id, true, input);
    return {
      characterId: character.id,
      characterLabel: character.label,
      inspiration: false,
      outcome: 'gifted' as const,
      recipient: {
        characterId: recipient.id,
        characterLabel: recipient.label,
        inspiration: true,
      },
    };
  });
}
