import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RouteClass as HarnessRouteClass } from '../../src/internal.js';
import type { RouteClass as FixtureRouteClass } from '../diagnostics/index.js';

/**
 * The harness declares its own `RouteClass` because `src/` cannot import the
 * test-local fixture contract. This assertion fails typecheck if the two
 * vocabularies ever diverge, so the nine ADR 0020 section 6.2 labels stay one
 * set rather than two that drift apart silently.
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const ROUTE_VOCABULARIES_AGREE: Exact<HarnessRouteClass, FixtureRouteClass> =
  true;

describe('offline discovery boundary', () => {
  it('shares one route vocabulary with the fixture contract', () => {
    expect(ROUTE_VOCABULARIES_AGREE).toBe(true);
  });

  it('is not imported by runtime modules and is not in the stable root export', () => {
    const roots = [
      'packages/core/src/orchestrator',
      'packages/core/src/state',
      'packages/core/src/session',
      'packages/core/src/campaign',
      'packages/core/src/memory',
    ];
    const files = roots.flatMap((root) => {
      return readdirSync(root)
        .filter((file) => file.endsWith('.ts'))
        .map((file) => `${root}/${file}`);
    });
    expect(
      files.flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .filter(
            (line) => line.includes('discovery') && line.includes('from '),
          ),
      ),
    ).toEqual([]);
    expect(readFileSync('packages/core/src/index.ts', 'utf8')).not.toMatch(
      /export[\s\S]*from ['"][^'"]*discovery[^'"]*['"]/iu,
    );
  });
});
