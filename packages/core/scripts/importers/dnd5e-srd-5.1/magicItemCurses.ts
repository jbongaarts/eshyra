/** Source-grounded M7 curses, oaths, and behavioral-state definitions. */
import type {
  MagicItemCurse,
  MagicItemCurseStateDefinition,
  MagicItemEffect,
  MagicItemMechanics,
  MagicItemOperation,
} from '../../../src/rules/magicItemMechanics.js';
import type {
  EngineHookBinding,
  ItemClauseExpectation,
  ItemClauseRepresentation,
  MagicItemFamilyProjection,
} from './magicItemCompiler.js';
import type { MagicItemExtraction } from './types.js';

interface ClauseSpec {
  readonly id: string;
  readonly phrase: string;
  readonly representation: ItemClauseRepresentation;
  readonly hooks: readonly EngineHookBinding[];
}

interface CurseSpec {
  readonly curse: MagicItemCurse;
  readonly effects?: readonly MagicItemEffect[];
  readonly operations?: readonly MagicItemOperation[];
  readonly clauses: readonly ClauseSpec[];
}

const F5 = {
  engine: 'F5',
  hook: 'attunement, curse, and item-instance state constraints',
} as const;
const F6 = {
  engine: 'F6',
  hook: 'hit-point loss, healing restriction, and character-condition state',
} as const;
const F7 = {
  engine: 'F7',
  hook: 'dawn, rest, and timed curse-state transitions',
} as const;
const F9 = {
  engine: 'F9',
  hook: 'saving throw, damage, and attack targeting consequences',
} as const;

const clause = (
  id: string,
  phrase: string,
  representation: ClauseSpec['representation'],
  hooks: readonly EngineHookBinding[],
): ClauseSpec => ({
  id: `m7-${id}`,
  phrase,
  representation,
  hooks,
});

const effect = (
  id: string,
  kind: string,
  payload: Readonly<Record<string, unknown>>,
): MagicItemEffect => ({ id: `m7-${id}`, kind, ...payload });

const state = (
  id: string,
  onset: string,
  rest: Omit<MagicItemCurseStateDefinition, 'id' | 'onset'> = {},
): MagicItemCurseStateDefinition => ({ id: `m7-${id}`, onset, ...rest });

const SPECS: ReadonlyMap<string, CurseSpec> = new Map([
  [
    'Armor of Vulnerability',
    {
      curse: {
        revealedBy: ['spell:identify', 'attunement'],
        endedBy: ['spell:remove-curse', 'similar magic'],
        effects: ['c2-static-armor-vulnerability-two-types'],
        stateDefinitions: [
          state('armor-vulnerability-curse', 'attune to the armor', {
            effects: ['c2-static-armor-vulnerability-two-types'],
            endsOn: [
              { trigger: 'targeted-by-spell:remove-curse-or-similar-magic' },
            ],
            note: 'Removing the armor does not end this character curse.',
          }),
        ],
      },
      clauses: [
        clause(
          'armor-vulnerability-reveal',
          'revealed only when an identify spell is cast on the armor or you attune to it',
          { block: 'curse' },
          [F5],
        ),
        clause(
          'armor-vulnerability-persistence',
          'removing the armor fails to end the curse',
          { block: 'curse' },
          [F5],
        ),
        clause(
          'armor-vulnerability-effect',
          'vulnerability to two of the three damage types associated with the armor',
          {
            block: 'effects',
            effectId: 'c2-static-armor-vulnerability-two-types',
          },
          [F9],
        ),
      ],
    },
  ],
  [
    'Berserker Axe',
    {
      effects: [
        effect('berserker-unwilling-to-part', 'movementRestriction', {
          restriction:
            'unwilling to part with the axe; keeps it within reach at all times',
          subject: 'cursed bearer',
        }),
        effect('berserker-other-weapons', 'advantage', {
          mode: 'disadvantage',
          appliesTo: 'attack rolls with weapons other than the axe',
          exception: 'no foe within 60 feet that bearer can see or hear',
        }),
        effect('berserker-forced-attacks', 'triggeredEffect', {
          trigger:
            'hostile creature damages bearer while axe is in bearer possession and bearer fails DC 15 Wisdom save',
          result:
            'enter berserk state and attack nearest creature each round with the axe',
        }),
      ],
      curse: {
        effects: [
          'm7-berserker-unwilling-to-part',
          'm7-berserker-other-weapons',
          'm7-berserker-forced-attacks',
        ],
        stateDefinitions: [
          state('berserker-axe-curse', 'become attuned to the axe', {
            effects: [
              'm7-berserker-unwilling-to-part',
              'm7-berserker-other-weapons',
            ],
          }),
          state(
            'berserker-axe-rage',
            'fail DC 15 Wisdom save after hostile creature deals damage while axe is possessed',
            {
              effects: ['m7-berserker-forced-attacks'],
              endsOn: [
                {
                  trigger:
                    'start turn with no creatures within 60 feet bearer can see or hear',
                },
              ],
              exclusive: {
                scope: 'character',
                group: 'berserker-axe-rage',
                recast: 'replace',
              },
              note: 'Nearest target is selected deterministically; ties are randomly selected through the dice service.',
            },
          ),
        ],
        note: 'The source gives no ordinary curse-ending procedure; live curse and rage instances are character conditions, not item state.',
      },
      clauses: [
        clause(
          'berserker-attachment',
          'unwilling to part with the axe, keeping it within reach at all times',
          { block: 'effects', effectId: 'm7-berserker-unwilling-to-part' },
          [F5],
        ),
        clause(
          'berserker-other-weapons',
          'disadvantage on attack rolls with weapons other than this one',
          { block: 'effects', effectId: 'm7-berserker-other-weapons' },
          [F9],
        ),
        clause(
          'berserker-rage',
          'succeed on a DC 15 Wisdom saving throw or go berserk',
          { block: 'effects', effectId: 'm7-berserker-forced-attacks' },
          [F6, F9],
        ),
        clause(
          'berserker-nearest-context',
          'attack the creature nearest to you with the axe',
          {
            adjudicated: true,
            note: 'The model identifies the contextually nearest visible/audible candidate set; deterministic dice and action owners resolve the save, a random tie, and the forced Attack action.',
          },
          [],
        ),
      ],
    },
  ],
  [
    'Demon Armor',
    {
      effects: [
        effect('demon-armor-disadvantage', 'advantage', {
          mode: 'disadvantage',
          appliesTo: [
            'attack rolls against demons',
            'saving throws against demon spells and special abilities',
          ],
        }),
      ],
      curse: {
        endedBy: ['spell:remove-curse', 'similar magic'],
        blocksDoff: true,
        effects: ['m7-demon-armor-disadvantage'],
        stateDefinitions: [
          state('demon-armor-curse', 'don the armor', {
            effects: ['m7-demon-armor-disadvantage'],
            endsOn: [
              { trigger: 'targeted-by-spell:remove-curse-or-similar-magic' },
            ],
          }),
        ],
      },
      clauses: [
        clause(
          'demon-armor-doff',
          'can’t doff it unless you are targeted by the remove curse spell or similar magic',
          { block: 'curse' },
          [F5],
        ),
        clause(
          'demon-armor-disadvantage',
          'disadvantage on attack rolls against demons and on saving throws against their spells and special abilities',
          { block: 'effects', effectId: 'm7-demon-armor-disadvantage' },
          [F9],
        ),
      ],
    },
  ],
  [
    'Shield of Missile Attraction',
    {
      effects: [
        effect('missile-attraction-redirect', 'triggeredEffect', {
          trigger:
            'ranged weapon attack targets another target within 10 feet of cursed bearer',
          result: 'cursed bearer becomes the target instead',
        }),
      ],
      curse: {
        revealedBy: ['attunement'],
        endedBy: ['spell:remove-curse', 'similar magic'],
        effects: ['m7-missile-attraction-redirect'],
        stateDefinitions: [
          state('missile-attraction-curse', 'attune to the shield', {
            effects: ['m7-missile-attraction-redirect'],
            endsOn: [
              { trigger: 'targeted-by-spell:remove-curse-or-similar-magic' },
            ],
            note: 'Removing the shield does not end the curse.',
          }),
        ],
      },
      clauses: [
        clause(
          'missile-attraction-persistence',
          'Removing the shield fails to end the curse on you',
          { block: 'curse' },
          [F5],
        ),
        clause(
          'missile-attraction-redirect',
          'curse causes you to become the target instead',
          { block: 'effects', effectId: 'm7-missile-attraction-redirect' },
          [F9],
        ),
      ],
    },
  ],
  [
    'Oathbow',
    {
      effects: [
        effect('oathbow-other-weapons', 'advantage', {
          mode: 'disadvantage',
          appliesTo:
            'attack rolls with all other weapons while sworn enemy lives',
        }),
      ],
      operations: [
        {
          id: 'm7-swear-enemy',
          activation: {
            cost: 'free',
            commandWord: true,
            trigger: 'make a ranged attack with the oathbow',
            target: 'target of the attack',
          },
          effects: ['m7-oathbow-other-weapons'],
        },
      ],
      curse: {
        effects: ['m7-oathbow-other-weapons'],
        exclusiveState: {
          id: 'sworn-enemy',
          replaces: 'no other sworn enemy may coexist',
          endsWhen: 'enemy dies or dawn seven days after oath',
          note: 'Death delays replacement until the next dawn; seventh-dawn expiry permits immediate replacement.',
        },
        stateDefinitions: [
          state('oathbow-sworn-enemy', 'operation:m7-swear-enemy', {
            effects: ['m7-oathbow-other-weapons'],
            exclusive: {
              scope: 'item-instance',
              group: 'oathbow-sworn-enemy',
              recast: 'blocked',
            },
            endsOn: [
              {
                trigger: 'sworn-enemy-dies',
                replacementAvailable: 'next-dawn',
              },
              {
                trigger: 'seventh-dawn-after-oath',
                replacementAvailable: 'immediate',
              },
            ],
            note: 'Target identity and ending clock are live item-instance/character links; the pack stores only this definition.',
          }),
        ],
      },
      clauses: [
        clause(
          'oathbow-swear',
          'target of your attack becomes your sworn enemy',
          { block: 'operations', operationId: 'm7-swear-enemy' },
          [F5, F9],
        ),
        clause(
          'oathbow-exclusive',
          'only one such sworn enemy at a time',
          { block: 'curse' },
          [F5],
        ),
        clause(
          'oathbow-endings',
          'until it dies or until dawn seven days later',
          { block: 'curse' },
          [F5, F7],
        ),
        clause(
          'oathbow-replacement',
          'choose a new one after the next dawn',
          { block: 'curse' },
          [F5, F7],
        ),
        clause(
          'oathbow-other-weapons',
          'disadvantage on attack rolls with all other weapons',
          { block: 'effects', effectId: 'm7-oathbow-other-weapons' },
          [F9],
        ),
      ],
    },
  ],
  [
    'Sword of Wounding',
    {
      effects: [
        effect('wounding-healing-suppression', 'healing', {
          mode: 'rest-only',
          appliesTo: 'hit points lost to this weapon damage',
          excludes: ['regeneration', 'magic', 'any other means'],
        }),
        effect('wounding-recurring-damage', 'recurringDamage', {
          dice: '1d4',
          type: 'necrotic',
          trigger: 'start of wounded creature turn for each wound counter',
        }),
      ],
      operations: [
        {
          id: 'm7-apply-wound',
          activation: {
            cost: 'free',
            trigger: 'once per turn when this weapon hits',
            target: 'creature hit',
          },
          effects: ['m7-wounding-recurring-damage'],
        },
        {
          id: 'm7-end-wounds-save',
          activation: {
            cost: 'free',
            trigger: 'after start-of-turn wound damage',
            target: 'wounded creature',
          },
          note: 'DC 15 Constitution saving throw ends all wounds on success.',
        },
        {
          id: 'm7-treat-wounds',
          activation: {
            cost: 'action',
            requirement: 'wounded creature or creature within 5 feet',
            target: 'wounded creature',
          },
          note: 'DC 15 Wisdom (Medicine) check ends all wounds on success.',
        },
      ],
      curse: {
        effects: [
          'm7-wounding-healing-suppression',
          'm7-wounding-recurring-damage',
        ],
        stateDefinitions: [
          state('sword-wound', 'operation:m7-apply-wound', {
            effects: ['m7-wounding-recurring-damage'],
            stack: { counterId: 'sword-wounds', increment: 1, clears: 'all' },
            endsOn: [
              { trigger: 'successful-operation:m7-end-wounds-save' },
              { trigger: 'successful-operation:m7-treat-wounds' },
            ],
            note: 'Wound count is a live target condition; damage is 1d4 per counter and application is limited to once per attacker turn.',
          }),
        ],
        note: 'Healing suppression applies only to hit points lost to this weapon damage; it is not a live HP ledger stored on the item.',
      },
      clauses: [
        clause(
          'wounding-healing',
          'can be regained only through a short or long rest',
          { block: 'effects', effectId: 'm7-wounding-healing-suppression' },
          [F6, F7],
        ),
        clause(
          'wounding-apply',
          'Once per turn, when you hit a creature with an attack using this magic weapon, you can wound the target',
          { block: 'operations', operationId: 'm7-apply-wound' },
          [F5, F6],
        ),
        clause(
          'wounding-damage',
          'takes 1d4 necrotic damage for each time you’ve wounded it',
          { block: 'effects', effectId: 'm7-wounding-recurring-damage' },
          [F6, F9],
        ),
        clause(
          'wounding-save',
          'DC 15 Constitution saving throw, ending the effect of all such wounds',
          { block: 'operations', operationId: 'm7-end-wounds-save' },
          [F6, F9],
        ),
        clause(
          'wounding-medicine',
          'DC 15 Wisdom (Medicine) check, ending the effect of such wounds',
          { block: 'operations', operationId: 'm7-treat-wounds' },
          [F6, F9],
        ),
      ],
    },
  ],
  [
    'Ring of Mind Shielding',
    {
      effects: [
        effect('mind-ring-soul-telepathy', 'telepathy', {
          audience: 'any creature wearing the soul-housing ring',
          oneWay: true,
          requiresLanguage: false,
        }),
      ],
      operations: [
        {
          id: 'm7-soul-depart',
          activation: {
            cost: 'free',
            trigger: 'captured soul chooses to depart for the afterlife',
          },
        },
      ],
      curse: {
        effects: ['m7-mind-ring-soul-telepathy'],
        stateDefinitions: [
          state(
            'mind-ring-housed-soul',
            'wearer dies while ring has no housed soul',
            {
              effects: ['m7-mind-ring-soul-telepathy'],
              exclusive: {
                scope: 'item-instance',
                group: 'ring-housed-soul',
                recast: 'blocked',
              },
              endsOn: [{ trigger: 'operation:m7-soul-depart' }],
              note: 'Soul identity and occupancy are live item-instance state; a second death cannot replace an occupied soul.',
            },
          ),
        ],
      },
      clauses: [
        clause(
          'mind-ring-capture',
          'your soul enters it, unless it already houses a soul',
          { block: 'curse' },
          [F5, F6],
        ),
        clause(
          'mind-ring-depart',
          'remain in the ring or depart for the afterlife',
          { block: 'operations', operationId: 'm7-soul-depart' },
          [F5, F6],
        ),
        clause(
          'mind-ring-telepathy',
          'telepathically communicate with any creature wearing it',
          { block: 'effects', effectId: 'm7-mind-ring-soul-telepathy' },
          [F5],
        ),
      ],
    },
  ],
  [
    'Orb of Dragonkind',
    {
      effects: [
        effect('orb-enslaved-charm', 'imposesCondition', {
          conditions: ['charmed'],
          target: 'failed controller',
          duration: 'while attuned',
        }),
        effect('orb-suggestion', 'castSpell', {
          spell: 'spell:suggestion',
          frequency: 'at-will',
          saveDc: 18,
          target: 'charmed attuned bearer',
        }),
      ],
      operations: [
        {
          id: 'm7-attempt-orb-control',
          activation: {
            cost: 'action',
            commandWord: true,
            requirement: 'attuned to orb',
          },
          effects: ['m7-orb-enslaved-charm', 'm7-orb-suggestion'],
          note: 'DC 15 Charisma check; success controls the orb while attuned, failure applies its charmed enslavement state.',
        },
      ],
      curse: {
        blocksUnattune: true,
        effects: ['m7-orb-enslaved-charm', 'm7-orb-suggestion'],
        stateDefinitions: [
          state('orb-enslavement', 'fail the DC 15 Charisma control check', {
            effects: ['m7-orb-enslaved-charm', 'm7-orb-suggestion'],
            endsOn: [{ trigger: 'attunement-ended-by-nonvoluntary-means' }],
            exclusive: {
              scope: 'item-instance',
              group: 'orb-controller-state',
              recast: 'replace',
            },
            note: 'While charmed, bearer cannot voluntarily unattune; the dragon essence’s desired evil ends are contextual GM adjudication.',
          }),
        ],
      },
      clauses: [
        clause(
          'orb-control-check',
          'make a DC 15 Charisma check',
          { block: 'operations', operationId: 'm7-attempt-orb-control' },
          [F5, F9],
        ),
        clause(
          'orb-charm',
          'failed check, you become charmed by the orb for as long as you remain attuned to it',
          { block: 'effects', effectId: 'm7-orb-enslaved-charm' },
          [F5, F6],
        ),
        clause(
          'orb-block-unattune',
          'can’t voluntarily end your attunement to it',
          { block: 'curse' },
          [F5],
        ),
        clause(
          'orb-suggestion',
          'orb casts suggestion on you at will (save DC 18)',
          { block: 'effects', effectId: 'm7-orb-suggestion' },
          [F5, F9],
        ),
        clause(
          'orb-evil-ends-context',
          'or something else the GM decides',
          {
            adjudicated: true,
            note: 'The orb essence’s desired evil end is deliberately GM-adjudicated; casting, save DC, charm, and attunement lock remain deterministic.',
          },
          [],
        ),
      ],
    },
  ],
  [
    'Robe of the Archmagi',
    {
      effects: [
        effect('archmagi-alignment-gate', 'triggeredEffect', {
          trigger: 'attempt to attune',
          condition:
            'robe color alignment does not correspond to character alignment',
          result: 'attunement fails',
          alignmentByColor: { white: 'good', gray: 'neutral', black: 'evil' },
        }),
      ],
      curse: {
        effects: ['m7-archmagi-alignment-gate'],
        note: 'White=good, gray=neutral, black=evil; this is an attunement precondition, not a live curse.',
      },
      clauses: [
        clause(
          'archmagi-alignment',
          'can’t attune to a robe of the archmagi that doesn’t correspond to your alignment',
          { block: 'effects', effectId: 'm7-archmagi-alignment-gate' },
          [F5],
        ),
      ],
    },
  ],
  [
    'Talisman of Pure Good',
    {
      effects: [
        effect('pure-good-alignment-contact', 'triggeredEffect', {
          trigger: 'touch or end turn holding/carrying talisman',
          result:
            'neutral creature takes 6d6 radiant; evil creature takes 8d6 radiant',
        }),
        effect('pure-good-fissure-gate', 'triggeredEffect', {
          trigger: 'fissure operation targets creature',
          condition: 'target is evil',
          result: 'DC 20 Dexterity save or destroyed without remains',
        }),
        effect('pure-good-wielder-eligibility', 'triggeredEffect', {
          trigger:
            'attempt to use as holy symbol or gain its spell-attack bonus',
          condition: 'wielder is a good cleric or paladin',
          result: 'eligible only when condition is met',
        }),
      ],
      curse: {
        effects: [
          'm7-pure-good-alignment-contact',
          'm7-pure-good-fissure-gate',
          'm7-pure-good-wielder-eligibility',
        ],
        note: 'Alignment eligibility and consequences subscribe to character alignment and deterministic damage/save owners.',
      },
      clauses: [
        clause(
          'pure-good-eligibility',
          'If you are a good cleric or paladin',
          {
            block: 'effects',
            effectId: 'm7-pure-good-wielder-eligibility',
          },
          [F5, F9],
        ),
        clause(
          'pure-good-contact',
          'neither good nor evil in alignment takes 6d6 radiant damage',
          { block: 'effects', effectId: 'm7-pure-good-alignment-contact' },
          [F6, F9],
        ),
        clause(
          'pure-good-evil-contact',
          'evil creature takes 8d6 radiant damage',
          { block: 'effects', effectId: 'm7-pure-good-alignment-contact' },
          [F6, F9],
        ),
        clause(
          'pure-good-fissure',
          'If the target is of evil alignment',
          { block: 'effects', effectId: 'm7-pure-good-fissure-gate' },
          [F6, F9],
        ),
      ],
    },
  ],
  [
    'Talisman of Ultimate Evil',
    {
      effects: [
        effect('ultimate-evil-alignment-contact', 'triggeredEffect', {
          trigger: 'touch or end turn holding/carrying talisman',
          result:
            'neutral creature takes 6d6 necrotic; good creature takes 8d6 necrotic',
        }),
        effect('ultimate-evil-fissure-gate', 'triggeredEffect', {
          trigger: 'fissure operation targets creature',
          condition: 'target is good',
          result: 'DC 20 Dexterity save or destroyed without remains',
        }),
        effect('ultimate-evil-wielder-eligibility', 'triggeredEffect', {
          trigger:
            'attempt to use as holy symbol or gain its spell-attack bonus',
          condition: 'wielder is an evil cleric or paladin',
          result: 'eligible only when condition is met',
        }),
      ],
      curse: {
        effects: [
          'm7-ultimate-evil-alignment-contact',
          'm7-ultimate-evil-fissure-gate',
          'm7-ultimate-evil-wielder-eligibility',
        ],
        note: 'Alignment eligibility and consequences subscribe to character alignment and deterministic damage/save owners.',
      },
      clauses: [
        clause(
          'ultimate-evil-eligibility',
          'If you are an evil cleric or paladin',
          {
            block: 'effects',
            effectId: 'm7-ultimate-evil-wielder-eligibility',
          },
          [F5, F9],
        ),
        clause(
          'ultimate-evil-contact',
          'neither good nor evil in alignment takes 6d6 necrotic damage',
          { block: 'effects', effectId: 'm7-ultimate-evil-alignment-contact' },
          [F6, F9],
        ),
        clause(
          'ultimate-evil-good-contact',
          'good creature takes 8d6 necrotic damage',
          { block: 'effects', effectId: 'm7-ultimate-evil-alignment-contact' },
          [F6, F9],
        ),
        clause(
          'ultimate-evil-fissure',
          'If the target is of good alignment',
          { block: 'effects', effectId: 'm7-ultimate-evil-fissure-gate' },
          [F6, F9],
        ),
      ],
    },
  ],
  [
    'Deck of Many Things',
    {
      effects: [
        effect('deck-euryale-penalty', 'savingThrowModifier', {
          amount: -2,
          appliesTo: 'all saving throws',
          duration: 'until ended by a god or The Fates',
        }),
        effect('deck-donjon-suspension', 'triggeredEffect', {
          trigger: 'draw and resolve Donjon',
          result:
            'disappear and become imprisoned in suspended animation in an extradimensional sphere',
        }),
        effect('deck-void-incapacitation', 'imposesCondition', {
          conditions: ['incapacitated'],
          reason: 'soul trapped in guarded object',
        }),
      ],
      curse: {
        effects: [
          'm7-deck-euryale-penalty',
          'm7-deck-donjon-suspension',
          'm7-deck-void-incapacitation',
        ],
        stateDefinitions: [
          state('deck-euryale-curse', 'draw and resolve Euryale', {
            effects: ['m7-deck-euryale-penalty'],
            endsOn: [
              { trigger: 'god-ends-curse' },
              { trigger: 'magic-of-the-fates-card' },
            ],
          }),
          state('deck-donjon-imprisonment', 'draw and resolve Donjon', {
            effects: ['m7-deck-donjon-suspension'],
            endsOn: [
              { trigger: 'found-and-removed-from-extradimensional-sphere' },
            ],
            note: 'Wish reveals the prison location but does not itself free the character; divination otherwise cannot locate it.',
          }),
          state('deck-void-soul-trap', 'draw and resolve The Void', {
            effects: ['m7-deck-void-incapacitation'],
            endsOn: [{ trigger: 'soul-freed-from-containing-object' }],
            note: 'Wish reveals the object location but cannot restore the soul; body remains incapacitated.',
          }),
        ],
        note: 'These are immutable card-state definitions. The live curse, imprisonment, soul object, and character incapacitation are campaign state created by M8 card resolution.',
      },
      clauses: [
        clause(
          'deck-euryale',
          'take a −2 penalty on saving throws while cursed in this way',
          { block: 'effects', effectId: 'm7-deck-euryale-penalty' },
          [F5, F9],
        ),
        clause(
          'deck-euryale-ending',
          'Only a god or the magic of The Fates card can end this curse',
          { block: 'curse' },
          [F5],
        ),
        clause(
          'deck-donjon',
          'entombed in a state of suspended animation in an extradimensional sphere',
          { block: 'effects', effectId: 'm7-deck-donjon-suspension' },
          [F5, F6],
        ),
        clause(
          'deck-donjon-ending',
          'remain imprisoned until you are found and removed from the sphere',
          { block: 'curse' },
          [F5],
        ),
        clause(
          'deck-void',
          'Your soul is drawn from your body and contained in an object',
          { block: 'effects', effectId: 'm7-deck-void-incapacitation' },
          [F5, F6],
        ),
        clause(
          'deck-void-ending',
          'wish spell can’t restore your soul, but the spell reveals the location',
          { block: 'curse' },
          [F5],
        ),
      ],
    },
  ],
]);

export const MAGIC_ITEM_CURSE_NAMES = Object.freeze([...SPECS.keys()]);
export const MAGIC_ITEM_CURSE_REFERENCES = Object.freeze([
  'spell:identify',
  'spell:remove-curse',
  'spell:suggestion',
]);

function itemClause(spec: ClauseSpec): ItemClauseExpectation {
  return {
    id: spec.id,
    tag: 'M7',
    representation: spec.representation,
    engineHooks: spec.hooks,
  };
}

export function projectMagicItemCurses(
  item: MagicItemExtraction,
): MagicItemFamilyProjection | undefined {
  const spec = SPECS.get(item.name);
  if (spec === undefined) return undefined;
  for (const clauseSpec of spec.clauses) {
    if (!item.description.includes(clauseSpec.phrase)) {
      throw new Error(
        `magic-item M7 curse projection: expected source phrase ${JSON.stringify(clauseSpec.phrase)} not found in ${JSON.stringify(item.name)} for clause ${JSON.stringify(clauseSpec.id)}`,
      );
    }
  }
  return {
    family: 'm7-curses-oaths-restrictions',
    mechanics: {
      curse: spec.curse,
      ...(spec.effects === undefined ? {} : { effects: spec.effects }),
      ...(spec.operations === undefined ? {} : { operations: spec.operations }),
    } satisfies Readonly<Partial<MagicItemMechanics>>,
    clauses: spec.clauses.map(itemClause),
  };
}
