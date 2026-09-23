/**
 * Race / ancestry-parser unit tests for the D&D 5e SRD 5.1 importer.
 *
 * Race text excerpts in this file are reproduced from the System Reference
 * Document 5.1 by Wizards of the Coast LLC, available under the Creative
 * Commons Attribution 4.0 International License (CC-BY-4.0). Excerpts are used
 * as parser test input; no modification has been made beyond reformatting to
 * match the importer's extracted-line input shape.
 *
 * Subrace decision under test (loreweaver-0m9.5.6): parents and subraces are
 * separate records, and each subrace record is flattened/self-contained.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractPdfText } from '../../../scripts/importers/dnd5e-srd-5.1/extract.js';
import { EXPECTED_SRD_5_1_ANCESTRY_NAMES } from '../../../scripts/importers/dnd5e-srd-5.1/index.js';
import { parseAncestries } from '../../../scripts/importers/dnd5e-srd-5.1/parseAncestries.js';
import {
  SRD_5_1_DEFAULT_SECTION_ANCHORS,
  sliceSection,
} from '../../../scripts/importers/dnd5e-srd-5.1/sections.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

// ---------------------------------------------------------------------------
// Dwarf (a race WITH subraces) + Hill Dwarf / Mountain Dwarf (subraces).
// ---------------------------------------------------------------------------

const DWARF_PAGE = page(18, [
  'Dwarf',
  'Bold and hardy, dwarves are known as skilled warriors, miners, and workers of stone and metal.',
  'Dwarf Traits',
  'Your dwarf character has an assortment of inborn abilities, part and parcel of dwarven nature.',
  'Ability Score Increase. Your Constitution score increases by 2.',
  "Age. Dwarves mature at the same rate as humans, but they're considered young until they reach the age of 50. On average, they live about 350 years.",
  'Alignment. Most dwarves are lawful, believing firmly in the benefits of a well-ordered society.',
  'Size. Dwarves stand between 4 and 5 feet tall and average about 150 pounds. Your size is Medium.',
  'Speed. Your base walking speed is 25 feet. Your speed is not reduced by wearing heavy armor.',
  'Darkvision. Accustomed to life underground, you have superior vision in dark and dim conditions.',
  'Dwarven Resilience. You have advantage on saving throws against poison, and you have resistance against poison damage.',
  'Dwarven Combat Training. You have proficiency with the battleaxe, handaxe, light hammer, and warhammer.',
  'Languages. You can speak, read, and write Common and Dwarvish.',
  'Subrace. Two main subraces of dwarves populate the worlds of D&D: hill dwarves and mountain dwarves. Choose one of these subraces.',
  'Hill Dwarf',
  'As a hill dwarf, you have keen senses, deep intuition, and remarkable resilience.',
  'Ability Score Increase. Your Wisdom score increases by 1.',
  'Dwarven Toughness. Your hit point maximum increases by 1, and it increases by 1 every time you gain a level.',
  'Mountain Dwarf',
  "As a mountain dwarf, you're strong and hardy, accustomed to a difficult life in rugged terrain.",
  'Ability Score Increase. Your Strength score increases by 2.',
  'Dwarven Armor Training. You have proficiency with light and medium armor.',
]);

// ---------------------------------------------------------------------------
// Human (a race with NO subraces).
// ---------------------------------------------------------------------------

const HUMAN_PAGE = page(31, [
  'Human',
  'In the reckonings of most worlds, humans are the youngest of the common races.',
  'Human Traits',
  "It's hard to make generalizations about humans, but your human character has these traits.",
  'Ability Score Increase. Your ability scores each increase by 1.',
  'Age. Humans reach adulthood in their late teens and live less than a century.',
  'Alignment. Humans tend toward no particular alignment. The best and the worst are found among them.',
  'Size. Humans vary widely in height and build, from barely 5 feet to well over 6 feet tall. Your size is Medium.',
  'Speed. Your base walking speed is 30 feet.',
  'Languages. You can speak, read, and write Common and one extra language of your choice.',
]);

describe('parseAncestries — Dwarf with subraces + Human without', () => {
  const results = parseAncestries([DWARF_PAGE, HUMAN_PAGE]);

  it('emits one record per race AND per subrace', () => {
    const names = results.map((r) => r.name);
    expect(names).toEqual(['Dwarf', 'Hill Dwarf', 'Human', 'Mountain Dwarf']);
  });

  // --- race with subraces ---
  describe('Dwarf (race with subraces)', () => {
    const dwarf = results.find((r) => r.name === 'Dwarf');

    it('lists its subraces in document order', () => {
      expect(dwarf?.subraces).toEqual(['Hill Dwarf', 'Mountain Dwarf']);
    });

    it('is not itself a subrace', () => {
      expect(dwarf?.subraceOf).toBeUndefined();
    });

    it('captures ability score increase, age, alignment, size, speed, languages, and racial traits', () => {
      const labels = dwarf?.traits.map((t) => t.name) ?? [];
      expect(labels).toEqual(
        expect.arrayContaining([
          'Ability Score Increase',
          'Age',
          'Alignment',
          'Size',
          'Speed',
          'Languages',
          'Darkvision',
          'Dwarven Resilience',
          'Dwarven Combat Training',
          'Subrace',
        ]),
      );
    });

    it('normalizes size and speed convenience fields', () => {
      expect(dwarf?.size).toBe('Medium');
      expect(dwarf?.speed).toBe(25);
    });

    it('puts flavor text in description, not the "Dwarf Traits" header or trait lines', () => {
      expect(dwarf?.description).toMatch(/Bold and hardy/);
      expect(dwarf?.description).not.toMatch(/Dwarf Traits/);
      expect(dwarf?.description).not.toMatch(/Ability Score Increase/);
    });

    it('records the source page', () => {
      expect(dwarf?.sourcePage).toBe(18);
    });
  });

  // --- subrace record ---
  describe('Hill Dwarf (subrace, flattened)', () => {
    const hill = results.find((r) => r.name === 'Hill Dwarf');

    it('points back to its parent race', () => {
      expect(hill?.subraceOf).toBe('Dwarf');
    });

    it('does not declare its own subraces', () => {
      expect(hill?.subraces).toBeUndefined();
    });

    it('is self-contained: inherits the parent racial traits', () => {
      const labels = hill?.traits.map((t) => t.name) ?? [];
      expect(labels).toEqual(
        expect.arrayContaining([
          'Darkvision',
          'Dwarven Resilience',
          'Dwarven Combat Training',
          'Languages',
        ]),
      );
    });

    it('includes its own subrace traits', () => {
      const toughness = hill?.traits.find(
        (t) => t.name === 'Dwarven Toughness',
      );
      expect(toughness?.text).toMatch(/hit point maximum increases by 1/);
    });

    // The SRD prints Hill Dwarf's ability-score-increase sentence in two
    // separate sections: the shared Dwarf block ("...Constitution...") and
    // the Hill Dwarf subrace block ("...Wisdom..."). Flattening keeps both as
    // distinct verbatim entries — parent first, then subrace, in document
    // order — rather than composing one joined sentence the source never
    // prints as a single span (eshyra-o9bd.19.2.1.3.1; this replaces the
    // prior "merges into one trait" expectation, which the source prose
    // proves wrong).
    it('keeps the parent and subrace ability score increase as two separate verbatim traits, in document order', () => {
      const asi = hill?.traits.filter(
        (t) => t.name === 'Ability Score Increase',
      );
      expect(asi).toHaveLength(2);
      expect(asi?.[0].text).toBe('Your Constitution score increases by 2.');
      expect(asi?.[1].text).toBe('Your Wisdom score increases by 1.');
    });

    it('drops the parent-only "Subrace" pointer trait from the flattened set', () => {
      const labels = hill?.traits.map((t) => t.name) ?? [];
      expect(labels).not.toContain('Subrace');
    });

    it('inherits size and speed from the parent', () => {
      expect(hill?.size).toBe('Medium');
      expect(hill?.speed).toBe(25);
    });

    it('uses its own flavor text for the description', () => {
      expect(hill?.description).toMatch(/As a hill dwarf/);
    });
  });

  describe('Mountain Dwarf (subrace, flattened)', () => {
    const mountain = results.find((r) => r.name === 'Mountain Dwarf');

    it('keeps its own +2 Strength as a separate trait from the inherited +2 Constitution', () => {
      const asi = mountain?.traits.filter(
        (t) => t.name === 'Ability Score Increase',
      );
      expect(asi).toHaveLength(2);
      expect(asi?.[0].text).toBe('Your Constitution score increases by 2.');
      expect(asi?.[1].text).toBe('Your Strength score increases by 2.');
    });

    it('includes its own Dwarven Armor Training trait', () => {
      const labels = mountain?.traits.map((t) => t.name) ?? [];
      expect(labels).toContain('Dwarven Armor Training');
    });
  });

  // --- race without subraces ---
  describe('Human (race without subraces)', () => {
    const human = results.find((r) => r.name === 'Human');

    it('leaves subraces undefined', () => {
      expect(human?.subraces).toBeUndefined();
    });

    it('is not a subrace', () => {
      expect(human?.subraceOf).toBeUndefined();
    });

    it('captures the core trait labels', () => {
      const labels = human?.traits.map((t) => t.name) ?? [];
      expect(labels).toEqual(
        expect.arrayContaining([
          'Ability Score Increase',
          'Age',
          'Alignment',
          'Size',
          'Speed',
          'Languages',
        ]),
      );
    });

    it('does not bleed Dwarf traits into Human', () => {
      const labels = human?.traits.map((t) => t.name) ?? [];
      expect(labels).not.toContain('Darkvision');
      expect(labels).not.toContain('Dwarven Resilience');
    });

    it('normalizes size and speed', () => {
      expect(human?.size).toBe('Medium');
      expect(human?.speed).toBe(30);
    });

    it('records its own source page', () => {
      expect(human?.sourcePage).toBe(31);
    });
  });
});

// ---------------------------------------------------------------------------
// Line-wrap fragments and interleaved table bleed (eshyra-0m9.15).
//
// In the real SRD PDF, trait prose wraps across extracted lines. The Languages
// trait wraps so that "Common and <Language>. <more prose>" lands on its own
// line, and the Dragonborn block interleaves the Draconic Ancestry breath-weapon
// table between the Speed and Draconic Ancestry traits. Both produced bogus
// trait records pre-fix: a continuation line shaped like "Label. body" was
// promoted to a trait, and the table rows bled into the Speed trait body. These
// fixtures reproduce that wrap/interleave shape line-for-line.
// ---------------------------------------------------------------------------

describe('parseAncestries — wrapped Languages line does not split into a bogus trait', () => {
  // The Languages prose wraps exactly as the SRD PDF extracts it: the label
  // line ends with "…read, and write", and "Common and Dwarvish. <prose>"
  // continues on the next line.
  const results = parseAncestries([
    page(18, [
      'Dwarf',
      'Bold and hardy, dwarves are known as skilled warriors.',
      'Dwarf Traits',
      'Your dwarf character has an assortment of inborn abilities.',
      'Ability Score Increase. Your Constitution score increases by 2.',
      'Speed. Your base walking speed is 25 feet.',
      'Languages. You can speak, read, and write',
      'Common and Dwarvish. Dwarvish is full of hard consonants and',
      'guttural sounds, and those characteristics spill over into',
      'whatever other language a dwarf might speak.',
    ]),
  ]);
  const dwarf = results.find((r) => r.name === 'Dwarf');

  it('keeps a single Languages trait with the wrapped body reflowed in', () => {
    const languages = dwarf?.traits.filter((t) => t.name === 'Languages');
    expect(languages).toHaveLength(1);
    expect(languages?.[0].text).toBe(
      'You can speak, read, and write Common and Dwarvish. Dwarvish is full ' +
        'of hard consonants and guttural sounds, and those characteristics ' +
        'spill over into whatever other language a dwarf might speak.',
    );
  });

  it('does not promote the "Common and Dwarvish" continuation to a trait', () => {
    const names = dwarf?.traits.map((t) => t.name) ?? [];
    expect(names).not.toContain('Common and Dwarvish');
  });
});

describe('parseAncestries — Dragonborn breath-weapon table does not bleed', () => {
  // The Draconic Ancestry table is interleaved between Speed and the Draconic
  // Ancestry trait, and the Draconic Ancestry body wraps so "Ancestry table.
  // <prose>" continues on its own line (the source phrase "the Draconic /
  // Ancestry table").
  const results = parseAncestries([
    page(31, [
      'Dragonborn',
      'Your draconic heritage manifests in a variety of traits.',
      'Dragonborn Traits',
      'Your draconic heritage manifests in a variety of traits you share.',
      'Ability Score Increase. Your Strength score increases by 2.',
      'Speed. Your base walking speed is 30 feet.',
      'Draconic Ancestry',
      'Dragon Damage Type Breath Weapon',
      'Black Acid 5 by 30 ft. line (Dex. save)',
      'Blue Lightning 5 by 30 ft. line (Dex. save)',
      'Gold Fire 15 ft. cone (Dex. save)',
      'Green Poison 15 ft. cone (Con. save)',
      'White Cold 15 ft. cone (Con. save)',
      'Draconic Ancestry. You have draconic ancestry.',
      'Choose one type of dragon from the Draconic',
      'Ancestry table. Your breath weapon and damage',
      'resistance are determined by the dragon type, as',
      'shown in the table.',
      'Languages. You can speak, read, and write',
      'Common and Draconic. Draconic is thought to be one of the oldest.',
    ]),
  ]);
  const dragonborn = results.find((r) => r.name === 'Dragonborn');

  it('keeps the Speed trait free of the interleaved breath-weapon table', () => {
    const speed = dragonborn?.traits.find((t) => t.name === 'Speed');
    expect(speed?.text).toBe('Your base walking speed is 30 feet.');
    expect(speed?.text).not.toMatch(/save\)/);
    expect(speed?.text).not.toMatch(/Damage Type/);
  });

  it('does not emit a bogus "Ancestry table" trait and reflows the wrapped body', () => {
    const names = dragonborn?.traits.map((t) => t.name) ?? [];
    expect(names).not.toContain('Ancestry table');
    const draconic = dragonborn?.traits.find(
      (t) => t.name === 'Draconic Ancestry',
    );
    expect(draconic?.text).toBe(
      'You have draconic ancestry. Choose one type of dragon from the ' +
        'Draconic Ancestry table. Your breath weapon and damage resistance ' +
        'are determined by the dragon type, as shown in the table.',
    );
  });

  it('does not promote the "Common and Draconic" Languages continuation', () => {
    const names = dragonborn?.traits.map((t) => t.name) ?? [];
    expect(names).not.toContain('Common and Draconic');
    const languages = dragonborn?.traits.find((t) => t.name === 'Languages');
    expect(languages?.text).toBe(
      'You can speak, read, and write Common and Draconic. Draconic is ' +
        'thought to be one of the oldest.',
    );
  });
});

// ---------------------------------------------------------------------------
// Empty / no-match input.
// ---------------------------------------------------------------------------

describe('parseAncestries — empty and no-match input', () => {
  it('returns an empty array for an empty page list', () => {
    expect(parseAncestries([])).toEqual([]);
  });

  it('returns an empty array when no known race heading appears', () => {
    const p = page(1, ['This is not a race.', 'Some other text here.']);
    expect(parseAncestries([p])).toEqual([]);
  });
});

describe('parseAncestries — halfling subrace canonical names', () => {
  const results = parseAncestries([
    page(26, [
      'Halfling',
      'The comforts of home are the goals of most halflings.',
      'Halfling Traits',
      'Your halfling character has a number of traits in common with all other halflings.',
      'Ability Score Increase. Your Dexterity score increases by 2.',
      'Size. Halflings average about 3 feet tall and weigh about 40 pounds. Your size is Small.',
      'Speed. Your base walking speed is 25 feet.',
      'Lucky. When you roll a 1 on an attack roll, ability check, or saving throw, you can reroll the die.',
      'Subrace. The two main kinds of halfling are lightfoot and stout.',
      'Lightfoot',
      'As a lightfoot halfling, you can easily hide from notice.',
      'Ability Score Increase. Your Charisma score increases by 1.',
      'Naturally Stealthy. You can attempt to hide even when you are obscured only by a creature.',
      'Stout',
      "As a stout halfling, you're hardier than average.",
      'Ability Score Increase. Your Constitution score increases by 1.',
      'Stout Resilience. You have advantage on saving throws against poison.',
    ]),
  ]);

  it('parent-qualifies bare SRD halfling subrace headings for records and lookup', () => {
    expect(results.map((r) => r.name)).toEqual([
      'Halfling',
      'Lightfoot Halfling',
      'Stout Halfling',
    ]);

    const halfling = results.find((r) => r.name === 'Halfling');
    expect(halfling?.subraces).toEqual([
      'Lightfoot Halfling',
      'Stout Halfling',
    ]);

    const lightfoot = results.find((r) => r.name === 'Lightfoot Halfling');
    expect(lightfoot?.subraceOf).toBe('Halfling');
    expect(lightfoot?.size).toBe('Small');
    expect(lightfoot?.speed).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// Real-PDF coverage (loreweaver-3m1)
// ---------------------------------------------------------------------------
//
// The SRD 5.1 PDF publishes 9 base races and exactly 4 subraces — Hill Dwarf,
// High Elf, Lightfoot Halfling, Rock Gnome. The other PHB subraces (Mountain
// Dwarf, Wood Elf, Dark Elf/Drow, Stout Halfling, Forest Gnome) are not part
// of the CC-BY-4.0 SRD 5.1 at all. The orchestrator's
// `EXPECTED_SRD_5_1_ANCESTRY_NAMES` constant originally claimed all 18, which
// caused `verify:dnd5e-srd-pack` to fail closed against a perfectly correct
// 13-record parse. These tests pin the 13-record reality so the constant
// can't silently drift back to the PHB set, and prove the parser produces
// exactly that set when run against the vendored PDF.

describe('parseAncestries — real SRD 5.1 PDF coverage (loreweaver-3m1)', () => {
  const SRD_PDF_PATH = join(
    process.cwd(),
    'packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf',
  );

  it('EXPECTED_SRD_5_1_ANCESTRY_NAMES carries the 13 actual SRD 5.1 names', () => {
    // The SRD 5.1 has 9 base races plus 4 subraces (one per race-with-subraces).
    // A regression that re-adds Mountain Dwarf etc. to this list would make the
    // ancestry coverage check fail against the real PDF.
    expect([...EXPECTED_SRD_5_1_ANCESTRY_NAMES].sort()).toEqual(
      [
        'Dragonborn',
        'Dwarf',
        'Elf',
        'Gnome',
        'Half-Elf',
        'Half-Orc',
        'Halfling',
        'Human',
        'Tiefling',
        'Hill Dwarf',
        'High Elf',
        'Lightfoot Halfling',
        'Rock Gnome',
      ].sort(),
    );
    expect(EXPECTED_SRD_5_1_ANCESTRY_NAMES).toHaveLength(13);
    // Sanity guard: PHB-only subraces must NOT appear here. Adding them is
    // exactly the bug loreweaver-3m1 fixed.
    for (const phbOnly of [
      'Mountain Dwarf',
      'Wood Elf',
      'Dark Elf (Drow)',
      'Stout Halfling',
      'Forest Gnome',
    ]) {
      expect(EXPECTED_SRD_5_1_ANCESTRY_NAMES).not.toContain(phbOnly);
    }
  });

  it('parses exactly the EXPECTED set from the vendored SRD 5.1 PDF', async () => {
    // Narrow extraction to the races chapter (PDF pages 3-7) plus page 8
    // where "Barbarian" first appears — the races endHeading anchor — so
    // sliceSection's requireEndHeading guard is satisfied without paying for
    // a 403-page extract. Keeps the test well under the suite's default
    // timeout while still exercising real PDF text and column-aware layout.
    const pdfBytes = readFileSync(SRD_PDF_PATH);
    const pages = await extractPdfText(new Uint8Array(pdfBytes), {
      pageRange: { start: 3, end: 8 },
    });
    const racePages = sliceSection(
      pages,
      SRD_5_1_DEFAULT_SECTION_ANCHORS.races,
    );
    const ancestries = parseAncestries(racePages);
    const parsedNames = ancestries.map((a) => a.name).sort();
    expect(parsedNames).toEqual([...EXPECTED_SRD_5_1_ANCESTRY_NAMES].sort());
  }, 20000);

  // Durable invariant (eshyra-o9bd.19.2.1.3.1): every emitted trait text must
  // be one contiguous verbatim span of the races-section source text — never
  // composed by joining text from two separately printed sections (as the
  // flattened subrace Ability Score Increase traits did pre-fix: the parent
  // race's sentence and the subrace's own sentence are printed sections apart,
  // so joining them with a space fabricated a span the SRD never prints).
  // Confirmed to fail on pre-fix `main` for exactly the four SRD 5.1 subraces
  // (High Elf, Hill Dwarf, Lightfoot Halfling, Rock Gnome) — see the bead's
  // completion notes for the captured failing-record list.
  it('never composes a trait text by joining two non-contiguous source spans', async () => {
    const pdfBytes = readFileSync(SRD_PDF_PATH);
    const pages = await extractPdfText(new Uint8Array(pdfBytes), {
      pageRange: { start: 3, end: 8 },
    });
    const racePages = sliceSection(
      pages,
      SRD_5_1_DEFAULT_SECTION_ANCHORS.races,
    );
    const ancestries = parseAncestries(racePages);

    // Collapse all whitespace runs (spaces, newlines, paragraph breaks) to one
    // space, so a trait text can be compared against the source regardless of
    // line-wrap position.
    const normalize = (value: string): string =>
      value.replace(/\s+/g, ' ').trim();

    // Mirror parseAncestries' own joinParagraphs: join consecutive non-blank
    // lines with a single space; a blank line starts a new paragraph. This is
    // the same reflow every trait text already goes through, applied here to
    // the full races-section source instead of one trait's body lines.
    const paragraphs: string[] = [];
    let current: string[] = [];
    for (const raw of racePages.flatMap((p) => p.lines)) {
      const line = raw.trim();
      if (line.length === 0) {
        if (current.length > 0) {
          paragraphs.push(current.join(' '));
          current = [];
        }
        continue;
      }
      current.push(line);
    }
    if (current.length > 0) {
      paragraphs.push(current.join(' '));
    }
    const sourceText = normalize(paragraphs.join('\n\n'));

    const failures: string[] = [];
    for (const ancestry of ancestries) {
      for (const trait of ancestry.traits) {
        const traitText = normalize(trait.text);
        if (traitText.length > 0 && !sourceText.includes(traitText)) {
          failures.push(`${ancestry.name} / ${trait.name}`);
        }
      }
    }
    expect(failures).toEqual([]);
  }, 20000);
});
