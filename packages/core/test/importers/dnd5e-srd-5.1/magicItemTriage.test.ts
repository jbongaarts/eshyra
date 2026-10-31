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
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COOLDOWN_ANCHORS,
  EQUIPMENT_EXTRA,
  equipmentFromPrintedText,
  GRANT_SPANS,
  KEPT_EXTERNAL_EVENT_MACHINES,
  KEPT_GATE_MACHINES,
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
const activationCensus = JSON.parse(
  readFileSync(
    new URL(
      '../../../scripts/importers/dnd5e-srd-5.1/magicItemActivationCensus.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as {
  scope: string;
  operation: string;
  cost: string | null;
  equipment: unknown;
  costSentence: string | string[] | null;
  equipmentSentences: string[];
  noneReason: { cost: string | null; equipment: string | null };
}[];
const operations = (scope: Scope): Obj[] =>
  (scope.mechanics.operations as Obj[] | undefined) ?? [];
const costRow = (scope: string, operation: string) => {
  const row = activationCensus.find(
    (entry) => entry.scope === scope && entry.operation === operation,
  );
  if (row === undefined)
    throw new Error(`no activation census row ${scope}/${operation}`);
  return row;
};

// Pipes of the Sewers first states the required action used to play the pipes,
// then separately assigns the swarm-calling operation its bonus action. Both
// costs govern this one operation, so both printed tokens are legitimate.
const DUAL_COST_SENTENCE_ALLOWLIST = new Map<string, string>([
  [
    'Pipes of the Sewers/call-rat-swarms',
    'The action is the playing prerequisite; the operation itself costs a bonus action.',
  ],
]);

describe('A. DM-adjudicated categories carry no typed predicate (whole corpus)', () => {
  it('matches the activation census for every parent and variant operation', () => {
    const actual = scopes.flatMap((scope) =>
      operations(scope).map((operation) => {
        const activation = operation.activation as Obj | undefined;
        return {
          scope: scope.label,
          operation: String(operation.id),
          cost: (activation?.cost as string | undefined) ?? null,
          equipment: activation?.equipment ?? null,
        };
      }),
    );
    // olc5.11.4 removes Rod of Alertness pull-rod and Cube of Force
    // spell-contact-loss: any-creature/external-event predicates are condition
    // transitions, not operations charged to the item owner.
    expect(activationCensus).toHaveLength(350);
    expect(actual).toHaveLength(activationCensus.length);
    const censusByKey = new Map(
      activationCensus.map((row) => [`${row.scope}/${row.operation}`, row]),
    );
    for (const row of actual) {
      const expected = censusByKey.get(`${row.scope}/${row.operation}`);
      expect(expected, `${row.scope}/${row.operation}`).toBeDefined();
      expect(
        { cost: row.cost, equipment: row.equipment },
        `${row.scope}/${row.operation}`,
      ).toEqual({ cost: expected?.cost, equipment: expected?.equipment });
      if (expected?.cost !== null) {
        const sentences = Array.isArray(expected?.costSentence)
          ? expected.costSentence
          : [expected?.costSentence as string];
        expect(
          sentences.length,
          `${row.scope}/${row.operation}`,
        ).toBeGreaterThan(0);
        for (const sentence of sentences)
          expect(description(row.scope.split('::')[0] as string)).toContain(
            sentence,
          );
      } else expect(expected?.noneReason.cost).toBeTruthy();
      if (expected?.equipment !== null) {
        expect(expected?.equipmentSentences.length).toBeGreaterThan(0);
        for (const sentence of expected?.equipmentSentences ?? [])
          expect(description(row.scope.split('::')[0] as string)).toContain(
            sentence,
          );
      } else expect(expected?.noneReason.equipment).toBeTruthy();
    }
    expect(censusByKey.get('Winged Boots/fly')?.equipment).toEqual([['worn']]);
  });

  it('keeps every typed cost citation free of contradictory printed costs', () => {
    const tokenCosts = (sentence: string): Set<string> => {
      const lower = sentence.toLowerCase();
      const costs = new Set<string>();
      if (/\bbonus action\b/.test(lower)) costs.add('bonus-action');
      if (/\breaction\b/.test(lower)) costs.add('reaction');
      if (/\bno action required\b|\bwithout using an action\b/.test(lower))
        costs.add('free');
      if (/(?<!bonus )\baction\b/.test(lower) && !costs.has('free'))
        costs.add('action');
      return costs;
    };

    for (const row of activationCensus) {
      if (row.cost === null || row.cost === 'consume') continue;
      const label = `${row.scope}/${row.operation}`;
      const sentences = Array.isArray(row.costSentence)
        ? row.costSentence
        : [row.costSentence ?? ''];
      expect(sentences.length, label).toBeGreaterThan(0);
      for (const sentence of sentences) {
        expect(sentence, label).toBeTruthy();
        const printedCosts = tokenCosts(sentence);
        expect(printedCosts.has(row.cost), label).toBe(true);
        if (printedCosts.size > 1) {
          // Every mixed-cost exception must name its allowed cost and explain
          // why both printed costs govern this operation.
          expect(DUAL_COST_SENTENCE_ALLOWLIST.has(label), label).toBe(true);
          expect(
            DUAL_COST_SENTENCE_ALLOWLIST.get(label),
            `${label} allowlist rationale`,
          ).toBeTruthy();
        } else {
          expect(printedCosts, label).toEqual(new Set([row.cost]));
        }
      }
    }
  });

  it('binds representative costs to the operation and variant that print them', () => {
    const expected = [
      [
        'Luck Blade',
        'cast-wish',
        'Wish. The sword has 1d4 – 1 charges. While holding it, you can use an action to expend 1 charge and cast the wish spell from it.',
      ],
      [
        'Rod of Lordly Might',
        'terrify',
        'Terrify. While holding the rod, you can use an action to force each creature you can see within 30 feet of you to make a DC 17 Wisdom saving throw.',
      ],
      [
        'Dancing Sword',
        'launch-sword',
        'You can use a bonus action to toss this magic sword into the air and speak the command word.',
      ],
      [
        'Dancing Sword',
        'command-attack',
        'While the sword hovers, you can use a bonus action to cause it to fly up to 30 feet to another spot within 30 feet of you.',
      ],
      [
        'Eversmoking Bottle',
        'close-bottle',
        'Closing the bottle requires you to speak its command word as an action.',
      ],
      [
        'Ring of the Ram',
        'break-object',
        'Alternatively, you can expend 1 to 3 of the ring’s charges as an action to try to break an object you can see within 60 feet of you that isn’t being worn or carried.',
      ],
      [
        'Ioun Stone::Greater Absorption',
        'm9-cancel-ioun-greater-absorption',
        'While this marbled lavender and green ellipsoid orbits your head, you can use your reaction to cancel a spell of 8th level or lower cast by a creature you can see and targeting only you.',
      ],
      [
        'Crystal Ball::Crystal Ball of Telepathy',
        'cast-suggestion',
        'You can also use an action to cast the suggestion spell (save DC 17) through the sensor on one of those creatures.',
      ],
    ] as const;

    for (const [scope, operation, sentence] of expected) {
      const row = costRow(scope, operation);
      expect(row.costSentence, `${scope}/${operation}`).toBe(sentence);
      expect(description(scope.split('::')[0] as string)).toContain(sentence);
    }

    expect(costRow('Feather Token', 'use-token').costSentence).toEqual([
      'Anchor. You can use an action to touch the token to a boat or ship.',
      'Bird. You can use an action to toss the token 5 feet into the air.',
      'Fan. If you are on a boat or ship, you can use an action to toss the token up to 10 feet in the air.',
      'Swan Boat. You can use an action to touch the token to a body of water at least 60 feet in diameter.',
      'Tree. You must be outdoors to use this token. You can use an action to touch it to an unoccupied space on the ground.',
      'Whip. You can use an action to throw the token to a point within 10 feet of you.',
    ]);
  });

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
    ]);
    let typed = 0;
    for (const scope of scopes) {
      const machine = scope.mechanics.stateMachine as Obj | undefined;
      if (machine === undefined) continue;
      typed += 1;
      expect(
        KEPT_STATE_MACHINES.has(scope.label) ||
          KEPT_EXTERNAL_EVENT_MACHINES.has(scope.label) ||
          KEPT_GATE_MACHINES.has(scope.label),
        scope.label,
      ).toBe(true);
      if (
        !CONSUMER_BOUND.has(scope.label) &&
        !KEPT_EXTERNAL_EVENT_MACHINES.has(scope.label) &&
        !KEPT_GATE_MACHINES.has(scope.label)
      )
        expect(
          (machine.states as Obj[]).length,
          `${scope.label} is a simple two-state toggle`,
        ).toBe(2);
    }
    expect(typed).toBe(
      KEPT_STATE_MACHINES.size +
        KEPT_EXTERNAL_EVENT_MACHINES.size +
        KEPT_GATE_MACHINES.size,
    );
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
    expect(operationCount).toBe(350);
    expect(activations + withoutActivation).toBe(operationCount);
    expect(equipment).toBe(129);
    // 21 activation-entered machines + the Ring of Djinni Summoning's external
    // event machine (eshyra-olc5.15) + the Candle of Invocation's lit/unlit
    // gate machine (eshyra-7f0h).
    expect(scopes.filter((s) => s.mechanics.stateMachine).length).toBe(23);
    expect(scopes.filter((s) => s.mechanics.containment).length).toBe(1);
    expect(scopes.filter((s) => s.mechanics.entityGrant).length).toBe(16);
  });
});

describe('B. kept typed fields are exact', () => {
  const CUES = {
    worn: /\b(?:wear|wearing|wears|worn)\b/i,
    held: /\bhold(?:ing)?\b|\bgrasping\b/i,
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
    expect(typed).toBe(129);
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
      variants: ['bronze-griffon'],
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

// ---------------------------------------------------------------------------
// Review 19.4.6.7 (eshyra-o9bd.19.4.6.8): S1 kept-field agreement incl. section
// headers and non-spell costs, S2 single-lifetime admission, S4 grant duration
// role. (S3, the soft-limit cost, is `itemSoftLimitCost.test.ts`.)
// ---------------------------------------------------------------------------

const operationOf = (name: string, id: string): Obj => {
  const found = scopes
    .filter((scope) => scope.label === name)
    .flatMap(operations)
    .find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`${name} has no operation ${id}`);
  return found;
};
const activationOf = (name: string, id: string): Obj =>
  (operationOf(name, id).activation as Obj | undefined) ?? {};

describe('D. kept activation fields agree with the governing printed passage, section headers and non-spell costs included (review 19.4.6.7 S1)', () => {
  type Row = readonly [
    scope: string,
    operation: string,
    equipment: readonly (readonly string[])[] | undefined,
    cost: string | undefined,
    governing: string,
  ];
  // Authority: the printed SRD sentence in the last column. Equipment is typed
  // when a worn / held / attuned / on-person gate governs the operation, even
  // through a section header or a continuing sentence; cost is typed when the
  // text prints a non-spell action type. Nothing is inferred beyond the print.
  const GOVERNED: readonly Row[] = [
    // The repaired members: the gate or the cost was not in a producer draft.
    [
      'Sun Blade',
      'manifest-blade',
      [['held']],
      'bonus-action',
      'While grasping the hilt, you can use a bonus action',
    ],
    [
      'Sun Blade',
      'dismiss-blade',
      [['held']],
      'bonus-action',
      'While grasping the hilt, you can use a bonus action',
    ],
    [
      'Scarab of Protection',
      'turn-failed-save-into-success',
      [['on-person']],
      'reaction',
      'It provides two benefits while it is on your person',
    ],
    [
      'Ring of Spell Turning',
      'm10-reflect-spell',
      [['worn']],
      undefined,
      'While wearing this ring, you have advantage on saving throws against any spell that targets only you',
    ],
    [
      'Dragon Scale Mail',
      'sense-nearest-dragon',
      undefined,
      'action',
      'you can focus your senses as an action',
    ],
    [
      'Well of Many Worlds',
      'open-portal',
      undefined,
      'action',
      'You can use an action to unfold and place the well of many worlds',
    ],
    // Header- and paragraph-scoped gates that were already right (controls).
    [
      'Helm of Brilliance',
      'cast-fireball',
      [['worn']],
      'action',
      'You gain the following benefits while wearing it',
    ],
    [
      'Cloak of Arachnida',
      'cast-web',
      [['worn']],
      'action',
      'While wearing it, you gain the following benefits',
    ],
    [
      'Trident of Fish Command',
      'cast-dominate-beast',
      [['on-person']],
      'action',
      'While you carry it',
    ],
    [
      'Talisman of Pure Good',
      'open-fissure',
      [['worn'], ['held']],
      'action',
      'If you are wearing or holding it',
    ],
    // Operations whose own passage prints no gate of its own: nothing typed.
    [
      'Ring of Mind Shielding',
      'hide-ring',
      undefined,
      'action',
      'You can use an action to cause the ring to become invisible',
    ],
    [
      'Armor of Invulnerability',
      'activate-immunity',
      undefined,
      'action',
      'you can use an action to make yourself immune to nonmagical damage',
    ],
    [
      'Ring of Invisibility',
      'become-visible',
      undefined,
      'bonus-action',
      'until you use a bonus action to become visible again',
    ],
  ];

  it.each(GOVERNED)(
    '%s %s: typed equipment and cost equal the governing printed passage',
    (scope, id, equipment, cost, governing) => {
      const item = scope.split('::')[0] as string;
      expect(description(item)).toContain(governing);
      const typed = activationOf(scope, id);
      expect(typed.equipment, `${scope} ${id} equipment`).toEqual(equipment);
      expect(typed.cost, `${scope} ${id} cost`).toEqual(cost);
      // A typed gate that came from a printed sentence is also carried verbatim.
      if (
        equipment !== undefined &&
        ['Sun Blade', 'Scarab of Protection', 'Ring of Spell Turning'].includes(
          item,
        )
      )
        expect(
          carries(item, governing),
          `${scope} ${id} carries the gate`,
        ).toBe(true);
    },
  );

  it('derives the equipment from the printed words, never from the operation name', () => {
    expect(
      equipmentFromPrintedText('While grasping the hilt', undefined),
    ).toEqual([['held']]);
    expect(
      equipmentFromPrintedText('while it is on your person', undefined),
    ).toEqual([['on-person']]);
    expect(
      equipmentFromPrintedText('While wearing this ring', undefined),
    ).toEqual([['worn']]);
    // Grasping is a trigger word elsewhere (Ioun Stone: ANOTHER creature
    // grasps the stone) and is never read from a trigger.
    expect(
      equipmentFromPrintedText(
        undefined,
        'another creature must use an action to grasp or net the stone',
      ),
    ).toEqual([]);
  });

  const ACTION_PHRASE =
    /\b(as an action|use an action|an action to|as a bonus action|use a bonus action|bonus action to|use your reaction)\b/i;
  const NAME_STOP = new Set([
    'cast',
    'use',
    'the',
    'and',
    'into',
    'end',
    'set',
  ]);
  /** Operations with no typed cost whose own printed sentence names an action
   * type: at least two words of the operation id (5-letter stems) appear in
   * one sentence that prints an action phrase. Spell casts are excluded: the
   * spell's own casting time supplies their cost. */
  function missingPrintedCosts(
    text: string,
    ops: readonly { id: string; cost?: string }[],
  ): string[] {
    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .filter((s) => ACTION_PHRASE.test(s));
    return ops
      .filter(({ id, cost }) => {
        if (cost !== undefined || /^(m\d+-)?cast-/.test(id)) return false;
        const words = id
          .replace(/^m\d+-/, '')
          .split('-')
          .filter((word) => word.length > 2 && !NAME_STOP.has(word));
        return sentences.some(
          (s) =>
            words.filter((w) => s.toLowerCase().includes(w.slice(0, 5)))
              .length >= 2,
        );
      })
      .map(({ id }) => id);
  }

  it('types the printed action cost of every non-spell operation whose own sentence prints one (sweep of all 350 operations)', () => {
    const missing: string[] = [];
    for (const scope of scopes)
      for (const id of missingPrintedCosts(
        description(scope.item),
        operations(scope).map((operation) => ({
          id: String(operation.id),
          ...((operation.activation as Obj | undefined)?.cost === undefined
            ? {}
            : { cost: String((operation.activation as Obj).cost) }),
        })),
      ))
        missing.push(`${scope.label}::${id}`);
    // Reviewed lexical false positive: the Staff of Charming failed-save flip
    // prints no action (the matching sentence is the staff's separate
    // charge-spending spell casts). The Apparatus's one action for up to two
    // levers is now typed once on move-levers (eshyra-7f0h).
    expect(missing.sort()).toEqual([
      'Staff of Charming::m10-flip-enchantment-save',
    ]);
  });

  it('keeps the cost screen able to fail (counterfactual: the pre-repair Dragon Scale Mail and Well of Many Worlds)', () => {
    expect(
      missingPrintedCosts(description('Dragon Scale Mail'), [
        { id: 'sense-nearest-dragon' },
      ]),
    ).toEqual(['sense-nearest-dragon']);
    expect(
      missingPrintedCosts(description('Well of Many Worlds'), [
        { id: 'open-portal' },
      ]),
    ).toEqual(['open-portal']);
    expect(
      missingPrintedCosts(description('Well of Many Worlds'), [
        { id: 'open-portal', cost: 'action' },
      ]),
    ).toEqual([]);
  });
});

describe('E. kept state machines own exactly one lifetime at a time (review 19.4.6.7 S2; bd memory refinement 2026-10-13)', () => {
  // One row per kept machine: the printed passage that shows the item owns a
  // single lifetime, and whether using the activation again while active is
  // refused (the same printed command, or nothing, ends/forbids it) or
  // re-applies it.
  const SINGLE_LIFETIME: readonly (readonly [
    string,
    'refused' | 'reapplies',
    string,
  ])[] = [
    ['Animated Shield', 'refused', 'The shield remains animated for 1 minute'],
    [
      'Boots of Speed',
      'refused',
      'If you click your heels together again, you end the effect',
    ],
    ['Cloak of the Bat', 'refused', 'transforming into a bat'],
    [
      'Cube of Force',
      'refused',
      'lasts for 1 minute, until you use an action to press the cube’s sixth face',
    ],
    [
      'Dagger of Venom',
      'refused',
      'The poison remains for 1 minute or until an attack using this weapon hits a creature',
    ],
    [
      'Flame Tongue',
      'refused',
      'The flames last until you use a bonus action to speak the command word again',
    ],
    [
      'Gem of Brightness',
      'refused',
      'It lasts until you use a bonus action to repeat the command word',
    ],
    [
      'Glamoured Studded Leather',
      'reapplies',
      'cause the armor to assume the appearance of a normal set of clothing or some other kind of armor',
    ],
    [
      'Immovable Rod',
      'refused',
      'Until you or another creature uses an action to push the button again, the rod doesn’t move',
    ],
    [
      'Ioun Stone',
      'refused',
      'You can use an action to seize and stow the stone, ending its effect',
    ],
    ['Potion of Diminution', 'refused', 'for 1d4 hours'],
    [
      'Potion of Gaseous Form',
      'refused',
      'for 1 hour (no concentration required) or until you end the effect as a bonus action',
    ],
    ['Potion of Growth', 'refused', 'for 1d4 hours'],
    [
      'Ring of Invisibility',
      'refused',
      'You remain invisible until the ring is removed',
    ],
    [
      'Ring of Mind Shielding',
      'refused',
      'You can use an action to cause the ring to become invisible until you use another action to make it visible',
    ],
    [
      'Rod of Alertness',
      'refused',
      'The rod’s head stops glowing and the effect ends after 10 minutes',
    ],
    [
      'Rope of Entanglement',
      'refused',
      'If the rope drops to 0 hit points, it is destroyed',
    ],
    [
      'Staff of the Woodlands',
      'refused',
      'While touching the tree and using another action to speak its command word, you return the staff to its normal form',
    ],
    [
      'Sun Blade',
      'refused',
      'to cause a blade of pure radiance to spring into existence, or make the blade disappear',
    ],
    [
      'Sword of Sharpness',
      'refused',
      'Speaking the command word again or sheathing the sword puts out the light',
    ],
    [
      'Wings of Flying',
      'refused',
      'for 1 hour or until you repeat the command word as an action',
    ],
  ];

  const machineOfScope = (name: string): Obj =>
    scopes.find((scope) => scope.label === name)?.mechanics.stateMachine as Obj;

  it('is exactly the reviewed single-lifetime set, with a printed owner for each', () => {
    expect(new Set(SINGLE_LIFETIME.map(([name]) => name))).toEqual(
      KEPT_STATE_MACHINES,
    );
    for (const [name, , printedOwner] of SINGLE_LIFETIME)
      expect(description(name), name).toContain(printedOwner);
  });

  it('classifies repeated use from the typed graph: only a printed re-application is a self-loop on its own activation', () => {
    for (const [name, repeat] of SINGLE_LIFETIME) {
      const machine = machineOfScope(name);
      const transitions = machine.transitions as Obj[];
      const activations = transitions.filter(
        (entry) => entry.via !== undefined && entry.from === machine.initial,
      );
      // The Rope of Entanglement is entered by a printed saving-throw outcome,
      // not by an activation; every other machine is entered by an operation.
      if (name !== 'Rope of Entanglement')
        expect(activations.length, name).toBeGreaterThan(0);
      const selfLoops = transitions.filter(
        (entry) =>
          entry.from === entry.to &&
          activations.some((a) => a.via === entry.via) &&
          entry.timer === undefined,
      );
      // Cube of Force switches faces (a different activation on the same
      // barrier); its same-face repeat is the declared source ambiguity.
      if (repeat === 'reapplies')
        expect(selfLoops.length, name).toBeGreaterThan(0);
      else if (name !== 'Cube of Force')
        expect(
          selfLoops.map((entry) => entry.via),
          name,
        ).toEqual([]);
    }
  });

  // An activation that creates repeatable or independently-timed instances
  // (a cloud per use, a flame per weapon, a set of spheres per use) is not a
  // single lifetime: no item-wide machine can state which instance ends.
  const MULTIPLIER =
    /\bone to (?:two|three|four)\b|\beach (?:sphere|swarm|cloud|weapon)\b|\bone weapon you are holding\b|\ba swarm of\b/i;

  it('no kept machine belongs to an item whose activation creates multiple instances; the three that do are DM-adjudicated', () => {
    for (const [name] of SINGLE_LIFETIME)
      expect(MULTIPLIER.test(description(name)), name).toBe(false);
    for (const name of [
      'Staff of Swarming Insects',
      'Helm of Brilliance',
      'Ring of Shooting Stars',
    ]) {
      expect(MULTIPLIER.test(description(name)), name).toBe(true);
      expect(KEPT_STATE_MACHINES.has(name), name).toBe(false);
      expect(WITHHELD.get(name)?.stateMachine, name).toBeDefined();
      expect(
        scopes.find((scope) => scope.label === name)?.mechanics.stateMachine,
        name,
      ).toBeUndefined();
    }
  });

  it('keeps the printed instance lifetimes verbatim and types each printed duration on the item power effect', () => {
    // Staff: "The insects remain for 10 minutes ... A wind of at least 10 miles
    // per hour disperses the swarm and ends the effect" -- one cloud per use.
    const staff = (scopes.find((s) => s.label === 'Staff of Swarming Insects')
      ?.mechanics.effects ?? []) as Obj[];
    expect(
      staff.find((effect) => effect.id === 'c2-create-insect-cloud-payload')
        ?.duration,
    ).toEqual({ amount: 10, unit: 'minute' });
    expect(
      carries('Staff of Swarming Insects', 'The insects remain for 10 minutes'),
    ).toBe(true);
    // Ring: "The spheres last as long as you concentrate ..., up to 1 minute".
    const ring = (scopes.find((s) => s.label === 'Ring of Shooting Stars')
      ?.mechanics.effects ?? []) as Obj[];
    const spheres = ring.find(
      (effect) => effect.id === 'c2-create-ball-lightning-payload',
    );
    expect(spheres?.duration).toEqual({ amount: 1, unit: 'minute' });
    expect(spheres?.concentrationRequired).toBe(true);
    expect(
      carries(
        'Ring of Shooting Stars',
        'The spheres last as long as you concentrate',
      ),
    ).toBe(true);
    // Helm: the flames have NO printed duration (they last until the command
    // word, a dropped or stowed weapon), so none is typed and the sentence is
    // carried for the DM; nothing is invented.
    const helm = (scopes.find((s) => s.label === 'Helm of Brilliance')
      ?.mechanics.effects ?? []) as Obj[];
    expect(
      helm.find(
        (effect) => effect.id === 'c2-static-helm-brilliance-weapon-flame',
      )?.duration,
    ).toBeUndefined();
    expect(
      carries(
        'Helm of Brilliance',
        'The flames last until you use a bonus action to speak the command word again or until you drop or stow the weapon',
      ),
    ).toBe(true);
  });

  it('projects finite durations from referenced spell records onto operation-bound item spell effects', () => {
    const spells = new Map(
      pack.records
        .filter((record) => record.kind === 'spell')
        .map((record) => [record.key, record]),
    );
    let checked = 0;
    for (const item of items) {
      const mechanics = (item.data as Obj).mechanics as Obj | undefined;
      if (mechanics === undefined) continue;
      const effects = (mechanics.effects as Obj[] | undefined) ?? [];
      const byId = new Map(effects.map((effect) => [effect.id, effect]));
      const operationEffectIds = new Set(
        ((mechanics.operations as Obj[] | undefined) ?? []).flatMap((op) =>
          Array.isArray(op.effects) ? (op.effects as string[]) : [],
        ),
      );
      for (const effectId of operationEffectIds) {
        const effect = byId.get(effectId);
        if (effect?.kind !== 'castSpell' || typeof effect.spellRef !== 'string')
          continue;
        const spell = spells.get(effect.spellRef);
        const spellData = spell?.data as Obj | undefined;
        const spellMechanics = spellData?.mechanics as Obj | undefined;
        const spellDuration = spellMechanics?.duration as Obj | undefined;
        if (spellDuration?.kind !== 'timed') continue;
        expect(effect.duration, `${item.key}#${effectId}`).toBeDefined();
        expect(effect.duration, `${item.key}#${effectId}`).toMatchObject({
          amount: expect.anything(),
          unit: expect.any(String),
        });
        checked += 1;
      }
    }
    expect(checked).toBe(94);
  });
});

describe('F. a kept grant duration or reversion times the creature existing, never its control (review 19.4.6.7 S4)', () => {
  const grantsOf = (name: string): Obj[] =>
    ((
      scopes.find((s) => s.label === name)?.mechanics.entityGrant as
        | Obj
        | undefined
    )?.grants ?? []) as Obj[];

  it('no kept grant reverts on a control clock', () => {
    let reverts = 0;
    for (const scope of scopes)
      for (const grant of ((scope.mechanics.entityGrant as Obj | undefined)
        ?.grants as Obj[]) ?? [])
        for (const event of (grant.revertOn as string[] | undefined) ?? []) {
          reverts += 1;
          expect(event, `${scope.label} ${String(grant.id)}`).not.toMatch(
            /control/i,
          );
        }
    expect(reverts).toBeGreaterThan(50);
  });

  it('Iron Flask: the creature persists and only the control paragraph is timed, so that paragraph stays printed text', () => {
    expect(grantsOf('Iron Flask')).toEqual([
      {
        id: 'released-flask-creature',
        kind: 'creature',
        tableRefs: ['table:iron-flask'],
        count: 1,
      },
    ]);
    expect(
      carries(
        'Iron Flask',
        'The creature is friendly to you and your companions for 1 hour and obeys your commands for that duration',
      ),
    ).toBe(true);
    expect(
      carries(
        'Iron Flask',
        'acts in accordance with its normal disposition and alignment',
      ),
    ).toBe(true);
    // The occupancy core item initialization binds is unchanged.
    expect(
      scopes.find((s) => s.label === 'Iron Flask')?.mechanics.containment,
    ).toEqual({
      mode: 'creature-prison',
      tracksOccupancy: true,
      capacity: { creatures: 1 },
    });
  });

  it('physical existence ends stay typed: the Horn of Valhalla returns to Valhalla after one hour', () => {
    expect(description('Horn of Valhalla')).toContain(
      'They return to Valhalla after 1 hour or when they drop to 0 hit points',
    );
    const horn = grantsOf('Horn of Valhalla')[0] as Obj;
    expect(horn.duration).toEqual({ amount: 1, unit: 'hour' });
    expect(horn.revertOn).toEqual([
      'one-hour-ended',
      'reduced-to-0-hit-points',
    ]);
  });
});
