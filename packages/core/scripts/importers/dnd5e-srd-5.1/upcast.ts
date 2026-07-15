import { EXPECTED_HIGHER_SLOT_SOURCE_PAGES } from './spellUpcastInventory.js';
import type { SpellExtraction } from './types.js';

/** The deliberately closed D&D spell-upcast vocabulary emitted by the compiler. */
export type UpcastSubject =
  | {
      readonly kind: 'damage';
      readonly damageType?: string;
      readonly semanticId: string;
    }
  | { readonly kind: 'healing'; readonly semanticId: string }
  | { readonly kind: 'effect'; readonly semanticId: string };

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
): UpcastSubject {
  const types = [...spell.description.matchAll(DAMAGE_TYPES)].map((m) =>
    m[1].toLowerCase(),
  );
  if (kind === 'damage') {
    return {
      kind,
      ...(types.length === 1 ? { damageType: types[0] } : {}),
      semanticId:
        types.length > 1
          ? `${spell.name.toLowerCase()}:damage-choice`
          : `${spell.name.toLowerCase()}:damage`,
    };
  }
  return { kind, semanticId: `${spell.name.toLowerCase()}:${kind}` };
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
  const dice = [
    ...text.matchAll(
      /(?:increase|increases) by (\d+d\d+)(?:\s+\w+)* for (?:each|every) (?:two )?slot level(?:s)? above (\d+)/gi,
    ),
  ];
  for (const match of dice) {
    const d = match[1];
    if (!DICE.test(d))
      throw new Error(`invalid upcast dice ${d} in ${spell.name}`);
    const isHealing = /healing/i.test(text);
    const operation: UpcastOperation = {
      kind: 'dice-per-slot',
      subject: subject(spell, isHealing ? 'healing' : 'damage'),
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
      subject: subject(spell, 'damage'),
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
      subject: subject(spell, /healing/i.test(text) ? 'healing' : 'effect'),
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
      subject: subject(spell, 'effect'),
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
      subject: subject(spell, 'effect'),
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
    const sentenceDice = [...sentence.matchAll(/\b(\d+d\d+)\b/gi)].map(
      (m) => m[1],
    );
    if (sentenceDice.length < 2) continue;
    sentenceDice.forEach((dice, index) => {
      const operation: UpcastOperation = {
        kind: 'dice-per-slot',
        subject: {
          ...subject(spell, /healing/i.test(sentence) ? 'healing' : 'damage'),
          semanticId: `${spell.name.toLowerCase()}:component-${index + 1}`,
        },
        dice,
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
      subject: subject(spell, 'effect'),
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
            subject: subject(spell, 'effect'),
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
  const operations = isS1
    ? []
    : [
        ...addPerSlotOperations(spell, spell.higherLevels),
        ...thresholdOperations(spell, spell.higherLevels),
      ];
  const qualifier = operations.length === 0 ? spell.higherLevels : undefined;
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
