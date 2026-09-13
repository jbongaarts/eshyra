/**
 * Evidence suite for the field-provenance fail-closed gate
 * (eshyra-o9bd.19.1.3.1).
 *
 * E1 proves the gate is fail-closed by BREAKING it two different ways —
 * removing a declaration real emitted records depend on, and emitting a
 * field no declaration covers at all — rather than only asserting that
 * today's pack happens to be covered. E2 proves the REAL regenerated pack
 * classifies every emitted leaf into exactly one class and reports the
 * per-kind, per-class counts. E3-E6 assert the DECIDED classification
 * against real committed records named in the owning bead's evidence list.
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPack } from '../../../scripts/importers/dnd5e-srd-5.1/emit.js';
import { DND5E_FIELD_PROVENANCE_DECLARATIONS } from '../../../scripts/importers/dnd5e-srd-5.1/fieldProvenanceDeclarations.js';
import type {
  SpellCasterClass,
  SpellExtraction,
} from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
import {
  assertFieldProvenanceCoverage,
  buildFieldProvenanceManifest,
  classifyFieldPointer,
  FieldProvenanceError,
  type FieldProvenanceManifest,
  getBundledDnd5eSrdPack,
  loadFieldProvenanceManifest,
  loadRulesPackFromDirectory,
  walkFieldPointers,
} from '../../../src/internal.js';
import type { RulesRecord } from '../../../src/rules/types.js';

const PACK_DIR = join(
  process.cwd(),
  'packages/core/data/rules-packs/rules__dnd5e-srd-5.1',
);

const MINIMAL_SPELL: SpellExtraction = {
  name: 'Acid Splash',
  level: 0,
  school: 'conjuration',
  ritual: false,
  castingTime: '1 action',
  range: '60 feet',
  components: ['V', 'S'],
  duration: 'Instantaneous',
  description: 'You hurl a bubble of acid.',
  sourcePage: 211,
};

function emptyClassIndex(): ReadonlyMap<string, ReadonlySet<SpellCasterClass>> {
  return new Map<string, Set<SpellCasterClass>>();
}

function fullManifest(): FieldProvenanceManifest {
  return buildFieldProvenanceManifest(DND5E_FIELD_PROVENANCE_DECLARATIONS);
}

/** Every leaf pointer under `record.data`, mapped to its declared class (or `undefined`). */
function classifyRecord(
  manifest: FieldProvenanceManifest,
  record: RulesRecord,
): ReadonlyMap<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  walkFieldPointers(record.data, (pointer) => {
    out.set(pointer, classifyFieldPointer(manifest, record.kind, pointer));
  });
  return out;
}

function requireRecord(
  records: readonly RulesRecord[],
  key: string,
): RulesRecord {
  const record = records.find((r) => r.key === key);
  if (record === undefined) {
    throw new Error(
      `expected the committed pack to carry ${key} — this evidence test depends on it staying present`,
    );
  }
  return record;
}

describe('field-provenance fail-closed gate (eshyra-o9bd.19.1.3.1, E1)', () => {
  it('throws when a declaration real emitted records depend on is removed', () => {
    const pack = buildPack({
      spells: [MINIMAL_SPELL],
      classIndex: emptyClassIndex(),
      conditions: [],
      sourceHash: 'test-hash-e1a',
    });

    // spell:/description is a real declared pointer every emitted spell
    // record carries — remove exactly that one entry from the production
    // declaration table (not a hand-picked fixture-only prefix), leaving
    // every other declaration intact.
    const withoutSpellDescription = DND5E_FIELD_PROVENANCE_DECLARATIONS.filter(
      (d) => !(d.kind === 'spell' && d.pointerPrefix === '/description'),
    );
    expect(withoutSpellDescription.length).toBe(
      DND5E_FIELD_PROVENANCE_DECLARATIONS.length - 1,
    );
    const brokenManifest = buildFieldProvenanceManifest(
      withoutSpellDescription,
    );

    expect(() =>
      assertFieldProvenanceCoverage(pack.records, brokenManifest),
    ).toThrow(FieldProvenanceError);
    expect(() =>
      assertFieldProvenanceCoverage(pack.records, brokenManifest),
    ).toThrow(/spell:acid-splash\/description/);
  });

  it('throws when a record emits a field no declaration covers at all', () => {
    const pack = buildPack({
      spells: [MINIMAL_SPELL],
      classIndex: emptyClassIndex(),
      conditions: [],
      sourceHash: 'test-hash-e1b',
    });

    // Simulate a future importer change that starts emitting a new field a
    // builder never declared provenance for — the exact scenario the gate
    // exists to catch (see the owning bead: "a future importer change that
    // adds a field must declare its provenance or the build stops").
    const withUndeclaredField: RulesRecord[] = pack.records.map((record) =>
      record.kind === 'spell'
        ? {
            ...record,
            data: {
              ...(record.data as Record<string, unknown>),
              zzzUndeclaredField: 'nothing declares this pointer',
            },
          }
        : record,
    );

    expect(() =>
      assertFieldProvenanceCoverage(withUndeclaredField, fullManifest()),
    ).toThrow(FieldProvenanceError);
    expect(() =>
      assertFieldProvenanceCoverage(withUndeclaredField, fullManifest()),
    ).toThrow(/zzzUndeclaredField/);
  });

  it('does NOT throw over the same records under the real, unmodified manifest', () => {
    // Control: the two cases above fail only because of the deliberate
    // breakage, not because the fixture itself is uncovered.
    const pack = buildPack({
      spells: [MINIMAL_SPELL],
      classIndex: emptyClassIndex(),
      conditions: [],
      sourceHash: 'test-hash-e1-control',
    });
    expect(() =>
      assertFieldProvenanceCoverage(pack.records, fullManifest()),
    ).not.toThrow();
  });
});

describe('field-provenance coverage over the real regenerated pack (E2)', () => {
  it('classifies every emitted leaf into exactly one class, with no gaps, and reports per-kind counts', () => {
    const pack = loadRulesPackFromDirectory(PACK_DIR);
    const manifest = loadFieldProvenanceManifest(PACK_DIR);

    // assertFieldProvenanceCoverage throws on any uncovered leaf — reaching
    // the summary at all is itself part of what this test proves.
    const summary = assertFieldProvenanceCoverage(pack.records, manifest);

    const rows: string[] = [];
    let totalLeaves = 0;
    for (const [kind, counts] of [...summary.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )) {
      const kindTotal =
        counts['source-prose'] +
        counts['source-derived'] +
        counts['compiler-projection'];
      totalLeaves += kindTotal;
      rows.push(
        `  ${kind}: source-prose=${counts['source-prose']} source-derived=${counts['source-derived']} compiler-projection=${counts['compiler-projection']} (total ${kindTotal})`,
      );
    }
    // Reported per E2's "counts per class per kind are reported" requirement.
    console.log(
      `field-provenance coverage over ${pack.records.length} records / ${totalLeaves} leaves:\n${rows.join('\n')}`,
    );

    expect(summary.size).toBeGreaterThan(0);
    expect(totalLeaves).toBeGreaterThan(0);
  });
});

describe('creature:adult-black-dragon classification (E3)', () => {
  const pack = loadRulesPackFromDirectory(PACK_DIR);
  const manifest = loadFieldProvenanceManifest(PACK_DIR);
  const dragon = requireRecord(pack.records, 'creature:adult-black-dragon');
  const data = dragon.data as {
    readonly armorClass: {
      readonly value: number;
      readonly source?: string;
      readonly sourceText: string;
    };
    readonly actions: ReadonlyArray<{
      readonly name: string;
      readonly text: string;
      readonly mechanics?: unknown;
    }>;
  };

  it('armorClass.sourceText is source-prose (real record has this leaf)', () => {
    expect(typeof data.armorClass.sourceText).toBe('string');
    expect(
      classifyFieldPointer(manifest, 'creature', '/armorClass/sourceText'),
    ).toBe('source-prose');
  });

  it('armorClass.value and armorClass.source are source-derived (real record has both leaves)', () => {
    expect(typeof data.armorClass.value).toBe('number');
    expect(typeof data.armorClass.source).toBe('string');
    expect(
      classifyFieldPointer(manifest, 'creature', '/armorClass/value'),
    ).toBe('source-derived');
    expect(
      classifyFieldPointer(manifest, 'creature', '/armorClass/source'),
    ).toBe('source-derived');
  });

  it('actions[5].text is source-prose and actions[5].mechanics is compiler-projection, on the real record', () => {
    // Real record shape check, not an assumption: index 5 ("Acid Breath") is
    // the one action in this record that carries both text and mechanics —
    // `mechanics` is itself a structured object here, not a leaf, so its
    // classification is a whole-subtree prefix match (classifyFieldPointer),
    // not a single walked leaf.
    expect(data.actions.length).toBeGreaterThan(5);
    expect(typeof data.actions[5].text).toBe('string');
    expect(data.actions[5].mechanics).toBeDefined();
    expect(classifyFieldPointer(manifest, 'creature', '/actions/*/text')).toBe(
      'source-prose',
    );
    expect(
      classifyFieldPointer(manifest, 'creature', '/actions/*/mechanics'),
    ).toBe('compiler-projection');
  });
});

describe('the sibling class named by the PR #543 re-review (E4)', () => {
  const pack = loadRulesPackFromDirectory(PACK_DIR);
  const manifest = loadFieldProvenanceManifest(PACK_DIR);
  const dragon = requireRecord(pack.records, 'creature:adult-black-dragon');
  const data = dragon.data as {
    readonly hitPoints: { readonly value: number; readonly formula: string };
    readonly speed: Readonly<Record<string, number>>;
    readonly abilityScores: Readonly<Record<string, number>>;
  };

  it('hit points, speed, ability scores, and structured statline metadata are source-derived, not source-prose', () => {
    // Real record shape check first: these leaves actually appear on the
    // record this evidence is about.
    expect(typeof data.hitPoints.value).toBe('number');
    expect(typeof data.hitPoints.formula).toBe('string');
    expect(typeof data.speed.walk).toBe('number');
    expect(typeof data.abilityScores.strength).toBe('number');

    // `hitPoints`/`speed`/`abilityScores` are container objects, not leaves
    // themselves (fieldProvenance.ts: only leaves carry a class) — the
    // DECIDED representation still classifies the whole subtree via one
    // declaration on the container prefix, so assert that prefix directly.
    for (const pointer of [
      '/hitPoints',
      '/hitPoints/value',
      '/hitPoints/formula',
      '/speed',
      '/speed/walk',
      '/abilityScores',
      '/abilityScores/strength',
    ]) {
      expect(classifyFieldPointer(manifest, 'creature', pointer)).toBe(
        'source-derived',
      );
    }
  });
});

describe('spell:fireball classification (E5)', () => {
  const pack = loadRulesPackFromDirectory(PACK_DIR);
  const manifest = loadFieldProvenanceManifest(PACK_DIR);
  const fireball = requireRecord(pack.records, 'spell:fireball');
  const classified = classifyRecord(manifest, fireball);

  it('description and higherLevels are source-prose', () => {
    expect(classified.get('/description')).toBe('source-prose');
    expect(classified.get('/higherLevels')).toBe('source-prose');
  });

  it('everything under mechanics and upcast is compiler-projection', () => {
    const mechanicsAndUpcastPointers = [...classified.keys()].filter(
      (pointer) =>
        pointer.startsWith('/mechanics/') ||
        pointer === '/mechanics' ||
        pointer.startsWith('/upcast/') ||
        pointer === '/upcast',
    );
    // Real record shape check: fireball actually has both subtrees, with
    // more than a trivial number of leaves between them.
    expect(mechanicsAndUpcastPointers.length).toBeGreaterThan(3);
    for (const pointer of mechanicsAndUpcastPointers) {
      expect(classified.get(pointer)).toBe('compiler-projection');
    }
  });
});

describe('magic-item:ioun-stone classification — nested array prose (E6)', () => {
  const pack = loadRulesPackFromDirectory(PACK_DIR);
  const manifest = loadFieldProvenanceManifest(PACK_DIR);
  const iounStone = requireRecord(pack.records, 'magic-item:ioun-stone');
  const data = iounStone.data as {
    readonly variants: ReadonlyArray<{
      readonly text: string;
      readonly mechanics?: unknown;
    }>;
  };

  it('variants[i].text is source-prose while variants[i].mechanics is compiler-projection', () => {
    // Real record shape check: this record's nested array actually has more
    // than one variant, and at least one carries mechanics — proving the
    // declaration model's nesting handling (E6's point) is exercised for
    // real, not just declared in the abstract.
    expect(data.variants.length).toBeGreaterThan(1);
    expect(data.variants.some((v) => v.mechanics !== undefined)).toBe(true);
    expect(
      classifyFieldPointer(manifest, 'magic-item', '/variants/*/text'),
    ).toBe('source-prose');
    expect(
      classifyFieldPointer(manifest, 'magic-item', '/variants/*/mechanics'),
    ).toBe('compiler-projection');
  });
});

/**
 * Finding 2 (PR #543 re-review round 4): the class declared at a pointer must
 * be valid for every value the SCHEMA permits there, not merely for the values
 * today's corpus happens to hold.
 *
 * `kindSchemas.ts` `optCreationChoices` — the one validator governing BOTH
 * ancestry and background creation choices — documents `sourceText` as "a
 * source-cited display label, not guaranteed verbatim SRD prose", constructed
 * as "<table name> (<die>)." for the rolled-table categories. The declaration
 * is per `(kind, pointer prefix)`, so a future ancestry choice may put a
 * constructed label at this already-covered pointer and still pass coverage.
 * `source-prose` was therefore unsound at that pointer regardless of what the
 * thirteen current ancestry records contain — and the declaration's own reason
 * string already said so while the call said otherwise.
 */
describe('creation-choice sourceText is classified by what the schema permits', () => {
  const manifest = buildFieldProvenanceManifest(
    DND5E_FIELD_PROVENANCE_DECLARATIONS,
  );

  it('never classifies a creation-choice label as verbatim source prose', () => {
    for (const kind of ['ancestry', 'background'] as const)
      expect(
        classifyFieldPointer(manifest, kind, '/choices/*/sourceText'),
      ).toBe('source-derived');
  });

  it('holds for a constructed label that is not literal SRD prose', () => {
    // The schema-permitted shape the review named, at the SAME already-covered
    // pointer. Classification is a property of the pointer, so a value the
    // importer composed cannot acquire verbatim authority by appearing here.
    const constructed = 'Acolyte Bonds (d6).';
    expect(constructed).not.toMatch(/^[A-Z][a-z]+ [a-z]/u);
    const cls = classifyFieldPointer(
      manifest,
      'ancestry',
      '/choices/*/sourceText',
    );
    expect(cls).toBe('source-derived');
    expect(cls).not.toBe('source-prose');
  });

  it('keeps genuinely verbatim ancestry choice text present, as source-derived', () => {
    // The truthful-either-way property that makes `source-derived` the right
    // conservative class: a value that IS verbatim is still deterministically
    // derived from the cited source, so nothing is lost or hidden — only the
    // unearned claim of verbatim authority is withheld.
    const pack = getBundledDnd5eSrdPack();
    const withChoices = pack.records.filter(
      (record) =>
        record.kind === 'ancestry' &&
        Array.isArray((record.data as { choices?: unknown }).choices),
    );
    expect(withChoices.length).toBeGreaterThan(0);
    for (const record of withChoices)
      for (const choice of (
        record.data as { choices: { sourceText?: unknown }[] }
      ).choices)
        expect(typeof choice.sourceText).toBe('string');
  });
});
