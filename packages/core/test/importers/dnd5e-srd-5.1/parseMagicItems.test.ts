/**
 * Magic-item parser unit tests for the D&D 5e SRD 5.1 importer (loreweaver-ecr).
 *
 * Magic item text excerpts in this file are reproduced from the System
 * Reference Document 5.1 by Wizards of the Coast LLC, available under the
 * Creative Commons Attribution 4.0 International License (CC-BY-4.0). Excerpts
 * are used as parser test input; no modification has been made beyond
 * reformatting to match the importer's extracted-line input shape.
 */

import { describe, expect, it } from 'vitest';
import { parseMagicItems } from '../../../scripts/importers/dnd5e-srd-5.1/parseMagicItems.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

function tieredPage(
  pageNumber: number,
  entries: readonly (readonly [line: string, height: number])[],
): PageText {
  return {
    pageNumber,
    lines: entries.map(([line]) => line),
    lineHeights: entries.map(([, height]) => height),
  };
}

const MAGIC_ITEMS_A_Z_PAGE = page(207, [
  'Magic items are presented in alphabetical order. A',
  'magic item’s description gives the item’s name, its',
  'category, its rarity, and its magical properties.',
  'Adamantine Armor',
  'Armor (medium or heavy, but not hide), uncommon',
  'This suit of armor is reinforced with adamantine,',
  'one of the hardest substances in existence. While',
  'you’re wearing it, any critical hit against you',
  'becomes a normal hit.',
  'Ammunition, +1, +2, or +3',
  'Weapon (any ammunition), uncommon (+1), rare',
  '(+2), or very rare (+3)',
  'You have a bonus to attack and damage rolls made',
  'with this piece of magic ammunition. The bonus is',
  'determined by the rarity of the ammunition. Once it',
  'hits a target, the ammunition is no longer magical.',
  'Amulet of Health',
  'Wondrous item, rare (requires attunement)',
  'Your Constitution score is 19 while you wear this',
  'amulet. It has no effect on you if your Constitution is',
  'already 19 or higher.',
  'Amulet of Proof against Detection and',
  'Location',
  'Wondrous item, uncommon (requires attunement)',
  'While wearing this amulet, you are hidden from',
  'divination magic. You can’t be targeted by such',
  'magic or perceived through magical scrying sensors.',
]);

const EMBEDDED_TABLE_PAGE = page(208, [
  'Apparatus of the Crab',
  'Wondrous item, legendary',
  'The apparatus of the Crab is a Large object with',
  'the following statistics:',
  'Armor Class: 20',
  'Hit Points: 200',
  'Each lever, from left to right, functions as shown in',
  'the Apparatus of the Crab Levers table.',
  'Apparatus of the Crab Levers',
  'Lever Up Down',
  '1 Legs and tail extend, Legs and tail retract,',
  'allowing the apparatus reducing the apparatus’s',
  'to walk and swim. speed to 0 and making it',
  'unable to benefit from',
  'bonuses to speed.',
  'Armor, +1, +2, or +3',
  'Armor (light, medium, or heavy), rare (+1), very rare',
  '(+2), or legendary (+3)',
  'You have a bonus to AC while wearing this armor.',
  'The bonus is determined by its rarity.',
]);

const TABLE_ROW_BEFORE_NEXT_ITEM_PAGE = page(209, [
  'Armor of Resistance',
  'Armor (light, medium, or heavy), rare (requires attunement)',
  'You have resistance to one type of damage while you',
  'wear this armor. The DM chooses the type or',
  'determines it randomly from the options below.',
  'd10 Damage Type d10 Damage Type',
  '1 Acid 6 Necrotic',
  '2 Cold 7 Poison',
  '3 Fire 8 Psychic',
  'Armor of Vulnerability',
  'Armor (plate), rare (requires attunement)',
  'While wearing this armor, you have resistance to one',
  'of the following damage types: bludgeoning,',
  'piercing, or slashing.',
  'Belt of Giant Strength',
  'Wondrous item, rarity varies (requires attunement)',
  'While wearing this belt, your Strength score changes',
  'to a score granted by the belt.',
  'Type Strength Rarity',
  'Hill giant 21 Rare',
  'Stone/frost giant 23 Very rare',
  'Fire giant 25 Very rare',
  'Cloud giant 27 Legendary',
  'Storm giant 29 Legendary',
  'Berserker Axe',
  'Weapon (any axe), rare (requires attunement)',
  'You gain a +1 bonus to attack and damage rolls',
  'made with this magic weapon.',
]);

const ATTUNEMENT_REQUIREMENT_PAGE = page(235, [
  'Staff of Power',
  'Staff, very rare (requires attunement by a sorcerer,',
  'warlock, or wizard)',
  'This staff can be wielded as a magic quarterstaff',
  'that grants a +2 bonus to attack and damage rolls.',
]);

const INTERLEAVED_BODY_PAGE = page(236, [
  'Damage Immunities necrotic, poison',
  'Defender',
  'Condition Immunities charmed, frightened, paralyzed,',
  'Weapon (any sword), legendary (requires',
  'petrified, poisoned, unconscious',
  'attunement)',
  'You gain a +3 bonus to attack and damage rolls',
  'made with this magic weapon.',
  'Demon Armor',
  'Actions',
  'Armor (plate), very rare (requires attunement)',
  'While wearing this armor, you gain a +1 bonus to AC.',
  'Dragon Scale Mail',
  'Armor (scale mail), very rare (requires attunement)',
  'Dragon Resistance Dragon Resistance',
  'Black Acid Gold Fire',
  'Blue Lightning Green Poison',
  'Brass Fire Red Fire',
  'Bronze Lightning Silver Cold',
  'Copper Acid White Cold',
  'Dragon Slayer',
  'Weapon (any sword), rare',
  'You gain a +1 bonus to attack and damage rolls.',
  'Ring of Animal Influence',
  'Ring, rare',
  '• Speak with animals',
  'Ring of Djinni Summoning',
  'Ring, legendary (requires attunement)',
  'While wearing this ring, you can speak its command word.',
  'Ring of Jumping',
  '• You can cast the following spells from the ring,',
  'Ring, uncommon (requires attunement)',
  'While wearing this ring, you can cast the jump spell.',
  'Ring of Feather Falling',
  'additional properties: Ring, rare (requires attunement)',
  'When you fall while wearing this ring, you descend safely.',
  'While touching the tree and using another action to',
  'speak its command word, you return the staff to its',
  'normal form.',
  'Staff of Thunder and Lightning',
  'Staff, very rare (requires attunement)',
  'This staff can be wielded as a magic quarterstaff.',
]);

describe('parseMagicItems', () => {
  const results = parseMagicItems([
    MAGIC_ITEMS_A_Z_PAGE,
    EMBEDDED_TABLE_PAGE,
    TABLE_ROW_BEFORE_NEXT_ITEM_PAGE,
    ATTUNEMENT_REQUIREMENT_PAGE,
  ]);
  const byName = new Map(results.map((item) => [item.name, item]));

  it('extracts representative SRD 5.1 magic items sorted by name', () => {
    expect(results.map((item) => item.name)).toEqual([
      'Adamantine Armor',
      'Ammunition, +1, +2, or +3',
      'Amulet of Health',
      'Amulet of Proof against Detection and Location',
      'Apparatus of the Crab',
      'Armor of Resistance',
      'Armor of Vulnerability',
      'Armor, +1, +2, or +3',
      'Belt of Giant Strength',
      'Berserker Axe',
      'Staff of Power',
    ]);
  });

  it('parses item category/type and rarity text', () => {
    expect(byName.get('Adamantine Armor')).toMatchObject({
      itemType: 'Armor (medium or heavy, but not hide)',
      rarity: 'uncommon',
      requiresAttunement: false,
    });
    expect(byName.get('Ammunition, +1, +2, or +3')).toMatchObject({
      itemType: 'Weapon (any ammunition)',
      rarity: 'uncommon (+1), rare (+2), or very rare (+3)',
    });
  });

  it('parses attunement requirements from the category line', () => {
    expect(byName.get('Amulet of Health')).toMatchObject({
      requiresAttunement: true,
    });
    expect(
      byName.get('Amulet of Health')?.attunementRequirement,
    ).toBeUndefined();
    expect(byName.get('Staff of Power')).toMatchObject({
      requiresAttunement: true,
      attunementRequirement: 'by a sorcerer, warlock, or wizard',
    });
  });

  it('captures wrapped names and wrapped category lines', () => {
    const amulet = byName.get('Amulet of Proof against Detection and Location');
    expect(amulet?.itemType).toBe('Wondrous item');
    expect(amulet?.rarity).toBe('uncommon');
    expect(amulet?.description).toMatch(/hidden from divination magic/);

    const armor = byName.get('Armor, +1, +2, or +3');
    expect(armor?.rarity).toBe('rare (+1), very rare (+2), or legendary (+3)');
  });

  it('keeps embedded table text inside the item description', () => {
    const apparatus = byName.get('Apparatus of the Crab');
    expect(apparatus?.description).toContain('Apparatus of the Crab Levers');
    expect(apparatus?.description).toContain('Lever Up Down');
    expect(apparatus?.description).toContain('Legs and tail extend');
  });

  it('keeps table rows out of following item names', () => {
    expect(byName.get('Armor of Resistance')?.description).toContain(
      '1 Acid 6 Necrotic',
    );
    expect(byName.get('Armor of Vulnerability')).toMatchObject({
      itemType: 'Armor (plate)',
      rarity: 'rare',
    });
    expect(byName.get('Belt of Giant Strength')?.description).toContain(
      'Type Strength Rarity',
    );
    expect(byName.get('Berserker Axe')).toMatchObject({
      itemType: 'Weapon (any axe)',
      rarity: 'rare',
    });
    expect(results.map((item) => item.name)).not.toContain(
      '1 Acid 6 Necrotic 2 Cold 7 Poison 3 Fire 8 Psychic Armor of Vulnerability',
    );
    expect(results.map((item) => item.name)).not.toContain(
      'Type Strength Rarity Hill giant 21 Rare Stone/frost giant 23 Very rare Fire giant 25 Very rare Cloud giant 27 Legendary Storm giant 29 Legendary Berserker Axe',
    );
  });

  it('does not bleed one item body into the next item', () => {
    const apparatus = byName.get('Apparatus of the Crab');
    expect(apparatus?.description).not.toContain('Armor, +1, +2, or +3');
    expect(apparatus?.description).not.toContain('bonus to AC');
  });

  it('records sourcePage from the page the item name appears on', () => {
    expect(byName.get('Adamantine Armor')?.sourcePage).toBe(207);
    expect(byName.get('Apparatus of the Crab')?.sourcePage).toBe(208);
  });

  it('returns an empty array when no category/rarity line is present', () => {
    expect(
      parseMagicItems([
        page(207, [
          'Magic Items A-Z',
          'This prose mentions rare magic items but has no item entry.',
        ]),
      ]),
    ).toEqual([]);
  });

  it('skips interleaved body lines between item names and category lines', () => {
    const interleaved = parseMagicItems([INTERLEAVED_BODY_PAGE]);
    expect(interleaved.map((item) => item.name)).toEqual([
      'Defender',
      'Demon Armor',
      'Dragon Scale Mail',
      'Dragon Slayer',
      'Ring of Animal Influence',
      'Ring of Djinni Summoning',
      'Ring of Feather Falling',
      'Ring of Jumping',
      'Staff of Thunder and Lightning',
    ]);
    expect(interleaved.map((item) => item.name)).not.toContain(
      'Damage Immunities necrotic, poison Defender Condition Immunities charmed, frightened, paralyzed,',
    );
    expect(interleaved.map((item) => item.name)).not.toContain(
      'Dragon Resistance Dragon Resistance Black Acid Gold Fire Blue Lightning Green Poison Brass Fire Red Fire Bronze Lightning Silver Cold Copper Acid White Cold Dragon Slayer',
    );
    expect(interleaved.map((item) => item.name)).not.toContain(
      'Ring of Jumping • You can cast the following spells from the ring,',
    );
    expect(interleaved.map((item) => item.name)).not.toContain(
      '• Speak with animals Ring of Djinni Summoning',
    );
  });

  it('parses interleaved category continuations without absorbing body lines', () => {
    const byInterleavedName = new Map(
      parseMagicItems([INTERLEAVED_BODY_PAGE]).map((item) => [item.name, item]),
    );
    expect(byInterleavedName.get('Defender')).toMatchObject({
      itemType: 'Weapon (any sword)',
      rarity: 'legendary',
      requiresAttunement: true,
    });
    expect(
      byInterleavedName.get('Defender')?.attunementRequirement,
    ).toBeUndefined();
    expect(byInterleavedName.get('Demon Armor')).toMatchObject({
      itemType: 'Armor (plate)',
      rarity: 'very rare',
      requiresAttunement: true,
    });
    expect(byInterleavedName.get('Ring of Feather Falling')).toMatchObject({
      itemType: 'Ring',
      rarity: 'rare',
      requiresAttunement: true,
    });
    expect(
      byInterleavedName.get('Staff of Thunder and Lightning'),
    ).toMatchObject({
      itemType: 'Staff',
      rarity: 'very rare',
      requiresAttunement: true,
    });
  });

  it('parses category starts whose rarity wraps to the next line', () => {
    const parsed = parseMagicItems([
      page(248, [
        'Vicious Weapon',
        'Weapon (any), rare',
        'When you roll a 20 on your attack roll with this',
        'magic weapon, your critical hit deals extra damage.',
        'Vorpal Sword',
        'Weapon (any sword that deals slashing damage),',
        'legendary (requires attunement)',
        'You gain a +3 bonus to attack and damage rolls',
        'made with this magic weapon.',
        'Wand of Binding',
        'Wand, rare (requires attunement by a spellcaster)',
        'This wand has 7 charges for the following properties.',
      ]),
    ]);
    const byParsedName = new Map(parsed.map((item) => [item.name, item]));

    expect(parsed.map((item) => item.name)).toEqual([
      'Vicious Weapon',
      'Vorpal Sword',
      'Wand of Binding',
    ]);
    expect(byParsedName.get('Vorpal Sword')).toMatchObject({
      itemType: 'Weapon (any sword that deals slashing damage)',
      rarity: 'legendary',
      requiresAttunement: true,
    });
    expect(byParsedName.get('Vicious Weapon')?.description).not.toContain(
      'Vorpal Sword',
    );
    expect(byParsedName.get('Vorpal Sword')?.description).toContain(
      'You gain a +3 bonus',
    );
  });

  it('detects a category whose rarity phrase wraps mid-word (… very / rare …)', () => {
    // SRD 5.1 p246: "Sword of Sharpness" wraps its category as
    //   "Weapon (any sword that deals slashing damage), very"
    //   "rare (requires attunement)"
    // The first line ends with the bare word "very" (no trailing punctuation,
    // balanced parens), so the boundary detector once missed the item and its
    // heading/body were swallowed into the preceding "Sword of Life Stealing".
    const parsed = parseMagicItems([
      page(246, [
        'Sword of Life Stealing',
        'Weapon (any sword), rare (requires attunement)',
        'When you attack a creature with this magic weapon',
        'and roll a 20 on the attack roll, that target takes an',
        'extra 3d6 necrotic damage.',
        'Sword of Sharpness',
        'Weapon (any sword that deals slashing damage), very',
        'rare (requires attunement)',
        'When you attack an object with this magic sword',
        'and hit, maximize your weapon damage dice.',
      ]),
    ]);
    const byParsedName = new Map(parsed.map((item) => [item.name, item]));

    expect(parsed.map((item) => item.name)).toEqual([
      'Sword of Life Stealing',
      'Sword of Sharpness',
    ]);
    expect(byParsedName.get('Sword of Sharpness')).toMatchObject({
      itemType: 'Weapon (any sword that deals slashing damage)',
      rarity: 'very rare',
      requiresAttunement: true,
    });
    expect(
      byParsedName.get('Sword of Life Stealing')?.description,
    ).not.toContain('Sword of Sharpness');
    expect(byParsedName.get('Sword of Sharpness')?.description).toContain(
      'maximize your weapon damage dice',
    );
  });

  it('parses an artifact-rarity item from an Artifacts-subsection slice (eshyra-0m9.16)', () => {
    // SRD 5.1 p252-253: Orb of Dragonkind is the lone "Artifacts" entry. Its
    // category line is "Wondrous item, artifact (requires attunement)"; the
    // importer feeds the Artifacts slice (heading excluded) to this same parser
    // and concatenates the result with the A-Z items.
    const parsed = parseMagicItems([
      page(252, [
        'Orb of Dragonkind',
        'Wondrous item, artifact (requires attunement)',
        'Ages past, elves and humans waged a terrible war',
        'against evil dragons.',
        'Random Properties. An Orb of Dragonkind has the',
        'following random properties:',
        '• 2 minor beneficial properties',
        'Destroying an Orb. An Orb of Dragonkind appears',
        'fragile but is impervious to most damage.',
      ]),
    ]);
    expect(parsed.map((item) => item.name)).toEqual(['Orb of Dragonkind']);
    const orb = parsed[0];
    expect(orb).toMatchObject({
      name: 'Orb of Dragonkind',
      itemType: 'Wondrous item',
      rarity: 'artifact',
      requiresAttunement: true,
      sourcePage: 252,
    });
    expect(orb.attunementRequirement).toBeUndefined();
    expect(orb.description).toMatch(/^Ages past, elves and humans waged/);
    expect(orb.description).toContain('Random Properties.');
    expect(orb.description).toContain('Destroying an Orb.');
  });

  // -------------------------------------------------------------------------
  // Bounded spans (eshyra-4a7.2). On the real SRD every magic-item NAME renders
  // at the leaf tier (h≈12.0); the body is h≈9.8. An item body must end at the
  // next item NAME heading even when that next item's category does not parse
  // (so it is not a detected entry). SRD 5.1 "Figurine of Wondrous Power"
  // (p221) prints "Wondrous item, rarity by figurine" — "figurine" is not a
  // recognized rarity — so before this bound, the preceding "Feather Token"
  // swallowed the whole Figurine entry (its variants and the embedded Giant Fly
  // stat block). The font-tier bound stops Feather Token at the Figurine
  // heading; eshyra-4a7.8 also accepts its source-defined rarity expression.
  // -------------------------------------------------------------------------
  it('bounds an item body at the next item heading whose category does not parse', () => {
    const parsed = parseMagicItems([
      tieredPage(221, [
        ['Feather Token', 12],
        ['Wondrous item, rare', 9.84],
        [
          'This tiny object looks like a feather. Different types of feather',
          9.84,
        ],
        ['tokens exist, each with a different single-use effect.', 9.84],
        [
          'Whip. You can use an action to throw the token to a point within 10',
          9.84,
        ],
        [
          'feet of you. The token disappears, and a floating whip takes its place.',
          9.84,
        ],
        ['Figurine of Wondrous Power', 12],
        ['Wondrous item, rarity by figurine', 9.84],
        [
          'A figurine of wondrous power is a statuette of a beast small enough',
          9.84,
        ],
        ['to fit in a pocket.', 9.84],
        [
          'Bronze Griffon (Rare). This bronze statuette is of a griffon rampant.',
          9.84,
        ],
        [
          'Ebony Fly (Rare). This ebony statuette is carved in the likeness of a horsefly.',
          9.84,
        ],
        ['Giant Fly', 12],
        ['Large beast, unaligned', 9.84],
        ['Armor Class 11', 9.84],
        ['Flame Tongue', 12],
        ['Weapon (any sword), rare (requires attunement)', 9.84],
        [
          'While holding this magic sword, you can use a bonus action to speak',
          9.84,
        ],
        ['its command word, causing flames to erupt from the blade.', 9.84],
      ]),
    ]);
    const byTieredName = new Map(parsed.map((item) => [item.name, item]));

    // Feather Token stops before the Figurine heading: no Figurine overview,
    // no figurine variants, no embedded Giant Fly stat block.
    const feather = byTieredName.get('Feather Token');
    expect(feather?.description).toContain('floating whip takes its place');
    expect(feather?.description).not.toContain('Figurine of Wondrous Power');
    expect(feather?.description).not.toContain('Bronze Griffon');
    expect(feather?.description).not.toContain('Giant Fly');

    const figurine = byTieredName.get('Figurine of Wondrous Power');
    expect(figurine).toMatchObject({
      itemType: 'Wondrous item',
      rarity: 'rarity by figurine',
      requiresAttunement: false,
      sourcePage: 221,
    });
    expect(figurine?.description).toContain(
      'A figurine of wondrous power is a statuette',
    );
    expect(figurine?.description).toContain('Bronze Griffon (Rare).');
    expect(figurine?.description).toContain('Giant Fly');
    expect(figurine?.description).not.toContain('Flame Tongue');
    expect(figurine?.variants?.[0]).toEqual({
      name: 'Bronze Griffon',
      rarity: 'Rare',
      text: 'This bronze statuette is of a griffon rampant.',
    });
    expect(figurine?.variants?.map((variant) => variant.name)).toEqual([
      'Bronze Griffon',
      'Ebony Fly',
    ]);

    expect(parsed.map((item) => item.name)).toEqual([
      'Feather Token',
      'Figurine of Wondrous Power',
      'Flame Tongue',
    ]);
    expect(byTieredName.get('Flame Tongue')?.description).toContain(
      'flames to erupt from the blade',
    );
  });

  it('keeps wrapped attunement parentheticals in category metadata', () => {
    const parsed = parseMagicItems([
      page(237, [
        'Ring of Shooting Stars',
        'Ring, very rare (requires attunement outdoors at',
        'night)',
        'While wearing this ring in dim light or darkness, you',
        'can cast dancing lights and light from the ring at will.',
        'Holy Avenger',
        'Weapon (any sword), legendary (requires attunement',
        'by a paladin)',
        'You gain a +3 bonus to attack and damage rolls',
        'made with this magic weapon.',
        'Pearl of Power',
        'Wondrous item, uncommon (requires attunement by a',
        'spellcaster)',
        'While this pearl is on your person, you can use an action.',
      ]),
    ]);
    const byParsedName = new Map(parsed.map((item) => [item.name, item]));

    expect(byParsedName.get('Ring of Shooting Stars')).toMatchObject({
      itemType: 'Ring',
      rarity: 'very rare',
      requiresAttunement: true,
      attunementRequirement: 'outdoors at night',
      description:
        'While wearing this ring in dim light or darkness, you can cast dancing lights and light from the ring at will.',
    });
    expect(byParsedName.get('Holy Avenger')).toMatchObject({
      itemType: 'Weapon (any sword)',
      rarity: 'legendary',
      requiresAttunement: true,
      attunementRequirement: 'by a paladin',
    });
    expect(byParsedName.get('Holy Avenger')?.description).toContain(
      'You gain a +3 bonus',
    );
    expect(byParsedName.get('Holy Avenger')?.description).not.toContain(
      'by a paladin)',
    );
    expect(byParsedName.get('Pearl of Power')).toMatchObject({
      itemType: 'Wondrous item',
      rarity: 'uncommon',
      requiresAttunement: true,
      attunementRequirement: 'by a spellcaster',
    });
    expect(byParsedName.get('Pearl of Power')?.description).not.toContain(
      'spellcaster)',
    );
  });
});

describe('parseMagicItems — reviewed inline variants (eshyra-xjp4)', () => {
  it.each([
    {
      name: 'Ioun Stone',
      rarity: 'rarity varies',
      introduction:
        'Many types of Ioun stone exist, each type a distinct combination of shape and color.',
      bodies: [
        'Absorption (Very Rare). Absorption text.',
        'Agility (Very Rare). Agility text.',
        'Awareness (Rare). Awareness text.',
        'Fortitude (Very Rare). Fortitude text.',
        'Greater Absorption (Legendary). Greater Absorption text.',
        'Insight (Very Rare). Insight text.',
        'Intellect (Very Rare). Intellect text.',
        'Leadership (Very Rare). Leadership text.',
        'Mastery (Legendary). Mastery text.',
        'Protection (Rare). Protection text.',
        'Regeneration (Legendary). Regeneration text.',
        'Reserve (Rare). Reserve text.',
        'Strength (Very Rare). Strength text.',
        'Sustenance (Rare). Sustenance text.',
      ],
      expectedNames: [
        'Absorption',
        'Agility',
        'Awareness',
        'Fortitude',
        'Greater Absorption',
        'Insight',
        'Intellect',
        'Leadership',
        'Mastery',
        'Protection',
        'Regeneration',
        'Reserve',
        'Strength',
        'Sustenance',
      ],
    },
    {
      name: 'Ring of Elemental Command',
      rarity: 'legendary',
      introduction: 'This ring is linked to one of the four Elemental Planes.',
      bodies: ['Air', 'Earth', 'Fire', 'Water'].map(
        (plane) => `Ring of ${plane} Elemental Command. ${plane} variant text.`,
      ),
      expectedNames: ['Air', 'Earth', 'Fire', 'Water'].map(
        (plane) => `Ring of ${plane} Elemental Command`,
      ),
    },
    {
      name: 'Crystal Ball',
      rarity: 'very rare or legendary',
      introduction:
        'The following crystal ball variants are legendary items and have additional properties.',
      bodies: ['Mind Reading', 'Telepathy', 'True Seeing'].map(
        (property) => `Crystal Ball of ${property}. ${property} text.`,
      ),
      expectedNames: ['Mind Reading', 'Telepathy', 'True Seeing'].map(
        (property) => `Crystal Ball of ${property}`,
      ),
    },
  ])('extracts the exact ordered $name membership', (fixture) => {
    const [parsed] = parseMagicItems([
      page(1, [
        fixture.name,
        `Wondrous item, ${fixture.rarity}`,
        fixture.introduction,
        ...fixture.bodies,
      ]),
    ]);
    expect(parsed.variants?.map((variant) => variant.name)).toEqual(
      fixture.expectedNames,
    );
    expect(parsed.variants?.at(-1)?.text).toMatch(/text\.$/);
  });

  it('fails closed when a reviewed variant heading drifts', () => {
    expect(() =>
      parseMagicItems([
        page(1, [
          'Crystal Ball',
          'Wondrous item, very rare or legendary',
          'The following crystal ball variants are legendary items and have additional properties.',
          'Crystal Ball of Mind Reading. Mind reading text.',
          'Crystal Ball of Telepathy. Telepathy text.',
          'Crystal Ball of Second Sight. Drifted heading text.',
        ]),
      ]),
    ).toThrow(/expected exactly one.*Crystal Ball of True Seeing/);
  });
});
