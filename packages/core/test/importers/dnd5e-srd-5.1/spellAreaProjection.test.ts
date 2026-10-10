/**
 * Spell area and projectile-count projections (eshyra-o9bd.19.4.1.1).
 *
 * The population is every spell whose description prints an N-foot shape
 * phrase. Each member is either typed (`mechanics.area`) with a shape and size
 * the printed phrase carries, or listed in REVIEWED_UNPROJECTED with the reason
 * it is not one defined effect area. Membership is computed from the committed
 * pack, never hand-copied, so the test follows the data rather than a snapshot.
 */
import { describe, expect, it } from 'vitest';
import { deriveSpellMechanics } from '../../../scripts/importers/dnd5e-srd-5.1/mechanicsProjections.js';
import type { SpellExtraction } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
import { getBundledDnd5eSrdPack } from '../../../src/rules/bundledSrdPack.js';
import { validateRecordKindSchema } from '../../../src/rules/kindSchemas.js';
import type { RulesRecord } from '../../../src/rules/types.js';

const SHAPE_PHRASE =
  /\b\d+-foot(?:-radius)?(?:,? \d+-foot[- ](?:tall|high))?[ -](?:sphere|cube|cone|cylinder|hemisphere)\b|\b\d+-foot-tall cylinder with a \d+-foot radius\b|\b\d+-foot-radius circle\b|\b\d+-foot-radius\b|\bline (?:of [a-z ]+ )?\d+ feet long\b|\b\d+-foot-wide, \d+-foot-long line\b/i;

const SHAPE_NOUNS: Readonly<Record<string, RegExp>> = {
  sphere: /sphere/,
  cube: /cube/,
  cone: /cone/,
  cylinder: /cylinder/,
  hemisphere: /hemisphere/,
  line: /line/,
  radius: /radius|circle/,
};

const ORIGINS = new Set(['self', 'point-within-range', 'creature', 'object']);

/**
 * Population members with no typed area, each with the reason it is not one
 * defined effect area or has no printed origin. Reviewed against the source
 * sentence; an entry is never a silent skip.
 */
const REVIEWED_UNPROJECTED: Readonly<Record<string, string>> = {
  'spell:alarm':
    'Warded area chosen within range and bounded by a maximum size; no printed origin point.',
  'spell:antipathy-sympathy':
    'Target alternatives (object, creature, or area no larger than a 200-foot cube); no printed origin point.',
  'spell:conjure-elemental':
    'Elemental area that fills a 10-foot cube within range; no printed origin point.',
  'spell:create-or-destroy-water':
    'Two alternative modes (rain in a 30-foot cube; fog destruction in a 30-foot cube); no single area.',
  'spell:creation':
    'Object-size bound (no larger than a 5-foot cube), not an effect area.',
  'spell:disintegrate':
    'Portion of a target object (a 10-foot-cube portion), not an effect area.',
  'spell:druidcraft':
    'Effect size bound (must fit in a 5-foot cube), not an effect area.',
  'spell:fabricate':
    'Object size bound (contained within a 10-foot cube), not an effect area.',
  'spell:faerie-fire':
    'Objects in a 20-foot cube within range; no printed origin point.',
  'spell:glyph-of-warding':
    'Explosive-runes mode centered on the glyph, with no printed point within range, and a second spell-glyph mode; no single projected origin.',
  'spell:hallucinatory-terrain':
    'Natural terrain in a 150-foot cube in range; no printed origin point.',
  'spell:hypnotic-pattern':
    'Pattern inside a 30-foot cube within range; no printed origin point.',
  'spell:major-image':
    'Image size bound (no larger than a 20-foot cube), not an effect area.',
  'spell:meteor-swarm':
    'Four printed origin points (each point you choose); several origins are not one area.',
  'spell:minor-illusion':
    'Image size bound (no larger than a 5-foot cube), not an effect area.',
  'spell:programmed-illusion':
    'Illusion size bound (no larger than a 30-foot cube), not an effect area.',
  'spell:silent-image':
    'Image size bound (no larger than a 15-foot cube), not an effect area.',
  'spell:slow':
    'Creatures altered within a 40-foot cube within range; no printed origin point.',
  'spell:symbol':
    'Dim-light sphere and mode-based effects; no printed origin point.',
  'spell:teleport':
    'Object size bound (must fit inside a 10-foot cube), not an effect area.',
  'spell:web':
    'A 20-foot cube from a chosen point, but a second shape sentence (a 5-foot cube of webs) makes the single-area rule fail closed.',
};

type Mechanics = Record<string, unknown>;

const pack = getBundledDnd5eSrdPack();
const spells = pack.records.filter((record) => record.kind === 'spell');
const population = spells.filter((record) =>
  SHAPE_PHRASE.test(String(record.data.description)),
);

function mechanicsOf(record: RulesRecord): Mechanics {
  return (record.data.mechanics ?? {}) as Mechanics;
}

describe('spell area population (eshyra-o9bd.19.4.1.1)', () => {
  it('types or reviews every spell whose description prints a shape phrase', () => {
    const untyped = population
      .filter((record) => mechanicsOf(record).area === undefined)
      .map((record) => record.key)
      .sort();
    expect(untyped).toEqual(Object.keys(REVIEWED_UNPROJECTED).sort());
    for (const reason of Object.values(REVIEWED_UNPROJECTED))
      expect(reason.length).toBeGreaterThan(0);
  });

  it('projects only dimensions the printed phrase carries, with an allowed origin', () => {
    const typed = population.filter(
      (record) => mechanicsOf(record).area !== undefined,
    );
    expect(typed.length).toBeGreaterThan(0);
    for (const record of typed) {
      const area = mechanicsOf(record).area as Record<string, unknown>;
      const text = String(record.data.description);
      const range = String(record.data.range);
      expect(ORIGINS.has(String(area.origin))).toBe(true);
      expect(area.unit).toBe('foot');
      expect(SHAPE_NOUNS[String(area.shape)]).toBeDefined();
      expect(`${text} ${range}`).toMatch(SHAPE_NOUNS[String(area.shape)]);
      expect(`${text} ${range}`).toContain(`${area.size}-foot`);
      if (area.height !== undefined)
        expect(text).toContain(`${area.height}-foot`);
      if (area.width !== undefined)
        expect(text).toContain(`${area.width}-foot`);
      if (area.origin === 'point-within-range')
        expect(text).toMatch(/\bpoint\b/);
    }
  });

  it('projects the printed fireball, cloudkill, and sleet storm areas exactly', () => {
    const areaOf = (key: string) =>
      mechanicsOf(spells.find((record) => record.key === key) as RulesRecord)
        .area;
    expect(areaOf('spell:fireball')).toEqual({
      shape: 'sphere',
      size: 20,
      unit: 'foot',
      origin: 'point-within-range',
    });
    expect(areaOf('spell:cloudkill')).toEqual({
      shape: 'sphere',
      size: 20,
      unit: 'foot',
      origin: 'point-within-range',
    });
    expect(areaOf('spell:sleet-storm')).toEqual({
      shape: 'cylinder',
      size: 40,
      height: 20,
      unit: 'foot',
      origin: 'point-within-range',
    });
  });

  it('keeps the range-printed self area and does not overwrite it', () => {
    const burningHands = spells.find(
      (record) => record.key === 'spell:burning-hands',
    ) as RulesRecord;
    expect(mechanicsOf(burningHands).area).toEqual({
      shape: 'cone',
      size: 15,
      unit: 'foot',
      origin: 'self',
    });
  });
});

describe('description-printed area derivation (eshyra-o9bd.19.4.1.1)', () => {
  const extraction = (
    description: string,
    range = '60 feet',
  ): SpellExtraction =>
    ({
      name: 'Probe Spell',
      level: 2,
      school: 'evocation',
      ritual: false,
      castingTime: '1 action',
      range,
      components: ['V', 'S'],
      duration: 'Instantaneous',
      description,
      sourcePage: 1,
    }) as unknown as SpellExtraction;

  it('projects a raw PDF-artifact cylinder ("20- foot-radius") from the printed sentence', () => {
    const area = deriveSpellMechanics(
      extraction(
        'A hail of rock-hard ice pounds to the ground in a 20- foot-radius, 40-foot-high cylinder centered on a point within range.',
        '300 feet',
      ),
    ).area;
    expect(area).toEqual({
      shape: 'cylinder',
      size: 20,
      height: 40,
      unit: 'foot',
      origin: 'point-within-range',
    });
  });

  it('refuses several origin points and a sentence with no printed point', () => {
    expect(
      deriveSpellMechanics(
        extraction(
          'Each creature in a 40-foot-radius sphere centered on each point you choose within range must save.',
        ),
      ).area,
    ).toBeUndefined();
    expect(
      deriveSpellMechanics(
        extraction('An area of ice fills a 10-foot cube within range.'),
      ).area,
    ).toBeUndefined();
  });

  it('refuses conflicting shape sentences rather than picking one', () => {
    expect(
      deriveSpellMechanics(
        extraction(
          'A cloud forms a 20-foot-radius sphere centered on a point within range. A 5-foot cube of it burns.',
        ),
      ).area,
    ).toBeUndefined();
  });
});

describe('projectile counts (eshyra-o9bd.19.4.1.1)', () => {
  const projectilesOf = (key: string) =>
    mechanicsOf(spells.find((record) => record.key === key) as RulesRecord)
      .projectiles;

  it('projects the printed base counts of the creation and call siblings', () => {
    expect(projectilesOf('spell:magic-missile')).toEqual({
      count: 3,
      noun: 'dart',
    });
    expect(projectilesOf('spell:scorching-ray')).toEqual({
      count: 3,
      noun: 'ray',
    });
    expect(projectilesOf('spell:storm-of-vengeance')).toEqual({
      count: 6,
      noun: 'bolt',
    });
  });

  it('leaves singular beams, leap counts, and level-scaled beams unprojected', () => {
    for (const key of [
      'spell:eldritch-blast',
      'spell:ray-of-frost',
      'spell:ray-of-enfeeblement',
      'spell:chain-lightning',
      'spell:prismatic-spray',
    ])
      expect(projectilesOf(key)).toBeUndefined();
  });
});

describe('spell area and projectile schema (fail closed)', () => {
  const magicMissile = (): RulesRecord => {
    const record = structuredClone(
      spells.find((item) => item.key === 'spell:magic-missile') as RulesRecord,
    );
    return record;
  };
  const withMechanics = (patch: Record<string, unknown>): RulesRecord => {
    const record = magicMissile();
    (record.data.mechanics as Record<string, unknown>).area = undefined;
    Object.assign(record.data.mechanics as Record<string, unknown>, patch);
    return record;
  };

  it('accepts the typed origins and dimensions the importer emits', () => {
    expect(() =>
      validateRecordKindSchema(
        withMechanics({
          area: {
            shape: 'cylinder',
            size: 10,
            height: 20,
            unit: 'foot',
            origin: 'point-within-range',
          },
        }),
        'records[0]',
      ),
    ).not.toThrow();
    expect(() =>
      validateRecordKindSchema(
        withMechanics({
          area: { shape: 'sphere', size: 5, unit: 'foot', origin: 'creature' },
        }),
        'records[0]',
      ),
    ).not.toThrow();
  });

  it('rejects an unknown origin, a stray height, and a non-positive projectile count', () => {
    expect(() =>
      validateRecordKindSchema(
        withMechanics({
          area: { shape: 'sphere', size: 5, unit: 'foot', origin: 'nowhere' },
        }),
        'records[0]',
      ),
    ).toThrow(/origin must be one of/);
    expect(() =>
      validateRecordKindSchema(
        withMechanics({
          area: {
            shape: 'sphere',
            size: 5,
            height: 10,
            unit: 'foot',
            origin: 'self',
          },
        }),
        'records[0]',
      ),
    ).toThrow(/height is only valid on cylinder/);
    expect(() =>
      validateRecordKindSchema(
        withMechanics({ projectiles: { count: 0, noun: 'dart' } }),
        'records[0]',
      ),
    ).toThrow();
  });
});
