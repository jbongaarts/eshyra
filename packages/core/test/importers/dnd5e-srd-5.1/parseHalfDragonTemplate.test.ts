import { describe, expect, it } from 'vitest';
import { parseHalfDragonTemplate } from '../../../scripts/importers/dnd5e-srd-5.1/parseHalfDragonTemplate.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

const BODY = 9.84;
const CELL = 8.88;
const LEAF = 12;
const SUBSECTION = 13.92;

function page(
  pageNumber: number,
  entries: readonly (readonly [string, number])[],
): PageText {
  return {
    pageNumber,
    lines: entries.map(([line]) => line),
    lineHeights: entries.map(([, height]) => height),
  };
}

const HALF_DRAGON_PAGES: readonly PageText[] = [
  page(320, [
    ['Illusory Appearance. This belongs to the Sea Hag.', BODY],
    ['Half-Dragon Template', SUBSECTION],
    ['A beast, humanoid, giant, or monstrosity can become', BODY],
    ['a half-dragon. It keeps its statistics, except as follows.', BODY],
    ['Challenge. To avoid recalculating the creature’s', BODY],
    ['challenge rating, apply the template only to a', BODY],
    ['creature that meets the optional prerequisite in the', BODY],
    ['Breath Weapon table below. Otherwise, recalculate', BODY],
    ['the rating after you apply the template.', BODY],
    ['Senses. The half-dragon gains blindsight with a', BODY],
    ['radius of 10 feet and darkvision with a radius of 60', BODY],
    ['feet.', BODY],
    ['Resistances. The half-dragon gains resistance to a', BODY],
    ['type of damage based on its color.', BODY],
    ['Color Damage Resistance', CELL],
    ['Black or copper Acid', CELL],
    ['Blue or bronze Lightning', CELL],
  ]),
  page(321, [
    ['Brass, gold, or red Fire', CELL],
    ['Green Poison', CELL],
    ['Silver or white Cold', CELL],
    ['Languages. The half-dragon speaks Draconic in', BODY],
    ['addition to any other languages it knows.', BODY],
    ['New Action: Breath Weapon. The half-dragon has', BODY],
    ['the breath weapon of its dragon half. The half-', BODY],
    ['dragon’s size determines how this action functions.', BODY],
    ['Optional', CELL],
    ['Size Breath Weapon Prerequisite', CELL],
    ['Large or As a wyrmling Challenge 2 or higher', CELL],
    ['smaller', CELL],
    ['Huge As a young dragon Challenge 7 or higher', CELL],
    ['Gargantuan As an adult dragon Challenge 8 or higher', CELL],
    ['Half-Red Dragon Veteran', LEAF],
    ['Medium humanoid (human), any alignment', BODY],
  ]),
];

describe('parseHalfDragonTemplate', () => {
  it('captures the bounded prose without either table or adjacent creatures', () => {
    expect(parseHalfDragonTemplate(HALF_DRAGON_PAGES)).toEqual({
      name: 'Half-Dragon Template',
      keySlug: 'half-dragon-template',
      text:
        'A beast, humanoid, giant, or monstrosity can become a half-dragon. ' +
        'It keeps its statistics, except as follows. Challenge. To avoid ' +
        'recalculating the creature’s challenge rating, apply the template ' +
        'only to a creature that meets the optional prerequisite in the ' +
        'Breath Weapon table below. Otherwise, recalculate the rating after ' +
        'you apply the template. Senses. The half-dragon gains blindsight ' +
        'with a radius of 10 feet and darkvision with a radius of 60 feet. ' +
        'Resistances. The half-dragon gains resistance to a type of damage ' +
        'based on its color. Languages. The half-dragon speaks Draconic in ' +
        'addition to any other languages it knows. New Action: Breath Weapon. ' +
        'The half-dragon has the breath weapon of its dragon half. The ' +
        'half-dragon’s size determines how this action functions.',
      sourcePage: 320,
      tableRefs: [
        'table:half-dragon-damage-resistance',
        'table:half-dragon-breath-weapon',
      ],
    });
  });

  it('returns undefined when the reviewed subsection is absent', () => {
    expect(
      parseHalfDragonTemplate([
        page(320, [['Sea Hag', LEAF]]),
        page(321, [['Half-Red Dragon Veteran', LEAF]]),
      ]),
    ).toBeUndefined();
  });
});
