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
const SKILLS = [
  'acrobatics',
  'arcana',
  'athletics',
  'investigation',
  'medicine',
  'perception',
  'persuasion',
  'stealth',
];
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
    if (vocabulary?.includes(lower) && !hasPhrase(haystack, lower))
      flag(path, 'vocabulary', value);
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

  // Dropped or added SCOPE is invisible to the screen above. These are the
  // repaired scope disagreements, asserted against the printed clause.
  it('keeps the scope the printed clause states (no dropped or added scope)', () => {
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
