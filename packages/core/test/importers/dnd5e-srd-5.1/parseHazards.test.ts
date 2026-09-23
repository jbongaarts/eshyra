/**
 * Hazard-parser unit tests for the D&D 5e SRD 5.1 importer.
 *
 * Hazard text excerpts in this file are reproduced from the System Reference
 * Document 5.1 by Wizards of the Coast LLC, available under the Creative
 * Commons Attribution 4.0 International License (CC-BY-4.0). Excerpts are
 * used as parser test input; no modification has been made beyond reformatting
 * to match the importer's extracted-line input shape.
 */

import { describe, expect, it } from 'vitest';
import { parseHazards } from '../../../scripts/importers/dnd5e-srd-5.1/parseHazards.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

// ---------------------------------------------------------------------------
// SRD 5.1 canonical hazards: Brown Mold, Green Slime, Webs, Yellow Mold.
// ---------------------------------------------------------------------------

const BROWN_MOLD_LINES = [
  'Brown Mold',
  'Brown mold feeds on warmth, draining heat from everything nearby. A patch of',
  'brown mold typically covers a 10-foot square, and the temperature within 30',
  'feet of it is always frigid cold. When a creature moves within 5 feet of the',
  'mold for the first time on a turn or starts its turn there, it must make a DC',
  '12 Constitution saving throw, taking 22 (4d10) cold damage on a failed save,',
  'or half as much damage on a successful one.',
  '',
  'Brown mold is immune to fire damage, and any source of fire brought within 5',
  'feet of a patch causes it to instantly expand outward in the direction of the',
  'fire, covering a 10-foot square (with the source of the fire at the center of',
  'that new growth). A patch of brown mold exposed to an effect that deals cold',
  'damage is instantly destroyed.',
];

const GREEN_SLIME_LINES = [
  'Green Slime',
  'This acidic slime devours flesh, organic material, and metal on contact.',
  'Bright green, wet, and sticky, it seeps through cracks to reach food sources.',
  '',
  'A creature that comes into contact with green slime outside of combat takes',
  '5 (1d10) acid damage. The slime deals 5 (1d10) acid damage again at the end',
  "of each of the creature's turns until the slime is scraped off, which requires",
  'an action. Metal or organic material that comes into contact with green slime',
  'is eaten away. After 1 minute of contact, the material is destroyed. Magic',
  'items are immune to this effect.',
  '',
  'Any effect that deals cold or fire damage, or bright sunlight, destroys a',
  'patch of green slime.',
];

const WEBS_LINES = [
  'Webs',
  'Giant spiders and other web-spinning creatures weave thick, sticky webs across',
  'passages and fill in the corners of their lairs. Webs are difficult terrain,',
  'and a 10-foot cube of web has AC 10, 15 hit points, vulnerability to fire',
  'damage, and immunity to bludgeoning, piercing, and psychic damage.',
  '',
  'A creature that starts its turn in a web or that enters one during its move',
  'must make a DC 12 Strength saving throw. On a failed save, the creature is',
  'restrained as long as it remains in the web or until it breaks free.',
  '',
  'A creature restrained by a web can use its action to try to escape. To do so,',
  'it must succeed on a DC 12 Strength (Athletics) or Dexterity (Acrobatics)',
  'check.',
];

const YELLOW_MOLD_LINES = [
  'Yellow Mold',
  'Yellow mold grows in dark places, and one patch typically covers a 5-foot',
  'square. If touched, the mold ejects a cloud of spores that fills a 10-foot',
  'cube originating from the mold. Any creature in the area must succeed on a DC',
  '15 Constitution saving throw or take 11 (2d10) poison damage and become',
  'poisoned for 1 minute. While poisoned in this way, a creature takes 5 (1d10)',
  'poison damage at the start of each of its turns. A poisoned creature can',
  'repeat the saving throw at the end of each of its turns, ending the effect on',
  'a success. Sunlight or any amount of fire damage instantly destroys a patch of',
  'yellow mold.',
];

// ---------------------------------------------------------------------------
// Single hazard: Brown Mold
// ---------------------------------------------------------------------------

describe('parseHazards — Brown Mold (single entry)', () => {
  const p = page(105, BROWN_MOLD_LINES);
  const results = parseHazards([p]);

  it('extracts exactly one hazard', () => {
    expect(results).toHaveLength(1);
  });

  it('extracts the hazard name', () => {
    expect(results[0].name).toBe('Brown Mold');
  });

  it('records the source page', () => {
    expect(results[0].sourcePage).toBe(105);
  });

  it('includes cold-damage mechanical text in description', () => {
    expect(results[0].description).toMatch(/cold damage/);
  });

  it('does not include the hazard name line as prose', () => {
    expect(results[0].description).not.toMatch(/^Brown Mold$/m);
  });

  it('re-flows wrapped lines into paragraphs', () => {
    expect(results[0].description).toMatch(/frigid cold/);
  });
});

// ---------------------------------------------------------------------------
// All four SRD 5.1 hazards on a single page
// ---------------------------------------------------------------------------

const ALL_HAZARDS_PAGE = page(105, [
  ...BROWN_MOLD_LINES,
  '',
  ...GREEN_SLIME_LINES,
  '',
  ...WEBS_LINES,
  '',
  ...YELLOW_MOLD_LINES,
]);

describe('parseHazards — all four SRD 5.1 hazards', () => {
  const results = parseHazards([ALL_HAZARDS_PAGE]);

  it('extracts exactly four hazards', () => {
    expect(results).toHaveLength(4);
  });

  it('returns hazards sorted by name', () => {
    const names = results.map((h) => h.name);
    expect(names).toEqual([...names].sort());
  });

  it('extracts all expected names', () => {
    const names = new Set(results.map((h) => h.name));
    expect(names.has('Brown Mold')).toBe(true);
    expect(names.has('Green Slime')).toBe(true);
    expect(names.has('Webs')).toBe(true);
    expect(names.has('Yellow Mold')).toBe(true);
  });

  it('does not bleed one hazard body into another', () => {
    const brown = results.find((h) => h.name === 'Brown Mold');
    const green = results.find((h) => h.name === 'Green Slime');
    const webs = results.find((h) => h.name === 'Webs');
    const yellow = results.find((h) => h.name === 'Yellow Mold');
    expect(brown?.description).toMatch(/cold damage/);
    expect(brown?.description).not.toMatch(/acid damage/);
    expect(green?.description).toMatch(/acid damage/);
    expect(green?.description).not.toMatch(/cold damage/);
    expect(webs?.description).toMatch(/difficult terrain/);
    expect(yellow?.description).toMatch(/poison damage/);
  });
});

// ---------------------------------------------------------------------------
// Multi-page: hazards spanning page boundaries
// ---------------------------------------------------------------------------

describe('parseHazards — hazards spanning multiple pages', () => {
  it('assigns sourcePage from the page the name line appears on', () => {
    const p1 = page(105, [...BROWN_MOLD_LINES, '', ...GREEN_SLIME_LINES]);
    const p2 = page(106, [...WEBS_LINES, '', ...YELLOW_MOLD_LINES]);
    const results = parseHazards([p1, p2]);
    expect(results).toHaveLength(4);
    const brown = results.find((h) => h.name === 'Brown Mold');
    const webs = results.find((h) => h.name === 'Webs');
    expect(brown?.sourcePage).toBe(105);
    expect(webs?.sourcePage).toBe(106);
  });
});

// ---------------------------------------------------------------------------
// Green Slime — multi-paragraph description
// ---------------------------------------------------------------------------

describe('parseHazards — Green Slime multi-paragraph', () => {
  const p = page(106, GREEN_SLIME_LINES);
  const [result] = parseHazards([p]);

  it('captures the multi-paragraph description', () => {
    expect(result.description).toMatch(/acidic slime/);
    expect(result.description).toMatch(/acid damage/);
    expect(result.description).toMatch(/cold or fire damage/);
  });
});

// ---------------------------------------------------------------------------
// Empty input: returns empty array without throwing
// ---------------------------------------------------------------------------

describe('parseHazards — empty input', () => {
  it('returns empty array for empty page list', () => {
    expect(parseHazards([])).toEqual([]);
  });

  it('returns empty array when no hazard names are found', () => {
    const p = page(1, ['This is not a hazard.', 'Some other text here.']);
    expect(parseHazards([p])).toEqual([]);
  });
});
