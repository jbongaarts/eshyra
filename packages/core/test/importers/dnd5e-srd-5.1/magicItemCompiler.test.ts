import { describe, expect, it } from 'vitest';
import { SRD_5_1_LICENSE } from '../../../scripts/importers/dnd5e-srd-5.1/emit.js';
import {
  aggregateMagicItemFamilyProjections,
  attachMagicItemExecutionReadiness,
  type ItemClauseExpectation,
  LANDED_MAGIC_ITEM_ENGINE_HOOKS,
  MAGIC_ITEM_ENGINE_FAMILIES,
  magicItemEngineHookKey,
  validateMagicItemClausesAndClassify,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemCompiler.js';
import { validateRecordKindSchema } from '../../../src/rules/kindSchemas.js';
import type { RulesRecord } from '../../../src/rules/types.js';

function itemRecord(data: Record<string, unknown>): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'magic-item',
    key: 'magic-item:test-item',
    name: 'Test Item',
    data,
    source: 'SRD 5.1 p. 1',
    license: SRD_5_1_LICENSE,
    provenance: { sourceRef: 'test', locator: 'p. 1' },
  };
}

describe('magic-item compiler family aggregation', () => {
  it('keeps F1 in the reviewed magic-item engine-hook vocabulary', () => {
    expect(MAGIC_ITEM_ENGINE_FAMILIES).toContain('F1');
  });

  it('registers only reviewed, exact live-runtime hook contracts', () => {
    expect([...LANDED_MAGIC_ITEM_ENGINE_HOOKS]).toEqual([
      magicItemEngineHookKey({
        engine: 'F5',
        hook: 'duration-budget accounting',
      }),
    ]);
    expect(LANDED_MAGIC_ITEM_ENGINE_HOOKS).not.toContain(
      magicItemEngineHookKey({
        engine: 'F5',
        hook: 'magic-item-usage-recharge',
      }),
    );
    expect(LANDED_MAGIC_ITEM_ENGINE_HOOKS).not.toContain(
      magicItemEngineHookKey({
        engine: 'F5',
        hook: 'item state transition and duration processing',
      }),
    );
  });
  it('merges orthogonal keyed blocks and arrays deterministically', () => {
    const result = aggregateMagicItemFamilyProjections([
      {
        family: 'M3',
        mechanics: {
          effects: [{ id: 'flight', kind: 'speedSet', value: 60 }],
        },
        clauses: [],
      },
      {
        family: 'C1',
        mechanics: {
          economies: { charges: { kind: 'charges', charges: { max: 3 } } },
          operations: [
            {
              id: 'fly',
              cost: [{ economy: 'charges', amount: 1 }],
              effects: ['flight'],
            },
          ],
        },
        clauses: [],
      },
    ]);
    expect(result.mechanics).toEqual({
      economies: { charges: { kind: 'charges', charges: { max: 3 } } },
      operations: [
        {
          id: 'fly',
          cost: [{ economy: 'charges', amount: 1 }],
          effects: ['flight'],
        },
      ],
      effects: [{ id: 'flight', kind: 'speedSet', value: 60 }],
    });
  });

  it('rejects duplicate ids and conflicting singleton blocks', () => {
    expect(() =>
      aggregateMagicItemFamilyProjections([
        {
          family: 'C1',
          mechanics: {
            operations: [{ id: 'activate' }, { id: 'activate' }],
          },
          clauses: [],
        },
      ]),
    ).toThrow(/duplicate operation id "activate"/);
    expect(() =>
      aggregateMagicItemFamilyProjections([
        {
          family: 'M5',
          mechanics: {
            activation: { cost: 'action' },
          },
          clauses: [],
        },
        {
          family: 'M7',
          mechanics: {
            activation: { cost: 'reaction' },
          },
          clauses: [],
        },
      ]),
    ).toThrow(/conflicting activation blocks/);
  });

  it('merges C1 costs with C2 effects into one stable operation', () => {
    const result = aggregateMagicItemFamilyProjections([
      {
        family: 'C2',
        mechanics: {
          operations: [
            {
              id: 'cast-fireball',
              effects: ['fireball'],
              excludes: ['cast-wall-of-fire'],
            },
          ],
        },
        clauses: [],
      },
      {
        family: 'C1',
        mechanics: {
          operations: [
            {
              id: 'cast-fireball',
              activation: { cost: 'action' },
              cost: [{ economy: 'charges', amount: 3 }],
            },
          ],
        },
        clauses: [],
      },
    ]);
    expect(result.mechanics?.operations).toEqual([
      {
        id: 'cast-fireball',
        activation: { cost: 'action' },
        cost: [{ economy: 'charges', amount: 3 }],
        excludes: ['cast-wall-of-fire'],
        effects: ['fireball'],
      },
    ]);
  });

  it('deduplicates identical split-owner contributions', () => {
    const result = aggregateMagicItemFamilyProjections([
      {
        family: 'C1',
        mechanics: {
          operations: [
            {
              id: 'activate',
              activation: { cost: 'action', commandWord: true },
              cost: [{ economy: 'charges', amount: 1 }],
              effects: ['glow'],
              excludes: ['sleep'],
              doesNotExpend: ['reserve'],
              note: 'source-grounded note',
            },
          ],
        },
        clauses: [],
      },
      {
        family: 'C2',
        mechanics: {
          operations: [
            {
              id: 'activate',
              activation: { commandWord: true, cost: 'action' },
              cost: [{ economy: 'charges', amount: 1 }],
              effects: ['glow'],
              excludes: ['sleep'],
              doesNotExpend: ['reserve'],
              note: 'source-grounded note',
            },
          ],
        },
        clauses: [],
      },
    ]);
    expect(result.mechanics?.operations).toHaveLength(1);
    expect(result.mechanics?.operations?.[0]).toMatchObject({
      cost: [{ economy: 'charges', amount: 1 }],
      effects: ['glow'],
      excludes: ['sleep'],
      doesNotExpend: ['reserve'],
    });
  });

  it('field-merges compatible split-owner activation contracts', () => {
    const result = aggregateMagicItemFamilyProjections([
      {
        family: 'C2',
        mechanics: {
          operations: [
            {
              id: 'entangle-creature',
              activation: {
                cost: 'action',
                commandWord: true,
                requirement: 'holding one end of rope',
                target: 'one visible creature',
              },
            },
          ],
        },
        clauses: [],
      },
      {
        family: 'M5',
        mechanics: {
          operations: [
            { id: 'entangle-creature', activation: { cost: 'action' } },
          ],
        },
        clauses: [],
      },
    ]);
    expect(result.mechanics?.operations).toEqual([
      {
        id: 'entangle-creature',
        activation: {
          cost: 'action',
          commandWord: true,
          requirement: 'holding one end of rope',
          target: 'one visible creature',
        },
      },
    ]);
  });

  it.each([
    [
      'cost',
      { cost: [{ economy: 'charges', amount: 1 }] },
      { cost: [{ economy: 'charges', amount: 2 }] },
    ],
    [
      'activation',
      { activation: { cost: 'action' as const } },
      { activation: { cost: 'reaction' as const } },
    ],
    ['note', { note: 'first' }, { note: 'second' }],
  ])('rejects conflicting %s contributions', (_field, first, second) => {
    expect(() =>
      aggregateMagicItemFamilyProjections([
        {
          family: 'C1',
          mechanics: { operations: [{ id: 'activate', ...first }] },
          clauses: [],
        },
        {
          family: 'C2',
          mechanics: { operations: [{ id: 'activate', ...second }] },
          clauses: [],
        },
      ]),
    ).toThrow(/conflicting/);
  });
});

describe('magic-item clause integrity and readiness', () => {
  const effectClause: ItemClauseExpectation = {
    id: 'test-item/flight',
    tag: 'M3',
    representation: { block: 'effects', effectId: 'flight' },
  };

  it('resolves concrete effect bindings and rejects dangling operation references', () => {
    const record = itemRecord({
      mechanics: {
        effects: [{ id: 'flight', kind: 'speedSet', mode: 'fly', value: 60 }],
      },
    });
    expect(
      validateMagicItemClausesAndClassify({
        records: [record],
        clausesByItemKey: new Map([[record.key, [effectClause]]]),
      }),
    ).toEqual([
      {
        itemKey: record.key,
        clauseId: effectClause.id,
        scope: { kind: 'parent' },
        tag: 'M3',
        readiness: 'green',
        representation: { block: 'effects', effectId: 'flight' },
      },
    ]);

    const dangling = itemRecord({
      mechanics: {
        economies: { charges: { kind: 'charges', charges: { max: 3 } } },
        operations: [
          {
            id: 'activate',
            cost: [{ economy: 'missing', amount: 1 }],
            effects: ['missing-effect'],
          },
        ],
      },
    });
    expect(() =>
      validateMagicItemClausesAndClassify({
        records: [dangling],
        clausesByItemKey: new Map([[dangling.key, []]]),
      }),
    ).toThrow(/references unknown economy "missing"/);

    expect(() =>
      validateMagicItemClausesAndClassify({
        records: [record],
        clausesByItemKey: new Map([
          [
            record.key,
            [
              {
                ...effectClause,
                representation: {
                  block: 'effects' as const,
                  effectId: 'missing',
                },
              },
            ],
          ],
        ]),
      }),
    ).toThrow(/representation binding does not resolve/);
  });

  it('keeps a multi-hook clause pending until every exact hook lands', () => {
    const record = itemRecord({
      mechanics: { effects: [{ id: 'flight', kind: 'speedSet', value: 60 }] },
    });
    const clause: ItemClauseExpectation = {
      ...effectClause,
      engineHooks: [
        { engine: 'F5', hook: 'per-period budget reset' },
        { engine: 'F7', hook: 'long-rest budget reset' },
      ],
    };
    const pending = validateMagicItemClausesAndClassify({
      records: [record],
      clausesByItemKey: new Map([[record.key, [clause]]]),
      landedEngineHooks: new Set([
        magicItemEngineHookKey(
          clause.engineHooks?.[0] as {
            engine: 'F5';
            hook: string;
          },
        ),
      ]),
    });
    expect(pending[0]).toMatchObject({
      readiness: 'engine-pending',
      missingEngines: ['F7'],
      missingHooks: [{ engine: 'F7', hook: 'long-rest budget reset' }],
    });
    const green = validateMagicItemClausesAndClassify({
      records: [record],
      clausesByItemKey: new Map([[record.key, [clause]]]),
      landedEngineHooks: new Set(
        clause.engineHooks?.map(magicItemEngineHookKey),
      ),
    });
    expect(green[0].readiness).toBe('green');
  });

  it('persists no-landed hook evidence as trusted per-clause readiness', () => {
    const record = itemRecord({
      itemType: 'Wondrous item',
      rarity: 'rare',
      requiresAttunement: false,
      description: 'Test fixture.',
      mechanics: {
        effects: [{ id: 'flight', kind: 'speedSet', mode: 'fly', value: 60 }],
      },
    });
    const clause: ItemClauseExpectation = {
      ...effectClause,
      engineHooks: [{ engine: 'F5', hook: 'elapsed-time flight budget' }],
    };
    const classified = validateMagicItemClausesAndClassify({
      records: [record],
      clausesByItemKey: new Map([[record.key, [clause]]]),
    });
    const [persisted] = attachMagicItemExecutionReadiness([record], classified);
    expect(
      (persisted.data as Record<string, unknown>).executionReadiness,
    ).toMatchObject({
      source: 'derived-magic-item-clauses-v1',
      clauses: [
        {
          clauseId: clause.id,
          scope: { kind: 'parent' },
          tag: 'M3',
          readiness: 'engine-pending',
          representation: { block: 'effects', effectId: 'flight' },
          engineHooks: [{ engine: 'F5', hook: 'elapsed-time flight budget' }],
          missingHooks: [{ engine: 'F5', hook: 'elapsed-time flight budget' }],
        },
      ],
    });
    expect(() =>
      validateRecordKindSchema(persisted, 'records[0]'),
    ).not.toThrow();
    const data = persisted.data as Record<string, unknown>;
    const executionReadiness = data.executionReadiness as {
      readonly source: string;
      readonly clauses: readonly Record<string, unknown>[];
    };
    expect(() =>
      validateRecordKindSchema(
        {
          ...persisted,
          data: {
            ...data,
            executionReadiness: {
              ...executionReadiness,
              clauses: [
                ...executionReadiness.clauses,
                executionReadiness.clauses[0],
              ],
            },
          },
        },
        'records[0]',
      ),
    ).toThrow(/duplicate clauseId/);
    expect(() =>
      validateRecordKindSchema(
        {
          ...persisted,
          data: {
            ...data,
            executionReadiness: {
              ...executionReadiness,
              unsupported: true,
            },
          },
        },
        'records[0]',
      ),
    ).toThrow(/unsupported key/);
  });

  it('reports unregistered items as red while rejecting unknown registry keys', () => {
    const record = itemRecord({ description: 'Source prose.' });
    expect(
      validateMagicItemClausesAndClassify({
        records: [record],
        clausesByItemKey: new Map([[record.key, []]]),
      })[0].readiness,
    ).toBe('red');
    expect(() =>
      validateMagicItemClausesAndClassify({
        records: [record],
        clausesByItemKey: new Map([['magic-item:unknown', []]]),
      }),
    ).toThrow(/unknown item key "magic-item:unknown"/);
  });
});
