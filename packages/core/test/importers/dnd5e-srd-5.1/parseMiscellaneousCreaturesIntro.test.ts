/**
 * The excerpt is reproduced from the System Reference Document 5.1 by
 * Wizards of the Coast LLC under CC-BY-4.0 and reformatted as extracted lines.
 */

import { describe, expect, it } from 'vitest';
import { parseMiscellaneousCreaturesIntro } from '../../../scripts/importers/dnd5e-srd-5.1/parseMiscellaneousCreaturesIntro.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

describe('parseMiscellaneousCreaturesIntro (eshyra-76b7)', () => {
  it('emits the Appendix MM-A intro prose as a single rule sourced to p366', () => {
    const rule = parseMiscellaneousCreaturesIntro([
      page(366, [
        'This appendix contains statistics for various animals,',
        'vermin, and other critters. The stat blocks are',
        'organized alphabetically by creature name.',
      ]),
    ]);

    expect(rule).toEqual({
      name: 'Appendix MM-A: Miscellaneous Creatures',
      keySlug: 'appendix-mm-a-miscellaneous-creatures',
      sourcePage: 366,
      text: 'This appendix contains statistics for various animals, vermin, and other critters. The stat blocks are organized alphabetically by creature name.',
    });
  });

  it('returns undefined for an empty reduced-fixture slice', () => {
    expect(parseMiscellaneousCreaturesIntro([])).toBeUndefined();
  });
});
