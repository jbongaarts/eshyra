/**
 * Sample-trap parser unit tests for the D&D 5e SRD 5.1 importer (loreweaver-hvp).
 *
 * Trap text excerpts in this file are reproduced from the System Reference
 * Document 5.1 by Wizards of the Coast LLC, available under the Creative
 * Commons Attribution 4.0 International License (CC-BY-4.0). Excerpts are
 * used as parser test input; no modification has been made beyond reformatting
 * to match the importer's extracted-line input shape.
 */

import { describe, expect, it } from 'vitest';
import { parseTraps } from '../../../scripts/importers/dnd5e-srd-5.1/parseTraps.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

// Leading guidance prose + the two trap tables. parseTraps must skip all of
// this — none of it carries a standalone "Mechanical trap" / "Magic trap"
// subtitle, so no sample-trap record should be promoted from it.
const SECTION_PREAMBLE_LINES = [
  'A trap can be either mechanical or magical in nature. Mechanical traps',
  'include pits, arrow traps, falling blocks, and whirling blades. Magic traps',
  'are either magical device traps or spell traps.',
  'Trap Effects',
  'Use the Trap Save DCs and Attack Bonuses table and the Damage Severity by',
  'Level table for suggestions based on three levels of trap severity.',
  'Sample Traps',
  'The magical and mechanical traps presented here vary in deadliness and are',
  'presented in alphabetical order.',
];

// ---------------------------------------------------------------------------
// Representative sample traps named in the loreweaver-hvp acceptance criteria:
// Fire-Breathing Statue, Poison Needle, Rolling Sphere, Sphere of Annihilation.
// ---------------------------------------------------------------------------

const FIRE_BREATHING_STATUE_LINES = [
  'Fire-Breathing Statue',
  'Magic trap',
  'This trap is activated when an intruder steps on a hidden pressure plate,',
  'releasing a magical gout of flame from a nearby statue. The statue can be of',
  'anything, including a dragon or a wizard casting a spell.',
  'The trap activates when more than 20 pounds of weight is placed on the',
  'pressure plate, causing the statue to release a 30-foot cone of fire. Each',
  'creature in the fire must make a DC 13 Dexterity saving throw, taking 22',
  '(4d10) fire damage on a failed save, or half as much damage on a successful',
  'one.',
];

const POISON_NEEDLE_LINES = [
  'Poison Needle',
  'Mechanical trap',
  "A poisoned needle is hidden within a treasure chest's lock, or in something",
  'else that a creature might open. Opening the chest without the proper key',
  'causes the needle to spring out, delivering a dose of poison.',
  'When the trap is triggered, the needle extends 3 inches straight out from the',
  'lock. A creature within range takes 1 piercing damage and 11 (2d10) poison',
  'damage, and must succeed on a DC 15 Constitution saving throw or be poisoned',
  'for 1 hour.',
];

const ROLLING_SPHERE_LINES = [
  'Rolling Sphere',
  'Mechanical trap',
  "When 20 or more pounds of pressure are placed on this trap's pressure plate,",
  'a hidden trapdoor in the ceiling opens, releasing a 10-foot-diameter rolling',
  'sphere of solid stone.',
  'Activation of the sphere requires all creatures present to roll initiative.',
  'The sphere rolls initiative with a +8 bonus. On its turn, it moves 60 feet in',
  'a straight line. Whenever the sphere enters a creature’s space, that',
  'creature must succeed on a DC 15 Dexterity saving throw or take 55 (10d10)',
  'bludgeoning damage and be knocked prone.',
];

const SPHERE_OF_ANNIHILATION_LINES = [
  'Sphere of Annihilation',
  'Magic trap',
  'Magical, impenetrable darkness fills the gaping mouth of a stone face carved',
  'into a wall. The mouth is 2 feet in diameter and roughly circular. No sound',
  'issues from it, and any matter that enters it is instantly obliterated.',
  'A successful DC 20 Intelligence (Arcana) check reveals that the mouth',
  'contains a sphere of annihilation that can’t be controlled or moved. A',
  'successful dispel magic (DC 18) removes the enchantment.',
];

// The "Diseases" heading is the end of the Traps slice in the real PDF; here it
// just terminates the last trap's body — `parseTraps` receives an already-sliced
// section, so a trailing heading line becomes prose unless excluded by the next
// trap boundary. We deliberately do NOT include it so the last trap's body is
// the verbatim SRD text.

const FULL_TRAPS_PAGE = page(196, [
  ...SECTION_PREAMBLE_LINES,
  ...FIRE_BREATHING_STATUE_LINES,
  ...POISON_NEEDLE_LINES,
  ...ROLLING_SPHERE_LINES,
  ...SPHERE_OF_ANNIHILATION_LINES,
]);

describe('parseTraps — representative sample traps', () => {
  const results = parseTraps([FULL_TRAPS_PAGE]);

  it('extracts exactly the four sample traps (no preamble/table promotion)', () => {
    expect(results.map((t) => t.name)).toEqual([
      'Fire-Breathing Statue',
      'Poison Needle',
      'Rolling Sphere',
      'Sphere of Annihilation',
    ]);
  });

  it('classifies each trap by its SRD subtitle', () => {
    const byName = new Map(results.map((t) => [t.name, t]));
    expect(byName.get('Fire-Breathing Statue')?.trapType).toBe('magic');
    expect(byName.get('Poison Needle')?.trapType).toBe('mechanical');
    expect(byName.get('Rolling Sphere')?.trapType).toBe('mechanical');
    expect(byName.get('Sphere of Annihilation')?.trapType).toBe('magic');
  });

  it('captures the body without the name or subtitle line', () => {
    const statue = results.find((t) => t.name === 'Fire-Breathing Statue');
    expect(statue?.description).toMatch(/hidden pressure plate/);
    expect(statue?.description).toMatch(/22 \(4d10\) fire damage/);
    expect(statue?.description).not.toMatch(/^Fire-Breathing Statue$/m);
    expect(statue?.description).not.toMatch(/^Magic trap$/m);
  });

  it('does not bleed one trap body into the next', () => {
    const needle = results.find((t) => t.name === 'Poison Needle');
    expect(needle?.description).toMatch(/2d10\) poison damage/);
    // The next trap's name/text must not be absorbed.
    expect(needle?.description).not.toMatch(/Rolling Sphere/);
    expect(needle?.description).not.toMatch(/bludgeoning damage/);
  });

  it('records the source page for each trap', () => {
    for (const trap of results) {
      expect(trap.sourcePage).toBe(196);
    }
  });
});

// ---------------------------------------------------------------------------
// "Pits" is a single sample-trap entry whose body inlines four variant
// lead-ins (Simple/Hidden/Locking/Spiked). It must remain ONE record.
// ---------------------------------------------------------------------------

const PITS_LINES = [
  'Pits',
  'Mechanical trap',
  'Four basic pit traps are presented here.',
  'Simple Pit. A simple pit trap is a hole dug in the ground, covered by a large',
  'cloth anchored on the edge and camouflaged with dirt and debris.',
  'Hidden Pit. This pit has a cover constructed from material identical to the',
  'floor around it.',
  'Spiked Pit. This pit trap is a simple, hidden, or locking pit trap with',
  'sharpened wooden or iron spikes at the bottom.',
];

describe('parseTraps — Pits (single entry, four inlined variants)', () => {
  const [pits] = parseTraps([page(197, PITS_LINES)]);

  it('emits a single Pits record', () => {
    expect(parseTraps([page(197, PITS_LINES)])).toHaveLength(1);
  });

  it('keeps all four variant lead-ins in one description', () => {
    expect(pits.trapType).toBe('mechanical');
    expect(pits.description).toMatch(/Simple Pit\./);
    expect(pits.description).toMatch(/Hidden Pit\./);
    expect(pits.description).toMatch(/Spiked Pit\./);
  });
});

// ---------------------------------------------------------------------------
// Boundaries and empty input.
// ---------------------------------------------------------------------------

describe('parseTraps — multi-page entries', () => {
  it('assigns sourcePage from the page the name line appears on', () => {
    const p1 = page(196, FIRE_BREATHING_STATUE_LINES);
    const p2 = page(197, POISON_NEEDLE_LINES);
    const results = parseTraps([p1, p2]);
    expect(
      results.find((t) => t.name === 'Fire-Breathing Statue')?.sourcePage,
    ).toBe(196);
    expect(results.find((t) => t.name === 'Poison Needle')?.sourcePage).toBe(
      197,
    );
  });
});

describe('parseTraps — empty / no-trap input', () => {
  it('returns an empty array for an empty page list', () => {
    expect(parseTraps([])).toEqual([]);
  });

  it('returns an empty array when no trap subtitle line is present', () => {
    const p = page(196, [
      ...SECTION_PREAMBLE_LINES,
      'No sample trap subtitle appears in this slice.',
    ]);
    expect(parseTraps([p])).toEqual([]);
  });
});
