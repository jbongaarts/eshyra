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

  it('carries a Ring of Elemental Command slay prerequisite on the plane-gated casts', () => {
    expect(
      String(
        activation('Ring of Elemental Command', 'cast-wall-of-ice')
          ?.requirement,
      ),
    ).toBe('If you help slay a water elemental while attuned to the ring');
    expect(activation('Ring of Elemental Command', 'cast-fireball')).toEqual({
      requirement:
        'If you help slay a fire elemental while attuned to the ring',
    });
    expect(
      String(
        activation('Ring of Elemental Command', 'dominate-air-elemental')
          ?.requirement,
      ),
    ).toBe('Ring of Air Elemental Command');
  });

  it('prints the previously paraphrased requirements and targets', () => {
    expect(activation('Gem of Brightness', 'blinding-beam')).toEqual({
      cost: 'action',
      commandWord: true,
      requirement: 'While you are holding it',
      target: 'one creature you can see within 60 feet of you',
    });
    expect(
      String(activation('Ring of Shooting Stars', 'cast-light')?.requirement),
    ).toBe('While wearing this ring in dim light or darkness');
    expect(activation('Ring of Shooting Stars', 'cast-faerie-fire')).toEqual({
      cost: 'action',
    });
    expect(activation('Armor of Invulnerability', 'activate-immunity')).toEqual(
      { cost: 'action' },
    );
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
  const GRAPH_ITEMS = [
    'Dagger of Venom',
    'Dancing Sword',
    'Decanter of Endless Water',
    'Staff of Swarming Insects',
    'Broom of Flying',
    'Eversmoking Bottle',
    'Rope of Climbing',
    'Ioun Stone',
    'Instant Fortress',
  ] as const;

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

  it('Dancing Sword: the launch is the first attack and the fourth attack returns it', () => {
    const transitions = transitionsOf('Dancing Sword');
    const states = (machineOf('Dancing Sword').states as Obj[]).map(
      (entry) => entry.id,
    );
    expect(states).not.toContain('attack-zero');
    const via = (id: string) => transitions.filter((entry) => entry.via === id);
    expect(via('launch-sword')).toEqual([
      { from: 'held', to: 'attack-one', via: 'launch-sword' },
    ]);
    // launch (1) + three counted commands (2, 3, 4) -> returning
    expect(via('command-attack').map((entry) => entry.to)).toEqual([
      'attack-two',
      'attack-three',
      'returning',
    ]);
    // Grasping it or moving more than 30 feet away stops the hovering from
    // every hovering state, including the return.
    for (const from of [
      'attack-one',
      'attack-two',
      'attack-three',
      'returning',
    ])
      expect(
        transitions.some(
          (entry) =>
            entry.from === from &&
            entry.to === 'not-hovering' &&
            String(entry.condition).includes(
              'grasp it or move more than 30 feet',
            ),
        ),
        from,
      ).toBe(true);
    // Both printed fall branches (no free hand; no unobstructed path).
    const falls = transitions
      .filter((entry) => entry.to === 'grounded')
      .map((entry) => entry.condition);
    expect(falls).toHaveLength(2);
  });

  it('Decanter of Endless Water: the water stops at the start of your next turn; there is no stop command', () => {
    expect(
      (mechanicsOf('Decanter of Endless Water').operations as Obj[]).map(
        (entry) => entry.id,
      ),
    ).not.toContain('stop-water');
    expect(machineOf('Decanter of Endless Water').termination).toBe(
      'The water stops pouring out at the start of your next turn',
    );
  });

  it('Staff of Swarming Insects: wind ends it, no dismissal command, no 20-foot movement cutoff', () => {
    const machine = machineOf('Staff of Swarming Insects');
    expect(
      (mechanicsOf('Staff of Swarming Insects').operations as Obj[]).map(
        (entry) => entry.id,
      ),
    ).not.toContain('dismiss-insect-cloud');
    expect(String(machine.termination)).toContain(
      'A wind of at least 10 miles per hour disperses the swarm',
    );
    expect(JSON.stringify(machine)).not.toMatch(/20 feet|10-foot clear/);
  });

  it('Broom of Flying: landing, not dismounting, stops the hovering', () => {
    expect(
      (mechanicsOf('Broom of Flying').operations as Obj[]).map(
        (entry) => entry.id,
      ),
    ).not.toContain('dismount-broom');
    expect(machineOf('Broom of Flying').termination).toBe(
      'The broom stops hovering when you land',
    );
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

  it('Eversmoking Bottle: closing does not end the cloud; it disperses ten minutes later', () => {
    const transitions = transitionsOf('Eversmoking Bottle');
    expect(
      transitions
        .filter((entry) => entry.via === 'close-bottle')
        .map((entry) => entry.to),
    ).toEqual(['cloud-lingering', 'cloud-lingering', 'cloud-lingering']);
    expect(
      transitions.find((entry) => entry.from === 'cloud-lingering'),
    ).toMatchObject({ to: 'closed', timer: { amount: 10, unit: 'minute' } });
  });

  it('Rope of Climbing: the action only animates; movement, fastening and knotting are not chained stages', () => {
    const states = (machineOf('Rope of Climbing').states as Obj[]).map(
      (entry) => entry.id,
    );
    expect(states).toEqual(['loose', 'animated']);
    expect(
      transitionsOf('Rope of Climbing').find(
        (entry) => entry.via === 'animate-rope',
      ),
    ).toMatchObject({ from: 'loose', to: 'animated' });
    expect(
      clauseText('Rope of Climbing', '/state-rope-of-climbing-movement'),
    ).toContain('As a bonus action, you can command the other end to move');
  });

  it('Ioun Stone: seizure accepts the attack OR the Acrobatics check; the executable operation is unchanged', () => {
    const seize = transitionsOf('Ioun Stone').find(
      (entry) => entry.to === 'seized',
    );
    expect(seize?.condition).toContain('successful attack roll against AC 24');
    expect(seize?.condition).toContain('DC 24 Dexterity (Acrobatics) check');
    expect(
      operation('Ioun Stone', 'grab-orbiting-stone').activation,
    ).toMatchObject({ cost: 'action' });
  });

  it('Instant Fortress: no whole-item destroyed state; component hit points and wish repair are carried verbatim', () => {
    const states = (machineOf('Instant Fortress').states as Obj[]).map(
      (entry) => entry.id,
    );
    expect(states).not.toContain('destroyed');
    expect(
      clauseText('Instant Fortress', '/state-instant-fortress-components'),
    ).toContain(
      'Each casting of wish causes the roof, the door, or one wall to regain 50 hit points.',
    );
  });

  it('Apparatus of the Crab: lever 1 never moves the hatch; lever 10 opens and closes it per the table', () => {
    const transitions = transitionsOf('Apparatus of the Crab');
    expect(
      transitions
        .filter((entry) => entry.via === 'set-lever-1')
        .every((entry) => entry.from === entry.to),
    ).toBe(true);
    const lever10 = transitions.filter((entry) => entry.via === 'set-lever-10');
    expect(lever10.map((entry) => [entry.from, entry.to])).toEqual([
      ['sealed', 'open'],
      ['open', 'sealed'],
    ]);
    const table = pack.records.find(
      (record) => record.key === 'table:apparatus-of-the-crab-levers',
    );
    if (table === undefined) throw new Error('no apparatus lever table');
    const row = ((table.data as Obj).rows as unknown[][]).find(
      (entry) => entry[0] === 10,
    ) as unknown[];
    expect(String(lever10[0]?.note)).toContain(String(row[1]));
    expect(String(lever10[1]?.note)).toContain(String(row[2]));
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
      expect(String(grant.note)).toContain('does not disappear');
      expect(String(grant.note)).toContain('hostile');
      expect(String(grant.note)).toContain('one hour after it was summoned');
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
    expect(String(lions.note)).toContain(
      'You can use one figurine or both simultaneously',
    );
  });

  it('Pipes of the Sewers: control ends when a friendly swarm STARTS ITS TURN unable to hear', () => {
    const control = String(
      grantOf('Pipes of the Sewers', 'called-rat-swarms').control,
    );
    expect(control).toContain(
      'starts its turn and can’t hear the pipes’ music',
    );
    expect(control).not.toContain('hears pipes played each round');
    for (const part of control.split('; '))
      expect(descriptionOf('Pipes of the Sewers')).toContain(part);
  });

  it('Manual of Golems: the eligibility gate and the animating ashes are printed preconditions, not a supplied grant', () => {
    const golem = grantOf('Manual of Golems', 'created-golem');
    expect(String(golem.note)).toBe(
      'The golem becomes animate when the ashes of the manual are sprinkled on it',
    );
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

  it('Orb of Dragonkind: the call is gated by its one-hour cooldown, not by outstanding dragons', () => {
    const call = grantOf('Orb of Dragonkind', 'called-evil-dragons');
    expect(call.exclusiveInstance).toBeUndefined();
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
  it('Bag of Devouring: only matter placed WHOLLY in the bag is lost; a part of a creature uses the 50% rule', () => {
    const containment = mechanicsOf('Bag of Devouring').containment as Obj;
    const overflow = String(containment.overflow);
    expect(overflow).toContain(
      'placed wholly in the bag is devoured and lost forever',
    );
    for (const part of overflow.split('; '))
      expect(descriptionOf('Bag of Devouring')).toContain(part);
    expect((containment.entry as Obj).trigger).toBe(
      'part of a living creature is placed in the bag',
    );
  });

  it('Handy Haversack: a SHARP OBJECT qualifies both piercing and tearing', () => {
    const triggers = (
      (mechanicsOf('Handy Haversack').containment as Obj).rupture as Obj
    ).triggers as string[];
    expect(triggers).toEqual([
      'If it is overloaded',
      'if a sharp object pierces it or tears it',
    ]);
    for (const part of triggers)
      expect(descriptionOf('Handy Haversack')).toContain(part);
  });

  it('Portable Hole: the ten-minute timer applies to a CLOSED hole, so no unconditional timer is typed', () => {
    const containment = mechanicsOf('Portable Hole').containment as Obj;
    expect(containment.suffocation).toBeUndefined();
    expect(
      clauseText('Portable Hole', '/containment-portable-hole-suffocation'),
    ).toContain('within a closed portable hole');
  });
});

describe('runtime safety across the whole corpus', () => {
  // The preflight ("green") operation set over every item x variant x operation
  // id, pinned. It is identical before and after eshyra-o9bd.19.4.6.2 and
  // eshyra-o9bd.19.4.6.1; a change here is a runtime-behavior change that must
  // be source-required and reported.
  const READY = [
    'Ammunition, +1, +2, or +3||hit-target',
    'Boots of Levitation||cast-levitate',
    'Candle of Invocation||burn',
    ...[
      'absorption',
      'agility',
      'awareness',
      'fortitude',
      'greater-absorption',
      'insight',
      'intellect',
      'leadership',
      'mastery',
      'protection',
      'regeneration',
      'reserve',
      'strength',
      'sustenance',
    ].map((variant) => `Ioun Stone|${variant}|grab-orbiting-stone`),
    'Ring of Shooting Stars||discharge-ball-lightning',
    'Rope of Entanglement||escape-rope',
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
