import { describe, expect, it } from 'vitest';
import { deriveCreatureEntryMechanics } from '../../../scripts/importers/dnd5e-srd-5.1/mechanicsProjections.js';

describe('deriveCreatureEntryMechanics recharge parsing (eshyra-54di)', () => {
  it('parses an en-dash recharge range as minimum..maximum, not minimum..minimum', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Fire Breath (Recharge 5–6)',
      'The dragon exhales fire in a 60-foot cone.',
    );
    expect(mechanics.recharge).toEqual({ roll: 'd6', minimum: 5, maximum: 6 });
  });

  it('parses a 4-6 en-dash recharge range', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Whirlwind (Recharge 4–6)',
      'The elemental forms a whirlwind.',
    );
    expect(mechanics.recharge).toEqual({ roll: 'd6', minimum: 4, maximum: 6 });
  });

  it('parses a single fixed recharge value as minimum == maximum', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Frightful Presence (Recharge 6)',
      'Each creature must succeed on a saving throw.',
    );
    expect(mechanics.recharge).toEqual({ roll: 'd6', minimum: 6, maximum: 6 });
  });

  it('omits recharge when the name has no Recharge clause', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Bite',
      'Melee Weapon Attack: +9 to hit, reach 5 ft., one target.',
    );
    expect(mechanics.recharge).toBeUndefined();
  });
});
