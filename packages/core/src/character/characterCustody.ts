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
 *     holds is refused — release it from the first campaign and its progress
 *     carries forward into the next one.
 *   - **sync-back** — committing a new registry revision from the campaign sheet
 *     when the campaign's copy has changed; the registry head moves forward.
 *   - **release** — sync-back plus dropping custody, so the character is idle
 *     and free to be checked out again. This is the normal way a character moves
 *     between campaigns: one continuing identity whose experiences carry forward.
 *   - **fork** — a deliberate, rare alternate-timeline branch into a *new*
 *     `globalCharacterId`. It is **not** how a character moves between campaigns
 *     (that is release → re-checkout, which preserves continuity); it exists
 *     only for the unusual "parallel what-if copy" case and explicitly breaks
 *     continuity with the source. The model is designed to avoid forking.
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
  CustodyRecord,
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
 * double-attach guard). The fix is to release it from that campaign — its
 * progress carries forward — not to fork; forking is reserved for a deliberate
 * parallel timeline. Re-checking-out into the *same* campaign is allowed and
 * idempotent (resume). A rules-pack mismatch still throws
 * {@link CharacterSheetPackMismatchError} from the underlying attach before any
 * custody is recorded.
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
      `character "${input.globalCharacterId}" is already in active play in campaign "${held.campaignId}" ` +
        `(as ${held.characterId}); exit that campaign to release it — its progress carries forward — before bringing it here`,
    );
  }
  // Same campaign but a different party slot is NOT an idempotent resume: it
  // would attach a second playable copy of one continuing identity inside the
  // same campaign (e.g. via /addpc allocating the next pc-<n>). Only re-checkout
  // into the very same character id is the idempotent resume case.
  if (held !== undefined && held.characterId !== characterId) {
    throw new CharacterCustodyError(
      `character "${input.globalCharacterId}" is already in this campaign as ${held.characterId}; ` +
        'one continuing character cannot occupy two party slots in the same campaign',
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

/** Who is committing a sync-back / release — checked against the custody lock. */
export interface CustodyHolderInput {
  /** The campaign claiming to hold the character. */
  readonly campaignId: string;
  /** The campaign-local character id being synced (e.g. `pc-1`). */
  readonly characterId: string;
}

/**
 * Commit a new registry revision from a campaign's current sheet, if it differs
 * from the registry head. Reads the campaign-local sheet, follows its stamped
 * `globalCharacterId` back to the registry, and appends a `sync-back` revision
 * (skipping the append when the sheet is unchanged, so idle sessions do not
 * spam identical revisions). Custody is left untouched — see
 * {@link releaseCharacterFromCampaign} to also drop the lock.
 *
 * Only the campaign that **holds custody** may sync back. A caller whose
 * `(campaignId, characterId)` does not match the current custody record is not
 * the authority — its campaign sheet is a stale copy — so it no-ops (returns
 * `undefined`) rather than appending a reverting revision over whoever holds the
 * character now. Returns `undefined` likewise when the sheet is not
 * registry-linked.
 */
export function syncBackCharacterFromCampaign(
  registry: CharacterRegistryStore,
  campaignDb: Db,
  input: CustodyHolderInput,
): SyncBackResult | undefined {
  const campaignSheet = createSqliteCharacterSheetStore(campaignDb).load(
    input.characterId,
  );
  const globalCharacterId = campaignSheet?.metadata.globalCharacterId;
  if (campaignSheet === undefined || globalCharacterId === undefined) {
    // The campaign character was never attached from the registry (e.g. created
    // directly in-campaign); there is nothing to sync back.
    return undefined;
  }

  const held = registry.custody(globalCharacterId);
  if (
    held === undefined ||
    held.campaignId !== input.campaignId ||
    held.characterId !== input.characterId
  ) {
    // Not the custody holder: this campaign's sheet is stale. Do not commit a
    // revision (it would clobber the actual holder's continuing timeline).
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
 * the custody model needs.
 *
 * Custody is cleared **only** when this campaign is the holder (sync-back
 * succeeded): a stale campaign releasing must never drop a lock that another
 * campaign now holds. Returns the sync-back outcome, or `undefined` when this
 * campaign is not the holder or the character is not registry-linked.
 */
export function releaseCharacterFromCampaign(
  registry: CharacterRegistryStore,
  campaignDb: Db,
  input: CustodyHolderInput,
): SyncBackResult | undefined {
  const result = syncBackCharacterFromCampaign(registry, campaignDb, input);
  if (result !== undefined) {
    // syncBack returned a result only because this campaign holds custody, so
    // clearing the lock here is safe and targets our own hold.
    registry.clearCustody(result.globalCharacterId);
  }
  return result;
}

/** Outcome of {@link acquireCustodyOnResume} for one campaign character. */
export type ResumeCustodyOutcome =
  /** The campaign sheet is not linked to a registry character; nothing to lock. */
  | 'not-linked'
  /** This campaign already holds custody (e.g. a checkout earlier this run). */
  | 'already-held'
  /** Custody was idle and has been re-acquired for this campaign. */
  | 'acquired';

/** Who is resuming a campaign character — checked against the custody lock. */
export interface ResumeCustodyInput {
  /** The campaign reclaiming custody. */
  readonly campaignId: string;
  /** The campaign-local character id being resumed (e.g. `pc-1`). */
  readonly characterId: string;
}

/**
 * A non-throwing classification of what resuming a campaign character would
 * encounter (ADR 0012, eshyra-lupf.14.4). This is the structured form behind
 * {@link checkCustodyResumable}'s throw/return contract: the conflict-resolution
 * UX needs to *distinguish* the two failure modes (a hard `held-elsewhere` stop
 * vs. a resolvable `stale-copy`) rather than collapse them into one error, so it
 * branches on this discriminated union instead.
 */
export type ResumeClassification =
  /** The campaign sheet is not linked to a registry character; nothing to lock. */
  | { readonly kind: 'not-linked' }
  /** This campaign already holds custody (e.g. a checkout earlier this run). */
  | { readonly kind: 'already-held'; readonly globalCharacterId: string }
  /** Idle and in sync — a real resume would take the lock at this revision. */
  | {
      readonly kind: 'resumable';
      readonly globalCharacterId: string;
      readonly revision: number;
    }
  /**
   * Another campaign is the active writer. A hard stop — `.14.4` keeps this
   * fail-closed; the resolution is to release it from that campaign.
   */
  | {
      readonly kind: 'held-elsewhere';
      readonly globalCharacterId: string;
      readonly heldBy: CustodyRecord;
    }
  /**
   * Idle, but the registry head has advanced past this campaign's copy (the
   * character adventured elsewhere since this campaign last held it). The
   * resolvable conflict: cancel, catch up to head, or fork an alternate
   * timeline.
   */
  | {
      readonly kind: 'stale-copy';
      readonly globalCharacterId: string;
      /** The registry head revision this campaign is behind. */
      readonly headRevision: number;
      /** The revision this campaign's copy was checked out at, if stamped. */
      readonly localRevision: number | undefined;
    };

/**
 * Classify, **without mutating** the registry, what resuming `input.characterId`
 * in `input.campaignId` would encounter (ADR 0012, eshyra-lupf.14.4). Pure
 * read-side decision used both by {@link checkCustodyResumable} (which turns
 * conflicts into throws for the all-or-nothing preflight) and by the CLI
 * conflict-resolution UX (which branches on the `kind`).
 */
export function classifyResumeConflict(
  registry: CharacterRegistryStore,
  campaignDb: Db,
  input: ResumeCustodyInput,
): ResumeClassification {
  const campaignSheet = createSqliteCharacterSheetStore(campaignDb).load(
    input.characterId,
  );
  const globalCharacterId = campaignSheet?.metadata.globalCharacterId;
  if (campaignSheet === undefined || globalCharacterId === undefined) {
    return { kind: 'not-linked' };
  }

  const held = registry.custody(globalCharacterId);
  if (held !== undefined) {
    if (
      held.campaignId === input.campaignId &&
      held.characterId === input.characterId
    ) {
      return { kind: 'already-held', globalCharacterId };
    }
    return { kind: 'held-elsewhere', globalCharacterId, heldBy: held };
  }

  // Idle: detect a copy the character has since outgrown in another campaign
  // (registry head moved past this campaign's stale sheet).
  const head = registry.headRevision(globalCharacterId);
  const headSheet =
    head === undefined ? undefined : registry.load(globalCharacterId);
  if (
    head !== undefined &&
    headSheet !== undefined &&
    !sheetsEqual(headSheet, stripCampaignProvenance(campaignSheet))
  ) {
    return {
      kind: 'stale-copy',
      globalCharacterId,
      headRevision: head,
      localRevision: campaignSheet.metadata.sourceRevision,
    };
  }

  return { kind: 'resumable', globalCharacterId, revision: head ?? 1 };
}

/**
 * Decide what resuming `input.characterId` in `input.campaignId` would do —
 * **without mutating** the registry. Returns the resume outcome
 * (`not-linked` / `already-held` / `acquired`), throwing
 * {@link CharacterCustodyError} on a conflict (held elsewhere, or the registry
 * head has advanced past this campaign's copy). `acquired` means "idle and in
 * sync — a real `acquireCustodyOnResume` call would take the lock".
 *
 * This is the preflight half of an all-or-nothing multi-character activation:
 * callers check every character first, so one conflict aborts before any lock
 * is taken. The conflict-resolution UX (eshyra-lupf.14.4) uses the structured
 * {@link classifyResumeConflict} instead, to offer choices rather than throw.
 */
export function checkCustodyResumable(
  registry: CharacterRegistryStore,
  campaignDb: Db,
  input: ResumeCustodyInput,
): ResumeCustodyOutcome {
  const classification = classifyResumeConflict(registry, campaignDb, input);
  switch (classification.kind) {
    case 'not-linked':
      return 'not-linked';
    case 'already-held':
      return 'already-held';
    case 'resumable':
      return 'acquired';
    case 'held-elsewhere':
      throw new CharacterCustodyError(
        `cannot resume: character "${classification.globalCharacterId}" is currently in active play in campaign ` +
          `"${classification.heldBy.campaignId}" (as ${classification.heldBy.characterId}); exit that campaign before resuming this one`,
      );
    case 'stale-copy':
      throw new CharacterCustodyError(
        `cannot resume: character "${classification.globalCharacterId}" has advanced in another campaign since this one ` +
          'last held it; its registry timeline is ahead of this campaign’s copy',
      );
  }
}

/**
 * Re-establish the custody lock for an already-attached campaign character when
 * a campaign resumes (ADR 0012, eshyra-lupf.14.3).
 *
 * Because the CLI releases custody on `/quit`, a resumed campaign has a
 * registry-linked `character_sheet` but no lock. Resuming must reclaim it so the
 * "exactly one writer at a time" guard holds for the duration of the new
 * session — and must fail closed rather than silently steal or revert a
 * character that has moved on. The decision (and its fail-closed conflicts) is
 * {@link checkCustodyResumable}; this function applies it, taking the lock when
 * the outcome is `acquired`.
 *
 * Unlike checkout this does not re-attach (which would re-project the live row
 * and discard per-turn HP/conditions); it only re-takes the lock. For a
 * multi-character campaign, preflight every character with
 * {@link checkCustodyResumable} before calling this so activation is
 * all-or-nothing and a later conflict cannot leave partial locks behind.
 */
export function acquireCustodyOnResume(
  registry: CharacterRegistryStore,
  campaignDb: Db,
  input: { campaignId: string; characterId: string; at: string },
): ResumeCustodyOutcome {
  const outcome = checkCustodyResumable(registry, campaignDb, input);
  if (outcome !== 'acquired') {
    return outcome;
  }

  // checkCustodyResumable proved the sheet is linked; re-read its global id.
  const globalCharacterId = createSqliteCharacterSheetStore(campaignDb).load(
    input.characterId,
  )?.metadata.globalCharacterId as string;
  const revision =
    registry.headRevision(globalCharacterId) ??
    ensureRevisioned(registry, globalCharacterId) ??
    1;
  registry.setCustody({
    globalCharacterId,
    campaignId: input.campaignId,
    characterId: input.characterId,
    revision,
    attachedAt: input.at,
  });
  return 'acquired';
}

/** What a character catch-up needs and where it lands. */
export interface CatchUpToHeadInput {
  /** The campaign adopting the newer revision (its stable campaign id). */
  readonly campaignId: string;
  /** The campaign-local character id to catch up (e.g. `pc-1`). */
  readonly characterId: string;
  /** Session id recorded on the resulting state mutations. */
  readonly sessionId: string;
  /** ISO-8601 timestamp for custody + attach provenance. */
  readonly at: string;
}

/** Outcome of {@link catchUpCharacterToHead}. */
export interface CatchUpToHeadResult {
  readonly globalCharacterId: string;
  /** The revision the campaign's stale copy was at, if it was stamped. */
  readonly fromRevision: number | undefined;
  /** The registry head revision the campaign was caught up to. */
  readonly toRevision: number;
  /** The re-attach/import outcome (live-row projection, prompt). */
  readonly attach: CompleteCharacterCreationResult;
}

/**
 * Catch a campaign's stale character copy up to the registry head (ADR 0012,
 * eshyra-lupf.14.4): the resolvable resume conflict's primary happy path. When
 * the registry head has advanced past this campaign's copy (the character
 * adventured elsewhere since), this **adopts head wholesale** — it replaces the
 * campaign-local `character_sheet` with the registry head revision, re-stamps
 * provenance (`globalCharacterId` / `sourceRevision = head` / `importedAt`),
 * re-projects the live `character` row, and acquires custody.
 *
 * This is a checkout of the newer revision, **not a merge**: the campaign's own
 * stale mechanical state for that character is discarded in favor of the
 * registry's current truth. It appends **no** new registry revision (it is
 * adopting head, not advancing it).
 *
 * Throws {@link CharacterCustodyError} when the character is not registry-linked,
 * has no registry timeline, or is in active play in another campaign (catch-up
 * cannot run while another campaign holds the write lock — that is the
 * fail-closed `held-elsewhere` conflict, resolved by releasing it there).
 */
export function catchUpCharacterToHead(
  registry: CharacterRegistryStore,
  campaignDb: Db,
  input: CatchUpToHeadInput,
): CatchUpToHeadResult {
  const campaignSheet = createSqliteCharacterSheetStore(campaignDb).load(
    input.characterId,
  );
  const globalCharacterId = campaignSheet?.metadata.globalCharacterId;
  if (campaignSheet === undefined || globalCharacterId === undefined) {
    throw new CharacterCustodyError(
      `cannot catch up "${input.characterId}": it is not linked to a registry character`,
    );
  }

  const held = registry.custody(globalCharacterId);
  if (
    held !== undefined &&
    (held.campaignId !== input.campaignId ||
      held.characterId !== input.characterId)
  ) {
    throw new CharacterCustodyError(
      `cannot catch up character "${globalCharacterId}": it is currently in active play in campaign ` +
        `"${held.campaignId}" (as ${held.characterId}); exit that campaign first`,
    );
  }

  const head = registry.headRevision(globalCharacterId);
  if (head === undefined) {
    throw new CharacterCustodyError(
      `cannot catch up character "${globalCharacterId}": it has no registry timeline`,
    );
  }
  // `head` is the latest revision, so `load` returns that revision's sheet.
  const headSheet = registry.load(globalCharacterId) as CharacterSheet;
  const fromRevision = campaignSheet.metadata.sourceRevision;

  // Re-attach the head sheet over the stale campaign copy: this overwrites the
  // per-campaign sheet and re-projects the live row (adopting head wholesale).
  const attach = attachCharacterSheetToCampaign(campaignDb, {
    sheet: headSheet,
    globalCharacterId,
    sourceRevision: head,
    characterId: input.characterId,
    sessionId: input.sessionId,
    at: input.at,
  });

  // Acquire custody at the adopted revision. No registry revision is appended —
  // catch-up consumes the head, it does not advance it.
  registry.setCustody({
    globalCharacterId,
    campaignId: input.campaignId,
    characterId: input.characterId,
    revision: head,
    attachedAt: input.at,
  });

  return { globalCharacterId, fromRevision, toRevision: head, attach };
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
 * histories. This is explicitly **not** the way to move a character between
 * campaigns — that is release → re-checkout, which keeps one continuing identity
 * whose experiences carry forward. Fork exists only for the unusual "parallel
 * what-if copy" case, and the model is designed to make it rare.
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
