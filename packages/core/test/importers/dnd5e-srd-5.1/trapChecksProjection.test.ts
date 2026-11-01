/**
 * Printed trap ability checks and dispel-magic DCs in the committed SRD 5.1
 * pack (eshyra-o9bd.19.4.4.1; opus:F-23 sphere-prose).
 *
 * The census derives its expectations from the committed trap text with its
 * own independent sentence scan, not from the importer's parser, and counts
 * nothing by hand: each DC-bearing non-save sentence in a trap record (or in
 * each `hazard:pits` variant) must appear as exactly one `checks`/`dispels`
 * entry whose `text` equals that sentence and whose `dc` equals the printed
 * number.
 */

import { describe, expect, it } from 'vitest';
import {
  getBundledDnd5eSrdPack,
  getBundledDnd5eSrdRecordRelationshipManifest,
  resolveRecordRelationships,
  resolveRulesStack,
} from '../../../src/internal.js';

type Obj = Record<string, unknown>;
const pack = getBundledDnd5eSrdPack();
const stack = resolveRulesStack({ base: pack });
const manifest = getBundledDnd5eSrdRecordRelationshipManifest();

const traps = pack.records.filter(
  (record) =>
    record.kind === 'hazard' && (record.data as Obj).category === 'trap',
);

interface Unit {
  readonly where: string;
  readonly text: string;
  readonly mechanics: Obj | undefined;
}

/** Text-bearing units: whole trap, or each printed pits variant. */
function units(): Unit[] {
  return traps.flatMap((record) => {
    const data = record.data as Obj;
    if (Array.isArray(data.variants)) {
      return (data.variants as Obj[]).map((variant) => ({
        where: `${record.key}/${variant.name as string}`,
        text: variant.text as string,
        mechanics: variant.mechanics as Obj | undefined,
      }));
    }
    // The sphere's optional version is projected on data.versions, so its
    // sentences belong to that unit, not to the record-level one.
    const versions = (data.versions as Obj[] | undefined) ?? [];
    const own = versions.reduce(
      (text, version) => text.replace(version.text as string, '').trim(),
      data.description as string,
    );
    return [
      { where: record.key, text: own, mechanics: data.mechanics as Obj },
      ...versions.map((version, i) => ({
        where: `${record.key}/versions[${i}]`,
        text: version.text as string,
        mechanics: version.mechanics as Obj | undefined,
      })),
    ];
  });
}

const dcSentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => /\bDC\b/.test(s) && !/saving throw/i.test(s));

describe('trap check and dispel census', () => {
  it('finds a non-trivial population from the pack itself', () => {
    const total = units().reduce((n, u) => n + dcSentences(u.text).length, 0);
    expect(total).toBeGreaterThan(0);
  });

  it.each(units())(
    '$where projects each printed non-save DC sentence exactly once',
    (unit) => {
      const entries = [
        ...((unit.mechanics?.checks as Obj[] | undefined) ?? []),
        ...((unit.mechanics?.dispels as Obj[] | undefined) ?? []),
      ];
      const sentences = dcSentences(unit.text);
      expect(entries.map((e) => e.text).sort()).toEqual([...sentences].sort());
      for (const entry of entries) {
        // The sentence's only integers are its DC (and, for spot sentences,
        // nothing else): take the number printed next to "DC".
        const printed =
          /\bDC (\d+)\b|\(DC (\d+)\)|\bDC\b[^.]*? is (\d+)\b/.exec(
            entry.text as string,
          );
        expect(entry.dc).toBe(
          Number(printed?.[1] ?? printed?.[2] ?? printed?.[3]),
        );
      }
    },
  );

  it('shape 3 entries (no printed ability) carry no ability or skill', () => {
    const bare = units().flatMap((u) =>
      ((u.mechanics?.checks as Obj[] | undefined) ?? []).filter(
        (check) =>
          !/\b(?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\b/.test(
            check.text as string,
          ),
      ),
    );
    expect(bare.length).toBeGreaterThan(0);
    for (const check of bare) {
      expect(check).not.toHaveProperty('ability');
      expect(check).not.toHaveProperty('skill');
    }
  });

  it('only prints a skill or tool the sentence itself prints', () => {
    for (const u of units()) {
      for (const check of (u.mechanics?.checks as Obj[] | undefined) ?? []) {
        const text = check.text as string;
        if (check.skill !== undefined) {
          expect(text.toLowerCase()).toContain(
            `(${(check.skill as string).replaceAll('-', ' ')})`,
          );
        }
        expect(check.tool !== undefined).toBe(/thieves’ tools/.test(text));
      }
    }
  });
});

describe('hazard:sphere-of-annihilation', () => {
  const sphere = pack.records.find(
    (record) => record.key === 'hazard:sphere-of-annihilation',
  );
  const data = sphere?.data as Obj;

  it('projects the Arcana check, the identical-item reference, and the DC 18 dispel on the version only', () => {
    expect(data.mechanics).toEqual({
      checks: [
        {
          dc: 20,
          ability: 'intelligence',
          skill: 'arcana',
          text: 'A successful DC 20 Intelligence (Arcana) check reveals that the mouth contains a sphere of annihilation that can’t be controlled or moved.',
        },
      ],
    });
    expect(data.identicalToRef).toBe('magic-item:sphere-of-annihilation');
    expect(data.identicalToText).toBe(
      'A successful DC 20 Intelligence (Arcana) check reveals that the mouth contains a sphere of annihilation that can’t be controlled or moved. It is otherwise identical to a normal sphere of annihilation.',
    );
    expect(data.versions).toEqual([
      {
        text: 'Some versions of the trap include an enchantment placed on the stone face, such that specified creatures feel an overwhelming urge to approach it and crawl inside its mouth. This effect is otherwise like the sympathy aspect of the antipathy/sympathy spell. A successful dispel magic (DC 18) removes this enchantment.',
        likeSpellRef: 'spell:antipathy-sympathy',
        likeSpellAspect: 'sympathy',
        mechanics: {
          dispels: [
            {
              spell: 'spell:dispel-magic',
              dc: 18,
              text: 'A successful dispel magic (DC 18) removes this enchantment.',
            },
          ],
        },
      },
    ]);
    expect(data).not.toHaveProperty('variants');
    expect((data.mechanics as Obj).dispels).toBeUndefined();
  });

  it('resolves every new relationship', () => {
    const relations = resolveRecordRelationships(
      manifest,
      sphere as NonNullable<typeof sphere>,
      stack,
    ).map((r) => [r.relation, r.outcome, r.targetRecordKey]);
    expect(relations).toEqual(
      expect.arrayContaining([
        [
          'otherwise-identical-to',
          'resolved',
          'magic-item:sphere-of-annihilation',
        ],
        ['effect-like-spell', 'resolved', 'spell:antipathy-sympathy'],
        ['dispelled-by', 'resolved', 'spell:dispel-magic'],
      ]),
    );
    for (const record of traps) {
      for (const r of resolveRecordRelationships(manifest, record, stack)) {
        expect(r.outcome).toBe('resolved');
      }
    }
  });
});
