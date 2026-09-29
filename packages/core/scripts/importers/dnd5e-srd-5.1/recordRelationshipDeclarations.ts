import type { RecordRelationshipDeclaration } from '../../../src/rules/recordRelationships.js';

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
    {
      kind: 'action',
      pointerPrefix: '/mechanics/conditions/*/condition',
      linkField: 'data.mechanics.conditions',
      disposition: 'reference',
      relation: 'condition',
      targetResolution: 'record-name',
      targetKind: 'condition',
      relationField: 'relation',
      reason:
        'Condition names are resolved against the condition kind; a missing, non-string, or unrecognized relation sibling now yields a typed indeterminate outcome (see recordRelationships.ts RelationshipResolution), never a silently skipped occurrence.',
    },
    {
      kind: 'feat',
      pointerPrefix: '/mechanics/conditions/*/condition',
      linkField: 'data.mechanics.conditions',
      disposition: 'reference',
      relation: 'condition',
      targetResolution: 'record-name',
      targetKind: 'condition',
      relationField: 'relation',
      reason:
        'Condition names are resolved against the condition kind; a missing, non-string, or unrecognized relation sibling now yields a typed indeterminate outcome (see recordRelationships.ts RelationshipResolution), never a silently skipped occurrence.',
    },
    {
      kind: 'feature',
      pointerPrefix: '/mechanics/conditions/*/condition',
      linkField: 'data.mechanics.conditions',
      disposition: 'reference',
      relation: 'condition',
      targetResolution: 'record-name',
      targetKind: 'condition',
      relationField: 'relation',
      reason:
        'Condition names are resolved against the condition kind; a missing, non-string, or unrecognized relation sibling now yields a typed indeterminate outcome (see recordRelationships.ts RelationshipResolution), never a silently skipped occurrence.',
    },
    {
      kind: 'hazard',
      pointerPrefix: '/mechanics/conditions/*/condition',
      linkField: 'data.mechanics.conditions',
      disposition: 'reference',
      relation: 'condition',
      targetResolution: 'record-name',
      targetKind: 'condition',
      relationField: 'relation',
      reason:
        'Condition names are resolved against the condition kind; a missing, non-string, or unrecognized relation sibling now yields a typed indeterminate outcome (see recordRelationships.ts RelationshipResolution), never a silently skipped occurrence.',
    },
    {
      kind: 'spell',
      pointerPrefix: '/mechanics/conditions/*/condition',
      linkField: 'data.mechanics.conditions',
      disposition: 'reference',
      relation: 'condition',
      targetResolution: 'record-name',
      targetKind: 'condition',
      relationField: 'relation',
      reason:
        'Condition names are resolved against the condition kind; a missing, non-string, or unrecognized relation sibling now yields a typed indeterminate outcome (see recordRelationships.ts RelationshipResolution), never a silently skipped occurrence.',
    },
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
  ];
