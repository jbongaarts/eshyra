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

/**
 * INDEPENDENT source-phrase reader (eshyra-o9bd.19.4.1.3). It shares no
 * regular expression or code with the importer: it tokenizes each description
 * sentence and walks the tokens, so a grammatical family the importer's
 * recognizer misses is still seen here.
 */
interface Dimension {
  readonly shape: string;
  readonly size: number;
  readonly height?: number;
  readonly width?: number;
}

const isNumber = (token: string | undefined): boolean =>
  token !== undefined && /^\d+$/.test(token);

function tokenize(sentence: string): string[] {
  return sentence
    .toLowerCase()
    .replace(/[\u00ad‐-―-]/g, ' ')
    .replace(/,/g, ' , ')
    .replace(/[.()“”]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function dimensionsOf(sentence: string): Dimension[] {
  const t = tokenize(sentence);
  const found: Dimension[] = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] === 'mile' && t[i + 1] === 'radius') {
      found.push({ shape: 'mile-radius', size: 0 });
      continue;
    }
    if (!isNumber(t[i])) continue;
    const n = Number(t[i]);
    if (t[i + 1] === 'feet') {
      if (t[i - 1] === 'of' && t[i - 2] === 'radius')
        found.push({ shape: 'radius', size: n });
      else if (
        t[i + 2] === 'long' &&
        t[i + 3] === 'and' &&
        isNumber(t[i + 4]) &&
        t[i + 6] === 'wide' &&
        t.slice(Math.max(0, i - 6), i).includes('line')
      )
        found.push({ shape: 'line', size: n, width: Number(t[i + 4]) });
      continue;
    }
    if (t[i + 1] !== 'foot') continue;
    const word = t[i + 2];
    if (word === 'radius') {
      let k = i + 3;
      if (t[k] === ',') k++;
      if (
        isNumber(t[k]) &&
        t[k + 1] === 'foot' &&
        (t[k + 2] === 'high' || t[k + 2] === 'tall') &&
        t[k + 3] === 'cylinder'
      ) {
        found.push({ shape: 'cylinder', size: n, height: Number(t[k]) });
        i = k + 3;
      } else if (t[k] === 'sphere' || t[k] === 'hemisphere') {
        found.push({ shape: t[k], size: n });
      } else {
        found.push({ shape: 'radius', size: n });
      }
    } else if (word === 'cube' || word === 'cone') {
      found.push({ shape: word, size: n });
    } else if (
      (word === 'tall' || word === 'high') &&
      t[i + 3] === 'cylinder' &&
      t[i + 4] === 'with' &&
      isNumber(t[i + 6]) &&
      t[i + 7] === 'foot' &&
      t[i + 8] === 'radius'
    ) {
      found.push({ shape: 'cylinder', size: Number(t[i + 6]), height: n });
      i += 8;
    } else if (
      word === 'wide' &&
      t[i + 3] === ',' &&
      isNumber(t[i + 4]) &&
      t[i + 5] === 'foot' &&
      t[i + 6] === 'long' &&
      t[i + 7] === 'line'
    ) {
      found.push({ shape: 'line', size: Number(t[i + 4]), width: n });
    }
  }
  return found;
}

function sentencesOf(description: string): string[] {
  return description
    .replace(/- foot/g, '-foot')
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence.length > 0);
}

type Expectation =
  | { readonly kind: 'projected'; readonly area: Mechanics }
  | { readonly kind: 'unprojected'; readonly reason: string };

/**
 * What the printed text says the area is: a sentence DEFINES the effect area
 * only when it prints exactly one supported dimension phrase together with an
 * anchor (a point within range, or the caster). Dimensions without an anchor
 * are subordinate and ignored; competing definitions are unprojected.
 */
function expectedAreaOf(description: string, range: string): Expectation {
  const sentences = sentencesOf(description);
  const pointPrinted = sentences.some((sentence) => {
    const lower = sentence.toLowerCase();
    const at = lower.indexOf('point');
    return at >= 0 && lower.indexOf('within range', at) > at;
  });
  const defining: { dim: Dimension; origin: string }[] = [];
  for (const sentence of sentences) {
    const dims = dimensionsOf(sentence);
    if (dims.length === 0) continue;
    const lower = sentence.toLowerCase();
    let origin: string | undefined;
    if (/\beach point\b/.test(lower))
      return { kind: 'unprojected', reason: 'several origin points' };
    const at = lower.indexOf('point');
    if (
      (at >= 0 && lower.indexOf('within range', at) > at) ||
      (pointPrinted && lower.includes('that point'))
    )
      origin = 'point-within-range';
    else if (lower.includes('around you') || lower.includes('centered on you'))
      origin = 'self';
    if (origin === undefined) continue;
    if (dims.length !== 1)
      return { kind: 'unprojected', reason: 'two shapes in one clause' };
    defining.push({ dim: dims[0], origin });
  }
  const rangeMatch = /^Self \((\d+)-(foot|mile)/.exec(range);
  if (rangeMatch !== null) {
    // Range-printed self area: shape/size/unit from the parenthetical; a
    // line's width comes from the description's matching "N feet long and M
    // feet wide".
    const size = Number(rangeMatch[1]);
    const noun = ['sphere', 'hemisphere', 'cone', 'line', 'cube'].find((word) =>
      range.includes(word),
    );
    const lineWidth =
      noun === 'line'
        ? sentences
            .flatMap(dimensionsOf)
            .find((dim) => dim.shape === 'line' && dim.size === size)?.width
        : undefined;
    return {
      kind: 'projected',
      area: {
        shape:
          noun === 'sphere' && range.includes('hemisphere')
            ? 'hemisphere'
            : (noun ?? 'radius'),
        size,
        ...(lineWidth === undefined ? {} : { width: lineWidth }),
        unit: rangeMatch[2],
        origin: 'self',
      },
    };
  }
  if (defining.length === 0)
    return { kind: 'unprojected', reason: 'no defining clause' };
  const first = JSON.stringify(defining[0]);
  if (defining.some((item) => JSON.stringify(item) !== first))
    return { kind: 'unprojected', reason: 'competing definitions' };
  const { dim, origin } = defining[0];
  if (dim.shape === 'mile-radius')
    return { kind: 'unprojected', reason: 'mile-scale alternative' };
  return {
    kind: 'projected',
    area: {
      shape: dim.shape,
      size: dim.size,
      ...(dim.height === undefined ? {} : { height: dim.height }),
      ...(dim.width === undefined ? {} : { width: dim.width }),
      unit: 'foot',
      origin,
    },
  };
}

/** Loose population: any sentence printing N feet beside a shape noun. */
function printsDimensionFamily(description: string): boolean {
  return sentencesOf(description).some(
    (sentence) =>
      /\d+[\s\u00ad‐-―-]*(?:foot|feet)/i.test(sentence) &&
      /\b(?:radius|cubes?|cones?|cylinder|sphere|hemisphere|line)\b/i.test(
        sentence,
      ),
  );
}

/**
 * Population members whose source does NOT define one supported effect area,
 * each with the clause-level reason (checked against the SRD 5.1 PDF text).
 * Every entry must be unprojected by the importer AND by the independent
 * reader; a member that becomes projectable must leave this list.
 */
const REVIEWED_UNPROJECTED: Readonly<Record<string, string>> = {
  'spell:alarm':
    '"an area within range that is no larger than a 20-foot cube": a maximum bound with no printed origin point.',
  'spell:animate-objects':
    '"blindsight with a radius of 30 feet": a sense radius of the animated object, not an effect area.',
  'spell:antipathy-sympathy':
    'Target is an object, a creature, or "an area no larger than a 200-foot cube": alternatives and a maximum bound, no origin point.',
  'spell:branding-smite':
    '"sheds dim light in a 5-foot radius": a light radius of the marked target, not the spell\'s effect area.',
  'spell:call-lightning':
    'Cloud is a cylinder "centered on a point you can see 100 feet directly above you": not a point within range, and bolts strike at separate points.',
  'spell:commune-with-nature':
    '"the radius is limited to 300 feet": a knowledge-range limit, not an effect area.',
  'spell:conjure-elemental':
    '"an area ... that fills a 10-foot cube within range": the elemental source area, no printed origin point.',
  'spell:control-water':
    '"a cube up to 100 feet on a side": a maximum bound across four alternative uses, no origin point.',
  'spell:create-or-destroy-water':
    'Two alternative modes (rain in a 30-foot cube; fog destruction in a 30-foot cube): no single area, no origin point.',
  'spell:creation':
    '"no larger than a 5-foot cube": an object-size bound, not an effect area.',
  'spell:dancing-lights':
    '"each light sheds dim light in a 10-foot radius": a light radius, not an effect area.',
  'spell:disintegrate':
    '"a 10-foot-cube portion" of a target object: a portion of the target, not an effect area.',
  'spell:druidcraft':
    '"must fit in a 5-foot cube": an effect-size bound, not an effect area.',
  'spell:fabricate':
    '"contained within a 10-foot cube": an object-size bound, not an effect area.',
  'spell:faerie-fire':
    '"Each object in a 20-foot cube within range": no printed origin point (the 10-foot radius is a light radius).',
  'spell:fire-shield':
    '"shedding bright light in a 10-foot radius": a light radius, not an effect area.',
  'spell:fire-storm':
    '"up to ten 10-foot cubes, which you can arrange as you wish": several arranged cubes, not one area.',
  'spell:flame-blade':
    '"sheds bright light in a 10-foot radius": a light radius, not an effect area.',
  'spell:flaming-sphere':
    'A "5-foot-diameter sphere" object that moves, with a 5-foot reach and a 20-foot light radius: object bounds, not an effect area.',
  'spell:glyph-of-warding':
    'Explosive-runes mode "centered on the glyph" (not a point within range) beside a second spell-glyph mode: no single projected origin.',
  'spell:hallow':
    '"The area can have a radius up to 60 feet": a maximum bound around a touched point, not a fixed area.',
  'spell:hallucinatory-terrain':
    '"terrain in a 150-foot cube in range": no printed origin point.',
  'spell:hypnotic-pattern':
    '"inside a 30-foot cube within range": no printed origin point.',
  'spell:light':
    '"sheds bright light in a 20-foot radius": a light radius of the object, not an effect area.',
  'spell:magnificent-mansion':
    '"the space can\'t exceed 50 cubes, each cube being 10 feet on each side": capacity of an extradimensional space, not an effect area.',
  'spell:major-image':
    '"no larger than a 20-foot cube": an image-size bound, not an effect area.',
  'spell:meteor-swarm':
    '"centered on each point you choose": four origin points, not one area.',
  'spell:minor-illusion':
    '"no larger than a 5-foot cube": an image-size bound, not an effect area.',
  'spell:plant-growth':
    'Two alternative uses: a 100-foot radius (1 action) or a half-mile radius (8 hours): the foot-unit area cannot represent both.',
  'spell:private-sanctum':
    '"a cube that can be as small as 5 feet to as large as 100 feet on each side": a variable size, no fixed area.',
  'spell:produce-flame':
    '"sheds bright light in a 10-foot radius": a light radius, not an effect area.',
  'spell:programmed-illusion':
    '"no larger than a 30-foot cube": an illusion-size bound, not an effect area.',
  'spell:silent-image':
    '"no larger than a 15-foot cube": an image-size bound, not an effect area.',
  'spell:slow':
    '"six creatures of your choice in a 40-foot cube within range": no printed origin point.',
  'spell:storm-of-vengeance':
    '"centered on a point you can see and spreading to a radius of 360 feet": the origin is a point you can see (range Sight), not a point within range.',
  'spell:symbol':
    '"filling a 60-foot-radius sphere with dim light" on trigger within mode-based effects: no printed origin point.',
  'spell:teleport':
    '"able to fit entirely inside a 10-foot cube": an object-size bound, not an effect area.',
  'spell:wall-of-force':
    '"a hemispherical dome or a sphere with a radius of up to 10 feet": a shape alternative of a wall with a maximum bound.',
  'spell:wall-of-ice':
    '"a hemispherical dome or a sphere with a radius of up to 10 feet": a shape alternative of a wall with a maximum bound.',
  'spell:prismatic-wall':
    '"a sphere up to 30 feet in diameter": an alternative shape of a wall, with no radius phrase to project.',
};

type Mechanics = Record<string, unknown>;

const pack = getBundledDnd5eSrdPack();
const spells = pack.records.filter((record) => record.kind === 'spell');
const population = spells.filter(
  (record) =>
    printsDimensionFamily(String(record.data.description)) ||
    /^Self \(/.test(String(record.data.range)),
);

function mechanicsOf(record: RulesRecord): Mechanics {
  return (record.data.mechanics ?? {}) as Mechanics;
}

/**
 * Compare the COMPLETE typed projection of every population member with the
 * independently read source: deep equality on shape, size, height, width,
 * unit and origin (so a swapped radius/height or a self-for-point origin
 * disagrees), and exact membership of the reviewed-unprojected list.
 */
function areaDisagreements(records: readonly RulesRecord[]): string[] {
  const problems: string[] = [];
  const reviewedKeys = new Set(Object.keys(REVIEWED_UNPROJECTED));
  for (const record of records) {
    const expected = expectedAreaOf(
      String(record.data.description),
      String(record.data.range),
    );
    const actual = mechanicsOf(record).area;
    if (expected.kind === 'projected') {
      if (
        JSON.stringify(sortKeys(actual)) !==
        JSON.stringify(sortKeys(expected.area))
      )
        problems.push(
          `${record.key}: area ${JSON.stringify(actual)} != source ${JSON.stringify(expected.area)}`,
        );
      if (reviewedKeys.has(record.key))
        problems.push(`${record.key}: reviewed-unprojected but projectable`);
    } else {
      if (actual !== undefined)
        problems.push(
          `${record.key}: area ${JSON.stringify(actual)} but source is ${expected.reason}`,
        );
      if (!reviewedKeys.has(record.key))
        problems.push(`${record.key}: unprojected without a reviewed reason`);
    }
  }
  return problems;
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).sort(([x], [y]) =>
      x.localeCompare(y),
    ),
  );
}

describe('spell area population (eshyra-o9bd.19.4.1.3)', () => {
  it('projects exactly what the independently read defining clause prints, or reviews the spell', () => {
    expect(population.length).toBeGreaterThan(0);
    expect(areaDisagreements(population)).toEqual([]);
    for (const reason of Object.values(REVIEWED_UNPROJECTED))
      expect(reason.length).toBeGreaterThan(0);
    const populationKeys = new Set(population.map((record) => record.key));
    for (const key of Object.keys(REVIEWED_UNPROJECTED))
      expect(populationKeys.has(key)).toBe(true);
  });

  it('rejects the Moonbeam mutants: self origin, and swapped radius/height', () => {
    const moonbeam = spells.find(
      (record) => record.key === 'spell:moonbeam',
    ) as RulesRecord;
    expect(areaDisagreements([moonbeam])).toEqual([]);
    const mutate = (area: Mechanics): RulesRecord => {
      const copy = structuredClone(moonbeam);
      (copy.data.mechanics as Mechanics).area = area;
      return copy;
    };
    const original = mechanicsOf(moonbeam).area as Mechanics;
    expect(
      areaDisagreements([mutate({ ...original, origin: 'self' })]),
    ).not.toEqual([]);
    expect(
      areaDisagreements([mutate({ ...original, size: 40, height: 5 })]),
    ).not.toEqual([]);
  });

  it('keeps an identified main area when subordinate dimensions follow (Web, Holy Aura)', () => {
    const areaOf = (key: string) =>
      mechanicsOf(spells.find((record) => record.key === key) as RulesRecord)
        .area;
    expect(areaOf('spell:web')).toEqual({
      shape: 'cube',
      size: 20,
      unit: 'foot',
      origin: 'point-within-range',
    });
    expect(areaOf('spell:holy-aura')).toEqual({
      shape: 'radius',
      size: 30,
      unit: 'foot',
      origin: 'self',
    });
    expect(areaOf('spell:spike-growth')).toEqual({
      shape: 'radius',
      size: 20,
      unit: 'foot',
      origin: 'point-within-range',
    });
    expect(areaOf('spell:sunburst')).toEqual({
      shape: 'radius',
      size: 60,
      unit: 'foot',
      origin: 'point-within-range',
    });
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

  it('keeps the range-printed self area and adds the printed line width', () => {
    const areaOf = (key: string) =>
      mechanicsOf(spells.find((record) => record.key === key) as RulesRecord)
        .area;
    expect(areaOf('spell:burning-hands')).toEqual({
      shape: 'cone',
      size: 15,
      unit: 'foot',
      origin: 'self',
    });
    expect(areaOf('spell:lightning-bolt')).toEqual({
      shape: 'line',
      size: 100,
      width: 5,
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

  it('keeps the defining area over an unanchored subordinate dimension but refuses competing anchored areas', () => {
    expect(
      deriveSpellMechanics(
        extraction(
          'A cloud forms a 20-foot-radius sphere centered on a point within range. A 5-foot cube of it burns.',
        ),
      ).area,
    ).toEqual({
      shape: 'sphere',
      size: 20,
      unit: 'foot',
      origin: 'point-within-range',
    });
    expect(
      deriveSpellMechanics(
        extraction(
          'A cloud forms a 20-foot-radius sphere centered on a point within range. A 10-foot cube centered on that point burns.',
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
