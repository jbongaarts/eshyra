/**
 * Combat-action parser unit tests for the D&D 5e SRD 5.1 importer.
 *
 * Action text excerpts in this file are reproduced from the System Reference
 * Document 5.1 by Wizards of the Coast LLC, available under the Creative
 * Commons Attribution 4.0 International License (CC-BY-4.0). Excerpts are
 * used as parser test input; no modification has been made beyond reformatting
 * to match the importer's extracted-line input shape.
 */

import { describe, expect, it } from 'vitest';
import { parseActions } from '../../../scripts/importers/dnd5e-srd-5.1/parseActions.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

const ACTIONS_IN_COMBAT_LINES = [
  'Actions in Combat',
  'The most common actions in combat are listed below.',
  '',
  'Attack',
  'The most common action to take in combat is the Attack action.',
  'Certain features, such as Extra Attack, let you make multiple attacks.',
  '',
  'Cast a Spell',
  'Spellcasters can use their action to cast a spell with a casting time of 1 action.',
  '',
  'Dash',
  'When you take the Dash action, you gain extra movement for the current turn.',
  '',
  'Disengage',
  "If you take the Disengage action, your movement doesn't provoke opportunity attacks.",
  '',
  'Dodge',
  'When you take the Dodge action, attack rolls against you have disadvantage.',
  '',
  'Help',
  'You can lend your aid to another creature in the completion of a task.',
  '',
  'Hide',
  'You make a Dexterity (Stealth) check in an attempt to hide.',
  '',
  'Ready',
  'First, you decide what perceivable circumstance will trigger your reaction.',
  '',
  'Search',
  'You devote your attention to finding something.',
  '',
  'Use an Object',
  'You normally interact with an object while doing something else.',
];

describe('parseActions — all standard SRD combat actions', () => {
  const results = parseActions([page(92, ACTIONS_IN_COMBAT_LINES)]);

  it('extracts all standard action names', () => {
    expect(results.map((a) => a.name)).toEqual([
      'Attack',
      'Cast a Spell',
      'Dash',
      'Disengage',
      'Dodge',
      'Help',
      'Hide',
      'Ready',
      'Search',
      'Use an Object',
    ]);
  });

  it('builds non-empty descriptions for representative actions', () => {
    const attack = results.find((a) => a.name === 'Attack');
    const dash = results.find((a) => a.name === 'Dash');
    const useObject = results.find((a) => a.name === 'Use an Object');
    expect(attack?.description).toMatch(/Extra Attack/);
    expect(dash?.description).toMatch(/extra movement/);
    expect(useObject?.description).toMatch(/interact with an object/);
  });

  it('records sourcePage from the action name line', () => {
    expect(results.every((a) => a.sourcePage === 92)).toBe(true);
  });
});

describe('parseActions — multi-page section', () => {
  it('uses the page where each action heading appears', () => {
    const p1 = page(92, [
      'Actions in Combat',
      'Attack',
      'The most common action to take in combat is the Attack action.',
      '',
      'Cast a Spell',
      'Spellcasters can use their action to cast a spell.',
      '',
      'Dash',
      'When you take the Dash action, you gain extra movement.',
    ]);
    const p2 = page(93, [
      'Disengage',
      "If you take the Disengage action, your movement doesn't provoke opportunity attacks.",
      '',
      'Use an Object',
      'You normally interact with an object while doing something else.',
    ]);
    const results = parseActions([p1, p2]);
    expect(results.find((a) => a.name === 'Attack')?.sourcePage).toBe(92);
    expect(results.find((a) => a.name === 'Disengage')?.sourcePage).toBe(93);
    expect(results.find((a) => a.name === 'Use an Object')?.sourcePage).toBe(
      93,
    );
  });
});

describe('parseActions — empty/unknown input', () => {
  it('returns empty for empty pages', () => {
    expect(parseActions([])).toEqual([]);
  });

  it('returns empty when no known action headings exist', () => {
    const p = page(1, ['Actions in Combat', 'No standard actions are listed.']);
    expect(parseActions([p])).toEqual([]);
  });
});
