import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { extractPdfText } from '../../../scripts/importers/dnd5e-srd-5.1/extract.js';
import {
  applyFoundation1ProcedureProjections,
  FOUNDATION1_PROJECTION_RECORD_KEYS,
  Foundation1ProjectionError,
} from '../../../scripts/importers/dnd5e-srd-5.1/foundation1ProcedureProjections.js';
import {
  buildFoundation1SourceObligations,
  FOUNDATION1_SOURCE_HASH,
  Foundation1SourceObligationError,
} from '../../../scripts/importers/dnd5e-srd-5.1/foundation1SourceObligations.js';
import type { RulesRecord } from '../../../src/rules/types.js';
import {
  evaluateFoundation1Proof,
  type Foundation1Obligation,
} from '../../../src/rules/verticalProcedureProof.js';

const PDF_PATH = join(
  process.cwd(),
  'packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf',
);
const RECORDS_PATH = join(
  process.cwd(),
  'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json',
);

const records = JSON.parse(
  readFileSync(RECORDS_PATH, 'utf8'),
) as readonly RulesRecord[];

let obligations: readonly Foundation1Obligation[];

beforeAll(async () => {
  const pdf = readFileSync(PDF_PATH);
  const pages = await extractPdfText(new Uint8Array(pdf));
  const sourceHash = createHash('sha256').update(pdf).digest('hex');
  obligations = buildFoundation1SourceObligations(pages, sourceHash);
});

const EXPECTED_DISCHARGE_ATOM_IDS = [
  'atom/equipment:longsword/data/mechanics/procedures/0/modes/0/damage',
  'atom/equipment:longsword/data/mechanics/procedures/0/modes/1/damage',
  'atom/equipment:longsword/data/mechanics/procedures/0/selector',
  'atom/feature:fighter:fighting-style/data/choices/0/choose',
  'atom/feature:fighter:fighting-style/data/mechanics/procedures/0/duplicateSelection',
  'atom/feature:fighter:fighting-style/data/mechanics/procedures/0/options/0/effect',
  'atom/feature:fighter:fighting-style/data/mechanics/procedures/0/options/1/effect',
  'atom/feature:fighter:fighting-style/data/mechanics/procedures/0/options/2/effect',
  'atom/feature:fighter:fighting-style/data/mechanics/procedures/0/options/3/effect',
  'atom/feature:fighter:fighting-style/data/mechanics/procedures/0/options/4/effect',
  'atom/feature:fighter:fighting-style/data/mechanics/procedures/0/options/5/effect',
  'atom/feature:sorcerer:font-of-magic/data/mechanics/procedures/0/operations/convertSpellSlot/actionCost',
  'atom/feature:sorcerer:font-of-magic/data/mechanics/procedures/0/operations/convertSpellSlot/pointsGained',
  'atom/feature:sorcerer:font-of-magic/data/mechanics/procedures/0/operations/createSpellSlot/actionCost',
  'atom/feature:sorcerer:font-of-magic/data/mechanics/procedures/0/operations/createSpellSlot/costBySlotLevel',
  'atom/feature:sorcerer:font-of-magic/data/mechanics/procedures/0/operations/createSpellSlot/createdSlotExpires',
  'atom/feature:sorcerer:font-of-magic/data/mechanics/procedures/0/operations/createSpellSlot/maximumSlotLevel',
  'atom/feature:sorcerer:font-of-magic/data/mechanics/procedures/0/pool',
  'atom/feature:sorcerer:font-of-magic/data/mechanics/procedures/0/pool/maximumByLevel',
  'atom/feature:sorcerer:font-of-magic/data/mechanics/procedures/0/pool/reset',
  'atom/hazard:burnt-othur-fumes/data/mechanics/procedures/0/initial/failureDamage',
  'atom/hazard:burnt-othur-fumes/data/mechanics/procedures/0/initial/save',
  'atom/hazard:burnt-othur-fumes/data/mechanics/procedures/0/repeat/failureDamage',
  'atom/hazard:burnt-othur-fumes/data/mechanics/procedures/0/repeat/save',
  'atom/hazard:burnt-othur-fumes/data/mechanics/procedures/0/repeat/timing',
  'atom/hazard:burnt-othur-fumes/data/mechanics/procedures/0/termination',
  'atom/spell:wish/data/mechanics/procedures/0/adjudicationBoundary',
  'atom/spell:wish/data/mechanics/procedures/0/stress/recovery',
  'atom/spell:wish/data/mechanics/procedures/0/stress/recurringDamage',
  'atom/spell:wish/data/mechanics/procedures/0/stress/strength',
  'atom/spell:wish/data/mechanics/procedures/0/stress/trigger',
  'atom/spell:wish/data/mechanics/procedures/0/stress/wishLoss',
] as const;

function cloneRecords(): RulesRecord[] {
  return structuredClone(records) as RulesRecord[];
}

function stripProcedures(input: readonly RulesRecord[]): RulesRecord[] {
  return structuredClone(input).map((record) => {
    const data = record.data as Record<string, unknown>;
    const mechanics = data.mechanics as Record<string, unknown> | undefined;
    if (mechanics !== undefined) {
      Reflect.deleteProperty(mechanics, 'procedures');
    }
    return record;
  }) as RulesRecord[];
}

function record(input: RulesRecord[], key: string): RulesRecord {
  const found = input.find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`missing test record ${key}`);
  return found;
}

function procedure(input: RulesRecord[], key: string): Record<string, unknown> {
  const data = record(input, key).data as Record<string, unknown>;
  const mechanics = data.mechanics as Record<string, unknown>;
  return (mechanics.procedures as Record<string, unknown>[])[0];
}

describe('Foundation 1 source authority', () => {
  it('produces 32 unique obligations for exactly five bounded procedures', () => {
    expect(obligations).toHaveLength(32);
    expect(new Set(obligations.map((obligation) => obligation.id)).size).toBe(
      32,
    );
    expect(
      [
        ...new Set(obligations.map((obligation) => obligation.procedureId)),
      ].sort(),
    ).toEqual([
      'burnt-othur-fumes',
      'fighter-fighting-style',
      'font-of-magic',
      'longsword-damage',
      'wish-nonstandard-effect',
    ]);
    expect(
      obligations.every((obligation) =>
        /^obl\/f1\/[a-f0-9]{64}$/.test(obligation.id),
      ),
    ).toBe(true);
  });

  it('binds every obligation to exact offsets and hashes in the pinned PDF extraction', () => {
    for (const obligation of obligations) {
      expect(obligation.derivedFrom.length).toBeGreaterThan(0);
      for (const span of obligation.derivedFrom) {
        expect(span.sourceHash).toBe(FOUNDATION1_SOURCE_HASH);
        expect(span.sourceRef).toBe(
          'https://dnd.wizards.com/resources/systems-reference-document',
        );
        expect(span.startOffset).toBeGreaterThanOrEqual(0);
        expect(span.endOffset).toBeGreaterThan(span.startOffset);
        expect(span.spanHash).toMatch(/^[a-f0-9]{64}$/);
      }
    }
  });

  it('fails closed when the source digest drifts', () => {
    expect(() =>
      buildFoundation1SourceObligations([], 'not-the-pinned-source'),
    ).toThrow(Foundation1SourceObligationError);
  });
});

describe('Foundation 1 independent discharge', () => {
  it('discharges every obligation to a unique exact atom in the real generated pack', () => {
    const report = evaluateFoundation1Proof(records, obligations);
    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.discharges).toHaveLength(obligations.length);
    expect(new Set(report.discharges.map((entry) => entry.atomId)).size).toBe(
      obligations.length,
    );
    expect(report.discharges.map((entry) => entry.atomId).sort()).toEqual(
      [...EXPECTED_DISCHARGE_ATOM_IDS].sort(),
    );
    for (const discharge of report.discharges) {
      expect(discharge.atomId).toBe(
        `atom/${discharge.recordKey}${discharge.pointer}`,
      );
      const obligation = obligations.find(
        (candidate) => candidate.id === discharge.obligationId,
      );
      expect(obligation).toBeDefined();
      expect(
        discharge.pointer === obligation?.localityPointer ||
          discharge.pointer.startsWith(`${obligation?.localityPointer}/`),
      ).toBe(true);
    }
  });

  it('reproduces the pre-projection failure boundary instead of treating no procedures as green', () => {
    const report = evaluateFoundation1Proof(
      stripProcedures(records),
      obligations,
    );
    expect(report.ok).toBe(false);
    expect(report.discharges).toHaveLength(1);
    expect(report.failures).toHaveLength(31);
    expect(new Set(report.failures.map((failure) => failure.code))).toEqual(
      new Set(['MISSING_FACET']),
    );
    const discharged = obligations.find(
      (obligation) => obligation.id === report.discharges[0]?.obligationId,
    );
    expect(discharged?.facet).toBe('choice-cardinality');
    expect(report.discharges[0]?.pointer).toBe('/data/choices/0/choose');
  });

  it.each([
    ['hazard:burnt-othur-fumes', 'repeat'],
    ['equipment:longsword', 'selector'],
    ['feature:fighter:fighting-style', 'duplicateSelection'],
    ['feature:sorcerer:font-of-magic', 'pool'],
    ['spell:wish', 'adjudicationBoundary'],
  ] as const)('fails closed when %s loses required facet %s', (key, field) => {
    const changed = cloneRecords();
    Reflect.deleteProperty(procedure(changed, key), field);
    const report = evaluateFoundation1Proof(changed, obligations);
    expect(report.ok).toBe(false);
    expect(report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MALFORMED_PROJECTION' }),
      ]),
    );
  });

  it('enforces injective multiplicity when two obligations target one save atom', () => {
    const initial = obligations.find(
      (obligation) =>
        obligation.procedureId === 'burnt-othur-fumes' &&
        obligation.ordinal === 1,
    );
    const repeatedIndex = obligations.findIndex(
      (obligation) =>
        obligation.procedureId === 'burnt-othur-fumes' &&
        obligation.ordinal === 4,
    );
    if (initial === undefined || repeatedIndex < 0) {
      throw new Error('missing Burnt Othur save obligations');
    }
    const collapsed = structuredClone(obligations) as Foundation1Obligation[];
    collapsed[repeatedIndex] = {
      ...collapsed[repeatedIndex],
      localityPointer: initial.localityPointer,
    };
    const report = evaluateFoundation1Proof(records, collapsed);
    expect(report.ok).toBe(false);
    expect(report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MULTIPLICITY_CONFLICT' }),
      ]),
    );
  });

  it('preserves option locality when an effect is moved to a sibling option', () => {
    const changed = cloneRecords();
    const options = procedure(changed, 'feature:fighter:fighting-style')
      .options as Record<string, unknown>[];
    [options[0].effect, options[1].effect] = [
      options[1].effect,
      options[0].effect,
    ];
    const report = evaluateFoundation1Proof(changed, obligations);
    expect(report.ok).toBe(false);
    expect(
      report.failures.filter((failure) => failure.code === 'MISSING_FACET'),
    ).toHaveLength(2);
  });

  it('requires unique source-owner resolution without embedding a record key in identity', () => {
    const changed = cloneRecords();
    const duplicate = structuredClone(
      record(changed, 'feature:fighter:fighting-style'),
    );
    duplicate.key = 'feature:synthetic:fighting-style';
    changed.push(duplicate);
    const report = evaluateFoundation1Proof(changed, obligations);
    expect(report.ok).toBe(false);
    expect(report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'OWNER_NOT_UNIQUE' }),
      ]),
    );
  });
});

describe('Foundation 1 projector boundary', () => {
  it('changes exactly the five reviewed record identities', () => {
    const before = stripProcedures(records);
    const after = applyFoundation1ProcedureProjections(before);
    const beforeByKey = new Map(
      before.map((entry) => [entry.key, JSON.stringify(entry)]),
    );
    expect(
      after
        .filter((entry) => beforeByKey.get(entry.key) !== JSON.stringify(entry))
        .map((entry) => entry.key)
        .sort(),
    ).toEqual([...FOUNDATION1_PROJECTION_RECORD_KEYS].sort());
  });

  it('fails loudly when reviewed source prose drifts', () => {
    const changed = stripProcedures(records);
    const wish = record(changed, 'spell:wish');
    const data = wish.data as Record<string, unknown>;
    data.description = (data.description as string).replace(
      '33 percent chance',
      'different chance',
    );
    expect(() => applyFoundation1ProcedureProjections(changed)).toThrow(
      Foundation1ProjectionError,
    );
  });

  it('has no import path from the projector to the obligation authority', () => {
    const projectorSource = readFileSync(
      join(
        process.cwd(),
        'packages/core/scripts/importers/dnd5e-srd-5.1/foundation1ProcedureProjections.ts',
      ),
      'utf8',
    );
    expect(projectorSource).not.toContain('foundation1SourceObligations');
    expect(projectorSource).not.toContain('obligationId');
  });
});
