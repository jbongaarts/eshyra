/** Reproducible, semantic inventory for eshyra-o9bd.18.8.8. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATHFINDER2E_REMASTER_RULES_PACK } from '../src/rules/pathfinder2eRemaster.js';

export type Disposition =
  | 'complete'
  | 'typed-core-with-prose-qualifier'
  | 'model-adjudicated'
  | 'unsupported'
  | 'not-mechanical';

export interface InventoryRow {
  readonly system: string;
  readonly recordKinds: readonly string[];
  readonly fieldPath: string;
  readonly representativeValues: readonly string[];
  readonly population: number;
  readonly valueClass:
    | 'source prose'
    | 'identifier-like'
    | 'scalar-like'
    | 'compound mechanical text'
    | 'mixed';
  readonly currentSchemaValidation: string;
  readonly deterministicConsumers: string;
  readonly currentAuditReadiness: string;
  readonly disposition: Disposition;
  readonly typedSchemaOrConsumer: string | null;
  readonly retainedProseBoundary: string | null;
  readonly owner: string | null;
  readonly futureWork: boolean;
}

export interface InventoryArtifact {
  readonly bead: string;
  readonly generatedBy: string;
  readonly inputs: readonly string[];
  readonly recordCounts: {
    readonly dnd5eSrd: number;
    readonly pathfinderFixture: number;
  };
  readonly rowCount: number;
  readonly dispositionCounts: Readonly<Record<Disposition, number>>;
  readonly rows: readonly InventoryRow[];
}

interface Seen {
  readonly kind: string;
  readonly values: Set<string>;
  population: number;
}

interface ClassificationContext {
  readonly system: string;
  readonly recordKinds: readonly string[];
  readonly fieldPath: string;
  readonly representativeValues: readonly string[];
}

type Classification = Omit<
  InventoryRow,
  'system' | 'recordKinds' | 'fieldPath' | 'representativeValues' | 'population'
>;
type ClassificationRule = {
  readonly name: string;
  readonly matches: (context: ClassificationContext) => boolean;
  readonly classify: (context: ClassificationContext) => Classification;
};

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const dndPath = join(
  root,
  'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json',
);
const outputPath = join(
  root,
  'docs/inventories/o9bd-18-8-8-semi-structured-boundary.json',
);
const markdownPath = join(
  root,
  'docs/inventories/o9bd-18-8-8-semi-structured-boundary.md',
);

function recordsFrom(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('records.json must be an array');
  return value as Record<string, unknown>[];
}

function add(
  seen: Map<string, Seen>,
  system: string,
  kind: string,
  path: string,
  value: unknown,
): void {
  if (typeof value === 'string') {
    const key = `${system}|${kind}|${path}`;
    const current = seen.get(key) ?? {
      kind,
      values: new Set<string>(),
      population: 0,
    };
    current.population += 1;
    if (current.values.size < 5) current.values.add(value);
    seen.set(key, current);
    return;
  }
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'string')) {
      const key = `${system}|${kind}|${path}[]`;
      const current = seen.get(key) ?? {
        kind,
        values: new Set<string>(),
        population: 0,
      };
      current.population += 1;
      for (const item of value.slice(0, 5)) {
        if (current.values.size < 5) current.values.add(String(item));
      }
      seen.set(key, current);
      return;
    }
    for (const item of value) add(seen, system, kind, `${path}[]`, item);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      add(seen, system, kind, path ? `${path}.${key}` : key, child);
    }
  }
}

function result(
  valueClass: Classification['valueClass'],
  disposition: Disposition,
  deterministicConsumers: string,
  currentSchemaValidation: string,
  currentAuditReadiness: string,
  typedSchemaOrConsumer: string | null,
  owner: string | null,
  futureWork = false,
  retainedProseBoundary: string | null = null,
): Classification {
  return {
    valueClass,
    currentSchemaValidation,
    deterministicConsumers,
    currentAuditReadiness,
    disposition,
    typedSchemaOrConsumer,
    retainedProseBoundary,
    owner,
    futureWork,
  };
}

const shapeValidation =
  'the registered system/kind validator checks the declared string or string-array shape';
const noDeterministicConsumer =
  'no deterministic consumer is registered for this field';

function exactPath(
  ...paths: string[]
): (context: Pick<ClassificationContext, 'fieldPath'>) => boolean {
  return ({ fieldPath }) => paths.includes(fieldPath);
}

function kindIs(
  ...kinds: string[]
): (context: Pick<ClassificationContext, 'recordKinds'>) => boolean {
  return ({ recordKinds }) =>
    recordKinds.length === kinds.length &&
    kinds.every((kind) => recordKinds.includes(kind));
}

function hasKind(
  ...kinds: string[]
): (context: Pick<ClassificationContext, 'recordKinds'>) => boolean {
  return ({ recordKinds }) => kinds.some((kind) => recordKinds.includes(kind));
}

const rules: readonly ClassificationRule[] = [
  {
    name: 'magic-item curse lifecycle state and effect references',
    matches: ({ system, fieldPath, recordKinds }) =>
      system === 'dnd5e-srd' &&
      kindIs('magic-item')({ recordKinds }) &&
      exactPath(
        'data.mechanics.curse.attunement.attachesStates[]',
        'data.mechanics.curse.attunement.preconditionEffects[]',
        'data.mechanics.curse.possession.blocksVoluntaryRelinquishmentWhileStates[]',
      )({ fieldPath } as ClassificationContext),
    classify: ({ fieldPath }) => {
      const custodyState = fieldPath.includes('.possession.');
      const attachedState = fieldPath.endsWith('.attachesStates[]');
      return result(
        'identifier-like',
        'complete',
        custodyState
          ? 'assertInventoryCurseCustodyReady resolves the effective curse and gates voluntary release while the referenced attached state is active'
          : attachedState
            ? 'assertEffectiveAttunementCurseReady gates atomic curse attachment/end and assertInventoryCurseCustodyReady identifies active attached possession states'
            : 'assertEffectiveAttunementCurseReady gates attunement until the referenced precondition effect can be evaluated',
        custodyState || attachedState
          ? 'validateMagicItemMechanics requires non-empty canonical state ids and resolves every id against curse.stateDefinitions'
          : 'validateMagicItemMechanics requires non-empty canonical effect ids and resolves every id against mechanics.effects',
        'magic-item curse projection, schema referential-integrity, attunement corpus, custody domain, transfer, and tool regressions',
        custodyState
          ? 'MagicItemCurse.possession.blocksVoluntaryRelinquishmentWhileStates / validateMagicItemMechanics'
          : attachedState
            ? 'MagicItemCurse.attunement.attachesStates / validateMagicItemMechanics'
            : 'MagicItemCurse.attunement.preconditionEffects / validateMagicItemMechanics',
        custodyState
          ? 'attunement.ts assertInventoryCurseCustodyReady and the remove/transfer mutation boundaries'
          : attachedState
            ? 'attunement.ts assertEffectiveAttunementCurseReady and assertInventoryCurseCustodyReady'
            : 'attunement.ts assertEffectiveAttunementCurseReady',
      );
    },
  },
  {
    name: 'canonical magic-item variant identity',
    matches: ({ system, fieldPath, recordKinds }) =>
      system === 'dnd5e-srd' &&
      kindIs('magic-item')({ recordKinds }) &&
      fieldPath === 'data.variants[].id',
    classify: () =>
      result(
        'identifier-like',
        'complete',
        'canonicalMagicItemVariantId / MagicItemVariantDefinition.id',
        'D&D magic-item validator requires a canonical unique id for every variant',
        'emitter, schema, variant resolver, grant, and instance-state regression tests',
        'MagicItemVariantDefinition.id',
        'magicItemVariants.ts and magic-item variant identity tests',
      ),
  },
  {
    name: 'derived magic-item execution readiness',
    matches: ({ system, fieldPath, recordKinds }) =>
      system === 'dnd5e-srd' &&
      kindIs('magic-item')({ recordKinds }) &&
      fieldPath.startsWith('data.executionReadiness'),
    classify: () =>
      result(
        'scalar-like',
        'complete',
        'magic-item compiler classification persistence and audit-bundle readiness report',
        'D&D magic-item validator enforces closed entry, scope, representation, and exact hook shapes',
        'generated-pack regression and audit report pin non-zero engine-pending/design-blocked counts',
        'MagicItemExecutionReadiness / validateMagicItemExecutionReadiness',
        'magicItemCompiler.ts, kindSchemas.ts, and magic-item execution-readiness audit',
      ),
  },
  {
    name: 'explicit unsupported residuals',
    matches: ({ system, fieldPath, recordKinds }) =>
      system === 'dnd5e-srd' &&
      ((hasKind('creature', 'stat-block')({ recordKinds }) &&
        exactPath('data.senses')({ fieldPath } as ClassificationContext)) ||
        (hasKind('creature')({ recordKinds }) &&
          exactPath(
            'data.savingThrows',
            'data.skills',
          )({
            fieldPath,
          } as ClassificationContext)) ||
        (kindIs('equipment')({ recordKinds }) &&
          exactPath('data.properties[]')({
            fieldPath,
          } as ClassificationContext)) ||
        (kindIs('magic-item')({ recordKinds }) &&
          exactPath('data.attunementRequirement')({
            fieldPath,
          } as ClassificationContext))),
    classify: ({ fieldPath }) =>
      result(
        'compound mechanical text',
        'unsupported',
        'future deterministic domain consumer; callers must not parse this ad hoc',
        'kind validator checks only the current shape; no complete semantic grammar is declared',
        'source is retained and readiness must not claim deterministic execution',
        null,
        fieldPath === 'data.properties[]'
          ? 'eshyra-o9bd.18.7.6 (equipment semantic payload)'
          : fieldPath === 'data.attunementRequirement'
            ? 'eshyra-o9bd.18.7.7.1 / 18.7.7 (magic-item state and activation contracts)'
            : 'eshyra-o9bd.18.7.9.15 (residual creature mechanics)',
        true,
      ),
  },
  {
    name: 'record identity',
    matches: exactPath('record.key', 'record.kind', 'record.systemId'),
    classify: ({ fieldPath }) => {
      if (fieldPath === 'record.key') {
        return result(
          'identifier-like',
          'complete',
          'rules-stack `byKey` index and `lookupRulesRecord({ ref })`',
          'RulesRecord.key is required by the baseline record validator',
          'canonical identity is indexed and ref-resolvable',
          'RulesRecord.key / RulesStackKindIndex.byKey',
          'rules-stack indexing and rules lookup',
        );
      }
      if (fieldPath === 'record.kind') {
        return result(
          'identifier-like',
          'complete',
          'RulesRecordKind discriminator and kind-specific schema dispatch',
          'RulesRecord.kind is checked against the closed RulesRecordKind union/validator',
          'kind membership and schema selection are audited',
          'RulesRecordKind; validateRecordKindSchema',
          'rules/types.ts and rules/kindSchemas.ts',
        );
      }
      return result(
        'identifier-like',
        'complete',
        'rules-stack system binding and `resolveRulesStack` compatibility',
        'RulesRecord.systemId is required by the baseline pack model',
        'system identity is checked while resolving the bound pack',
        'RulesRecord.systemId / RulesPack.meta.systemId',
        'rules-stack resolution',
      );
    },
  },
  {
    name: 'record normalized name identity',
    matches: exactPath('record.name'),
    classify: () =>
      result(
        'identifier-like',
        'complete',
        'rules-stack `byName` index using `normalizeRulesRecordName`; display identity',
        'RulesRecord.name is required by the baseline record validator',
        'normalized-name lookup reports not-found/single/ambiguous results',
        'normalizeRulesRecordName / RulesStackKindIndex.byName',
        'rules-stack indexing and rules lookup',
      ),
  },
  {
    name: 'record source-corpus identity',
    matches: exactPath('record.provenance.sourceRef'),
    classify: () =>
      result(
        'identifier-like',
        'complete',
        'validateRulesPack `assertProvenanceMatchesPackSource` cross-field invariant',
        'RecordProvenance.sourceRef must match meta.source.sourceUrl or meta.source.sourceIdentity',
        'pack validation fails closed when the source identity does not match',
        'RecordProvenance.sourceRef / RulesPackSource identity',
        'rules/validate.ts assertProvenanceMatchesPackSource',
      ),
  },
  {
    name: 'source and licensing provenance',
    matches: ({ fieldPath }) =>
      fieldPath === 'record.source' ||
      fieldPath.startsWith('record.provenance.') ||
      fieldPath.startsWith('record.license.'),
    classify: () =>
      result(
        'source prose',
        'not-mechanical',
        'provenance/display/licensing consumers only',
        'RulesRecord source, provenance, and license contracts validate metadata shape',
        'source coverage and license audits retain this evidence',
        null,
        'RulesRecord.source / RecordProvenance / RulesPackLicense',
      ),
  },
  {
    name: 'canonical record references',
    matches: exactPath(
      'data.contents[].ref',
      'data.equipmentGrants[].ref',
      'data.startingEquipment.entries[].grants[].ref',
      'data.startingEquipment.entries[].options[].grants[].ref',
      'data.features[]',
      'data.featuresByLevel[].features[]',
      'data.parentClass',
      'data.subraceOf',
      'data.subraces[]',
      'data.statBlockRefs[]',
      'data.tableRefs[]',
      'data.choices[].tableRef',
      'data.progressionTableRef',
      'data.spellTableRefs[]',
      'data.choices[].options[].prerequisites[].ref',
      'data.choices[].options[].prerequisites[].classRef',
      'data.choices[].options[].prerequisites[].featureRef',
    ),
    classify: ({ fieldPath }) => {
      const equipment =
        fieldPath === 'data.contents[].ref' ||
        fieldPath.includes('grants[].ref');
      const progression =
        fieldPath === 'data.features[]' ||
        fieldPath === 'data.featuresByLevel[].features[]' ||
        fieldPath.includes('progression');
      return result(
        'identifier-like',
        'complete',
        equipment
          ? fieldPath === 'data.contents[].ref'
            ? 'srdEquipmentPacks equipment-pack content resolution'
            : 'srdStartingEquipmentGrants starting-equipment resolution'
          : progression
            ? 'rulesPackResolver parseClassProgression feature-reference resolution'
            : fieldPath === 'data.tableRefs[]' ||
                fieldPath === 'data.choices[].tableRef' ||
                fieldPath === 'data.progressionTableRef' ||
                fieldPath === 'data.spellTableRefs[]'
              ? 'tableRefs reachability audit and advancement/choice table lookup'
              : 'lookupRulesRecord typed ancestry, spell, feature, or stat-block reference consumer',
        `${shapeValidation}; reference-bearing field has a domain contract`,
        'reference reachability/parity audits and the named resolver fail closed',
        equipment
          ? fieldPath === 'data.contents[].ref'
            ? 'EquipmentPackContents.ref / equipment-pack content reference'
            : 'StartingEquipmentGrant.ref / starting-equipment record reference'
          : progression
            ? 'ClassProgression.featureRefs / subclass feature reference'
            : 'domain-specific RulesRecord reference key',
        equipment
          ? 'srdStartingEquipmentGrants.ts and srdEquipmentPacks.ts'
          : progression
            ? 'rulesPackResolver.ts'
            : 'owning domain validator and rules/lookup.ts',
      );
    },
  },
  {
    name: 'local choice identities and discriminators',
    matches: exactPath(
      'data.choices[].id',
      'data.choices[].category',
      'data.choices[].options[].id',
      'data.choices[].options[].prerequisites[].kind',
      'data.startingEquipment.entries[].kind',
      'data.startingEquipment.entries[].grants[].kind',
      'data.startingEquipment.entries[].grants[].select',
      'data.startingEquipment.entries[].grants[].weaponCategory',
      'data.startingEquipment.entries[].grants[].weaponRange',
      'data.startingEquipment.entries[].options[].grants[].kind',
      'data.startingEquipment.entries[].options[].grants[].select',
      'data.startingEquipment.entries[].options[].grants[].weaponCategory',
      'data.startingEquipment.entries[].options[].grants[].weaponRange',
    ),
    classify: ({ fieldPath }) =>
      result(
        'identifier-like',
        'complete',
        fieldPath.includes('startingEquipment')
          ? 'srdStartingEquipmentGrants typed grant/filter contract'
          : 'srdCreationChoices / feature-choice validator local choice contract',
        'kind-specific schema validates the closed choice/grant discriminator',
        'choice and equipment-resolution audits validate domain membership',
        fieldPath.includes('startingEquipment')
          ? 'StartingEquipmentGrant discriminator / StartingEquipmentFilterSelect'
          : 'CreationChoice.id / CreationChoiceCategory / FeatureChoiceCategory',
        fieldPath.includes('startingEquipment')
          ? 'srdStartingEquipmentGrants.ts and rulesPackResolver.ts'
          : 'srdCreationChoices.ts and featureChoices.ts',
      ),
  },
  {
    name: 'creation and progression domains',
    matches: ({ system, fieldPath, recordKinds }) =>
      system === 'dnd5e-srd' &&
      ((kindIs('ancestry')({ recordKinds }) &&
        exactPath(
          'data.abilityScoreIncreases[].choice.from[]',
          'data.abilityScoreIncreases[].fixed[].ability',
          'data.choices[].from[]',
          'data.languages[].fixed[]',
          'data.languages[].from[]',
        )({ fieldPath } as ClassificationContext)) ||
        (kindIs('background')({ recordKinds }) &&
          exactPath(
            'data.choices[].from[]',
            'data.skillProficiencies[]',
            'data.languages[].fixed[]',
            'data.languages[].from[]',
          )({
            fieldPath,
          } as ClassificationContext)) ||
        (kindIs('class')({ recordKinds }) &&
          exactPath(
            'data.armorProficiencies[]',
            'data.weaponProficiencies[]',
            'data.toolProficiencies[]',
            'data.savingThrowProficiencies[]',
            'data.toolProficiencyChoices[].from[]',
            'data.primaryAbilities[]',
            'data.skillChoices[].from[]',
            'data.spellcastingAbility',
            'data.spellPreparation.kind',
            'data.spellPreparation.preparationFormula.ability',
            'data.progression[].advancement[].kind',
            'data.progression[].advancement[].ref',
            'data.progression[].advancement[].targetRefs[]',
            'data.progression[].proficiencyBonus',
          )({ fieldPath } as ClassificationContext)) ||
        exactPath('data.classes[]')({ fieldPath } as ClassificationContext)),
    classify: ({ fieldPath }) =>
      result(
        'scalar-like',
        'complete',
        fieldPath === 'data.classes[]'
          ? 'rulesPackResolver spell legal-class filtering'
          : fieldPath.includes('progression')
            ? 'rulesPackResolver parseClassProgression / advancementTable parsing'
            : fieldPath.includes('Proficien') ||
                fieldPath.includes('proficiency')
              ? 'srdCreationChoices and class-choice/proficiency resolution'
              : 'rulesPackResolver and srdCreationChoices typed creation-choice domains',
        'D&D system kind schema plus the named resolver contract validates this field',
        'character creation/progression audits and resolvers consume the closed domain',
        'domain-specific creation/progression schema and resolver contract',
        'rulesPackResolver.ts, srdCreationChoices.ts, and advancementTable.ts',
      ),
  },
  {
    name: 'equipment filter fields',
    matches: ({ system, fieldPath, recordKinds }) =>
      system === 'dnd5e-srd' &&
      kindIs('equipment')({ recordKinds }) &&
      exactPath(
        'data.category',
        'data.equipmentGroup',
        'data.weaponCategory',
        'data.weaponRange',
        'data.damageType',
        'data.armorType',
        'data.armorClass.dexModifier',
      )({ fieldPath } as ClassificationContext),
    classify: () =>
      result(
        'scalar-like',
        'complete',
        'srdStartingEquipmentGrants equipment catalog filters and kind schema',
        'D&D equipment validator checks the field shape and closed filter contract',
        'equipment-resolution audit verifies every starting-equipment filter resolves',
        'Dnd5eEquipmentData / StartingEquipmentFilterGrant',
        'srdEquipmentResolutionAudit.ts and srdStartingEquipmentGrants.ts',
      ),
  },
  {
    name: 'equipment mechanics projections',
    matches: ({ system, fieldPath, recordKinds }) =>
      system === 'dnd5e-srd' &&
      kindIs('equipment')({ recordKinds }) &&
      (fieldPath.startsWith('data.weaponProperties') ||
        fieldPath.startsWith('data.useProfile')),
    classify: ({ fieldPath }) => {
      const evidence =
        fieldPath.endsWith('.source') ||
        fieldPath.endsWith('.sourcePhrase') ||
        fieldPath === 'data.useProfile.modelAdjudicatedQualifiers[]';
      return result(
        evidence ? 'source prose' : 'scalar-like',
        evidence ? 'model-adjudicated' : 'complete',
        evidence
          ? 'retained source binding or explicitly adjudicated qualifier'
          : 'equipment use-profile and closed weapon-property consumers',
        'D&D equipment schema validates the closed projection vocabulary',
        'equipment inventory, source-drift, schema, and readiness gates',
        evidence ? null : 'EquipmentUseProfile / WeaponProperty',
        evidence
          ? 'equipmentMechanics.ts source binding'
          : 'parseEquipment.ts, equipmentMechanics.ts, and kindSchemas.ts',
      );
    },
  },
  {
    name: 'spell upcast source boundary',
    matches: ({ system, recordKinds, fieldPath }) =>
      system === 'dnd5e-srd' &&
      kindIs('spell')({ recordKinds }) &&
      (fieldPath === 'data.scalingSourceKind' ||
        fieldPath === 'data.scalingSourceText' ||
        fieldPath.startsWith('data.upcast')),
    classify: ({ fieldPath }) => {
      const retained =
        fieldPath === 'data.scalingSourceText' ||
        fieldPath === 'data.upcast.sourcePhrase' ||
        fieldPath === 'data.upcast.qualifier.text';
      return result(
        retained ? 'source prose' : 'scalar-like',
        fieldPath === 'data.upcast.qualifier.text'
          ? 'typed-core-with-prose-qualifier'
          : retained && fieldPath === 'data.scalingSourceText'
            ? 'not-mechanical'
            : 'complete',
        'shared spell upcast contract, canonical compiler, and resolveSpellUpcast',
        'one closed parser shared by kind-schema validation and runtime rejects source, shape, compatibility, and arithmetic drift',
        '92-clause deep semantic oracle and resolver retain exact phrase/page/clause/operation evidence',
        'SpellUpcastSpec / SpellUpcastOperation',
        'parseSpells.ts, upcast.ts, spellUpcastContract.ts, spellUpcast.ts, and kindSchemas.ts',
        false,
        'data.higherLevels',
      );
    },
  },
  {
    name: 'mechanics duration projection with source qualifier',
    matches: exactPath(
      'data.mechanics.duration.kind',
      'data.mechanics.duration.unit',
    ),
    classify: () =>
      result(
        'scalar-like',
        'typed-core-with-prose-qualifier',
        'deriveSpellMechanics duration projection and spell effect audits',
        'D&D spell schema validates mechanics.duration and the closed duration vocabulary',
        'typed duration kind/unit is audited; the original spell duration remains retained prose evidence',
        'SpellDurationMechanics.kind/unit',
        'importer mechanicsProjections.ts and dnd5eSrdAuditBundle.test.ts',
        false,
        'data.duration',
      ),
  },
  {
    name: 'mechanics canonical references',
    matches: ({ fieldPath }) =>
      /^data\.mechanics\..*(?:ruleRef|classRef|featureRef|creatureRef|resultRef|tableRef|tableRefs\[\]|ambiguityId)$/.test(
        fieldPath,
      ),
    classify: ({ fieldPath }) =>
      result(
        'identifier-like',
        'complete',
        fieldPath.endsWith('ambiguityId')
          ? 'RulesAmbiguity.id availability/transition contract'
          : 'mechanics projection reference validation and the named effect resolver',
        'domain-specific mechanics schema validates the reference-bearing field',
        'reference reachability and mechanics audits validate the declared target',
        'domain-specific mechanics reference contract',
        'mechanicsProjections.ts and the owning rules/audit domain',
      ),
  },
  {
    name: 'mechanics closed scalar contracts',
    matches: ({ fieldPath }) =>
      /^data\.(?:mechanics|traits\[\]\.mechanics|actions\[\]\.mechanics|reactions\[\]\.mechanics|legendaryActions\.entries\[\]\.mechanics)\.(?:actionEconomy\.cost|effects\[\]\.(?:kind|mode|cost|ability|frequency|timing|attackType)|effects\[\]\.(?:creation|identity|placement|statBlockBasis)\.kind|effects\[\]\.(?:creation|creation\.options\[\]|creation\.cardinality|creation\.options\[\]\.cardinality|scaling\[\]|scaling\[\]\.options\[\]\.choices\[\]|transitions\[\]\.operation)\.kind|effects\[\]\.(?:creation\.cardinality|creation\.options\[\]\.cardinality|scaling\[\]\.options\[\]\.choices\[\]\.cardinality|transitions\[\]\.operation\.cardinality)\.mode|saves\[\]\.ability|spellcasting\.(?:ability|mode|componentRequirement)|levels\[\]\.effects\[\]\.(?:kind|mode))$/.test(
        fieldPath,
      ),
    classify: () =>
      result(
        'scalar-like',
        'complete',
        'mechanicsProjections domain discriminators and kindSchemas closed vocabularies',
        'domain-specific mechanics schema validates the closed scalar/discriminator',
        'mechanics audit consumes the typed scalar without model parsing',
        'domain-specific mechanics discriminator/scalar contract',
        'mechanicsProjections.ts and rules/kindSchemas.ts',
      ),
  },
  {
    name: 'mechanics prose qualifiers',
    matches: ({ fieldPath }) =>
      fieldPath.includes('.mechanics.') &&
      /(?:\.note|\.footnote|\.condition|\.constraint|\.target|\.against|\.to|\.from|\.detail|\.context)$/.test(
        fieldPath,
      ),
    classify: () =>
      result(
        'compound mechanical text',
        'model-adjudicated',
        'model context only; no deterministic consumer owns this qualifier',
        shapeValidation,
        'qualifier remains source/entry prose and is not claimed as typed gameplay support',
        null,
        null,
      ),
  },
  {
    name: 'explicit display and flavor fields',
    matches: exactPath(
      'data.actions[].name',
      'data.traits[].name',
      'data.variants[].name',
      'data.choices[].options[].name',
      'data.feature.name',
      'data.familyPath[]',
    ),
    classify: () =>
      result(
        'source prose',
        'not-mechanical',
        'display and navigation only',
        shapeValidation,
        'display/source audits only; no deterministic gameplay claim',
        null,
        'record display contract',
      ),
  },
  {
    name: 'mechanical source prose',
    matches: ({ fieldPath }) =>
      exactPath(
        'data.text',
        'data.description',
        'data.actions[].text',
        'data.reactions[].text',
        'data.legendaryActions[].text',
        'data.choices[].options[].text',
        'data.choices[].sourceText',
        'data.startingEquipment.text',
        'data.startingEquipment.entries[].text',
        'data.startingEquipment.entries[].sourceText',
        'data.startingEquipment.entries[].options[].text',
        'data.armorClass.sourceText',
        'data.abilityScoreIncreases[].sourceText',
        'data.proficiencyNotes[].text',
      )({ fieldPath } as ClassificationContext),
    classify: ({ fieldPath }) =>
      result(
        'compound mechanical text',
        'model-adjudicated',
        'model context only; any deterministic core must be represented by a separate named projection',
        shapeValidation,
        `source text retained as evidence; no deterministic support is claimed for ${fieldPath}`,
        null,
        null,
      ),
  },
  {
    name: 'source prose and unowned strings',
    matches: ({ fieldPath }) =>
      fieldPath.startsWith('data.') &&
      /(?:\.text|\.description|\.sourceText|\.prompt|\.detail|\.note|\.condition|\.constraint|\.target|\.against|\.grant|\.equipment)$/.test(
        fieldPath,
      ),
    classify: () =>
      result(
        'source prose',
        'model-adjudicated',
        noDeterministicConsumer,
        shapeValidation,
        'source coverage retains the clause; readiness does not count it as deterministic support',
        null,
        null,
      ),
  },
  {
    name: 'conservative fallback',
    matches: () => true,
    classify: ({ fieldPath }) =>
      result(
        'scalar-like',
        'model-adjudicated',
        noDeterministicConsumer,
        shapeValidation,
        `syntax alone does not establish deterministic authority for ${fieldPath}`,
        null,
        null,
      ),
  },
];

export function classifyField(context: ClassificationContext): Classification {
  const rule = rules.find((candidate) => candidate.matches(context));
  if (rule === undefined)
    throw new Error(`no classification rule for ${context.fieldPath}`);
  return rule.classify(context);
}

export function buildInventoryArtifact(): InventoryArtifact {
  const dndRecords = recordsFrom(JSON.parse(readFileSync(dndPath, 'utf8')));
  const sources = [
    {
      system: 'dnd5e-srd',
      records: dndRecords,
    },
    {
      system: 'pathfinder2e-remaster',
      records:
        PATHFINDER2E_REMASTER_RULES_PACK.records as unknown as readonly Record<
          string,
          unknown
        >[],
    },
  ];
  const seen = new Map<string, Seen>();
  for (const source of sources) {
    for (const record of source.records) {
      const kind = String(record.kind);
      add(seen, source.system, kind, 'data', record.data);
      for (const [key, value] of Object.entries(record)) {
        if (key !== 'data')
          add(seen, source.system, kind, `record.${key}`, value);
      }
    }
  }
  const rows = [...seen.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      const [system, recordKind, ...pathParts] = key.split('|');
      const fieldPath = pathParts.join('|');
      const representativeValues = [...value.values];
      const classification = classifyField({
        system,
        recordKinds: [recordKind],
        fieldPath,
        representativeValues,
      });
      return {
        system,
        recordKinds: [recordKind],
        fieldPath,
        representativeValues,
        population: value.population,
        ...classification,
      } satisfies InventoryRow;
    });
  const dispositionCounts = Object.fromEntries(
    [...new Set(rows.map((row) => row.disposition))]
      .sort()
      .map((disposition) => [
        disposition,
        rows.filter((row) => row.disposition === disposition).length,
      ]),
  ) as Record<Disposition, number>;
  return {
    bead: 'eshyra-o9bd.18.8.8',
    generatedBy: relative(root, fileURLToPath(import.meta.url)),
    inputs: [
      relative(root, dndPath),
      'packages/core/src/rules/pathfinder2eRemaster.ts',
    ],
    recordCounts: {
      dnd5eSrd: dndRecords.length,
      pathfinderFixture: PATHFINDER2E_REMASTER_RULES_PACK.records.length,
    },
    rowCount: rows.length,
    dispositionCounts,
    rows,
  };
}

export function renderInventoryJson(artifact: InventoryArtifact): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

export function renderInventoryMarkdown(artifact: InventoryArtifact): string {
  const lines = [
    '# Semi-structured SRD string inventory',
    '',
    `Generated by \`${artifact.generatedBy}\`; inputs contain ${artifact.recordCounts.dnd5eSrd} D&D records and ${artifact.recordCounts.pathfinderFixture} representative Pathfinder records. Rows group repeated field paths within each record kind; population is occurrences for scalar strings and records containing an array of strings.`,
    '',
    `Total grouped paths: **${artifact.rowCount}**. Dispositions: ${Object.entries(
      artifact.dispositionCounts,
    )
      .map(([key, value]) => `\`${key}\` ${value}`)
      .join(', ')}.`,
    '',
    'Scope boundary (ADR 0020 §5.6): one disposition per candidate is field-level bookkeeping only. It is not exclusive clause, procedure, discovery, or capability ownership. A record can hold a typed projection and an untyped residual for the same concept; discovery may use this census for exploratory candidates and projection-limit disclosure, never as an ownership claim.',
    '',
    'The generated JSON is the machine-readable inventory. This table keeps the same evidence compact enough for review.',
    '',
    '| System | Kinds | Field path | Population | Representative values | Class | Disposition | Consumer / schema | Retained prose | Owner / future |',
    '| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of artifact.rows) {
    const values = row.representativeValues
      .map((value) => value.replaceAll('|', '\\|').replaceAll('\n', ' '))
      .join('; ');
    lines.push(
      `| ${row.system} | ${row.recordKinds.join(', ')} | \`${row.fieldPath}\` | ${row.population} | ${values} | ${row.valueClass} | \`${row.disposition}\` | ${row.typedSchemaOrConsumer ?? row.currentSchemaValidation} | ${row.retainedProseBoundary ?? '—'} | ${row.owner ?? '—'}${row.futureWork ? ' (future work)' : ''} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

export function checkCommittedOutputs(): void {
  const artifact = buildInventoryArtifact();
  if (readFileSync(outputPath, 'utf8') !== renderInventoryJson(artifact)) {
    throw new Error('committed semi-structured JSON inventory is stale');
  }
  if (
    readFileSync(markdownPath, 'utf8') !== renderInventoryMarkdown(artifact)
  ) {
    throw new Error('committed semi-structured Markdown inventory is stale');
  }
}

export function writeCommittedOutputs(): void {
  const artifact = buildInventoryArtifact();
  writeFileSync(outputPath, renderInventoryJson(artifact));
  writeFileSync(markdownPath, renderInventoryMarkdown(artifact));
  console.log(
    `wrote ${relative(root, outputPath)} and ${relative(root, markdownPath)} (${artifact.rowCount} rows)`,
  );
}

const isCli =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  if (process.argv.includes('--check')) {
    checkCommittedOutputs();
    console.log(
      `inventory is current (${buildInventoryArtifact().rowCount} rows)`,
    );
  } else {
    writeCommittedOutputs();
  }
}
