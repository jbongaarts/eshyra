import { describe, expect, it } from 'vitest';
import {
  deriveMagicItemMechanics,
  MAGIC_ITEM_M2_M3_DEFERRED,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemPassiveEffects.js';
import type { MagicItemExtraction } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function item(
  name: string,
  description: string,
  overrides: Partial<MagicItemExtraction> = {},
): MagicItemExtraction {
  return {
    name,
    itemType: 'Wondrous item',
    rarity: 'rare',
    requiresAttunement: false,
    description,
    sourcePage: 1,
    ...overrides,
  };
}

describe('deriveMagicItemMechanics (eshyra-o9bd.18.7.7.5)', () => {
  it('returns undefined for an item outside the M2/M3 membership', () => {
    expect(
      deriveMagicItemMechanics(
        item(
          'Adamantine Armor',
          'Any critical hit against you becomes a normal hit.',
        ),
      ),
    ).toBeUndefined();
  });

  it('projects an ability-score floor (Amulet of Health)', () => {
    const mechanics = deriveMagicItemMechanics(
      item(
        'Amulet of Health',
        'Your Constitution score is 19 while you wear this amulet. It has no effect on you if your Constitution is already 19 or higher.',
      ),
    );
    expect(mechanics).toEqual({
      effects: [
        { kind: 'abilityScoreSet', ability: 'constitution', value: 19 },
      ],
    });
  });

  it('projects a per-level hit-point-maximum increase (Berserker Axe)', () => {
    const mechanics = deriveMagicItemMechanics(
      item(
        'Berserker Axe',
        'While you are attuned to this weapon, your hit point maximum increases by 1 for each level you have attained.',
      ),
    );
    expect(mechanics).toEqual({
      effects: [{ kind: 'hitPointMaximumIncrease', perLevel: 1 }],
    });
  });

  it('projects a table-driven ability-score set alongside a duration condition (Potion of Giant Strength)', () => {
    const mechanics = deriveMagicItemMechanics(
      item(
        'Potion of Giant Strength',
        'When you drink this potion, your Strength score changes for 1 hour. The type of giant determines the score (see the table below).',
      ),
    );
    expect(mechanics).toEqual({
      effects: [
        {
          kind: 'abilityScoreSet',
          ability: 'strength',
          tableRef: 'table:potion-of-giant-strength',
          condition: 'for 1 hour',
        },
      ],
    });
  });

  it('projects dice-based regeneration plus limb regrowth (Ring of Regeneration)', () => {
    const mechanics = deriveMagicItemMechanics(
      item(
        'Ring of Regeneration',
        'While wearing this ring, you regain 1d6 hit points every 10 minutes, provided that you have at least 1 hit point. If you lose a body part, the ring causes the missing part to regrow and return to full functionality after 1d6 + 1 days if you have at least 1 hit point the whole time.',
      ),
    );
    expect(mechanics).toEqual({
      effects: [
        {
          kind: 'regeneration',
          hitDice: '1d6',
          timing: 'every-10-minutes',
          condition: 'if it has at least 1 hit point',
          limbRegrowthDays: '1d6 + 1',
          limbRegrowthCondition:
            'if you have at least 1 hit point the whole time',
        },
      ],
    });
  });

  it('projects a table-driven speed alongside a multiplier rider (Carpet of Flying)', () => {
    const mechanics = deriveMagicItemMechanics(
      item(
        'Carpet of Flying',
        'You can speak the carpet’s command word as an action to make the carpet hover and fly. A carpet can carry up to twice the weight shown on the table, but it flies at half speed if it carries more than its normal capacity.',
      ),
    );
    expect(mechanics).toEqual({
      effects: [
        {
          kind: 'speedSet',
          mode: 'fly',
          valueTableRef: 'table:carpet-of-flying',
        },
        {
          kind: 'speedMultiplier',
          multiplier: 0.5,
          thresholdTableRef: 'table:carpet-of-flying',
          thresholdMultiplier: 2,
          condition: 'carrying more than the (doubled) table capacity',
        },
      ],
    });
  });

  it('projects a walk-speed floor plus a movement-restriction and jump-distance rider (Boots of Striding and Springing)', () => {
    const mechanics = deriveMagicItemMechanics(
      item(
        'Boots of Striding and Springing',
        'While you wear these boots, your walking speed becomes 30 feet, unless your walking speed is higher, and your speed isn’t reduced if you are encumbered or wearing heavy armor. In addition, you can jump three times the normal distance, though you can’t jump farther than your remaining movement would allow.',
      ),
    );
    expect(mechanics).toEqual({
      effects: [
        { kind: 'speedSet', mode: 'walk', value: 30, floor: true },
        {
          kind: 'ignoreMovementRestriction',
          source: 'being encumbered or wearing heavy armor',
        },
        {
          kind: 'jumpDistanceMultiplier',
          multiplier: 3,
          condition:
            'you can’t jump farther than your remaining movement would allow',
        },
      ],
    });
  });

  it('returns undefined and records a reason for the three deferred items', () => {
    expect(
      deriveMagicItemMechanics(
        item('Ioun Stone', 'An Ioun stone is named after Ioun...'),
      ),
    ).toBeUndefined();
    expect(
      deriveMagicItemMechanics(
        item(
          'Ring of Elemental Command',
          'This ring is linked to one of the four Elemental Planes.',
        ),
      ),
    ).toBeUndefined();
    expect(
      deriveMagicItemMechanics(
        item(
          'Crystal Ball',
          'While scrying with the crystal ball, you have truesight with a radius of 120 feet centered on the spell’s sensor.',
        ),
      ),
    ).toBeUndefined();
    expect(MAGIC_ITEM_M2_M3_DEFERRED.get('Ioun Stone')).toMatch(
      /inline variant structuring/,
    );
    expect(MAGIC_ITEM_M2_M3_DEFERRED.get('Ring of Elemental Command')).toMatch(
      /inline variant structuring/,
    );
    expect(MAGIC_ITEM_M2_M3_DEFERRED.get('Crystal Ball')).toMatch(
      /inline variant structuring/,
    );
  });

  it('throws when a modeled item’s source text drifts from the expected phrase', () => {
    expect(() =>
      deriveMagicItemMechanics(
        item('Amulet of Health', 'This amulet does something else entirely.'),
      ),
    ).toThrow(/expected pattern/);
  });
});
