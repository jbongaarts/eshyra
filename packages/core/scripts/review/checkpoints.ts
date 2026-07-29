/**
 * Reviewer checkpoints: the only artifacts that can authorize implementation
 * or approve an implementation head.
 *
 * Two kinds, deliberately never interchangeable:
 *
 *   contract-authorization — "this CONTRACT may be implemented"
 *   implementation-review  — "this HEAD implements it correctly"
 *
 * The separation is load-bearing. Later implementation commits do NOT
 * invalidate contract authorization while the contract, profile, and policy
 * hashes are unchanged; any new commit DOES invalidate implementation
 * approval. Collapsing the two would either force pointless re-authorization
 * on every push or let an approved head silently cover unreviewed code.
 *
 * Fixture isolation lives here rather than in the loader that happens to need
 * it: a checkpoint is fixture-only if it says so or if any of its identity
 * strings is namespaced `fixture-only`, and production parsing rejects such a
 * checkpoint unconditionally. No environment variable, flag, or path can
 * enable fixture acceptance in production.
 */

import { isReviewProfile, type ReviewProfile } from './profiles.js';

export const FIXTURE_NAMESPACE = 'fixture-only';

export type CheckpointKind = 'contract-authorization' | 'implementation-review';

export type CheckpointResult = 'approved' | 'changes-requested' | 'rejected';

export type ImplementationPermission = 'granted' | 'denied';

export type ReviewedScope = 'full-contract' | 'partial';

export type ReviewMode = 'full' | 'incremental' | 'targeted';

interface CheckpointCommon {
  readonly protocolId: string;
  readonly protocolHash: string;
  readonly profileId: string;
  readonly profileHash: string;
  readonly policyHash: string;
  readonly effectiveProfile: ReviewProfile;
  readonly contractHash: string;
  readonly reviewerRole: string;
  readonly result: CheckpointResult;
  readonly openFindings: number;
  readonly newDefectClasses: number;
  readonly materialContractChange: boolean;
  readonly freshContractReviewRequired: boolean;
  readonly fixtureOnly: boolean;
}

export interface ContractAuthorizationCheckpoint extends CheckpointCommon {
  readonly checkpointKind: 'contract-authorization';
  readonly reviewedScope: ReviewedScope;
  readonly scopeNotes: string;
  readonly publicationHeadSha: string;
  readonly implementationPermission: ImplementationPermission;
}

export interface ImplementationReviewCheckpoint extends CheckpointCommon {
  readonly checkpointKind: 'implementation-review';
  readonly reviewedHeadSha: string;
  readonly reviewMode: ReviewMode;
  readonly freshFullImplementationReviewRequired: boolean;
  readonly nextPermissibleReviewMode: ReviewMode;
  readonly designInvalidated: boolean;
}

export type ReviewCheckpoint =
  | ContractAuthorizationCheckpoint
  | ImplementationReviewCheckpoint;

export class CheckpointError extends Error {
  constructor(
    readonly problems: readonly string[],
    message?: string,
  ) {
    super(
      message ??
        `Checkpoint rejected:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
    this.name = 'CheckpointError';
  }
}

/** Where a checkpoint payload came from. Production never accepts fixtures. */
export type CheckpointTrust = 'production' | 'test-fixture';

const SHA_RE = /^[0-9a-f]{40}$/;
const HASH_RE = /^[0-9a-f]{64}$/;

function requireString(
  raw: Record<string, unknown>,
  key: string,
  problems: string[],
): string {
  const value = raw[key];
  if (typeof value !== 'string' || value.trim() === '') {
    problems.push(`Field "${key}" must be a non-empty string.`);
    return '';
  }
  return value.trim();
}

function requireBoolean(
  raw: Record<string, unknown>,
  key: string,
  problems: string[],
): boolean {
  const value = raw[key];
  if (typeof value !== 'boolean') {
    problems.push(`Field "${key}" must be a boolean.`);
    return false;
  }
  return value;
}

function requireCount(
  raw: Record<string, unknown>,
  key: string,
  problems: string[],
): number {
  const value = raw[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    problems.push(`Field "${key}" must be a non-negative integer.`);
    return 0;
  }
  return value;
}

function requireEnum<T extends string>(
  raw: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  problems: string[],
): T {
  const value = raw[key];
  if (
    typeof value !== 'string' ||
    !(allowed as readonly string[]).includes(value)
  ) {
    problems.push(
      `Field "${key}" must be one of: ${allowed.join(', ')} (got ${JSON.stringify(value)}).`,
    );
    return allowed[0];
  }
  return value as T;
}

/** Any identity string namespaced `fixture-only` taints the whole payload. */
export function payloadMentionsFixture(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.toLowerCase().startsWith(FIXTURE_NAMESPACE);
  }
  if (Array.isArray(value)) {
    return value.some(payloadMentionsFixture);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some(payloadMentionsFixture);
  }
  return false;
}

export interface ParseCheckpointOptions {
  readonly trust: CheckpointTrust;
}

export function parseCheckpoint(
  input: unknown,
  options: ParseCheckpointOptions,
): ReviewCheckpoint {
  const problems: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new CheckpointError(['Checkpoint payload must be a JSON object.']);
  }
  const raw = input as Record<string, unknown>;

  const kind = requireEnum<CheckpointKind>(
    raw,
    'checkpointKind',
    ['contract-authorization', 'implementation-review'],
    problems,
  );

  const declaredFixture = raw.fixtureOnly === true;
  const taintedFixture = payloadMentionsFixture(raw);
  const fixtureOnly = declaredFixture || taintedFixture;

  if (fixtureOnly && options.trust !== 'test-fixture') {
    // Fail before any other diagnosis: a fixture checkpoint must never be
    // reported as "nearly valid" in a production context.
    throw new CheckpointError([
      `Checkpoint is fixture-only (declared=${declaredFixture}, namespaced=${taintedFixture}) and cannot be loaded in a production context. Fixture checkpoints authorize nothing.`,
    ]);
  }
  if (options.trust === 'test-fixture' && !fixtureOnly) {
    throw new CheckpointError([
      `Checkpoint loaded from a test-fixture path must set "fixtureOnly": true and namespace its reviewerRole "${FIXTURE_NAMESPACE}...". A production-shaped checkpoint may not live under a fixture path.`,
    ]);
  }
  if (fixtureOnly) {
    const reviewerRole =
      typeof raw.reviewerRole === 'string' ? raw.reviewerRole : '';
    if (!reviewerRole.toLowerCase().startsWith(FIXTURE_NAMESPACE)) {
      problems.push(
        `Fixture checkpoint reviewerRole must be visibly namespaced "${FIXTURE_NAMESPACE}"; got ${JSON.stringify(reviewerRole)}.`,
      );
    }
  }

  const protocolId = requireString(raw, 'protocolId', problems);
  const protocolHash = requireString(raw, 'protocolHash', problems);
  const profileId = requireString(raw, 'profileId', problems);
  const profileHash = requireString(raw, 'profileHash', problems);
  const policyHash = requireString(raw, 'policyHash', problems);
  const contractHash = requireString(raw, 'contractHash', problems);
  const reviewerRole = requireString(raw, 'reviewerRole', problems);
  const effectiveProfileRaw = requireString(raw, 'effectiveProfile', problems);
  if (effectiveProfileRaw !== '' && !isReviewProfile(effectiveProfileRaw)) {
    problems.push(
      `Field "effectiveProfile" is not a review profile: ${JSON.stringify(effectiveProfileRaw)}.`,
    );
  }
  const effectiveProfile: ReviewProfile = isReviewProfile(effectiveProfileRaw)
    ? effectiveProfileRaw
    : 'standard';

  for (const [key, value] of [
    ['protocolHash', protocolHash],
    ['profileHash', profileHash],
    ['policyHash', policyHash],
    ['contractHash', contractHash],
  ] as const) {
    if (value !== '' && !fixtureOnly && !HASH_RE.test(value)) {
      problems.push(
        `Field "${key}" must be a full 64-hex SHA-256 digest; truncation is display-only.`,
      );
    }
  }

  const result = requireEnum<CheckpointResult>(
    raw,
    'result',
    ['approved', 'changes-requested', 'rejected'],
    problems,
  );
  const openFindings = requireCount(raw, 'openFindings', problems);
  const newDefectClasses = requireCount(raw, 'newDefectClasses', problems);
  const materialContractChange = requireBoolean(
    raw,
    'materialContractChange',
    problems,
  );
  const freshContractReviewRequired = requireBoolean(
    raw,
    'freshContractReviewRequired',
    problems,
  );

  const common: CheckpointCommon = {
    protocolId,
    protocolHash,
    profileId,
    profileHash,
    policyHash,
    effectiveProfile,
    contractHash,
    reviewerRole,
    result,
    openFindings,
    newDefectClasses,
    materialContractChange,
    freshContractReviewRequired,
    fixtureOnly,
  };

  const checkpoint: ReviewCheckpoint =
    kind === 'contract-authorization'
      ? {
          ...common,
          checkpointKind: 'contract-authorization',
          reviewedScope: requireEnum<ReviewedScope>(
            raw,
            'reviewedScope',
            ['full-contract', 'partial'],
            problems,
          ),
          scopeNotes:
            typeof raw.scopeNotes === 'string' ? raw.scopeNotes.trim() : '',
          publicationHeadSha: requireSha(
            raw,
            'publicationHeadSha',
            fixtureOnly,
            problems,
          ),
          implementationPermission: requireEnum<ImplementationPermission>(
            raw,
            'implementationPermission',
            ['granted', 'denied'],
            problems,
          ),
        }
      : {
          ...common,
          checkpointKind: 'implementation-review',
          reviewedHeadSha: requireSha(
            raw,
            'reviewedHeadSha',
            fixtureOnly,
            problems,
          ),
          reviewMode: requireEnum<ReviewMode>(
            raw,
            'reviewMode',
            ['full', 'incremental', 'targeted'],
            problems,
          ),
          freshFullImplementationReviewRequired: requireBoolean(
            raw,
            'freshFullImplementationReviewRequired',
            problems,
          ),
          nextPermissibleReviewMode: requireEnum<ReviewMode>(
            raw,
            'nextPermissibleReviewMode',
            ['full', 'incremental', 'targeted'],
            problems,
          ),
          designInvalidated: requireBoolean(raw, 'designInvalidated', problems),
        };

  problems.push(...contradictionProblems(checkpoint));

  if (problems.length > 0) {
    throw new CheckpointError(problems);
  }
  return checkpoint;
}

function requireSha(
  raw: Record<string, unknown>,
  key: string,
  fixtureOnly: boolean,
  problems: string[],
): string {
  const value = requireString(raw, key, problems);
  if (value !== '' && !fixtureOnly && !SHA_RE.test(value)) {
    problems.push(
      `Field "${key}" must be a full 40-hex commit SHA; got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

/**
 * Internal contradictions a reviewer could publish by accident. These are
 * rejections, not warnings: a checkpoint that both approves and reports a new
 * defect class does not describe a reviewable state.
 */
export function contradictionProblems(checkpoint: ReviewCheckpoint): string[] {
  const problems: string[] = [];
  const approved = checkpoint.result === 'approved';

  if (approved && checkpoint.newDefectClasses > 0) {
    problems.push(
      'Contradiction: result is approved while newDefectClasses > 0. A new defect class after a full review means the design, not the diff, is in question.',
    );
  }
  if (approved && checkpoint.openFindings > 0) {
    problems.push('Contradiction: result is approved while openFindings > 0.');
  }
  if (approved && checkpoint.freshContractReviewRequired) {
    problems.push(
      'Contradiction: result is approved while freshContractReviewRequired is true.',
    );
  }
  if (approved && checkpoint.materialContractChange) {
    problems.push(
      'Contradiction: result is approved while materialContractChange is true. A material contract change requires re-authorization first.',
    );
  }

  if (checkpoint.checkpointKind === 'contract-authorization') {
    if (checkpoint.implementationPermission === 'granted' && !approved) {
      problems.push(
        `Contradiction: implementationPermission is granted while result is ${checkpoint.result}.`,
      );
    }
    if (
      checkpoint.implementationPermission === 'granted' &&
      checkpoint.reviewedScope !== 'full-contract'
    ) {
      problems.push(
        'Contradiction: implementationPermission is granted on a partial reviewed scope. Authorization must cover the entire contract.',
      );
    }
    return problems;
  }

  if (checkpoint.designInvalidated && approved) {
    problems.push(
      'Contradiction: designInvalidated is true while result is approved.',
    );
  }
  if (approved && checkpoint.freshFullImplementationReviewRequired) {
    problems.push(
      'Contradiction: result is approved while freshFullImplementationReviewRequired is true.',
    );
  }
  if (
    checkpoint.newDefectClasses > 0 &&
    !checkpoint.freshFullImplementationReviewRequired
  ) {
    problems.push(
      'Contradiction: newDefectClasses > 0 but freshFullImplementationReviewRequired is false. A new defect class invalidates every prior partial review.',
    );
  }
  if (
    checkpoint.newDefectClasses > 0 &&
    checkpoint.nextPermissibleReviewMode !== 'full'
  ) {
    problems.push(
      `Contradiction: newDefectClasses > 0 but nextPermissibleReviewMode is ${checkpoint.nextPermissibleReviewMode}; it must be full.`,
    );
  }
  return problems;
}

/* -------------------------------------------------------------------------
 * Freshness
 * ---------------------------------------------------------------------- */

export interface CurrentReviewIdentity {
  readonly protocolId: string;
  readonly protocolHash: string;
  readonly profileId: string;
  readonly profileHash: string;
  readonly policyHash: string;
  readonly effectiveProfile: ReviewProfile;
  readonly contractHash: string;
}

/**
 * Identity drift between a published checkpoint and current computed state.
 * Any nonempty result makes the checkpoint STALE — it reviewed something that
 * is no longer what is being asked about.
 */
export function identityDrift(
  checkpoint: ReviewCheckpoint,
  current: CurrentReviewIdentity,
): string[] {
  const drift: string[] = [];
  if (checkpoint.protocolId !== current.protocolId) {
    drift.push(`protocol ${checkpoint.protocolId} -> ${current.protocolId}`);
  }
  if (checkpoint.protocolHash !== current.protocolHash) {
    drift.push('protocol document changed');
  }
  if (checkpoint.profileId !== current.profileId) {
    drift.push(`profile ${checkpoint.profileId} -> ${current.profileId}`);
  }
  if (checkpoint.profileHash !== current.profileHash) {
    drift.push('profile document changed');
  }
  if (checkpoint.policyHash !== current.policyHash) {
    drift.push('minimum-profile policy changed');
  }
  if (checkpoint.effectiveProfile !== current.effectiveProfile) {
    drift.push(
      `effective profile ${checkpoint.effectiveProfile} -> ${current.effectiveProfile}`,
    );
  }
  if (checkpoint.contractHash !== current.contractHash) {
    drift.push('normalized contract changed');
  }
  return drift;
}

export interface AuthorizationVerdict {
  readonly valid: boolean;
  readonly reasons: readonly string[];
}

/**
 * Contract authorization is valid only when every one of these holds. Note
 * what is deliberately absent: the current head SHA. Later implementation
 * commits do not invalidate authorization while the contract and policy
 * hashes are unchanged.
 */
export function evaluateAuthorization(
  checkpoint: ContractAuthorizationCheckpoint,
  current: CurrentReviewIdentity,
  designInvalidated: boolean,
): AuthorizationVerdict {
  const reasons: string[] = [];
  const drift = identityDrift(checkpoint, current);
  if (drift.length > 0) {
    reasons.push(`stale: ${drift.join('; ')}`);
  }
  if (checkpoint.result !== 'approved') {
    reasons.push(`result is ${checkpoint.result}`);
  }
  if (checkpoint.implementationPermission !== 'granted') {
    reasons.push('implementation permission is not granted');
  }
  if (checkpoint.reviewedScope !== 'full-contract') {
    reasons.push('reviewed scope does not cover the entire contract');
  }
  if (checkpoint.fixtureOnly) {
    reasons.push('checkpoint is fixture-only');
  }
  if (designInvalidated) {
    reasons.push('a later design invalidation exists for this PR');
  }
  return { valid: reasons.length === 0, reasons };
}

export function evaluateImplementationApproval(
  checkpoint: ImplementationReviewCheckpoint,
  current: CurrentReviewIdentity,
  currentHeadSha: string,
  designInvalidated: boolean,
): AuthorizationVerdict {
  const reasons: string[] = [];
  const drift = identityDrift(checkpoint, current);
  if (drift.length > 0) {
    reasons.push(`stale: ${drift.join('; ')}`);
  }
  if (checkpoint.reviewedHeadSha !== currentHeadSha) {
    reasons.push(
      `reviewed head ${checkpoint.reviewedHeadSha.slice(0, 12)} is not the current head ${currentHeadSha.slice(0, 12)}`,
    );
  }
  if (checkpoint.result !== 'approved') {
    reasons.push(`result is ${checkpoint.result}`);
  }
  if (checkpoint.designInvalidated || designInvalidated) {
    reasons.push('design invalidated');
  }
  if (checkpoint.fixtureOnly) {
    reasons.push('checkpoint is fixture-only');
  }
  return { valid: reasons.length === 0, reasons };
}
