/**
 * Tests for the deterministic starting-equipment grant resolver
 * (`src/character/srdStartingEquipmentGrants.ts`, eshyra-ngcj.3) and its
 * application across every class record in the committed pack.
 */

import { describe, expect, it } from 'vitest';
import {
  getBundledDnd5eSrdPack,
  type RulesRecord,
  resolveStartingEquipmentGrants,
  StartingEquipmentGrantError,
  startingEquipmentGrantPhrases,
} from '../src/internal.js';

interface PackGrant {
  readonly kind: 'item' | 'filter';
  readonly ref?: string;
  readonly quantity: number;
  readonly condition?: string;
  readonly select?: string;
  readonly weaponCategory?: string;
  readonly weaponRange?: string;
}
interface PackEntry {
  readonly kind: 'choice' | 'fixed';
  readonly text?: string;
  readonly grants?: PackGrant[];
  readonly options?: { text: string; grants?: PackGrant[] }[];
}

function classRecords(): RulesRecord[] {
  return getBundledDnd5eSrdPack().records.filter((r) => r.kind === 'class');
}

describe('resolveStartingEquipmentGrants', () => {
  it('resolves a fixed item to an equipment ref with quantity', () => {
    expect(resolveStartingEquipmentGrants('a greataxe')).toEqual([
      { kind: 'item', ref: 'equipment:greataxe', quantity: 1 },
    ]);
  });

  it('parses explicit quantities from number words and digits', () => {
    expect(resolveStartingEquipmentGrants('two handaxes')).toEqual([
      { kind: 'item', ref: 'equipment:handaxe', quantity: 2 },
    ]);
    expect(resolveStartingEquipmentGrants('10 darts')).toEqual([
      { kind: 'item', ref: 'equipment:dart', quantity: 10 },
    ]);
  });

  it('splits a compound phrase into one grant per item, in order', () => {
    expect(
      resolveStartingEquipmentGrants('leather armor, longbow, and 20 arrows'),
    ).toEqual([
      { kind: 'item', ref: 'equipment:leather', quantity: 1 },
      { kind: 'item', ref: 'equipment:longbow', quantity: 1 },
      { kind: 'item', ref: 'equipment:arrows-20', quantity: 1 },
    ]);
  });

  it('preserves the "(if proficient)" proviso as a structured condition', () => {
    expect(
      resolveStartingEquipmentGrants('a warhammer (if proficient)'),
    ).toEqual([
      {
        kind: 'item',
        ref: 'equipment:warhammer',
        quantity: 1,
        condition: 'if proficient',
      },
    ]);
  });

  it('resolves open weapon choices to typed filters', () => {
    expect(resolveStartingEquipmentGrants('any martial melee weapon')).toEqual([
      {
        kind: 'filter',
        select: 'weapon',
        quantity: 1,
        weaponCategory: 'martial',
        weaponRange: 'melee',
      },
    ]);
    expect(resolveStartingEquipmentGrants('two martial weapons')).toEqual([
      {
        kind: 'filter',
        select: 'weapon',
        quantity: 2,
        weaponCategory: 'martial',
      },
    ]);
  });

  it('resolves focus / instrument / holy-symbol choices to typed filters', () => {
    expect(resolveStartingEquipmentGrants('an arcane focus')).toEqual([
      { kind: 'filter', select: 'arcane-focus', quantity: 1 },
    ]);
    expect(
      resolveStartingEquipmentGrants('any other musical instrument'),
    ).toEqual([{ kind: 'filter', select: 'musical-instrument', quantity: 1 }]);
  });

  it('throws on an unknown phrase (fail closed)', () => {
    expect(() => resolveStartingEquipmentGrants('a vorpal sword')).toThrow(
      StartingEquipmentGrantError,
    );
  });
});

describe('committed pack starting-equipment grants', () => {
  const classes = classRecords();
  const equipmentKeys = new Set(
    getBundledDnd5eSrdPack()
      .records.filter((r) => r.kind === 'equipment')
      .map((r) => r.key),
  );

  it('covers all 12 classes', () => {
    expect(classes).toHaveLength(12);
  });

  it('every option and fixed entry carries non-empty grants', () => {
    for (const cls of classes) {
      const entries = (
        cls.data as { startingEquipment?: { entries?: PackEntry[] } }
      ).startingEquipment?.entries;
      expect(entries, `${cls.key} has entries`).toBeDefined();
      for (const entry of entries ?? []) {
        if (entry.kind === 'fixed') {
          expect(
            entry.grants?.length,
            `${cls.key} fixed grants`,
          ).toBeGreaterThan(0);
        } else {
          for (const option of entry.options ?? []) {
            expect(
              option.grants?.length,
              `${cls.key} option "${option.text}" grants`,
            ).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('every fixed item grant resolves to a real equipment record', () => {
    for (const cls of classes) {
      const entries =
        (cls.data as { startingEquipment?: { entries?: PackEntry[] } })
          .startingEquipment?.entries ?? [];
      const buckets = entries.flatMap((e) =>
        e.kind === 'fixed'
          ? [e.grants ?? []]
          : (e.options ?? []).map((o) => o.grants ?? []),
      );
      for (const grants of buckets) {
        for (const grant of grants) {
          if (grant.kind !== 'item') continue;
          expect(
            equipmentKeys.has(grant.ref ?? ''),
            `${cls.key} grant ref ${grant.ref}`,
          ).toBe(true);
          expect(grant.quantity).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });
});

describe('resolver phrase coverage', () => {
  it('exposes the distinct phrase set', () => {
    expect(startingEquipmentGrantPhrases().length).toBe(48);
  });
});
