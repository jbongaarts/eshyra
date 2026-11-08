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
 * `triggeredEffect` is mixed (Rod of Rulership and Philter of Love's
 * triggered effect store `charmed`; five others store prose) and a table keyed
 * by kind cannot separate them, so it is excluded and tracked as a follow-up.
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
    // remaining undeclared record-key leaves are owned by eshyra-ry69.
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
        'Overloaded field: an imposesCondition effect names the condition it imposes (Philter of Love: charmed), while every other effect kind stores a prose activation precondition here (for example "while the sword is ablaze") that is excluded. triggeredEffect is mixed (two charmed names, five prose clauses) and cannot be told apart by kind, so it is excluded and tracked as a follow-up.',
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
