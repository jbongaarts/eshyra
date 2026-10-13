/**
 * Magic-item non-effect triage (eshyra-o9bd.19.4.6.6; bd memory
 * magic-item-faithful-or-absent, refined 2026-10-12).
 *
 * Invariant: a non-effect magic-item structure stays TYPED and EXACT only where
 * a positive engine capability is likely soon (operation ids, economy cost
 * bindings, economies including event-anchored cooldowns, the printed action
 * type, the structured equipment prerequisite, simple active/inactive toggles
 * and the machines the executable operations bind to, entity-grant creature
 * references / count / duration / reversion); everything else is
 * DM-ADJUDICATED: the typed field is absent and an `adjudicated-by-design`
 * clause carries a VERBATIM span of the printed description.
 *
 * Authority is the printed SRD text of each item, never the generated pack.
 * Part A is the whole-corpus screen (the categories are absent or exact BY
 * CONSTRUCTION, not per reviewed example); part B pins the kept fields'
 * exactness; part C is the representative eligible/ineligible scenarios of each
 * kept category. The executable (green) operation set is pinned in
 * `magicItemOperationSourceAgreement.test.ts` (runtime safety).
 */
import { describe, expect, it } from 'vitest';
import {
  COOLDOWN_ANCHORS,
  EQUIPMENT_EXTRA,
  equipmentFromPrintedText,
  GRANT_SPANS,
  KEPT_STATE_MACHINES,
  OPERATION_SPANS,
  WITHHELD,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemTriage.js';
import { governingSpans } from '../../../scripts/importers/dnd5e-srd-5.1/magicItemTriageSpans.js';
import { getBundledDnd5eSrdPack } from '../../../src/internal.js';

type Obj = Record<string, unknown>;
const pack = getBundledDnd5eSrdPack();
const items = pack.records.filter((record) => record.kind === 'magic-item');
const byName = new Map(items.map((record) => [record.name, record]));

interface Scope {
  readonly label: string;
  readonly item: string;
  readonly mechanics: Obj;
}

const scopes: Scope[] = items.flatMap((record) => {
  const data = record.data as Obj;
  return [
    {
      label: record.name,
      item: record.name,
      mechanics: (data.mechanics as Obj | undefined) ?? {},
    },
    ...((data.variants as Obj[] | undefined) ?? []).map((variant) => ({
      label: `${record.name}::${String(variant.name)}`,
      item: record.name,
      mechanics: (variant.mechanics as Obj | undefined) ?? {},
    })),
  ];
});

const dataFor = (name: string): Obj => {
  const record = byName.get(name);
  if (record === undefined) throw new Error(`no item ${name}`);
  return record.data as Obj;
};
const description = (name: string): string => String(dataFor(name).description);
const clausesOf = (name: string): Obj[] =>
  (dataFor(name).executionReadiness as Obj).clauses as Obj[];
const adjudicatedSpans = (name: string): string[] =>
  clausesOf(name)
    .map((clause) => clause.representation as Obj)
    .filter((representation) => representation.adjudicated === true)
    .map((representation) => String(representation.sourceText));
const carries = (name: string, printed: string): boolean =>
  adjudicatedSpans(name).some((span) => span.includes(printed));
const operations = (scope: Scope): Obj[] =>
  (scope.mechanics.operations as Obj[] | undefined) ?? [];

describe('A. DM-adjudicated categories carry no typed predicate (whole corpus)', () => {
  it('types only cost, commandWord and equipment on every operation activation', () => {
    let seen = 0;
    for (const scope of scopes)
      for (const operation of operations(scope)) {
        const typed = operation.activation as Obj | undefined;
        if (typed === undefined) continue;
        seen += 1;
        expect(
          Object.keys(typed).filter(
            (key) => !['cost', 'commandWord', 'equipment'].includes(key),
          ),
          `${scope.label} ${String(operation.id)}`,
        ).toEqual([]);
      }
    expect(seen).toBeGreaterThan(250);
  });

  it('keeps no rollManipulation block anywhere and spellStore only as the stored-level counters item initialization binds and only the occupancy-bound Iron Flask containment', () => {
    for (const scope of scopes) {
      if (
        ![
          'Ring of Spell Storing',
          'Ioun Stone::Reserve',
          'Rod of Absorption',
        ].includes(scope.label)
      )
        expect(scope.mechanics.spellStore, scope.label).toBeUndefined();
      expect(scope.mechanics.rollManipulation, scope.label).toBeUndefined();
      if (scope.label === 'Iron Flask')
        expect(scope.mechanics.containment).toEqual({
          mode: 'creature-prison',
          tracksOccupancy: true,
          capacity: { creatures: 1 },
        });
      else expect(scope.mechanics.containment, scope.label).toBeUndefined();
    }
  });

  it('keeps only the allowed grant fields: no control prose, exclusivity, death consequence or note', () => {
    let grants = 0;
    for (const scope of scopes) {
      const block = scope.mechanics.entityGrant as Obj | undefined;
      if (block === undefined) continue;
      expect(block.note, scope.label).toBeUndefined();
      for (const grant of block.grants as Obj[]) {
        grants += 1;
        const where = `${scope.label} ${String(grant.id)}`;
        expect(grant.exclusiveInstance, where).toBeUndefined();
        expect(grant.onEntityDeath, where).toBeUndefined();
        expect(grant.note, where).toBeUndefined();
        if (grant.control !== undefined)
          expect(String(grant.control), where).toMatch(/^as spell:[a-z0-9-]+$/);
        // A kept grant always names what it creates.
        expect(
          grant.creatureRefs ?? grant.statBlockRef ?? grant.tableRefs,
          where,
        ).toBeDefined();
      }
    }
    expect(grants).toBeGreaterThan(25);
  });

  it('keeps a state machine only for the reviewed simple toggles and the green-bound machines', () => {
    const CONSUMER_BOUND = new Set([
      'Cube of Force',
      'Ioun Stone',
      'Rope of Entanglement',
      'Ring of Shooting Stars',
    ]);
    let typed = 0;
    for (const scope of scopes) {
      const machine = scope.mechanics.stateMachine as Obj | undefined;
      if (machine === undefined) continue;
      typed += 1;
      expect(KEPT_STATE_MACHINES.has(scope.label), scope.label).toBe(true);
      if (!CONSUMER_BOUND.has(scope.label))
        expect(
          (machine.states as Obj[]).length,
          `${scope.label} is a simple two-state toggle`,
        ).toBe(2);
    }
    expect(typed).toBe(KEPT_STATE_MACHINES.size);
    // Every withheld machine is absent and has its disposition table entry.
    for (const [scope, spans] of WITHHELD)
      if (spans.stateMachine !== undefined)
        expect(
          scopes.find((entry) => entry.label === scope)?.mechanics.stateMachine,
          scope,
        ).toBeUndefined();
  });

  it('gives every adjudicated clause a non-empty verbatim span of the item description', () => {
    let spans = 0;
    for (const record of items)
      for (const span of adjudicatedSpans(record.name)) {
        spans += 1;
        expect(span.length, record.name).toBeGreaterThan(0);
        expect(description(record.name), record.name).toContain(span);
      }
    expect(spans).toBeGreaterThanOrEqual(330);
  });

  it('carries every withheld block, stripped grant text and removed activation sentence as an adjudicated span', () => {
    const covered = (scope: string, text: string): boolean =>
      carries(scope.split('::')[0] as string, text);
    const withheldBlocks = ['containment', 'spellStore', 'rollManipulation'];
    for (const [scope, blocks] of WITHHELD) {
      const itemName = scope.split('::')[0] as string;
      const printed = description(itemName);
      for (const [block, anchors] of Object.entries(blocks)) {
        expect(
          withheldBlocks.concat(['stateMachine', 'entityGrant']),
        ).toContain(block);
        for (const anchor of anchors ?? []) {
          const [start, end] = typeof anchor === 'string' ? [anchor] : anchor;
          expect(printed, `${scope} ${block}`).toContain(start);
          expect(covered(scope, start as string), `${scope} ${block}`).toBe(
            true,
          );
          if (end !== undefined)
            expect(covered(scope, end), `${scope} ${block} end`).toBe(true);
        }
      }
    }
    for (const [item, anchors] of GRANT_SPANS)
      for (const text of governingSpans(
        description(item),
        anchors,
        `${item} grant`,
      ))
        expect(carries(item, text), `${item} grant control`).toBe(true);
    for (const [key, anchors] of OPERATION_SPANS) {
      const item = key.split('::')[0] as string;
      for (const text of governingSpans(description(item), anchors, key))
        expect(carries(item, text), key).toBe(true);
    }
  });

  it('is a census, not a sample: every kept and adjudicated structure of the pack is counted', () => {
    let activations = 0;
    let equipment = 0;
    let withoutActivation = 0;
    let operationCount = 0;
    for (const scope of scopes)
      for (const operation of operations(scope)) {
        operationCount += 1;
        const typed = operation.activation as Obj | undefined;
        if (typed === undefined) withoutActivation += 1;
        else activations += 1;
        if (typed?.equipment !== undefined) equipment += 1;
      }
    expect(operationCount).toBe(362);
    expect(activations + withoutActivation).toBe(operationCount);
    expect(equipment).toBe(124);
    expect(scopes.filter((s) => s.mechanics.stateMachine).length).toBe(24);
    expect(scopes.filter((s) => s.mechanics.containment).length).toBe(1);
    expect(scopes.filter((s) => s.mechanics.entityGrant).length).toBe(16);
  });
});

describe('B. kept typed fields are exact', () => {
  const CUES = {
    worn: /\b(?:wear|wearing|wears|worn)\b/i,
    held: /\bhold(?:ing)?\b/i,
    attuned: /\battuned\b|Requires Attunement/i,
    'on-person': /\bon your person\b|\bcarry\b/i,
  } as const;

  it('derives equipment only from a printed worn / held / attuned / on-person cue in the item text', () => {
    let typed = 0;
    for (const scope of scopes)
      for (const operation of operations(scope)) {
        const equipment = (operation.activation as Obj | undefined)
          ?.equipment as (keyof typeof CUES)[][] | undefined;
        if (equipment === undefined) continue;
        typed += 1;
        for (const kind of equipment.flat())
          expect(
            CUES[kind].test(adjudicatedSpans(scope.item).join(' ')) ||
              CUES[kind].test(description(scope.item)),
            `${scope.label} ${String(operation.id)} ${kind}`,
          ).toBe(true);
      }
    expect(typed).toBe(124);
    // The table-extra equipment gates are printed by a section header.
    for (const [key, kinds] of EQUIPMENT_EXTRA) {
      const item = key.split('::')[0] as string;
      for (const kind of kinds)
        expect(CUES[kind].test(adjudicatedSpans(item).join(' ')), key).toBe(
          true,
        );
    }
  });

  it('types a printed alternative ("wearing or holding it") as alternatives, never as a conjunction', () => {
    expect(
      equipmentFromPrintedText('If you are wearing or holding it', undefined),
    ).toEqual([['worn'], ['held']]);
    expect(equipmentFromPrintedText('While wearing it', undefined)).toEqual([
      ['worn'],
    ]);
    expect(
      equipmentFromPrintedText(
        'If you are a spellcaster holding the rod',
        undefined,
      ),
    ).toEqual([['held']]);
    expect(equipmentFromPrintedText('While attuned to it', undefined)).toEqual([
      ['attuned'],
    ]);
    expect(
      equipmentFromPrintedText('While this pearl is on your person', undefined),
    ).toEqual([['on-person']]);
    // A trigger contributes only a printed "while wearing it" qualifier.
    expect(
      equipmentFromPrintedText(
        undefined,
        'When you fail a Dexterity saving throw while wearing it',
      ),
    ).toEqual([['worn']]);
    expect(
      equipmentFromPrintedText(
        'Ring of Air Elemental Command',
        'If you help slay an air elemental while attuned to the ring',
      ),
    ).toEqual([]);
  });

  it('anchors the three event-anchored cooldowns to the printed termination event', () => {
    const economyOf = (name: string, id: string): Obj =>
      ((dataFor(name).mechanics as Obj).economies as Record<string, Obj>)[
        id
      ] as Obj;
    const startsOn = (name: string, id: string): unknown =>
      (economyOf(name, id).cooldown as Obj).startsOn;

    // Ring of Djinni Summoning: "After the djinni departs, it can't be summoned
    // again for 24 hours" -- the wait starts at the departure (grant reversion),
    // not at the summoning.
    expect(startsOn('Ring of Djinni Summoning', 'cooldown')).toEqual({
      event: 'grant-ended',
      grantId: 'particular-djinni',
    });
    expect(description('Ring of Djinni Summoning')).toContain(
      'After the djinni departs, it can’t be summoned again for 24 hours',
    );
    // Wings of Flying: "When they disappear, you can't use them again for 1d12
    // hours" -- the wait starts when the wings disappear (the machine's return
    // to inactive, by the one-hour timer or the repeated command word).
    expect(startsOn('Wings of Flying', 'cooldown')).toEqual({
      event: 'state-entered',
      stateId: 'inactive',
    });
    expect(description('Wings of Flying')).toContain(
      'When they disappear, you can’t use them again for 1d12 hours',
    );
    const wings = (
      (dataFor('Wings of Flying').mechanics as Obj).stateMachine as Obj
    ).transitions as Obj[];
    expect(
      wings
        .filter((entry) => entry.to === 'inactive')
        .map((e) => e.via ?? 'timer'),
    ).toEqual(['dismiss-wings', 'timer']);
    // Efreeti Bottle: the table row prints one hour's service, THEN the return
    // and a new stopper, THEN "The stopper can't be removed for 24 hours".
    expect(startsOn('Efreeti Bottle', 'stopper')).toEqual({
      event: 'grant-ended',
      grantId: 'serving-efreeti',
    });
    const table = pack.records.find(
      (record) => record.key === 'table:efreeti-bottle',
    );
    expect(JSON.stringify(((table?.data ?? {}) as Obj).rows)).toContain(
      'The stopper can’t be removed for 24 hours.',
    );
    expect(COOLDOWN_ANCHORS.size).toBe(2);
  });

  it('sweeps every cooldown economy: the rest are initiation-anchored by their printed sentence', () => {
    const initiation: Record<string, string> = {
      'Frost Brand': 'This property can be used no more than once per hour',
      'Horn of Valhalla': 'it can’t be used again until 7 days have passed',
      'Rod of Security':
        'The rod can’t be used again until ten days have passed',
      'Well of Many Worlds': 'it can’t do so again for 1d8 hours',
    };
    const found: string[] = [];
    for (const scope of scopes) {
      const economies = (scope.mechanics.economies ?? {}) as Record<
        string,
        Obj
      >;
      for (const [id, economy] of Object.entries(economies)) {
        if (economy.kind !== 'cooldown') continue;
        const anchored = (economy.cooldown as Obj).startsOn !== undefined;
        found.push(`${scope.label}:${id}:${anchored ? 'event' : 'initiation'}`);
        if (!anchored)
          expect(description(scope.item), scope.label).toContain(
            initiation[scope.item] ?? '<no reviewed initiation sentence>',
          );
      }
    }
    expect(found.sort()).toEqual([
      'Efreeti Bottle:stopper:event',
      'Frost Brand:cooldown:initiation',
      'Horn of Valhalla:cooldown:initiation',
      'Ring of Djinni Summoning:cooldown:event',
      'Rod of Security:cooldown:initiation',
      'Well of Many Worlds:cooldown:initiation',
      'Wings of Flying:cooldown:event',
    ]);
  });
});

describe('C. representative eligible / ineligible scenarios per kept category', () => {
  const operation = (name: string, id: string): Obj =>
    operations(scopes.find((scope) => scope.label === name) as Scope).find(
      (entry) => entry.id === id,
    ) as Obj;

  it('action type: typed only where printed, never defaulted', () => {
    // Printed "bonus action" / "reaction" / "action".
    expect(
      (operation('Flame Tongue', 'toggle-flames').activation as Obj).cost,
    ).toBe('bonus-action');
    expect(
      (
        operation('Gloves of Missile Snaring', 'snare-missile')
          .activation as Obj
      ).cost,
    ).toBe('reaction');
    // The wait-for-trigger sentence prints no action cost: none is typed.
    expect(
      operation('Nine Lives Stealer', 'slay-on-critical').activation,
    ).toBeUndefined();
    expect(
      operation('Sphere of Annihilation', 'sphere-space-entry').activation,
    ).toBeUndefined();
  });

  it('equipment: worn / held / attuned / on-person gates are structured, the other conjuncts stay printed', () => {
    // Eligible: a worn ring casts; ineligible by the typed gate: not worn.
    expect(
      (operation('Ring of Jumping', 'cast-jump').activation as Obj).equipment,
    ).toEqual([['worn']]);
    expect(
      (operation('Wand of Fear', 'command').activation as Obj).equipment,
    ).toEqual([['held']]);
    expect(
      (
        operation('Hammer of Thunderbolts', 'giant-slaying-critical')
          .activation as Obj
      ).equipment,
    ).toEqual([['attuned']]);
    // The ring's help-slay gate is not equipment; it is a printed sentence.
    expect(
      operation('Ring of Elemental Command', 'cast-fireball').activation as
        | Obj
        | undefined,
    ).toBeUndefined();
  });

  it('active-state toggles keep their printed duration or termination', () => {
    const shield = (
      (dataFor('Animated Shield').mechanics as Obj).stateMachine as Obj
    ).transitions as Obj[];
    expect(shield.find((entry) => entry.timer !== undefined)?.timer).toEqual({
      amount: 1,
      unit: 'minute',
    });
    const growth = (
      (dataFor('Potion of Growth').mechanics as Obj).stateMachine as Obj
    ).transitions as Obj[];
    expect(growth.find((entry) => entry.timer !== undefined)?.timer).toEqual({
      amount: '1d4',
      unit: 'hour',
    });
  });

  it('entity grants keep creature, count, duration and reversion, and the conjure elemental exception', () => {
    const griffon = (
      (
        (dataFor('Figurine of Wondrous Power').mechanics as Obj)
          .entityGrant as Obj
      ).grants as Obj[]
    ).find((grant) => grant.id === 'bronze-griffon') as Obj;
    expect(griffon).toEqual({
      id: 'bronze-griffon',
      kind: 'creature',
      creatureRefs: ['creature:griffon'],
      duration: { amount: 6, unit: 'hour' },
      revertOn: [
        'duration-ended',
        'reduced-to-0-hit-points',
        'owner-command-while-touching',
      ],
    });
    const elemental = (
      (
        (dataFor('Bowl of Commanding Water Elementals').mechanics as Obj)
          .entityGrant as Obj
      ).grants as Obj[]
    )[0] as Obj;
    expect(elemental.control).toBe('as spell:conjure-elemental');
    expect(elemental.revertOn).not.toContain('concentration-ended');
  });
});
