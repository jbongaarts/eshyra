/**
 * The excerpt is reproduced from the System Reference Document 5.1 by
 * Wizards of the Coast LLC under CC-BY-4.0 and reformatted as extracted lines.
 */

import { describe, expect, it } from 'vitest';
import { parseSelfSufficiency } from '../../../scripts/importers/dnd5e-srd-5.1/parseSelfSufficiency.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

describe('parseSelfSufficiency', () => {
  it('emits the complete bounded sidebar as a rule', () => {
    const rule = parseSelfSufficiency([
      page(73, [
        'The expenses and lifestyles described here assume that you',
        'are spending your time between adventures in town.',
        'Maintaining this kind of lifestyle doesn’t require you to',
        'spend any coin, but it is time-consuming.',
      ]),
    ]);

    expect(rule).toEqual({
      name: 'Self-Sufficiency',
      keySlug: 'self-sufficiency',
      sourcePage: 73,
      text: expect.stringContaining('doesn’t require you to spend any coin'),
    });
  });

  it('returns undefined for an empty reduced-fixture slice', () => {
    expect(parseSelfSufficiency([])).toBeUndefined();
  });
});
