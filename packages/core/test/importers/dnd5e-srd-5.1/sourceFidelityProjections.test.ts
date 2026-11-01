import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  deriveCreatureEntryMechanics,
  deriveFeatureMechanics,
  deriveSpellMechanics,
} from '../../../scripts/importers/dnd5e-srd-5.1/mechanicsProjections.js';
import type { SpellExtraction } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
import type { RulesRecord } from '../../../src/rules/types.js';

/**
 * eshyra-o9bd.16.7.1 (audit eshyra-o9bd.16.1, L1-F3/F4/F5): retained typed
 * projections must state the SRD truthfully in the existing vocabulary or be
 * omitted. Witnesses are quoted from SRD 5.1 (pages in each test); the
 * invariants run over the whole generated pack.
 */

type Json = Record<string, unknown>;

const records = JSON.parse(
  readFileSync(
    new URL(
      '../../../data/rules-packs/rules__dnd5e-srd-5.1/records.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as RulesRecord[];

const byKey = (key: string): RulesRecord => {
  const record = records.find((candidate) => candidate.key === key);
  if (record === undefined) throw new Error(`${key} missing from pack`);
  return record;
};

const entriesOf = (key: string): Json[] => {
  const data = byKey(key).data as Json;
  return ['traits', 'actions', 'reactions', 'legendaryActions'].flatMap(
    (section) => (data[section] as Json[] | undefined) ?? [],
  );
};

const entry = (key: string, name: string): Json => {
  const found = entriesOf(key).find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`${key} has no entry ${name}`);
  return found;
};

const mechanicsOf = (value: Json): Json => value.mechanics as Json;
const hitDamageOf = (value: Json): Json[] =>
  ((mechanicsOf(value).attacks as Json[])[0].hitDamage as Json[]) ?? [];
const savesOf = (value: Json): Json[] =>
  (mechanicsOf(value).saves as Json[] | undefined) ?? [];

const damageKey = (term: Json): string => `${term.dice}|${term.type}`;

/** The damage terms printed after the save clause in the Hit sentence. */
function sentenceSaveOwnedTerms(text: string): string[] {
  const hit = /Hit:([^.]*)\./.exec(text)?.[1] ?? '';
  const save =
    /\bmust (?:succeed on|make)(?: on)? a DC \d+ [A-Z][a-z]+ saving throw\b/.exec(
      hit,
    );
  if (save === null) return [];
  return [
    ...hit
      .slice(save.index)
      .matchAll(/\(([^)]*\d+d\d+[^)]*)\)\s+([a-z]+)\s+damage/g),
  ].map((match) => `${match[1].replace(/\s+/g, ' ')}|${match[2]}`);
}

describe('L1-F5: save-governed damage in a Hit sentence belongs to the save', () => {
  const cohort: [string, string][] = [
    ['creature:assassin', 'Shortsword'],
    ['creature:assassin', 'Light Crossbow'],
    ['creature:giant-centipede', 'Bite'],
    ['creature:giant-poisonous-snake', 'Bite'],
    ['creature:giant-scorpion', 'Sting'],
    ['creature:giant-spider', 'Bite'],
    ['creature:giant-wasp', 'Sting'],
    ['creature:giant-wolf-spider', 'Bite'],
    ['creature:guardian-naga', 'Bite'],
    ['creature:imp', 'Sting (Bite in Beast Form)'],
    ['creature:phase-spider', 'Bite'],
    ['creature:purple-worm', 'Tail Stinger'],
    ['creature:quasit', 'Claws (Bite in Beast Form)'],
    ['creature:spirit-naga', 'Bite'],
  ];

  it('moves the printed save damage off hitDamage onto saves[0].damageOnFailure, for the full audited cohort', () => {
    for (const [key, name] of cohort) {
      const value = entry(key, name);
      const owned = sentenceSaveOwnedTerms(String(value.text));
      expect(owned.length, `${key} ${name}`).toBeGreaterThan(0);
      expect(hitDamageOf(value).map(damageKey), `${key} ${name}`).not.toEqual(
        expect.arrayContaining(owned),
      );
      for (const term of owned) {
        expect(hitDamageOf(value).map(damageKey)).not.toContain(term);
      }
      const [save] = savesOf(value);
      expect((save.damageOnFailure as Json[]).map(damageKey)).toEqual(owned);
      const halves = /half as much damage on a successful/.test(
        String(value.text),
      );
      expect(save.damageOnSuccess, `${key} ${name}`).toBe(
        halves ? 'half' : undefined,
      );
    }
  });

  it('holds over every creature entry in the pack, not just the audited cohort', () => {
    let checked = 0;
    for (const record of records) {
      if (record.kind !== 'creature') continue;
      for (const value of entriesOf(record.key)) {
        const attacks = (value.mechanics as Json | undefined)?.attacks;
        if (attacks === undefined) continue;
        const owned = sentenceSaveOwnedTerms(String(value.text));
        if (owned.length === 0) continue;
        checked += 1;
        expect(
          hitDamageOf(value)
            .map(damageKey)
            .filter((k) => owned.includes(k)),
          `${record.key} ${String(value.name)}`,
        ).toEqual([]);
        expect(
          (savesOf(value)[0].damageOnFailure as Json[]).map(damageKey),
          `${record.key} ${String(value.name)}`,
        ).toEqual(owned);
        expect(
          ((mechanicsOf(value).damage as Json[] | undefined) ?? [])
            .map(damageKey)
            .filter((k) => owned.includes(k)),
        ).toEqual([]);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(cohort.length);
  });

  it('Giant Centipede Bite (SRD p. 374): piercing is the hit, poison is owned by a save with no damage on success', () => {
    const bite = entry('creature:giant-centipede', 'Bite');
    expect(hitDamageOf(bite)).toEqual([
      { average: 4, dice: '1d4 + 2', type: 'piercing' },
    ]);
    expect(savesOf(bite)).toEqual([
      {
        ability: 'constitution',
        dc: 11,
        damageOnFailure: [{ average: 10, dice: '3d6', type: 'poison' }],
      },
    ]);
  });

  it('Giant Scorpion Sting (SRD p. 378): the half-on-success branch changes poison only, never the piercing hit', () => {
    const sting = entry('creature:giant-scorpion', 'Sting');
    expect(hitDamageOf(sting)).toEqual([
      { average: 7, dice: '1d10 + 2', type: 'piercing' },
    ]);
    expect(savesOf(sting)).toEqual([
      {
        ability: 'constitution',
        dc: 12,
        damageOnSuccess: 'half',
        damageOnFailure: [{ average: 22, dice: '4d10', type: 'poison' }],
      },
    ]);
  });

  it('keeps flat hit damage as the hit when the save owns the dice damage (Spider, Poisonous Snake)', () => {
    expect(hitDamageOf(entry('creature:spider', 'Bite'))).toEqual([
      { amount: 1, type: 'piercing' },
    ]);
    expect(hitDamageOf(entry('creature:poisonous-snake', 'Bite'))).toEqual([
      { amount: 1, type: 'piercing' },
    ]);
  });

  it('Guardian Naga Spit Poison (SRD p. 234): all damage is save-owned; the attack carries none', () => {
    const spit = entry('creature:guardian-naga', 'Spit Poison');
    expect(mechanicsOf(spit).attacks).toEqual([
      expect.not.objectContaining({ hitDamage: expect.anything() }),
    ]);
    expect(savesOf(spit)[0].damageOnFailure).toEqual([
      { average: 45, dice: '10d8', type: 'poison' },
    ]);
  });

  it('controls: extra on-hit poison plus a separate condition save stays hit damage (Bone Devil, Erinyes, Ettercap, Balor)', () => {
    for (const [key, name, extra] of [
      ['creature:bone-devil', 'Sting', 'poison'],
      ['creature:erinyes', 'Longbow', 'poison'],
      ['creature:ettercap', 'Bite', 'poison'],
      ['creature:balor', 'Whip', 'fire'],
    ] as const) {
      const value = entry(key, name);
      expect(
        hitDamageOf(value).map((term) => term.type),
        key,
      ).toContain(extra);
      expect(savesOf(value)[0].damageOnFailure, key).toBeUndefined();
    }
  });

  it('derives the same routing from the printed text without the pack (grammar unit)', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Bite',
      'Melee Weapon Attack: +4 to hit, reach 5 ft., one creature. Hit: 4 (1d4 + 2) piercing damage, and the target must succeed on a DC 11 Constitution saving throw or take 10 (3d6) poison damage.',
    );
    expect(mechanics.damage).toEqual([
      { average: 4, dice: '1d4 + 2', type: 'piercing' },
    ]);
    expect((mechanics.saves as Json[])[0].damageOnFailure).toEqual([
      { average: 10, dice: '3d6', type: 'poison' },
    ]);
  });
});

describe('L1-F4: an all-damage resistance never swallows a printed exception', () => {
  it('Empty Body (SRD p. 28) "resistance to all damage but force damage" projects no all-damage resistance', () => {
    const emptyBody = byKey('feature:monk:empty-body');
    expect(String((emptyBody.data as Json).description)).toContain(
      'resistance to all damage but force damage',
    );
    expect(JSON.stringify(emptyBody.data)).not.toContain('damageResistance');
  });

  it('rejects any following exception form on the all-damage grammar, and keeps the unqualified positive', () => {
    const effects = (text: string): Json[] =>
      (
        (deriveFeatureMechanics(text).effects as Json[] | undefined) ?? []
      ).filter((effect) => effect.kind === 'damageResistance');
    for (const exception of [
      'but force damage',
      'except force damage',
      'other than force damage',
    ]) {
      expect(
        effects(`You also have resistance to all damage ${exception}.`),
      ).toEqual([]);
    }
    expect(effects('You have resistance to all damage.')).toEqual([
      { kind: 'damageResistance', types: 'all' },
    ]);
  });

  it('controls: Armor of Invulnerability keeps its magical exclusion; Petrified keeps all-damage resistance', () => {
    const armor = JSON.stringify(
      byKey('magic-item:armor-of-invulnerability').data,
    );
    expect(armor).toContain(
      '{"id":"c2-static-armor-invulnerability-resistance","kind":"damageResistance","types":"all","excludes":["magical damage"]}',
    );
    expect(JSON.stringify(byKey('condition:petrified').data)).toContain(
      '{"kind":"damageResistance","subject":"conditioned","damage":"all"}',
    );
  });
});

describe('L1-F3: spell rollModifier subjects are the grammatical subject or the effect is omitted', () => {
  const modifiersOf = (key: string): Json[] =>
    (
      ((byKey(key).data as Json).mechanics as Json | undefined)?.effects as
        | Json[]
        | undefined
    )?.filter((effect) => effect.kind === 'rollModifier') ?? [];

  it('Guiding Bolt (SRD pp. 151-152): the next attack roll AGAINST the target has advantage, with its printed limit', () => {
    expect(modifiersOf('spell:guiding-bolt')).toEqual([
      {
        kind: 'rollModifier',
        subject: 'attackers-against-target',
        mode: 'advantage',
        scope:
          'the next attack roll made against this target before the end of your next turn',
      },
    ]);
  });

  it('Irresistible Dance (SRD p. 158): OTHER creatures have advantage on attack rolls against the target', () => {
    expect(modifiersOf('spell:irresistible-dance')).toEqual([
      {
        kind: 'rollModifier',
        subject: 'attackers-against-target',
        mode: 'advantage',
        scope: 'attack-rolls',
      },
    ]);
  });

  it('Holy Aura (SRD p. 155): the chosen creatures cannot be named in the vocabulary, so nothing is emitted (no caster default from "when you cast this spell")', () => {
    expect(modifiersOf('spell:holy-aura')).toEqual([]);
  });

  it('invariant over the pack: no modifier scope smuggles in a different party clause', () => {
    for (const record of records) {
      if (record.kind !== 'spell') continue;
      for (const effect of modifiersOf(record.key)) {
        expect(String(effect.scope), record.key).not.toMatch(
          /\bother creatures\b|\bhave (?:advantage|disadvantage)\b/,
        );
      }
    }
  });

  it("controls keep their subjects: Dominate x3, Blur, Hunter's Mark, Shocking Grasp, Haste, Resurrection, Vicious Mockery", () => {
    const subjects = (key: string): unknown[] =>
      modifiersOf(key).map((effect) => effect.subject);
    for (const key of [
      'spell:dominate-beast',
      'spell:dominate-monster',
      'spell:dominate-person',
    ]) {
      expect(subjects(key)).toEqual(['target']);
    }
    expect(subjects('spell:blur')).toEqual(['other-creatures']);
    expect(subjects('spell:hunters-mark')).toContain('caster');
    expect(subjects('spell:shocking-grasp')).toEqual(['caster']);
    expect(subjects('spell:haste')).toContain('target');
    expect(subjects('spell:resurrection')).toContain('caster');
    expect(subjects('spell:vicious-mockery')).toEqual(['target']);
  });

  it('grammar units: object-of-preposition and embedded-caster clauses never become the subject', () => {
    const spell = (description: string): SpellExtraction => ({
      name: 'Test Spell',
      level: 1,
      school: 'evocation',
      ritual: false,
      castingTime: '1 action',
      range: '60 feet',
      components: { verbal: true, somatic: true, material: false },
      duration: 'Instantaneous',
      description,
      sourcePage: 1,
    });
    const effects = (description: string): Json[] =>
      (
        (deriveSpellMechanics(spell(description)).effects as
          | Json[]
          | undefined) ?? []
      ).filter((effect) => effect.kind === 'rollModifier');
    expect(
      effects(
        'Creatures of your choice in that radius when you cast this spell glow and have advantage on all saving throws.',
      ),
    ).toEqual([]);
    expect(
      effects(
        'The target takes damage, and the next attack roll made against it has advantage.',
      ),
    ).toEqual([]);
    expect(
      effects(
        'The target takes 1d4 psychic damage and has disadvantage on the next attack roll it makes.',
      ),
    ).toEqual([
      {
        kind: 'rollModifier',
        subject: 'target',
        mode: 'disadvantage',
        scope: 'the next attack roll it makes',
      },
    ]);
  });
});
