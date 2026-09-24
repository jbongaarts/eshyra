/**
 * Unit evidence for the source-derived creature attack lead-in gate
 * (eshyra-o9bd.19.2.2.1). The corpus-wide proof is the importer run itself:
 * `runImporter` calls `assertCreatureAttackLeadInsSegmented` over the full
 * SRD extraction, and CI's srd-importer-reproducibility job runs
 * `verify:dnd5e-srd-pack` whenever importer or pack files change.
 */
import { describe, expect, it } from 'vitest';
import {
  assertCreatureAttackLeadInsSegmented,
  auditCreatureAttackLeadIns,
  CreatureAttackLeadInError,
} from '../../../scripts/importers/dnd5e-srd-5.1/creatureAttackLeadIns.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
import type { RulesRecord } from '../../../src/rules/types.js';

function creature(
  key: string,
  name: string,
  actions: readonly { name: string; text: string }[],
): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'creature',
    key,
    name,
    data: { actions },
  } as unknown as RulesRecord;
}

const SOURCE: PageText[] = [
  {
    pageNumber: 328,
    lines: [
      'Wererat',
      'Medium humanoid (human, shapechanger), lawful evil',
      'Actions',
      'Multiattack (Humanoid or Hybrid Form Only). The',
      'wererat makes two attacks.',
      'Shortsword (Humanoid or Hybrid Form Only). Melee',
      'Weapon Attack: +4 to hit, reach 5 ft., one target.',
      'Hand Crossbow (Humanoid or Hybrid Form Only).',
      'Ranged Weapon Attack: +4 to hit, range 30/120 ft.',
      'Weretiger',
      'Medium humanoid (human, shapechanger), neutral',
      'Scimitar. Melee Weapon Attack: +5 to hit, reach 5 ft.',
    ],
  },
];

const WERETIGER = creature('creature:weretiger', 'Weretiger', [
  { name: 'Scimitar', text: 'Melee Weapon Attack: +5 to hit, reach 5 ft.' },
]);

describe('creature attack lead-in gate (eshyra-o9bd.19.2.2.1)', () => {
  it('passes when every printed attack lead-in opens its own entry', () => {
    const wererat = creature('creature:wererat', 'Wererat', [
      { name: 'Multiattack', text: 'The wererat makes two attacks.' },
      { name: 'Shortsword', text: 'Melee Weapon Attack: +4 to hit.' },
      { name: 'Hand Crossbow', text: 'Ranged Weapon Attack: +4 to hit.' },
    ]);
    expect(() =>
      assertCreatureAttackLeadInsSegmented([wererat, WERETIGER], SOURCE, {
        requireComplete: false,
      }),
    ).not.toThrow();
  });

  it('fails when an attack is swallowed into a preceding ATTACK entry', () => {
    const wererat = creature('creature:wererat', 'Wererat', [
      { name: 'Multiattack', text: 'The wererat makes two attacks.' },
      {
        name: 'Shortsword',
        text: 'Melee Weapon Attack: +4 to hit. Hand Crossbow (Humanoid or Hybrid Form Only). Ranged Weapon Attack: +4 to hit.',
      },
    ]);
    expect(
      auditCreatureAttackLeadIns([wererat, WERETIGER], SOURCE).mismatches,
    ).toEqual([
      {
        key: 'creature:wererat',
        sourceLeadIns: 2,
        entryLeadIns: 1,
        exceptedLeadIns: 0,
      },
    ]);
  });

  it('fails when an attack is swallowed into a preceding NON-attack entry', () => {
    // The receiving entry carries exactly one attack lead-in, so a pack-only
    // "more than one lead-in per entry" predicate cannot see this state.
    const wererat = creature('creature:wererat', 'Wererat', [
      {
        name: 'Multiattack',
        text: 'The wererat makes two attacks. Shortsword. Melee Weapon Attack: +4 to hit.',
      },
      { name: 'Hand Crossbow', text: 'Ranged Weapon Attack: +4 to hit.' },
    ]);
    expect(() =>
      assertCreatureAttackLeadInsSegmented([wererat, WERETIGER], SOURCE, {
        requireComplete: false,
      }),
    ).toThrow(CreatureAttackLeadInError);
  });

  it('requires every creature to be anchored in a complete run', () => {
    const phantom = creature('creature:phantom', 'Phantom', []);
    expect(() =>
      assertCreatureAttackLeadInsSegmented([WERETIGER, phantom], SOURCE, {
        requireComplete: true,
      }),
    ).toThrow(/creature:phantom: printed name \+ size\/type line not found/);
  });

  it('applies the reviewed Giant Rat exception and fails when it goes stale', () => {
    const page: PageText[] = [
      {
        pageNumber: 378,
        lines: [
          'Giant Rat',
          'Small beast, unaligned',
          'Bite. Melee Weapon Attack: +4 to hit, reach 5 ft.',
          'Variant: Diseased Giant Rats',
          'Some giant rats carry vile diseases. Bite. Melee',
          'Weapon Attack: +4 to hit, reach 5 ft.',
        ],
      },
    ];
    const bite = { name: 'Bite', text: 'Melee Weapon Attack: +4 to hit.' };
    const variant = {
      name: 'Diseased Giant Rats',
      text: 'Some giant rats carry vile diseases. Bite. Melee Weapon Attack: +4 to hit.',
    };
    const rat = {
      ...creature('creature:giant-rat', 'Giant Rat', [bite]),
      data: { actions: [bite], variants: [variant] },
    } as unknown as RulesRecord;
    expect(auditCreatureAttackLeadIns([rat], page)).toEqual({
      mismatches: [],
      unanchored: [],
      staleExceptions: [],
    });
    const plainPage: PageText[] = [
      { pageNumber: 378, lines: page[0].lines.slice(0, 3) },
    ];
    const plainRat = creature('creature:giant-rat', 'Giant Rat', [bite]);
    expect(() =>
      assertCreatureAttackLeadInsSegmented([plainRat], plainPage, {
        requireComplete: true,
      }),
    ).toThrow(/creature:giant-rat/);
  });
});
