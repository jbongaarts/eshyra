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

/** Option names and option texts removed from a feature's own body. */
function nonOptionProse(record: PackRecord): string {
  const choices = (record.data.choices ?? []) as {
    options?: { name?: string; text?: string }[];
  }[];
  // The body is the description plus any printed subsections (the parent
  // projection is derived from both; see reconstructFeatureText).
  const sections = (record.data.sections ?? []) as {
    name?: string;
    text?: string;
  }[];
  let prose = [
    String(record.data.description),
    ...sections.map(
      (section) => `${section.name ?? ''}. ${section.text ?? ''}`,
    ),
  ].join(' ');
  for (const choice of choices) {
    for (const option of choice.options ?? []) {
      if (typeof option.text === 'string')
        prose = prose.replace(option.text, ' ');
      if (typeof option.name === 'string')
        prose = prose.replace(option.name, ' ');
    }
  }
  return prose.toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Witness phrase for each parent effect kind. A parent effect is valid only
 * when its printed phrase occurs in the feature's non-option prose. Kinds
 * without a witness fail closed so a new kind needs an explicit reviewed
 * phrase here.
 */
const PARENT_EFFECT_WITNESSES: Readonly<
  Record<string, (effect: Record<string, unknown>) => RegExp | undefined>
> = {
  expertise: () => /proficiency bonus is doubled/,
  // "Your spell save DC" in the spellcasting body (SRD 5.1 class spellcasting).
  saveDcFormula: () => /\bsave dc\b/,
  // Skill/tool/language grants print "you gain proficiency with" or "proficient".
  proficiency: () => /\bproficien/,
  // Channel Divinity healing prints "restore a number of hit points".
  healing: () => /\bhit points\b/,
  // Favored Enemy's check benefit prints "advantage" on the ability checks.
  abilityCheckModifier: () => /\badvantage\b|\bcheck\b/,
  extraDamage: (effect) =>
    typeof effect.dice === 'string'
      ? new RegExp(effect.dice.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      : undefined,
  evasion: () => /\bevasion\b/,
  damageReduction: () => /\bhalf\b|\bhalve\b/,
};

/** Each parent projection (saves, conditions, effects, spellGrants) that the
 * feature's non-option prose does not print. */
function parentProjectionViolations(record: PackRecord): string[] {
  const prose = nonOptionProse(record);
  const mechanics = (record.data.mechanics ?? {}) as Record<string, unknown>;
  const violations: string[] = [];
  for (const grant of (mechanics.spellGrants ?? []) as { spell: string }[]) {
    const name = grant.spell.replace(/^spell:/, '').replace(/-/g, ' ');
    if (!prose.includes(name)) violations.push(`spellGrants ${grant.spell}`);
  }
  for (const condition of (mechanics.conditions ?? []) as {
    condition: string;
  }[]) {
    if (!prose.includes(condition.condition))
      violations.push(`condition ${condition.condition}`);
  }
  for (const save of (mechanics.saves ?? []) as { ability?: string }[]) {
    if (
      save.ability !== undefined &&
      !prose.includes(`${save.ability} saving throw`)
    )
      violations.push(`save ${save.ability}`);
  }
  ((mechanics.effects ?? []) as Record<string, unknown>[]).forEach(
    (effect, index) => {
      const kind = String(effect.kind);
      const witness = PARENT_EFFECT_WITNESSES[kind]?.(effect);
      if (witness === undefined || !witness.test(prose))
        violations.push(
          `effects[${index}] ${kind}${effect.dice ? ` ${String(effect.dice)}` : ''}`,
        );
    },
  );
  return violations;
}

/** A copy of a feature record with its parent mechanics replaced in memory. */
function withParentMechanics(
  record: PackRecord,
  mechanics: Record<string, unknown>,
): PackRecord {
  return { ...record, data: { ...record.data, mechanics } };
}

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
      if (record.data.choices === undefined) continue;
      if (record.data.mechanics === undefined) continue;
      checked.push(record.key);
      expect(
        parentProjectionViolations(record),
        `${record.key} parent projection derived from option prose`,
      ).toEqual([]);
    }
    // Legitimate parent projections stay valid: Dragon Ancestor's expertise is
    // printed in the parent prose, and fighter fighting-style procedures are
    // option-keyed (each option carries its own effect).
    expect(checked).toContain('feature:draconic-bloodline:dragon-ancestor');
    expect(checked).toContain('feature:fighter:fighting-style');
  });

  // Negative controls (eshyra-o9bd.19.3.1.3, S2): the two source-backed bad
  // states this invariant exists to reject. Each is injected in memory into a
  // copy of the committed record; the predicate must report it.
  it('rejects the source-backed option-only effects when restored to the parent', () => {
    const hunters = byKey('feature:hunter:hunters-prey');
    const restoredHunters = withParentMechanics(hunters, {
      effects: [{ kind: 'extraDamage', dice: '1d8' }],
    });
    expect(parentProjectionViolations(restoredHunters)).toEqual([
      expect.stringContaining('effects[0] extraDamage 1d8'),
    ]);

    const superior = byKey('feature:hunter:superior-hunters-defense');
    const restoredSuperior = withParentMechanics(superior, {
      saves: [{ ability: 'dexterity' }],
      effects: [
        { kind: 'evasion' },
        {
          kind: 'damageReduction',
          multiplier: 0.5,
          scope: 'triggering-attack',
        },
      ],
    });
    const violations = parentProjectionViolations(restoredSuperior);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('effects[0] evasion'),
        expect.stringContaining('effects[1] damageReduction'),
      ]),
    );
  });
});

describe('O3b: alternative damage types in one roll', () => {
  it('projects fire-shield as one roll whose type is warm-fire or cold by its shield', () => {
    expect(byKey('spell:fire-shield').data.mechanics).toMatchObject({
      damage: [
        {
          dice: '2d8',
          typeOptions: [
            { type: 'fire', condition: 'from a warm shield' },
            { type: 'cold', condition: 'from a cold shield' },
          ],
        },
      ],
    });
  });

  it('projects spirit-guardians as one roll whose type depends on the caster alignment', () => {
    expect(byKey('spell:spirit-guardians').data.mechanics).toMatchObject({
      damage: [
        {
          dice: '3d8',
          typeOptions: [
            { type: 'radiant', condition: 'if you are good or neutral' },
            { type: 'necrotic', condition: 'if you are evil' },
          ],
        },
      ],
    });
  });

  it('never projects two cumulative damage entries for one printed alternative-type pair', () => {
    const grammar =
      /(\d+d\d+(?: [+-] \d+)?) ([a-z]+) damage(?: \([^)]*\)| from [^,.;]+)?,? or \1 ([a-z]+) damage/i;
    const checked: string[] = [];
    for (const record of records) {
      if (record.kind !== 'spell' && record.kind !== 'magic-item') continue;
      const text = JSON.stringify(record.data).replace(/\\"/g, '"');
      const match = grammar.exec(text);
      if (match === null) continue;
      checked.push(record.key);
      const damage = ((record.data.mechanics as Record<string, unknown>)
        ?.damage ?? []) as Record<string, unknown>[];
      const cumulative = damage.filter(
        (entry) =>
          entry.dice === match[1] &&
          (entry.type === match[2].toLowerCase() ||
            entry.type === match[3].toLowerCase()),
      );
      expect(
        cumulative.length,
        `${record.key} projects both alternatives cumulatively`,
      ).toBeLessThanOrEqual(1);
      expect(
        damage.some((entry) => Array.isArray(entry.typeOptions)),
        `${record.key} prints "${match[0]}" without a typeOptions entry`,
      ).toBe(true);
    }
    expect(checked.sort()).toEqual([
      'spell:fire-shield',
      'spell:spirit-guardians',
    ]);
  });
});

// eshyra-o9bd.19.3.1.3 (S1): a non-creature target restricted by printed sight
// ("can see", "visible", "see each other") must carry that sight restriction in
// its projection. Population: every non-creature record with a projected target
// field whose own printed text uses sight wording.
const SIGHT_SOURCE_RE =
  /\bcan see\b|\bvisible\b|\bsee each other\b|\bthat you can see\b/i;
const SIGHT_PROJECTION_RE = /\bsee\b|\bvisible\b|\bsight\b/i;
const TARGET_KEYS = new Set([
  'target',
  'targets',
  'targetTypes',
  'targetQualifier',
  'excludesTargetTypes',
]);

function hasProjectedTarget(value: unknown): boolean {
  for (const object of objectsIn(value)) {
    if (Object.keys(object).some((key) => TARGET_KEYS.has(key))) return true;
  }
  return false;
}

/** The sight-restricted projection test: a target string or a boolean sight flag. */
function projectsSight(data: Record<string, unknown>): boolean {
  for (const object of objectsIn(data)) {
    for (const [key, value] of Object.entries(object)) {
      if (key === 'requiresSight' || key === 'requiresMutualSight') {
        if (value === true) return true;
      }
      if (TARGET_KEYS.has(key)) {
        const strings = Array.isArray(value) ? value : [value];
        if (
          strings.some(
            (item) =>
              typeof item === 'string' && SIGHT_PROJECTION_RE.test(item),
          )
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function sightCohort(): PackRecord[] {
  return records.filter(
    (record) =>
      record.kind !== 'creature' &&
      hasProjectedTarget(record.data) &&
      SIGHT_SOURCE_RE.test(
        JSON.stringify({
          d: record.data.description,
          t: record.data.text,
          h: record.data.higherLevels,
        }),
      ),
  );
}

describe('S1: sight restrictions survive into non-creature target projections', () => {
  it('projects the printed sight restriction for every visibility-cohort record', () => {
    const cohort = sightCohort();
    expect(cohort.map((record) => record.key).sort()).toEqual([
      'feature:school-of-evocation:sculpt-spells',
      'magic-item:eyes-of-charming',
      'magic-item:gem-of-brightness',
      'magic-item:iron-flask',
      'magic-item:ring-of-the-ram',
      'magic-item:robe-of-scintillating-colors',
      'magic-item:rod-of-lordly-might',
      'magic-item:rope-of-entanglement',
      'magic-item:wand-of-paralysis',
    ]);
    for (const record of cohort) {
      expect(
        projectsSight(record.data),
        `${record.key} omits its printed sight restriction`,
      ).toBe(true);
    }
  });

  it('flags a visibility-cohort record whose sight qualifier is removed (negative control)', () => {
    const iron = byKey('magic-item:iron-flask');
    const stripped = JSON.parse(
      JSON.stringify(iron.data)
        .replace(/ that you can see/g, '')
        .replace(/"requiresSight":true,?/g, ''),
    ) as Record<string, unknown>;
    expect(projectsSight(stripped)).toBe(false);
  });
});
