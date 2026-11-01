/**
 * Record-scoped field-provenance declarations (`field-provenance-v2`,
 * eshyra-o9bd.16.7.2). Synthetic manifests only: the bundled pack's own
 * witnesses live in `test/importers/dnd5e-srd-5.1/composedDisplayProvenance.test.ts`.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertFieldProvenanceScopesLive,
  buildFieldProvenanceManifest,
  classifyFieldPointer,
  FIELD_PROVENANCE_SCHEMA,
  type FieldProvenanceDeclaration,
  FieldProvenanceError,
  loadFieldProvenanceManifest,
} from '../../src/internal.js';
import type { RulesRecord } from '../../src/rules/types.js';

const decl = (
  pointerPrefix: string,
  cls: FieldProvenanceDeclaration['class'],
  recordKeys?: string[],
): FieldProvenanceDeclaration => ({
  kind: 'feature',
  pointerPrefix,
  class: cls,
  reason: 'test',
  ...(recordKeys === undefined ? {} : { recordKeys }),
});

const record = (key: string, data: unknown): RulesRecord =>
  ({ kind: 'feature', key, name: key, data }) as unknown as RulesRecord;

describe('record-scoped precedence', () => {
  it('a scoped declaration beats an unscoped one at any prefix depth, for the named record only', () => {
    const m = buildFieldProvenanceManifest([
      decl('/choices/*/options/*/text', 'source-prose'),
      decl('/choices', 'source-derived', ['feature:composed']),
    ]);
    // Scoped `/choices` beats unscoped `/choices/*/options/*/text`, which is
    // deeper, because the scoped tier outranks depth.
    expect(
      classifyFieldPointer(
        m,
        'feature',
        'feature:composed',
        '/choices/*/options/*/text',
      ),
    ).toBe('source-derived');
    // Any other record under the same pointer keeps the unscoped class.
    expect(
      classifyFieldPointer(
        m,
        'feature',
        'feature:verbatim',
        '/choices/*/options/*/text',
      ),
    ).toBe('source-prose');
  });

  it('within the scoped tier the longest prefix wins', () => {
    const m = buildFieldProvenanceManifest([
      decl('/choices', 'source-derived', ['feature:x']),
      decl('/choices/*/options/*/mechanics', 'compiler-projection', [
        'feature:x',
      ]),
    ]);
    expect(
      classifyFieldPointer(
        m,
        'feature',
        'feature:x',
        '/choices/*/options/*/mechanics/damage',
      ),
    ).toBe('compiler-projection');
    expect(
      classifyFieldPointer(m, 'feature', 'feature:x', '/choices/*/prompt'),
    ).toBe('source-derived');
  });

  it('returns undefined for a record no scoped declaration names and no unscoped one covers', () => {
    const m = buildFieldProvenanceManifest([
      decl('/choices', 'source-derived', ['feature:x']),
    ]);
    expect(
      classifyFieldPointer(m, 'feature', 'feature:y', '/choices/*'),
    ).toBeUndefined();
  });

  it('does not match a scoped prefix on a partial segment', () => {
    const m = buildFieldProvenanceManifest([
      decl('/rows', 'source-derived', ['feature:x']),
      decl('/rows', 'source-prose'),
    ]);
    expect(
      classifyFieldPointer(m, 'feature', 'feature:x', '/rowsExtra'),
    ).toBeUndefined();
  });
});

describe('record-scoped manifest validation', () => {
  it('uses the v2 schema tag', () => {
    expect(FIELD_PROVENANCE_SCHEMA).toBe('field-provenance-v2');
  });

  it('allows an unscoped and a scoped declaration on the same (kind, prefix)', () => {
    expect(() =>
      buildFieldProvenanceManifest([
        decl('/rows', 'source-prose'),
        decl('/rows', 'source-derived', ['feature:x']),
      ]),
    ).not.toThrow();
  });

  it('allows scoped declarations on the same (kind, prefix) over disjoint records', () => {
    expect(() =>
      buildFieldProvenanceManifest([
        decl('/rows', 'source-derived', ['feature:x']),
        decl('/rows', 'source-derived', ['feature:y']),
      ]),
    ).not.toThrow();
  });

  it('rejects scoped declarations on the same (kind, prefix) that overlap on a record', () => {
    expect(() =>
      buildFieldProvenanceManifest([
        decl('/rows', 'source-derived', ['feature:x', 'feature:y']),
        decl('/rows', 'compiler-projection', ['feature:y']),
      ]),
    ).toThrow(/overlap on record "feature:y"/);
  });

  it('rejects an identical scoped declaration', () => {
    expect(() =>
      buildFieldProvenanceManifest([
        decl('/rows', 'source-derived', ['feature:x']),
        decl('/rows', 'source-derived', ['feature:x']),
      ]),
    ).toThrow(FieldProvenanceError);
  });

  it('rejects an empty recordKeys array', () => {
    expect(() =>
      buildFieldProvenanceManifest([decl('/rows', 'source-derived', [])]),
    ).toThrow(/non-empty array/);
  });

  it('rejects an empty or whitespace-only record key', () => {
    expect(() =>
      buildFieldProvenanceManifest([decl('/rows', 'source-derived', [' '])]),
    ).toThrow(/non-empty strings/);
  });

  it('rejects a repeated record key inside one list', () => {
    expect(() =>
      buildFieldProvenanceManifest([
        decl('/rows', 'source-derived', ['feature:x', 'feature:x']),
      ]),
    ).toThrow(/more than once/);
  });
});

describe('packLoader validates the v2 record-scoped shape', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0))
      rmSync(root, { recursive: true, force: true });
  });

  const writeManifest = (
    declarations: unknown[],
    schema: unknown = FIELD_PROVENANCE_SCHEMA,
  ) => {
    const root = mkdtempSync(join(tmpdir(), 'eshyra-fp-v2-'));
    roots.push(root);
    writeFileSync(
      join(root, 'field-provenance.json'),
      JSON.stringify({ schema, declarations }),
    );
    return root;
  };

  it('loads a scoped declaration', () => {
    const root = writeManifest([
      {
        kind: 'feature',
        pointerPrefix: '/rows',
        class: 'source-derived',
        reason: 'test',
        recordKeys: ['feature:x'],
      },
    ]);
    const m = loadFieldProvenanceManifest(root);
    expect(classifyFieldPointer(m, 'feature', 'feature:x', '/rows')).toBe(
      'source-derived',
    );
  });

  it('rejects a malformed recordKeys value', () => {
    const root = writeManifest([
      {
        kind: 'feature',
        pointerPrefix: '/rows',
        class: 'source-derived',
        reason: 'test',
        recordKeys: 'feature:x',
      },
    ]);
    expect(() => loadFieldProvenanceManifest(root)).toThrow(
      /recordKeys must be a non-empty array/,
    );
  });

  it('rejects a v1 manifest, which would drop record scope', () => {
    const root = writeManifest([], 'field-provenance-v1');
    expect(() => loadFieldProvenanceManifest(root)).toThrow(
      /expected "field-provenance-v2"/,
    );
  });
});

describe('dead-scope gate', () => {
  const featureRecord = (key: string, data: unknown): RulesRecord =>
    record(key, data);

  it('passes when every scoped record is emitted and carries the prefix', () => {
    const m = buildFieldProvenanceManifest([
      decl('/choices', 'source-derived', ['feature:x']),
    ]);
    expect(() =>
      assertFieldProvenanceScopesLive(
        [featureRecord('feature:x', { choices: [{ id: 'a' }] })],
        m,
      ),
    ).not.toThrow();
  });

  it('throws when a scoped record key is not emitted', () => {
    const m = buildFieldProvenanceManifest([
      decl('/choices', 'source-derived', ['feature:gone']),
    ]);
    expect(() =>
      assertFieldProvenanceScopesLive([featureRecord('feature:x', {})], m),
    ).toThrow(/not an emitted feature record/);
  });

  it('throws when the scoped prefix matches no leaf in its record', () => {
    const m = buildFieldProvenanceManifest([
      decl('/choices', 'source-derived', ['feature:x']),
    ]);
    expect(() =>
      assertFieldProvenanceScopesLive(
        [featureRecord('feature:x', { description: 'd' })],
        m,
      ),
    ).toThrow(/matches no leaf/);
  });
});
