/**
 * Compiler-COMPOSED display strings must not be classified as verbatim source
 * prose (independent-audit blocker L1-F2, eshyra-o9bd.16.1 / eshyra-o9bd.16.7.2).
 *
 * The importer builds several option, variant and table display strings from
 * printed headers and cells (deriveFeatureChoices.ts, parseMagicItems.ts,
 * parseTables.ts, classProgression.ts). Their pointers are shared with genuinely
 * verbatim text in sibling records, so the classification is record-scoped
 * (`recordKeys`, field-provenance-v2). This test pins:
 *  - the concrete SRD witnesses (pp. 22, 44, 74, 84, 210-211, 220, 226, and the
 *    class-feature splice) classify as source-derived;
 *  - positive controls: verbatim passages under the SAME pointer in sibling
 *    records stay source-prose;
 *  - scope does not leak to records that were not named;
 *  - the dead-scope gate passes on the committed pack.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertFieldProvenanceScopesLive,
  classifyFieldPointer,
  type FieldProvenanceManifest,
  loadFieldProvenanceManifest,
  loadRulesPackFromDirectory,
  walkFieldPointers,
} from '../../../src/internal.js';
import type { RulesRecord } from '../../../src/rules/types.js';

const PACK_DIR = join(
  process.cwd(),
  'packages/core/data/rules-packs/rules__dnd5e-srd-5.1',
);

const pack = loadRulesPackFromDirectory(PACK_DIR);
const manifest: FieldProvenanceManifest = loadFieldProvenanceManifest(PACK_DIR);

function recordOf(key: string): RulesRecord {
  const found = pack.records.find((r) => r.key === key);
  if (found === undefined) throw new Error(`pack has no record ${key}`);
  return found;
}

/** Classification of a pointer as it applies to one real record. */
function classOf(key: string, pointer: string) {
  return classifyFieldPointer(manifest, recordOf(key).kind, key, pointer);
}

interface Witness {
  readonly key: string;
  readonly pointer: string;
  readonly page: string;
}

/** Composed displays: each must be source-derived, and each names its own record. */
const COMPOSED_WITNESSES: readonly Witness[] = [
  {
    key: 'feature:draconic-bloodline:dragon-ancestor',
    pointer: '/choices/*/options/*/text',
    page: 'SRD p. 44',
  },
  {
    key: 'feature:circle-of-the-land:circle-spells',
    pointer: '/choices/*/options/*/text',
    page: 'SRD p. 22',
  },
  {
    key: 'magic-item:elemental-gem',
    pointer: '/variants/*/text',
    page: 'SRD p. 220',
  },
  {
    key: 'magic-item:horn-of-valhalla',
    pointer: '/variants/*/text',
    page: 'SRD p. 226',
  },
  {
    key: 'magic-item:bag-of-tricks',
    pointer: '/variants/*/text',
    page: 'SRD pp. 210-211',
  },
  { key: 'table:travel-pace', pointer: '/columns', page: 'SRD p. 84' },
  { key: 'table:food-drink-and-lodging', pointer: '/rows', page: 'SRD p. 74' },
  { key: 'table:services', pointer: '/rows', page: 'SRD p. 74' },
  {
    key: 'feature:cleric:destroy-undead',
    pointer: '/description',
    page: 'table-splice witness',
  },
  {
    key: 'feature:druid:wild-shape',
    pointer: '/description',
    page: 'table-splice witness',
  },
];

/**
 * Positive controls: a genuinely verbatim passage under the SAME pointer in a
 * sibling record. Without these, a blanket demotion of the pointer would pass.
 */
const VERBATIM_CONTROLS: readonly Witness[] = [
  {
    key: 'feature:fighter:fighting-style',
    pointer: '/choices/*/options/*/text',
    page: 'control',
  },
  {
    key: 'feature:sorcerer:metamagic',
    pointer: '/choices/*/options/*/text',
    page: 'control',
  },
  {
    key: 'magic-item:crystal-ball',
    pointer: '/variants/*/text',
    page: 'control',
  },
  {
    key: 'magic-item:ioun-stone',
    pointer: '/variants/*/text',
    page: 'control',
  },
];

describe('L1-F2 composed displays are source-derived, not verbatim prose', () => {
  for (const w of COMPOSED_WITNESSES) {
    it(`${w.key} ${w.pointer} (${w.page}) is source-derived`, () => {
      expect(classOf(w.key, w.pointer)).toBe('source-derived');
    });
  }

  it('the table:travel-pace composed columns really are the expanded labels', () => {
    const columns = (
      recordOf('table:travel-pace').data as { columns: string[] }
    ).columns;
    expect(columns).toContain('Distance per Minute');
  });
});

describe('positive controls: verbatim text under the same pointer stays source-prose', () => {
  for (const w of VERBATIM_CONTROLS) {
    it(`${w.key} ${w.pointer} (${w.page}) is source-prose`, () => {
      expect(classOf(w.key, w.pointer)).toBe('source-prose');
    });
  }

  it('every other table keeps verbatim source-prose columns and rows', () => {
    const scopedTables = new Set([
      'table:travel-pace',
      'table:food-drink-and-lodging',
      'table:services',
    ]);
    const others = pack.records.filter(
      (r) => r.kind === 'table' && !scopedTables.has(r.key),
    );
    expect(others.length).toBeGreaterThan(100);
    for (const t of others) {
      expect(classifyFieldPointer(manifest, 'table', t.key, '/columns')).toBe(
        'source-prose',
      );
      expect(classifyFieldPointer(manifest, 'table', t.key, '/rows')).toBe(
        'source-prose',
      );
    }
  });
});

describe('scope does not leak to unnamed records', () => {
  it('no non-witness feature option or magic-item variant is source-derived under a composed pointer', () => {
    const composedKeys = new Set(COMPOSED_WITNESSES.map((w) => w.key));
    const leaks: string[] = [];
    for (const record of pack.records) {
      if (record.kind !== 'feature' && record.kind !== 'magic-item') continue;
      if (composedKeys.has(record.key)) continue;
      walkFieldPointers(record.data, (pointer) => {
        if (
          pointer.startsWith('/choices/*/options/*/text') ||
          pointer.startsWith('/variants/*/text')
        ) {
          const cls = classifyFieldPointer(
            manifest,
            record.kind,
            record.key,
            pointer,
          );
          if (cls !== 'source-prose')
            leaks.push(`${record.key}${pointer} -> ${cls}`);
        }
      });
    }
    expect(leaks).toEqual([]);
  });
});

describe('dead-scope gate on the committed pack', () => {
  it('every record-scoped declaration names a live record that carries its prefix', () => {
    expect(() =>
      assertFieldProvenanceScopesLive(pack.records, manifest),
    ).not.toThrow();
  });
});
