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
  readonly resolution: {
    readonly kind: string;
    readonly ownerKey?: string;
    readonly candidateKeys?: readonly string[];
    readonly normalizedName?: string;
    readonly field?: string;
  };
  readonly structuredFieldEvidence?: {
    readonly sourceClass: string;
    readonly spellLevel: number | null;
    readonly memberCount: number;
    readonly spellKeys: readonly string[];
  };
}

interface CoverageReport {
  readonly summary: {
    readonly record: number;
    readonly childOf: number;
    readonly ambiguous: number;
    readonly taxonomy: number;
    readonly structuredField: number;
    readonly ignored: Readonly<Record<string, number>>;
    readonly knownGap: Readonly<Record<string, number>>;
    readonly unaccounted: number;
  };
  readonly diagnostics: {
    readonly recordNameCollisions: readonly {
      readonly normalizedName: string;
      readonly candidateKeys: readonly string[];
      readonly occurrences: readonly unknown[];
      readonly unresolved: boolean;
    }[];
    readonly duplicateSourceText: readonly {
      readonly normalizedText: string;
      readonly category: string;
      readonly occurrences: readonly unknown[];
    }[];
    readonly suspiciousOwnership: readonly unknown[];
    readonly unresolvedOwnership: readonly unknown[];
  };
  readonly entries: readonly CoverageEntry[];
}

interface SourceRegionLedgerEntry {
  readonly id: string;
  readonly pageStart: number;
  readonly pageEnd: number;
  readonly headingPath: readonly string[];
  readonly sourceContext: string | null;
  readonly regionType: string;
  readonly firstPhrase: string;
  readonly lastPhrase: string;
  readonly normalizedCharCount: number;
  readonly classification: string;
  readonly targetKey?: string;
  readonly ignoreReason?: string;
}

interface SourceRegionLedger {
  readonly summary: {
    readonly entries: number;
    readonly proseRegions: number;
    readonly pureStructure: number;
    readonly record: number;
    readonly childOf: number;
    readonly structuredField: number;
    readonly intentionallyIgnored: Readonly<Record<string, number>>;
    readonly pureDocumentStructure: number;
    readonly unrepresented: number;
    readonly broadStructuralIgnores: number;
    readonly unaccountedPages: readonly number[];
  };
  readonly entries: readonly SourceRegionLedgerEntry[];
}

const inventory = JSON.parse(
  readFileSync(join(PACK_DIR, 'source-inventory.json'), 'utf8'),
) as readonly InventoryItem[];

const coverage = JSON.parse(
  readFileSync(join(PACK_DIR, 'source-coverage.json'), 'utf8'),
) as CoverageReport;

const sourceRegionLedger = JSON.parse(
  readFileSync(join(PACK_DIR, 'source-region-ledger.json'), 'utf8'),
) as SourceRegionLedger;

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
      coverage.summary.ambiguous +
      coverage.summary.taxonomy +
      coverage.summary.structuredField +
      coverage.summary.unaccounted +
      Object.values(coverage.summary.ignored).reduce((a, b) => a + b, 0) +
      Object.values(coverage.summary.knownGap).reduce((a, b) => a + b, 0);
    expect(counted).toBe(coverage.entries.length);
  });

  it('represents every spell-list heading with source-positioned membership evidence', () => {
    const spellEntries = coverage.entries.filter(
      (entry) =>
        entry.page >= 105 &&
        entry.page <= 113 &&
        entry.status === 'structured-field:spell.data.classes',
    );
    expect(spellEntries).toHaveLength(78);
    expect(spellEntries.every((entry) => entry.structuredFieldEvidence)).toBe(
      true,
    );
    const levelGroups = spellEntries.filter(
      (entry) => entry.structuredFieldEvidence?.spellLevel !== null,
    );
    expect(levelGroups).toHaveLength(70);
    expect(
      levelGroups.every((entry) =>
        entry.structuredFieldEvidence?.spellKeys.every((key) =>
          key.startsWith('spell:'),
        ),
      ),
    ).toBe(true);
    expect(
      levelGroups.reduce(
        (count, entry) =>
          count + (entry.structuredFieldEvidence?.memberCount ?? 0),
        0,
      ),
    ).toBe(778);
    expect(
      coverage.entries.some(
        (entry) =>
          entry.page >= 105 &&
          entry.page <= 113 &&
          entry.status === 'ignored:spell-list-header',
      ),
    ).toBe(false);
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
    // record 1943 -> 1944 (eshyra-4a7.10.6): the Appendix MM-B "Customizing
    // NPCs" subsection heading (formerly known-gap) now maps to its emitted
    // rule record.
    // record 1944 -> 1960 (eshyra-4a7.10.5): the Appendix PH-B four pantheon
    // headings + four deity-table captions (8) and the Appendix PH-C eight
    // plane headings (8) moved from known-gap to their emitted rule/table
    // records.
    // record 1960 -> 1961 (eshyra-76b7): the "Appendix MM-A: Miscellaneous
    // Creatures" heading now name-matches its emitted intro rule record instead
    // of falling to the document-structure ignore default.
    // Ambiguous bare-name matches no longer count as records. Contextual
    // stat-block headings move to childOf; unresolved collisions remain
    // reviewer-visible in the ambiguous total.
    // eshyra-7qit maps ten previously ignored/ambiguous Equipment,
    // Expenses, Diseases, and Poisons headings to their new rules.
    // record 1430 -> 1442 (eshyra-g9im / eshyra-i2v4): twelve chapter/appendix/
    // subclass-category headings (Feats, Using Ability Scores, Appendix PH-A:
    // Conditions, Appendix MM-B: Nonplayer Characters, and the eight
    // subclass-category headings Martial Archetypes … Arcane Traditions) now
    // name-match their emitted intro/overview rule records instead of falling to
    // the document-structure ignore default.
    // record 1442 -> 1444 (eshyra-45fw): the Magic Items A-Z heading moved from
    // document-structure and the Sample Traps heading moved from
    // record-group-heading to their emitted intro rule records.
    // record 1444 -> 1445 (eshyra-lo1o): the Spellcasting chapter heading now
    // maps to the emitted Spellcasting chapter-intro rule.
    // 1445 -> 1452: armor category headings, Adventuring Gear, and subclass
    // spell-table intro headings now map to emitted source-bounded rules.
    // 1452 -> 1453 (eshyra-o9bd.2/.3): Rogue's "Thieves' Cant" subsection, split
    // out of feature:rogue:sneak-attack into its own feature:rogue:thieves-cant
    // record, now maps to that record instead of riding in Sneak Attack's body.
    // 1453 -> 1444 (eshyra-erf5.1): curated non-record rules (child-of/ignore/
    // taxonomy/known-gap) now outrank the bare-name auto-match, the same as
    // record-type rules already did — a same-named-but-unrelated record must
    // not silently swallow a source item a curated rule already classifies.
    // This resurrects several previously-dead-but-correct curated rules: the
    // p78 five per-ability "Skills" bullet captions move to child-of
    // rule:skills instead of the unrelated same-named per-ability rule records
    // (-5); "Two-Weapon Fighting" under Fighter/Ranger moves child-of its
    // owning feature:*:fighting-style instead of the unrelated general combat
    // rule:two-weapon-fighting (-2); the Equipment "Tools" and Spellcasting-
    // section "Poisons" table captions move to the existing
    // table-rows-emitted-as-records ignore instead of the unrelated same-named
    // rule:tools / rule:poisons (-2). One stale curated rule that would have
    // wrongly resurfaced (a `feature:rogue:sneak-attack` child-of predicate for
    // "Thieves' Cant" written before that text got its own
    // feature:rogue:thieves-cant record) was removed, and the eldritch-
    // invocations page-range rule gained two exclusions for "Dark One's
    // Blessing" / "Dark One's Own Luck" (The Fiend's own p50 features,
    // interleaved with the invocation list) so both keep resolving to their
    // real feature:the-fiend:* records via the auto-match.
    expect(coverage.summary.record).toBe(1444);
    // childOf 14 -> 98 (eshyra-4a7.6, PR2): the broad class-chapter known-gap is
    // gone. The 86 feature-option / spellcasting-boilerplate leaf subheadings
    // map child-of their owning feature/subclass records (the text rides in
    // those bodies), verified present.
    // 98 -> 99 (eshyra-citg): "Tenets of Devotion" heading now maps child-of
    // subclass:oath-of-devotion (its prose is a named section on that record).
    // 456 -> 455 (eshyra-o9bd.2/.3): Rogue's "Thieves' Cant" subsection no longer
    // rides child-of Sneak Attack; it is its own feature record (see `record`).
    // 455 -> 462 (eshyra-erf5.1): the same reordering fix moves the seven
    // record-count decreases above (minus the two that landed in `ignored`)
    // into `childOf` instead: the five p78 ability captions (+5) and the two
    // Two-Weapon Fighting headings (+2).
    expect(coverage.summary.childOf).toBe(462);
    expect(coverage.summary.ambiguous).toBe(187);
    expect(coverage.summary.taxonomy).toBe(33);
    expect(coverage.summary.structuredField).toBe(78);
    expect(coverage.summary.unaccounted).toBe(0);
    // eshyra-4a7.6 (PR2) added two class-chapter ignore reasons: the 9 class
    // progression-table column-header fragments (table internals) and the 2
    // subclass spell-table headings (their tables are emitted + linked via
    // subclass.data.spellTableRefs). The 8 subclass-group section headings fall
    // to the document-structure default (41 -> 49).
    // eshyra-4a7.10.4: the "Sentient Magic Items" section heading now maps to
    // its emitted intro rule instead of the document-structure default
    // (49 -> 48).
    // eshyra-4a7.10.5: the Appendix PH-B "Suggested Domains Symbol" deity-table
    // column-group header (a table internal of the emitted deity tables) is
    // ignored with its own reason.
    // eshyra-76b7: the "Appendix MM-A: Miscellaneous Creatures" heading now
    // maps to its emitted intro rule instead of the document-structure default
    // (48 -> 47).
    // eshyra-g9im / eshyra-i2v4: twelve chapter/appendix/subclass-category
    // headings now own intro/overview rule records, so each moves off the
    // document-structure default — including the eight subclass-category
    // headings that previously fell here (42 -> 30).
    // eshyra-45fw: Magic Items A-Z now maps to its emitted intro rule instead
    // of document-structure (30 -> 29), and Sample Traps now maps to its emitted
    // intro rule instead of the lone record-group-heading ignore. The source
    // region ledger follow-up removes equipment-category-heading and subclass-
    // spell-table-heading by mapping those headings to emitted rules, and moves
    // Adventuring Gear out of table-rows-emitted-as-records.
    // eshyra-erf5.1: table-rows-emitted-as-records 11 -> 13. The Equipment
    // "Tools" and Spellcasting-section "Poisons" table captions now resolve to
    // this pre-existing (previously dead) ignore rule instead of the
    // unrelated same-named rule:tools / rule:poisons prose records — see the
    // `record` count comment above.
    expect(coverage.summary.ignored).toEqual({
      'class-progression-table-internal': 9,
      'deity-table-column-header': 1,
      'document-structure': 29,
      'front-matter': 2,
      'table-rows-emitted-as-records': 13,
    });
    // eshyra-4a7.6 (PR2): the broad class-chapter known-gap is removed entirely.
    // eshyra-citg: the "Tenets of Devotion" heading is now child-of
    // subclass:oath-of-devotion (its prose is a named section on that record),
    // so the eshyra-citg known-gap rule is gone.
    // eshyra-4a7.10.4: the five Creating Sentient Magic Items / Abilities /
    // Communication / Special Purpose / Conflict guidance headings moved from
    // known-gap to their emitted rule records (56 -> 51).
    // eshyra-4a7.10.6: the Appendix MM-B "Customizing NPCs" heading moved from
    // known-gap to its emitted rule record (51 -> 50).
    // eshyra-4a7.10.5: the 17 Appendix PH-B / PH-C headings, captions, and the
    // deity-table column header moved out of known-gap (16 to records, 1 to the
    // deity-table-column-header ignore), leaving only the Monsters-chapter
    // creature-family lore headings (50 -> 33).
    expect(coverage.summary.knownGap).toEqual({});
  });
});

describe('committed SRD source-region ledger artifact — prose gate', () => {
  function regionContaining(phrase: string): SourceRegionLedgerEntry {
    const match = sourceRegionLedger.entries.find(
      (entry) =>
        entry.firstPhrase.includes(phrase) || entry.lastPhrase.includes(phrase),
    );
    expect(
      match,
      `expected source-region ledger entry for "${phrase}"`,
    ).toBeDefined();
    return match as SourceRegionLedgerEntry;
  }

  it('has no unrepresented prose and no broad structural ignore over prose', () => {
    expect(sourceRegionLedger.summary.proseRegions).toBeGreaterThan(2000);
    expect(sourceRegionLedger.summary.unrepresented).toBe(0);
    expect(sourceRegionLedger.summary.broadStructuralIgnores).toBe(0);
    // eshyra-o9bd.18.8.3: spell-list regions are source-positioned structured
    // ownership, so duplicate spell names cannot be claimed by a subclass table.
    // eshyra-erf5.5: table-rows-only pages (p69's Adventuring Gear price-list
    // body, the p360-361 deity-table column-header run) now carry explicit
    // table-rows entries instead of silently owning nothing, classified under
    // the owning structure's documented reason.
    expect(sourceRegionLedger.summary.intentionallyIgnored).toEqual({
      'deity-table-column-header': 1,
      'front-matter': 2,
      'table-rows-emitted-as-records': 2,
    });
    expect(sourceRegionLedger.summary.structuredField).toBe(83);
  });

  it('source-positions the page-109 Ranger sentinel away from the Circle table', () => {
    const rangerHeading = entryFor(109, 'Ranger Spells');
    expect(rangerHeading.resolution).toEqual(
      expect.objectContaining({
        kind: 'curated-structured-field',
        field: 'spell.data.classes',
      }),
    );
    expect(rangerHeading.status).toBe('structured-field:spell.data.classes');
    const region = sourceRegionLedger.entries.find(
      (entry) =>
        entry.pageStart === 109 &&
        entry.firstPhrase.includes('Commune with Nature'),
    );
    expect(region).toEqual(
      expect.objectContaining({
        classification: 'structured-field:spell.data.classes',
      }),
    );
    expect(region?.classification).not.toBe(
      'record:table:circle-of-the-land-forest',
    );
    expect(
      sourceRegionLedger.entries.some(
        (entry) =>
          entry.pageStart >= 105 &&
          entry.pageStart <= 113 &&
          entry.classification === 'intentionally-ignored:spell-list-header',
      ),
    ).toBe(false);
  });

  it('gives every previously silent table-rows-only page explicit accounting (eshyra-erf5.5)', () => {
    // p69, p361, and p362 had zero ledger entries before eshyra-erf5.5 even
    // though their content is fully represented (equipment records; deity
    // table: records' rows). Pin their explicit accounting so a page can
    // never again vanish behind a zero-unrepresented summary.
    expect(sourceRegionLedger.summary.unaccountedPages).toEqual([]);

    const entriesTouching = (page: number) =>
      sourceRegionLedger.entries.filter(
        (entry) => entry.pageStart <= page && page <= entry.pageEnd,
      );
    expect(entriesTouching(69).length).toBeGreaterThan(0);
    expect(entriesTouching(361).length).toBeGreaterThan(0);
    expect(entriesTouching(362).length).toBeGreaterThan(0);

    // The deity table rows are the owning table records' own row data; the
    // Norse run's p362 continuation (Frigga through Uller) must be attributed
    // to table:norse-deities specifically.
    const norse = sourceRegionLedger.entries.find(
      (entry) => entry.id === 'p361-l43-table-rows',
    );
    expect(norse).toMatchObject({
      regionType: 'table-rows',
      pageStart: 361,
      pageEnd: 362,
      classification: 'record:table:norse-deities',
      targetKey: 'table:norse-deities',
    });

    // The Adventuring Gear price-list body (including its embedded sub-group
    // captions, which render at table-cell height) is emitted as equipment
    // records, and the ledger says so explicitly.
    const priceList = sourceRegionLedger.entries.find(
      (entry) => entry.id === 'p69-l0-table-rows',
    );
    expect(priceList).toMatchObject({
      regionType: 'table-rows',
      classification: 'intentionally-ignored:table-rows-emitted-as-records',
    });
    expect(priceList?.firstPhrase).toContain('Ammunition');
  });

  it('keeps pure structural headings distinct from prose-bearing regions', () => {
    expect(sourceRegionLedger.summary.pureStructure).toBeGreaterThan(0);
    expect(
      sourceRegionLedger.entries.some(
        (entry) =>
          entry.regionType === 'pure-structure' &&
          entry.normalizedCharCount === 0 &&
          entry.classification === 'pure-document-structure',
      ),
    ).toBe(true);
  });

  it('maps previously missed prose classes to concrete records', () => {
    const expected: ReadonlyArray<{
      readonly phrase: string;
      readonly classification: string;
      readonly regionType?: string;
    }> = [
      {
        phrase: 'The rules for lifting and carrying are intentionally simple',
        classification: 'record:rule:variant-encumbrance',
      },
      {
        phrase: 'This section describes items that have special rules',
        classification: 'record:rule:adventuring-gear',
        regionType: 'group-intro',
      },
      {
        phrase: 'Made from supple and thin materials',
        classification: 'record:rule:light-armor',
      },
      {
        phrase: 'Medium armor offers more protection',
        classification: 'record:rule:medium-armor',
      },
      {
        phrase: 'Of all the armor categories',
        classification: 'record:rule:heavy-armor-category',
      },
      {
        phrase: 'Given their insidious and deadly nature',
        classification: 'record:rule:poisons',
      },
      {
        phrase: 'A feat represents a talent',
        classification: 'record:rule:feats',
        regionType: 'chapter-intro',
      },
      {
        phrase: 'Conditions alter a creature’s capabilities',
        classification: 'record:rule:conditions',
      },
      {
        phrase: 'Six abilities provide a quick description',
        classification: 'record:rule:using-ability-scores',
        regionType: 'chapter-intro',
      },
      {
        phrase: 'Different fighters choose different approaches',
        classification: 'record:rule:martial-archetypes',
      },
      {
        phrase: 'This appendix contains statistics for various humanoid',
        classification: 'record:rule:appendix-mm-b-nonplayer-characters',
      },
      {
        phrase: 'Magic items are presented in alphabetical order',
        classification: 'record:rule:magic-items-a-z',
        regionType: 'group-intro',
      },
      {
        phrase: 'The magical and mechanical traps presented here',
        classification: 'record:rule:sample-traps',
        regionType: 'group-intro',
      },
      {
        phrase: 'Magic permeates fantasy gaming worlds',
        classification: 'record:rule:spellcasting-chapter',
        regionType: 'chapter-intro',
      },
      {
        phrase: 'You gain oath spells at the paladin levels listed',
        classification: 'record:rule:oath-of-devotion-oath-spells',
      },
      {
        phrase: 'The Fiend lets you choose from an expanded list of spells',
        classification: 'record:rule:the-fiend-expanded-spell-list',
      },
    ];

    for (const { phrase, classification, regionType } of expected) {
      const entry = regionContaining(phrase);
      expect(entry.classification, phrase).toBe(classification);
      if (regionType !== undefined) {
        expect(entry.regionType, phrase).toBe(regionType);
      }
      expect(entry.normalizedCharCount, phrase).toBeGreaterThan(0);
    }
  });

  it('uses explicit ignore reasons for prose that is intentionally outside records', () => {
    const frontMatter = sourceRegionLedger.entries.find(
      (entry) => entry.classification === 'intentionally-ignored:front-matter',
    );
    expect(frontMatter).toBeDefined();
    expect(frontMatter?.normalizedCharCount).toBeGreaterThan(0);
    expect(frontMatter?.ignoreReason).toBe('front-matter');
  });

  it('gives every sidebar callout a ledger entry keyed to its emitted record (eshyra-5c7f)', () => {
    // Sidebar box body prose renders in the same h≈8.9 table-cell band as real
    // table rows, so a heading immediately followed by a sidebar body used to
    // look exactly like a heading immediately followed by a real table and
    // its body was silently skipped as table-row noise — the heading still
    // got a correct `record:`/`child-of:` coverage status, but zero ledger
    // entries ever cited it, so `source-region-ledger.json` could claim
    // `unrepresented: 0` while genuinely never having looked at these 19
    // regions (17 named in the bead plus two incidental creature-variant
    // sidebars the same fix naturally covers).
    const targetKeys = [
      'rule:druid-sacred-plants-and-wood',
      'rule:druid-druids-and-the-gods',
      'rule:paladin-breaking-your-oath',
      'rule:warlock-your-pact-boon',
      'rule:wizard-your-spellbook',
      'rule:equipment-packs',
      'rule:self-sufficiency',
      'rule:hiding',
      'rule:combat-step-by-step',
      'rule:interacting-with-objects-around-you',
      'rule:contests-in-combat',
      'rule:casting-in-armor',
      'rule:the-schools-of-magic',
      'rule:modifying-creatures',
      'rule:armor-weapon-and-tool-proficiencies',
      'rule:grapple-rules-for-monsters',
      'condition:exhaustion',
      'creature:giant-rat',
      'creature:swarm-of-insects',
    ];
    for (const targetKey of targetKeys) {
      const entries = sourceRegionLedger.entries.filter(
        (entry) => entry.targetKey === targetKey,
      );
      expect(entries.length, targetKey).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.normalizedCharCount, targetKey).toBeGreaterThan(0);
      }
    }
  });

  it('includes the p23/p34/p55 sidebar continuation pages in source evidence (eshyra-5c7f)', () => {
    // "Druids and the Gods" (p23), "Breaking Your Oath" (p33-34), and "Your
    // Spellbook" (p54-55) are each sidebars whose body text continues onto a
    // second page; the same fix that gives the sidebar a ledger entry at all
    // naturally carries its continuation page along, since the region ledger
    // attributes prose to the active owning heading regardless of page
    // breaks.
    for (const page of [23, 34, 55]) {
      const entries = sourceRegionLedger.entries.filter(
        (entry) => entry.pageStart <= page && page <= entry.pageEnd,
      );
      expect(entries.length, `page ${page}`).toBeGreaterThan(0);
    }
  });
});

describe('committed SRD source-coverage artifacts — known-gap sentinels', () => {
  it('accounts for all 33 Monsters family headings as creature taxonomy', () => {
    const taxonomyEntries = coverage.entries.filter(
      (entry) =>
        entry.section === 'Monsters' &&
        entry.status.startsWith('taxonomy:creature.familyPath:'),
    );
    expect(taxonomyEntries).toHaveLength(33);
    expect(entryFor(261, 'Angels').status).toBe(
      'taxonomy:creature.familyPath:Angels',
    );
    expect(entryFor(280, 'Dragons, Chromatic').status).toBe(
      'taxonomy:creature.familyPath:Dragons > Chromatic Dragons',
    );
    expect(entryFor(280, 'Black Dragon').status).toBe(
      'taxonomy:creature.familyPath:Dragons > Chromatic Dragons > Black Dragons',
    );
    expect(entryFor(356, 'Zombies').status).toBe(
      'taxonomy:creature.familyPath:Zombies',
    );
    expect(
      coverage.entries.some(
        (entry) => entry.status === 'known-gap:eshyra-4a7.10',
      ),
    ).toBe(false);
  });

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
    const berserker = coverage.entries.filter(
      (e) => e.text === 'Berserker' && e.structure === 'stat-block',
    );
    expect(berserker).toHaveLength(1);
    expect(berserker[0].status).toBe('record:creature:berserker');
  });

  it('Appendix MM-B Acolyte and Druid stat blocks resolve to NPC creature records despite cross-kind name collisions', () => {
    const acolyte = entryFor(395, 'Acolyte');
    expect(acolyte.structure).toBe('stat-block');
    expect(acolyte.status).toBe('record:creature:acolyte');

    const druid = entryFor(398, 'Druid');
    expect(druid.structure).toBe('stat-block');
    expect(druid.status).toBe('record:creature:druid');
  });

  it('every stat-block inventory entry resolves to a creature or inline stat-block record', () => {
    const invalid = coverage.entries.filter(
      (entry) =>
        entry.structure === 'stat-block' &&
        !/^record:(creature|stat-block):/.test(entry.status),
    );
    expect(invalid).toEqual([]);
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

  it('the Appendix PH-B pantheons region (p360-362) is emitted as rule and deity-table records (eshyra-4a7.10.5)', () => {
    // The appendix intro and four pantheon-prose headings are rule records.
    expect(entryFor(360, 'The Celtic Pantheon').status).toBe(
      'record:rule:the-celtic-pantheon',
    );
    expect(entryFor(360, 'The Norse Pantheon').status).toBe(
      'record:rule:the-norse-pantheon',
    );
    // The four deity-table captions auto-match their reconstructed table
    // records (parseDeityTables).
    const celtic = entryFor(360, 'Celtic Deities');
    expect(celtic.structure).toBe('table-caption');
    expect(celtic.status).toBe('record:table:celtic-deities');
    expect(entryFor(361, 'Norse Deities').status).toBe(
      'record:table:norse-deities',
    );
    // The deity tables' right-side column-group header is a table internal,
    // ignored with its own reason rather than emitted as a record.
    const header = entryFor(360, 'Suggested Domains Symbol');
    expect(header.structure).toBe('table-shape');
    expect(header.status).toBe('ignored:deity-table-column-header');
  });

  it('the Appendix PH-C planes region (p363-364) is emitted as rule records (eshyra-4a7.10.5)', () => {
    expect(entryFor(363, 'The Material Plane').status).toBe(
      'record:rule:the-material-plane',
    );
    expect(entryFor(363, 'Planar Travel').status).toBe(
      'record:rule:planar-travel',
    );
    expect(entryFor(364, 'Demiplanes').status).toBe('record:rule:demiplanes');
    // The SRD prints the title "Outer Planes" twice on p364 — an h≈13.9
    // subsection under "Beyond the Material" and an h≈12 sub-leaf below it.
    // Each emits its own rule record, and explicit tier-based recordRules pin
    // each source heading to its source-correct record rather than letting the
    // bare name auto-match collapse both onto the lexicographically-first key.
    const outerPlanes = coverage.entries.filter(
      (e) => e.page === 364 && e.text === 'Outer Planes',
    );
    expect(outerPlanes).toHaveLength(2);
    const subsection = outerPlanes.find((e) => e.tier === 'subsection');
    const leaf = outerPlanes.find((e) => e.tier === 'leaf');
    expect(subsection?.status).toBe(
      'record:rule:beyond-the-material-outer-planes',
    );
    expect(leaf?.status).toBe('record:rule:outer-planes-outer-planes');
    // The two headings resolve to DIFFERENT records — no same-name collapse.
    expect(subsection?.status).not.toBe(leaf?.status);
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
    expect(entryFor(255, 'Alignment').status).toBe(
      'record:rule:monsters-alignment',
    );
  });

  it('the Customizing NPCs guidance (p395) is emitted as a rule without absorbing the adjacent NPC stat blocks (eshyra-4a7.10.6)', () => {
    const guidance = entryFor(395, 'Customizing NPCs');
    expect(guidance.section).toBe('Appendix MM-B: Nonplayer Characters');
    expect(guidance.status).toBe('record:rule:customizing-npcs');
    // The first NPC stat block immediately follows the guidance prose; it must
    // stay its own creature record rather than bleeding into the rule body.
    const firstNpc = entryFor(395, 'Acolyte');
    expect(firstNpc.structure).toBe('stat-block');
    expect(firstNpc.status).toBe('record:creature:acolyte');
  });

  it('the Self-Sufficiency prose sidebar (p73, table-shaped by typography) is emitted as a rule', () => {
    const entry = entryFor(73, 'Self-Sufficiency');
    expect(entry.structure).toBe('table-caption');
    expect(entry.status).toBe('record:rule:self-sufficiency');
  });

  it('maps prose-heavy Equipment and hazard guidance headings to their rules', () => {
    const headingFor = (page: number, text: string, tier: string) => {
      const matches = coverage.entries.filter(
        (entry) =>
          entry.page === page && entry.text === text && entry.tier === tier,
      );
      expect(matches).toHaveLength(1);
      return matches[0];
    };
    expect(entryFor(62, 'Selling Treasure').status).toBe(
      'record:rule:selling-treasure',
    );
    expect(entryFor(62, 'Armor').status).toBe('record:rule:armor-guidance');
    expect(headingFor(70, 'Tools', 'section').status).toBe('record:rule:tools');
    expect(entryFor(71, 'Mounts and Vehicles').status).toBe(
      'record:rule:mounts-and-vehicles',
    );
    expect(entryFor(199, 'Diseases').status).toBe('record:rule:diseases');
    expect(entryFor(199, 'Sample Diseases').status).toBe(
      'record:rule:sample-diseases',
    );
    expect(headingFor(204, 'Poisons', 'section').status).toBe(
      'record:rule:poisons',
    );
    expect(entryFor(204, 'Sample Poisons').status).toBe(
      'record:rule:sample-poisons',
    );
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
  it('artifact carries typed provenance and separate diagnostic collections', () => {
    expect(coverage.diagnostics).toBeDefined();
    expect(Array.isArray(coverage.diagnostics.recordNameCollisions)).toBe(true);
    expect(Array.isArray(coverage.diagnostics.duplicateSourceText)).toBe(true);
    expect(Array.isArray(coverage.diagnostics.suspiciousOwnership)).toBe(true);
    expect(Array.isArray(coverage.diagnostics.unresolvedOwnership)).toBe(true);
    expect(
      coverage.entries.every(
        (entry) => typeof entry.resolution?.kind === 'string',
      ),
    ).toBe(true);
  });

  it('retains all occurrences for unresolved repeated headings', () => {
    const asi = coverage.diagnostics.duplicateSourceText.find(
      (g) => g.normalizedText === 'ability score improvement',
    );
    expect(asi?.category).toBe('unresolved-owner');
    expect(asi?.occurrences).toHaveLength(12);
    expect(coverage.diagnostics.suspiciousOwnership).toContainEqual(asi);
  });

  it('surfaces the Acolyte cross-kind collision (background and creature share the same name)', () => {
    const shadow = coverage.diagnostics.recordNameCollisions.find(
      (r) => r.normalizedName === 'acolyte',
    );
    expect(shadow).toBeDefined();
    expect(shadow?.candidateKeys).toEqual([
      'background:acolyte',
      'creature:acolyte',
    ]);
    expect(shadow).not.toHaveProperty('winnerKey');
  });

  it('attributes stat-block section headings to their owning records', () => {
    expect(entryFor(261, 'Actions').status).toBe('child-of:creature:aboleth');
    expect(entryFor(261, 'Legendary Actions').status).toBe(
      'child-of:creature:aboleth',
    );
    expect(entryFor(395, 'Actions').status).toBe('child-of:creature:acolyte');
  });

  it('diagnostic entries are sorted by normalized text', () => {
    const names = coverage.diagnostics.duplicateSourceText.map(
      (r) => r.normalizedText,
    );
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it('diagnostic occurrences expose exact source coordinates', () => {
    const group = coverage.diagnostics.duplicateSourceText.find(
      (g) => g.normalizedText === 'draconic ancestry',
    );
    expect(group?.occurrences.map((o) => `${o.page}:${o.lineIndex}`)).toEqual([
      '5:67',
      '44:87',
    ]);
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

  it('every Variant heading is represented as a record or attached child', () => {
    const variants = coverage.entries.filter((entry) =>
      entry.text.startsWith('Variant:'),
    );
    expect(variants.map((entry) => entry.text)).toEqual([
      'Variant: Skills with Different Abilities',
      'Variant: Encumbrance',
      'Variant: Diseased Giant Rats',
      'Variant: Insect Swarms',
    ]);
    expect(variants.map((entry) => entry.status)).toEqual([
      'record:rule:variant-skills-with-different-abilities',
      'record:rule:variant-encumbrance',
      'child-of:creature:giant-rat',
      'child-of:creature:swarm-of-insects',
    ]);
  });

  it('maps reviewed cross-kind headings to their source-correct records', () => {
    expect(entryFor(86, 'Darkvision').status).toBe('record:rule:darkvision');
    expect(entryFor(133, 'Darkvision').status).toBe('record:spell:darkvision');
    expect(entryFor(146, 'Fly').status).toBe('record:spell:fly');
    expect(entryFor(179, 'Shield').status).toBe('record:spell:shield');
    expect(entryFor(256, 'Fly').status).toBe('record:rule:fly');
    expect(entryFor(257, 'Darkvision').status).toBe(
      'record:rule:senses-darkvision',
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
    const duplicate = coverage.diagnostics.duplicateSourceText.find(
      (group) => group.normalizedText === 'draconic ancestry',
    );
    expect(duplicate?.category).toBe('explicitly-disambiguated');
    expect(
      duplicate?.occurrences.map((entry) => `${entry.page}:${entry.lineIndex}`),
    ).toEqual(['5:67', '44:87']);
    expect(coverage.diagnostics.suspiciousOwnership).not.toContainEqual(
      duplicate,
    );
  });

  it('keeps repeated feature headings fully visible without inventing a winner', () => {
    const duplicate = coverage.diagnostics.duplicateSourceText.find(
      (group) => group.normalizedText === 'ability score improvement',
    );
    expect(duplicate?.category).toBe('unresolved-owner');
    expect(duplicate?.occurrences).toHaveLength(12);
    expect(duplicate?.candidateKeys).toHaveLength(12);
    expect(
      coverage.diagnostics.recordNameCollisions.find(
        (group) => group.normalizedName === 'ability score improvement',
      ),
    ).toMatchObject({
      candidateKeys: duplicate?.candidateKeys,
      unresolved: true,
    });
  });

  it('retains child-of and contextual provenance for p78 captions and stat-block headings', () => {
    expect(entryFor(78, 'Strength').resolution).toEqual(
      expect.objectContaining({
        kind: 'curated-child-of',
        ownerKey: 'rule:skills',
      }),
    );
    expect(entryFor(261, 'Actions').resolution).toEqual(
      expect.objectContaining({
        kind: 'contextual-stat-block',
        ownerKey: 'creature:aboleth',
      }),
    );
    expect(entryFor(261, 'Legendary Actions').resolution).toEqual(
      expect.objectContaining({
        kind: 'contextual-stat-block',
        ownerKey: 'creature:aboleth',
      }),
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

describe('committed SRD source-coverage artifacts — intro-prose coverage guard (eshyra-g9im / eshyra-i2v4)', () => {
  // Chapter/appendix/subclass-category headings whose intro prose carries
  // gameplay rules or source context must resolve to their emitted rule record,
  // NOT be hidden behind `ignored:document-structure`. This locks in the fix and
  // fails loudly if a future regeneration drops one of these intro rules and the
  // heading silently falls back to the document-structure ignore default.
  const PROSE_BEARING_HEADINGS: ReadonlyArray<{
    readonly page: number;
    readonly text: string;
    readonly status: string;
  }> = [
    { page: 75, text: 'Feats', status: 'record:rule:feats' },
    {
      page: 76,
      text: 'Using Ability Scores',
      status: 'record:rule:using-ability-scores',
    },
    {
      page: 358,
      text: 'Appendix PH-A: Conditions',
      status: 'record:rule:conditions',
    },
    {
      page: 395,
      text: 'Appendix MM-B: Nonplayer Characters',
      status: 'record:rule:appendix-mm-b-nonplayer-characters',
    },
    {
      page: 207,
      text: 'Magic Items A-Z',
      status: 'record:rule:magic-items-a-z',
    },
    {
      page: 196,
      text: 'Sample Traps',
      status: 'record:rule:sample-traps',
    },
    {
      page: 100,
      text: 'Spellcasting',
      status: 'record:rule:spellcasting-chapter',
    },
    {
      page: 25,
      text: 'Martial Archetypes',
      status: 'record:rule:martial-archetypes',
    },
    {
      page: 28,
      text: 'Monastic Traditions',
      status: 'record:rule:monastic-traditions',
    },
    { page: 32, text: 'Sacred Oaths', status: 'record:rule:sacred-oaths' },
    {
      page: 37,
      text: 'Ranger Archetypes',
      status: 'record:rule:ranger-archetypes',
    },
    {
      page: 40,
      text: 'Roguish Archetypes',
      status: 'record:rule:roguish-archetypes',
    },
    {
      page: 44,
      text: 'Sorcerous Origins',
      status: 'record:rule:sorcerous-origins',
    },
    {
      page: 50,
      text: 'Otherworldly Patrons',
      status: 'record:rule:otherworldly-patrons',
    },
    {
      page: 54,
      text: 'Arcane Traditions',
      status: 'record:rule:arcane-traditions',
    },
  ];

  it('every prose-bearing chapter/appendix/subclass heading resolves to its rule record', () => {
    for (const { page, text, status } of PROSE_BEARING_HEADINGS) {
      const entry = entryFor(page, text);
      expect(entry.status, `${text} (p${page})`).toBe(status);
    }
  });

  it('none of the prose-bearing headings remain ignored as document-structure', () => {
    for (const { page, text } of PROSE_BEARING_HEADINGS) {
      const entry = entryFor(page, text);
      expect(entry.status, `${text} (p${page})`).not.toBe(
        'ignored:document-structure',
      );
    }
  });

  it('none of the prose-bearing headings remain ignored as record-group headings', () => {
    for (const { page, text } of PROSE_BEARING_HEADINGS) {
      const entry = entryFor(page, text);
      expect(entry.status, `${text} (p${page})`).not.toBe(
        'ignored:record-group-heading',
      );
    }
  });
});
