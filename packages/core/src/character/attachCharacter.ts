/**
 * Attach a registry character into a campaign for play (ADR 0012).
 *
 * Attaching is copy-with-provenance, not a fork: the sheet must have been built
 * under the campaign's bound rules pack (fail closed on mismatch), it is stamped
 * with the source `globalCharacterId`, persisted as the campaign's authoritative
 * per-campaign sheet, and projected into the live `character` row. This is the
 * single core entry point the CLI (and future web/app UXes) use to bring a
 * continuing character into a campaign.
 */

import type { Db } from '../persistence/db.js';
import {
  DEFAULT_DND5E_SRD_BINDING,
  readCampaignRulesBinding,
} from '../rules/binding.js';
import { assertSupportedCharacterBuild } from './characterBuild.js';
import {
  assertSheetMatchesPack,
  createSqliteCharacterSheetStore,
} from './characterSheetStore.js';
import {
  type CompleteCharacterCreationResult,
  importFinalizedCharacter,
} from './creation.js';
import type { CharacterSheet } from './finalizeCharacter.js';

export interface AttachCharacterSheetInput {
  /** The sheet to attach (typically loaded from the character registry). */
  readonly sheet: CharacterSheet;
  /** The cross-campaign identity this sheet came from (stamped as provenance). */
  readonly globalCharacterId: string;
  /**
   * The registry revision being checked out (ADR 0012, eshyra-lupf.14.3),
   * stamped on the campaign sheet as `metadata.sourceRevision` so the playable
   * instance records the point on the character's timeline it took custody
   * from. Omitted by callers that do not (yet) track revisions.
   */
  readonly sourceRevision?: number;
  /** The campaign-local character id to attach as (defaults to `pc-1`). */
  readonly characterId?: string;
  /** Session id recorded on the resulting state mutations. */
  readonly sessionId: string;
  /** ISO-8601 timestamp for `importedAt` provenance and mutation metadata. */
  readonly at: string;
}

/**
 * Attach `input.sheet` into the campaign `db`. Throws
 * {@link CharacterSheetPackMismatchError} when the sheet's rules pack does not
 * match the campaign binding (a cross-pack import is a future conversion, not an
 * attach). On success the campaign `character_sheet` is the authoritative
 * playable instance and the live `character` row is projected from it.
 */
export function attachCharacterSheetToCampaign(
  db: Db,
  input: AttachCharacterSheetInput,
): CompleteCharacterCreationResult {
  assertSupportedCharacterBuild(input.sheet, {
    operation: 'character-sheet attach',
  });
  const binding = readCampaignRulesBinding(db) ?? DEFAULT_DND5E_SRD_BINDING;
  assertSheetMatchesPack(input.sheet, binding);

  const attached: CharacterSheet = {
    ...input.sheet,
    metadata: {
      ...input.sheet.metadata,
      globalCharacterId: input.globalCharacterId,
      importedAt: input.at,
      ...(input.sourceRevision !== undefined
        ? { sourceRevision: input.sourceRevision }
        : {}),
    },
  };

  createSqliteCharacterSheetStore(db).save(
    input.characterId ?? 'pc-1',
    attached,
  );
  return importFinalizedCharacter(db, {
    character: attached,
    sessionId: input.sessionId,
    at: input.at,
    ...(input.characterId !== undefined
      ? { characterId: input.characterId }
      : {}),
  });
}
