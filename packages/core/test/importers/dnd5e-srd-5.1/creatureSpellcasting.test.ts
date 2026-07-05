import { describe, expect, it } from 'vitest';
import { parseCreatureSpellcasting } from '../../../scripts/importers/dnd5e-srd-5.1/creatureSpellcasting.js';

const KNOWN_SPELLS = new Set([
  'spell:disguise-self',
  'spell:major-image',
  'spell:charm-person',
  'spell:mirror-image',
  'spell:scrying',
  'spell:suggestion',
  'spell:geas',
  'spell:light',
  'spell:sacred-flame',
  'spell:thaumaturgy',
  'spell:bless',
  'spell:cure-wounds',
  'spell:sanctuary',
  'spell:sleep',
  'spell:heat-metal',
  'spell:enlarge-reduce',
  'spell:tongues',
  'spell:detect-magic',
]);

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const resolve = (candidate: string): string | undefined => {
  const ref = `spell:${slug(candidate)}`;
  return KNOWN_SPELLS.has(ref) ? ref : undefined;
};

describe('parseCreatureSpellcasting (eshyra-o9bd.18.7.3)', () => {
  it('parses the Lamia innate form: ability, DC, component waiver, and groups', () => {
    const parsed = parseCreatureSpellcasting(
      'Innate Spellcasting',
      'The lamia’s innate spellcasting ability is Charisma (spell save DC 13). It can innately cast the following spells, requiring no material components. At will: disguise self (any humanoid form), major image 3/day each: charm person, mirror image, scrying, suggestion 1/day: geas',
      resolve,
    );
    expect(parsed).toEqual({
      mode: 'innate',
      ability: 'charisma',
      saveDC: 13,
      componentRequirement: 'no-material',
      groups: [
        {
          frequency: 'at-will',
          spells: [
            { ref: 'spell:disguise-self', note: 'any humanoid form' },
            { ref: 'spell:major-image' },
          ],
        },
        {
          frequency: 'per-day',
          uses: 3,
          each: true,
          spells: [
            { ref: 'spell:charm-person' },
            { ref: 'spell:mirror-image' },
            { ref: 'spell:scrying' },
            { ref: 'spell:suggestion' },
          ],
        },
        {
          frequency: 'per-day',
          uses: 1,
          spells: [{ ref: 'spell:geas' }],
        },
      ],
    });
  });

  it('parses the Acolyte prepared form: caster level, list class, slots', () => {
    const parsed = parseCreatureSpellcasting(
      'Spellcasting',
      'The acolyte is a 1st-level spellcaster. Its spellcasting ability is Wisdom (spell save DC 12, +4 to hit with spell attacks). The acolyte has following cleric spells prepared: Cantrips (at will): light, sacred flame, thaumaturgy 1st level (3 slots): bless, cure wounds, sanctuary',
      resolve,
    );
    expect(parsed).toMatchObject({
      mode: 'prepared',
      ability: 'wisdom',
      saveDC: 12,
      attackBonus: 4,
      casterLevel: 1,
      listClass: 'cleric',
    });
    expect(parsed?.groups).toEqual([
      {
        frequency: 'cantrip',
        spells: [
          { ref: 'spell:light' },
          { ref: 'spell:sacred-flame' },
          { ref: 'spell:thaumaturgy' },
        ],
      },
      {
        frequency: 'slot-level',
        level: 1,
        slots: 3,
        spells: [
          { ref: 'spell:bless' },
          { ref: 'spell:cure-wounds' },
          { ref: 'spell:sanctuary' },
        ],
      },
    ]);
  });

  it('parses the single-spell mephit form: per-day frequency from the trait-name limit and the inline save DC', () => {
    const parsed = parseCreatureSpellcasting(
      'Innate Spellcasting (1/Day)',
      'The mephit can innately cast heat metal (spell save DC 10), requiring no material components. Its innate spellcasting ability is Charisma.',
      resolve,
    );
    expect(parsed).toEqual({
      mode: 'innate',
      ability: 'charisma',
      saveDC: 10,
      componentRequirement: 'no-material',
      groups: [
        {
          frequency: 'per-day',
          uses: 1,
          spells: [{ ref: 'spell:heat-metal' }],
        },
      ],
    });
  });

  it('parses a slash-named spell and a headerless "N/day:" group (Efreeti)', () => {
    const parsed = parseCreatureSpellcasting(
      'Innate Spellcasting',
      'The efreeti’s innate spellcasting ability is Charisma (spell save DC 15, +7 to hit with spell attacks). It can innately cast the following spells, requiring no material components: At will: detect magic 3/day: enlarge/reduce, tongues',
      resolve,
    );
    expect(parsed?.groups).toEqual([
      { frequency: 'at-will', spells: [{ ref: 'spell:detect-magic' }] },
      {
        frequency: 'per-day',
        uses: 3,
        spells: [{ ref: 'spell:enlarge-reduce' }, { ref: 'spell:tongues' }],
      },
    ]);
  });

  it('fails closed when any spell token does not resolve', () => {
    const parsed = parseCreatureSpellcasting(
      'Innate Spellcasting',
      'The hag’s innate spellcasting ability is Charisma (spell save DC 14). She can innately cast the following spells, requiring no material components: At will: detect magic 1/day each: charm person, not a real spell',
      resolve,
    );
    expect(parsed).toBeUndefined();
  });

  it('fails closed without a resolver and on non-spellcasting traits', () => {
    expect(
      parseCreatureSpellcasting(
        'Innate Spellcasting',
        'The lamia’s innate spellcasting ability is Charisma (spell save DC 13). At will: disguise self',
        undefined,
      ),
    ).toBeUndefined();
    expect(
      parseCreatureSpellcasting(
        'Magic Resistance',
        'The hag has advantage on saving throws against spells and other magical effects.',
        resolve,
      ),
    ).toBeUndefined();
  });
});
