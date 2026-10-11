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
    // "while you are riding it": the goat's aura is conditional on riding.
    expect(
      String(
        effect('magic-item:figurine-of-wondrous-power', 'goat-terror-aura')
          .trigger,
      ),
    ).toContain('riding');
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
    // "while you wear or hold it" (both alignment talismans).
    for (const [item, id] of [
      ['magic-item:talisman-of-pure-good', 'pure-good-spell-attacks'],
      ['magic-item:talisman-of-ultimate-evil', 'ultimate-evil-spell-attacks'],
    ] as const)
      expect(String(effect(item, id).appliesTo)).toContain(
        'wearing or holding',
      );
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
      expect(effect(item, id).trigger).toBe('attack roll 20');
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
