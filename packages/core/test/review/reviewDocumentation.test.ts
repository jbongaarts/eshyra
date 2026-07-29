/**
 * Context-budget discipline.
 *
 * The review system is loaded by every future task in this repository, so its
 * recurring context cost is an acceptance criterion, not a nicety. These tests
 * are the enforcement: ceilings on document size, a hard ceiling on the
 * automatically-loaded instruction files, and proof that a `standard` task is
 * never told to read the rules-clause-complete profile.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_SIZE_LIMITS,
  documentSizeViolations,
  ENTRY_POINT_GUIDANCE_LIMIT,
  loadProfileDocument,
  loadProtocolDocument,
} from '../../scripts/review/documents.js';
import { hashDocumentText } from '../../scripts/review/hashing.js';
import {
  POLICY_PATH,
  PROTOCOL_DOC_PATH,
  PROTOCOL_ID,
  profileDocPath,
  profileId,
  REVIEW_PROFILES,
} from '../../scripts/review/profiles.js';

const repoRoot = process.cwd();

function read(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}

function pointerBlock(path: string): string {
  const text = read(path);
  const start = text.indexOf('<!-- BEGIN REVIEW PROTOCOL POINTER -->');
  const end = text.indexOf('<!-- END REVIEW PROTOCOL POINTER -->');
  expect(
    start,
    `${path} must carry a review-protocol pointer block`,
  ).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end + '<!-- END REVIEW PROTOCOL POINTER -->'.length);
}

describe('document sizes', () => {
  it('every review document stays within its ceiling', () => {
    expect(documentSizeViolations(repoRoot)).toEqual([]);
  });

  it('the ceilings are the agreed ones', () => {
    expect(DOCUMENT_SIZE_LIMITS[PROTOCOL_DOC_PATH]).toBe(12000);
    expect(DOCUMENT_SIZE_LIMITS['docs/review/profiles/standard.md']).toBe(4000);
    expect(
      DOCUMENT_SIZE_LIMITS['docs/review/profiles/semantic-system.md'],
    ).toBe(6000);
    expect(
      DOCUMENT_SIZE_LIMITS['docs/review/profiles/rules-clause-complete.md'],
    ).toBe(8000);
  });

  it('every profile has a document and a stable identifier', () => {
    for (const profile of REVIEW_PROFILES) {
      const document = loadProfileDocument(repoRoot, profile);
      expect(document.id).toBe(profileId(profile));
      expect(document.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(document.path).toBe(profileDocPath(profile));
      expect(document.text).toContain(profileId(profile));
    }
  });

  it('the protocol document carries the protocol identifier and a changelog', () => {
    const protocol = loadProtocolDocument(repoRoot);
    expect(protocol.id).toBe(PROTOCOL_ID);
    expect(protocol.text).toContain(PROTOCOL_ID);
    expect(protocol.text).toMatch(/##\s+Changelog/);
  });

  it('document hashes ignore formatting-only edits', () => {
    const text = read(PROTOCOL_DOC_PATH);
    // Trailing whitespace first, then CRLF endings, then extra blank lines.
    const reformatted = `${text.replace(/\n/g, '   \n').replace(/\n/g, '\r\n')}\r\n\r\n\r\n`;
    expect(hashDocumentText(reformatted)).toBe(hashDocumentText(text));
  });
});

describe('automatically-loaded instruction files', () => {
  it.each(['AGENTS.md', 'CLAUDE.md'])(
    '%s adds review guidance within the size ceiling',
    (path) => {
      expect(pointerBlock(path).length).toBeLessThanOrEqual(
        ENTRY_POINT_GUIDANCE_LIMIT,
      );
    },
  );

  it.each(['AGENTS.md', 'CLAUDE.md'])(
    '%s points at review:preflight and the bead contract',
    (path) => {
      const block = pointerBlock(path);
      expect(block).toContain('review:preflight');
      expect(block).toMatch(/REVIEW CONTRACT/);
      expect(block).toMatch(/DESIGN_INVALIDATED/);
      expect(block).toContain(PROTOCOL_DOC_PATH);
    },
  );

  it.each(['AGENTS.md', 'CLAUDE.md'])(
    '%s does not duplicate schemas, markers, hashing rules, or checklists',
    (path) => {
      const block = pointerBlock(path);
      for (const forbidden of [
        'eshyra-review-checkpoint',
        'eshyra-review-contract:v2',
        'checkpointKind',
        'SHA-256',
        'RFC 8785',
        'implementationPermission',
        'reviewedHeadSha',
        'minimum-profile-policy.json',
        '### Semantic-system contract',
      ]) {
        expect(block, `${path} must not restate "${forbidden}"`).not.toContain(
          forbidden,
        );
      }
    },
  );

  it.each(['AGENTS.md', 'CLAUDE.md'])(
    '%s never tells an agent to read all profile documents',
    (path) => {
      const block = pointerBlock(path);
      // Naming one profile document would push a `standard` task to load work
      // it has no business loading.
      expect(block).not.toContain('docs/review/profiles/standard.md');
      expect(block).not.toContain('docs/review/profiles/semantic-system.md');
      expect(block).not.toContain(
        'docs/review/profiles/rules-clause-complete.md',
      );
      // Whitespace-flexible: these files are hard-wrapped.
      expect(block.replace(/\s+/g, ' ')).toMatch(
        /only\W* the profile document it reports as effective/i,
      );
    },
  );
});

describe('separation of concerns between documents', () => {
  it('keeps rules-source evidence out of the common protocol', () => {
    const protocol = read(PROTOCOL_DOC_PATH);
    for (const forbidden of [
      'source obligation',
      'pack representation',
      'Exact membership or bounded scope',
      'provider-neutral reference execution',
    ]) {
      expect(protocol.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('keeps rules-source evidence out of the standard profile', () => {
    const standard = read('docs/review/profiles/standard.md');
    for (const forbidden of [
      'source obligation',
      'rules-pack',
      'generated pack',
      'engine capability',
    ]) {
      expect(standard.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('states the universal lifecycle in the common protocol only', () => {
    const protocol = read(PROTOCOL_DOC_PATH);
    for (const required of [
      'Selecting a profile',
      'Authorization, then implementation review',
      'Freshness',
      'Material contract change',
      'Finding generalization',
      'DESIGN_INVALIDATED',
      'Transition and bootstrap',
      'Profile escalation',
      'Changelog',
    ]) {
      expect(protocol).toContain(required);
    }
  });

  it('puts the rules chain only in the rules-clause-complete profile', () => {
    const rules = read('docs/review/profiles/rules-clause-complete.md');
    expect(rules).toContain('source obligation');
    expect(rules).toContain('engine capability');
    expect(rules).toContain('provider-neutral');
    expect(read('docs/review/profiles/semantic-system.md')).not.toContain(
      'pack representation',
    );
  });
});

describe('policy and command wiring', () => {
  const packageJson = JSON.parse(read('package.json')) as {
    scripts: Record<string, string>;
  };

  it('publishes every documented command as an npm script', () => {
    for (const script of [
      'review:classify',
      'review:preflight',
      'review:handoff',
      'review:checkpoint',
      'review:invalidate',
      'review:ci',
    ]) {
      expect(packageJson.scripts[script]).toContain(
        'packages/core/scripts/review/cli.ts',
      );
    }
  });

  it('keeps the policy at the path the code loads', () => {
    expect(() => JSON.parse(read(POLICY_PATH))).not.toThrow();
  });

  it('is enforced by a CI workflow with a read-only permission model', () => {
    const workflow = read('.github/workflows/review-governance.yml');
    expect(workflow).toContain('review:ci');
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('pull-requests: read');
    // pull_request_target would run untrusted fork code alongside a writable
    // token. The gate is read-only precisely so it never needs one.
    // Named only in the header comment explaining why it is NOT used; it must
    // never appear as an actual trigger.
    expect(workflow).not.toMatch(/^\s*pull_request_target:/m);
    expect(workflow).not.toMatch(/permissions:[\s\S]{0,200}write/);
  });
});
