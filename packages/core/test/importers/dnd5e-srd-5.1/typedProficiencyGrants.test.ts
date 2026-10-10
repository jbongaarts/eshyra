import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  typedProficiencyEffectFromText,
  typeProficiencyGrant,
} from '../../../scripts/importers/dnd5e-srd-5.1/mechanicsProjections.js';
import { validateRecordKindSchema } from '../../../src/rules/kindSchemas.js';
import type { RulesRecord } from '../../../src/rules/types.js';

const PACK_RECORDS_URL = new URL(
  '../../../data/rules-packs/rules__dnd5e-srd-5.1/records.json',
  import.meta.url,
);

function loadPackRecords(): RulesRecord[] {
  const parsed = JSON.parse(readFileSync(PACK_RECORDS_URL, 'utf8')) as
    | RulesRecord[]
    | { records: RulesRecord[] };
  return Array.isArray(parsed) ? parsed : parsed.records;
}

function recordByKey(records: RulesRecord[], key: string): RulesRecord {
  const found = records.find((record) => record.key === key);
  if (found === undefined) throw new Error(`missing pack record ${key}`);
  return found;
}

/** Every `{kind:'proficiency'}` effect on a record, feature or option level. */
function proficiencyEffectsOf(
  record: RulesRecord,
): { where: string; effect: Record<string, unknown> }[] {
  const out: { where: string; effect: Record<string, unknown> }[] = [];
  const data = record.data as Record<string, unknown>;
  const mechanics = data.mechanics as
    | { effects?: Record<string, unknown>[] }
    | undefined;
  for (const effect of mechanics?.effects ?? []) {
    if (effect.kind === 'proficiency') {
      out.push({ where: record.key, effect });
    }
  }
  const choices = (data.choices ?? []) as {
    id: string;
    options?: {
      id: string;
      mechanics?: { effects: Record<string, unknown>[] };
    }[];
  }[];
  for (const choice of choices) {
    for (const option of choice.options ?? []) {
      for (const effect of option.mechanics?.effects ?? []) {
        out.push({ where: `${record.key}#${option.id}`, effect });
      }
    }
  }
  return out;
}

describe('typeProficiencyGrant (eshyra-olc5.7.1)', () => {
  it.each([
    ['Wisdom saving throws', { savingThrows: ['wisdom'] }],
    ['the Wisdom saving throws', { savingThrows: ['wisdom'] }],
    ['Strength saving throws', { savingThrows: ['strength'] }],
    [
      'the Deception and Persuasion skills',
      { skills: ['Deception', 'Persuasion'] },
    ],
    ['the Perception skill', { skills: ['Perception'] }],
    ['the Intimidation skill', { skills: ['Intimidation'] }],
    [
      'Animal Handling, Sleight of Hand, and Stealth skills',
      { skills: ['Animal Handling', 'Sleight of Hand', 'Stealth'] },
    ],
    ['heavy armor', { armor: ['heavy armor'] }],
    ['light armor and shields', { armor: ['light armor', 'shields'] }],
    [
      'light armor, medium armor, and shields',
      { armor: ['light armor', 'medium armor', 'shields'] },
    ],
    [
      'deception and persuasion skills',
      { skills: ['Deception', 'Persuasion'] },
    ],
  ])('types the whole phrase %j', (grant, expected) => {
    expect(typeProficiencyGrant(grant)).toEqual(expected);
  });

  it.each([
    'three skills of your choice',
    'two skills of your choice',
    'the battleaxe, handaxe, light hammer, and warhammer',
    "the artisan's tools of your choice: smith's tools, brewer's supplies, or mason's tools",
    "thieves' tools",
    'speak, read, and write Dwarvish',
    'Wisdom saving throws if you are not wearing armor',
    'the Athletics and Frostbite skills',
    'Deception and Deception skills',
    'light armor and weapons',
    'Wisdom and Charisma saving throws',
    'this armor',
    '',
  ])('leaves %j untyped (fail closed)', (grant) => {
    expect(typeProficiencyGrant(grant)).toEqual({});
  });

  it('types an option body only when its own proficiency grant types', () => {
    expect(
      typedProficiencyEffectFromText(
        'You gain proficiency in the Deception and Persuasion skills.',
      ),
    ).toEqual({
      kind: 'proficiency',
      grant: 'the Deception and Persuasion skills',
      skills: ['Deception', 'Persuasion'],
    });
    expect(
      typedProficiencyEffectFromText(
        'You are proficient with it while you wield it.',
      ),
    ).toBeUndefined();
    expect(
      typedProficiencyEffectFromText(
        'You have proficiency with the battleaxe, handaxe, light hammer, and warhammer.',
      ),
    ).toBeUndefined();
  });
});

describe('typed proficiency grants on the committed pack (eshyra-olc5.7.1)', () => {
  const records = loadPackRecords();

  it('every typed field appears in its own grant text, or the grant is a scope', () => {
    let typedCount = 0;
    for (const record of records) {
      for (const { where, effect } of proficiencyEffectsOf(record)) {
        const grant = typeof effect.grant === 'string' ? effect.grant : '';
        const lower = grant.toLowerCase();
        const skills = (effect.skills ?? []) as string[];
        const armor = (effect.armor ?? []) as string[];
        const saves = (effect.savingThrows ?? []) as string[];
        if (skills.length + armor.length + saves.length === 0) continue;
        typedCount += 1;
        for (const skill of skills) {
          expect(lower, `${where} skill ${skill}`).toContain(
            skill.toLowerCase(),
          );
        }
        for (const category of armor) {
          expect(lower, `${where} armor ${category}`).toContain(category);
        }
        if (effect.scope !== 'all-saving-throws') {
          for (const ability of saves) {
            expect(lower, `${where} save ${ability}`).toContain(ability);
          }
        }
      }
    }
    expect(typedCount).toBeGreaterThan(0);
  });

  it('carries exactly the expected typed values on the four named records', () => {
    const slipperyMind = proficiencyEffectsOf(
      recordByKey(records, 'feature:rogue:slippery-mind'),
    );
    expect(slipperyMind.map((e) => e.effect)).toEqual([
      {
        kind: 'proficiency',
        grant: 'Wisdom saving throws',
        savingThrows: ['wisdom'],
      },
    ]);

    const diamondSoul = proficiencyEffectsOf(
      recordByKey(records, 'feature:monk:diamond-soul'),
    );
    expect(diamondSoul.map((e) => e.effect)).toEqual([
      {
        kind: 'proficiency',
        scope: 'all-saving-throws',
        savingThrows: [
          'strength',
          'dexterity',
          'constitution',
          'intelligence',
          'wisdom',
          'charisma',
        ],
      },
    ]);

    const lifeDomain = proficiencyEffectsOf(
      recordByKey(records, 'feature:life-domain:bonus-proficiency'),
    );
    expect(lifeDomain.map((e) => e.effect)).toEqual([
      { kind: 'proficiency', grant: 'heavy armor', armor: ['heavy armor'] },
    ]);

    const beguiling = proficiencyEffectsOf(
      recordByKey(records, 'feature:warlock:eldritch-invocations'),
    ).filter((e) =>
      e.where.endsWith('#eldritch-invocation:beguiling-influence'),
    );
    expect(beguiling.map((e) => e.effect)).toEqual([
      {
        kind: 'proficiency',
        grant: 'the Deception and Persuasion skills',
        skills: ['Deception', 'Persuasion'],
      },
    ]);
  });
});

describe('kindSchemas typed proficiency validation (eshyra-olc5.7.1)', () => {
  function withEffect(
    record: RulesRecord,
    effect: Record<string, unknown>,
  ): RulesRecord {
    const data = structuredClone(record.data) as Record<string, unknown>;
    data.mechanics = { effects: [effect] };
    return { ...record, data } as RulesRecord;
  }

  it('accepts the committed Slippery Mind record', () => {
    const record = recordByKey(
      loadPackRecords(),
      'feature:rogue:slippery-mind',
    );
    expect(() =>
      validateRecordKindSchema(record, 'feature:rogue:slippery-mind'),
    ).not.toThrow();
  });

  it.each([
    [{ kind: 'proficiency', grant: 'x', savingThrows: ['luck'] }, 'ability'],
    [{ kind: 'proficiency', grant: 'x', skills: ['Frostbite'] }, 'skill'],
    [{ kind: 'proficiency', grant: 'x', armor: ['plate armor'] }, 'armor'],
    [
      { kind: 'proficiency', grant: 'x', skills: ['Stealth', 'Stealth'] },
      'duplicate',
    ],
    [{ kind: 'proficiency', grant: 'x', savingThrows: [] }, 'empty'],
  ])('rejects an unknown or malformed typed value (%s)', (effect) => {
    const record = withEffect(
      recordByKey(loadPackRecords(), 'feature:rogue:slippery-mind'),
      effect,
    );
    expect(() =>
      validateRecordKindSchema(record, 'feature:rogue:slippery-mind'),
    ).toThrow();
  });

  it('rejects a non-proficiency effect on an option', () => {
    const records = loadPackRecords();
    const record = structuredClone(
      recordByKey(records, 'feature:warlock:eldritch-invocations'),
    );
    const data = record.data as unknown as {
      choices: { options: { id: string; mechanics?: unknown }[] }[];
    };
    const option = data.choices
      .flatMap((choice) => choice.options)
      .find((o) => o.id === 'eldritch-invocation:beguiling-influence');
    if (option === undefined) throw new Error('missing option');
    option.mechanics = { effects: [{ kind: 'healing', amountFormula: '1' }] };
    expect(() =>
      validateRecordKindSchema(record, 'feature:warlock:eldritch-invocations'),
    ).toThrow(/proficiency/);
  });
});
