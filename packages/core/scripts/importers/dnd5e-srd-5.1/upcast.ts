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
  return undefined;
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
