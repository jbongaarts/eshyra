import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BOOTSTRAP_BEAD_ID,
  evaluateBootstrapException,
} from '../../scripts/review/bootstrap.js';
import {
  CheckpointError,
  type ContractAuthorizationCheckpoint,
  type CurrentReviewIdentity,
  evaluateAuthorization,
  evaluateImplementationApproval,
  type ImplementationReviewCheckpoint,
  identityDrift,
  parseCheckpoint,
} from '../../scripts/review/checkpoints.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);
const HEAD = '1'.repeat(40);
const OTHER_HEAD = '2'.repeat(40);

const identity: CurrentReviewIdentity = {
  protocolId: 'eshyra-review-v2',
  protocolHash: HASH_A,
  profileId: 'semantic-system-v1',
  profileHash: HASH_B,
  policyHash: HASH_C,
  effectiveProfile: 'semantic-system',
  contractHash: HASH_D,
};

function authorizationPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    checkpointKind: 'contract-authorization',
    protocolId: 'eshyra-review-v2',
    protocolHash: HASH_A,
    profileId: 'semantic-system-v1',
    profileHash: HASH_B,
    policyHash: HASH_C,
    effectiveProfile: 'semantic-system',
    contractHash: HASH_D,
    reviewedScope: 'full-contract',
    scopeNotes: 'entire contract reviewed',
    publicationHeadSha: HEAD,
    reviewerRole: 'independent-primary-reviewer',
    result: 'approved',
    implementationPermission: 'granted',
    openFindings: 0,
    newDefectClasses: 0,
    materialContractChange: false,
    freshContractReviewRequired: false,
    ...overrides,
  };
}

function implementationPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    checkpointKind: 'implementation-review',
    protocolId: 'eshyra-review-v2',
    protocolHash: HASH_A,
    profileId: 'semantic-system-v1',
    profileHash: HASH_B,
    policyHash: HASH_C,
    effectiveProfile: 'semantic-system',
    contractHash: HASH_D,
    reviewedHeadSha: HEAD,
    reviewMode: 'full',
    reviewerRole: 'independent-primary-reviewer',
    result: 'approved',
    openFindings: 0,
    newDefectClasses: 0,
    materialContractChange: false,
    freshContractReviewRequired: false,
    freshFullImplementationReviewRequired: false,
    nextPermissibleReviewMode: 'incremental',
    designInvalidated: false,
    ...overrides,
  };
}

function parseProduction(payload: unknown) {
  return parseCheckpoint(payload, { trust: 'production' });
}

function rejection(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof CheckpointError) {
      return error.problems.join(' | ');
    }
    throw error;
  }
  throw new Error('Expected a CheckpointError but none was thrown.');
}

describe('checkpoint kind separation', () => {
  it('parses each kind into its own shape', () => {
    const auth = parseProduction(authorizationPayload());
    expect(auth.checkpointKind).toBe('contract-authorization');
    expect(auth).toHaveProperty('implementationPermission', 'granted');

    const impl = parseProduction(implementationPayload());
    expect(impl.checkpointKind).toBe('implementation-review');
    expect(impl).toHaveProperty('reviewedHeadSha', HEAD);
  });

  it('rejects an authorization payload missing its kind-specific fields', () => {
    const payload = authorizationPayload();
    payload.implementationPermission = undefined;
    expect(rejection(() => parseProduction(payload))).toMatch(
      /implementationPermission/,
    );
  });

  it('rejects an implementation payload missing its reviewed head', () => {
    const payload = implementationPayload();
    payload.reviewedHeadSha = undefined;
    expect(rejection(() => parseProduction(payload))).toMatch(
      /reviewedHeadSha/,
    );
  });

  it('rejects an unknown checkpoint kind', () => {
    expect(
      rejection(() =>
        parseProduction(
          authorizationPayload({ checkpointKind: 'vibes-review' }),
        ),
      ),
    ).toMatch(/checkpointKind/);
  });

  it('rejects a truncated digest', () => {
    expect(
      rejection(() =>
        parseProduction(authorizationPayload({ contractHash: 'abc123' })),
      ),
    ).toMatch(/64-hex/);
  });
});

describe('self-contradictory checkpoints', () => {
  it('rejects granted permission on a non-approved result', () => {
    expect(
      rejection(() =>
        parseProduction(
          authorizationPayload({
            result: 'changes-requested',
            implementationPermission: 'granted',
          }),
        ),
      ),
    ).toMatch(/implementationPermission is granted while result/);
  });

  it('rejects granted permission on partial scope', () => {
    expect(
      rejection(() =>
        parseProduction(
          authorizationPayload({
            reviewedScope: 'partial',
            implementationPermission: 'granted',
          }),
        ),
      ),
    ).toMatch(/partial reviewed scope/);
  });

  it('rejects approval alongside a new defect class', () => {
    expect(
      rejection(() =>
        parseProduction(authorizationPayload({ newDefectClasses: 1 })),
      ),
    ).toMatch(/newDefectClasses > 0/);
  });

  it('rejects approval alongside open findings', () => {
    expect(
      rejection(() =>
        parseProduction(implementationPayload({ openFindings: 2 })),
      ),
    ).toMatch(/openFindings > 0/);
  });

  it('rejects approval alongside a material contract change', () => {
    expect(
      rejection(() =>
        parseProduction(authorizationPayload({ materialContractChange: true })),
      ),
    ).toMatch(/materialContractChange is true/);
  });

  it('rejects design invalidation combined with approval', () => {
    expect(
      rejection(() =>
        parseProduction(implementationPayload({ designInvalidated: true })),
      ),
    ).toMatch(/designInvalidated is true/);
  });

  it('forces a new defect class to demand a fresh full review', () => {
    const message = rejection(() =>
      parseProduction(
        implementationPayload({
          result: 'changes-requested',
          openFindings: 3,
          newDefectClasses: 1,
          freshFullImplementationReviewRequired: false,
          nextPermissibleReviewMode: 'incremental',
        }),
      ),
    );
    expect(message).toMatch(/freshFullImplementationReviewRequired is false/);
    expect(message).toMatch(/nextPermissibleReviewMode is incremental/);
  });

  it('accepts the consistent new-defect-class transition', () => {
    const checkpoint = parseProduction(
      implementationPayload({
        result: 'changes-requested',
        openFindings: 3,
        newDefectClasses: 1,
        freshFullImplementationReviewRequired: true,
        nextPermissibleReviewMode: 'full',
      }),
    ) as ImplementationReviewCheckpoint;
    expect(checkpoint.nextPermissibleReviewMode).toBe('full');
  });
});

describe('freshness', () => {
  it('reports no drift when identity matches', () => {
    expect(
      identityDrift(parseProduction(authorizationPayload()), identity),
    ).toEqual([]);
  });

  it.each([
    ['protocolHash', 'protocol document changed'],
    ['profileHash', 'profile document changed'],
    ['policyHash', 'minimum-profile policy changed'],
    ['contractHash', 'normalized contract changed'],
  ])('detects a changed %s', (field, expected) => {
    const drift = identityDrift(
      parseProduction(authorizationPayload({ [field]: 'f'.repeat(64) })),
      identity,
    );
    expect(drift).toContain(expected);
  });

  it('detects a changed effective profile as drift', () => {
    const drift = identityDrift(
      parseProduction(
        authorizationPayload({
          effectiveProfile: 'rules-clause-complete',
          profileId: 'rules-clause-complete-v1',
        }),
      ),
      identity,
    );
    expect(drift.join(' ')).toMatch(/effective profile/);
  });

  it('keeps authorization valid across later implementation commits', () => {
    const checkpoint = parseProduction(
      authorizationPayload(),
    ) as ContractAuthorizationCheckpoint;
    // The authorization was published at HEAD; the branch has moved on.
    expect(evaluateAuthorization(checkpoint, identity, false).valid).toBe(true);
  });

  it('invalidates authorization when the contract changes', () => {
    const checkpoint = parseProduction(
      authorizationPayload({ contractHash: 'f'.repeat(64) }),
    ) as ContractAuthorizationCheckpoint;
    const verdict = evaluateAuthorization(checkpoint, identity, false);
    expect(verdict.valid).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/normalized contract changed/);
  });

  it('invalidates authorization when the policy changes', () => {
    const checkpoint = parseProduction(
      authorizationPayload({ policyHash: 'f'.repeat(64) }),
    ) as ContractAuthorizationCheckpoint;
    expect(
      evaluateAuthorization(checkpoint, identity, false).reasons.join(' '),
    ).toMatch(/minimum-profile policy changed/);
  });

  it('rejects an incomplete-scope authorization', () => {
    // `implementationPermission: denied` keeps the payload internally
    // consistent so the SCOPE rule is what fails, not a contradiction.
    const checkpoint = parseProduction(
      authorizationPayload({
        reviewedScope: 'partial',
        implementationPermission: 'denied',
      }),
    ) as ContractAuthorizationCheckpoint;
    const verdict = evaluateAuthorization(checkpoint, identity, false);
    expect(verdict.valid).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/entire contract/);
  });

  it('invalidates implementation approval on any new commit', () => {
    const checkpoint = parseProduction(
      implementationPayload(),
    ) as ImplementationReviewCheckpoint;
    expect(
      evaluateImplementationApproval(checkpoint, identity, HEAD, false).valid,
    ).toBe(true);
    const stale = evaluateImplementationApproval(
      checkpoint,
      identity,
      OTHER_HEAD,
      false,
    );
    expect(stale.valid).toBe(false);
    expect(stale.reasons.join(' ')).toMatch(/is not the current head/);
  });

  it('refuses approval once a design invalidation exists', () => {
    const auth = parseProduction(
      authorizationPayload(),
    ) as ContractAuthorizationCheckpoint;
    expect(evaluateAuthorization(auth, identity, true).valid).toBe(false);
    const impl = parseProduction(
      implementationPayload(),
    ) as ImplementationReviewCheckpoint;
    expect(
      evaluateImplementationApproval(impl, identity, HEAD, true).valid,
    ).toBe(false);
  });
});

describe('fixture isolation', () => {
  const fixturePath = join(
    process.cwd(),
    'packages/core/test/fixtures/review/fixture-only-contract-authorization.json',
  );
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<
    string,
    unknown
  >;

  it('loads only under a test-fixture trust context', () => {
    const parsed = parseCheckpoint(fixture, { trust: 'test-fixture' });
    expect(parsed.fixtureOnly).toBe(true);
    expect(parsed.reviewerRole.startsWith('fixture-only')).toBe(true);
  });

  it('is rejected outright in production, with no way to opt in', () => {
    expect(rejection(() => parseProduction(fixture))).toMatch(
      /fixture-only.*cannot be loaded in a production context/,
    );
    // The rejection is a property of the payload, not of the environment.
    for (const key of [
      'ESHYRA_ALLOW_FIXTURE_CHECKPOINTS',
      'ESHYRA_REVIEW_FIXTURES',
      'CI',
    ]) {
      process.env[key] = '1';
    }
    try {
      expect(() => parseProduction(fixture)).toThrow(CheckpointError);
    } finally {
      for (const key of [
        'ESHYRA_ALLOW_FIXTURE_CHECKPOINTS',
        'ESHYRA_REVIEW_FIXTURES',
      ]) {
        delete process.env[key];
      }
    }
  });

  it('cannot authorize a real PR, bead, or contract', () => {
    const parsed = parseCheckpoint(fixture, {
      trust: 'test-fixture',
    }) as ContractAuthorizationCheckpoint;
    const verdict = evaluateAuthorization(parsed, identity, false);
    expect(verdict.valid).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/fixture-only/);
  });

  it('taints a payload that merely namespaces one identity string', () => {
    const laundered = authorizationPayload({
      reviewerRole: 'fixture-only-reviewer',
    });
    expect(rejection(() => parseProduction(laundered))).toMatch(
      /namespaced=true/,
    );
  });

  it('rejects a production-shaped checkpoint read from a fixture path', () => {
    expect(
      rejection(() =>
        parseCheckpoint(authorizationPayload(), { trust: 'test-fixture' }),
      ),
    ).toMatch(/must set "fixtureOnly": true/);
  });

  it('requires a visibly namespaced reviewer role on a fixture', () => {
    expect(
      rejection(() =>
        parseCheckpoint(
          { ...fixture, reviewerRole: 'independent-primary-reviewer' },
          { trust: 'test-fixture' },
        ),
      ),
    ).toMatch(/visibly namespaced/);
  });
});

describe('bootstrap exception isolation', () => {
  const base = {
    beadId: BOOTSTRAP_BEAD_ID,
    prHeadRefName: BOOTSTRAP_BEAD_ID,
    baseBranchHasProtocol: false,
    effectiveProfile: 'semantic-system',
  } as const;

  it('applies only when all three conditions hold', () => {
    const decision = evaluateBootstrapException(base);
    expect(decision.applies).toBe(true);
    expect(decision.summary).toMatch(/BOOTSTRAP EXCEPTION ACTIVE/);
    expect(decision.summary).toMatch(/NOT an authorization/);
    expect(decision.conditions).toHaveLength(3);
  });

  it('cannot apply once the protocol exists on the base branch', () => {
    const decision = evaluateBootstrapException({
      ...base,
      baseBranchHasProtocol: true,
    });
    expect(decision.applies).toBe(false);
    expect(decision.summary).toMatch(/base branch lacks/);
  });

  it('cannot apply to any other bead', () => {
    expect(
      evaluateBootstrapException({
        ...base,
        beadId: 'eshyra-o9bd.19.1.14',
        prHeadRefName: 'eshyra-o9bd.19.1.14',
      }).applies,
    ).toBe(false);
  });

  it('cannot apply to another PR branch even for the right bead', () => {
    expect(
      evaluateBootstrapException({
        ...base,
        prHeadRefName: 'eshyra-o9bd.19.1.17-part-2',
      }).applies,
    ).toBe(false);
  });

  it('names the exact bead it is bounded to', () => {
    expect(BOOTSTRAP_BEAD_ID).toBe('eshyra-o9bd.19.1.17');
  });
});
