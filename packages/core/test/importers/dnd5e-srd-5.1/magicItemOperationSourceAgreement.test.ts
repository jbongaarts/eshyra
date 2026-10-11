/**
 * Magic-item operation / activation source agreement (eshyra-o9bd.19.4.6.1;
 * bd memory magic-item-faithful-or-absent).
 *
 * Invariant: a typed operation `activation` states the printed predicate
 * exactly or is not typed. It never invents an activation cost, command word,
 * prerequisite, trigger or target the item's printed description does not
 * carry, and an activation cost the text does not state is absent and carried
 * by an `adjudicated-by-design` clause with a verbatim `sourceText` span.
 *
 * Authority for the expected values is the printed SRD description of each
 * item, never the generated pack. This is a source-AGREEMENT screen, not a
 * capability or completeness claim. The lexical screen (cost words) is
 * necessary, not sufficient; the typed free-text fields (requirement / trigger /
 * target) set by the reviewed table are strictly stronger because the
 * compiler requires each to be a verbatim span of the description. The scenario
 * tests below pin one printed-eligible versus ineligible predicate per root
 * cause rather than one reproducer per item.
 *
 * Scope: operations/activation of the items the reviewed table covers
 * (eshyra-o9bd.19.4.5.7 groups S2 and S3). The same lexical screen applied to
 * the rest of the corpus is a recorded follow-up, not asserted here.
 */
import { describe, expect, it } from 'vitest';
import {
  applyFaithfulMagicItemOperations,
  MAGIC_ITEM_FAITHFUL_OPERATION_SPECS,
  MAGIC_ITEM_PRODUCER_FAITHFUL_OPERATION_ITEMS,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemFaithfulOperations.js';
import { getBundledDnd5eSrdPack } from '../../../src/internal.js';
import { assertMagicItemOperationReady } from '../../../src/state/itemExecutionReadiness.js';
import { deriveItemOperationReadinessInput } from '../../../src/state/itemState.js';

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const pack = getBundledDnd5eSrdPack();
const items = pack.records.filter((record) => record.kind === 'magic-item');
const byName = new Map(items.map((record) => [record.name, record]));

interface Scope {
  readonly label: string;
  readonly description: string;
  readonly mechanics: Obj;
  readonly operations: Obj[];
  readonly readiness: Obj[];
}

function scopesOf(name: string): Scope[] {
  const record = byName.get(name);
  if (record === undefined) throw new Error(`no item ${name}`);
  const data = record.data as Obj;
  const readiness = ((data.executionReadiness as Obj).clauses as Obj[]).filter(
    (entry) => entry.readiness === 'adjudicated-by-design',
  );
  const scopes: Scope[] = [
    {
      label: name,
      description: String(data.description),
      mechanics: (data.mechanics as Obj | undefined) ?? {},
      operations: ((data.mechanics as Obj | undefined)?.operations ??
        []) as Obj[],
      readiness,
    },
  ];
  for (const variant of (data.variants as Obj[] | undefined) ?? []) {
    const mechanics = (variant.mechanics as Obj | undefined) ?? {};
    scopes.push({
      label: `${name}::${String(variant.name)}`,
      description: String(data.description),
      mechanics,
      operations: (mechanics.operations ?? []) as Obj[],
      readiness,
    });
  }
  return scopes;
}

const coveredItemNames = [
  ...new Set([
    ...[...MAGIC_ITEM_FAITHFUL_OPERATION_SPECS.keys()].map(
      (key) => key.split('::')[0] as string,
    ),
    ...MAGIC_ITEM_PRODUCER_FAITHFUL_OPERATION_ITEMS,
  ]),
];

const operation = (name: string, id: string): Obj => {
  const found = scopesOf(name)
    .flatMap((scope) => scope.operations)
    .find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`${name} has no operation ${id}`);
  return found;
};
const activation = (name: string, id: string): Obj | undefined =>
  operation(name, id).activation as Obj | undefined;

describe('typed activation agrees with the printed text (covered items)', () => {
  it('resolves every table key to a real item, variant and operation', () => {
    for (const [key, spec] of MAGIC_ITEM_FAITHFUL_OPERATION_SPECS) {
      const [itemName, variantName] = key.split('::') as [string, string?];
      const scopes = scopesOf(itemName);
      const scope = scopes.find(
        (entry) => entry.label === (variantName === undefined ? itemName : key),
      );
      expect(scope, key).toBeDefined();
      for (const patch of spec.operations ?? [])
        expect(
          scope?.operations.some((entry) => entry.id === patch.operationId),
          `${key} ${patch.operationId}`,
        ).toBe(true);
    }
  });

  it('types a cost, command word or free action only where the text prints it', () => {
    const problems: string[] = [];
    for (const name of coveredItemNames)
      for (const scope of scopesOf(name))
        for (const entry of scope.operations) {
          const typed = entry.activation as Obj | undefined;
          if (typed === undefined) continue;
          const where = `${scope.label} ${String(entry.id)}`;
          const text = scope.description;
          if (typed.cost === 'action' && !/\baction\b/.test(text))
            problems.push(`${where}: action cost not printed`);
          if (typed.cost === 'bonus-action' && !/bonus action/.test(text))
            problems.push(`${where}: bonus-action cost not printed`);
          if (typed.cost === 'reaction' && !/\breaction\b/.test(text))
            problems.push(`${where}: reaction cost not printed`);
          if (typed.cost === 'free' && !/no action required/.test(text))
            problems.push(`${where}: free cost not printed`);
          if (typed.commandWord === true && !/command word/.test(text))
            problems.push(`${where}: command word not printed`);
        }
    expect(problems).toEqual([]);
  });

  it('types every table-set requirement, trigger and target as a verbatim printed span', () => {
    const problems: string[] = [];
    for (const [key, spec] of MAGIC_ITEM_FAITHFUL_OPERATION_SPECS) {
      const [itemName] = key.split('::') as [string];
      const scope = scopesOf(itemName).find(
        (entry) => entry.label === (key.includes('::') ? key : itemName),
      ) as Scope;
      for (const patch of spec.operations ?? []) {
        const typed = scope.operations.find(
          (entry) => entry.id === patch.operationId,
        )?.activation as Obj | undefined;
        for (const field of ['requirement', 'trigger', 'target'] as const) {
          const wanted = patch.activation?.[field];
          if (typeof wanted !== 'string') continue;
          if (typed?.[field] !== wanted)
            problems.push(`${key} ${patch.operationId}.${field} not typed`);
          if (!scope.description.includes(wanted))
            problems.push(`${key} ${patch.operationId}.${field} not verbatim`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('carries every unprinted-cost removal, delivery sentence and grant precondition as a verbatim adjudicated clause', () => {
    for (const [key, spec] of MAGIC_ITEM_FAITHFUL_OPERATION_SPECS) {
      const itemName = key.split('::')[0] as string;
      const scope = scopesOf(itemName)[0] as Scope;
      for (const entry of spec.clauses ?? []) {
        const found = scope.readiness.find(
          (clause) =>
            typeof clause.clauseId === 'string' &&
            clause.clauseId.endsWith(`/${entry.id}`),
        );
        expect(found, `${key} ${entry.id}`).toBeDefined();
        const representation = (found as Obj).representation as Obj;
        expect(representation.adjudicated).toBe(true);
        expect(representation.sourceText).toBe(entry.sourceText);
        expect(scope.description).toContain(entry.sourceText);
      }
      for (const patch of spec.operations ?? []) {
        const dropsCost =
          patch.activation !== undefined &&
          'cost' in patch.activation &&
          patch.activation.cost === null;
        if (!dropsCost && patch.dropEconomyCost !== true) continue;
        expect(
          (spec.clauses ?? []).some(
            (entry) =>
              'operation' in entry.owner &&
              entry.owner.operation === patch.operationId,
          ),
          `${key} ${patch.operationId} drops a cost without a printed-sentence clause`,
        ).toBe(true);
      }
    }
  });
});

describe('table application fails loudly on drift (counterfactuals)', () => {
  const item = {
    name: 'Bowl of Commanding Water Elementals',
    itemType: 'Wondrous item',
    rarity: 'rare',
    requiresAttunement: false,
    sourcePage: 1,
    description: String(
      scopesOf('Bowl of Commanding Water Elementals')[0]?.description,
    ),
  };
  const projection = (
    operationId: string,
  ): Parameters<typeof applyFaithfulMagicItemOperations>[1] => [
    {
      family: 'test',
      mechanics: {
        operations: [{ id: operationId, activation: { cost: 'action' } }],
      },
      clauses: [],
    },
  ];

  it('patches a projected operation with the printed predicate', () => {
    const [patched] = applyFaithfulMagicItemOperations(
      item,
      projection('summon-water-elemental'),
    );
    expect(patched?.mechanics.operations?.[0]?.activation).toEqual({
      cost: 'action',
      commandWord: true,
      requirement: 'While this bowl is filled with water',
    });
  });

  it('rejects a table operation no family projects', () => {
    expect(() =>
      applyFaithfulMagicItemOperations(item, projection('some-other-op')),
    ).toThrow(/is not projected by any family/);
  });

  it('rejects a requirement that is not a verbatim span of the description', () => {
    expect(() =>
      applyFaithfulMagicItemOperations(
        { ...item, description: item.description.replace('filled', 'full') },
        projection('summon-water-elemental'),
      ),
    ).toThrow(/not a verbatim span/);
  });
});

describe('root-cause scenarios: printed-eligible versus ineligible', () => {
  it('does not invent a prerequisite (Dagger of Venom: the action creates the coating)', () => {
    expect(activation('Dagger of Venom', 'coat-blade')).toEqual({
      cost: 'action',
    });
  });

  it('binds a command word only to the stage that prints it', () => {
    // Animated Shield: speaking animates; ending needs only a bonus action.
    expect(activation('Animated Shield', 'speak-command-word')).toMatchObject({
      commandWord: true,
      requirement: 'While holding this shield',
    });
    expect(activation('Animated Shield', 'end-animation')).toEqual({
      cost: 'bonus-action',
    });
    // Staff of the Woodlands: only RETURNING speaks the word; planting needs
    // fertile earth.
    expect(activation('Staff of the Woodlands', 'tree-form')).toEqual({
      cost: 'action',
      requirement: 'plant one end of the staff in fertile earth',
    });
    expect(
      activation('Staff of the Woodlands', 'return-from-tree')?.commandWord,
    ).toBe(true);
  });

  it('never defaults an activation cost the text does not print', () => {
    for (const [name, id] of [
      ['Broom of Flying', 'send-broom'],
      ['Broom of Flying', 'recall-broom'],
      ['Carpet of Flying', 'end-flight'],
      ['Rope of Climbing', 'knot-rope'],
      ['Sword of Sharpness', 'end-light'],
      ['Boots of Speed', 'deactivate-speed'],
      ['Apparatus of the Crab', 'set-lever-4'],
      ['Candle of Invocation', 'm9-cast-candle-spell'],
      ['Cloak of the Bat', 'end-polymorph'],
    ] as const)
      expect(
        activation(name, id)?.cost,
        `${name} ${id} must not type a cost`,
      ).toBeUndefined();
  });

  it('carries a printed holding / wearing / on-your-person predicate', () => {
    for (const [name, id, phrase] of [
      ['Rod of Alertness', 'cast-detect-magic', 'While holding the rod'],
      ['Gem of Brightness', 'shed-light', 'While you are holding it'],
      ['Pearl of Power', 'regain-spell-slot', 'on your person'],
      ['Wand of Secrets', 'detect-secret', 'While holding it'],
      ['Ring of X-ray Vision', 'activate-x-ray-vision', 'While wearing'],
      ['Cloak of the Bat', 'cast-polymorph', 'dim light or darkness'],
    ] as const)
      expect(
        String(activation(name, id)?.requirement),
        `${name} ${id}`,
      ).toContain(phrase);
  });

  it('carries the printed target, range and sight of a delivered activation', () => {
    expect(
      String(activation('Iron Bands of Binding', 'throw-bands')?.target),
    ).toBe('a Huge or smaller creature you can see within 60 feet of you');
    expect(
      String(activation('Ring of ' + 'the Ram', 'break-object')?.target),
    ).toContain('isn’t being worn or carried');
    expect(
      String(activation('Talisman of Pure Good', 'open-fissure')?.target),
    ).toContain('on the ground within 120 feet');
    expect(
      String(activation('Ring of Djinni Summoning', 'summon-djinni')?.target),
    ).toContain('unoccupied space you choose within 120 feet');
  });

  it('binds a printed trigger to the melee hit, not the action economy', () => {
    for (const id of ['lightning', 'thunder'])
      expect(activation('Staff of Thunder and Lightning', id)).toEqual({
        trigger: 'When you hit with a melee attack using the staff',
      });
    for (const id of ['drain-life', 'paralyze'])
      expect(activation('Rod of Lordly Might', id)).toEqual({
        trigger: 'When you hit a creature with a melee attack using the rod',
      });
    expect(activation('Frost Brand', 'extinguish-flames')?.trigger).toBe(
      'When you draw this weapon',
    );
  });

  it('commits the Nine Lives Stealer charge only on the printed outcome (not unconditionally)', () => {
    const slay = operation('Nine Lives Stealer', 'slay-on-critical');
    expect(slay.cost).toBeUndefined();
    expect(slay.activation).toEqual({
      trigger:
        'If you score a critical hit against a creature that has fewer than 100 hit points',
    });
  });

  it('prints Glamoured Studded Leather as a bonus action with no invented restore operation', () => {
    expect(activation('Glamoured Studded Leather', 'set-appearance')).toEqual({
      cost: 'bonus-action',
      commandWord: true,
    });
    const record = byName.get('Glamoured Studded Leather') as {
      data: { mechanics: Obj };
    };
    const operations = record.data.mechanics.operations as Obj[];
    expect(operations.map((entry) => entry.id)).toEqual(['set-appearance']);
    const transitions = (record.data.mechanics.stateMachine as Obj)
      .transitions as Obj[];
    for (const transition of transitions)
      if (transition.via !== undefined)
        expect(transition.via).toBe('set-appearance');
  });
});

describe('runtime safety: what use_item can execute is unchanged', () => {
  // These operations pass the readiness preflight at the pre-repair head and
  // must still pass (the preflight and use_item read only operation ids, cost,
  // excludes, doesNotExpend and effects, never `activation`).
  it.each([
    ['Ring of Shooting Stars', undefined, 'discharge-ball-lightning'],
    ['Rope of Entanglement', undefined, 'escape-rope'],
    ['Boots of Levitation', undefined, 'cast-levitate'],
  ] as const)('%s %s %s stays ready', (name, variant, operationId) => {
    const record = byName.get(name);
    expect(record).toBeDefined();
    const input = deriveItemOperationReadinessInput(
      record as NonNullable<typeof record>,
      variant,
      operationId,
    );
    expect(() =>
      assertMagicItemOperationReady(
        record as NonNullable<typeof record>,
        variant,
        input,
      ),
    ).not.toThrow();
  });

  it('keeps every operation economy cost except the Nine Lives Stealer outcome-only charge', () => {
    for (const [name, id] of [
      ['Dagger of Venom', 'coat-blade'],
      ['Wand of Binding', 'assisted-escape'],
      ['Ring of the Ram', 'break-object'],
      ['Ring of Shooting Stars', 'create-ball-lightning'],
      ['Pipes of the Sewers', 'call-rat-swarms'],
    ] as const)
      expect(operation(name, id).cost, `${name} ${id}`).toBeDefined();
  });

  it('declares no operation whose activation object is empty', () => {
    for (const record of items)
      for (const scope of scopesOf(record.name))
        for (const entry of scope.operations)
          if (isObj(entry.activation))
            expect(
              Object.keys(entry.activation).length,
              `${scope.label} ${String(entry.id)}`,
            ).toBeGreaterThan(0);
  });
});
