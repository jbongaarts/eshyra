/**
 * Creature-parser unit tests for the D&D 5e SRD 5.1 importer.
 *
 * Creature stat-block excerpts in this file are reproduced from the System
 * Reference Document 5.1 by Wizards of the Coast LLC, available under the
 * Creative Commons Attribution 4.0 International License (CC-BY-4.0). Excerpts
 * are used as parser test input; no modification has been made beyond
 * reformatting to match the importer's extracted-line input shape (the
 * STR/DEX/… ability table is split into a header line and a scores line, as
 * pdfjs extracts it).
 */

import { describe, expect, it } from 'vitest';
import { parseCreatures } from '../../../scripts/importers/dnd5e-srd-5.1/parseCreatures.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

// ---------------------------------------------------------------------------
// SRD 5.1 representative stat blocks. Note the Unicode minus (−) in modifiers,
// matching the real PDF; only the leading score is read by the parser.
// ---------------------------------------------------------------------------

// Small humanoid.
const GOBLIN_LINES = [
  'Goblin',
  'Small humanoid (goblinoid), neutral evil',
  'Armor Class 15 (leather armor, shield)',
  'Hit Points 7 (2d6)',
  'Speed 30 ft.',
  'STR DEX CON INT WIS CHA',
  '8 (−1) 14 (+2) 10 (+0) 10 (+0) 8 (−1) 8 (−1)',
  'Skills Stealth +6',
  'Senses darkvision 60 ft., passive Perception 9',
  'Languages Common, Goblin',
  'Challenge 1/4 (50 XP)',
  'Nimble Escape. The goblin can take the Disengage or Hide action as a bonus',
  'action on each of its turns.',
  'ACTIONS',
  'Scimitar. Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5',
  '(1d6 + 2) slashing damage.',
];

// Medium beast — exercises a multi-mode speed (walk + climb) and ASCII-hyphen
// modifiers.
const BLACK_BEAR_LINES = [
  'Black Bear',
  'Medium beast, unaligned',
  'Armor Class 11 (natural armor)',
  'Hit Points 19 (3d8 + 6)',
  'Speed 40 ft., climb 30 ft.',
  'STR DEX CON INT WIS CHA',
  '15 (+2) 10 (+0) 14 (+2) 2 (-4) 12 (+1) 7 (-2)',
  'Skills Perception +3',
  'Senses passive Perception 13',
  'Languages —',
  'Challenge 1/2 (100 XP)',
];

// Large dragon — exercises a flying speed and an integer challenge rating.
const WYVERN_LINES = [
  'Wyvern',
  'Large dragon, unaligned',
  'Armor Class 13 (natural armor)',
  'Hit Points 110 (13d10 + 39)',
  'Speed 20 ft., fly 80 ft.',
  'STR DEX CON INT WIS CHA',
  '19 (+4) 10 (+0) 16 (+3) 5 (−3) 12 (+1) 6 (−2)',
  'Senses darkvision 60 ft., passive Perception 11',
  'Languages —',
  'Challenge 6 (2,300 XP)',
];

// ---------------------------------------------------------------------------
// Single creature: Goblin (small humanoid)
// ---------------------------------------------------------------------------

describe('parseCreatures — Goblin (small humanoid)', () => {
  const [goblin] = parseCreatures([page(310, GOBLIN_LINES)]);

  it('extracts exactly one creature', () => {
    expect(parseCreatures([page(310, GOBLIN_LINES)])).toHaveLength(1);
  });

  it('extracts the name and records the source page', () => {
    expect(goblin.name).toBe('Goblin');
    expect(goblin.sourcePage).toBe(310);
  });

  it('parses size, type (with parenthetical subtype preserved), and alignment', () => {
    expect(goblin.size).toBe('Small');
    // The "(goblinoid)" race/subtype qualifier is retained on the type
    // (loreweaver-2ze) rather than collapsed to a bare "humanoid".
    expect(goblin.type).toBe('humanoid (goblinoid)');
    expect(goblin.alignment).toBe('neutral evil');
  });

  it('parses the leading integers of AC and HP', () => {
    expect(goblin.armorClass).toBe(15);
    expect(goblin.hitPoints).toBe(7);
  });

  it('parses an unlabeled base speed as walk', () => {
    expect(goblin.speed).toEqual({ walk: 30 });
  });

  it('parses the challenge rating without the XP parenthetical', () => {
    expect(goblin.challengeRating).toBe('1/4');
  });

  it('parses all six ability scores (score, not modifier)', () => {
    expect(goblin.abilityScores).toEqual({
      strength: 8,
      dexterity: 14,
      constitution: 10,
      intelligence: 10,
      wisdom: 8,
      charisma: 8,
    });
  });
});

// ---------------------------------------------------------------------------
// Medium beast: Black Bear — multi-mode speed, ASCII-hyphen modifiers
// ---------------------------------------------------------------------------

describe('parseCreatures — Black Bear (medium beast)', () => {
  const [bear] = parseCreatures([page(318, BLACK_BEAR_LINES)]);

  it('parses size and type', () => {
    expect(bear.size).toBe('Medium');
    expect(bear.type).toBe('beast');
    expect(bear.alignment).toBe('unaligned');
  });

  it('parses a labeled secondary speed mode', () => {
    expect(bear.speed).toEqual({ walk: 40, climb: 30 });
  });

  it('parses HP with a dice + bonus expression', () => {
    expect(bear.hitPoints).toBe(19);
  });

  it('parses scores with ASCII-hyphen modifiers', () => {
    expect(bear.abilityScores.intelligence).toBe(2);
    expect(bear.abilityScores.charisma).toBe(7);
  });

  it('parses a fractional challenge rating', () => {
    expect(bear.challengeRating).toBe('1/2');
  });
});

// ---------------------------------------------------------------------------
// Large dragon: Wyvern — flying speed, integer CR
// ---------------------------------------------------------------------------

describe('parseCreatures — Wyvern (large dragon)', () => {
  const [wyvern] = parseCreatures([page(360, WYVERN_LINES)]);

  it('parses size and type', () => {
    expect(wyvern.size).toBe('Large');
    expect(wyvern.type).toBe('dragon');
  });

  it('parses a flying speed mode alongside the base walk speed', () => {
    expect(wyvern.speed).toEqual({ walk: 20, fly: 80 });
  });

  it('parses a large hit-point total', () => {
    expect(wyvern.hitPoints).toBe(110);
  });

  it('parses an integer challenge rating', () => {
    expect(wyvern.challengeRating).toBe('6');
  });
});

// ---------------------------------------------------------------------------
// Category tag (loreweaver-bn0): Monsters vs Appendix MM-B Nonplayer Characters
// ---------------------------------------------------------------------------

// A representative Appendix MM-B NPC stat block (Bandit Captain). Its grammar is
// identical to a monster stat block, so the only difference is the provenance
// category the caller supplies.
const BANDIT_CAPTAIN_LINES = [
  'Bandit Captain',
  'Medium humanoid (any race), any non-lawful',
  'Armor Class 15 (studded leather)',
  'Hit Points 65 (10d8 + 20)',
  'Speed 30 ft.',
  'STR DEX CON INT WIS CHA',
  '15 (+2) 16 (+3) 14 (+2) 14 (+2) 11 (+0) 14 (+2)',
  'Challenge 2 (450 XP)',
];

describe('parseCreatures — category tag', () => {
  it("defaults the category to 'monster'", () => {
    const [goblin] = parseCreatures([page(310, GOBLIN_LINES)]);
    expect(goblin.category).toBe('monster');
  });

  it("stamps 'npc' on every extraction when the NPC category is requested", () => {
    const [captain] = parseCreatures([page(397, BANDIT_CAPTAIN_LINES)], 'npc');
    expect(captain.name).toBe('Bandit Captain');
    expect(captain.category).toBe('npc');
    // The stat block parses identically to a monster aside from the tag.
    expect(captain.armorClass).toBe(15);
    expect(captain.hitPoints).toBe(65);
    expect(captain.challengeRating).toBe('2');
    expect(captain.abilityScores.charisma).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// Multiple creatures on one page
// ---------------------------------------------------------------------------

describe('parseCreatures — multiple stat blocks on one page', () => {
  const results = parseCreatures([
    page(310, [...GOBLIN_LINES, '', ...BLACK_BEAR_LINES, '', ...WYVERN_LINES]),
  ]);

  it('extracts all three creatures', () => {
    expect(results).toHaveLength(3);
  });

  it('returns creatures sorted by name', () => {
    expect(results.map((c) => c.name)).toEqual([
      'Black Bear',
      'Goblin',
      'Wyvern',
    ]);
  });

  it('does not bleed one stat block into another', () => {
    const bear = results.find((c) => c.name === 'Black Bear');
    const goblin = results.find((c) => c.name === 'Goblin');
    const wyvern = results.find((c) => c.name === 'Wyvern');
    expect(bear?.type).toBe('beast');
    expect(goblin?.type).toBe('humanoid (goblinoid)');
    expect(wyvern?.type).toBe('dragon');
    // Ability scores must come from each creature's own block.
    expect(goblin?.abilityScores.strength).toBe(8);
    expect(bear?.abilityScores.strength).toBe(15);
    expect(wyvern?.abilityScores.strength).toBe(19);
    // AC must not be shared from the first block.
    expect(bear?.armorClass).toBe(11);
    expect(wyvern?.armorClass).toBe(13);
  });
});

// ---------------------------------------------------------------------------
// Creatures spanning multiple pages
// ---------------------------------------------------------------------------

describe('parseCreatures — stat blocks spanning multiple pages', () => {
  it('assigns sourcePage from the page the meta line appears on', () => {
    const results = parseCreatures([
      page(310, GOBLIN_LINES),
      page(318, BLACK_BEAR_LINES),
    ]);
    expect(results).toHaveLength(2);
    expect(results.find((c) => c.name === 'Goblin')?.sourcePage).toBe(310);
    expect(results.find((c) => c.name === 'Black Bear')?.sourcePage).toBe(318);
  });
});

// ---------------------------------------------------------------------------
// Defense-in-depth: meta-like prose without a stat block is not a creature
// ---------------------------------------------------------------------------

describe('parseCreatures — non-creature input', () => {
  it('returns empty array for empty page list', () => {
    expect(parseCreatures([])).toEqual([]);
  });

  it('skips a meta-like sentence with no stat-block signature', () => {
    // "Large beasts, such as horses, …" parses as a meta line, but no Armor
    // Class / Hit Points / ability table follows, so it must be skipped.
    const p = page(1, [
      'The Plains',
      'Large beasts, such as horses, roam the open grasslands.',
      'They are not a threat to a well-armed party.',
    ]);
    expect(parseCreatures([p])).toEqual([]);
  });

  it('ignores trailing non-creature prose after the last stat block', () => {
    const p = page(310, [
      ...GOBLIN_LINES,
      '',
      'Nonplayer Characters',
      'The following NPCs are described in prose, not stat blocks.',
    ]);
    const results = parseCreatures([p]);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Goblin');
  });
});

// ---------------------------------------------------------------------------
// Fail loud on a confirmed-but-malformed stat block
// ---------------------------------------------------------------------------

describe('parseCreatures — malformed confirmed stat block', () => {
  it('throws when a confirmed creature is missing its Challenge line', () => {
    const noChallenge = GOBLIN_LINES.filter(
      (l) => l.startsWith('Challenge') === false,
    );
    expect(() => parseCreatures([page(310, noChallenge)])).toThrow(
      /Goblin.*Challenge/,
    );
  });
});

// ---------------------------------------------------------------------------
// Real-PDF resilience (loreweaver-w8h)
// ---------------------------------------------------------------------------

describe('parseCreatures — real-PDF resilience', () => {
  it('parses ability scores even when prose from the adjacent column lands between the STR/DEX header and the score row', () => {
    // Reproduces the real SRD page 268 (Cloaker) shape: column-aware extraction
    // emits the right-column score row separated from its header by a
    // left-column body line. Before w8h the parser only looked at the line
    // immediately after the header and silently dropped the stat block.
    const cloaker = [
      'Cloaker',
      'Large aberration, chaotic neutral',
      'Armor Class 14 (natural armor)',
      'Hit Points 78 (12d10 + 12)',
      'Speed 10 ft., fly 40 ft.',
      'STR DEX CON INT WIS CHA',
      'attack or a harmful spell while a duplicate remains,',
      '17 (+3) 15 (+2) 12 (+1) 13 (+1) 12 (+1) 14 (+2)',
      'Skills Stealth +5',
      'Senses darkvision 60 ft., passive Perception 11',
      'Languages Deep Speech, Undercommon',
      'Challenge 8 (3,900 XP)',
    ];
    const results = parseCreatures([page(268, cloaker)]);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Cloaker');
    expect(results[0].abilityScores.strength).toBe(17);
    expect(results[0].abilityScores.dexterity).toBe(15);
    expect(results[0].abilityScores.charisma).toBe(14);
  });

  it('normalizes soft hyphens and U+2010 in compound creature names so PDF presentation marks do not drop the stat block', () => {
    // Reproduces the real SRD page 388 (Saber-Toothed Tiger) shape: the
    // compound name carries an ASCII hyphen + U+00AD soft hyphen + U+2010
    // Unicode HYPHEN, which renders as one hyphen but breaks the name's
    // character-class check. Before w8h these stat blocks (Will-o'-Wisp,
    // Half-Red Dragon Veteran, Saber-Toothed Tiger) were silently dropped.
    const saberTooth = [
      'Saber-\u00AD\u2010Toothed Tiger',
      'Large beast, unaligned',
      'Armor Class 12',
      'Hit Points 52 (7d10 + 14)',
      'Speed 40 ft.',
      'STR DEX CON INT WIS CHA',
      '18 (+4) 14 (+2) 15 (+2) 3 (−4) 12 (+1) 8 (−1)',
      'Senses passive Perception 13',
      'Languages —',
      'Challenge 2 (450 XP)',
    ];
    const [tiger] = parseCreatures([page(388, saberTooth)]);
    expect(tiger.name).toBe('Saber-Toothed Tiger');
    expect(tiger.size).toBe('Large');
    expect(tiger.type).toBe('beast');
  });
});

// ---------------------------------------------------------------------------
// Keyed defensive / sense fields (eshyra-ez6v / eshyra-4a7.5)
//
// The SRD prints Saving Throws, Skills, Damage Vulnerabilities/Resistances/
// Immunities, Condition Immunities, Senses, and Languages in a fixed-order run
// between the ability-score row and the Challenge line. Each creature carries
// only the labels its source prints. Excerpts below are reproduced verbatim
// from the SRD 5.1 extracted-line shape (Aboleth p261, Deva p261-262), trait /
// action body included so the bounded scan is exercised against trailing prose.
// ---------------------------------------------------------------------------

const ABOLETH_LINES = [
  'Aboleth',
  'Large aberration, lawful evil',
  'Armor Class 17 (natural armor)',
  'Hit Points 135 (18d10 + 36)',
  'Speed 10 ft., swim 40 ft.',
  'STR DEX CON INT WIS CHA',
  '21 (+5) 9 (−1) 15 (+2) 18 (+4) 15 (+2) 18 (+4)',
  'Saving Throws Con +6, Int +8, Wis +6',
  'Skills History +12, Perception +10',
  'Senses darkvision 120 ft., passive Perception 20',
  'Languages Deep Speech, telepathy 120 ft.',
  'Challenge 10 (5,900 XP)',
  'Amphibious. The aboleth can breathe air and water.',
  'Actions',
  'Multiattack. The aboleth makes three tentacle attacks.',
];

// Deva: the SRD wraps Damage Resistances across two extracted lines, and the
// block carries Condition Immunities — neither present on the Aboleth.
const DEVA_LINES = [
  'Deva',
  'Medium celestial, lawful good',
  'Armor Class 17 (natural armor)',
  'Hit Points 136 (16d8 + 64)',
  'Speed 30 ft., fly 90 ft.',
  'STR DEX CON INT WIS CHA',
  '18 (+4) 18 (+4) 18 (+4) 17 (+3) 20 (+5) 20 (+5)',
  'Saving Throws Wis +9, Cha +9',
  'Skills Insight +9, Perception +9',
  'Damage Resistances radiant; bludgeoning, piercing,',
  'and slashing from nonmagical attacks',
  'Condition Immunities charmed, exhaustion, frightened',
  'Senses darkvision 120 ft., passive Perception 19',
  'Languages all, telepathy 120 ft.',
  'Challenge 10 (5,900 XP)',
  'Angelic Weapons. The deva’s weapon attacks are magical.',
];

describe('parseCreatures — keyed defensive / sense fields', () => {
  it('captures the full keyed run printed for the Aboleth', () => {
    const [aboleth] = parseCreatures([page(261, ABOLETH_LINES)]);
    expect(aboleth.savingThrows).toBe('Con +6, Int +8, Wis +6');
    expect(aboleth.skills).toBe('History +12, Perception +10');
    expect(aboleth.senses).toBe('darkvision 120 ft., passive Perception 20');
    expect(aboleth.languages).toBe('Deep Speech, telepathy 120 ft.');
  });

  it('leaves labels the Aboleth does not print undefined (no empty keys)', () => {
    const [aboleth] = parseCreatures([page(261, ABOLETH_LINES)]);
    expect(aboleth.damageVulnerabilities).toBeUndefined();
    expect(aboleth.damageResistances).toBeUndefined();
    expect(aboleth.damageImmunities).toBeUndefined();
    expect(aboleth.conditionImmunities).toBeUndefined();
  });

  it('does not let trait / action prose after Challenge leak into a keyed field', () => {
    const [aboleth] = parseCreatures([page(261, ABOLETH_LINES)]);
    // Languages is the last keyed line before Challenge; its value must stop at
    // the source line and not absorb the Amphibious trait below Challenge.
    expect(aboleth.languages).toBe('Deep Speech, telepathy 120 ft.');
  });

  it('re-joins a Damage Resistances value that wraps across extracted lines', () => {
    const [deva] = parseCreatures([page(261, DEVA_LINES)]);
    expect(deva.damageResistances).toBe(
      'radiant; bludgeoning, piercing, and slashing from nonmagical attacks',
    );
    expect(deva.conditionImmunities).toBe('charmed, exhaustion, frightened');
    expect(deva.savingThrows).toBe('Wis +9, Cha +9');
    expect(deva.languages).toBe('all, telepathy 120 ft.');
  });

  it('splits a next-field label the PDF merged onto the previous value line', () => {
    // Real SRD p327 (Wereboar): column flow merged "Senses passive Perception
    // 12" onto the end of the wrapped Damage Immunities value. The Senses label
    // must still split off as its own field rather than be absorbed.
    const wereboar = [
      'Wereboar',
      'Medium humanoid (human, shapechanger), neutral evil',
      'Armor Class 10 in humanoid form, 11 (natural armor)',
      'in boar or hybrid form',
      'Hit Points 78 (12d8 + 24)',
      'Speed 30 ft. (40 ft. in boar form)',
      'STR DEX CON INT WIS CHA',
      '17 (+3) 10 (+0) 15 (+2) 10 (+0) 11 (+0) 8 (−1)',
      'Skills Perception +2',
      'Damage Immunities bludgeoning, piercing, and',
      'slashing from nonmagical attacks not made with',
      'silvered weapons Senses passive Perception 12',
      'Languages Common (can’t speak in boar form)',
      'Challenge 4 (1,100 XP)',
    ];
    const [boar] = parseCreatures([page(327, wereboar)]);
    expect(boar.damageImmunities).toBe(
      'bludgeoning, piercing, and slashing from nonmagical attacks not made with silvered weapons',
    );
    expect(boar.senses).toBe('passive Perception 12');
    expect(boar.languages).toBe('Common (can’t speak in boar form)');
  });

  it('accepts the singular "Damage Resistance" label a conditional block prints', () => {
    // Real SRD p395 (Archmage): the stoneskin conditional is printed as singular
    // "Damage Resistance"; it must map to damageResistances, not be swallowed by
    // the preceding Skills value.
    const archmage = [
      'Archmage',
      'Medium humanoid (any race), any alignment',
      'Armor Class 12 (15 with mage armor)',
      'Hit Points 99 (18d8 + 18)',
      'Speed 30 ft.',
      'STR DEX CON INT WIS CHA',
      '10 (+0) 14 (+2) 12 (+1) 20 (+5) 15 (+2) 16 (+3)',
      'Saving Throws Int +9, Wis +6',
      'Skills Arcana +13, History +13',
      'Damage Resistance damage from spells; nonmagical',
      'bludgeoning, piercing, and slashing (from stoneskin)',
      'Senses passive Perception 12',
      'Languages any six languages',
      'Challenge 12 (8,400 XP)',
    ];
    const [mage] = parseCreatures([page(395, archmage)], 'npc');
    expect(mage.skills).toBe('Arcana +13, History +13');
    expect(mage.damageResistances).toBe(
      'damage from spells; nonmagical bludgeoning, piercing, and slashing (from stoneskin)',
    );
    expect(mage.senses).toBe('passive Perception 12');
  });

  it('captures keyed fields on an NPC stat block the same way', () => {
    // The Bandit Captain prints no defensive/sense run beyond what its block
    // carries; a beast-simple block (Black Bear) has only Skills/Senses/Languages.
    const [bear] = parseCreatures([page(318, BLACK_BEAR_LINES)]);
    expect(bear.skills).toBe('Perception +3');
    expect(bear.senses).toBe('passive Perception 13');
    expect(bear.languages).toBe('—');
    expect(bear.savingThrows).toBeUndefined();
  });
});

describe('parseCreatures — non-creature region boundaries', () => {
  it('stops the Sea Hag body before the Half-Dragon Template subsection', () => {
    const lines = [
      'Sea Hag',
      'Medium fey, chaotic evil',
      'Armor Class 14 (natural armor)',
      'Hit Points 52 (7d8 + 21)',
      'Speed 30 ft., swim 40 ft.',
      'STR DEX CON INT WIS CHA',
      '16 (+3) 13 (+1) 16 (+3) 12 (+1) 12 (+1) 13 (+1)',
      'Senses darkvision 60 ft., passive Perception 11',
      'Languages Aquan, Common, Giant',
      'Challenge 2 (450 XP)',
      'Amphibious. The hag can breathe air and water.',
      'Actions',
      'Claws. Melee Weapon Attack: +5 to hit, reach 5 ft., one target.',
      'Half-Dragon Template',
      'A beast, humanoid, giant, or monstrosity can become a half-dragon.',
      'Half-Red Dragon Veteran',
      'Medium humanoid (human), any alignment',
      'Armor Class 18 (plate)',
      'Hit Points 65 (10d8 + 20)',
      'Speed 30 ft.',
      'STR DEX CON INT WIS CHA',
      '16 (+3) 13 (+1) 14 (+2) 10 (+0) 11 (+0) 10 (+0)',
      'Challenge 5 (1,800 XP)',
    ];
    const heights = lines.map((line) =>
      line === 'Half-Dragon Template' ? 13.92 : 9.84,
    );
    const [veteran, seaHag] = parseCreatures([
      { pageNumber: 320, lines, lineHeights: heights },
    ]);

    expect(seaHag.name).toBe('Sea Hag');
    expect(seaHag.actions).toEqual([
      {
        name: 'Claws',
        text: 'Melee Weapon Attack: +5 to hit, reach 5 ft., one target.',
      },
    ]);
    expect(JSON.stringify(seaHag)).not.toContain('Half-Dragon Template');
    expect(veteran.name).toBe('Half-Red Dragon Veteran');
  });
});

// ---------------------------------------------------------------------------
// Narrative body sections — traits, actions, reactions, legendary actions
// (eshyra-yevt / eshyra-4a7.5). Excerpts reproduced verbatim from the SRD 5.1
// extracted-line shape (Aboleth p261, Deva p261-262), wrapped exactly as pdfjs
// emits them so the sentence-completeness and wrap-rejoining logic is exercised.
// ---------------------------------------------------------------------------

// Full Aboleth body: 3 traits, an Actions section (incl. a multi-paragraph
// Enslave and a usage-qualified name), and a Legendary Actions section with an
// intro paragraph.
const ABOLETH_FULL = [
  'Aboleth',
  'Large aberration, lawful evil',
  'Armor Class 17 (natural armor)',
  'Hit Points 135 (18d10 + 36)',
  'Speed 10 ft., swim 40 ft.',
  'STR DEX CON INT WIS CHA',
  '21 (+5) 9 (−1) 15 (+2) 18 (+4) 15 (+2) 18 (+4)',
  'Saving Throws Con +6, Int +8, Wis +6',
  'Skills History +12, Perception +10',
  'Senses darkvision 120 ft., passive Perception 20',
  'Languages Deep Speech, telepathy 120 ft.',
  'Challenge 10 (5,900 XP)',
  'Amphibious. The aboleth can breathe air and water.',
  'Mucous Cloud. While underwater, the aboleth is',
  'surrounded by transformative mucus. A creature that',
  'touches the aboleth or that hits it with a melee attack',
  'while within 5 feet of it must make a DC 14',
  'Constitution saving throw. On a failure, the creature is',
  'diseased for 1d4 hours.',
  'Probing Telepathy. If a creature communicates',
  'telepathically with the aboleth, the aboleth learns the',
  'creature’s greatest desires if the aboleth can see the',
  'creature.',
  'Actions',
  'Multiattack. The aboleth makes three tentacle attacks.',
  'Tentacle. Melee Weapon Attack: +9 to hit, reach 10 ft.,',
  'one target. Hit: 12 (2d6 + 5) bludgeoning damage.',
  'Enslave (3/Day). The aboleth targets one creature it',
  'can see within 30 feet of it.',
  'Whenever the charmed target takes damage, the',
  'target can repeat the saving throw.',
  'Legendary Actions',
  'The aboleth can take 3 legendary actions, choosing',
  'from the options below. The aboleth regains spent',
  'legendary actions at the start of its turn.',
  'Detect. The aboleth makes a Wisdom (Perception)',
  'check.',
  'Psychic Drain (Costs 2 Actions). One creature charmed',
  'by the aboleth takes 10 (3d6) psychic damage.',
];

describe('parseCreatures — narrative sections', () => {
  const [aboleth] = parseCreatures([page(261, ABOLETH_FULL)]);

  it('splits the implicit trait run into named entries', () => {
    expect(aboleth.traits?.map((t) => t.name)).toEqual([
      'Amphibious',
      'Mucous Cloud',
      'Probing Telepathy',
    ]);
    expect(aboleth.traits?.[0].text).toBe(
      'The aboleth can breathe air and water.',
    );
  });

  it('does not split a wrapped body sentence that starts with a capitalized phrase', () => {
    // "Constitution saving throw. On a failure …" is a wrapped continuation of
    // Mucous Cloud, not a new trait — the open body was not sentence-complete.
    const mucous = aboleth.traits?.find((t) => t.name === 'Mucous Cloud');
    expect(mucous?.text).toContain(
      'must make a DC 14 Constitution saving throw',
    );
    expect(mucous?.text).toContain('On a failure, the creature is diseased');
    expect(
      aboleth.traits?.some((t) => t.name === 'Constitution saving throw'),
    ).toBe(false);
  });

  it('parses the Actions section, preserving a usage-qualified name', () => {
    expect(aboleth.actions?.map((a) => a.name)).toEqual([
      'Multiattack',
      'Tentacle',
      'Enslave (3/Day)',
    ]);
  });

  it('keeps a multi-paragraph entry body joined on a blank-line break', () => {
    const enslave = aboleth.actions?.find((a) => a.name === 'Enslave (3/Day)');
    // The two source paragraphs are joined; both are present.
    expect(enslave?.text).toContain('targets one creature it can see');
    expect(enslave?.text).toContain('Whenever the charmed target takes damage');
  });

  it('captures the legendary-actions intro as description and the options as entries', () => {
    expect(aboleth.legendaryActions?.description).toContain(
      'can take 3 legendary actions',
    );
    expect(aboleth.legendaryActions?.entries.map((e) => e.name)).toEqual([
      'Detect',
      'Psychic Drain (Costs 2 Actions)',
    ]);
  });

  it('leaves sections the creature does not print undefined', () => {
    expect(aboleth.reactions).toBeUndefined();
  });

  it('splits a trait that follows a spellcasting spell list (no terminal punctuation)', () => {
    // Real SRD Deva (p261-262): the Innate Spellcasting body ends on a spell-list
    // line ("1/day each: …") with no terminal period; Magic Resistance must still
    // open as a new trait rather than be absorbed.
    const deva = [
      'Deva',
      'Medium celestial, lawful good',
      'Armor Class 17 (natural armor)',
      'Hit Points 136 (16d8 + 64)',
      'Speed 30 ft., fly 90 ft.',
      'STR DEX CON INT WIS CHA',
      '18 (+4) 18 (+4) 18 (+4) 17 (+3) 20 (+5) 20 (+5)',
      'Senses darkvision 120 ft., passive Perception 19',
      'Languages all, telepathy 120 ft.',
      'Challenge 10 (5,900 XP)',
      'Innate Spellcasting. The deva’s spellcasting ability is',
      'Charisma (spell save DC 17). The deva can innately cast',
      'the following spells, requiring only verbal components:',
      'At will: detect evil and good',
      '1/day each: commune, raise dead',
      'Magic Resistance. The deva has advantage on saving',
      'throws against spells and other magical effects.',
    ];
    const [parsed] = parseCreatures([page(261, deva)]);
    expect(parsed.traits?.map((t) => t.name)).toEqual([
      'Innate Spellcasting',
      'Magic Resistance',
    ]);
    // The spell list rides inside the Innate Spellcasting trait text verbatim.
    const spellcasting = parsed.traits?.[0];
    expect(spellcasting?.text).toContain('At will: detect evil and good');
    expect(spellcasting?.text).toContain('1/day each: commune, raise dead');
  });

  it('parses a Reactions section', () => {
    // Real SRD Shrieker (p309): a trait then a Reactions section, no Actions.
    const shrieker = [
      'Shrieker',
      'Medium plant, unaligned',
      'Armor Class 5',
      'Hit Points 13 (3d8)',
      'Speed 0 ft.',
      'STR DEX CON INT WIS CHA',
      '1 (−5) 1 (−5) 10 (+0) 1 (−5) 3 (−4) 1 (−5)',
      'Senses blindsight 30 ft. (blind beyond this radius),',
      'passive Perception 6',
      'Languages —',
      'Challenge 0 (10 XP)',
      'False Appearance. While the shrieker remains',
      'motionless, it is indistinguishable from an ordinary',
      'fungus.',
      'Reactions',
      'Shriek. When bright light or a creature is within 30 feet',
      'of the shrieker, it emits a shriek audible within 300 feet',
      'of it.',
    ];
    const [parsed] = parseCreatures([page(309, shrieker)]);
    expect(parsed.traits?.map((t) => t.name)).toEqual(['False Appearance']);
    expect(parsed.actions).toBeUndefined();
    expect(parsed.reactions?.map((r) => r.name)).toEqual(['Shriek']);
  });

  it('matches an entry name containing a curly apostrophe', () => {
    // Real SRD devils print "Devil’s Sight" with a curly apostrophe (U+2019).
    const devil = [
      'Bearded Devil',
      'Medium fiend (devil), lawful evil',
      'Armor Class 13 (natural armor)',
      'Hit Points 52 (8d8 + 16)',
      'Speed 30 ft.',
      'STR DEX CON INT WIS CHA',
      '16 (+3) 15 (+2) 15 (+2) 9 (−1) 11 (+0) 11 (+0)',
      'Senses darkvision 120 ft., passive Perception 10',
      'Languages Infernal, telepathy 120 ft.',
      'Challenge 3 (700 XP)',
      'Devil’s Sight. Magical darkness doesn’t impede the',
      'devil’s darkvision.',
      'Magic Resistance. The devil has advantage on saving',
      'throws against spells and other magical effects.',
    ];
    const [parsed] = parseCreatures([page(274, devil)]);
    expect(parsed.traits?.map((t) => t.name)).toEqual([
      'Devil’s Sight',
      'Magic Resistance',
    ]);
    expect(parsed.traits?.[0].text).toBe(
      'Magical darkness doesn’t impede the devil’s darkvision.',
    );
  });

  it('strips a structural heading line (group heading) from the body by font height', () => {
    // The SRD prints a creature-group heading ("Angels") between stat blocks at a
    // larger font than body text; in extraction it lands as the last line of the
    // preceding creature's body. A taller line is dropped so it cannot pollute
    // the final entry. Body text is 9.84pt; the group heading is ~14pt.
    const lines = [
      'Aboleth',
      'Large aberration, lawful evil',
      'Armor Class 17 (natural armor)',
      'Hit Points 135 (18d10 + 36)',
      'Speed 10 ft., swim 40 ft.',
      'STR DEX CON INT WIS CHA',
      '21 (+5) 9 (−1) 15 (+2) 18 (+4) 15 (+2) 18 (+4)',
      'Senses darkvision 120 ft., passive Perception 20',
      'Languages Deep Speech, telepathy 120 ft.',
      'Challenge 10 (5,900 XP)',
      'Amphibious. The aboleth can breathe air and water.',
      'Angels',
    ];
    const lineHeights = lines.map((l) => (l === 'Angels' ? 13.92 : 9.84));
    const [parsed] = parseCreatures([{ pageNumber: 261, lines, lineHeights }]);
    expect(parsed.traits?.map((t) => t.name)).toEqual(['Amphibious']);
    // "Angels" was dropped, not appended to the Amphibious trait body.
    expect(parsed.traits?.[0].text).toBe(
      'The aboleth can breathe air and water.',
    );
  });
});

// ---------------------------------------------------------------------------
// Creature variant sidebars (eshyra-70xr / eshyra-4a7.5). The SRD prints two
// boxed "Variant: …" notes in the creature chapters; each ends the preceding
// creature's narrative and is attached to the creature it modifies.
// ---------------------------------------------------------------------------

// Giant Rat (SRD p378 / MM-A) followed by its Diseased variant sidebar. The
// variant repeats a "Bite." line that must NOT become a second Giant Rat action.
const GIANT_RAT_WITH_VARIANT = [
  'Giant Rat',
  'Small beast, unaligned',
  'Armor Class 12',
  'Hit Points 7 (2d6)',
  'Speed 30 ft.',
  'STR DEX CON INT WIS CHA',
  '7 (−2) 15 (+2) 11 (+0) 2 (−4) 10 (+0) 4 (−3)',
  'Senses darkvision 60 ft., passive Perception 10',
  'Languages —',
  'Challenge 1/8 (25 XP)',
  'Keen Smell. The rat has advantage on Wisdom (Perception) checks that rely on',
  'smell.',
  'Actions',
  'Bite. Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 4 (1d4 +',
  '2) piercing damage.',
  'Variant: Diseased Giant Rats',
  'Some giant rats carry vile diseases that they spread with their',
  'bites. A diseased giant rat has a challenge rating of 1/8 (25',
  'XP) and the following action instead of its normal bite attack.',
  'Bite. Melee Weapon Attack: +4 to hit, reach 5 ft., one',
  'target. Hit: 4 (1d4 + 2) piercing damage.',
];

describe('parseCreatures — variant sidebars', () => {
  it('does not let a variant sidebar pollute the creature it follows', () => {
    const [rat] = parseCreatures([page(378, GIANT_RAT_WITH_VARIANT)]);
    // The variant's repeated "Bite." is NOT a second action.
    expect(rat.actions?.map((a) => a.name)).toEqual(['Bite']);
    expect(rat.traits?.map((t) => t.name)).toEqual(['Keen Smell']);
  });

  it('attaches the variant sidebar to the creature it modifies', () => {
    const [rat] = parseCreatures([page(378, GIANT_RAT_WITH_VARIANT)]);
    expect(rat.variants?.map((v) => v.name)).toEqual(['Diseased Giant Rats']);
    const text = rat.variants?.[0].text ?? '';
    expect(text).toContain(
      'A diseased giant rat has a challenge rating of 1/8',
    );
    // The sidebar body, including its alternate Bite action, is preserved.
    expect(text).toContain('instead of its normal bite attack');
    expect(text).toContain('Bite. Melee Weapon Attack: +4 to hit');
  });

  it('bounds the variant body at the next creature by font height', () => {
    const lines = [
      ...GIANT_RAT_WITH_VARIANT,
      'Giant Scorpion',
      'Large beast, unaligned',
    ];
    const lineHeights = lines.map((l) =>
      l === 'Giant Scorpion'
        ? 12
        : l === 'Variant: Diseased Giant Rats'
          ? 10.8
          : 9.84,
    );
    const [rat] = parseCreatures([{ pageNumber: 378, lines, lineHeights }]);
    // "Giant Scorpion" (a taller heading line) is not swept into the variant.
    expect(rat.variants?.[0].text).not.toContain('Giant Scorpion');
    expect(rat.variants?.[0].text).toContain('piercing damage');
  });

  it('attaches a variant to a creature other than the one whose body it sits in', () => {
    // Insect Swarms is printed after Swarm of Ravens but modifies Swarm of
    // Insects (SRD p391). Both creatures present; the variant must land on the
    // target, and Swarm of Ravens must stay unpolluted.
    const swarmOfInsects = [
      'Swarm of Insects',
      'Medium swarm of Tiny beasts, unaligned',
      'Armor Class 11 (natural armor)',
      'Hit Points 22 (5d8)',
      'Speed 20 ft., climb 20 ft.',
      'STR DEX CON INT WIS CHA',
      '3 (−4) 13 (+1) 10 (+0) 1 (−5) 7 (−2) 1 (−5)',
      'Senses blindsight 10 ft., passive Perception 8',
      'Languages —',
      'Challenge 1/2 (100 XP)',
      'Swarm. The swarm can occupy another creature’s space and vice versa.',
      'Actions',
      'Bites. Melee Weapon Attack: +3 to hit, reach 0 ft., one creature in the',
      'swarm’s space. Hit: 10 (4d4) piercing damage, or 5 (2d4) piercing damage if',
      'the swarm has half of its hit points or fewer.',
    ];
    const swarmOfRavens = [
      'Swarm of Ravens',
      'Medium swarm of Tiny beasts, unaligned',
      'Armor Class 12',
      'Hit Points 24 (7d8 − 7)',
      'Speed 10 ft., fly 50 ft.',
      'STR DEX CON INT WIS CHA',
      '6 (−2) 14 (+2) 8 (−1) 3 (−4) 12 (+1) 6 (−2)',
      'Senses passive Perception 15',
      'Languages —',
      'Challenge 1/4 (50 XP)',
      'Swarm. The swarm can occupy another creature’s space and vice versa.',
      'Actions',
      'Beaks. Melee Weapon Attack: +4 to hit, reach 5 ft., one target in the',
      'swarm’s space. Hit: 7 (4d4 − 3) piercing damage.',
      'Variant: Insect Swarms',
      'Different kinds of insects can gather in swarms, and each',
      'swarm has the special characteristics described below.',
      'Swarm of Beetles. A swarm of beetles gains a burrowing',
      'speed of 5 feet.',
      'Spider Climb. The swarm can climb difficult surfaces.',
    ];
    const creatures = parseCreatures([
      page(389, swarmOfInsects),
      page(391, swarmOfRavens),
    ]);
    const insects = creatures.find((c) => c.name === 'Swarm of Insects');
    const ravens = creatures.find((c) => c.name === 'Swarm of Ravens');
    expect(insects?.variants?.map((v) => v.name)).toEqual(['Insect Swarms']);
    expect(insects?.variants?.[0].text).toContain('Swarm of Beetles');
    // Swarm of Ravens keeps only its own action and carries no variant.
    expect(ravens?.actions?.map((a) => a.name)).toEqual(['Beaks']);
    expect(ravens?.variants).toBeUndefined();
  });

  it('fails closed on a variant caption not in the reviewed target map', () => {
    const lines = [...GIANT_RAT_WITH_VARIANT];
    lines[lines.indexOf('Variant: Diseased Giant Rats')] =
      'Variant: Mutant Rats';
    expect(() => parseCreatures([page(378, lines)])).toThrow(
      /reviewed variant-target map/,
    );
  });
});
