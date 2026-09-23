/**
 * Source census for the successful-save half-damage defect class
 * (eshyra-o9bd.19.4.3.1; finding-registry rows half-damage-branches and
 * hazard-success-branches; Bag of Beans).
 *
 * Every sentence of the pinned SRD 5.1 PDF that mentions both halving
 * ("half"/"halves") and success ("success"/"succeeds"...) is listed here — a
 * deliberately broader net than the importer's success-branch grammar, so a
 * printed wording the importer fails to recognize still lands in the
 * denominator. halfDamageSuccessBranches.test.ts re-derives this list from the
 * PDF and fails on any difference, then checks each join against the pack.
 *
 * Each join names the record and the container (JSON pointer) whose verbatim
 * prose carries the sentence (`anchor` is the part of the sentence found
 * there; column interleaving can split a printed sentence), and how the pack
 * represents it:
 *  - `typed-save`: the container's single typed save must carry
 *    `damageOnSuccess: 'half'`;
 *  - `magic-item-effect`: the named curated save effect must carry
 *    `successfulSaveDamage: 'half'`;
 *  - `untyped`: a member with no typed save to carry it (reason given);
 *  - `not-a-member`: the sentence halves or succeeds but is not a save whose
 *    success halves damage (reason given); a typed save there must NOT carry
 *    the branch.
 */

export type HalfDamageCensusJoin = {
  readonly recordKey: string;
  readonly pointer: string;
  readonly anchor: string;
} & (
  | { readonly representation: 'typed-save' }
  | { readonly representation: 'magic-item-effect'; readonly effectId: string }
  | {
      readonly representation: 'untyped' | 'not-a-member';
      readonly reason: string;
    }
);

export interface HalfDamageCensusEntry {
  readonly page: number;
  /** The sentence as extracted from the pinned PDF (whitespace collapsed). */
  readonly source: string;
  readonly joins: readonly HalfDamageCensusJoin[];
}

export const HALF_DAMAGE_SUCCESS_CENSUS: readonly HalfDamageCensusEntry[] = [
  {
    page: 5,
    source:
      'A creature takes 2d6 damage on a failed save, and half as much damage on a successful',
    joins: [
      {
        recordKey: 'ancestry:dragonborn',
        pointer: '/data/traits/6',
        anchor:
          'A creature takes 2d6 damage on a failed save, and half as much damage on a successful',
        representation: 'untyped',
        reason:
          'The Breath Weapon trait projects no typed save (its damage and save are prose only), so no typed branch can be missing.',
      },
    ],
  },
  {
    page: 28,
    source:
      'When you are subjected to an effect that allows you to make a Dexterity saving throw to take only half damage, you instead take no damage if you succeed on the saving throw, and only half damage if you fail.',
    joins: [
      {
        recordKey: 'feature:monk:evasion',
        pointer: '/data',
        anchor:
          'When you are subjected to an effect that allows you to make a Dexterity saving throw to take only half damage, you instead take no damage if you succeed on the saving throw, and only half damage if you fail.',
        representation: 'not-a-member',
        reason:
          "Evasion: modifies other effects' half-damage saves; not itself a save whose success halves damage.",
      },
    ],
  },
  {
    page: 38,
    source:
      'When you are subjected to an effect, such as a red dragon’s fiery breath or a lightning bolt spell, that allows you to make a Dexterity saving throw to take only half damage, you instead take no damage if you succeed on the saving throw, and only half damage if you fail.',
    joins: [
      {
        recordKey: 'feature:hunter:superior-hunters-defense',
        pointer: '/data',
        anchor:
          'When you are subjected to an effect, such as a red dragon’s fiery breath or a lightning bolt spell, that allows you to make a Dexterity saving throw to take only half damage, you instead take no damage if you succeed on the saving throw, and only half damage if you fail.',
        representation: 'not-a-member',
        reason:
          "Evasion option: modifies other effects' half-damage saves; not itself a save whose success halves damage.",
      },
      {
        recordKey: 'feature:hunter:superior-hunters-defense',
        pointer: '/data/choices/0/options/0',
        anchor:
          'When you are subjected to an effect, such as a red dragon’s fiery breath or a lightning bolt spell, that allows you to make a Dexterity saving throw to take only half damage, you instead take no damage if you succeed on the saving throw, and only half damage if you fail.',
        representation: 'not-a-member',
        reason:
          "Evasion option: modifies other effects' half-damage saves; not itself a save whose success halves damage.",
      },
    ],
  },
  {
    page: 40,
    source:
      'When you are subjected to an effect that allows you to make a Dexterity saving throw to take only half damage, you instead take no damage if you succeed on the saving throw, and only half damage if you fail.',
    joins: [
      {
        recordKey: 'feature:rogue:evasion',
        pointer: '/data',
        anchor:
          'When you are subjected to an effect that allows you to make a Dexterity saving throw to take only half damage, you instead take no damage if you succeed on the saving throw, and only half damage if you fail.',
        representation: 'not-a-member',
        reason:
          "Evasion: modifies other effects' half-damage saves; not itself a save whose success halves damage.",
      },
    ],
  },
  {
    page: 54,
    source:
      'The chosen creatures automatically succeed on their saving throws against the spell, and they take no damage if they would normally take half damage on a successful save.',
    joins: [
      {
        recordKey: 'feature:school-of-evocation:sculpt-spells',
        pointer: '/data',
        anchor:
          'The chosen creatures automatically succeed on their saving throws against the spell, and they take no damage if they would normally take half damage on a successful save.',
        representation: 'not-a-member',
        reason:
          "Sculpt Spells: changes the half-damage branch of the caster's own spells (modeled as autoSucceedSave.noDamageInsteadOfHalf); not itself a half-damage save.",
      },
    ],
  },
  {
    page: 54,
    source:
      'When a creature succeeds on a saving throw against your cantrip, the creature takes half the cantrip’s damage (if any) but suffers no additional effect from the cantrip.',
    joins: [
      {
        recordKey: 'feature:school-of-evocation:potent-cantrip',
        pointer: '/data',
        anchor:
          'When a creature succeeds on a saving throw against your cantrip, the creature takes half the cantrip’s damage (if any) but suffers no additional effect from the cantrip.',
        representation: 'not-a-member',
        reason:
          "Potent Cantrip: grants a half-damage branch to the caster's cantrips (modeled as a damageOnSuccessfulSave effect); not itself a save.",
      },
    ],
  },
  {
    page: 79,
    source: 'If at least half the group succeeds, the whole group succeeds.',
    joins: [
      {
        recordKey: 'rule:group-checks',
        pointer: '/data',
        anchor:
          'If at least half the group succeeds, the whole group succeeds.',
        representation: 'not-a-member',
        reason: 'Group checks: "half the group succeeds"; no damage.',
      },
    ],
  },
  {
    page: 79,
    source:
      'If at least half the group succeeds, the successful characters are able to guide their companions out of danger.',
    joins: [
      {
        recordKey: 'rule:group-checks',
        pointer: '/data',
        anchor:
          'If at least half the group succeeds, the successful characters are able to guide their companions out of danger.',
        representation: 'not-a-member',
        reason: 'Group checks: "half the group succeeds"; no damage.',
      },
    ],
  },
  {
    page: 87,
    source:
      'A character who drinks only half that much water must succeed on a DC 15 Constitution saving throw or suffer one level of exhaustion at the end of the day.',
    joins: [
      {
        recordKey: 'rule:water',
        pointer: '/data',
        anchor:
          'A character who drinks only half that much water must succeed on a DC 15 Constitution saving throw or suffer one level of exhaustion at the end of the day.',
        representation: 'not-a-member',
        reason: 'Water: "half that much water"; no damage.',
      },
    ],
  },
  {
    page: 122,
    source: 'On a successful save, the creature takes half as much damage.',
    joins: [
      {
        recordKey: 'spell:blade-barrier',
        pointer: '/data',
        anchor: 'On a successful save, the creature takes half as much damage.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 122,
    source:
      'The target takes 8d8 necrotic damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:blight',
        pointer: '/data',
        anchor:
          'The target takes 8d8 necrotic damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 123,
    source:
      'A creature takes 3d6 fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:burning-hands',
        pointer: '/data',
        anchor:
          'A creature takes 3d6 fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 123,
    source:
      'A creature takes 3d10 lightning damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:call-lightning',
        pointer: '/data',
        anchor:
          'A creature takes 3d10 lightning damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 124,
    source:
      'The target takes 10d8 lightning damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:chain-lightning',
        pointer: '/data',
        anchor:
          'The target takes 10d8 lightning damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 124,
    source:
      'A target takes 8d6 necrotic damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:circle-of-death',
        pointer: '/data',
        anchor:
          'A target takes 8d6 necrotic damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 125,
    source:
      'The creature takes 5d8 poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:cloudkill',
        pointer: '/data',
        anchor:
          'The creature takes 5d8 poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 127,
    source:
      'A creature takes 8d8 cold damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:cone-of-cold',
        pointer: '/data',
        anchor:
          'A creature takes 8d8 cold damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 131,
    source:
      'On a successful save, the creature takes half damage, and isn’t caught in the vortex.',
    joins: [
      {
        recordKey: 'spell:control-water',
        pointer: '/data',
        anchor:
          'On a successful save, the creature takes half damage, and isn’t caught in the vortex.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 134,
    source:
      'A creature takes fire damage equal to the total accumulated damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:delayed-blast-fireball',
        pointer: '/data',
        anchor:
          'A creature takes fire damage equal to the total accumulated damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 139,
    source:
      'On a successful save, the creature takes half as much damage and doesn’t fall prone or become buried.',
    joins: [
      {
        recordKey: 'spell:earthquake',
        pointer: '/data',
        anchor:
          'On a successful save, the creature takes half as much damage and doesn’t fall prone or become buried.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 144,
    source:
      'It takes 7d8 + 30 necrotic damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:finger-of-death',
        pointer: '/data',
        anchor:
          'It takes 7d8 + 30 necrotic damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 144,
    source:
      'A target takes 8d6 fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:fireball',
        pointer: '/data',
        anchor:
          'A target takes 8d6 fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 145,
    source:
      'It takes 7d10 fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:fire-storm',
        pointer: '/data',
        anchor:
          'It takes 7d10 fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 145,
    source:
      'A creature takes 4d6 fire damage and 4d6 radiant damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:flame-strike',
        pointer: '/data',
        anchor:
          'A creature takes 4d6 fire damage and 4d6 radiant damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 145,
    source:
      'The creature takes 2d6 fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:flaming-sphere',
        pointer: '/data',
        anchor:
          'The creature takes 2d6 fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 147,
    source: 'On a successful save, it takes half as much damage.',
    joins: [
      {
        recordKey: 'spell:freezing-sphere',
        pointer: '/data',
        anchor: 'On a successful save, it takes half as much damage.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 150,
    source:
      'A creature takes 5d8 acid, cold, fire, lightning, or thunder damage on a failed saving throw (your choice when you create the glyph), or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:glyph-of-warding',
        pointer: '/data',
        anchor:
          'A creature takes 5d8 acid, cold, fire, lightning, or thunder damage on a failed saving throw (your choice when you create the glyph), or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 151,
    source:
      'The creature takes 20 radiant damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:guardian-of-faith',
        pointer: '/data',
        anchor:
          'The creature takes 20 radiant damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 153,
    source:
      'On a failed save, it takes 14d6 necrotic damage, or half as much damage on a successful save.',
    joins: [
      {
        recordKey: 'spell:harm',
        pointer: '/data',
        anchor:
          'On a failed save, it takes 14d6 necrotic damage, or half as much damage on a successful save.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 154,
    source:
      'It takes 2d10 fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:hellish-rebuke',
        pointer: '/data',
        anchor:
          'It takes 2d10 fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 155,
    source:
      'A creature takes 2d8 bludgeoning damage and 4d6 cold damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:ice-storm',
        pointer: '/data',
        anchor:
          'A creature takes 2d8 bludgeoning damage and 4d6 cold damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 157,
    source:
      'A creature takes 10d8 fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:incendiary-cloud',
        pointer: '/data',
        anchor:
          'A creature takes 10d8 fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 157,
    source:
      'A creature takes 4d10 piercing damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:insect-plague',
        pointer: '/data',
        anchor:
          'A creature takes 4d10 piercing damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 159,
    source:
      'A creature takes 8d6 lightning damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:lightning-bolt',
        pointer: '/data',
        anchor:
          'A creature takes 8d6 lightning damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 164,
    source:
      'A creature takes 20d6 fire damage and 20d6 bludgeoning damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:meteor-swarm',
        pointer: '/data',
        anchor:
          'A creature takes 20d6 fire damage and 20d6 bludgeoning damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 166,
    source:
      'It takes 2d10 radiant damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:moonbeam',
        pointer: '/data',
        anchor:
          'It takes 2d10 radiant damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 170,
    source:
      'The target takes 10d6 fire damage on a failed save, or half as much damage on a successful one. 2.',
    joins: [
      {
        recordKey: 'spell:prismatic-spray',
        pointer: '/data',
        anchor:
          'The target takes 10d6 fire damage on a failed save, or half as much damage on a successful one. 2.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 170,
    source:
      'The target takes 10d6 acid damage on a failed save, or half as much damage on a successful one. 3.',
    joins: [
      {
        recordKey: 'spell:prismatic-spray',
        pointer: '/data',
        anchor:
          'The target takes 10d6 acid damage on a failed save, or half as much damage on a successful one. 3.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 170,
    source:
      'The target takes 10d6 lightning damage on a failed save, or half as much damage on a successful one. 4.',
    joins: [
      {
        recordKey: 'spell:prismatic-spray',
        pointer: '/data',
        anchor:
          'The target takes 10d6 lightning damage on a failed save, or half as much damage on a successful one. 4.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 170,
    source:
      'The target takes 10d6 poison damage on a failed save, or half as much damage on a successful one. 5.',
    joins: [
      {
        recordKey: 'spell:prismatic-spray',
        pointer: '/data',
        anchor:
          'The target takes 10d6 poison damage on a failed save, or half as much damage on a successful one. 5.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 170,
    source:
      'The target takes 10d6 cold damage on a failed save, or half as much damage on a successful one. 6.',
    joins: [
      {
        recordKey: 'spell:prismatic-spray',
        pointer: '/data',
        anchor:
          'The target takes 10d6 cold damage on a failed save, or half as much damage on a successful one. 6.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 171,
    source:
      'The creature takes 10d6 fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:prismatic-wall',
        pointer: '/data',
        anchor:
          'The creature takes 10d6 fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 171,
    source:
      'The creature takes 10d6 acid damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:prismatic-wall',
        pointer: '/data',
        anchor:
          'The creature takes 10d6 acid damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 171,
    source:
      'The creature takes 10d6 lightning damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:prismatic-wall',
        pointer: '/data',
        anchor:
          'The creature takes 10d6 lightning damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 171,
    source:
      'The creature takes 10d6 poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:prismatic-wall',
        pointer: '/data',
        anchor:
          'The creature takes 10d6 poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 171,
    source:
      'The creature takes 10d6 cold damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:prismatic-wall',
        pointer: '/data',
        anchor:
          'The creature takes 10d6 cold damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 178,
    source:
      'A creature takes 3d8 thunder damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:shatter',
        pointer: '/data',
        anchor:
          'A creature takes 3d8 thunder damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 182,
    source: 'On a successful save, the creature takes half as much damage.',
    joins: [
      {
        recordKey: 'spell:spirit-guardians',
        pointer: '/data',
        anchor: 'On a successful save, the creature takes half as much damage.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 183,
    source:
      'The creature takes 10d6 lightning damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:storm-of-vengeance',
        pointer: '/data',
        anchor:
          'The creature takes 10d6 lightning damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 184,
    source:
      'On a successful save, it takes half as much damage and isn’t blinded by this spell.',
    joins: [
      {
        recordKey: 'spell:sunbeam',
        pointer: '/data',
        anchor:
          'On a successful save, it takes half as much damage and isn’t blinded by this spell.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 184,
    source:
      'On a successful save, it takes half as much damage and isn’t blinded by this spell.',
    joins: [
      {
        recordKey: 'spell:sunburst',
        pointer: '/data',
        anchor:
          'On a successful save, it takes half as much damage and isn’t blinded by this spell.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 184,
    source:
      'Each target must make a Constitution saving throw, taking 10d10 necrotic damage on a failed save, or half as much damage on a successful save.',
    joins: [
      {
        recordKey: 'spell:symbol',
        pointer: '/data',
        anchor:
          'Each target must make a Constitution saving throw, taking 10d10 necrotic damage on a failed save, or half as much damage on a successful save.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 187,
    source:
      'On a successful save, the creature takes half as much damage and isn’t pushed.',
    joins: [
      {
        recordKey: 'spell:thunderwave',
        pointer: '/data',
        anchor:
          'On a successful save, the creature takes half as much damage and isn’t pushed.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 190,
    source:
      'On a failed save, a creature takes 5d8 fire damage, or half as much damage on a successful save.',
    joins: [
      {
        recordKey: 'spell:wall-of-fire',
        pointer: '/data',
        anchor:
          'On a failed save, a creature takes 5d8 fire damage, or half as much damage on a successful save.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 190,
    source:
      'On a failed save, the creature takes 10d6 cold damage, or half as much damage on a successful save.',
    joins: [
      {
        recordKey: 'spell:wall-of-ice',
        pointer: '/data',
        anchor:
          'On a failed save, the creature takes 10d6 cold damage, or half as much damage on a successful save.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 190,
    source:
      'That creature takes 5d6 cold damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:wall-of-ice',
        pointer: '/data',
        anchor:
          'That creature takes 5d6 cold damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 191,
    source:
      'On a failed save, a creature takes 7d8 piercing damage, or half as much damage on a successful save.',
    joins: [
      {
        recordKey: 'spell:wall-of-thorns',
        pointer: '/data',
        anchor:
          'On a failed save, a creature takes 7d8 piercing damage, or half as much damage on a successful save.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 191,
    source:
      'It takes 7d8 slashing damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:wall-of-thorns',
        pointer: '/data',
        anchor:
          'It takes 7d8 slashing damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 192,
    source:
      'A creature takes 3d8 bludgeoning damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'spell:wind-wall',
        pointer: '/data',
        anchor:
          'A creature takes 3d8 bludgeoning damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 196,
    source:
      'Any creature in the area beneath the unstable section must succeed on a DC 15 Dexterity saving throw, taking 22 (4d10) bludgeoning damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'hazard:collapsing-roof',
        pointer: '/data',
        anchor:
          'Any creature in the area beneath the unstable section must succeed on a DC 15 Dexterity saving throw, taking 22 (4d10) bludgeoning damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 197,
    source:
      'Each creature in the fire must make a DC 13 Dexterity saving throw, taking 22 (4d10) fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'hazard:fire-breathing-statue',
        pointer: '/data',
        anchor:
          'Each creature in the fire must make a DC 13 Dexterity saving throw, taking 22 (4d10) fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 197,
    source:
      'In that case, anyone taking piercing damage from the spikes must also make a DC 13 Constitution saving throw, taking an 22 (4d10) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'hazard:pits',
        pointer: '/data',
        anchor:
          'In that case, anyone taking piercing damage from the spikes must also make a DC 13 Constitution saving throw, taking an 22 (4d10) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 198,
    source:
      '(If there are no targets in the area, the darts don’t hit anything.) A target that is hit takes 2 (1d4) piercing damage and must succeed on a DC 15 Constitution saving throw, taking 11 (2d10) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'hazard:poison-darts',
        pointer: '/data',
        anchor:
          '(If there are no targets in the area, the darts don’t hit anything.) A target that is hit takes 2 (1d4) piercing damage and must succeed on a DC 15 Constitution saving throw, taking 11 (2d10) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 204,
    source:
      'On a successful save, the creature takes half damage and isn’t poisoned.',
    joins: [
      {
        recordKey: 'hazard:assassins-blood',
        pointer: '/data',
        anchor:
          'On a successful save, the creature takes half damage and isn’t poisoned.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 204,
    source:
      'If the poison has not been neutralized before then, the creature must succeed on a DC 17 Constitution saving throw, taking 31 (9d6) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'hazard:midnight-tears',
        pointer: '/data',
        anchor:
          'If the poison has not been neutralized before then, the creature must succeed on a DC 17 Constitution saving throw, taking 31 (9d6) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 205,
    source:
      'A creature subjected to this poison must make a DC 19 Constitution saving throw, taking 42 (12d6) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'hazard:purple-worm-poison',
        pointer: '/data',
        anchor:
          'A creature subjected to this poison must make a DC 19 Constitution saving throw, taking 42 (12d6) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 205,
    source:
      'A creature subjected to this poison must succeed on a DC 11 Constitution saving throw, taking 10 (3d6) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'hazard:serpent-venom',
        pointer: '/data',
        anchor:
          'A creature subjected to this poison must succeed on a DC 11 Constitution saving throw, taking 10 (3d6) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 205,
    source:
      'A creature subjected to this poison must make a DC 15 Constitution saving throw, taking 24 (7d6) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'hazard:wyvern-poison',
        pointer: '/data',
        anchor:
          'A creature subjected to this poison must make a DC 15 Constitution saving throw, taking 24 (7d6) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 209,
    source:
      'If a creature belonging to the type, race, or group associated with an arrow of slaying takes damage from the arrow, the creature must make a DC 17 Constitution saving throw, taking an extra 6d10 piercing damage on a failed save, or half as much extra damage on a successful one.',
    joins: [
      {
        recordKey: 'magic-item:arrow-of-slaying',
        pointer: '/data',
        anchor:
          'If a creature belonging to the type, race, or group associated with an arrow of slaying takes damage from the arrow, the creature must make a DC 17 Constitution saving throw, taking an extra 6d10 piercing damage on a failed save, or half as much extra damage on a successful one.',
        representation: 'magic-item-effect',
        effectId: 'c2-residual-slaying-damage',
      },
    ],
  },
  {
    page: 209,
    source:
      'Each creature in the area, including you, must make a DC 15 Dexterity saving throw, taking 5d4 fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'magic-item:bag-of-beans',
        pointer: '/data',
        anchor:
          'Each creature in the area, including you, must make a DC 15 Dexterity saving throw, taking 5d4 fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'magic-item-effect',
        effectId: 'c2-residual-dump-beans-explosion',
      },
    ],
  },
  {
    page: 219,
    source:
      'An elemental composed mostly of water that is exposed to a pinch of the dust must make a DC 13 Constitution saving throw, taking 10d6 necrotic damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'magic-item:dust-of-dryness',
        pointer: '/data',
        anchor:
          'An elemental composed mostly of water that is exposed to a pinch of the dust must make a DC 13 Constitution saving throw, taking 10d6 necrotic damage on a failed save, or half as much damage on a successful one.',
        representation: 'magic-item-effect',
        effectId: 'c2-residual-water-elemental-damage',
      },
    ],
  },
  {
    page: 226,
    source:
      'On a successful save, a creature takes half as much damage and isn’t deafened.',
    joins: [
      {
        recordKey: 'magic-item:horn-of-blasting',
        pointer: '/data',
        anchor:
          'On a successful save, a creature takes half as much damage and isn’t deafened.',
        representation: 'magic-item-effect',
        effectId: 'c2-blow-horn-payload',
      },
    ],
  },
  {
    page: 227,
    source:
      'Each creature in the area where the fortress appears must make a DC 15 Dexterity saving throw, taking 10d10 bludgeoning damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'magic-item:instant-fortress',
        pointer: '/data',
        anchor:
          'Each creature in the area where the fortress appears must make a DC 15 Dexterity saving throw, taking 10d10 bludgeoning damage on a failed save, or half as much damage on a successful one.',
        representation: 'magic-item-effect',
        effectId: 'c2-residual-fortress-appearance-damage',
      },
    ],
  },
  {
    page: 228,
    source:
      'Each creature in the line excluding you and the target must make a DC 13 Dexterity saving throw, taking 4d6 lightning damage on a failed save, and half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'magic-item:javelin-of-lightning',
        pointer: '/data',
        anchor:
          'Each creature in the line excluding you and the target must make a DC 13 Dexterity saving throw, taking 4d6 lightning damage on a failed save, and half as much damage on a successful one.',
        representation: 'magic-item-effect',
        effectId: 'c2-hurl-lightning-payload',
      },
    ],
  },
  {
    page: 237,
    source:
      'Each creature within a 15-foot cube originating from that point is showered in sparks and must make a DC 15 Dexterity saving throw, taking 5d4 fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'magic-item:ring-of-shooting-stars',
        pointer: '/data',
        anchor:
          'Each creature within a 15-foot cube originating from that point is showered in sparks and must make a DC 15 Dexterity saving throw, taking 5d4 fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'magic-item-effect',
        effectId: 'c2-launch-shooting-stars-payload',
      },
    ],
  },
  {
    page: 244,
    source: 'On a successful save, a creature takes half as much damage.',
    joins: [
      {
        recordKey: 'magic-item:staff-of-power',
        pointer: '/data',
        anchor: 'On a successful save, a creature takes half as much damage.',
        representation: 'untyped',
        reason:
          'The retributive strike is projected as a random-procedure outcome whose text carries the half-on-success branch; no typed save.',
      },
    ],
  },
  {
    page: 245,
    source: 'On a successful save, a creature takes half as much damage.',
    joins: [
      {
        recordKey: 'magic-item:staff-of-the-magi',
        pointer: '/data',
        anchor: 'On a successful save, a creature takes half as much damage.',
        representation: 'untyped',
        reason:
          'The retributive strike is projected as a random-procedure outcome whose text carries the half-on-success branch; no typed save.',
      },
    ],
  },
  {
    page: 246,
    source:
      'taking 9d6 lightning damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'magic-item:staff-of-thunder-and-lightning',
        pointer: '/data',
        anchor:
          'taking 9d6 lightning damage on a failed save, or half as much damage on a successful one.',
        representation: 'magic-item-effect',
        effectId: 'c2-lightning-strike-payload',
      },
    ],
  },
  {
    page: 246,
    source:
      'On a successful save, a creature takes half damage and isn’t deafened.',
    joins: [
      {
        recordKey: 'magic-item:staff-of-thunder-and-lightning',
        pointer: '/data',
        anchor:
          'On a successful save, a creature takes half damage and isn’t deafened.',
        representation: 'magic-item-effect',
        effectId: 'c2-thunderclap-payload',
      },
    ],
  },
  {
    page: 263,
    source:
      'Each creature of its choice in a 10-foot radius must make a DC 23 Dexterity saving throw, taking 14 (4d6) fire damage plus 14 (4d6) radiant damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:solar',
        pointer: '/data/legendaryActions/entries/1',
        anchor:
          'Each creature of its choice in a 10-foot radius must make a DC 23 Dexterity saving throw, taking 14 (4d6) fire damage plus 14 (4d6) radiant damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 265,
    source:
      'Each creature in that line must make a DC 13 Dexterity saving throw, taking 10 (3d6) acid damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:ankheg',
        pointer: '/data/actions/1',
        anchor:
          'Each creature in that line must make a DC 13 Dexterity saving throw, taking 10 (3d6) acid damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 266,
    source:
      'Each creature in that line must make a DC 16 Dexterity saving throw, taking 66 (12d10) lightning damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:behir',
        pointer: '/data/actions/3',
        anchor:
          'Each creature in that line must make a DC 16 Dexterity saving throw, taking 66 (12d10) lightning damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 267,
    source:
      'On a successful save, the creature takes only half the damage, isn’t knocked prone, and is pushed 5 feet out of the bulette’s space into an unoccupied space of the creature’s choice.',
    joins: [
      {
        recordKey: 'creature:bulette',
        pointer: '/data/actions/1',
        anchor:
          'On a successful save, the creature takes only half the damage, isn’t knocked prone, and is pushed 5 feet out of the bulette’s space into an unoccupied space of the creature’s choice.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 267,
    source:
      'Each creature in that area must make a DC 15 Dexterity saving throw, taking 31 (7d8) fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:chimera',
        pointer: '/data/actions/4',
        anchor:
          'Each creature in that area must make a DC 15 Dexterity saving throw, taking 31 (7d8) fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 270,
    source:
      'When the balor dies, it explodes, and each creature within 30 feet of it must make a DC 20 Dexterity saving throw, taking 70 (20d6) fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:balor',
        pointer: '/data/traits/0',
        anchor:
          'When the balor dies, it explodes, and each creature within 30 feet of it must make a DC 20 Dexterity saving throw, taking 70 (20d6) fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 277,
    source:
      'The creature then makes a DC 17 Dexterity saving throw, taking 35 (10d6) cold damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:ice-devil',
        pointer: '/data/actions/4',
        anchor:
          'The creature then makes a DC 17 Dexterity saving throw, taking 35 (10d6) cold damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 277,
    source:
      'Whenever a creature finishes moving through the frigid air on a turn, willingly or otherwise, the creature must make a DC 17 Constitution saving throw, taking 17 (5d6) cold damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:ice-devil',
        pointer: '/data/actions/4',
        anchor:
          'Whenever a creature finishes moving through the frigid air on a turn, willingly or otherwise, the creature must make a DC 17 Constitution saving throw, taking 17 (5d6) cold damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 278,
    source:
      'Hit: 5 (1d4 + 3) piercing damage, and the target must make on a DC 11 Constitution saving throw, taking 10 (3d6) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:imp',
        pointer: '/data/actions/0',
        anchor:
          'Hit: 5 (1d4 + 3) piercing damage, and the target must make on a DC 11 Constitution saving throw, taking 10 (3d6) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 280,
    source:
      'Each creature in that line must make a DC 22 Dexterity saving throw, taking 67 (15d8) acid damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:ancient-black-dragon',
        pointer: '/data/actions/5',
        anchor:
          'Each creature in that line must make a DC 22 Dexterity saving throw, taking 67 (15d8) acid damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 281,
    source:
      'Each creature in that line must make a DC 18 Dexterity saving throw, taking 54 (12d8) acid damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:adult-black-dragon',
        pointer: '/data/actions/5',
        anchor:
          'Each creature in that line must make a DC 18 Dexterity saving throw, taking 54 (12d8) acid damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 282,
    source:
      'Each creature in that line must make a DC 14 Dexterity saving throw, taking 49 (11d8) acid damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:young-black-dragon',
        pointer: '/data/actions/3',
        anchor:
          'Each creature in that line must make a DC 14 Dexterity saving throw, taking 49 (11d8) acid damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 282,
    source:
      'Each creature in that line must make a DC 11 Dexterity saving throw, taking 22 (5d8) acid damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:black-dragon-wyrmling',
        pointer: '/data/actions/1',
        anchor:
          'Each creature in that line must make a DC 11 Dexterity saving throw, taking 22 (5d8) acid damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 282,
    source:
      'Each creature in that line must make a DC 23 Dexterity saving throw, taking 88 (16d10) lightning damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:ancient-blue-dragon',
        pointer: '/data/actions/5',
        anchor:
          'Each creature in that line must make a DC 23 Dexterity saving throw, taking 88 (16d10) lightning damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 283,
    source:
      'Each creature in that line must make a DC 19 Dexterity saving throw, taking 66 (12d10) lightning damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:adult-blue-dragon',
        pointer: '/data/actions/5',
        anchor:
          'Each creature in that line must make a DC 19 Dexterity saving throw, taking 66 (12d10) lightning damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 284,
    source:
      'Each creature in that line must make a DC 16 Dexterity saving throw, taking 55 (10d10) lightning damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:young-blue-dragon',
        pointer: '/data/actions/3',
        anchor:
          'Each creature in that line must make a DC 16 Dexterity saving throw, taking 55 (10d10) lightning damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 284,
    source:
      'Each creature in that line must make a DC 12 Dexterity saving throw, taking 22 (4d10) lightning damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:blue-dragon-wyrmling',
        pointer: '/data/actions/1',
        anchor:
          'Each creature in that line must make a DC 12 Dexterity saving throw, taking 22 (4d10) lightning damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 285,
    source:
      'Each creature in that area must make a DC 22 Constitution saving throw, taking 77 (22d6) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:ancient-green-dragon',
        pointer: '/data/actions/5',
        anchor:
          'Each creature in that area must make a DC 22 Constitution saving throw, taking 77 (22d6) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 285,
    source:
      'Each creature in that area must make a DC 18 Constitution saving throw, taking 56 (16d6) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:adult-green-dragon',
        pointer: '/data/actions/5',
        anchor:
          'Each creature in that area must make a DC 18 Constitution saving throw, taking 56 (16d6) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 286,
    source:
      'Each creature in that area must make a DC 14 Constitution saving throw, taking 42 (12d6) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:young-green-dragon',
        pointer: '/data/actions/3',
        anchor:
          'Each creature in that area must make a DC 14 Constitution saving throw, taking 42 (12d6) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 286,
    source:
      'Each creature in that area must make a DC 11 Constitution saving throw, taking 21 (6d6) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:green-dragon-wyrmling',
        pointer: '/data/actions/1',
        anchor:
          'Each creature in that area must make a DC 11 Constitution saving throw, taking 21 (6d6) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 287,
    source:
      'Each creature in that area must make a DC 24 Dexterity saving throw, taking 91 (26d6) fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:ancient-red-dragon',
        pointer: '/data/actions/5',
        anchor:
          'Each creature in that area must make a DC 24 Dexterity saving throw, taking 91 (26d6) fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 287,
    source:
      'Each creature in that area must make a DC 21 Dexterity saving throw, taking 63 (18d6) fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:adult-red-dragon',
        pointer: '/data/actions/5',
        anchor:
          'Each creature in that area must make a DC 21 Dexterity saving throw, taking 63 (18d6) fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 288,
    source:
      'Each creature in that area must make a DC 17 Dexterity saving throw, taking 56 (16d6) fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:young-red-dragon',
        pointer: '/data/actions/3',
        anchor:
          'Each creature in that area must make a DC 17 Dexterity saving throw, taking 56 (16d6) fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 288,
    source:
      'Each creature in that area must make a DC 13 Dexterity saving throw, taking 24 (7d6) fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:red-dragon-wyrmling',
        pointer: '/data/actions/1',
        anchor:
          'Each creature in that area must make a DC 13 Dexterity saving throw, taking 24 (7d6) fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 289,
    source:
      'Each creature in that area must make a DC 22 Constitution saving throw, taking 72 (16d8) cold damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:ancient-white-dragon',
        pointer: '/data/actions/5',
        anchor:
          'Each creature in that area must make a DC 22 Constitution saving throw, taking 72 (16d8) cold damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 289,
    source:
      'Each creature in that area must make a DC 19 Constitution saving throw, taking 54 (12d8) cold damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:adult-white-dragon',
        pointer: '/data/actions/5',
        anchor:
          'Each creature in that area must make a DC 19 Constitution saving throw, taking 54 (12d8) cold damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 290,
    source:
      'Each creature in that area must make a DC 15 Constitution saving throw, taking 45 (10d8) cold damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:young-white-dragon',
        pointer: '/data/actions/3',
        anchor:
          'Each creature in that area must make a DC 15 Constitution saving throw, taking 45 (10d8) cold damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 290,
    source:
      'Each creature in that area must make a DC 12 Constitution saving throw, taking 22 (5d8) cold damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:white-dragon-wyrmling',
        pointer: '/data/actions/1',
        anchor:
          'Each creature in that area must make a DC 12 Constitution saving throw, taking 22 (5d8) cold damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 291,
    source:
      'Each creature in that line must make a DC 21 Dexterity saving throw, taking 56 (16d6) fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:ancient-brass-dragon',
        pointer: '/data/actions/6',
        anchor:
          'Each creature in that line must make a DC 21 Dexterity saving throw, taking 56 (16d6) fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 292,
    source:
      'Each creature in that line must make a DC 18 Dexterity saving throw, taking 45 (13d6) fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:adult-brass-dragon',
        pointer: '/data/actions/6',
        anchor:
          'Each creature in that line must make a DC 18 Dexterity saving throw, taking 45 (13d6) fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 292,
    source:
      'Each creature in that line must make a DC 14 Dexterity saving throw, taking 42 (12d6) fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:young-brass-dragon',
        pointer: '/data/actions/4',
        anchor:
          'Each creature in that line must make a DC 14 Dexterity saving throw, taking 42 (12d6) fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 293,
    source:
      'Each creature in that line must make a DC 11 Dexterity saving throw, taking 14 (4d6) fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:brass-dragon-wyrmling',
        pointer: '/data/actions/2',
        anchor:
          'Each creature in that line must make a DC 11 Dexterity saving throw, taking 14 (4d6) fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 293,
    source:
      'Each creature in that line must make a DC 23 Dexterity saving throw, taking 88 (16d10) lightning damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:ancient-bronze-dragon',
        pointer: '/data/actions/6',
        anchor:
          'Each creature in that line must make a DC 23 Dexterity saving throw, taking 88 (16d10) lightning damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 294,
    source:
      'Each creature in that line must make a DC 19 Dexterity saving throw, taking 66 (12d10) lightning damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:adult-bronze-dragon',
        pointer: '/data/actions/6',
        anchor:
          'Each creature in that line must make a DC 19 Dexterity saving throw, taking 66 (12d10) lightning damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 295,
    source:
      'Each creature in that line must make a DC 15 Dexterity saving throw, taking 55 (10d10) lightning damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:young-bronze-dragon',
        pointer: '/data/actions/4',
        anchor:
          'Each creature in that line must make a DC 15 Dexterity saving throw, taking 55 (10d10) lightning damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 295,
    source:
      'Each creature in that line must make a DC 12 Dexterity saving throw, taking 16 (3d10) lightning damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:bronze-dragon-wyrmling',
        pointer: '/data/actions/2',
        anchor:
          'Each creature in that line must make a DC 12 Dexterity saving throw, taking 16 (3d10) lightning damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 296,
    source:
      'Each creature in that line must make a DC 22 Dexterity saving throw, taking 63 (14d8) acid damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:ancient-copper-dragon',
        pointer: '/data/actions/6',
        anchor:
          'Each creature in that line must make a DC 22 Dexterity saving throw, taking 63 (14d8) acid damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 297,
    source:
      'Each creature in that line must make a DC 18 Dexterity saving throw, taking 54 (12d8) acid damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:adult-copper-dragon',
        pointer: '/data/actions/6',
        anchor:
          'Each creature in that line must make a DC 18 Dexterity saving throw, taking 54 (12d8) acid damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 297,
    source:
      'Each creature in that line must make a DC 14 Dexterity saving throw, taking 40 (9d8) acid damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:young-copper-dragon',
        pointer: '/data/actions/4',
        anchor:
          'Each creature in that line must make a DC 14 Dexterity saving throw, taking 40 (9d8) acid damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 298,
    source:
      'Each creature in that line must make a DC 11 Dexterity saving throw, taking 18 (4d8) acid damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:copper-dragon-wyrmling',
        pointer: '/data/actions/2',
        anchor:
          'Each creature in that line must make a DC 11 Dexterity saving throw, taking 18 (4d8) acid damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 299,
    source:
      'Each creature in that area must make a DC 24 Dexterity saving throw, taking 71 (13d10) fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:ancient-gold-dragon',
        pointer: '/data/actions/6',
        anchor:
          'Each creature in that area must make a DC 24 Dexterity saving throw, taking 71 (13d10) fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 299,
    source:
      'Each creature in that area must make a DC 21 Dexterity saving throw, taking 66 (12d10) fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:adult-gold-dragon',
        pointer: '/data/actions/6',
        anchor:
          'Each creature in that area must make a DC 21 Dexterity saving throw, taking 66 (12d10) fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 300,
    source:
      'Each creature in that area must make a DC 17 Dexterity saving throw, taking 55 (10d10) fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:young-gold-dragon',
        pointer: '/data/actions/4',
        anchor:
          'Each creature in that area must make a DC 17 Dexterity saving throw, taking 55 (10d10) fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 301,
    source:
      'Each creature in that area must make a DC 13 Dexterity saving throw, taking 22 (4d10) fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:gold-dragon-wyrmling',
        pointer: '/data/actions/2',
        anchor:
          'Each creature in that area must make a DC 13 Dexterity saving throw, taking 22 (4d10) fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 301,
    source:
      'Each creature in that area must make a DC 24 Constitution saving throw, taking 67 (15d8) cold damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:ancient-silver-dragon',
        pointer: '/data/actions/6',
        anchor:
          'Each creature in that area must make a DC 24 Constitution saving throw, taking 67 (15d8) cold damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 302,
    source:
      'Each creature in that area must make a DC 20 Constitution saving throw, taking 58 (13d8) cold damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:adult-silver-dragon',
        pointer: '/data/actions/6',
        anchor:
          'Each creature in that area must make a DC 20 Constitution saving throw, taking 58 (13d8) cold damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 303,
    source:
      'Each creature in that area must make a DC 17 Constitution saving throw, taking 54 (12d8) cold damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:young-silver-dragon',
        pointer: '/data/actions/4',
        anchor:
          'Each creature in that area must make a DC 17 Constitution saving throw, taking 54 (12d8) cold damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 303,
    source:
      'Each creature in that area must make a DC 13 Constitution saving throw, taking 18 (4d8) cold damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:silver-dragon-wyrmling',
        pointer: '/data/actions/2',
        anchor:
          'Each creature in that area must make a DC 13 Constitution saving throw, taking 18 (4d8) cold damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 304,
    source:
      'Each creature in that area must make a DC 18 Constitution saving throw, taking 52 (15d6) fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:dragon-turtle',
        pointer: '/data/actions/4',
        anchor:
          'Each creature in that area must make a DC 18 Constitution saving throw, taking 52 (15d6) fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 306,
    source:
      'If the saving throw is successful, the target takes half the bludgeoning damage and isn’t flung away or knocked prone.',
    joins: [
      {
        recordKey: 'creature:air-elemental',
        pointer: '/data/actions/2',
        anchor:
          'If the saving throw is successful, the target takes half the bludgeoning damage and isn’t flung away or knocked prone.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 314,
    source:
      'Each creature within 10 feet of that point must make a DC 17 Dexterity saving throw, taking 54 (12d8) lightning damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:storm-giant',
        pointer: '/data/actions/3',
        anchor:
          'Each creature within 10 feet of that point must make a DC 17 Dexterity saving throw, taking 54 (12d8) lightning damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 317,
    source:
      'Each creature in that area must make a DC 19 Constitution saving throw, taking 45 (10d8) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:iron-golem',
        pointer: '/data/actions/3',
        anchor:
          'Each creature in that area must make a DC 19 Constitution saving throw, taking 45 (10d8) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 321,
    source:
      'Each creature in that area must make a DC 15 Dexterity saving throw, taking 24 (7d6) fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:half-red-dragon-veteran',
        pointer: '/data/actions/4',
        anchor:
          'Each creature in that area must make a DC 15 Dexterity saving throw, taking 24 (7d6) fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 322,
    source:
      'Each creature in that area must make a DC 12 Dexterity saving throw, taking 21 (6d6) fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:hell-hound',
        pointer: '/data/actions/1',
        anchor:
          'Each creature in that area must make a DC 12 Dexterity saving throw, taking 21 (6d6) fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 325,
    source:
      'lightning damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:kraken',
        pointer: '/data/actions/4',
        anchor:
          'lightning damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 325,
    source:
      'Each creature other than the kraken that ends its turn there must succeed on a DC 23 Constitution saving throw, taking 16 (3d10) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:kraken',
        pointer: '/data/legendaryActions/entries/2',
        anchor:
          'Each creature other than the kraken that ends its turn there must succeed on a DC 23 Constitution saving throw, taking 16 (3d10) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 326,
    source:
      'Each non-undead creature within 20 feet of the lich must make a DC 18 Constitution saving throw against this magic, taking 21 (6d6) necrotic damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:lich',
        pointer: '/data/legendaryActions/entries/3',
        anchor:
          'Each non-undead creature within 20 feet of the lich must make a DC 18 Constitution saving throw against this magic, taking 21 (6d6) necrotic damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 329,
    source:
      'Each creature within 10 feet of it must make a DC 11 Dexterity saving throw, taking 7 (2d6) fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:magmin',
        pointer: '/data/traits/0',
        anchor:
          'Each creature within 10 feet of it must make a DC 11 Dexterity saving throw, taking 7 (2d6) fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 331,
    source:
      'Each creature within 5 feet of it must make a DC 10 Dexterity saving throw, taking 4 (1d8) slashing damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:ice-mephit',
        pointer: '/data/traits/0',
        anchor:
          'Each creature within 5 feet of it must make a DC 10 Dexterity saving throw, taking 4 (1d8) slashing damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 331,
    source:
      'Each creature in that area must succeed on a DC 10 Dexterity saving throw, taking 5 (2d4) cold damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:ice-mephit',
        pointer: '/data/actions/1',
        anchor:
          'Each creature in that area must succeed on a DC 10 Dexterity saving throw, taking 5 (2d4) cold damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 331,
    source:
      'Each creature within 5 feet of it must make a DC 11 Dexterity saving throw, taking 7 (2d6) fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:magma-mephit',
        pointer: '/data/traits/0',
        anchor:
          'Each creature within 5 feet of it must make a DC 11 Dexterity saving throw, taking 7 (2d6) fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 331,
    source:
      'Each creature in that area must make a DC 11 Dexterity saving throw, taking 7 (2d6) fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:magma-mephit',
        pointer: '/data/actions/1',
        anchor:
          'Each creature in that area must make a DC 11 Dexterity saving throw, taking 7 (2d6) fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 332,
    source:
      'Each creature in that area must succeed on a DC 10 Dexterity saving throw, taking 4 (1d8) fire damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:steam-mephit',
        pointer: '/data/actions/1',
        anchor:
          'Each creature in that area must succeed on a DC 10 Dexterity saving throw, taking 4 (1d8) fire damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 335,
    source:
      'Hit: 8 (1d8 + 4) piercing damage, and the target must make a DC 15 Constitution saving throw, taking 45 (10d8) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:guardian-naga',
        pointer: '/data/actions/0',
        anchor:
          'Hit: 8 (1d8 + 4) piercing damage, and the target must make a DC 15 Constitution saving throw, taking 45 (10d8) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 335,
    source:
      'Hit: The target must make a DC 15 Constitution saving throw, taking 45 (10d8) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:guardian-naga',
        pointer: '/data/actions/1',
        anchor:
          'Hit: The target must make a DC 15 Constitution saving throw, taking 45 (10d8) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 336,
    source:
      'Hit: 7 (1d6 + 4) piercing damage, and the target must make a DC 13 Constitution saving throw, taking 31 (7d8) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:spirit-naga',
        pointer: '/data/actions/0',
        anchor:
          'Hit: 7 (1d6 + 4) piercing damage, and the target must make a DC 13 Constitution saving throw, taking 31 (7d8) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 339,
    source:
      'On a successful save, the target takes half the bludgeoning damage and isn’t stunned.',
    joins: [
      {
        recordKey: 'creature:otyugh',
        pointer: '/data/actions/3',
        anchor:
          'On a successful save, the target takes half the bludgeoning damage and isn’t stunned.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 341,
    source:
      'Hit: 19 (3d6 + 9) piercing damage, and the target must make a DC 19 Constitution saving throw, taking 42 (12d6) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:purple-worm',
        pointer: '/data/actions/2',
        anchor:
          'Hit: 19 (3d6 + 9) piercing damage, and the target must make a DC 19 Constitution saving throw, taking 42 (12d6) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 348,
    source:
      'On a successful save, the creature takes half as much damage and isn’t knocked prone.',
    joins: [
      {
        recordKey: 'creature:androsphinx',
        pointer: '/data/actions/5',
        anchor:
          'On a successful save, the creature takes half as much damage and isn’t knocked prone.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 350,
    source:
      'Constitution saving throw against this magic, taking 32 (5d10 + 5) psychic damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:succubus-incubus',
        pointer: '/data/actions/2',
        anchor:
          'Constitution saving throw against this magic, taking 32 (5d10 + 5) psychic damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 356,
    source:
      'The target must make a DC 15 Constitution saving throw, taking 24 (7d6) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:wyvern',
        pointer: '/data/actions/3',
        anchor:
          'The target must make a DC 15 Constitution saving throw, taking 24 (7d6) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 378,
    source:
      'Hit: 6 (1d4 + 4) piercing damage, and the target must make a DC 11 Constitution saving throw, taking 10 (3d6) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:giant-poisonous-snake',
        pointer: '/data/actions/0',
        anchor:
          'Hit: 6 (1d4 + 4) piercing damage, and the target must make a DC 11 Constitution saving throw, taking 10 (3d6) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 378,
    source:
      'Hit: 7 (1d10 + 2) piercing damage, and the target must make a DC 12 Constitution saving throw, taking 22 (4d10) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:giant-scorpion',
        pointer: '/data/actions/2',
        anchor:
          'Hit: 7 (1d10 + 2) piercing damage, and the target must make a DC 12 Constitution saving throw, taking 22 (4d10) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 379,
    source:
      'Hit: 7 (1d8 + 3) piercing damage, and the target must make a DC 11 Constitution saving throw, taking 9 (2d8) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:giant-spider',
        pointer: '/data/actions/0',
        anchor:
          'Hit: 7 (1d8 + 3) piercing damage, and the target must make a DC 11 Constitution saving throw, taking 9 (2d8) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 381,
    source:
      'target must make a DC 11 Constitution saving throw, taking 10 (3d6) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:giant-wasp',
        pointer: '/data/actions/0',
        anchor:
          'target must make a DC 11 Constitution saving throw, taking 10 (3d6) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 381,
    source:
      'Hit: 4 (1d6 + 1) piercing damage, and the target must make a DC 11 Constitution saving throw, taking 7 (2d6) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:giant-wolf-spider',
        pointer: '/data/actions/0',
        anchor:
          'Hit: 4 (1d6 + 1) piercing damage, and the target must make a DC 11 Constitution saving throw, taking 7 (2d6) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 386,
    source:
      'Hit: 7 (1d10 + 2) piercing damage, and the target must make a DC 11 Constitution saving throw, taking 18 (4d8) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:phase-spider',
        pointer: '/data/actions/0',
        anchor:
          'Hit: 7 (1d10 + 2) piercing damage, and the target must make a DC 11 Constitution saving throw, taking 18 (4d8) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 386,
    source:
      'Hit: 1 piercing damage, and the target must make a DC 10 Constitution saving throw, taking 5 (2d4) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:poisonous-snake',
        pointer: '/data/actions/0',
        anchor:
          'Hit: 1 piercing damage, and the target must make a DC 10 Constitution saving throw, taking 5 (2d4) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 389,
    source:
      'Hit: 1 piercing damage, and the target must make a DC 9 Constitution saving throw, taking 4 (1d8) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:scorpion',
        pointer: '/data/actions/0',
        anchor:
          'Hit: 1 piercing damage, and the target must make a DC 9 Constitution saving throw, taking 4 (1d8) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 390,
    source:
      'The target must make a DC 10 Constitution saving throw, taking 14 (4d6) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:swarm-of-poisonous-snakes',
        pointer: '/data/actions/0',
        anchor:
          'The target must make a DC 10 Constitution saving throw, taking 14 (4d6) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 393,
    source:
      'Each creature in that area must make a DC 12 Dexterity saving throw, taking 18 (4d8) cold damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:winter-wolf',
        pointer: '/data/actions/1',
        anchor:
          'Each creature in that area must make a DC 12 Dexterity saving throw, taking 18 (4d8) cold damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 396,
    source:
      'If the assassin is subjected to an effect that allows it to make a Dexterity saving throw to take only half damage, the assassin instead takes no damage if it succeeds on the saving throw, and only half damage if it fails.',
    joins: [
      {
        recordKey: 'creature:assassin',
        pointer: '/data/traits/1',
        anchor:
          'If the assassin is subjected to an effect that allows it to make a Dexterity saving throw to take only half damage, the assassin instead takes no damage if it succeeds on the saving throw, and only half damage if it fails.',
        representation: 'not-a-member',
        reason:
          "Evasion trait: modifies other effects' half-damage saves; not itself a save whose success halves damage.",
      },
    ],
  },
  {
    page: 396,
    source:
      'Hit: 6 (1d6 + 3) piercing damage, and the target must make a DC 15 Constitution saving throw, taking 24 (7d6) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:assassin',
        pointer: '/data/actions/1',
        anchor:
          'Hit: 6 (1d6 + 3) piercing damage, and the target must make a DC 15 Constitution saving throw, taking 24 (7d6) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
  {
    page: 396,
    source:
      'Hit: 7 (1d8 + 3) piercing damage, and the target must make a DC 15 Constitution saving throw, taking 24 (7d6) poison damage on a failed save, or half as much damage on a successful one.',
    joins: [
      {
        recordKey: 'creature:assassin',
        pointer: '/data/actions/2',
        anchor:
          'Hit: 7 (1d8 + 3) piercing damage, and the target must make a DC 15 Constitution saving throw, taking 24 (7d6) poison damage on a failed save, or half as much damage on a successful one.',
        representation: 'typed-save',
      },
    ],
  },
];
