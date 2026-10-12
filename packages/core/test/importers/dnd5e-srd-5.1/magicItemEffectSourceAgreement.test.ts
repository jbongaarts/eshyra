/**
 * Magic-item effect source agreement (eshyra-o9bd.19.4.5.1; finding-registry
 * row magic-item-effects).
 *
 * Invariant: a structured magic-item effect does not assert a quantity, a
 * damage type / ability / condition / skill, a spell, a duration unit, or an
 * explicit "no concentration" override that the item's own printed text does
 * not carry. Text means the verbatim description, the item name and rarity, and
 * any table the effect itself references (table-driven values are checked
 * against the printed table).
 *
 * This is a source-AGREEMENT screen, not a capability or completeness claim: an
 * effect no engine executes, or an effect that leaves a printed clause
 * unrepresented, is not a violation here. The screen is necessary, not
 * sufficient; added or dropped scope (which it cannot see) is covered by the
 * representative scope assertions below.
 *
 * The population is enumerated by query, never counted. The exception list
 * names each reviewed, source-backed non-occurrence individually.
 */

import { describe, expect, it } from 'vitest';
import { getBundledDnd5eSrdPack } from '../../../src/internal.js';

type Json = unknown;
type Obj = Record<string, unknown>;
const isObj = (value: Json): value is Obj =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const DAMAGE_TYPES = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
];
const ABILITIES = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];
const CONDITIONS = [
  'blinded',
  'charmed',
  'deafened',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
  'suffocating',
];
/** The eighteen canonical skills (hyphens stand for spaces). */
const SKILLS = [
  'acrobatics',
  'animal handling',
  'arcana',
  'athletics',
  'deception',
  'history',
  'insight',
  'intimidation',
  'investigation',
  'medicine',
  'nature',
  'perception',
  'performance',
  'persuasion',
  'religion',
  'sleight of hand',
  'stealth',
  'survival',
];
/** The canonical senses an effect's `sense` field may carry. */
const SENSES = ['blindsight', 'darkvision', 'tremorsense', 'truesight'];
/**
 * `sense` values that are not canonical senses but descriptive labels of a
 * printed sensory power. Each is individually tied to the printed phrase it
 * summarizes; there is no blanket allowance, and an unlisted non-canonical
 * label is a violation.
 */
const DERIVED_SENSE_LABELS: Readonly<
  Record<string, { readonly label: string; readonly printed: string }>
> = Object.fromEntries(
  [
    [
      'magic-item:dragon-scale-mail',
      'nearest-dragon-of-matching-type',
      'discern the distance and direction to the closest dragon',
    ],
    [
      'magic-item:lantern-of-revealing',
      'reveal-invisible-in-bright-light',
      'Invisible creatures and objects are visible',
    ],
    [
      'magic-item:ring-of-x-ray-vision',
      'x-ray-vision',
      'see into and through solid matter',
    ],
    ['magic-item:robe-of-eyes', 'all-around-vision', 'see in all directions'],
    [
      'magic-item:robe-of-eyes',
      'see-invisible-and-ethereal',
      'see invisible creatures and objects, as well as see into the Ethereal Plane',
    ],
    [
      'magic-item:rod-of-alertness',
      'invisible-hostile-location',
      'sense the location of any invisible hostile creature',
    ],
    [
      'magic-item:rod-of-lordly-might',
      'magnetic-north-and-depth',
      'indicates magnetic north',
    ],
    [
      'magic-item:wand-of-enemy-detection',
      'nearest-hostile-direction',
      'know the direction of the nearest creature hostile to you',
    ],
    [
      'magic-item:wand-of-secrets',
      'nearest-secret-door-or-trap',
      'points at the one nearest to you',
    ],
  ].map(([item, label, printed]) => [
    `${item}|${label}`,
    { label: label as string, printed: printed as string },
  ]),
);
const VOCABULARY_BY_KEY: Readonly<Record<string, readonly string[]>> = {
  type: DAMAGE_TYPES,
  types: DAMAGE_TYPES,
  damageType: DAMAGE_TYPES,
  typeChoice: DAMAGE_TYPES,
  from: DAMAGE_TYPES,
  to: DAMAGE_TYPES,
  ability: ABILITIES,
  abilities: ABILITIES,
  abilityChoice: ABILITIES,
  addAbilityModifier: ABILITIES,
  conditions: CONDITIONS,
  failedSaveCondition: CONDITIONS,
  condition: CONDITIONS,
  skill: SKILLS,
  skills: SKILLS,
  sense: SENSES,
  senses: SENSES,
};

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];
const spelled = (n: number): string =>
  n < 20
    ? (ONES[n] ?? '')
    : `${TENS[Math.floor(n / 10)]}${n % 10 === 0 ? '' : ` ${ONES[n % 10]}`}`;
const NUMBER_IDIOMS: Readonly<Record<number, readonly string[]>> = {
  0.5: ['half'],
  1: ['once', 'single'],
  2: ['twice', 'double'],
  3: ['triple', 'thrice'],
};

/** Lowercased, punctuation-free token string padded for whole-word search. */
const tokens = (text: string): string =>
  ` ${text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[‐-―−]/g, '-')
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/(\d)(?:st|nd|rd|th)\b/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
const hasPhrase = (haystack: string, phrase: string): boolean =>
  haystack.includes(` ${phrase} `);
const numberOccurs = (haystack: string, value: number): boolean => {
  const magnitude = Math.abs(value);
  const forms = [String(magnitude), ...(NUMBER_IDIOMS[magnitude] ?? [])];
  if (Number.isInteger(magnitude) && magnitude < 100)
    forms.push(spelled(magnitude));
  return forms.some((form) => hasPhrase(haystack, form));
};

interface Violation {
  readonly item: string;
  readonly effect: string;
  readonly path: string;
  readonly kind: string;
  readonly value: string;
}

/**
 * Reviewed, source-backed non-occurrences. Each entry is one effect path and
 * value; there is no blanket allowance.
 */
const REVIEWED_EXCEPTIONS: readonly (Violation & { readonly why: string })[] = [
  {
    item: 'magic-item:carpet-of-flying',
    effect: 'm3-carpet-of-flying-speed-multiplier',
    path: 'm3-carpet-of-flying-speed-multiplier.threshold.multiplier',
    kind: 'number',
    value: '1',
    why: 'The threshold is the printed "normal capacity", i.e. 1x the weight shown on the table; the factor 1 is the identity of that table value, not a printed quantity.',
  },
];

function walk(
  node: Json,
  key: string,
  path: string,
  visit: (key: string, value: unknown, path: string) => void,
): void {
  if (Array.isArray(node)) {
    node.forEach((child, index) => {
      walk(child, key, `${path}[${index}]`, visit);
    });
  } else if (isObj(node)) {
    for (const [childKey, child] of Object.entries(node))
      walk(child, childKey, `${path}.${childKey}`, visit);
  } else {
    visit(key, node, path);
  }
}

function screenEffect(
  itemKey: string,
  itemText: string,
  effect: Obj,
  tableText: (ref: string) => string,
): Violation[] {
  const violations: Violation[] = [];
  const effectId = String(effect.id);
  let text = itemText;
  walk(effect, '', effectId, (_key, value) => {
    if (typeof value === 'string' && value.startsWith('table:'))
      text += ` ${tableText(value)}`;
  });
  const haystack = tokens(text);
  const flag = (path: string, kind: string, value: unknown) => {
    violations.push({
      item: itemKey,
      effect: effectId,
      path,
      kind,
      value: String(value),
    });
  };
  walk(effect, '', effectId, (key, value, path) => {
    if (key === 'id' || key === 'kind') return;
    if (typeof value === 'number') {
      if (!numberOccurs(haystack, value)) flag(path, 'number', value);
      return;
    }
    if (typeof value === 'boolean') {
      if (key === 'concentrationRequired' && value === false) {
        if (!/no concentration|need to concentrate/i.test(itemText))
          flag(path, 'boolean', `${key}=false`);
      }
      return;
    }
    if (typeof value !== 'string') return;
    const lower = value.toLowerCase();
    if (key === 'spellRef' || key === 'spellRefs' || key === 'spell') {
      const name = lower.replace(/^spell:/, '').replace(/-/g, ' ');
      if (!hasPhrase(haystack, name)) flag(path, 'spell', value);
      return;
    }
    if (/^(table|magic-item|creature):/.test(value)) return;
    const vocabulary = VOCABULARY_BY_KEY[key];
    const spacedLower = lower.replace(/-/g, ' ');
    if (
      vocabulary?.includes(spacedLower) &&
      !hasPhrase(haystack, tokens(spacedLower).trim())
    )
      flag(path, 'vocabulary', value);
    if (key === 'sense' && !SENSES.includes(lower)) {
      const derived = DERIVED_SENSE_LABELS[`${itemKey}|${lower}`];
      if (
        derived === undefined ||
        !hasPhrase(haystack, tokens(derived.printed).trim())
      )
        flag(path, 'sense-label', value);
    }
    if (key === 'trigger') {
      // A natural-20 trigger is not a critical-hit trigger (a hit on a
      // paralyzed creature in reach is a critical hit on any die result), so
      // each trigger form needs its own printed form.
      if (
        /\bcritical hit\b/.test(lower) &&
        !hasPhrase(haystack, 'critical hit')
      )
        flag(path, 'trigger', value);
      if (
        /\b(?:natural 20|attack roll 20)\b/.test(lower) &&
        !/\broll(?:s|ed)? an? (?:natural )?20\b/i.test(itemText)
      )
        flag(path, 'trigger', value);
    }
    if (key === 'unit' && !hasPhrase(haystack, lower))
      if (!hasPhrase(haystack, `${lower}s`)) flag(path, 'unit', value);
    for (const dice of value.match(/\b\d*d\d+\b/g) ?? []) {
      const full = dice.startsWith('d') ? `1${dice}` : dice;
      if (!hasPhrase(haystack, full) && !hasPhrase(haystack, dice))
        flag(path, 'dice', dice);
    }
    if (vocabulary === undefined) {
      // Free text (result, trigger, condition prose): a damage-type word must
      // be printed, matching word forms by stem (poison / poisoned).
      for (const word of tokens(value).trim().split(' ')) {
        if (
          DAMAGE_TYPES.includes(word) &&
          !haystack.split(' ').some((printed) => printed.startsWith(word))
        )
          flag(path, 'damage-word', word);
      }
    }
    const withoutDice = value.replace(/\b\d*d\d+\b/g, '');
    for (const digits of withoutDice.match(
      /(?<![\w.])\d+(?:\.\d+)?(?![\w])/g,
    ) ?? [])
      if (!numberOccurs(haystack, Number(digits))) flag(path, 'number', digits);
  });
  return violations;
}

const pack = getBundledDnd5eSrdPack();
const recordsByKey = new Map(
  pack.records.map((record) => [record.key, record]),
);
const tableText = (ref: string): string => {
  const table = recordsByKey.get(ref);
  return table === undefined ? '' : JSON.stringify(table.data);
};
/** The population: magic-item records whose mechanics.effects is non-empty. */
const population = pack.records.filter(
  (record) =>
    record.kind === 'magic-item' &&
    isObj(record.data) &&
    isObj(record.data.mechanics) &&
    Array.isArray(record.data.mechanics.effects) &&
    record.data.mechanics.effects.length > 0,
);
const itemText = (record: (typeof population)[number]): string => {
  const data = record.data as Obj;
  return `${String(data.description)} ${record.name} ${String(data.rarity)}`;
};
const effectsOf = (record: (typeof population)[number]): Obj[] =>
  ((record.data as Obj).mechanics as Obj).effects as Obj[];

describe('magic-item effect source agreement (eshyra-o9bd.19.4.5.1)', () => {
  it('enumerates a non-trivial population by query', () => {
    expect(population.length).toBeGreaterThan(0);
    expect(population.flatMap(effectsOf).length).toBeGreaterThan(
      population.length,
    );
  });

  it('every emitted quantity, vocabulary value, spell, and concentration override occurs in the printed item text', () => {
    const violations = population.flatMap((record) =>
      effectsOf(record).flatMap((effect) =>
        screenEffect(record.key, itemText(record), effect, tableText),
      ),
    );
    const unreviewed = violations.filter(
      (violation) =>
        !REVIEWED_EXCEPTIONS.some(
          (exception) =>
            exception.item === violation.item &&
            exception.path === violation.path &&
            exception.kind === violation.kind &&
            exception.value === violation.value,
        ),
    );
    expect(unreviewed).toEqual([]);
    // An exception that no longer fires is stale and must be removed.
    for (const exception of REVIEWED_EXCEPTIONS)
      expect(
        violations.some(
          (violation) =>
            violation.item === exception.item &&
            violation.path === exception.path &&
            violation.value === exception.value,
        ),
      ).toBe(true);
  });

  it('discriminates: altered vocabulary, quantity, and an added concentration override are caught', () => {
    const feather = recordsByKey.get('magic-item:feather-token');
    const base = {
      id: 'probe',
      kind: 'triggeredEffect',
      result: 'resolve +9 attack for 1d6+5 force damage',
      attackModifier: 9,
      damage: { dice: '1d6+5', type: 'force' },
    };
    if (feather === undefined) throw new Error('feather token missing');
    const text = `${String((feather.data as Obj).description)} Feather Token`;
    const screen = (effect: Obj) =>
      screenEffect('probe', text, effect, () => '');
    expect(screen(base)).toEqual([]);
    expect(
      screen({ ...base, damage: { dice: '1d6+5', type: 'slashing' } }).map(
        (violation) => violation.kind,
      ),
    ).toEqual(['vocabulary']);
    expect(
      screen({ ...base, attackModifier: 11 }).map(
        (violation) => violation.kind,
      ),
    ).toEqual(['number']);
    expect(
      screen({ ...base, concentrationRequired: false }).map(
        (violation) => violation.kind,
      ),
    ).toEqual(['boolean']);
  });

  it('discriminates canonical sense and skill substitutions and trigger forms', () => {
    const probe = (itemKey: string, id: string, patch: Obj) => {
      const record = recordsByKey.get(itemKey);
      if (record === undefined) throw new Error(itemKey);
      const found = effectsOf(record as never).find((candidate) =>
        String(candidate.id).endsWith(id),
      );
      if (found === undefined) throw new Error(`${itemKey} ${id}`);
      return {
        clean: screenEffect(
          itemKey,
          itemText(record as never),
          found,
          tableText,
        ),
        altered: screenEffect(
          itemKey,
          itemText(record as never),
          { ...found, ...patch },
          tableText,
        ).map((violation) => violation.kind),
      };
    };
    // Truesight -> blindsight (a canonical sense the item never prints).
    const gem = probe('magic-item:gem-of-seeing', 'sense-truesight', {
      sense: 'blindsight',
    });
    expect(gem.clean).toEqual([]);
    expect(gem.altered).toEqual(['vocabulary']);
    // Arcana -> survival (one of the eighteen canonical skills, unprinted).
    const scroll = probe(
      'magic-item:spell-scroll',
      'scroll-copying-procedure',
      {
        skill: 'survival',
      },
    );
    expect(scroll.clean).toEqual([]);
    expect(scroll.altered).toEqual(['vocabulary']);
    // A non-canonical sense label is not silently skipped.
    expect(
      probe('magic-item:gem-of-seeing', 'sense-truesight', {
        sense: 'echolocation',
      }).altered,
    ).toEqual(['sense-label']);
    // A natural-20 rider widened to "critical hit" is caught; a true
    // critical-hit clause (Nine Lives Stealer) is not.
    const mace = probe(
      'magic-item:mace-of-smiting',
      'mace-smiting-critical-rider',
      { trigger: 'critical hit' },
    );
    expect(mace.clean).toEqual([]);
    expect(mace.altered).toEqual(['trigger']);
    expect(
      probe('magic-item:nine-lives-stealer', 'slay-on-critical-payload', {})
        .clean,
    ).toEqual([]);
  });

  // Dropped or added SCOPE is invisible to the screen above. These are the
  // repaired scope disagreements, asserted against the printed clause.
  it('keeps the scope the printed clause states (no dropped or added scope)', () => {
    const recordMechanics = (itemKey: string) =>
      ((recordsByKey.get(itemKey) as { data: Obj }).data as Obj).mechanics as {
        operations?: { activation?: { trigger?: string } }[];
      };
    const effect = (itemKey: string, id: string): Obj => {
      const found = effectsOf(recordsByKey.get(itemKey) as never).find(
        (candidate) => String(candidate.id).endsWith(id),
      );
      if (found === undefined) throw new Error(`${itemKey} ${id}`);
      return found;
    };
    // "advantage on saving throws against spells and other magical effects"
    expect(
      String(
        effect('magic-item:holy-avenger', 'holy-avenger-aura-saves').condition,
      ),
    ).toContain('against spells and other magical effects');
    // "+1 bonus to ability checks and saving throws"
    expect(
      String(
        effect('magic-item:stone-of-good-luck-luckstone', 'luckstone-saves')
          .appliesTo,
      ),
    ).toBe('ability checks and saving throws');
    // "resistance to nonmagical damage": the carve-out is magical damage, not
    // only damage from magical weapons.
    expect(
      effect(
        'magic-item:armor-of-invulnerability',
        'armor-invulnerability-resistance',
      ).excludes,
    ).toEqual(['magical damage']);
    // "use your reaction to become the target of the attack instead": no added
    // visibility or cover requirement.
    expect(
      'requirement' in
        effect('magic-item:arrow-catching-shield', 'redirect-ranged-attack'),
    ).toBe(false);
    // "a target within 5 feet" (an object may be the target, not only a
    // creature).
    expect(
      String(
        effect('magic-item:arrow-catching-shield', 'redirect-ranged-attack')
          .trigger,
      ),
    ).not.toContain('creature');
    // "made to hide" / "rely on sight" / "provided that you have a free
    // hand": the qualifier stays on the stage it governs.
    expect(
      String(
        effect('magic-item:cloak-of-elvenkind', 'elvenkind-stealth').condition,
      ),
    ).toContain('made to hide');
    expect(
      String(
        effect('magic-item:eyes-of-minute-seeing', 'minute-investigation')
          .condition,
      ),
    ).toContain('rely on sight');
    const snare = effect(
      'magic-item:gloves-of-missile-snaring',
      'snare-missile',
    );
    expect(String(snare.trigger)).toContain('free hand');
    expect(
      recordMechanics('magic-item:gloves-of-missile-snaring').operations?.[0]
        ?.activation?.trigger,
    ).toContain('free hand');
    // The goat's aura (riding / reversion / repeat-save / immunity) is absent as
    // a typed effect; see the faithful-or-absent block at the end of the file.
    // "takes damage from the arrow" (not merely a hit), on effect and operation.
    expect(
      String(effect('magic-item:arrow-of-slaying', 'slaying-damage').trigger),
    ).toContain('takes damage');
    expect(
      recordMechanics('magic-item:arrow-of-slaying').operations?.[0]?.activation
        ?.trigger,
    ).toContain('takes damage');
    // "light spell cast on the robe or daylight spell cast within 5 feet".
    expect(
      String(
        effect('magic-item:robe-of-eyes', 'robe-eyes-light-blindness').trigger,
      ),
    ).toBe(
      'light spell cast on the robe or daylight spell cast within 5 feet of the robe',
    );
    // "a +2 bonus to spell attack rolls while you wear or hold it" (both
    // alignment talismans): the scope is spell attack rolls only.
    for (const [item, id] of [
      ['magic-item:talisman-of-pure-good', 'pure-good-spell-attacks'],
      ['magic-item:talisman-of-ultimate-evil', 'ultimate-evil-spell-attacks'],
    ] as const) {
      const appliesTo = String(effect(item, id).appliesTo);
      expect(appliesTo).toContain('spell attack rolls');
      expect(appliesTo).toContain('wears or holds');
    }
    // Review 19.4.5.10 S1: each selected effect keeps its own printed
    // predicate. Cube of Force: "targeted by certain spells or comes into
    // contact with certain spell or magic item effects" (the table lists the
    // Horn of Blasting) - not spells only.
    expect(
      String(
        effect('magic-item:cube-of-force', 'm5-complex-cube-contact').trigger,
      ),
    ).toContain('certain spell or magic item effects');
    // Rod of Lordly Might: "If you press button 6, ... indicates magnetic north."
    expect(
      String(
        effect(
          'magic-item:rod-of-lordly-might',
          'm3-rod-of-lordly-might-sense-magnetic-north-and-depth',
        ).condition,
      ),
    ).toContain('button 6');
    // Candle of Invocation: "Any creature within that light" (dim light in a
    // 30-foot radius), not mere proximity.
    expect(
      String(
        effect('magic-item:candle-of-invocation', 'invocation-zone').condition,
      ),
    ).toContain("burning candle's light");
    // Lantern of Revealing: the 30/30 profile only while lit with the hood not
    // lowered; lowering the hood (while lit) reduces it to 5-foot dim light.
    expect(
      String(
        effect(
          'magic-item:lantern-of-revealing',
          'm3-lantern-of-revealing-bright-light',
        ).condition,
      ),
    ).toContain('hood is not lowered');
    expect(
      String(
        effect(
          'magic-item:lantern-of-revealing',
          'm3-lantern-of-revealing-dim-light',
        ).condition,
      ),
    ).toContain('while lit with the hood lowered');
    // Feather Token: the nested whip profile (a duplicate of the residual whip
    // attack) carries the same printed scope - a melee spell attack against a
    // creature within 10 feet of the whip, as a bonus action; the repeat flight
    // and attack is a bonus action on your turn.
    const featherRecord = recordsByKey.get('magic-item:feather-token');
    if (featherRecord === undefined) throw new Error('feather token missing');
    const tokenPayload = (
      ((featherRecord.data as Obj).mechanics as Obj).effects as Obj[]
    ).find((e) => String(e.id).endsWith('token-kind-payload'));
    const whip = ((tokenPayload?.variants as Obj | undefined)?.whip ??
      {}) as Obj;
    expect(whip).toMatchObject({
      attackKind: 'melee-spell-attack',
      target: 'a creature within 10 feet of the whip',
      attackAction: 'bonus-action',
      moveAndRepeat: 'As a bonus action on your turn',
    });
    // Review 19.4.5.11 S1: an independently emitted save/payload effect keeps
    // its printed recipient and area, verbatim from the printed sentence.
    for (const [item, id, printed] of [
      [
        'magic-item:dust-of-sneezing-and-choking',
        'c2-residual-choking-dust',
        'you and each creature that needs to breathe within 30 feet of you',
      ],
      [
        'magic-item:instant-fortress',
        'c2-residual-fortress-appearance-damage',
        'Each creature in the area where the fortress appears',
      ],
    ] as const) {
      const target = String(effect(item, id).target);
      expect(target).toBe(printed);
      const description = String(
        (recordsByKey.get(item)?.data as Obj | undefined)?.description,
      );
      expect(description).toContain(printed);
    }
    // Ring of Elemental Command: each plane's dominate monster belongs only to
    // that plane's ring, and its additional spells also require helping slay
    // an elemental of that plane while attuned (printed per variant).
    for (const [plane, extra] of [
      ['air', ['chain-lightning', 'gust-of-wind', 'wind-wall']],
      ['earth', ['stone-shape', 'stoneskin', 'wall-of-stone']],
      ['fire', ['burning-hands', 'fireball', 'wall-of-fire']],
      [
        'water',
        [
          'create-or-destroy-water',
          'control-water',
          'ice-storm',
          'wall-of-ice',
        ],
      ],
    ] as const) {
      const ring = `Ring of ${plane[0]?.toUpperCase()}${plane.slice(1)} Elemental Command`;
      const ringEffect = (id: string) =>
        effect('magic-item:ring-of-elemental-command', id);
      expect(String(ringEffect(`dominate-${plane}-elemental`).condition)).toBe(
        `only a ${ring}`,
      );
      for (const spell of extra) {
        const condition = String(ringEffect(`cast-${spell}`).condition);
        expect(condition).toContain(`only a ${ring}`);
        expect(condition).toContain(
          `${plane} elemental while attuned to the ring`,
        );
      }
    }
    // Printed spatial relationships. Javelin of Lightning: a line "from you to
    // a target within 120 feet" has no fixed length; Staff of Thunder and
    // Lightning prints a 120-foot-long line, which stays fixed.
    const javelinLine = effect(
      'magic-item:javelin-of-lightning',
      'hurl-lightning-payload',
    ).line as Obj;
    expect('lengthFeet' in javelinLine).toBe(false);
    expect(javelinLine.from).toBe('user');
    expect(String(javelinLine.to)).toContain('target');
    expect(
      (
        effect(
          'magic-item:staff-of-thunder-and-lightning',
          'lightning-strike-payload',
        ).line as Obj
      ).lengthFeet,
    ).toBe(120);
    // Instant Fortress: "an unoccupied space outside but next to the
    // fortress"; no nearest-space tie-break is printed.
    const fortress = effect(
      'magic-item:instant-fortress',
      'fortress-appearance-damage',
    );
    expect('pushToNearestUnoccupied' in fortress).toBe(false);
    expect(fortress.pushTo).toBe(
      'unoccupied space outside but next to the fortress',
    );
    // Pipes of the Sewers: the printed ordinary/giant-rat protection (no
    // attack unless threatened or harmed), without an invented command
    // exception; the swarm-control contest is a separate procedure.
    const rats = effect('magic-item:pipes-of-the-sewers', 'rat-indifference');
    expect(String(rats.result)).toContain(
      'unless wearer threatens or harms it',
    );
    expect(JSON.stringify(rats)).not.toMatch(/command/);
    // Natural-20 riders keep the printed die-result trigger.
    for (const [item, id] of [
      ['magic-item:mace-of-smiting', 'mace-smiting-critical-rider'],
      ['magic-item:sword-of-life-stealing', 'life-stealing-critical-rider'],
    ] as const)
      expect(String(effect(item, id).trigger)).toMatch(/^attack roll 20\b/);
    // "attack a creature ... and roll a 20": a creature-only rider, whereas
    // the Mace of Smiting prints no target class.
    for (const [item, id] of [
      ['magic-item:sword-of-life-stealing', 'life-stealing-critical-rider'],
      ['magic-item:sword-of-sharpness', 'sharpness-natural-twenty-rider'],
    ] as const)
      expect(effect(item, id).trigger).toBe(
        'attack roll 20 against a creature',
      );
    expect(
      effect('magic-item:mace-of-smiting', 'mace-smiting-critical-rider')
        .trigger,
    ).toBe('attack roll 20');

    // Prerequisite, exception and delivery forms (eshyra-o9bd.19.4.5.5).
    // Crystal Ball: "While touching it, you can cast the scrying spell"; no
    // action-speed permission (Scrying keeps its normal casting time), unlike
    // the Orb of Dragonkind, which prints "use an action ... scrying".
    const ball = effect('magic-item:crystal-ball', 'crystal-scrying');
    expect(String(ball.trigger)).toContain('touching');
    expect(String(ball.trigger)).not.toContain('action');
    expect(ball.castingTime).toBe('spell-normal');
    const operation = (itemKey: string, id: string) =>
      (
        recordMechanics(itemKey) as {
          operations?: { id?: string; activation?: Obj }[];
        }
      ).operations?.find((candidate) => candidate.id === id);
    expect(
      operation('magic-item:orb-of-dragonkind', 'cast-scrying')?.activation,
    ).toMatchObject({
      cost: 'action',
      requirement: 'control the orb',
    });
    expect(
      effect('magic-item:spell-scroll', 'scroll-casting-procedure').castingTime,
    ).toBe('spell-normal');
    // Dust of Dryness: the elemental is EXPOSED to a pinch (no throwing is
    // printed); the damage clause has one account, while the throwing
    // deliveries belong to Disappearance and Sneezing and Choking only.
    const dryness = effect(
      'magic-item:dust-of-dryness',
      'water-elemental-damage',
    );
    expect(String(dryness.trigger)).toContain('exposed');
    expect(String(dryness.trigger)).not.toMatch(/thrown|throw/);
    const absorb = effect('magic-item:dust-of-dryness', 'absorb-water');
    expect(String(absorb.trigger)).not.toMatch(/thrown|throw|elemental/);
    expect('waterElemental' in absorb).toBe(false);
    expect(
      operation('magic-item:dust-of-dryness', 'sprinkle-dust')?.activation
        ?.target,
    ).toBe('water');
    for (const item of [
      'magic-item:dust-of-disappearance',
      'magic-item:dust-of-sneezing-and-choking',
    ])
      expect(
        String(effectsOf(recordsByKey.get(item) as never)[0]?.trigger),
      ).toContain('thrown into air');
    // Touching vs merely carrying/wearing/holding, per the printed state.
    expect(
      String(effect('magic-item:luck-blade', 'luck-blade-saves').condition),
    ).toContain('on your person');
    expect(
      String(
        effect('magic-item:stone-of-good-luck-luckstone', 'luckstone-saves')
          .condition,
      ),
    ).toContain('on your person');
    expect(
      String(
        effect('magic-item:scarab-of-protection', 'scarab-spell-saves')
          .condition,
      ),
    ).toContain('on your person');
    expect(
      String(
        effect('magic-item:ioun-stone', 'awareness-no-surprise').condition,
      ),
    ).toContain('orbits');
    expect(
      String(
        effect('magic-item:wand-of-the-war-mage-1-2-or-3', 'ignore-half-cover')
          .trigger,
      ),
    ).toContain('holder of the wand');
    expect(
      String(effect('magic-item:sun-blade', 'sun-blade-finesse').trigger),
    ).toContain('while the blade exists');
    expect(
      String(effect('magic-item:boots-of-speed', 'speed-multiplier').condition),
    ).toContain('activated');
    // Action economy / target class / exceptions printed beside the effect.
    expect(
      String(
        effect('magic-item:amulet-of-the-planes', 'plane-shift-check').trigger,
      ),
    ).toContain('familiar');
    expect(
      String(
        effect('magic-item:decanter-of-endless-water', 'geyser-impact').trigger,
      ),
    ).toContain('object');
    expect(
      String(
        effect('magic-item:gloves-of-swimming-and-climbing', 'athletics-bonus')
          .trigger,
      ),
    ).toContain('Strength (Athletics)');
    expect(
      String(
        effect(
          'magic-item:talisman-of-the-sphere',
          'enhanced-sphere-levitation',
        ).trigger,
      ),
    ).not.toContain('wearer');
    expect(
      effect('magic-item:ring-of-invisibility', 'invisibility').endsOn,
    ).toContain('ring-removed');
    expect(
      effect('magic-item:plate-armor-of-etherealness', 'etherealness').endsOn,
    ).toContain('armor-removed');
    expect(
      operation('magic-item:cubic-gate', 'cast-plane-shift')?.activation
        ?.requirement,
    ).toContain('twice');
    // "you can telepathically communicate with any creature wearing it": no
    // added directionality or language flags.
    const telepathy = effect(
      'magic-item:ring-of-mind-shielding',
      'mind-ring-soul-telepathy',
    );
    expect('oneWay' in telepathy).toBe(false);
    expect('requiresLanguage' in telepathy).toBe(false);
  });
});

/**
 * Faithful-or-absent (eshyra-o9bd.19.4.5.8; bd memory
 * magic-item-faithful-or-absent). A typed `mechanics.effects` member states the
 * printed predicate exactly or does not exist as a typed effect; "absent"
 * means an executionReadiness clause with readiness 'adjudicated-by-design'
 * whose representation carries a verbatim span of the printed description.
 *
 * Scope: `mechanics.effects` only. Operations, state machines, economies,
 * grants and containment belong to eshyra-o9bd.19.4.6.
 */
describe('magic-item effects are faithful or absent (eshyra-o9bd.19.4.5.8)', () => {
  const norm = (value: string): string =>
    value.toLowerCase().replace(/\s+/g, ' ').trim();
  const magicItems = pack.records.filter(
    (record) => record.kind === 'magic-item',
  );
  const dataOf = (key: string): Obj =>
    (recordsByKey.get(key) as { data: Obj }).data;
  const descriptionOf = (key: string): string =>
    norm(String(dataOf(key).description));
  const allEffects = (key: string): Obj[] => {
    const data = dataOf(key);
    const mechanics = isObj(data.mechanics) ? data.mechanics : {};
    const variants = Array.isArray(data.variants) ? data.variants : [];
    return [
      ...((mechanics.effects as Obj[] | undefined) ?? []),
      ...variants.flatMap((variant) =>
        isObj(variant) && isObj(variant.mechanics)
          ? ((variant.mechanics.effects as Obj[] | undefined) ?? [])
          : [],
      ),
    ];
  };
  const parentEffect = (key: string, id: string): Obj | undefined =>
    allEffects(key).find((candidate) => candidate.id === id);
  const clausesOf = (key: string): Obj[] =>
    (dataOf(key).executionReadiness as Obj).clauses as Obj[];

  it('every adjudicated clause carries a non-empty verbatim span of the printed description', () => {
    const adjudicated = magicItems.flatMap((record) =>
      clausesOf(record.key)
        .filter((clause) => clause.readiness === 'adjudicated-by-design')
        .map((clause) => ({ record, clause })),
    );
    expect(adjudicated.length).toBeGreaterThan(0);
    for (const { record, clause } of adjudicated) {
      const representation = clause.representation as Obj;
      const label = `${record.key} ${String(clause.clauseId)}`;
      expect(representation.adjudicated, label).toBe(true);
      expect(typeof representation.sourceText, label).toBe('string');
      const sourceText = representation.sourceText as string;
      expect(sourceText.length, label).toBeGreaterThan(0);
      // Verbatim (exact, case- and punctuation-sensitive) substring.
      expect(
        String((record.data as Obj).description).includes(sourceText),
        label,
      ).toBe(true);
      expect(String(representation.note).length, label).toBeGreaterThan(0);
    }
  });

  /**
   * Members whose typed effect states the printed predicate exactly. Each row
   * names the printed phrase(s) the emitted field must carry: the ineligible
   * scenario in the review (wrong weapon/mode, non-creature target, wrong
   * beneficiary, stowed item, out-of-sight point, wrong geometry origin,
   * unqualified quantity role) is exactly the absence of that phrase. A
   * fragment must occur in BOTH the printed description and the emitted field.
   */
  interface ExactRow {
    readonly item: string;
    readonly effect: string;
    readonly field: string;
    readonly printed: readonly string[];
  }
  const OATH_PRINTED = [
    'ranged attack roll',
    'with this weapon against your sworn enemy',
  ];
  const EXACT: readonly ExactRow[] = [
    {
      item: 'magic-item:oathbow',
      effect: 'c2-residual-oathbow-sworn-enemy-attacks',
      field: 'condition',
      printed: OATH_PRINTED,
    },
    {
      item: 'magic-item:oathbow',
      effect: 'c2-residual-oathbow-ignore-cover-range',
      field: 'trigger',
      printed: OATH_PRINTED,
    },
    {
      item: 'magic-item:oathbow',
      effect: 'c2-residual-oathbow-sworn-enemy-extra-damage',
      field: 'trigger',
      printed: OATH_PRINTED,
    },
    ...['c2-drain-life-payload', 'c2-paralyze-payload'].map((effect) => ({
      item: 'magic-item:rod-of-lordly-might',
      effect,
      field: 'trigger',
      printed: ['a creature with a melee attack using the rod'],
    })),
    {
      item: 'magic-item:sword-of-wounding',
      effect: 'c2-residual-apply-wound',
      field: 'trigger',
      printed: [
        'once per turn',
        'a creature with an attack using this magic weapon',
      ],
    },
    {
      item: 'magic-item:vorpal-sword',
      effect: 'c2-static-vorpal-no-decapitation-rider',
      field: 'condition',
      printed: [
        'immune to slashing damage',
        'doesn’t have or need a head',
        'has legendary actions',
      ],
    },
    {
      item: 'magic-item:holy-avenger',
      effect: 'c2-residual-holy-avenger-aura-saves',
      field: 'condition',
      printed: [
        'you and all creatures friendly to you in the aura',
        'hold the drawn sword',
        'against spells and other magical effects',
      ],
    },
    {
      item: 'magic-item:decanter-of-endless-water',
      effect: 'c2-residual-geyser-impact',
      field: 'trigger',
      printed: [
        'while holding the decanter',
        'a creature you can see within 30 feet of you',
        'weighs no more than 200 pounds',
      ],
    },
    {
      item: 'magic-item:decanter-of-endless-water',
      effect: 'c2-residual-geyser-impact',
      field: 'result',
      printed: ['away from you'],
    },
    {
      item: 'magic-item:ring-of-shooting-stars',
      effect: 'c2-launch-shooting-stars-payload',
      field: 'trigger',
      printed: ['a point you can see within 60 feet of you'],
    },
    {
      item: 'magic-item:bracers-of-archery',
      effect: 'c2-static-bracers-archery-damage',
      field: 'appliesTo',
      printed: ['ranged attacks made with', 'longbow and shortbow'],
    },
    {
      item: 'magic-item:defender',
      effect: 'c2-residual-defender-bonus-transfer',
      field: 'trigger',
      printed: [
        'the first time you attack with the sword on each of your turns',
      ],
    },
    {
      item: 'magic-item:defender',
      effect: 'c2-residual-defender-bonus-transfer',
      field: 'result',
      printed: ['you must hold the sword to gain a bonus to ac from it'],
    },
    {
      item: 'magic-item:ring-of-spell-turning',
      effect: 'c2-residual-spell-turning-saves',
      field: 'condition',
      printed: ['targets only you (not in an area of effect)'],
    },
    {
      item: 'magic-item:rod-of-alertness',
      effect: 'm3-rod-of-alertness-sense-invisible-hostile-location',
      field: 'condition',
      printed: [
        'friendly to you',
        'invisible hostile creature that is also in the bright light',
      ],
    },
    {
      item: 'magic-item:horn-of-blasting',
      effect: 'c2-blow-horn-payload',
      field: 'glassOrCrystalAppliesTo',
      printed: ['made of glass or crystal'],
    },
    {
      item: 'magic-item:hammer-of-thunderbolts',
      effect: 'c2-giant-slaying-critical-payload',
      field: 'trigger',
      printed: [
        'attuned to this weapon',
        'roll a 20 on an attack roll made with this weapon against a giant',
      ],
    },
    {
      item: 'magic-item:wand-of-the-war-mage-1-2-or-3',
      effect: 'c2-static-war-mage-rarity-spell-attack',
      field: 'appliesTo',
      printed: ['holding this wand', 'spell attack rolls'],
    },
    {
      item: 'magic-item:ring-of-the-ram',
      effect: 'c2-spectral-ram-attack-payload',
      field: 'result',
      printed: ['away from you'],
    },
    {
      item: 'magic-item:feather-token',
      effect: 'c2-residual-whip-attack',
      field: 'trigger',
      printed: [
        'a melee spell attack against a creature within 10 feet of the whip',
      ],
    },
    {
      item: 'magic-item:gem-of-seeing',
      effect: 'm3-gem-of-seeing-sense-truesight',
      field: 'condition',
      printed: [
        'speak the gem’s command word',
        'expend 1 charge',
        'peer through the gem',
      ],
    },
    {
      item: 'magic-item:plate-armor-of-etherealness',
      effect: 'c2-residual-etherealness',
      field: 'trigger',
      printed: ['its command word as an action'],
    },
    {
      item: 'magic-item:rod-of-rulership',
      effect: 'c2-residual-rulership-charm',
      field: 'trigger',
      printed: [
        'present the rod and command obedience from each creature of your choice that you can see within 120 feet of you',
      ],
    },
    {
      item: 'magic-item:wand-of-binding',
      effect: 'c2-residual-assisted-escape-save',
      field: 'condition',
      printed: [
        'holding the wand',
        'use your reaction to expend 1 charge',
        'a saving throw you make to avoid being paralyzed or restrained',
      ],
    },
    {
      item: 'magic-item:wand-of-binding',
      effect: 'c2-residual-assisted-escape-check',
      field: 'condition',
      printed: ['holding the wand', 'any check you make to escape a grapple'],
    },
    {
      item: 'magic-item:wand-of-enemy-detection',
      effect: 'm3-wand-of-enemy-detection-sense-nearest-hostile-direction',
      field: 'condition',
      printed: [
        'use an action and expend 1 charge to speak its command word',
        'stop holding the wand',
      ],
    },
    {
      item: 'magic-item:ring-of-x-ray-vision',
      effect: 'm3-ring-of-x-ray-vision-sense-x-ray-vision',
      field: 'condition',
      printed: ['while wearing', 'use an action to speak its command word'],
    },
    {
      item: 'magic-item:wand-of-secrets',
      effect: 'm3-wand-of-secrets-sense-nearest-secret-door-or-trap',
      field: 'condition',
      printed: [
        'use an action to expend 1',
        'secret door or trap is within 30 feet of you',
      ],
    },
    ...[
      ['talisman-of-pure-good', 'm7-pure-good-fissure-gate'],
      ['talisman-of-ultimate-evil', 'm7-ultimate-evil-fissure-gate'],
    ].map(([item, effect]) => ({
      item: `magic-item:${item}`,
      effect,
      field: 'trigger',
      printed: [
        'wearing or holding',
        'use an action to expend 1 charge',
        'one creature you can see on the ground within 120 feet of you',
      ],
    })),
    {
      item: 'magic-item:talisman-of-the-sphere',
      effect: 'c2-residual-enhanced-sphere-levitation',
      field: 'result',
      printed: ['additional feet equal to 10 × your intelligence modifier'],
    },
  ];

  it.each(
    EXACT.map(
      (row) => [`${row.item} ${row.effect}.${row.field}`, row] as const,
    ),
  )('%s states the printed predicate', (_label, row) => {
    const effect = parentEffect(row.item, row.effect);
    expect(effect, 'typed effect present').toBeDefined();
    const value = norm(String((effect as Obj)[row.field]));
    const printed = descriptionOf(row.item);
    for (const fragment of row.printed.map(norm)) {
      expect(printed, `printed text carries ${fragment}`).toContain(fragment);
      expect(value, `${row.field} carries ${fragment}`).toContain(fragment);
    }
  });

  it('keeps quantity roles, geometry origins and branches on the stage the source prints', () => {
    // Talisman of the Sphere: ten feet PLUS additional feet (10 x Int modifier);
    // the ten is the base, never part of the additional formula.
    const sphere = parentEffect(
      'magic-item:talisman-of-the-sphere',
      'c2-residual-enhanced-sphere-levitation',
    ) as Obj;
    expect(sphere.baseFeet).toBe(10);
    expect(sphere.additionalFeetFormula).toBe('10 × intelligence-modifier');
    // Horn of Blasting: glass or crystal have disadvantage AND take 10d6.
    const horn = parentEffect(
      'magic-item:horn-of-blasting',
      'c2-blow-horn-payload',
    ) as Obj;
    expect(horn.glassOrCrystalDamageDice).toBe('10d6');
    expect(horn.glassOrCrystalSaveMode).toBe('disadvantage');
    // Ring of the Ram: the push is directional ("away from you").
    expect(
      (
        parentEffect(
          'magic-item:ring-of-the-ram',
          'c2-spectral-ram-attack-payload',
        ) as Obj
      ).pushDirection,
    ).toBe('away from you');
    // Rod of Alertness: the 60-foot figure is the rod's bright-light radius
    // (centred on the rod), not a sensing range from the beneficiary.
    expect(
      parentEffect(
        'magic-item:rod-of-alertness',
        'm3-rod-of-alertness-sense-invisible-hostile-location',
      ),
    ).not.toHaveProperty('rangeFeet');
    // No predicate collapsed back to its pre-repair broader wording.
    const broader: readonly (readonly [string, string, string, string])[] = [
      [
        'magic-item:oathbow',
        'c2-residual-oathbow-sworn-enemy-attacks',
        'condition',
        'target is sworn enemy',
      ],
      [
        'magic-item:rod-of-lordly-might',
        'c2-drain-life-payload',
        'trigger',
        'melee hit with rod',
      ],
      [
        'magic-item:sword-of-wounding',
        'c2-residual-apply-wound',
        'trigger',
        'weapon attack hits',
      ],
      [
        'magic-item:ring-of-spell-turning',
        'c2-residual-spell-turning-saves',
        'condition',
        'spell targets only wearer',
      ],
      [
        'magic-item:rod-of-rulership',
        'c2-residual-rulership-charm',
        'trigger',
        'rod command is issued',
      ],
    ];
    for (const [item, effect, field, retired] of broader)
      expect((parentEffect(item, effect) as Obj)[field], effect).not.toBe(
        retired,
      );
  });

  /**
   * Members that are absent as typed effects. The effect (or the single typed
   * field) leaves `mechanics.effects`; the printed clause is an adjudicated
   * clause whose span the DM model reads and interprets.
   */
  interface AbsentRow {
    readonly item: string;
    readonly effect: string;
    readonly clauseSuffix: string;
    readonly span: string;
    readonly keepsEffect?: true;
  }
  const ABSENT: readonly AbsentRow[] = [
    ...[
      ['manual-of-bodily-health', 'constitution'],
      ['manual-of-gainful-exercise', 'strength'],
      ['manual-of-quickness-of-action', 'dexterity'],
      ['tome-of-clear-thought', 'intelligence'],
      ['tome-of-leadership-and-influence', 'charisma'],
      ['tome-of-understanding', 'wisdom'],
    ].map(([item, ability]) => ({
      item: `magic-item:${item}`,
      effect: `m2-${item}-${ability}-score-increase`,
      clauseSuffix: `m2-${item}-${ability}-score-increase`,
      span: '48 hours over a period of 6 days or fewer',
    })),
    {
      item: 'magic-item:figurine-of-wondrous-power',
      effect: 'c2-residual-goat-terror-aura',
      clauseSuffix: 'c2-residual-goat-terror-aura',
      span: 'immune to the goat’s aura for the next 24 hours',
    },
    {
      // The printed restriction binds the shackled creature, which the typed
      // immunity vocabulary (a bearer immunity) cannot state.
      item: 'magic-item:dimensional-shackles',
      effect: 'c2-residual-dimensional-movement-block',
      clauseSuffix: 'c2-residual-dimensional-movement-block',
      span: 'They don’t prevent the creature from passing through an interdimensional portal.',
    },
    {
      item: 'magic-item:nine-lives-stealer',
      effect: 'c2-slay-on-critical-payload',
      clauseSuffix: 'slay-on-critical-charge-loss',
      span: 'The sword loses 1 charge if the creature is slain.',
      keepsEffect: true,
    },
  ];

  it.each(ABSENT.map((row) => [`${row.item} ${row.effect}`, row] as const))(
    '%s is absent as a typed claim and adjudicated with a printed span',
    (_label, row) => {
      const effect = allEffects(row.item).find(({ id }) => id === row.effect);
      if (row.keepsEffect === undefined) {
        expect(effect).toBeUndefined();
        // No readiness clause binds the withheld effect, and no operation,
        // state or transition still names it.
        expect(
          clausesOf(row.item).filter(
            (clause) =>
              (clause.representation as Obj).block === 'effects' &&
              (clause.representation as Obj).effectId === row.effect,
          ),
        ).toEqual([]);
        expect(JSON.stringify(dataOf(row.item).mechanics ?? {})).not.toContain(
          row.effect,
        );
      } else {
        // The kept payload no longer asserts the unconditional cost.
        expect(effect).not.toHaveProperty('chargeCost');
      }
      const clause = clausesOf(row.item).find((candidate) =>
        String(candidate.clauseId).endsWith(`/${row.clauseSuffix}`),
      ) as Obj;
      expect(clause.readiness).toBe('adjudicated-by-design');
      expect(String((clause.representation as Obj).sourceText)).toContain(
        row.span,
      );
    },
  );
});
