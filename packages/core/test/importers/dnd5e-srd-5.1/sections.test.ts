/**
 * Tests for the deterministic section slicer.
 *
 * The slicer is the importer's safety boundary: parsers are only correct on
 * narrowed input, and the slicer is what does the narrowing. These tests
 * cover both the success paths and — critically — the fail-closed behavior
 * when an anchor doesn't match.
 */

import { describe, expect, it } from 'vitest';
import {
  SectionNotFoundError,
  SRD_5_1_DEFAULT_SECTION_ANCHORS,
  sliceSection,
} from '../../../scripts/importers/dnd5e-srd-5.1/sections.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

describe('sliceSection — happy path', () => {
  const pages: PageText[] = [
    page(1, ['Intro', 'Some intro text.']),
    page(2, ['Spells', 'Acid Splash', 'Conjuration cantrip']),
    page(3, ['Burning Hands', '1st-level evocation']),
    page(4, ['Monsters', 'Goblin', 'Small humanoid']),
  ];

  it('starts after the heading line and excludes it from the slice', () => {
    const sliced = sliceSection(pages, {
      startHeading: /^Spells$/,
      endHeading: /^Monsters$/,
    });
    // Page 2 in the slice should NOT include the "Spells" heading line.
    expect(sliced[0].lines[0]).toBe('Acid Splash');
  });

  it('stops just before the end heading and excludes it from the slice', () => {
    const sliced = sliceSection(pages, {
      startHeading: /^Spells$/,
      endHeading: /^Monsters$/,
    });
    // The slice should not include the "Monsters" page's content.
    const allLines = sliced.flatMap((p) => p.lines);
    expect(allLines).not.toContain('Monsters');
    expect(allLines).not.toContain('Goblin');
    expect(allLines).not.toContain('Small humanoid');
  });

  it('preserves pageNumber for traceability', () => {
    const sliced = sliceSection(pages, {
      startHeading: /^Spells$/,
      endHeading: /^Monsters$/,
    });
    // Slice spans page 2 (after the heading) and page 3 (whole page).
    expect(sliced.map((p) => p.pageNumber)).toEqual([2, 3]);
  });

  it('carries per-line font heights through the slice, aligned to lines', () => {
    // The rule parser depends on `lineHeights` surviving slicing (loreweaver-yli):
    // buildSlice must re-project the parallel height array to the same window it
    // cuts from `lines`, dropping the start-heading row.
    const withHeights: PageText[] = [
      {
        pageNumber: 2,
        lines: ['Spells', 'Acid Splash', 'Conjuration cantrip'],
        lineHeights: [18, 13.9, 9.8],
      },
      {
        pageNumber: 3,
        lines: ['Monsters', 'Goblin'],
        lineHeights: [25.9, 9.8],
      },
    ];
    const sliced = sliceSection(withHeights, {
      startHeading: /^Spells$/,
      endHeading: /^Monsters$/,
    });
    expect(sliced[0].lines).toEqual(['Acid Splash', 'Conjuration cantrip']);
    expect(sliced[0].lineHeights).toEqual([13.9, 9.8]);
  });

  it('slices to end of document when endHeading is undefined', () => {
    const sliced = sliceSection(pages, {
      startHeading: /^Monsters$/,
    });
    const allLines = sliced.flatMap((p) => p.lines);
    expect(allLines).toContain('Goblin');
    expect(allLines).toContain('Small humanoid');
  });

  it('slices to end of document when endHeading is set but never matches', () => {
    const sliced = sliceSection(pages, {
      startHeading: /^Monsters$/,
      endHeading: /^NoSuchHeading$/,
    });
    const allLines = sliced.flatMap((p) => p.lines);
    expect(allLines).toContain('Goblin');
  });

  it('omits empty pages from the result', () => {
    const padded: PageText[] = [
      page(1, ['Spells']), // heading only — leaves nothing after stripping
      page(2, ['Acid Splash']),
      page(3, ['Monsters', 'Goblin']),
    ];
    const sliced = sliceSection(padded, {
      startHeading: /^Spells$/,
      endHeading: /^Monsters$/,
    });
    // Page 1's only line is the heading; that page should not appear empty
    // in the slice.
    expect(sliced.every((p) => p.lines.length > 0)).toBe(true);
    expect(sliced.map((p) => p.pageNumber)).toEqual([2]);
  });
});

describe('sliceSection — fail-closed behavior', () => {
  it('throws SectionNotFoundError when startHeading does not match', () => {
    const pages: PageText[] = [page(1, ['Hello world'])];
    expect(() =>
      sliceSection(pages, {
        startHeading: /^Spells$/,
        endHeading: /^Monsters$/,
      }),
    ).toThrow(SectionNotFoundError);
  });

  it('error names the unmatched pattern so the caller can fix it', () => {
    const pages: PageText[] = [page(1, ['Hello world'])];
    expect(() =>
      sliceSection(pages, {
        startHeading: /^Spells$/,
      }),
    ).toThrow(/start heading not found.*\/\^Spells\$\//);
  });

  it('matches against trimmed lines, not raw lines', () => {
    const pages: PageText[] = [
      page(1, ['   Spells   ', 'Acid Splash']),
      page(2, ['Monsters', 'Goblin']),
    ];
    const sliced = sliceSection(pages, {
      startHeading: /^Spells$/,
      endHeading: /^Monsters$/,
    });
    expect(sliced[0].lines).toEqual(['Acid Splash']);
  });

  it('throws SectionNotFoundError when requireEndHeading is true and endHeading does not match', () => {
    const pages: PageText[] = [
      page(1, ['Spells', 'Acid Splash', 'Conjuration cantrip']),
    ];
    expect(() =>
      sliceSection(pages, {
        startHeading: /^Spells$/,
        endHeading: /^Monsters$/,
        requireEndHeading: true,
      }),
    ).toThrow(SectionNotFoundError);
  });

  it('end-required error names the unmatched end pattern', () => {
    const pages: PageText[] = [page(1, ['Spells', 'Acid Splash'])];
    expect(() =>
      sliceSection(pages, {
        startHeading: /^Spells$/,
        endHeading: /^Monsters$/,
        requireEndHeading: true,
      }),
    ).toThrow(/end heading not found.*\/\^Monsters\$\//);
  });

  it('preserves slice-to-EOF fallback when requireEndHeading is false and endHeading is unmatched', () => {
    const pages: PageText[] = [
      page(1, ['Spells', 'Acid Splash']),
      page(2, ['Magic Missile']),
    ];
    const sliced = sliceSection(pages, {
      startHeading: /^Spells$/,
      endHeading: /^Monsters$/,
      requireEndHeading: false,
    });
    const allLines = sliced.flatMap((p) => p.lines);
    expect(allLines).toEqual(['Acid Splash', 'Magic Missile']);
  });

  it('preserves slice-to-EOF fallback when requireEndHeading is omitted', () => {
    const pages: PageText[] = [
      page(1, ['Spells', 'Acid Splash']),
      page(2, ['Magic Missile']),
    ];
    const sliced = sliceSection(pages, {
      startHeading: /^Spells$/,
      endHeading: /^Monsters$/,
    });
    const allLines = sliced.flatMap((p) => p.lines);
    expect(allLines).toEqual(['Acid Splash', 'Magic Missile']);
  });
});

describe('SRD_5_1_DEFAULT_SECTION_ANCHORS — sanity', () => {
  it('spell-lists anchor matches "Spell Lists" exactly', () => {
    const anchor = SRD_5_1_DEFAULT_SECTION_ANCHORS.spellLists;
    expect(anchor.startHeading.test('Spell Lists')).toBe(true);
    // Should not false-positive on body prose mentions:
    expect(anchor.startHeading.test('See the Spell Lists chapter')).toBe(false);
  });

  it('spell-descriptions anchor matches either "Spells" or "Spell Descriptions"', () => {
    const anchor = SRD_5_1_DEFAULT_SECTION_ANCHORS.spellDescriptions;
    expect(anchor.startHeading.test('Spells')).toBe(true);
    expect(anchor.startHeading.test('Spell Descriptions')).toBe(true);
  });

  it('spell-lists anchor end-heading matches the spell-descriptions chapter heading', () => {
    const anchor = SRD_5_1_DEFAULT_SECTION_ANCHORS.spellLists;
    expect(anchor.endHeading).toBeDefined();
    if (anchor.endHeading !== undefined) {
      expect(anchor.endHeading.test('Spells')).toBe(true);
      expect(anchor.endHeading.test('Spell Descriptions')).toBe(true);
    }
  });

  it('both default anchors require an end heading (fail-closed on missing chapter boundary)', () => {
    expect(SRD_5_1_DEFAULT_SECTION_ANCHORS.spellLists.requireEndHeading).toBe(
      true,
    );
    expect(
      SRD_5_1_DEFAULT_SECTION_ANCHORS.spellDescriptions.requireEndHeading,
    ).toBe(true);
  });

  it('the hazards anchor also requires an end heading (fail-closed on missing dungeon-hazards boundary)', () => {
    expect(SRD_5_1_DEFAULT_SECTION_ANCHORS.hazards.requireEndHeading).toBe(
      true,
    );
  });

  it('traps anchor matches "Traps", bounds at "Diseases", and fails closed on a missing end (loreweaver-hvp)', () => {
    const anchor = SRD_5_1_DEFAULT_SECTION_ANCHORS.traps;
    expect(anchor.startHeading.test('Traps')).toBe(true);
    // Body-prose mentions must not false-positive on the tight ^...$ anchor.
    expect(anchor.startHeading.test('Find Traps')).toBe(false);
    expect(anchor.startHeading.test('Some traps are deadly')).toBe(false);
    expect(anchor.endHeading?.test('Diseases')).toBe(true);
    expect(anchor.endHeading?.test('Madness')).toBe(true);
    expect(anchor.requireEndHeading).toBe(true);
    expect(anchor.matchHeadings).toBe(true);
  });

  it('madness and objects anchors are exact, heading-scoped, and fail closed at neighboring sections', () => {
    const madness = SRD_5_1_DEFAULT_SECTION_ANCHORS.madness;
    expect(madness.startHeading.test('Madness')).toBe(true);
    expect(madness.startHeading.test('Indefinite Madness')).toBe(false);
    expect(madness.endHeading?.test('Objects')).toBe(true);
    expect(madness.requireEndHeading).toBe(true);
    expect(madness.matchHeadings).toBe(true);

    const objects = SRD_5_1_DEFAULT_SECTION_ANCHORS.objects;
    expect(objects.startHeading.test('Objects')).toBe(true);
    expect(objects.startHeading.test('Statistics for Objects')).toBe(false);
    expect(objects.endHeading?.test('Poisons')).toBe(true);
    expect(objects.requireEndHeading).toBe(true);
    expect(objects.matchHeadings).toBe(true);
  });

  it('core-rules anchor starts at "Using Ability Scores" and requires an end heading', () => {
    const anchor = SRD_5_1_DEFAULT_SECTION_ANCHORS.coreRules;
    expect(anchor.startHeading.test('Using Ability Scores')).toBe(true);
    expect(anchor.requireEndHeading).toBe(true);
  });

  it('combat-actions anchor matches "Actions in Combat" and requires an end heading', () => {
    const anchor = SRD_5_1_DEFAULT_SECTION_ANCHORS.combatActions;
    expect(anchor.startHeading.test('Actions in Combat')).toBe(true);
    expect(anchor.requireEndHeading).toBe(true);
  });

  it('equipment anchor matches "Equipment", bounds at the next subsection, and requires an end heading', () => {
    const anchor = SRD_5_1_DEFAULT_SECTION_ANCHORS.equipment;
    expect(anchor.startHeading.test('Equipment')).toBe(true);
    expect(anchor.endHeading?.test('Mounts and Vehicles')).toBe(true);
    expect(anchor.endHeading?.test('Multiclassing')).toBe(true);
    expect(anchor.endHeading?.test('Adventuring Gear')).toBe(false);
    expect(anchor.requireEndHeading).toBe(true);
  });

  it('unrepresented-prose anchors tightly bound the racial and equipment guidance regions', () => {
    const racialTraits = SRD_5_1_DEFAULT_SECTION_ANCHORS.racialTraits;
    expect(racialTraits.startHeading.test('Racial Traits')).toBe(true);
    expect(racialTraits.endHeading?.test('Dwarf')).toBe(true);
    expect(racialTraits.requireEndHeading).toBe(true);

    const armorGuidance = SRD_5_1_DEFAULT_SECTION_ANCHORS.armorGuidance;
    expect(
      armorGuidance.startHeading.test('Getting Into and Out of Armor'),
    ).toBe(true);
    expect(armorGuidance.endHeading?.test('Weapons')).toBe(true);
    expect(armorGuidance.requireEndHeading).toBe(true);

    const weaponGuidance = SRD_5_1_DEFAULT_SECTION_ANCHORS.weaponGuidance;
    expect(weaponGuidance.startHeading.test('Weapons')).toBe(true);
    expect(weaponGuidance.endHeading?.test('Adventuring Gear')).toBe(true);
    expect(weaponGuidance.requireEndHeading).toBe(true);

    const selfSufficiency = SRD_5_1_DEFAULT_SECTION_ANCHORS.selfSufficiency;
    expect(selfSufficiency.startHeading.test('Self-Sufficiency')).toBe(true);
    expect(selfSufficiency.endHeading?.test('Food, Drink, and Lodging')).toBe(
      true,
    );
    expect(selfSufficiency.requireEndHeading).toBe(true);
  });

  it('treasure-tables anchor matches "Treasure" and requires a magic-item boundary', () => {
    const anchor = SRD_5_1_DEFAULT_SECTION_ANCHORS.treasureTables;
    expect(anchor.startHeading.test('Treasure')).toBe(true);
    expect(anchor.endHeading?.test('Using Magic Items')).toBe(true);
    expect(anchor.endHeading?.test('Using a Magic Item')).toBe(true);
    expect(anchor.endHeading?.test('Magic Items')).toBe(false);
    expect(anchor.requireEndHeading).toBe(true);
  });

  it('magic-items anchor matches "Magic Items A-Z", bounds at "Sentient Magic Items", and fails closed on a missing end', () => {
    const anchor = SRD_5_1_DEFAULT_SECTION_ANCHORS.magicItems;
    expect(anchor.startHeading.test('Magic Items A-Z')).toBe(true);
    expect(anchor.startHeading.test('Magic Items')).toBe(false);
    expect(anchor.endHeading?.test('Sentient Magic Items')).toBe(true);
    expect(anchor.endHeading?.test('Artifacts')).toBe(true);
    expect(anchor.requireEndHeading).toBe(true);
    expect(anchor.matchHeadings).toBe(true);
  });

  it('artifacts anchor matches "Artifacts", bounds at "Monsters", and fails closed on a missing end (eshyra-0m9.16)', () => {
    const anchor = SRD_5_1_DEFAULT_SECTION_ANCHORS.artifacts;
    expect(anchor.startHeading.test('Artifacts')).toBe(true);
    // Body prose mentioning the word should not false-positive.
    expect(anchor.startHeading.test('These are artifacts')).toBe(false);
    expect(anchor.endHeading?.test('Monsters')).toBe(true);
    expect(
      anchor.endHeading?.test('Appendix MM-A: Miscellaneous Creatures'),
    ).toBe(true);
    expect(anchor.requireEndHeading).toBe(true);
    expect(anchor.matchHeadings).toBe(true);
  });

  // Real-PDF chapter mapping (loreweaver-0m9.5.20). The SRD 5.1 PDF has no
  // aggregate "Classes" chapter heading — the races chapter closes at the
  // first per-class chapter title ("Barbarian"), and the classes section
  // spans 12 per-class chapters before the "Beyond 1st Level" chapter.
  it('races anchor accepts both "Barbarian" (real SRD) and "Classes" (fixture) as end-heading', () => {
    const anchor = SRD_5_1_DEFAULT_SECTION_ANCHORS.races;
    expect(anchor.endHeading?.test('Barbarian')).toBe(true);
    expect(anchor.endHeading?.test('Classes')).toBe(true);
    // Body prose mentioning the words should not false-positive.
    expect(anchor.endHeading?.test('A barbarian rages.')).toBe(false);
    expect(anchor.matchHeadings).toBe(true);
  });

  it('classes anchor accepts the real-SRD per-class heading and the fixture aggregate', () => {
    const anchor = SRD_5_1_DEFAULT_SECTION_ANCHORS.classes;
    expect(anchor.startHeading.test('Barbarian')).toBe(true);
    expect(anchor.startHeading.test('Classes')).toBe(true);
    expect(anchor.endHeading?.test('Beyond 1st Level')).toBe(true);
    expect(anchor.endHeading?.test('Using Ability Scores')).toBe(true);
    expect(anchor.matchHeadings).toBe(true);
  });

  it('core-rules anchor end matches both "Spellcasting" (real SRD chapter) and "Spell Lists" (fixture)', () => {
    const anchor = SRD_5_1_DEFAULT_SECTION_ANCHORS.coreRules;
    expect(anchor.endHeading?.test('Spellcasting')).toBe(true);
    expect(anchor.endHeading?.test('Spell Lists')).toBe(true);
    expect(anchor.matchHeadings).toBe(true);
  });

  it('spellcasting-rules anchor matches "Spellcasting", bounds at "Spell Lists", and fails closed on a missing end (loreweaver-3hp)', () => {
    const anchor = SRD_5_1_DEFAULT_SECTION_ANCHORS.spellcastingRules;
    expect(anchor.startHeading.test('Spellcasting')).toBe(true);
    // Body-prose mentions must not false-positive on the tight ^...$ anchor.
    expect(anchor.startHeading.test('Spellcasting Ability')).toBe(false);
    expect(anchor.startHeading.test('A spellcasting class')).toBe(false);
    expect(anchor.endHeading?.test('Spell Lists')).toBe(true);
    expect(anchor.endHeading?.test('Spell Descriptions')).toBe(true);
    expect(anchor.requireEndHeading).toBe(true);
    expect(anchor.matchHeadings).toBe(true);
  });

  it('conditions anchor matches "Appendix PH-A: Conditions" (real SRD) and "Conditions" (fixture)', () => {
    const anchor = SRD_5_1_DEFAULT_SECTION_ANCHORS.conditions;
    expect(anchor.startHeading.test('Appendix PH-A: Conditions')).toBe(true);
    expect(anchor.startHeading.test('Appendix A: Conditions')).toBe(true);
    expect(anchor.startHeading.test('Conditions')).toBe(true);
    expect(anchor.endHeading?.test('Appendix PH-B:')).toBe(true);
    expect(anchor.endHeading?.test('Appendix B:')).toBe(true);
    expect(anchor.matchHeadings).toBe(true);
  });

  // Appendix MM-B: Nonplayer Characters (loreweaver-bn0). The anchor must match
  // only the real appendix heading and is intentionally end-anchorless: MM-B is
  // the SRD's last content section and runs to EOF, with the exact NPC name-set
  // gate failing closed on drift instead of an end heading.
  it('nonplayer-characters anchor matches the MM-B heading and runs to EOF', () => {
    const anchor = SRD_5_1_DEFAULT_SECTION_ANCHORS.nonplayerCharacters;
    expect(
      anchor.startHeading.test('Appendix MM-B: Nonplayer Characters'),
    ).toBe(true);
    // The MM-A misc-creatures heading must NOT match (those are monster
    // creatures parsed by a separate anchor).
    expect(
      anchor.startHeading.test('Appendix MM-A: Miscellaneous Creatures'),
    ).toBe(false);
    // No end heading: the section legitimately slices to EOF.
    expect(anchor.endHeading).toBeUndefined();
    expect(anchor.requireEndHeading).toBeUndefined();
    expect(anchor.matchHeadings).toBe(true);
  });

  it('matchHeadings is set on every implemented-kind chapter anchor', () => {
    const a = SRD_5_1_DEFAULT_SECTION_ANCHORS;
    expect(a.races.matchHeadings).toBe(true);
    expect(a.classes.matchHeadings).toBe(true);
    expect(a.coreRules.matchHeadings).toBe(true);
    expect(a.spellcastingRules.matchHeadings).toBe(true);
    expect(a.spellLists.matchHeadings).toBe(true);
    expect(a.spellDescriptions.matchHeadings).toBe(true);
    expect(a.combatActions.matchHeadings).toBe(true);
    expect(a.monsters.matchHeadings).toBe(true);
    expect(a.nonplayerCharacters.matchHeadings).toBe(true);
    expect(a.conditions.matchHeadings).toBe(true);
    expect(a.feats.matchHeadings).toBe(true);
    expect(a.traps.matchHeadings).toBe(true);
    expect(a.hazards.matchHeadings).toBe(true);
    expect(a.equipment.matchHeadings).toBe(true);
    expect(a.magicItems.matchHeadings).toBe(true);
    expect(a.artifacts.matchHeadings).toBe(true);
    expect(a.multiclassing.matchHeadings).toBe(true);
  });
});

describe('sliceSection — matchHeadings', () => {
  it('skips a body-font occurrence and locks onto the actual heading line when both share text', () => {
    // Two "Equipment" lines on the same page: line 0 is the class-block
    // subsection (body font, NOT in headingLineIndexes), line 2 is the
    // actual chapter title (heading font, IS in headingLineIndexes). The
    // slicer must skip line 0 and start the slice after line 2.
    //
    // Position-based heading matching is what makes this work — a
    // text-only "headings contains 'Equipment'" check would accept line 0
    // because its trimmed text is also "Equipment".
    const pages: PageText[] = [
      {
        pageNumber: 1,
        lines: [
          'Equipment', // body-font class-block subsection
          'You start with the following equipment',
          'Equipment', // actual chapter heading
          'Common coins come in several denominations.',
        ],
        headingLineIndexes: [2],
      },
    ];
    const sliced = sliceSection(pages, {
      startHeading: /^Equipment$/,
      matchHeadings: true,
    });
    // Slice begins AFTER line 2 (the real heading), not after line 0.
    expect(sliced[0].lines).toEqual([
      'Common coins come in several denominations.',
    ]);
  });

  it('matchHeadings: true falls back to line matching when `headingLineIndexes` is undefined (fixture compatibility)', () => {
    const pages: PageText[] = [{ pageNumber: 1, lines: ['Equipment', 'body'] }];
    const sliced = sliceSection(pages, {
      startHeading: /^Equipment$/,
      matchHeadings: true,
    });
    expect(sliced[0].lines).toEqual(['body']);
  });

  it('disambiguates a chapter title from a same-text class subsection across pages', () => {
    // Real-PDF shape: page 8 has body-font "Equipment" as a class-block
    // subsection — present in `lines`, absent from `headingLineIndexes`.
    // Page 62 has the actual h=25.9 "Equipment" chapter title at line 0,
    // which IS in headingLineIndexes. With matchHeadings: true the slicer
    // skips the body occurrence on page 8 entirely and locks onto the
    // chapter heading on page 62.
    const pages: PageText[] = [
      {
        pageNumber: 8,
        lines: ['Barbarian', 'Equipment', 'You start with...'],
        headingLineIndexes: [0],
      },
      {
        pageNumber: 62,
        lines: ['Equipment', 'Common coins come in several denominations.'],
        headingLineIndexes: [0],
      },
    ];
    const sliced = sliceSection(pages, {
      startHeading: /^Equipment$/,
      matchHeadings: true,
    });
    expect(sliced.map((p) => p.pageNumber)).toEqual([62]);
    expect(sliced[0].lines[0]).toBe(
      'Common coins come in several denominations.',
    );
  });

  it('falls through to a real heading on a later page when the start text only appears as body prose earlier', () => {
    // Reverse failure mode of the previous test: a page-level
    // `headingLineIndexes: []` declares "no headings on this page" rather
    // than "no info"; the slicer must NOT match any line on that page and
    // must reach the actual heading on a later page.
    const pages: PageText[] = [
      {
        pageNumber: 1,
        lines: ['Equipment', 'body prose mentioning equipment.'],
        headingLineIndexes: [],
      },
      {
        pageNumber: 2,
        lines: ['Equipment', 'Common coins come in several denominations.'],
        headingLineIndexes: [0],
      },
    ];
    const sliced = sliceSection(pages, {
      startHeading: /^Equipment$/,
      matchHeadings: true,
    });
    expect(sliced.map((p) => p.pageNumber)).toEqual([2]);
  });
});
