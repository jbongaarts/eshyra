/**
 * Unit tests for the feature-choice deriver (eshyra-o9bd.9).
 *
 * `deriveFeatureChoices` is a pure post-emit pass that reads the assembled
 * class/subclass/feature records and attaches structured `data.choices[]` to
 * the feature each player build choice hangs off. These tests build minimal
 * records and assert the derived choice shape per modeling slice; the committed
 * pack's real coverage is asserted by the `choice-coverage` gate baseline in
 * `srdPlayabilityAudit.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
  deriveFeatureChoices,
  FeatureChoiceDerivationError,
} from '../../../scripts/importers/dnd5e-srd-5.1/deriveFeatureChoices.js';
import type { RulesPackLicense, RulesRecord } from '../../../src/internal.js';

const LICENSE: RulesPackLicense = {
  licenseClass: 'open',
  licenseName: 'CC-BY-4.0',
  attributionText: 'fixture',
  requiresAttribution: true,
  commercialUseAllowed: true,
  hostedUseAllowed: true,
  redistributionAllowed: true,
  publicSharingAllowed: true,
  derivativeAllowed: true,
  containsUserSuppliedText: false,
  containsTrademarkedSettingMaterial: false,
  sourceMaterialDescription: 'fixture',
  provenancePolicy: 'fixture',
  outputRestrictions: 'fixture',
};

function rec(
  kind: RulesRecord['kind'],
  key: string,
  name: string,
  data: Record<string, unknown>,
): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind,
    key,
    name,
    data,
    source: 'SRD p. 1',
    license: LICENSE,
    provenance: { sourceRef: 'https://example.test', locator: 'p. 1' },
  };
}

/** A class record granting `featureKey` at `level`, with a subclass-feature
 * slot labelled `slotName` so the subclass deriver can find the group base. */
function classRec(
  key: string,
  name: string,
  opts: {
    grants: ReadonlyArray<{ ref: string; level: number }>;
    slotName?: string;
    slotLevel?: number;
  },
): RulesRecord {
  const progression: Array<Record<string, unknown>> = opts.grants.map((g) => ({
    level: g.level,
    advancement: [{ kind: 'featureGrant', ref: g.ref }],
  }));
  if (opts.slotName !== undefined) {
    progression.push({
      level: opts.slotLevel ?? 6,
      advancement: [
        {
          kind: 'subclassFeatureSlot',
          slotName: opts.slotName,
          subclassLevel: opts.slotLevel ?? 6,
        },
      ],
    });
  }
  return rec('class', key, name, { progression });
}

function featureChoices(
  records: readonly RulesRecord[],
  key: string,
): Array<Record<string, unknown>> {
  const feature = records.find((r) => r.key === key);
  const choices = (feature?.data as { choices?: unknown }).choices;
  return Array.isArray(choices)
    ? (choices as Array<Record<string, unknown>>)
    : [];
}

describe('deriveFeatureChoices — subclass selection (eshyra-o9bd.9.2)', () => {
  it('attaches a subclass choice to the selector feature named after the slot base', () => {
    const classRecords = [
      classRec('class:fighter', 'Fighter', {
        grants: [{ ref: 'feature:fighter:martial-archetype', level: 3 }],
        slotName: 'Martial Archetype feature',
        slotLevel: 7,
      }),
    ];
    const subclassRecords = [
      rec('subclass', 'subclass:champion', 'Champion', {
        parentClass: 'class:fighter',
        description: 'A champion.',
      }),
    ];
    const featureRecords = [
      rec('feature', 'feature:fighter:martial-archetype', 'Martial Archetype', {
        source: 'class:fighter',
        level: 3,
        description: 'At 3rd level, you choose an archetype.',
      }),
    ];

    const out = deriveFeatureChoices({
      classRecords,
      subclassRecords,
      featureRecords,
    });
    const choices = featureChoices(out, 'feature:fighter:martial-archetype');
    expect(choices).toEqual([
      {
        id: 'subclass',
        category: 'subclass',
        prompt: 'Choose your Martial Archetype.',
        level: 3,
        choose: 1,
        from: ['subclass:champion'],
      },
    ]);
  });

  it('matches a selector whose name has the slot base as a trailing word (Barbarian Primal Path)', () => {
    const classRecords = [
      classRec('class:barbarian', 'Barbarian', {
        grants: [{ ref: 'feature:barbarian:primal-path', level: 3 }],
        slotName: 'Path feature',
      }),
    ];
    const subclassRecords = [
      rec('subclass', 'subclass:path-of-the-berserker', 'Berserker', {
        parentClass: 'class:barbarian',
        description: 'Rage.',
      }),
    ];
    const featureRecords = [
      rec('feature', 'feature:barbarian:primal-path', 'Primal Path', {
        source: 'class:barbarian',
        level: 3,
        description: 'At 3rd level, you choose a path.',
      }),
    ];
    const out = deriveFeatureChoices({
      classRecords,
      subclassRecords,
      featureRecords,
    });
    const choices = featureChoices(out, 'feature:barbarian:primal-path');
    expect(choices).toHaveLength(1);
    expect(choices[0].category).toBe('subclass');
    expect(choices[0].from).toEqual(['subclass:path-of-the-berserker']);
  });

  it('sorts multiple subclass options and leaves classes without subclasses untouched', () => {
    const classRecords = [
      classRec('class:cleric', 'Cleric', {
        grants: [{ ref: 'feature:cleric:divine-domain', level: 1 }],
        slotName: 'Divine Domain feature',
        slotLevel: 1,
      }),
    ];
    const subclassRecords = [
      rec('subclass', 'subclass:life-domain', 'Life', {
        parentClass: 'class:cleric',
        description: 'x',
      }),
      rec('subclass', 'subclass:war-domain', 'War', {
        parentClass: 'class:cleric',
        description: 'x',
      }),
    ];
    const featureRecords = [
      rec('feature', 'feature:cleric:divine-domain', 'Divine Domain', {
        source: 'class:cleric',
        level: 1,
        description: 'Choose one domain.',
      }),
    ];
    const out = deriveFeatureChoices({
      classRecords,
      subclassRecords,
      featureRecords,
    });
    expect(featureChoices(out, 'feature:cleric:divine-domain')[0].from).toEqual(
      ['subclass:life-domain', 'subclass:war-domain'],
    );
  });

  it('leaves features with no derived choice unchanged (no empty choices array)', () => {
    const featureRecords = [
      rec('feature', 'feature:fighter:second-wind', 'Second Wind', {
        source: 'class:fighter',
        level: 1,
        description: 'Regain hit points.',
      }),
    ];
    const out = deriveFeatureChoices({
      classRecords: [],
      subclassRecords: [],
      featureRecords,
    });
    expect((out[0].data as { choices?: unknown }).choices).toBeUndefined();
  });
});

/** A class with a spellcastingProgression row + preparation metadata. */
function casterClass(
  key: string,
  name: string,
  opts: {
    featureKey: string;
    level: number;
    cantripsKnown?: number;
    spellsKnown?: number;
    prep: 'known' | 'prepared';
    spellbookStartingSpells?: number;
    preparationFormula?: {
      ability: string;
      classLevelDivisor: number;
      minimum: number;
    };
  },
): RulesRecord {
  const spellcasting: Record<string, unknown> = {
    kind: 'spellcastingProgression',
  };
  if (opts.cantripsKnown !== undefined)
    spellcasting.cantripsKnown = opts.cantripsKnown;
  if (opts.spellsKnown !== undefined)
    spellcasting.spellsKnown = opts.spellsKnown;
  const spellPreparation: Record<string, unknown> = { kind: opts.prep };
  if (opts.spellbookStartingSpells !== undefined)
    spellPreparation.spellbookStartingSpells = opts.spellbookStartingSpells;
  if (opts.preparationFormula !== undefined)
    spellPreparation.preparationFormula = opts.preparationFormula;
  return rec('class', key, name, {
    spellPreparation,
    progression: [
      {
        level: opts.level,
        advancement: [
          { kind: 'featureGrant', ref: opts.featureKey },
          spellcasting,
        ],
      },
    ],
  });
}

describe('deriveFeatureChoices — spell/cantrip selection (eshyra-o9bd.9.3)', () => {
  it('gives a known caster both a cantrip and a spell choice from its list', () => {
    const out = deriveFeatureChoices({
      classRecords: [
        casterClass('class:bard', 'Bard', {
          featureKey: 'feature:bard:spellcasting',
          level: 1,
          cantripsKnown: 2,
          spellsKnown: 4,
          prep: 'known',
        }),
      ],
      subclassRecords: [],
      featureRecords: [
        rec('feature', 'feature:bard:spellcasting', 'Spellcasting', {
          source: 'class:bard',
          level: 1,
          description: 'cantrips of your choice; spells of your choice',
        }),
      ],
    });
    // eshyra-vk23.2: structured filters (not prose strings) plus a level-up
    // replacement choice for known casters.
    const choices = featureChoices(out, 'feature:bard:spellcasting');
    expect(choices.map((c) => c.id)).toEqual([
      'cantrips',
      'spells',
      'spell-replacement',
    ]);
    const cantrips = choices[0] as Record<string, unknown>;
    expect(cantrips.category).toBe('cantrip');
    expect(cantrips.choose).toBe(2);
    expect(cantrips.from).toMatchObject({
      kind: 'spellFilter',
      classLists: ['class:bard'],
      spellLevels: [0],
    });
    const spells = choices[1] as Record<string, unknown>;
    expect(spells.choose).toBe(4);
    expect(spells.from).toMatchObject({
      kind: 'spellFilter',
      classLists: ['class:bard'],
      maxSpellLevel: { classRef: 'class:bard', atLevel: 1 },
    });
    const replacement = choices[2] as Record<string, unknown>;
    expect(replacement).toMatchObject({
      category: 'spell',
      choose: 1,
      replaces: true,
      trigger: 'level-up',
    });
    expect(replacement.from).toMatchObject({ kind: 'spellFilter' });
  });

  it('gives a prepared caster a cantrip choice and a formula-driven preparation choice', () => {
    const out = deriveFeatureChoices({
      classRecords: [
        casterClass('class:cleric', 'Cleric', {
          featureKey: 'feature:cleric:spellcasting',
          level: 1,
          cantripsKnown: 3,
          prep: 'prepared',
          preparationFormula: {
            ability: 'wisdom',
            classLevelDivisor: 1,
            minimum: 1,
          },
        }),
      ],
      subclassRecords: [],
      featureRecords: [
        rec('feature', 'feature:cleric:spellcasting', 'Spellcasting', {
          source: 'class:cleric',
          level: 1,
          description: 'cantrips of your choice',
        }),
      ],
    });
    const choices = featureChoices(out, 'feature:cleric:spellcasting');
    expect(choices.map((c) => c.id)).toEqual(['cantrips', 'prepared-spells']);
    const prepared = choices[1] as Record<string, unknown>;
    expect(prepared).toMatchObject({
      category: 'spell',
      trigger: 'daily-preparation',
      chooseFormula: { ability: 'wisdom', classLevelDivisor: 1, minimum: 1 },
    });
    expect(prepared.choose).toBeUndefined();
  });

  it('models the Wizard spellbook as starting contents plus per-level growth', () => {
    const out = deriveFeatureChoices({
      classRecords: [
        casterClass('class:wizard', 'Wizard', {
          featureKey: 'feature:wizard:spellcasting',
          level: 1,
          cantripsKnown: 3,
          prep: 'prepared',
          spellbookStartingSpells: 6,
          preparationFormula: {
            ability: 'intelligence',
            classLevelDivisor: 1,
            minimum: 1,
          },
        }),
      ],
      subclassRecords: [],
      featureRecords: [
        rec('feature', 'feature:wizard:spellbook', 'Spellbook', {
          source: 'class:wizard',
          level: 1,
          description:
            'a spellbook containing six 1st-level wizard spells of your choice',
        }),
      ],
    });
    const choices = featureChoices(out, 'feature:wizard:spellbook');
    expect(choices.map((c) => c.id)).toEqual([
      'spellbook-initial',
      'spellbook-growth',
    ]);
    expect(choices[0]).toMatchObject({ category: 'spell', choose: 6 });
    expect((choices[0] as Record<string, unknown>).from).toMatchObject({
      kind: 'spellFilter',
      classLists: ['class:wizard'],
      spellLevels: [1],
    });
    expect(choices[1]).toMatchObject({
      category: 'spell',
      choose: 2,
      trigger: 'level-up',
    });
  });

  it('models Mystic Arcanum as one pick per 11th/13th/15th/17th tier', () => {
    const out = deriveFeatureChoices({
      classRecords: [
        casterClass('class:warlock', 'Warlock', {
          featureKey: 'feature:warlock:mystic-arcanum',
          level: 11,
          prep: 'known',
        }),
      ],
      subclassRecords: [],
      featureRecords: [
        rec('feature', 'feature:warlock:mystic-arcanum', 'Mystic Arcanum', {
          source: 'class:warlock',
          level: 11,
          description:
            'Choose one 6th-level spell from the warlock spell list.',
        }),
      ],
    });
    const choices = featureChoices(out, 'feature:warlock:mystic-arcanum');
    expect(
      choices.map((c) => [
        c.id,
        c.level,
        (c.from as { spellLevels?: number[] }).spellLevels,
      ]),
    ).toEqual([
      ['arcanum-6', 11, [6]],
      ['arcanum-7', 13, [7]],
      ['arcanum-8', 15, [8]],
      ['arcanum-9', 17, [9]],
    ]);
    for (const c of choices) {
      expect(c.category).toBe('spell');
      expect(c.choose).toBe(1);
      expect((c.from as { classLists?: string[] }).classLists).toEqual([
        'class:warlock',
      ]);
    }
  });
});

describe('deriveFeatureChoices — ASI vs feat (eshyra-o9bd.9.4)', () => {
  it('attaches a structured ASI choice and a named feat out-of-scope marker', () => {
    const out = deriveFeatureChoices({
      classRecords: [
        classRec('class:fighter', 'Fighter', {
          grants: [
            { ref: 'feature:fighter:ability-score-improvement', level: 4 },
          ],
        }),
      ],
      subclassRecords: [],
      featureRecords: [
        rec(
          'feature',
          'feature:fighter:ability-score-improvement',
          'Ability Score Improvement',
          {
            source: 'class:fighter',
            level: 4,
            description: 'increase one ability score of your choice by 2…',
          },
        ),
      ],
    });
    const choices = featureChoices(
      out,
      'feature:fighter:ability-score-improvement',
    );
    expect(choices).toHaveLength(2);
    const [asi, feat] = choices;
    expect(asi.category).toBe('asiOrFeat');
    expect(asi.choose).toBe(2);
    expect(asi.from).toEqual([
      'strength',
      'dexterity',
      'constitution',
      'intelligence',
      'wisdom',
      'charisma',
    ]);
    expect(feat.category).toBe('asiOrFeat');
    expect(feat.choose).toBeUndefined();
    expect((feat.unsupported as { reason: string }).reason).toMatch(/Grappler/);
  });

  it('does not attach to a non-ASI feature', () => {
    const out = deriveFeatureChoices({
      classRecords: [
        classRec('class:fighter', 'Fighter', {
          grants: [{ ref: 'feature:fighter:second-wind', level: 1 }],
        }),
      ],
      subclassRecords: [],
      featureRecords: [
        rec('feature', 'feature:fighter:second-wind', 'Second Wind', {
          source: 'class:fighter',
          level: 1,
          description: 'Regain hit points.',
        }),
      ],
    });
    expect(featureChoices(out, 'feature:fighter:second-wind')).toEqual([]);
  });
});

describe('deriveFeatureChoices — option-list choices (eshyra-o9bd.9.5)', () => {
  function optionFeature(
    classKey: string,
    className: string,
    featureKey: string,
    featureName: string,
    description: string,
    level = 1,
  ) {
    return deriveFeatureChoices({
      classRecords: [
        classRec(classKey, className, {
          grants: [{ ref: featureKey, level }],
        }),
      ],
      subclassRecords: [],
      featureRecords: [
        rec('feature', featureKey, featureName, {
          source: classKey,
          level,
          description,
        }),
      ],
    });
  }

  it('parses the favored enemy colon-list into an enumerated from', () => {
    const out = optionFeature(
      'class:ranger',
      'Ranger',
      'feature:ranger:favored-enemy',
      'Favored Enemy',
      'Choose a type of favored enemy: aberrations, beasts, celestials, or undead. You have advantage…',
    );
    const choice = featureChoices(out, 'feature:ranger:favored-enemy')[0];
    expect(choice.category).toBe('favoredEnemy');
    expect(choice.choose).toBe(1);
    expect(choice.from).toEqual([
      'aberrations',
      'beasts',
      'celestials',
      'undead',
    ]);
  });

  it('parses the favored terrain colon-list', () => {
    const out = optionFeature(
      'class:ranger',
      'Ranger',
      'feature:ranger:natural-explorer',
      'Natural Explorer',
      'Choose one type of favored terrain: arctic, coast, desert, or swamp. When you make…',
    );
    const choice = featureChoices(out, 'feature:ranger:natural-explorer')[0];
    expect(choice.category).toBe('naturalExplorer');
    expect(choice.from).toEqual(['arctic', 'coast', 'desert', 'swamp']);
  });

  it('parses the Fighting Style pick count with a named option pool', () => {
    const out = optionFeature(
      'class:fighter',
      'Fighter',
      'feature:fighter:fighting-style',
      'Fighting Style',
      'You adopt a particular style of fighting. Choose one of the following options. Archery You gain a +2 bonus. Defense While you are wearing armor, you gain a +1 bonus to AC. Dueling When you are wielding a melee weapon in one hand, you gain a +2 bonus. Great Weapon Fighting When you roll a 1 or 2 on a damage die, you can reroll the die. Protection When a creature you can see attacks a target other than you, you can use your reaction. Two-Weapon Fighting When you engage in two-weapon fighting, you can add your ability modifier.',
    );
    const choice = featureChoices(out, 'feature:fighter:fighting-style')[0];
    expect(choice.category).toBe('fightingStyle');
    expect(choice.choose).toBe(1);
    expect(choice.from).toEqual([
      'fighting-style:archery',
      'fighting-style:defense',
      'fighting-style:dueling',
      'fighting-style:great-weapon-fighting',
      'fighting-style:protection',
      'fighting-style:two-weapon-fighting',
    ]);
    const options = choice.options as Array<Record<string, unknown>>;
    expect(options[0]).toMatchObject({
      id: 'fighting-style:archery',
      name: 'Archery',
      text: 'You gain a +2 bonus.',
      source: 'SRD p. 1',
    });
  });

  it('parses the Metamagic count of two', () => {
    const out = optionFeature(
      'class:sorcerer',
      'Sorcerer',
      'feature:sorcerer:metamagic',
      'Metamagic',
      'You gain two of the following Metamagic options of your choice. Careful Spell When you cast a spell, you can protect creatures. Distant Spell When you cast a spell, you can double the range. Empowered Spell When you roll damage, you can reroll dice. Extended Spell When you cast a spell, you can double its duration. Heightened Spell When you cast a spell, you can give one target disadvantage. Quickened Spell When you cast a spell, you can change its casting time. Subtle Spell When you cast a spell, you can cast it without components. Twinned Spell When you cast a spell, you can target a second creature.',
      3,
    );
    const choice = featureChoices(out, 'feature:sorcerer:metamagic')[0];
    expect(choice.category).toBe('metamagic');
    expect(choice.choose).toBe(2);
    expect(choice.from).toContain('metamagic:twinned-spell');
    expect(choice.options).toHaveLength(8);
  });

  it('parses the Pact Boon option catalog', () => {
    const out = optionFeature(
      'class:warlock',
      'Warlock',
      'feature:warlock:pact-boon',
      'Pact Boon',
      'At 3rd level, you gain one of the following features of your choice. Pact of the Chain You learn the find familiar spell. Pact of the Blade You can use your action to create a pact weapon. Pact of the Tome Your patron gives you a grimoire called a Book of Shadows.',
      3,
    );
    const choice = featureChoices(out, 'feature:warlock:pact-boon')[0];
    expect(choice.category).toBe('other');
    expect(choice.choose).toBe(1);
    expect(choice.from).toEqual([
      'pact-boon:pact-of-the-chain',
      'pact-boon:pact-of-the-blade',
      'pact-boon:pact-of-the-tome',
    ]);
  });

  it('parses Eldritch Invocation options and prerequisites', () => {
    const out = optionFeature(
      'class:warlock',
      'Warlock',
      'feature:warlock:eldritch-invocations',
      'Eldritch Invocations',
      'At 2nd level, you gain two eldritch invocations of your choice. Agonizing Blast Prerequisite: eldritch blast cantrip When you cast eldritch blast, add your Charisma modifier. Armor of Shadows You can cast mage armor on yourself at will. Ascendant Step Prerequisite: 9th level You can cast levitate on yourself at will. Beast Speech You can cast speak with animals at will. Beguiling Influence You gain proficiency in two skills. Bewitching Whispers Prerequisite: 7th level You can cast compulsion once. Book of Ancient Secrets Prerequisite: Pact of the Tome feature You can inscribe magical rituals. Chains of Carceri Prerequisite: 15th level, Pact of the Chain feature You can cast hold monster at will. Devil’s Sight You can see normally in darkness. Dreadful Word Prerequisite: 7th level You can cast confusion once. Eldritch Sight You can cast detect magic at will. Eldritch Spear Prerequisite: eldritch blast cantrip Its range is 300 feet. Eyes of the Rune Keeper You can read all writing. Fiendish Vigor You can cast false life. Gaze of Two Minds You can perceive through another creature. Lifedrinker Prerequisite: 12th level, Pact of the Blade feature You deal extra necrotic damage. Mask of Many Faces You can cast disguise self. Master of Myriad Forms Prerequisite: 15th level You can cast alter self. Minions of Chaos Prerequisite: 9th level You can cast conjure elemental. Mire the Mind Prerequisite: 5th level You can cast slow. Misty Visions You can cast silent image. One with Shadows Prerequisite: 5th level You can become invisible. Otherworldly Leap Prerequisite: 9th level You can cast jump. Repelling Blast Prerequisite: eldritch blast cantrip You can push the creature. Sculptor of Flesh Prerequisite: 7th level You can cast polymorph. Sign of Ill Omen Prerequisite: 5th level You can cast bestow curse. Thief of Five Fates You can cast bane. Thirsting Blade Prerequisite: 5th level, Pact of the Blade feature You can attack twice. Visions of Distant Realms Prerequisite: 15th level You can cast arcane eye. Voice of the Chain Master Prerequisite: Pact of the Chain feature You can communicate telepathically. Whispers of the Grave Prerequisite: 9th level You can cast speak with dead. Witch Sight Prerequisite: 15th level You can see true forms.',
      2,
    );
    const choice = featureChoices(
      out,
      'feature:warlock:eldritch-invocations',
    )[0];
    expect(choice.category).toBe('invocation');
    expect(choice.choose).toBe(2);
    expect(choice.from).toContain('eldritch-invocation:agonizing-blast');
    expect(choice.options).toHaveLength(32);
    const options = choice.options as Array<Record<string, unknown>>;
    expect(
      options.find((o) => o.id === 'eldritch-invocation:agonizing-blast'),
    ).toMatchObject({
      prerequisite: 'eldritch blast cantrip',
    });

    // eshyra-vk23.3: prerequisites that wrap "Pact of the <X> feature" across
    // SRD lines must stay intact, not truncate to "Pact of" and leak "the X
    // feature ..." into the option body. eshyra-vk23.9: the same prose is also
    // parsed into structured `prerequisites` clauses (preserving the prose).
    const byId = new Map(options.map((o) => [o.id as string, o]));
    const expectations: ReadonlyArray<
      [string, string, string, Array<Record<string, unknown>>]
    > = [
      [
        'eldritch-invocation:book-of-ancient-secrets',
        'Pact of the Tome feature',
        'You can inscribe',
        [{ kind: 'pactBoon', ref: 'pact-boon:pact-of-the-tome' }],
      ],
      [
        'eldritch-invocation:chains-of-carceri',
        '15th level, Pact of the Chain feature',
        'You can cast hold monster',
        [
          { kind: 'level', classRef: 'class:warlock', level: 15 },
          { kind: 'pactBoon', ref: 'pact-boon:pact-of-the-chain' },
        ],
      ],
      [
        'eldritch-invocation:lifedrinker',
        '12th level, Pact of the Blade feature',
        'You deal extra necrotic damage',
        [
          { kind: 'level', classRef: 'class:warlock', level: 12 },
          { kind: 'pactBoon', ref: 'pact-boon:pact-of-the-blade' },
        ],
      ],
      [
        'eldritch-invocation:thirsting-blade',
        '5th level, Pact of the Blade feature',
        'You can attack twice',
        [
          { kind: 'level', classRef: 'class:warlock', level: 5 },
          { kind: 'pactBoon', ref: 'pact-boon:pact-of-the-blade' },
        ],
      ],
      [
        'eldritch-invocation:voice-of-the-chain-master',
        'Pact of the Chain feature',
        'You can communicate telepathically',
        [{ kind: 'pactBoon', ref: 'pact-boon:pact-of-the-chain' }],
      ],
    ];
    for (const [id, prerequisite, bodyStart, clauses] of expectations) {
      const option = byId.get(id);
      expect(option, id).toBeDefined();
      expect(option).toMatchObject({ prerequisite });
      expect(option?.prerequisites, `${id} structured`).toEqual(clauses);
      const text = option?.text as string;
      expect(text.startsWith(bodyStart), `${id} body: ${text}`).toBe(true);
      expect(text.startsWith('the '), `${id} leaked prereq`).toBe(false);
    }

    // A cantrip prerequisite resolves to its spell ref (eshyra-vk23.9).
    expect(
      byId.get('eldritch-invocation:agonizing-blast')?.prerequisites,
    ).toEqual([{ kind: 'cantrip', ref: 'spell:eldritch-blast' }]);
  });


  it('parses Hunter subclass option catalogs', () => {
    const out = deriveFeatureChoices({
      classRecords: [
        classRec('class:ranger', 'Ranger', {
          grants: [],
        }),
      ],
      subclassRecords: [],
      featureRecords: [
        rec('feature', 'feature:hunter:hunters-prey', "Hunter's Prey", {
          source: 'subclass:hunter',
          level: 3,
          description:
            'At 3rd level, you gain one of the following features of your choice. Colossus Slayer. Your tenacity can wear down foes. Giant Killer. You can use your reaction. Horde Breaker. You can make another attack.',
        }),
      ],
    });
    const choice = featureChoices(out, 'feature:hunter:hunters-prey')[0];
    expect(choice.choose).toBe(1);
    expect(choice.from).toEqual([
      'hunters-prey:colossus-slayer',
      'hunters-prey:giant-killer',
      'hunters-prey:horde-breaker',
    ]);
  });

  it('models Champion Additional Fighting Style against the Fighter style ids', () => {
    const out = deriveFeatureChoices({
      classRecords: [
        classRec('class:fighter', 'Fighter', {
          grants: [],
        }),
      ],
      subclassRecords: [],
      featureRecords: [
        rec('feature', 'feature:fighter:fighting-style', 'Fighting Style', {
          source: 'class:fighter',
          level: 1,
          description:
            'You adopt a particular style of fighting. Choose one of the following options. Archery You gain a +2 bonus. Defense While you are wearing armor, you gain a +1 bonus to AC. Dueling When you are wielding a melee weapon in one hand, you gain a +2 bonus. Great Weapon Fighting When you roll a 1 or 2 on a damage die, you can reroll the die. Protection When a creature you can see attacks a target other than you, you can use your reaction. Two-Weapon Fighting When you engage in two-weapon fighting, you can add your ability modifier.',
        }),
        rec(
          'feature',
          'feature:champion:additional-fighting-style',
          'Additional Fighting Style',
          {
            source: 'subclass:champion',
            level: 10,
            description:
              'At 10th level, you can choose a second option from the Fighting Style class feature.',
          },
        ),
      ],
    });
    const choice = featureChoices(
      out,
      'feature:champion:additional-fighting-style',
    )[0];
    expect(choice.category).toBe('fightingStyle');
    expect(choice.choose).toBe(1);
    expect(choice.from).toContain('fighting-style:archery');
    expect(choice.from).toContain('fighting-style:two-weapon-fighting');
    expect(choice.options).toHaveLength(6);
  });
});

describe('deriveFeatureChoices — feature spell filters (eshyra-ngcj.2.3)', () => {
  it('models Magical Secrets as a structured any-class spell filter', () => {
    const out = deriveFeatureChoices({
      classRecords: [
        classRec('class:bard', 'Bard', {
          grants: [{ ref: 'feature:bard:magical-secrets', level: 10 }],
        }),
      ],
      subclassRecords: [],
      featureRecords: [
        rec('feature', 'feature:bard:magical-secrets', 'Magical Secrets', {
          source: 'class:bard',
          level: 10,
          description:
            'Choose two spells from any class, including this one. A spell you choose must be of a level you can cast, or a cantrip.',
        }),
      ],
    });
    const choice = featureChoices(out, 'feature:bard:magical-secrets')[0];
    expect(choice.category).toBe('spell');
    expect(choice.choose).toBe(2);
    expect(choice.from).toMatchObject({
      kind: 'spellFilter',
      classLists: 'any',
      includeCantrips: true,
      maxSpellLevel: { classRef: 'class:bard', atLevel: 10 },
      countsAgainstKnown: true,
    });
  });

  it('models Spell Mastery as separate 1st- and 2nd-level spellbook choices', () => {
    const out = deriveFeatureChoices({
      classRecords: [
        classRec('class:wizard', 'Wizard', {
          grants: [{ ref: 'feature:wizard:spell-mastery', level: 18 }],
        }),
      ],
      subclassRecords: [],
      featureRecords: [
        rec('feature', 'feature:wizard:spell-mastery', 'Spell Mastery', {
          source: 'class:wizard',
          level: 18,
          description:
            'Choose a 1st-level wizard spell and a 2nd-level wizard spell that are in your spellbook.',
        }),
      ],
    });
    const choices = featureChoices(out, 'feature:wizard:spell-mastery');
    expect(choices.map((choice) => choice.id)).toEqual([
      'spell-mastery-1st-level',
      'spell-mastery-2nd-level',
    ]);
    expect(choices[0].from).toMatchObject({
      spellLevels: [1],
      mustBeInSpellbook: true,
    });
  });

  it('models Pact of the Tome cantrips as a contingent spell filter', () => {
    const out = deriveFeatureChoices({
      classRecords: [
        classRec('class:warlock', 'Warlock', {
          grants: [{ ref: 'feature:warlock:pact-boon', level: 3 }],
        }),
      ],
      subclassRecords: [],
      featureRecords: [
        rec('feature', 'feature:warlock:pact-boon', 'Pact Boon', {
          source: 'class:warlock',
          level: 3,
          description:
            'At 3rd level, you gain one of the following features of your choice. Pact of the Chain You learn find familiar. Pact of the Blade You create a pact weapon. Pact of the Tome When you gain this feature, choose three cantrips from any class’s spell list.',
        }),
      ],
    });
    const choice = featureChoices(out, 'feature:warlock:pact-boon').find(
      (entry) => entry.id === 'pact-of-the-tome-cantrips',
    );
    if (choice === undefined)
      throw new Error('missing Pact of the Tome choice');
    expect(choice.id).toBe('pact-of-the-tome-cantrips');
    expect(choice.category).toBe('cantrip');
    expect(choice.from).toMatchObject({
      kind: 'spellFilter',
      classLists: 'any',
      spellLevels: [0],
      requiresFeatureOption: 'pact-boon:pact-of-the-tome',
    });
  });

  it('models Book of Ancient Secrets rituals as a contingent spell filter', () => {
    const out = deriveFeatureChoices({
      classRecords: [
        classRec('class:warlock', 'Warlock', {
          grants: [{ ref: 'feature:warlock:eldritch-invocations', level: 2 }],
        }),
      ],
      subclassRecords: [],
      featureRecords: [
        rec(
          'feature',
          'feature:warlock:eldritch-invocations',
          'Eldritch Invocations',
          {
            source: 'class:warlock',
            level: 2,
            description:
              'At 2nd level, you gain two eldritch invocations of your choice. Agonizing Blast Prerequisite: eldritch blast cantrip When you cast eldritch blast, add your Charisma modifier. Armor of Shadows You can cast mage armor on yourself at will. Ascendant Step Prerequisite: 9th level You can cast levitate on yourself at will. Beast Speech You can cast speak with animals at will. Beguiling Influence You gain proficiency in two skills. Bewitching Whispers Prerequisite: 7th level You can cast compulsion once. Book of Ancient Secrets Prerequisite: Pact of the Tome feature Choose two 1st-level spells that have the ritual tag from any class’s spell list. Chains of Carceri Prerequisite: 15th level, Pact of the Chain feature You can cast hold monster at will. Devil’s Sight You can see normally in darkness. Dreadful Word Prerequisite: 7th level You can cast confusion once. Eldritch Sight You can cast detect magic at will. Eldritch Spear Prerequisite: eldritch blast cantrip Its range is 300 feet. Eyes of the Rune Keeper You can read all writing. Fiendish Vigor You can cast false life. Gaze of Two Minds You can perceive through another creature. Lifedrinker Prerequisite: 12th level, Pact of the Blade feature You deal extra necrotic damage. Mask of Many Faces You can cast disguise self. Master of Myriad Forms Prerequisite: 15th level You can cast alter self. Minions of Chaos Prerequisite: 9th level You can cast conjure elemental. Mire the Mind Prerequisite: 5th level You can cast slow. Misty Visions You can cast silent image. One with Shadows Prerequisite: 5th level You can become invisible. Otherworldly Leap Prerequisite: 9th level You can cast jump. Repelling Blast Prerequisite: eldritch blast cantrip You can push the creature. Sculptor of Flesh Prerequisite: 7th level You can cast polymorph. Sign of Ill Omen Prerequisite: 5th level You can cast bestow curse. Thief of Five Fates You can cast bane. Thirsting Blade Prerequisite: 5th level, Pact of the Blade feature You can attack twice. Visions of Distant Realms Prerequisite: 15th level You can cast arcane eye. Voice of the Chain Master Prerequisite: Pact of the Chain feature You can communicate telepathically. Whispers of the Grave Prerequisite: 9th level You can cast speak with dead. Witch Sight Prerequisite: 15th level You can see true forms.',
          },
        ),
      ],
    });
    const choice = featureChoices(
      out,
      'feature:warlock:eldritch-invocations',
    ).find((entry) => entry.id === 'book-of-ancient-secrets-rituals');
    if (choice === undefined) {
      throw new Error('missing Book of Ancient Secrets choice');
    }
    expect(choice.id).toBe('book-of-ancient-secrets-rituals');
    expect(choice.from).toMatchObject({
      kind: 'spellFilter',
      spellLevels: [1],
      ritualOnly: true,
      requiresFeatureOption: 'eldritch-invocation:book-of-ancient-secrets',
    });
  });
});

describe('deriveFeatureChoices — subclass-feature options (eshyra-o9bd.9.6)', () => {
  function singleFeature(
    classKey: string,
    featureKey: string,
    featureName: string,
    description: string,
    level = 1,
  ) {
    return deriveFeatureChoices({
      classRecords: [
        classRec(classKey, classKey, {
          grants: [{ ref: featureKey, level }],
        }),
      ],
      subclassRecords: [],
      featureRecords: [
        rec('feature', featureKey, featureName, {
          source: classKey,
          level,
          description,
        }),
      ],
    });
  }

  it('models Bard Expertise as a structured character-state skill filter', () => {
    const out = singleFeature(
      'class:bard',
      'feature:bard:expertise',
      'Expertise',
      'At 3rd level, choose two of your skill proficiencies. Your proficiency bonus is doubled…',
      3,
    );
    const choice = featureChoices(out, 'feature:bard:expertise')[0];
    expect(choice.category).toBe('expertise');
    expect(choice.choose).toBe(2);
    // eshyra-vk23.4: a structured character-state filter, not a prose string.
    expect(choice.from).toEqual({
      kind: 'characterStateFilter',
      proficiencyTypes: ['skill'],
    });
  });

  it('includes thieves’ tools in the Rogue Expertise character-state filter', () => {
    const out = singleFeature(
      'class:rogue',
      'feature:rogue:expertise',
      'Expertise',
      'At 1st level, choose two of your skill proficiencies, or one of your skill proficiencies and your proficiency with thieves’ tools. Your proficiency bonus is doubled…',
    );
    const choice = featureChoices(out, 'feature:rogue:expertise')[0];
    expect(choice.category).toBe('expertise');
    expect(choice.from).toEqual({
      kind: 'characterStateFilter',
      proficiencyTypes: ['skill'],
      tools: ['thieves-tools'],
    });
  });

  it('marks Channel Divinity as a named out-of-scope (per-use, not build) choice', () => {
    const out = singleFeature(
      'class:cleric',
      'feature:cleric:channel-divinity',
      'Channel Divinity',
      'At 2nd level, you gain the ability to channel divine energy. When you use your Channel Divinity, you choose which effect to create.',
      2,
    );
    const choice = featureChoices(out, 'feature:cleric:channel-divinity')[0];
    expect(choice.category).toBe('channelDivinity');
    expect(choice.choose).toBeUndefined();
    expect((choice.unsupported as { reason: string }).reason).toMatch(
      /per-use/,
    );
  });

  it('does not attach to an unrelated feature', () => {
    const out = singleFeature(
      'class:fighter',
      'feature:fighter:second-wind',
      'Second Wind',
      'You have a limited well of stamina.',
    );
    expect(featureChoices(out, 'feature:fighter:second-wind')).toEqual([]);
  });
});

describe('deriveFeatureChoices — fail-closed count parsing (review fix)', () => {
  function grantedFeature(
    classKey: string,
    featureKey: string,
    name: string,
    description: string,
    level = 1,
  ) {
    return {
      classRecords: [
        classRec(classKey, classKey, { grants: [{ ref: featureKey, level }] }),
      ],
      subclassRecords: [] as RulesRecord[],
      featureRecords: [
        rec('feature', featureKey, name, {
          source: classKey,
          level,
          description,
        }),
      ],
    };
  }

  it('reads the indefinite article "a" as a count of 1 (not via a default)', () => {
    const out = deriveFeatureChoices(
      grantedFeature(
        'class:ranger',
        'feature:ranger:favored-enemy',
        'Favored Enemy',
        'Choose a type of favored enemy: aberrations, beasts, or undead. You have advantage…',
      ),
    );
    const choice = featureChoices(out, 'feature:ranger:favored-enemy')[0];
    expect(choice.choose).toBe(1);
    expect(choice.from).toEqual(['aberrations', 'beasts', 'undead']);
  });

  it('throws (does not invent a count) when an option-list count is unparseable', () => {
    expect(() =>
      deriveFeatureChoices(
        grantedFeature(
          'class:fighter',
          'feature:fighter:fighting-style',
          'Fighting Style',
          // No count word before the keyword — extraction-regression shape.
          'You adopt a particular style of fighting as your specialty. Pick from the following options. Archery…',
        ),
      ),
    ).toThrow(FeatureChoiceDerivationError);
  });

  it('throws when an enumerated option list parses empty', () => {
    expect(() =>
      deriveFeatureChoices(
        grantedFeature(
          'class:ranger',
          'feature:ranger:natural-explorer',
          'Natural Explorer',
          // Count is present ("one") but the colon list is gone.
          'Choose one type of favored terrain. When you make an Intelligence check…',
        ),
      ),
    ).toThrow(/option list/);
  });

  it('throws when the Expertise count is unparseable', () => {
    expect(() =>
      deriveFeatureChoices(
        grantedFeature(
          'class:rogue',
          'feature:rogue:expertise',
          'Expertise',
          // Triggers the expertise branch but carries no count word.
          'At 1st level, choose some of your skill proficiencies. Your proficiency bonus is doubled…',
        ),
      ),
    ).toThrow(FeatureChoiceDerivationError);
  });
});
