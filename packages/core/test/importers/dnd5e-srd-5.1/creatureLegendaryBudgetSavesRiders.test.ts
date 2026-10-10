/**
 * Creature legendary budgets, multi-save entries, and rider/ongoing damage
 * (eshyra-o9bd.19.4.3: opus:F-26 legendary-economy, opus:F-32
 * multi-save-entries, fable:F3 creature-ongoing-riders).
 *
 * Populations are enumerated from the committed pack's own source-verbatim
 * text by independent patterns in this file, not from the importer's grammar:
 * a printed budget sentence, a printed save clause, or a printed rider that the
 * projection omits stays in the population and fails here.
 */

import { describe, expect, it } from 'vitest';
import { getBundledDnd5eSrdPack } from '../../../src/internal.js';

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const pack = getBundledDnd5eSrdPack();
const creatures = pack.records.filter((record) => record.kind === 'creature');
const byKey = new Map(pack.records.map((record) => [record.key, record]));
const dataOf = (key: string): Obj => {
  const record = byKey.get(key);
  if (record === undefined) throw new Error(`missing record ${key}`);
  return record.data as Obj;
};

const entriesOf = (data: Obj): Obj[] => [
  ...((data.traits as Obj[] | undefined) ?? []),
  ...((data.actions as Obj[] | undefined) ?? []),
  ...((data.reactions as Obj[] | undefined) ?? []),
  ...(((data.legendaryActions as Obj | undefined)?.entries as
    | Obj[]
    | undefined) ?? []),
];

const effectsOf = (entry: Obj): Obj[] => {
  const mechanics = entry.mechanics;
  return isObj(mechanics) && Array.isArray(mechanics.effects)
    ? (mechanics.effects as Obj[])
    : [];
};

const savesOf = (entry: Obj): Obj[] => {
  const mechanics = entry.mechanics;
  return isObj(mechanics) && Array.isArray(mechanics.saves)
    ? (mechanics.saves as Obj[])
    : [];
};

const WORD_NUMBERS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};
const ABILITY_NAMES = [
  'Strength',
  'Dexterity',
  'Constitution',
  'Intelligence',
  'Wisdom',
  'Charisma',
];

describe('creature legendary budget (opus:F-26)', () => {
  it('types the budget exactly where the intro sentence prints it', () => {
    const mismatched: string[] = [];
    let printed = 0;
    for (const record of creatures) {
      const block = (record.data as Obj).legendaryActions;
      if (!isObj(block)) continue;
      const description =
        typeof block.description === 'string' ? block.description : '';
      const match =
        /\bcan take (\d+|one|two|three|four|five) legendary actions\b/i.exec(
          description,
        );
      if (match === null) {
        if (block.budget !== undefined) mismatched.push(record.key);
        continue;
      }
      printed += 1;
      const expected = WORD_NUMBERS[match[1].toLowerCase()] ?? Number(match[1]);
      if (block.budget !== expected) mismatched.push(record.key);
    }
    expect(mismatched).toEqual([]);
    expect(printed).toBeGreaterThan(0);
  });

  it('types timing, regain, and one-at-a-time only where printed', () => {
    const wrong: string[] = [];
    for (const record of creatures) {
      const block = (record.data as Obj).legendaryActions;
      if (!isObj(block)) continue;
      const description =
        typeof block.description === 'string' ? block.description : '';
      const timing = /only at the end of another creature[’']s turn/.test(
        description,
      );
      const regain =
        /regains spent legendary actions at the start of its turn/.test(
          description,
        );
      const one = /Only one legendary action option can be used at a time/.test(
        description,
      );
      if (
        (block.timing === 'end-of-another-creatures-turn') !== timing ||
        (block.regain === 'start-of-own-turn') !== regain ||
        (block.oneAtATime === true) !== one
      )
        wrong.push(record.key);
    }
    expect(wrong).toEqual([]);
  });

  it('pins the aboleth budget from its printed sentence', () => {
    const block = dataOf('creature:aboleth').legendaryActions as Obj;
    expect(block.budget).toBe(3);
    expect(block.timing).toBe('end-of-another-creatures-turn');
    expect(block.regain).toBe('start-of-own-turn');
    expect(block.oneAtATime).toBe(true);
  });
});

describe('creature multi-save entries (opus:F-32)', () => {
  it('projects one typed save per printed save clause, in source order', () => {
    const mismatched: string[] = [];
    for (const record of creatures) {
      for (const entry of entriesOf(record.data as Obj)) {
        const text = typeof entry.text === 'string' ? entry.text : '';
        const clauses = [
          ...text.matchAll(
            /\bDC (\d+) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw\b/g,
          ),
        ];
        const saves = savesOf(entry);
        if (clauses.length === 0) {
          if (
            saves.length !== 0 &&
            clauses.length === 0 &&
            saves.some((s) => s.dc !== undefined)
          )
            mismatched.push(`${record.key} ${entry.name}`);
          continue;
        }
        const ok =
          saves.length === clauses.length &&
          clauses.every(
            (clause, i) =>
              saves[i]?.dc === Number(clause[1]) &&
              saves[i]?.ability === clause[2].toLowerCase(),
          );
        if (!ok) mismatched.push(`${record.key} ${entry.name}`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it('pins the purple-worm Bite second save and the air elemental Whirlwind branch', () => {
    const bite = entriesOf(dataOf('creature:purple-worm')).find(
      (entry) => entry.name === 'Bite',
    ) as Obj;
    expect(savesOf(bite)).toEqual([
      { ability: 'dexterity', dc: 19 },
      { ability: 'constitution', dc: 21 },
    ]);
    const whirlwind = entriesOf(dataOf('creature:air-elemental')).find(
      (entry) => String(entry.name).startsWith('Whirlwind'),
    ) as Obj;
    expect(savesOf(whirlwind)).toEqual([
      { ability: 'strength', dc: 13, damageOnSuccess: 'half' },
      { ability: 'dexterity', dc: 13 },
    ]);
    // Ice devil Wall of Ice (SRD 5.1): both printed clauses, the DC 17
    // Dexterity save on creation and the DC 17 Constitution save when moving
    // through the wall, carry their own half-damage success branch.
    const wall = entriesOf(dataOf('creature:ice-devil')).find((entry) =>
      String(entry.name).startsWith('Wall of Ice'),
    ) as Obj;
    expect(savesOf(wall)).toEqual([
      { ability: 'dexterity', dc: 17, damageOnSuccess: 'half' },
      { ability: 'constitution', dc: 17, damageOnSuccess: 'half' },
    ]);
  });
});

describe('creature rider and ongoing damage (fable:F3)', () => {
  it('projects every printed extra-damage rider with its dice, type, and frequency', () => {
    const mismatched: string[] = [];
    let riders = 0;
    for (const record of creatures) {
      for (const entry of entriesOf(record.data as Obj)) {
        const text = typeof entry.text === 'string' ? entry.text : '';
        const name = typeof entry.name === 'string' ? entry.name : '';
        const match =
          /\b(?:takes|deals?|deal) an extra (\d+) \((\d+d\d+)\)(?: (\w+))? damage\b/.exec(
            text,
          );
        if (match === null) continue;
        riders += 1;
        const effect = effectsOf(entry).find(
          (candidate) =>
            candidate.kind === 'extraDamage' && candidate.dice === match[2],
        );
        const typeOk =
          match[3] === undefined
            ? effect?.type === undefined
            : effect?.type === match[3];
        const frequencyOk =
          (/\bOnce per turn\b/.test(text) || /\(1\/Turn\)/.test(name)) ===
          (effect?.frequency === 'once-per-turn');
        if (
          effect === undefined ||
          effect.average !== Number(match[1]) ||
          !typeOk ||
          !frequencyOk
        )
          mismatched.push(`${record.key} ${name}`);
      }
    }
    expect(mismatched).toEqual([]);
    expect(riders).toBeGreaterThan(0);
  });

  it('projects every printed infernal-wound hit-point loss without damage typing', () => {
    const mismatched: string[] = [];
    let wounds = 0;
    for (const record of creatures) {
      for (const entry of entriesOf(record.data as Obj)) {
        const text = typeof entry.text === 'string' ? entry.text : '';
        const match =
          /\blose (\d+) \((\d+d\d+)\) hit points at the start of each of its turns due to an infernal wound\b/.exec(
            text,
          );
        if (match === null) continue;
        wounds += 1;
        const effect = effectsOf(entry).find(
          (candidate) => candidate.kind === 'recurringHitPointLoss',
        );
        if (
          effect?.dice !== match[2] ||
          effect?.average !== Number(match[1]) ||
          effect?.type !== undefined ||
          effect?.trigger !== 'start of each of its turns'
        )
          mismatched.push(`${record.key} ${entry.name}`);
      }
    }
    expect(mismatched).toEqual([]);
    expect(wounds).toBe(2);
  });

  it('pins the hobgoblin Martial Advantage and horned-devil Tail regressions', () => {
    const martial = entriesOf(dataOf('creature:hobgoblin')).find(
      (entry) => entry.name === 'Martial Advantage',
    ) as Obj;
    expect(effectsOf(martial)).toEqual([
      expect.objectContaining({
        kind: 'extraDamage',
        dice: '2d6',
        average: 7,
        frequency: 'once-per-turn',
      }),
    ]);
    expect(effectsOf(martial)[0].type).toBeUndefined();
    const tail = entriesOf(dataOf('creature:horned-devil')).find(
      (entry) => entry.name === 'Tail',
    ) as Obj;
    expect(effectsOf(tail)).toEqual([
      expect.objectContaining({
        kind: 'recurringHitPointLoss',
        dice: '3d6',
        average: 10,
      }),
    ]);
  });

  it('pins the boar Charge regression with its printed type and verbatim trigger', () => {
    const charge = entriesOf(dataOf('creature:boar')).find(
      (entry) => entry.name === 'Charge',
    ) as Obj;
    expect(effectsOf(charge)).toEqual([
      {
        kind: 'extraDamage',
        dice: '1d6',
        average: 3,
        type: 'slashing',
        trigger:
          'If the boar moves at least 20 feet straight toward a target and then hits it with a tusk attack on the same turn',
      },
    ]);
  });
});

export const ABILITY_NAMES_FOR_REPORT = ABILITY_NAMES;
