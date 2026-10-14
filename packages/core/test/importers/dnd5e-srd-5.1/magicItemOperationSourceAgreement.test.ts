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
 * capability or completeness claim. Kept activation costs are checked against
 * the reviewed 359-operation census; typed free-text fields (requirement /
 * trigger / target) set by the reviewed table are strictly stronger because the
 * compiler requires each to be a verbatim span of the description. The scenario
 * tests below pin one printed-eligible versus ineligible predicate per root
 * cause rather than one reproducer per item.
 *
 * Scope: eshyra-o9bd.19.4.6.1 reviewed the S2/S3 members; eshyra-o9bd.19.4.6.2
 * extends the lexical cost/word screen and the verbatim requirement / trigger /
 * target check to EVERY operation of EVERY magic item and variant (the
 * whole-corpus screen below), and covers the state-graph, grant, economy,
 * procedure and containment members of groups S4, S5, S6 and S1.16-S1.18.
 */
import { describe, expect, it } from 'vitest';
import { MAGIC_ITEM_FAITHFUL_LIFECYCLE_ITEMS } from '../../../scripts/importers/dnd5e-srd-5.1/magicItemFaithfulLifecycles.js';
import {
  applyFaithfulMagicItemOperations,
  MAGIC_ITEM_FAITHFUL_OPERATION_SPECS,
  MAGIC_ITEM_PRODUCER_FAITHFUL_OPERATION_ITEMS,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemFaithfulOperations.js';
import { DRINK_SENTENCES } from '../../../scripts/importers/dnd5e-srd-5.1/magicItemFaithfulOperationsCorpus.js';
import { getBundledDnd5eSrdPack } from '../../../src/internal.js';
import { magicItemVariantDefinitions } from '../../../src/rules/magicItemVariants.js';
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

/**
 * Every adjudicated-by-design printed span an item carries (parent and
 * variants share the item's clauses). After eshyra-o9bd.19.4.6.6 the free-text
 * activation, graph, grant, containment, spell-store and roll-manipulation
 * claims are absent from the typed pack; the printed sentence is the claim.
 */
const spansOfItem = (name: string): string[] =>
  (scopesOf(name)[0]?.readiness ?? []).map((entry) =>
    String((entry.representation as Obj).sourceText ?? ''),
  );
const carries = (name: string, printed: string): boolean =>
  spansOfItem(name).some((span) => span.includes(printed));

describe('typed activation agrees with the printed text (covered items)', () => {
  it('preserves the governing spans for every early-null actor/delivery activation', () => {
    const governing = new Map([
      [
        'Armor of Invulnerability',
        'Additionally, you can use an action to make yourself immune to nonmagical damage for 10 minutes or until you are no longer wearing the armor.',
      ],
      ...Object.entries(DRINK_SENTENCES),
    ]);
    expect(governing).toHaveLength(18);
    for (const [name, sentence] of governing) {
      const activation = operation(
        name,
        name === 'Armor of Invulnerability' ? 'activate-immunity' : 'drink',
      ).activation as Obj | undefined;
      expect(activation?.requirement, name).toBeUndefined();
      expect(activation?.target, name).toBeUndefined();
      expect(scopesOf(name)[0]?.description).toContain(sentence);
      expect(
        carries(name, sentence),
        `${name} governing early-null sentence`,
      ).toBe(true);
    }
  });

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

  it('types a cost, command word or free action only where the text prints it (table items)', () => {
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

  it('carries every table-set requirement, trigger and target as an adjudicated verbatim span, never as a typed field', () => {
    // eshyra-o9bd.19.4.6.6: the free-text activation fields are DM-adjudicated.
    // The source-fidelity claim the 19.4.6.1 table made (each fragment is a
    // verbatim printed span) is preserved: the fragment is still printed in
    // the item's adjudicated clauses, now whole-sentence.
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
          if (typed?.[field] !== undefined)
            problems.push(`${key} ${patch.operationId}.${field} still typed`);
          if (!scope.description.includes(wanted))
            problems.push(`${key} ${patch.operationId}.${field} not verbatim`);
          if (!carries(itemName, wanted))
            problems.push(
              `${key} ${patch.operationId}.${field} not carried by an adjudicated span`,
            );
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
        const dropsPredicate =
          patch.activation !== undefined &&
          `${key}/${patch.operationId}` !== 'Dagger of Venom/coat-blade' &&
          (['requirement', 'trigger', 'target'] as const).some(
            (field) => patch.activation?.[field] === null,
          );
        if (!dropsCost && !dropsPredicate && patch.dropEconomyCost !== true)
          continue;
        if (dropsCost || patch.dropEconomyCost === true)
          expect(
            (spec.clauses ?? []).some(
              (entry) =>
                'operation' in entry.owner &&
                entry.owner.operation === patch.operationId,
            ),
            `${key} ${patch.operationId} drops a cost without a printed-sentence clause`,
          ).toBe(true);
        if (dropsPredicate) {
          const itemName = key.split('::')[0] as string;
          expect(
            spansOfItem(itemName).some((span) =>
              scope.description.includes(span),
            ),
            `${key} ${patch.operationId} dropped an activation predicate without retaining an adjudicated source span`,
          ).toBe(true);
        }
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
    expect(activation('Animated Shield', 'speak-command-word')).toEqual({
      cost: 'bonus-action',
      commandWord: true,
      equipment: [['held']],
    });
    expect(activation('Animated Shield', 'end-animation')).toEqual({
      cost: 'bonus-action',
    });
    // Staff of the Woodlands: only RETURNING speaks the word; planting needs
    // fertile earth (adjudicated, not a typed requirement).
    expect(activation('Staff of the Woodlands', 'tree-form')).toEqual({
      cost: 'action',
    });
    expect(
      carries(
        'Staff of the Woodlands',
        'plant one end of the staff in fertile earth',
      ),
    ).toBe(true);
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

  it('types the printed worn / held / attuned / on-person prerequisite as structured equipment and keeps every other conjunct adjudicated', () => {
    for (const [name, id, equipment] of [
      ['Rod of Alertness', 'cast-detect-magic', [['held']]],
      ['Gem of Brightness', 'shed-light', [['held']]],
      ['Pearl of Power', 'regain-spell-slot', [['on-person']]],
      ['Wand of Secrets', 'detect-secret', [['held']]],
      ['Ring of X-ray Vision', 'activate-x-ray-vision', [['worn']]],
      ['Cloak of the Bat', 'cast-polymorph', [['worn']]],
      ['Helm of Brilliance', 'ignite-weapon', [['worn']]],
      ['Hammer of Thunderbolts', 'hurl-thunderclap', [['attuned']]],
      ['Hammer of Thunderbolts', 'giant-slaying-critical', [['attuned']]],
    ] as const)
      expect(activation(name, id)?.equipment, `${name} ${id}`).toEqual(
        equipment,
      );
    // The remaining conjuncts are printed spans, not typed predicates.
    expect(carries('Cloak of the Bat', 'dim light or darkness')).toBe(true);
    expect(
      carries(
        'Helm of Brilliance',
        'one weapon you are holding to burst into flames',
      ),
    ).toBe(true);
    expect(
      carries('Hammer of Thunderbolts', 'Giant’s Bane (Requires Attunement)'),
    ).toBe(true);
    // "wearing or holding it" is an alternative: two equipment alternatives,
    // never a conjunction; the printed sentence is still carried.
    expect(
      activation('Talisman of Pure Good', 'open-fissure')?.equipment,
    ).toEqual([['worn'], ['held']]);
    expect(
      activation('Talisman of Ultimate Evil', 'open-fissure')?.equipment,
    ).toEqual([['worn'], ['held']]);
    expect(
      carries('Talisman of Pure Good', 'If you are wearing or holding it'),
    ).toBe(true);
  });

  it('carries the printed target, range and sight of a delivered activation as adjudicated spans', () => {
    for (const [name, id, printed] of [
      [
        'Iron Bands of Binding',
        'throw-bands',
        'a Huge or smaller creature you can see within 60 feet of you',
      ],
      ['Ring of the Ram', 'break-object', 'isn’t being worn or carried'],
      [
        'Talisman of Pure Good',
        'open-fissure',
        'on the ground within 120 feet',
      ],
      [
        'Ring of Djinni Summoning',
        'summon-djinni',
        'unoccupied space you choose within 120 feet',
      ],
    ] as const) {
      expect(activation(name, id)?.target, `${name} ${id}`).toBeUndefined();
      expect(carries(name, printed), `${name} ${id}`).toBe(true);
    }
  });

  it('carries a printed trigger as an adjudicated span, with no action economy invented', () => {
    for (const [name, id, printed] of [
      [
        'Staff of Thunder and Lightning',
        'lightning',
        'When you hit with a melee attack using the staff',
      ],
      [
        'Staff of Thunder and Lightning',
        'thunder',
        'When you hit with a melee attack using the staff',
      ],
      [
        'Rod of Lordly Might',
        'drain-life',
        'When you hit a creature with a melee attack using the rod',
      ],
      [
        'Rod of Lordly Might',
        'paralyze',
        'When you hit a creature with a melee attack using the rod',
      ],
      ['Frost Brand', 'extinguish-flames', 'When you draw this weapon'],
    ] as const) {
      expect(activation(name, id), `${name} ${id}`).toBeUndefined();
      expect(carries(name, printed), `${name} ${id}`).toBe(true);
    }
  });

  it('commits the Nine Lives Stealer charge only on the printed outcome (not unconditionally)', () => {
    const slay = operation('Nine Lives Stealer', 'slay-on-critical');
    expect(slay.cost).toBeUndefined();
    expect(slay.activation).toBeUndefined();
    expect(
      carries(
        'Nine Lives Stealer',
        'If you score a critical hit against a creature that has fewer than 100 hit points',
      ),
    ).toBe(true);
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
  it.each([['Boots of Levitation', undefined, 'cast-levitate']] as const)(
    '%s %s %s stays ready',
    (name, variant, operationId) => {
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
    },
  );

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

// ---------------------------------------------------------------------------
// Whole-corpus operations screen (eshyra-o9bd.19.4.6.2, part E)
// ---------------------------------------------------------------------------

/** Every operation of every magic item, parent and variant scope. */
function allOperations(): {
  readonly where: string;
  readonly description: string;
  readonly operation: Obj;
}[] {
  return items.flatMap((record) =>
    scopesOf(record.name).flatMap((scope) =>
      scope.operations.map((operation) => ({
        where: `${scope.label} ${String(operation.id)}`,
        description: scope.description,
        operation,
      })),
    ),
  );
}

const boundaryMatch = (description: string, text: string): boolean =>
  new RegExp(
    `(?<![A-Za-z0-9])${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`,
  ).test(description);

describe('whole-corpus operations screen (every magic-item operation)', () => {
  const everyOperation = allOperations();

  it('screens the complete operation census, not a table subset', () => {
    // Independent count straight from the pack JSON (parent plus variants).
    let expected = 0;
    for (const record of items) {
      const data = record.data as Obj;
      expected += (
        ((data.mechanics as Obj | undefined)?.operations ?? []) as unknown[]
      ).length;
      for (const variant of (data.variants as Obj[] | undefined) ?? [])
        expected += (
          ((variant.mechanics as Obj | undefined)?.operations ??
            []) as unknown[]
        ).length;
    }
    expect(everyOperation).toHaveLength(expected);
    expect(everyOperation.length).toBeGreaterThan(300);
  });

  it('types a cost, free action or command word only where the item prints it', () => {
    const problems: string[] = [];
    for (const { where, description, operation } of everyOperation) {
      const typed = operation.activation as Obj | undefined;
      if (typed === undefined) continue;
      if (typed.cost === 'action' && !/\baction\b/.test(description))
        problems.push(`${where}: action cost not printed`);
      if (typed.cost === 'bonus-action' && !/bonus action/.test(description))
        problems.push(`${where}: bonus-action cost not printed`);
      if (typed.cost === 'reaction' && !/\breaction\b/.test(description))
        problems.push(`${where}: reaction cost not printed`);
      if (typed.cost === 'free' && !/no action required/.test(description))
        problems.push(`${where}: free cost not printed`);
      if (typed.commandWord === true && !/command word/.test(description))
        problems.push(`${where}: command word not printed`);
    }
    expect(problems).toEqual([]);
  });

  it('types every requirement, trigger and target as a whole-word verbatim printed span', () => {
    const problems: string[] = [];
    for (const { where, description, operation } of everyOperation) {
      const typed = operation.activation as Obj | undefined;
      if (typed === undefined) continue;
      for (const field of ['requirement', 'trigger', 'target'] as const) {
        const value = typed[field];
        if (value === undefined) continue;
        if (typeof value !== 'string' || !boundaryMatch(description, value))
          problems.push(`${where}.${field} ${JSON.stringify(value)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('keeps the screen able to fail (counterfactual: a paraphrase and an unprinted cost are caught)', () => {
    expect(
      boundaryMatch('you can use your reaction', 'wearer fails a save'),
    ).toBe(false);
    // "self" is a substring of "yourself" but not a printed target.
    expect(boundaryMatch('make yourself immune', 'self')).toBe(false);
    expect(boundaryMatch('make yourself immune', 'make yourself immune')).toBe(
      true,
    );
  });

  it('carries BOTH printed Ring of Elemental Command gates on the post-slay casts as adjudicated spans: the linked-plane variant and the help-slay prerequisite', () => {
    const planes = ['Air', 'Earth', 'Fire', 'Water'] as const;
    for (const plane of planes) {
      const slay = new RegExp(
        `If you help slay an? ${plane.toLowerCase()} elemental while attuned to the ring`,
      );
      expect(
        spansOfItem('Ring of Elemental Command').some((span) =>
          slay.test(span),
        ),
        plane,
      ).toBe(true);
      expect(
        carries(
          'Ring of Elemental Command',
          `Ring of ${plane} Elemental Command`,
        ),
        plane,
      ).toBe(true);
    }
    // No cast types a predicate: a fire-linked ring that helped slay an AIR
    // elemental is decided by the printed gates, not by a typed field.
    for (const operation of scopesOf('Ring of Elemental Command')[0]
      ?.operations ?? [])
      if (String(operation.id).startsWith('cast-'))
        expect(operation.activation, String(operation.id)).toBeUndefined();
  });

  it('types only the printed action cost, command word and equipment of previously paraphrased activations', () => {
    expect(activation('Gem of Brightness', 'blinding-beam')).toEqual({
      cost: 'action',
      commandWord: true,
      equipment: [['held']],
    });
    expect(
      carries(
        'Gem of Brightness',
        'one creature you can see within 60 feet of you',
      ),
    ).toBe(true);
    expect(activation('Ring of Shooting Stars', 'cast-light')).toEqual({
      cost: 'action',
      equipment: [['worn']],
    });
    expect(carries('Ring of Shooting Stars', 'in dim light or darkness')).toBe(
      true,
    );
    expect(activation('Ring of Shooting Stars', 'cast-faerie-fire')).toEqual({
      cost: 'action',
    });
    expect(activation('Armor of Invulnerability', 'activate-immunity')).toEqual(
      { cost: 'action' },
    );
  });

  it('keeps Ring of Shooting Stars sphere discharge as an adjudicated external trigger', () => {
    const operations = mechanicsOf('Ring of Shooting Stars').operations ?? [];
    expect(
      operations.some((entry) => entry.id === 'discharge-ball-lightning'),
    ).toBe(false);
    expect(
      operations.some((entry) => entry.id === 'create-ball-lightning'),
    ).toBe(true);
    expect(
      carries(
        'Ring of Shooting Stars',
        'When a creature other than you comes within 5 feet of a sphere, the sphere discharges lightning at that creature and disappears.',
      ),
    ).toBe(true);
  });

  it('removes a free or action cost the text does not print and carries the sentence as an adjudicated clause', () => {
    for (const [name, id] of [
      ['Javelin of Lightning', 'hurl-lightning'],
      ['Dwarven Thrower', 'throw-weapon'],
      ['Marvelous Pigments', 'paint-object'],
      ['Ring of Elemental Command', 'cast-chain-lightning'],
      ['Staff of Power', 'power-strike'],
      ['Ring of Spell Storing', 'm9-cast-ring-spell'],
      ['Sphere of Annihilation', 'sphere-space-entry'],
      ['Sword of Wounding', 'm7-apply-wound'],
      ['Oathbow', 'm7-swear-enemy'],
    ] as const) {
      expect(activation(name, id)?.cost, `${name} ${id}`).toBeUndefined();
      const scope = scopesOf(name)[0] as Scope;
      expect(
        scope.readiness.some(
          (entry) =>
            typeof entry.clauseId === 'string' &&
            entry.clauseId.endsWith(`/activation-${id}`),
        ),
        `${name} ${id} has an adjudicated activation clause`,
      ).toBe(true);
    }
    // Printed "(no action required)" keeps its free cost.
    expect(activation('Luck Blade', 'm10-use-luck')?.cost).toBe('free');
  });
});

describe('Feather Token whip payload states its printed attack kind and range', () => {
  it('is a melee spell attack against a creature within 10 feet of the whip', () => {
    const payload = (
      (mechanicsOf('Feather Token').effects as Obj[]).find(
        (entry) => entry.id === 'token-kind-payload',
      ) as Obj
    ).variants as Obj;
    const whip = payload.whip as Obj;
    expect(whip.attackKind).toBe('melee-spell-attack');
    expect(descriptionOf('Feather Token')).toContain(String(whip.target));
  });
});

describe('Cloak of the Bat ending cites the governing passage truthfully', () => {
  it('names the inherited polymorph spell rule and the only printed passage that casts it', () => {
    const cloak = scopesOf('Cloak of the Bat')[0] as Scope;
    const found = cloak.readiness.find(
      (entry) =>
        typeof entry.clauseId === 'string' &&
        entry.clauseId.endsWith('/activation-end-polymorph'),
    ) as Obj;
    const representation = found.representation as Obj;
    expect(cloak.description).toContain(String(representation.sourceText));
    expect(representation.sourceText).toContain('cast polymorph on yourself');
    expect(String(representation.note)).toContain('spell:polymorph');
    expect(String(representation.note)).toMatch(/prints no ending of its own/);
  });
});

// ---------------------------------------------------------------------------
// S4 / S5 / S6 / S1.16-S1.18 (eshyra-o9bd.19.4.6.2)
// ---------------------------------------------------------------------------

const dataOf = (name: string): Obj => {
  const record = byName.get(name);
  if (record === undefined) throw new Error(`no item ${name}`);
  return record.data as Obj;
};
const mechanicsOf = (name: string): Obj => dataOf(name).mechanics as Obj;
const descriptionOf = (name: string): string =>
  String(dataOf(name).description);
const machineOf = (name: string): Obj => mechanicsOf(name).stateMachine as Obj;
const transitionsOf = (name: string): Obj[] =>
  machineOf(name).transitions as Obj[];
const grantOf = (name: string, id: string): Obj => {
  const found = ((mechanicsOf(name).entityGrant as Obj).grants as Obj[]).find(
    (entry) => entry.id === id,
  );
  if (found === undefined) throw new Error(`${name} has no grant ${id}`);
  return found;
};
const clauseText = (name: string, suffix: string): string => {
  const found = scopesOf(name)[0]?.readiness.find(
    (entry) =>
      typeof entry.clauseId === 'string' && entry.clauseId.endsWith(suffix),
  ) as Obj | undefined;
  if (found === undefined) throw new Error(`${name} has no clause ${suffix}`);
  return String((found.representation as Obj).sourceText);
};

describe('state graphs state the printed transition, timer and termination (S4)', () => {
  // Machines that stay typed (simple toggles with a printed duration or
  // termination, plus the machines the green operations bind to); every other
  // reviewed machine is withheld and tested as such below.
  const GRAPH_ITEMS = ['Dagger of Venom', 'Ioun Stone'] as const;

  it('every reviewed machine quotes its conditions and termination from the printed description', () => {
    const problems: string[] = [];
    for (const name of GRAPH_ITEMS) {
      const description = descriptionOf(name);
      const machine = machineOf(name);
      if (typeof machine.termination === 'string')
        if (!description.includes(machine.termination))
          problems.push(`${name} termination`);
      for (const entry of transitionsOf(name)) {
        for (const field of ['condition', 'note'] as const) {
          const value = entry[field];
          if (typeof value === 'string' && !description.includes(value))
            problems.push(
              `${name} ${String(entry.from)}->${String(entry.to)} ${field}`,
            );
        }
      }
    }
    expect(problems).toEqual([]);
    expect(MAGIC_ITEM_FAITHFUL_LIFECYCLE_ITEMS).toEqual(
      expect.arrayContaining([...GRAPH_ITEMS]),
    );
  });

  it('Dagger of Venom: the coating ends when an attack hits A CREATURE, not any hit', () => {
    const conditions = transitionsOf('Dagger of Venom')
      .map((entry) => entry.condition)
      .filter((value) => value !== undefined);
    expect(conditions).toEqual(['an attack using this weapon hits a creature']);
  });

  it('Staff of Swarming Insects: every use creates its own cloud, so no item-wide machine is typed; wind ends it, no dismissal command, no 20-foot movement cutoff (review 19.4.6.7 S2)', () => {
    const mechanics = mechanicsOf('Staff of Swarming Insects');
    expect(mechanics.stateMachine).toBeUndefined();
    expect(
      (mechanics.operations as Obj[]).map((entry) => entry.id),
    ).not.toContain('dismiss-insect-cloud');
    // The printed ten-minute duration lives on the effect, for the item
    // duration capability (eshyra-olc5.11) to bind start_effect to.
    const cloud = (mechanics.effects as Obj[]).find(
      (entry) => entry.id === 'c2-create-insect-cloud-payload',
    );
    expect(cloud?.duration).toEqual({ amount: 10, unit: 'minute' });
    expect(cloud?.endsOn).toEqual(['wind-of-at-least-10-miles-per-hour']);
    expect(
      operation('Staff of Swarming Insects', 'create-insect-cloud').effects,
    ).toEqual(['c2-create-insect-cloud-payload']);
    expect(
      carries(
        'Staff of Swarming Insects',
        'A wind of at least 10 miles per hour disperses the swarm and ends the effect',
      ),
    ).toBe(true);
    expect(JSON.stringify(mechanics)).not.toMatch(/20 feet|10-foot clear/);
  });

  it('Cloak of Displacement: independent suppression lifetimes are withheld, not merged', () => {
    const mechanics = mechanicsOf('Cloak of Displacement');
    expect(mechanics.stateMachine).toBeUndefined();
    expect(
      ((mechanics.operations ?? []) as Obj[]).map((entry) => entry.id),
    ).toEqual([]);
    const text = clauseText(
      'Cloak of Displacement',
      '/m5-cloak-of-displacement',
    );
    expect(text).toContain('until the start of your next turn');
    expect(text).toContain(
      'incapacitated, restrained, or otherwise unable to move',
    );
  });

  it.each([
    [
      'Dancing Sword',
      [
        'After the hovering sword attacks for the fourth time',
        'It also ceases to hover if you grasp it or move more than 30 feet away from it',
      ],
    ],
    [
      'Decanter of Endless Water',
      ['The water stops pouring out at the start of your next turn'],
    ],
    ['Broom of Flying', ['The broom stops hovering when you land']],
    [
      'Eversmoking Bottle',
      [
        'Once the bottle is closed, the cloud disperses after 10 minutes',
        'Each minute the bottle remains open and within the cloud',
      ],
    ],
    [
      'Rope of Climbing',
      ['As a bonus action, you can command the other end to move'],
    ],
    [
      'Instant Fortress',
      [
        'Each casting of wish causes the roof, the door, or one wall to regain 50 hit points.',
      ],
    ],
    [
      'Apparatus of the Crab',
      [
        'After each use, a lever goes back to its neutral position',
        'A creature in the compartment can use an action to move as many as two',
      ],
    ],
  ] as const)(
    '%s: complex state topology is DM-adjudicated; the printed sentences are verbatim spans and the operations stay declared',
    (name, printed) => {
      expect(mechanicsOf(name).stateMachine).toBeUndefined();
      for (const sentence of printed)
        expect(carries(name, sentence), sentence).toBe(true);
      // A withheld machine must not free its operations: each stays declared
      // and keeps a blocking operation clause (see the readiness set below).
      const ids = (mechanicsOf(name).operations as Obj[]).map((e) => e.id);
      expect(ids.length).toBeGreaterThan(0);
      // Operations the printed text does not define stay absent (no stop
      // command for the decanter, no dismount for the broom).
      expect(ids).not.toContain('stop-water');
      expect(ids).not.toContain('dismount-broom');
    },
  );

  it('Ioun Stone: seizure accepts either printed check as an external condition', () => {
    const seize = transitionsOf('Ioun Stone').find(
      (entry) => entry.to === 'seized',
    );
    expect(seize?.condition).toContain('successful attack roll against AC 24');
    expect(seize?.condition).toContain('DC 24 Dexterity (Acrobatics) check');
    expect(
      (mechanicsOf('Ioun Stone').operations ?? []).some(
        (entry) => entry.id === 'grab-orbiting-stone',
      ),
    ).toBe(false);
  });

  it('Glamoured Studded Leather: re-using the property changes the appearance; removing the armor ends it', () => {
    const transitions = transitionsOf('Glamoured Studded Leather');
    expect(
      transitions.some(
        (entry) =>
          entry.from === 'active' &&
          entry.to === 'active' &&
          entry.via === 'set-appearance',
      ),
    ).toBe(true);
    expect(
      transitions.find((entry) => entry.condition !== undefined)?.condition,
    ).toBe('remove the armor');
  });
});

describe('entity grants state the printed lifecycle and control (S5)', () => {
  it.each([
    ['Bowl of Commanding Water Elementals', 'water-elemental'],
    ['Brazier of Commanding Fire Elementals', 'fire-elemental'],
    ['Censer of Controlling Air Elementals', 'air-elemental'],
    ['Stone of Controlling Earth Elementals', 'earth-elemental'],
    ['Elemental Gem', 'gem-elemental'],
  ] as const)(
    '%s never reverts on concentration-ended (conjure elemental: concentration broken does not end the elemental)',
    (name, grantId) => {
      const grant = grantOf(name, grantId);
      expect(grant.revertOn).toEqual([
        'reduced-to-0-hit-points',
        'one-hour-ended',
      ]);
      // The concentration exception is the inherited spell lifecycle, which
      // the grant points at rather than paraphrases.
      expect(grant.control).toBe('as spell:conjure-elemental');
      expect(grant.note).toBeUndefined();
      expect(grant.exclusiveInstance).toBeUndefined();
      expect(
        carries(name, 'as if you had cast the conjure elemental spell'),
      ).toBe(true);
    },
  );

  it('conjure elemental itself (the inherited rule) keeps the concentration exception', () => {
    const spell = pack.records.find(
      (record) => record.key === 'spell:conjure-elemental',
    );
    if (spell === undefined) throw new Error('no conjure elemental spell');
    expect(String((spell.data as Obj).description)).toContain(
      'If your concentration is broken, the elemental doesn’t disappear.',
    );
  });

  it('no item grant that casts "as spell:conjure-elemental" reverts on concentration-ended', () => {
    for (const record of items) {
      const grants = (
        ((record.data as Obj).mechanics as Obj | undefined)?.entityGrant as
          | Obj
          | undefined
      )?.grants as Obj[] | undefined;
      for (const grant of grants ?? [])
        if (String(grant.control).includes('spell:conjure-elemental'))
          expect(
            grant.revertOn,
            `${record.name} ${String(grant.id)}`,
          ).not.toContain('concentration-ended');
    }
  });

  it('Obsidian Steed reverts on an OBEYED command only (it may ignore orders, including to revert)', () => {
    expect(
      grantOf('Figurine of Wondrous Power', 'obsidian-steed').revertOn,
    ).toEqual([
      'duration-ended',
      'reduced-to-0-hit-points',
      'obeyed-owner-command-while-touching',
    ]);
    // The other figurines keep the unconditional printed command reversion.
    expect(
      grantOf('Figurine of Wondrous Power', 'onyx-dog').revertOn,
    ).toContain('owner-command-while-touching');
  });

  it('Golden Lions: one or both figurines, independent availability, no unconditional pair and no dismissal', () => {
    const lions = grantOf('Figurine of Wondrous Power', 'golden-lions');
    expect(lions.count).toBe(1);
    expect(lions.exclusiveInstance).toBeUndefined();
    expect(lions.note).toBeUndefined();
    expect(
      carries(
        'Figurine of Wondrous Power',
        'You can use one figurine or both simultaneously',
      ),
    ).toBe(true);
  });

  it('Pipes of the Sewers: the whole conditional control (contest winner, uncontrolled swarm, deaf start of turn) is adjudicated printed text, not a typed policy', () => {
    const grant = grantOf('Pipes of the Sewers', 'called-rat-swarms');
    expect(grant.control).toBeUndefined();
    expect(grant.exclusiveInstance).toBeUndefined();
    for (const printed of [
      'If you lose the contest, the swarm behaves as it normally would',
      'If you win the contest, the swarm is swayed by the pipes’ music',
      'isn’t under another creature’s control',
      'If a friendly swarm starts its turn and can’t hear the pipes’ music, your control over that swarm ends',
    ])
      expect(carries('Pipes of the Sewers', printed), printed).toBe(true);
  });

  it('Manual of Golems: the eligibility gate and the animating ashes are printed preconditions, not a supplied grant', () => {
    const golem = grantOf('Manual of Golems', 'created-golem');
    expect(golem.note).toBeUndefined();
    expect(golem.control).toBeUndefined();
    expect(
      carries(
        'Manual of Golems',
        'The golem becomes animate when the ashes of the manual are sprinkled on it',
      ),
    ).toBe(true);
    expect(
      clauseText('Manual of Golems', '/grant-manual-of-golems-eligibility'),
    ).toContain('at least two 5th-level spell slots');
    const creation = clauseText(
      'Manual of Golems',
      '/grant-manual-of-golems-creation',
    );
    expect(creation).toContain('resting no more than 8 hours per day');
    expect(creation).toContain('sprinkled on it');
  });

  it('Orb of Dragonkind: the call creates no entity reference, so no grant is typed; its cooldown sentence is adjudicated', () => {
    expect(mechanicsOf('Orb of Dragonkind').entityGrant).toBeUndefined();
    expect(
      carries(
        'Orb of Dragonkind',
        'Once you have used this property, it can’t be used again for 1 hour.',
      ),
    ).toBe(true);
    expect(
      clauseText('Orb of Dragonkind', '/grant-orb-of-dragonkind-call-cooldown'),
    ).toBe(
      'Once you have used this property, it can’t be used again for 1 hour.',
    );
  });

  it.each(['Staff of Power', 'Staff of the Magi'])(
    '%s: every other creature saves regardless of the breaker’s escape',
    (name) => {
      const procedure = (
        ((mechanicsOf(name).randomProcedure as Obj).procedures as Obj[]).find(
          (entry) => entry.id === 'retributive-escape',
        ) as Obj
      ).outcome as string;
      expect(descriptionOf(name)).toContain(procedure);
      expect(procedure).toContain(
        'avoiding the explosion. If you fail to avoid the effect',
      );
      expect(procedure).toContain(
        'Every other creature in the area must make a DC 17 Dexterity saving throw',
      );
    },
  );

  it('Goat of Terror aura stays withheld (reversion cutoff, repeat save, 24-hour immunity)', () => {
    const scope = scopesOf('Figurine of Wondrous Power')[0] as Scope;
    expect(
      scope.readiness.some(
        (entry) =>
          typeof entry.clauseId === 'string' &&
          entry.clauseId.endsWith('/c2-residual-goat-terror-aura'),
      ),
    ).toBe(true);
  });
});

describe('economies and composition (S6)', () => {
  it('Luck Blade: wish costs a charge AND the once-per-dawn gate; the luck pool stays separate', () => {
    const economies = mechanicsOf('Luck Blade').economies as Obj;
    expect(economies.wish).toMatchObject({
      kind: 'per-day',
      perDay: { uses: 1 },
      reset: [{ at: 'dawn', amount: 'all' }],
    });
    expect(operation('Luck Blade', 'cast-wish').cost).toEqual([
      { economy: 'charges', amount: 1 },
      { economy: 'wish', amount: 1 },
    ]);
    expect(operation('Luck Blade', 'm10-use-luck').cost).toEqual([
      { economy: 'luck', amount: 1 },
    ]);
  });

  it('Rod of Alertness: one aura identity owns the action, the daily use and the state transition', () => {
    const ids = (mechanicsOf('Rod of Alertness').operations as Obj[]).map(
      (entry) => entry.id,
    );
    expect(ids).not.toContain('activate-aura');
    const aura = operation('Rod of Alertness', 'activate-protective-aura');
    expect(aura.activation).toMatchObject({ cost: 'action' });
    expect(aura.cost).toEqual([{ economy: 'uses', amount: 1 }]);
    expect(
      transitionsOf('Rod of Alertness').find(
        (entry) => entry.via === 'activate-protective-aura',
      ),
    ).toMatchObject({ from: 'held', to: 'planted-aura' });
  });
});

describe('containment states the printed qualifiers (S1.16-S1.18)', () => {
  it('Bag of Devouring: containment is adjudicated; only matter placed WHOLLY in the bag is lost and a part of a creature uses the 50% rule, as printed', () => {
    expect(
      (dataOf('Bag of Devouring').mechanics as Obj | undefined)?.containment,
    ).toBeUndefined();
    expect(
      carries(
        'Bag of Devouring',
        'Animal or vegetable matter placed wholly in the bag is devoured and lost forever',
      ),
    ).toBe(true);
    expect(carries('Bag of Devouring', 'there is a 50 percent chance')).toBe(
      true,
    );
  });

  it('Handy Haversack: containment is adjudicated; a SHARP OBJECT qualifies both piercing and tearing, as printed', () => {
    expect(
      (dataOf('Handy Haversack').mechanics as Obj | undefined)?.containment,
    ).toBeUndefined();
    expect(
      carries(
        'Handy Haversack',
        'if a sharp object pierces it or tears it, the haversack ruptures and is destroyed',
      ),
    ).toBe(true);
  });

  it('Portable Hole: containment is adjudicated; the ten-minute timer applies to a CLOSED hole, as printed', () => {
    expect(
      (dataOf('Portable Hole').mechanics as Obj | undefined)?.containment,
    ).toBeUndefined();
    expect(carries('Portable Hole', 'within a closed portable hole')).toBe(
      true,
    );
    expect(
      clauseText('Portable Hole', '/containment-portable-hole-suffocation'),
    ).toContain('within a closed portable hole');
  });
});

// ---------------------------------------------------------------------------
// Review 19.4.6.3 (eshyra-o9bd.19.4.6.4): omitted predicates, outcome-gated
// transitions, spellStore costs and per-instance economies
// ---------------------------------------------------------------------------

const HOLDING_LEAD =
  /\b(?:while|if|as long as)\b[^.,:]{0,50}?\b(?:holding|hold|wearing|wear|wield(?:ing)?|carry|carrying|grasping|grasp|on your person|touching)\b/i;
const ACTIVATION_WORDS =
  /\b(you can|can use|expend|speak|command word|use an action|as an action|as a bonus|use your reaction|cast)\b/i;

/**
 * The OMISSION screen: the verbatim screen above catches an invented or
 * paraphrased predicate, this one catches a printed one that was dropped. A
 * `cast-*` operation whose spell is named in a printed activation sentence led
 * by a holding / wearing / carrying / on-your-person predicate must type that
 * predicate in requirement, trigger or target. Spell names are specific, so
 * the association is precise; non-spell operations are covered by the
 * reviewed census below.
 */
function castsMissingHoldingPredicate(
  description: string,
  operations: readonly Obj[],
): { readonly governed: number; readonly missing: string[] } {
  const sentences = description
    .split(/(?<=[.!?])\s+/)
    .filter(
      (sentence) =>
        HOLDING_LEAD.test(sentence) && ACTIVATION_WORDS.test(sentence),
    )
    .map((sentence) => sentence.toLowerCase());
  const missing: string[] = [];
  let governed = 0;
  for (const operation of operations) {
    const id = String(operation.id).replace(/^m\d+-/, '');
    if (!id.startsWith('cast-')) continue;
    const spell = id.slice('cast-'.length).replaceAll('-', ' ');
    const spellNames = [
      spell,
      spell.replace('enlarge reduce', 'enlarge/reduce'),
    ];
    if (
      !sentences.some((sentence) =>
        spellNames.some((name) => sentence.includes(name)),
      )
    )
      continue;
    governed += 1;
    const typed = (operation.activation ?? {}) as Obj;
    if (!Array.isArray(typed.equipment) || typed.equipment.length === 0)
      missing.push(String(operation.id));
  }
  return { governed, missing };
}

describe('omitted printed predicates (review 19.4.6.3 S1)', () => {
  it('types the printed holding / wearing equipment on every governed spell cast, across the whole corpus', () => {
    const problems: string[] = [];
    let governed = 0;
    for (const record of items)
      for (const scope of scopesOf(record.name)) {
        const result = castsMissingHoldingPredicate(
          scope.description,
          scope.operations,
        );
        governed += result.governed;
        for (const id of result.missing) problems.push(`${scope.label} ${id}`);
      }
    expect(problems).toEqual([]);
    // Not vacuous: wands, rods, staffs, rings, boots, helms, hats, capes.
    expect(governed).toBeGreaterThan(70);
  });

  it('keeps the omission screen able to fail (counterfactual: a stowed-staff cast without the printed holding clause)', () => {
    const description =
      'While holding it, you can use an action to expend 1 or more of its charges to cast one of the following spells from it: burning hands (1 charge), fireball (3 charges).';
    expect(
      castsMissingHoldingPredicate(description, [
        { id: 'cast-fireball', activation: { cost: 'action' } },
        {
          id: 'cast-burning-hands',
          activation: { equipment: [['held']] },
        },
      ]),
    ).toEqual({ governed: 2, missing: ['cast-fireball'] });
  });

  it('types held equipment on every staff cast, including the free casts of the same paragraph', () => {
    for (const name of [
      'Staff of Charming',
      'Staff of Fire',
      'Staff of Frost',
      'Staff of Healing',
      'Staff of Power',
      'Staff of Swarming Insects',
      'Staff of the Magi',
    ]) {
      const casts = (scopesOf(name)[0]?.operations ?? []).filter((entry) =>
        /^(cast-|create-insect-cloud)/.test(String(entry.id)),
      );
      expect(casts.length, name).toBeGreaterThan(2);
      for (const operation of casts)
        expect(
          (operation.activation as Obj).equipment,
          `${name} ${String(operation.id)}`,
        ).toEqual([['held']]);
    }
    // Negative siblings: these staffs print no holding clause for their casts.
    for (const name of [
      'Staff of the Woodlands',
      'Staff of Thunder and Lightning',
    ])
      for (const operation of (scopesOf(name)[0]?.operations ?? []).filter(
        (entry) => String(entry.id).startsWith('cast-'),
      ))
        expect(
          (operation.activation as Obj | undefined)?.equipment,
          `${name} ${String(operation.id)}`,
        ).toBeUndefined();
  });

  it('records the reviewed census of non-spell operations whose printed predicate, actor or target is carried as an adjudicated verbatim span', () => {
    const census: readonly (readonly [string, string, string, string])[] = [
      [
        'Boots of Speed',
        'activate-speed',
        'requirement',
        'While you wear these boots',
      ],
      [
        'Ring of Invisibility',
        'become-invisible',
        'requirement',
        'While wearing this ring',
      ],
      [
        'Robe of Useful Items',
        'detach-patch',
        'requirement',
        'While wearing the robe',
      ],
      [
        'Wings of Flying',
        'manifest-wings',
        'requirement',
        'While wearing this cloak',
      ],
      [
        'Staff of Swarming Insects',
        'create-insect-cloud',
        'requirement',
        'While holding the staff',
      ],
      [
        'Folding Boat',
        'fold-boat',
        'requirement',
        'provided that no creatures are aboard',
      ],
      [
        'Sphere of Annihilation',
        'attempt-control',
        'requirement',
        'If you are within 60 feet of an uncontrolled sphere',
      ],
      [
        'Chime of Opening',
        'strike-chime',
        'target',
        'an object within 120 feet of you that can be opened',
      ],
      [
        'Dimensional Shackles',
        'attach-shackles',
        'target',
        'an incapacitated creature',
      ],
      [
        'Eyes of Charming',
        'cast-charm-person',
        'target',
        'a humanoid within 30 feet of you',
      ],
    ];
    for (const [name, id, field, span] of census) {
      expect(descriptionOf(name), `${name} prints it`).toContain(span);
      // Typed-field exactness is no longer claimed: the predicate is carried
      // verbatim by an adjudicated span and the field is absent.
      expect(activation(name, id)?.[field], `${name} ${id}.${field}`).toBe(
        undefined,
      );
      expect(carries(name, span), `${name} ${id}.${field}`).toBe(true);
    }
    // Iron Flask keeps only the occupancy structure item initialization binds.
    expect(mechanicsOf('Iron Flask').containment).toEqual({
      mode: 'creature-prison',
      tracksOccupancy: true,
      capacity: { creatures: 1 },
    });
    expect(
      carries(
        'Iron Flask',
        'a creature that you can see within 60 feet of you',
      ),
    ).toBe(true);
    // Typing the printed actor does not change what use_item can execute:
    // the green set is pinned in the runtime-safety block below.
  });

  it('records the reviewed operations that deliberately state no holding clause (sweep result)', () => {
    // Heuristic-sweep hits (item-level token association) that the printed
    // text does NOT gate by holding / wearing; each is reviewed, none is a
    // missing predicate.
    const reviewedUngated: readonly (readonly [string, string, string])[] = [
      [
        'Cloak of the Bat',
        'end-polymorph',
        'ending is delegated to the polymorph spell; the printed wearing clause governs only the cast',
      ],
      [
        'Ring of Invisibility',
        'become-visible',
        'printed as a bonus action with no wearing clause of its own',
      ],
      [
        'Rope of Climbing',
        'fasten-rope',
        'a separate printed command sentence, not part of the holding clause',
      ],
      [
        'Rope of Climbing',
        'knot-rope',
        'a separate printed command sentence, not part of the holding clause',
      ],
      [
        'Rope of Climbing',
        'release-rope',
        'a separate printed command sentence, not part of the holding clause',
      ],
      [
        'Rope of Entanglement',
        'release-creature',
        'printed as a second command word with no hold clause',
      ],
      [
        'Staff of Charming',
        'reflect-enchantment',
        'printed "with or without the staff’s intervention"; no holding clause',
      ],
      [
        'Staff of the Woodlands',
        'tree-form',
        'the touching clause governs the return, not the planting',
      ],
      [
        'Decanter of Endless Water',
        'produce-geyser',
        'holding governs only the aim sub-action; no field states both',
      ],
    ];
    for (const [name, id] of reviewedUngated) {
      const typed = (activation(name, id) ?? {}) as Obj;
      expect(typed.equipment, `${name} ${id}`).toBeUndefined();
    }
  });
});

describe('state graph text and outcome-gated transitions, whole corpus (review 19.4.6.3 S2)', () => {
  const tableCells = (key: string): string[] => {
    const table = pack.records.find((record) => record.key === key);
    if (table === undefined) return [];
    return ((table.data as Obj).rows as unknown[][])
      .flat()
      .map((cell) => String(cell));
  };

  /** A graph string is a verbatim printed span, or a `table:` citation whose
   * quoted cell text is verbatim in the cited table. */
  function unprintedGraphText(
    description: string,
    field: string,
    value: unknown,
  ): string | undefined {
    if (typeof value !== 'string') return undefined;
    if (description.includes(value)) return undefined;
    const cited = /^(table:[a-z0-9-]+) .*?: (.+)$/.exec(value);
    if (
      field === 'note' &&
      cited !== null &&
      tableCells(String(cited[1])).includes(String(cited[2]))
    )
      return undefined;
    return field;
  }

  it('every state machine of every item and variant quotes its conditions, notes and termination from the printed description', () => {
    const problems: string[] = [];
    let machines = 0;
    for (const record of items)
      for (const scope of scopesOf(record.name)) {
        const machine = scope.mechanics.stateMachine as Obj | undefined;
        if (machine === undefined) continue;
        machines += 1;
        const bad = (field: string, value: unknown, where: string) => {
          if (unprintedGraphText(scope.description, field, value) !== undefined)
            problems.push(`${scope.label} ${where} ${field}: ${String(value)}`);
        };
        bad('termination', machine.termination, 'machine');
        bad('note', machine.note, 'machine');
        for (const entry of machine.transitions as Obj[]) {
          const where = `${String(entry.from)}->${String(entry.to)}`;
          bad('condition', entry.condition, where);
          bad('note', entry.note, where);
        }
      }
    expect(problems).toEqual([]);
    // Independent census: every machine in the pack was screened.
    let expected = 0;
    for (const record of items) {
      const data = record.data as Obj;
      if ((data.mechanics as Obj | undefined)?.stateMachine !== undefined)
        expected += 1;
      for (const variant of (data.variants as Obj[] | undefined) ?? [])
        if ((variant.mechanics as Obj | undefined)?.stateMachine !== undefined)
          expected += 1;
    }
    expect(machines).toBe(expected);
    // 49 machines before the triage; 21 stay typed (single-lifetime toggles
    // and the machines an existing consumer binds to), the other 28 are
    // withheld (review 19.4.6.7 S2 added the Staff of Swarming Insects, Helm
    // of Brilliance and Ring of Shooting Stars).
    expect(machines).toBe(21);
  });

  it('keeps the graph-text screen able to fail (counterfactual: a paraphrased condition and a mis-cited table cell)', () => {
    const description = 'If the rope drops to 0 hit points, it is destroyed.';
    expect(
      unprintedGraphText(description, 'condition', 'rope reaches 0 hit points'),
    ).toBe('condition');
    expect(
      unprintedGraphText(
        description,
        'condition',
        'the rope drops to 0 hit points',
      ),
    ).toBeUndefined();
    expect(
      unprintedGraphText(
        description,
        'note',
        'table:apparatus-of-the-crab-levers lever 10, Up: Not a printed cell.',
      ),
    ).toBe('note');
  });

  it('binds holder actions to paid operations and target escape to an external event', () => {
    const ropeTransitions = transitionsOf('Rope of Entanglement');
    expect(
      ropeTransitions.find(
        (entry) => entry.from === 'loose' && entry.to === 'restraining',
      ),
    ).toMatchObject({
      via: 'entangle-creature',
      onFailure: { to: 'loose', scope: 'target' },
    });
    expect(
      ropeTransitions.find(
        (entry) =>
          entry.from === 'restraining' &&
          typeof entry.condition === 'string' &&
          entry.condition.includes('target’s choice'),
      ),
    ).toEqual({
      from: 'restraining',
      to: 'loose',
      condition:
        'A target restrained by the rope can use an action to make a DC 15 Strength or Dexterity check (target’s choice). On a success, the creature is no longer restrained by the rope.',
    });
    expect(
      (mechanicsOf('Rope of Entanglement').operations ?? []).some(
        (entry) => entry.id === 'escape-rope',
      ),
    ).toBe(false);
    expect(operation('Rope of Entanglement', 'release-creature')).toBeDefined();
    expect(
      ropeTransitions
        .filter((entry) => entry.condition)
        .map((entry) => entry.condition),
    ).toEqual([
      'A target restrained by the rope can use an action to make a DC 15 Strength or Dexterity check (target’s choice). On a success, the creature is no longer restrained by the rope.',
      'the rope drops to 0 hit points',
      'the rope drops to 0 hit points',
    ]);
    // Sphere and Iron Bands machines are withheld; the printed outcomes that
    // made their transitions condition-only are adjudicated spans, and the
    // outcome-gated operations stay declared.
    expect(mechanicsOf('Sphere of Annihilation').stateMachine).toBeUndefined();
    expect(mechanicsOf('Iron Bands of Binding').stateMachine).toBeUndefined();
    expect(
      carries(
        'Sphere of Annihilation',
        'On a success, the sphere levitates in one direction of your choice',
      ),
    ).toBe(true);
    expect(
      carries(
        'Iron Bands of Binding',
        'On a hit, the target is restrained until you take a bonus action',
      ),
    ).toBe(true);
    expect(
      operation('Sphere of Annihilation', 'attempt-control'),
    ).toBeDefined();
  });

  it('Immovable Rod: the DC 30 check moves the FIXED rod and does not release it', () => {
    const machine = machineOf('Immovable Rod');
    expect(String(machine.termination)).not.toContain('DC 30');
    expect(String(machine.termination)).toContain('deactivate and fall');
    expect(String(machine.note)).toContain(
      'moving the fixed rod up to 10 feet on a success',
    );
  });

  it('Marvelous Pigments: the machine is withheld; any completed painting becomes a real object and a higher value is a worthless-material object, as printed', () => {
    expect(mechanicsOf('Marvelous Pigments').stateMachine).toBeUndefined();
    expect(
      carries(
        'Marvelous Pigments',
        'When you complete the painting, the object or terrain feature depicted becomes a real, nonmagical object',
      ),
    ).toBe(true);
    expect(
      carries(
        'Marvelous Pigments',
        'the object looks authentic, but close inspection reveals it is made from paste, bone, or some other worthless material',
      ),
    ).toBe(true);
  });

  it('Folding Boat: the machine is withheld; folding needs no creatures aboard, as printed, and the command-word operations stay typed', () => {
    expect(mechanicsOf('Folding Boat').stateMachine).toBeUndefined();
    expect(activation('Folding Boat', 'fold-boat')).toEqual({
      cost: 'action',
      commandWord: true,
    });
    expect(
      carries('Folding Boat', 'provided that no creatures are aboard'),
    ).toBe(true);
  });
});

describe('spellStore costs and per-instance economies (review 19.4.6.3 S3, S4)', () => {
  it('spellStore keeps only the stored-level counters item initialization binds, rollManipulation is DM-adjudicated, and the printed distinctions are verbatim spans', () => {
    const CORE = new Set([
      'Ring of Spell Storing',
      'Ioun Stone::Reserve',
      'Rod of Absorption',
    ]);
    for (const record of items)
      for (const scope of scopesOf(record.name)) {
        expect(scope.mechanics.rollManipulation, scope.label).toBeUndefined();
        const store = scope.mechanics.spellStore as Obj | undefined;
        if (!CORE.has(scope.label)) {
          expect(store, scope.label).toBeUndefined();
          continue;
        }
        for (const contract of (store as Obj).contracts as Obj[])
          expect(
            Object.keys(contract).filter(
              (key) =>
                ![
                  'id',
                  'kind',
                  'variant',
                  'capacityLevels',
                  'lifetimeCapacityLevels',
                  'initialLevels',
                  'operationIds',
                ].includes(key),
            ),
            `${scope.label} ${String(contract.id)}`,
          ).toEqual([]);
      }
    // The stored spell keeps its normal casting time and the scroll's casting
    // time is the spell's, as printed (no typed free cost can contradict them).
    expect(
      carries(
        'Spell Scroll',
        'Casting the spell by reading the scroll requires the spell’s normal casting time',
      ),
    ).toBe(true);
    expect(
      carries(
        'Ring of Spell Storing',
        'The level of the slot used to cast the spell determines how much space it uses',
      ),
    ).toBe(true);
    expect(
      carries(
        'Ioun Stone',
        'Once the stone has canceled 20 levels of spells, it burns out and turns dull gray',
      ),
    ).toBe(true);
    expect(carries('Luck Blade', 'You must use the second roll')).toBe(true);
  });

  it('Necklace of Prayer Beads: no necklace-wide once-per-day pool; the per-bead dawn gate is an adjudicated clause carrying the printed sentence', () => {
    const mechanics = mechanicsOf('Necklace of Prayer Beads');
    expect(Object.keys((mechanics.economies ?? {}) as Obj)).not.toContain(
      'bead-spells',
    );
    const cast = ((mechanics.operations ?? []) as Obj[]).find(
      (entry) => entry.id === 'cast-bead-spell',
    ) as Obj;
    expect(cast.cost).toBeUndefined();
    const text = clauseText('Necklace of Prayer Beads', '/c1-bead-spells');
    expect(text).toBe(
      'Once a magic bead’s spell is cast, that bead can’t be used again until the next dawn.',
    );
    expect(descriptionOf('Necklace of Prayer Beads')).toContain(text);
    // The bead inventory (1d4 + 2 magic beads) stays typed.
    expect((mechanics.economies as Obj).beads).toMatchObject({
      kind: 'doses',
      doses: { count: '1d4+2' },
    });
  });

  it('no per-day pool of one is typed for a gate the text prints per instance', () => {
    // Class screen: an economy whose note says per-instance / per-bead /
    // each-X must not be a single shared per-day use.
    const problems: string[] = [];
    for (const record of items)
      for (const scope of scopesOf(record.name)) {
        const economies = (scope.mechanics.economies ?? {}) as Obj;
        for (const [id, economy] of Object.entries(economies)) {
          const typed = economy as Obj;
          if (
            typed.kind === 'per-day' &&
            /\bindependent\b[^.]*\b(each|per)\b/i.test(String(typed.note ?? ''))
          )
            problems.push(`${scope.label} ${id}: ${String(typed.note)}`);
        }
      }
    expect(problems).toEqual([]);
  });
});

describe('runtime safety across the whole corpus', () => {
  // The preflight ("green") operation set over every item x variant x operation
  // id, pinned. Other creatures' actions are external condition events and are
  // excluded from this owner-operation set.
  const READY = [
    'Ammunition, +1, +2, or +3||hit-target',
    'Animated Shield||end-animation',
    'Animated Shield||speak-command-word',
    'Boots of Levitation||cast-levitate',
    'Candle of Invocation||burn',
    'Frost Brand||extinguish-flames',
    'Ring of X-ray Vision||activate-x-ray-vision',
    'Rod of Security||enter-paradise',
    'Rope of Entanglement||entangle-creature',
    'Rope of Entanglement||release-creature',
    'Well of Many Worlds||open-portal',
    'Wings of Flying||dismiss-wings',
    'Wings of Flying||manifest-wings',
  ].sort();

  it('keeps the executable operation set identical', () => {
    const ready: string[] = [];
    for (const record of items) {
      const data = record.data as Obj;
      const ids = new Set<string>(['activate', 'deactivate']);
      for (const operation of ((data.mechanics as Obj | undefined)
        ?.operations ?? []) as Obj[])
        ids.add(String(operation.id));
      for (const variant of (data.variants as Obj[] | undefined) ?? [])
        for (const operation of ((variant.mechanics as Obj | undefined)
          ?.operations ?? []) as Obj[])
          ids.add(String(operation.id));
      const definitions = magicItemVariantDefinitions(record);
      const variantIds: (string | undefined)[] =
        definitions.length === 0
          ? [undefined]
          : definitions.map((definition) => definition.id);
      for (const variantId of variantIds)
        for (const id of ids) {
          try {
            const input = deriveItemOperationReadinessInput(
              record,
              variantId,
              id,
            );
            assertMagicItemOperationReady(record, variantId, input);
            ready.push(`${record.name}|${variantId ?? ''}|${id}`);
          } catch {
            // not executable
          }
        }
    }
    expect(ready.sort()).toEqual(READY);
  });
});
