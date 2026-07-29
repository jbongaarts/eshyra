import { beforeEach, describe, expect, it } from 'vitest';
import { formatCheckpointComment } from '../../scripts/review/checkpointPublication.js';
import { parseCheckpoint } from '../../scripts/review/checkpoints.js';
import { type ReviewCliDeps, runReviewCli } from '../../scripts/review/cli.js';
import { loadProtocolDocument } from '../../scripts/review/documents.js';
import { formatInvalidationComment } from '../../scripts/review/invalidation.js';
import { loadMinimumProfilePolicy } from '../../scripts/review/policy.js';
import { PREFLIGHT_MAX_DEFAULT_LINES } from '../../scripts/review/report.js';
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
const policyHash = loadMinimumProfilePolicy(repoRoot).policyHash;
const protocolHash = loadProtocolDocument(repoRoot).hash;

let github: FakeGitHub;
let beads: FakeBeads;

function deps(io = captureIo()): ReviewCliDeps & { io: typeof io } {
  return {
    repoRoot,
    github,
    beads,
    localChangedPaths: () => [],
    stdout: io.stdout,
    stderr: io.stderr,
    io,
  };
}

async function run(argv: string[]) {
  const io = captureIo();
  const code = await runReviewCli(argv, deps(io));
  return { code, out: io.out(), err: io.err() };
}

/** Publish a handoff and return the payload the CLI actually wrote. */
async function publishHandoff(kind: string, pr = 900) {
  const result = await run([
    'handoff',
    '--bead',
    'eshyra-test.1',
    '--pr',
    String(pr),
    '--kind',
    kind,
  ]);
  expect(result.code).toBe(0);
  const comments = await github.listComments(pr);
  const body = comments.at(-1)?.body ?? '';
  const json = /```json\n([\s\S]*?)\n```/.exec(body);
  return JSON.parse(json?.[1] ?? '{}') as Record<string, unknown>;
}

function authorizationComment(
  payload: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): string {
  return formatCheckpointComment(
    parseCheckpoint(
      {
        checkpointKind: 'contract-authorization',
        protocolId: 'eshyra-review-v2',
        protocolHash: payload.protocolHash,
        profileId: payload.profileId,
        profileHash: payload.profileHash,
        policyHash: payload.policyHash,
        effectiveProfile: payload.effectiveProfile,
        contractHash: payload.contractHash,
        reviewedScope: 'full-contract',
        scopeNotes: 'entire contract',
        publicationHeadSha: payload.publicationHeadSha,
        reviewerRole: 'independent-primary-reviewer',
        result: 'approved',
        implementationPermission: 'granted',
        openFindings: 0,
        newDefectClasses: 0,
        materialContractChange: false,
        freshContractReviewRequired: false,
        ...overrides,
      },
      { trust: 'production' },
    ),
  );
}

function implementationComment(
  payload: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): string {
  return formatCheckpointComment(
    parseCheckpoint(
      {
        checkpointKind: 'implementation-review',
        protocolId: 'eshyra-review-v2',
        protocolHash: payload.protocolHash,
        profileId: payload.profileId,
        profileHash: payload.profileHash,
        policyHash: payload.policyHash,
        effectiveProfile: payload.effectiveProfile,
        contractHash: payload.contractHash,
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
      },
      { trust: 'production' },
    ),
  );
}

beforeEach(() => {
  github = new FakeGitHub();
  beads = new FakeBeads();
  github.baseBranchPaths.add(
    'docs/review/eshyra-development-and-review-protocol.md',
  );
  github.setPullRequest(
    fakePr({
      number: 900,
      headSha: HEAD,
      changedPaths: ['packages/cli/src/index.ts'],
    }),
  );
  beads.set(beadWithContract({ profile: 'standard' }));
});

describe('review:classify', () => {
  it('reports the three profiles and the policy hash', async () => {
    const { code, out } = await run(['classify', '--bead', 'eshyra-test.1']);
    expect(code).toBe(0);
    expect(out).toMatch(/declared\s+standard/);
    expect(out).toMatch(/path minimum\s+standard/);
    expect(out).toMatch(/characteristic\s+standard/);
    expect(out).toMatch(/effective\s+standard/);
    expect(out).toMatch(
      new RegExp(`policy hash\\s+${policyHash.slice(0, 12)}`),
    );
    expect(out).toMatch(/read\s+docs\/review\/profiles\/standard\.md/);
  });

  it('fails and names the escalation when under-classified', async () => {
    github.setPullRequest(
      fakePr({
        number: 900,
        headSha: HEAD,
        changedPaths: ['packages/core/src/rules/kindSchemas.ts'],
      }),
    );
    const { code, out } = await run([
      'classify',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
    ]);
    expect(code).toBe(1);
    expect(out).toMatch(/UNDER-CLASSIFIED/);
    expect(out).toMatch(/rules-schemas-and-clauses -> rules-clause-complete/);
  });

  it('--json exposes the full classification', async () => {
    const { out } = await run([
      'classify',
      '--bead',
      'eshyra-test.1',
      '--json',
    ]);
    const parsed = JSON.parse(out) as {
      classification: { policyHash: string; effectiveProfile: string };
    };
    expect(parsed.classification.policyHash).toBe(policyHash);
    expect(parsed.classification.effectiveProfile).toBe('standard');
  });
});

describe('review:preflight output discipline', () => {
  it('stays compact by default and names exactly one profile document', async () => {
    const { code, out } = await run([
      'preflight',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
    ]);
    // An in-progress `standard` change with no handoff yet is not an error:
    // nothing is blocked until review readiness is claimed.
    expect(code).toBe(0);
    expect(out).toMatch(/next\s+Continue implementation/);
    const lines = out.trimEnd().split('\n');
    expect(lines.length).toBeLessThan(PREFLIGHT_MAX_DEFAULT_LINES);

    expect(out).toContain('docs/review/profiles/standard.md');
    expect(out).not.toContain('docs/review/profiles/semantic-system.md');
    expect(out).not.toContain('docs/review/profiles/rules-clause-complete.md');
  });

  it('does not print the full contract, policy, or checkpoint history', async () => {
    const { out } = await run([
      'preflight',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
    ]);
    expect(out).not.toContain('Intended outcome');
    expect(out).not.toContain('pathRules');
    expect(out).not.toContain('### Objective and scope');
  });

  it('--verbose expands detail and prints full digests', async () => {
    const { out } = await run([
      'preflight',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
      '--verbose',
    ]);
    expect(out).toContain('contract sections:');
    expect(out).toContain('### Objective and scope');
    expect(out).toContain(protocolHash);
  });

  it('--json exposes complete structured state', async () => {
    const { out } = await run([
      'preflight',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
      '--json',
    ]);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed).toHaveProperty('hashes');
    expect(parsed).toHaveProperty('contract');
    expect(parsed).toHaveProperty('state');
    expect(parsed).toHaveProperty('classification');
    expect(parsed.profileDocument).toBe('docs/review/profiles/standard.md');
  });

  it('recommends only the effective profile when escalated', async () => {
    beads.set(beadWithContract({ profile: 'rules-clause-complete' }));
    const { out } = await run(['preflight', '--bead', 'eshyra-test.1']);
    expect(out).toContain('docs/review/profiles/rules-clause-complete.md');
    expect(out).not.toContain('docs/review/profiles/standard.md');
  });
});

describe('contract handoff comments', () => {
  it('publishes one comment carrying the contract and its identity', async () => {
    const payload = await publishHandoff('implementation-review');
    expect(payload.contractHash).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.publicationHeadSha).toBe(HEAD);

    const body = (await github.listComments(900))[0].body;
    expect(body).toContain('<!-- eshyra-review-contract:v2 -->');
    expect(body).toContain('## REVIEW CONTRACT');
    expect(body).toContain('is authoritative');
    expect(body).toContain('explanatory only');
  });

  it('upserts rather than duplicating, and is idempotent', async () => {
    await publishHandoff('implementation-review');
    expect(await github.listComments(900)).toHaveLength(1);

    const second = await run([
      'handoff',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
      '--kind',
      'implementation-review',
    ]);
    expect(second.code).toBe(0);
    expect(second.out).toMatch(/handoff\s+unchanged/);
    expect(await github.listComments(900)).toHaveLength(1);

    // A changed head produces an update in place, not a second comment.
    github.setPullRequest(fakePr({ number: 900, headSha: NEXT_HEAD }));
    const third = await run([
      'handoff',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
      '--kind',
      'implementation-review',
    ]);
    expect(third.out).toMatch(/handoff\s+updated/);
    expect(await github.listComments(900)).toHaveLength(1);
  });

  it('--dry-run writes nothing', async () => {
    const { code } = await run([
      'handoff',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
      '--kind',
      'implementation-review',
      '--dry-run',
    ]);
    expect(code).toBe(0);
    expect(github.writes).toEqual([]);
    expect(await github.listComments(900)).toHaveLength(0);
  });

  it('does not echo the comment body unless --verbose', async () => {
    const quiet = await run([
      'handoff',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
      '--kind',
      'implementation-review',
      '--dry-run',
    ]);
    expect(quiet.out).not.toContain('## REVIEW CONTRACT');
    const loud = await run([
      'handoff',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
      '--kind',
      'implementation-review',
      '--dry-run',
      '--verbose',
    ]);
    expect(loud.out).toContain('## REVIEW CONTRACT');
  });

  it('reports a superseded duplicate handoff instead of ignoring it', async () => {
    const payload = await publishHandoff('implementation-review');
    // Simulate a second handoff comment appearing out of band.
    const original = (await github.listComments(900))[0].body;
    github.addComment(900, original, '2099-01-01T00:00:00Z');
    const { out } = await run([
      'preflight',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
    ]);
    expect(out).toMatch(/superseded contract handoff/);
    expect(payload.beadId).toBe('eshyra-test.1');
  });

  it('reports a malformed handoff comment instead of treating it as absent', async () => {
    github.addComment(
      900,
      '<!-- eshyra-review-contract:v2 -->\n\nno payload here',
    );
    const { code, out } = await run([
      'preflight',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
    ]);
    expect(code).toBe(1);
    expect(out).toMatch(/Malformed contract handoff/);
  });

  it('rejects a handoff whose published digest does not match its payload', async () => {
    await publishHandoff('implementation-review');
    const comments = await github.listComments(900);
    await github.updateComment(
      comments[0].id,
      comments[0].body.replace(
        /"contractHash": "[0-9a-f]{64}"/,
        `"contractHash": "${'e'.repeat(64)}"`,
      ),
    );
    const { out } = await run([
      'preflight',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
    ]);
    expect(out).toMatch(/Malformed contract handoff/);
  });
});

describe('standard profile: optional authorization', () => {
  it('does not demand authorization', async () => {
    const payload = await publishHandoff('implementation-review');
    const { out } = await run([
      'preflight',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
    ]);
    expect(out).toMatch(/auth\s+optional/);
    expect(out).toMatch(/state\s+ready-for-implementation-review/);
    expect(payload.authorizationRequired).toBe(false);
  });

  it('still requires implementation approval at the current head', async () => {
    const payload = await publishHandoff('implementation-review');
    github.addComment(900, implementationComment(payload));
    const approved = await run([
      'preflight',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
    ]);
    expect(approved.out).toMatch(/state\s+implementation-approved/);

    github.setPullRequest(fakePr({ number: 900, headSha: NEXT_HEAD }));
    const stale = await run([
      'preflight',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
    ]);
    expect(stale.out).not.toMatch(/state\s+implementation-approved/);
    expect(stale.out).toMatch(/is not the current head/);
  });

  it('demands authorization when the contract asks for it', async () => {
    beads.set(beadWithContract({ profile: 'standard', authorization: 'yes' }));
    await publishHandoff('contract-authorization');
    const { code, out } = await run([
      'preflight',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
    ]);
    expect(code).toBe(1);
    expect(out).toMatch(/auth\s+required/);
    expect(out).toMatch(/state\s+authorization-pending/);
  });
});

describe('semantic-system and rules-clause: mandatory authorization', () => {
  it.each(['semantic-system', 'rules-clause-complete'] as const)(
    'blocks %s work until a contract-authorization checkpoint exists',
    async (profile) => {
      beads.set(beadWithContract({ profile }));
      const payload = await publishHandoff('contract-authorization');

      const pending = await run([
        'preflight',
        '--bead',
        'eshyra-test.1',
        '--pr',
        '900',
      ]);
      expect(pending.code).toBe(1);
      expect(pending.out).toMatch(/state\s+authorization-pending/);
      expect(pending.out).toMatch(/Contract authorization is mandatory/);

      github.addComment(900, authorizationComment(payload));
      const authorized = await run([
        'preflight',
        '--bead',
        'eshyra-test.1',
        '--pr',
        '900',
      ]);
      expect(authorized.out).toMatch(/auth\s+required — granted by/);
      expect(authorized.out).toMatch(/state\s+authorized-and-in-progress/);
    },
  );

  it('keeps authorization valid across later commits', async () => {
    beads.set(beadWithContract({ profile: 'semantic-system' }));
    const payload = await publishHandoff('contract-authorization');
    github.addComment(900, authorizationComment(payload));

    github.setPullRequest(fakePr({ number: 900, headSha: NEXT_HEAD }));
    const { out } = await run([
      'preflight',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
    ]);
    expect(out).toMatch(/auth\s+required — granted by/);
  });

  it('invalidates authorization when the contract is edited', async () => {
    beads.set(beadWithContract({ profile: 'semantic-system' }));
    const payload = await publishHandoff('contract-authorization');
    github.addComment(900, authorizationComment(payload));

    beads.set(
      beadWithContract({
        profile: 'semantic-system',
        characteristics: 'persisted-state-change',
      }),
    );
    const { code, out } = await run([
      'preflight',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
    ]);
    expect(code).toBe(1);
    expect(out).toMatch(/normalized contract changed/);
  });
});

describe('design invalidation is terminal', () => {
  const invalidationBody = formatInvalidationComment({
    invalidatedHeadSha: HEAD,
    owningBead: 'eshyra-test.1',
    effectiveProfile: 'standard',
    reason: 'Repeated rounds produced new defect classes.',
    newDefectClasses: ['fail-open on unresolved lookup'],
    successorBead: 'eshyra-test.2',
  });

  it('reports the terminal state and refuses readiness', async () => {
    const payload = await publishHandoff('implementation-review');
    github.addComment(900, implementationComment(payload));
    github.addComment(900, invalidationBody);

    const { code, out } = await run([
      'preflight',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
    ]);
    expect(code).toBe(1);
    expect(out).toMatch(/state\s+design-invalidated/);
    expect(out).toMatch(/Stop work/);
  });

  it('overrides an existing approval checkpoint', async () => {
    const payload = await publishHandoff('implementation-review');
    github.addComment(900, implementationComment(payload));
    github.addComment(900, invalidationBody);
    const { out } = await run([
      'preflight',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
      '--json',
    ]);
    const parsed = JSON.parse(out) as {
      state: {
        implementationApproved: boolean;
        mergeReadiness: { ready: boolean };
      };
    };
    expect(parsed.state.implementationApproved).toBe(false);
    expect(parsed.state.mergeReadiness.ready).toBe(false);
  });

  it('refuses a new handoff', async () => {
    github.addComment(900, invalidationBody);
    const { code, err } = await run([
      'handoff',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
      '--kind',
      'implementation-review',
    ]);
    expect(code).toBe(1);
    expect(err).toMatch(/DESIGN_INVALIDATED/);
    expect(github.writes).toEqual([]);
  });

  it('refuses a later approval checkpoint', async () => {
    const payload = await publishHandoff('implementation-review');
    github.addComment(900, invalidationBody);
    const file = `${repoRoot}/packages/core/test/fixtures/review/.tmp-checkpoint.json`;
    const { writeFileSync, rmSync } = await import('node:fs');
    writeFileSync(
      file,
      JSON.stringify({
        checkpointKind: 'implementation-review',
        protocolId: 'eshyra-review-v2',
        protocolHash: payload.protocolHash,
        profileId: payload.profileId,
        profileHash: payload.profileHash,
        policyHash: payload.policyHash,
        effectiveProfile: payload.effectiveProfile,
        contractHash: payload.contractHash,
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
      }),
    );
    try {
      const { code, err } = await run([
        'checkpoint',
        '--pr',
        '900',
        '--input',
        file,
      ]);
      expect(code).toBe(1);
      expect(err).toMatch(/DESIGN_INVALIDATED/);
    } finally {
      rmSync(file, { force: true });
    }
  });

  it('treats the real PR #475 stop-work comment as terminal', async () => {
    // Regression fixture: the historical marker predates the machine payload
    // entirely. #475, #476, and #477 are never reopened; they exist here only
    // as evidence that a pre-protocol invalidation still stops the gate.
    const { readFileSync } = await import('node:fs');
    github.addComment(
      900,
      readFileSync(
        `${repoRoot}/packages/core/test/fixtures/review/pr-475-design-invalidated.md`,
        'utf8',
      ),
    );
    const { code, out } = await run([
      'preflight',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
    ]);
    expect(code).toBe(1);
    expect(out).toMatch(/state\s+design-invalidated/);
  });

  it('is detected even when the machine payload is unreadable', async () => {
    // PRs #475-#477 carry the marker with no machine payload at all. A parse
    // failure must never downgrade a terminal state to "absent".
    github.addComment(
      900,
      '<!-- eshyra-design-invalidated:v1 -->\n\n# STOP WORK\n\nprose only',
    );
    const { code, out } = await run([
      'preflight',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
    ]);
    expect(code).toBe(1);
    expect(out).toMatch(/state\s+design-invalidated/);
  });
});

describe('review:invalidate', () => {
  it('publishes the record and mutates nothing else', async () => {
    const { code, out } = await run([
      'invalidate',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
      '--successor',
      'eshyra-test.2',
      '--reason',
      'Design failed, not the diff.',
    ]);
    expect(code).toBe(0);
    expect(out).toMatch(/were NOT mutated/);
    const body = (await github.listComments(900)).at(-1)?.body ?? '';
    expect(body).toContain('<!-- eshyra-design-invalidated:v1 -->');
    expect(body).toContain('must not be merged');
    expect(body).toContain('eshyra-test.2');
    expect(github.writes).toEqual(['create:900']);
  });

  it('requires a stated reason', async () => {
    const { code, err } = await run([
      'invalidate',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
    ]);
    expect(code).toBe(2);
    expect(err).toMatch(/--reason/);
  });
});

describe('checkpoint comment compactness', () => {
  it('carries no protocol restatement and no normalized contract', () => {
    const body = formatCheckpointComment(
      parseCheckpoint(
        {
          checkpointKind: 'contract-authorization',
          protocolId: 'eshyra-review-v2',
          protocolHash: 'a'.repeat(64),
          profileId: 'semantic-system-v1',
          profileHash: 'b'.repeat(64),
          policyHash: 'c'.repeat(64),
          effectiveProfile: 'semantic-system',
          contractHash: 'd'.repeat(64),
          reviewedScope: 'full-contract',
          scopeNotes: '',
          publicationHeadSha: HEAD,
          reviewerRole: 'independent-primary-reviewer',
          result: 'approved',
          implementationPermission: 'granted',
          openFindings: 0,
          newDefectClasses: 0,
          materialContractChange: false,
          freshContractReviewRequired: false,
        },
        { trust: 'production' },
      ),
    );
    expect(body).not.toContain('## REVIEW CONTRACT');
    expect(body).not.toContain('Intended outcome');
    expect(body).not.toContain('Objective and scope');
    // The human-readable part stays small; the machine payload is the bulk.
    const humanPart = body.slice(0, body.indexOf('```json'));
    expect(humanPart.split('\n').length).toBeLessThan(25);
  });
});

describe('malformed and unsupported comments', () => {
  it('reports a malformed checkpoint rather than skipping it', async () => {
    await publishHandoff('implementation-review');
    github.addComment(
      900,
      '<!-- eshyra-review-checkpoint:v2 -->\n\n```json\n{"checkpointKind":"implementation-review"}\n```',
    );
    const { code, out } = await run([
      'preflight',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
    ]);
    expect(code).toBe(1);
    expect(out).toMatch(/Malformed checkpoint comment/);
  });

  it('errors on an unsupported marker version rather than ignoring it', async () => {
    await publishHandoff('implementation-review');
    github.addComment(900, '<!-- eshyra-review-checkpoint:v9 -->\n\nfuture');
    const { code, err, out } = await run([
      'preflight',
      '--bead',
      'eshyra-test.1',
      '--pr',
      '900',
    ]);
    expect(code).not.toBe(0);
    expect(`${out}${err}`).toMatch(/unsupported marker version/);
  });
});
