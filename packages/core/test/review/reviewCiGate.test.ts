import { beforeEach, describe, expect, it } from 'vitest';
import { formatCheckpointComment } from '../../scripts/review/checkpointPublication.js';
import { parseCheckpoint } from '../../scripts/review/checkpoints.js';
import { evaluateCiGate } from '../../scripts/review/ciGate.js';
import { runReviewCli } from '../../scripts/review/cli.js';
import { formatInvalidationComment } from '../../scripts/review/invalidation.js';
import { PROTOCOL_DOC_PATH } from '../../scripts/review/profiles.js';
import {
  beadWithContract,
  captureIo,
  FakeBeads,
  FakeGitHub,
  fakePr,
} from './support/reviewFakes.js';

const repoRoot = process.cwd();
const HEAD = '1'.repeat(40);
const NEXT_HEAD = '2'.repeat(40);

let github: FakeGitHub;
let beads: FakeBeads;

async function run(argv: string[]) {
  const io = captureIo();
  const code = await runReviewCli(argv, {
    repoRoot,
    github,
    beads,
    localChangedPaths: () => [],
    stdout: io.stdout,
    stderr: io.stderr,
  });
  return { code, out: io.out(), err: io.err() };
}

async function publishHandoff(kind: string, bead = 'eshyra-test.1') {
  const result = await run([
    'handoff',
    '--bead',
    bead,
    '--pr',
    '900',
    '--kind',
    kind,
  ]);
  expect(result.code).toBe(0);
  const body = (await github.listComments(900)).at(-1)?.body ?? '';
  const json = /```json\n([\s\S]*?)\n```/.exec(body);
  return JSON.parse(json?.[1] ?? '{}') as Record<string, unknown>;
}

async function gate(
  stage: 'implementation' | 'merge-readiness',
  baseHasProtocol = true,
) {
  return evaluateCiGate({
    repoRoot,
    pr: await github.getPullRequest(900),
    comments: await github.listComments(900),
    baseBranchHasProtocol: baseHasProtocol,
    stage,
  });
}

function checkpointComment(
  kind: 'contract-authorization' | 'implementation-review',
  payload: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): string {
  const shared = {
    protocolId: 'eshyra-review-v2',
    protocolHash: payload.protocolHash,
    profileId: payload.profileId,
    profileHash: payload.profileHash,
    policyHash: payload.policyHash,
    effectiveProfile: payload.effectiveProfile,
    contractHash: payload.contractHash,
    reviewerRole: 'independent-primary-reviewer',
    result: 'approved',
    openFindings: 0,
    newDefectClasses: 0,
    materialContractChange: false,
    freshContractReviewRequired: false,
  };
  const specific =
    kind === 'contract-authorization'
      ? {
          checkpointKind: kind,
          reviewedScope: 'full-contract',
          scopeNotes: 'entire contract',
          publicationHeadSha: payload.publicationHeadSha,
          implementationPermission: 'granted',
        }
      : {
          checkpointKind: kind,
          reviewedHeadSha: HEAD,
          reviewMode: 'full',
          freshFullImplementationReviewRequired: false,
          nextPermissibleReviewMode: 'incremental',
          designInvalidated: false,
        };
  return formatCheckpointComment(
    parseCheckpoint(
      { ...shared, ...specific, ...overrides },
      {
        trust: 'production',
      },
    ),
  );
}

beforeEach(() => {
  github = new FakeGitHub();
  beads = new FakeBeads();
  github.baseBranchPaths.add(PROTOCOL_DOC_PATH);
  github.setPullRequest(
    fakePr({
      number: 900,
      headSha: HEAD,
      headRefName: 'eshyra-test.1',
      changedPaths: ['packages/cli/src/index.ts'],
    }),
  );
  beads.set(beadWithContract({ profile: 'standard' }));
});

describe('CI gate: universal requirements', () => {
  it('requires a published handoff on every review-governed PR', async () => {
    const result = await gate('implementation');
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toMatch(
      /No .*handoff has been published/,
    );
  });

  it('passes an in-progress standard PR once a handoff exists', async () => {
    await publishHandoff('implementation-review');
    const result = await gate('implementation');
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.effectiveProfile).toBe('standard');
  });

  it('rejects a design-invalidated PR before evaluating anything else', async () => {
    await publishHandoff('implementation-review');
    github.addComment(
      900,
      formatInvalidationComment({
        invalidatedHeadSha: HEAD,
        owningBead: 'eshyra-test.1',
        effectiveProfile: 'standard',
        reason: 'The design failed, not the diff.',
        newDefectClasses: [],
        successorBead: '',
      }),
    );
    const result = await gate('merge-readiness');
    expect(result.ok).toBe(false);
    expect(result.state).toBe('design-invalidated');
    expect(result.failures.join(' ')).toMatch(/must not be merged/);
  });

  it('re-derives the contract digest and rejects a forged one', async () => {
    await publishHandoff('implementation-review');
    const comment = (await github.listComments(900))[0];
    await github.updateComment(
      comment.id,
      comment.body.replace(
        /"contractHash": "[0-9a-f]{64}"/,
        `"contractHash": "${'e'.repeat(64)}"`,
      ),
    );
    const result = await gate('implementation');
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toMatch(/Malformed contract handoff/);
  });

  it('rejects a handoff published against a different policy', async () => {
    await publishHandoff('implementation-review');
    const comment = (await github.listComments(900))[0];
    await github.updateComment(
      comment.id,
      comment.body.replace(
        /"policyHash": "[0-9a-f]{64}"/,
        `"policyHash": "${'f'.repeat(64)}"`,
      ),
    );
    const result = await gate('implementation');
    expect(result.failures.join(' ')).toMatch(
      /different minimum-profile policy/,
    );
  });

  it('recomputes the minimum from the PR paths, defeating a lowered profile', async () => {
    // The handoff was published while the change was ordinary CLI work.
    await publishHandoff('implementation-review');
    // The branch then grows an importer change without touching the contract.
    github.setPullRequest(
      fakePr({
        number: 900,
        headSha: HEAD,
        headRefName: 'eshyra-test.1',
        changedPaths: [
          'packages/cli/src/index.ts',
          'packages/core/scripts/importers/dnd5e-srd-5.1/cli.ts',
        ],
      }),
    );
    const result = await gate('implementation');
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toMatch(/Under-classified/);
    expect(result.failures.join(' ')).toMatch(/rules-clause-complete/);
  });
});

describe('CI gate: standard profile', () => {
  it('does not require pre-implementation authorization', async () => {
    await publishHandoff('implementation-review');
    const result = await gate('implementation');
    expect(result.ok).toBe(true);
    expect(result.notes.join(' ')).toMatch(
      /Pre-implementation authorization is not required/,
    );
  });

  it('requires an implementation checkpoint at the current head to merge', async () => {
    const payload = await publishHandoff('implementation-review');
    expect((await gate('merge-readiness')).ok).toBe(false);

    github.addComment(900, checkpointComment('implementation-review', payload));
    expect((await gate('merge-readiness')).ok).toBe(true);

    github.setPullRequest(
      fakePr({ number: 900, headSha: NEXT_HEAD, headRefName: 'eshyra-test.1' }),
    );
    const stale = await gate('merge-readiness');
    expect(stale.ok).toBe(false);
    expect(stale.failures.join(' ')).toMatch(/is not the current head/);
  });
});

describe('CI gate: semantic-system and rules-clause-complete', () => {
  beforeEach(() => {
    beads.set(beadWithContract({ profile: 'semantic-system' }));
  });

  it('blocks substantive implementation without an authorization checkpoint', async () => {
    await publishHandoff('contract-authorization');
    const result = await gate('implementation');
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toMatch(
      /Contract authorization is required before substantive implementation/,
    );
  });

  it('permits in-progress work once authorization is granted', async () => {
    const payload = await publishHandoff('contract-authorization');
    github.addComment(
      900,
      checkpointComment('contract-authorization', payload),
    );
    const result = await gate('implementation');
    expect(result.failures).toEqual([]);
    expect(result.state).toBe('authorized-and-in-progress');
  });

  it('does not demand an implementation checkpoint for in-progress pushes', async () => {
    const payload = await publishHandoff('contract-authorization');
    github.addComment(
      900,
      checkpointComment('contract-authorization', payload),
    );
    expect((await gate('implementation')).ok).toBe(true);
    expect((await gate('merge-readiness')).ok).toBe(false);
  });

  it('requires both checkpoints before merge readiness', async () => {
    const authPayload = await publishHandoff('contract-authorization');
    github.addComment(
      900,
      checkpointComment('contract-authorization', authPayload),
    );
    const implPayload = await publishHandoff('implementation-review');
    github.addComment(
      900,
      checkpointComment('implementation-review', implPayload),
    );
    const result = await gate('merge-readiness');
    expect(result.failures).toEqual([]);
    expect(result.state).toBe('implementation-approved');
  });

  it('reports each distinguishable lifecycle state', async () => {
    const payload = await publishHandoff('contract-authorization');
    expect((await gate('implementation')).state).toBe('authorization-pending');

    github.addComment(
      900,
      checkpointComment('contract-authorization', payload),
    );
    expect((await gate('implementation')).state).toBe(
      'authorized-and-in-progress',
    );

    const implPayload = await publishHandoff('implementation-review');
    expect((await gate('implementation')).state).toBe(
      'ready-for-implementation-review',
    );

    github.addComment(
      900,
      checkpointComment('implementation-review', implPayload, {
        result: 'changes-requested',
        openFindings: 2,
      }),
    );
    expect((await gate('implementation')).state).toBe('changes-requested');
  });
});

describe('CI gate: bootstrap exception', () => {
  it('waives only authorization, only for the bootstrap bead and branch', async () => {
    beads.set(
      beadWithContract({
        profile: 'semantic-system',
        beadId: 'eshyra-o9bd.19.1.17',
      }),
    );
    github.setPullRequest(
      fakePr({
        number: 900,
        headSha: HEAD,
        headRefName: 'eshyra-o9bd.19.1.17',
        changedPaths: ['packages/core/scripts/review/cli.ts'],
      }),
    );
    await publishHandoff('contract-authorization', 'eshyra-o9bd.19.1.17');

    const withProtocolOnBase = await gate('implementation', true);
    expect(withProtocolOnBase.ok).toBe(false);
    expect(withProtocolOnBase.failures.join(' ')).toMatch(
      /Contract authorization is required/,
    );

    const bootstrapped = await gate('implementation', false);
    expect(bootstrapped.ok).toBe(true);
    expect(bootstrapped.bootstrap?.applies).toBe(true);
    expect(bootstrapped.notes.join(' ')).toMatch(/BOOTSTRAP EXCEPTION ACTIVE/);
    expect(bootstrapped.notes.join(' ')).toMatch(/not an authorization/i);
    // The waiver never becomes an approval.
    expect(bootstrapped.state).not.toBe('implementation-approved');
  });

  it('still requires implementation review before merge', async () => {
    beads.set(
      beadWithContract({
        profile: 'semantic-system',
        beadId: 'eshyra-o9bd.19.1.17',
      }),
    );
    github.setPullRequest(
      fakePr({
        number: 900,
        headSha: HEAD,
        headRefName: 'eshyra-o9bd.19.1.17',
        changedPaths: ['packages/core/scripts/review/cli.ts'],
      }),
    );
    await publishHandoff('implementation-review', 'eshyra-o9bd.19.1.17');
    const result = await gate('merge-readiness', false);
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toMatch(/Implementation review/);
  });

  it('never applies to another bead on the same branch shape', async () => {
    beads.set(
      beadWithContract({
        profile: 'rules-clause-complete',
        beadId: 'eshyra-o9bd.19.1.14',
      }),
    );
    github.setPullRequest(
      fakePr({
        number: 900,
        headSha: HEAD,
        headRefName: 'eshyra-o9bd.19.1.14',
        changedPaths: ['packages/core/src/rules/types.ts'],
      }),
    );
    await publishHandoff('contract-authorization', 'eshyra-o9bd.19.1.14');
    const result = await gate('implementation', false);
    expect(result.bootstrap?.applies).toBe(false);
    expect(result.ok).toBe(false);
  });
});
