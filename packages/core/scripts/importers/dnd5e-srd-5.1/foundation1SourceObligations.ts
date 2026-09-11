import { createHash } from 'node:crypto';
import type { RulesRecordKind } from '../../../src/rules/types.js';
import type {
  Foundation1Facet,
  Foundation1Obligation,
  Foundation1SourceSpan,
} from '../../../src/rules/verticalProcedureProof.js';
import type { PageText } from './types.js';

const SOURCE_REF =
  'https://dnd.wizards.com/resources/systems-reference-document';
export const FOUNDATION1_SOURCE_HASH =
  '2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0';

interface SourceAnchorDraft {
  readonly page: number;
  readonly lines: readonly string[];
}

interface ObligationDraft {
  readonly procedureId: string;
  readonly ordinal: number;
  readonly owner: {
    readonly kind: RulesRecordKind;
    readonly sourceHeading: string;
    readonly sourcePage: number;
  };
  readonly anchors: readonly SourceAnchorDraft[];
  readonly facet: Foundation1Facet;
  readonly localityPointer: string;
  readonly expected: unknown;
}

const anchor = (
  page: number,
  ...lines: readonly string[]
): SourceAnchorDraft => ({
  page,
  lines,
});

const owner = (
  kind: RulesRecordKind,
  sourceHeading: string,
  sourcePage: number,
) => ({
  kind,
  sourceHeading,
  sourcePage,
});

const BURNT_OTHUR = owner('hazard', 'Burnt Othur Fumes', 204);
const LONGSWORD = owner('equipment', 'Longsword', 66);
const FIGHTING_STYLE = owner('feature', 'Fighting Style', 24);
const FONT_OF_MAGIC = owner('feature', 'Font of Magic', 43);
const WISH = owner('spell', 'Wish', 193);

const SORCERY_POINT_MAXIMUMS = [
  { level: 2, maximum: 2 },
  { level: 3, maximum: 3 },
  { level: 4, maximum: 4 },
  { level: 5, maximum: 5 },
  { level: 6, maximum: 6 },
  { level: 7, maximum: 7 },
  { level: 8, maximum: 8 },
  { level: 9, maximum: 9 },
  { level: 10, maximum: 10 },
  { level: 11, maximum: 11 },
  { level: 12, maximum: 12 },
  { level: 13, maximum: 13 },
  { level: 14, maximum: 14 },
  { level: 15, maximum: 15 },
  { level: 16, maximum: 16 },
  { level: 17, maximum: 17 },
  { level: 18, maximum: 18 },
  { level: 19, maximum: 19 },
  { level: 20, maximum: 20 },
] as const;

const SPELL_SLOT_COSTS = [
  { slotLevel: 1, cost: 2 },
  { slotLevel: 2, cost: 3 },
  { slotLevel: 3, cost: 5 },
  { slotLevel: 4, cost: 6 },
  { slotLevel: 5, cost: 7 },
] as const;

const DRAFTS: readonly ObligationDraft[] = [
  {
    procedureId: 'burnt-othur-fumes',
    ordinal: 1,
    owner: BURNT_OTHUR,
    anchors: [
      anchor(
        204,
        'subjected to this poison must succeed on a DC 13',
        'Constitution saving throw or take 10 (3d6) poison',
        'damage, and must repeat the saving throw at the',
      ),
    ],
    facet: 'save',
    localityPointer: '/procedure/burnt-othur-fumes/initial',
    expected: { ability: 'constitution', dc: 13 },
  },
  {
    procedureId: 'burnt-othur-fumes',
    ordinal: 2,
    owner: BURNT_OTHUR,
    anchors: [
      anchor(
        204,
        'Constitution saving throw or take 10 (3d6) poison',
        'damage, and must repeat the saving throw at the',
      ),
    ],
    facet: 'damage',
    localityPointer: '/procedure/burnt-othur-fumes/initial',
    expected: { dice: '3d6', type: 'poison' },
  },
  {
    procedureId: 'burnt-othur-fumes',
    ordinal: 3,
    owner: BURNT_OTHUR,
    anchors: [
      anchor(
        204,
        'damage, and must repeat the saving throw at the',
        'start of each of its turns. On each successive failed',
      ),
    ],
    facet: 'repeat-timing',
    localityPointer: '/procedure/burnt-othur-fumes/repeat',
    expected: 'start-of-affected-turn',
  },
  {
    procedureId: 'burnt-othur-fumes',
    ordinal: 4,
    owner: BURNT_OTHUR,
    anchors: [
      anchor(
        204,
        'damage, and must repeat the saving throw at the',
        'start of each of its turns. On each successive failed',
      ),
    ],
    facet: 'save',
    localityPointer: '/procedure/burnt-othur-fumes/repeat',
    expected: { ability: 'constitution', dc: 13 },
  },
  {
    procedureId: 'burnt-othur-fumes',
    ordinal: 5,
    owner: BURNT_OTHUR,
    anchors: [
      anchor(
        204,
        'start of each of its turns. On each successive failed',
        'save, the character takes 3 (1d6) poison damage.',
      ),
    ],
    facet: 'damage',
    localityPointer: '/procedure/burnt-othur-fumes/repeat',
    expected: { dice: '1d6', type: 'poison' },
  },
  {
    procedureId: 'burnt-othur-fumes',
    ordinal: 6,
    owner: BURNT_OTHUR,
    anchors: [
      anchor(
        204,
        'save, the character takes 3 (1d6) poison damage.',
        'After three successful saves, the poison ends.',
      ),
    ],
    facet: 'termination',
    localityPointer: '/procedure/burnt-othur-fumes/termination',
    expected: { kind: 'successful-saves', count: 3 },
  },
  {
    procedureId: 'longsword-damage',
    ordinal: 1,
    owner: LONGSWORD,
    anchors: [
      anchor(
        65,
        'Versatile. This weapon can be used with one or',
        'two hands. A damage value in parentheses appears',
        'with the property—the damage when the weapon is',
        'used with two hands to make a melee attack.',
      ),
    ],
    facet: 'mode-selector',
    localityPointer: '/procedure/longsword-damage',
    expected: 'hands-used',
  },
  {
    procedureId: 'longsword-damage',
    ordinal: 2,
    owner: LONGSWORD,
    anchors: [anchor(66, 'Longsword 15 gp 1d8 slashing')],
    facet: 'damage',
    localityPointer: '/procedure/longsword-damage/mode/one-handed',
    expected: {
      id: 'one-handed',
      hands: 1,
      damage: { dice: '1d8', type: 'slashing' },
    },
  },
  {
    procedureId: 'longsword-damage',
    ordinal: 3,
    owner: LONGSWORD,
    anchors: [
      anchor(66, '3 lb. Versatile (1d10)'),
      anchor(
        65,
        'Versatile. This weapon can be used with one or',
        'two hands. A damage value in parentheses appears',
        'with the property—the damage when the weapon is',
        'used with two hands to make a melee attack.',
      ),
    ],
    facet: 'damage',
    localityPointer: '/procedure/longsword-damage/mode/two-handed',
    expected: {
      id: 'two-handed',
      hands: 2,
      damage: { dice: '1d10', type: 'slashing' },
    },
  },
  {
    procedureId: 'fighter-fighting-style',
    ordinal: 1,
    owner: FIGHTING_STYLE,
    anchors: [
      anchor(
        24,
        'specialty. Choose one of the following options. You',
        'can’t take a Fighting Style option more than once,',
      ),
    ],
    facet: 'choice-cardinality',
    localityPointer: '/procedure/fighter-fighting-style/choice/fighting-style',
    expected: {
      choiceId: 'fighting-style',
      choose: 1,
      procedureChoiceId: 'fighting-style',
    },
  },
  {
    procedureId: 'fighter-fighting-style',
    ordinal: 2,
    owner: FIGHTING_STYLE,
    anchors: [
      anchor(
        24,
        'can’t take a Fighting Style option more than once,',
        'even if you later get to choose again.',
      ),
    ],
    facet: 'duplicate-selection',
    localityPointer: '/procedure/fighter-fighting-style',
    expected: 'prohibited',
  },
  {
    procedureId: 'fighter-fighting-style',
    ordinal: 3,
    owner: FIGHTING_STYLE,
    anchors: [
      anchor(
        24,
        'Archery',
        'You gain a +2 bonus to attack rolls you make with',
        'ranged weapons.',
      ),
    ],
    facet: 'option-effect',
    localityPointer:
      '/procedure/fighter-fighting-style/option/fighting-style:archery',
    expected: {
      id: 'fighting-style:archery',
      effect: { kind: 'attack-roll-bonus', amount: 2, weaponRange: 'ranged' },
    },
  },
  {
    procedureId: 'fighter-fighting-style',
    ordinal: 4,
    owner: FIGHTING_STYLE,
    anchors: [
      anchor(
        24,
        'Defense',
        'While you are wearing armor, you gain a +1 bonus to',
        'AC.',
      ),
    ],
    facet: 'option-effect',
    localityPointer:
      '/procedure/fighter-fighting-style/option/fighting-style:defense',
    expected: {
      id: 'fighting-style:defense',
      effect: {
        kind: 'armor-class-bonus',
        amount: 1,
        whileWearingArmor: true,
      },
    },
  },
  {
    procedureId: 'fighter-fighting-style',
    ordinal: 5,
    owner: FIGHTING_STYLE,
    anchors: [
      anchor(
        24,
        'Dueling',
        'When you are wielding a melee weapon in one hand',
        'and no other weapons, you gain a +2 bonus to',
        'damage rolls with that weapon.',
      ),
    ],
    facet: 'option-effect',
    localityPointer:
      '/procedure/fighter-fighting-style/option/fighting-style:dueling',
    expected: {
      id: 'fighting-style:dueling',
      effect: {
        kind: 'damage-roll-bonus',
        amount: 2,
        weaponRange: 'melee',
        weaponHands: 1,
        noOtherWeapon: true,
      },
    },
  },
  {
    procedureId: 'fighter-fighting-style',
    ordinal: 6,
    owner: FIGHTING_STYLE,
    anchors: [
      anchor(
        24,
        'Great Weapon Fighting',
        'When you roll a 1 or 2 on a damage die for an attack',
        'you make with a melee weapon that you are',
        'wielding with two hands, you can reroll the die and',
        'must use the new roll, even if the new roll is a 1 or a',
        '2. The weapon must have the two-handed or',
        'versatile property for you to gain this benefit.',
      ),
    ],
    facet: 'option-effect',
    localityPointer:
      '/procedure/fighter-fighting-style/option/fighting-style:great-weapon-fighting',
    expected: {
      id: 'fighting-style:great-weapon-fighting',
      effect: {
        kind: 'damage-die-reroll',
        rerollValues: [1, 2],
        keepReroll: true,
        weaponRange: 'melee',
        handsUsed: 2,
        requiredProperties: ['two-handed', 'versatile'],
      },
    },
  },
  {
    procedureId: 'fighter-fighting-style',
    ordinal: 7,
    owner: FIGHTING_STYLE,
    anchors: [
      anchor(
        24,
        'Protection',
        'When a creature you can see attacks a target other',
        'than you that is within 5 feet of you, you can use',
        'your reaction to impose disadvantage on the attack',
        'roll. You must be wielding a shield.',
      ),
    ],
    facet: 'option-effect',
    localityPointer:
      '/procedure/fighter-fighting-style/option/fighting-style:protection',
    expected: {
      id: 'fighting-style:protection',
      effect: {
        kind: 'reaction-attack-disadvantage',
        target: 'other-creature',
        rangeFeet: 5,
        requiresSight: true,
        requiresShield: true,
      },
    },
  },
  {
    procedureId: 'fighter-fighting-style',
    ordinal: 8,
    owner: FIGHTING_STYLE,
    anchors: [
      anchor(
        24,
        'Two-Weapon Fighting',
        'When you engage in two-weapon fighting, you can',
        'add your ability modifier to the damage of the',
        'second attack.',
      ),
    ],
    facet: 'option-effect',
    localityPointer:
      '/procedure/fighter-fighting-style/option/fighting-style:two-weapon-fighting',
    expected: {
      id: 'fighting-style:two-weapon-fighting',
      effect: {
        kind: 'offhand-damage-ability-modifier',
        addAbilityModifier: true,
      },
    },
  },
  {
    procedureId: 'font-of-magic',
    ordinal: 1,
    owner: FONT_OF_MAGIC,
    anchors: [
      anchor(
        43,
        'This wellspring is represented by',
        'sorcery points, which allow you to create a variety of',
        'magical effects.',
        'Sorcery Points',
      ),
    ],
    facet: 'resource-pool',
    localityPointer: '/data/mechanics/procedures/0/pool',
    expected: { id: 'sorcery-points', name: 'Sorcery Points' },
  },
  {
    procedureId: 'font-of-magic',
    ordinal: 2,
    owner: FONT_OF_MAGIC,
    anchors: [
      anchor(
        42,
        '1st +2 Spellcasting, Sorcerous',
        'Origin',
        '2nd +2 2 Font of Magic',
        '3rd +2 3 Metamagic',
        '4th +2 4 Ability Score',
        'Improvement',
        '5th +3 5',
        '6th +3 6 Sorcerous Origin',
        'feature',
        '7th +3 7',
        '8th +3 8 Ability Score',
        'Improvement',
        '9th +4 9',
        '10th +4 10 Metamagic',
        '11th +4 11',
        '12th +4 12 Ability Score',
        'Improvement',
        '13th +5 13',
        '14th +5 14 Sorcerous Origin',
        'feature',
        '15th +5 15',
        '16th +5 16 Ability Score',
        'Improvement',
        '17th +6 17 Metamagic',
        '18th +6 18 Sorcerous Origin',
        'feature',
        '19th +6 19 Ability Score',
        'Improvement',
        '20th +6 20 Sorcerous Restoration',
      ),
      anchor(
        43,
        'You have 2 sorcery points, and you gain more as you',
        'reach higher levels, as shown in the Sorcery Points',
        'column of the Sorcerer table. You can never have',
        'more sorcery points than shown on the table for',
        'your level.',
      ),
    ],
    facet: 'resource-maximum',
    localityPointer: '/data/mechanics/procedures/0/pool/maximumByLevel',
    expected: SORCERY_POINT_MAXIMUMS,
  },
  {
    procedureId: 'font-of-magic',
    ordinal: 3,
    owner: FONT_OF_MAGIC,
    anchors: [
      anchor(
        43,
        'your level. You regain all spent sorcery points when',
        'you finish a long rest.',
      ),
    ],
    facet: 'resource-reset',
    localityPointer: '/data/mechanics/procedures/0/pool',
    expected: 'long-rest',
  },
  {
    procedureId: 'font-of-magic',
    ordinal: 4,
    owner: FONT_OF_MAGIC,
    anchors: [
      anchor(
        43,
        'Creating Spell Slots. You can transform',
        'unexpended sorcery points into one spell slot as a',
        'bonus action on your turn.',
      ),
    ],
    facet: 'create-slot-action',
    localityPointer: '/data/mechanics/procedures/0/operations/createSpellSlot',
    expected: 'bonus-action',
  },
  {
    procedureId: 'font-of-magic',
    ordinal: 5,
    owner: FONT_OF_MAGIC,
    anchors: [
      anchor(
        43,
        'table shows the cost of creating a spell slot of a given',
        'level. You can create spell slots no higher in level',
        'than 5th.',
      ),
    ],
    facet: 'create-slot-limit',
    localityPointer: '/data/mechanics/procedures/0/operations/createSpellSlot',
    expected: 5,
  },
  {
    procedureId: 'font-of-magic',
    ordinal: 6,
    owner: FONT_OF_MAGIC,
    anchors: [
      anchor(
        43,
        'Creating Spell Slots',
        'Spell Slot Sorcery',
        'Level Point Cost',
        '1st 2',
        '2nd 3',
        '3rd 5',
        '4th 6',
        '5th 7',
      ),
    ],
    facet: 'create-slot-costs',
    localityPointer:
      '/data/mechanics/procedures/0/operations/createSpellSlot/costBySlotLevel',
    expected: SPELL_SLOT_COSTS,
  },
  {
    procedureId: 'font-of-magic',
    ordinal: 7,
    owner: FONT_OF_MAGIC,
    anchors: [
      anchor(
        43,
        'Any spell slot you create with this feature vanishes',
        'when you finish a long rest.',
      ),
    ],
    facet: 'created-slot-expiry',
    localityPointer: '/data/mechanics/procedures/0/operations/createSpellSlot',
    expected: 'long-rest',
  },
  {
    procedureId: 'font-of-magic',
    ordinal: 8,
    owner: FONT_OF_MAGIC,
    anchors: [
      anchor(
        43,
        'Converting a Spell Slot to Sorcery Points. As a',
        'bonus action on your turn, you can expend one spell',
      ),
      anchor(
        44,
        'slot and gain a number of sorcery points equal to the',
        'slot’s level.',
      ),
    ],
    facet: 'convert-slot-action',
    localityPointer: '/data/mechanics/procedures/0/operations/convertSpellSlot',
    expected: 'bonus-action',
  },
  {
    procedureId: 'font-of-magic',
    ordinal: 9,
    owner: FONT_OF_MAGIC,
    anchors: [
      anchor(
        44,
        'slot and gain a number of sorcery points equal to the',
        'slot’s level.',
      ),
    ],
    facet: 'conversion-value',
    localityPointer: '/data/mechanics/procedures/0/operations/convertSpellSlot',
    expected: 'slot-level',
  },
  {
    procedureId: 'wish-nonstandard-effect',
    ordinal: 1,
    owner: WISH,
    anchors: [
      anchor(
        193,
        'scope of the above examples. State your wish to the',
        'GM as precisely as possible. The GM has great',
        'latitude in ruling what occurs in such an instance;',
      ),
    ],
    facet: 'adjudication-boundary',
    localityPointer: '/data/mechanics/procedures/0/adjudicationBoundary',
    expected: {
      id: 'wish-beyond-listed-effects',
      boundaryKind: 'designed-adjudication',
      adjudicator: 'dm',
      trigger: 'beyond-listed-effects',
    },
  },
  {
    procedureId: 'wish-nonstandard-effect',
    ordinal: 2,
    owner: WISH,
    anchors: [
      anchor(
        193,
        'The stress of casting this spell to produce any',
        'effect other than duplicating another spell weakens',
        'you.',
      ),
    ],
    facet: 'stress-trigger',
    localityPointer: '/data/mechanics/procedures/0/stress',
    expected: 'non-duplication-effect',
  },
  {
    procedureId: 'wish-nonstandard-effect',
    ordinal: 3,
    owner: WISH,
    anchors: [
      anchor(
        193,
        'you. After enduring that stress, each time you cast a',
        'spell until you finish a long rest, you take 1d10',
        'necrotic damage per level of that spell. This damage',
        'can’t be reduced or prevented in any way.',
      ),
    ],
    facet: 'recurring-damage',
    localityPointer: '/data/mechanics/procedures/0/stress/recurringDamage',
    expected: {
      event: 'cast-spell-before-long-rest',
      dicePerSpellLevel: '1d10',
      damageType: 'necrotic',
      preventable: false,
    },
  },
  {
    procedureId: 'wish-nonstandard-effect',
    ordinal: 4,
    owner: WISH,
    anchors: [
      anchor(
        193,
        'addition, your Strength drops to 3, if it isn’t 3 or',
        'lower already, for 2d4 days.',
      ),
    ],
    facet: 'strength-effect',
    localityPointer: '/data/mechanics/procedures/0/stress/strength',
    expected: { maximumAfterStress: 3, durationDice: '2d4', unit: 'day' },
  },
  {
    procedureId: 'wish-nonstandard-effect',
    ordinal: 5,
    owner: WISH,
    anchors: [
      anchor(
        193,
        'For each of those days',
        'that you spend resting and doing nothing more than',
        'light activity, your remaining recovery time',
        'decreases by 2 days.',
      ),
    ],
    facet: 'recovery-procedure',
    localityPointer: '/data/mechanics/procedures/0/stress/recovery',
    expected: {
      ordinaryDayReduction: 1,
      restDayReduction: 2,
      maximumRestActivity: 'light',
    },
  },
  {
    procedureId: 'wish-nonstandard-effect',
    ordinal: 6,
    owner: WISH,
    anchors: [
      anchor(
        193,
        'decreases by 2 days. Finally, there is a 33 percent',
        'chance that you are unable to cast wish ever again if',
        'you suffer this stress.',
      ),
    ],
    facet: 'probabilistic-transition',
    localityPointer: '/data/mechanics/procedures/0/stress/wishLoss',
    expected: { chancePercent: 33, state: 'unable-to-cast-wish' },
  },
];

export class Foundation1SourceObligationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Foundation1SourceObligationError';
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function bindAnchor(
  pages: ReadonlyMap<number, string>,
  draft: SourceAnchorDraft,
): Foundation1SourceSpan {
  const pageText = pages.get(draft.page);
  if (pageText === undefined) {
    throw new Foundation1SourceObligationError(
      `canonical source page ${draft.page} is missing`,
    );
  }
  const excerpt = draft.lines.join('\n');
  const startOffset = pageText.indexOf(excerpt);
  if (startOffset < 0) {
    throw new Foundation1SourceObligationError(
      `canonical source p. ${draft.page} no longer contains ${JSON.stringify(excerpt)}`,
    );
  }
  if (pageText.indexOf(excerpt, startOffset + 1) >= 0) {
    throw new Foundation1SourceObligationError(
      `canonical source p. ${draft.page} contains a non-unique anchor ${JSON.stringify(excerpt)}`,
    );
  }
  return {
    sourceRef: SOURCE_REF,
    sourceHash: FOUNDATION1_SOURCE_HASH,
    page: draft.page,
    startOffset,
    endOffset: startOffset + excerpt.length,
    spanHash: hash(excerpt),
  };
}

/**
 * Produces the bounded source obligations directly from the pinned canonical
 * extraction. It imports no projector and contains no generated record key.
 */
export function buildFoundation1SourceObligations(
  pages: readonly PageText[],
  sourceHash = FOUNDATION1_SOURCE_HASH,
): readonly Foundation1Obligation[] {
  if (sourceHash !== FOUNDATION1_SOURCE_HASH) {
    throw new Foundation1SourceObligationError(
      `source digest drift: expected ${FOUNDATION1_SOURCE_HASH}, got ${sourceHash}`,
    );
  }
  const canonicalPages = new Map(
    pages.map((page) => [page.pageNumber, page.lines.join('\n')]),
  );
  const obligations = DRAFTS.map((draft) => {
    const derivedFrom = draft.anchors.map((sourceAnchor) =>
      bindAnchor(canonicalPages, sourceAnchor),
    );
    const ownerSpan = derivedFrom[0];
    const identityInput = [
      'foundation1-obligation-v1',
      sourceHash,
      draft.procedureId,
      draft.facet,
      String(draft.ordinal),
      `${ownerSpan.page}:${ownerSpan.spanHash}`,
    ].join('\0');
    return {
      id: `obl/f1/${hash(identityInput)}`,
      procedureId: draft.procedureId,
      ordinal: draft.ordinal,
      owner: draft.owner,
      derivedFrom,
      facet: draft.facet,
      localityPointer: draft.localityPointer.replace(
        '/data/mechanics/procedures/0',
        `/procedure/${draft.procedureId}`,
      ),
      expected: draft.expected,
    } satisfies Foundation1Obligation;
  });
  const ids = new Set(obligations.map((obligation) => obligation.id));
  if (ids.size !== obligations.length) {
    throw new Foundation1SourceObligationError(
      'bounded source obligation identities are not unique',
    );
  }
  return obligations;
}
