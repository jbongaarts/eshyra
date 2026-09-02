import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('offline discovery boundary', () => {
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
