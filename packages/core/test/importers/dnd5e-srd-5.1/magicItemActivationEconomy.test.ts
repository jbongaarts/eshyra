/**
 * Activation-economy typing and per-clause readiness (eshyra-xwau.1).
 *
 * Two contracts:
 *  1. FAITHFUL-OR-ABSENT COST EVIDENCE. Every typed activation cost this bead
 *     adds is backed by an exact printed phrase (the ledger), and every
 *     operation left untyped whose item text contains a strict action-type
 *     phrase is individually dispositioned (the phrase governs another
 *     operation, a spell's own casting time, or is ambiguous). Operations whose
 *     text prints no such phrase carry no typed cost.
 *  2. PER-CLAUSE READINESS. The four F2 activation-economy hooks are NOT in
 *     LANDED_MAGIC_ITEM_ENGINE_HOOKS. The classifier removes one from a clause
 *     only when that clause's operation(s)/transition(s) carry a typed cost
 *     use_item spends; it stays on every untyped clause. Asserted both on
 *     synthetic records and, generally, over the whole generated pack.
 */
import { describe, expect, it } from 'vitest';
import { SRD_5_1_LICENSE } from '../../../scripts/importers/dnd5e-srd-5.1/emit.js';
import {
  ACTION_TYPE_PHRASE,
  TYPED_ACTIVATION_COST_EVIDENCE,
  UNTYPED_ACTIVATION_PHRASE_DISPOSITIONS,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemActivationCostLedger.js';
import {
  ACTIVATION_ECONOMY_HOOK_KEYS,
  type ItemClauseExpectation,
  LANDED_MAGIC_ITEM_ENGINE_HOOKS,
  magicItemEngineHookKey,
  validateMagicItemClausesAndClassify,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemCompiler.js';
import { getBundledDnd5eSrdPack } from '../../../src/internal.js';
import type { RulesRecord } from '../../../src/rules/types.js';

type Obj = Record<string, unknown>;
const ACTIVATION_HOOKS = [
  'action-economy activation',
  'activation action economy',
  'reaction and action economy',
  'item activation and action-budget ownership',
];
const SPENT = new Set(['action', 'bonus-action', 'reaction']);

const pack = getBundledDnd5eSrdPack();
const items = pack.records.filter((record) => record.kind === 'magic-item');

interface Scope {
  readonly label: string;
  readonly item: string;
  readonly description: string;
  readonly operations: readonly Obj[];
}
const scopes: Scope[] = items.flatMap((record) => {
  const data = record.data as Obj;
  const parent = data.mechanics as Obj | undefined;
  return [
    {
      label: record.name,
      item: record.name,
      description: String(data.description),
      operations: (parent?.operations as Obj[] | undefined) ?? [],
    },
    ...((data.variants as Obj[] | undefined) ?? []).map((variant) => ({
      label: `${record.name}::${String(variant.name ?? variant.id)}`,
      item: record.name,
      description: String(variant.description ?? data.description),
      operations:
        ((variant.mechanics as Obj | undefined)?.operations as
          | Obj[]
          | undefined) ?? [],
    })),
  ];
});

const sentencesWithPhrase = (description: string): string[] =>
  (description.match(/[^.]+\./g) ?? [description]).filter((sentence) =>
    ACTION_TYPE_PHRASE.test(sentence),
  );

describe('activation-cost evidence ledger (faithful-or-absent)', () => {
  it('backs every typed cost this bead added with an exact printed phrase of that item', () => {
    for (const entry of TYPED_ACTIVATION_COST_EVIDENCE) {
      const scope = scopes.find(({ label }) => label === entry.item);
      expect(scope, entry.item).toBeDefined();
      expect(scope?.description, entry.item).toContain(entry.phrase);
      expect(ACTION_TYPE_PHRASE.test(entry.phrase), entry.phrase).toBe(true);
      const operation = scope?.operations.find(
        ({ id }) => id === entry.operationId,
      );
      expect((operation?.activation as Obj | undefined)?.cost).toBe(entry.cost);
    }
    // The audit found no operation left untyped whose own text prints its
    // action type; the earlier faithful-or-absent corpus already typed them.
    expect(TYPED_ACTIVATION_COST_EVIDENCE).toEqual([]);
  });

  it('dispositions exactly the untyped operations whose item text contains a strict action-type phrase', () => {
    const computed = scopes
      .flatMap((scope) =>
        scope.operations
          .filter(
            (operation) =>
              !SPENT.has(
                String((operation.activation as Obj | undefined)?.cost),
              ),
          )
          .filter(
            (operation) =>
              (operation.activation as Obj | undefined)?.cost !== 'consume' &&
              (operation.activation as Obj | undefined)?.cost !== 'free',
          )
          .filter(() => sentencesWithPhrase(scope.description).length > 0)
          .map((operation) => `${scope.label}/${String(operation.id)}`),
      )
      .sort();
    expect(computed).toEqual(
      Object.keys(UNTYPED_ACTIVATION_PHRASE_DISPOSITIONS).sort(),
    );
    for (const reason of Object.values(UNTYPED_ACTIVATION_PHRASE_DISPOSITIONS))
      expect(reason.length).toBeGreaterThan(0);
  });

  it('negative sample: untyped operations whose item text has no action-type phrase stay untyped', () => {
    const noPhrase = scopes.flatMap((scope) =>
      sentencesWithPhrase(scope.description).length > 0
        ? []
        : scope.operations.filter(
            (operation) =>
              (operation.activation as Obj | undefined)?.cost === undefined,
          ),
    );
    expect(noPhrase.length).toBeGreaterThan(30);
  });

  it('keeps the phrase screen able to fail (counterfactuals)', () => {
    for (const printed of [
      'you can use an action to cause',
      'As a bonus action, you can click',
      'you can use your reaction to absorb',
      'lighting it requires an action',
    ])
      expect(ACTION_TYPE_PHRASE.test(printed), printed).toBe(true);
    for (const unprinted of [
      'an action figure',
      'the transaction ends',
      'Each bead contains a spell',
      'a reactionary stance',
    ])
      expect(ACTION_TYPE_PHRASE.test(unprinted), unprinted).toBe(false);
  });
});

const hook = (name: string) => ({ engine: 'F2' as const, hook: name });
function record(mechanics: Obj): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'magic-item',
    key: 'magic-item:test-item',
    name: 'Test Item',
    data: { description: 'Test.', mechanics },
    source: 'SRD 5.1 p. 1',
    license: SRD_5_1_LICENSE,
    provenance: { sourceRef: 'test', locator: 'p. 1' },
  };
}
function classify(
  mechanics: Obj,
  representation: ItemClauseExpectation['representation'],
  hookName = 'activation action economy',
) {
  const item = record(mechanics);
  return validateMagicItemClausesAndClassify({
    records: [item],
    clausesByItemKey: new Map([
      [
        item.key,
        [
          {
            id: 'test-item/clause',
            tag: 'M5',
            representation,
            engineHooks: [hook(hookName)],
          },
        ],
      ],
    ]),
    landedEngineHooks: LANDED_MAGIC_ITEM_ENGINE_HOOKS,
  })[0];
}

describe('activation-economy hooks are removed per clause, never landed globally', () => {
  it('does not register any activation-economy hook as globally landed', () => {
    for (const key of ACTIVATION_ECONOMY_HOOK_KEYS)
      expect(LANDED_MAGIC_ITEM_ENGINE_HOOKS.has(key)).toBe(false);
    expect([...ACTIVATION_ECONOMY_HOOK_KEYS].sort()).toEqual(
      ACTIVATION_HOOKS.map((name) => magicItemEngineHookKey(hook(name))).sort(),
    );
  });

  it('operation clause: owned only when that operation carries a spent typed cost', () => {
    for (const [activation, owned] of [
      [{ cost: 'action' }, true],
      [{ cost: 'bonus-action' }, true],
      [{ cost: 'reaction' }, true],
      [{ cost: 'free' }, false],
      [{ cost: 'consume' }, false],
      [{ commandWord: true }, false],
      [undefined, false],
    ] as const) {
      const entry = classify(
        {
          operations: [
            { id: 'use', ...(activation === undefined ? {} : { activation }) },
          ],
        },
        { block: 'operations', operationId: 'use' },
      );
      expect(entry?.readiness, JSON.stringify(activation)).toBe(
        owned ? 'green' : 'engine-pending',
      );
    }
  });

  it('keeps every other pending hook: only the activation-economy hook is removed', () => {
    const item = record({
      operations: [{ id: 'use', activation: { cost: 'action' } }],
    });
    const [entry] = validateMagicItemClausesAndClassify({
      records: [item],
      clausesByItemKey: new Map([
        [
          item.key,
          [
            {
              id: 'test-item/clause',
              tag: 'M5',
              representation: { block: 'operations', operationId: 'use' },
              engineHooks: [
                hook('activation action economy'),
                {
                  engine: 'F9',
                  hook: 'geometry, targeting, movement, and contest resolution',
                },
              ],
            },
          ],
        ],
      ]),
      landedEngineHooks: LANDED_MAGIC_ITEM_ENGINE_HOOKS,
    });
    expect(entry?.readiness).toBe('engine-pending');
    expect(entry?.missingHooks).toEqual([
      {
        engine: 'F9',
        hook: 'geometry, targeting, movement, and contest resolution',
      },
    ]);
    expect(entry?.engineHooks).toHaveLength(2);
  });

  it('state-machine clause: one untyped activate or deactivate operation keeps the whole machine pending', () => {
    const machine = (second: Obj) => ({
      operations: [{ id: 'on', activation: { cost: 'bonus-action' } }, second],
      stateMachine: {
        initial: 'off',
        states: [{ id: 'off' }, { id: 'active' }],
        transitions: [
          { from: 'off', to: 'active', via: 'on' },
          { from: 'active', to: 'off', via: 'off-op' },
        ],
      },
    });
    const block = { block: 'stateMachine' as const };
    expect(
      classify(machine({ id: 'off-op', activation: { cost: 'action' } }), block)
        ?.readiness,
    ).toBe('green');
    expect(classify(machine({ id: 'off-op' }), block)?.readiness).toBe(
      'engine-pending',
    );
    expect(
      classify(
        machine({ id: 'off-op', activation: { cost: 'consume' } }),
        block,
      )?.readiness,
    ).toBe('engine-pending');
    // A machine with no operation-driven transition owns nothing.
    expect(
      classify(
        {
          stateMachine: {
            initial: 'a',
            states: [{ id: 'a' }, { id: 'b' }],
            transitions: [{ from: 'a', to: 'b', condition: 'when it rains' }],
          },
        },
        block,
      )?.readiness,
    ).toBe('engine-pending');
  });

  it('effects clause: owned only by exactly one typed operation, not a shared, untyped or unreferenced effect', () => {
    const effect = (id: string) => ({ id, kind: 'sense' });
    const rep = { block: 'effects' as const, effectId: 'fx' };
    const typedOp = (id: string) => ({
      id,
      activation: { cost: 'action' },
      effects: ['fx'],
    });
    expect(
      classify({ operations: [typedOp('a')], effects: [effect('fx')] }, rep)
        ?.readiness,
    ).toBe('green');
    expect(
      classify(
        { operations: [typedOp('a'), typedOp('b')], effects: [effect('fx')] },
        rep,
      )?.readiness,
    ).toBe('engine-pending');
    expect(
      classify(
        { operations: [{ id: 'a', effects: ['fx'] }], effects: [effect('fx')] },
        rep,
      )?.readiness,
    ).toBe('engine-pending');
    expect(
      classify({ operations: [], effects: [effect('fx')] }, rep)?.readiness,
    ).toBe('engine-pending');
  });

  it('never owns the interItem and containment blocks, whatever the operation cost', () => {
    const mechanics = {
      operations: [{ id: 'use', activation: { cost: 'action' } }],
      interItem: {},
      containment: {},
    };
    for (const block of ['interItem', 'containment'] as const)
      expect(
        classify(
          mechanics,
          { block },
          'item activation and action-budget ownership',
        )?.readiness,
        block,
      ).toBe('engine-pending');
  });
});

describe('generated pack: a clause loses the activation hook only when its operation or transition is typed', () => {
  type Clause = {
    clauseId: string;
    scope: { kind: string; variantKey?: string };
    representation: Obj;
    engineHooks?: { engine: string; hook: string }[];
    missingHooks?: { engine: string; hook: string }[];
  };

  it('holds for every clause of every item (independent re-derivation)', () => {
    let removed = 0;
    let kept = 0;
    const problems: string[] = [];
    for (const record of items) {
      const data = record.data as Obj;
      const clauses = (data.executionReadiness as { clauses: Clause[] })
        .clauses;
      for (const clause of clauses) {
        const declared = (clause.engineHooks ?? []).filter(({ hook: name }) =>
          ACTIVATION_HOOKS.includes(name),
        );
        if (declared.length === 0) continue;
        const stillMissing = (clause.missingHooks ?? []).some(
          ({ hook: name }) => ACTIVATION_HOOKS.includes(name),
        );
        const variant =
          clause.scope.kind === 'variant'
            ? ((data.variants as Obj[]).find(
                ({ id }) => id === clause.scope.variantKey,
              ) as Obj)
            : undefined;
        const mechanics = {
          ...((data.mechanics as Obj | undefined) ?? {}),
          ...((variant?.mechanics as Obj | undefined) ?? {}),
        };
        const operations = (mechanics.operations as Obj[] | undefined) ?? [];
        const costOf = (id: unknown) =>
          (operations.find((op) => op.id === id)?.activation as Obj | undefined)
            ?.cost;
        const rep = clause.representation;
        let expectOwned = false;
        if (rep.block === 'operations')
          expectOwned = SPENT.has(String(costOf(rep.operationId)));
        else if (rep.block === 'stateMachine') {
          const vias = [
            ...new Set(
              ((mechanics.stateMachine as Obj).transitions as Obj[])
                .map(({ via }) => via)
                .filter((via) => via !== undefined),
            ),
          ];
          expectOwned =
            vias.length > 0 &&
            vias.every((via) => SPENT.has(String(costOf(via))));
        } else if (rep.block === 'effects') {
          const referencing = operations.filter(({ effects }) =>
            (effects as unknown[] | undefined)?.includes(rep.effectId),
          );
          expectOwned =
            referencing.length === 1 &&
            SPENT.has(String(costOf(referencing[0]?.id)));
        }
        if (stillMissing === expectOwned)
          problems.push(
            `${clause.clauseId}: owned=${expectOwned} stillMissing=${stillMissing}`,
          );
        if (expectOwned) removed++;
        else kept++;
      }
    }
    expect(problems).toEqual([]);
    // Non-vacuous: both outcomes occur in the pack.
    expect(removed).toBeGreaterThan(100);
    expect(kept).toBeGreaterThan(30);
  });
});
