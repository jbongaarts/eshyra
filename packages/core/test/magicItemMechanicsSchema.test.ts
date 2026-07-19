import { describe, expect, it } from 'vitest';
import { validateRecordKindSchema } from '../src/rules/kindSchemas.js';
import { isStatefulMagicItemMechanics } from '../src/rules/magicItemMechanics.js';
import type { RulesRecord } from '../src/rules/types.js';

function magicItem(mechanics: Record<string, unknown>): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'magic-item',
    key: 'magic-item:test-item',
    name: 'Test Item',
    data: {
      itemType: 'Wondrous item',
      rarity: 'rare',
      requiresAttunement: false,
      description: 'Source-faithful fixture.',
      mechanics,
    },
  } as RulesRecord;
}

function validate(mechanics: Record<string, unknown>): void {
  validateRecordKindSchema(magicItem(mechanics), 'records[0]');
}

const castEffect = (id: string, spellRef: string) => ({
  id,
  kind: 'castSpell',
  spellRef,
});

describe('magic-item mechanics schema', () => {
  it('accepts paired conditional depletion outcomes and rejects incomplete pairs', () => {
    expect(() =>
      validate({
        economies: {
          charges: {
            kind: 'charges',
            charges: { max: 20 },
            onDepleted: {
              roll: 'd20',
              losePropertyOn: 1,
              regainOn: 20,
              regainAmount: '1d8+2',
            },
          },
        },
      }),
    ).not.toThrow();
    expect(() =>
      validate({
        economies: {
          charges: {
            kind: 'charges',
            charges: { max: 20 },
            onDepleted: { roll: 'd20', regainOn: 20 },
          },
        },
      }),
    ).toThrow(/regainOn and .*regainAmount must be declared together/);
    expect(() =>
      validate({
        economies: {
          charges: {
            kind: 'charges',
            charges: { max: 20 },
            onDepleted: { losePropertyOn: 1 },
          },
        },
      }),
    ).toThrow(/losePropertyOn requires .*roll/);
  });

  it('rejects transitions that combine success effects with onFailure', () => {
    expect(() =>
      validate({
        effects: [castEffect('success', 'spell:magic-missile')],
        stateMachine: {
          initial: 'ready',
          states: [{ id: 'ready' }, { id: 'done' }],
          transitions: [
            {
              from: 'ready',
              to: 'done',
              via: 'activate',
              effects: ['success'],
              onFailure: {
                retryAfter: { amount: 1, unit: 'round' },
                scope: 'item',
              },
            },
          ],
        },
      }),
    ).toThrow(/cannot declare both effects and onFailure/);
  });

  it('accepts staff-of-fire shared charges and operation/effect bindings', () => {
    const mechanics = {
      activation: { cost: 'action', commandWord: true },
      economies: {
        charges: {
          kind: 'charges',
          charges: { max: 10 },
          reset: [{ at: 'dawn', amount: '1d6+4' }],
          onDepleted: { roll: '1d20', destroyedOn: 1 },
        },
      },
      operations: [
        {
          id: 'cast-burning-hands',
          cost: [{ economy: 'charges', amount: 1 }],
          effects: ['burning-hands'],
        },
        {
          id: 'cast-fireball',
          cost: [{ economy: 'charges', amount: 3 }],
          effects: ['fireball'],
        },
        {
          id: 'cast-wall-of-fire',
          cost: [{ economy: 'charges', amount: 4 }],
          effects: ['wall-of-fire'],
        },
      ],
      effects: [
        castEffect('burning-hands', 'spell:burning-hands'),
        castEffect('fireball', 'spell:fireball'),
        castEffect('wall-of-fire', 'spell:wall-of-fire'),
      ],
    };
    expect(() => validate(mechanics)).not.toThrow();
    expect(isStatefulMagicItemMechanics(mechanics)).toBe(true);
  });

  it('accepts rod-of-lordly-might independent economies and form state', () => {
    const perDay = {
      kind: 'per-day',
      perDay: { uses: 1 },
      reset: [{ at: 'dawn', amount: 'all' }],
    };
    expect(() =>
      validate({
        economies: {
          'drain-life': perDay,
          paralyze: perDay,
          terrify: perDay,
        },
        operations: [
          { id: 'drain-life', cost: [{ economy: 'drain-life', amount: 1 }] },
          { id: 'paralyze', cost: [{ economy: 'paralyze', amount: 1 }] },
          { id: 'terrify', cost: [{ economy: 'terrify', amount: 1 }] },
          { id: 'select-form' },
        ],
        stateMachine: {
          initial: 'mace',
          states: [
            { id: 'mace' },
            { id: 'flame-tongue' },
            { id: 'battleaxe' },
            { id: 'spear' },
            { id: 'climbing-pole' },
            { id: 'battering-ram' },
          ],
          transitions: [
            { from: 'mace', to: 'flame-tongue', via: 'select-form' },
            { from: 'flame-tongue', to: 'mace', via: 'select-form' },
          ],
        },
      }),
    ).not.toThrow();
  });

  it('accepts winged-boots duration budget and partial regain', () => {
    expect(() =>
      validate({
        economies: {
          'flight-budget': {
            kind: 'budget',
            budget: {
              total: { amount: 4, unit: 'hour' },
              increment: { amount: 1, unit: 'minute' },
            },
            reset: [
              {
                at: 'per-period',
                period: { amount: 12, unit: 'hour' },
                amount: { amount: 2, unit: 'hour' },
                onlyIfUnused: true,
              },
            ],
          },
        },
        operations: [
          {
            id: 'fly',
            cost: [{ economy: 'flight-budget', amount: 'variable' }],
            effects: ['flight'],
          },
        ],
        effects: [{ id: 'flight', kind: 'speedSet', mode: 'fly', value: 30 }],
      }),
    ).not.toThrow();
  });

  it('preserves valid rolled durations and rejects malformed duration dice', () => {
    expect(() =>
      validate({
        economies: {
          portal: {
            kind: 'cooldown',
            cooldown: { duration: { amount: '1d8', unit: 'hour' } },
          },
          wings: {
            kind: 'cooldown',
            cooldown: { duration: { amount: '1d12', unit: 'hour' } },
          },
        },
      }),
    ).not.toThrow();
    expect(() =>
      validate({
        economies: {
          portal: {
            kind: 'cooldown',
            cooldown: { duration: { amount: 'eventually', unit: 'hour' } },
          },
        },
      }),
    ).toThrow(/amount must be a dice expression/);
  });

  it('accepts a stateless potion consume operation and legacy id-less passives', () => {
    const potion = {
      activation: { cost: 'consume' },
      operations: [{ id: 'drink', effects: ['healing'] }],
      effects: [{ id: 'healing', kind: 'healing', dice: '2d4+2' }],
    };
    expect(() => validate(potion)).not.toThrow();
    expect(isStatefulMagicItemMechanics(potion)).toBe(false);
    expect(() => validate({ effects: [{ kind: 'hover' }] })).not.toThrow();
  });

  it('accepts ring-of-spell-storing state and random initial levels', () => {
    const mechanics = {
      operations: [{ id: 'store-spell' }, { id: 'cast-stored-spell' }],
      spellStore: {
        contracts: [
          {
            id: 'ring-spells',
            kind: 'spell-storage',
            capacityLevels: 5,
            maximumSpellLevel: 5,
            casterOfRecord: 'creature that stored the spell',
            storeOn: { cost: 'free', trigger: 'spell cast into the ring' },
            castOut: { cost: 'spell-normal-casting-time' },
            operationIds: ['store-spell', 'cast-stored-spell'],
            initialLevels: '1d6-1',
          },
        ],
      },
      randomProcedure: {
        procedures: [
          {
            id: 'initial-spell-levels',
            kind: 'initial-state',
            trigger: 'ring is found',
            roll: '1d6-1',
            outcome: 'initialize the levels of stored spells',
          },
        ],
      },
    };
    expect(() => validate(mechanics)).not.toThrow();
    expect(isStatefulMagicItemMechanics(mechanics)).toBe(true);
  });

  it('accepts the remaining orthogonal contract blocks', () => {
    expect(() =>
      validate({
        economies: {
          'five-days': {
            kind: 'cooldown',
            cooldown: { duration: { amount: 5, unit: 'day' } },
          },
          reroll: { kind: 'per-day', perDay: { uses: 1 } },
        },
        effects: [{ id: 'curse-rider', kind: 'hover' }],
        entityGrant: {
          runtimeOwner: 'encounter-combatant',
          grants: [
            {
              id: 'bronze-griffon',
              kind: 'creature',
              statBlockRef: 'creature:griffon',
              count: 1,
              control: 'obeys spoken commands',
              duration: { amount: 6, unit: 'hour' },
              revertOn: ['duration expires', 'reduced to 0 hit points'],
              cooldownEconomy: 'five-days',
              exclusiveInstance: { scope: 'item', recast: 'blocked' },
            },
            {
              id: 'generic-object',
              kind: 'object',
              count: '1d4',
              note: 'Source defines the conjured generic object without a stat block.',
            },
          ],
        },
        containment: {
          mode: 'cells',
          tracksOccupancy: true,
          capacity: { count: 12 },
          cells: {
            count: 12,
            occupantsPerCell: 1,
            environment: 'infinite fog-filled extradimensional expanse',
            noAging: true,
            noNeeds: ['food', 'drink', 'sleep'],
            overflowRelease: 'random-occupant',
          },
          rupture: {
            triggers: ['shattered'],
            destroysItem: true,
            contentsDestination: 'unoccupied spaces near the mirror',
          },
          release: {
            activation: { cost: 'action', commandWord: true },
            result: 'release one named creature or numbered cell',
          },
        },
        curse: {
          revealedBy: ['identify spell'],
          endedBy: ['remove curse'],
          blocksUnattune: true,
          effects: ['curse-rider'],
        },
        rollManipulation: {
          transforms: [
            {
              id: 'reroll-attack',
              kind: 'reroll',
              roll: 'attack roll',
              trigger: 'after the attack roll',
              operationId: 'reroll-attack',
              limitEconomy: 'reroll',
              replacement: 'use the second roll',
            },
          ],
        },
        operations: [{ id: 'reroll-attack' }],
        interItem: {
          requiresItems: [
            {
              itemRefs: [
                'magic-item:gauntlets-of-ogre-power',
                'magic-item:belt-of-giant-strength',
              ],
              allRequired: true,
              state: 'worn',
            },
          ],
        },
      }),
    ).not.toThrow();
  });

  it('validates multi-grant source references and statefulness per grant', () => {
    const mechanics = {
      economies: {
        cooldown: {
          kind: 'cooldown',
          cooldown: { duration: { amount: 1, unit: 'day' } },
        },
      },
      entityGrant: {
        runtimeOwner: 'persistent-actor',
        grants: [
          {
            id: 'selected-creature',
            kind: 'creature',
            creatureRefs: ['creature:elk', 'creature:giant-goat'],
            tableRefs: ['table:figurine-options'],
            cooldownEconomy: 'cooldown',
            exclusiveInstance: { scope: 'owner', recast: 'dismiss-existing' },
          },
        ],
      },
    };
    expect(() => validate(mechanics)).not.toThrow();
    expect(isStatefulMagicItemMechanics(mechanics)).toBe(true);
    expect(
      isStatefulMagicItemMechanics({
        entityGrant: {
          runtimeOwner: 'illusory-entity',
          grants: [{ id: 'image', kind: 'illusion', note: 'generic image' }],
        },
      }),
    ).toBe(false);
  });

  it.each([
    [
      'duplicate definition ids',
      [
        { id: 'same', onset: 'attunement', note: 'first' },
        { id: 'same', onset: 'attunement', note: 'second' },
      ],
      /id must be unique/,
    ],
    [
      'unknown effect id',
      [{ id: 'curse', onset: 'attunement', effects: ['missing'] }],
      /unknown effect/,
    ],
    [
      'unknown onset operation',
      [{ id: 'curse', onset: 'operation:missing', note: 'state' }],
      /onset references unknown operation/,
    ],
    [
      'replacement availability without exclusivity',
      [
        {
          id: 'oath',
          onset: 'attunement',
          endsOn: [
            { trigger: 'target-dies', replacementAvailable: 'next-dawn' },
          ],
        },
      ],
      /requires an exclusive definition/,
    ],
    [
      'invalid exclusive scope',
      [
        {
          id: 'oath',
          onset: 'attunement',
          exclusive: { scope: 'campaign', group: 'oath', recast: 'blocked' },
        },
      ],
      /scope must be item-instance or character/,
    ],
    [
      'stack maximum below increment',
      [
        {
          id: 'wound',
          onset: 'hit',
          stack: {
            counterId: 'wounds',
            increment: 2,
            maximum: 1,
            clears: 'all',
          },
        },
      ],
      /maximum must be >= increment/,
    ],
    [
      'unknown live-state field',
      [{ id: 'curse', onset: 'attunement', attachedTo: 'pc-1' }],
      /unsupported key "attachedTo"/,
    ],
  ])('rejects curse state definitions with %s', (_name, definitions, error) => {
    expect(() =>
      validate({ curse: { stateDefinitions: definitions } }),
    ).toThrow(error as RegExp);
  });

  it('accepts operation-bound exclusive and stacking curse definitions', () => {
    expect(() =>
      validate({
        effects: [{ id: 'penalty', kind: 'hover' }],
        operations: [{ id: 'apply-curse' }, { id: 'clear-curse' }],
        curse: {
          stateDefinitions: [
            {
              id: 'exclusive-oath',
              onset: 'operation:apply-curse',
              effects: ['penalty'],
              endsOn: [
                {
                  trigger: 'successful-operation:clear-curse',
                  replacementAvailable: 'immediate',
                },
              ],
              exclusive: {
                scope: 'item-instance',
                group: 'exclusive-oath',
                recast: 'blocked',
              },
            },
            {
              id: 'stacking-wound',
              onset: 'weapon hit',
              stack: {
                counterId: 'wounds',
                increment: 1,
                maximum: 6,
                clears: 'all',
              },
              note: 'Counter values are live target state.',
            },
          ],
        },
      }),
    ).not.toThrow();
  });

  it('validates explicit attunement lifecycle state references', () => {
    expect(() =>
      validate({
        curse: {
          attunement: { attachesStates: ['persistent-curse'] },
          possession: {
            blocksVoluntaryRelinquishmentWhileStates: ['persistent-curse'],
          },
          stateDefinitions: [
            {
              id: 'persistent-curse',
              onset: 'attunement',
              note: 'persists until removed',
            },
          ],
        },
      }),
    ).not.toThrow();
    expect(() =>
      validate({
        curse: {
          attunement: { attachesStates: ['missing-state'] },
          stateDefinitions: [
            { id: 'other-state', onset: 'attunement', note: 'fixture' },
          ],
        },
      }),
    ).toThrow(/references unknown state "missing-state"/);
    expect(() =>
      validate({
        curse: {
          possession: {
            blocksVoluntaryRelinquishmentWhileStates: ['missing-state'],
          },
          stateDefinitions: [
            { id: 'other-state', onset: 'attunement', note: 'fixture' },
          ],
        },
      }),
    ).toThrow(/possession.*references unknown state "missing-state"/);
    expect(() =>
      validate({
        curse: {
          attunement: { preconditionEffects: ['missing-effect'] },
        },
      }),
    ).toThrow(/preconditionEffects references unknown effect "missing-effect"/);
  });

  it.each([
    [
      'unknown runtime owner',
      {
        runtimeOwner: 'item-state',
        grants: [{ id: 'x', kind: 'object', note: 'x' }],
      },
      /runtimeOwner/,
    ],
    [
      'empty grants',
      { runtimeOwner: 'encounter-combatant', grants: [] },
      /non-empty array/,
    ],
    [
      'duplicate grant ids',
      {
        runtimeOwner: 'encounter-combatant',
        grants: [
          { id: 'same', kind: 'object', note: 'first' },
          { id: 'same', kind: 'object', note: 'second' },
        ],
      },
      /id must be unique/,
    ],
    [
      'missing source binding',
      {
        runtimeOwner: 'encounter-combatant',
        grants: [{ id: 'x', kind: 'creature' }],
      },
      /must declare statBlockRef, creatureRefs, tableRefs, or an explicit note/,
    ],
    [
      'wrong creature ref kind',
      {
        runtimeOwner: 'encounter-combatant',
        grants: [
          { id: 'x', kind: 'creature', creatureRefs: ['spell:find-familiar'] },
        ],
      },
      /creatureRefs/,
    ],
    [
      'malformed count dice',
      {
        runtimeOwner: 'encounter-combatant',
        grants: [
          { id: 'x', kind: 'creature', note: 'generic', count: 'several' },
        ],
      },
      /dice expression/,
    ],
    [
      'unknown cooldown economy',
      {
        runtimeOwner: 'encounter-combatant',
        grants: [
          {
            id: 'x',
            kind: 'creature',
            note: 'generic',
            cooldownEconomy: 'missing',
          },
        ],
      },
      /unknown economy/,
    ],
    [
      'invalid exclusivity enum',
      {
        runtimeOwner: 'encounter-combatant',
        grants: [
          {
            id: 'x',
            kind: 'creature',
            note: 'generic',
            exclusiveInstance: { scope: 'campaign', recast: 'replace' },
          },
        ],
      },
      /scope must be item or owner/,
    ],
    [
      'unknown grant field',
      {
        runtimeOwner: 'encounter-combatant',
        grants: [{ id: 'x', kind: 'creature', note: 'generic', liveHp: 12 }],
      },
      /unsupported key "liveHp"/,
    ],
  ])('rejects entity grant %s', (_name, entityGrant, message) => {
    expect(() => validate({ entityGrant })).toThrow(message as RegExp);
  });

  it.each([
    [
      'unknown economy',
      {
        operations: [{ id: 'cast', cost: [{ economy: 'charges', amount: 1 }] }],
      },
      /unknown economy/,
    ],
    [
      'unknown non-expenditure economy',
      {
        economies: {
          thunder: { kind: 'per-day', perDay: { uses: 1 } },
        },
        operations: [{ id: 'combined', doesNotExpend: ['lightning'] }],
      },
      /doesNotExpend references unknown economy/,
    ],
    [
      'unknown effect',
      { operations: [{ id: 'cast', effects: ['fireball'] }] },
      /unknown effect/,
    ],
    [
      'id-less bound effect',
      {
        operations: [{ id: 'use', effects: ['passive'] }],
        effects: [{ kind: 'hover' }],
      },
      /unknown effect/,
    ],
    [
      'malformed duration',
      {
        economies: {
          flight: {
            kind: 'cooldown',
            cooldown: { duration: { amount: 5, unit: 'weeks' } },
          },
        },
      },
      /unit must be one of/,
    ],
    [
      'malformed dice',
      {
        economies: {
          charges: {
            kind: 'charges',
            charges: { max: 10 },
            reset: [{ at: 'dawn', amount: 'lots' }],
          },
        },
      },
      /dice expression/,
    ],
    [
      'unknown top-level field',
      { liveCharges: 7 },
      /unsupported key "liveCharges"/,
    ],
    [
      'unknown nested field',
      { activation: { cost: 'action', mutable: true } },
      /unsupported key "mutable"/,
    ],
  ])('rejects %s', (_name, mechanics, message) => {
    expect(() => validate(mechanics as Record<string, unknown>)).toThrow(
      message as RegExp,
    );
  });

  it('rejects malformed and dangling state-machine references', () => {
    expect(() =>
      validate({
        stateMachine: {
          initial: 'missing',
          states: [{ id: 'inactive' }, { id: 'active' }],
          transitions: [
            {
              from: 'inactive',
              to: 'active',
              timer: { amount: 1, unit: 'round' },
              condition: 'also supplied',
            },
          ],
        },
      }),
    ).toThrow(/initial references unknown state/);
    expect(() =>
      validate({
        stateMachine: {
          initial: 'inactive',
          states: [{ id: 'inactive' }, { id: 'active' }],
          transitions: [
            {
              from: 'inactive',
              to: 'active',
              timer: { amount: 1, unit: 'round' },
              condition: 'also supplied',
            },
          ],
        },
      }),
    ).toThrow(/exactly one of via, timer, or condition/);
    expect(() =>
      validate({
        stateMachine: {
          initial: 'inactive',
          states: [{ id: 'inactive' }, { id: 'active' }],
          transitions: [
            { from: 'inactive', to: 'active', via: 'missing-operation' },
          ],
        },
      }),
    ).toThrow(/via references unknown operation/);
  });

  it('implements the stateful-singleton classification without mutable state', () => {
    expect(isStatefulMagicItemMechanics(undefined)).toBe(false);
    expect(isStatefulMagicItemMechanics({}, true)).toBe(true);
    expect(
      isStatefulMagicItemMechanics({
        economies: { use: { kind: 'single-use' } },
      }),
    ).toBe(false);
    expect(
      isStatefulMagicItemMechanics({
        economies: { use: { kind: 'at-will' } },
      }),
    ).toBe(false);
    expect(
      isStatefulMagicItemMechanics({
        containment: {
          mode: 'creature-prison',
          tracksOccupancy: true,
          capacity: { count: 1 },
        },
      }),
    ).toBe(true);
  });
});
