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
    expect([...LANDED_MAGIC_ITEM_ENGINE_HOOKS].sort()).toEqual(
      [
        magicItemEngineHookKey({
          engine: 'F2',
          hook: 'olc5.11 pack-tested paid item operation',
        }),
        magicItemEngineHookKey({
          engine: 'F5',
          hook: 'olc5.11 pack-tested item state and timer transition',
        }),
        magicItemEngineHookKey({
          engine: 'F5',
          hook: 'duration-budget accounting',
        }),
        magicItemEngineHookKey({
          engine: 'F5',
          hook: 'elapsed-time cooldown reset',
        }),
        magicItemEngineHookKey({
          engine: 'F5',
          hook: 'state-anchored cooldown reset',
        }),
        magicItemEngineHookKey({
          engine: 'F5',
          hook: 'grant-anchored cooldown reset',
        }),
        magicItemEngineHookKey({
          engine: 'F5',
          hook: 'external-event item lifecycle consequence',
        }),
        magicItemEngineHookKey({
          engine: 'F7',
          hook: 'long-rest reset and early-reuse gate',
        }),
        magicItemEngineHookKey({
          engine: 'F5',
          hook: 'dawn reset with nonblocking early-reuse risk',
        }),
        magicItemEngineHookKey({
          engine: 'F5',
          hook: 'per-period usage reset',
        }),
      ].sort(),
    );
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

describe('charge-recharge ownership is narrow and per clause', () => {
  const rechargeHook = {
    engine: 'F5' as const,
    hook: 'magic-item-usage-recharge',
  };
  const classifyCharge = (
    economy: Record<string, unknown>,
    operationCost: unknown = { economy: 'charges', amount: 'variable' },
    operationId = 'use',
  ) => {
    const record = itemRecord({
      description: 'Fixture.',
      mechanics: {
        economies: { charges: economy },
        operations: [{ id: operationId, cost: [operationCost] }],
      },
    });
    return validateMagicItemClausesAndClassify({
      records: [record],
      clausesByItemKey: new Map([
        [
          record.key,
          [
            {
              id: 'fixture/economy',
              tag: 'C1',
              representation: { block: 'economies', economyId: 'charges' },
              engineHooks: [rechargeHook],
            },
            {
              id: 'fixture/operation',
              tag: 'C1',
              representation: { block: 'operations', operationId },
              engineHooks: [rechargeHook],
            },
          ],
        ],
      ]),
      landedEngineHooks: LANDED_MAGIC_ITEM_ENGINE_HOOKS,
    });
  };
  const economy = (reset: unknown = [{ at: 'dawn', amount: '1d3' }]) => ({
    kind: 'charges',
    charges: { max: 3 },
    reset,
  });

  it('owns a dice regain economy and its supported fixed or variable costs', () => {
    expect(
      classifyCharge(economy(), { economy: 'charges', amount: 'variable' }).map(
        ({ readiness }) => readiness,
      ),
    ).toEqual(['green', 'green']);
    expect(
      classifyCharge(economy(), { economy: 'charges', amount: 2 }).map(
        ({ readiness }) => readiness,
      ),
    ).toEqual(['green', 'green']);
  });

  it('keeps the hook for depletion consequences, a 7-day reset, or multiple reset entries', () => {
    const depleted = {
      ...economy(),
      onDepleted: { roll: 'd20', regainOn: 20, regainAmount: '1d8' },
    };
    const weekly = economy([{ at: 'days', days: 7, amount: '1d3' }]);
    const multiple = economy([
      { at: 'dawn', amount: '1d3' },
      { at: 'dusk', amount: '1d3' },
    ]);
    for (const counterfactual of [depleted, weekly, multiple])
      expect(
        classifyCharge(counterfactual).map(({ readiness }) => readiness),
      ).toEqual(['engine-pending', 'engine-pending']);
  });

  it('keeps operations pending when any cost is outside the supported spend contract', () => {
    expect(
      classifyCharge(economy(), { economy: 'charges', amount: '1d4' }).map(
        ({ readiness }) => readiness,
      ),
    ).toEqual(['green', 'engine-pending']);
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

  it('isolates parent and selected-variant clause evidence from sibling variants', () => {
    const record = itemRecord({
      parentField: ['parent-ref'],
      mechanics: {
        economies: { parentEconomy: { kind: 'charges' } },
        operations: [{ id: 'parent-operation' }],
        effects: [{ id: 'parent-effect', kind: 'sense' }],
        stateMachine: { initial: 'parent' },
      },
      variants: [
        {
          id: 'alpha',
          name: 'Alpha',
          alphaField: ['alpha-ref'],
          mechanics: {
            economies: { alphaEconomy: { kind: 'charges' } },
            operations: [{ id: 'alpha-operation' }],
            effects: [{ id: 'alpha-effect', kind: 'sense' }],
            containment: { capacity: 1 },
          },
        },
        {
          id: 'beta',
          name: 'Beta',
          betaField: ['beta-ref'],
          mechanics: {
            economies: { betaEconomy: { kind: 'charges' } },
            operations: [{ id: 'beta-operation' }],
            effects: [{ id: 'beta-effect', kind: 'sense' }],
            curse: { blocksUnattune: true },
          },
        },
      ],
    });
    const classify = (
      id: string,
      representation: ItemClauseExpectation['representation'],
    ) =>
      validateMagicItemClausesAndClassify({
        records: [record],
        clausesByItemKey: new Map([
          [record.key, [{ id, tag: 'M1', representation }]],
        ]),
      });

    const parentId = `${record.key}/parent`;
    const alphaId = `${record.key}/variant:alpha/clause`;
    expect(
      classify(parentId, { block: 'effects', effectId: 'parent-effect' }),
    ).toHaveLength(1);
    expect(
      classify(alphaId, { block: 'effects', effectId: 'parent-effect' }),
    ).toHaveLength(1);
    expect(
      classify(alphaId, { block: 'effects', effectId: 'alpha-effect' }),
    ).toHaveLength(1);
    expect(
      classify(alphaId, {
        block: 'structuredField',
        field: 'alphaField',
        ref: 'alpha-ref',
      }),
    ).toHaveLength(1);
    expect(
      classify(alphaId, {
        block: 'structuredField',
        field: 'variants',
        ref: 'alpha',
      }),
    ).toHaveLength(1);

    for (const representation of [
      { block: 'effects', effectId: 'beta-effect' },
      { block: 'operations', operationId: 'beta-operation' },
      { block: 'economies', economyId: 'betaEconomy' },
      { block: 'curse' },
      {
        block: 'structuredField',
        field: 'betaField',
        ref: 'beta-ref',
      },
      {
        block: 'structuredField',
        field: 'variants',
        ref: 'beta',
      },
    ] as const) {
      expect(() => classify(alphaId, representation)).toThrow(
        /representation binding does not resolve/,
      );
    }
    expect(() =>
      classify(parentId, { block: 'effects', effectId: 'alpha-effect' }),
    ).toThrow(/representation binding does not resolve/);
  });

  it('requires every variant-scoped clause disposition to name an emitted variant and clause suffix', () => {
    const record = itemRecord({
      description: 'A contextual clause.',
      variants: [{ id: 'alpha', name: 'Alpha', mechanics: {} }],
    });
    const adjudicated = {
      adjudicated: true,
      note: 'contextual',
      sourceText: 'contextual',
    } as const;
    const classify = (
      id: string,
      representation: ItemClauseExpectation['representation'],
    ) =>
      validateMagicItemClausesAndClassify({
        records: [record],
        clausesByItemKey: new Map([
          [record.key, [{ id, tag: 'M1', representation }]],
        ]),
      });

    for (const representation of [
      adjudicated,
      { designBlocked: true, reason: 'out of scope' },
    ] as const) {
      expect(() =>
        classify(`${record.key}/variant:missing/clause`, representation),
      ).toThrow(/references unknown variant "missing"/);
    }
    expect(() =>
      classify(`${record.key}/variant:/clause`, adjudicated),
    ).toThrow(/empty variant scope/);
    for (const id of [
      `${record.key}/variant:alpha`,
      `${record.key}/variant:alpha/`,
    ]) {
      expect(() => classify(id, adjudicated)).toThrow(/missing clause suffix/);
    }
    expect(
      classify(`${record.key}/variant:alpha/clause`, adjudicated),
    ).toHaveLength(1);
    // Faithful-or-absent: an adjudicated clause must carry a verbatim span of
    // the printed description (eshyra-o9bd.19.4.5.8).
    for (const sourceText of ['', 'paraphrased clause', 'Contextual']) {
      expect(() =>
        classify(`${record.key}/variant:alpha/clause`, {
          ...adjudicated,
          sourceText,
        }),
      ).toThrow(/not a non-empty verbatim span/);
    }
  });

  it('validates operation references against each runtime-effective parent plus selected variant scope', () => {
    const classify = (record: RulesRecord) =>
      validateMagicItemClausesAndClassify({
        records: [record],
        clausesByItemKey: new Map([[record.key, []]]),
      });
    const inherited = itemRecord({
      mechanics: {
        economies: { parentEconomy: { kind: 'charges' } },
        effects: [{ id: 'parent-effect', kind: 'sense' }],
        operations: [
          {
            id: 'shared-operation',
            cost: [{ economy: 'parentEconomy', amount: 1 }],
          },
        ],
      },
      variants: [
        {
          id: 'alpha',
          name: 'Alpha',
          mechanics: {
            economies: { alphaEconomy: { kind: 'charges' } },
            effects: [{ id: 'alpha-effect', kind: 'sense' }],
            operations: [
              { id: 'shared-operation', effects: ['alpha-effect'] },
              {
                id: 'alpha-operation',
                cost: [{ economy: 'parentEconomy', amount: 1 }],
                doesNotExpend: ['parentEconomy'],
                effects: ['parent-effect'],
                excludes: ['shared-operation'],
              },
            ],
          },
        },
      ],
    });
    expect(classify(inherited)).toMatchObject([{ readiness: 'red' }]);

    const parentLicensedByChild = itemRecord({
      mechanics: {
        operations: [{ id: 'parent-operation', effects: ['child-effect'] }],
      },
      variants: [
        {
          id: 'alpha',
          name: 'Alpha',
          mechanics: { effects: [{ id: 'child-effect', kind: 'sense' }] },
        },
      ],
    });
    expect(() => classify(parentLicensedByChild)).toThrow(
      /parent operation parent-operation references unknown effect "child-effect"/,
    );

    const siblingLeak = itemRecord({
      variants: [
        {
          id: 'alpha',
          name: 'Alpha',
          mechanics: { effects: [{ id: 'alpha-effect', kind: 'sense' }] },
        },
        {
          id: 'beta',
          name: 'Beta',
          mechanics: {
            operations: [{ id: 'beta-operation', effects: ['alpha-effect'] }],
          },
        },
      ],
    });
    expect(() => classify(siblingLeak)).toThrow(
      /variant "beta" operation beta-operation references unknown effect "alpha-effect"/,
    );
  });

  it('applies runtime variant operation merge conflict and duplicate rules during reference validation', () => {
    const classify = (record: RulesRecord) =>
      validateMagicItemClausesAndClassify({
        records: [record],
        clausesByItemKey: new Map([[record.key, []]]),
      });
    const conflict = itemRecord({
      mechanics: {
        operations: [{ id: 'activate', activation: { cost: 'action' } }],
      },
      variants: [
        {
          id: 'alpha',
          name: 'Alpha',
          mechanics: {
            operations: [{ id: 'activate', activation: { cost: 'reaction' } }],
          },
        },
      ],
    });
    expect(() => classify(conflict)).toThrow(
      /variant "alpha" cannot merge.*conflict on operation 'activate' activation.cost/,
    );
    const duplicate = itemRecord({
      variants: [
        {
          id: 'alpha',
          name: 'Alpha',
          mechanics: {
            operations: [{ id: 'activate' }, { id: 'activate' }],
          },
        },
      ],
    });
    expect(() => classify(duplicate)).toThrow(
      /duplicate operation id "activate"/,
    );
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
