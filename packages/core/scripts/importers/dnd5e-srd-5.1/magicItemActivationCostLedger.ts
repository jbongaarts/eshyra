/**
 * Evidence ledger for activation-cost typing in the SRD pack
 * (eshyra-xwau.1; bd memory magic-item-faithful-or-absent).
 *
 * Rule: a magic-item operation (or the operation that drives a state-machine
 * activate/deactivate transition) gets a typed `activation.cost` ONLY where the
 * item's own printed text names the action type for that exact operation. Not
 * by analogy, item category, or the core rules, except the narrow cited
 * exception below.
 *
 * Two ledgers:
 *  - {@link TYPED_ACTIVATION_COST_EVIDENCE}: every cost typed by a later
 *    bead, with the exact printed phrase. xwau.1's audit found none left
 *    untyped by the earlier faithful-or-absent corpus (o9bd.19.4.6.x); the
 *    entries are eshyra-7f0h's Apparatus move-levers and Candle light/cast-gate.
 *  - {@link UNTYPED_ACTIVATION_PHRASE_DISPOSITIONS}: every operation that stays
 *    untyped although its item text contains a strict action-type phrase,
 *    with the reason that phrase does not type THIS operation. A test asserts
 *    the table equals the computed set, so a new untyped operation whose text
 *    prints an action phrase fails until it is reviewed.
 *
 * Core-rule exception (not applied): SRD equipment "Potion of Healing" prints
 * "Drinking or administering a potion takes an action." It is scoped to that
 * equipment entry, and the single-valued `activation.cost` vocabulary carries
 * `consume` (the item is expended) for every drink operation. Retyping them
 * `action` would drop the typed consume fact, so drink operations keep
 * `consume` and spend no turn resource automatically (DM-adjudicated).
 */

export interface TypedActivationCostEvidence {
  readonly item: string;
  readonly operationId: string;
  readonly cost: 'action' | 'bonus-action' | 'reaction';
  /** Exact span of the item's printed description naming the action type. */
  readonly phrase: string;
}

export const TYPED_ACTIVATION_COST_EVIDENCE: readonly TypedActivationCostEvidence[] =
  [
    {
      item: 'Apparatus of the Crab',
      operationId: 'move-levers',
      cost: 'action',
      phrase:
        'A creature in the compartment can use an action to move as many as two of the apparatus’s levers up or down',
    },
    {
      item: 'Candle of Invocation',
      operationId: 'light',
      cost: 'action',
      phrase:
        'The candle’s magic is activated when the candle is lit, which requires an action',
    },
    // The first-light gate is the lighting action; the gate spell’s own casting
    // time is also 1 action, so the two do not conflict (eshyra-7f0h).
    {
      item: 'Candle of Invocation',
      operationId: 'cast-gate',
      cost: 'action',
      phrase:
        'The candle’s magic is activated when the candle is lit, which requires an action',
    },
  ];

/**
 * Strict action-type phrase (at least as strict as the olc5.9 N3 override
 * evidence): a verb of use or "as a/an" directly followed by the action type.
 * A bare "action" word, or "action" inside another word, never matches.
 */
export const ACTION_TYPE_PHRASE =
  /\b(?:use|uses|using)\s+(?:an|your|a)\s+(?:bonus\s+action|action|reaction)\b|\b(?:as|requires?|takes?)\s+(?:an|a)\s+(?:bonus\s+action|action|reaction)\b|\buse\s+the\s+reaction\b/i;

const SPELL_CASTING_TIME =
  'The printed action activates a spell cast from the item; rule:spells says an item spell uses its normal casting time unless the item changes it, and this one does not (olc5.9.2). use_item already spends the bound spell casting time.';
const OTHER_OPERATION =
  'The printed action type governs a different operation of this item (typed there), not this operation.';

export const UNTYPED_ACTIVATION_PHRASE_DISPOSITIONS: Readonly<
  Record<string, string>
> = {
  'Boots of Speed/maintain-speed': OTHER_OPERATION,
  'Boots of Speed/deactivate-speed':
    'The bonus action is printed for the first click; ending the effect restates no action (magicItemFaithfulOperations).',
  'Candle of Invocation/burn':
    'Burn-time deduction spends no action: only the lighting (typed on light) requires one.',
  'Candle of Invocation/snuff':
    'The printed text names no action for snuffing the candle out early, so none is typed.',
  'Candle of Invocation/m9-cast-candle-spell':
    'Casting is free of slots and prints no action type for the cast.',
  'Cape of the Mountebank/cast-dimension-door': SPELL_CASTING_TIME,
  'Carpet of Flying/end-flight': OTHER_OPERATION,
  'Circlet of Blasting/cast-scorching-ray': SPELL_CASTING_TIME,
  'Cloak of the Bat/end-polymorph': OTHER_OPERATION,
  'Dancing Sword/catch-sword': OTHER_OPERATION,
  'Dimensional Shackles/escape-shackles':
    'The creature breaks free with a Strength check; the printed actions are for placing and removing the shackles (typed on those operations).',
  'Figurine of Wondrous Power/goat-of-traveling-beast-form-hour':
    'Spends an hour of beast form; the printed action transforms the figurine.',
  'Ioun Stone::Reserve/m9-store-ioun-reserve': OTHER_OPERATION,
  'Ioun Stone::Reserve/m9-cast-ioun-reserve': OTHER_OPERATION,
  'Necklace of Prayer Beads/remove-bead':
    'The printed bonus action casts the bead spell (typed on cast-bead-spell); removing a bead prints no action.',
  'Orb of Dragonkind/cast-scrying': SPELL_CASTING_TIME,
  'Ring of Mind Shielding/m7-soul-depart': OTHER_OPERATION,
  'Rod of Absorption/m9-cast-with-rod-energy':
    'The printed reaction absorbs a spell (typed on m9-absorb-rod-spell); casting with stored energy prints no action.',
  'Rod of Lordly Might/drain-life':
    'A hit-triggered property; the printed bonus action presses a button and the printed action is Terrify.',
  'Rod of Lordly Might/paralyze': 'See drain-life.',
  'Rope of Climbing/fasten-rope':
    'The printed bonus action commands the rope end to move; fastening, knotting and releasing print no action of their own.',
  'Rope of Climbing/knot-rope': 'See fasten-rope.',
  'Rope of Climbing/release-rope': 'See fasten-rope.',
  'Sphere of Annihilation/sphere-space-entry':
    'The printed action attempts control (typed on attempt-control); entering the sphere space is an automatic effect.',
  'Sphere of Annihilation/contest-control':
    'A contested check after the controlling attempt; prints no action of its own.',
  'Sphere of Annihilation/move-sphere':
    'Moving a controlled sphere prints no action.',
  'Staff of Charming/m10-flip-enchantment-save':
    'Flipping a failed save prints no action; the printed reaction turns the spell back (typed on reflect-enchantment).',
  'Staff of Power/power-strike':
    'A hit-triggered charge spend; the printed actions are the spells and the retributive strike.',
  'Staff of the Magi/cast-conjure-elemental': SPELL_CASTING_TIME,
  'Staff of the Woodlands/cast-awaken': SPELL_CASTING_TIME,
  'Staff of Thunder and Lightning/lightning':
    'The hit-triggered Lightning property; the printed action is Lightning Strike (typed on that operation).',
  'Staff of Thunder and Lightning/thunder':
    'The hit-triggered Thunder property; the printed action is Thunderclap (typed on that operation).',
  'Sword of Wounding/m7-apply-wound':
    'The printed action is a creature’s Medicine check to end the wounds, not applying them.',
  'Sword of Wounding/m7-end-wounds-save':
    'The printed action is the Medicine check alternative; the end-of-turn save is not an action.',
  'Wand of Binding/assisted-escape':
    'The printed reaction applies only to the saving-throw branch; no common cost is typed for both branches.',
};
