import { describe, expect, it } from 'vitest';
import {
  findOwnershipViolations,
  type OwnershipModule,
  REVIEWED_FOREIGN_DEPENDENCIES,
  readDiscoverySources,
} from './support/discoveryOwnership.js';

/**
 * Permanent evidence for the W11 (`eshyra-o9bd.19.13`) ownership boundary:
 * discovery owns no campaign-rule or ruling schema, store, cache of record,
 * recording tool, active-rule resolver, or supersession/revocation lifecycle
 * (design section 8.4).
 *
 * The structural half lives here. The behavioural half — that discovery
 * retains nothing across queries at one position — is in
 * `campaignRuleConsumption.test.ts`, because a structural check cannot see
 * state that is never declared at module scope.
 *
 * Every rejection case below is run FIRST, against the analyzer itself. A
 * boundary checker whose own rejections are untested is worth what the previous
 * one was worth: it reported green on the PR that introduced
 * `PreflightCampaignRuling`, a discovery-owned ruling schema that happened to
 * use none of the words it banned. The `local-rule-schema` fixture is that
 * exact declaration, replayed.
 */

function fixture(text: string): OwnershipModule[] {
  return [{ path: 'packages/core/src/discovery/fixture.ts', text }];
}

describe('discovery ownership analyzer', () => {
  it('rejects the local ruling schema the previous checker missed', () => {
    const violations = findOwnershipViolations(
      fixture(`
        export interface PreflightCampaignRuling {
          readonly ruleIdentity: string;
          readonly ambiguityId: string;
          readonly selectedInterpretationId: string;
          readonly status: string;
          readonly effectivePosition: string;
          readonly supersededBy: string | null;
          readonly revokedPosition: string | null;
        }
      `),
    );
    expect(violations.map((item) => item.kind)).toEqual(['local-rule-schema']);
    expect(violations[0].detail).toContain('PreflightCampaignRuling');
    expect(violations[0].detail).toContain('selectedInterpretationId');
  });

  it('accepts what discovery is entitled to do', () => {
    // The control that matters as much as the rejections: consuming the
    // jhpt-owned projection, naming a rule in a trace, per-call working state,
    // and immutable module constants must all stay legal, or the checker just
    // forbids discovery from functioning.
    expect(
      findOwnershipViolations(
        fixture(`
          import type { CampaignRulingProjection } from '../campaign/campaignRules.js';
          const MUST_CONSIDER: readonly string[] = ['campaign-rule'];
          export interface JoinTrace {
            readonly placedRules: readonly {
              readonly ruleIdentity: string;
              readonly governingRecordKey: string;
            }[];
            readonly rulings: readonly CampaignRulingProjection[];
          }
          export function join(items: readonly string[]): Set<string> {
            const seen = new Set<string>();
            for (const item of items) seen.add(item);
            return seen;
          }
        `),
      ),
    ).toEqual([]);
  });
});

describe('discovery ownership boundary', () => {
  const modules = readDiscoverySources('packages/core/src/discovery');

  it('scans the complete discovery production surface, recursively', () => {
    expect(modules.length).toBeGreaterThan(0);
    // Recursion is asserted on the walker rather than assumed: today discovery
    // is flat, so a non-recursive reader would look identical here and a later
    // subdirectory would silently leave the boundary unchecked.
    expect(
      readDiscoverySources('packages/core/src').some(({ path }) =>
        path.includes('/campaign/'),
      ),
    ).toBe(true);
  });

  it('owns no rule schema, store, cache, resolver, or lifecycle', () => {
    expect(findOwnershipViolations(modules)).toEqual([]);
  });

  it('consumes the jhpt read vocabulary it is allowed to consume', () => {
    // Positive control for the dependency rule: the seam really is reached, so
    // an empty violation list means a boundary held rather than that discovery
    // never touched jhpt at all.
    expect(
      modules.some(({ text }) =>
        text.includes("from '../campaign/campaignRules.js'"),
      ),
    ).toBe(true);
    expect(
      modules.some(({ text }) => text.includes('CampaignRuleReadSeam')),
    ).toBe(true);
    expect(REVIEWED_FOREIGN_DEPENDENCIES).toContain(
      '../campaign/campaignRules.js',
    );
  });
});
