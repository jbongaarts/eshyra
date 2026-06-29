/**
 * Deterministic emitter for the D&D 5e SRD 5.1 importer.
 *
 * Takes parsed spell extractions + the class-list index, builds canonical
 * `RulesRecord`s and a `RulesPackMeta`, runs `validateRulesPack` to catch any
 * schema drift before writing, and writes `manifest.json` + `records.json`
 * with stable formatting (sorted-by-key records, fixed field order, 2-space
 * indent, trailing newline).
 *
 * Determinism note: object key order in the emitted JSON is the literal
 * order of the object expressions below. `JSON.stringify` preserves
 * insertion order, so two runs over the same parsed input produce
 * byte-identical files.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  RecordProvenance,
  RulesPack,
  RulesPackLicense,
  RulesPackMeta,
  RulesPackSource,
  RulesRecord,
} from '../../../src/rules/types.js';
import { validateRulesPack } from '../../../src/rules/validate.js';
import { linkAncestryOptionTables } from './ancestryOptions.js';
import { enrichClassChapterRecords } from './classProgression.js';
import { deriveFeatureChoices } from './deriveFeatureChoices.js';
import {
  enrichAncestryCreationFacts,
  enrichBackgroundCreationFacts,
} from './creationFacts.js';
import { linkOwnedTables } from './linkOwnedTables.js';
import type { SourceInventoryItem } from './sourceInventory.js';
import type { SourceCoverageReport } from './sourceInventoryCoverage.js';
import type { SourceRegionLedger } from './sourceRegionLedger.js';
import { linkSpellEmbeddedTables } from './spellTables.js';
import {
  assertNoEmbeddedTableLinearization,
  stripEmbeddedTableProse,
} from './stripEmbeddedTableProse.js';
import type {
  ActionExtraction,
  AncestryExtraction,
  BackgroundExtraction,
  ClassExtraction,
  ClassPrimaryAbilityIndex,
  ConditionExtraction,
  CreatureExtraction,
  DiseaseExtraction,
  EquipmentExtraction,
  FeatExtraction,
  FeatureExtraction,
  HazardExtraction,
  MagicItemExtraction,
  PoisonExtraction,
  RuleExtraction,
  SpellCasterClass,
  SpellClassIndex,
  SpellExtraction,
  StatBlockExtraction,
  SubclassExtraction,
  TableExtraction,
  TrapExtraction,
} from './types.js';

const SYSTEM_ID = 'dnd5e-srd';
const PACK_ID = 'rules:dnd5e-srd-5.1';
const SOURCE_URL =
  'https://dnd.wizards.com/resources/systems-reference-document';
// Source title and release date are kept byte-for-byte aligned with the pinned
// vendored source manifest at packages/core/sources/dnd5e-srd-5.1/manifest.json
// (sourceTitle + the CC-BY-4.0 release date documented there). The
// srdGeneratedPack committed-pack test asserts this alignment.
const SOURCE_TITLE = 'System Reference Document 5.1';
const SOURCE_VERSION = '5.1';
const SOURCE_DATE = '2023-01-27';

const PROVENANCE_POLICY =
  'Each record names the SRD page it was extracted from when the upstream record carries a page; pageless records cite the SRD section as the locator.';

export const SRD_5_1_LICENSE: RulesPackLicense = {
  licenseClass: 'open',
  licenseName: 'Creative Commons Attribution 4.0 International',
  attributionText:
    'This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.',
  requiresAttribution: true,
  commercialUseAllowed: true,
  hostedUseAllowed: true,
  redistributionAllowed: true,
  publicSharingAllowed: true,
  derivativeAllowed: true,
  containsUserSuppliedText: false,
  containsTrademarkedSettingMaterial: false,
  sourceMaterialDescription: `${SOURCE_TITLE} at ${SOURCE_URL}`,
  provenancePolicy: 'Every record names the SRD page it was extracted from.',
  outputRestrictions:
    'Preserve the SRD 5.1 attribution text on redistributed records and derivatives.',
};

function buildSource(sourceHash: string): RulesPackSource {
  return {
    sourceTitle: SOURCE_TITLE,
    sourceVersion: SOURCE_VERSION,
    sourceUrl: SOURCE_URL,
    sourceHash,
    sourceDate: SOURCE_DATE,
    recordProvenancePolicy: PROVENANCE_POLICY,
  };
}

function buildMeta(
  sourceHash: string,
  includedKinds: readonly string[],
): RulesPackMeta {
  // The description is intentionally explicit about which kinds the current
  // importer covers; this prevents callers from assuming a half-built pack is
  // reference-complete. See ADR 0005 and the loreweaver-0m9.5 issue.
  return {
    packId: PACK_ID,
    title: 'D&D 5e SRD 5.1',
    description: `D&D 5th Edition System Reference Document 5.1, extracted by the deterministic importer at packages/core/scripts/importers/dnd5e-srd-5.1. Included record kinds: ${includedKinds.join(', ')}. Other SRD record kinds are tracked under loreweaver-0m9.5 child issues and are not included until their parsers ship.`,
    role: 'base',
    systemId: SYSTEM_ID,
    version: SOURCE_VERSION,
    license: SRD_5_1_LICENSE,
    source: buildSource(sourceHash),
  };
}

function spellKey(name: string): string {
  return `spell:${slug(name)}`;
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function provenanceFor(page: number): RecordProvenance {
  return {
    sourceRef: SOURCE_URL,
    locator: `p. ${page}`,
  };
}

function sourceLabelFor(page: number): string {
  return `SRD 5.1 p. ${page}`;
}

function equipmentSourcePages(item: EquipmentExtraction): readonly number[] {
  return [
    ...new Set(
      [item.descriptionSourcePage, item.sourcePage].filter(
        (page): page is number => page !== undefined,
      ),
    ),
  ].sort((a, b) => a - b);
}

function equipmentSourceLabel(item: EquipmentExtraction): string {
  const pages = equipmentSourcePages(item);
  return pages.length === 1
    ? sourceLabelFor(pages[0])
    : `SRD 5.1 pp. ${pages.join(', ')}`;
}

function equipmentProvenance(item: EquipmentExtraction): RecordProvenance {
  const pages = equipmentSourcePages(item);
  return pages.length === 1
    ? provenanceFor(pages[0])
    : { sourceRef: SOURCE_URL, locator: `pp. ${pages.join(', ')}` };
}

export function spellExtractionsToRecords(
  spells: readonly SpellExtraction[],
  classes: ReadonlyMap<string, readonly SpellCasterClass[]>,
): RulesRecord[] {
  const out: RulesRecord[] = spells.map((spell) => {
    const classList = classes.get(spell.name) ?? [];
    const data = buildSpellData(spell, classList);
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'spell',
      key: spellKey(spell.name),
      name: spell.name,
      data,
      source: sourceLabelFor(spell.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(spell.sourcePage),
    };
    return record;
  });
  // Stable record order by key (loadRulesPackFromDirectory also sorts on read,
  // but emitting sorted means the on-disk file is human-readable in order).
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

function buildSpellData(
  spell: SpellExtraction,
  classes: readonly SpellCasterClass[],
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    level: spell.level,
    school: spell.school,
    castingTime: spell.castingTime,
    range: spell.range,
    duration: spell.duration,
    components: [...spell.components],
    classes: [...classes],
    description: spell.description,
  };
  if (spell.componentMaterials !== undefined) {
    base.componentMaterials = spell.componentMaterials;
  }
  if (spell.ritual) {
    base.ritual = true;
  }
  if (spell.higherLevels !== undefined) {
    base.higherLevels = spell.higherLevels;
  }
  return base;
}

function creatureKey(name: string): string {
  return `creature:${slug(name)}`;
}

function classKey(name: string): string {
  return `class:${slug(name)}`;
}

function subclassKey(name: string): string {
  return `subclass:${slug(name)}`;
}

function conditionKey(name: string): string {
  return `condition:${slug(name)}`;
}

function featKey(name: string): string {
  return `feat:${slug(name)}`;
}

function hazardKey(name: string): string {
  return `hazard:${slug(name)}`;
}

function ruleKey(name: string): string {
  return `rule:${slug(name)}`;
}

function actionKey(name: string): string {
  return `action:${slug(name)}`;
}

function tableKey(name: string): string {
  return `table:${slug(name)}`;
}

function equipmentKey(name: string): string {
  return `equipment:${slug(name)}`;
}

function magicItemKey(name: string): string {
  return `magic-item:${slug(name)}`;
}

export function statBlockKey(name: string): string {
  return `stat-block:${slug(name)}`;
}

function ancestryKey(name: string): string {
  return `ancestry:${slug(name)}`;
}

/**
 * Build the `data` payload for one creature record. Field insertion order is
 * fixed (so emitted JSON is byte-stable) and matches the `dnd5e-srd` creature
 * kindSchema's required keys; see `validateDnd5eCreature` in `kindSchemas.ts`.
 *
 * NPC stat blocks from Appendix MM-B carry a leading `category: 'npc'`
 * discriminator (loreweaver-bn0). Monster records (Monsters chapter / Appendix
 * MM-A) intentionally carry NO category field — its absence means "monster" —
 * so category provenance does not add an empty/default field to monster
 * records and the 296-creature monster baseline stays independent.
 */
function buildCreatureData(
  creature: CreatureExtraction,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (creature.category === 'npc') {
    data.category = 'npc';
  }
  if (creature.familyPath !== undefined) {
    data.familyPath = [...creature.familyPath];
  }
  data.size = creature.size;
  data.type = creature.type;
  data.alignment = creature.alignment;
  data.armorClass = creature.armorClass;
  data.hitPoints = creature.hitPoints;
  data.speed = { ...creature.speed };
  data.challengeRating = creature.challengeRating;
  data.abilityScores = {
    strength: creature.abilityScores.strength,
    dexterity: creature.abilityScores.dexterity,
    constitution: creature.abilityScores.constitution,
    intelligence: creature.abilityScores.intelligence,
    wisdom: creature.abilityScores.wisdom,
    charisma: creature.abilityScores.charisma,
  };
  // Optional keyed defensive / sense fields, appended after abilityScores in
  // stat-block print order (eshyra-ez6v / eshyra-4a7.5). Each is set only when
  // the SRD prints that label for the creature, so records that lack a field
  // (a beast with no saving throws) stay free of empty keys and the pre-existing
  // header-only records gain only the labels their source actually carries.
  if (creature.savingThrows !== undefined)
    data.savingThrows = creature.savingThrows;
  if (creature.skills !== undefined) data.skills = creature.skills;
  if (creature.damageVulnerabilities !== undefined)
    data.damageVulnerabilities = creature.damageVulnerabilities;
  if (creature.damageResistances !== undefined)
    data.damageResistances = creature.damageResistances;
  if (creature.damageImmunities !== undefined)
    data.damageImmunities = creature.damageImmunities;
  if (creature.conditionImmunities !== undefined)
    data.conditionImmunities = creature.conditionImmunities;
  if (creature.senses !== undefined) data.senses = creature.senses;
  if (creature.languages !== undefined) data.languages = creature.languages;
  // Narrative body sections (eshyra-yevt / eshyra-4a7.5), appended after the
  // keyed fields in stat-block print order. Each entry is a fresh {name, text}
  // object so the emitted JSON is byte-stable; sections absent from the source
  // produce no key.
  if (creature.traits !== undefined) {
    data.traits = creature.traits.map((e) => ({ name: e.name, text: e.text }));
  }
  if (creature.actions !== undefined) {
    data.actions = creature.actions.map((e) => ({
      name: e.name,
      text: e.text,
    }));
  }
  if (creature.reactions !== undefined) {
    data.reactions = creature.reactions.map((e) => ({
      name: e.name,
      text: e.text,
    }));
  }
  if (creature.legendaryActions !== undefined) {
    const legendary: Record<string, unknown> = {};
    if (creature.legendaryActions.description !== undefined) {
      legendary.description = creature.legendaryActions.description;
    }
    legendary.entries = creature.legendaryActions.entries.map((e) => ({
      name: e.name,
      text: e.text,
    }));
    data.legendaryActions = legendary;
  }
  // Source-derived flavor/description prose printed after the stat block
  // (eshyra-76b7). Appendix MM-A creatures and Appendix MM-B NPCs carry it; it
  // is kept out of the mechanical action/reaction text and emitted as its own
  // optional field. Absent for creatures the SRD does not describe after the
  // stat block, so they gain no key.
  if (creature.description !== undefined) {
    data.description = creature.description;
  }
  // Boxed "Variant: …" sidebars that modify this creature (eshyra-70xr).
  if (creature.variants !== undefined) {
    data.variants = creature.variants.map((v) => ({
      name: v.name,
      text: v.text,
    }));
  }
  return data;
}

export function creatureExtractionsToRecords(
  creatures: readonly CreatureExtraction[],
): RulesRecord[] {
  const out: RulesRecord[] = creatures.map((creature) => {
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'creature',
      key: creatureKey(creature.name),
      name: creature.name,
      data: buildCreatureData(creature),
      source: sourceLabelFor(creature.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(creature.sourcePage),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

/**
 * Build the `data` payload for one inline stat-block record. Field insertion
 * order is fixed for byte-stable JSON and matches `validateDnd5eStatBlock`. Hit
 * points ride the permissive `{ value?, formula?, special? }` shape and the
 * challenge rating is omitted entirely when the source block has none, so the
 * strict creature schema (integer HP, required CR) is never relaxed (eshyra-4a7.4).
 */
function buildStatBlockData(
  statBlock: StatBlockExtraction,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  data.size = statBlock.size;
  data.type = statBlock.type;
  data.alignment = statBlock.alignment;
  data.armorClass = statBlock.armorClass;
  const hp: Record<string, unknown> = {};
  if (statBlock.hitPoints.value !== undefined)
    hp.value = statBlock.hitPoints.value;
  if (statBlock.hitPoints.formula !== undefined)
    hp.formula = statBlock.hitPoints.formula;
  if (statBlock.hitPoints.special !== undefined)
    hp.special = statBlock.hitPoints.special;
  data.hitPoints = hp;
  data.speed = { ...statBlock.speed };
  data.abilityScores = {
    strength: statBlock.abilityScores.strength,
    dexterity: statBlock.abilityScores.dexterity,
    constitution: statBlock.abilityScores.constitution,
    intelligence: statBlock.abilityScores.intelligence,
    wisdom: statBlock.abilityScores.wisdom,
    charisma: statBlock.abilityScores.charisma,
  };
  // Keyed trailing fields in stat-block print order; each emitted only when the
  // source block carries it (eshyra-4a7.4).
  if (statBlock.savingThrows !== undefined)
    data.savingThrows = statBlock.savingThrows;
  if (statBlock.skills !== undefined) data.skills = statBlock.skills;
  if (statBlock.damageVulnerabilities !== undefined)
    data.damageVulnerabilities = statBlock.damageVulnerabilities;
  if (statBlock.damageResistances !== undefined)
    data.damageResistances = statBlock.damageResistances;
  if (statBlock.damageImmunities !== undefined)
    data.damageImmunities = statBlock.damageImmunities;
  if (statBlock.conditionImmunities !== undefined)
    data.conditionImmunities = statBlock.conditionImmunities;
  if (statBlock.senses !== undefined) data.senses = statBlock.senses;
  if (statBlock.languages !== undefined) data.languages = statBlock.languages;
  if (statBlock.challengeRating !== undefined)
    data.challengeRating = statBlock.challengeRating;
  if (statBlock.experiencePoints !== undefined)
    data.experiencePoints = statBlock.experiencePoints;
  if (statBlock.traits !== undefined) {
    data.traits = statBlock.traits.map((entry) => ({
      name: entry.name,
      text: entry.text,
    }));
  }
  if (statBlock.actions !== undefined) {
    data.actions = statBlock.actions.map((entry) => ({
      name: entry.name,
      text: entry.text,
    }));
  }
  data.inlineSource = {
    containingItem: statBlock.containingItem,
    page: statBlock.sourcePage,
  };
  return data;
}

export function statBlockExtractionsToRecords(
  statBlocks: readonly StatBlockExtraction[],
): RulesRecord[] {
  const out: RulesRecord[] = statBlocks.map((statBlock) => {
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'stat-block',
      key: statBlockKey(statBlock.name),
      name: statBlock.name,
      data: buildStatBlockData(statBlock),
      source: sourceLabelFor(statBlock.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(statBlock.sourcePage),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

/**
 * Build the `data` payload for one base-class record. Field insertion order is
 * fixed (so emitted JSON is byte-stable) and matches the `dnd5e-srd` class
 * kindSchema's required keys; see `validateDnd5eClass` in `kindSchemas.ts`.
 */
function buildClassData(
  cls: ClassExtraction,
  primaryAbilities: readonly string[],
): Record<string, unknown> {
  return {
    hitDie: cls.hitDie,
    primaryAbilities: [...primaryAbilities],
    savingThrowProficiencies: [...cls.savingThrowProficiencies],
    armorProficiencies: [...cls.armorProficiencies],
    weaponProficiencies: [...cls.weaponProficiencies],
    // Options modeling (eshyra-4a7.6); each omitted when the source line was
    // absent. Structured `progression`/`progressionTableRef`/`features` are
    // added later by enrichClassChapterRecords (they need the table + feature
    // records).
    ...(cls.toolProficiencies !== undefined
      ? { toolProficiencies: [...cls.toolProficiencies] }
      : {}),
    ...(cls.toolProficiencyChoices !== undefined
      ? {
          toolProficiencyChoices: cls.toolProficiencyChoices.map((c) => ({
            ...c,
          })),
        }
      : {}),
    ...(cls.skillChoices !== undefined
      ? { skillChoices: cls.skillChoices.map((c) => ({ ...c })) }
      : {}),
    ...(cls.startingEquipment !== undefined
      ? { startingEquipment: { ...cls.startingEquipment } }
      : {}),
    ...(cls.proficiencyNotes !== undefined
      ? { proficiencyNotes: cls.proficiencyNotes.map((n) => ({ ...n })) }
      : {}),
  };
}

export function classExtractionsToRecords(
  classes: readonly ClassExtraction[],
  primaryAbilityIndex?: ClassPrimaryAbilityIndex,
): RulesRecord[] {
  const out: RulesRecord[] = classes.map((cls) => {
    // The SRD Class Features block carries no primary-ability line, so the
    // extraction's `primaryAbilities` is normally empty and the canonical
    // source is the Multiclassing prerequisites map (loreweaver-0m9.5.19). A
    // value the block DID carry (a variant/homebrew layout) is more specific
    // and wins; otherwise the prerequisites map fills it; otherwise it stays
    // empty (ADR 0007 — never authored from model knowledge).
    const primaryAbilities =
      cls.primaryAbilities.length > 0
        ? cls.primaryAbilities
        : (primaryAbilityIndex?.get(cls.name) ?? []);
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'class',
      key: classKey(cls.name),
      name: cls.name,
      data: buildClassData(cls, primaryAbilities),
      source: sourceLabelFor(cls.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(cls.sourcePage),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

/**
 * Build the `data` payload for one subclass record. `parentClass` is keyed to
 * the parent `class:<slug>` record (ADR 0009 data-side linkage, never
 * `overrides`). Field insertion order is fixed for byte-stable output. The
 * optional granted-`features` reference array is populated by the feature
 * parser (loreweaver-0m9.5.18), not here.
 */
function buildSubclassData(sub: SubclassExtraction): Record<string, unknown> {
  return {
    parentClass: classKey(sub.parentClass),
    description: sub.description,
    ...(sub.sections && sub.sections.length > 0
      ? { sections: sub.sections.map((s) => ({ name: s.name, text: s.text })) }
      : {}),
  };
}

export function subclassExtractionsToRecords(
  subclasses: readonly SubclassExtraction[],
): RulesRecord[] {
  const out: RulesRecord[] = subclasses.map((sub) => {
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'subclass',
      key: subclassKey(sub.name),
      name: sub.name,
      data: buildSubclassData(sub),
      source: sourceLabelFor(sub.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(sub.sourcePage),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

/**
 * Build the `data` payload for one feature record. `source` is keyed to the
 * granting class (`class:<slug>`) or subclass (`subclass:<slug>`) record (ADR
 * 0009 data-side linkage, never `overrides`). Field insertion order is fixed
 * for byte-stable output and matches the `dnd5e-srd` feature kindSchema
 * (`validateDnd5eFeature`: source, level, description, optional choices).
 */
function buildFeatureData(feature: FeatureExtraction): Record<string, unknown> {
  const source =
    feature.grantorKind === 'class'
      ? classKey(feature.grantorName)
      : subclassKey(feature.grantorName);
  return {
    source,
    level: feature.level,
    description: feature.description,
    // Structured player choices (eshyra-o9bd.9). Absent until a derivation pass
    // populates `feature.choices`; only emitted when present so the committed
    // pack stays byte-stable for features without modeled choices.
    ...(feature.choices !== undefined
      ? { choices: feature.choices.map((c) => ({ ...c })) }
      : {}),
  };
}

export function featureExtractionsToRecords(
  features: readonly FeatureExtraction[],
): RulesRecord[] {
  const out: RulesRecord[] = features.map((feature) => {
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'feature',
      key: `feature:${slug(feature.grantorName)}:${slug(feature.name)}`,
      name: feature.name,
      data: buildFeatureData(feature),
      source: sourceLabelFor(feature.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(feature.sourcePage),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

export function conditionExtractionsToRecords(
  conditions: readonly ConditionExtraction[],
): RulesRecord[] {
  const out: RulesRecord[] = conditions.map((condition) => {
    const data: Record<string, unknown> = {
      description: condition.description,
    };
    if (condition.effects.length > 0) {
      data.effects = [...condition.effects];
    }
    if (condition.levels !== undefined && condition.levels.length > 0) {
      data.levels = condition.levels.map((l) => ({
        level: l.level,
        effect: l.effect,
      }));
    }
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'condition',
      key: conditionKey(condition.name),
      name: condition.name,
      data,
      source: sourceLabelFor(condition.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(condition.sourcePage),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

export function featExtractionsToRecords(
  feats: readonly FeatExtraction[],
): RulesRecord[] {
  const out: RulesRecord[] = feats.map((feat) => {
    const data: Record<string, unknown> = {
      description: feat.description,
    };
    if (feat.prerequisites !== undefined) {
      data.prerequisites = feat.prerequisites;
    }
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'feat',
      key: featKey(feat.name),
      name: feat.name,
      data,
      source: sourceLabelFor(feat.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(feat.sourcePage),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

export function hazardExtractionsToRecords(
  hazards: readonly HazardExtraction[],
): RulesRecord[] {
  const out: RulesRecord[] = hazards.map((hazard) => {
    const data: Record<string, unknown> = {
      description: hazard.description,
    };
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'hazard',
      key: hazardKey(hazard.name),
      name: hazard.name,
      data,
      source: sourceLabelFor(hazard.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(hazard.sourcePage),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

/**
 * Sample traps emit under the `hazard` record kind (loreweaver-hvp). Schema
 * fit: the SRD's "Traps" section sits in the gamemastering chapter alongside
 * Diseases/Madness/Poisons, and a trap is — like an environmental hazard — a
 * description-only danger, so it satisfies the same `hazard` kindSchema
 * (`validateDnd5eHazard` requires only `description`). The `trapType`
 * discriminator ("mechanical" | "magic") preserves the SRD subtitle and marks
 * the record as a trap. A dedicated `trap` record kind was considered and
 * rejected: it would force changes across the exhaustive
 * `Record<RulesRecordKind, …>` validators and stack indexes for no schema
 * benefit. Keyed `hazard:<slug>`; the SRD 5.1 environmental-hazard set is empty
 * (see `parseHazards`), so there is no key collision.
 */
export function trapExtractionsToRecords(
  traps: readonly TrapExtraction[],
): RulesRecord[] {
  const out: RulesRecord[] = traps.map((trap) => {
    const data: Record<string, unknown> = {
      trapType: trap.trapType,
      description: trap.description,
    };
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'hazard',
      key: hazardKey(trap.name),
      name: trap.name,
      data,
      source: sourceLabelFor(trap.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(trap.sourcePage),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

/**
 * Sample diseases emit under the `hazard` record kind with a
 * `data.category: 'disease'` discriminator (loreweaver-6ra). Schema fit: like a
 * trap, a disease is a description-only danger with a save DC and effects, so it
 * satisfies the same `hazard` kindSchema (`validateDnd5eHazard` requires only
 * `description`). A dedicated `disease` kind was rejected for the same reason
 * traps reuse `hazard` — it would force changes across every exhaustive
 * `Record<RulesRecordKind, …>` validator and stack index for no schema benefit
 * (see Note B in the SRD section-coverage audit). `category` (absent on traps,
 * which the `trapType` discriminator already marks) lets callers tell the three
 * gamemastering hazard sub-families apart. Keyed `hazard:<slug>`; no SRD 5.1
 * disease name collides with a trap or environmental-hazard name.
 */
export function diseaseExtractionsToRecords(
  diseases: readonly DiseaseExtraction[],
): RulesRecord[] {
  const out: RulesRecord[] = diseases.map((disease) => {
    const data: Record<string, unknown> = {
      category: 'disease',
      description: disease.description,
    };
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'hazard',
      key: hazardKey(disease.name),
      name: disease.name,
      data,
      source: sourceLabelFor(disease.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(disease.sourcePage),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

/**
 * Sample poisons emit under the `hazard` record kind with a
 * `data.category: 'poison'` discriminator (loreweaver-6ra), alongside the
 * structured `poisonType` (delivery method) and `price` (per dose) fields. Same
 * schema-fit rationale as diseases/traps: a poison is a description-only danger
 * with a save DC and effects. Field insertion order is fixed for byte-stable
 * output; `price` is omitted when the entry has no matching reference-table row.
 * Keyed `hazard:<slug>`; no SRD 5.1 poison name collides with a trap, disease,
 * or environmental-hazard name.
 */
export function poisonExtractionsToRecords(
  poisons: readonly PoisonExtraction[],
): RulesRecord[] {
  const out: RulesRecord[] = poisons.map((poison) => {
    const data: Record<string, unknown> = {
      category: 'poison',
      poisonType: poison.poisonType,
    };
    if (poison.price !== undefined) {
      data.price = poison.price;
    }
    data.description = poison.description;
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'hazard',
      key: hazardKey(poison.name),
      name: poison.name,
      data,
      source: sourceLabelFor(poison.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(poison.sourcePage),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

export function ruleExtractionsToRecords(
  rules: readonly RuleExtraction[],
): RulesRecord[] {
  const out: RulesRecord[] = rules.map((rule) => {
    const data: Record<string, unknown> = {
      text: rule.text,
    };
    if (rule.tableRefs !== undefined) {
      data.tableRefs = [...rule.tableRefs];
    }
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'rule',
      key:
        rule.keySlug === undefined
          ? ruleKey(rule.name)
          : `rule:${rule.keySlug}`,
      name: rule.name,
      data,
      source: sourceLabelFor(rule.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(rule.sourcePage),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

export function actionExtractionsToRecords(
  actions: readonly ActionExtraction[],
): RulesRecord[] {
  const out: RulesRecord[] = actions.map((action) => {
    const data: Record<string, unknown> = {
      description: action.description,
    };
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'action',
      key: actionKey(action.name),
      name: action.name,
      data,
      source: sourceLabelFor(action.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(action.sourcePage),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

export function tableExtractionsToRecords(
  tables: readonly TableExtraction[],
): RulesRecord[] {
  const out: RulesRecord[] = tables.map((table) => {
    const data: Record<string, unknown> = {
      columns: [...table.columns],
      rows: table.rows.map((row) => [...row]),
    };
    if (table.projection !== undefined) {
      data.projection = table.projection;
    }
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'table',
      key: tableKey(table.name),
      name: table.name,
      data,
      source: sourceLabelFor(table.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(table.sourcePage),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

/**
 * Build the `data` payload for one equipment record. Field insertion order is
 * fixed (so emitted JSON is byte-stable) and category-specific fields are
 * present only for the matching `category`. The record validates against the
 * `equipment` baseline kindSchema (a non-null `data` object); see
 * `kindSchemas.ts`.
 */
function buildEquipmentData(
  item: EquipmentExtraction,
): Record<string, unknown> {
  const data: Record<string, unknown> = { category: item.category };
  if (item.cost !== undefined) {
    data.cost = item.cost;
  }
  if (item.category === 'weapon') {
    if (item.damageDie !== undefined) {
      data.damageDie = item.damageDie;
    }
    if (item.damageType !== undefined) {
      data.damageType = item.damageType;
    }
    data.properties = [...(item.properties ?? [])];
  }
  if (item.category === 'armor') {
    if (item.ac !== undefined) {
      data.ac = item.ac;
    }
    if (item.armorType !== undefined) {
      data.armorType = item.armorType;
    }
    data.stealthDisadvantage = item.stealthDisadvantage ?? false;
    if (item.strengthRequirement !== undefined) {
      data.strengthRequirement = item.strengthRequirement;
    }
  }
  // Mounts (cost/speed/carrying-capacity) and waterborne vehicles (cost/speed)
  // carry a verbatim `speed` cell; mounts additionally carry `carryingCapacity`.
  if (item.category === 'mount' || item.category === 'vehicle') {
    if (item.speed !== undefined) {
      data.speed = item.speed;
    }
    if (item.carryingCapacity !== undefined) {
      data.carryingCapacity = item.carryingCapacity;
    }
  }
  if (item.weight !== undefined) {
    data.weight = item.weight;
  }
  // Container Capacity, attached verbatim to the matching gear record.
  if (item.capacity !== undefined) {
    data.capacity = item.capacity;
  }
  if (item.description !== undefined) {
    data.description = item.description;
  }
  return data;
}

export function equipmentExtractionsToRecords(
  equipment: readonly EquipmentExtraction[],
): RulesRecord[] {
  const out: RulesRecord[] = equipment.map((item) => {
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'equipment',
      key: equipmentKey(item.name),
      name: item.name,
      data: buildEquipmentData(item),
      source: equipmentSourceLabel(item),
      license: SRD_5_1_LICENSE,
      provenance: equipmentProvenance(item),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

function buildMagicItemData(
  item: MagicItemExtraction,
  statBlockRefs: readonly string[] | undefined,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    itemType: item.itemType,
    rarity: item.rarity,
    requiresAttunement: item.requiresAttunement,
  };
  if (item.attunementRequirement !== undefined) {
    data.attunementRequirement = item.attunementRequirement;
  }
  data.description = item.description;
  if (item.variants !== undefined && item.variants.length > 0) {
    data.variants = item.variants.map((variant) => ({
      name: variant.name,
      rarity: variant.rarity,
      text: variant.text,
    }));
  }
  // An item that defines an inline stat block (Deck of Many Things -> Avatar of
  // Death) points at the emitted `stat-block` record(s) via `statBlockRefs`
  // (eshyra-4a7.4). Sorted for byte-stable JSON.
  if (statBlockRefs !== undefined && statBlockRefs.length > 0) {
    data.statBlockRefs = [...statBlockRefs].sort();
  }
  return data;
}

/**
 * @param statBlockRefsByItemName Map from a magic-item NAME to the stat-block
 * record keys it references. Items absent from the map emit no `statBlockRefs`.
 */
export function magicItemExtractionsToRecords(
  magicItems: readonly MagicItemExtraction[],
  statBlockRefsByItemName: ReadonlyMap<string, readonly string[]> = new Map(),
): RulesRecord[] {
  const out: RulesRecord[] = magicItems.map((item) => {
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'magic-item',
      key: magicItemKey(item.name),
      name: item.name,
      data: buildMagicItemData(item, statBlockRefsByItemName.get(item.name)),
      source: sourceLabelFor(item.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(item.sourcePage),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

export function ancestryExtractionsToRecords(
  ancestries: readonly AncestryExtraction[],
): RulesRecord[] {
  const out: RulesRecord[] = ancestries.map((ancestry) => {
    // `source: 'race'` preserves the SRD 5.1 source term while the record kind
    // is the canonical 'ancestry' (ADR 0005). Field order is literal for
    // byte-stable output.
    const data: Record<string, unknown> = {
      source: 'race',
      description: ancestry.description,
    };
    if (ancestry.size !== undefined) {
      data.size = ancestry.size;
    }
    if (ancestry.speed !== undefined) {
      data.speed = ancestry.speed;
    }
    data.traits = ancestry.traits.map((t) => ({ name: t.name, text: t.text }));
    if (ancestry.subraceOf !== undefined) {
      data.subraceOf = ancestryKey(ancestry.subraceOf);
    }
    if (ancestry.subraces !== undefined && ancestry.subraces.length > 0) {
      data.subraces = ancestry.subraces.map((name) => ancestryKey(name));
    }
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'ancestry',
      key: ancestryKey(ancestry.name),
      name: ancestry.name,
      data,
      source: sourceLabelFor(ancestry.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(ancestry.sourcePage),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

function backgroundKey(name: string): string {
  return `background:${slug(name)}`;
}

/**
 * Build the `data` payload for one background record (eshyra-0m9.17). Field
 * insertion order is fixed (so emitted JSON is byte-stable) and matches the
 * `dnd5e-srd` background kindSchema (`validateDnd5eBackground`): description,
 * skillProficiencies, and the nested feature are required; toolProficiencies,
 * languages, equipment, and suggestedCharacteristics are present only when the
 * background grants them. The feature is a NESTED `{ name, text }` field, not
 * a top-level `feature` record — `validateDnd5eFeature` requires a
 * class/subclass grantor and grant level a background feature does not have.
 */
function buildBackgroundData(
  background: BackgroundExtraction,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    description: background.description,
    skillProficiencies: [...background.skillProficiencies],
  };
  if (background.toolProficiencies !== undefined) {
    data.toolProficiencies = [...background.toolProficiencies];
  }
  if (background.languages !== undefined) {
    data.languages = background.languages;
  }
  if (background.equipment !== undefined) {
    data.equipment = background.equipment;
  }
  data.feature = {
    name: background.feature.name,
    text: background.feature.text,
  };
  if (background.suggestedCharacteristics !== undefined) {
    data.suggestedCharacteristics = background.suggestedCharacteristics;
  }
  return data;
}

export function backgroundExtractionsToRecords(
  backgrounds: readonly BackgroundExtraction[],
): RulesRecord[] {
  const out: RulesRecord[] = backgrounds.map((background) => {
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'background',
      key: backgroundKey(background.name),
      name: background.name,
      data: buildBackgroundData(background),
      source: sourceLabelFor(background.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(background.sourcePage),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

export interface BuildPackInput {
  readonly spells: readonly SpellExtraction[];
  readonly classIndex: SpellClassIndex;
  /**
   * Validated spell-name -> class memberships produced by applyClassLists.
   * The importer supplies this normalized map; classIndex remains for focused
   * buildPack fixtures and callers that already provide exact-name keys.
   */
  readonly spellClasses?: ReadonlyMap<string, readonly SpellCasterClass[]>;
  /**
   * Per-class primary abilities read from the Multiclassing prerequisites
   * listing (loreweaver-0m9.5.19). Optional: absent/empty when the Multiclassing
   * section was not found, in which case class `primaryAbilities` stay empty.
   */
  readonly primaryAbilityIndex?: ClassPrimaryAbilityIndex;
  readonly creatures?: readonly CreatureExtraction[];
  /**
   * Abbreviated inline stat blocks (Avatar of Death, Giant Fly; eshyra-4a7.4).
   * Emitted under the `stat-block` kind; their containing magic items gain a
   * `data.statBlockRefs` pointer when that item is itself emitted.
   */
  readonly statBlocks?: readonly StatBlockExtraction[];
  readonly classes?: readonly ClassExtraction[];
  readonly subclasses?: readonly SubclassExtraction[];
  readonly features?: readonly FeatureExtraction[];
  readonly conditions: readonly ConditionExtraction[];
  readonly feats?: readonly FeatExtraction[];
  readonly hazards?: readonly HazardExtraction[];
  readonly traps?: readonly TrapExtraction[];
  readonly diseases?: readonly DiseaseExtraction[];
  readonly poisons?: readonly PoisonExtraction[];
  readonly actions?: readonly ActionExtraction[];
  readonly rules?: readonly RuleExtraction[];
  readonly tables?: readonly TableExtraction[];
  readonly equipment?: readonly EquipmentExtraction[];
  readonly magicItems?: readonly MagicItemExtraction[];
  readonly ancestries?: readonly AncestryExtraction[];
  readonly backgrounds?: readonly BackgroundExtraction[];
  readonly sourceHash: string;
}

export function buildPack(input: BuildPackInput): RulesPack {
  const classByName =
    input.spellClasses ??
    new Map(
      input.spells.map((spell) => {
        const bucket = input.classIndex.get(spell.name);
        return [
          spell.name,
          bucket
            ? [...bucket].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
            : [],
        ];
      }),
    );
  const baseSpellRecords = spellExtractionsToRecords(input.spells, classByName);
  const creatureRecords = creatureExtractionsToRecords(input.creatures ?? []);
  const classRecords = classExtractionsToRecords(
    input.classes ?? [],
    input.primaryAbilityIndex,
  );
  const subclassRecords = subclassExtractionsToRecords(input.subclasses ?? []);
  const featureRecords = featureExtractionsToRecords(input.features ?? []);
  const conditionRecords = conditionExtractionsToRecords(input.conditions);
  const featRecords = featExtractionsToRecords(input.feats ?? []);
  // Environmental hazards (empty for SRD 5.1), sample traps (loreweaver-hvp),
  // and the gamemastering diseases + poisons (loreweaver-6ra) all emit under the
  // `hazard` kind; concatenate before the shared sort. Traps carry a `trapType`
  // discriminator; diseases and poisons carry `data.category` ('disease' /
  // 'poison').
  const hazardRecords = [
    ...hazardExtractionsToRecords(input.hazards ?? []),
    ...trapExtractionsToRecords(input.traps ?? []),
    ...diseaseExtractionsToRecords(input.diseases ?? []),
    ...poisonExtractionsToRecords(input.poisons ?? []),
  ];
  const actionRecords = actionExtractionsToRecords(input.actions ?? []);
  const ruleRecords = ruleExtractionsToRecords(input.rules ?? []);
  const tableRecords = tableExtractionsToRecords(input.tables ?? []);
  const spellRecords = linkSpellEmbeddedTables({
    spellRecords: baseSpellRecords,
    tableRecords,
    tables: input.tables ?? [],
  });
  const equipmentRecords = equipmentExtractionsToRecords(input.equipment ?? []);
  // Inline stat blocks (eshyra-4a7.4) and the containing magic-item reference
  // map. Both reviewed containers are emitted and link to their embedded block.
  const statBlockRecords = statBlockExtractionsToRecords(
    input.statBlocks ?? [],
  );
  const statBlockRefsByItemName = new Map<string, string[]>();
  for (const statBlock of input.statBlocks ?? []) {
    const list = statBlockRefsByItemName.get(statBlock.containingItem) ?? [];
    list.push(statBlockKey(statBlock.name));
    statBlockRefsByItemName.set(statBlock.containingItem, list);
  }
  const magicItemRecords = magicItemExtractionsToRecords(
    input.magicItems ?? [],
    statBlockRefsByItemName,
  );
  // Link ancestry option tables (eshyra-4a7.7): add `tableRefs` on any ancestry
  // trait whose prose names "the <Name> table" (the Dragonborn Draconic
  // Ancestry table) to the emitted `table` record on the same SRD page, so the
  // option rows are reachable as structured data rather than prose-only.
  const ancestryRecords = enrichAncestryCreationFacts(
    linkAncestryOptionTables(
      ancestryExtractionsToRecords(input.ancestries ?? []),
      tableRecords,
    ),
  );
  const backgroundRecords = enrichBackgroundCreationFacts(
    backgroundExtractionsToRecords(input.backgrounds ?? []),
  );
  // Enrich the class-chapter records with structured progression and the
  // class/subclass/feature cross-references (eshyra-4a7.6). Derived from the
  // parsed table extractions and feature records, after all four are built.
  const enriched = enrichClassChapterRecords({
    classRecords,
    subclassRecords,
    featureRecords,
    tables: input.tables ?? [],
  });
  // Attach structured player choices (subclass selection, Fighting Style,
  // Metamagic, ASI-vs-feat, …) to the feature records they hang off
  // (eshyra-o9bd.9). Runs after enrichment so the class progression graph and
  // subclass links the derivers read are already present.
  const featureRecordsWithChoices = deriveFeatureChoices({
    classRecords: enriched.classRecords,
    subclassRecords: enriched.subclassRecords,
    featureRecords: enriched.featureRecords,
  });
  // Remove embedded-table linearizations the prose joiners absorbed into owner
  // descriptions/text, leaving the structured `table:*` records as the sole
  // representation (eshyra-3anh). The assertion fails the build closed if any
  // captured table span still appears in prose.
  const stripped = stripEmbeddedTableProse({
    records: [
      ...spellRecords,
      ...creatureRecords,
      ...enriched.classRecords,
      ...enriched.subclassRecords,
      ...featureRecordsWithChoices,
      ...conditionRecords,
      ...featRecords,
      ...hazardRecords,
      ...actionRecords,
      ...ruleRecords,
      ...tableRecords,
      ...equipmentRecords,
      ...magicItemRecords,
      ...statBlockRecords,
      ...ancestryRecords,
      ...backgroundRecords,
    ],
    tables: input.tables ?? [],
  });
  assertNoEmbeddedTableLinearization({
    records: stripped,
    tables: input.tables ?? [],
  });
  // Link owner records (magic items, economy/reference rules) to the `table`
  // records that belong to their entry (eshyra-o9bd.8). Adds `data.tableRefs`
  // only; the de-flattened prose above is untouched.
  const linked = linkOwnedTables(stripped);
  const records = linked.sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  const includedKinds = uniqueKindsOf(records);
  const pack: RulesPack = {
    meta: buildMeta(input.sourceHash, includedKinds),
    records,
  };
  // Throws on schema / provenance / structural error.
  return validateRulesPack(pack);
}

function uniqueKindsOf(records: readonly RulesRecord[]): readonly string[] {
  const set = new Set<string>();
  for (const r of records) set.add(r.kind);
  return [...set].sort();
}

/** Stable JSON serialization: 2-space indent, trailing newline. */
function stringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export interface WritePackOptions {
  readonly outDir: string;
}

export function writePackToDirectory(
  pack: RulesPack,
  options: WritePackOptions,
): void {
  mkdirSync(options.outDir, { recursive: true });
  writeFileSync(
    join(options.outDir, 'manifest.json'),
    stringify(pack.meta),
    'utf8',
  );
  writeFileSync(
    join(options.outDir, 'records.json'),
    stringify(pack.records),
    'utf8',
  );
}

/** File names of the source-coverage artifacts written next to the pack. */
export const SOURCE_INVENTORY_FILE = 'source-inventory.json';
export const SOURCE_COVERAGE_FILE = 'source-coverage.json';
export const SOURCE_REGION_LEDGER_FILE = 'source-region-ledger.json';

/**
 * Write the source-structure inventory and its coverage report next to the
 * pack files (eshyra-4a7.1). These are review artifacts, not pack data:
 * `loadRulesPackFromDirectory` reads only `manifest.json` + `records.json`
 * by name and tolerates extra files in the directory. Same stable JSON
 * serialization as the pack files so regeneration is byte-stable.
 */
export function writeSourceCoverageArtifacts(
  inventory: readonly SourceInventoryItem[],
  report: SourceCoverageReport,
  regionLedger: SourceRegionLedger | undefined,
  options: WritePackOptions,
): void {
  mkdirSync(options.outDir, { recursive: true });
  writeFileSync(
    join(options.outDir, SOURCE_INVENTORY_FILE),
    stringify(inventory),
    'utf8',
  );
  writeFileSync(
    join(options.outDir, SOURCE_COVERAGE_FILE),
    stringify(report),
    'utf8',
  );
  if (regionLedger !== undefined) {
    writeFileSync(
      join(options.outDir, SOURCE_REGION_LEDGER_FILE),
      stringify(regionLedger),
      'utf8',
    );
  }
}
