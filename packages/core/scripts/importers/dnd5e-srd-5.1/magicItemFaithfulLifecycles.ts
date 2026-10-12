/**
 * Faithful-or-absent state graphs, grant lifecycles, economies, procedures and
 * containment (eshyra-o9bd.19.4.6.2; bd memory magic-item-faithful-or-absent;
 * review groups S4, S5, S6 and S1.16-S1.18 of eshyra-o9bd.19.4.5.7).
 *
 * The family producers draft the candidate structures; this reviewed table is
 * applied on top of them (after the operations table). Every free-text claim
 * the table writes -- a transition `condition`, a machine `termination`, a
 * grant `control` / `note`, a containment trigger -- is a VERBATIM span of the
 * item's printed description, built only through `ctx.span` / `ctx.between`,
 * which throw when the text is not a substring. A structure the typed
 * vocabulary cannot state exactly is withheld: the block (or the operation that
 * only existed to drive it) is removed and its readiness clause becomes an
 * `adjudicated-by-design` clause carrying a verbatim `sourceText` span, so the
 * DM model interprets the printed text.
 *
 * Runtime safety: no operation the readiness preflight reports green is
 * removed or re-bound (the Ioun Stone `grab-orbiting-stone` operation keeps its
 * id and its absent state binding); `itemState` reads transitions only through
 * `from`/`to`/`via`/`timer`/`effects`, and every removed operation here was
 * never executable (blocked by an engine-pending clause).
 */
import type {
  MagicItemEconomy,
  MagicItemEntityGrant,
  MagicItemMechanics,
  MagicItemOperation,
  MagicItemStateMachine,
} from '../../../src/rules/magicItemMechanics.js';
import type {
  ItemClauseExpectation,
  MagicItemFamilyProjection,
} from './magicItemCompiler.js';
import { ownerIndex, ownerTag } from './magicItemFaithfulOperations.js';
import { type ActivationClause, clause } from './magicItemFaithfulSpecKit.js';
import type { MagicItemExtraction } from './types.js';

export interface LifecycleContext {
  readonly itemName: string;
  /** A verbatim span of the printed description, or throws. */
  readonly span: (text: string) => string;
  /** The contiguous verbatim span from `start` through `end`, or throws. */
  readonly between: (start: string, end: string) => string;
}

type Projections = readonly MagicItemFamilyProjection[];
type Transition = MagicItemStateMachine['transitions'][number];
type Grant = MagicItemEntityGrant['grants'][number];

interface LifecycleSpec {
  /** Edit the projections (mechanics blocks); may add or remove blocks. */
  readonly apply?: (
    projections: Projections,
    ctx: LifecycleContext,
  ) => Projections;
  /** Adjudicated clauses carrying printed sentences no typed field states. */
  readonly clauses?: (ctx: LifecycleContext) => readonly ActivationClause[];
}

const WITHHELD_NOTE =
  'The typed vocabulary cannot state this printed lifecycle exactly, so no typed structure is kept; the DM model interprets the printed text.';

function fail(item: string, message: string): never {
  throw new Error(`magic-item faithful lifecycles: ${item} ${message}`);
}

/** Apply `edit` to the unique mechanics block `name`; throws when absent. */
function editBlock<K extends keyof MagicItemMechanics>(
  projections: Projections,
  item: string,
  name: K,
  edit: (value: NonNullable<MagicItemMechanics[K]>) => MagicItemMechanics[K],
): Projections {
  let found = false;
  const result = projections.map((projection) => {
    const value = projection.mechanics[name];
    if (value === undefined) return projection;
    found = true;
    return {
      ...projection,
      mechanics: {
        ...projection.mechanics,
        [name]: edit(value as NonNullable<MagicItemMechanics[K]>),
      },
    };
  });
  if (!found) fail(item, `has no ${String(name)} block to edit`);
  return result;
}

function mapOperations(
  projections: Projections,
  edit: (
    operations: readonly MagicItemOperation[],
  ) => readonly MagicItemOperation[],
): Projections {
  return projections.map((projection) =>
    projection.mechanics.operations === undefined
      ? projection
      : {
          ...projection,
          mechanics: {
            ...projection.mechanics,
            operations: edit(projection.mechanics.operations),
          },
        },
  );
}

/** Remove operations an invented transition or lifecycle needed. */
function removeOperations(
  projections: Projections,
  item: string,
  ids: readonly string[],
): Projections {
  for (const id of ids)
    if (
      !projections.some((projection) =>
        (projection.mechanics.operations ?? []).some(
          (entry) => entry.id === id,
        ),
      )
    )
      fail(item, `cannot remove unknown operation ${id}`);
  return mapOperations(projections, (operations) =>
    operations.filter((entry) => !ids.includes(entry.id)),
  );
}

/** Remove a typed block whose clause becomes adjudicated-by-design. */
function withholdBlock(
  projections: Projections,
  item: string,
  block: 'stateMachine' | 'entityGrant' | 'containment' | 'randomProcedure',
  sourceText: string,
  note: string = WITHHELD_NOTE,
): Projections {
  let clauseFound = false;
  const result = projections.map((projection) => {
    if (projection.mechanics[block] === undefined) return projection;
    const { [block]: _removed, ...mechanics } = projection.mechanics;
    const clauses = projection.clauses.map((entry) => {
      const representation = entry.representation;
      if ('block' in representation && representation.block === block) {
        clauseFound = true;
        const { engineHooks: _hooks, ...rest } = entry;
        return {
          ...rest,
          representation: { adjudicated: true as const, note, sourceText },
        };
      }
      return entry;
    });
    return { ...projection, mechanics, clauses };
  });
  if (!clauseFound) fail(item, `has no ${block} readiness clause to withhold`);
  return result;
}

/** Remove a typed economy (and every operation cost that spends it) whose
 * identity the vocabulary cannot state; its readiness clause becomes
 * `adjudicated-by-design` carrying a verbatim printed span. */
function withholdEconomy(
  projections: Projections,
  item: string,
  economyId: string,
  sourceText: string,
  note: string,
): Projections {
  let clauseFound = false;
  const withoutEconomy = projections.map((projection) => {
    const economies = projection.mechanics.economies;
    const clauses = projection.clauses.map((entry) => {
      const representation = entry.representation;
      if (
        'block' in representation &&
        representation.block === 'economies' &&
        'economyId' in representation &&
        representation.economyId === economyId
      ) {
        clauseFound = true;
        const { engineHooks: _hooks, ...rest } = entry;
        return {
          ...rest,
          representation: { adjudicated: true as const, note, sourceText },
        };
      }
      return entry;
    });
    if (economies?.[economyId] === undefined) return { ...projection, clauses };
    const { [economyId]: _removed, ...remaining } = economies;
    const { economies: _old, ...mechanics } = projection.mechanics;
    return {
      ...projection,
      mechanics: {
        ...mechanics,
        ...(Object.keys(remaining).length === 0
          ? {}
          : { economies: remaining }),
      },
      clauses,
    };
  });
  if (!clauseFound)
    fail(item, `has no ${economyId} economy clause to withhold`);
  return mapOperations(withoutEconomy, (operations) =>
    operations.map((entry) => {
      const kept = (entry.cost ?? []).filter(
        (cost) => cost.economy !== economyId,
      );
      if (kept.length === (entry.cost ?? []).length) return entry;
      const { cost: _cost, ...rest } = entry;
      return kept.length === 0 ? rest : { ...rest, cost: kept };
    }),
  );
}

const transition = (
  from: string,
  to: string,
  rest: Omit<Transition, 'from' | 'to'> = {},
): Transition => ({ from, to, ...rest }) as Transition;

const FIGURINE_REVERT_OBEYED = [
  'duration-ended',
  'reduced-to-0-hit-points',
  'obeyed-owner-command-while-touching',
] as const;

const ELEMENTAL_VESSELS = [
  'Bowl of Commanding Water Elementals',
  'Brazier of Commanding Fire Elementals',
  'Censer of Controlling Air Elementals',
  'Stone of Controlling Earth Elementals',
  'Elemental Gem',
] as const;

const CONJURE_ELEMENTAL_NOTE =
  'Uses the conjure elemental spell lifecycle: the elemental disappears when it drops to 0 hit points or when the spell ends after one hour. If concentration is broken the elemental does not disappear; the summoner loses control, it becomes hostile, it cannot be dismissed, and it disappears one hour after it was summoned (spell:conjure-elemental).';

function editGrant(
  projections: Projections,
  item: string,
  grantId: string,
  edit: (grant: Grant) => Grant,
): Projections {
  return editBlock(projections, item, 'entityGrant', (value) => {
    if (!value.grants.some((grant) => grant.id === grantId))
      fail(item, `has no grant ${grantId}`);
    return {
      ...value,
      grants: value.grants.map((grant) =>
        grant.id === grantId ? edit(grant) : grant,
      ),
    };
  });
}

const without = <T extends object, K extends keyof T>(
  value: T,
  key: K,
): Omit<T, K> => {
  const { [key]: _drop, ...rest } = value;
  return rest;
};

const SPECS: ReadonlyMap<string, LifecycleSpec> = new Map<
  string,
  LifecycleSpec
>([
  // --- S4 state graphs -------------------------------------------------------
  [
    'Apparatus of the Crab',
    {
      // Lever 10 opens/closes the rear hatch (Up unseals and opens, Down closes
      // and seals); lever 1 extends/retracts the legs and tail and never moves
      // the hatch. The direction lives in the printed lever table, so each
      // transition quotes the table cell that governs it.
      apply: (projections, ctx) =>
        editBlock(projections, ctx.itemName, 'stateMachine', (machine) => ({
          ...machine,
          transitions: [
            ...Array.from({ length: 9 }, (_, index) =>
              ['sealed', 'open'].map((state) =>
                transition(state, state, { via: `set-lever-${index + 1}` }),
              ),
            ).flat(),
            // The direction is typed in the transition's own `via`: Up opens a
            // sealed hatch, Down seals an open one. Up while open and Down
            // while sealed declare no transition.
            transition('sealed', 'open', {
              via: 'set-lever-10-up',
              note: 'table:apparatus-of-the-crab-levers lever 10, Up: The rear hatch unseals and opens.',
            }),
            transition('open', 'sealed', {
              via: 'set-lever-10-down',
              note: 'table:apparatus-of-the-crab-levers lever 10, Down: The rear hatch closes and seals.',
            }),
            ...machine.transitions.filter((entry) => entry.via === undefined),
          ],
        })),
    },
  ],
  [
    'Dagger of Venom',
    {
      apply: (projections, ctx) =>
        editBlock(projections, ctx.itemName, 'stateMachine', (machine) => ({
          ...machine,
          transitions: machine.transitions.map((entry) =>
            entry.condition === undefined
              ? entry
              : {
                  ...entry,
                  condition: ctx.span(
                    'an attack using this weapon hits a creature',
                  ),
                },
          ),
          termination: ctx.span(
            'The poison remains for 1 minute or until an attack using this weapon hits a creature',
          ),
        })),
    },
  ],
  [
    'Dancing Sword',
    {
      // The launch itself makes the FIRST attack; the fourth attack is followed
      // by the return. Hovering ends if you grasp the sword or move more than
      // 30 feet away from it, and the return ends by falling when no hand is
      // free or the path is obstructed.
      apply: (projections, ctx) =>
        editBlock(projections, ctx.itemName, 'stateMachine', (machine) => ({
          ...machine,
          initial: 'held',
          states: [
            { id: 'held' },
            { id: 'attack-one' },
            { id: 'attack-two' },
            { id: 'attack-three' },
            { id: 'returning' },
            { id: 'grounded' },
            { id: 'not-hovering' },
          ],
          transitions: [
            transition('held', 'attack-one', { via: 'launch-sword' }),
            transition('attack-one', 'attack-two', { via: 'command-attack' }),
            transition('attack-two', 'attack-three', { via: 'command-attack' }),
            transition('attack-three', 'returning', { via: 'command-attack' }),
            transition('returning', 'held', { via: 'catch-sword' }),
            transition('returning', 'grounded', {
              condition: ctx.span(
                'If you have no hand free, it falls to the ground at your feet',
              ),
            }),
            transition('returning', 'grounded', {
              condition: ctx.span(
                'If the sword has no unobstructed path to you, it moves as close to you as it can and then falls to the ground',
              ),
            }),
            ...['attack-one', 'attack-two', 'attack-three', 'returning'].map(
              (from) =>
                transition(from, 'not-hovering', {
                  condition: ctx.span(
                    'It also ceases to hover if you grasp it or move more than 30 feet away from it',
                  ),
                }),
            ),
          ],
          termination: ctx.between(
            'After the hovering sword attacks for the fourth time',
            'move more than 30 feet away from it',
          ),
        })),
    },
  ],
  [
    'Decanter of Endless Water',
    {
      // The printed text has no stop command: the water stops pouring at the
      // start of your next turn.
      apply: (projections, ctx) =>
        editBlock(
          removeOperations(projections, ctx.itemName, ['stop-water']),
          ctx.itemName,
          'stateMachine',
          (machine) => ({
            ...machine,
            transitions: machine.transitions.map((entry) =>
              entry.via === 'stop-water'
                ? {
                    from: entry.from,
                    to: entry.to,
                    condition: ctx.span(
                      'The water stops pouring out at the start of your next turn',
                    ),
                  }
                : entry,
            ),
            termination: ctx.span(
              'The water stops pouring out at the start of your next turn',
            ),
          }),
        ),
    },
  ],
  [
    'Staff of Swarming Insects',
    {
      // Heavily obscured for creatures other than you, centered on you and
      // moving with you; ends at ten minutes or a wind of 10 mph. No dismissal
      // command is printed.
      apply: (projections, ctx) =>
        editBlock(
          removeOperations(projections, ctx.itemName, ['dismiss-insect-cloud']),
          ctx.itemName,
          'stateMachine',
          (machine) => ({
            ...machine,
            states: machine.states.map((entry) =>
              entry.id === 'cloud'
                ? {
                    ...entry,
                    note: ctx.between(
                      'making the area heavily obscured for creatures other than you',
                      'remaining centered on you',
                    ),
                  }
                : entry,
            ),
            transitions: [
              ...machine.transitions.filter(
                (entry) => entry.via !== 'dismiss-insect-cloud',
              ),
              transition('cloud', 'clear', {
                condition: ctx.span(
                  'A wind of at least 10 miles per hour disperses the swarm and ends the effect',
                ),
              }),
            ],
            termination: ctx.between(
              'The insects remain for 10 minutes',
              'ends the effect',
            ),
          }),
        ),
    },
  ],
  [
    'Broom of Flying',
    {
      // Landing, not dismounting, stops the hovering; no dismount command is
      // printed.
      apply: (projections, ctx) =>
        editBlock(
          removeOperations(projections, ctx.itemName, ['dismount-broom']),
          ctx.itemName,
          'stateMachine',
          (machine) => ({
            ...machine,
            transitions: machine.transitions
              // "reaches named destination" is not a printed event; the
              // remote broom comes back "when you speak another command word".
              .filter(
                (entry) =>
                  entry.condition !== 'broom reaches named destination',
              )
              .map((entry) =>
                entry.via === 'dismount-broom'
                  ? {
                      from: entry.from,
                      to: entry.to,
                      condition: ctx.span(
                        'The broom stops hovering when you land',
                      ),
                    }
                  : entry.via === 'recall-broom'
                    ? { ...entry, to: 'parked' }
                    : entry,
              ),
            termination: ctx.span('The broom stops hovering when you land'),
          }),
        ),
    },
  ],
  [
    'Cloak of Displacement',
    {
      // Damage suppression lasts until the start of your next turn;
      // incapacitated / restrained / unable-to-move suppression lasts while the
      // condition holds. Two independent lifetimes cannot share one state, so
      // the machine and its two invented transition operations are withheld.
      apply: (projections, ctx) =>
        withholdBlock(
          removeOperations(projections, ctx.itemName, [
            'suppress-displacement',
            'restore-displacement',
          ]),
          ctx.itemName,
          'stateMachine',
          ctx.between(
            'If you take damage, the property ceases to function until the start of your next turn',
            'otherwise unable to move',
          ),
          'Damage suppresses the property until the start of your next turn, while being incapacitated, restrained, or otherwise unable to move suppresses it for as long as that condition holds. The two lifetimes are independent, so no single typed state graph states them exactly; the DM model interprets the printed text.',
        ),
    },
  ],
  [
    'Eversmoking Bottle',
    {
      // Growth needs the bottle to remain open AND within the cloud; closing the
      // bottle does not end the cloud, which disperses ten minutes later.
      apply: (projections, ctx) =>
        editBlock(projections, ctx.itemName, 'stateMachine', (machine) => ({
          ...machine,
          states: [
            { id: 'closed' },
            { id: 'cloud-open' },
            {
              id: 'cloud-lingering',
              note: ctx.span(
                'Once the bottle is closed, the cloud disperses after 10 minutes',
              ),
            },
          ],
          transitions: [
            transition('closed', 'cloud-open', { via: 'open-bottle' }),
            // Growth ("each minute the bottle remains open AND within the
            // cloud") is a guarded timer the vocabulary cannot state (a plain
            // timer would grow the cloud while the open bottle is carried out
            // of it), so no growth states are typed; the printed sentence is
            // carried by an adjudicated clause below.
            transition('cloud-open', 'cloud-lingering', {
              via: 'close-bottle',
            }),
            transition('cloud-lingering', 'closed', {
              timer: { amount: 10, unit: 'minute' },
              note: ctx.span(
                'Once the bottle is closed, the cloud disperses after 10 minutes',
              ),
            }),
          ],
          termination: ctx.between(
            'The cloud persists as long as the bottle is open',
            'can do so after 1 round',
          ),
        })),
      clauses: (ctx) => [
        clause(
          'state-eversmoking-bottle-growth',
          { block: 'stateMachine' },
          ctx.span(
            'Each minute the bottle remains open and within the cloud, the radius increases by 10 feet until it reaches its maximum radius of 120 feet.',
          ),
          'Growth is gated on the bottle remaining open AND within the cloud, which no typed timer states; no growth state or timer is typed, and the DM model interprets the printed text.',
        ),
      ],
    },
  ],
  [
    'Rope of Climbing',
    {
      // The action only animates the rope. Movement toward a destination (a
      // bonus action), fastening, knotting and coiling are independent
      // commands, not stages of one chain, so they are carried by clauses.
      apply: (projections, ctx) =>
        editBlock(projections, ctx.itemName, 'stateMachine', (machine) => ({
          ...machine,
          states: [
            { id: 'loose' },
            {
              id: 'animated',
              note: ctx.span('the rope animates'),
            },
          ],
          transitions: [
            transition('loose', 'animated', { via: 'animate-rope' }),
            // Fastening, knotting and unfastening are independent commands
            // that do not change the animation state; the self-loops keep the
            // operations bound to this (engine-pending) graph.
            ...['fasten-rope', 'knot-rope', 'release-rope'].map((via) =>
              transition('animated', 'animated', { via }),
            ),
          ],
          termination: ctx.span(
            'If the rope drops to 0 hit points, it is destroyed',
          ),
        })),
      clauses: (ctx) => [
        clause(
          'state-rope-of-climbing-movement',
          { block: 'stateMachine' },
          ctx.span(
            'As a bonus action, you can command the other end to move toward a destination you choose.',
          ),
          'The rope’s movement toward a destination is a separate bonus-action command that is not a stage of the animation transition; the DM model interprets the printed text.',
        ),
      ],
    },
  ],
  [
    'Ioun Stone',
    {
      apply: (projections, ctx) =>
        editBlock(projections, ctx.itemName, 'stateMachine', (machine) => ({
          ...machine,
          transitions: machine.transitions.map((entry) =>
            entry.from === 'orbiting' && entry.to === 'seized'
              ? {
                  ...entry,
                  condition: ctx.span(
                    'either by making a successful attack roll against AC 24 or a successful DC 24 Dexterity (Acrobatics) check',
                  ),
                }
              : entry,
          ),
          termination: ctx.between(
            'Thereafter, another creature must use an action to grasp or net the stone',
            'ending its effect',
          ),
        })),
    },
  ],
  [
    'Instant Fortress',
    {
      // The roof, the door and each wall have their own 100 hit points and wish
      // repairs a component 50 hit points per casting: there is no whole-item
      // destroyed state and no ownership cutoff.
      apply: (projections, ctx) =>
        editBlock(projections, ctx.itemName, 'stateMachine', (machine) => ({
          ...machine,
          states: machine.states.filter((entry) => entry.id !== 'destroyed'),
          transitions: machine.transitions
            .filter((entry) => entry.to !== 'destroyed')
            .map((entry) =>
              entry.via === 'dismiss-fortress'
                ? {
                    ...entry,
                    note: ctx.span('which works only if the fortress is empty'),
                  }
                : entry,
            ),
          termination: ctx.between(
            'remains until you use an action to speak the command word that dismisses it',
            'only if the fortress is empty',
          ),
        })),
      clauses: (ctx) => [
        clause(
          'state-instant-fortress-components',
          { block: 'stateMachine' },
          ctx.between(
            'The roof, the door, and the walls each have 100 hit points',
            'one wall to regain 50 hit points.',
          ),
          'Component hit points and wish repair are printed per component; no typed whole-item destroyed state is kept, and the DM model interprets the printed text.',
        ),
      ],
    },
  ],
  // --- S5 grants -------------------------------------------------------------
  ...ELEMENTAL_VESSELS.map((name): [string, LifecycleSpec] => [
    name,
    {
      apply: (projections, ctx) =>
        editBlock(projections, ctx.itemName, 'entityGrant', (value) => ({
          ...value,
          grants: value.grants.map((grant) => ({
            ...grant,
            revertOn: ['reduced-to-0-hit-points', 'one-hour-ended'],
            note: `${grant.note ?? ''} ${CONJURE_ELEMENTAL_NOTE}`.trim(),
          })),
        })),
    },
  ]),
  [
    'Figurine of Wondrous Power',
    {
      apply: (projections, ctx) => {
        const steed = editGrant(
          projections,
          ctx.itemName,
          'obsidian-steed',
          (grant) => ({
            ...grant,
            revertOn: [...FIGURINE_REVERT_OBEYED],
            // Reversion by command happens only when the command is obeyed.
            note: ctx.between(
              'If you have a good alignment, the figurine has a 10 percent chance',
              'a command to revert to figurine form',
            ),
          }),
        );
        // Golden lions: one figurine or both may be used simultaneously and
        // each lion has its own seven-day availability, so there is no
        // unconditional pair and no dismissal of an existing lion.
        return editGrant(steed, ctx.itemName, 'golden-lions', (grant) => ({
          ...without(grant, 'exclusiveInstance'),
          count: 1,
          note: ctx.between(
            'You can use one figurine or both simultaneously',
            'until 7 days have passed.',
          ),
        }));
      },
    },
  ],
  [
    'Pipes of the Sewers',
    {
      apply: (projections, ctx) =>
        editGrant(projections, ctx.itemName, 'called-rat-swarms', (grant) => ({
          ...grant,
          control: [
            ctx.span('aren’t under your control otherwise'),
            ctx.span(
              'becomes friendly to you and your companions for as long as you continue to play the pipes each round as an action',
            ),
            ctx.span(
              'If a friendly swarm starts its turn and can’t hear the pipes’ music, your control over that swarm ends',
            ),
          ].join('; '),
        })),
    },
  ],
  [
    'Manual of Golems',
    {
      apply: (projections, ctx) =>
        editGrant(projections, ctx.itemName, 'created-golem', (grant) => ({
          ...grant,
          control: ctx.span(
            'It is under your control, and it understands and obeys your spoken commands',
          ),
          note: ctx.span(
            'The golem becomes animate when the ashes of the manual are sprinkled on it',
          ),
        })),
      clauses: (ctx) => [
        clause(
          'grant-manual-of-golems-eligibility',
          { block: 'entityGrant' },
          ctx.span(
            'To decipher and use the manual, you must be a spellcaster with at least two 5th-level spell slots.',
          ),
          'The eligibility gate is a printed precondition for the created-golem grant that the grant vocabulary cannot state; the DM model interprets the printed text.',
        ),
        clause(
          'grant-manual-of-golems-creation',
          { block: 'entityGrant' },
          ctx.between(
            'To create a golem, you must spend the time shown on the table',
            'sprinkled on it.',
          ),
          'The creation work, cost, consumption of the manual and the animating ashes are printed preconditions and a printed trigger for the created-golem grant; the DM model interprets the printed text.',
        ),
      ],
    },
  ],
  [
    'Orb of Dragonkind',
    {
      // The call may be used again after one hour whether or not the called
      // dragons have arrived: no item-exclusive outstanding-summons gate.
      apply: (projections, ctx) =>
        editGrant(
          projections,
          ctx.itemName,
          'called-evil-dragons',
          (grant) => ({
            ...without(grant, 'exclusiveInstance'),
            control: ctx.span(
              'Evil dragons in range feel compelled to come to the orb as soon as possible by the most direct route',
            ),
            note: ctx.span(
              'Dragons drawn to the orb might be hostile toward you for compelling them against their will',
            ),
          }),
        ),
      clauses: (ctx) => [
        clause(
          'grant-orb-of-dragonkind-call-cooldown',
          { block: 'entityGrant' },
          ctx.span(
            'Once you have used this property, it can’t be used again for 1 hour.',
          ),
          'The one-hour use gate of the call is printed and independent of whether the called dragons have arrived; no typed cooldown or exclusivity is kept, and the DM model interprets the printed text.',
        ),
      ],
    },
  ],
  // --- S5.03 retributive strike ----------------------------------------------
  ...(['Staff of Power', 'Staff of the Magi'] as const).map(
    (name): [string, LifecycleSpec] => [
      name,
      {
        // The breaker's escape only avoids the breaker's own damage; every
        // other creature in the area saves regardless.
        apply: (projections, ctx) =>
          editBlock(projections, ctx.itemName, 'randomProcedure', (value) => ({
            ...value,
            procedures: value.procedures.map((procedure) =>
              procedure.id === 'retributive-escape'
                ? {
                    ...procedure,
                    outcome: ctx.between(
                      'You have a 50 percent chance to instantly travel to a random plane of existence, avoiding the explosion',
                      'a creature takes half as much damage.',
                    ),
                  }
                : procedure,
            ),
          })),
      },
    ],
  ),
  // --- S6 economies -----------------------------------------------------------
  [
    'Luck Blade',
    {
      // Wish: one charge AND "can't be used again until the next dawn".
      apply: (projections, ctx) => {
        // Only the charge-economy family owns the cast-wish cost.
        let added = false;
        const withEconomy = projections.map((projection) => {
          const economies = projection.mechanics.economies;
          if (economies?.charges === undefined) return projection;
          added = true;
          return {
            ...projection,
            mechanics: {
              ...projection.mechanics,
              economies: {
                ...economies,
                wish: {
                  kind: 'per-day',
                  perDay: { uses: 1 },
                  reset: [{ at: 'dawn', amount: 'all' }],
                  note: ctx.span(
                    'This property can’t be used again until the next dawn.',
                  ),
                } as MagicItemEconomy,
              },
            },
          };
        });
        if (!added) fail(ctx.itemName, 'has no charges economy');
        return mapOperations(withEconomy, (operations) =>
          operations.map((entry) =>
            entry.id === 'cast-wish'
              ? {
                  ...entry,
                  cost: [...(entry.cost ?? []), { economy: 'wish', amount: 1 }],
                }
              : entry,
          ),
        );
      },
    },
  ],
  [
    'Necklace of Prayer Beads',
    {
      // Each magic bead has its own once-per-dawn gate; a necklace-wide
      // once-per-day pool (uses: 1) would let a three-bead necklace cast one
      // bead spell per dawn. The vocabulary has no per-instance gate, so the
      // economy is withheld and the printed sentence is adjudicated.
      apply: (projections, ctx) =>
        withholdEconomy(
          projections,
          ctx.itemName,
          'bead-spells',
          ctx.span(
            'Once a magic bead’s spell is cast, that bead can’t be used again until the next dawn.',
          ),
          'The once-per-dawn gate is per magic bead (the necklace has 1d4 + 2 beads); no necklace-wide pool is typed, and the DM model interprets the printed text.',
        ),
    },
  ],
  // --- S1.16-S1.18 containment ------------------------------------------------
  [
    'Bag of Devouring',
    {
      apply: (projections, ctx) =>
        editBlock(projections, ctx.itemName, 'containment', (value) => ({
          ...value,
          overflow: [
            ctx.span(
              'Animal or vegetable matter placed wholly in the bag is devoured and lost forever',
            ),
            ctx.span(
              'Any creature that starts its turn inside the bag is devoured, its body destroyed',
            ),
            ctx.span(
              'once each day, the bag swallows any objects inside it and spits them out into another plane of existence',
            ),
          ].join('; '),
        })),
    },
  ],
  [
    'Handy Haversack',
    {
      apply: (projections, ctx) =>
        editBlock(projections, ctx.itemName, 'containment', (value) => {
          if (value.rupture === undefined) fail(ctx.itemName, 'has no rupture');
          return {
            ...value,
            rupture: {
              ...value.rupture,
              triggers: [
                ctx.span('If it is overloaded'),
                ctx.span('if a sharp object pierces it or tears it'),
              ],
            },
          };
        }),
    },
  ],
  [
    'Portable Hole',
    {
      // The ten-minute survival applies to a breathing creature within a CLOSED
      // portable hole; the suffocation structure has no closed-state field.
      apply: (projections, ctx) =>
        editBlock(projections, ctx.itemName, 'containment', (value) =>
          without(value, 'suffocation'),
        ),
      clauses: (ctx) => [
        clause(
          'containment-portable-hole-suffocation',
          { block: 'containment' },
          ctx.span(
            'A breathing creature within a closed portable hole can survive for up to 10 minutes, after which time it begins to suffocate.',
          ),
          'The suffocation timer applies only to a creature within a CLOSED portable hole; the suffocation structure has no closed-state field, so none is typed and the DM model interprets the printed text.',
        ),
      ],
    },
  ],
]);

// --- Whole-corpus state-graph text (review 19.4.6.3 S2) ----------------------
//
// Every transition `condition` / `note` and machine `termination` the
// producers drafted is either a verbatim span of the item's printed
// description (or a `table:` citation whose cell text is verbatim in the cited
// table) or absent. The edits below replace paraphrases with the printed span,
// or remove the field/transition when the text prints nothing that states it.
// A transition is `via` an operation only when it is not outcome-dependent: a
// transition that fires only on a hit, a success, or a failed save is
// condition-only with the printed outcome span (the vocabulary allows exactly
// one of via/timer/condition).

type Machine = MagicItemStateMachine;
type GraphEdit = (machine: Machine, ctx: LifecycleContext) => Machine;

const setTermination = (machine: Machine, value: string | null): Machine => {
  const { termination: _drop, ...rest } = machine;
  return value === null ? rest : { ...rest, termination: value };
};

const matches = (
  entry: Transition,
  from: string,
  to: string,
  via?: string,
): boolean =>
  entry.from === from &&
  entry.to === to &&
  (via === undefined || entry.via === via);

/** Replace the `condition` of the condition-bearing transition(s) from -> to. */
const setCondition = (
  machine: Machine,
  from: string,
  to: string,
  condition: string,
): Machine => {
  const target = (entry: Transition): boolean =>
    matches(entry, from, to) && entry.condition !== undefined;
  if (!machine.transitions.some(target))
    fail('state graph', `has no ${from} -> ${to} condition transition`);
  return {
    ...machine,
    transitions: machine.transitions.map((entry) =>
      target(entry) ? { ...entry, condition } : entry,
    ),
  };
};

/** Replace the `note` of the transition(s) from -> to. */
const setNote = (
  machine: Machine,
  from: string,
  to: string,
  note: string,
): Machine => {
  if (!machine.transitions.some((entry) => matches(entry, from, to)))
    fail('state graph', `has no ${from} -> ${to} transition`);
  return {
    ...machine,
    transitions: machine.transitions.map((entry) =>
      matches(entry, from, to) ? { ...entry, note } : entry,
    ),
  };
};

/** Turn the `via` transition from -> to into a condition-only transition. */
const viaToCondition = (
  machine: Machine,
  from: string,
  to: string,
  via: string,
  condition: string,
): Machine => {
  if (!machine.transitions.some((entry) => matches(entry, from, to, via)))
    fail('state graph', `has no ${from} -> ${to} via ${via} transition`);
  return {
    ...machine,
    transitions: machine.transitions.map((entry) => {
      if (!matches(entry, from, to, via)) return entry;
      const { via: _via, ...rest } = entry;
      return { ...rest, condition };
    }),
  };
};

/** Remove transitions between two states (an unprinted or unstatable edge). */
const dropTransitions = (
  machine: Machine,
  from: string,
  to: string,
  via?: string,
): Machine => {
  if (!machine.transitions.some((entry) => matches(entry, from, to, via)))
    fail('state graph', `has no ${from} -> ${to} transition to drop`);
  return {
    ...machine,
    transitions: machine.transitions.filter(
      (entry) => !matches(entry, from, to, via),
    ),
  };
};

const dropState = (machine: Machine, id: string): Machine => ({
  ...machine,
  states: machine.states.filter((entry) => entry.id !== id),
  transitions: machine.transitions.filter(
    (entry) => entry.from !== id && entry.to !== id,
  ),
});

/** Termination-only graphs: the printed span, or absent. */
const terminationOnly = (
  quote: (ctx: LifecycleContext) => string | null,
): GraphEdit => {
  return (machine, ctx) => setTermination(machine, quote(ctx));
};

const GRAPH_EDITS: ReadonlyMap<string, GraphEdit> = new Map<string, GraphEdit>([
  [
    'Animated Shield',
    terminationOnly((ctx) =>
      ctx.span(
        'The shield remains animated for 1 minute, until you use a bonus action to end this effect, or until you are incapacitated or die',
      ),
    ),
  ],
  [
    // "Apparatus reaches 0 hit points" and "destruction" are not printed (the
    // statistics block lists only Hit Points: 200), so no disabled state.
    'Apparatus of the Crab',
    (machine) => setTermination(dropState(machine, 'disabled'), null),
  ],
  [
    'Bead of Force',
    terminationOnly((ctx) =>
      ctx.span(
        'A sphere of transparent force then encloses the area for 1 minute',
      ),
    ),
  ],
  [
    'Boots of Speed',
    terminationOnly((ctx) =>
      ctx.between(
        'If you click your heels together again, you end the effect',
        'until you finish a long rest',
      ),
    ),
  ],
  ['Carpet of Flying', terminationOnly(() => null)],
  [
    'Chime of Opening',
    (machine, ctx) =>
      setCondition(
        setTermination(machine, null),
        'resolving',
        'ready',
        ctx.between(
          'one lock or latch on the object opens',
          'the sound can’t reach the object',
        ),
      ),
  ],
  ['Cloak of the Bat', terminationOnly(() => null)],
  [
    'Cube of Force',
    terminationOnly((ctx) =>
      ctx.span(
        'lasts for 1 minute, until you use an action to press the cube’s sixth face, or the cube runs out of charges',
      ),
    ),
  ],
  [
    'Dimensional Shackles',
    (machine, ctx) =>
      setNote(
        setTermination(
          machine,
          ctx.between(
            'Once every 30 days, the bound creature can make a DC 30',
            'destroys the shackles',
          ),
        ),
        'bound',
        'broken',
        ctx.between(
          'Once every 30 days, the bound creature can make a DC 30',
          'destroys the shackles.',
        ),
      ),
  ],
  [
    'Dust of Dryness',
    terminationOnly((ctx) => ctx.span('Doing so ends that pellet’s magic')),
  ],
  [
    'Dwarven Thrower',
    terminationOnly((ctx) =>
      ctx.span(
        'Immediately after the attack, the weapon flies back to your hand',
      ),
    ),
  ],
  [
    // The single end condition differs per token kind (anchor: touch again;
    // bird: dismissed, killed, or a day of flight; ...), so no one printed
    // span states it: the end transition and its state are withheld.
    'Feather Token',
    (machine) => dropState(setTermination(machine, null), 'consumed'),
  ],
  [
    'Flame Tongue',
    terminationOnly((ctx) =>
      ctx.between(
        'The flames last until you use a bonus action to speak the command word again',
        'sheathe the sword',
      ),
    ),
  ],
  [
    // The second command word unfolds the BOX into a ship; boat <-> ship are
    // not printed, and folding is allowed only with no creatures aboard (the
    // fold-boat operation carries that requirement).
    'Folding Boat',
    (machine, ctx) =>
      setTermination(
        dropTransitions(
          dropTransitions(machine, 'boat', 'ship'),
          'ship',
          'boat',
        ),
        ctx.span(
          'The third command word causes the folding boat to fold back into a box, provided that no creatures are aboard',
        ),
      ),
  ],
  [
    'Gem of Brightness',
    terminationOnly((ctx) =>
      ctx.between(
        'It lasts until you use a bonus action to repeat the command word',
        'another function of the gem',
      ),
    ),
  ],
  [
    'Helm of Brilliance',
    terminationOnly((ctx) =>
      ctx.between(
        'The flames last until you use a bonus action to speak the command word again',
        'stow the weapon',
      ),
    ),
  ],
  [
    'Holy Avenger',
    terminationOnly((ctx) =>
      ctx.span(
        'While you hold the drawn sword, it creates an aura in a 10-foot radius around you',
      ),
    ),
  ],
  [
    // The DC 30 check MOVES the fixed rod up to 10 feet; the rod stays fixed.
    'Immovable Rod',
    (machine, ctx) => ({
      ...setTermination(
        machine,
        ctx.between(
          'Until you or another creature uses an action to push the button again',
          'deactivate and fall',
        ),
      ),
      note: ctx.span(
        'A creature can use an action to make a DC 30 Strength check, moving the fixed rod up to 10 feet on a success',
      ),
    }),
  ],
  [
    // Missing the attack leaves the bands a sphere, so the throw transition is
    // hit-only.
    'Iron Bands of Binding',
    (machine, ctx) =>
      setNote(
        setTermination(
          viaToCondition(
            machine,
            'sphere',
            'restraining',
            'throw-bands',
            ctx.span('On a hit, the target is restrained'),
          ),
          ctx.between(
            'On a hit, the target is restrained until you take a bonus action',
            'become a sphere once more',
          ),
        ),
        'restraining',
        'destroyed',
        ctx.between(
          'A creature, including the one restrained, can use an action to make a DC 20 Strength check to break the iron bands',
          'until 24 hours have elapsed',
        ),
      ),
  ],
  [
    // Every painting becomes a real, nonmagical object when completed; a
    // higher-value depiction is a worthless-material object, not a
    // "representation".
    'Marvelous Pigments',
    (machine, ctx) =>
      setTermination(
        setCondition(
          machine,
          'painting',
          'realized',
          ctx.span('When you complete the painting'),
        ),
        ctx.between(
          'If you paint a form of energy such as fire or lightning',
          'doing no harm to anything',
        ),
      ),
  ],
  [
    'Potion of Diminution',
    terminationOnly((ctx) =>
      ctx.span('for 1d4 hours (no concentration required)'),
    ),
  ],
  [
    'Potion of Gaseous Form',
    terminationOnly((ctx) =>
      ctx.span(
        'for 1 hour (no concentration required) or until you end the effect as a bonus action',
      ),
    ),
  ],
  [
    'Potion of Growth',
    terminationOnly((ctx) =>
      ctx.span('for 1d4 hours (no concentration required)'),
    ),
  ],
  ['Ring of Elemental Command', terminationOnly(() => null)],
  [
    'Ring of Invisibility',
    terminationOnly((ctx) =>
      ctx.span(
        'You remain invisible until the ring is removed, until you attack or cast a spell, or until you use a bonus action to become visible again',
      ),
    ),
  ],
  [
    'Ring of Mind Shielding',
    terminationOnly((ctx) =>
      ctx.span(
        'You can use an action to cause the ring to become invisible until you use another action to make it visible, until you remove the ring, or until you die',
      ),
    ),
  ],
  [
    // "All created spheres have discharged" is derived, not printed (each
    // sphere discharges and disappears on its own), so the depleted state is
    // withheld.
    'Ring of Shooting Stars',
    (machine, ctx) =>
      setTermination(
        dropState(machine, 'depleted'),
        ctx.span(
          'The spheres last as long as you concentrate (as if concentrating on a spell), up to 1 minute',
        ),
      ),
  ],
  [
    'Robe of Useful Items',
    (machine, ctx) =>
      setTermination(
        setCondition(
          machine,
          'patched',
          'ordinary',
          ctx.span('the last patch is removed'),
        ),
        ctx.span('the robe becomes an ordinary garment'),
      ),
  ],
  [
    'Rod of Alertness',
    terminationOnly((ctx) =>
      ctx.span(
        'The rod’s head stops glowing and the effect ends after 10 minutes, or when a creature uses an action to pull the rod from the ground',
      ),
    ),
  ],
  [
    'Rod of Lordly Might',
    terminationOnly((ctx) =>
      ctx.span(
        'A button’s effect lasts until you push a different button or until you push the same button again, which causes the rod to revert to its normal form',
      ),
    ),
  ],
  [
    // The entangle transition fires only when the target FAILS the save; the
    // escape fires on a successful check, not on any attempt.
    'Rope of Entanglement',
    (machine, ctx) => {
      const destroyed = ctx.span('the rope drops to 0 hit points');
      return setTermination(
        setCondition(
          setCondition(
            setCondition(
              viaToCondition(
                machine,
                'loose',
                'restraining',
                'entangle-creature',
                ctx.between(
                  'The target must succeed on a DC 15 Dexterity saving throw',
                  'become restrained',
                ),
              ),
              'restraining',
              'loose',
              ctx.span(
                'On a success, the creature is no longer restrained by the rope',
              ),
            ),
            'loose',
            'destroyed',
            destroyed,
          ),
          'restraining',
          'destroyed',
          destroyed,
        ),
        ctx.span('If the rope drops to 0 hit points, it is destroyed'),
      );
    },
  ],
  [
    'Sovereign Glue',
    (machine, ctx) => {
      const span = ctx.span(
        'the bond it creates can be broken only by the application of universal solvent or oil of etherealness, or with a wish spell',
      );
      return setTermination(
        setCondition(machine, 'bonded', 'unset', span),
        span,
      );
    },
  ],
  [
    // A failed DC 25 check moves the sphere toward the actor and gains no
    // control, so the control transition is success-only.
    'Sphere of Annihilation',
    (machine, ctx) =>
      setTermination(
        setCondition(
          viaToCondition(
            machine,
            'uncontrolled',
            'controlled',
            'attempt-control',
            ctx.between(
              'On a success, the sphere levitates in one direction of your choice',
              '(minimum 5 feet)',
            ),
          ),
          'contested',
          'controlled',
          ctx.span('The winner of the contest gains control of the sphere'),
        ),
        ctx.span(
          'The winner of the contest gains control of the sphere and can levitate it as normal',
        ),
      ),
  ],
  [
    'Staff of the Python',
    (machine, ctx) =>
      setTermination(
        setCondition(
          machine,
          'python',
          'destroyed',
          ctx.span('the snake is reduced to 0 hit points'),
        ),
        ctx.between('If the snake is reduced to 0 hit points', 'is destroyed'),
      ),
  ],
  [
    'Staff of the Woodlands',
    terminationOnly((ctx) =>
      ctx.span(
        'While touching the tree and using another action to speak its command word, you return the staff to its normal form',
      ),
    ),
  ],
  [
    'Sword of Sharpness',
    terminationOnly((ctx) =>
      ctx.span(
        'Speaking the command word again or sheathing the sword puts out the light',
      ),
    ),
  ],
  [
    'Wings of Flying',
    terminationOnly((ctx) =>
      ctx.span('for 1 hour or until you repeat the command word as an action'),
    ),
  ],
]);

/** Items whose lifecycle, grant, economy or containment claims were reviewed. */
export const MAGIC_ITEM_FAITHFUL_LIFECYCLE_ITEMS: readonly string[] =
  Object.freeze([...new Set([...SPECS.keys(), ...GRAPH_EDITS.keys()])]);

export function applyFaithfulMagicItemLifecycles(
  item: MagicItemExtraction,
  projections: Projections,
): Projections {
  const spec = SPECS.get(item.name);
  const graphEdit = GRAPH_EDITS.get(item.name);
  if (spec === undefined && graphEdit === undefined) return projections;
  const description = item.description;
  const ctx: LifecycleContext = {
    itemName: item.name,
    span: (text) => {
      if (text.length === 0 || !description.includes(text))
        fail(
          item.name,
          `span ${JSON.stringify(text)} is not a verbatim span of the printed description`,
        );
      return text;
    },
    between: (start, end) => {
      const from = description.indexOf(start);
      if (from < 0)
        fail(
          item.name,
          `span start ${JSON.stringify(start)} is not in the printed description`,
        );
      const to = description.indexOf(end, from + start.length - 1);
      if (to < 0)
        fail(
          item.name,
          `span end ${JSON.stringify(end)} does not follow its start in the printed description`,
        );
      return description.slice(from, to + end.length);
    },
  };
  let result =
    spec?.apply === undefined ? projections : spec.apply(projections, ctx);
  if (graphEdit !== undefined)
    result = editBlock(result, item.name, 'stateMachine', (machine) =>
      graphEdit(machine, ctx),
    );
  for (const entry of spec?.clauses?.(ctx) ?? []) {
    const index = ownerIndex(result, entry.owner);
    if (index < 0)
      fail(item.name, `clause ${entry.id} names an owner no family projects`);
    const adjudicated: ItemClauseExpectation = {
      id: entry.id,
      tag: ownerTag(result, index),
      representation: {
        adjudicated: true,
        note: entry.note ?? WITHHELD_NOTE,
        sourceText: entry.sourceText,
      },
    };
    result = result.map((projection, at) =>
      at === index
        ? { ...projection, clauses: [...projection.clauses, adjudicated] }
        : projection,
    );
  }
  return result;
}
