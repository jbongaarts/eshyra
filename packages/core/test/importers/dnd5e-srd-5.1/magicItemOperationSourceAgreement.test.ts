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

  it('carries BOTH printed Ring of Elemental Command gates on the post-slay casts: the linked-plane variant and the help-slay prerequisite', () => {
    expect(activation('Ring of Elemental Command', 'cast-wall-of-ice')).toEqual(
      {
        requirement: 'Ring of Water Elemental Command',
        trigger: 'If you help slay a water elemental while attuned to the ring',
      },
    );
    // A fire-linked ring that helped slay an AIR elemental satisfies neither
    // gate of a fire cast: the cast carries the FIRE variant heading.
    expect(activation('Ring of Elemental Command', 'cast-fireball')).toEqual({
      requirement: 'Ring of Fire Elemental Command',
      trigger: 'If you help slay a fire elemental while attuned to the ring',
    });
    expect(
      String(
        activation('Ring of Elemental Command', 'dominate-air-elemental')
          ?.requirement,
      ),
    ).toBe('Ring of Air Elemental Command');
    // Every post-slay cast of every plane carries its own plane's gates.
    const planes = ['Air', 'Earth', 'Fire', 'Water'] as const;
    for (const operation of scopesOf('Ring of Elemental Command')[0]
      ?.operations ?? []) {
      const id = String(operation.id);
      if (!id.startsWith('cast-')) continue;
      const typed = operation.activation as Obj;
      const plane = planes.find(
        (name) => typed.requirement === `Ring of ${name} Elemental Command`,
      );
      expect(plane, id).toBeDefined();
      expect(String(typed.trigger), id).toMatch(
        new RegExp(
          `^If you help slay an? ${String(plane).toLowerCase()} elemental while attuned to the ring$`,
        ),
      );
    }
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

  it('Eversmoking Bottle: growth is not a plain timer; closing does not end the cloud, it disperses ten minutes later', () => {
    const transitions = transitionsOf('Eversmoking Bottle');
    // The "open AND within the cloud" growth guard is not statable by a timer,
    // so no growth timer or growth state is typed; the printed sentence is an
    // adjudicated clause.
    expect(
      transitions.filter(
        (entry) =>
          entry.timer !== undefined && entry.from !== 'cloud-lingering',
      ),
    ).toEqual([]);
    expect(
      (machineOf('Eversmoking Bottle').states as Obj[]).map(
        (entry) => entry.id,
      ),
    ).toEqual(['closed', 'cloud-open', 'cloud-lingering']);
    expect(
      clauseText('Eversmoking Bottle', '/state-eversmoking-bottle-growth'),
    ).toContain('remains open and within the cloud');
    expect(
      transitions
        .filter((entry) => entry.via === 'close-bottle')
        .map((entry) => entry.to),
    ).toEqual(['cloud-lingering']);
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

  it('Apparatus of the Crab: lever 1 never moves the hatch; lever 10 UP opens and DOWN seals it, typed in the transition', () => {
    const transitions = transitionsOf('Apparatus of the Crab');
    expect(
      transitions
        .filter((entry) => entry.via === 'set-lever-1')
        .every((entry) => entry.from === entry.to),
    ).toBe(true);
    // The direction is the operation (`via`), not a note: repeated UP never
    // toggles an open hatch shut.
    const up = transitions.filter((entry) => entry.via === 'set-lever-10-up');
    const down = transitions.filter(
      (entry) => entry.via === 'set-lever-10-down',
    );
    expect(up.map((entry) => [entry.from, entry.to])).toEqual([
      ['sealed', 'open'],
    ]);
    expect(down.map((entry) => [entry.from, entry.to])).toEqual([
      ['open', 'sealed'],
    ]);
    expect(transitions.some((entry) => entry.via === 'set-lever-10')).toBe(
      false,
    );
    const table = pack.records.find(
      (record) => record.key === 'table:apparatus-of-the-crab-levers',
    );
    if (table === undefined) throw new Error('no apparatus lever table');
    const row = ((table.data as Obj).rows as unknown[][]).find(
      (entry) => entry[0] === 10,
    ) as unknown[];
    expect(String(up[0]?.note)).toContain(String(row[1]));
    expect(String(down[0]?.note)).toContain(String(row[2]));
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

// ---------------------------------------------------------------------------
// Review 19.4.6.3 (eshyra-o9bd.19.4.6.4): omitted predicates, outcome-gated
// transitions, spellStore costs and per-instance economies
// ---------------------------------------------------------------------------

const HOLDING_WORDS =
  /\b(holding|hold|wearing|wear|worn|wield|wielding|carry|carrying|grasping|grasp|on your person|touching)\b/i;
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
    const text = ['requirement', 'trigger', 'target']
      .map((field) => String(typed[field] ?? ''))
      .join(' ');
    if (!HOLDING_WORDS.test(text)) missing.push(String(operation.id));
  }
  return { governed, missing };
}

describe('omitted printed predicates (review 19.4.6.3 S1)', () => {
  it('types the printed holding / wearing predicate on every governed spell cast, across the whole corpus', () => {
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
          activation: { requirement: 'While holding it' },
        },
      ]),
    ).toEqual({ governed: 2, missing: ['cast-fireball'] });
  });

  it('states the printed holding requirement on every staff cast, including the free casts of the same paragraph', () => {
    const expected: Record<string, string> = {
      'Staff of Charming': 'While holding this staff',
      'Staff of Fire': 'While holding it',
      'Staff of Frost': 'While holding it',
      'Staff of Healing': 'While holding it',
      'Staff of Power': 'While holding this staff',
      'Staff of Swarming Insects': 'While holding the staff',
      'Staff of the Magi': 'While holding the staff',
    };
    for (const [name, requirement] of Object.entries(expected)) {
      const casts = (scopesOf(name)[0]?.operations ?? []).filter((entry) =>
        /^(cast-|create-insect-cloud)/.test(String(entry.id)),
      );
      expect(casts.length, name).toBeGreaterThan(2);
      for (const operation of casts)
        expect(
          (operation.activation as Obj).requirement,
          `${name} ${String(operation.id)}`,
        ).toBe(requirement);
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
          String((operation.activation as Obj | undefined)?.requirement ?? ''),
          `${name} ${String(operation.id)}`,
        ).not.toMatch(HOLDING_WORDS);
  });

  it('records the reviewed census of non-spell operations whose printed predicate, actor or target is typed verbatim', () => {
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
        'Rope of Entanglement',
        'escape-rope',
        'requirement',
        'A target restrained by the rope',
      ],
      [
        'Ioun Stone',
        'grab-orbiting-stone',
        'trigger',
        'another creature must use an action to grasp or net the stone',
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
      expect(activation(name, id)?.[field], `${name} ${id}.${field}`).toBe(
        span,
      );
    }
    const entry = (mechanicsOf('Iron Flask').containment as Obj).entry as Obj;
    expect((entry.activation as Obj).target).toBe(
      'a creature that you can see within 60 feet of you',
    );
    expect(descriptionOf('Iron Flask')).toContain(
      String((entry.activation as Obj).target),
    );
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
        'Sun Blade',
        'manifest-blade',
        'weapon-wielding rule supplies holding (review 19.4.6.3)',
      ],
      [
        'Sun Blade',
        'dismiss-blade',
        'weapon-wielding rule supplies holding (review 19.4.6.3)',
      ],
      [
        'Decanter of Endless Water',
        'produce-geyser',
        'holding governs only the aim sub-action; no field states both',
      ],
    ];
    for (const [name, id] of reviewedUngated) {
      const typed = (activation(name, id) ?? {}) as Obj;
      expect(
        HOLDING_WORDS.test(
          ['requirement', 'trigger', 'target']
            .map((f) => String(typed[f] ?? ''))
            .join(' '),
        ),
        `${name} ${id}`,
      ).toBe(false);
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
    expect(machines).toBeGreaterThanOrEqual(49);
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

  it('does not move a state on an outcome the transition cannot state: hit-only, success-only and failed-save-only transitions are condition-only', () => {
    // Sphere: a FAILED DC 25 check moves the sphere toward the actor and
    // gains no control. Iron Bands: a MISS makes the bands a sphere again.
    // Rope of Entanglement: a SUCCESSFUL save leaves the target free.
    for (const [name, op] of [
      ['Sphere of Annihilation', 'attempt-control'],
      ['Iron Bands of Binding', 'throw-bands'],
      ['Rope of Entanglement', 'entangle-creature'],
    ] as const) {
      expect(
        transitionsOf(name).some((entry) => entry.via === op),
        `${name} ${op} fires unconditionally`,
      ).toBe(false);
    }
    expect(
      transitionsOf('Sphere of Annihilation').find(
        (entry) => entry.from === 'uncontrolled' && entry.to === 'controlled',
      ),
    ).toMatchObject({
      condition: expect.stringMatching(/^On a success, the sphere levitates/),
    });
    expect(
      transitionsOf('Iron Bands of Binding').find(
        (entry) => entry.from === 'sphere' && entry.to === 'restraining',
      )?.condition,
    ).toBe('On a hit, the target is restrained');
    expect(
      transitionsOf('Rope of Entanglement').find(
        (entry) => entry.from === 'loose' && entry.to === 'restraining',
      )?.condition,
    ).toMatch(
      /must succeed on a DC 15 Dexterity saving throw.*become restrained/,
    );
    // The outcome-gated operations stay declared (and un-bound).
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

  it('Marvelous Pigments: any completed painting becomes a real object; a higher value is a worthless-material object, not a representation', () => {
    const machine = machineOf('Marvelous Pigments');
    const completes = (machine.transitions as Obj[]).find(
      (entry) => entry.to === 'realized',
    );
    expect(completes?.condition).toBe('When you complete the painting');
    expect(String(machine.termination)).not.toMatch(
      /representation|at most 25/,
    );
  });

  it('Folding Boat: only the printed box-to-vessel and vessel-to-box transitions exist, folding needs no creatures aboard', () => {
    const pairs = transitionsOf('Folding Boat').map((entry) =>
      [entry.from, entry.to, entry.via].join('>'),
    );
    expect(pairs.sort()).toEqual(
      [
        'box>boat>become-boat',
        'box>ship>become-ship',
        'boat>box>fold-boat',
        'ship>box>fold-boat',
      ].sort(),
    );
    expect(activation('Folding Boat', 'fold-boat')?.requirement).toBe(
      'provided that no creatures are aboard',
    );
  });
});

describe('spellStore costs and per-instance economies (review 19.4.6.3 S3, S4)', () => {
  it('no spellStore event types the free cost the text does not print; a stored spell keeps its normal casting time', () => {
    const problems: string[] = [];
    let events = 0;
    for (const record of items)
      for (const scope of scopesOf(record.name)) {
        const store = scope.mechanics.spellStore as Obj | undefined;
        for (const contract of (store?.contracts ?? []) as Obj[])
          for (const field of ['storeOn', 'castOut', 'absorbOn'] as const) {
            const event = contract[field] as Obj | undefined;
            if (event === undefined) continue;
            events += 1;
            if (
              event.cost === 'free' &&
              !/no action required/.test(scope.description)
            )
              problems.push(
                `${scope.label} ${String(contract.id)}.${field}: free`,
              );
            if (
              event.cost === 'reaction' &&
              !/\breaction\b/.test(scope.description)
            )
              problems.push(
                `${scope.label} ${String(contract.id)}.${field}: reaction`,
              );
          }
      }
    expect(problems).toEqual([]);
    expect(events).toBeGreaterThanOrEqual(9);
    for (const [name, label] of [
      ['Ring of Spell Storing', 'Ring of Spell Storing'],
      ['Ioun Stone', 'Ioun Stone::Reserve'],
    ] as const) {
      const scope = scopesOf(name).find((entry) => entry.label === label);
      if (scope === undefined) throw new Error(`no scope ${label}`);
      const contract = (
        (scope.mechanics.spellStore as Obj).contracts as Obj[]
      )[0] as Obj;
      expect((contract.storeOn as Obj).cost, name).toBe(
        'spell-normal-casting-time',
      );
      expect((contract.castOut as Obj).cost, name).toBe(
        'spell-normal-casting-time',
      );
    }
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
