/**
 * Explicit alternate-timeline fork CLI UX (ADR 0012, eshyra-lupf.14.4.4).
 *
 * A thin, deliberately-discouraging surface over the core
 * {@link forkCharacterTimeline}. Forking branches a character into a brand-new
 * `globalCharacterId` (revision 1, with parent provenance) and **breaks
 * continuity**: the fork and its source are independent characters thereafter.
 * It is NOT how a character moves between campaigns (that is release →
 * re-checkout). Two surfaces use this module:
 *
 *   - resume-conflict fork ({@link forkConflictedCharacterIntoCampaign}): when a
 *     campaign's copy is stale, keep playing THIS campaign's version as a new,
 *     separate character — fork from the campaign's revision, then check the
 *     fork into the same party slot.
 *   - standalone fork ({@link forkCharacterInteractive}): a registry-level
 *     operation to fork any registered character from head or a chosen revision
 *     into a new id, without attaching it anywhere.
 */

import {
  CharacterCustodyError,
  type CharacterRegistryStore,
  checkoutCharacterIntoCampaign,
  type Db,
  forkCharacterTimeline,
} from '@eshyra/core';
import { openCharacterRegistry } from './characterRegistry.js';
import { resolveDataRoot } from './dataRoot.js';
import { nodeIO } from './play.js';
import type { CliIO } from './playTypes.js';

/** Minimal deps the fork flows need. */
export interface ForkDeps {
  readonly characterRegistry: CharacterRegistryStore;
  readonly io: CliIO;
  readonly now: () => string;
  readonly nextId: (prefix: string) => string;
}

/**
 * Resolve a stale-copy resume conflict by forking: branch this campaign's
 * revision of the character into a brand-new identity and check that fork into
 * the same party slot, so play continues with an explicitly separate character.
 * The original continuing identity is untouched.
 *
 * Requires the campaign copy to have a recorded source revision (the revision it
 * was checked out at) so the fork branches the right point; without it we cannot
 * honestly identify which revision to fork, so the caller is told to catch up or
 * cancel instead. Returns true when the fork was created and attached.
 */
export function forkConflictedCharacterIntoCampaign(
  deps: ForkDeps,
  db: Db,
  campaignId: string,
  characterId: string,
  source: {
    readonly globalCharacterId: string;
    readonly fromRevision: number | undefined;
  },
): boolean {
  if (source.fromRevision === undefined) {
    deps.io.write(
      `Cannot fork "${source.globalCharacterId}": this campaign's copy has no recorded ` +
        'revision to branch from. Choose catch-up or cancel instead.',
    );
    return false;
  }
  const newGlobalCharacterId = deps.nextId('fork');
  try {
    const fork = forkCharacterTimeline(deps.characterRegistry, {
      sourceGlobalCharacterId: source.globalCharacterId,
      newGlobalCharacterId,
      fromRevision: source.fromRevision,
    });
    // Attach the fork (revision 1) into the same party slot: this re-links the
    // campaign sheet to the new identity, re-projects the live row, and takes
    // custody of the fork. The source character stays idle and unchanged.
    checkoutCharacterIntoCampaign(deps.characterRegistry, db, {
      globalCharacterId: newGlobalCharacterId,
      campaignId,
      characterId,
      sessionId: 'resume-fork',
      at: deps.now(),
    });
    deps.io.write(
      `Forked "${source.globalCharacterId}"@${source.fromRevision} into a new, separate ` +
        `character "${fork.globalCharacterId}" (revision 1). Continuity with the original is ` +
        'broken: the two are now independent characters. This campaign now plays the fork.',
    );
    return true;
  } catch (error) {
    deps.io.write(
      error instanceof CharacterCustodyError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error),
    );
    return false;
  }
}

/** Print a registered character's revision timeline for selection. */
function listRevisions(
  deps: Pick<ForkDeps, 'characterRegistry' | 'io'>,
  globalCharacterId: string,
): void {
  const revisions = deps.characterRegistry.listRevisions(globalCharacterId);
  if (revisions.length === 0) {
    deps.io.write('  (no revisions)');
    return;
  }
  for (const revision of revisions) {
    const sheet = revision.sheet;
    deps.io.write(
      `  revision ${revision.revision} [${revision.source}]: level ${sheet.level} ` +
        `${sheet.ancestry.name} ${sheet.class.name} — ${sheet.identity.name}`,
    );
  }
}

/**
 * Standalone, registry-level fork: prompt for a source character, a source
 * revision (default head), and a new id, then fork. Explains up front that this
 * breaks continuity. Does NOT attach the fork to any campaign — the new identity
 * is created in the registry and can later be imported into a campaign. Returns
 * true when a fork was created.
 */
export async function forkCharacterInteractive(
  deps: Pick<ForkDeps, 'characterRegistry' | 'io'>,
): Promise<boolean> {
  const ids = deps.characterRegistry.list();
  if (ids.length === 0) {
    deps.io.write('No characters found in the character registry to fork.');
    return false;
  }

  deps.io.write(
    'Forking creates a NEW, separate character from a chosen revision. It breaks',
  );
  deps.io.write(
    'continuity: the fork and the original become independent characters with',
  );
  deps.io.write(
    'separate timelines. To move a character between campaigns instead, just',
  );
  deps.io.write('release it from one campaign and check it out in the next.');
  deps.io.write('Registered characters:');
  for (const id of ids) {
    const sheet = deps.characterRegistry.load(id);
    const head = deps.characterRegistry.headRevision(id);
    const label =
      sheet === undefined
        ? id
        : `${id}: ${sheet.identity.name}, level ${sheet.level} ${sheet.ancestry.name} ${sheet.class.name} (head revision ${head ?? '?'})`;
    deps.io.write(`  ${label}`);
  }

  const sourceInput = await deps.io.prompt('Source character id to fork: ');
  const sourceId = sourceInput?.trim();
  if (sourceId === undefined || sourceId.length === 0) {
    deps.io.write('Fork cancelled.');
    return false;
  }
  const head = deps.characterRegistry.headRevision(sourceId);
  if (head === undefined) {
    deps.io.write(
      `No registered character with a timeline for id "${sourceId}".`,
    );
    return false;
  }

  deps.io.write(`Revisions for "${sourceId}":`);
  listRevisions(deps, sourceId);
  const revisionInput = await deps.io.prompt(
    `Source revision to fork from [default head ${head}]: `,
  );
  const revisionRaw = revisionInput?.trim() ?? '';
  let fromRevision = head;
  if (revisionRaw.length > 0) {
    const parsed = Number.parseInt(revisionRaw, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      deps.io.write(`"${revisionRaw}" is not a valid revision number.`);
      return false;
    }
    fromRevision = parsed;
  }

  const newIdInput = await deps.io.prompt('New character id for the fork: ');
  const newId = newIdInput?.trim();
  if (newId === undefined || newId.length === 0) {
    deps.io.write('Fork cancelled.');
    return false;
  }

  try {
    const fork = forkCharacterTimeline(deps.characterRegistry, {
      sourceGlobalCharacterId: sourceId,
      newGlobalCharacterId: newId,
      fromRevision,
    });
    deps.io.write(
      `Forked "${sourceId}"@${fromRevision} into "${fork.globalCharacterId}" ` +
        `(revision ${fork.revision.revision}, parent ${fork.revision.parent?.globalCharacterId}@${fork.revision.parent?.revision}). ` +
        'The original character is unchanged. Import the fork into a campaign to play it.',
    );
    return true;
  } catch (error) {
    deps.io.write(error instanceof Error ? error.message : String(error));
    return false;
  }
}

/** Terminal entrypoint for `eshyra fork-character`. */
export async function runForkCharacterSubcommand(): Promise<number> {
  const dataRoot = resolveDataRoot();
  const characterRegistry = openCharacterRegistry(dataRoot);
  const terminal = nodeIO();
  try {
    const ok = await forkCharacterInteractive({
      characterRegistry,
      io: terminal,
    });
    return ok ? 0 : 1;
  } finally {
    terminal.close();
  }
}
