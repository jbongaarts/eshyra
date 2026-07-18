/**
 * Determinism + validation tests for the importer emit module.
 *
 * The emit module is the boundary between parsed SRD spell extractions and
 * the on-disk pack files. Two guarantees matter here:
 *   1. The emitted JSON is byte-identical across runs over the same input.
 *   2. The emitted pack always passes `validateRulesPack` — i.e. the
 *      generated records satisfy the per-kind dnd5e-srd spell schema and
 *      every record's provenance references the pack's source URL.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ArmorClassShapeError,
  actionExtractionsToRecords,
  ancestryExtractionsToRecords,
  buildPack as buildCanonicalPack,
  spellExtractionsToRecords as canonicalSpellExtractionsToRecords,
  conditionExtractionsToRecords,
  creatureExtractionsToRecords,
  diseaseExtractionsToRecords,
  equipmentExtractionsToRecords,
  featExtractionsToRecords,
  featureExtractionsToRecords,
  hazardExtractionsToRecords,
  magicItemExtractionsToRecords,
  poisonExtractionsToRecords,
  SRD_5_1_LICENSE,
  subclassExtractionsToRecords,
  tableExtractionsToRecords,
  writePackToDirectory,
} from '../../../scripts/importers/dnd5e-srd-5.1/emit.js';
import type {
  ActionExtraction,
  AncestryExtraction,
  ConditionExtraction,
  CreatureExtraction,
  DiseaseExtraction,
  EquipmentExtraction,
  FeatExtraction,
  FeatureExtraction,
  HazardExtraction,
  MagicItemExtraction,
  PoisonExtraction,
  RuleExtraction,
  SpellCasterClass,
  SpellExtraction,
  SubclassExtraction,
  TableExtraction,
} from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

const tmpDirs: string[] = [];

const buildPack = (input: Parameters<typeof buildCanonicalPack>[0]) =>
  buildCanonicalPack({
    ...input,
    allowSyntheticSpellSourceBindings: true,
  });

const spellExtractionsToRecords = (
  ...args: Parameters<typeof canonicalSpellExtractionsToRecords>
) =>
  canonicalSpellExtractionsToRecords(args[0], args[1], {
    allowSyntheticSourceBindings: true,
  });

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'srd-importer-emit-'));
  tmpDirs.push(dir);
  return dir;
}

const ACID_SPLASH: SpellExtraction = {
  name: 'Acid Splash',
  level: 0,
  school: 'conjuration',
  ritual: false,
  castingTime: '1 action',
  range: '60 feet',
  components: ['V', 'S'],
  duration: 'Instantaneous',
  description: 'You hurl a bubble of acid.',
  higherLevels:
    "This spell's damage increases by 1d6 when you reach 5th level (2d6), 11th level (3d6), and 17th level (4d6).",
  sourcePage: 211,
};

const BLINDED_CONDITION: ConditionExtraction = {
  name: 'Blinded',
  description:
    "A blinded creature can't see and automatically fails any ability check that requires sight. Attack rolls against the creature have advantage, and the creature's attack rolls have disadvantage.",
  effects: [
    "A blinded creature can't see and automatically fails any ability check that requires sight.",
    "Attack rolls against the creature have advantage, and the creature's attack rolls have disadvantage.",
  ],
  sourcePage: 358,
};

const EXHAUSTION_CONDITION: ConditionExtraction = {
  name: 'Exhaustion',
  description:
    'Exhaustion is measured in six levels. A creature suffers the effect of its current level of exhaustion as well as all lower levels.',
  effects: [],
  levels: [
    { level: 1, effect: 'Disadvantage on ability checks' },
    { level: 2, effect: 'Speed halved' },
    { level: 3, effect: 'Disadvantage on attack rolls and saving throws' },
    { level: 4, effect: 'Hit point maximum halved' },
    { level: 5, effect: 'Speed reduced to 0' },
    { level: 6, effect: 'Death' },
  ],
  sourcePage: 359,
};

const MAGIC_MISSILE: SpellExtraction = {
  name: 'Magic Missile',
  level: 1,
  school: 'evocation',
  ritual: false,
  castingTime: '1 action',
  range: '120 feet',
  components: ['V', 'S'],
  duration: 'Instantaneous',
  description: 'You create three glowing darts of magical force.',
  higherLevels:
    'When you cast this spell using a spell slot of 2nd level or higher, the spell creates one more dart for each slot level above 1st.',
  sourcePage: 257,
};

const AID: SpellExtraction = {
  name: 'Aid',
  level: 2,
  school: 'abjuration',
  ritual: false,
  castingTime: '1 action',
  range: '30 feet',
  components: ['V', 'S', 'M'],
  componentMaterials: 'a tiny strip of white cloth',
  duration: '8 hours',
  description: 'Your spell bolsters your allies with toughness and resolve.',
  sourcePage: 211,
};

const COVER_RULE: RuleExtraction = {
  name: 'Cover',
  text: 'Walls, trees, creatures, and other obstacles can provide cover during combat.',
  sourcePage: 196,
};

const ATTACK_ACTION: ActionExtraction = {
  name: 'Attack',
  description: 'The most common action to take in combat is the Attack action.',
  sourcePage: 92,
};

const LONGSWORD_ACTION: ActionExtraction = {
  name: 'Longsword',
  description:
    'Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 8 (1d8 + 4) slashing damage.',
  sourcePage: 254,
};

const DWARF_ANCESTRY: AncestryExtraction = {
  name: 'Dwarf',
  description: 'Bold and hardy, dwarves are known as skilled warriors.',
  traits: [
    {
      name: 'Ability Score Increase',
      text: 'Your Constitution score increases by 2.',
    },
    { name: 'Size', text: 'Your size is Medium.' },
    { name: 'Speed', text: 'Your base walking speed is 25 feet.' },
  ],
  size: 'Medium',
  speed: 25,
  subraces: ['Hill Dwarf'],
  sourcePage: 18,
};

const HILL_DWARF_ANCESTRY: AncestryExtraction = {
  name: 'Hill Dwarf',
  description: 'As a hill dwarf, you have keen senses.',
  traits: [
    {
      name: 'Ability Score Increase',
      text: 'Your Constitution score increases by 2. Your Wisdom score increases by 1.',
    },
    { name: 'Size', text: 'Your size is Medium.' },
    { name: 'Speed', text: 'Your base walking speed is 25 feet.' },
    {
      name: 'Dwarven Toughness',
      text: 'Your hit point maximum increases by 1.',
    },
  ],
  size: 'Medium',
  speed: 25,
  subraceOf: 'Dwarf',
  sourcePage: 18,
};

const CHAMPION_SUBCLASS: SubclassExtraction = {
  name: 'Champion',
  parentClass: 'Fighter',
  description:
    'The archetypal Champion focuses on the development of raw physical power honed to deadly perfection.',
  sourcePage: 72,
};

const IMPROVED_CRITICAL_FEATURE: FeatureExtraction = {
  name: 'Improved Critical',
  grantorKind: 'subclass',
  grantorName: 'Champion',
  level: 3,
  description:
    'Beginning when you choose this archetype at 3rd level, your weapon attacks score a critical hit on a roll of 19 or 20.',
  sourcePage: 72,
};

const SECOND_WIND_FEATURE: FeatureExtraction = {
  name: 'Second Wind',
  grantorKind: 'class',
  grantorName: 'Fighter',
  level: 1,
  description:
    'Once on your turn, you can use a bonus action to regain hit points equal to 1d10 + your fighter level. You must finish a short or long rest before you can use it again.',
  sourcePage: 72,
};

const DIFFICULTY_TABLE: TableExtraction = {
  name: 'Difficulty Classes',
  columns: ['Task Difficulty', 'DC'],
  rows: [
    ['Very easy', 5],
    ['Easy', 10],
    ['Medium', 15],
    ['Hard', 20],
  ],
  sourcePage: 77,
};

const ADAMANTINE_ARMOR: MagicItemExtraction = {
  name: 'Adamantine Armor',
  itemType: 'Armor (medium or heavy, but not hide)',
  rarity: 'uncommon',
  requiresAttunement: false,
  description:
    'This suit of armor is reinforced with adamantine. While you’re wearing it, any critical hit against you becomes a normal hit.',
  sourcePage: 207,
};

const AMULET_OF_HEALTH: MagicItemExtraction = {
  name: 'Amulet of Health',
  itemType: 'Wondrous item',
  rarity: 'rare',
  requiresAttunement: true,
  description: 'Your Constitution score is 19 while you wear this amulet.',
  sourcePage: 207,
};

function makeIndex(
  entries: ReadonlyArray<[string, SpellCasterClass[]]>,
): Map<string, Set<SpellCasterClass>> {
  const map = new Map<string, Set<SpellCasterClass>>();
  for (const [name, classes] of entries) {
    map.set(name, new Set(classes));
  }
  return map;
}

const FAKE_HASH = 'a'.repeat(64);

describe('buildPack — validation', () => {
  it('produces a pack that passes validateRulesPack', () => {
    const pack = buildPack({
      spells: [ACID_SPLASH, MAGIC_MISSILE],
      classIndex: makeIndex([
        ['Acid Splash', ['Sorcerer', 'Wizard']],
        ['Magic Missile', ['Sorcerer', 'Wizard']],
      ]),
      conditions: [],
      sourceHash: FAKE_HASH,
    });
    expect(pack.meta.packId).toBe('rules:dnd5e-srd-5.1');
    expect(pack.records).toHaveLength(2);
  });

  it('sorts records by key', () => {
    const pack = buildPack({
      spells: [MAGIC_MISSILE, ACID_SPLASH, AID],
      classIndex: makeIndex([]),
      conditions: [],
      sourceHash: FAKE_HASH,
    });
    const keys = pack.records.map((r) => r.key);
    expect(keys).toEqual([...keys].sort());
  });

  it('embeds the source hash in the manifest', () => {
    const pack = buildPack({
      spells: [ACID_SPLASH],
      classIndex: makeIndex([]),
      conditions: [],
      sourceHash: FAKE_HASH,
    });
    expect(pack.meta.source.sourceHash).toBe(FAKE_HASH);
  });

  it('lists only "spell" in the included-kinds description (no half-built coverage claim)', () => {
    const pack = buildPack({
      spells: [ACID_SPLASH],
      classIndex: makeIndex([]),
      conditions: [],
      sourceHash: FAKE_HASH,
    });
    expect(pack.meta.description).toMatch(/Included record kinds: spell\b/);
  });

  it('includes rule records and names both kinds in the included-kinds description', () => {
    const pack = buildPack({
      spells: [ACID_SPLASH],
      classIndex: makeIndex([]),
      conditions: [],
      rules: [COVER_RULE],
      sourceHash: FAKE_HASH,
    });
    const ruleKeys = pack.records
      .filter((r) => r.kind === 'rule')
      .map((r) => r.key);
    expect(ruleKeys).toEqual(['rule:cover']);
    const cover = pack.records.find((r) => r.key === 'rule:cover');
    expect((cover?.data as Record<string, unknown>).text).toMatch(
      /provide cover during combat/i,
    );
    expect(pack.meta.description).toMatch(
      /Included record kinds: .*rule.*spell|Included record kinds: .*spell.*rule/,
    );
  });

  it('includes "action" in included-kinds when action records are present', () => {
    const pack = buildPack({
      spells: [ACID_SPLASH],
      classIndex: makeIndex([]),
      conditions: [],
      actions: [ATTACK_ACTION],
      sourceHash: FAKE_HASH,
    });
    expect(pack.meta.description).toMatch(
      /Included record kinds: action, spell\b/,
    );
  });

  it('includes "table" in included-kinds when table records are present', () => {
    const pack = buildPack({
      spells: [ACID_SPLASH],
      classIndex: makeIndex([]),
      conditions: [],
      tables: [DIFFICULTY_TABLE],
      sourceHash: FAKE_HASH,
    });
    expect(pack.meta.description).toMatch(
      /Included record kinds: spell, table\b/,
    );
  });

  it('includes "subclass" in included-kinds when subclass records are present', () => {
    const pack = buildPack({
      spells: [ACID_SPLASH],
      classIndex: makeIndex([]),
      conditions: [],
      subclasses: [CHAMPION_SUBCLASS],
      sourceHash: FAKE_HASH,
    });
    expect(pack.meta.description).toMatch(
      /Included record kinds: spell, subclass\b/,
    );
  });

  it('includes "feature" in included-kinds when feature records are present', () => {
    const pack = buildPack({
      spells: [ACID_SPLASH],
      classIndex: makeIndex([]),
      conditions: [],
      features: [IMPROVED_CRITICAL_FEATURE],
      sourceHash: FAKE_HASH,
    });
    expect(pack.meta.description).toMatch(
      /Included record kinds: feature, spell\b/,
    );
  });

  it('includes "ancestry" in included-kinds when ancestry records are present', () => {
    const pack = buildPack({
      spells: [ACID_SPLASH],
      classIndex: makeIndex([]),
      conditions: [],
      ancestries: [DWARF_ANCESTRY, HILL_DWARF_ANCESTRY],
      sourceHash: FAKE_HASH,
    });
    expect(pack.meta.description).toMatch(
      /Included record kinds: ancestry, spell\b/,
    );
  });

  it('includes "magic-item" in included-kinds when magic item records are present', () => {
    const pack = buildPack({
      spells: [ACID_SPLASH],
      classIndex: makeIndex([]),
      conditions: [],
      magicItems: [ADAMANTINE_ARMOR],
      sourceHash: FAKE_HASH,
    });
    expect(pack.meta.description).toMatch(
      /Included record kinds: magic-item, spell\b/,
    );
  });
});

describe('spellExtractionsToRecords — record shape', () => {
  it('builds a record key of the form "spell:<slug>"', () => {
    const [record] = spellExtractionsToRecords(
      [ACID_SPLASH],
      new Map([['Acid Splash', ['Wizard']]]),
    );
    expect(record.key).toBe('spell:acid-splash');
  });

  it('preserves classes in the order supplied', () => {
    const [record] = spellExtractionsToRecords(
      [ACID_SPLASH],
      new Map([['Acid Splash', ['Sorcerer', 'Wizard']]]),
    );
    expect((record.data as { classes: string[] }).classes).toEqual([
      'Sorcerer',
      'Wizard',
    ]);
  });

  it('includes componentMaterials only when present', () => {
    const [acidRec] = spellExtractionsToRecords([ACID_SPLASH], new Map());
    const [aidRec] = spellExtractionsToRecords([AID], new Map());
    expect(
      (acidRec.data as Record<string, unknown>).componentMaterials,
    ).toBeUndefined();
    expect((aidRec.data as Record<string, unknown>).componentMaterials).toBe(
      'a tiny strip of white cloth',
    );
  });

  it('attaches provenance pointing at the SRD source URL', () => {
    const [record] = spellExtractionsToRecords([ACID_SPLASH], new Map());
    expect(record.provenance.sourceRef).toBe(
      'https://dnd.wizards.com/resources/systems-reference-document',
    );
    expect(record.provenance.locator).toBe('p. 211');
  });

  it('projects concentration, save, condition, and scaling mechanics', () => {
    const holdPerson: SpellExtraction = {
      name: 'Hold Person',
      level: 2,
      school: 'enchantment',
      ritual: false,
      castingTime: '1 action',
      range: '60 feet',
      components: ['V', 'S', 'M'],
      duration: 'Concentration, up to 1 minute',
      description:
        'Choose a humanoid that you can see within range. The target must succeed on a Wisdom saving throw or be paralyzed for the duration.',
      higherLevels:
        'When you cast this spell using a spell slot of 3rd level or higher, you can target one additional humanoid for each slot level above 2nd.',
      sourcePage: 251,
    };
    const [record] = spellExtractionsToRecords([holdPerson], new Map());
    expect(record.data).toMatchObject({
      mechanics: {
        concentration: true,
        saves: [{ ability: 'wisdom' }],
        conditions: [{ condition: 'paralyzed' }],
        scaling: { sourceText: holdPerson.higherLevels },
      },
    });
  });

  it('derives concentration from the no-comma SRD duration typo (eshyra-o9bd.18.2)', () => {
    // SRD 5.1 p. 173 prints Protection from Evil and Good's duration as
    // "Concentration up to 10 minutes" — no comma. The detector must accept
    // both that form and the standard "Concentration, up to ..." form.
    const protection: SpellExtraction = {
      name: 'Protection from Evil and Good',
      level: 1,
      school: 'abjuration',
      ritual: false,
      castingTime: '1 action',
      range: 'Touch',
      components: ['V', 'S', 'M'],
      duration: 'Concentration up to 10 minutes',
      description:
        'Until the spell ends, one willing creature you touch is protected against certain types of creatures.',
      sourcePage: 173,
    };
    const [record] = spellExtractionsToRecords([protection], new Map());
    expect(record.data).toMatchObject({
      mechanics: { concentration: true },
    });
  });

  it('marks non-concentration spells without inventing prose mechanics', () => {
    const [record] = spellExtractionsToRecords([AID], new Map());
    expect(record.data).toMatchObject({
      mechanics: { concentration: false },
    });
    expect(
      (record.data as { mechanics: Record<string, unknown> }).mechanics,
    ).not.toHaveProperty('saves');
  });
});

describe('conditionExtractionsToRecords — typed mechanics', () => {
  it('projects attack-roll and ability-check effects for blinded without parsing prose', () => {
    const [record] = conditionExtractionsToRecords([BLINDED_CONDITION]);
    const mechanics = (record.data as { mechanics?: { effects?: unknown[] } })
      .mechanics;

    expect(mechanics?.effects).toEqual(
      expect.arrayContaining([
        {
          kind: 'autoFailCheck',
          subject: 'conditioned',
          roll: 'ability-check',
          requiredSense: 'sight',
        },
        {
          kind: 'attackRollModifier',
          subject: 'against-conditioned',
          mode: 'advantage',
        },
        {
          kind: 'attackRollModifier',
          subject: 'conditioned',
          mode: 'disadvantage',
        },
      ]),
    );
  });

  it('projects exhaustion level mechanics as typed per-level effects', () => {
    const [record] = conditionExtractionsToRecords([EXHAUSTION_CONDITION]);
    const levels = (
      record.data as {
        mechanics?: {
          levelApplication?: string;
          levels?: readonly {
            level: number;
            effects: readonly Record<string, unknown>[];
          }[];
        };
      }
    ).mechanics?.levels;
    const levelApplication = (
      record.data as { mechanics?: { levelApplication?: string } }
    ).mechanics?.levelApplication;

    expect(levelApplication).toBe('current-and-lower');
    expect(levels?.find((level) => level.level === 3)?.effects).toEqual([
      {
        kind: 'attackRollModifier',
        subject: 'conditioned',
        mode: 'disadvantage',
      },
      {
        kind: 'savingThrowModifier',
        subject: 'conditioned',
        mode: 'disadvantage',
        roll: 'saving-throw',
      },
    ]);
    expect(levels?.find((level) => level.level === 6)?.effects).toEqual([
      { kind: 'death', subject: 'conditioned' },
    ]);
  });
});

describe('creatureExtractionsToRecords — keyed defensive / sense fields', () => {
  const baseAbilities = {
    strength: 21,
    dexterity: 9,
    constitution: 15,
    intelligence: 18,
    wisdom: 15,
    charisma: 18,
  };
  const ABOLETH: CreatureExtraction = {
    name: 'Aboleth',
    category: 'monster',
    size: 'Large',
    type: 'aberration',
    alignment: 'lawful evil',
    armorClass: {
      value: 17,
      source: 'natural armor',
      sourceText: '17 (natural armor)',
    },
    hitPoints: { value: 135, formula: '18d10 + 36' },
    speed: { walk: 10, swim: 40 },
    speedSourceText: '10 ft., swim 40 ft.',
    challengeRating: '10',
    experiencePoints: 5900,
    abilityScores: baseAbilities,
    savingThrows: 'Con +6, Int +8, Wis +6',
    skills: 'History +12, Perception +10',
    senses: 'darkvision 120 ft., passive Perception 20',
    languages: 'Deep Speech, telepathy 120 ft.',
    sourcePage: 261,
  };

  it('emits the keyed fields onto the record data', () => {
    const [record] = creatureExtractionsToRecords([ABOLETH]);
    const data = record.data as Record<string, unknown>;
    expect(data.savingThrows).toBe('Con +6, Int +8, Wis +6');
    expect(data.skills).toBe('History +12, Perception +10');
    expect(data.senses).toBe('darkvision 120 ft., passive Perception 20');
    expect(data.languages).toBe('Deep Speech, telepathy 120 ft.');
  });

  it('orders keyed fields after abilityScores in stat-block print order', () => {
    const [record] = creatureExtractionsToRecords([ABOLETH]);
    const keys = Object.keys(record.data as Record<string, unknown>);
    expect(keys).toEqual([
      'size',
      'type',
      'alignment',
      'armorClass',
      'hitPoints',
      'speed',
      'speedSourceText',
      'challengeRating',
      'experiencePoints',
      'abilityScores',
      'savingThrows',
      'skills',
      'senses',
      'languages',
    ]);
  });

  it('emits structured statline semantics — AC variants, hover, speed variants (eshyra-o9bd.18.6)', () => {
    const werebear: CreatureExtraction = {
      ...ABOLETH,
      name: 'Werebear',
      armorClass: {
        value: 10,
        condition: 'in humanoid form',
        variants: [
          {
            value: 11,
            source: 'natural armor',
            condition: 'in bear and hybrid form',
          },
        ],
        sourceText:
          '10 in humanoid form, 11 (natural armor) in bear and hybrid form',
      },
      hitPoints: { value: 135, formula: '18d8 + 54' },
      speed: { walk: 30 },
      hover: true,
      speedVariants: [
        { condition: 'in bear or hybrid form', speed: { walk: 40, climb: 30 } },
      ],
      speedSourceText:
        '30 ft. (40 ft., climb 30 ft. in bear or hybrid form) (hover)',
    };
    const data = creatureExtractionsToRecords([werebear])[0].data as Record<
      string,
      unknown
    >;
    expect(data.armorClass).toEqual({
      value: 10,
      condition: 'in humanoid form',
      variants: [
        {
          value: 11,
          source: 'natural armor',
          condition: 'in bear and hybrid form',
        },
      ],
      sourceText:
        '10 in humanoid form, 11 (natural armor) in bear and hybrid form',
    });
    expect(data.hitPoints).toEqual({ value: 135, formula: '18d8 + 54' });
    expect(data.speed).toEqual({ walk: 30 });
    expect(data.hover).toBe(true);
    expect(data.speedVariants).toEqual([
      { condition: 'in bear or hybrid form', speed: { walk: 40, climb: 30 } },
    ]);
    expect(
      Object.keys(data).slice(
        Object.keys(data).indexOf('speed'),
        Object.keys(data).indexOf('challengeRating'),
      ),
    ).toEqual(['speed', 'hover', 'speedVariants', 'speedSourceText']);
    // Absent-by-default: the plain Aboleth fixture emits none of the optionals.
    const plain = creatureExtractionsToRecords([ABOLETH])[0].data as Record<
      string,
      unknown
    >;
    expect(plain.hover).toBeUndefined();
    expect(plain.speedVariants).toBeUndefined();
  });

  it('emits narrative sections as {name,text} arrays and a legendary object', () => {
    const aboleth: CreatureExtraction = {
      ...ABOLETH,
      traits: [{ name: 'Amphibious', text: 'It can breathe air and water.' }],
      actions: [
        { name: 'Multiattack', text: 'It makes three tentacle attacks.' },
        { name: 'Enslave (3/Day)', text: 'It targets one creature.' },
      ],
      reactions: [{ name: 'Parry', text: 'It adds 2 to its AC.' }],
      legendaryActions: {
        description: 'It can take 3 legendary actions.',
        entries: [{ name: 'Detect', text: 'It makes a Wisdom check.' }],
      },
    };
    const data = creatureExtractionsToRecords([aboleth])[0].data as Record<
      string,
      unknown
    >;
    // Entries carry the verbatim name/text plus a typed `mechanics`
    // projection where a reviewed grammar matches (eshyra-o9bd.18.7.3):
    // Amphibious gains a `breathes` effect; the usage parenthetical gains
    // `usage.perDay`.
    expect(data.traits).toEqual([
      {
        name: 'Amphibious',
        text: 'It can breathe air and water.',
        mechanics: {
          effects: [{ kind: 'breathes', environments: ['air', 'water'] }],
        },
      },
    ]);
    expect(
      (data.actions as Array<{ name: string }>).map((a) => a.name),
    ).toEqual(['Multiattack', 'Enslave (3/Day)']);
    expect(
      (data.actions as Array<{ mechanics?: { usage?: unknown } }>)[1].mechanics
        ?.usage,
    ).toEqual({ perDay: 3 });
    expect(data.reactions).toEqual([
      { name: 'Parry', text: 'It adds 2 to its AC.' },
    ]);
    expect(data.legendaryActions).toEqual({
      description: 'It can take 3 legendary actions.',
      entries: [{ name: 'Detect', text: 'It makes a Wisdom check.' }],
    });
    // Narrative sections follow the keyed fields in print order.
    const keys = Object.keys(data);
    expect(keys.slice(-4)).toEqual([
      'traits',
      'actions',
      'reactions',
      'legendaryActions',
    ]);
  });

  it('emits variant sidebars as a {name,text} array after the narrative sections', () => {
    const rat: CreatureExtraction = {
      ...ABOLETH,
      actions: [{ name: 'Bite', text: 'It bites.' }],
      variants: [
        { name: 'Diseased Giant Rats', text: 'A diseased giant rat …' },
      ],
    };
    const data = creatureExtractionsToRecords([rat])[0].data as Record<
      string,
      unknown
    >;
    expect(data.variants).toEqual([
      { name: 'Diseased Giant Rats', text: 'A diseased giant rat …' },
    ]);
    // `variants` is the last data key (after the narrative sections).
    expect(Object.keys(data).at(-1)).toBe('variants');
  });

  it('emits a legendary-actions object without description when none is present', () => {
    const creature: CreatureExtraction = {
      ...ABOLETH,
      legendaryActions: {
        entries: [{ name: 'Detect', text: 'It makes a check.' }],
      },
    };
    const data = creatureExtractionsToRecords([creature])[0].data as Record<
      string,
      unknown
    >;
    expect(data.legendaryActions).toEqual({
      entries: [{ name: 'Detect', text: 'It makes a check.' }],
    });
  });

  it('omits keyed fields the creature does not carry (no empty keys)', () => {
    const beast: CreatureExtraction = {
      name: 'Black Bear',
      category: 'monster',
      size: 'Medium',
      type: 'beast',
      alignment: 'unaligned',
      armorClass: 11,
      hitPoints: 19,
      speed: { walk: 40, climb: 30 },
      challengeRating: '1/2',
      experiencePoints: 100,
      abilityScores: baseAbilities,
      skills: 'Perception +3',
      senses: 'passive Perception 13',
      languages: '—',
      sourcePage: 318,
    };
    const data = creatureExtractionsToRecords([beast])[0].data as Record<
      string,
      unknown
    >;
    expect(Object.keys(data)).not.toContain('savingThrows');
    expect(Object.keys(data)).not.toContain('damageResistances');
    expect(Object.keys(data)).not.toContain('conditionImmunities');
    expect(data.skills).toBe('Perception +3');
  });

  it('emits source-derived creature family taxonomy when present', () => {
    const angel: CreatureExtraction = {
      ...ABOLETH,
      name: 'Deva',
      familyPath: ['Angels'],
    };
    const data = creatureExtractionsToRecords([angel])[0].data as Record<
      string,
      unknown
    >;
    expect(data.familyPath).toEqual(['Angels']);
  });
});

describe('SRD_5_1_LICENSE — attribution text', () => {
  it('attributionText matches the verbatim preamble pinned in the source manifest byte-for-byte', () => {
    const sourceManifest = JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          'packages/core/sources/dnd5e-srd-5.1/manifest.json',
        ),
        'utf8',
      ),
    ) as { attribution: { text: string } };
    expect(SRD_5_1_LICENSE.attributionText).toBe(
      sourceManifest.attribution.text,
    );
  });

  it('pack manifest attributionText matches the source manifest attribution text byte-for-byte', () => {
    const sourceManifest = JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          'packages/core/sources/dnd5e-srd-5.1/manifest.json',
        ),
        'utf8',
      ),
    ) as { attribution: { text: string } };
    const packManifest = JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json',
        ),
        'utf8',
      ),
    ) as { license: { attributionText: string } };
    expect(packManifest.license.attributionText).toBe(
      sourceManifest.attribution.text,
    );
  });
});

describe('actionExtractionsToRecords — record shape', () => {
  it('builds action keys of the form "action:<slug>"', () => {
    const [record] = actionExtractionsToRecords([ATTACK_ACTION]);
    expect(record.key).toBe('action:attack');
  });

  it('stores action description in data.description', () => {
    const [record] = actionExtractionsToRecords([ATTACK_ACTION]);
    expect((record.data as { description: string }).description).toMatch(
      /Attack action/,
    );
  });

  it('projects explicit attack mechanics from action prose', () => {
    const [record] = actionExtractionsToRecords([LONGSWORD_ACTION]);
    expect(record.data).toMatchObject({
      mechanics: {
        attacks: [
          {
            attackType: 'melee-weapon',
            attackBonus: 5,
            reachFeet: 5,
            target: 'one target',
            hitDamage: [{ average: 8, dice: '1d8 + 4', type: 'slashing' }],
          },
        ],
      },
    });
  });
});

describe('subclassExtractionsToRecords — record shape', () => {
  it('builds subclass keys of the form "subclass:<slug>"', () => {
    const [record] = subclassExtractionsToRecords([CHAMPION_SUBCLASS]);
    expect(record.key).toBe('subclass:champion');
    expect(record.kind).toBe('subclass');
  });

  it('keys parentClass to the parent class record (data-side linkage, ADR 0009)', () => {
    const [record] = subclassExtractionsToRecords([CHAMPION_SUBCLASS]);
    expect((record.data as { parentClass: string }).parentClass).toBe(
      'class:fighter',
    );
  });

  it('carries the subclass description through into data.description', () => {
    const [record] = subclassExtractionsToRecords([CHAMPION_SUBCLASS]);
    expect((record.data as { description: string }).description).toMatch(
      /archetypal Champion/,
    );
  });

  it('does not set overrides (parent linkage lives in data only)', () => {
    const [record] = subclassExtractionsToRecords([CHAMPION_SUBCLASS]);
    expect(record.overrides).toBeUndefined();
  });

  it('attaches provenance pointing at the SRD source page', () => {
    const [record] = subclassExtractionsToRecords([CHAMPION_SUBCLASS]);
    expect(record.provenance.locator).toBe('p. 72');
  });
});

describe('featureExtractionsToRecords — record shape', () => {
  it('builds feature keys scoped by grantor and feature name', () => {
    const [record] = featureExtractionsToRecords([IMPROVED_CRITICAL_FEATURE]);
    expect(record.key).toBe('feature:champion:improved-critical');
    expect(record.kind).toBe('feature');
  });

  it('keys the feature source to its granting subclass record', () => {
    const [record] = featureExtractionsToRecords([IMPROVED_CRITICAL_FEATURE]);
    expect((record.data as { source: string }).source).toBe(
      'subclass:champion',
    );
  });

  it('carries level and description through the dnd5e feature schema', () => {
    const [record] = featureExtractionsToRecords([IMPROVED_CRITICAL_FEATURE]);
    expect((record.data as { level: number }).level).toBe(3);
    expect((record.data as { description: string }).description).toMatch(
      /critical hit/,
    );
  });

  it('attaches provenance pointing at the SRD source page', () => {
    const [record] = featureExtractionsToRecords([IMPROVED_CRITICAL_FEATURE]);
    expect(record.provenance.locator).toBe('p. 72');
  });

  it('projects subclass critical-range mechanics', () => {
    const [record] = featureExtractionsToRecords([IMPROVED_CRITICAL_FEATURE]);
    expect(record.data).toMatchObject({
      mechanics: {
        effects: [{ kind: 'criticalRange', minimumRoll: 19 }],
      },
    });
  });

  it('projects class feature rest-reset resources', () => {
    const [record] = featureExtractionsToRecords([SECOND_WIND_FEATURE]);
    expect(record.data).toMatchObject({
      mechanics: {
        resources: [
          {
            reset: 'short-or-long-rest',
          },
        ],
      },
    });
  });
});

// eshyra-vk23.1: `spellGrants` must be validated structure, not regex residue.
// The projection captures "you learn/can cast/know the X spell" fragments but
// only keeps them when a resolver maps the fragment to a real spell ref, so a
// mechanics-looking field can never surface clipped prose as authoritative data.
describe('featureExtractionsToRecords — fail-closed spellGrants (eshyra-vk23.1)', () => {
  const resolveSpellGrant = (candidate: string): string | undefined =>
    candidate.trim().toLowerCase() === 'find familiar'
      ? 'spell:find-familiar'
      : undefined;

  const PACT_CHAIN: FeatureExtraction = {
    name: 'Pact Boon',
    grantorKind: 'class',
    grantorName: 'Warlock',
    level: 3,
    description:
      'You learn the find familiar spell and can cast it as a ritual. It does not count against your number of spells known.',
    sourcePage: 47,
  };

  const PROSE_RESIDUE: FeatureExtraction = {
    name: 'Spellcasting',
    grantorKind: 'class',
    grantorName: 'Bard',
    level: 1,
    description:
      'You know two cantrips of your choice from the bard spell list. When you gain a level, you can choose one of the bard spells you know and replace it with another spell.',
    sourcePage: 11,
  };

  it('keeps a captured grant only when it resolves to a real spell ref', () => {
    const [record] = featureExtractionsToRecords(
      [PACT_CHAIN],
      resolveSpellGrant,
    );
    expect(record.data).toMatchObject({
      mechanics: { spellGrants: [{ spell: 'spell:find-familiar' }] },
    });
  });

  it('omits spellGrants for unresolved natural-language fragments', () => {
    const [record] = featureExtractionsToRecords(
      [PROSE_RESIDUE],
      resolveSpellGrant,
    );
    const mechanics = (record.data as { mechanics?: Record<string, unknown> })
      .mechanics;
    expect(mechanics ?? {}).not.toHaveProperty('spellGrants');
  });

  it('omits spellGrants entirely when no resolver is supplied (fail closed)', () => {
    const [record] = featureExtractionsToRecords([PACT_CHAIN]);
    const mechanics = (record.data as { mechanics?: Record<string, unknown> })
      .mechanics;
    expect(mechanics ?? {}).not.toHaveProperty('spellGrants');
  });
});

describe('tableExtractionsToRecords - record shape', () => {
  it('builds table keys of the form "table:<slug>"', () => {
    const [record] = tableExtractionsToRecords([DIFFICULTY_TABLE]);
    expect(record.key).toBe('table:difficulty-classes');
  });

  it('stores columns and rows in the table kindSchema shape', () => {
    const [record] = tableExtractionsToRecords([DIFFICULTY_TABLE]);
    expect(record.kind).toBe('table');
    expect((record.data as { columns: string[] }).columns).toEqual([
      'Task Difficulty',
      'DC',
    ]);
    expect((record.data as { rows: unknown[][] }).rows).toEqual([
      ['Very easy', 5],
      ['Easy', 10],
      ['Medium', 15],
      ['Hard', 20],
    ]);
  });
});

describe('ancestryExtractionsToRecords — record shape', () => {
  it('builds ancestry keys of the form "ancestry:<slug>"', () => {
    const [record] = ancestryExtractionsToRecords([DWARF_ANCESTRY]);
    expect(record.key).toBe('ancestry:dwarf');
    expect(record.kind).toBe('ancestry');
  });

  it('preserves the source "race" term in data.source (ADR 0005)', () => {
    const [record] = ancestryExtractionsToRecords([DWARF_ANCESTRY]);
    expect((record.data as { source: string }).source).toBe('race');
  });

  it('references subraces by key on the parent record', () => {
    const [record] = ancestryExtractionsToRecords([DWARF_ANCESTRY]);
    expect((record.data as { subraces: string[] }).subraces).toEqual([
      'ancestry:hill-dwarf',
    ]);
    expect((record.data as Record<string, unknown>).subraceOf).toBeUndefined();
  });

  it('references the parent by key on a subrace record', () => {
    const [record] = ancestryExtractionsToRecords([HILL_DWARF_ANCESTRY]);
    expect((record.data as { subraceOf: string }).subraceOf).toBe(
      'ancestry:dwarf',
    );
    expect((record.data as Record<string, unknown>).subraces).toBeUndefined();
  });

  it('emits size and speed convenience fields when present', () => {
    const [record] = ancestryExtractionsToRecords([DWARF_ANCESTRY]);
    expect((record.data as { size: string }).size).toBe('Medium');
    expect((record.data as { speed: number }).speed).toBe(25);
  });

  it('carries the trait list through into data.traits', () => {
    const [record] = ancestryExtractionsToRecords([HILL_DWARF_ANCESTRY]);
    const names = (
      record.data as { traits: Array<{ name: string }> }
    ).traits.map((t) => t.name);
    expect(names).toContain('Dwarven Toughness');
  });

  it('projects ancestry trait mechanics when the prose is explicit', () => {
    const resistant: AncestryExtraction = {
      ...DWARF_ANCESTRY,
      traits: [
        {
          name: 'Dwarven Resilience',
          text: 'You have advantage on saving throws against poison, and you have resistance against poison damage.',
        },
      ],
    };
    const [record] = ancestryExtractionsToRecords([resistant]);
    // Structured projections (eshyra-o9bd.18.7.5): "saving throws against
    // poison" names the damage/effect family, not the poisoned condition, so
    // it is a scoped saving-throw modifier; the resistance names its damage
    // type. The earlier bare keyword markers carried no semantics.
    expect(record.data).toMatchObject({
      traits: [
        {
          mechanics: {
            effects: [
              {
                kind: 'savingThrowModifier',
                mode: 'advantage',
                against: 'poison',
              },
              { kind: 'damageResistance', types: ['poison'] },
            ],
          },
        },
      ],
    });
  });
});

describe('featExtractionsToRecords — mechanics projection', () => {
  it('projects explicit feat proficiency mechanics with the verbatim grant clause', () => {
    const skilled: FeatExtraction = {
      name: 'Skilled',
      description:
        'You gain proficiency in any combination of three skills or tools of your choice.',
      sourcePage: 170,
    };
    const [record] = featExtractionsToRecords([skilled]);
    expect(record.data).toMatchObject({
      mechanics: {
        effects: [
          {
            kind: 'proficiency',
            grant: 'any combination of three skills or tools of your choice',
          },
        ],
      },
    });
  });
});

describe('magicItemExtractionsToRecords — record shape', () => {
  it('builds magic-item keys of the form "magic-item:<slug>"', () => {
    const [record] = magicItemExtractionsToRecords([ADAMANTINE_ARMOR]);
    expect(record.key).toBe('magic-item:adamantine-armor');
    expect(record.kind).toBe('magic-item');
  });

  it('stores category, rarity, attunement, and description in data', () => {
    const [record] = magicItemExtractionsToRecords([AMULET_OF_HEALTH]);
    expect(record.data).toMatchObject({
      itemType: 'Wondrous item',
      rarity: 'rare',
      requiresAttunement: true,
      description: 'Your Constitution score is 19 while you wear this amulet.',
    });
  });

  it('attaches provenance pointing at the SRD source page', () => {
    const [record] = magicItemExtractionsToRecords([ADAMANTINE_ARMOR]);
    expect(record.provenance.locator).toBe('p. 207');
  });
});

describe('diseaseExtractionsToRecords — record shape', () => {
  const CACKLE_FEVER: DiseaseExtraction = {
    name: 'Cackle Fever',
    description: 'This disease targets humanoids, although gnomes are immune.',
    sourcePage: 199,
  };

  it('emits under the hazard kind with data.category "disease"', () => {
    const [record] = diseaseExtractionsToRecords([CACKLE_FEVER]);
    expect(record.kind).toBe('hazard');
    expect(record.key).toBe('hazard:cackle-fever');
    expect(record.data).toEqual({
      category: 'disease',
      description:
        'This disease targets humanoids, although gnomes are immune.',
    });
    expect(record.provenance.locator).toBe('p. 199');
  });
});

describe('hazardExtractionsToRecords — mechanics projection', () => {
  it('projects explicit save and damage mechanics', () => {
    const lava: HazardExtraction = {
      name: 'Lava',
      description:
        'A creature must make a DC 15 Dexterity saving throw, taking 22 (4d10) fire damage on a failed save.',
      sourcePage: 110,
    };
    const [record] = hazardExtractionsToRecords([lava]);
    expect(record.data).toMatchObject({
      mechanics: {
        saves: [{ ability: 'dexterity', dc: 15 }],
        damage: [{ average: 22, dice: '4d10', type: 'fire' }],
      },
    });
  });
});

describe('poisonExtractionsToRecords — record shape', () => {
  const ASSASSINS_BLOOD: PoisonExtraction = {
    name: 'Assassin’s Blood',
    poisonType: 'ingested',
    price: '150 gp',
    description: 'A creature subjected to this poison must make a DC 10 save.',
    sourcePage: 204,
  };
  const PRICELESS: PoisonExtraction = {
    name: 'Mystery Poison',
    poisonType: 'contact',
    description: 'An effect with no listed price.',
    sourcePage: 204,
  };

  it('emits under the hazard kind with category, poisonType, price, description in order', () => {
    const [record] = poisonExtractionsToRecords([ASSASSINS_BLOOD]);
    expect(record.kind).toBe('hazard');
    expect(record.key).toBe('hazard:assassins-blood');
    expect(record.data).toEqual({
      category: 'poison',
      poisonType: 'ingested',
      price: '150 gp',
      description:
        'A creature subjected to this poison must make a DC 10 save.',
    });
    // Field insertion order is fixed for byte-stable output.
    expect(Object.keys(record.data)).toEqual([
      'category',
      'poisonType',
      'price',
      'description',
    ]);
  });

  it('omits price when the entry has no matching table row', () => {
    const [record] = poisonExtractionsToRecords([PRICELESS]);
    expect(record.data).not.toHaveProperty('price');
    expect(Object.keys(record.data)).toEqual([
      'category',
      'poisonType',
      'description',
    ]);
  });
});

describe('equipmentExtractionsToRecords — armorClass (eshyra-rtgi)', () => {
  function armor(overrides: Partial<EquipmentExtraction>): EquipmentExtraction {
    return {
      name: 'Test Armor',
      category: 'armor',
      sourcePage: 63,
      ...overrides,
    };
  }

  it('derives an unlimited-Dex-modifier armorClass for light armor', () => {
    const [record] = equipmentExtractionsToRecords([
      armor({ name: 'Leather', ac: '11 + Dex modifier', armorType: 'light' }),
    ]);
    expect(record.data).toMatchObject({
      ac: '11 + Dex modifier',
      armorClass: { base: 11, dexModifier: 'unlimited' },
    });
  });

  it('derives a capped-Dex-modifier armorClass for medium armor', () => {
    const [record] = equipmentExtractionsToRecords([
      armor({
        name: 'Chain Shirt',
        ac: '13 + Dex modifier (max 2)',
        armorType: 'medium',
      }),
    ]);
    expect(record.data).toMatchObject({
      ac: '13 + Dex modifier (max 2)',
      armorClass: { base: 13, dexModifier: 'capped', dexModifierCap: 2 },
    });
  });

  it('derives a no-Dex-modifier armorClass for heavy armor', () => {
    const [record] = equipmentExtractionsToRecords([
      armor({ name: 'Chain Mail', ac: '16', armorType: 'heavy' }),
    ]);
    expect(record.data).toMatchObject({
      ac: '16',
      armorClass: { base: 16, dexModifier: 'none' },
    });
  });

  it('derives a bonus-only armorClass for a shield', () => {
    const [record] = equipmentExtractionsToRecords([
      armor({ name: 'Shield', ac: '+2', armorType: 'shield' }),
    ]);
    expect(record.data).toMatchObject({
      ac: '+2',
      armorClass: { bonus: 2 },
    });
  });

  it('fails closed on an AC cell shape outside the four reviewed cases', () => {
    expect(() =>
      equipmentExtractionsToRecords([
        armor({ name: 'Mystery Armor', ac: 'AC 20', armorType: 'heavy' }),
      ]),
    ).toThrow(ArmorClassShapeError);
  });

  it('does not attach armorClass to non-armor equipment', () => {
    const [record] = equipmentExtractionsToRecords([
      { name: 'Backpack', category: 'gear', sourcePage: 68, cost: '2 gp' },
    ]);
    expect(record.data).not.toHaveProperty('armorClass');
  });
});

describe('writePackToDirectory — determinism', () => {
  it('produces byte-identical files across two runs over the same input', () => {
    const dirA = makeTmpDir();
    const dirB = makeTmpDir();
    const input = {
      spells: [ACID_SPLASH, AID, MAGIC_MISSILE],
      classIndex: makeIndex([
        ['Acid Splash', ['Sorcerer', 'Wizard']],
        ['Aid', ['Cleric', 'Paladin']],
        ['Magic Missile', ['Sorcerer', 'Wizard']],
      ]),
      conditions: [],
      sourceHash: FAKE_HASH,
    };
    writePackToDirectory(buildPack(input), { outDir: dirA });
    writePackToDirectory(buildPack(input), { outDir: dirB });
    expect(readFileSync(join(dirA, 'manifest.json'), 'utf8')).toBe(
      readFileSync(join(dirB, 'manifest.json'), 'utf8'),
    );
    expect(readFileSync(join(dirA, 'records.json'), 'utf8')).toBe(
      readFileSync(join(dirB, 'records.json'), 'utf8'),
    );
  });

  it('does not depend on input spell order', () => {
    const dirA = makeTmpDir();
    const dirB = makeTmpDir();
    writePackToDirectory(
      buildPack({
        spells: [ACID_SPLASH, AID, MAGIC_MISSILE],
        classIndex: makeIndex([]),
        conditions: [],
        sourceHash: FAKE_HASH,
      }),
      { outDir: dirA },
    );
    writePackToDirectory(
      buildPack({
        spells: [MAGIC_MISSILE, ACID_SPLASH, AID],
        classIndex: makeIndex([]),
        conditions: [],
        sourceHash: FAKE_HASH,
      }),
      { outDir: dirB },
    );
    expect(readFileSync(join(dirA, 'records.json'), 'utf8')).toBe(
      readFileSync(join(dirB, 'records.json'), 'utf8'),
    );
  });

  it('does not depend on class-index insertion order', () => {
    const dirA = makeTmpDir();
    const dirB = makeTmpDir();
    writePackToDirectory(
      buildPack({
        spells: [ACID_SPLASH],
        classIndex: makeIndex([['Acid Splash', ['Wizard', 'Sorcerer']]]),
        conditions: [],
        sourceHash: FAKE_HASH,
      }),
      { outDir: dirA },
    );
    writePackToDirectory(
      buildPack({
        spells: [ACID_SPLASH],
        classIndex: makeIndex([['Acid Splash', ['Sorcerer', 'Wizard']]]),
        conditions: [],
        sourceHash: FAKE_HASH,
      }),
      { outDir: dirB },
    );
    expect(readFileSync(join(dirA, 'records.json'), 'utf8')).toBe(
      readFileSync(join(dirB, 'records.json'), 'utf8'),
    );
  });

  it('emits a trailing newline on both files', () => {
    const dir = makeTmpDir();
    writePackToDirectory(
      buildPack({
        spells: [ACID_SPLASH],
        classIndex: makeIndex([]),
        conditions: [],
        sourceHash: FAKE_HASH,
      }),
      { outDir: dir },
    );
    expect(
      readFileSync(join(dir, 'manifest.json'), 'utf8').endsWith('\n'),
    ).toBe(true);
    expect(readFileSync(join(dir, 'records.json'), 'utf8').endsWith('\n')).toBe(
      true,
    );
  });
});
