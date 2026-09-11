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
  enumerateFoundation1Atoms,
  evaluateFoundation1Proof,
  type Foundation1Obligation,
  type Foundation1ProjectedAtom,
  matchFoundation1Candidates,
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
  'atom/equipment:longsword/procedure/longsword-damage/mode/one-handed',
  'atom/equipment:longsword/procedure/longsword-damage/mode/two-handed',
  'atom/equipment:longsword/procedure/longsword-damage/selector',
  'atom/feature:fighter:fighting-style/procedure/fighter-fighting-style/choice/fighting-style',
  'atom/feature:fighter:fighting-style/procedure/fighter-fighting-style/duplicateSelection',
  'atom/feature:fighter:fighting-style/procedure/fighter-fighting-style/option/fighting-style:archery',
  'atom/feature:fighter:fighting-style/procedure/fighter-fighting-style/option/fighting-style:defense',
  'atom/feature:fighter:fighting-style/procedure/fighter-fighting-style/option/fighting-style:dueling',
  'atom/feature:fighter:fighting-style/procedure/fighter-fighting-style/option/fighting-style:great-weapon-fighting',
  'atom/feature:fighter:fighting-style/procedure/fighter-fighting-style/option/fighting-style:protection',
  'atom/feature:fighter:fighting-style/procedure/fighter-fighting-style/option/fighting-style:two-weapon-fighting',
  'atom/feature:sorcerer:font-of-magic/procedure/font-of-magic/operations/convertSpellSlot/actionCost',
  'atom/feature:sorcerer:font-of-magic/procedure/font-of-magic/operations/convertSpellSlot/pointsGained',
  'atom/feature:sorcerer:font-of-magic/procedure/font-of-magic/operations/createSpellSlot/actionCost',
  'atom/feature:sorcerer:font-of-magic/procedure/font-of-magic/operations/createSpellSlot/costBySlotLevel',
  'atom/feature:sorcerer:font-of-magic/procedure/font-of-magic/operations/createSpellSlot/createdSlotExpires',
  'atom/feature:sorcerer:font-of-magic/procedure/font-of-magic/operations/createSpellSlot/maximumSlotLevel',
  'atom/feature:sorcerer:font-of-magic/procedure/font-of-magic/pool',
  'atom/feature:sorcerer:font-of-magic/procedure/font-of-magic/pool/maximumByLevel',
  'atom/feature:sorcerer:font-of-magic/procedure/font-of-magic/pool/reset',
  'atom/hazard:burnt-othur-fumes/procedure/burnt-othur-fumes/initial/failureDamage',
  'atom/hazard:burnt-othur-fumes/procedure/burnt-othur-fumes/initial/save',
  'atom/hazard:burnt-othur-fumes/procedure/burnt-othur-fumes/repeat/failureDamage',
  'atom/hazard:burnt-othur-fumes/procedure/burnt-othur-fumes/repeat/save',
  'atom/hazard:burnt-othur-fumes/procedure/burnt-othur-fumes/repeat/timing',
  'atom/hazard:burnt-othur-fumes/procedure/burnt-othur-fumes/termination',
  'atom/spell:wish/procedure/wish-nonstandard-effect/adjudicationBoundary',
  'atom/spell:wish/procedure/wish-nonstandard-effect/stress/recovery',
  'atom/spell:wish/procedure/wish-nonstandard-effect/stress/recurringDamage',
  'atom/spell:wish/procedure/wish-nonstandard-effect/stress/strength',
  'atom/spell:wish/procedure/wish-nonstandard-effect/stress/trigger',
  'atom/spell:wish/procedure/wish-nonstandard-effect/stress/wishLoss',
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

function procedures(
  input: RulesRecord[],
  key: string,
): Record<string, unknown>[] {
  const data = record(input, key).data as Record<string, unknown>;
  const mechanics = data.mechanics as Record<string, unknown>;
  return mechanics.procedures as Record<string, unknown>[];
}

function projectedAtom(id: string): Foundation1ProjectedAtom {
  return {
    id,
    recordKey: 'hazard:synthetic',
    pointer: `/data/${id}`,
    semanticPointer: `/procedure/synthetic/${id}`,
    facet: 'save',
    value: { ability: 'constitution', dc: 13 },
  };
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
    const atomsById = new Map(
      records
        .flatMap((entry) => enumerateFoundation1Atoms(entry))
        .map((atom) => [atom.id, atom]),
    );
    for (const discharge of report.discharges) {
      const obligation = obligations.find(
        (candidate) => candidate.id === discharge.obligationId,
      );
      const projectedAtom = atomsById.get(discharge.atomId);
      expect(obligation).toBeDefined();
      expect(projectedAtom).toBeDefined();
      expect(
        projectedAtom?.semanticPointer === obligation?.localityPointer ||
          projectedAtom?.semanticPointer.startsWith(
            `${obligation?.localityPointer}/`,
          ),
      ).toBe(true);
    }
  });

  it('reproduces the pre-projection failure boundary instead of treating no procedures as green', () => {
    const report = evaluateFoundation1Proof(
      stripProcedures(records),
      obligations,
    );
    expect(report.ok).toBe(false);
    expect(report.discharges).toHaveLength(0);
    expect(report.failures).toHaveLength(32);
    expect(new Set(report.failures.map((failure) => failure.code))).toEqual(
      new Set(['MISSING_FACET']),
    );
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

  it('binds damage and option effects to their semantic selectors', () => {
    const changed = cloneRecords();
    const modes = procedure(changed, 'equipment:longsword').modes as Record<
      string,
      unknown
    >[];
    [modes[0].hands, modes[1].hands] = [modes[1].hands, modes[0].hands];
    const options = procedure(changed, 'feature:fighter:fighting-style')
      .options as Record<string, unknown>[];
    [options[0].id, options[1].id] = [options[1].id, options[0].id];
    const report = evaluateFoundation1Proof(changed, obligations);
    expect(report.ok).toBe(false);
    expect(
      report.failures.filter((failure) => failure.code === 'MISSING_FACET'),
    ).toHaveLength(4);
  });

  it('binds the existing feature choice to the projected option procedure', () => {
    const changed = cloneRecords();
    const fightingStyle = record(changed, 'feature:fighter:fighting-style');
    const data = fightingStyle.data as Record<string, unknown>;
    const choices = data.choices as Record<string, unknown>[];
    choices.push({ id: 'other-choice', choose: 1, options: [] });
    procedure(changed, fightingStyle.key).choiceId = 'other-choice';
    const report = evaluateFoundation1Proof(changed, obligations);
    expect(report.ok).toBe(false);
    expect(report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MISSING_FACET' }),
      ]),
    );
  });

  it('keeps selector-bound discharges stable when modes and options are reordered', () => {
    const changed = cloneRecords();
    const modes = procedure(changed, 'equipment:longsword').modes as Record<
      string,
      unknown
    >[];
    modes.reverse();
    const options = procedure(changed, 'feature:fighter:fighting-style')
      .options as Record<string, unknown>[];
    options.reverse();

    const report = evaluateFoundation1Proof(changed, obligations);
    expect(report.ok).toBe(true);
    expect(report.discharges).toHaveLength(obligations.length);
  });

  it.each([
    'hazard:burnt-othur-fumes',
    'equipment:longsword',
    'feature:fighter:fighting-style',
    'feature:sorcerer:font-of-magic',
    'spell:wish',
  ])('rejects duplicate and competing procedures for %s', (key) => {
    const duplicateRecords = cloneRecords();
    const duplicate = structuredClone(procedure(duplicateRecords, key));
    procedures(duplicateRecords, key).push(duplicate);
    expect(
      evaluateFoundation1Proof(duplicateRecords, obligations),
    ).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ code: 'MALFORMED_PROJECTION' }),
      ]),
    });

    const competingRecords = cloneRecords();
    const competing = structuredClone(procedure(competingRecords, key));
    competing.id = `${String(competing.id)}-competitor`;
    procedures(competingRecords, key).push(competing);
    expect(
      evaluateFoundation1Proof(competingRecords, obligations),
    ).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ code: 'MALFORMED_PROJECTION' }),
      ]),
    });
  });

  it.each([
    ['hazard:burnt-othur-fumes', 'equipment:longsword'],
    ['equipment:longsword', 'hazard:burnt-othur-fumes'],
    ['feature:fighter:fighting-style', 'equipment:longsword'],
    ['feature:sorcerer:font-of-magic', 'equipment:longsword'],
    ['spell:wish', 'equipment:longsword'],
  ] as const)(
    'keeps semantic discharge stable when %s procedures are reordered',
    (key, donorKey) => {
      const changed = cloneRecords();
      const donor = structuredClone(procedure(changed, donorKey));
      procedures(changed, key).unshift(donor);
      const report = evaluateFoundation1Proof(changed, obligations);
      expect(report.ok).toBe(true);
      expect(report.discharges).toHaveLength(obligations.length);
    },
  );

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

describe('Foundation 1 injective matching', () => {
  const [atomA, atomB, atomC] = ['atom-a', 'atom-b', 'atom-c'].map(
    projectedAtom,
  );

  it('preserves a displaced obligation after successful reassignment', () => {
    const matches = matchFoundation1Candidates(
      new Map([
        ['broad', [atomA, atomB]],
        ['specific', [atomA]],
      ]),
    );
    expect(
      [...matches.entries()].map(([key, value]) => [key, value.id]),
    ).toEqual([
      ['broad', 'atom-b'],
      ['specific', 'atom-a'],
    ]);
  });

  it.each([
    [
      [
        ['broad-a', [atomA, atomB, atomC]],
        ['broad-b', [atomA, atomB]],
        ['specific', [atomA]],
      ],
    ],
    [
      [
        ['specific', [atomA]],
        ['broad-b', [atomA, atomB]],
        ['broad-a', [atomA, atomB, atomC]],
      ],
    ],
  ] as const)(
    'finds a longer augmenting chain regardless of order',
    (entries) => {
      const matches = matchFoundation1Candidates(new Map(entries));
      expect(matches.size).toBe(3);
      expect(new Set([...matches.values()].map((atom) => atom.id))).toEqual(
        new Set(['atom-a', 'atom-b', 'atom-c']),
      );
    },
  );
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

  it.each([
    [
      'feature:fighter:fighting-style',
      (data: Record<string, unknown>) => {
        const choices = data.choices as Record<string, unknown>[];
        const options = choices[0].options as Record<string, unknown>[];
        options[0].text = String(options[0].text).replace('+2', '+9');
      },
    ],
    [
      'feature:fighter:fighting-style',
      (data: Record<string, unknown>) => {
        const choices = data.choices as Record<string, unknown>[];
        const options = choices[0].options as Record<string, unknown>[];
        options[2].text = String(options[2].text).replace(
          'no other weapons',
          'an empty other hand',
        );
      },
    ],
    [
      'feature:sorcerer:font-of-magic',
      (data: Record<string, unknown>) => {
        data.description = String(data.description).replace(
          'as a bonus action on your turn',
          'as an action on your turn',
        );
      },
    ],
    [
      'spell:wish',
      (data: Record<string, unknown>) => {
        data.description = String(data.description).replace(
          'until you finish a long rest, you take 1d10',
          'until you finish a short rest, you take 1d10',
        );
      },
    ],
  ] as const)(
    'rejects curated semantic drift in %s source inputs',
    (key, mutate) => {
      const changed = stripProcedures(records);
      mutate(record(changed, key).data as Record<string, unknown>);
      expect(() => applyFoundation1ProcedureProjections(changed)).toThrow(
        Foundation1ProjectionError,
      );
    },
  );

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
