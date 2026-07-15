export type EquipmentReviewDisposition =
  | 'already complete'
  | 'requires projection in this bead'
  | 'model-adjudicated qualifier'
  | 'not mechanical'
  | 'externally owned runtime behavior';

export interface EquipmentReview {
  readonly disposition: EquipmentReviewDisposition;
  readonly rationale: string;
  readonly owners: readonly string[];
  readonly requiredDeterministicRepresentation: readonly string[];
}

const COMPLETE = [
  'equipment:backpack',
  'equipment:barrel',
  'equipment:basket',
  'equipment:battleaxe',
  'equipment:blowgun',
  'equipment:bottle-glass',
  'equipment:breastplate',
  'equipment:bucket',
  'equipment:burglars-pack',
  'equipment:camel',
  'equipment:chain-mail',
  'equipment:chain-shirt',
  'equipment:chest',
  'equipment:club',
  'equipment:crossbow-hand',
  'equipment:crossbow-heavy',
  'equipment:crossbow-light',
  'equipment:dagger',
  'equipment:dart',
  'equipment:diplomats-pack',
  'equipment:donkey-or-mule',
  'equipment:dungeoneers-pack',
  'equipment:elephant',
  'equipment:entertainers-pack',
  'equipment:explorers-pack',
  'equipment:flail',
  'equipment:flask-or-tankard',
  'equipment:galley',
  'equipment:glaive',
  'equipment:greataxe',
  'equipment:greatclub',
  'equipment:greatsword',
  'equipment:halberd',
  'equipment:half-plate',
  'equipment:handaxe',
  'equipment:hide',
  'equipment:horse-draft',
  'equipment:horse-riding',
  'equipment:javelin',
  'equipment:jug-or-pitcher',
  'equipment:keelboat',
  'equipment:leather',
  'equipment:light-hammer',
  'equipment:longbow',
  'equipment:longship',
  'equipment:longsword',
  'equipment:mace',
  'equipment:mastiff',
  'equipment:maul',
  'equipment:morningstar',
  'equipment:padded',
  'equipment:pike',
  'equipment:plate',
  'equipment:pony',
  'equipment:pot-iron',
  'equipment:pouch',
  'equipment:priests-pack',
  'equipment:quarterstaff',
  'equipment:rapier',
  'equipment:ring-mail',
  'equipment:rowboat',
  'equipment:sack',
  'equipment:sailing-ship',
  'equipment:scale-mail',
  'equipment:scholars-pack',
  'equipment:scimitar',
  'equipment:shield',
  'equipment:shortbow',
  'equipment:shortsword',
  'equipment:sickle',
  'equipment:sling',
  'equipment:spear',
  'equipment:splint',
  'equipment:studded-leather',
  'equipment:trident',
  'equipment:vial',
  'equipment:war-pick',
  'equipment:warhammer',
  'equipment:warhorse',
  'equipment:warship',
  'equipment:waterskin',
  'equipment:whip',
] as const;

const PROJECTED = [
  'equipment:acid-vial',
  'equipment:alchemists-fire-flask',
  'equipment:antitoxin-vial',
  'equipment:ball-bearings-bag-of-1-000',
  'equipment:block-and-tackle',
  'equipment:caltrops-bag-of-20',
  'equipment:candle',
  'equipment:case-crossbow-bolt',
  'equipment:case-map-or-scroll',
  'equipment:chain-10-feet',
  'equipment:climbers-kit',
  'equipment:crowbar',
  'equipment:healers-kit',
  'equipment:holy-water-flask',
  'equipment:hunting-trap',
  'equipment:lamp',
  'equipment:lance',
  'equipment:lantern-bullseye',
  'equipment:lantern-hooded',
  'equipment:lock',
  'equipment:magnifying-glass',
  'equipment:manacles',
  'equipment:net',
  'equipment:oil-flask',
  'equipment:poison-basic-vial',
  'equipment:quiver',
  'equipment:ram-portable',
  'equipment:rope-hempen-50-feet',
  'equipment:rope-silk-50-feet',
  'equipment:scale-merchants',
  'equipment:spellbook',
  'equipment:spyglass',
  'equipment:tent-two-person',
  'equipment:tinderbox',
  'equipment:torch',
] as const;

const MODEL = [
  'equipment:alchemists-supplies',
  'equipment:amulet',
  'equipment:bagpipes',
  'equipment:book',
  'equipment:brewers-supplies',
  'equipment:calligraphers-supplies',
  'equipment:carpenters-tools',
  'equipment:cartographers-tools',
  'equipment:cobblers-tools',
  'equipment:component-pouch',
  'equipment:cooks-utensils',
  'equipment:crystal',
  'equipment:dice-set',
  'equipment:disguise-kit',
  'equipment:drum',
  'equipment:dulcimer',
  'equipment:emblem',
  'equipment:fishing-tackle',
  'equipment:flute',
  'equipment:forgery-kit',
  'equipment:glassblowers-tools',
  'equipment:herbalism-kit',
  'equipment:horn',
  'equipment:jewelers-tools',
  'equipment:leatherworkers-tools',
  'equipment:lute',
  'equipment:lyre',
  'equipment:masons-tools',
  'equipment:mess-kit',
  'equipment:navigators-tools',
  'equipment:orb',
  'equipment:painters-supplies',
  'equipment:pan-flute',
  'equipment:playing-card-set',
  'equipment:poisoners-kit',
  'equipment:potters-tools',
  'equipment:rations-1-day',
  'equipment:reliquary',
  'equipment:rod',
  'equipment:shawm',
  'equipment:smiths-tools',
  'equipment:sprig-of-mistletoe',
  'equipment:staff',
  'equipment:thieves-tools',
  'equipment:tinkers-tools',
  'equipment:totem',
  'equipment:viol',
  'equipment:wand',
  'equipment:weavers-tools',
  'equipment:woodcarvers-tools',
  'equipment:wooden-staff',
  'equipment:yew-wand',
] as const;

const EXTERNAL = [
  'equipment:arrows-20',
  'equipment:blowgun-needles-50',
  'equipment:crossbow-bolts-20',
  'equipment:potion-of-healing',
  'equipment:sling-bullets-20',
] as const;

const NONMECHANICAL = [
  'equipment:abacus',
  'equipment:bedroll',
  'equipment:bell',
  'equipment:bit-and-bridle',
  'equipment:blanket',
  'equipment:carriage',
  'equipment:cart',
  'equipment:chalk-1-piece',
  'equipment:chariot',
  'equipment:clothes-common',
  'equipment:clothes-costume',
  'equipment:clothes-fine',
  'equipment:clothes-travelers',
  'equipment:feed-per-day',
  'equipment:grappling-hook',
  'equipment:hammer',
  'equipment:hammer-sledge',
  'equipment:hourglass',
  'equipment:ink-1-ounce-bottle',
  'equipment:ink-pen',
  'equipment:ladder-10-foot',
  'equipment:mirror-steel',
  'equipment:paper-one-sheet',
  'equipment:parchment-one-sheet',
  'equipment:perfume-vial',
  'equipment:pick-miners',
  'equipment:piton',
  'equipment:pole-10-foot',
  'equipment:robes',
  'equipment:saddle-exotic',
  'equipment:saddle-military',
  'equipment:saddle-pack',
  'equipment:saddle-riding',
  'equipment:saddlebags',
  'equipment:sealing-wax',
  'equipment:shovel',
  'equipment:signal-whistle',
  'equipment:signet-ring',
  'equipment:sled',
  'equipment:soap',
  'equipment:spikes-iron-10',
  'equipment:stabling-per-day',
  'equipment:wagon',
  'equipment:whetstone',
] as const;

const QUALITATIVE_MODEL_KEYS = new Set<string>([
  'equipment:book',
  'equipment:fishing-tackle',
  'equipment:mess-kit',
  'equipment:rations-1-day',
]);

const entries: Array<readonly [string, EquipmentReview]> = [
  ...COMPLETE.map(
    (key) =>
      [
        key,
        {
          disposition: 'already complete',
          rationale:
            'Reviewed table-derived armor, weapon, pack, capacity, mount, or vehicle payload is complete for deterministic filtering and lookup.',
          owners: ['equipment-schema'],
          requiredDeterministicRepresentation: ['table-derived fields'],
        },
      ] as const,
  ),
  ...PROJECTED.map(
    (key) =>
      [
        key,
        {
          disposition: 'requires projection in this bead',
          rationale:
            'Reviewed source description contains immutable numeric or procedural equipment semantics emitted by the curated specification.',
          owners: ['equipment-use-profile'],
          requiredDeterministicRepresentation: ['data.useProfile'],
        },
      ] as const,
  ),
  ...MODEL.map(
    (key) =>
      [
        key,
        QUALITATIVE_MODEL_KEYS.has(key)
          ? {
              disposition: 'model-adjudicated qualifier' as const,
              rationale:
                'Reviewed description only identifies narrative contents or suitability; it supplies no closed capacity, timing, modifier, dice, or finite-use procedure.',
              owners: ['DM'],
              requiredDeterministicRepresentation: [],
            }
          : {
              disposition: 'externally owned runtime behavior' as const,
              rationale:
                'Reviewed tool/focus eligibility and proficiency procedure is owned by canonical rule:skills, rule:proficiency-bonus, rule:material-m, and rule:spellcasting semantics; this record retains the item-specific grouping and source wording.',
              owners: [
                'rule:skills',
                'rule:proficiency-bonus',
                'rule:material-m',
                'rule:spellcasting',
              ],
              requiredDeterministicRepresentation: [
                'applicable canonical tool/focus rule-owned procedure',
              ],
            },
      ] as const,
  ),
  ...EXTERNAL.map(
    (key) =>
      [
        key,
        {
          disposition: 'externally owned runtime behavior',
          rationale:
            key === 'equipment:potion-of-healing'
              ? 'The ordinary-table duplicate is canonically owned by magic-item:potion-of-healing and the pending M1/C2/S consumable-healing work in eshyra-o9bd.18.7.7.4.'
              : 'Ammunition bundle identity and quantity are table-derived; per-shot decrement uses the canonical inventory mutation selected by the DM.',
          owners:
            key === 'equipment:potion-of-healing'
              ? ['magic-item:potion-of-healing', 'eshyra-o9bd.18.7.7.4']
              : ['inventory', 'remove_item'],
          requiredDeterministicRepresentation:
            key === 'equipment:potion-of-healing'
              ? ['canonical magic-item:potion-of-healing implementation']
              : ['inventory quantity and remove_item'],
        },
      ] as const,
  ),
  ...NONMECHANICAL.map(
    (key) =>
      [
        key,
        {
          disposition: 'not mechanical',
          rationale:
            'Reviewed row supplies purchase/display identity only; no source description or closed per-item gameplay procedure is present.',
          owners: [],
          requiredDeterministicRepresentation: [],
        },
      ] as const,
  ),
];

export const EQUIPMENT_MECHANICS_REVIEW: ReadonlyMap<string, EquipmentReview> =
  new Map(entries);
if (EQUIPMENT_MECHANICS_REVIEW.size !== entries.length)
  throw new Error('duplicate equipment review key');
if (entries.length !== 218)
  throw new Error(
    `equipment review must contain 218 records, got ${entries.length}`,
  );
