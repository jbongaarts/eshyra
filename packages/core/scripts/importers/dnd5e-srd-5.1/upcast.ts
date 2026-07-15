import { EXPECTED_HIGHER_SLOT_SOURCE_PAGES } from './spellUpcastInventory.js';
import type { SpellExtraction } from './types.js';

/** The deliberately closed D&D spell-upcast vocabulary emitted by the compiler. */
export type UpcastSubject =
  | {
      readonly kind: 'damage';
      readonly damageType?: string;
      readonly damageTypes?: readonly string[];
      readonly selection?: 'choose-one';
      readonly semanticId: string;
      readonly property: 'damage-dice';
    }
  | {
      readonly kind: 'healing';
      readonly semanticId: string;
      readonly property: 'healing-dice';
    }
  | {
      readonly kind: 'effect';
      readonly semanticId: string;
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
  readonly qualifier?: string;
  readonly disposition:
    | 'complete-typed-upcast'
    | 'existing-s1-typed-scaling'
    | 'typed-core-with-model-qualifier';
}

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

function subject(
  spell: SpellExtraction,
  kind: UpcastSubject['kind'],
  text = spell.description,
  semanticId?: string,
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
            ...(/\bor\b|your choice/i.test(text)
              ? { selection: 'choose-one' as const }
              : {}),
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
      property: 'healing-dice',
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
    const operation: UpcastOperation = {
      kind: 'dice-per-slot',
      subject: subject(spell, 'damage', text),
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
      const operation: UpcastOperation = {
        kind: 'dice-per-slot',
        subject: {
          ...subject(
            spell,
            /healing/i.test(sentence) ? 'healing' : 'damage',
            sentence,
            `${spell.name.toLowerCase()}:${component[1].trim().toLowerCase().replace(/\s+/g, '-')}`,
          ),
        },
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
  const operations: UpcastOperation[] = [];
  for (const match of text.matchAll(
    /(?:using|with) (?:a )?(\d+)(?:st|nd|rd|th)[- ]level spell slot[^.]*?duration (?:is |increases to |is )([^.]+)/gi,
  )) {
    operations.push({
      kind: 'threshold',
      subject: subject(spell, 'effect', text),
      atSlotLevel: Number(match[1]),
      value: match[2].trim(),
    });
  }
  if (
    operations.length === 0 &&
    /spell slot/i.test(text) &&
    !/(?:for each|for every) slot level/i.test(text)
  ) {
    for (const sentence of text.split(/(?<=\.)\s+/)) {
      const levels = [
        ...sentence.matchAll(
          /(?:slot|slots) (?:of |at |used for )?(\d+)(?:st|nd|rd|th)?/gi,
        ),
        ...sentence.matchAll(/(\d+)(?:st|nd|rd|th)[- ]level spell slot/gi),
      ].map((m) => Number(m[1]));
      for (const level of levels) {
        if (level >= 1 && level <= 9)
          operations.push({
            kind: 'threshold',
            subject: subject(spell, 'effect', sentence),
            atSlotLevel: level,
            value: sentence.trim(),
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
  const spellKey = `spell:${spell.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
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
  const clauseId = `${spell.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}:higher-slot`;
  const isS1 = S1_SUMMONS.has(
    spell.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  );
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
  const operations = isS1
    ? []
    : [
        ...addPerSlotOperations(spell, operationText),
        ...thresholdOperations(spell, operationText),
      ];
  const hasUnqualifiedOperation = operations.some(
    (operation) =>
      operation.subject.kind === 'effect' &&
      operation.subject.property === 'other-quantity',
  );
  const qualifier =
    !isS1 && (operations.length === 0 || hasUnqualifiedOperation)
      ? spell.higherLevels
      : undefined;
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
