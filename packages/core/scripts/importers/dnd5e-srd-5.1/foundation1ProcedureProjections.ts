import type {
  BoundedProcedure,
  FeatureOptionEffect,
} from '../../../src/rules/boundedProcedures.js';
import type { RulesRecord } from '../../../src/rules/types.js';

type JsonObject = Record<string, unknown>;

export const FOUNDATION1_PROJECTION_RECORD_KEYS = [
  'equipment:longsword',
  'feature:fighter:fighting-style',
  'feature:sorcerer:font-of-magic',
  'hazard:burnt-othur-fumes',
  'spell:wish',
] as const;

const SUPPORTING_RECORD_KEYS = [
  'rule:weapon-properties',
  'table:creating-spell-slots',
  'table:the-sorcerer',
] as const;

const REQUIRED_RECORD_KEYS = [
  ...FOUNDATION1_PROJECTION_RECORD_KEYS,
  ...SUPPORTING_RECORD_KEYS,
] as const;

export class Foundation1ProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Foundation1ProjectionError';
  }
}

function objectAt(value: unknown, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Foundation1ProjectionError(`${path} must be an object`);
  }
  return value as JsonObject;
}

function stringAt(object: JsonObject, key: string, path: string): string {
  const value = object[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Foundation1ProjectionError(
      `${path}.${key} must be a non-empty string`,
    );
  }
  return value;
}

function assertIncludes(text: string, phrase: string, recordKey: string): void {
  if (!text.includes(phrase)) {
    throw new Foundation1ProjectionError(
      `${recordKey} source drift: missing ${JSON.stringify(phrase)}`,
    );
  }
}

function recordMap(records: readonly RulesRecord[]): Map<string, RulesRecord> {
  const byKey = new Map(records.map((record) => [record.key, record]));
  for (const key of REQUIRED_RECORD_KEYS) {
    if (!byKey.has(key)) {
      throw new Foundation1ProjectionError(`required record ${key} is missing`);
    }
  }
  return byKey;
}

function dataOf(
  byKey: ReadonlyMap<string, RulesRecord>,
  key: string,
): JsonObject {
  return objectAt(byKey.get(key)?.data, `${key}.data`);
}

function withProcedures(
  record: RulesRecord,
  procedures: readonly BoundedProcedure[],
  removeMechanicsKeys: readonly string[] = [],
): RulesRecord {
  const data = objectAt(record.data, `${record.key}.data`);
  const mechanics =
    data.mechanics === undefined
      ? {}
      : { ...objectAt(data.mechanics, `${record.key}.data.mechanics`) };
  for (const key of removeMechanicsKeys) delete mechanics[key];
  mechanics.procedures = procedures;
  return {
    ...record,
    data: {
      ...data,
      mechanics,
    },
  };
}

function burntOthurProcedure(data: JsonObject): BoundedProcedure {
  const description = stringAt(
    data,
    'description',
    'hazard:burnt-othur-fumes.data',
  );
  for (const phrase of [
    'DC 13 Constitution saving throw or take 10 (3d6) poison damage',
    'repeat the saving throw at the start of each of its turns',
    'On each successive failed save, the character takes 3 (1d6) poison damage',
    'After three successful saves, the poison ends',
  ]) {
    assertIncludes(description, phrase, 'hazard:burnt-othur-fumes');
  }
  return {
    id: 'burnt-othur-fumes',
    kind: 'repeat-save-hazard',
    entryTransition: {
      onInitialSuccess: 'end',
      onInitialFailure: 'activate-repeat',
    },
    initial: {
      save: { ability: 'constitution', dc: 13 },
      failureDamage: { dice: '3d6', type: 'poison' },
    },
    repeat: {
      timing: 'start-of-affected-turn',
      save: { ability: 'constitution', dc: 13 },
      failureDamage: { dice: '1d6', type: 'poison' },
    },
    termination: { kind: 'successful-saves', count: 3 },
  };
}

function longswordProcedure(
  data: JsonObject,
  weaponProperties: JsonObject,
): BoundedProcedure {
  if (
    data.damageDie !== '1d8' ||
    data.damageType !== 'slashing' ||
    !Array.isArray(data.properties) ||
    !data.properties.includes('Versatile (1d10)')
  ) {
    throw new Foundation1ProjectionError(
      'equipment:longsword table projection no longer matches the reviewed 1d8/Versatile (1d10) source rows',
    );
  }
  const text = stringAt(
    weaponProperties,
    'text',
    'rule:weapon-properties.data',
  );
  assertIncludes(
    text,
    'Versatile. This weapon can be used with one or two hands. A damage value in parentheses appears with the property—the damage when the weapon is used with two hands to make a melee attack.',
    'rule:weapon-properties',
  );
  return {
    id: 'longsword-damage',
    kind: 'weapon-damage-modes',
    selector: 'hands-used',
    modes: [
      {
        id: 'one-handed',
        hands: 1,
        damage: { dice: '1d8', type: 'slashing' },
      },
      {
        id: 'two-handed',
        hands: 2,
        damage: { dice: '1d10', type: 'slashing' },
      },
    ],
  };
}

const FIGHTING_STYLE_EFFECTS: ReadonlyMap<string, FeatureOptionEffect> =
  new Map([
    [
      'fighting-style:archery',
      { kind: 'attack-roll-bonus', amount: 2, weaponRange: 'ranged' },
    ],
    [
      'fighting-style:defense',
      { kind: 'armor-class-bonus', amount: 1, whileWearingArmor: true },
    ],
    [
      'fighting-style:dueling',
      {
        kind: 'damage-roll-bonus',
        amount: 2,
        weaponRange: 'melee',
        weaponHands: 1,
        noOtherWeapon: true,
      },
    ],
    [
      'fighting-style:great-weapon-fighting',
      {
        kind: 'damage-die-reroll',
        rerollValues: [1, 2],
        keepReroll: true,
        weaponRange: 'melee',
        handsUsed: 2,
        propertyRequirement: {
          kind: 'any-of',
          properties: ['two-handed', 'versatile'],
        },
      },
    ],
    [
      'fighting-style:protection',
      {
        kind: 'reaction-attack-disadvantage',
        actionCost: 'reaction',
        attacker: { mustBeVisibleToYou: true },
        protectedTarget: {
          mustBeOtherThanYou: true,
          maximumDistanceFromYouFeet: 5,
        },
        requiresShield: true,
      },
    ],
    [
      'fighting-style:two-weapon-fighting',
      {
        kind: 'offhand-damage-ability-modifier',
        addAbilityModifier: true,
      },
    ],
  ]);

const FIGHTING_STYLE_SOURCE_TEXT: ReadonlyMap<string, string> = new Map([
  [
    'fighting-style:archery',
    'You gain a +2 bonus to attack rolls you make with ranged weapons.',
  ],
  [
    'fighting-style:defense',
    'While you are wearing armor, you gain a +1 bonus to AC.',
  ],
  [
    'fighting-style:dueling',
    'When you are wielding a melee weapon in one hand and no other weapons, you gain a +2 bonus to damage rolls with that weapon.',
  ],
  [
    'fighting-style:great-weapon-fighting',
    'When you roll a 1 or 2 on a damage die for an attack you make with a melee weapon that you are wielding with two hands, you can reroll the die and must use the new roll, even if the new roll is a 1 or a 2. The weapon must have the two-handed or versatile property for you to gain this benefit.',
  ],
  [
    'fighting-style:protection',
    'When a creature you can see attacks a target other than you that is within 5 feet of you, you can use your reaction to impose disadvantage on the attack roll. You must be wielding a shield.',
  ],
  [
    'fighting-style:two-weapon-fighting',
    'When you engage in two-weapon fighting, you can add your ability modifier to the damage of the second attack.',
  ],
]);

function fightingStyleProcedure(data: JsonObject): BoundedProcedure {
  const description = stringAt(
    data,
    'description',
    'feature:fighter:fighting-style.data',
  );
  assertIncludes(
    description,
    'Choose one of the following options. You can’t take a Fighting Style option more than once',
    'feature:fighter:fighting-style',
  );
  const choices = data.choices;
  if (!Array.isArray(choices) || choices.length !== 1) {
    throw new Foundation1ProjectionError(
      'feature:fighter:fighting-style must carry exactly one structured choice',
    );
  }
  const choice = objectAt(
    choices[0],
    'feature:fighter:fighting-style.data.choices[0]',
  );
  if (choice.choose !== 1 || !Array.isArray(choice.options)) {
    throw new Foundation1ProjectionError(
      'feature:fighter:fighting-style choice cardinality/options drifted',
    );
  }
  const options = choice.options.map((value, index) => {
    const option = objectAt(
      value,
      `feature:fighter:fighting-style.data.choices[0].options[${index}]`,
    );
    const id = stringAt(
      option,
      'id',
      `feature:fighter:fighting-style.data.choices[0].options[${index}]`,
    );
    const effect = FIGHTING_STYLE_EFFECTS.get(id);
    if (effect === undefined) {
      throw new Foundation1ProjectionError(
        `feature:fighter:fighting-style has unreviewed option ${JSON.stringify(id)}`,
      );
    }
    const sourceText = FIGHTING_STYLE_SOURCE_TEXT.get(id);
    if (sourceText === undefined || option.text !== sourceText) {
      throw new Foundation1ProjectionError(
        `feature:fighter:fighting-style option ${JSON.stringify(id)} source text drifted`,
      );
    }
    return { id, effect };
  });
  if (options.length !== FIGHTING_STYLE_EFFECTS.size) {
    throw new Foundation1ProjectionError(
      'feature:fighter:fighting-style option census drifted',
    );
  }
  return {
    id: 'fighter-fighting-style',
    kind: 'feature-options',
    choiceId: 'fighting-style',
    duplicateSelection: 'prohibited',
    options,
  };
}

function tableData(
  byKey: ReadonlyMap<string, RulesRecord>,
  key: string,
): {
  readonly columns: readonly unknown[];
  readonly rows: readonly unknown[][];
} {
  const data = dataOf(byKey, key);
  if (!Array.isArray(data.columns) || !Array.isArray(data.rows)) {
    throw new Foundation1ProjectionError(`${key} must carry columns and rows`);
  }
  return {
    columns: data.columns,
    rows: data.rows.map((row, index) => {
      if (!Array.isArray(row)) {
        throw new Foundation1ProjectionError(
          `${key}.data.rows[${index}] must be an array`,
        );
      }
      return row;
    }),
  };
}

function ordinalLevel(value: unknown, path: string): number {
  if (typeof value !== 'string') {
    throw new Foundation1ProjectionError(
      `${path} must be an ordinal level string`,
    );
  }
  const match = /^(\d+)(?:st|nd|rd|th)$/.exec(value);
  if (match === null) {
    throw new Foundation1ProjectionError(
      `${path} must be an ordinal level string`,
    );
  }
  return Number(match[1]);
}

function fontOfMagicProcedure(
  data: JsonObject,
  byKey: ReadonlyMap<string, RulesRecord>,
): BoundedProcedure {
  const description = stringAt(
    data,
    'description',
    'feature:sorcerer:font-of-magic.data',
  );
  for (const phrase of [
    'You can never have more sorcery points than shown on the table for your level.',
    'You regain all spent sorcery points when you finish a long rest.',
    'The Creating Spell Slots table shows the cost of creating a spell slot of a given level.',
    'You can create spell slots no higher in level than 5th.',
    'Any spell slot you create with this feature vanishes when you finish a long rest.',
    'gain a number of sorcery points equal to the slot’s level.',
    'Creating Spell Slots. You can transform unexpended sorcery points into one spell slot as a bonus action on your turn.',
    'Converting a Spell Slot to Sorcery Points. As a bonus action on your turn, you can expend one spell slot and gain a number of sorcery points equal to the slot’s level.',
  ]) {
    assertIncludes(description, phrase, 'feature:sorcerer:font-of-magic');
  }
  const progression = tableData(byKey, 'table:the-sorcerer');
  const pointsIndex = progression.columns.indexOf('Sorcery Points');
  const levelIndex = progression.columns.indexOf('Level');
  if (pointsIndex < 0 || levelIndex < 0) {
    throw new Foundation1ProjectionError(
      'table:the-sorcerer no longer contains Level and Sorcery Points columns',
    );
  }
  const maximumByLevel = progression.rows.flatMap((row, index) => {
    const rawMaximum = row[pointsIndex];
    if (rawMaximum === '') return [];
    const maximum =
      typeof rawMaximum === 'number' ? rawMaximum : Number(rawMaximum);
    if (!Number.isInteger(maximum) || maximum < 1) {
      throw new Foundation1ProjectionError(
        `table:the-sorcerer row ${index} has invalid Sorcery Points`,
      );
    }
    return [
      {
        level: ordinalLevel(
          row[levelIndex],
          `table:the-sorcerer.data.rows[${index}][${levelIndex}]`,
        ),
        maximum,
      },
    ];
  });
  const costsTable = tableData(byKey, 'table:creating-spell-slots');
  if (
    costsTable.columns[0] !== 'Spell Slot Level' ||
    costsTable.columns[1] !== 'Sorcery Point Cost'
  ) {
    throw new Foundation1ProjectionError(
      'table:creating-spell-slots column fingerprint drifted',
    );
  }
  const costBySlotLevel = costsTable.rows.map((row, index) => {
    const cost = typeof row[1] === 'number' ? row[1] : Number(row[1]);
    if (!Number.isInteger(cost) || cost < 1) {
      throw new Foundation1ProjectionError(
        `table:creating-spell-slots row ${index} has invalid cost`,
      );
    }
    return {
      slotLevel: ordinalLevel(
        row[0],
        `table:creating-spell-slots.data.rows[${index}][0]`,
      ),
      cost,
    };
  });
  return {
    id: 'font-of-magic',
    kind: 'resource-conversion',
    pool: {
      id: 'sorcery-points',
      name: 'Sorcery Points',
      maximumByLevel,
      reset: 'long-rest',
    },
    operations: {
      createSpellSlot: {
        actionCost: 'bonus-action',
        maximumSlotLevel: 5,
        costBySlotLevel,
        createdSlotExpires: 'long-rest',
      },
      convertSpellSlot: {
        actionCost: 'bonus-action',
        pointsGained: 'slot-level',
      },
    },
  };
}

function wishProcedure(data: JsonObject): BoundedProcedure {
  const description = stringAt(data, 'description', 'spell:wish.data');
  for (const phrase of [
    'You might be able to achieve something beyond the scope of the above examples.',
    'The GM has great latitude in ruling what occurs in such an instance',
    'effect other than duplicating another spell weakens you',
    'each time you cast a spell until you finish a long rest, you take 1d10 necrotic damage per level of that spell',
    'This damage can’t be reduced or prevented in any way',
    'your Strength drops to 3, if it isn’t 3 or lower already, for 2d4 days',
    'For each of those days that you spend resting and doing nothing more than light activity, your remaining recovery time decreases by 2 days.',
    'there is a 33 percent chance that you are unable to cast wish ever again if you suffer this stress',
  ]) {
    assertIncludes(description, phrase, 'spell:wish');
  }
  return {
    id: 'wish-nonstandard-effect',
    kind: 'adjudicated-stress',
    adjudicationBoundary: {
      id: 'wish-beyond-listed-effects',
      boundaryKind: 'designed-adjudication',
      adjudicator: 'dm',
      trigger: 'beyond-listed-effects',
    },
    stress: {
      trigger: 'non-duplication-effect',
      recurringDamage: {
        event: 'cast-spell-before-long-rest',
        dicePerSpellLevel: '1d10',
        damageType: 'necrotic',
        preventable: false,
      },
      strength: {
        maximumAfterStress: 3,
        durationDice: '2d4',
        unit: 'day',
      },
      recovery: {
        ordinaryDayReduction: 1,
        restDayReduction: 2,
        maximumRestActivity: 'light',
      },
      wishLoss: {
        chancePercent: 33,
        state: 'unable-to-cast-wish',
      },
    },
  };
}

/**
 * Project the five reviewed procedures. This module never imports the source
 * obligation specification and emits no obligation ids or discharge links.
 */
export function applyFoundation1ProcedureProjections(
  records: readonly RulesRecord[],
): readonly RulesRecord[] {
  const byKey = recordMap(records);
  const procedures = new Map<string, readonly BoundedProcedure[]>([
    [
      'hazard:burnt-othur-fumes',
      [burntOthurProcedure(dataOf(byKey, 'hazard:burnt-othur-fumes'))],
    ],
    [
      'equipment:longsword',
      [
        longswordProcedure(
          dataOf(byKey, 'equipment:longsword'),
          dataOf(byKey, 'rule:weapon-properties'),
        ),
      ],
    ],
    [
      'feature:fighter:fighting-style',
      [fightingStyleProcedure(dataOf(byKey, 'feature:fighter:fighting-style'))],
    ],
    [
      'feature:sorcerer:font-of-magic',
      [
        fontOfMagicProcedure(
          dataOf(byKey, 'feature:sorcerer:font-of-magic'),
          byKey,
        ),
      ],
    ],
    ['spell:wish', [wishProcedure(dataOf(byKey, 'spell:wish'))]],
  ]);
  return records.map((record) => {
    const projected = procedures.get(record.key);
    if (projected === undefined) return record;
    const removeKeys =
      record.key === 'hazard:burnt-othur-fumes'
        ? ['saves', 'damage']
        : record.key === 'feature:sorcerer:font-of-magic'
          ? ['resources']
          : record.key === 'spell:wish'
            ? ['damage']
            : [];
    return withProcedures(record, projected, removeKeys);
  });
}

export function canApplyFoundation1ProcedureProjections(
  records: readonly RulesRecord[],
): boolean {
  const keys = new Set(records.map((record) => record.key));
  return REQUIRED_RECORD_KEYS.every((key) => keys.has(key));
}
