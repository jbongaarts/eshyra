/**
 * Creature attack grammar evidence (eshyra-o9bd.19.4.2): Unicode minus in
 * printed dice, parenthetical mode bonuses, mutually exclusive damage modes,
 * and alternate range notation. The invariant predicates below are written
 * independently of the parser: they read the committed pack's printed text and
 * compare it to the projected `attacks[]` / `damage` values.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateRecordKindSchema } from '../../../src/rules/kindSchemas.js';
import type { RulesRecord } from '../../../src/rules/types.js';

const records = JSON.parse(
  readFileSync(
    new URL(
      '../../../data/rules-packs/rules__dnd5e-srd-5.1/records.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as RulesRecord[];

const byKey = new Map(records.map((record) => [record.key, record]));

function recordOf(key: string): RulesRecord {
  const record = byKey.get(key);
  if (record === undefined) throw new Error(`${key} is not in the pack`);
  return record;
}

const MINUS = '−';

/** Every creature text block that carries an attack lead-in and Hit clause. */
function attackBlocks(record: RulesRecord): {
  name: string;
  text: string;
  mechanics: Record<string, unknown>;
}[] {
  const out: {
    name: string;
    text: string;
    mechanics: Record<string, unknown>;
  }[] = [];
  const data = record.data as Record<string, unknown>;
  for (const section of [
    'traits',
    'actions',
    'reactions',
    'legendaryActions',
    'variants',
  ]) {
    const entries = data[section];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries as {
      name: string;
      text?: string;
      mechanics?: Record<string, unknown>;
    }[]) {
      if (
        typeof entry.text === 'string' &&
        /(?:Melee|Ranged|Melee or Ranged) (?:Weapon|Spell) Attack:/.test(
          entry.text,
        ) &&
        /Hit:/.test(entry.text)
      ) {
        out.push({
          name: entry.name,
          text: entry.text,
          mechanics: entry.mechanics ?? {},
        });
      }
    }
  }
  return out;
}

function normalizeDice(dice: string): string {
  return dice.split(MINUS).join('-').replace(/\s+/g, ' ');
}

/**
 * Printed damage terms in a Hit clause, keyed like `projectedModes`: a dice
 * term as "<dice>|<type>", a flat no-dice print ("Hit: 1 piercing damage.")
 * as "amount:<n>|<type>".
 */
function printedTerms(hit: string): string[] {
  const dice = [
    ...hit.matchAll(
      /(\d+)\s*\((\d+d\d+(?:\s*[+−-]\s*\d+)?)\)\s+([a-z]+)\s+damage/gi,
    ),
  ].map((match) => `${normalizeDice(match[2])}|${match[3].toLowerCase()}`);
  const flat = /^\s*(\d+) ([a-z]+) damage/.exec(hit);
  if (flat === null || dice.length > 0) return dice;
  return [`amount:${flat[1]}|${flat[2].toLowerCase()}`];
}

function projectedModes(attack: Record<string, unknown>): string[][] {
  const modes = [(attack.hitDamage ?? []) as Record<string, unknown>[]];
  for (const alternative of (attack.alternatives ?? []) as {
    hitDamage: Record<string, unknown>[];
  }[]) {
    modes.push(alternative.hitDamage);
  }
  return modes.map((mode) =>
    mode.map((entry) =>
      entry.dice === undefined
        ? `amount:${String(entry.amount)}|${String(entry.type)}`
        : `${normalizeDice(String(entry.dice))}|${String(entry.type)}`,
    ),
  );
}

function leadInAttack(record: RulesRecord, name: string) {
  const block = attackBlocks(record).find((entry) => entry.name === name);
  if (block === undefined) throw new Error(`${record.key} ${name} missing`);
  const attacks = block.mechanics.attacks as Record<string, unknown>[];
  return { block, attack: attacks?.[0] };
}

describe('creature attack grammar over the committed pack', () => {
  it('projects every printed Hit damage term into hitDamage or alternatives', () => {
    const creatures = records.filter((record) => record.kind === 'creature');
    let checked = 0;
    for (const record of creatures) {
      for (const block of attackBlocks(record)) {
        const hit = /Hit:\s*([^.]*)\./.exec(block.text)?.[1] ?? '';
        const leadIn = /(?:Weapon|Spell) Attack:\s*([+−-]\d+) to hit/.exec(
          block.text,
        );
        const attacks = block.mechanics.attacks as
          | Record<string, unknown>[]
          | undefined;
        expect(attacks, `${record.key} ${block.name} attacks[]`).toBeDefined();
        const attack = attacks?.[0] ?? {};
        const printedBonus = Number((leadIn?.[1] ?? '').split(MINUS).join('-'));
        expect(attack.attackBonus, `${record.key} ${block.name} bonus`).toBe(
          printedBonus,
        );

        const printed = printedTerms(hit);
        const modes = projectedModes(attack);
        const projected = new Set(modes.flat());
        const printedSet = new Set(printed);
        expect(
          [...projected].sort(),
          `${record.key} ${block.name} projected terms`,
        ).toEqual([...printedSet].sort());
        // Shared riders legitimately repeat across modes; the default mode
        // starts with the first printed term.
        if (printed.length > 0) {
          expect(modes[0][0], `${record.key} ${block.name} default`).toBe(
            printed[0],
          );
        }
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('never projects a Unicode minus into dice, and never drops a printed minus dice Hit', () => {
    for (const record of records) {
      expect(
        /"dice":"[^"]*−/.test(JSON.stringify(record.data)),
        `${record.key} dice contains U+2212`,
      ).toBe(false);
    }
    for (const record of records.filter((r) => r.kind === 'creature')) {
      for (const block of attackBlocks(record)) {
        const hit = /Hit:\s*([^.]*)\./.exec(block.text)?.[1] ?? '';
        if (!/\d+d\d+\s*−\s*\d+/.test(hit)) continue;
        const attacks = block.mechanics.attacks as
          | Record<string, unknown>[]
          | undefined;
        expect(
          (attacks?.[0]?.hitDamage as unknown[] | undefined)?.length ?? 0,
          `${record.key} ${block.name} hitDamage`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('keeps exact source values for the repaired defect classes', () => {
    const druid = leadInAttack(recordOf('creature:druid'), 'Quarterstaff');
    expect(druid.attack).toEqual({
      attackType: 'melee-weapon',
      attackBonus: 2,
      reachFeet: 5,
      target: 'one target',
      hitDamage: [{ average: 3, dice: '1d6', type: 'bludgeoning' }],
      alternatives: [
        {
          condition: 'if wielded with two hands',
          hitDamage: [{ average: 4, dice: '1d8', type: 'bludgeoning' }],
        },
        {
          condition: 'with shillelagh',
          hitDamage: [{ average: 6, dice: '1d8 + 2', type: 'bludgeoning' }],
          attackBonus: 4,
        },
      ],
    });

    const dryad = leadInAttack(recordOf('creature:dryad'), 'Club');
    expect(dryad.attack.alternatives).toEqual([
      {
        condition: 'with shillelagh',
        hitDamage: [{ average: 8, dice: '1d8 + 4', type: 'bludgeoning' }],
        attackBonus: 6,
      },
    ]);

    const drider = leadInAttack(recordOf('creature:drider'), 'Longsword');
    expect(drider.attack.hitDamage).toEqual([
      { average: 7, dice: '1d8 + 3', type: 'slashing' },
    ]);
    expect(drider.block.mechanics.damage).toEqual([
      { average: 7, dice: '1d8 + 3', type: 'slashing' },
    ]);
    expect(drider.attack.alternatives).toEqual([
      {
        condition: 'if used with two hands',
        hitDamage: [{ average: 8, dice: '1d10 + 3', type: 'slashing' }],
      },
    ]);

    // Shared rider (Azer's fire) appears in both modes.
    const azer = leadInAttack(recordOf('creature:azer'), 'Warhammer');
    expect(azer.attack.hitDamage).toEqual([
      { average: 7, dice: '1d8 + 3', type: 'bludgeoning' },
      { average: 3, dice: '1d6', type: 'fire' },
    ]);
    expect(azer.attack.alternatives).toEqual([
      {
        condition: 'if used with two hands to make a melee attack',
        hitDamage: [
          { average: 8, dice: '1d10 + 3', type: 'bludgeoning' },
          { average: 3, dice: '1d6', type: 'fire' },
        ],
      },
    ]);

    // Half-HP swarm mode.
    const swarm = leadInAttack(recordOf('creature:swarm-of-rats'), 'Bites');
    expect(swarm.attack.hitDamage).toEqual([
      { average: 7, dice: '2d6', type: 'piercing' },
    ]);
    expect(swarm.attack.alternatives).toEqual([
      {
        condition: 'if the swarm has half of its hit points or fewer',
        hitDamage: [{ average: 3, dice: '1d6', type: 'piercing' }],
      },
    ]);

    // Unicode minus in a printed dice expression.
    const baboon = leadInAttack(recordOf('creature:baboon'), 'Bite');
    expect(baboon.attack.hitDamage).toEqual([
      { average: 1, dice: '1d4 - 1', type: 'piercing' },
    ]);
    expect(baboon.block.mechanics.damage).toEqual([
      { average: 1, dice: '1d4 - 1', type: 'piercing' },
    ]);
  });

  it('keeps every printed ranged notation as rangeFeet', () => {
    const rangeOf = (key: string, name: string) =>
      leadInAttack(recordOf(key), name).attack.rangeFeet;
    // "range N/M ft." (slash form) and "N ft./M ft." (split form)
    expect(rangeOf('creature:bandit', 'Light Crossbow')).toEqual({
      normal: 80,
      long: 320,
    });
    expect(rangeOf('creature:salamander', 'Spear')).toEqual({
      normal: 20,
      long: 60,
    });
    // "ranged N/M ft." (the scout's keyword)
    expect(rangeOf('creature:scout', 'Longbow')).toEqual({
      normal: 150,
      long: 600,
    });
    // Single "range N ft." (spell attacks carry no long range)
    expect(rangeOf('creature:efreeti', 'Hurl Flame')).toEqual({ normal: 120 });
    expect(rangeOf('creature:barbed-devil', 'Hurl Flame')).toEqual({
      normal: 150,
    });
  });

  it('projects the whole printed target phrase, through the sentence boundary', () => {
    // Independent extraction: the phrase starts at a word quantifier (a digit
    // is a range, never a quantifier) and runs to the sentence before "Hit:".
    const quantified =
      /\b((?:one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:target|creature|willing)[\s\S]*?)\.\s*Hit:/i;
    let checked = 0;
    for (const record of records.filter((r) => r.kind === 'creature')) {
      for (const block of attackBlocks(record)) {
        const printed = quantified.exec(block.text)?.[1];
        if (printed === undefined) continue;
        const attacks = block.mechanics.attacks as
          | Record<string, unknown>[]
          | undefined;
        expect(attacks?.[0]?.target, `${record.key} ${block.name} target`).toBe(
          printed.toLowerCase(),
        );
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('keeps mechanics.damage equal to the default hit mode on alternative-bearing attacks', () => {
    for (const record of records.filter((r) => r.kind === 'creature')) {
      for (const block of attackBlocks(record)) {
        const attacks = block.mechanics.attacks as
          | Record<string, unknown>[]
          | undefined;
        const attack = attacks?.[0];
        if (attack?.alternatives === undefined) continue;
        expect(block.mechanics.damage, `${record.key} ${block.name}`).toEqual(
          attack.hitDamage,
        );
      }
    }
  });

  it('projects the Diseased Giant Rats variant bite like an action entry', () => {
    const variants = (
      recordOf('creature:giant-rat').data as {
        variants: { name: string; mechanics?: Record<string, unknown> }[];
      }
    ).variants;
    const variant = variants.find(
      (entry) => entry.name === 'Diseased Giant Rats',
    );
    expect(variant?.mechanics).toEqual({
      attacks: [
        {
          attackType: 'melee-weapon',
          attackBonus: 4,
          reachFeet: 5,
          target: 'one target',
          hitDamage: [{ average: 4, dice: '1d4 + 2', type: 'piercing' }],
        },
      ],
      saves: [{ ability: 'constitution', dc: 10 }],
      damage: [{ average: 4, dice: '1d4 + 2', type: 'piercing' }],
    });
  });

  it('keeps Swarm of Poisonous Snakes save damage with its save, out of the default mode', () => {
    const snakes = leadInAttack(
      recordOf('creature:swarm-of-poisonous-snakes'),
      'Bites',
    );
    expect(snakes.attack.target).toBe('one creature in the swarm’s space');
    expect(snakes.attack.hitDamage).toEqual([
      { average: 7, dice: '2d6', type: 'piercing' },
    ]);
    expect(snakes.block.mechanics.damage).toEqual([
      { average: 7, dice: '2d6', type: 'piercing' },
    ]);
    expect(snakes.block.mechanics.saves).toEqual([
      {
        ability: 'constitution',
        dc: 10,
        damageOnSuccess: 'half',
        damageOnFailure: [{ average: 14, dice: '4d6', type: 'poison' }],
      },
    ]);
  });

  it('keeps the crocodile tail exclusion and the vampire eligible-target alternatives', () => {
    const tail = leadInAttack(recordOf('creature:giant-crocodile'), 'Tail');
    expect(tail.attack.target).toBe('one target not grappled by the crocodile');
    const bite = leadInAttack(recordOf('creature:vampire-spawn'), 'Bite');
    expect(bite.attack.target).toBe(
      'one willing creature, or a creature that is grappled by the vampire, incapacitated, or restrained',
    );
  });

  it('fails closed when an alternative has no condition or damage', () => {
    const druid = structuredClone(recordOf('creature:druid'));
    const traits = (
      druid.data as { actions: { mechanics: Record<string, unknown> }[] }
    ).actions;
    const attacks = traits[0].mechanics.attacks as {
      alternatives: { condition: string }[];
    }[];
    attacks[0].alternatives[0].condition = '';
    expect(() => validateRecordKindSchema(druid, 'druid')).toThrow(/condition/);
  });
});
