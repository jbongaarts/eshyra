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
import { deriveFeatureChoices } from '../../../scripts/importers/dnd5e-srd-5.1/deriveFeatureChoices.js';
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
    const choices = featureChoices(out, 'feature:bard:spellcasting');
    expect(choices.map((c) => [c.category, c.choose, c.from])).toEqual([
      ['cantrip', 2, 'the bard spell list'],
      ['spell', 4, 'the bard spell list'],
    ]);
  });

  it('gives a prepared caster without a spellbook only a cantrip choice', () => {
    const out = deriveFeatureChoices({
      classRecords: [
        casterClass('class:cleric', 'Cleric', {
          featureKey: 'feature:cleric:spellcasting',
          level: 1,
          cantripsKnown: 3,
          prep: 'prepared',
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
    expect(choices.map((c) => c.category)).toEqual(['cantrip']);
  });

  it('uses the spellbook starting count for the Wizard spell choice', () => {
    const out = deriveFeatureChoices({
      classRecords: [
        casterClass('class:wizard', 'Wizard', {
          featureKey: 'feature:wizard:spellcasting',
          level: 1,
          cantripsKnown: 3,
          prep: 'prepared',
          spellbookStartingSpells: 6,
        }),
      ],
      subclassRecords: [],
      featureRecords: [
        rec('feature', 'feature:wizard:spellcasting', 'Spellcasting', {
          source: 'class:wizard',
          level: 1,
          description: 'cantrips of your choice; spells of your choice',
        }),
      ],
    });
    const spell = featureChoices(out, 'feature:wizard:spellcasting').find(
      (c) => c.category === 'spell',
    );
    expect(spell?.choose).toBe(6);
  });

  it('models Mystic Arcanum as a single-spell choice from the class list', () => {
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
    expect(featureChoices(out, 'feature:warlock:mystic-arcanum')).toEqual([
      {
        id: 'arcanum',
        category: 'spell',
        prompt:
          'Choose one 6th-level spell from the warlock spell list as your arcanum.',
        level: 11,
        choose: 1,
        from: 'the warlock spell list',
      },
    ]);
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
      'You adopt a particular style of fighting. Choose one of the following options. Archery…',
    );
    const choice = featureChoices(out, 'feature:fighter:fighting-style')[0];
    expect(choice.category).toBe('fightingStyle');
    expect(choice.choose).toBe(1);
    expect(choice.from).toBe('a Fighting Style option from this feature');
  });

  it('parses the Metamagic count of two', () => {
    const out = optionFeature(
      'class:sorcerer',
      'Sorcerer',
      'feature:sorcerer:metamagic',
      'Metamagic',
      'You gain two of the following Metamagic options of your choice. Careful Spell…',
      3,
    );
    const choice = featureChoices(out, 'feature:sorcerer:metamagic')[0];
    expect(choice.category).toBe('metamagic');
    expect(choice.choose).toBe(2);
  });

  it('parses the Eldritch Invocations count', () => {
    const out = optionFeature(
      'class:warlock',
      'Warlock',
      'feature:warlock:eldritch-invocations',
      'Eldritch Invocations',
      'At 2nd level, you gain two eldritch invocations of your choice.',
      2,
    );
    const choice = featureChoices(
      out,
      'feature:warlock:eldritch-invocations',
    )[0];
    expect(choice.category).toBe('invocation');
    expect(choice.choose).toBe(2);
    expect(choice.from).toBe('an Eldritch Invocation you qualify for');
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

  it('models Expertise as a structured skill-proficiency choice', () => {
    const out = singleFeature(
      'class:rogue',
      'feature:rogue:expertise',
      'Expertise',
      'At 1st level, choose two of your skill proficiencies. Your proficiency bonus is doubled…',
    );
    const choice = featureChoices(out, 'feature:rogue:expertise')[0];
    expect(choice.category).toBe('expertise');
    expect(choice.choose).toBe(2);
    expect(choice.from).toBe('your skill proficiencies');
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
