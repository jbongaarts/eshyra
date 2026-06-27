/**
 * Cross-campaign character custody lifecycle (ADR 0012, eshyra-lupf.14.3).
 *
 * Builds the checkout → play → sync-back → re-checkout loop on the registry
 * foundation (eshyra-lupf.14.2). A character has a linear revision history in
 * the registry and is owned, at any moment, by exactly one writer:
 *
 *   - **register** — a brand-new character enters the registry as revision 1.
 *   - **checkout** — attaching a registry character into a campaign records
 *     custody (the cross-DB write lock) and stamps the campaign sheet with the
 *     checked-out revision. Attaching a character a second campaign already
 *     holds is refused; the only way to play it elsewhere is an explicit fork.
 *   - **sync-back** — committing a new registry revision from the campaign sheet
 *     when the campaign's copy has changed; the registry head moves forward.
 *   - **release** — sync-back plus dropping custody, so the character is idle
 *     and free to be checked out again.
 *   - **fork** — a deliberate, rare alternate-timeline branch into a *new*
 *     `globalCharacterId`, explicitly breaking continuity with the source.
 *
 * Custody (`character_custody`) is what makes "exactly one writer at a time"
 * enforceable across the registry database and the per-campaign databases: while
 * a campaign holds custody it is the authority; the registry head is stale until
 * sync-back. These helpers never write two databases inside one transaction
 * (SQLite cannot); they order writes so a crash leaves a recoverable state —
 * the campaign sheet is the durable source a later sync-back commits from.
 */

import type { Db } from '../persistence/db.js';
import {
  type AttachCharacterSheetInput,
  attachCharacterSheetToCampaign,
} from './attachCharacter.js';
import type {
  CharacterRegistryStore,
  CharacterRevision,
} from './characterRegistry.js';
import { createSqliteCharacterSheetStore } from './characterSheetStore.js';
import type { CompleteCharacterCreationResult } from './creation.js';
import type { CharacterSheet } from './finalizeCharacter.js';

/**
 * Raised when a custody invariant is violated — most importantly an attempt to
 * attach a character a different campaign already holds (a silent double-attach,
 * which fork exists to make explicit).
 */
export class CharacterCustodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CharacterCustodyError';
  }
}

/** Where a registry character is being attached. */
export interface CheckoutCharacterInput {
  /** The registry character to take custody of. Must already be registered. */
  readonly globalCharacterId: string;
  /** The campaign acquiring custody (its stable campaign id). */
  readonly campaignId: string;
  /** The campaign-local character id to attach as (defaults to `pc-1`). */
  readonly characterId?: string;
  /** Session id recorded on the resulting state mutations. */
  readonly sessionId: string;
  /** ISO-8601 timestamp for custody + attach provenance. */
  readonly at: string;
}

/** Outcome of {@link checkoutCharacterIntoCampaign}. */
export interface CheckoutCharacterResult {
  /** The campaign-side attach/import outcome (live-row projection, prompt). */
  readonly attach: CompleteCharacterCreationResult;
  /** The registry revision that was checked out and stamped on the sheet. */
  readonly revision: number;
  /** The campaign-local character id the sheet was attached as. */
  readonly characterId: string;
}

/** Outcome of {@link syncBackCharacterFromCampaign}. */
export interface SyncBackResult {
  readonly globalCharacterId: string;
  /**
   * The registry head revision after sync-back. When `committed` is false this
   * is the pre-existing head (no new revision was appended).
   */
  readonly revision: number;
  /** True when the campaign sheet differed from head and a revision was added. */
  readonly committed: boolean;
}

const DEFAULT_CHARACTER_ID = 'pc-1';

/**
 * Register a brand-new character as revision 1 of its registry timeline and
 * return that revision. The single entry point for putting a freshly finalized
 * sheet into the registry with history (as opposed to the low-level
 * {@link CharacterRegistryStore.save} head writer).
 */
export function registerNewCharacter(
  registry: CharacterRegistryStore,
  input: { globalCharacterId: string; sheet: CharacterSheet },
): CharacterRevision {
  return registry.appendRevision(
    input.globalCharacterId,
    input.sheet,
    'register',
  );
}

/**
 * Ensure `globalCharacterId` has at least one revision, seeding revision 1 from
 * the registry head when a legacy/`save`-only entry has a head sheet but no
 * timeline yet (e.g. a character migrated before eshyra-lupf.14.3). Returns the
 * head revision number, or `undefined` when the id is not registered at all.
 */
function ensureRevisioned(
  registry: CharacterRegistryStore,
  globalCharacterId: string,
): number | undefined {
  const head = registry.headRevision(globalCharacterId);
  if (head !== undefined) {
    return head;
  }
  const sheet = registry.load(globalCharacterId);
  if (sheet === undefined) {
    return undefined;
  }
  return registerNewCharacter(registry, { globalCharacterId, sheet }).revision;
}

/**
 * Check a registry character out into a campaign: take custody, attach the head
 * sheet as the campaign's authoritative playable instance (stamped with the
 * checked-out revision), and project the live `character` row.
 *
 * Fails closed when another campaign already holds the character (the
 * double-attach guard) — the caller must fork to play an alternate timeline.
 * Re-checking-out into the *same* campaign is allowed and idempotent (resume).
 * A rules-pack mismatch still throws {@link CharacterSheetPackMismatchError}
 * from the underlying attach before any custody is recorded.
 */
export function checkoutCharacterIntoCampaign(
  registry: CharacterRegistryStore,
  campaignDb: Db,
  input: CheckoutCharacterInput,
): CheckoutCharacterResult {
  const characterId = input.characterId ?? DEFAULT_CHARACTER_ID;
  const held = registry.custody(input.globalCharacterId);
  if (held !== undefined && held.campaignId !== input.campaignId) {
    throw new CharacterCustodyError(
      `character "${input.globalCharacterId}" is already attached to campaign "${held.campaignId}" ` +
        `(as ${held.characterId}); release it there or fork an alternate timeline before attaching it elsewhere`,
    );
  }

  const revision = ensureRevisioned(registry, input.globalCharacterId);
  if (revision === undefined) {
    throw new CharacterCustodyError(
      `no registered character "${input.globalCharacterId}" to check out`,
    );
  }
  // `revision` is the head, so `load` returns that revision's sheet.
  const sheet = registry.load(input.globalCharacterId) as CharacterSheet;

  // Attach first (it fails closed on a pack mismatch); only then record custody,
  // so a rejected attach never leaves a dangling lock.
  const attachInput: AttachCharacterSheetInput = {
    sheet,
    globalCharacterId: input.globalCharacterId,
    sourceRevision: revision,
    characterId,
    sessionId: input.sessionId,
    at: input.at,
  };
  const attach = attachCharacterSheetToCampaign(campaignDb, attachInput);

  registry.setCustody({
    globalCharacterId: input.globalCharacterId,
    campaignId: input.campaignId,
    characterId,
    revision,
    attachedAt: input.at,
  });

  return { attach, revision, characterId };
}

/**
 * Strip the per-attachment provenance a checkout stamps onto a campaign sheet
 * (`globalCharacterId` / `importedAt` / `sourceRevision`) so the registry
 * timeline stores clean, canonical sheets. The registry is keyed by
 * `globalCharacterId` and tracks revisions itself, so those fields describe the
 * campaign instance, not the continuing character; dropping them also lets the
 * unchanged-sheet dedupe below match a freshly registered head.
 */
function stripCampaignProvenance(sheet: CharacterSheet): CharacterSheet {
  const {
    globalCharacterId: _global,
    importedAt: _imported,
    sourceRevision: _source,
    ...metadata
  } = sheet.metadata;
  return { ...sheet, metadata };
}

/** Whether two sheets are byte-identical once serialized (revision dedupe). */
function sheetsEqual(a: CharacterSheet, b: CharacterSheet): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Commit a new registry revision from a campaign's current sheet, if it differs
 * from the registry head. Reads the campaign-local sheet, follows its stamped
 * `globalCharacterId` back to the registry, and appends a `sync-back` revision
 * (skipping the append when the sheet is unchanged, so idle sessions do not
 * spam identical revisions). Custody is left untouched — see
 * {@link releaseCharacterFromCampaign} to also drop the lock.
 */
export function syncBackCharacterFromCampaign(
  registry: CharacterRegistryStore,
  campaignDb: Db,
  input: { characterId?: string },
): SyncBackResult | undefined {
  const characterId = input.characterId ?? DEFAULT_CHARACTER_ID;
  const campaignSheet =
    createSqliteCharacterSheetStore(campaignDb).load(characterId);
  const globalCharacterId = campaignSheet?.metadata.globalCharacterId;
  if (campaignSheet === undefined || globalCharacterId === undefined) {
    // The campaign character was never attached from the registry (e.g. created
    // directly in-campaign); there is nothing to sync back.
    return undefined;
  }
  const sheet = stripCampaignProvenance(campaignSheet);

  const head = registry.headRevision(globalCharacterId);
  const headSheet =
    head === undefined ? undefined : registry.load(globalCharacterId);
  if (headSheet !== undefined && sheetsEqual(headSheet, sheet)) {
    return { globalCharacterId, revision: head as number, committed: false };
  }

  const appended = registry.appendRevision(
    globalCharacterId,
    sheet,
    'sync-back',
  );
  return {
    globalCharacterId,
    revision: appended.revision,
    committed: true,
  };
}

/**
 * Release a character from a campaign: sync its sheet back to the registry (per
 * {@link syncBackCharacterFromCampaign}) and drop custody so the character is
 * idle and free to be checked out again. The single "leave campaign" operation
 * the custody model needs. Returns the sync-back outcome, or `undefined` when
 * the campaign character is not registry-linked.
 */
export function releaseCharacterFromCampaign(
  registry: CharacterRegistryStore,
  campaignDb: Db,
  input: { characterId?: string },
): SyncBackResult | undefined {
  const result = syncBackCharacterFromCampaign(registry, campaignDb, input);
  if (result !== undefined) {
    registry.clearCustody(result.globalCharacterId);
  }
  return result;
}

/** Where an alternate-timeline fork branches from and lands. */
export interface ForkCharacterInput {
  /** The continuing character to branch from. */
  readonly sourceGlobalCharacterId: string;
  /** The new, independent identity the fork becomes. Must be unused. */
  readonly newGlobalCharacterId: string;
  /**
   * The source revision to branch from (defaults to the source head). The
   * fork's revision 1 is a copy of this revision's sheet.
   */
  readonly fromRevision?: number;
}

/** Outcome of {@link forkCharacterTimeline}. */
export interface ForkCharacterResult {
  readonly globalCharacterId: string;
  /** The fork's revision 1, carrying source provenance in `parent`. */
  readonly revision: CharacterRevision;
}

/**
 * Fork an alternate timeline from a character into a brand-new
 * `globalCharacterId` — a deliberate, rare operation that **breaks continuity**:
 * the fork and its source are thereafter independent characters with separate
 * histories. Used to play a copy of a character in a second campaign without the
 * two diverging copies silently claiming to be the same continuing identity.
 *
 * Throws {@link CharacterCustodyError} when the source revision does not exist
 * or the target id is already registered (a fork must never overwrite an
 * existing character).
 */
export function forkCharacterTimeline(
  registry: CharacterRegistryStore,
  input: ForkCharacterInput,
): ForkCharacterResult {
  if (registry.headRevision(input.newGlobalCharacterId) !== undefined) {
    throw new CharacterCustodyError(
      `cannot fork onto "${input.newGlobalCharacterId}": that id already has a registry timeline`,
    );
  }
  const fromRevision =
    input.fromRevision ?? registry.headRevision(input.sourceGlobalCharacterId);
  if (fromRevision === undefined) {
    throw new CharacterCustodyError(
      `no registered character "${input.sourceGlobalCharacterId}" to fork from`,
    );
  }
  const source = registry.loadRevision(
    input.sourceGlobalCharacterId,
    fromRevision,
  );
  if (source === undefined) {
    throw new CharacterCustodyError(
      `source revision ${input.sourceGlobalCharacterId}@${fromRevision} does not exist`,
    );
  }

  const revision = registry.appendRevision(
    input.newGlobalCharacterId,
    source.sheet,
    'fork',
    {
      globalCharacterId: input.sourceGlobalCharacterId,
      revision: fromRevision,
    },
  );
  return { globalCharacterId: input.newGlobalCharacterId, revision };
}
