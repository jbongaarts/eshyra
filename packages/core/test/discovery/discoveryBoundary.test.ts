import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  RouteClass as HarnessRouteClass,
  ExpectedStateEffectOperation as HarnessStateEffectOperation,
} from '../../src/internal.js';
import type { ExpectedStateEffectOperation as FixtureStateEffectOperation } from '../diagnostics/fixtureContract.js';
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
const STATE_EFFECT_SHAPES_AGREE: Exact<
  HarnessStateEffectOperation,
  FixtureStateEffectOperation
> = true;

const RUNTIME_ROOTS = [
  'packages/core/src/orchestrator',
  'packages/core/src/state',
  'packages/core/src/session',
  'packages/core/src/campaign',
  'packages/core/src/memory',
];

/**
 * Phase 1 forbade every runtime import of the discovery experiment. W9
 * (`eshyra-o9bd.19.11`, design section 12.2) opens exactly ONE seam: the
 * orchestrator's shadow observation point. Everything else stays closed, and
 * the seam is pinned to the shadow entry point and the shared types rather
 * than to "anything under discovery/", so a later change cannot quietly reach
 * the stage harness, the packet builder, or the campaign-rule join from
 * runtime code.
 *
 * That the seam changes nothing the DM receives is not a structural property
 * and is not asserted here; `shadowRuntime.test.ts` proves it by rendering the
 * DM message with the flag on and off.
 */
const SHADOW_SEAM_FILE = 'packages/core/src/orchestrator/orchestrator.ts';
const SHADOW_SEAM_MODULES: readonly string[] = [
  '../discovery/shadow.js',
  '../discovery/types.js',
];

interface SourceModule {
  readonly path: string;
  readonly text: string;
}

/** Every runtime import of a discovery module that no seam authorizes. */
function unauthorizedDiscoveryImports(
  modules: readonly SourceModule[],
): string[] {
  return modules.flatMap(({ path, text }) =>
    // `from '…'` and a dynamic `import('…')`, so a runtime module cannot
    // reach discovery through a form the static import list never shows.
    [...text.matchAll(/(?:from|import\()\s*'([^']*discovery[^']*)'/gu)]
      .map((match) => match[1])
      .filter(
        (specifier) =>
          path !== SHADOW_SEAM_FILE || !SHADOW_SEAM_MODULES.includes(specifier),
      )
      .map((specifier) => `${path} -> ${specifier}`),
  );
}

function runtimeModules(): SourceModule[] {
  return RUNTIME_ROOTS.flatMap((root) =>
    readdirSync(root)
      .filter((file) => file.endsWith('.ts'))
      .map((file) => ({
        path: `${root}/${file}`,
        text: readFileSync(`${root}/${file}`, 'utf8'),
      })),
  );
}

describe('discovery runtime boundary', () => {
  it('shares one route vocabulary with the fixture contract', () => {
    expect(ROUTE_VOCABULARIES_AGREE).toBe(true);
    expect(STATE_EFFECT_SHAPES_AGREE).toBe(true);
  });

  it('reports a runtime discovery import that no seam authorizes', () => {
    // Run the rejection cases first: a boundary checker whose own rejections
    // are untested is worth nothing, and both shapes below are exactly what a
    // careless later change would look like.
    expect(
      unauthorizedDiscoveryImports([
        {
          path: 'packages/core/src/state/itemState.ts',
          text: "import { x } from '../discovery/shadow.js';",
        },
      ]),
    ).toEqual([
      'packages/core/src/state/itemState.ts -> ../discovery/shadow.js',
    ]);
    expect(
      unauthorizedDiscoveryImports([
        {
          path: SHADOW_SEAM_FILE,
          text: "import { runDiscoveryStages } from '../discovery/harness.js';",
        },
      ]),
    ).toEqual([`${SHADOW_SEAM_FILE} -> ../discovery/harness.js`]);
    expect(
      unauthorizedDiscoveryImports([
        {
          path: 'packages/core/src/memory/turnTrace.ts',
          text: "const m = await import('../discovery/shadow.js');",
        },
      ]),
    ).toEqual([
      'packages/core/src/memory/turnTrace.ts -> ../discovery/shadow.js',
    ]);
    expect(
      unauthorizedDiscoveryImports([
        {
          path: SHADOW_SEAM_FILE,
          text: "import { captureDiscoveryShadow } from '../discovery/shadow.js';",
        },
      ]),
    ).toEqual([]);
  });

  it('is reached from runtime code only through the shadow seam', () => {
    expect(unauthorizedDiscoveryImports(runtimeModules())).toEqual([]);
    // The seam is real, not merely permitted: if the orchestrator ever stops
    // importing it, this whole check would pass vacuously.
    expect(readFileSync(SHADOW_SEAM_FILE, 'utf8')).toContain(
      "from '../discovery/shadow.js'",
    );
  });

  it('is absent from the stable root export', () => {
    expect(readFileSync('packages/core/src/index.ts', 'utf8')).not.toMatch(
      /export[\s\S]*from ['"][^'"]*discovery[^'"]*['"]/iu,
    );
  });
});
