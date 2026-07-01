import { describe, expect, it } from 'vitest';
import type {
  RecordProvenance,
  RulesPack,
  RulesPackLicense,
  RulesPackSource,
  RulesRecord,
} from '../src/internal.js';
import {
  assertShippableRulesPack,
  evaluateRulesPackPolicy,
  RulesPackError,
  validateRulesPack,
} from '../src/internal.js';

const DEFAULT_SOURCE_URL = 'https://example.test/srd/5.1';

function packSource(overrides: Partial<RulesPackSource> = {}): RulesPackSource {
  return {
    sourceTitle: 'Example SRD',
    sourceVersion: '5.1',
    sourceUrl: DEFAULT_SOURCE_URL,
    recordProvenancePolicy:
      'Every record cites the SRD page it was extracted from.',
    ...overrides,
  };
}

function recordProvenance(
  overrides: Partial<RecordProvenance> = {},
): RecordProvenance {
  return {
    sourceRef: DEFAULT_SOURCE_URL,
    locator: 'p. 1',
    ...overrides,
  };
}

function license(overrides: Partial<RulesPackLicense> = {}): RulesPackLicense {
  return {
    licenseClass: 'open',
    licenseName: 'Creative Commons Attribution 4.0 International',
    attributionText: 'Rules text derived from an open SRD fixture.',
    requiresAttribution: true,
    commercialUseAllowed: true,
    hostedUseAllowed: true,
    redistributionAllowed: true,
    publicSharingAllowed: true,
    derivativeAllowed: true,
    containsUserSuppliedText: false,
    containsTrademarkedSettingMaterial: false,
    sourceMaterialDescription: 'Open fantasy rules reference.',
    provenancePolicy: 'Every record includes source and license metadata.',
    outputRestrictions: 'Preserve attribution on redistributed records.',
    ...overrides,
  };
}

function creatureData(): Record<string, unknown> {
  return {
    size: 'Small',
    type: 'humanoid',
    alignment: 'neutral evil',
    armorClass: 15,
    hitPoints: 7,
    speed: { walk: 30 },
    challengeRating: '1/4',
    abilityScores: {
      strength: 8,
      dexterity: 14,
      constitution: 10,
      intelligence: 10,
      wisdom: 8,
      charisma: 8,
    },
  };
}

function record(
  key: string,
  overrides: Partial<RulesRecord> = {},
): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'creature',
    key,
    name: 'Goblin',
    data: creatureData(),
    source: 'Example SRD p. 1',
    license: license(),
    provenance: recordProvenance(),
    ...overrides,
  };
}

function validRulesPack(
  overrides: Partial<RulesPack['meta']> & {
    records?: readonly RulesRecord[];
    licenseClass?: RulesPackLicense['licenseClass'];
  } = {},
): RulesPack {
  const { records, licenseClass, ...metaOverrides } = overrides;
  return {
    meta: {
      packId: 'rules:dnd5e-srd',
      title: 'D&D 5e SRD',
      description: 'Provider-neutral rules fixture.',
      role: 'base',
      systemId: 'dnd5e-srd',
      version: '5.1',
      license: license(licenseClass === undefined ? {} : { licenseClass }),
      source: packSource(),
      ...metaOverrides,
    },
    records: records ?? [record('creature:goblin')],
  };
}

describe('rules pack validation', () => {
  it('validates a base D&D rules pack with license metadata', () => {
    const pack = validateRulesPack(
      validRulesPack({ role: 'base', systemId: 'dnd5e-srd' }),
    );
    expect(pack.meta.systemId).toBe('dnd5e-srd');
    expect(pack.meta.license.licenseName).toContain('Creative Commons');
  });

  it('rejects blank system ids', () => {
    const pack = validRulesPack({ systemId: '' });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/systemId/);
  });

  it('rejects addon packs without base compatibility metadata', () => {
    const pack = validRulesPack({ role: 'addon' });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/compatibleBaseSystems/);
  });

  it('rejects duplicate record keys in one pack', () => {
    const pack = validRulesPack({
      records: [record('creature:goblin'), record('creature:goblin')],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/duplicate key/);
  });

  it('rejects records missing required data payloads', () => {
    const { data: _data, ...recordWithoutData } = record('creature:goblin');
    const pack = {
      ...validRulesPack(),
      records: [recordWithoutData],
    };

    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/records\[0\]\.data/);
  });

  it('preserves explicit license fields on metadata and records', () => {
    const pack = validateRulesPack(
      validRulesPack({
        license: license({
          licenseName: 'Open RPG Creative License',
          attributionText: 'ORC attribution text.',
          requiresAttribution: false,
        }),
        records: [
          record('creature:goblin', {
            license: license({
              licenseName: 'Creative Commons Zero',
              attributionText: 'No attribution required.',
              requiresAttribution: false,
            }),
          }),
        ],
      }),
    );

    expect(pack.meta.license.licenseName).toBe('Open RPG Creative License');
    expect(pack.meta.license.requiresAttribution).toBe(false);
    expect(pack.records[0].license.licenseName).toBe('Creative Commons Zero');
    expect(pack.records[0].license.attributionText).toBe(
      'No attribution required.',
    );
  });

  it('preserves source manifest fields on meta', () => {
    const sourceUrl = 'https://example.test/srd/5.2';
    const pack = validateRulesPack(
      validRulesPack({
        source: packSource({
          sourceHash: 'sha256:deadbeef',
          sourceDate: '2024-01-15',
          sourceUrl,
        }),
        records: [
          record('creature:goblin', {
            provenance: recordProvenance({ sourceRef: sourceUrl }),
          }),
        ],
      }),
    );
    expect(pack.meta.source.sourceTitle).toBe('Example SRD');
    expect(pack.meta.source.sourceHash).toBe('sha256:deadbeef');
    expect(pack.meta.source.sourceDate).toBe('2024-01-15');
    expect(pack.meta.source.sourceUrl).toBe(sourceUrl);
  });

  it('rejects packs whose source has neither sourceUrl nor sourceIdentity', () => {
    const sourceWithNeither = {
      sourceTitle: 'Example SRD',
      sourceVersion: '5.1',
      recordProvenancePolicy: 'records cite section',
    };
    const pack = validRulesPack({
      source: sourceWithNeither as RulesPackSource,
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(
      /sourceUrl or sourceIdentity/,
    );
  });

  it('accepts sourceIdentity in place of sourceUrl for vendored corpora', () => {
    const identity = 'pf2e-remaster:vendor:2024-q4';
    const pack = validateRulesPack(
      validRulesPack({
        source: {
          sourceTitle: 'Pathfinder 2e Remaster (vendored)',
          sourceVersion: '1.0',
          sourceIdentity: identity,
          recordProvenancePolicy:
            'records cite Player/GM/Monster Core section.',
        },
        records: [
          record('creature:goblin', {
            provenance: recordProvenance({ sourceRef: identity }),
          }),
        ],
      }),
    );
    expect(pack.meta.source.sourceIdentity).toBe(identity);
    expect(pack.records[0].provenance.sourceRef).toBe(identity);
  });

  it('rejects records whose provenance does not match the pack source', () => {
    const pack = validRulesPack({
      records: [
        record('creature:goblin', {
          provenance: recordProvenance({
            sourceRef: 'https://example.test/other',
          }),
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(
      /provenance\.sourceRef must match/,
    );
  });

  it('rejects records missing provenance', () => {
    const { provenance: _p, ...recordWithoutProvenance } =
      record('creature:goblin');
    const pack = {
      ...validRulesPack(),
      records: [recordWithoutProvenance],
    };
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/records\[0\]\.provenance/);
  });

  it('rejects packs missing meta.source entirely', () => {
    const validMeta = validRulesPack().meta;
    const { source: _s, ...metaWithoutSource } = validMeta;
    const pack = {
      ...validRulesPack(),
      meta: metaWithoutSource as RulesPack['meta'],
    };
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/meta\.source/);
  });

  it('rejects dnd5e creature records missing required schema fields', () => {
    const pack = validRulesPack({
      records: [record('creature:goblin', { data: { hitPoints: 7 } })],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/data\.size/);
  });

  it('rejects dnd5e creature records with malformed ability scores', () => {
    const data = creatureData();
    const abilityScores = {
      ...(data.abilityScores as Record<string, number>),
      strength: -1,
    };
    const pack = validRulesPack({
      records: [
        record('creature:goblin', {
          data: { ...data, abilityScores },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/abilityScores\.strength/);
  });

  it('accepts a non-empty source-derived creature family path', () => {
    const pack = validRulesPack({
      records: [
        record('creature:deva', {
          data: { ...creatureData(), familyPath: ['Angels'] },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).not.toThrow();
  });

  it('rejects an empty or malformed creature family path', () => {
    for (const familyPath of [[], ['Angels', '']] as const) {
      const pack = validRulesPack({
        records: [
          record('creature:deva', {
            data: { ...creatureData(), familyPath },
          }),
        ],
      });
      expect(() => validateRulesPack(pack)).toThrow(/data\.familyPath/);
    }
  });

  it('accepts an optional source-derived creature description (eshyra-76b7)', () => {
    const pack = validRulesPack({
      records: [
        record('creature:acolyte', {
          data: {
            ...creatureData(),
            description:
              'Acolytes are junior members of a clergy, usually answerable to a priest.',
          },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).not.toThrow();
  });

  it('rejects a non-string creature description (eshyra-76b7)', () => {
    const pack = validRulesPack({
      records: [
        record('creature:acolyte', {
          data: { ...creatureData(), description: 42 },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/data\.description/);
  });

  it('rejects dnd5e spell records missing the level field', () => {
    const pack = validRulesPack({
      records: [
        record('spell:fire-bolt', {
          kind: 'spell',
          name: 'Fire Bolt',
          data: {
            school: 'evocation',
            castingTime: '1 action',
            range: '120 feet',
            components: ['V', 'S'],
            duration: 'Instantaneous',
            classes: ['Sorcerer', 'Wizard'],
          },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/data\.level/);
  });

  it('accepts dnd5e spell records that match the spell schema', () => {
    const pack = validateRulesPack(
      validRulesPack({
        records: [
          record('spell:fire-bolt', {
            kind: 'spell',
            name: 'Fire Bolt',
            data: {
              level: 0,
              school: 'evocation',
              castingTime: '1 action',
              range: '120 feet',
              components: ['V', 'S'],
              duration: 'Instantaneous',
              classes: ['Sorcerer', 'Wizard'],
            },
          }),
        ],
      }),
    );
    expect(pack.records[0].kind).toBe('spell');
  });

  it('accepts optional spell tableRefs and rejects non-string entries', () => {
    const spell = record('spell:confusion', {
      kind: 'spell',
      name: 'Confusion',
      data: {
        level: 4,
        school: 'enchantment',
        castingTime: '1 action',
        range: '90 feet',
        components: ['V', 'S', 'M'],
        duration: 'Concentration, up to 1 minute',
        classes: ['Bard', 'Sorcerer', 'Wizard'],
        tableRefs: ['table:confusion-behavior'],
      },
    });
    expect(() =>
      validateRulesPack(validRulesPack({ records: [spell] })),
    ).not.toThrow();
    expect(() =>
      validateRulesPack(
        validRulesPack({
          records: [
            {
              ...spell,
              data: { ...spell.data, tableRefs: [42] },
            },
          ],
        }),
      ),
    ).toThrow(/tableRefs/);
  });

  it('rejects a non-canonical mechanics.damage type (eshyra-erf5.4)', () => {
    const spell = record('spell:example', {
      kind: 'spell',
      name: 'Example',
      data: {
        level: 1,
        school: 'evocation',
        castingTime: '1 action',
        range: '30 feet',
        components: ['V', 'S'],
        duration: 'Instantaneous',
        classes: ['Wizard'],
        mechanics: { damage: [{ dice: '1d4', type: 'extra' }] },
      },
    });
    expect(() =>
      validateRulesPack(validRulesPack({ records: [spell] })),
    ).toThrow(/damage\[0\]\.type must be a canonical SRD damage type/);
    expect(() =>
      validateRulesPack(
        validRulesPack({
          records: [
            {
              ...spell,
              data: {
                ...spell.data,
                mechanics: {
                  damage: [{ dice: '1d4', type: 'fire' }],
                },
              },
            },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('accepts spell weaponDamageModifiers and rejects an unknown operation (eshyra-erf5.4)', () => {
    const spell = record('spell:enlarge-reduce', {
      kind: 'spell',
      name: 'Enlarge/Reduce',
      data: {
        level: 2,
        school: 'transmutation',
        castingTime: '1 action',
        range: '30 feet',
        components: ['V', 'S', 'M'],
        duration: 'Concentration, up to 1 minute',
        classes: ['Sorcerer', 'Wizard'],
        mechanics: {
          weaponDamageModifiers: [{ dice: '1d4', operation: 'increase' }],
        },
      },
    });
    expect(() =>
      validateRulesPack(validRulesPack({ records: [spell] })),
    ).not.toThrow();
    expect(() =>
      validateRulesPack(
        validRulesPack({
          records: [
            {
              ...spell,
              data: {
                ...spell.data,
                mechanics: {
                  weaponDamageModifiers: [{ dice: '1d4', operation: 'more' }],
                },
              },
            },
          ],
        }),
      ),
    ).toThrow(/weaponDamageModifiers\[0\]\.operation/);
  });

  it('requires structured armorClass on armor/shield equipment (eshyra-rtgi)', () => {
    const leather = record('equipment:leather', {
      kind: 'equipment',
      name: 'Leather',
      data: {
        category: 'armor',
        ac: '11 + Dex modifier',
        armorType: 'light',
        armorClass: { base: 11, dexModifier: 'unlimited' },
      },
    });
    expect(() =>
      validateRulesPack(validRulesPack({ records: [leather] })),
    ).not.toThrow();
    expect(() =>
      validateRulesPack(
        validRulesPack({
          records: [
            { ...leather, data: { ...leather.data, armorClass: undefined } },
          ],
        }),
      ),
    ).toThrow(/armorClass/);
  });

  it('requires a valid dexModifier kind and rejects a stray dexModifierCap (eshyra-rtgi)', () => {
    const base = record('equipment:example-armor', {
      kind: 'equipment',
      name: 'Example Armor',
      data: {
        category: 'armor',
        ac: '16',
        armorType: 'heavy',
        armorClass: { base: 16, dexModifier: 'none' },
      },
    });
    expect(() =>
      validateRulesPack(validRulesPack({ records: [base] })),
    ).not.toThrow();
    expect(() =>
      validateRulesPack(
        validRulesPack({
          records: [
            {
              ...base,
              data: {
                ...base.data,
                armorClass: { base: 16, dexModifier: 'bogus' },
              },
            },
          ],
        }),
      ),
    ).toThrow(/dexModifier must be one of/);
    expect(() =>
      validateRulesPack(
        validRulesPack({
          records: [
            {
              ...base,
              data: {
                ...base.data,
                armorClass: {
                  base: 16,
                  dexModifier: 'none',
                  dexModifierCap: 2,
                },
              },
            },
          ],
        }),
      ),
    ).toThrow(/dexModifierCap is only valid when dexModifier is "capped"/);
  });

  it('requires a shield armorClass to carry a bonus, not a base/dexModifier', () => {
    const shield = record('equipment:shield', {
      kind: 'equipment',
      name: 'Shield',
      data: {
        category: 'armor',
        ac: '+2',
        armorType: 'shield',
        armorClass: { bonus: 2 },
      },
    });
    expect(() =>
      validateRulesPack(validRulesPack({ records: [shield] })),
    ).not.toThrow();
    expect(() =>
      validateRulesPack(
        validRulesPack({
          records: [
            {
              ...shield,
              data: { ...shield.data, armorClass: { base: 2 } },
            },
          ],
        }),
      ),
    ).toThrow(/armorClass\.bonus/);
  });

  it('rejects dnd5e action records missing a description', () => {
    const pack = validRulesPack({
      records: [
        record('action:attack', {
          kind: 'action',
          name: 'Attack',
          data: {},
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/data\.description/);
  });

  it('accepts dnd5e feature records linked to a grantor and level', () => {
    const pack = validateRulesPack(
      validRulesPack({
        records: [
          record('feature:action-surge', {
            kind: 'feature',
            name: 'Action Surge',
            data: {
              description:
                'You can push yourself beyond your normal limits for a moment.',
              source: 'class:fighter',
              level: 2,
            },
          }),
        ],
      }),
    );
    expect(pack.records[0].kind).toBe('feature');
  });

  it('rejects dnd5e feature records missing the grantor source link', () => {
    const pack = validRulesPack({
      records: [
        record('feature:rage', {
          kind: 'feature',
          name: 'Rage',
          data: { description: 'In battle, you fight with primal ferocity.' },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/data\.source/);
  });

  it('rejects dnd5e feature records without the level gained', () => {
    const pack = validRulesPack({
      records: [
        record('feature:channel-divinity', {
          kind: 'feature',
          name: 'Channel Divinity',
          data: {
            description: 'You can channel divine energy directly from a deity.',
            source: 'class:cleric',
          },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/data\.level/);
  });

  it('accepts a feature record with a structured choices[] entry (eshyra-o9bd.9)', () => {
    const pack = validateRulesPack(
      validRulesPack({
        records: [
          record('feature:fighting-style', {
            kind: 'feature',
            name: 'Fighting Style',
            data: {
              description: 'You adopt a particular style of fighting.',
              source: 'class:fighter',
              level: 1,
              choices: [
                {
                  id: 'fighting-style',
                  category: 'fightingStyle',
                  prompt: 'Choose a Fighting Style.',
                  level: 1,
                  choose: 1,
                  from: ['Archery', 'Defense', 'Dueling'],
                },
              ],
            },
          }),
        ],
      }),
    );
    expect(pack.records[0].kind).toBe('feature');
  });

  it('accepts a feature choice with a named out-of-scope marker (eshyra-o9bd.9)', () => {
    expect(() =>
      validateRulesPack(
        validRulesPack({
          records: [
            record('feature:metamagic', {
              kind: 'feature',
              name: 'Metamagic',
              data: {
                description: 'You gain two Metamagic options of your choice.',
                source: 'class:sorcerer',
                level: 3,
                choices: [
                  {
                    id: 'metamagic',
                    category: 'metamagic',
                    prompt: 'Choose two Metamagic options.',
                    level: 3,
                    unsupported: { reason: 'Metamagic options not modeled.' },
                  },
                ],
              },
            }),
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('rejects a feature choice with an unknown category (eshyra-o9bd.9)', () => {
    const pack = validRulesPack({
      records: [
        record('feature:bad-choice', {
          kind: 'feature',
          name: 'Bad Choice',
          data: {
            description: 'A choice.',
            source: 'class:fighter',
            level: 1,
            choices: [
              {
                id: 'x',
                category: 'wibble',
                prompt: 'Pick.',
                level: 1,
                choose: 1,
              },
            ],
          },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(/category must be one of/);
  });

  it('rejects a feature choice that is neither structured nor unsupported (eshyra-o9bd.9)', () => {
    const pack = validRulesPack({
      records: [
        record('feature:bad-choice', {
          kind: 'feature',
          name: 'Bad Choice',
          data: {
            description: 'A choice.',
            source: 'class:fighter',
            level: 1,
            choices: [
              { id: 'x', category: 'subclass', prompt: 'Pick.', level: 1 },
            ],
          },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(
      /exactly one of 'choose'.*or 'unsupported'/,
    );
  });

  it('rejects a feature choice that is both structured and unsupported (eshyra-o9bd.9)', () => {
    const pack = validRulesPack({
      records: [
        record('feature:bad-choice', {
          kind: 'feature',
          name: 'Bad Choice',
          data: {
            description: 'A choice.',
            source: 'class:fighter',
            level: 1,
            choices: [
              {
                id: 'x',
                category: 'subclass',
                prompt: 'Pick.',
                level: 1,
                choose: 1,
                unsupported: { reason: 'no' },
              },
            ],
          },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(
      /exactly one of 'choose'.*or 'unsupported'/,
    );
  });

  it('accepts dnd5e subclass records linked to a parent class', () => {
    const pack = validateRulesPack(
      validRulesPack({
        records: [
          record('subclass:champion', {
            kind: 'subclass',
            name: 'Champion',
            data: {
              parentClass: 'class:fighter',
              description:
                'The archetypal Champion focuses on the development of raw physical power.',
              features: ['feature:improved-critical'],
            },
          }),
        ],
      }),
    );
    expect(pack.records[0].kind).toBe('subclass');
  });

  it('rejects dnd5e subclass records missing the parent class link', () => {
    const pack = validRulesPack({
      records: [
        record('subclass:life-domain', {
          kind: 'subclass',
          name: 'Life Domain',
          data: {
            description:
              'The Life domain focuses on the vibrant positive energy.',
          },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/data\.parentClass/);
  });

  it('does not require base-class scalar fields on a subclass', () => {
    // A subclass carries only its own fields; hitDie/proficiencies stay on
    // the parent `class` record (ADR 0009). Description is still required.
    const pack = validRulesPack({
      records: [
        record('subclass:evocation', {
          kind: 'subclass',
          name: 'School of Evocation',
          data: { parentClass: 'class:wizard' },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/data\.description/);
  });

  it('rejects rule records without a text body', () => {
    const pack = validRulesPack({
      records: [
        record('rule:cover', {
          kind: 'rule',
          name: 'Cover',
          systemId: 'misc-system',
          data: { description: 'A creature behind cover...' },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/data\.text/);
  });

  it('accepts optional rule tableRefs and rejects non-string entries', () => {
    const rule = record('rule:half-dragon-template', {
      kind: 'rule',
      name: 'Half-Dragon Template',
      data: {
        text: 'A creature can become a half-dragon.',
        tableRefs: ['table:half-dragon-damage-resistance'],
      },
    });
    expect(() =>
      validateRulesPack(validRulesPack({ records: [rule] })),
    ).not.toThrow();
    expect(() =>
      validateRulesPack(
        validRulesPack({
          records: [
            {
              ...rule,
              data: { ...rule.data, tableRefs: [42] },
            },
          ],
        }),
      ),
    ).toThrow(/tableRefs/);
  });

  it('rejects table records without columns and rows arrays', () => {
    const pack = validRulesPack({
      records: [
        record('table:starting-equipment', {
          kind: 'table',
          name: 'Starting Equipment',
          systemId: 'misc-system',
          data: { columns: ['Class', 'Pack'] },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/data\.rows/);
  });

  it('accepts table records with non-empty columns and scalar rows', () => {
    const pack = validateRulesPack(
      validRulesPack({
        records: [
          record('table:difficulty-classes', {
            kind: 'table',
            name: 'Difficulty Classes',
            systemId: 'misc-system',
            data: {
              columns: ['Task Difficulty', 'DC', 'Applies'],
              rows: [
                ['Easy', 10, true],
                ['Special', null, false],
              ],
            },
          }),
        ],
      }),
    );
    expect(pack.records[0].kind).toBe('table');
  });

  it('accepts D&D table records with semantic projections', () => {
    const pack = validateRulesPack(
      validRulesPack({
        records: [
          record('table:beast-shapes', {
            kind: 'table',
            name: 'Beast Shapes',
            data: {
              columns: ['Level', 'Max. CR', 'Limitations', 'Example'],
              rows: [['2nd', '1/4', 'No flying or swimming speed', 'Wolf']],
              projection: {
                kind: 'beastShapeOptions',
                rows: [
                  {
                    druidLevel: 2,
                    maxChallengeRating: '1/4',
                    maxChallengeRatingValue: 0.25,
                    limitations: 'No flying or swimming speed',
                    example: 'Wolf',
                  },
                ],
              },
            },
          }),
        ],
      }),
    );
    expect(pack.records[0].kind).toBe('table');
  });

  it('accepts the eshyra-o9bd.7.1-.7.4 projection kinds and nullable fields', () => {
    const pack = validateRulesPack(
      validRulesPack({
        records: [
          record('table:lifestyle-expenses', {
            kind: 'table',
            name: 'Lifestyle Expenses',
            data: {
              columns: ['Lifestyle', 'Price/Day'],
              rows: [['Wretched', '—']],
              // A null pricePerDayCopper (free) must be accepted.
              projection: {
                kind: 'lifestyleExpenses',
                rows: [
                  {
                    lifestyle: 'Wretched',
                    pricePerDay: '—',
                    pricePerDayCopper: null,
                    isMinimum: false,
                  },
                ],
              },
            },
          }),
          record('table:exotic-languages', {
            kind: 'table',
            name: 'Exotic Languages',
            data: {
              columns: ['Language', 'Typical Speakers', 'Script'],
              rows: [['Deep Speech', 'Aboleths, cloakers', '—']],
              // A null script must be accepted.
              projection: {
                kind: 'languageOptions',
                rows: [
                  {
                    language: 'Deep Speech',
                    typicalSpeakers: 'Aboleths, cloakers',
                    script: null,
                    category: 'exotic',
                  },
                ],
              },
            },
          }),
          record('table:object-hit-points', {
            kind: 'table',
            name: 'Object Hit Points',
            data: {
              columns: ['Size', 'Fragile', 'Resilient'],
              rows: [['Tiny (bottle, lock)', '2 (1d4)', '5 (2d4)']],
              projection: {
                kind: 'objectHitPoints',
                rows: [
                  {
                    size: 'Tiny (bottle, lock)',
                    sizeCategory: 'Tiny',
                    fragile: { average: 2, dice: '1d4' },
                    resilient: { average: 5, dice: '2d4' },
                  },
                ],
              },
            },
          }),
        ],
      }),
    );
    expect(pack.records).toHaveLength(3);
  });

  it('rejects a projection row missing a required typed field', () => {
    const pack = validRulesPack({
      records: [
        record('table:object-hit-points', {
          kind: 'table',
          name: 'Object Hit Points',
          data: {
            columns: ['Size', 'Fragile', 'Resilient'],
            rows: [['Tiny (bottle, lock)', '2 (1d4)', '5 (2d4)']],
            projection: {
              kind: 'objectHitPoints',
              rows: [
                {
                  size: 'Tiny (bottle, lock)',
                  sizeCategory: 'Tiny',
                  // `dice` is missing from the resilient roll.
                  fragile: { average: 2, dice: '1d4' },
                  resilient: { average: 5 },
                },
              ],
            },
          },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/resilient\.dice/);
  });

  it('rejects D&D table records with unsupported semantic projection kinds', () => {
    const pack = validRulesPack({
      records: [
        record('table:unknown-projection', {
          kind: 'table',
          name: 'Unknown Projection',
          data: {
            columns: ['Name'],
            rows: [['Value']],
            projection: { kind: 'mysteryProjection', rows: [] },
          },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(
      /unsupported table projection kind/,
    );
  });

  it('rejects table records with empty columns', () => {
    const pack = validRulesPack({
      records: [
        record('table:empty-columns', {
          kind: 'table',
          name: 'Empty Columns',
          systemId: 'misc-system',
          data: { columns: [], rows: [] },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/data\.columns/);
  });

  it('rejects table rows whose length does not match columns', () => {
    const pack = validRulesPack({
      records: [
        record('table:difficulty-classes', {
          kind: 'table',
          name: 'Difficulty Classes',
          systemId: 'misc-system',
          data: {
            columns: ['Task Difficulty', 'DC'],
            rows: [['Easy'], ['Hard', 20, 'extra']],
          },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(
      /data\.rows\[0\] length must match data\.columns length/,
    );
  });

  it('rejects table row cells that are objects or arrays', () => {
    const objectCellPack = validRulesPack({
      records: [
        record('table:object-cell', {
          kind: 'table',
          name: 'Object Cell',
          systemId: 'misc-system',
          data: {
            columns: ['Name', 'Value'],
            rows: [['Easy', { dc: 10 }]],
          },
        }),
      ],
    });
    expect(() => validateRulesPack(objectCellPack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(objectCellPack)).toThrow(
      /data\.rows\[0\]\[1\]/,
    );

    const arrayCellPack = validRulesPack({
      records: [
        record('table:array-cell', {
          kind: 'table',
          name: 'Array Cell',
          systemId: 'misc-system',
          data: {
            columns: ['Name', 'Values'],
            rows: [['Easy', [10]]],
          },
        }),
      ],
    });
    expect(() => validateRulesPack(arrayCellPack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(arrayCellPack)).toThrow(
      /data\.rows\[0\]\[1\]/,
    );
  });

  it('falls through to the baseline data check for unregistered systems', () => {
    const pack = validateRulesPack(
      validRulesPack({
        systemId: 'experimental-system',
        records: [
          record('creature:goblin', {
            systemId: 'experimental-system',
            kind: 'creature',
            data: { description: 'A small green humanoid.' },
          }),
        ],
      }),
    );
    expect(pack.records[0].systemId).toBe('experimental-system');
  });

  it('rejects user-private packs at shippable boundaries', () => {
    const pack = validateRulesPack(
      validRulesPack({ licenseClass: 'user-private' }),
    );
    const policy = evaluateRulesPackPolicy(pack.meta.license);
    expect(policy.shippable).toBe(false);
    expect(policy.reasons.join(' ')).toContain('user-private');
    expect(() => assertShippableRulesPack(pack.meta.license)).toThrow(
      RulesPackError,
    );
  });
});

// Inline abbreviated stat blocks (eshyra-4a7.4) ride a dedicated `stat-block`
// kind whose schema is permissive where these blocks diverge from a full
// creature: hit points may be derived/textual and the challenge rating is
// optional. The strict `creature` schema is unchanged.
describe('stat-block kind validation (dnd5e-srd)', () => {
  function statBlockRecord(
    data: Record<string, unknown>,
    keySuffix = 'avatar-of-death',
  ): RulesRecord {
    return record(`stat-block:${keySuffix}`, {
      kind: 'stat-block',
      name: 'Avatar of Death',
      data,
    });
  }

  const abilityScores = {
    strength: 16,
    dexterity: 16,
    constitution: 16,
    intelligence: 16,
    wisdom: 16,
    charisma: 16,
  };

  it('accepts a derived (special) hit-point block with no challenge rating', () => {
    const pack = validRulesPack({
      records: [
        statBlockRecord({
          size: 'Medium',
          type: 'undead',
          alignment: 'neutral evil',
          armorClass: 20,
          hitPoints: { special: 'half the hit point maximum of its summoner' },
          speed: { walk: 60, fly: 60 },
          abilityScores,
          inlineSource: { containingItem: 'Deck of Many Things', page: 218 },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).not.toThrow();
  });

  it('accepts a fixed value+formula hit-point block', () => {
    const pack = validRulesPack({
      records: [
        statBlockRecord(
          {
            size: 'Large',
            type: 'beast',
            alignment: 'unaligned',
            armorClass: 11,
            hitPoints: { value: 19, formula: '3d10 + 3' },
            speed: { walk: 30, fly: 60 },
            abilityScores,
            inlineSource: {
              containingItem: 'Figurine of Wondrous Power',
              page: 222,
            },
          },
          'giant-fly',
        ),
      ],
    });
    expect(() => validateRulesPack(pack)).not.toThrow();
  });

  it('rejects a stat block whose hitPoints carries none of value/formula/special', () => {
    const pack = validRulesPack({
      records: [
        statBlockRecord({
          size: 'Medium',
          type: 'undead',
          alignment: 'neutral evil',
          armorClass: 20,
          hitPoints: {},
          speed: { walk: 60 },
          abilityScores,
          inlineSource: { containingItem: 'Deck of Many Things', page: 218 },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(/hitPoints/);
  });

  it('rejects a stat block missing its inlineSource provenance', () => {
    const pack = validRulesPack({
      records: [
        statBlockRecord({
          size: 'Medium',
          type: 'undead',
          alignment: 'neutral evil',
          armorClass: 20,
          hitPoints: { value: 10 },
          speed: { walk: 60 },
          abilityScores,
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(/inlineSource/);
  });

  it('accepts a magic item that references an inline stat block via statBlockRefs', () => {
    const pack = validRulesPack({
      records: [
        record('magic-item:deck-of-many-things', {
          kind: 'magic-item',
          name: 'Deck of Many Things',
          data: {
            itemType: 'Wondrous item',
            rarity: 'legendary',
            requiresAttunement: false,
            description: 'A deck of ivory or vellum cards.',
            statBlockRefs: ['stat-block:avatar-of-death'],
          },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).not.toThrow();
  });
});

describe('class/subclass/feature progression fields (dnd5e-srd, eshyra-4a7.6)', () => {
  const baseClassData = {
    hitDie: 12,
    primaryAbilities: ['Strength'],
    savingThrowProficiencies: ['Strength', 'Constitution'],
    armorProficiencies: ['Light armor', 'medium armor', 'shields'],
    weaponProficiencies: ['Simple weapons', 'martial weapons'],
  };
  const classRecord = (data: Record<string, unknown>): RulesRecord =>
    record('class:barbarian', { kind: 'class', name: 'Barbarian', data });

  it('accepts the full set of optional class options/progression fields', () => {
    const pack = validRulesPack({
      records: [
        classRecord({
          ...baseClassData,
          toolProficiencies: ['Herbalism kit'],
          toolProficiencyChoices: [
            { text: 'Three musical instruments of your choice', choose: 3 },
          ],
          skillChoices: [
            { text: 'Choose two from A, B', choose: 2, from: ['A', 'B'] },
            { text: 'Choose any three', any: true, choose: 3 },
          ],
          startingEquipment: {
            text: '• (a) a greataxe or (b) any martial melee weapon',
            entries: ['(a) a greataxe or (b) any martial melee weapon'],
          },
          proficiencyNotes: [
            { field: 'armorProficiencies', text: 'no metal armor' },
          ],
          progressionTableRef: 'table:the-barbarian',
          features: ['feature:barbarian:rage'],
          progression: [
            {
              level: 1,
              proficiencyBonus: '+2',
              features: [
                { name: 'Rage', ref: 'feature:barbarian:rage' },
                { name: 'Action Surge', detail: 'two uses' },
              ],
              resources: { rages: 2, rageDamage: '+2' },
              spellcasting: { cantripsKnown: 3, slots: { '1': 2 } },
            },
            { level: 20, proficiencyBonus: '+6', resources: { rages: null } },
          ],
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).not.toThrow();
  });

  it('rejects a progression row missing the required level', () => {
    const pack = validRulesPack({
      records: [
        classRecord({
          ...baseClassData,
          progression: [{ proficiencyBonus: '+2' }],
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(/level/);
  });

  it('rejects a skill choice entry without verbatim text', () => {
    const pack = validRulesPack({
      records: [
        classRecord({ ...baseClassData, skillChoices: [{ choose: 2 }] }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(/text/);
  });

  it('rejects a proficiency note missing its field', () => {
    const pack = validRulesPack({
      records: [
        classRecord({
          ...baseClassData,
          proficiencyNotes: [{ text: 'no metal armor' }],
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(/field/);
  });

  it('accepts subclass spellTableRefs/progressionTableRefs and feature tableRefs', () => {
    const pack = validRulesPack({
      records: [
        record('subclass:life-domain', {
          kind: 'subclass',
          name: 'Life Domain',
          data: {
            parentClass: 'class:cleric',
            description: 'A domain of healing.',
            features: ['feature:life-domain:disciple-of-life'],
            spellTableRefs: ['table:life-domain-spells'],
            progressionTableRefs: [],
          },
        }),
        record('feature:cleric:destroy-undead', {
          kind: 'feature',
          name: 'Destroy Undead',
          data: {
            source: 'class:cleric',
            level: 5,
            description: 'Destroys undead as shown in the table.',
            tableRefs: ['table:destroy-undead'],
          },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).not.toThrow();
  });
});
