/**
 * Spell-parser unit tests for the D&D 5e SRD 5.1 importer.
 *
 * Spell text excerpts in this file are reproduced from the System Reference
 * Document 5.1 by Wizards of the Coast LLC, available under the Creative
 * Commons Attribution 4.0 International License (CC-BY-4.0). Excerpts are
 * used here as parser test input; no modification of the rules content has
 * been made beyond reformatting to match the importer's extracted-line input
 * shape (one PDF visual line per array entry).
 */

import { describe, expect, it } from 'vitest';
import {
  applyClassLists,
  parseSpellClassLists,
  parseSpells,
} from '../../../scripts/importers/dnd5e-srd-5.1/parseSpells.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

// ---------------------------------------------------------------------------
// Cantrip: Acid Splash. Verbatim SRD 5.1.
// ---------------------------------------------------------------------------

const ACID_SPLASH_PAGE = page(211, [
  'Acid Splash',
  'Conjuration cantrip',
  'Casting Time: 1 action',
  'Range: 60 feet',
  'Components: V, S',
  'Duration: Instantaneous',
  'You hurl a bubble of acid. Choose one creature you can',
  'see within range, or choose two creatures you can see',
  'within range that are within 5 feet of each other. A target',
  'must succeed on a Dexterity saving throw or take 1d6',
  'acid damage.',
  "This spell's damage increases by 1d6 when you reach",
  '5th level (2d6), 11th level (3d6), and 17th level (4d6).',
]);

const HUNTERS_MARK_PAGE = page(151, [
  'Hunter’s Mark',
  '1st-level divination',
  'Casting Time: 1 bonus action',
  'Range: 90 feet',
  'Components: V',
  'Duration: Concentration, up to 1 hour',
  'You choose a creature you can see within range and mystically',
  'mark it as your quarry.',
]);

// ---------------------------------------------------------------------------
// 1st-level with "At Higher Levels": Magic Missile.
// ---------------------------------------------------------------------------

const MAGIC_MISSILE_PAGE = page(257, [
  'Magic Missile',
  '1st-level evocation',
  'Casting Time: 1 action',
  'Range: 120 feet',
  'Components: V, S',
  'Duration: Instantaneous',
  'You create three glowing darts of magical force. Each',
  'dart hits a creature of your choice that you can see',
  'within range. A dart deals 1d4 + 1 force damage to its',
  'target. The darts all strike simultaneously, and you can',
  'direct them to hit one creature or several.',
  'At Higher Levels. When you cast this spell using a',
  'spell slot of 2nd level or higher, the spell creates one',
  'more dart for each slot level above 1st.',
]);

// ---------------------------------------------------------------------------
// 2nd-level with material components text: Aid.
// ---------------------------------------------------------------------------

const AID_PAGE = page(211, [
  'Aid',
  '2nd-level abjuration',
  'Casting Time: 1 action',
  'Range: 30 feet',
  'Components: V, S, M (a tiny strip of white cloth)',
  'Duration: 8 hours',
  'Your spell bolsters your allies with toughness and',
  'resolve. Choose up to three creatures within range.',
  "Each target's hit point maximum and current hit points",
  'increase by 5 for the duration.',
  'At Higher Levels. When you cast this spell using a spell',
  "slot of 3rd level or higher, a target's hit points increase by",
  'an additional 5 for each slot level above 2nd.',
]);

describe('parseSpells — cantrip without material components', () => {
  const [spell] = parseSpells([ACID_SPLASH_PAGE]);

  it('extracts the spell name', () => {
    expect(spell.name).toBe('Acid Splash');
  });

  it('marks level=0 for a cantrip', () => {
    expect(spell.level).toBe(0);
  });

  it('captures the school in lowercase', () => {
    expect(spell.school).toBe('conjuration');
  });

  it('captures the keyed metadata fields', () => {
    expect(spell.castingTime).toBe('1 action');
    expect(spell.range).toBe('60 feet');
    expect(spell.components).toEqual(['V', 'S']);
    expect(spell.duration).toBe('Instantaneous');
  });

  it('leaves componentMaterials undefined when none are listed', () => {
    expect(spell.componentMaterials).toBeUndefined();
  });

  it('captures a description that re-flows wrapped lines', () => {
    expect(spell.description).toMatch(/^You hurl a bubble of acid\./);
    // Wrapped lines collapse to a single space, not a literal newline.
    expect(spell.description).not.toContain('\nsee within');
  });

  it('leaves higherLevels undefined for SRD 5.1 cantrip upgrade text (no marker)', () => {
    // SRD 5.1 cantrips state their per-level damage scaling as a regular
    // description paragraph with no "At Higher Levels." or "Cantrip Upgrade."
    // header. The parser only splits higherLevels on those literal markers,
    // so cantrip scaling stays in description.
    expect(spell.higherLevels).toBeUndefined();
    expect(spell.description).toMatch(/damage increases by 1d6 when you reach/);
  });

  it('records the source page', () => {
    expect(spell.sourcePage).toBe(211);
  });
});

describe('parseSpells — leveled spell with At Higher Levels', () => {
  const [spell] = parseSpells([MAGIC_MISSILE_PAGE]);

  it('extracts level=1 from "1st-level"', () => {
    expect(spell.level).toBe(1);
  });

  it('captures the school', () => {
    expect(spell.school).toBe('evocation');
  });

  it('splits description vs. higherLevels at "At Higher Levels."', () => {
    expect(spell.description).toMatch(/^You create three glowing darts/);
    expect(spell.description).not.toMatch(/At Higher Levels/);
    expect(spell.higherLevels).toMatch(/^When you cast this spell/);
  });
});

describe('parseSpells — material-component spell', () => {
  const [spell] = parseSpells([AID_PAGE]);

  it('extracts the V/S/M component list without the material text', () => {
    expect(spell.components).toEqual(['V', 'S', 'M']);
  });

  it('captures the material component text separately', () => {
    expect(spell.componentMaterials).toBe('a tiny strip of white cloth');
  });

  it('captures level=2 and abjuration school', () => {
    expect(spell.level).toBe(2);
    expect(spell.school).toBe('abjuration');
  });
});

describe('parseSpells — multiple spells across one page', () => {
  it('extracts both spells in alphabetical order', () => {
    const merged = page(211, [
      ...MAGIC_MISSILE_PAGE.lines,
      '',
      ...ACID_SPLASH_PAGE.lines,
    ]);
    const spells = parseSpells([merged]);
    expect(spells.map((s) => s.name)).toEqual(['Acid Splash', 'Magic Missile']);
  });

  it('does not bleed description from one spell into the next', () => {
    const merged = page(211, [
      ...MAGIC_MISSILE_PAGE.lines,
      '',
      ...ACID_SPLASH_PAGE.lines,
    ]);
    const [acid, magicMissile] = parseSpells([merged]);
    expect(acid.description).not.toMatch(/magical force/);
    expect(magicMissile.description).not.toMatch(/bubble of acid/);
  });
});

describe('parseSpells — output ordering', () => {
  it('returns spells sorted by name', () => {
    const spells = parseSpells([
      MAGIC_MISSILE_PAGE,
      ACID_SPLASH_PAGE,
      AID_PAGE,
    ]);
    const names = spells.map((s) => s.name);
    expect(names).toEqual([...names].sort());
  });
});

// ---------------------------------------------------------------------------
// Body-slicing regression: the final spell with no following marker must
// preserve its full body, including its last real content line. The previous
// implementation chopped off the last line under the assumption that it was
// the next spell's name — which is wrong when there is no next spell.
// ---------------------------------------------------------------------------

describe('parseSpells — final-spell body preservation (regression)', () => {
  it('keeps the final line of the final spell when no next-marker exists', () => {
    const lonely = page(257, [
      'Magic Missile',
      '1st-level evocation',
      'Casting Time: 1 action',
      'Range: 120 feet',
      'Components: V, S',
      'Duration: Instantaneous',
      'You create three glowing darts of magical force.',
      'FINAL_BODY_LINE_THAT_MUST_NOT_BE_DROPPED.',
    ]);
    const [spell] = parseSpells([lonely]);
    expect(spell).toBeDefined();
    // The final body line must appear somewhere in the spell's textual output
    // (description or higherLevels) — never silently dropped.
    const allText = `${spell.description}\n${spell.higherLevels ?? ''}`;
    expect(allText).toMatch(/FINAL_BODY_LINE_THAT_MUST_NOT_BE_DROPPED\./);
  });

  it('does not drop a body line when the next spell has multiple blank lines before its name', () => {
    const merged = page(211, [
      'Acid Splash',
      'Conjuration cantrip',
      'Casting Time: 1 action',
      'Range: 60 feet',
      'Components: V, S',
      'Duration: Instantaneous',
      'You hurl a bubble of acid.',
      'ACID_LAST_LINE.',
      '',
      '',
      '',
      'Magic Missile',
      '1st-level evocation',
      'Casting Time: 1 action',
      'Range: 120 feet',
      'Components: V, S',
      'Duration: Instantaneous',
      'You create three glowing darts of magical force.',
    ]);
    const [acid] = parseSpells([merged]);
    expect(acid.description).toMatch(/ACID_LAST_LINE/);
  });
});

// ---------------------------------------------------------------------------
// Class-list bleed regression: text that appears AFTER the spell-descriptions
// section (class spell lists, monster stat blocks, etc.) must not be absorbed
// into the final spell's body. The parser only guarantees this when it is
// given the spell-descriptions slice, but historically a bug let the final
// spell absorb everything following it. Keep a regression test that exercises
// the wrong-input behavior so a future re-introduction is caught.
// ---------------------------------------------------------------------------

describe('parseSpells — class-list bleed (regression)', () => {
  it('does not absorb class-list headers into the final spell body when followed by class lists in the same input', () => {
    const merged = page(257, [
      ...MAGIC_MISSILE_PAGE.lines,
      '',
      // Hostile follow-on content that pre-fix would have been absorbed:
      'Wizard Spells',
      'Cantrips (0 Level)',
      'Acid Splash',
      'Fire Bolt',
      '',
      '1st Level',
      'Burning Hands',
      'Charm Person',
    ]);
    const [spell] = parseSpells([merged]);
    const haystack = `${spell.description}\n${spell.higherLevels ?? ''}`;
    expect(haystack).not.toMatch(/Wizard Spells/);
    expect(haystack).not.toMatch(/Cantrips \(0 Level\)/);
    // "Acid Splash" appears as a name in the class list; verify it didn't
    // bleed into the spell's text.
    expect(haystack).not.toMatch(/Acid Splash/);
  });
});

// ---------------------------------------------------------------------------
// Real-PDF leveled-marker regression (loreweaver-qqc): in the SRD 5.1 PDF
// every word-internal hyphen — including the "Nth-level <school>" marker — is
// emitted by pdfjs as a four-character font-glyph cluster:
//   U+002D HYPHEN-MINUS + U+00AD SOFT HYPHEN + U+2010 HYPHEN + U+2011 NB HYPHEN
// The previous LEVELED_MARKER regex demanded a single ASCII hyphen, so no
// leveled-spell heading in the real PDF matched. Every leveled spell after a
// cantrip silently became part of that cantrip's body (Fire Bolt absorbed the
// entire F-* and G-* leveled run up to the next cantrip "Guidance"). Parse
// must accept the cluster and emit each leveled spell as its own record.
// ---------------------------------------------------------------------------

const REAL_PDF_HYPHEN_CLUSTER = '-\u00AD\u2010\u2011';

describe('parseSpells — real-PDF hyphen cluster in leveled marker (regression)', () => {
  const FIRE_BOLT_LINES = [
    'Fire Bolt',
    'Evocation cantrip',
    'Casting Time: 1 action',
    'Range: 120 feet',
    'Components: V, S',
    'Duration: Instantaneous',
    'You hurl a mote of fire at a creature or object within',
    'range. Make a ranged spell attack against the target.',
    "This spell's damage increases by 1d10 when you reach",
    '5th level (2d10), 11th level (3d10), and 17th level (4d10).',
  ];
  const FIRE_SHIELD_LINES = [
    'Fire Shield',
    `4th${REAL_PDF_HYPHEN_CLUSTER}level evocation`,
    'Casting Time: 1 action',
    'Range: Self',
    'Components: V, S, M (a bit of phosphorus or a firefly)',
    'Duration: 10 minutes',
    'Thin and wispy flames wreathe your body, shedding',
    `bright light in a 10${REAL_PDF_HYPHEN_CLUSTER}foot radius.`,
  ];

  it('emits the leveled spell as its own record (does not absorb into the preceding cantrip)', () => {
    const merged = page(144, [...FIRE_BOLT_LINES, '', ...FIRE_SHIELD_LINES]);
    const spells = parseSpells([merged]);
    expect(spells.map((s) => s.name)).toEqual(['Fire Bolt', 'Fire Shield']);
  });

  it('keeps Fire Bolt body free of Fire Shield text', () => {
    const merged = page(144, [...FIRE_BOLT_LINES, '', ...FIRE_SHIELD_LINES]);
    const [fireBolt] = parseSpells([merged]);
    expect(fireBolt.description).toMatch(/^You hurl a mote of fire/);
    expect(fireBolt.description).not.toMatch(/Fire Shield/);
    expect(fireBolt.description).not.toMatch(/wispy flames/);
  });

  it('extracts the leveled spell with level=4 and school=evocation', () => {
    const merged = page(144, [...FIRE_BOLT_LINES, '', ...FIRE_SHIELD_LINES]);
    const fireShield = parseSpells([merged]).find(
      (s) => s.name === 'Fire Shield',
    );
    expect(fireShield).toBeDefined();
    expect(fireShield?.level).toBe(4);
    expect(fireShield?.school).toBe('evocation');
  });

  it('normalizes the cluster in body text to a clean ASCII hyphen', () => {
    const merged = page(144, [...FIRE_BOLT_LINES, '', ...FIRE_SHIELD_LINES]);
    const fireShield = parseSpells([merged]).find(
      (s) => s.name === 'Fire Shield',
    );
    expect(fireShield).toBeDefined();
    // The source line carried the four-glyph cluster in "10-foot radius";
    // the parsed body must read with a plain ASCII hyphen.
    expect(fireShield?.description).toContain('10-foot radius');
    // …and must not leak any of the invisible PDF hyphen presentation
    // characters (U+00AD soft hyphen, U+2010 hyphen, U+2011 non-breaking
    // hyphen) into the normalized output.
    expect(fireShield?.description).not.toMatch(/[\u00AD\u2010\u2011]/);
  });
});

// ---------------------------------------------------------------------------
// SRD 5.1 PDF typo tolerance (loreweaver-qqc): Contagion's metadata block in
// the published PDF says "Component:" (singular) instead of "Components:".
// Without tolerance the parser throws "incomplete spell metadata" and the
// importer aborts mid-pass. Other spells use the plural form.
// ---------------------------------------------------------------------------

describe('parseSpells — Contagion "Component:" typo (regression)', () => {
  it('accepts the singular "Component:" form as the Components field', () => {
    const contagionPage = page(129, [
      'Contagion',
      '5th-level necromancy',
      'Casting Time: 1 action',
      'Range: Touch',
      'Component: V, S',
      'Duration: 7 days',
      'Your touch inflicts disease. Make a melee spell attack.',
    ]);
    const [spell] = parseSpells([contagionPage]);
    expect(spell).toBeDefined();
    expect(spell.name).toBe('Contagion');
    expect(spell.components).toEqual(['V', 'S']);
    expect(spell.duration).toBe('7 days');
  });
});

describe('parseSpellClassLists', () => {
  it('extracts spell names per caster class', () => {
    const classListPage: PageText = page(289, [
      'Wizard Spells',
      'Cantrips (0 Level)',
      'Acid Splash',
      'Fire Bolt',
      '',
      '1st Level',
      'Magic Missile',
      '',
      'Sorcerer Spells',
      'Cantrips (0 Level)',
      'Acid Splash',
      'Fire Bolt',
      '',
      '1st Level',
      'Magic Missile',
    ]);
    const index = parseSpellClassLists([classListPage]);
    expect([...(index.get('Acid Splash') ?? new Set())].sort()).toEqual([
      'Sorcerer',
      'Wizard',
    ]);
    expect([...(index.get('Magic Missile') ?? new Set())].sort()).toEqual([
      'Sorcerer',
      'Wizard',
    ]);
  });

  it('returns an empty index when no class headers are found', () => {
    const noClassPage = page(1, ['Acid Splash', 'Conjuration cantrip']);
    const index = parseSpellClassLists([noClassPage]);
    expect(index.size).toBe(0);
  });
});

describe('applyClassLists', () => {
  it('returns a stable, sorted class list for each spell', () => {
    const classListPage: PageText = page(289, [
      'Wizard Spells',
      'Cantrips (0 Level)',
      'Acid Splash',
      '',
      'Sorcerer Spells',
      'Cantrips (0 Level)',
      'Acid Splash',
    ]);
    const index = parseSpellClassLists([classListPage]);
    const spells = parseSpells([ACID_SPLASH_PAGE]);
    const { classes } = applyClassLists(spells, index);
    expect(classes.get('Acid Splash')).toEqual(['Sorcerer', 'Wizard']);
  });

  it('returns an empty array for spells not in any class list', () => {
    const empty: PageText = page(1, []);
    const index = parseSpellClassLists([empty]);
    const spells = parseSpells([ACID_SPLASH_PAGE]);
    const { classes } = applyClassLists(spells, index);
    expect(classes.get('Acid Splash')).toEqual([]);
  });

  it('matches ASCII and curly apostrophes without changing the source-preserving spell name', () => {
    const index = parseSpellClassLists([
      page(109, ['Ranger Spells', '1st Level', "Hunter's Mark"]),
    ]);
    const spells = parseSpells([HUNTERS_MARK_PAGE]);
    const { classes } = applyClassLists(spells, index);

    expect(spells[0].name).toBe('Hunter’s Mark');
    expect(classes.get('Hunter’s Mark')).toEqual(['Ranger']);
  });

  it('fails closed when a source spell-list entry has no emitted spell record', () => {
    const index = parseSpellClassLists([
      page(109, ['Ranger Spells', '1st Level', 'Missing Spell']),
    ]);
    const spells = parseSpells([ACID_SPLASH_PAGE]);

    expect(() => applyClassLists(spells, index)).toThrow(
      /spell-list entries did not resolve.*Missing Spell/i,
    );
  });
});
