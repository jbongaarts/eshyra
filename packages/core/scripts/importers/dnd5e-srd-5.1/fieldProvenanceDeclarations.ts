/**
 * Field-level provenance declarations for the D&D 5e SRD 5.1 rules pack
 * (eshyra-o9bd.19.1.3.1).
 *
 * This is a curated compiler INPUT (ADR 0017 §3), not generated output: a
 * human-reviewed classification of the importer's own emitted field shapes,
 * derived by reading the parsers that build them (`parseCreatures.ts`,
 * `parseSpells.ts`, `kindSchemas.ts`'s per-kind validators, ...) against the
 * three classes defined in `../../../src/rules/fieldProvenance.ts`. It feeds
 * `buildPack` (see `emit.ts`), which runs `assertFieldProvenanceCoverage`
 * over the FINAL emitted records before writing anything — the fail-closed
 * gate that closes the semantic class this bead exists for. This file is
 * checked deterministically (schema, no dup `(kind, pointerPrefix)` pairs)
 * by `buildFieldProvenanceManifest`; it is never hand-applied to
 * `records.json`.
 *
 * ## How to read a declaration
 *
 * Each entry classifies every leaf under `pointerPrefix` (an array index
 * collapses to the literal segment `*`) within one record `kind`'s `data`,
 * unless a MORE SPECIFIC (deeper) declaration for the same kind overrides a
 * sub-path — see `classifyFieldPointer`'s longest-prefix-wins rule. That is
 * what lets one entry classify a whole structured statline
 * `source-derived` while a second, deeper entry carves out its one verbatim
 * companion field as `source-prose` (the recurring `armorClass.value`
 * vs. `armorClass.sourceText` shape named in this bead's evidence set).
 *
 * ## Recurring shapes, factored into helpers
 *
 * A handful of shapes repeat across many kinds and are factored into small
 * builder functions below rather than repeated by hand:
 *
 * - `mechanicsSubtree` / `PROJECTION_FIELD_NAMES` — `mechanics`, `upcast`,
 *   `executionReadiness`, `useProfile`, and a table's `projection` are
 *   ALWAYS `compiler-projection`, whole subtree, wherever they occur
 *   (top-level on a record, or nested under an entry array such as
 *   `actions/*\/mechanics`). This includes any literal-looking audit string
 *   nested inside one (`upcast.sourceCorrection.extractedSourcePhrase`): it
 *   is lineage evidence on a compiler artifact, not a standalone quotable
 *   field — see the "three classes" doc comment in `fieldProvenance.ts` for
 *   why splitting it out per-leaf would just reintroduce the container-shape
 *   heuristic this bead replaces.
 * - `namedEntry` — the recurring `{ name, text, mechanics? }` narrative
 *   entry (a creature's trait/action/reaction, an ancestry trait, a
 *   subclass section, a `Variant:` sidebar, ...): `name` and `text` are the
 *   bold lead-in label and body PRINTED verbatim by the source, so both are
 *   `source-prose`; `mechanics`, where the entry has one, is
 *   `compiler-projection` via `mechanicsSubtree`.
 * - `sourceTextCompanion` — a structured object that carries one sibling
 *   field literally named `sourceText` holding the verbatim printed clause
 *   alongside OTHER fields that are the parser's structured extraction from
 *   it (e.g. `armorClass.value`/`armorClass.source` vs.
 *   `armorClass.sourceText`; `speed.walk` vs. `speedSourceText`). The
 *   `sourceText` sibling is `source-prose`; the rest of the object defaults
 *   `source-derived` unless a narrower override says otherwise.
 *
 * ## One documented exception: NOT every `sourceText` field is verbatim
 *
 * `kindSchemas.ts`'s `optCreationChoices` doc comment is explicit:
 * `choices[].sourceText` on an `ancestry`/`background` creation choice "is a
 * source-cited display label, NOT GUARANTEED VERBATIM SRD PROSE" — for the
 * four rolled-table categories (`personalityTrait`/`ideal`/`bond`/`flaw`) it
 * is a compiler-CONSTRUCTED "<table name> (<die>)." pointer, because the SRD
 * prose there is the separate linked `table` record, not this field. A
 * field-NAME heuristic ("anything called `sourceText` is verbatim") would be
 * a THIRD shape-based heuristic of exactly the kind that failed twice
 * already (eshyra-o9bd.19.1.3.1's own motivation) — it would mislabel this
 * one field `source-prose` and let a compiler-constructed label be presented
 * as verbatim source authority. Per the record's own documentation this
 * field is truthful and attributable but not verbatim, which is the
 * definition of `source-derived` — so `ancestry`/`background`
 * `choices/*\/sourceText` is declared `source-derived` below, NOT via the
 * `sourceTextCompanion` helper's usual `source-prose` default. See E-notes
 * in the owning bead's completion report for why this one resisted a
 * uniform rule.
 */

import type {
  FieldProvenanceClass,
  FieldProvenanceDeclaration,
} from '../../../src/rules/fieldProvenance.js';
import type { RulesRecordKind } from '../../../src/rules/types.js';

const decls: FieldProvenanceDeclaration[] = [];

function add(
  kind: RulesRecordKind,
  pointerPrefix: string,
  cls: FieldProvenanceClass,
  reason: string,
): void {
  decls.push({ kind, pointerPrefix, class: cls, reason });
}

function prose(
  kind: RulesRecordKind,
  pointerPrefix: string,
  reason: string,
): void {
  add(kind, pointerPrefix, 'source-prose', reason);
}

function derived(
  kind: RulesRecordKind,
  pointerPrefix: string,
  reason: string,
): void {
  add(kind, pointerPrefix, 'source-derived', reason);
}

function projection(
  kind: RulesRecordKind,
  pointerPrefix: string,
  reason: string,
): void {
  add(kind, pointerPrefix, 'compiler-projection', reason);
}

/**
 * `mechanics` / `upcast` / `executionReadiness` / `useProfile` / a table's
 * `projection` — wherever one of these appears, the whole subtree beneath it
 * is the compiler's typed, interpretive projection of nearby source prose,
 * never itself presented as a verbatim quote. See the module doc comment.
 */
function mechanicsSubtree(
  kind: RulesRecordKind,
  pointerPrefix: string,
  fieldName: string,
): void {
  projection(
    kind,
    pointerPrefix,
    `${fieldName} is the compiler's typed projection of nearby source prose ` +
      '(DECIDED representation: mechanics/upcast/executionReadiness/' +
      'useProfile/projection are always compiler-projection, whole subtree, ' +
      'including any embedded audit-lineage string).',
  );
}

/**
 * A recurring `{ name, text, mechanics? }` narrative entry array (a
 * creature's traits/actions/reactions, an ancestry trait, a subclass
 * section, a magic item's `Variant:` sidebar, ...). `name`/`text` are the
 * source's own bold lead-in label and body; `mechanics`, when the shape
 * carries one, is the compiler's projection of that same text.
 */
function namedEntry(
  kind: RulesRecordKind,
  arrayPrefix: string,
  opts: { readonly mechanics?: boolean } = {},
): void {
  prose(
    kind,
    `${arrayPrefix}/*/name`,
    'literal bold lead-in label printed by the source for this entry',
  );
  prose(
    kind,
    `${arrayPrefix}/*/text`,
    'literal entry body text printed by the source, re-flowed across wrapped lines but not otherwise altered',
  );
  if (opts.mechanics !== false) {
    mechanicsSubtree(
      kind,
      `${arrayPrefix}/*/mechanics`,
      `${arrayPrefix}[].mechanics`,
    );
  }
}

/**
 * A structured object with a sibling `sourceText` leaf holding the verbatim
 * printed clause, next to other fields that are the parser's extraction
 * from it. `sourceText` is `source-prose`; everything else under
 * `objectPrefix` defaults `source-derived` (callers add narrower overrides
 * for any field of their own that is not a plain parsed fact).
 */
function sourceTextCompanion(
  kind: RulesRecordKind,
  objectPrefix: string,
  reason: string,
): void {
  derived(
    kind,
    objectPrefix,
    `${reason} — structured extraction from the source clause.`,
  );
  prose(
    kind,
    `${objectPrefix}/sourceText`,
    `${reason} — sourceText is the source clause reproduced verbatim, kept alongside the structured extraction.`,
  );
}

// ---------------------------------------------------------------------------
// action — the ten standard combat actions (parseActions.ts)
// ---------------------------------------------------------------------------
prose(
  'action',
  '/description',
  "the action's SRD description paragraph, quoted verbatim.",
);
mechanicsSubtree('action', '/mechanics', 'action.mechanics');

// ---------------------------------------------------------------------------
// ancestry — race/subrace (parseAncestries.ts)
// ---------------------------------------------------------------------------
prose(
  'ancestry',
  '/description',
  'the ancestry intro paragraph, quoted verbatim.',
);
derived(
  'ancestry',
  '/abilityScoreIncreases',
  'the fixed/choice ability-score bonus structure, parsed from the printed "Ability Score Increase" line.',
);
prose(
  'ancestry',
  '/abilityScoreIncreases/*/sourceText',
  'the verbatim printed Ability Score Increase clause, kept alongside the parsed fixed/choice structure.',
);
derived(
  'ancestry',
  '/choices',
  'structured creation-choice facts (category/choose/from/tableRef/roll/id).',
);
derived(
  'ancestry',
  '/choices/*/sourceText',
  'a source-cited display LABEL, not guaranteed verbatim SRD prose. `kindSchemas.ts` `optCreationChoices` — the one validator governing BOTH ancestry and background creation choices — documents that for the rolled-table categories this is a compiler-constructed "<table name> (<die>)." pointer rather than a quote. The class is a property of what the SCHEMA permits at this pointer, not of what today\'s few ancestry records happen to hold: a future ancestry choice may use a constructed label at this same already-covered pointer. `source-derived` is the conservative class that stays truthful for both a constructed label and a value that happens to be verbatim, and it never claims verbatim authority for a value the importer composed. The `background` sibling has always been declared this way.',
);
projection(
  'ancestry',
  '/choices/*/prompt',
  'a compiler-authored, human-readable prompt string (see deriveFeatureChoices.ts), never a source quote.',
);
derived(
  'ancestry',
  '/languages',
  'structured language-grant facts (fixed/choose/from), parsed from the printed languages line.',
);
prose(
  'ancestry',
  '/languages/*/sourceText',
  'the verbatim printed languages clause, kept alongside the parsed grant structure.',
);
derived(
  'ancestry',
  '/size',
  'the size category word, extracted from the ancestry header line.',
);
derived(
  'ancestry',
  '/source',
  'a structural field describing where this ancestry sits in the source (page/section), not narrative prose.',
);
derived(
  'ancestry',
  '/speed',
  'the base walking speed, extracted from the ancestry header line.',
);
derived(
  'ancestry',
  '/subraceOf',
  'a record-key reference to the parent ancestry, not source text.',
);
derived(
  'ancestry',
  '/subraces',
  'a list of subrace record-key references, not source text.',
);
namedEntry('ancestry', '/traits');
derived(
  'ancestry',
  '/traits/*/tableRefs',
  "a list of this trait's linked `table:` record-key references, not source text.",
);

// ---------------------------------------------------------------------------
// background — the one committed background (Acolyte) (parseBackgrounds.ts)
// ---------------------------------------------------------------------------
prose(
  'background',
  '/description',
  'the background intro paragraph, quoted verbatim.',
);
derived(
  'background',
  '/skillProficiencies',
  'a list of skill names granted by the background, parsed from the printed proficiencies line.',
);
derived(
  'background',
  '/toolProficiencies',
  'a list of tool names granted by the background, parsed from the printed proficiencies line.',
);
derived(
  'background',
  '/languages',
  'structured language-grant facts, parsed from the printed languages line.',
);
prose(
  'background',
  '/languages/*/sourceText',
  'the verbatim printed languages clause, kept alongside the parsed grant structure.',
);
prose(
  'background',
  '/equipment',
  'the printed starting-equipment paragraph, quoted verbatim (the structured breakdown lives separately in equipmentGrants).',
);
prose(
  'background',
  '/feature/name',
  "the background feature's bold lead-in label, quoted verbatim.",
);
prose(
  'background',
  '/feature/text',
  "the background feature's body text, quoted verbatim.",
);
mechanicsSubtree(
  'background',
  '/feature/mechanics',
  'background.feature.mechanics',
);
prose(
  'background',
  '/suggestedCharacteristics',
  'the intro paragraph pointing at the suggested-characteristics roll tables, quoted verbatim.',
);
derived(
  'background',
  '/tableRefs',
  'a list of linked `table:` record-key references, not source text.',
);
derived(
  'background',
  '/choices',
  'structured creation-choice facts (category/choose/from/tableRef/roll/id).',
);
derived(
  'background',
  '/choices/*/sourceText',
  'source-derived, not source-prose — see the ancestry choices/*/sourceText note above and the module doc comment; the same optCreationChoices shape is shared by ancestry and background.',
);
projection(
  'background',
  '/choices/*/prompt',
  'a compiler-authored, human-readable prompt string, never a source quote.',
);
derived(
  'background',
  '/equipmentGrants',
  'the structured line-item breakdown (name/quantity/ref/detail/select) of the equipment paragraph above.',
);

// ---------------------------------------------------------------------------
// class — base classes (parseClasses.ts / classProgression.ts)
// ---------------------------------------------------------------------------
derived(
  'class',
  '/armorProficiencies',
  'a list of armor-category proficiencies, parsed from the printed proficiencies block.',
);
derived(
  'class',
  '/features',
  "a list of this class's granted `feature:` record-key references, not source text.",
);
derived(
  'class',
  '/hitDie',
  "the class's hit die size, parsed from the printed Hit Points block.",
);
derived(
  'class',
  '/primaryAbilities',
  'a list of primary-ability names, parsed from the Multiclassing prerequisites listing (best-effort enrichment).',
);
derived(
  'class',
  '/proficiencyNotes',
  'structured (field, text) proficiency-restriction notes.',
);
prose(
  'class',
  '/proficiencyNotes/*/text',
  'a proficiency-restriction clause (e.g. the Druid metal-armor restriction) lifted out of the normalized token, quoted verbatim.',
);
derived(
  'class',
  '/progression',
  "the class's level-by-level advancement table, transcribed from the printed class progression table.",
);
derived(
  'class',
  '/progressionTableRef',
  "a `table:` record-key reference to the class's printed progression table, not source text.",
);
derived(
  'class',
  '/savingThrowProficiencies',
  'a list of saving-throw ability names, parsed from the printed proficiencies block.',
);
derived(
  'class',
  '/skillChoices',
  'the structured skill-choice grant (choose/from/any), parsed from the printed proficiencies block.',
);
prose(
  'class',
  '/skillChoices/*/text',
  'the verbatim printed skill-choice clause.',
);
derived(
  'class',
  '/spellPreparation',
  "the class's machine-readable spell-preparation formula, deterministically derived from the class's own spellcasting rules text.",
);
prose(
  'class',
  '/spellPreparation/sourceText',
  'the verbatim printed spell-preparation clause the formula was derived from.',
);
derived(
  'class',
  '/spellcastingAbility',
  "the class's spellcasting ability name, parsed from its spellcasting rules text.",
);
derived(
  'class',
  '/startingEquipment',
  "the class's structured starting-equipment grants, transcribed from the printed Equipment clause.",
);
prose(
  'class',
  '/startingEquipment/text',
  'the printed starting-equipment paragraph, quoted verbatim.',
);
prose(
  'class',
  '/startingEquipment/entries/*/text',
  'a printed starting-equipment line/option, quoted verbatim.',
);
prose(
  'class',
  '/startingEquipment/entries/*/sourceText',
  'the verbatim printed starting-equipment clause for this entry, kept alongside its structured grants.',
);
prose(
  'class',
  '/startingEquipment/entries/*/options/*/text',
  'a printed starting-equipment option line, quoted verbatim.',
);
derived(
  'class',
  '/toolProficiencies',
  'a list of tool names, parsed from the printed proficiencies block.',
);
derived(
  'class',
  '/toolProficiencyChoices',
  'the structured tool-choice grant (choose/from), parsed from the printed proficiencies block.',
);
prose(
  'class',
  '/toolProficiencyChoices/*/text',
  'the verbatim printed tool-choice clause.',
);
derived(
  'class',
  '/weaponProficiencies',
  'a list of weapon-category proficiencies, parsed from the printed proficiencies block.',
);

// ---------------------------------------------------------------------------
// condition — the 15 SRD conditions (parseConditions.ts / conditionMechanics.ts)
// ---------------------------------------------------------------------------
prose(
  'condition',
  '/description',
  "the condition's intro line, quoted verbatim.",
);
prose(
  'condition',
  '/effects',
  'the printed bullet-point effect list, quoted verbatim per bullet.',
);
derived(
  'condition',
  '/levels',
  "the condition's exhaustion-style level table structure (level numbers).",
);
prose(
  'condition',
  '/levels/*/effect',
  'a printed per-level effect line, quoted verbatim.',
);
mechanicsSubtree('condition', '/mechanics', 'condition.mechanics');

// ---------------------------------------------------------------------------
// creature — monsters + Appendix MM-A/MM-B (parseCreatures.ts)
// ---------------------------------------------------------------------------
derived(
  'creature',
  '/abilityScores',
  'the six ability-score numbers, parsed from the printed ability table.',
);
namedEntry('creature', '/actions');
namedEntry('creature', '/reactions');
namedEntry('creature', '/traits');
prose(
  'creature',
  '/legendaryActions/description',
  "the legendary actions section's intro paragraph, quoted verbatim.",
);
namedEntry('creature', '/legendaryActions/entries');
derived(
  'creature',
  '/alignment',
  "the creature's alignment, parsed from the stat-block header line.",
);
sourceTextCompanion('creature', '/armorClass', "the creature's armor class");
derived(
  'creature',
  '/armorClass/variants',
  'conditional/alternate AC entries, parsed from the printed AC line parentheticals.',
);
derived(
  'creature',
  '/category',
  "the 'npc' discriminator (Appendix MM-B) — a classification the importer assigns from which appendix a stat block was parsed under, not printed text; absence means 'monster'.",
);
derived(
  'creature',
  '/challengeRating',
  'the challenge rating, parsed from the printed Challenge line.',
);
derived(
  'creature',
  '/conditionImmunities',
  'the condition-immunity list, parsed from the printed statline label.',
);
derived(
  'creature',
  '/damageImmunities',
  'the damage-immunity list, parsed from the printed statline label.',
);
derived(
  'creature',
  '/damageResistances',
  'the damage-resistance list, parsed from the printed statline label.',
);
derived(
  'creature',
  '/damageVulnerabilities',
  'the damage-vulnerability list, parsed from the printed statline label.',
);
prose(
  'creature',
  '/description',
  'the trailing flavor paragraph printed after the stat block, quoted verbatim (eshyra-76b7).',
);
derived(
  'creature',
  '/experiencePoints',
  "the creature's XP award, computed from its challenge rating via the standard CR-to-XP table.",
);
derived(
  'creature',
  '/familyPath',
  'the heading-only taxonomy path (e.g. ["Dragons","Chromatic Dragons","Black Dragons"]) this creature was grouped under, per the README\'s own "source-derived" terminology (eshyra-4a7.10.2).',
);
derived(
  'creature',
  '/hitPoints',
  "the creature's average hit points and printed dice formula, parsed from the printed Hit Points line.",
);
derived(
  'creature',
  '/hover',
  'the boolean \'hovers\' flag, parsed from the printed "(hover)" annotation on the Speed line.',
);
derived(
  'creature',
  '/languages',
  'the languages list, parsed from the printed statline label.',
);
derived(
  'creature',
  '/savingThrows',
  'the saving-throw proficiency list, parsed from the printed statline label.',
);
derived(
  'creature',
  '/senses',
  'the senses list, parsed from the printed statline label.',
);
derived(
  'creature',
  '/size',
  "the creature's size category, parsed from the stat-block header line.",
);
derived(
  'creature',
  '/skills',
  'the skill proficiency list, parsed from the printed statline label.',
);
derived(
  'creature',
  '/speed',
  'the mode->feet speed map, parsed from the printed Speed line.',
);
prose(
  'creature',
  '/speedSourceText',
  'the printed Speed line, quoted verbatim, kept alongside the parsed speed map.',
);
derived(
  'creature',
  '/speedVariants',
  'conditional/alternate speed entries (e.g. a lycanthrope form), parsed from the printed Speed line parentheticals.',
);
derived(
  'creature',
  '/type',
  "the creature's type (and subtype parenthetical), parsed from the stat-block header line.",
);
namedEntry('creature', '/variants');

// ---------------------------------------------------------------------------
// equipment — armor/weapons/gear/tools (parseEquipment.ts / equipmentMechanics.ts)
// ---------------------------------------------------------------------------
derived(
  'equipment',
  '/ac',
  'a shorthand numeric AC value, parsed from the printed armor table row.',
);
derived(
  'equipment',
  '/armorClass',
  "the item's structured AC formula (base/bonus/dexModifier/dexModifierCap), parsed from the printed armor table row.",
);
derived(
  'equipment',
  '/armorType',
  'the armor category (light/medium/heavy/shield), parsed from the printed armor table.',
);
derived(
  'equipment',
  '/capacity',
  'a container capacity value, parsed from the printed item description.',
);
derived(
  'equipment',
  '/carryingCapacity',
  'a mount/vehicle carrying-capacity value, parsed from the printed item description.',
);
derived(
  'equipment',
  '/category',
  "the item's equipment category, parsed from its printed table section.",
);
derived(
  'equipment',
  '/contents',
  'the structured line-item contents of an equipment pack, parsed from the printed pack description.',
);
derived(
  'equipment',
  '/cost',
  'the item price, parsed from the printed cost column.',
);
derived(
  'equipment',
  '/damageDie',
  'the weapon damage die, parsed from the printed weapon table row.',
);
derived(
  'equipment',
  '/damageType',
  'the weapon damage type, parsed from the printed weapon table row.',
);
prose(
  'equipment',
  '/description',
  "the item's SRD description prose, quoted verbatim.",
);
derived(
  'equipment',
  '/equipmentGroup',
  'the item\'s structural table grouping (e.g. "Armor", "Weapons"), not narrative prose.',
);
derived(
  'equipment',
  '/properties',
  "the list of weapon/armor property words, parsed from the printed table's Properties column.",
);
derived(
  'equipment',
  '/speed',
  'a mount/vehicle speed value, parsed from the printed item description.',
);
derived(
  'equipment',
  '/stealthDisadvantage',
  'the boolean stealth-disadvantage flag, parsed from the printed armor table.',
);
derived(
  'equipment',
  '/strengthRequirement',
  'the minimum-Strength requirement, parsed from the printed armor table.',
);
// `equipment` had no `/mechanics` key at all until PR #545's Foundation-1
// stage (`applyFoundation1ProcedureProjections`) began emitting bounded
// procedure projections onto `equipment:longsword`. The fail-closed gate
// caught that on integration, which is exactly what it exists to do: a new
// producer output must be classified or the build stops. These are
// compiler-authored executable structure derived from source prose, so they
// take the DECIDED whole-subtree `mechanics` rule the eight other kinds
// already use. A deeper declaration still wins if a future field under
// `/mechanics` needs a different class.
mechanicsSubtree('equipment', '/mechanics', 'equipment.mechanics');
mechanicsSubtree('equipment', '/useProfile', 'equipment.useProfile');
derived(
  'equipment',
  '/weaponCategory',
  'the weapon category (simple/martial), parsed from the printed weapon table.',
);
derived(
  'equipment',
  '/weaponProperties',
  'structured weapon-property facts (e.g. versatile die, thrown/ammunition range), parsed from the printed Properties column.',
);
derived(
  'equipment',
  '/weaponRange',
  'the weapon range category, parsed from the printed weapon table.',
);
derived(
  'equipment',
  '/weight',
  "the item weight, parsed from the printed table's Weight column.",
);

// ---------------------------------------------------------------------------
// feat — Grappler (the one committed SRD feat) (parseFeats.ts)
// ---------------------------------------------------------------------------
prose(
  'feat',
  '/description',
  'the feat description paragraph, quoted verbatim.',
);
prose(
  'feat',
  '/prerequisites',
  'the printed prerequisite line (e.g. "Strength 13 or higher."), quoted verbatim.',
);
mechanicsSubtree('feat', '/mechanics', 'feat.mechanics');

// ---------------------------------------------------------------------------
// feature — class/subclass-granted features (parseFeatures.ts / deriveFeatureChoices.ts)
// ---------------------------------------------------------------------------
prose(
  'feature',
  '/description',
  'the feature description prose, quoted verbatim.',
);
derived(
  'feature',
  '/source',
  'the granting class/subclass record-key, not source text.',
);
derived(
  'feature',
  '/level',
  'the integer grant level, parsed from the class progression table.',
);
derived(
  'feature',
  '/tableRefs',
  'a list of linked `table:` record-key references, not source text.',
);
mechanicsSubtree('feature', '/mechanics', 'feature.mechanics');
derived(
  'feature',
  '/choices',
  'structured player-choice facts this feature requires (Fighting Style, subclass selection, Metamagic, spell selection, ...), deterministically derived from the class/feature rules text.',
);
projection(
  'feature',
  '/choices/*/prompt',
  'a compiler-authored, human-readable prompt string (deriveFeatureChoices.ts), never a source quote.',
);
prose(
  'feature',
  '/choices/*/options/*/text',
  "a named option's printed descriptive clause (e.g. a Fighting Style option body), quoted verbatim.",
);
projection(
  'feature',
  '/choices/*/unsupported',
  "the importer's own diagnostic note about a modeling gap for this choice — commentary about the compiler, not source-derived fact.",
);

// ---------------------------------------------------------------------------
// hazard — traps/diseases/poisons (parseHazards.ts / parseTraps.ts / parseDiseases.ts / parsePoisons.ts)
// ---------------------------------------------------------------------------
derived(
  'hazard',
  '/category',
  "the hazard's category (trap/disease/poison), a classification the importer assigns based on which SRD subsection it was parsed from.",
);
prose(
  'hazard',
  '/description',
  "the hazard's SRD description prose, quoted verbatim.",
);
derived(
  'hazard',
  '/poisonType',
  'the poison-delivery category, parsed from the printed poison description.',
);
derived(
  'hazard',
  '/price',
  'the poison price, parsed from the printed poison table/description.',
);
derived(
  'hazard',
  '/trapType',
  'the trap category (mechanical/magic), parsed from the printed trap description.',
);
mechanicsSubtree('hazard', '/mechanics', 'hazard.mechanics');

// ---------------------------------------------------------------------------
// magic-item — the 240 SRD magic items (parseMagicItems.ts / magicItem*.ts)
// ---------------------------------------------------------------------------
derived(
  'magic-item',
  '/attunementRequirement',
  'the structured attunement qualifier (e.g. "by a spellcaster"), parsed from the printed attunement line.',
);
prose(
  'magic-item',
  '/description',
  "the item's SRD description prose, quoted verbatim.",
);
mechanicsSubtree(
  'magic-item',
  '/executionReadiness',
  'magic-item.executionReadiness',
);
derived(
  'magic-item',
  '/itemType',
  "the item's equipment-category classification, parsed from its printed type line.",
);
mechanicsSubtree('magic-item', '/mechanics', 'magic-item.mechanics');
derived(
  'magic-item',
  '/rarity',
  'the item rarity, parsed from the printed type line.',
);
derived(
  'magic-item',
  '/requiresAttunement',
  'the boolean attunement flag, parsed from the printed type line.',
);
derived(
  'magic-item',
  '/statBlockRefs',
  'a list of linked `stat-block:` record-key references, not source text.',
);
derived(
  'magic-item',
  '/tableRefs',
  'a list of linked `table:` record-key references, not source text.',
);
namedEntry('magic-item', '/variants');
derived(
  'magic-item',
  '/variants/*/rarity',
  "a variant's own rarity, parsed from its printed type line.",
);
derived(
  'magic-item',
  '/variants/*/id',
  'a stable variant identifier, not source text.',
);

// ---------------------------------------------------------------------------
// rule — general rules text (parseRules.ts)
// ---------------------------------------------------------------------------
prose('rule', '/text', 'the rule body, quoted verbatim.');
derived(
  'rule',
  '/tableRefs',
  'a list of linked `table:` record-key references, not source text.',
);
derived(
  'rule',
  '/skillsByAbility',
  'the ability->skills grouping, parsed from the printed skills-by-ability table.',
);

// ---------------------------------------------------------------------------
// spell — the 319 SRD spells (parseSpells.ts / mechanicsProjections.ts / upcast.ts)
// ---------------------------------------------------------------------------
derived(
  'spell',
  '/castingTime',
  'the printed casting time, parsed from the spell header block.',
);
derived(
  'spell',
  '/classes',
  'the list of class names that can cast this spell, computed from the spell-list appendix.',
);
prose(
  'spell',
  '/componentMaterials',
  'the printed material-component parenthetical clause, quoted verbatim.',
);
derived(
  'spell',
  '/components',
  'the V/S/M component-letter list, parsed from the spell header block.',
);
prose(
  'spell',
  '/description',
  'the spell description prose, quoted verbatim (E5).',
);
derived(
  'spell',
  '/duration',
  'the printed spell duration, parsed from the spell header block.',
);
prose(
  'spell',
  '/higherLevels',
  'the "At Higher Levels" paragraph, quoted verbatim (E5).',
);
derived(
  'spell',
  '/level',
  'the spell level, parsed from the spell header block.',
);
mechanicsSubtree('spell', '/mechanics', 'spell.mechanics');
derived(
  'spell',
  '/range',
  'the printed spell range, parsed from the spell header block.',
);
derived(
  'spell',
  '/ritual',
  'the boolean ritual flag, parsed from the spell header block.',
);
derived(
  'spell',
  '/scalingSourceKind',
  "a classification of where this spell's cantrip/slot scaling text lives, not source text itself.",
);
prose(
  'spell',
  '/scalingSourceText',
  "the printed scaling clause this spell's scaling was derived from, quoted verbatim.",
);
derived(
  'spell',
  '/school',
  'the spell school, parsed from the spell header block.',
);
derived(
  'spell',
  '/tableRefs',
  'a list of linked `table:` record-key references, not source text.',
);
mechanicsSubtree('spell', '/upcast', 'spell.upcast');

// ---------------------------------------------------------------------------
// stat-block — abbreviated inline combat stat blocks (parseStatBlocks.ts / eshyra-4a7.4)
// ---------------------------------------------------------------------------
derived(
  'stat-block',
  '/abilityScores',
  'the six ability-score numbers, parsed from the printed inline block.',
);
namedEntry('stat-block', '/actions');
namedEntry('stat-block', '/traits');
derived(
  'stat-block',
  '/alignment',
  'the alignment, parsed from the printed inline block header.',
);
derived(
  'stat-block',
  '/armorClass',
  'the AC value, parsed from the printed inline block (permissive shape; may be textual — eshyra-4a7.4).',
);
derived(
  'stat-block',
  '/challengeRating',
  'the challenge rating, parsed from the printed inline block, when present.',
);
derived(
  'stat-block',
  '/conditionImmunities',
  'the condition-immunity list, parsed from the printed inline block.',
);
derived(
  'stat-block',
  '/damageImmunities',
  'the damage-immunity list, parsed from the printed inline block.',
);
derived(
  'stat-block',
  '/experiencePoints',
  'the XP award, computed from the challenge rating when present.',
);
derived(
  'stat-block',
  '/hitPoints',
  'the hit-point value/formula, parsed from the printed inline block.',
);
prose(
  'stat-block',
  '/hitPoints/special',
  'a derived/textual HP amount the source prints in place of a number+formula (e.g. "half the hit point maximum of its summoner"), quoted verbatim because it could not be reduced to a structured value.',
);
derived(
  'stat-block',
  '/inlineSource',
  'the containing-item + page pointer recording where this inline block is printed — a structural locator, not narrative prose.',
);
derived(
  'stat-block',
  '/languages',
  'the languages list, parsed from the printed inline block.',
);
derived(
  'stat-block',
  '/senses',
  'the senses list, parsed from the printed inline block.',
);
derived(
  'stat-block',
  '/size',
  'the size category, parsed from the printed inline block header.',
);
derived(
  'stat-block',
  '/speed',
  'the mode->feet speed map, parsed from the printed inline block.',
);
derived(
  'stat-block',
  '/type',
  'the creature type, parsed from the printed inline block header.',
);

// ---------------------------------------------------------------------------
// subclass — Champion, Life domain, School of Evocation, ... (parseSubclasses.ts)
// ---------------------------------------------------------------------------
prose(
  'subclass',
  '/description',
  'the subclass intro paragraph, quoted verbatim.',
);
derived(
  'subclass',
  '/features',
  "a list of this subclass's granted `feature:` record-key references, not source text.",
);
derived(
  'subclass',
  '/featuresByLevel',
  "the level-grouped feature-grant projection (one row per grant level), computed from the granted features' own levels — a derived index, not new source text.",
);
derived(
  'subclass',
  '/parentClass',
  'the parent base `class` record-key, not source text.',
);
namedEntry('subclass', '/sections', { mechanics: false });
derived(
  'subclass',
  '/spellTableRefs',
  'a list of linked `table:` record-key references, not source text.',
);

// ---------------------------------------------------------------------------
// table — extracted SRD tables (parseDocumentTables.ts / tableProjections.ts)
// ---------------------------------------------------------------------------
prose(
  'table',
  '/columns',
  'the printed column header labels, quoted verbatim.',
);
prose(
  'table',
  '/legend',
  'printed footnote/legend text accompanying the table, quoted verbatim.',
);
prose(
  'table',
  '/rows',
  "the table's raw cells, reproduced verbatim from the source table (as opposed to `projection`, the compiler's structured reading of them).",
);
mechanicsSubtree('table', '/projection', 'table.projection');

export const DND5E_FIELD_PROVENANCE_DECLARATIONS: readonly FieldProvenanceDeclaration[] =
  decls;
