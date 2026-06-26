import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Package-boundary guard (eshyra-4s0r.2).
 *
 * `@eshyra/core` has two import paths and they are NOT interchangeable: the root
 * export (`@eshyra/core`) is the stable public surface; `@eshyra/core/internal`
 * carries no compatibility promise and is for co-developed in-repo callers
 * (tests, evaluation tooling) only. Production CLI code is a real external-style
 * consumer and must depend only on the stable root.
 *
 * This test fails if any production source file under `packages/cli/src` imports
 * `@eshyra/core/internal`. If a CLI feature needs an API that currently lives in
 * `/internal`, promote it to the root export (`packages/core/src/index.ts`)
 * rather than reaching through the unstable subpath. Test/evaluation files under
 * `packages/cli/test` are intentionally NOT covered — they may assert against
 * implementation details via `/internal`.
 */

const CLI_SRC_DIR = join(process.cwd(), 'packages', 'cli', 'src');

// Matches both single- and double-quoted specifiers in static imports,
// `export … from`, and dynamic `import('…')` forms.
const INTERNAL_SPECIFIER = /['"]@eshyra\/core\/internal['"]/;

function listTypeScriptFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTypeScriptFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('package boundary: CLI production code does not import @eshyra/core/internal', () => {
  it('scans some CLI source files (guards against an empty/misrooted glob)', () => {
    expect(listTypeScriptFiles(CLI_SRC_DIR).length).toBeGreaterThan(0);
  });

  it('has no production CLI imports from @eshyra/core/internal', () => {
    const offenders = listTypeScriptFiles(CLI_SRC_DIR)
      .filter((file) => INTERNAL_SPECIFIER.test(readFileSync(file, 'utf8')))
      .map((file) => relative(process.cwd(), file));

    expect(
      offenders,
      `Production CLI files must import only from the stable '@eshyra/core' root, ` +
        `not the unstable '@eshyra/core/internal' subpath. Promote the needed API to ` +
        `packages/core/src/index.ts instead. Offending files:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
