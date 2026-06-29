import {
  type StartingEquipmentGrant as ResolvedEquipmentGrant,
  resolveStartingEquipmentGrants,
} from '../../../src/character/srdStartingEquipmentGrants.js';
import type { RulesRecord } from '../../../src/rules/types.js';

const ABILITY_SCORE_NAMES = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
] as const;

type AbilityScoreName = (typeof ABILITY_SCORE_NAMES)[number];

interface AbilityScoreIncrease {
  readonly ability: AbilityScoreName;
  readonly bonus: number;
}

interface AbilityScoreIncreaseChoice {
  readonly choose: number;
  readonly bonus: number;
  readonly from: readonly AbilityScoreName[];
}

interface AncestryAbilityScoreIncrease {
  readonly fixed: readonly AbilityScoreIncrease[];
  readonly choice?: AbilityScoreIncreaseChoice;
  readonly sourceText: string;
}

interface LanguageGrant {
  readonly fixed: readonly string[];
  readonly choose?: number;
  readonly sourceText: string;
}

interface ClassSpellcasting {
  readonly ability: AbilityScoreName;
  readonly preparation: 'known' | 'prepared';
  readonly spellbookStartingSpells?: number;
  readonly sourceText: string;
}

interface StartingEquipmentOption {
  readonly label: string;
  readonly text: string;
  readonly grants: readonly ResolvedEquipmentGrant[];
}

interface StartingEquipmentChoice {
  readonly kind: 'choice';
  readonly options: readonly StartingEquipmentOption[];
  readonly sourceText: string;
}

interface StartingEquipmentGrant {
  readonly kind: 'fixed';
  readonly text: string;
  readonly sourceText: string;
  readonly grants: readonly ResolvedEquipmentGrant[];
}

type StartingEquipmentEntry = StartingEquipmentChoice | StartingEquipmentGrant;

interface ClassStartingEquipment {
  readonly entries: readonly StartingEquipmentEntry[];
}

function abilitiesExcept(
  ...excluded: readonly AbilityScoreName[]
): readonly AbilityScoreName[] {
  const omit = new Set(excluded);
  return ABILITY_SCORE_NAMES.filter((name) => !omit.has(name));
}

function known(sourceText: string, ...fixed: readonly string[]): LanguageGrant {
  return { fixed, sourceText };
}

function choose(
  sourceText: string,
  count: number,
  ...fixed: readonly string[]
): LanguageGrant {
  return { fixed, choose: count, sourceText };
}

function choice(
  sourceText: string,
  ...options: readonly (readonly [string, string])[]
): StartingEquipmentChoice {
  return {
    kind: 'choice',
    options: options.map(([label, text]) => ({
      label,
      text,
      grants: resolveStartingEquipmentGrants(text),
    })),
    sourceText,
  };
}

function fixed(
  text: string,
  sourceText: string = text,
): StartingEquipmentGrant {
  return {
    kind: 'fixed',
    text,
    sourceText,
    grants: resolveStartingEquipmentGrants(text),
  };
}

const ANCESTRY_ABILITY_SCORE_INCREASES: Readonly<
  Record<string, AncestryAbilityScoreIncrease>
> = {
  'ancestry:dragonborn': {
    fixed: [
      { ability: 'strength', bonus: 2 },
      { ability: 'charisma', bonus: 1 },
    ],
    sourceText:
      'Your Strength score increases by 2, and your Charisma score increases by 1.',
  },
  'ancestry:dwarf': {
    fixed: [{ ability: 'constitution', bonus: 2 }],
    sourceText: 'Your Constitution score increases by 2.',
  },
  'ancestry:elf': {
    fixed: [{ ability: 'dexterity', bonus: 2 }],
    sourceText: 'Your Dexterity score increases by 2.',
  },
  'ancestry:gnome': {
    fixed: [{ ability: 'intelligence', bonus: 2 }],
    sourceText: 'Your Intelligence score increases by 2.',
  },
  'ancestry:half-elf': {
    fixed: [{ ability: 'charisma', bonus: 2 }],
    choice: { choose: 2, bonus: 1, from: abilitiesExcept('charisma') },
    sourceText:
      'Your Charisma score increases by 2, and two other ability scores of your choice increase by 1.',
  },
  'ancestry:half-orc': {
    fixed: [
      { ability: 'strength', bonus: 2 },
      { ability: 'constitution', bonus: 1 },
    ],
    sourceText:
      'Your Strength score increases by 2, and your Constitution score increases by 1.',
  },
  'ancestry:halfling': {
    fixed: [{ ability: 'dexterity', bonus: 2 }],
    sourceText: 'Your Dexterity score increases by 2.',
  },
  'ancestry:high-elf': {
    fixed: [
      { ability: 'dexterity', bonus: 2 },
      { ability: 'intelligence', bonus: 1 },
    ],
    sourceText:
      'Your Dexterity score increases by 2. Your Intelligence score increases by 1.',
  },
  'ancestry:hill-dwarf': {
    fixed: [
      { ability: 'constitution', bonus: 2 },
      { ability: 'wisdom', bonus: 1 },
    ],
    sourceText:
      'Your Constitution score increases by 2. Your Wisdom score increases by 1.',
  },
  'ancestry:human': {
    fixed: ABILITY_SCORE_NAMES.map((ability) => ({ ability, bonus: 1 })),
    sourceText: 'Your ability scores each increase by 1.',
  },
  'ancestry:lightfoot-halfling': {
    fixed: [
      { ability: 'dexterity', bonus: 2 },
      { ability: 'charisma', bonus: 1 },
    ],
    sourceText:
      'Your Dexterity score increases by 2. Your Charisma score increases by 1.',
  },
  'ancestry:rock-gnome': {
    fixed: [
      { ability: 'intelligence', bonus: 2 },
      { ability: 'constitution', bonus: 1 },
    ],
    sourceText:
      'Your Intelligence score increases by 2. Your Constitution score increases by 1.',
  },
  'ancestry:tiefling': {
    fixed: [
      { ability: 'intelligence', bonus: 1 },
      { ability: 'charisma', bonus: 2 },
    ],
    sourceText:
      'Your Intelligence score increases by 1, and your Charisma score increases by 2.',
  },
};

const ANCESTRY_LANGUAGES: Readonly<Record<string, LanguageGrant>> = {
  'ancestry:dragonborn': known(
    'You can speak, read, and write Common and Draconic.',
    'Common',
    'Draconic',
  ),
  'ancestry:dwarf': known(
    'You can speak, read, and write Common and Dwarvish.',
    'Common',
    'Dwarvish',
  ),
  'ancestry:elf': known(
    'You can speak, read, and write Common and Elvish.',
    'Common',
    'Elvish',
  ),
  'ancestry:gnome': known(
    'You can speak, read, and write Common and Gnomish.',
    'Common',
    'Gnomish',
  ),
  'ancestry:half-elf': choose(
    'You can speak, read, and write Common, Elvish, and one extra language of your choice.',
    1,
    'Common',
    'Elvish',
  ),
  'ancestry:half-orc': known(
    'You can speak, read, and write Common and Orc.',
    'Common',
    'Orc',
  ),
  'ancestry:halfling': known(
    'You can speak, read, and write Common and Halfling.',
    'Common',
    'Halfling',
  ),
  'ancestry:high-elf': known(
    'You can speak, read, and write Common and Elvish.',
    'Common',
    'Elvish',
  ),
  'ancestry:hill-dwarf': known(
    'You can speak, read, and write Common and Dwarvish.',
    'Common',
    'Dwarvish',
  ),
  'ancestry:human': choose(
    'You can speak, read, and write Common and one extra language of your choice.',
    1,
    'Common',
  ),
  'ancestry:lightfoot-halfling': known(
    'You can speak, read, and write Common and Halfling.',
    'Common',
    'Halfling',
  ),
  'ancestry:rock-gnome': known(
    'You can speak, read, and write Common and Gnomish.',
    'Common',
    'Gnomish',
  ),
  'ancestry:tiefling': known(
    'You can speak, read, and write Common and Infernal.',
    'Common',
    'Infernal',
  ),
};

const BACKGROUND_LANGUAGES: Readonly<Record<string, LanguageGrant>> = {
  'background:acolyte': choose('Two of your choice', 2),
};

const CLASS_SPELLCASTING: Readonly<Record<string, ClassSpellcasting>> = {
  'class:bard': {
    ability: 'charisma',
    preparation: 'known',
    sourceText: 'Charisma is your spellcasting ability for your bard spells.',
  },
  'class:cleric': {
    ability: 'wisdom',
    preparation: 'prepared',
    sourceText:
      'You prepare the list of cleric spells that are available for you to cast, choosing from the cleric spell list. When you do so, choose a number of cleric spells equal to your Wisdom modifier + your cleric level (minimum of one spell). Wisdom is your spellcasting ability for your cleric spells.',
  },
  'class:druid': {
    ability: 'wisdom',
    preparation: 'prepared',
    sourceText:
      'You prepare the list of druid spells that are available for you to cast, choosing from the druid spell list. When you do so, choose a number of druid spells equal to your Wisdom modifier + your druid level (minimum of one spell). Wisdom is your spellcasting ability for your druid spells.',
  },
  'class:paladin': {
    ability: 'charisma',
    preparation: 'prepared',
    sourceText:
      'By 2nd level, you have learned to draw on divine magic through meditation and prayer to cast spells as a cleric does. Charisma is your spellcasting ability for your paladin spells.',
  },
  'class:ranger': {
    ability: 'wisdom',
    preparation: 'known',
    sourceText:
      'By the time you reach 2nd level, you have learned to use the magical essence of nature to cast spells, much as a druid does. Wisdom is your spellcasting ability for your ranger spells.',
  },
  'class:sorcerer': {
    ability: 'charisma',
    preparation: 'known',
    sourceText:
      'Charisma is your spellcasting ability for your sorcerer spells.',
  },
  'class:warlock': {
    ability: 'charisma',
    preparation: 'known',
    sourceText:
      'Charisma is your spellcasting ability for your warlock spells.',
  },
  'class:wizard': {
    ability: 'intelligence',
    preparation: 'prepared',
    spellbookStartingSpells: 6,
    sourceText:
      'At 1st level, you have a spellbook containing six 1st-level wizard spells of your choice. You prepare the list of wizard spells that are available for you to cast. To do so, choose a number of wizard spells from your spellbook equal to your Intelligence modifier + your wizard level (minimum of one spell). Intelligence is your spellcasting ability for your wizard spells.',
  },
};

const CLASS_STARTING_EQUIPMENT: Readonly<
  Record<string, ClassStartingEquipment>
> = {
  'class:barbarian': {
    entries: [
      choice(
        '(a) a greataxe or (b) any martial melee weapon',
        ['a', 'a greataxe'],
        ['b', 'any martial melee weapon'],
      ),
      choice(
        '(a) two handaxes or (b) any simple weapon',
        ['a', 'two handaxes'],
        ['b', 'any simple weapon'],
      ),
      fixed('An explorer’s pack and four javelins'),
    ],
  },
  'class:bard': {
    entries: [
      choice(
        '(a) a rapier, (b) a longsword, or (c) any simple weapon',
        ['a', 'a rapier'],
        ['b', 'a longsword'],
        ['c', 'any simple weapon'],
      ),
      choice(
        '(a) a diplomat’s pack or (b) an entertainer’s pack',
        ['a', 'a diplomat’s pack'],
        ['b', 'an entertainer’s pack'],
      ),
      choice(
        '(a) a lute or (b) any other musical instrument',
        ['a', 'a lute'],
        ['b', 'any other musical instrument'],
      ),
      fixed('Leather armor and a dagger'),
    ],
  },
  'class:cleric': {
    entries: [
      choice(
        '(a) a mace or (b) a warhammer (if proficient)',
        ['a', 'a mace'],
        ['b', 'a warhammer (if proficient)'],
      ),
      choice(
        '(a) scale mail, (b) leather armor, or (c) chain mail (if proficient)',
        ['a', 'scale mail'],
        ['b', 'leather armor'],
        ['c', 'chain mail (if proficient)'],
      ),
      choice(
        '(a) a light crossbow and 20 bolts or (b) any simple weapon',
        ['a', 'a light crossbow and 20 bolts'],
        ['b', 'any simple weapon'],
      ),
      choice(
        '(a) a priest’s pack or (b) an explorer’s pack',
        ['a', 'a priest’s pack'],
        ['b', 'an explorer’s pack'],
      ),
      fixed('A shield and a holy symbol'),
    ],
  },
  'class:druid': {
    entries: [
      choice(
        '(a) a wooden shield or (b) any simple weapon',
        ['a', 'a wooden shield'],
        ['b', 'any simple weapon'],
      ),
      choice(
        '(a) a scimitar or (b) any simple melee weapon',
        ['a', 'a scimitar'],
        ['b', 'any simple melee weapon'],
      ),
      fixed('Leather armor, an explorer’s pack, and a druidic focus'),
    ],
  },
  'class:fighter': {
    entries: [
      choice(
        '(a) chain mail or (b) leather armor, longbow, and 20 arrows',
        ['a', 'chain mail'],
        ['b', 'leather armor, longbow, and 20 arrows'],
      ),
      choice(
        '(a) a martial weapon and a shield or (b) two martial weapons',
        ['a', 'a martial weapon and a shield'],
        ['b', 'two martial weapons'],
      ),
      choice(
        '(a) a light crossbow and 20 bolts or (b) two handaxes',
        ['a', 'a light crossbow and 20 bolts'],
        ['b', 'two handaxes'],
      ),
      choice(
        '(a) a dungeoneer’s pack or (b) an explorer’s pack',
        ['a', 'a dungeoneer’s pack'],
        ['b', 'an explorer’s pack'],
      ),
    ],
  },
  'class:monk': {
    entries: [
      choice(
        '(a) a shortsword or (b) any simple weapon',
        ['a', 'a shortsword'],
        ['b', 'any simple weapon'],
      ),
      choice(
        '(a) a dungeoneer’s pack or (b) an explorer’s pack',
        ['a', 'a dungeoneer’s pack'],
        ['b', 'an explorer’s pack'],
      ),
      fixed('10 darts'),
    ],
  },
  'class:paladin': {
    entries: [
      choice(
        '(a) a martial weapon and a shield or (b) two martial weapons',
        ['a', 'a martial weapon and a shield'],
        ['b', 'two martial weapons'],
      ),
      choice(
        '(a) five javelins or (b) any simple melee weapon',
        ['a', 'five javelins'],
        ['b', 'any simple melee weapon'],
      ),
      choice(
        '(a) a priest’s pack or (b) an explorer’s pack',
        ['a', 'a priest’s pack'],
        ['b', 'an explorer’s pack'],
      ),
      fixed('Chain mail and a holy symbol'),
    ],
  },
  'class:ranger': {
    entries: [
      choice(
        '(a) scale mail or (b) leather armor',
        ['a', 'scale mail'],
        ['b', 'leather armor'],
      ),
      choice(
        '(a) two shortswords or (b) two simple melee weapons',
        ['a', 'two shortswords'],
        ['b', 'two simple melee weapons'],
      ),
      choice(
        '(a) a dungeoneer’s pack or (b) an explorer’s pack',
        ['a', 'a dungeoneer’s pack'],
        ['b', 'an explorer’s pack'],
      ),
      fixed('A longbow and a quiver of 20 arrows'),
    ],
  },
  'class:rogue': {
    entries: [
      choice(
        '(a) a rapier or (b) a shortsword',
        ['a', 'a rapier'],
        ['b', 'a shortsword'],
      ),
      choice(
        '(a) a shortbow and quiver of 20 arrows or (b) a shortsword',
        ['a', 'a shortbow and quiver of 20 arrows'],
        ['b', 'a shortsword'],
      ),
      choice(
        '(a) a burglar’s pack, (b) a dungeoneer’s pack, or (c) an explorer’s pack',
        ['a', 'a burglar’s pack'],
        ['b', 'a dungeoneer’s pack'],
        ['c', 'an explorer’s pack'],
      ),
      fixed(
        'Leather armor, two daggers, and thieves’ tools',
        '(a) Leather armor, two daggers, and thieves’ tools',
      ),
    ],
  },
  'class:sorcerer': {
    entries: [
      choice(
        '(a) a light crossbow and 20 bolts or (b) any simple weapon',
        ['a', 'a light crossbow and 20 bolts'],
        ['b', 'any simple weapon'],
      ),
      choice(
        '(a) a component pouch or (b) an arcane focus',
        ['a', 'a component pouch'],
        ['b', 'an arcane focus'],
      ),
      choice(
        '(a) a dungeoneer’s pack or (b) an explorer’s pack',
        ['a', 'a dungeoneer’s pack'],
        ['b', 'an explorer’s pack'],
      ),
      fixed('Two daggers'),
    ],
  },
  'class:warlock': {
    entries: [
      choice(
        '(a) a light crossbow and 20 bolts or (b) any simple weapon',
        ['a', 'a light crossbow and 20 bolts'],
        ['b', 'any simple weapon'],
      ),
      choice(
        '(a) a component pouch or (b) an arcane focus',
        ['a', 'a component pouch'],
        ['b', 'an arcane focus'],
      ),
      choice(
        '(a) a scholar’s pack or (b) a dungeoneer’s pack',
        ['a', 'a scholar’s pack'],
        ['b', 'a dungeoneer’s pack'],
      ),
      fixed('Leather armor, any simple weapon, and two daggers'),
    ],
  },
  'class:wizard': {
    entries: [
      choice(
        '(a) a quarterstaff or (b) a dagger',
        ['a', 'a quarterstaff'],
        ['b', 'a dagger'],
      ),
      choice(
        '(a) a component pouch or (b) an arcane focus',
        ['a', 'a component pouch'],
        ['b', 'an arcane focus'],
      ),
      choice(
        '(a) a scholar’s pack or (b) an explorer’s pack',
        ['a', 'a scholar’s pack'],
        ['b', 'an explorer’s pack'],
      ),
      fixed('A spellbook'),
    ],
  },
};

function cloneAbilityScoreIncreases(
  value: AncestryAbilityScoreIncrease,
): AncestryAbilityScoreIncrease {
  return {
    fixed: value.fixed.map((entry) => ({ ...entry })),
    ...(value.choice !== undefined
      ? {
          choice: {
            choose: value.choice.choose,
            bonus: value.choice.bonus,
            from: [...value.choice.from],
          },
        }
      : {}),
    sourceText: value.sourceText,
  };
}

function cloneLanguageGrant(value: LanguageGrant): LanguageGrant {
  return {
    fixed: [...value.fixed],
    ...(value.choose !== undefined ? { choose: value.choose } : {}),
    sourceText: value.sourceText,
  };
}

function cloneClassSpellcasting(value: ClassSpellcasting): ClassSpellcasting {
  return {
    ability: value.ability,
    preparation: value.preparation,
    ...(value.spellbookStartingSpells !== undefined
      ? { spellbookStartingSpells: value.spellbookStartingSpells }
      : {}),
    sourceText: value.sourceText,
  };
}

function cloneGrants(
  grants: readonly ResolvedEquipmentGrant[],
): readonly ResolvedEquipmentGrant[] {
  return grants.map((grant) => ({ ...grant }));
}

function cloneStartingEquipmentEntry(
  entry: StartingEquipmentEntry,
): StartingEquipmentEntry {
  if (entry.kind === 'fixed') {
    return {
      kind: 'fixed',
      text: entry.text,
      sourceText: entry.sourceText,
      grants: cloneGrants(entry.grants),
    };
  }
  return {
    kind: 'choice',
    options: entry.options.map((option) => ({
      ...option,
      grants: cloneGrants(option.grants),
    })),
    sourceText: entry.sourceText,
  };
}

function cloneClassStartingEquipment(
  value: ClassStartingEquipment,
): ClassStartingEquipment {
  return { entries: value.entries.map(cloneStartingEquipmentEntry) };
}

function dataObject(record: RulesRecord): Record<string, unknown> {
  return (record.data ?? {}) as Record<string, unknown>;
}

export function enrichAncestryCreationFacts(
  records: readonly RulesRecord[],
): RulesRecord[] {
  return records.map((record) => {
    const abilityScoreIncreases = ANCESTRY_ABILITY_SCORE_INCREASES[record.key];
    const languages = ANCESTRY_LANGUAGES[record.key];
    if (abilityScoreIncreases === undefined || languages === undefined) {
      return record;
    }
    return {
      ...record,
      data: {
        ...dataObject(record),
        abilityScoreIncreases: [
          cloneAbilityScoreIncreases(abilityScoreIncreases),
        ],
        languages: [cloneLanguageGrant(languages)],
      },
    };
  });
}

export function enrichBackgroundCreationFacts(
  records: readonly RulesRecord[],
): RulesRecord[] {
  return records.map((record) => {
    const languages = BACKGROUND_LANGUAGES[record.key];
    if (languages === undefined) {
      return record;
    }
    return {
      ...record,
      data: {
        ...dataObject(record),
        languages: [cloneLanguageGrant(languages)],
      },
    };
  });
}

export function classSpellcastingCreationFact(
  classKey: string,
): ClassSpellcasting | undefined {
  const fact = CLASS_SPELLCASTING[classKey];
  return fact === undefined ? undefined : cloneClassSpellcasting(fact);
}

export function classStartingEquipmentCreationFact(
  classKey: string,
): ClassStartingEquipment | undefined {
  const fact = CLASS_STARTING_EQUIPMENT[classKey];
  return fact === undefined ? undefined : cloneClassStartingEquipment(fact);
}
