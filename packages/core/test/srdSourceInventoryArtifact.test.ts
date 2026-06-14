/**
 * Sentinel regression tests for the committed SRD source-coverage artifacts
 * (eshyra-4a7.1) at `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/`.
 *
 * Like `srdGeneratedPack.test.ts`, these tests operate on the COMMITTED
 * artifacts on disk, not on importer output — re-running the importer is the
 * path-gated `verify:dnd5e-srd-pack` job's responsibility. What this file
 * guards:
 *
 *   - The artifacts exist, parse, and are internally consistent (every
 *     inventory item has exactly one coverage entry; nothing unaccounted).
 *   - The known structure gaps the eshyra-4a7 epic is built around are
 *     VISIBLE in the coverage output as `known-gap:<bead>` statuses rather
 *     than hidden inside passing tests — when one of those beads lands and
 *     regenerates the artifacts, the matching sentinel here fails on purpose
 *     so the curation rule gets removed and the gate starts enforcing the
 *     new coverage.
 *   - Source structures the pack genuinely covers resolve to `record:` /
 *     `child-of:` statuses.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PACK_DIR = join(
  process.cwd(),
  'packages/core/data/rules-packs/rules__dnd5e-srd-5.1',
);

interface InventoryItem {
  readonly page: number;
  readonly lineIndex: number;
  readonly text: string;
  readonly tier: string | null;
  readonly structure: string;
  readonly section: string | null;
  readonly context: string | null;
}

interface CoverageEntry {
  readonly page: number;
  readonly lineIndex: number;
  readonly tier: string | null;
  readonly structure: string;
  readonly text: string;
  readonly section: string | null;
  readonly status: string;
}

interface AmbiguousNameCollision {
  readonly normalizedName: string;
  readonly winnerKey: string;
  readonly shadowedKeys: readonly string[];
}

interface CollapsedSourceGroup {
  readonly text: string;
  readonly resolvedKey: string;
  readonly count: number;
}

interface CoverageReport {
  readonly summary: {
    readonly record: number;
    readonly childOf: number;
    readonly ignored: Readonly<Record<string, number>>;
    readonly knownGap: Readonly<Record<string, number>>;
    readonly unaccounted: number;
  };
  readonly ambiguous: {
    readonly shadowedRecords: readonly AmbiguousNameCollision[];
    readonly collapsedSourceItems: readonly CollapsedSourceGroup[];
  };
  readonly entries: readonly CoverageEntry[];
}

const inventory = JSON.parse(
  readFileSync(join(PACK_DIR, 'source-inventory.json'), 'utf8'),
) as readonly InventoryItem[];

const coverage = JSON.parse(
  readFileSync(join(PACK_DIR, 'source-coverage.json'), 'utf8'),
) as CoverageReport;

/** The unique coverage entry for a (page, text) pair; throws if ambiguous. */
function entryFor(page: number, text: string): CoverageEntry {
  const matches = coverage.entries.filter(
    (e) => e.page === page && e.text === text,
  );
  expect(
    matches,
    `expected exactly one entry for p${page} "${text}"`,
  ).toHaveLength(1);
  return matches[0];
}

describe('committed SRD source-coverage artifacts — integrity', () => {
  it('inventory and coverage describe the same item set in reading order', () => {
    expect(inventory.length).toBeGreaterThan(2000);
    expect(coverage.entries).toHaveLength(inventory.length);
    const locator = (x: { page: number; lineIndex: number }) =>
      `${x.page}:${x.lineIndex}`;
    expect(coverage.entries.map(locator)).toEqual(inventory.map(locator));
    // Reading order: sorted by (page, lineIndex).
    const sorted = [...inventory].sort(
      (a, b) => a.page - b.page || a.lineIndex - b.lineIndex,
    );
    expect(inventory.map(locator)).toEqual(sorted.map(locator));
  });

  it('accounts for every source structure (the gate is closed)', () => {
    expect(coverage.summary.unaccounted).toBe(0);
    expect(
      coverage.entries.filter((e) => e.status === 'unaccounted'),
    ).toHaveLength(0);
  });

  it('summary counts match the entries', () => {
    const counted =
      coverage.summary.record +
      coverage.summary.childOf +
      coverage.summary.unaccounted +
      Object.values(coverage.summary.ignored).reduce((a, b) => a + b, 0) +
      Object.values(coverage.summary.knownGap).reduce((a, b) => a + b, 0);
    expect(counted).toBe(coverage.entries.length);
  });

  it('every known-gap status names an eshyra bead', () => {
    for (const beadId of Object.keys(coverage.summary.knownGap)) {
      expect(beadId).toMatch(/^eshyra-/);
    }
  });

  it('pins the exact coverage baseline so silent reclassification fails loudly', () => {
    // A tight baseline: regenerating the artifacts can keep `unaccounted === 0`
    // while quietly moving a covered structure into a broad known-gap rule
    // (notably the class-chapter fallback `known-gap:eshyra-4a7.6`). The
    // integrity checks above would miss that; these exact counts will not.
    // When an eshyra-4a7.* gap bead lands and regenerates the artifacts, update
    // these numbers in the same change that removes the matching curation rule.
    expect(inventory).toHaveLength(2258);
    // record 1849 -> 1873 (eshyra-4a7.3): the 24 document-wide table records
    // claim their captions / caption-less runs. The eshyra-4a7.3 catch-all
    // known-gap rule is gone; its remaining items moved to scoped owners. The
    // The deity tables (5 items), Half-Dragon Template region (3), and the
    // Self-Sufficiency prose sidebar (1) joined their regions under
    // eshyra-4a7.10.
    // eshyra-4a7.6 dropped 128 -> 116 (the Barbarian progression caption,
    // seven Circle of the Land tables, Life Domain / Oath of Devotion /
    // Fiend Expanded spell tables, and Creating Spell Slots are now records);
    // eshyra-4a7.7's two Draconic Ancestry captions are now records, so its
    // rule was removed per the known-gap lifecycle.
    // record 1873 -> 1875 (eshyra-4a7.4): Avatar of Death and Giant Fly are now
    // emitted `stat-block` records, so the name auto-match claims their two
    // `structure: 'stat-block'` inventory items and the `known-gap:eshyra-4a7.4`
    // rule (2 items) was removed per the known-gap lifecycle.
    // record 1875 -> 1902 (eshyra-4a7.8): Figurine of Wondrous Power and all 26
    // formerly deferred Magic Items table structures are now records. The
    // Spell Scroll structure also resolves explicitly to its table record
    // instead of the same-name magic item.
    // record 1902 -> 1914 (eshyra-4a7.6): the 11 remaining class progression
    // table captions ("The Bard" … "The Wizard") and the Druid's Beast Shapes
    // caption now auto-match their emitted table records (12 items). The
    // Cleric's Destroy Undead table caption was already record-status (it
    // auto-matched the same-name feature); it now maps explicitly to
    // table:destroy-undead, so the count is unchanged by that one.
    // record 1914 -> 1923 (eshyra-o4j7): all nine spell-embedded table
    // structures now resolve to emitted table records.
    // record 1923 -> 1934 (eshyra-4a7.10.1): four Races headings and seven
    // Equipment/Self-Sufficiency headings moved from known-gap to their new
    // rule records. Four additional Races headings were already record-status
    // through incorrect same-name auto-matches; explicit rules now point them
    // at their source-correct parent-qualified records without changing count.
    // record 1934 -> 1937 (eshyra-4a7.10.3): the Half-Dragon Template heading
    // and its two caption-less table runs now map to emitted records.
    // record 1937 -> 1943 (eshyra-4a7.10.4): the "Sentient Magic Items" section
    // heading (formerly document-structure) and the five Creating/Abilities/
    // Communication/Special Purpose/Conflict headings (formerly known-gap) now
    // map to emitted rule records. The Senses and Alignment headings were
    // already record-status through incorrect same-name auto-matches; explicit
    // rules now point them at their source-correct parent-qualified records
    // without changing count.
    expect(coverage.summary.record).toBe(1943);
    // childOf 14 -> 98 (eshyra-4a7.6, PR2): the broad class-chapter known-gap is
    // gone. The 86 feature-option / spellcasting-boilerplate leaf subheadings
    // plus the Rogue's "Thieves' Cant" subsection map child-of their owning
    // feature/subclass records (the text rides in those bodies), verified
    // present.
    // 98 -> 99 (eshyra-citg): "Tenets of Devotion" heading now maps child-of
    // subclass:oath-of-devotion (its prose is a named section on that record).
    expect(coverage.summary.childOf).toBe(99);
    expect(coverage.summary.unaccounted).toBe(0);
    // eshyra-4a7.6 (PR2) added two class-chapter ignore reasons: the 9 class
    // progression-table column-header fragments (table internals) and the 2
    // subclass spell-table headings (their tables are emitted + linked via
    // subclass.data.spellTableRefs). The 8 subclass-group section headings fall
    // to the document-structure default (41 -> 49).
    // eshyra-4a7.10.4: the "Sentient Magic Items" section heading now maps to
    // its emitted intro rule instead of the document-structure default
    // (49 -> 48).
    expect(coverage.summary.ignored).toEqual({
      'class-progression-table-internal': 9,
      'document-structure': 48,
      'equipment-category-heading': 3,
      'front-matter': 2,
      'record-group-heading': 3,
      'spell-list-header': 78,
      'subclass-spell-table-heading': 2,
      'table-rows-emitted-as-records': 18,
      'variant-rule-excluded': 2,
    });
    // eshyra-4a7.6 (PR2): the broad class-chapter known-gap is removed entirely.
    // eshyra-citg: the "Tenets of Devotion" heading is now child-of
    // subclass:oath-of-devotion (its prose is a named section on that record),
    // so the eshyra-citg known-gap rule is gone.
    // eshyra-4a7.10.4: the five Creating Sentient Magic Items / Abilities /
    // Communication / Special Purpose / Conflict guidance headings moved from
    // known-gap to their emitted rule records (56 -> 51).
    expect(coverage.summary.knownGap).toEqual({
      'eshyra-4a7.10': 51,
    });
  });
});

describe('committed SRD source-coverage artifacts — known-gap sentinels', () => {
  it('Figurine of Wondrous Power (p221) is emitted as a magic-item record', () => {
    const entry = entryFor(221, 'Figurine of Wondrous Power');
    expect(entry.status).toBe('record:magic-item:figurine-of-wondrous-power');
  });

  it('embedded stat blocks Avatar of Death (p218) and Giant Fly (p222) are detected and emitted as stat-block records (eshyra-4a7.4)', () => {
    // Detected by typography (still `structure: 'stat-block'`) AND now accounted
    // for as emitted `stat-block` records, claimed by the name auto-match — they
    // no longer disappear into magic-item prose as a known gap.
    const avatar = entryFor(218, 'Avatar of Death');
    expect(avatar.structure).toBe('stat-block');
    expect(avatar.status).toBe('record:stat-block:avatar-of-death');
    const fly = entryFor(222, 'Giant Fly');
    expect(fly.structure).toBe('stat-block');
    expect(fly.status).toBe('record:stat-block:giant-fly');
  });

  it('an ordinary Monsters-chapter stat block (Aboleth) is detected and accounted as a creature record', () => {
    // Regression contract (eshyra-4a7.4): the document-wide stat-block work must
    // NOT disturb the strict-creature accounting. The monster/NPC inventory
    // items stay `structure: 'stat-block'` and resolve to their `creature`
    // records via the name auto-match, never the inline `stat-block` kind.
    const aboleth = coverage.entries.filter(
      (e) => e.text === 'Aboleth' && e.structure === 'stat-block',
    );
    expect(aboleth).toHaveLength(1);
    expect(aboleth[0].status).toBe('record:creature:aboleth');
  });

  it('an Appendix MM-B NPC stat block (Berserker) is detected and accounted as a creature record', () => {
    // Berserker is chosen because it has no cross-kind name collision; the SRD's
    // Acolyte NPC shares its name with the Acolyte background, whose record sorts
    // first and legitimately claims that shared inventory item.
    const berserker = coverage.entries.filter(
      (e) => e.text === 'Berserker' && e.structure === 'stat-block',
    );
    expect(berserker).toHaveLength(1);
    expect(berserker[0].status).toBe('record:creature:berserker');
  });

  it('the Ring of Resistance embedded d10 table (p237) is emitted as a table record', () => {
    const entry = entryFor(237, 'd10 Damage Type Gem');
    expect(entry.structure).toBe('table-shape');
    expect(entry.status).toBe('record:table:ring-of-resistance');
  });

  it('the Carpet of Flying embedded size table (p213) is emitted as a table record', () => {
    const entry = entryFor(213, 'd100 Size Capacity Flying Speed');
    expect(entry.structure).toBe('table-shape');
    expect(entry.status).toBe('record:table:carpet-of-flying');
  });

  it('the Teleport familiarity matrix (p186) is emitted as a table record', () => {
    const entry = entryFor(186, 'Similar Off On');
    expect(entry.structure).toBe('table-shape');
    expect(entry.status).toBe('record:table:teleport-familiarity');
  });

  it('known-gap:eshyra-o4j7 does not remain after the spell tables are emitted', () => {
    expect(
      coverage.entries.some((e) => e.status === 'known-gap:eshyra-o4j7'),
    ).toBe(false);
  });

  it('the Celtic Deities table (p360) belongs to the Appendix PH-B region tracked by eshyra-4a7.10', () => {
    const entry = entryFor(360, 'Celtic Deities');
    expect(entry.structure).toBe('table-caption');
    expect(entry.status).toBe('known-gap:eshyra-4a7.10');
  });

  it('the Half-Dragon Template region (p320-321) is emitted as rule and table records', () => {
    expect(entryFor(320, 'Half-Dragon Template').status).toBe(
      'record:rule:half-dragon-template',
    );
    const colors = entryFor(320, 'Color Damage Resistance');
    expect(colors.structure).toBe('table-shape');
    expect(colors.status).toBe('record:table:half-dragon-damage-resistance');
    const sizes = entryFor(321, 'Optional');
    expect(sizes.structure).toBe('table-shape');
    expect(sizes.status).toBe('record:table:half-dragon-breath-weapon');
  });

  it('the Sentient Magic Items construction guidance (p251-252) is emitted as rule records (eshyra-4a7.10.4)', () => {
    expect(entryFor(251, 'Sentient Magic Items').status).toBe(
      'record:rule:sentient-magic-items',
    );
    expect(entryFor(251, 'Creating Sentient Magic Items').status).toBe(
      'record:rule:creating-sentient-magic-items',
    );
    expect(entryFor(251, 'Abilities').status).toBe('record:rule:abilities');
    expect(entryFor(251, 'Communication').status).toBe(
      'record:rule:communication',
    );
    expect(entryFor(251, 'Special Purpose').status).toBe(
      'record:rule:special-purpose',
    );
    expect(entryFor(252, 'Conflict').status).toBe('record:rule:conflict');
  });

  it('the Magic Items Senses/Alignment headings map to the sentient rules without stealing the Monsters headings (eshyra-4a7.10.4)', () => {
    // The sentient "Senses"/"Alignment" rules are parent-qualified, so they
    // share their bare title with the Monsters stat-block "Senses" rule and the
    // Beyond-1st-Level "Alignment" rule. Explicit record rules keep each source
    // heading on its source-correct record rather than letting the name
    // auto-match collide them.
    expect(entryFor(251, 'Senses').section).toBe('Magic Items');
    expect(entryFor(251, 'Senses').status).toBe(
      'record:rule:creating-sentient-magic-items-senses',
    );
    expect(entryFor(257, 'Senses').section).toBe('Monsters');
    expect(entryFor(257, 'Senses').status).toBe('record:rule:senses');
    expect(entryFor(251, 'Alignment').section).toBe('Magic Items');
    expect(entryFor(251, 'Alignment').status).toBe(
      'record:rule:creating-sentient-magic-items-alignment',
    );
    expect(entryFor(255, 'Alignment').section).toBe('Monsters');
    expect(entryFor(255, 'Alignment').status).toBe('record:rule:alignment');
  });

  it('the Self-Sufficiency prose sidebar (p73, table-shaped by typography) is emitted as a rule', () => {
    const entry = entryFor(73, 'Self-Sufficiency');
    expect(entry.structure).toBe('table-caption');
    expect(entry.status).toBe('record:rule:self-sufficiency');
  });

  it('the Races p3 headings map to their source-correct rule records', () => {
    expect(entryFor(3, 'Racial Traits').status).toBe(
      'record:rule:racial-traits',
    );
    expect(entryFor(3, 'Alignment').status).toBe(
      'record:rule:racial-traits-alignment',
    );
    expect(entryFor(3, 'Size').status).toBe('record:rule:racial-traits-size');
  });

  it('the Monsters p254 Size heading remains mapped to the stat-block interpretation rule', () => {
    const entry = entryFor(254, 'Size');
    expect(entry.section).toBe('Monsters');
    expect(entry.structure).toBe('heading');
    expect(entry.status).toBe('record:rule:size');
  });

  it('Tenets of Devotion (p33) is child-of subclass:oath-of-devotion, not a known-gap (eshyra-citg)', () => {
    // Regression: before eshyra-citg the "Tenets of Devotion" heading was
    // known-gap:eshyra-citg. Now the parser collects its prose as a named
    // section on the subclass record; the heading maps child-of that record.
    const entry = entryFor(33, 'Tenets of Devotion');
    expect(entry.status).toBe('child-of:subclass:oath-of-devotion');
  });

  it('known-gap:eshyra-citg does not appear in the committed coverage (eshyra-citg closed)', () => {
    expect(
      coverage.entries.some((e) => e.status === 'known-gap:eshyra-citg'),
    ).toBe(false);
  });
});

describe('committed SRD source-coverage artifacts — ambiguous-match diagnostic (eshyra-xwic)', () => {
  it('artifact carries an ambiguous section with shadowedRecords and collapsedSourceItems', () => {
    expect(coverage.ambiguous).toBeDefined();
    expect(Array.isArray(coverage.ambiguous.shadowedRecords)).toBe(true);
    expect(Array.isArray(coverage.ambiguous.collapsedSourceItems)).toBe(true);
  });

  it('pins exact ambiguous-match counts so silent drift fails loudly', () => {
    // When a bead closes a name collision (e.g. by adding an explicit
    // recordRule that disambiguates a duplicate, or by renaming a record),
    // these counts should drop and the test should be updated in the same change.
    // Same-name magic-item/table records add 19 reviewed shadowed-record
    // diagnostics. Explicit Spell Scroll table accounting removes its former
    // two-source-item collapse.
    // eshyra-4a7.6: the new table:destroy-undead shares its name with
    // feature:cleric:destroy-undead, adding one shadowed-record diagnostic
    // (81 -> 82). With the table caption now claimed by an explicit recordRule
    // rather than the auto-match, "Destroy Undead" is no longer a collapsed
    // two-source-item group (59 -> 58).
    // eshyra-4a7.10.1 adds parent-qualified racial Alignment/Languages/Speed
    // records to existing collision groups and creates a new Size collision
    // group, increasing the group count by one (82 -> 83).
    // eshyra-4a7.10.4: the sentient-item "Senses" rule adds a new two-record
    // "senses" collision group (83 -> 84); the sentient-item "Alignment" rule
    // joins the existing "alignment" collision group without adding a group.
    expect(coverage.ambiguous.shadowedRecords).toHaveLength(84);
    // The explicit p3/p254 Size mappings prevent those two source headings
    // from collapsing onto one record (58 -> 57). eshyra-4a7.10.4: the explicit
    // Magic Items / Monsters Senses mappings split the former two-source-item
    // "Senses" collapse onto their own records (57 -> 56).
    expect(coverage.ambiguous.collapsedSourceItems).toHaveLength(56);
  });

  it('surfaces the 12-way Ability Score Improvement feature collapse (one per class, all map to barbarian key)', () => {
    const asi = coverage.ambiguous.collapsedSourceItems.find(
      (g) => g.resolvedKey === 'feature:barbarian:ability-score-improvement',
    );
    expect(asi).toBeDefined();
    expect(asi?.text).toBe('Ability Score Improvement');
    expect(asi?.count).toBe(12);
  });

  it('surfaces the Acolyte cross-kind collision (background and creature share the same name)', () => {
    const shadow = coverage.ambiguous.shadowedRecords.find(
      (r) => r.normalizedName === 'acolyte',
    );
    expect(shadow).toBeDefined();
    expect(shadow?.winnerKey).toBe('background:acolyte');
    expect(shadow?.shadowedKeys).toContain('creature:acolyte');
  });

  it('surfaces the Actions collapse (monster stat-block sections all map to the rule:actions key)', () => {
    const actions = coverage.ambiguous.collapsedSourceItems.find(
      (g) => g.resolvedKey === 'rule:actions',
    );
    expect(actions).toBeDefined();
    expect(actions?.text).toBe('Actions');
    // 296 creature + 21 NPC stat blocks each have an Actions section; the
    // exact count may change as the monster chapter parser evolves. Gate on
    // a minimum so a regression that drops entries fails, not the exact value.
    expect(actions?.count).toBeGreaterThanOrEqual(300);
  });

  it('shadowedRecords entries are sorted by normalizedName', () => {
    const names = coverage.ambiguous.shadowedRecords.map(
      (r) => r.normalizedName,
    );
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it('collapsedSourceItems entries are sorted by resolvedKey', () => {
    const keys = coverage.ambiguous.collapsedSourceItems.map(
      (g) => g.resolvedKey,
    );
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });
});

describe('committed SRD source-coverage artifacts — covered-structure sentinels', () => {
  it('the Champion subclass feature heading Improved Critical (p25) resolves to its feature record', () => {
    const entry = entryFor(25, 'Improved Critical');
    expect(entry.status).toBe('record:feature:champion:improved-critical');
  });

  it('the bare "Lightfoot" subrace heading (p5) maps to the renamed ancestry record', () => {
    const entry = entryFor(5, 'Lightfoot');
    expect(entry.status).toBe('record:ancestry:lightfoot-halfling');
  });

  it('race trait subsections resolve as child data on ancestry records', () => {
    const entry = entryFor(3, 'Dwarf Traits');
    expect(entry.status).toBe('child-of:ancestry:dwarf');
  });

  it('creature variant sidebars resolve as child data on the creatures they modify (eshyra-70xr)', () => {
    expect(entryFor(378, 'Variant: Diseased Giant Rats').status).toBe(
      'child-of:creature:giant-rat',
    );
    expect(entryFor(391, 'Variant: Insect Swarms').status).toBe(
      'child-of:creature:swarm-of-insects',
    );
  });

  it('the duplicate Draconic Ancestry captions (p5 Races, p44 Sorcerer) resolve to their OWN table records', () => {
    // Both captions print the same text, so the name auto-match alone cannot
    // tell them apart; explicit per-chapter record rules (which outrank the
    // auto-match) map each caption to its own emitted record (eshyra-4a7.3).
    const races = entryFor(5, 'Draconic Ancestry');
    expect(races.structure).toBe('table-caption');
    expect(races.status).toBe('record:table:draconic-ancestry');
    const sorcerer = entryFor(44, 'Draconic Ancestry');
    expect(sorcerer.structure).toBe('table-caption');
    expect(sorcerer.status).toBe(
      'record:table:draconic-bloodline-draconic-ancestry',
    );
  });

  it('the Barbarian progression caption (p8) resolves to the emitted table record', () => {
    const entry = entryFor(8, 'The Barbarian');
    expect(entry.structure).toBe('table-caption');
    expect(entry.status).toBe('record:table:the-barbarian');
  });

  it('the bare Circle of the Land terrain captions (p22) resolve to their qualified table records', () => {
    const arctic = entryFor(22, 'Arctic');
    expect(arctic.structure).toBe('table-caption');
    expect(arctic.status).toBe('record:table:circle-of-the-land-arctic');
    const swamp = entryFor(22, 'Swamp');
    expect(swamp.status).toBe('record:table:circle-of-the-land-swamp');
  });

  it('caption-less magic-item table runs resolve to their owning-item-named table records', () => {
    const wand = entryFor(250, 'd100 Effect');
    expect(wand.structure).toBe('table-shape');
    expect(wand.status).toBe('record:table:wand-of-wonder');
    const beans = entryFor(209, 'd100 Effect');
    expect(beans.status).toBe('record:table:bag-of-beans');
    const belt = entryFor(211, 'Type Strength Rarity');
    expect(belt.status).toBe('record:table:belt-of-giant-strength');
  });

  it('the Donning and Doffing Armor caption (p64) resolves to the emitted table record', () => {
    const entry = entryFor(64, 'Donning and Doffing Armor');
    expect(entry.structure).toBe('table-caption');
    expect(entry.status).toBe('record:table:donning-and-doffing-armor');
  });
});
