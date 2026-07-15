import { EXPECTED_HIGHER_SLOT_SOURCE_PAGES } from './spellUpcastInventory.js';
import type { SpellExtraction } from './types.js';

/** The deliberately closed D&D spell-upcast vocabulary emitted by the compiler. */
export type UpcastSubject =
  | {
      readonly kind: 'damage';
      readonly damageType?: string;
      readonly damageTypes?: readonly string[];
      readonly selection?: 'choose-one' | 'source-determined';
      readonly application?: 'all-components';
      readonly semanticId: string;
      readonly property: 'damage-dice';
    }
  | {
      readonly kind: 'healing';
      readonly semanticId: string;
      readonly property: 'healing-dice' | 'healing-points';
    }
  | {
      readonly kind: 'affected-hit-points';
      readonly semanticId: string;
      readonly property: 'affected-hit-point-pool-dice';
    }
  | {
      readonly kind: 'effect';
      readonly semanticId: string;
      readonly selection?: 'choose-one';
      readonly choiceGroup?: string;
      readonly cardinalityMode?: 'maximum-total';
      readonly includesCaster?: true;
      readonly property:
        | 'duration-hours'
        | 'hit-points'
        | 'target-count'
        | 'projectile-count'
        | 'creature-count'
        | 'object-count'
        | 'volume-gallons'
        | 'cube-size-feet'
        | 'spell-level-threshold'
        | 'duration'
        | 'radius-feet'
        | 'bonus'
        | 'memory-age'
        | 'temporary-hit-points'
        | 'other-quantity';
    };

export type UpcastOperation =
  | {
      readonly kind: 'dice-per-slot';
      readonly subject: UpcastSubject;
      readonly dice: string;
      readonly startSlotLevel: number;
      readonly everySlotLevels: number;
    }
  | {
      readonly kind: 'flat-per-slot';
      readonly subject: UpcastSubject;
      readonly amount: number;
      readonly startSlotLevel: number;
      readonly everySlotLevels: number;
    }
  | {
      readonly kind: 'count-per-slot';
      readonly subject: UpcastSubject;
      readonly count: number;
      readonly startSlotLevel: number;
      readonly everySlotLevels: number;
    }
  | {
      readonly kind: 'threshold';
      readonly subject: UpcastSubject;
      readonly atSlotLevel: number;
      readonly value: string;
    }
  | {
      readonly kind: 'selected-slot-value';
      readonly subject: UpcastSubject;
      readonly minSlotLevel: number;
      readonly value: 'selected-slot-level';
    };

export interface SpellUpcastSpec {
  readonly sourceKind: 'higher-slot';
  readonly clauseId: string;
  readonly sourcePhrase: string;
  readonly sourcePage: number;
  readonly operations: readonly UpcastOperation[];
  readonly qualifier?: {
    readonly text: string;
    readonly minSlotLevel: number;
  };
  readonly disposition:
    | 'complete-typed-upcast'
    | 'existing-s1-typed-scaling'
    | 'typed-core-with-model-qualifier';
}

interface ReviewedProjection {
  readonly operations: readonly UpcastOperation[];
  readonly qualifier?: SpellUpcastSpec['qualifier'];
}

const REVIEWED_SOURCE_BINDINGS: Readonly<
  Record<string, { readonly page: number; readonly text: string }>
> = {
  'dominate-beast': {
    page: 137,
    text: 'When you cast this spell with a 5th-level spell slot, the duration is concentration, up to 10 minutes. When you use a 6th-level spell slot, the duration is concentration, up to 1 hour. When you use a spell slot of 7th level or higher, the duration is concentration, up to 8 hours.',
  },
  'dominate-person': {
    page: 138,
    text: 'When you cast this spell using a 6th-level spell slot, the duration is concentration, up to 10 minutes. When you use a 7th-level spell slot, the duration is concentration, up to 1 hour. When you use a spell slot of 8th level or higher, the duration is concentration, up to 8 hours.',
  },
  'mass-suggestion': {
    page: 163,
    text: 'When you cast this spell using a 7th-level spell slot, the duration is 10 days. When you use an 8th-level spell slot, the duration is 30 days. When you use a 9th-level spell slot, the duration is a year and a day.',
  },
  'planar-binding': {
    page: 168,
    text: 'When you cast this spell using a spell slot of a higher level, the duration increases to 10 days with a 6th-level slot, to 30 days with a 7th- level slot, to 180 days with an 8th-level slot, and to a year and a day with a 9th-level spell slot.',
  },
  'modify-memory': {
    page: 166,
    text: 'If you cast this spell using a spell slot of 6th level or higher, you can alter the target’s memories of an event that took place up to 7 days ago (6th level), 30 days ago (7th level), 1 year ago (8th level), or any time in the creature’s past (9th level).',
  },
  'bestow-curse': {
    page: 121,
    text: 'If you cast this spell using a spell slot of 4th level or higher, the duration is concentration, up to 10 minutes. If you use a spell slot of 5th level or higher, the duration is 8 hours. If you use a spell slot of 7th level or higher, the duration is 24 hours. If you use a 9th level spell slot, the spell lasts until it is dispelled. Using a spell slot of 5th level or higher grants a duration that doesn’t require concentration.',
  },
  geas: {
    page: 148,
    text: 'When you cast this spell using a spell slot of 7th or 8th level, the duration is 1 year. When you cast this spell using a spell slot of 9th level, the spell lasts until it is ended by one of the spells mentioned above.',
  },
  'hunters-mark': {
    page: 155,
    text: 'When you cast this spell using a spell slot of 3rd or 4th level, you can maintain your concentration on the spell for up to 8 hours. When you use a spell slot of 5th level or higher, you can maintain your concentration on the spell for up to 24 hours.',
  },
  'magic-weapon': {
    page: 161,
    text: 'When you cast this spell using a spell slot of 4th level or higher, the bonus increases to +2. When you use a spell slot of 6th level or higher, the bonus increases to +3.',
  },
  'create-or-destroy-water': {
    page: 132,
    text: 'When you cast this spell using a spell slot of 2nd level or higher, you create or destroy 10 additional gallons of water, or the size of the cube increases by 5 feet, for each slot level above 1st.',
  },
  'glyph-of-warding': {
    page: 149,
    text: 'When you cast this spell using a spell slot of 4th level or higher, the damage of an explosive runes glyph increases by 1d8 for each slot level above 3rd. If you create a spell glyph, you can store any spell of up to the same level as the slot you use for the glyph of warding.',
  },
  'wall-of-ice': {
    page: 190,
    text: 'When you cast this spell using a spell slot of 7th level or higher, the damage the wall deals when it appears increases by 2d6, and the damage from passing through the sheet of frigid air increases by 1d6, for each slot level above 6th.',
  },
  etherealness: {
    page: 140,
    text: 'When you cast this spell using a spell slot of 8th level or higher, you can target up to three willing creatures (including you) for each slot level above 7th. The creatures must be within 10 feet of you when you cast the spell.',
  },
  'dispel-magic': {
    page: 136,
    text: 'When you cast this spell using a spell slot of 4th level or higher, you automatically end the effects of a spell on the target if the spell’s level is equal to or less than the level of the spell slot you used.',
  },
  'false-life': {
    page: 142,
    text: 'When you cast this spell using a spell slot of 2nd level or higher, you gain 5 additional temporary hit points for each slot level above 1st.',
  },
};

const SCHEDULE_VALUES: Readonly<
  Record<string, readonly { readonly slot: number; readonly value: string }[]>
> = {
  'dominate-beast': [
    { slot: 5, value: 'concentration, up to 10 minutes' },
    { slot: 6, value: 'concentration, up to 1 hour' },
    { slot: 7, value: 'concentration, up to 8 hours' },
  ],
  'dominate-person': [
    { slot: 6, value: 'concentration, up to 10 minutes' },
    { slot: 7, value: 'concentration, up to 1 hour' },
    { slot: 8, value: 'concentration, up to 8 hours' },
  ],
  'mass-suggestion': [
    { slot: 7, value: '10 days' },
    { slot: 8, value: '30 days' },
    { slot: 9, value: 'a year and a day' },
  ],
  'planar-binding': [
    { slot: 6, value: '10 days' },
    { slot: 7, value: '30 days' },
    { slot: 8, value: '180 days' },
    { slot: 9, value: 'a year and a day' },
  ],
  'modify-memory': [
    { slot: 6, value: 'up to 7 days ago' },
    { slot: 7, value: 'up to 30 days ago' },
    { slot: 8, value: 'up to 1 year ago' },
    { slot: 9, value: 'any time in the creature’s past' },
  ],
  'bestow-curse': [
    { slot: 4, value: 'concentration, up to 10 minutes' },
    { slot: 5, value: '8 hours, no concentration' },
    { slot: 7, value: '24 hours, no concentration' },
    { slot: 9, value: 'until dispelled, no concentration' },
  ],
  geas: [
    { slot: 7, value: '1 year' },
    { slot: 9, value: 'until ended by an allowed spell' },
  ],
  'hunters-mark': [
    { slot: 3, value: 'concentration, up to 8 hours' },
    { slot: 5, value: 'concentration, up to 24 hours' },
  ],
  'magic-weapon': [
    { slot: 4, value: '+2' },
    { slot: 6, value: '+3' },
  ],
};

function reviewedProjection(
  spell: SpellExtraction,
  spellSlug: string,
  text: string,
): ReviewedProjection | undefined {
  const binding = REVIEWED_SOURCE_BINDINGS[spellSlug];
  if (binding === undefined) return undefined;
  if (spell.sourcePage !== binding.page || text !== binding.text) {
    throw new Error(
      `reviewed upcast source drift for spell:${spellSlug}: expected p.${binding.page} ${JSON.stringify(binding.text)}, got p.${spell.sourcePage} ${JSON.stringify(text)}`,
    );
  }
  const schedule = SCHEDULE_VALUES[spellSlug];
  if (schedule !== undefined) {
    const property =
      spellSlug === 'modify-memory'
        ? 'memory-age'
        : spellSlug === 'magic-weapon'
          ? 'bonus'
          : 'duration';
    return {
      operations: schedule.map(({ slot, value }) => ({
        kind: 'threshold',
        subject: {
          kind: 'effect',
          semanticId: `${spell.name.toLowerCase()}:${property}-schedule`,
          property,
        },
        atSlotLevel: slot,
        value,
      })),
    };
  }
  if (spellSlug === 'create-or-destroy-water') {
    const choice = {
      selection: 'choose-one' as const,
      choiceGroup: 'create-or-destroy-water:scaled-mode',
    };
    return {
      operations: [
        {
          kind: 'count-per-slot',
          subject: {
            kind: 'effect',
            semanticId: 'create or destroy water:volume',
            property: 'volume-gallons',
            ...choice,
          },
          count: 10,
          startSlotLevel: 1,
          everySlotLevels: 1,
        },
        {
          kind: 'flat-per-slot',
          subject: {
            kind: 'effect',
            semanticId: 'create or destroy water:cube-size',
            property: 'cube-size-feet',
            ...choice,
          },
          amount: 5,
          startSlotLevel: 1,
          everySlotLevels: 1,
        },
      ],
    };
  }
  if (spellSlug === 'glyph-of-warding') {
    return {
      operations: [
        {
          kind: 'dice-per-slot',
          subject: {
            kind: 'damage',
            damageTypes: ['acid', 'cold', 'fire', 'lightning', 'thunder'],
            selection: 'choose-one',
            semanticId: 'glyph of warding:explosive-runes-damage',
            property: 'damage-dice',
          },
          dice: '1d8',
          startSlotLevel: 3,
          everySlotLevels: 1,
        },
      ],
      qualifier: {
        text: 'If you create a spell glyph, you can store any spell of up to the same level as the slot you use for the glyph of warding.',
        minSlotLevel: 4,
      },
    };
  }
  if (spellSlug === 'wall-of-ice') {
    return {
      operations: [
        {
          kind: 'dice-per-slot',
          subject: componentDamageSubject(
            spell,
            text,
            'wall of ice:appearing-wall-damage',
            'cold',
          ),
          dice: '2d6',
          startSlotLevel: 6,
          everySlotLevels: 1,
        },
        {
          kind: 'dice-per-slot',
          subject: componentDamageSubject(
            spell,
            text,
            'wall of ice:frigid-air-damage',
            'cold',
          ),
          dice: '1d6',
          startSlotLevel: 6,
          everySlotLevels: 1,
        },
      ],
    };
  }
  if (spellSlug === 'etherealness') {
    return {
      operations: [
        {
          kind: 'count-per-slot',
          subject: {
            kind: 'effect',
            semanticId: 'etherealness:willing-creature-maximum',
            property: 'creature-count',
            cardinalityMode: 'maximum-total',
            includesCaster: true,
          },
          count: 3,
          startSlotLevel: 7,
          everySlotLevels: 1,
        },
      ],
    };
  }
  if (spellSlug === 'dispel-magic') {
    return {
      operations: [
        {
          kind: 'selected-slot-value',
          subject: {
            kind: 'effect',
            semanticId: 'dispel magic:automatic-spell-level-threshold',
            property: 'spell-level-threshold',
          },
          minSlotLevel: 4,
          value: 'selected-slot-level',
        },
      ],
    };
  }
  if (spellSlug === 'false-life') {
    return {
      operations: [
        {
          kind: 'flat-per-slot',
          subject: {
            kind: 'effect',
            semanticId: 'false life:temporary-hit-points',
            property: 'temporary-hit-points',
          },
          amount: 5,
          startSlotLevel: 1,
          everySlotLevels: 1,
        },
      ],
    };
  }
  throw new Error(`reviewed upcast projection missing for spell:${spellSlug}`);
}

const REVIEWED_CLAUSE_COVERAGE: Readonly<
  Record<
    string,
    { readonly operationCount: number; readonly qualifier: boolean }
  >
> = {
  ...Object.fromEntries(
    Object.entries(SCHEDULE_VALUES).map(([key, schedule]) => [
      key,
      { operationCount: schedule.length, qualifier: false },
    ]),
  ),
  'create-or-destroy-water': { operationCount: 2, qualifier: false },
  'glyph-of-warding': { operationCount: 1, qualifier: true },
  'wall-of-ice': { operationCount: 2, qualifier: false },
  etherealness: { operationCount: 1, qualifier: false },
  'dispel-magic': { operationCount: 1, qualifier: false },
  'false-life': { operationCount: 1, qualifier: false },
};

const S1_SUMMONS = new Set([
  'conjure-animals',
  'conjure-celestial',
  'conjure-elemental',
  'conjure-fey',
  'conjure-minor-elementals',
  'conjure-woodland-beings',
  'create-undead',
  'animate-dead',
  'animate-objects',
  'find-familiar',
  'find-steed',
  'giant-insect',
  'phantom-steed',
  'simulacrum',
]);

const DICE = /^(?:\d+)d(?:\d+)$/;
const DAMAGE_TYPES =
  /\b(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder) damage\b/gi;

function spellSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-');
}

function subject(
  spell: SpellExtraction,
  kind: UpcastSubject['kind'],
  text = spell.description,
  semanticId?: string,
  numericKind: 'dice' | 'flat' = 'dice',
): UpcastSubject {
  const localTypes = [
    ...new Set(
      [...text.matchAll(DAMAGE_TYPES)].map((match) => match[1].toLowerCase()),
    ),
  ];
  const descriptionTypes = [
    ...new Set(
      [...spell.description.matchAll(DAMAGE_TYPES)].map((match) =>
        match[1].toLowerCase(),
      ),
    ),
  ];
  const types = localTypes.length > 0 ? localTypes : descriptionTypes;
  if (kind === 'damage') {
    return {
      kind,
      ...(types.length === 1 ? { damageType: types[0] } : {}),
      ...(types.length > 1
        ? {
            damageTypes: types,
            ...(/(?:acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder) damage\s+or\s+(?:the\s+)?(?:acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder) damage|your choice/i.test(
              text,
            )
              ? { selection: 'choose-one' as const }
              : /both types|both .*damage/i.test(text)
                ? { application: 'all-components' as const }
                : { selection: 'source-determined' as const }),
          }
        : {}),
      semanticId:
        semanticId ??
        (types.length > 1
          ? `${spell.name.toLowerCase()}:damage-choice`
          : `${spell.name.toLowerCase()}:damage`),
      property: 'damage-dice',
    };
  }
  if (kind === 'healing') {
    return {
      kind,
      semanticId: semanticId ?? `${spell.name.toLowerCase()}:healing`,
      property: numericKind === 'flat' ? 'healing-points' : 'healing-dice',
    };
  }
  if (kind === 'affected-hit-points') {
    return {
      kind,
      semanticId:
        semanticId ?? `${spell.name.toLowerCase()}:affected-hit-point-pool`,
      property: 'affected-hit-point-pool-dice',
    };
  }
  const property = /duration.*hours?/i.test(text)
    ? 'duration-hours'
    : /duration/i.test(text)
      ? 'duration'
      : /hit points?/i.test(text)
        ? 'hit-points'
        : /radius.*(?:feet|foot)/i.test(text)
          ? 'radius-feet'
          : /bonus/i.test(text)
            ? 'bonus'
            : /gallons?/i.test(text)
              ? 'volume-gallons'
              : /cube.*(?:feet|foot)|size.*(?:feet|foot)/i.test(text)
                ? 'cube-size-feet'
                : /level higher/i.test(text)
                  ? 'spell-level-threshold'
                  : /darts?|rays?|beams?/i.test(text)
                    ? 'projectile-count'
                    : /targets?/i.test(text)
                      ? 'target-count'
                      : /creatures?|beasts?/i.test(text)
                        ? 'creature-count'
                        : /objects?/i.test(text)
                          ? 'object-count'
                          : 'other-quantity';
  return {
    kind,
    semanticId: semanticId ?? `${spell.name.toLowerCase()}:effect`,
    property,
  };
}

function levelAbove(text: string): number | undefined {
  const match = /above (\d+)(?:st|nd|rd|th)/i.exec(text);
  return match === null ? undefined : Number(match[1]);
}

function componentDamageSubject(
  spell: SpellExtraction,
  text: string,
  semanticId: string,
  damageType?: string,
): UpcastSubject {
  if (damageType !== undefined) {
    return {
      kind: 'damage',
      damageType,
      semanticId,
      property: 'damage-dice',
    };
  }
  return subject(spell, 'damage', text, semanticId);
}

function addPerSlotOperations(
  spell: SpellExtraction,
  text: string,
): UpcastOperation[] {
  const operations: UpcastOperation[] = [];
  const seen = new Set<string>();
  const parentheticalComponents = [
    ...text.matchAll(
      /damage \(both ([a-z-]+) and ([a-z-]+)\) increases by (\d+d\d+) for (?:each|every) slot level(?:s)? above (\d+)/gi,
    ),
  ];
  for (const match of parentheticalComponents) {
    for (const component of [match[1], match[2]]) {
      const operation: UpcastOperation = {
        kind: 'dice-per-slot',
        subject: subject(
          spell,
          'damage',
          match[0],
          `${spell.name.toLowerCase()}:${component.toLowerCase()}-damage`,
        ),
        dice: match[3],
        startSlotLevel: Number(match[4]),
        everySlotLevels: 1,
      };
      seen.add(JSON.stringify(operation));
      operations.push(operation);
    }
  }
  const dice = [
    ...text.matchAll(
      /(?:increase|increases) by (\d+d\d+)(?:\s+\w+)* for (?:each|every) (?:two )?slot level(?:s)? above (\d+)/gi,
    ),
  ];
  for (const match of dice) {
    const matchIndex = match.index ?? 0;
    const sentenceStart = text.lastIndexOf('.', matchIndex) + 1;
    const sentenceEnd = text.indexOf('.', matchIndex);
    const sentence = text.slice(
      sentenceStart,
      sentenceEnd === -1 ? text.length : sentenceEnd + 1,
    );
    if (
      parentheticalComponents.some(
        (component) =>
          component.index !== undefined &&
          match.index !== undefined &&
          match.index >= component.index &&
          match.index < component.index + component[0].length,
      )
    )
      continue;
    if (
      [
        ...sentence.matchAll(
          /damage from the ([a-z ]+?)(?: option)? increases by (\d+d\d+)/gi,
        ),
      ].length > 1
    )
      continue;
    const d = match[1];
    if (!DICE.test(d))
      throw new Error(`invalid upcast dice ${d} in ${spell.name}`);
    const isHealing = /healing/i.test(text);
    const operation: UpcastOperation = {
      kind: 'dice-per-slot',
      subject: subject(spell, isHealing ? 'healing' : 'damage', text),
      dice: d,
      startSlotLevel: Number(match[2]),
      everySlotLevels: /every two slot levels/i.test(match[0]) ? 2 : 1,
    };
    seen.add(JSON.stringify(operation));
    operations.push(operation);
  }
  const rolledAdditional = [
    ...text.matchAll(
      /(?:roll|creates?) an? additional (\d+d\d+) for (?:each|every) slot level(?:s)? above (\d+)/gi,
    ),
  ];
  for (const match of rolledAdditional) {
    const affectedHitPointPool = /color spray|sleep/i.test(spell.name);
    const operation: UpcastOperation = {
      kind: 'dice-per-slot',
      subject: subject(
        spell,
        affectedHitPointPool ? 'affected-hit-points' : 'damage',
        text,
      ),
      dice: match[1],
      startSlotLevel: Number(match[2]),
      everySlotLevels: 1,
    };
    if (!seen.has(JSON.stringify(operation))) operations.push(operation);
  }
  const flat = [
    ...text.matchAll(
      /(?:additional |increases by |increase by )([0-9]+)(?:\s+\w+)* for each slot level above (\d+)/gi,
    ),
    ...text.matchAll(
      /(one|two|three|four|five|six|seven|eight|nine|\d+) level higher for each slot level above (\d+)/gi,
    ),
    ...text.matchAll(
      /increases? [^.]*? by (\d+)(?:\s+\w+)* for each slot level beyond (\d+)/gi,
    ),
  ];
  const wordsForFlat: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
  };
  for (const match of flat) {
    const operation: UpcastOperation = {
      kind: 'flat-per-slot',
      subject: subject(
        spell,
        /healing/i.test(text) ? 'healing' : 'effect',
        text,
        undefined,
        'flat',
      ),
      amount: wordsForFlat[match[1].toLowerCase()] ?? Number(match[1]),
      startSlotLevel: Number(match[2]),
      everySlotLevels: 1,
    };
    seen.add(JSON.stringify(operation));
    operations.push(operation);
  }
  const counts = [
    ...text.matchAll(
      /(one|two|three|four|five|six|seven|eight|nine|\d+) (?:additional|more) [^.]*?(?:for each|for every) slot level(?:s)? above (\d+)/gi,
    ),
  ];
  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
  };
  for (const match of counts) {
    const operation: UpcastOperation = {
      kind: 'count-per-slot',
      subject: subject(spell, 'effect', match[0]),
      count: words[match[1].toLowerCase()] ?? Number(match[1]),
      startSlotLevel: Number(match[2]),
      everySlotLevels: 1,
    };
    if (!seen.has(JSON.stringify(operation))) operations.push(operation);
  }
  for (const match of text.matchAll(
    /up to (one|two|three|four|five|six|seven|eight|nine|\d+) [^.]*?for each slot level above (\d+)/gi,
  )) {
    const operation: UpcastOperation = {
      kind: 'count-per-slot',
      subject: subject(spell, 'effect', match[0]),
      count: words[match[1].toLowerCase()] ?? Number(match[1]),
      startSlotLevel: Number(match[2]),
      everySlotLevels: 1,
    };
    if (!seen.has(JSON.stringify(operation))) operations.push(operation);
  }
  // A single source sentence can increase independent components (Arcane
  // Hand, Wall of Ice, and Wall of Fire). Keep each adjustment distinct by a
  // stable source-owned semantic id; never use a mechanics array offset.
  for (const sentence of text.split(/(?<=\.)\s+/)) {
    if (!/for each slot level above/i.test(sentence)) continue;
    const levels = levelAbove(sentence);
    if (levels === undefined) continue;
    const components = [
      ...sentence.matchAll(
        /damage from the ([a-z ]+?)(?: option)? increases by (\d+d\d+)/gi,
      ),
    ];
    if (components.length < 2) continue;
    components.forEach((component) => {
      const componentName = component[1].trim().toLowerCase();
      const arcaneHandType =
        spell.name === 'Arcane Hand'
          ? componentName === 'clenched fist'
            ? 'force'
            : componentName === 'grasping hand'
              ? 'bludgeoning'
              : undefined
          : undefined;
      const operation: UpcastOperation = {
        kind: 'dice-per-slot',
        subject: componentDamageSubject(
          spell,
          sentence,
          `${spell.name.toLowerCase()}:${componentName.replace(/\s+/g, '-')}`,
          arcaneHandType,
        ),
        dice: component[2],
        startSlotLevel: levels,
        everySlotLevels: /every two slot levels/i.test(sentence) ? 2 : 1,
      };
      if (!seen.has(JSON.stringify(operation))) operations.push(operation);
    });
  }
  return operations;
}

function thresholdOperations(
  spell: SpellExtraction,
  text: string,
): UpcastOperation[] {
  if (/for (?:each|every)(?: two)? slot levels?/i.test(text)) return [];
  const operations: UpcastOperation[] = [];
  if (/spell slot/i.test(text)) {
    for (const sentence of text.split(/(?<=\.)\s+/)) {
      const levels = new Set(
        [
          ...sentence.matchAll(
            /(?:slot|slots) (?:of |at |used for )?(\d+)(?:st|nd|rd|th)?/gi,
          ),
          ...sentence.matchAll(/(\d+)(?:st|nd|rd|th)[- ]level spell slot/gi),
        ].map((match) => Number(match[1])),
      );
      const duration = /duration (?:is |increases to )([^.]+)/i.exec(
        sentence,
      )?.[1];
      for (const level of levels) {
        if (level >= 1 && level <= 9)
          operations.push({
            kind: 'threshold',
            subject: subject(spell, 'effect', sentence),
            atSlotLevel: level,
            value: duration?.trim() ?? sentence.trim(),
          });
      }
    }
  }
  return operations;
}

/** Compile one retained SRD clause. It is intentionally not a prose formula engine. */
export function compileSpellUpcast(
  spell: SpellExtraction,
): SpellUpcastSpec | undefined {
  if (
    spell.level === 0 ||
    spell.scalingSourceKind !== 'higher-slot' ||
    spell.higherLevels === undefined
  )
    return undefined;
  const spellKey = `spell:${spellSlug(spell.name)}`;
  const expectedPage = EXPECTED_HIGHER_SLOT_SOURCE_PAGES[spellKey];
  // Small parser fixtures intentionally renumber their synthetic pages; the
  // full SRD source (pages > 20) is the compiler's source-drift gate.
  if (
    expectedPage !== undefined &&
    spell.sourcePage >= 100 &&
    spell.sourcePage <= 200 &&
    expectedPage !== spell.sourcePage
  ) {
    throw new Error(
      `source page drift for ${spellKey}: expected ${expectedPage}, got ${spell.sourcePage}`,
    );
  }
  const clauseId = `${spellSlug(spell.name)}:higher-slot`;
  const isS1 = S1_SUMMONS.has(spellSlug(spell.name));
  const malformedAnimalFriendship =
    'When you cast this spell using a spell slot of 2nd level or higher, you can affect one additional beast t level above 1st.';
  const operationText =
    spellKey === 'spell:animal-friendship' &&
    spell.sourcePage === 115 &&
    spell.higherLevels === malformedAnimalFriendship
      ? 'When you cast this spell using a spell slot of 2nd level or higher, you can affect one additional beast for each slot level above 1st.'
      : spell.higherLevels;
  if (/\bbeast t level above\b/i.test(operationText)) {
    throw new Error(
      `malformed Animal Friendship higher-level source in ${spell.name}`,
    );
  }
  const reviewed = isS1
    ? undefined
    : reviewedProjection(spell, spellKey.slice('spell:'.length), operationText);
  const operations = isS1
    ? []
    : (reviewed?.operations ?? [
        ...addPerSlotOperations(spell, operationText),
        ...thresholdOperations(spell, operationText),
      ]);
  const hasUnqualifiedOperation = operations.some(
    (operation) =>
      operation.subject.kind === 'effect' &&
      operation.subject.property === 'other-quantity',
  );
  const firstHigherSlot =
    Number(
      /(?:slot(?: of)? |a )(\d+)(?:st|nd|rd|th)[- ]level/i.exec(
        spell.higherLevels,
      )?.[1],
    ) || spell.level + 1;
  const qualifier =
    reviewed?.qualifier ??
    (!isS1 && (operations.length === 0 || hasUnqualifiedOperation)
      ? { text: spell.higherLevels, minSlotLevel: firstHigherSlot }
      : undefined);
  const coverage = REVIEWED_CLAUSE_COVERAGE[spellKey.slice('spell:'.length)];
  if (
    coverage !== undefined &&
    (operations.length !== coverage.operationCount ||
      (qualifier !== undefined) !== coverage.qualifier)
  ) {
    throw new Error(`reviewed upcast coverage drift for ${spellKey}`);
  }
  return {
    sourceKind: 'higher-slot',
    clauseId,
    sourcePhrase: spell.scalingSourceText ?? spell.higherLevels,
    sourcePage: spell.sourcePage,
    operations,
    ...(qualifier === undefined ? {} : { qualifier }),
    disposition: isS1
      ? 'existing-s1-typed-scaling'
      : qualifier === undefined
        ? 'complete-typed-upcast'
        : 'typed-core-with-model-qualifier',
  };
}
