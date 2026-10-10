import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveFeatureMechanics } from '../../../scripts/importers/dnd5e-srd-5.1/mechanicsProjections.js';
import { validateRecordKindSchema } from '../../../src/rules/kindSchemas.js';
import type { RulesRecord } from '../../../src/rules/types.js';

// eshyra-o9bd.19.3.2.1: feature/trait `mechanics.resources` is a source-fidelity
// projection. Each entry must be backed by a governing SRD sentence that names
// the rest that restores or limits the feature (never a rest that appears only
// as an occasion). The table below is the exact regression oracle for the
// findings F-03/F-04/F-05/F-06/F-24 over the committed pack.

type ResourceEntry = Record<string, unknown>;
type PackRecord = {
  key: string;
  kind: string;
  data: Record<string, unknown>;
};

const pack = JSON.parse(
  readFileSync(
    join(
      process.cwd(),
      'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json',
    ),
    'utf8',
  ),
) as { records?: PackRecord[] } | PackRecord[];
const records: PackRecord[] = Array.isArray(pack) ? pack : (pack.records ?? []);
const byKey = new Map(records.map((record) => [record.key, record]));

// Every object in the pack that owns a `mechanics` block (a feature record, a
// trait, or a background feature), with its printed text.
type Owner = { recordKey: string; owner: Record<string, unknown> };
const owners: Owner[] = [];
const collectOwners = (node: unknown, recordKey: string): void => {
  if (Array.isArray(node)) {
    for (const item of node) collectOwners(item, recordKey);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const object = node as Record<string, unknown>;
  if (object.mechanics !== undefined && typeof object.mechanics === 'object') {
    owners.push({ recordKey, owner: object });
  }
  for (const value of Object.values(object)) collectOwners(value, recordKey);
};
for (const record of records) collectOwners(record.data, record.key);

const printedText = (owner: Record<string, unknown>): string => {
  const parts: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node === 'string') parts.push(node);
    else if (Array.isArray(node)) node.forEach(visit);
    else if (node !== null && typeof node === 'object') {
      for (const [field, value] of Object.entries(node)) {
        if (field !== 'mechanics' && field !== 'provenance') visit(value);
      }
    }
  };
  for (const field of ['description', 'text', 'sections'] as const) {
    visit(owner[field]);
  }
  return parts.join(' ').replace(/’/g, "'");
};

const resourcesOf = (
  owner: Record<string, unknown>,
): ResourceEntry[] | undefined =>
  (owner.mechanics as { resources?: ResourceEntry[] } | undefined)?.resources;

const EXPECTED: ReadonlyArray<{
  key: string;
  trait?: string;
  resources: ResourceEntry[];
}> = [
  { key: 'feature:barbarian:rage', resources: [{ reset: 'long-rest' }] },
  {
    key: 'feature:bard:bardic-inspiration',
    resources: [
      { uses: 'charisma-modifier', usesMinimum: 1, reset: 'long-rest' },
    ],
  },
  {
    key: 'feature:bard:font-of-inspiration',
    resources: [
      {
        reset: 'short-or-long-rest',
        appliesTo: 'feature:bard:bardic-inspiration',
      },
    ],
  },
  ...['bard', 'cleric', 'druid', 'paladin', 'ranger', 'sorcerer', 'wizard'].map(
    (caster) => ({
      key: `feature:${caster}:spellcasting`,
      resources: [{ resource: 'spell-slots', reset: 'long-rest' }],
    }),
  ),
  {
    key: 'feature:warlock:pact-magic',
    resources: [{ resource: 'spell-slots', reset: 'short-or-long-rest' }],
  },
  {
    key: 'feature:circle-of-the-land:natural-recovery',
    resources: [{ uses: 1, reset: 'long-rest' }],
  },
  {
    key: 'feature:cleric:channel-divinity',
    resources: [
      {
        usesByLevel: [
          { level: 2, uses: 1 },
          { level: 6, uses: 2 },
          { level: 18, uses: 3 },
        ],
        reset: 'short-or-long-rest',
      },
    ],
  },
  {
    key: 'feature:paladin:sacred-oath',
    resources: [{ uses: 1, reset: 'short-or-long-rest' }],
  },
  {
    key: 'feature:druid:wild-shape',
    resources: [{ uses: 2, reset: 'short-or-long-rest' }],
  },
  {
    key: 'feature:fighter:action-surge',
    resources: [
      {
        usesByLevel: [
          { level: 2, uses: 1 },
          { level: 17, uses: 2 },
        ],
        reset: 'short-or-long-rest',
      },
    ],
  },
  {
    key: 'feature:fighter:indomitable',
    resources: [
      {
        usesByLevel: [
          { level: 9, uses: 1 },
          { level: 13, uses: 2 },
          { level: 17, uses: 3 },
        ],
        reset: 'long-rest',
      },
    ],
  },
  {
    key: 'feature:fighter:second-wind',
    resources: [{ uses: 1, reset: 'short-or-long-rest' }],
  },
  {
    key: 'feature:rogue:stroke-of-luck',
    resources: [{ uses: 1, reset: 'short-or-long-rest' }],
  },
  {
    key: 'feature:the-fiend:dark-ones-own-luck',
    resources: [{ uses: 1, reset: 'short-or-long-rest' }],
  },
  {
    key: 'feature:oath-of-devotion:holy-nimbus',
    resources: [{ uses: 1, reset: 'long-rest' }],
  },
  {
    key: 'feature:the-fiend:hurl-through-hell',
    resources: [{ uses: 1, reset: 'long-rest' }],
  },
  {
    key: 'feature:warlock:eldritch-master',
    resources: [{ uses: 1, reset: 'long-rest' }],
  },
  {
    key: 'feature:warlock:mystic-arcanum',
    resources: [{ uses: 1, reset: 'long-rest' }],
  },
  {
    key: 'feature:way-of-the-open-hand:wholeness-of-body',
    resources: [{ uses: 1, reset: 'long-rest' }],
  },
  { key: 'feature:monk:ki', resources: [{ reset: 'short-or-long-rest' }] },
  {
    key: 'feature:paladin:cleansing-touch',
    resources: [
      { uses: 'charisma-modifier', usesMinimum: 1, reset: 'long-rest' },
    ],
  },
  {
    key: 'feature:paladin:divine-sense',
    resources: [{ uses: '1-plus-charisma-modifier', reset: 'long-rest' }],
  },
  { key: 'feature:paladin:lay-on-hands', resources: [{ reset: 'long-rest' }] },
  {
    key: 'feature:wizard:arcane-recovery',
    resources: [{ uses: 1, reset: 'day' }],
  },
  {
    key: 'feature:wizard:signature-spells',
    resources: [{ uses: 1, reset: 'short-or-long-rest' }],
  },
  {
    key: 'ancestry:dragonborn',
    trait: 'Breath Weapon',
    resources: [{ uses: 1, reset: 'short-or-long-rest' }],
  },
  {
    key: 'ancestry:half-orc',
    trait: 'Relentless Endurance',
    resources: [{ uses: 1, reset: 'long-rest' }],
  },
  {
    key: 'ancestry:tiefling',
    trait: 'Infernal Legacy',
    resources: [{ reset: 'long-rest' }],
  },
];

// Phantom resources (F-06): these carried a keyword-derived resource before
// this change and must not carry one now.
const REMOVED: readonly { key: string; trait?: string }[] = [
  { key: 'feature:barbarian:relentless-rage' },
  { key: 'feature:bard:song-of-rest' },
  { key: 'feature:school-of-evocation:overchannel' },
  { key: 'feature:sorcerer:sorcerous-restoration' },
  { key: 'feature:the-fiend:fiendish-resilience' },
  { key: 'feature:warlock:pact-boon' },
  { key: 'feature:way-of-the-open-hand:tranquility' },
  { key: 'feature:cleric:divine-intervention' },
];

const ownerFor = (key: string, trait?: string): Record<string, unknown> => {
  const record = byKey.get(key);
  if (record === undefined) throw new Error(`missing record ${key}`);
  if (trait === undefined) return record.data;
  const traits = record.data.traits as { name: string }[] | undefined;
  const found = traits?.find((item) => item.name === trait);
  if (found === undefined) throw new Error(`missing trait ${trait} on ${key}`);
  return found as unknown as Record<string, unknown>;
};

describe('feature resource projection (eshyra-o9bd.19.3.2.1)', () => {
  it('projects exactly the EXPECTED resources over the committed pack (F-03/F-04/F-05/F-06/F-24)', () => {
    for (const { key, trait, resources } of EXPECTED) {
      expect(
        resourcesOf(ownerFor(key, trait)),
        `${key}${trait ? `:${trait}` : ''}`,
      ).toEqual(resources);
    }
  });

  it('removes every phantom resource on the REMOVE list', () => {
    for (const { key, trait } of REMOVED) {
      expect(resourcesOf(ownerFor(key, trait)), key).toBeUndefined();
    }
  });

  it('emits resources only on the EXPECTED set (no unlisted resource records)', () => {
    const expectedOwners = new Set(
      EXPECTED.map(({ key, trait }) => `${key}|${trait ?? ''}`),
    );
    const actual = owners
      .filter(({ owner }) => resourcesOf(owner) !== undefined)
      .map(({ recordKey, owner }) => {
        const trait = (owner as { name?: unknown }).name;
        return `${recordKey}|${recordKey.startsWith('ancestry:') ? String(trait) : ''}`;
      });
    expect(new Set(actual)).toEqual(expectedOwners);
  });

  it('keeps every reset backed by a governing sentence naming that rest (generalized invariant)', () => {
    // Independent predicate: a sentence that finishes/completes/takes the
    // named rest AND states a use, regain, replenishment, or unavailability.
    // "during a short rest", "at the end of a long rest", and "when you finish
    // a short rest, the DC resets" do not satisfy it.
    const restWordByReset: Readonly<Record<string, string>> = {
      'short-rest': 'short',
      'long-rest': 'long',
      'short-or-long-rest': 'short or long',
    };
    for (const { owner, recordKey } of owners) {
      const entries = resourcesOf(owner);
      if (entries === undefined) continue;
      const sentences = printedText(owner).split(/(?<=[.!?])\s+/);
      for (const entry of entries) {
        const reset = String(entry.reset);
        const governed =
          reset === 'day'
            ? sentences.some((s) => /\bonce per day\b/i.test(s))
            : sentences.some((s) => {
                const rest = restWordByReset[reset];
                return (
                  rest !== undefined &&
                  new RegExp(
                    `\\b(?:finish|complete|take)s? (?:a|an) ${rest} rests?\\b`,
                    'i',
                  ).test(s) &&
                  /\b(?:again|expended|regain|replenish\w*|unavailable|use)\b/i.test(
                    s,
                  )
                );
              });
        expect(
          governed,
          `${recordKey} reset ${reset}: ${printedText(owner).slice(0, 120)}`,
        ).toBe(true);
      }
    }
  });

  it('every appliesTo resolves to an emitted feature record', () => {
    for (const { owner, recordKey } of owners) {
      for (const entry of resourcesOf(owner) ?? []) {
        if (entry.appliesTo !== undefined) {
          expect(
            byKey.has(String(entry.appliesTo)),
            `${recordKey} appliesTo`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('feature resource grammar (eshyra-o9bd.19.3.2.1)', () => {
  const derive = (text: string, level?: number) =>
    deriveFeatureMechanics(text, undefined, { level }).resources;

  it('emits a resource from each governing relation', () => {
    expect(
      derive('You must finish a long rest before you can rage again.'),
    ).toEqual([{ reset: 'long-rest' }]);
    expect(
      derive(
        'Once you use this feature, you can’t use it again until you finish a short or long rest.',
      ),
    ).toEqual([{ uses: 1, reset: 'short-or-long-rest' }]);
    expect(
      derive(
        'Once per day when you finish a short rest, you can choose expended spell slots to recover.',
      ),
    ).toEqual([{ uses: 1, reset: 'day' }]);
    expect(
      derive(
        'You regain all expended spell slots when you finish a long rest.',
      ),
    ).toEqual([{ resource: 'spell-slots', reset: 'long-rest' }]);
    expect(
      derive(
        'When you finish a short or long rest, you regain your expended uses.',
      ),
    ).toEqual([{ reset: 'short-or-long-rest' }]);
    expect(
      derive(
        'You have a pool of healing power that replenishes when you take a long rest.',
      ),
    ).toEqual([{ reset: 'long-rest' }]);
  });

  it('projects no resource for occasion-only or counter-only rest mentions', () => {
    for (const text of [
      'This ability can be done during a short rest.',
      'At the end of a long rest, you gain the effect of a sanctuary spell.',
      'Some effect lasts during a short rest.',
      'When you finish a short rest, the DC resets to 10.',
      'You regain 4 expended sorcery points whenever you finish a short rest.',
      'If you use this feature again before you finish a long rest, you take 2d12 necrotic damage.',
      'If your deity intervenes, you can’t use this feature again for 7 days. Otherwise, you can use it again after you finish a long rest.',
    ]) {
      expect(derive(text), text).toBeUndefined();
    }
  });

  it('projects the printed use counts and scaling from the feature level', () => {
    expect(
      derive(
        'You can use this feature a number of times equal to 1 + your Charisma modifier. When you finish a long rest, you regain all expended uses.',
      ),
    ).toEqual([{ uses: '1-plus-charisma-modifier', reset: 'long-rest' }]);
    expect(
      derive(
        'You must then finish a short or long rest to use your Channel Divinity again. Beginning at 6th level, you can use your Channel Divinity twice between rests, and beginning at 18th level, you can use it three times between rests.',
        2,
      ),
    ).toEqual([
      {
        usesByLevel: [
          { level: 2, uses: 1 },
          { level: 6, uses: 2 },
          { level: 18, uses: 3 },
        ],
        reset: 'short-or-long-rest',
      },
    ]);
  });

  it('projects the printed ki save DC as a saveDcFormula', () => {
    expect(
      deriveFeatureMechanics(
        'The saving throw DC is calculated as follows: Ki save DC = 8 + your proficiency bonus + your Wisdom modifier Flurry of Blows',
      ).effects,
    ).toEqual([
      {
        kind: 'saveDcFormula',
        base: 8,
        ability: 'wisdom',
        addProficiencyBonus: true,
      },
    ]);
  });
});

describe('feature resource schema (fail closed)', () => {
  const featureWith = (resources: unknown[]): RulesRecord =>
    ({
      systemId: 'dnd5e-srd',
      kind: 'feature',
      key: 'feature:test:resource',
      name: 'Resource Test',
      data: {
        source: 'class:test',
        level: 1,
        description: 'Test feature.',
        mechanics: { resources },
      },
    }) as RulesRecord;

  it('accepts the emitted resource shapes', () => {
    expect(() =>
      validateRecordKindSchema(
        featureWith([
          { uses: 'charisma-modifier', usesMinimum: 1, reset: 'long-rest' },
          { uses: '1-plus-charisma-modifier', reset: 'long-rest' },
          {
            usesByLevel: [
              { level: 2, uses: 1 },
              { level: 6, uses: 2 },
            ],
            reset: 'short-or-long-rest',
          },
          { resource: 'spell-slots', reset: 'day' },
          { reset: 'long-rest', appliesTo: 'feature:test:resource' },
        ]),
        'records[0]',
      ),
    ).not.toThrow();
  });

  it('rejects unsupported reset, field, use, and progression shapes', () => {
    for (const bad of [
      { reset: 'short-rest-or-day' },
      { reset: 'long-rest', pool: 'x' },
      { reset: 'long-rest', uses: 0 },
      { reset: 'long-rest', uses: 'strength' },
      { reset: 'long-rest', resource: 'hit-dice' },
      { reset: 'long-rest', appliesTo: 'spell:magic-missile' },
      { reset: 'long-rest', uses: 1, usesByLevel: [{ level: 2, uses: 1 }] },
      {
        reset: 'long-rest',
        usesByLevel: [
          { level: 6, uses: 2 },
          { level: 2, uses: 1 },
        ],
      },
      { reset: 'long-rest', usesMinimum: 1, uses: 2 },
    ]) {
      expect(
        () => validateRecordKindSchema(featureWith([bad]), 'records[0]'),
        JSON.stringify(bad),
      ).toThrow();
    }
  });
});
