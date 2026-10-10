/**
 * Option-local and alternative projections in the committed SRD 5.1 pack
 * (eshyra-o9bd.19.3.1.1; owning bead eshyra-o9bd.19.3.1, O1/O2/O5).
 *
 * - O1: a printed "A or B saving throw" projects both abilities, not one.
 * - O2: a record that prints several named traps projects each trap's own
 *   mechanics; the record-level mechanics do not read every trap as applying.
 * - O5: a feature's parent mechanics are not derived from one option's prose.
 *
 * Expectations are read from the committed records and the printed phrasing
 * is matched with independent regexes, not with the importer's own parser.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RECORDS_PATH = join(
  __dirname,
  '../../../data/rules-packs/rules__dnd5e-srd-5.1/records.json',
);

interface PackRecord {
  readonly kind: string;
  readonly key: string;
  readonly data: Record<string, unknown>;
}

const records = JSON.parse(readFileSync(RECORDS_PATH, 'utf8')) as PackRecord[];

function byKey(key: string): PackRecord {
  const found = records.find((record) => record.key === key);
  if (found === undefined) throw new Error(`missing pack record ${key}`);
  return found;
}

/** Every object in a JSON value, depth-first. */
function* objectsIn(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const item of value) yield* objectsIn(item);
  } else if (typeof value === 'object' && value !== null) {
    yield value as Record<string, unknown>;
    for (const child of Object.values(value)) yield* objectsIn(child);
  }
}

const ABILITY = 'Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma';
// An effect's printed save: "must succeed on (a DC N) A or B saving throw".
// General rule prose ("usually requires a Wisdom or Charisma saving throw")
// prints no effect and is not in this population.
const ALTERNATIVE_SAVE_PRINTED = new RegExp(
  `\\bmust (?:succeed on|make)\\b[^.]{0,40}?\\b(${ABILITY}) or (${ABILITY}) saving throw`,
  'g',
);

describe('O1: alternative-ability saves', () => {
  it('projects the bulette Deadly Leap save with its printed abilities, DC, and target choice', () => {
    const bulette = byKey('creature:bulette');
    const deadlyLeap = (bulette.data.actions as Record<string, unknown>[]).find(
      (action) => action.name === 'Deadly Leap',
    );
    expect(deadlyLeap).toBeDefined();
    const mechanics = deadlyLeap?.mechanics as Record<string, unknown>;
    expect(mechanics.saves).toEqual([
      {
        abilityOptions: ['strength', 'dexterity'],
        chosenBy: 'target',
        dc: 16,
        damageOnSuccess: 'half',
      },
    ]);
  });

  it('projects every printed "A or B saving throw" clause with both printed abilities in order', () => {
    const checked: string[] = [];
    for (const record of records) {
      const text = JSON.stringify(record.data).replace(/\\"/g, '"');
      const printed = [...text.matchAll(ALTERNATIVE_SAVE_PRINTED)].map((m) => [
        m[1].toLowerCase(),
        m[2].toLowerCase(),
      ]);
      if (printed.length === 0) continue;
      checked.push(record.key);
      const projected = [...objectsIn(record.data)]
        .filter((object) => Array.isArray(object.saves))
        .flatMap((object) => object.saves as Record<string, unknown>[])
        .filter((save) => Array.isArray(save.abilityOptions))
        .map((save) => save.abilityOptions as string[]);
      for (const [first, second] of printed) {
        expect(
          projected.some(
            (options) =>
              options.length === 2 &&
              options[0] === first &&
              options[1] === second,
          ),
          `${record.key} prints "${first} or ${second} saving throw" but projects no matching abilityOptions`,
        ).toBe(true);
      }
    }
    // Guards the population itself: the bulette clause is the only effect save
    // in the committed pack; a change in that population must be deliberate.
    expect(checked).toEqual(['creature:bulette']);
  });

  it('projects no single ability for an alternative-ability save', () => {
    for (const record of records) {
      for (const object of objectsIn(record.data)) {
        if (!Array.isArray(object.saves)) continue;
        for (const save of object.saves as Record<string, unknown>[]) {
          expect(
            (save.ability !== undefined) !==
              (save.abilityOptions !== undefined),
            `${record.key} save must carry exactly one of ability or abilityOptions`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('O2: printed sub-traps in one record', () => {
  it('splits hazard:pits into its four printed traps with their own projections', () => {
    const pits = byKey('hazard:pits');
    const variants = pits.data.variants as {
      name: string;
      text: string;
      mechanics?: Record<string, unknown>;
    }[];
    expect(variants.map((variant) => variant.name)).toEqual([
      'Simple Pit',
      'Hidden Pit',
      'Locking Pit',
      'Spiked Pit',
    ]);
    for (const variant of variants) {
      expect(String(pits.data.description)).toContain(variant.text);
      expect(variant.text.startsWith(`${variant.name}. `)).toBe(true);
    }
    const [, , , spiked] = variants;
    expect(spiked.mechanics).toEqual({
      saves: [{ ability: 'constitution', dc: 13, damageOnSuccess: 'half' }],
      damage: [
        { average: 11, dice: '2d10', type: 'piercing' },
        { average: 22, dice: '4d10', type: 'poison' },
      ],
    });
    // Only the Spiked Pit poison variant carries a save; no other pit does.
    for (const variant of variants.slice(0, 3)) {
      expect(variant.mechanics).toBeUndefined();
    }
    expect(pits.data.mechanics).toBeUndefined();
  });

  it('keeps single-trap hazard records on record-level mechanics', () => {
    const roof = byKey('hazard:collapsing-roof');
    expect(roof.data.variants).toBeUndefined();
    expect(roof.data.mechanics).toBeDefined();
  });
});

describe('O5: option prose does not hoist into the parent feature', () => {
  it('keeps find-familiar on the Pact of the Chain option only', () => {
    const boon = byKey('feature:warlock:pact-boon');
    expect(boon.data.mechanics).toBeUndefined();
    const options = (
      boon.data.choices as { options: Record<string, unknown>[] }[]
    )[0].options;
    const byId = new Map(options.map((option) => [option.id, option]));
    expect(byId.get('pact-boon:pact-of-the-chain')?.mechanics).toEqual({
      spellGrants: [{ spell: 'spell:find-familiar' }],
    });
    expect(byId.get('pact-boon:pact-of-the-blade')?.mechanics).toBeUndefined();
    expect(byId.get('pact-boon:pact-of-the-tome')?.mechanics).toBeUndefined();
  });

  it('derives every parent projection from non-option prose', () => {
    const checked: string[] = [];
    for (const record of records) {
      if (record.kind !== 'feature') continue;
      const choices = record.data.choices as
        | { options?: { text?: string }[] }[]
        | undefined;
      if (choices === undefined) continue;
      const optionTexts = choices.flatMap((choice) =>
        (choice.options ?? [])
          .map((option) => option.text)
          .filter((text): text is string => typeof text === 'string'),
      );
      const description = String(record.data.description);
      const prose = optionTexts.reduce(
        (remaining, text) => remaining.replace(text, ' '),
        description,
      );
      const mechanics = record.data.mechanics as
        | Record<string, unknown>
        | undefined;
      if (mechanics === undefined) continue;
      checked.push(record.key);
      for (const grant of (mechanics.spellGrants ?? []) as {
        spell: string;
      }[]) {
        const name = grant.spell.replace(/^spell:/, '').replace(/-/g, ' ');
        expect(
          prose.toLowerCase(),
          `${record.key} spellGrants ${grant.spell}`,
        ).toContain(name);
      }
      for (const condition of (mechanics.conditions ?? []) as {
        condition: string;
      }[]) {
        expect(
          prose.toLowerCase(),
          `${record.key} condition ${condition.condition}`,
        ).toContain(condition.condition);
      }
      for (const save of (mechanics.saves ?? []) as { ability?: string }[]) {
        if (save.ability === undefined) continue;
        expect(
          prose.toLowerCase(),
          `${record.key} save ${save.ability}`,
        ).toContain(`${save.ability} saving throw`);
      }
    }
    expect(checked).toContain('feature:draconic-bloodline:dragon-ancestor');
    expect(checked).toContain('feature:fighter:fighting-style');
  });
});
