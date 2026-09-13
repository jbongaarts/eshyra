import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadRecordRelationshipManifest,
  loadRulesPackFromDirectory,
  RECORD_RELATIONSHIP_SCHEMA,
  RulesPackError,
} from '../src/internal.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Path to the committed canonical D&D SRD 5.1 pack shipped with the core
 * package. The directory name uses `__` in place of `:` (Windows-safe); the
 * packId inside manifest.json still carries the canonical colon form.
 */
const COMMITTED_PACK_DIR = join(
  __dirname,
  '../data/rules-packs/rules__dnd5e-srd-5.1',
);

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pack-loader-test-'));
  tmpDirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// Minimal valid pack fixture shared by negative-path tests.
// ---------------------------------------------------------------------------

const VALID_MANIFEST = JSON.stringify({
  packId: 'rules:test-minimal',
  title: 'Minimal test pack',
  description: 'A minimal pack used by loader unit tests.',
  role: 'base',
  systemId: 'test-system',
  version: '1.0',
  license: {
    licenseClass: 'original',
    licenseName: 'Original content',
    attributionText: 'Test fixture — no external attribution required.',
    requiresAttribution: false,
    commercialUseAllowed: true,
    hostedUseAllowed: true,
    redistributionAllowed: true,
    publicSharingAllowed: true,
    derivativeAllowed: true,
    containsUserSuppliedText: false,
    containsTrademarkedSettingMaterial: false,
    sourceMaterialDescription: 'Loader unit-test fixture.',
    provenancePolicy: 'Each record cites the fixture identity.',
    outputRestrictions: 'None.',
  },
  source: {
    sourceTitle: 'Loader test fixture',
    sourceVersion: '1.0',
    sourceIdentity: 'test-system:loader-fixture',
    recordProvenancePolicy: 'Each record cites the fixture identity.',
  },
});

const VALID_RECORDS = JSON.stringify([
  {
    systemId: 'test-system',
    kind: 'rule',
    key: 'rule:alpha',
    name: 'Alpha Rule',
    data: { text: 'The alpha rule governs all other rules.' },
    source: 'Loader fixture § 1',
    license: {
      licenseClass: 'original',
      licenseName: 'Original content',
      attributionText: 'Test fixture — no external attribution required.',
      requiresAttribution: false,
      commercialUseAllowed: true,
      hostedUseAllowed: true,
      redistributionAllowed: true,
      publicSharingAllowed: true,
      derivativeAllowed: true,
      containsUserSuppliedText: false,
      containsTrademarkedSettingMaterial: false,
      sourceMaterialDescription: 'Loader unit-test fixture.',
      provenancePolicy: 'Each record cites the fixture identity.',
      outputRestrictions: 'None.',
    },
    provenance: {
      sourceRef: 'test-system:loader-fixture',
      locator: '§ 1',
    },
  },
]);

// ---------------------------------------------------------------------------
// Happy path: load the committed canonical pack.
//
// These tests exercise the loader against the real on-disk pack; they assert
// loader behavior (validates, sorts, preserves provenance/source), not the
// pack's exact per-kind coverage — that baseline lives in srdGeneratedPack.test.
// ---------------------------------------------------------------------------

describe('loadRulesPackFromDirectory — committed pack (rules:dnd5e-srd-5.1)', () => {
  it('loads the committed pack and returns the correct packId', () => {
    const pack = loadRulesPackFromDirectory(COMMITTED_PACK_DIR);
    expect(pack.meta.packId).toBe('rules:dnd5e-srd-5.1');
  });

  it('returns the full record set sorted by key', () => {
    const pack = loadRulesPackFromDirectory(COMMITTED_PACK_DIR);
    expect(pack.records.length).toBeGreaterThan(1);
    const keys = pack.records.map((r) => r.key);
    expect(keys).toEqual([...keys].sort());
  });

  it('contains known landmark records carrying SRD provenance', () => {
    const pack = loadRulesPackFromDirectory(COMMITTED_PACK_DIR);
    const goblin = pack.records.find((r) => r.key === 'creature:goblin');
    expect(goblin?.name).toBe('Goblin');
    expect(goblin?.provenance.sourceRef).toBe(
      'https://dnd.wizards.com/resources/systems-reference-document',
    );
    expect(pack.records.some((r) => r.key === 'spell:fire-bolt')).toBe(true);
  });

  it('meta.source fields are preserved', () => {
    const pack = loadRulesPackFromDirectory(COMMITTED_PACK_DIR);
    expect(pack.meta.source.sourceTitle).toBe('System Reference Document 5.1');
    expect(pack.meta.source.sourceUrl).toBe(
      'https://dnd.wizards.com/resources/systems-reference-document',
    );
  });
});

// ---------------------------------------------------------------------------
// Determinism: same directory → same output on two independent loads.
// ---------------------------------------------------------------------------

describe('loadRulesPackFromDirectory — determinism', () => {
  it('produces deeply equal packs on two independent loads of the committed pack', () => {
    const packA = loadRulesPackFromDirectory(COMMITTED_PACK_DIR);
    const packB = loadRulesPackFromDirectory(COMMITTED_PACK_DIR);
    expect(packA).toEqual(packB);
  });

  it('stable JSON serialization: two loads produce the same JSON string', () => {
    const jsonA = JSON.stringify(
      loadRulesPackFromDirectory(COMMITTED_PACK_DIR),
    );
    const jsonB = JSON.stringify(
      loadRulesPackFromDirectory(COMMITTED_PACK_DIR),
    );
    expect(jsonA).toBe(jsonB);
  });

  it('sorts records by key when records.json is in non-alphabetical order', () => {
    const dir = makeTmpDir();
    // Write records in reverse alphabetical key order.
    const reversedRecords = JSON.stringify(
      JSON.parse(VALID_RECORDS)
        .concat([
          {
            systemId: 'test-system',
            kind: 'rule',
            key: 'rule:zeta',
            name: 'Zeta Rule',
            data: { text: 'The last rule alphabetically.' },
            source: 'Loader fixture § 2',
            license: JSON.parse(VALID_RECORDS)[0].license,
            provenance: {
              sourceRef: 'test-system:loader-fixture',
              locator: '§ 2',
            },
          },
        ])
        .reverse(),
    );
    writeFileSync(join(dir, 'manifest.json'), VALID_MANIFEST, 'utf8');
    writeFileSync(join(dir, 'records.json'), reversedRecords, 'utf8');
    const pack = loadRulesPackFromDirectory(dir);
    const keys = pack.records.map((r) => r.key);
    expect(keys).toEqual([...keys].sort());
  });
});

// ---------------------------------------------------------------------------
// Negative path: validation errors.
// ---------------------------------------------------------------------------

describe('loadRulesPackFromDirectory — negative paths', () => {
  it('throws RulesPackError when manifest.json is missing', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'records.json'), VALID_RECORDS, 'utf8');
    expect(() => loadRulesPackFromDirectory(dir)).toThrow(RulesPackError);
    expect(() => loadRulesPackFromDirectory(dir)).toThrow(/manifest not found/);
  });

  it('throws RulesPackError when records.json is missing', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'manifest.json'), VALID_MANIFEST, 'utf8');
    expect(() => loadRulesPackFromDirectory(dir)).toThrow(RulesPackError);
    expect(() => loadRulesPackFromDirectory(dir)).toThrow(/records not found/);
  });

  it('throws RulesPackError when manifest.json is not valid JSON', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'manifest.json'), '{ not valid json }', 'utf8');
    writeFileSync(join(dir, 'records.json'), VALID_RECORDS, 'utf8');
    expect(() => loadRulesPackFromDirectory(dir)).toThrow(RulesPackError);
    expect(() => loadRulesPackFromDirectory(dir)).toThrow(/not valid JSON/);
  });

  it('throws RulesPackError when meta.source is missing (validateRulesPack catches it)', () => {
    const dir = makeTmpDir();
    const manifestWithoutSource = JSON.stringify({
      packId: 'rules:test-minimal',
      title: 'Broken pack',
      description: 'Missing source.',
      role: 'base',
      systemId: 'test-system',
      version: '1.0',
      license: JSON.parse(VALID_MANIFEST).license,
      // source intentionally omitted
    });
    writeFileSync(join(dir, 'manifest.json'), manifestWithoutSource, 'utf8');
    writeFileSync(join(dir, 'records.json'), VALID_RECORDS, 'utf8');
    expect(() => loadRulesPackFromDirectory(dir)).toThrow(RulesPackError);
    expect(() => loadRulesPackFromDirectory(dir)).toThrow(/meta\.source/);
  });

  it('throws RulesPackError when a record provenance.sourceRef does not match the pack source', () => {
    const dir = makeTmpDir();
    const mismatchedRecords = JSON.stringify([
      {
        ...JSON.parse(VALID_RECORDS)[0],
        provenance: {
          sourceRef: 'https://wrong-source.example/not-the-identity',
        },
      },
    ]);
    writeFileSync(join(dir, 'manifest.json'), VALID_MANIFEST, 'utf8');
    writeFileSync(join(dir, 'records.json'), mismatchedRecords, 'utf8');
    expect(() => loadRulesPackFromDirectory(dir)).toThrow(RulesPackError);
    expect(() => loadRulesPackFromDirectory(dir)).toThrow(
      /provenance\.sourceRef must match/,
    );
  });
});

// ---------------------------------------------------------------------------
// loadRecordRelationshipManifest — negative paths (eshyra-jgxl F2).
//
// buildRecordRelationshipManifest's own cross-field validation runs on
// whatever loadRecordRelationshipManifest hands it, so a malformed on-disk
// manifest must fail HERE, at the loader, before that validation ever sees
// it — a blind cast would let a wrong-typed field reach a check written
// assuming the interface's own types, either throwing an unrelated native
// error or (for `targetKind` specifically) degrading into a `Map` lookup
// miss indistinguishable from a legitimate "no record with this name" result.
// ---------------------------------------------------------------------------

describe('loadRecordRelationshipManifest — negative paths', () => {
  it('returns undefined when the pack ships no record-relationships.json', () => {
    const dir = makeTmpDir();
    expect(loadRecordRelationshipManifest(dir)).toBeUndefined();
  });

  it('fails closed on a malformed on-disk targetKind, never a silent lookup miss', () => {
    const dir = makeTmpDir();
    writeFileSync(
      join(dir, 'record-relationships.json'),
      JSON.stringify({
        schema: RECORD_RELATIONSHIP_SCHEMA,
        declarations: [
          {
            kind: 'action',
            pointerPrefix: '/mechanics/conditions/*/condition',
            linkField: 'data.mechanics.conditions',
            disposition: 'reference',
            relation: 'condition',
            targetResolution: 'record-name',
            targetKind: 'not-a-real-kind',
            relationField: 'relation',
            reason: 'malformed fixture',
          },
        ],
      }),
      'utf8',
    );
    expect(() => loadRecordRelationshipManifest(dir)).toThrow(RulesPackError);
    expect(() => loadRecordRelationshipManifest(dir)).toThrow(/targetKind/);
  });

  it('fails closed on a non-string pointerPrefix instead of an unrelated native error', () => {
    const dir = makeTmpDir();
    writeFileSync(
      join(dir, 'record-relationships.json'),
      JSON.stringify({
        schema: RECORD_RELATIONSHIP_SCHEMA,
        declarations: [
          {
            kind: 'ancestry',
            pointerPrefix: 42,
            linkField: 'data.source',
            disposition: 'not-a-reference',
            reason: 'malformed fixture',
          },
        ],
      }),
      'utf8',
    );
    expect(() => loadRecordRelationshipManifest(dir)).toThrow(RulesPackError);
    expect(() => loadRecordRelationshipManifest(dir)).toThrow(/pointerPrefix/);
  });

  it('fails closed when declarations is missing entirely', () => {
    const dir = makeTmpDir();
    writeFileSync(
      join(dir, 'record-relationships.json'),
      JSON.stringify({ schema: RECORD_RELATIONSHIP_SCHEMA }),
      'utf8',
    );
    expect(() => loadRecordRelationshipManifest(dir)).toThrow(RulesPackError);
    expect(() => loadRecordRelationshipManifest(dir)).toThrow(
      /declarations must be an array/,
    );
  });
});
