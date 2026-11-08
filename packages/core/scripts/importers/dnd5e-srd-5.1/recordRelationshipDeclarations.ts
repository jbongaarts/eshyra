import { CONDITION_RELATION_VALUES } from '../../../src/rules/conditionRelations.js';
import type { RecordRelationshipDeclaration } from '../../../src/rules/recordRelationships.js';
import type { RulesRecordKind } from '../../../src/rules/types.js';

/**
 * The relation each `mechanics.conditions[].relation` sibling value produces.
 * It is the closed `CONDITION_RELATION_VALUES` vocabulary mapped to itself, so
 * the emitted relation names are unchanged from the former
 * placeholder-plus-override form, and no value is excluded: every one of the
 * eleven values states what the printed clause says about a condition named
 * by the record (`mention` is a source-text mention with no structured claim,
 * kept as an edge). A value outside the vocabulary stays `indeterminate`.
 */
const MECHANICS_CONDITION_RELATION_TABLE: Readonly<Record<string, string>> =
  Object.fromEntries(CONDITION_RELATION_VALUES.map((value) => [value, value]));

function mechanicsConditionDeclaration(
  kind: RulesRecordKind,
  pointerPrefix: string,
  linkField: string,
  owner: string,
): RecordRelationshipDeclaration {
  return {
    kind,
    pointerPrefix,
    linkField,
    disposition: 'reference',
    targetResolution: 'record-name',
    targetKind: 'condition',
    relationField: 'relation',
    relationByFieldValue: MECHANICS_CONDITION_RELATION_TABLE,
    reason: `Condition names in ${owner} mechanics.conditions are resolved against the condition kind. The sibling relation states what the printed clause says about that condition (applies, removes, prevents, immune, advantage, ...); a missing, non-string, or unrecognized sibling yields a typed indeterminate outcome (see recordRelationships.ts RelationshipResolution), never a silently skipped occurrence.`,
  };
}

/**
 * eshyra-o9bd.19.3.5: every `mechanics.conditions[].condition` leaf in a
 * non-condition record. The top-level kinds were declared earlier; the nested
 * creature (actions, legendary actions, reactions, traits) and ancestry
 * (traits) shapes carry the identical entry shape and sibling vocabulary.
 */
const MECHANICS_CONDITION_DECLARATIONS: readonly RecordRelationshipDeclaration[] =
  [
    ...(['action', 'feat', 'feature', 'hazard', 'spell'] as const).map((kind) =>
      mechanicsConditionDeclaration(
        kind,
        '/mechanics/conditions/*/condition',
        'data.mechanics.conditions',
        `a ${kind} record's`,
      ),
    ),
    mechanicsConditionDeclaration(
      'ancestry',
      '/traits/*/mechanics/conditions/*/condition',
      'data.traits[].mechanics.conditions',
      "an ancestry trait's",
    ),
    mechanicsConditionDeclaration(
      'creature',
      '/actions/*/mechanics/conditions/*/condition',
      'data.actions[].mechanics.conditions',
      "a creature action's",
    ),
    mechanicsConditionDeclaration(
      'creature',
      '/legendaryActions/entries/*/mechanics/conditions/*/condition',
      'data.legendaryActions.entries[].mechanics.conditions',
      "a creature legendary action's",
    ),
    mechanicsConditionDeclaration(
      'creature',
      '/reactions/*/mechanics/conditions/*/condition',
      'data.reactions[].mechanics.conditions',
      "a creature reaction's",
    ),
    mechanicsConditionDeclaration(
      'creature',
      '/traits/*/mechanics/conditions/*/condition',
      'data.traits[].mechanics.conditions',
      "a creature trait's",
    ),
  ];

const PROSE_PRECONDITION_REASON =
  'A free-text precondition clause (for example "While raging"), not a condition name; it is not a reference to a condition record.';

function prosePrecondition(
  kind: RulesRecordKind,
  pointerPrefix: string,
  linkField: string,
): RecordRelationshipDeclaration {
  return {
    kind,
    pointerPrefix,
    linkField,
    disposition: 'not-a-reference',
    reason: PROSE_PRECONDITION_REASON,
  };
}

/**
 * The magic-item `effects[].condition` shape is overloaded within one kind:
 * most effect kinds store a prose activation precondition there, while an
 * `imposesCondition` effect (Philter of Love) stores the condition it imposes.
 * The effect `kind` therefore selects the meaning. Every emitted effect kind
 * is listed so a new kind is `indeterminate`, not silently misread.
 * `triggeredEffect` stores prose only: the two triggered effects that impose
 * `charmed` (Rod of Rulership, Philter of Love's residual effect) carry it in
 * `conditions[]` (declared below with the other imposing effects), so no
 * condition name is left under this field for a table-excluded kind.
 */
const MAGIC_ITEM_EFFECT_CONDITION_PROSE_KINDS = [
  'abilityScoreIncrease',
  'abilityScoreSet',
  'acFormula',
  'advantage',
  'breathes',
  'castSpell',
  'climbAnywhere',
  'damageResistance',
  'extraDamage',
  'hover',
  'ignoreDifficultTerrain',
  'immunity',
  'jumpDistanceMultiplier',
  'leavesNoTracks',
  'light',
  'proficiency',
  'regeneration',
  'rollModifier',
  'rollPenaltyDice',
  'sense',
  'slowFall',
  'speedBonus',
  'speedMultiplier',
  'speedSet',
  'triggeredEffect',
  'walkOnLiquids',
] as const;

/**
 * Creature and stat-block `conditionImmunities` is the verbatim printed
 * stat-block label: a comma-separated list of condition names ("charmed,
 * exhaustion, poisoned"). Every printed name is a condition record, so each
 * list entry is a `condition-immunity` reference (the same relation a magic
 * item's immunity effect uses).
 */
const CONDITION_IMMUNITY_DECLARATIONS: readonly RecordRelationshipDeclaration[] =
  (['creature', 'stat-block'] as const).map((kind) => ({
    kind,
    pointerPrefix: '/conditionImmunities',
    linkField: 'data.conditionImmunities',
    disposition: 'reference',
    relation: 'condition-immunity',
    targetResolution: 'record-name',
    targetKind: 'condition',
    listDelimiter: ', ',
    reason: `The ${kind} record's printed "Condition Immunities" label lists the conditions it is immune to as a comma-separated string; each printed name resolves against the condition kind (for example the zombie's "poisoned", the ghoul's "charmed, exhaustion, poisoned").`,
  }));

/**
 * eshyra-ry69: one fixed-relation record-key reference declaration. The leaf is
 * the canonical record key the importer emitted; `reason` states, from the
 * printed source, why the field is a link and what the relation means.
 */
function keyReference(
  kind: RulesRecordKind,
  pointerPrefix: string,
  linkField: string,
  relation: string,
  reason: string,
  excludedLeafValues?: readonly string[],
): RecordRelationshipDeclaration {
  return {
    kind,
    pointerPrefix,
    linkField,
    disposition: 'reference',
    relation,
    targetResolution: 'record-key',
    ...(excludedLeafValues === undefined ? {} : { excludedLeafValues }),
    reason,
  };
}

const LANGUAGE_EXTENSION_RULE_REASON =
  'The language rule an extra-language choice defers to for languages outside the listed set (the rule on languages and the exotic-languages table; the GM approves an exotic pick).';
const LANGUAGE_EXTENSION_TABLE_REASON =
  'The exotic-languages table an extra-language choice may pick from with GM approval.';

/**
 * eshyra-ry69: the remaining record-key leaves outside the families declared
 * by eshyra-o9bd.16.6.2. Each shape was found by the deterministic predicate
 * (a data leaf equal to an existing record key at an undeclared
 * (kind, normalized pointer)) and decided against the printed source.
 */
const RECORD_KEY_LEAF_DECLARATIONS: readonly RecordRelationshipDeclaration[] = [
  // Languages: the rule and exotic table an extra-language pick defers to.
  ...(
    [
      ['ancestry', '/choices/*/extension', 'data.choices[].extension'],
      ['ancestry', '/languages/*/extension', 'data.languages[].extension'],
      ['background', '/languages/*/extension', 'data.languages[].extension'],
    ] as const
  ).flatMap(([kind, prefix, field]) => [
    keyReference(
      kind,
      `${prefix}/ruleRef`,
      `${field}.ruleRef`,
      'governing-rule',
      LANGUAGE_EXTENSION_RULE_REASON,
    ),
    keyReference(
      kind,
      `${prefix}/exoticTableRef`,
      `${field}.exoticTableRef`,
      'table-reference',
      LANGUAGE_EXTENSION_TABLE_REASON,
    ),
  ]),
  {
    kind: 'ancestry',
    pointerPrefix: '/choices/*/from/*',
    linkField: 'data.choices[].from',
    disposition: 'reference',
    targetResolution: 'record-key',
    relationField: '../category',
    relationByFieldValue: {
      cantrip: 'choice-option',
      language: null,
      skill: null,
      tool: null,
    },
    reason:
      'An ancestry choice lists its options. A cantrip choice (High Elf: "one cantrip of your choice from the wizard spell list") lists spell records; the language, skill and tool choices list printed names (Elvish, Acrobatics, Smith’s tools) that are not records, so those categories are explicitly excluded. A new category is indeterminate, not silently read.',
  },
  keyReference(
    'ancestry',
    '/subraceOf',
    'data.subraceOf',
    'subrace-of',
    'A subrace record names the base ancestry it belongs to (High Elf is a subrace of Elf).',
  ),
  keyReference(
    'ancestry',
    '/subraces/*',
    'data.subraces',
    'has-subrace',
    'A base ancestry lists its subrace records (Dwarf: Hill Dwarf).',
  ),
  keyReference(
    'ancestry',
    '/traits/*/mechanics/spellGrants/*/spell',
    'data.traits[].mechanics.spellGrants[].spell',
    'granted-spell',
    'A racial trait grants a named spell (Infernal Legacy: hellish rebuke, darkness).',
  ),
  keyReference(
    'background',
    '/choices/*/tableRef',
    'data.choices[].tableRef',
    'table-reference',
    'The personality/ideal/bond/flaw table a background choice is made or rolled from.',
  ),
  keyReference(
    'background',
    '/equipmentGrants/*/ref',
    'data.equipmentGrants[].ref',
    'starting-equipment',
    'An equipment record a background grants as starting equipment.',
  ),
  // Class and subclass structure.
  keyReference(
    'class',
    '/features/*',
    'data.features',
    'class-feature',
    'A feature record the class grants (its printed class feature list).',
  ),
  keyReference(
    'class',
    '/progression/*/advancement/*/ref',
    'data.progression[].advancement[].ref',
    'granted-feature',
    'A featureGrant advancement names the feature record the class gains at that level. Only featureGrant advancements carry ref.',
  ),
  keyReference(
    'class',
    '/progression/*/advancement/*/targetRefs/*',
    'data.progression[].advancement[].targetRefs',
    'improved-feature',
    'A featureImprovement advancement names the feature records it improves at that level (Cleric Divine Intervention improvement).',
  ),
  keyReference(
    'class',
    '/startingEquipment/entries/*/grants/*/ref',
    'data.startingEquipment.entries[].grants[].ref',
    'starting-equipment',
    'An equipment record the class grants as starting equipment.',
  ),
  keyReference(
    'class',
    '/startingEquipment/entries/*/options/*/grants/*/ref',
    'data.startingEquipment.entries[].options[].grants[].ref',
    'starting-equipment',
    'An equipment record one printed starting-equipment option grants (for example the barbarian\u2019s greataxe).',
  ),
  keyReference(
    'equipment',
    '/contents/*/ref',
    'data.contents[].ref',
    'pack-contents',
    'An equipment record that is part of an equipment pack (Burglar’s Pack: backpack, rations). Only packs carry contents.',
  ),
  keyReference(
    'subclass',
    '/features/*',
    'data.features',
    'subclass-feature',
    'A feature record the subclass grants.',
  ),
  keyReference(
    'subclass',
    '/featuresByLevel/*/features/*',
    'data.featuresByLevel[].features',
    'subclass-feature',
    'A feature record the subclass grants at the stated level.',
  ),
  // Feature choices.
  {
    kind: 'feature',
    pointerPrefix: '/choices/*/from/*',
    linkField: 'data.choices[].from',
    disposition: 'reference',
    targetResolution: 'record-key',
    relationField: '../category',
    relationByFieldValue: {
      subclass: 'choice-option',
      asiOrFeat: null,
      favoredEnemy: null,
      fightingStyle: null,
      invocation: null,
      language: null,
      metamagic: null,
      naturalExplorer: null,
      other: null,
      skill: null,
    },
    reason:
      'A feature choice lists its options. A subclass choice lists subclass records (Primal Path: path of the berserker). Every other string-list category lists printed option names or in-record option ids (ability names, skills, languages, fighting styles, invocation ids) that are not records, so those categories are explicitly excluded. A new category is indeterminate, not silently read.',
  },
  keyReference(
    'feature',
    '/choices/*/from/classLists/*',
    'data.choices[].from.classLists',
    'spell-list-class',
    'A spell-filter choice draws its spells from the spell list of these classes (Bard: the bard spell list).',
  ),
  keyReference(
    'feature',
    '/choices/*/from/countsAsClassSpell',
    'data.choices[].from.countsAsClassSpell',
    'counts-as-class-spell',
    'Magical Secrets: spells chosen "count as bard spells for you"; the class they count as.',
  ),
  keyReference(
    'feature',
    '/choices/*/from/maxSpellLevel/classRef',
    'data.choices[].from.maxSpellLevel.classRef',
    'spell-level-class',
    'The class whose spell-slot progression bounds the highest spell level a spell-filter choice may pick (Magical Secrets: "of a level you can cast").',
  ),
  keyReference(
    'feature',
    '/choices/*/options/*/mechanics/spellGrants/*/spell',
    'data.choices[].options[].mechanics.spellGrants[].spell',
    'granted-spell',
    'A choice option grants a named spell (Pact of the Chain: find familiar).',
  ),
  keyReference(
    'feature',
    '/choices/*/options/*/prerequisites/*/classRef',
    'data.choices[].options[].prerequisites[].classRef',
    'prerequisite-class',
    'A choice option requires a level in this class (Eldritch Invocation: "9th level warlock").',
  ),
  keyReference(
    'feature',
    '/choices/*/options/*/prerequisites/*/featureRef',
    'data.choices[].options[].prerequisites[].featureRef',
    'prerequisite-feature',
    'A choice option requires this feature (Eldritch Invocation: the Pact Boon feature).',
  ),
  {
    kind: 'feature',
    pointerPrefix: '/choices/*/options/*/prerequisites/*/ref',
    linkField: 'data.choices[].options[].prerequisites[].ref',
    disposition: 'reference',
    targetResolution: 'record-key',
    relationField: 'kind',
    relationByFieldValue: {
      cantrip: 'prerequisite-spell',
      pactBoon: null,
    },
    reason:
      'Overloaded field in an invocation prerequisite. A cantrip prerequisite names the spell record ("eldritch blast cantrip"); a pactBoon prerequisite names the in-record pact option id (pact-boon:pact-of-the-tome), which is not a record (its record reference is the sibling featureRef), so it is excluded. A new prerequisite kind is indeterminate.',
  },
  keyReference(
    'feature',
    '/choices/*/options/*/summonFormExtensions/*/forms/*/creatureRef',
    'data.choices[].options[].summonFormExtensions[].forms[].creatureRef',
    'creation-form',
    'Pact of the Chain: the familiar can take these special forms (imp, pseudodragon, quasit, sprite); the creature whose statistics the form uses.',
  ),
  keyReference(
    'feature',
    '/choices/*/options/*/summonFormExtensions/*/spell',
    'data.choices[].options[].summonFormExtensions[].spell',
    'extended-spell',
    'Pact of the Chain extends the find familiar spell with additional forms.',
  ),
  keyReference(
    'feature',
    '/mechanics/effects/*/progression/classRef',
    'data.mechanics.effects[].progression.classRef',
    'class-progression',
    'The class whose level progression scales this feature effect (Martial Arts: the monk table).',
  ),
  keyReference(
    'feature',
    '/mechanics/effects/*/spell',
    'data.mechanics.effects[].spell',
    'permanent-spell-effect',
    'Purity of Spirit: "you are always under the effects of a protection from evil and good spell". Only permanentSpellEffect effects carry spell.',
  ),
  keyReference(
    'feature',
    '/mechanics/resources/*/appliesTo',
    'data.mechanics.resources[].appliesTo',
    'resource-applies-to',
    'The feature whose use the resource governs (Font of Inspiration restores Bardic Inspiration).',
  ),
  // Magic items.
  {
    kind: 'magic-item',
    pointerPrefix: '/executionReadiness/clauses/*/representation/ref',
    linkField: 'data.executionReadiness.clauses[].representation.ref',
    disposition: 'not-a-reference',
    reason:
      'Execution-readiness ledger back-pointer: it names the structured field that represents a source clause (table refs, stat-block refs, or a prose attunement/variants value). Every record key it holds duplicates an entry already declared at /tableRefs/* or /statBlockRefs/* on the same item, so the relationship is carried there and a second edge would only repeat it.',
  },
  keyReference(
    'magic-item',
    '/mechanics/curse/endedBy/*',
    'data.mechanics.curse.endedBy',
    'ended-by',
    'What ends the item’s curse ("remove curse or similar magic"); the spell record. The prose entry similar magic is not a record.',
    ['similar magic'],
  ),
  keyReference(
    'magic-item',
    '/mechanics/curse/revealedBy/*',
    'data.mechanics.curse.revealedBy',
    'revealed-by',
    'What reveals the item’s curse ("an identify spell or attunement"); the spell record. The prose entry attunement is not a record.',
    ['attunement'],
  ),
  keyReference(
    'magic-item',
    '/mechanics/effects/*/endsOn/*',
    'data.mechanics.effects[].endsOn',
    'ended-by',
    'What ends an item effect. Most entries are printed trigger tokens (successful-repeat-save, attack, armor-removed); Dust of Sneezing and Choking is ended by a lesser restoration spell, the record this declares. The tokens are enumerated as excluded leaf values, so a new token is an unresolved loss, not silently skipped.',
    [
      'successful-repeat-save',
      'attack',
      'cast-spell',
      'armor-removed',
      'hat-removed',
      'command-word-spoken-again-as-action',
      'ring-removed',
      'bonus-action-deactivate',
      'harmed-by-user-or-companions',
      'command-contrary-to-nature',
      'wind-of-at-least-10-miles-per-hour',
    ],
  ),
  keyReference(
    'magic-item',
    '/mechanics/effects/*/includes',
    'data.mechanics.effects[].includes',
    'includes-item',
    'Universal Solvent "instantly dissolves adhesive" including sovereign glue; the item it covers.',
  ),
  keyReference(
    'magic-item',
    '/mechanics/effects/*/removableOnlyBy/*',
    'data.mechanics.effects[].removableOnlyBy',
    'removable-only-by',
    'Sovereign Glue "can be removed only by ... universal solvent, oil of etherealness, or wish"; each is a record.',
  ),
  keyReference(
    'magic-item',
    '/mechanics/effects/*/revealedBy',
    'data.mechanics.effects[].revealedBy',
    'revealed-by',
    'Potion of Poison: "an identify spell reveals that it is poison"; the spell record.',
  ),
  keyReference(
    'magic-item',
    '/mechanics/effects/*/spell',
    'data.mechanics.effects[].spell',
    'effect-spell',
    'The spell a castSpell effect casts (Orb of Dragonkind: suggestion).',
  ),
  keyReference(
    'magic-item',
    '/mechanics/effects/*/spellRef',
    'data.mechanics.effects[].spellRef',
    'effect-spell',
    'The spell an effect casts or applies (castSpell: Amulet of the Planes casts plane shift; triggeredEffect: Oil of Etherealness applies etherealness). Only castSpell and triggeredEffect effects carry spellRef.',
  ),
  keyReference(
    'magic-item',
    '/mechanics/effects/*/spellRefs/*',
    'data.mechanics.effects[].spellRefs',
    'effect-spell',
    'The spells a castSpell effect may cast (Necklace of Prayer Beads: bless, cure wounds, ...).',
  ),
  ...(
    [
      [
        'economyDeduction/tableRef',
        'the table giving the charges an action deducts',
      ],
      ['gemTypeTableRef', 'the table of gem types'],
      ['maximumCapacity/tableRef', 'the table giving the maximum capacity'],
      [
        'saveDcAndAttackBonusTableRef',
        'the table of save DC and attack bonus by scroll level',
      ],
      ['spellSelectionTableRef', 'the table that selects the bead spell'],
      ['tableRef', 'the source table the effect applies'],
      ['threshold/tableRef', 'the table giving the threshold'],
      ['typeFrom', 'the table the damage type is chosen from'],
      ['valueTableRef', 'the table giving the effect value'],
    ] as const
  ).map(([suffix, meaning]) =>
    keyReference(
      'magic-item',
      `/mechanics/effects/*/${suffix}`,
      `data.mechanics.effects[].${suffix.replace('/', '.')}`,
      'table-reference',
      `An item effect names ${meaning}; the table record the reader must consult.`,
    ),
  ),
  keyReference(
    'magic-item',
    '/mechanics/effects/*/variants/bird/creatureRef',
    'data.mechanics.effects[].variants.bird.creatureRef',
    'creation-form',
    'Feather Token (bird): the large bird has the statistics of a roc but cannot attack.',
  ),
  keyReference(
    'magic-item',
    '/mechanics/entityGrant/grants/*/creatureRefs/*',
    'data.mechanics.entityGrant.grants[].creatureRefs',
    'granted-creature',
    'The creature records an item can summon or produce (Bag of Tricks: weasel, giant rat, ...).',
  ),
  keyReference(
    'magic-item',
    '/mechanics/entityGrant/grants/*/statBlockRef',
    'data.mechanics.entityGrant.grants[].statBlockRef',
    'stat-block-reference',
    'The stat-block record of the creature an item grants (Figurine of Wondrous Power: ebony fly).',
  ),
  keyReference(
    'magic-item',
    '/mechanics/entityGrant/grants/*/tableRefs/*',
    'data.mechanics.entityGrant.grants[].tableRefs',
    'table-reference',
    'The table a granted creature is rolled or chosen from (Bag of Tricks, Horn of Valhalla, Elemental Gem).',
  ),
  keyReference(
    'magic-item',
    '/mechanics/interItem/counters/*/itemRefs/*',
    'data.mechanics.interItem.counters[].itemRefs',
    'inter-item-counter',
    'An item the printed text names as countered by this one (Oil of Slipperiness prevents sovereign glue adhesion).',
  ),
  keyReference(
    'magic-item',
    '/mechanics/interItem/counters/*/targetRef',
    'data.mechanics.interItem.counters[].targetRef',
    'inter-item-counter',
    'The item a counter-interaction targets (Oil of Slipperiness: sovereign glue).',
  ),
  keyReference(
    'magic-item',
    '/mechanics/interItem/nestingHazard/withItemRefs/*',
    'data.mechanics.interItem.nestingHazard.withItemRefs',
    'nesting-hazard',
    'Bag of Holding: placing another extradimensional item (handy haversack, portable hole) inside destroys both.',
  ),
  keyReference(
    'magic-item',
    '/mechanics/interItem/portalInteraction/portalRefs/*',
    'data.mechanics.interItem.portalInteraction.portalRefs',
    'portal-interaction',
    'Sphere of Annihilation: contact with a planar portal or extradimensional space (gate, portable hole, bag of holding) triggers the source table.',
  ),
  keyReference(
    'magic-item',
    '/mechanics/interItem/portalInteraction/tableRefs/*',
    'data.mechanics.interItem.portalInteraction.tableRefs',
    'table-reference',
    'The table the GM rolls on when the sphere contacts a portal.',
  ),
  keyReference(
    'magic-item',
    '/mechanics/operations/*/leverSelection/tableRef',
    'data.mechanics.operations[].leverSelection.tableRef',
    'table-reference',
    'Apparatus of the Crab: the lever table a lever selection is read from.',
  ),
  keyReference(
    'magic-item',
    '/mechanics/randomProcedure/procedures/*/tableRef',
    'data.mechanics.randomProcedure.procedures[].tableRef',
    'table-reference',
    'The source table a random procedure rolls on (Bag of Beans, Deck of Many Things).',
  ),
  // Spells.
  keyReference(
    'spell',
    '/mechanics/effects/*/creation/creatureRef',
    'data.mechanics.effects[].creation.creatureRef',
    'creation-form',
    'The creature record whose statistics the created creature uses (Phantom Steed: riding horse).',
  ),
  keyReference(
    'spell',
    '/mechanics/effects/*/creation/options/*/resultRef',
    'data.mechanics.effects[].creation.options[].resultRef',
    'creation-form',
    'The creature record one printed creation option produces (Giant Insect: giant centipede).',
  ),
  keyReference(
    'spell',
    '/mechanics/effects/*/creation/outcomes/*/resultRef',
    'data.mechanics.effects[].creation.outcomes[].resultRef',
    'creation-form',
    'The creature record one printed creation outcome produces (Animate Dead: skeleton or zombie).',
  ),
  keyReference(
    'spell',
    '/mechanics/effects/*/scaling/*/options/*/choices/*/creatureRefs/*',
    'data.mechanics.effects[].scaling[].options[].choices[].creatureRefs',
    'creation-form',
    'The creature records a higher-level cast may create (Create Undead: ghoul, ghast, wight, mummy).',
  ),
  keyReference(
    'spell',
    '/mechanics/effects/*/statBlockOverlay/tableRef',
    'data.mechanics.effects[].statBlockOverlay.tableRef',
    'table-reference',
    'The table of statistics the created creature uses (Animate Objects).',
  ),
  keyReference(
    'spell',
    '/mechanics/effects/*/tableRefs/*',
    'data.mechanics.effects[].tableRefs',
    'table-reference',
    'The tables a staged effect shifts through (Control Weather: precipitation, temperature, wind).',
  ),
  keyReference(
    'table',
    '/projection/sourceRuleRef',
    'data.projection.sourceRuleRef',
    'source-rule',
    'The rule record the table projection is drawn from (Indefinite Madness: madness effects).',
  ),
];

/** Curated relationship meaning for the fields formerly guessed by discovery. */
export const DND5E_RECORD_RELATIONSHIP_DECLARATIONS: readonly RecordRelationshipDeclaration[] =
  [
    {
      kind: 'ancestry',
      pointerPrefix: '/source',
      linkField: 'data.source',
      disposition: 'not-a-reference',
      reason:
        'A structural field describing where this ancestry sits in the source (page/section), not narrative prose.',
    },
    {
      kind: 'feature',
      pointerPrefix: '/source',
      linkField: 'data.source',
      disposition: 'reference',
      relation: 'granted-by',
      targetResolution: 'record-key',
      reason: 'The granting class/subclass record-key, not source text.',
    },
    {
      kind: 'subclass',
      pointerPrefix: '/parentClass',
      linkField: 'data.parentClass',
      disposition: 'reference',
      relation: 'parent-class',
      targetResolution: 'record-key',
      reason: 'The parser emits the canonical parent class record key.',
    },
    {
      kind: 'class',
      pointerPrefix: '/progressionTableRef',
      linkField: 'data.progressionTableRef',
      disposition: 'reference',
      relation: 'progression-table',
      targetResolution: 'record-key',
      reason: 'The parser emits the class progression table record key.',
    },
    {
      kind: 'rule',
      pointerPrefix: '/tableRefs/*',
      linkField: 'data.tableRefs',
      disposition: 'reference',
      relation: 'table-reference',
      targetResolution: 'record-key',
      reason:
        'The parser emits canonical table record keys referenced by this rule.',
    },
    {
      kind: 'magic-item',
      pointerPrefix: '/tableRefs/*',
      linkField: 'data.tableRefs',
      disposition: 'reference',
      relation: 'table-reference',
      targetResolution: 'record-key',
      reason:
        'The parser emits canonical table record keys referenced by this magic item.',
    },
    {
      kind: 'magic-item',
      pointerPrefix: '/statBlockRefs/*',
      linkField: 'data.statBlockRefs',
      disposition: 'reference',
      relation: 'stat-block-reference',
      targetResolution: 'record-key',
      reason:
        'The parser emits canonical stat-block record keys referenced by this magic item.',
    },
    {
      kind: 'spell',
      pointerPrefix: '/tableRefs/*',
      linkField: 'data.tableRefs',
      disposition: 'reference',
      relation: 'table-reference',
      targetResolution: 'record-key',
      reason:
        'The parser emits canonical table record keys referenced by this spell.',
    },
    {
      kind: 'feature',
      pointerPrefix: '/tableRefs/*',
      linkField: 'data.tableRefs',
      disposition: 'reference',
      relation: 'table-reference',
      targetResolution: 'record-key',
      reason:
        'The parser emits canonical table record keys referenced by this feature.',
    },
    {
      kind: 'background',
      pointerPrefix: '/tableRefs/*',
      linkField: 'data.tableRefs',
      disposition: 'reference',
      relation: 'table-reference',
      targetResolution: 'record-key',
      reason:
        'The parser emits canonical table record keys referenced by this background.',
    },
    {
      kind: 'subclass',
      pointerPrefix: '/spellTableRefs/*',
      linkField: 'data.spellTableRefs',
      disposition: 'reference',
      relation: 'table-reference',
      targetResolution: 'record-key',
      reason:
        'The parser emits canonical spell-table record keys referenced by this subclass.',
    },
    ...MECHANICS_CONDITION_DECLARATIONS,
    // eshyra-o9bd.19.3.4: rule/action/condition discovery. These fields
    // already carried resolvable record keys, but no declaration said they
    // were links, so discovery could not follow them.
    {
      kind: 'action',
      pointerPrefix: '/mechanics/effects/*/ruleRef',
      linkField: 'data.mechanics.effects[].ruleRef',
      disposition: 'reference',
      relation: 'governing-rule',
      targetResolution: 'record-key',
      reason:
        'The curated record key of the rule that governs this action effect (e.g. Hide -> rule:hiding).',
    },
    {
      kind: 'action',
      pointerPrefix: '/mechanics/effects/*/ordinaryInteractionRuleRef',
      linkField: 'data.mechanics.effects[].ordinaryInteractionRuleRef',
      disposition: 'reference',
      relation: 'governing-rule',
      targetResolution: 'record-key',
      reason:
        'Use an Object names the rule for the free object interaction it is distinguished from.',
    },
    {
      kind: 'condition',
      pointerPrefix: '/mechanics/levelLifecycle/exceptionRuleRefs/*',
      linkField: 'data.mechanics.levelLifecycle.exceptionRuleRefs',
      disposition: 'reference',
      relation: 'lifecycle-exception',
      targetResolution: 'record-key',
      reason:
        'A rule elsewhere in the source that overrides this condition level lifecycle (Food and Water blocks exhaustion removal).',
    },
    {
      kind: 'condition',
      pointerPrefix: '/mechanics/effects/*/condition',
      linkField: 'data.mechanics.effects[].condition',
      disposition: 'reference',
      targetResolution: 'record-name',
      targetKind: 'condition',
      relationField: 'kind',
      relationByFieldValue: {
        impliesCondition: 'implied-condition',
        imposesCondition: 'imposed-condition',
        conditionEndsWhen: null, // names the record's own condition: a self-reference, not a relationship
      },
      reason:
        'Condition effects name their related condition for impliesCondition and imposesCondition; conditionEndsWhen names the source condition itself and is explicitly excluded.',
    },
    {
      kind: 'condition',
      pointerPrefix: '/mechanics/effects/*/triggerCondition',
      linkField: 'data.mechanics.effects[].triggerCondition',
      disposition: 'reference',
      relation: 'ending-trigger-condition',
      targetResolution: 'record-name',
      targetKind: 'condition',
      reason:
        'The Grappled source clause says its condition ends when the grappler is incapacitated (see the condition).',
    },
    {
      kind: 'hazard',
      pointerPrefix: '/identicalToRef',
      linkField: 'data.identicalToRef',
      disposition: 'reference',
      relation: 'otherwise-identical-to',
      targetResolution: 'record-key',
      reason:
        'The Sphere of Annihilation trap prints that it is otherwise identical to the normal sphere of annihilation magic item.',
    },
    {
      kind: 'hazard',
      pointerPrefix: '/versions/*/likeSpellRef',
      linkField: 'data.versions[].likeSpellRef',
      disposition: 'reference',
      relation: 'effect-like-spell',
      targetResolution: 'record-key',
      reason:
        'The trap version prints that its enchantment is otherwise like an aspect of a named spell.',
    },
    {
      kind: 'hazard',
      pointerPrefix: '/mechanics/dispels/*/spell',
      linkField: 'data.mechanics.dispels[].spell',
      disposition: 'reference',
      relation: 'dispelled-by',
      targetResolution: 'record-key',
      reason:
        'A printed trap dispel-magic DC names the spell that removes the trap.',
    },
    {
      kind: 'hazard',
      pointerPrefix: '/versions/*/mechanics/dispels/*/spell',
      linkField: 'data.versions[].mechanics.dispels[].spell',
      disposition: 'reference',
      relation: 'dispelled-by',
      targetResolution: 'record-key',
      reason:
        'A printed dispel-magic DC inside a trap version names the spell that removes the enchantment.',
    },
    // eshyra-o9bd.16.6.2 (audit L2-F1): four source-grounded non-condition
    // reference families that already carried resolvable record keys. The
    // remaining record-key leaves are declared by eshyra-ry69 below.
    {
      kind: 'spell',
      pointerPrefix: '/mechanics/effects/*/creation/forms/*/creatureRef',
      linkField: 'data.mechanics.effects[].creation.forms[].creatureRef',
      disposition: 'reference',
      relation: 'creation-form',
      targetResolution: 'record-key',
      reason:
        'The creature record whose statistics the created form uses (Find Familiar: the familiar has the statistics of the chosen form).',
    },
    {
      kind: 'creature',
      pointerPrefix: '/traits/*/mechanics/spellcasting/groups/*/spells/*/ref',
      linkField: 'data.traits[].mechanics.spellcasting.groups[].spells[].ref',
      disposition: 'reference',
      relation: 'spellcasting-spell',
      targetResolution: 'record-key',
      reason:
        'A spell record a creature spellcasting trait lists in one of its printed groups: cantrips, spells by slot level, at will, or a number of times per day.',
    },
    {
      kind: 'ancestry',
      pointerPrefix: '/traits/*/tableRefs/*',
      linkField: 'data.traits[].tableRefs',
      disposition: 'reference',
      relation: 'table-reference',
      targetResolution: 'record-key',
      reason:
        'The table record a racial trait directs the reader to (Dragonborn: Draconic Ancestry).',
    },
    {
      kind: 'ancestry',
      pointerPrefix: '/choices/*/tableRef',
      linkField: 'data.choices[].tableRef',
      disposition: 'reference',
      relation: 'table-reference',
      targetResolution: 'record-key',
      reason:
        'The table record a racial choice is made from (Dragonborn: Draconic Ancestry).',
    },
    {
      kind: 'magic-item',
      pointerPrefix: '/mechanics/interItem/requiresItems/*/itemRefs/*',
      linkField: 'data.mechanics.interItem.requiresItems[].itemRefs',
      disposition: 'reference',
      relation: 'requires-item',
      targetResolution: 'record-key',
      reason:
        'A magic item the printed text names as a prerequisite of this item: worn for attunement (Hammer of Thunderbolts: belt of giant strength, gauntlets of ogre power) or coating its storage container (Sovereign Glue: oil of slipperiness).',
    },
    // eshyra-o9bd.19.3.5: condition-name leaves outside condition records.
    // Each is a typed reference or an explicit not-a-reference.
    {
      kind: 'magic-item',
      pointerPrefix: '/mechanics/effects/*/conditions/*',
      linkField: 'data.mechanics.effects[].conditions',
      disposition: 'reference',
      targetResolution: 'record-name',
      targetKind: 'condition',
      relationField: '../kind',
      relationByFieldValue: {
        imposesCondition: 'imposed-condition',
        triggeredEffect: 'imposed-condition',
        immunity: 'condition-immunity',
      },
      excludedLeafValues: ['suffocating'],
      reason:
        'The conditions a magic-item effect names: imposesCondition and triggeredEffect impose them on a failed save or trigger (Wand of Paralysis: paralyzed; Robe of Eyes: blinded), and immunity states immunity to them (Periapt of Proof against Poison: immune to the poisoned condition). The relation comes from the containing effect kind. Dust of Sneezing and Choking also lists suffocating ("incapacitated and suffocating"), which the SRD defines as a rule (rule:suffocating) and not a condition; it is declared as an excluded leaf value rather than left as an unresolved reference, and the importer keeps it in the conditions list because no existing field carries that meaning.',
    },
    {
      kind: 'magic-item',
      pointerPrefix: '/mechanics/effects/*/failedSaveCondition',
      linkField: 'data.mechanics.effects[].failedSaveCondition',
      disposition: 'reference',
      relation: 'failed-save-condition',
      targetResolution: 'record-name',
      targetKind: 'condition',
      reason:
        'The condition a creature suffers on a failed saving throw (Dagger of Venom: poisoned; Giant Slayer: prone; Horn of Blasting: deafened; Hammer of Thunderbolts: stunned). Every emitted occurrence is a triggeredEffect failed-save rider with this one meaning.',
    },
    {
      kind: 'magic-item',
      pointerPrefix: '/mechanics/effects/*/onSuccessfulSave/condition',
      linkField: 'data.mechanics.effects[].onSuccessfulSave.condition',
      disposition: 'reference',
      relation: 'successful-save-condition',
      targetResolution: 'record-name',
      targetKind: 'condition',
      reason:
        'Mace of Disruption: on a successful save the creature becomes frightened of the wielder until the end of the wielder next turn.',
    },
    {
      kind: 'magic-item',
      pointerPrefix: '/mechanics/effects/*/condition',
      linkField: 'data.mechanics.effects[].condition',
      disposition: 'reference',
      targetResolution: 'record-name',
      targetKind: 'condition',
      relationField: 'kind',
      relationByFieldValue: {
        imposesCondition: 'imposed-condition',
        ...Object.fromEntries(
          MAGIC_ITEM_EFFECT_CONDITION_PROSE_KINDS.map((kind) => [kind, null]),
        ),
      },
      reason:
        'Overloaded field: an imposesCondition effect names the condition it imposes (Philter of Love: charmed), while every other effect kind, triggeredEffect included, stores a prose activation precondition here (for example "while the sword is ablaze") that is excluded. The importer emits the condition a triggeredEffect imposes (Rod of Rulership, Philter of Love) in its conditions[] array, not here.',
    },
    // eshyra-o9bd.19.3.5.2 (eshyra-1fx7): condition names under field names
    // other than condition/conditions/failedSaveCondition.
    ...CONDITION_IMMUNITY_DECLARATIONS,
    // eshyra-ry69: the remaining record-key reference leaves.
    ...RECORD_KEY_LEAF_DECLARATIONS,
    {
      kind: 'magic-item',
      pointerPrefix: '/mechanics/effects/*/state',
      linkField: 'data.mechanics.effects[].state',
      disposition: 'reference',
      targetResolution: 'record-name',
      targetKind: 'condition',
      relationField: 'kind',
      relationByFieldValue: { visibility: 'imposed-condition' },
      reason:
        'A visibility effect names the condition it imposes: Dust of Disappearance ("you and each creature and object within 10 feet of you become invisible for 2d4 minutes") and Potion of Invisibility ("you become invisible for 1 hour"). The SRD defines Invisible as a condition (Appendix PH-A). Any other effect kind carrying a state is indeterminate, not silently read.',
    },
    {
      kind: 'condition',
      pointerPrefix: '/mechanics/effects/*/state',
      linkField: 'data.mechanics.effects[].state',
      disposition: 'not-a-reference',
      reason:
        'The Invisible condition record describes its own state ("impossible-to-see"), a descriptor of that condition, not a condition name.',
    },
    {
      kind: 'magic-item',
      pointerPrefix: '/mechanics/effects/*/ends/*',
      linkField: 'data.mechanics.effects[].ends',
      disposition: 'reference',
      targetResolution: 'record-name',
      targetKind: 'condition',
      relationField: '../kind',
      relationByFieldValue: {
        conditionEndsWhen: 'removed-condition',
        triggeredEffect: 'removed-condition',
      },
      excludedLeafValues: ['disease', 'any-disease'],
      reason:
        'What a magic-item effect ends. Restorative Ointment: "ceases to be poisoned, and is cured of any disease" lists the poisoned condition it removes beside diseases. Diseases are not condition records (the SRD treats them as a separate rules topic), so disease and any-disease are declared excluded leaf values rather than unresolved references.',
    },
    {
      kind: 'magic-item',
      pointerPrefix: '/mechanics/effects/*/variants/whip/endsOn/*',
      linkField: 'data.mechanics.effects[].variants.whip.endsOn',
      disposition: 'reference',
      relation: 'ending-trigger-condition',
      targetResolution: 'record-name',
      targetKind: 'condition',
      excludedLeafValues: ['dismiss-action', 'death'],
      reason:
        'Feather Token (whip): "The whip disappears after 1 hour, when you use an action to dismiss it, or when you are incapacitated or die." The incapacitated entry names the condition that ends the effect; dismiss-action and death are not conditions and are declared excluded leaf values.',
    },
    prosePrecondition(
      'magic-item',
      '/variants/*/mechanics/effects/*/condition',
      'data.variants[].mechanics.effects[].condition',
    ),
    prosePrecondition(
      'magic-item',
      '/mechanics/stateMachine/transitions/*/condition',
      'data.mechanics.stateMachine.transitions[].condition',
    ),
    prosePrecondition(
      'action',
      '/mechanics/effects/*/condition',
      'data.mechanics.effects[].condition',
    ),
    prosePrecondition(
      'ancestry',
      '/traits/*/mechanics/effects/*/condition',
      'data.traits[].mechanics.effects[].condition',
    ),
    prosePrecondition(
      'creature',
      '/actions/*/mechanics/effects/*/condition',
      'data.actions[].mechanics.effects[].condition',
    ),
    prosePrecondition(
      'creature',
      '/traits/*/mechanics/effects/*/condition',
      'data.traits[].mechanics.effects[].condition',
    ),
    prosePrecondition(
      'creature',
      '/actions/*/mechanics/attacks/*/alternatives/*/condition',
      'data.actions[].mechanics.attacks[].alternatives[].condition',
    ),
    prosePrecondition(
      'creature',
      '/traits/*/mechanics/effects/*/forms/*/statlineRefs/*/condition',
      'data.traits[].mechanics.effects[].forms[].statlineRefs[].condition',
    ),
    prosePrecondition(
      'feature',
      '/mechanics/effects/*/condition',
      'data.mechanics.effects[].condition',
    ),
    prosePrecondition(
      'spell',
      '/mechanics/effects/*/condition',
      'data.mechanics.effects[].condition',
    ),
    prosePrecondition(
      'spell',
      '/mechanics/damage/*/typeOptions/*/condition',
      'data.mechanics.damage[].typeOptions[].condition',
    ),
    {
      kind: 'action',
      pointerPrefix: '/mechanics/effects/*/conditions/*',
      linkField: 'data.mechanics.effects[].conditions',
      disposition: 'not-a-reference',
      reason:
        'Dodge benefitEndsWhen lists the circumstances that end the benefit (you-are-incapacitated, your-speed-is-0), which are clauses, not condition names. The Dodge incapacitated edge is already carried by its mechanics.conditions exclusion entry.',
    },
    {
      kind: 'equipment',
      pointerPrefix: '/useProfile/clauses/*/semantics/failureCondition',
      linkField: 'data.useProfile.clauses[].semantics.failureCondition',
      disposition: 'reference',
      relation: 'failed-save-condition',
      targetResolution: 'record-name',
      targetKind: 'condition',
      reason:
        'Ball Bearings: a creature moving across the area must succeed on a DC 10 Dexterity saving throw or fall prone.',
    },
    {
      kind: 'equipment',
      pointerPrefix: '/useProfile/clauses/*/semantics/condition',
      linkField: 'data.useProfile.clauses[].semantics.condition',
      disposition: 'reference',
      targetResolution: 'record-name',
      targetKind: 'condition',
      relationField: '../owner',
      relationByFieldValue: {
        F3: 'imposed-condition',
        model: null,
      },
      reason:
        'Overloaded field in equipment use-profile clauses. The F3 (save/condition) clause owner stores a condition name (Net: a creature hit by a net is restrained until it is freed); the model-owned clause stores a free-text precondition (Lance: wielder-not-mounted), which is excluded. Any other clause owner is indeterminate, not silently read.',
    },
  ];
