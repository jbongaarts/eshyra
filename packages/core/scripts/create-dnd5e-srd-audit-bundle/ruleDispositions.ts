/**
 * Rule-record disposition & engine-procedure coverage layer
 * (eshyra-o9bd.18.7.8.1).
 *
 * Exact classification of `rule:*` and `action:*` records only. It is not a
 * corpus-wide semantic ownership, discovery-completeness,
 * capability-completeness, or exclusive-clause-ownership artifact (ADR 0020
 * §5.3). Kept in a sibling module (not inline in cli.ts) purely for
 * file-size reasons — it is wired into the same audit-bundle build path via
 * `assertRuleDispositions`. `action:*` joined the scope in eshyra-t8gw.1,
 * when the ten SRD 5.1 "Actions in Combat" standard-action rows moved from
 * `rule:*` keys to the `action:*` keys they had duplicated; every field
 * carried over byte-identical, so the classification claim these rows make
 * is unchanged, only their key prefix.
 *
 * Two independent registries, deliberately not nested (design doc §2,
 * docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-8-1-rule-disposition-layer-design.md):
 *
 * - `RULE_DISPOSITIONS` — *what is this rule?* Exactly one of
 *   reference-prose / definition / engine-procedure / table-backed /
 *   duplicate per the 2026-07-06 rule-classification artifact (335 rows).
 * - `ENGINE_PROCEDURE_COVERAGE` — the audit projection of implementation
 *   evidence and runtime rule statements for every `engine-procedure` key
 *   (175 rows). Only implemented rows are authored in the audit bundle;
 *   adjudication contexts and known limits are projected from their runtime
 *   datasets. A row's disposition class implies no channel fact.
 *
 * `RULE_DISPOSITIONS` is transcribed from its source classification artifact
 * (docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-8-rule-classification.md).
 * Engine-procedure membership remains pinned by identity, while runtime
 * statements and implemented evidence come from their owning datasets.
 */

import { createHash } from 'node:crypto';
import { validateToolInput } from '../../src/model/toolSchemaValidation.js';
import { DEFAULT_TOOLS } from '../../src/orchestrator/tools.js';
import type {
  RuleDeterministicCapabilityContract,
  RuleDeterministicCapabilityDisposition,
} from '../../src/rules/deterministicCapabilityLedger.js';
import {
  RULE_DETERMINISTIC_CAPABILITY_BINDINGS,
  RULE_DETERMINISTIC_CAPABILITY_CONTRACTS,
  RULE_DETERMINISTIC_CAPABILITY_DISPOSITIONS,
  requireRuleDeterministicCapabilityContract,
  validateRuleDeterministicCapabilityContracts as validateLedgerCapabilityContracts,
} from '../../src/rules/deterministicCapabilityLedger.js';
import {
  RULE_ADJUDICATION_CONTEXT,
  type RuleAdjudicationContext,
  validateRuleAdjudicationContext,
} from '../../src/rules/ruleAdjudicationContext.js';
import {
  RULE_KNOWN_LIMITS,
  type RuleKnownLimit,
  validateRuleKnownLimits,
} from '../../src/rules/ruleKnownLimits.js';

export {
  RULE_DETERMINISTIC_CAPABILITY_BINDINGS,
  RULE_DETERMINISTIC_CAPABILITY_CONTRACTS,
  RULE_DETERMINISTIC_CAPABILITY_DISPOSITIONS,
  requireRuleDeterministicCapabilityContract,
} from '../../src/rules/deterministicCapabilityLedger.js';

import { findingByCanonicalId } from '../../src/rules/findingRegistry.js';
import type { RulesPack } from '../../src/rules/types.js';

export type RuleDispositionClass =
  | 'reference-prose'
  | 'definition'
  | 'engine-procedure'
  | 'table-backed'
  | 'duplicate';

export type RuleProcedureFamily =
  | 'core-d20'
  | 'combat-core'
  | 'movement-environment'
  | 'spellcasting'
  | 'rest-death-hp'
  | 'build-advancement'
  | 'downtime-economy'
  | 'objects-hazards'
  | 'monster-conventions'
  | 'magic-item-procedures'
  | 'templates'
  | 'gear-payload'
  | 'perception-senses';

export interface RuleDisposition {
  readonly class: RuleDispositionClass;
  /** Required iff class === 'engine-procedure'. */
  readonly family?: RuleProcedureFamily;
  /**
   * Names what covers deterministic content living in a 'definition' or
   * 'reference-prose' row: another rule key (must itself be
   * engine-procedure or table-backed), or a 'record-data:<kind>.<field>'
   * pointer. Absent for rows that are pure vocabulary/narrative.
   */
  readonly deterministicOwner?: string;
  /** Required iff class === 'duplicate': a rule key resolving to a
   *  non-duplicate row, or a 'record-data:<kind>.<field>' pointer when the
   *  canonical owner is a different record kind (e.g. class/feature/
   *  equipment data) rather than another rule. */
  readonly canonicalOwner?: string;
  /** True for hybrid PROC+TABLE rows: tableRefs must exist AND coverage is
   *  still required — a structured table never excuses an unmodeled
   *  procedure in the same record. */
  readonly tableEvidence?: boolean;
  /** Verbatim (trimmed) note from the classification artifact matrix. */
  readonly note: string;
}

export const RULE_DISPOSITIONS: Readonly<Record<string, RuleDisposition>> =
  Object.freeze({
    'rule:a-clear-path-to-the-target': {
      class: 'engine-procedure',
      family: 'spellcasting',
      note: 'spellcasting: total-cover targeting block; AoE origin lands near side of obstruction',
    },
    'rule:a-legendary-creatures-lair': {
      class: 'reference-prose',
      note: '',
    },
    'rule:abilities': {
      class: 'engine-procedure',
      family: 'magic-item-procedures',
      note: 'sentient-items: 4d6-drop-lowest per mental score',
    },
    'rule:ability-checks': {
      class: 'engine-procedure',
      family: 'core-d20',
      tableEvidence: true,
      note: "core-d20: d20+mod vs DC; DC table ref'd",
    },
    'rule:ability-score-increase': {
      class: 'reference-prose',
      deterministicOwner: 'record-data:ancestry.abilityScoreIncrease',
      note: 'ASIs structured per ancestry',
    },
    'rule:ability-scores': {
      class: 'reference-prose',
      note: 'monster-book pointer',
    },
    'rule:ability-scores-and-modifiers': {
      class: 'engine-procedure',
      family: 'core-d20',
      tableEvidence: true,
      note: "core-d20: mod = floor((score−10)/2); table ref'd",
    },
    'rule:actions': {
      class: 'reference-prose',
      note: '',
    },
    'rule:actions-in-combat': {
      class: 'reference-prose',
      note: '',
    },
    'rule:activating-an-item': {
      class: 'engine-procedure',
      family: 'magic-item-procedures',
      note: 'magic-items: action-activation is not Use-an-Object (Fast Hands exclusion)',
    },
    'rule:advantage-and-disadvantage': {
      class: 'engine-procedure',
      family: 'core-d20',
      note: 'core-d20: no stacking, adv+dis cancel, single reroll',
    },
    'rule:adventuring-gear': {
      class: 'reference-prose',
      note: '',
    },
    'rule:age': {
      class: 'reference-prose',
      note: '',
    },
    'rule:alignment': {
      class: 'reference-prose',
      note: '',
    },
    'rule:alignment-in-the-multiverse': {
      class: 'reference-prose',
      note: '',
    },
    'rule:ammunition': {
      class: 'engine-procedure',
      family: 'monster-conventions',
      note: 'monster-conventions: assumed ammo 2d4 thrown / 2d10 projectile',
    },
    'rule:appendix-mm-a-miscellaneous-creatures': {
      class: 'reference-prose',
      note: '',
    },
    'rule:appendix-mm-b-nonplayer-characters': {
      class: 'reference-prose',
      note: '',
    },
    'rule:arcane-traditions': {
      class: 'reference-prose',
      note: '',
    },
    'rule:areas-of-effect': {
      class: 'engine-procedure',
      family: 'spellcasting',
      note: 'spellcasting: AoE geometry framework (shapes in cone/cube/cylinder/line/sphere rows)',
    },
    'rule:armor-class': {
      class: 'duplicate',
      canonicalOwner: 'rule:armor-guidance',
      note: 'canonical: gear armor records + armor-guidance',
    },
    'rule:armor-guidance': {
      class: 'engine-procedure',
      family: 'gear-payload',
      note: 'equipment: non-proficiency penalties (disadv Str/Dex rolls, no casting); heavy-armor Str speed −10; stealth disadv; shield +2, one shield max. Per-armor stats structured in gear →18.7.6 for payload',
    },
    'rule:armor-weapon-and-tool-proficiencies': {
      class: 'engine-procedure',
      family: 'monster-conventions',
      note: 'monster-conventions: default assumption — monster is proficient with its listed armor/weapons/tools (promoted from REF: deterministic engine default; swap guidance remains GM prose)',
    },
    'action:attack': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'combat-core: Attack action grants exactly one melee/ranged attack (promoted from DEF 2026-07-06: deterministic action-economy grant)',
    },
    'rule:attack-rolls': {
      class: 'engine-procedure',
      family: 'core-d20',
      note: 'core-d20: d20+mods ≥ AC',
    },
    'rule:attunement': {
      class: 'engine-procedure',
      family: 'magic-item-procedures',
      note: 'magic-items: attunement state machine (short rest, max 3, no duplicate copies, 100 ft/24 h ending, death, voluntary)',
    },
    'rule:backgrounds': {
      class: 'reference-prose',
      note: '',
    },
    'rule:backgrounds-equipment': {
      class: 'engine-procedure',
      family: 'build-advancement',
      note: 'char-build: starting-equipment package XOR coin purchase — exclusive choice gate (promoted from REF 2026-07-06)',
    },
    'rule:backgrounds-languages': {
      class: 'reference-prose',
      note: '',
    },
    'rule:backgrounds-proficiencies': {
      class: 'engine-procedure',
      family: 'build-advancement',
      note: 'char-build: duplicate-proficiency replacement rule',
    },
    'rule:being-prone': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: "movement: stand = half speed; crawl +1 ft/ft; speed 0 can't stand",
    },
    'rule:between-adventures': {
      class: 'reference-prose',
      note: '',
    },
    'rule:beyond-1st-level': {
      class: 'engine-procedure',
      family: 'build-advancement',
      note: "advancement: HP per level (roll or fixed average), retroactive Con, ASI cap 20. **Flag: references Character Advancement table but carries no tableRef** (table is ref'd from rule:experience-points)",
    },
    'rule:beyond-the-material': {
      class: 'reference-prose',
      note: '',
    },
    'rule:beyond-the-material-outer-planes': {
      class: 'reference-prose',
      note: '',
    },
    'rule:blindsight': {
      class: 'engine-procedure',
      family: 'perception-senses',
      note: 'perception-senses: sightless perception within radius (promoted from DEF: deterministic perception semantics; radii structured per creature). Canonical over senses-blindsight',
    },
    'rule:bonus-action': {
      class: 'engine-procedure',
      family: 'spellcasting',
      note: 'spellcasting: bonus-action spell → only action-cantrip same turn',
    },
    'rule:bonus-actions': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'action-economy: one per turn, timing',
    },
    'rule:breaking-up-your-move': {
      class: 'engine-procedure',
      family: 'movement-environment',
      note: 'movement: split move around action',
    },
    'rule:burrow': {
      class: 'engine-procedure',
      family: 'movement-environment',
      note: 'movement-environment: burrow through sand/earth/mud/ice; solid-rock restriction unless trait (promoted from DEF: deterministic movement restriction)',
    },
    'rule:cantrips': {
      class: 'definition',
      deterministicOwner: 'rule:spell-slots',
      note: 'no-slot/at-will exemption is owned by the spell-slot economy engine procedure (rule:spell-slots, PROC)',
    },
    'action:cast-a-spell': {
      class: 'reference-prose',
      note: '',
    },
    'rule:casting-a-spell': {
      class: 'reference-prose',
      note: '',
    },
    'rule:casting-a-spell-at-a-higher-level': {
      class: 'engine-procedure',
      family: 'spellcasting',
      note: 'spellcasting: F4 atomically selects/spends the legal slot; the shared closed upcast contract resolves every reviewed higher-slot transform. Choosing to upcast, targets, and typed exclusive branches remains a DM/player choice.',
    },
    'rule:casting-a-spell-attack-rolls': {
      class: 'engine-procedure',
      family: 'spellcasting',
      note: 'spellcasting: spell attack = ability mod + PB',
    },
    'rule:casting-a-spell-range': {
      class: 'engine-procedure',
      family: 'spellcasting',
      note: 'spellcasting: target-within-range validation; range self semantics for cones/lines (promoted from DEF: deterministic targeting gate)',
    },
    'rule:casting-a-spell-saving-throws': {
      class: 'engine-procedure',
      family: 'spellcasting',
      note: 'spellcasting: spell save DC = 8 + mod + PB + special modifiers',
    },
    'rule:casting-in-armor': {
      class: 'engine-procedure',
      family: 'spellcasting',
      note: 'spellcasting: must be proficient in worn armor',
    },
    'rule:casting-time': {
      class: 'definition',
      note: '',
    },
    'rule:casting-time-reactions': {
      class: 'definition',
      note: '',
    },
    'rule:challenge': {
      class: 'reference-prose',
      deterministicOwner: 'record-data:creature.experiencePoints',
      note: 'CR guidance; the deterministic CR-0 XP rule (0 vs 10 XP) is owned by per-creature `experiencePoints` fields + the creature-cr-xp gate',
    },
    'rule:challenge-experience-points': {
      class: 'table-backed',
      note: 'XP by CR',
    },
    'rule:channel-divinity': {
      class: 'engine-procedure',
      family: 'build-advancement',
      note: 'multiclassing: no extra uses; effects union',
    },
    'rule:charges': {
      class: 'engine-procedure',
      family: 'magic-item-procedures',
      note: 'magic-items: charge count revealed on identify/attunement',
    },
    'rule:charisma': {
      class: 'definition',
      note: '',
    },
    'rule:charisma-checks': {
      class: 'reference-prose',
      note: 'skill descriptions',
    },
    'rule:charisma-spellcasting-ability': {
      class: 'duplicate',
      canonicalOwner: 'record-data:class.spellcastingAbility',
      note: 'canonical: class records `spellcastingAbility`',
    },
    'rule:class-features': {
      class: 'engine-procedure',
      family: 'build-advancement',
      note: 'multiclassing: features minus starting equipment; special cases listed',
    },
    'rule:climb': {
      class: 'engine-procedure',
      family: 'movement-environment',
      note: 'movement-environment: climbing speed exempts extra-movement cost (promoted from DEF: deterministic cost exemption; speeds structured per creature)',
    },
    'rule:climbing-swimming-and-crawling': {
      class: 'engine-procedure',
      family: 'movement-environment',
      note: 'movement: +1 ft/ft (+2 in difficult terrain) without climb/swim speed; optional Athletics',
    },
    'rule:coinage': {
      class: 'engine-procedure',
      family: 'downtime-economy',
      tableEvidence: true,
      note: "exchange rates ref'd; coin weight 50/lb",
    },
    'rule:combat-step-by-step': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'combat-core: 5-step encounter loop',
    },
    'rule:combining-magical-effects': {
      class: 'engine-procedure',
      family: 'spellcasting',
      note: "spellcasting: same-spell effects don't stack, most potent applies",
    },
    'rule:command-word': {
      class: 'engine-procedure',
      family: 'magic-item-procedures',
      note: 'magic-items: activation blocked where sound is prevented (silence) (promoted from DEF: deterministic activation gate)',
    },
    'rule:communication': {
      class: 'table-backed',
      note: 'sentient items',
    },
    'rule:complex-traps': {
      class: 'engine-procedure',
      family: 'objects-hazards',
      note: 'hazards: trap initiative + per-round actions',
    },
    'rule:components': {
      class: 'definition',
      deterministicOwner: 'rule:verbal-v',
      note: 'V/S/M gating owner: the verbal-v / somatic-s / material-m PROC rows; per-spell components structured',
    },
    'rule:concentration': {
      class: 'engine-procedure',
      family: 'spellcasting',
      note: 'spellcasting: Con save DC = max(10, ⌊damage/2⌋) per source; break conditions',
    },
    'rule:conditions': {
      class: 'reference-prose',
      note: 'intro; conditions are separate structured records',
    },
    'rule:cone': {
      class: 'engine-procedure',
      family: 'spellcasting',
      note: 'spellcasting: geometry (width = distance)',
    },
    'rule:conflict': {
      class: 'engine-procedure',
      family: 'magic-item-procedures',
      note: 'sentient-items: contested Cha check; control save DC 12+Cha mod; charmed 1d12 h; repeat on damage; 1/dawn',
    },
    'rule:constitution': {
      class: 'definition',
      note: '',
    },
    'rule:constitution-checks': {
      class: 'reference-prose',
      note: '',
    },
    'rule:constitution-hit-points': {
      class: 'engine-procedure',
      family: 'build-advancement',
      note: 'advancement: retroactive Con-mod HP formula',
    },
    'rule:consumables': {
      class: 'engine-procedure',
      family: 'magic-item-procedures',
      note: 'magic-items: one-shot consumption state (item loses magic when used) (promoted from DEF: deterministic state transition)',
    },
    'rule:contests': {
      class: 'engine-procedure',
      family: 'core-d20',
      note: 'core-d20: contest resolution, tie = status quo',
    },
    'rule:contests-in-combat': {
      class: 'reference-prose',
      note: '',
    },
    'rule:controlling-a-mount': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'mounted: controlled vs independent; initiative sync; Dash/Disengage/Dodge only',
    },
    'rule:cover': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'combat-core: +2 / +5 AC & Dex saves; total cover untargetable; no stacking',
    },
    'rule:crafting': {
      class: 'engine-procedure',
      family: 'downtime-economy',
      note: 'downtime: 5 gp/day progress, half-value materials, cooperation, lifestyle offset',
    },
    'rule:creating-sentient-magic-items': {
      class: 'reference-prose',
      note: '',
    },
    'rule:creating-sentient-magic-items-alignment': {
      class: 'table-backed',
      note: '',
    },
    'rule:creating-sentient-magic-items-senses': {
      class: 'table-backed',
      note: '',
    },
    'rule:creature-size': {
      class: 'reference-prose',
      note: '**Flag: references Size Categories table, no tableRef** (rule:size carries it)',
    },
    'rule:critical-hits': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'combat-core: double all damage dice',
    },
    'rule:cube': {
      class: 'engine-procedure',
      family: 'spellcasting',
      note: 'spellcasting geometry',
    },
    'rule:curing-madness': {
      class: 'reference-prose',
      note: 'madness: cross-spell pointers',
    },
    'rule:customizing-a-background': {
      class: 'engine-procedure',
      family: 'build-advancement',
      note: 'char-build: swap feature/skills/tools rule',
    },
    'rule:customizing-npcs': {
      class: 'reference-prose',
      note: '',
    },
    'rule:cylinder': {
      class: 'engine-procedure',
      family: 'spellcasting',
      note: 'spellcasting geometry',
    },
    'rule:damage-and-healing': {
      class: 'reference-prose',
      note: '',
    },
    'rule:damage-and-healing-hit-points': {
      class: 'definition',
      note: '',
    },
    'rule:damage-resistance-and-vulnerability': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: "combat-core: halve/double after other modifiers; instances don't stack",
    },
    'rule:damage-rolls': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'combat-core: add ability mod; min 0; roll once for multi-target',
    },
    'rule:damage-types': {
      class: 'definition',
      note: 'vocabulary',
    },
    'rule:darkvision': {
      class: 'engine-procedure',
      family: 'perception-senses',
      note: 'perception-senses: darkness→dim, dim→bright lighting substitution within radius; no color (promoted from DEF: deterministic lighting semantics). Canonical over senses-darkvision',
    },
    'action:dash': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'action: extra movement = current speed',
    },
    'rule:death-saving-throws': {
      class: 'engine-procedure',
      family: 'rest-death-hp',
      note: 'rest-death: flat DC 10 d20; 3-count; nat 1 = 2 fails; nat 20 = 1 HP; damage-at-0 = fail (2 on crit)',
    },
    'rule:demiplanes': {
      class: 'reference-prose',
      note: '',
    },
    'rule:detecting-and-disabling-a-trap': {
      class: 'engine-procedure',
      family: 'objects-hazards',
      note: "hazards: Perception vs trap DC; Investigation + thieves' tools; Arcana for magic traps",
    },
    'rule:dexterity': {
      class: 'definition',
      note: '',
    },
    'rule:dexterity-attack-rolls-and-damage': {
      class: 'engine-procedure',
      family: 'core-d20',
      note: 'core-d20: Dex for ranged/finesse',
    },
    'rule:dexterity-checks': {
      class: 'reference-prose',
      note: '',
    },
    'rule:dexterity-initiative': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'combat-core: initiative = Dex check',
    },
    'rule:diseases': {
      class: 'reference-prose',
      note: '',
    },
    'action:disengage': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'action: no opportunity attacks this turn',
    },
    'action:dodge': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'action: attackers disadv, Dex saves adv; void if incapacitated/speed 0',
    },
    'rule:downtime-activities': {
      class: 'engine-procedure',
      family: 'downtime-economy',
      note: 'downtime: 8 h/day minimum, non-consecutive',
    },
    'rule:dropping-to-0-hit-points': {
      class: 'reference-prose',
      note: '',
    },
    'rule:druid-druids-and-the-gods': {
      class: 'reference-prose',
      note: '',
    },
    'rule:druid-sacred-plants-and-wood': {
      class: 'reference-prose',
      note: '',
    },
    'rule:duration': {
      class: 'definition',
      note: '',
    },
    'rule:equipment': {
      class: 'engine-procedure',
      family: 'monster-conventions',
      note: 'monster-conventions: default assumption — spellcasting monsters have their required material components (promoted from REF: deterministic engine default; gear-recoverability guidance remains prose)',
    },
    'rule:equipment-packs': {
      class: 'reference-prose',
      note: 'pack contents in gear records',
    },
    'rule:expenses': {
      class: 'reference-prose',
      note: '',
    },
    'rule:expenses-lifestyle-expenses': {
      class: 'engine-procedure',
      family: 'downtime-economy',
      note: 'economy: lifestyle costs/week or month. **Flag: references Expenses table, no tableRef**; DUP pair with lifestyle-expenses (p. 88)',
    },
    'rule:experience-points': {
      class: 'engine-procedure',
      family: 'build-advancement',
      tableEvidence: true,
      note: 'char advancement table; multiclass XP by total level',
    },
    'rule:extra-attack': {
      class: 'engine-procedure',
      family: 'build-advancement',
      note: 'multiclassing: no stacking',
    },
    'rule:falling': {
      class: 'engine-procedure',
      family: 'movement-environment',
      note: 'environment: 1d6/10 ft, max 20d6, land prone',
    },
    'rule:falling-unconscious': {
      class: 'engine-procedure',
      family: 'rest-death-hp',
      note: 'rest-death: 0 HP → unconscious, ends on any HP',
    },
    'rule:fantasy-historical-pantheons': {
      class: 'reference-prose',
      note: '',
    },
    'rule:feats': {
      class: 'engine-procedure',
      family: 'build-advancement',
      note: 'char-build: once each; prerequisite loss disables',
    },
    'rule:fly': {
      class: 'engine-procedure',
      family: 'movement-environment',
      note: 'movement-environment: fly speed use; hover creatures stop hovering on death (promoted from DEF: deterministic state rule; hover flag structured per creature)',
    },
    'rule:flying-movement': {
      class: 'engine-procedure',
      family: 'movement-environment',
      note: 'movement: fall when prone/speed 0 unless hover',
    },
    'rule:food': {
      class: 'engine-procedure',
      family: 'movement-environment',
      note: 'survival: 1 lb/day; half rations; limit 3+Con mod days then exhaustion/day',
    },
    'rule:food-and-water': {
      class: 'engine-procedure',
      family: 'movement-environment',
      note: 'survival: exhaustion from deprivation not removable until fed',
    },
    'rule:food-drink-and-lodging': {
      class: 'table-backed',
      note: '',
    },
    'rule:gaining-inspiration': {
      class: 'engine-procedure',
      family: 'build-advancement',
      note: 'inspiration: boolean resource cap — have it or not, cannot stockpile (promoted from REF: deterministic resource limit; award remains GM discretion)',
    },
    'rule:getting-into-and-out-of-armor': {
      class: 'table-backed',
      note: 'don/doff times',
    },
    'rule:going-mad': {
      class: 'reference-prose',
      note: 'madness sources; Wis/Cha saves',
    },
    'rule:grapple-rules-for-monsters': {
      class: 'engine-procedure',
      family: 'monster-conventions',
      note: 'monster-conventions: default escape DC = 10 + Str(Athletics) mod',
    },
    'rule:grappling': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'combat-contests: Athletics vs Athletics/Acrobatics; drag at half speed',
    },
    'rule:group-checks': {
      class: 'engine-procedure',
      family: 'core-d20',
      note: 'core-d20: half-succeed rule',
    },
    'rule:half-dragon-template': {
      class: 'engine-procedure',
      family: 'templates',
      tableEvidence: true,
      note: "templates: stat deltas + 2 tables ref'd",
    },
    'rule:healing': {
      class: 'engine-procedure',
      family: 'rest-death-hp',
      note: "rest-death: healing adds regained HP to current HP; excess over HP max is lost; dead creatures can't regain HP until magic restores them to life",
    },
    'rule:heavy-armor-category': {
      class: 'duplicate',
      canonicalOwner: 'record-data:equipment.armorClass',
      note: 'canonical: gear armor records (no Dex to AC)',
    },
    'action:help': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'action: advantage grant, 5-ft attack aid',
    },
    'action:hide': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'action: Stealth check per hiding rules',
    },
    'rule:hiding': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'perception: Stealth vs active Perception / passive score (10+mods, ±5 adv/dis)',
    },
    'rule:hit-points': {
      class: 'engine-procedure',
      family: 'monster-conventions',
      tableEvidence: true,
      note: 'monster-conventions: HD by size table; HP = HD avg + Con×HD',
    },
    'rule:hit-points-and-hit-dice': {
      class: 'engine-procedure',
      family: 'build-advancement',
      note: 'multiclassing: pooled HD by die type',
    },
    'rule:improvised-weapons': {
      class: 'engine-procedure',
      family: 'gear-payload',
      note: 'equipment: 1d4, range 20/60, proficiency analogy →18.7.6',
    },
    'rule:innate-spellcasting': {
      class: 'engine-procedure',
      family: 'monster-conventions',
      note: 'monster-conventions: lowest-level casting, CR for cantrip scaling',
    },
    'rule:inner-planes': {
      class: 'reference-prose',
      note: '',
    },
    'rule:inspiration': {
      class: 'reference-prose',
      note: '',
    },
    'rule:instant-death': {
      class: 'engine-procedure',
      family: 'rest-death-hp',
      note: 'rest-death: remaining damage ≥ HP max → death',
    },
    'rule:instantaneous': {
      class: 'definition',
      deterministicOwner: 'record-data:spell.duration',
      note: "can't-be-dispelled semantics owner: spell:dispel-magic record + per-spell structured duration",
    },
    'rule:intelligence': {
      class: 'definition',
      note: '',
    },
    'rule:intelligence-checks': {
      class: 'reference-prose',
      note: '',
    },
    'rule:intelligence-spellcasting-ability': {
      class: 'duplicate',
      canonicalOwner: 'record-data:class.spellcastingAbility',
      note: 'canonical: class records',
    },
    'rule:interacting-with-objects': {
      class: 'engine-procedure',
      family: 'objects-hazards',
      note: 'objects: GM-set AC/HP; immune poison/psychic; auto-fail Str/Dex saves; break at 0',
    },
    'rule:interacting-with-objects-around-you': {
      class: 'reference-prose',
      deterministicOwner: 'rule:other-activity-on-your-turn',
      note: 'example list; the one-free-interaction rule is owned by rule:other-activity-on-your-turn (PROC)',
    },
    'rule:jumping': {
      class: 'engine-procedure',
      family: 'movement-environment',
      note: 'movement: long = Str score ft (half standing); high = 3+Str mod (half standing); DC 10 checks; reach = height + 1.5×height',
    },
    'rule:knocking-a-creature-out': {
      class: 'engine-procedure',
      family: 'rest-death-hp',
      note: 'rest-death: melee nonlethal choice → unconscious+stable',
    },
    'rule:known-and-prepared-spells': {
      class: 'reference-prose',
      note: 'per-class detail structured',
    },
    'rule:lair-actions': {
      class: 'engine-procedure',
      family: 'monster-conventions',
      note: 'monster-conventions: initiative 20 (lose ties); restrictions',
    },
    'rule:languages': {
      class: 'table-backed',
      note: 'standard + exotic tables',
    },
    'rule:legendary-actions': {
      class: 'engine-procedure',
      family: 'monster-conventions',
      note: "monster-conventions: end-of-others'-turns economy, regain at start; per-creature counts structured",
    },
    'rule:legendary-creatures': {
      class: 'engine-procedure',
      family: 'monster-conventions',
      note: 'monster-conventions: assumed forms do not gain legendary actions / lair actions / regional effects (promoted from DEF: deterministic exclusion gate; interacts with 18.7.9 slice C1 changeShape)',
    },
    'rule:lifestyle-expenses': {
      class: 'table-backed',
      note: 'DUP pair with expenses-lifestyle-expenses; this p. 88 row carries the tableRef — canonical',
    },
    'rule:lifting-and-carrying': {
      class: 'engine-procedure',
      family: 'build-advancement',
      note: 'encumbrance: capacity = Str×15; push/drag ×2 at speed 5; size doubling/halving (kind `carryingCapacitySize` exists)',
    },
    'rule:light-armor': {
      class: 'duplicate',
      canonicalOwner: 'record-data:equipment.armorClass',
      note: 'canonical: gear armor records',
    },
    'rule:limited-usage': {
      class: 'engine-procedure',
      family: 'monster-conventions',
      note: 'monster-conventions: X/Day long-rest reset; Recharge X–Y = d6 at start of turn ≥ threshold, also on short/long rest (promoted from DEF: the per-entry use economies are structured (18.7.3), but the recharge/reset runtime procedure needs an engine owner)',
    },
    'rule:line': {
      class: 'engine-procedure',
      family: 'spellcasting',
      note: 'spellcasting geometry',
    },
    'rule:long-rest': {
      class: 'engine-procedure',
      family: 'rest-death-hp',
      note: 'rest-death: 8 h, interruption ≥1 h strenuous, all HP + half HD (min 1), 1/24 h, needs ≥1 HP',
    },
    'rule:longer-casting-times': {
      class: 'engine-procedure',
      family: 'spellcasting',
      note: 'spellcasting: action per turn + concentration; slot kept on break',
    },
    'rule:madness': {
      class: 'reference-prose',
      note: '',
    },
    'rule:madness-effects': {
      class: 'engine-procedure',
      family: 'objects-hazards',
      tableEvidence: true,
      note: "3 tables ref'd; durations 1d10 min / 1d10×10 h",
    },
    'rule:magic-items': {
      class: 'reference-prose',
      note: '',
    },
    'rule:magic-items-a-z': {
      class: 'reference-prose',
      note: '',
    },
    'rule:making-an-attack': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'combat-core: 3-step attack procedure',
    },
    'rule:martial-archetypes': {
      class: 'reference-prose',
      note: '',
    },
    'rule:material-m': {
      class: 'engine-procedure',
      family: 'spellcasting',
      note: 'spellcasting: focus/pouch substitution; cost components required; consumption; free-hand',
    },
    'rule:medium-armor': {
      class: 'duplicate',
      canonicalOwner: 'record-data:equipment.armorClass',
      note: 'canonical: gear armor records (Dex max +2)',
    },
    'rule:melee-and-ranged-attacks': {
      class: 'definition',
      note: 'Hit/Miss notation',
    },
    'rule:melee-attacks': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'combat-core: reach 5 ft; unarmed = 1 + Str, proficient',
    },
    'rule:modifiers-to-the-roll': {
      class: 'engine-procedure',
      family: 'core-d20',
      note: 'core-d20: ability mod + PB rules',
    },
    'rule:modifying-creatures': {
      class: 'reference-prose',
      note: '',
    },
    'rule:monastic-traditions': {
      class: 'reference-prose',
      note: '',
    },
    'rule:monsters': {
      class: 'reference-prose',
      note: '',
    },
    'rule:monsters-alignment': {
      class: 'reference-prose',
      note: '',
    },
    'rule:monsters-and-death': {
      class: 'reference-prose',
      note: 'GM convention',
    },
    'rule:monsters-armor-class': {
      class: 'definition',
      note: '',
    },
    'rule:monsters-languages': {
      class: 'definition',
      note: '',
    },
    'rule:monsters-reactions': {
      class: 'definition',
      note: '',
    },
    'rule:monsters-saving-throws': {
      class: 'definition',
      deterministicOwner: 'record-data:creature.savingThrows',
      note: 'save bonus = mod + PB-by-CR; per-creature values structured',
    },
    'rule:monsters-skills': {
      class: 'definition',
      deterministicOwner: 'record-data:creature.skills',
      note: 'skill bonus = mod + PB (double for expertise); structured',
    },
    'rule:monsters-speed': {
      class: 'definition',
      note: '',
    },
    'rule:mounted-combat': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'combat-core (mounted): mount eligibility gate — willing creature, ≥1 size larger, appropriate anatomy (promoted from DEF: deterministic eligibility rule)',
    },
    'rule:mounting-and-dismounting': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'mounted: cost = half speed; DC 10 Dex save vs falling off; reaction dismount',
    },
    'rule:mounts-and-vehicles': {
      class: 'engine-procedure',
      family: 'downtime-economy',
      note: 'economy: vehicle pull ×5 capacity; barding ×4 cost ×2 weight; current +3 mph. **Flag: references Mounts and Other Animals table, no tableRef**',
    },
    'rule:movement': {
      class: 'reference-prose',
      note: '',
    },
    'rule:movement-and-position': {
      class: 'engine-procedure',
      family: 'movement-environment',
      note: 'movement: budget spending across modes',
    },
    'rule:movement-and-position-difficult-terrain': {
      class: 'engine-procedure',
      family: 'movement-environment',
      note: 'movement: +1 ft/ft; non-stacking; creature spaces count. DUP pair with speed-difficult-terrain (travel) — both canonical for their scale',
    },
    'rule:moving-around-other-creatures': {
      class: 'engine-procedure',
      family: 'movement-environment',
      note: "movement: hostile pass-through needs ±2 sizes; can't end in occupied space",
    },
    'rule:moving-between-attacks': {
      class: 'engine-procedure',
      family: 'movement-environment',
      note: 'movement: split between attacks',
    },
    'rule:multiattack': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'combat-core: Multiattack cannot be used for opportunity attacks (promoted from DEF: deterministic action-economy restriction; per-creature routines structured, 18.7.9)',
    },
    'rule:multiclassing': {
      class: 'engine-procedure',
      family: 'build-advancement',
      note: 'multiclassing: character level = sum',
    },
    'rule:multiclassing-proficiency-bonus': {
      class: 'engine-procedure',
      family: 'build-advancement',
      note: 'multiclassing: PB by total level',
    },
    'rule:multiple-items-of-the-same-kind': {
      class: 'reference-prose',
      note: 'common-sense slots',
    },
    'rule:oath-of-devotion-oath-spells': {
      class: 'duplicate',
      canonicalOwner: 'record-data:feature.grantedSpells',
      note: 'canonical: feature records',
    },
    'rule:objects': {
      class: 'engine-procedure',
      family: 'objects-hazards',
      tableEvidence: true,
      note: "object AC/HP tables ref'd; damage threshold; immunities",
    },
    'rule:opportunity-attacks': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'combat-core: trigger + teleport/forced-move exclusions',
    },
    'rule:other-activity-on-your-turn': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'action-economy: one free object interaction',
    },
    'rule:otherworldly-patrons': {
      class: 'reference-prose',
      note: '',
    },
    'rule:outer-planes-outer-planes': {
      class: 'reference-prose',
      note: '',
    },
    'rule:paired-items': {
      class: 'engine-procedure',
      family: 'magic-item-procedures',
      note: 'magic-items: both of pair required',
    },
    'rule:paladin-breaking-your-oath': {
      class: 'reference-prose',
      note: '',
    },
    'rule:passive-checks': {
      class: 'engine-procedure',
      family: 'core-d20',
      note: 'core-d20: 10 + mods, ±5 adv/dis',
    },
    'rule:planar-travel': {
      class: 'reference-prose',
      note: '',
    },
    'rule:poisons': {
      class: 'engine-procedure',
      family: 'objects-hazards',
      note: 'hazards: 4 delivery types w/ deterministic exposure semantics',
    },
    'rule:practicing-a-profession': {
      class: 'engine-procedure',
      family: 'downtime-economy',
      note: 'downtime: lifestyle earned by work/Performance',
    },
    'rule:prerequisites': {
      class: 'table-backed',
      note: 'multiclass prereqs',
    },
    'rule:proficiencies': {
      class: 'table-backed',
      note: 'multiclass proficiencies',
    },
    'rule:proficiency-bonus': {
      class: 'engine-procedure',
      family: 'core-d20',
      note: 'core-d20: apply once; multiply/divide once; ×0 when not proficient',
    },
    'rule:psionics': {
      class: 'definition',
      note: '',
    },
    'rule:racial-traits': {
      class: 'reference-prose',
      note: '',
    },
    'rule:racial-traits-alignment': {
      class: 'reference-prose',
      note: '',
    },
    'rule:racial-traits-languages': {
      class: 'reference-prose',
      note: '',
    },
    'rule:racial-traits-size': {
      class: 'reference-prose',
      note: '',
    },
    'rule:racial-traits-speed': {
      class: 'reference-prose',
      note: '',
    },
    'rule:range': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'combat-core: normal/long; disadv beyond normal',
    },
    'rule:ranged-attacks': {
      class: 'reference-prose',
      note: '',
    },
    'rule:ranged-attacks-in-close-combat': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'combat-core: disadv within 5 ft of seeing hostile',
    },
    'rule:ranger-archetypes': {
      class: 'reference-prose',
      note: '',
    },
    'rule:reactions': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'action-economy: one per round; interrupt semantics',
    },
    'action:ready': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'action: trigger + readied spell concentration',
    },
    'rule:recuperating': {
      class: 'engine-procedure',
      family: 'downtime-economy',
      note: 'downtime: 3 days + DC 15 Con save → benefit menu',
    },
    'rule:regional-effects': {
      class: 'reference-prose',
      note: '',
    },
    'rule:researching': {
      class: 'engine-procedure',
      family: 'downtime-economy',
      note: 'downtime: 1 gp/day',
    },
    'rule:resting': {
      class: 'reference-prose',
      note: '',
    },
    'rule:rituals': {
      class: 'engine-procedure',
      family: 'spellcasting',
      note: 'spellcasting: +10 min, no slot, no upcast, feature-gated',
    },
    'rule:roguish-archetypes': {
      class: 'reference-prose',
      note: '',
    },
    'rule:rolling-1-or-20': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'combat-core: nat 20 auto-hit/crit, nat 1 auto-miss',
    },
    'rule:sacred-oaths': {
      class: 'reference-prose',
      note: '',
    },
    'rule:sample-diseases': {
      class: 'reference-prose',
      note: '',
    },
    'rule:sample-poisons': {
      class: 'reference-prose',
      note: '',
    },
    'rule:sample-traps': {
      class: 'reference-prose',
      note: '',
    },
    'rule:saving-throws': {
      class: 'engine-procedure',
      family: 'core-d20',
      note: 'core-d20: d20 + mod (+PB if proficient)',
    },
    'action:search': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'action',
    },
    'rule:self-sufficiency': {
      class: 'engine-procedure',
      family: 'downtime-economy',
      note: 'downtime: wilderness lifestyle equivalents',
    },
    'rule:selling-treasure': {
      class: 'engine-procedure',
      family: 'downtime-economy',
      note: 'economy: half-price gear; full-value gems/trade goods',
    },
    'rule:senses': {
      class: 'definition',
      note: '',
    },
    'rule:senses-blindsight': {
      class: 'duplicate',
      canonicalOwner: 'rule:blindsight',
      note: 'canonical: rule:blindsight (PROC); monster-facing copy adds naturally-blind parenthetical note',
    },
    'rule:senses-darkvision': {
      class: 'duplicate',
      canonicalOwner: 'rule:darkvision',
      note: 'canonical: rule:darkvision (PROC)',
    },
    'rule:senses-truesight': {
      class: 'duplicate',
      canonicalOwner: 'rule:truesight',
      note: 'canonical: rule:truesight (PROC)',
    },
    'rule:sentient-magic-items': {
      class: 'reference-prose',
      note: '',
    },
    'rule:services': {
      class: 'table-backed',
      note: 'hireling rates',
    },
    'rule:short-rest': {
      class: 'engine-procedure',
      family: 'rest-death-hp',
      note: 'rest-death: ≥1 h; spend HD (roll + Con each)',
    },
    'rule:shoving-a-creature': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'combat-contests: contest → prone or push 5 ft',
    },
    'rule:silvered-weapons': {
      class: 'engine-procedure',
      family: 'downtime-economy',
      note: 'economy: 100 gp per weapon / 10 ammo',
    },
    'rule:size': {
      class: 'table-backed',
      note: 'size categories',
    },
    'rule:skills': {
      class: 'definition',
      deterministicOwner: 'rule:proficiency-bonus',
      note: 'add-PB-if-proficient semantics owner: rule:proficiency-bonus + rule:ability-checks (PROC)',
    },
    'rule:somatic-s': {
      class: 'engine-procedure',
      family: 'spellcasting',
      note: 'spellcasting: free hand required',
    },
    'rule:sorcerous-origins': {
      class: 'reference-prose',
      note: '',
    },
    'rule:space': {
      class: 'definition',
      deterministicOwner: 'record-data:table.size-categories',
      note: 'surround counts are illustrations derived from size geometry (owner: table:size-categories via rule:size)',
    },
    'rule:special-purpose': {
      class: 'table-backed',
      note: 'sentient items',
    },
    'rule:special-traits': {
      class: 'definition',
      note: '',
    },
    'rule:special-traits-spellcasting': {
      class: 'engine-procedure',
      family: 'monster-conventions',
      note: 'monster-conventions: class-list casting, upcast by slots, class membership for items',
    },
    'rule:special-types-of-movement': {
      class: 'reference-prose',
      note: '',
    },
    'rule:special-weapons': {
      class: 'engine-procedure',
      family: 'gear-payload',
      note: 'equipment: lance (disadv <5 ft, two-handed unmounted), net (restrained, DC 10 Str escape, AC 10/5 slashing, one attack) →18.7.6',
    },
    'rule:speed': {
      class: 'engine-procedure',
      family: 'movement-environment',
      tableEvidence: true,
      note: "travel pace table ref'd; forced march Con save DC 10+1/h; gallop ×2",
    },
    'rule:speed-difficult-terrain': {
      class: 'engine-procedure',
      family: 'movement-environment',
      note: 'travel: half speed. DUP pair with combat difficult terrain',
    },
    'rule:spell-level': {
      class: 'definition',
      note: '',
    },
    'rule:spell-slots': {
      class: 'engine-procedure',
      family: 'spellcasting',
      note: "spellcasting: slot-expenditure economy — expend a slot of the spell's level or higher; long rest restores all (promoted from DEF: per-class progression values are structured, but the expenditure/restoration procedure needs an engine owner)",
    },
    'rule:spellcasting': {
      class: 'engine-procedure',
      family: 'build-advancement',
      tableEvidence: true,
      note: 'multiclassing: slot formula (full + half⌊⌋ classes → shared table); pact-magic interop',
    },
    'rule:spellcasting-chapter': {
      class: 'reference-prose',
      note: '',
    },
    'rule:spellcasting-services': {
      class: 'reference-prose',
      note: 'price guidance',
    },
    'rule:spells': {
      class: 'engine-procedure',
      family: 'magic-item-procedures',
      note: 'magic-items: item casting (lowest level, no components/slots; UMD ability +0, PB applies)',
    },
    'rule:sphere': {
      class: 'engine-procedure',
      family: 'spellcasting',
      note: 'spellcasting geometry',
    },
    'rule:squeezing-into-a-smaller-space': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'movement: one-size squeeze; +1 ft/ft; disadv attacks & Dex saves; attackers adv',
    },
    'rule:stabilizing-a-creature': {
      class: 'engine-procedure',
      family: 'rest-death-hp',
      note: 'rest-death: DC 10 Wis (Medicine); stable semantics; 1d4 h → 1 HP (kind `stabilize` exists)',
    },
    'rule:strength': {
      class: 'definition',
      note: '',
    },
    'rule:strength-attack-rolls-and-damage': {
      class: 'engine-procedure',
      family: 'core-d20',
      note: 'core-d20: Str for melee',
    },
    'rule:strength-checks': {
      class: 'reference-prose',
      note: '',
    },
    'rule:subraces': {
      class: 'reference-prose',
      note: '',
    },
    'rule:suffocating': {
      class: 'engine-procedure',
      family: 'movement-environment',
      note: 'survival: hold breath 1+Con mod min (min 30 s); then Con-mod rounds (min 1) → 0 HP dying',
    },
    'rule:suggested-characteristics': {
      class: 'reference-prose',
      note: '',
    },
    'rule:surprise': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'combat-core: Stealth vs passive Perception; surprised = no move/action/reaction turn 1',
    },
    'rule:swim': {
      class: 'engine-procedure',
      family: 'movement-environment',
      note: 'movement-environment: swimming speed exempts extra-movement cost (promoted from DEF, as climb)',
    },
    'rule:tags': {
      class: 'definition',
      note: '',
    },
    'rule:targeting-yourself': {
      class: 'engine-procedure',
      family: 'spellcasting',
      note: 'spellcasting: self-targeting eligibility',
    },
    'rule:targets': {
      class: 'definition',
      note: '',
    },
    'rule:telepathy': {
      class: 'engine-procedure',
      family: 'monster-conventions',
      note: "monster-conventions (communication): global telepathy semantics — no shared language but target must know ≥1 language; non-telepaths receive/respond but can't initiate/terminate; no action cost; ends on range break/retarget/incapacitation; blocked by antimagic (promoted from DEF: deterministic behavioral contract; the canonical semantics behind 18.7.9 slice C3's `telepathy` payloads)",
    },
    'rule:temporary-hit-points': {
      class: 'engine-procedure',
      family: 'rest-death-hp',
      note: 'rest-death: buffer, no stacking (choose), no healing, long-rest expiry (kind `temporaryHitPoints` exists)',
    },
    'rule:the-celtic-pantheon': {
      class: 'table-backed',
      note: '',
    },
    'rule:the-egyptian-pantheon': {
      class: 'table-backed',
      note: '',
    },
    'rule:the-environment': {
      class: 'reference-prose',
      note: '',
    },
    'rule:the-fiend-expanded-spell-list': {
      class: 'duplicate',
      canonicalOwner: 'record-data:feature.grantedSpells',
      note: 'canonical: warlock feature records',
    },
    'rule:the-greek-pantheon': {
      class: 'table-backed',
      note: '',
    },
    'rule:the-material-plane': {
      class: 'reference-prose',
      note: '',
    },
    'rule:the-norse-pantheon': {
      class: 'table-backed',
      note: '',
    },
    'rule:the-order-of-combat': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'combat-core: round/turn cycle (6 s)',
    },
    'rule:the-order-of-combat-initiative': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'combat-core: Dex check; group rolls; tie handling',
    },
    'rule:the-planes-of-existence': {
      class: 'reference-prose',
      note: '',
    },
    'rule:the-schools-of-magic': {
      class: 'definition',
      note: '',
    },
    'rule:time': {
      class: 'reference-prose',
      note: '',
    },
    'rule:tools': {
      class: 'definition',
      deterministicOwner: 'rule:proficiency-bonus',
      note: 'add-PB semantics owner: rule:proficiency-bonus (PROC); ability-flexible tool checks are GM adjudication',
    },
    'rule:trade-goods': {
      class: 'table-backed',
      note: '',
    },
    'rule:training': {
      class: 'engine-procedure',
      family: 'downtime-economy',
      note: 'downtime: 250 days × 1 gp',
    },
    'rule:transitive-planes': {
      class: 'reference-prose',
      note: '',
    },
    'rule:trap-effects': {
      class: 'table-backed',
      note: "severity dice + DC/attack tables ref'd",
    },
    'rule:traps': {
      class: 'reference-prose',
      note: '',
    },
    'rule:traps-in-play': {
      class: 'reference-prose',
      note: '',
    },
    'rule:tremorsense': {
      class: 'engine-procedure',
      family: 'perception-senses',
      note: 'perception-senses: pinpoint vibration sources sharing ground contact; cannot detect flying/incorporeal (promoted from DEF: deterministic detection semantics)',
    },
    'rule:triggering-a-trap': {
      class: 'reference-prose',
      note: '',
    },
    'rule:truesight': {
      class: 'engine-procedure',
      family: 'perception-senses',
      note: 'perception-senses: see in normal/magical darkness, see invisible, auto-detect visual illusions AND auto-succeed their saves, perceive shapechanger/transformed originals, see into Ethereal (promoted from DEF: deterministic auto-success bundle). Canonical over senses-truesight; interacts with 18.7.9 C1',
    },
    'rule:two-weapon-fighting': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'combat-core: light weapons, bonus attack, no positive ability mod to damage',
    },
    'rule:type': {
      class: 'definition',
      note: 'creature-type vocabulary',
    },
    'rule:unarmored-defense': {
      class: 'engine-procedure',
      family: 'build-advancement',
      note: 'multiclassing: no re-gain',
    },
    'rule:underwater-combat': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'environment: melee disadv unless listed weapons; ranged auto-miss beyond normal; fire resistance immersed',
    },
    'rule:unseen-attackers-and-targets': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'combat-core: disadv vs unseen, adv when unseen; auto-miss wrong guess',
    },
    'action:use-an-object': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'action',
    },
    'rule:using-ability-scores': {
      class: 'reference-prose',
      note: '',
    },
    'rule:using-different-speeds': {
      class: 'engine-procedure',
      family: 'movement-environment',
      note: 'movement: cross-mode subtraction',
    },
    'rule:using-each-ability': {
      class: 'reference-prose',
      note: '',
    },
    'rule:using-inspiration': {
      class: 'engine-procedure',
      family: 'build-advancement',
      note: 'inspiration: spend → advantage; gifting',
    },
    'rule:variant-encumbrance': {
      class: 'engine-procedure',
      family: 'build-advancement',
      note: 'encumbrance (variant): >5×Str → speed −10; >10×Str → −20 + disadv Str/Dex/Con rolls',
    },
    'rule:variant-skills-with-different-abilities': {
      class: 'engine-procedure',
      family: 'core-d20',
      note: 'core-d20 (variant): skill/ability recombination',
    },
    'rule:verbal-v': {
      class: 'engine-procedure',
      family: 'spellcasting',
      note: 'spellcasting: gag/silence blocks V',
    },
    'rule:vision-and-light': {
      class: 'engine-procedure',
      family: 'movement-environment',
      note: 'environment: lightly obscured → Perception disadv; heavily obscured → blinded-equivalent; 3 light levels',
    },
    'rule:vulnerabilities-resistances-and-immunities': {
      class: 'definition',
      deterministicOwner: 'rule:damage-resistance-and-vulnerability',
      note: 'DUP with damage-resistance-and-vulnerability (that row canonical for the math)',
    },
    'rule:warlock-your-pact-boon': {
      class: 'reference-prose',
      note: '',
    },
    'rule:water': {
      class: 'engine-procedure',
      family: 'movement-environment',
      note: 'survival: 1 gal/day (2 hot); half → DC 15 Con save or exhaustion; less → automatic',
    },
    'rule:weapon-proficiency': {
      class: 'engine-procedure',
      family: 'core-d20',
      note: 'equipment: PB gating on attack rolls',
    },
    'rule:weapon-properties': {
      class: 'engine-procedure',
      family: 'gear-payload',
      note: 'equipment: property semantics (ammunition + half recovery, finesse, heavy/Small disadv, light, loading, range, reach +5, thrown, two-handed, versatile) →18.7.6',
    },
    'rule:weapons': {
      class: 'reference-prose',
      note: '',
    },
    'rule:wearing-and-wielding-items': {
      class: 'reference-prose',
      note: '',
    },
    'rule:what-is-a-spell': {
      class: 'reference-prose',
      note: '',
    },
    'rule:wisdom': {
      class: 'definition',
      note: '',
    },
    'rule:wisdom-checks': {
      class: 'reference-prose',
      note: '',
    },
    'rule:wisdom-spellcasting-ability': {
      class: 'duplicate',
      canonicalOwner: 'record-data:class.spellcastingAbility',
      note: 'canonical: class records',
    },
    'rule:wizard-your-spellbook': {
      class: 'engine-procedure',
      family: 'downtime-economy',
      note: 'downtime: copy 2 h + 50 gp per level; backup 1 h + 10 gp',
    },
    'rule:working-together': {
      class: 'engine-procedure',
      family: 'core-d20',
      note: 'core-d20: leader rolls with advantage; eligibility constraints',
    },
    'rule:your-turn': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'action-economy: move + one action, any order, may forgo',
    },
  });

export interface RuleImplementationEvidence {
  readonly runtimeOwner: readonly string[];
  readonly evidence: readonly string[];
}

export type RuleCoverageChannel =
  | 'implementation'
  | 'adjudicationContext'
  | 'knownLimit'
  | 'noRuntimeStatement';

export interface RuleProcedureCoverage {
  readonly implementation?: RuleImplementationEvidence;
  readonly adjudicationContext?: RuleAdjudicationContext;
  readonly knownLimits: readonly RuleKnownLimit[];
}

const UNBOUND_ENGINE_PROCEDURE_COVERAGE: Readonly<
  Record<string, RuleImplementationEvidence>
> = Object.freeze({
  'rule:abilities': {
    runtimeOwner: [
      'packages/core/src/orchestrator/dice.ts',
      'packages/core/src/orchestrator/toolRoll.ts',
    ],
    evidence: [
      'packages/core/test/diceGrammar.test.ts',
      'packages/core/test/resolutionTools.test.ts',
    ],
  },
  'rule:ability-checks': {
    runtimeOwner: [
      'packages/core/src/orchestrator/resolution.ts',
      'packages/core/src/orchestrator/toolResolveCheck.ts',
      'packages/core/src/orchestrator/playerVisibleRollLedger.ts',
    ],
    evidence: [
      'packages/core/test/resolution.test.ts',
      'packages/core/test/resolutionTools.test.ts',
    ],
  },
  'rule:ability-scores-and-modifiers': {
    runtimeOwner: [
      'packages/core/src/character/abilities.ts',
      'packages/core/src/character/derivedValues.ts',
    ],
    evidence: ['packages/core/test/liveStateSchema.test.ts'],
  },
  'rule:advantage-and-disadvantage': {
    runtimeOwner: [
      'packages/core/src/orchestrator/dice.ts',
      'packages/core/src/orchestrator/resolution.ts',
      'packages/core/src/orchestrator/toolResolveCheck.ts',
    ],
    evidence: [
      'packages/core/test/diceGrammar.test.ts',
      'packages/core/test/resolution.test.ts',
    ],
  },
  'rule:attack-rolls': {
    runtimeOwner: [
      'packages/core/src/orchestrator/resolution.ts',
      'packages/core/src/orchestrator/toolResolveCheck.ts',
    ],
    evidence: [
      'packages/core/test/resolution.test.ts',
      'packages/core/test/resolutionTools.test.ts',
    ],
  },
  'rule:attunement': {
    runtimeOwner: [
      'packages/core/src/state/attunement.ts',
      'packages/core/src/orchestrator/toolAttuneItem.ts',
      'packages/core/src/orchestrator/toolEndAttunement.ts',
    ],
    evidence: ['packages/core/test/attunement.test.ts'],
  },
  'rule:backgrounds-equipment': {
    runtimeOwner: [
      'packages/core/src/character/srdStartingEquipmentGrants.ts',
      'packages/core/src/character/srdEquipmentPacks.ts',
    ],
    evidence: [
      'packages/core/test/characterDraftEngine.test.ts',
      'packages/core/test/finalizeCharacter.test.ts',
      'packages/cli/test/characterWizard.test.ts',
    ],
  },
  'rule:backgrounds-proficiencies': {
    runtimeOwner: ['packages/core/src/character/characterDraft.ts'],
    evidence: [
      'packages/core/test/characterDraftEngine.test.ts',
      'packages/cli/test/characterWizard.test.ts',
    ],
  },
  'rule:beyond-1st-level': {
    runtimeOwner: ['packages/core/src/character/levelUpEngine.ts'],
    evidence: [
      'packages/core/test/levelUpEngine.test.ts',
      'packages/core/test/guidedLevelUpFlow.test.ts',
      'packages/cli/test/play.test.ts',
    ],
  },
  'rule:bonus-action': {
    runtimeOwner: [
      'packages/core/src/state/actionEconomy.ts',
      'packages/core/src/orchestrator/toolSpendTurnResource.ts',
    ],
    evidence: ['packages/core/test/actionEconomy.test.ts'],
  },
  'rule:bonus-actions': {
    runtimeOwner: [
      'packages/core/src/state/actionEconomy.ts',
      'packages/core/src/orchestrator/toolSpendTurnResource.ts',
    ],
    evidence: ['packages/core/test/actionEconomy.test.ts'],
  },
  'rule:casting-a-spell-at-a-higher-level': {
    runtimeOwner: [
      'packages/core/src/orchestrator/spellUpcast.ts',
      'packages/core/src/rules/spellUpcastContract.ts',
      'packages/core/src/orchestrator/toolResolveSpellUpcast.ts',
      'packages/core/src/orchestrator/toolSpendSpellSlot.ts',
      'packages/core/src/orchestrator/turnTraceProjection.ts',
      'packages/core/src/state/campaignRecordLookup.ts',
      'packages/core/src/state/spellSlots.ts',
    ],
    evidence: [
      'packages/core/test/spellUpcast.test.ts',
      'packages/core/test/spellSlots.test.ts',
      'packages/core/test/turnTraceProjection.test.ts',
    ],
  },
  'rule:concentration': {
    runtimeOwner: [
      'packages/core/src/state/activeEffects.ts',
      'packages/core/src/state/hpLifecycle.ts',
      'packages/core/src/orchestrator/toolResolveConcentration.ts',
      'packages/core/src/orchestrator/toolStartEffect.ts',
      'packages/core/src/orchestrator/toolEndEffect.ts',
    ],
    evidence: ['packages/core/test/activeEffects.test.ts'],
  },
  'rule:constitution-hit-points': {
    runtimeOwner: ['packages/core/src/character/levelUpEngine.ts'],
    evidence: ['packages/core/test/levelUpEngine.test.ts'],
  },
  'rule:contests': {
    runtimeOwner: [
      'packages/core/src/orchestrator/resolution.ts',
      'packages/core/src/orchestrator/toolResolveContest.ts',
    ],
    evidence: [
      'packages/core/test/resolution.test.ts',
      'packages/core/test/resolutionTools.test.ts',
    ],
  },
  'rule:critical-hits': {
    runtimeOwner: [
      'packages/core/src/orchestrator/resolution.ts',
      'packages/core/src/orchestrator/toolResolveDamage.ts',
    ],
    evidence: [
      'packages/core/test/resolution.test.ts',
      'packages/core/test/resolutionTools.test.ts',
    ],
  },
  // R0 rewritten: the accepted custom-background policy is implemented and validated during character creation (characterDraftEngine.test.ts).
  'rule:customizing-a-background': {
    runtimeOwner: ['packages/core/src/character/characterDraft.ts'],
    evidence: [
      'packages/core/test/characterDraftEngine.test.ts',
      'packages/core/test/finalizeCharacter.test.ts',
    ],
  },
  'rule:damage-resistance-and-vulnerability': {
    runtimeOwner: [
      'packages/core/src/orchestrator/resolution.ts',
      'packages/core/src/orchestrator/toolResolveDamage.ts',
    ],
    evidence: ['packages/core/test/resolution.test.ts'],
  },
  'rule:damage-rolls': {
    runtimeOwner: [
      'packages/core/src/orchestrator/dice.ts',
      'packages/core/src/orchestrator/resolution.ts',
      'packages/core/src/orchestrator/toolResolveDamage.ts',
    ],
    evidence: [
      'packages/core/test/resolution.test.ts',
      'packages/core/test/resolutionTools.test.ts',
    ],
  },
  'rule:death-saving-throws': {
    runtimeOwner: [
      'packages/core/src/state/hpLifecycle.ts',
      'packages/core/src/orchestrator/toolRecordDeathSave.ts',
    ],
    evidence: ['packages/core/test/hpLifecycle.test.ts'],
  },
  'rule:falling-unconscious': {
    runtimeOwner: [
      'packages/core/src/state/hpLifecycle.ts',
      'packages/core/src/orchestrator/toolAdjustHp.ts',
    ],
    evidence: ['packages/core/test/hpLifecycle.test.ts'],
  },
  // R0 rewritten: optional feats are selected at ability-score-improvement levels with prerequisite and duplicate checks (levelUpEngine.test.ts).
  'rule:feats': {
    runtimeOwner: ['packages/core/src/character/levelUpEngine.ts'],
    evidence: ['packages/core/test/levelUpEngine.test.ts'],
  },
  'rule:gaining-inspiration': {
    runtimeOwner: [
      'packages/core/src/state/inspiration.ts',
      'packages/core/src/orchestrator/toolAwardInspiration.ts',
    ],
    evidence: ['packages/core/test/inspiration.test.ts'],
  },
  'rule:grapple-rules-for-monsters': {
    runtimeOwner: [
      'packages/core/src/orchestrator/calc.ts',
      'packages/core/src/orchestrator/toolCalc.ts',
    ],
    evidence: ['packages/core/test/calc.test.ts'],
  },
  'rule:group-checks': {
    runtimeOwner: [
      'packages/core/src/orchestrator/calc.ts',
      'packages/core/src/orchestrator/resolution.ts',
    ],
    evidence: [
      'packages/core/test/calc.test.ts',
      'packages/core/test/resolutionTools.test.ts',
    ],
  },
  'rule:healing': {
    runtimeOwner: [
      'packages/core/src/state/hpLifecycle.ts',
      'packages/core/src/orchestrator/toolAdjustHp.ts',
    ],
    evidence: [
      'packages/core/test/hpLifecycle.test.ts',
      'packages/core/test/domainMutations.test.ts',
    ],
  },
  'rule:instant-death': {
    runtimeOwner: [
      'packages/core/src/state/hpLifecycle.ts',
      'packages/core/src/orchestrator/toolAdjustHp.ts',
    ],
    evidence: ['packages/core/test/hpLifecycle.test.ts'],
  },
  'rule:legendary-actions': {
    runtimeOwner: [
      'packages/core/src/state/actionEconomy.ts',
      'packages/core/src/orchestrator/toolSpendTurnResource.ts',
    ],
    evidence: ['packages/core/test/actionEconomy.test.ts'],
  },
  'rule:limited-usage': {
    runtimeOwner: [
      'packages/core/src/state/usageCounters.ts',
      'packages/core/src/orchestrator/toolSpendUsage.ts',
      'packages/core/src/orchestrator/toolRestoreUsage.ts',
      'packages/core/src/orchestrator/toolResetUsage.ts',
    ],
    evidence: ['packages/core/test/usageCounters.test.ts'],
  },
  'rule:long-rest': {
    runtimeOwner: [
      'packages/core/src/orchestrator/toolRest.ts',
      'packages/core/src/state/rest.ts',
    ],
    evidence: ['packages/core/test/rest.test.ts'],
  },
  'rule:modifiers-to-the-roll': {
    runtimeOwner: [
      'packages/core/src/orchestrator/resolution.ts',
      'packages/core/src/orchestrator/toolResolutionShared.ts',
    ],
    evidence: ['packages/core/test/resolution.test.ts'],
  },
  'rule:other-activity-on-your-turn': {
    runtimeOwner: [
      'packages/core/src/state/actionEconomy.ts',
      'packages/core/src/orchestrator/toolSpendTurnResource.ts',
    ],
    evidence: ['packages/core/test/actionEconomy.test.ts'],
  },
  'rule:passive-checks': {
    runtimeOwner: [
      'packages/core/src/orchestrator/calc.ts',
      'packages/core/src/orchestrator/toolCalc.ts',
    ],
    evidence: ['packages/core/test/calc.test.ts'],
  },
  'rule:proficiency-bonus': {
    runtimeOwner: [
      'packages/core/src/orchestrator/resolution.ts',
      'packages/core/src/character/derivedValues.ts',
      'packages/core/src/character/levelUpEngine.ts',
    ],
    evidence: ['packages/core/test/resolution.test.ts'],
  },
  'rule:reactions': {
    runtimeOwner: [
      'packages/core/src/state/actionEconomy.ts',
      'packages/core/src/orchestrator/toolSpendTurnResource.ts',
      'packages/core/src/orchestrator/toolUpdateCombatant.ts',
    ],
    evidence: ['packages/core/test/actionEconomy.test.ts'],
  },
  'rule:saving-throws': {
    runtimeOwner: [
      'packages/core/src/orchestrator/resolution.ts',
      'packages/core/src/orchestrator/toolResolveCheck.ts',
      'packages/core/src/character/derivedValues.ts',
    ],
    evidence: [
      'packages/core/test/resolution.test.ts',
      'packages/core/test/resolutionTools.test.ts',
    ],
  },
  'rule:short-rest': {
    runtimeOwner: [
      'packages/core/src/orchestrator/toolRest.ts',
      'packages/core/src/state/rest.ts',
    ],
    evidence: ['packages/core/test/rest.test.ts'],
  },
  'rule:spell-slots': {
    runtimeOwner: [
      'packages/core/src/state/spellSlots.ts',
      'packages/core/src/orchestrator/toolSpendSpellSlot.ts',
    ],
    evidence: ['packages/core/test/spellSlots.test.ts'],
  },
  'rule:stabilizing-a-creature': {
    runtimeOwner: [
      'packages/core/src/state/hpLifecycle.ts',
      'packages/core/src/orchestrator/toolStabilizeCharacter.ts',
    ],
    evidence: ['packages/core/test/hpLifecycle.test.ts'],
  },
  'rule:surprise': {
    runtimeOwner: [
      'packages/core/src/state/actionEconomy.ts',
      'packages/core/src/orchestrator/toolSetSurprised.ts',
      'packages/core/src/orchestrator/calc.ts',
    ],
    evidence: [
      'packages/core/test/actionEconomy.test.ts',
      'packages/core/test/calc.test.ts',
    ],
  },
  'rule:temporary-hit-points': {
    runtimeOwner: [
      'packages/core/src/state/hpLifecycle.ts',
      'packages/core/src/orchestrator/toolGrantTempHp.ts',
    ],
    evidence: ['packages/core/test/hpLifecycle.test.ts'],
  },
  'rule:using-inspiration': {
    runtimeOwner: [
      'packages/core/src/state/inspiration.ts',
      'packages/core/src/orchestrator/toolUseInspiration.ts',
      'packages/core/src/orchestrator/resolution.ts',
    ],
    evidence: [
      'packages/core/test/inspiration.test.ts',
      'packages/core/test/resolution.test.ts',
    ],
  },
  'rule:your-turn': {
    runtimeOwner: [
      'packages/core/src/state/actionEconomy.ts',
      'packages/core/src/orchestrator/toolBeginTurn.ts',
      'packages/core/src/orchestrator/toolSpendTurnResource.ts',
    ],
    evidence: ['packages/core/test/actionEconomy.test.ts'],
  },
});

export function materializeEngineProcedureCoverage(
  implementationEvidence: Readonly<Record<string, RuleImplementationEvidence>>,
  statementDatasets: {
    readonly procedureKeys?: readonly string[];
    readonly adjudicationContext?: Readonly<
      Record<string, RuleAdjudicationContext>
    >;
    readonly knownLimits?: Readonly<Record<string, readonly RuleKnownLimit[]>>;
  } = {},
): Readonly<Record<string, RuleProcedureCoverage>> {
  const adjudicationContext =
    statementDatasets.adjudicationContext ?? RULE_ADJUDICATION_CONTEXT;
  const knownLimits = statementDatasets.knownLimits ?? RULE_KNOWN_LIMITS;
  const keys = new Set([
    ...(statementDatasets.procedureKeys ?? []),
    ...Object.keys(implementationEvidence),
    ...Object.keys(adjudicationContext),
    ...Object.keys(knownLimits),
  ]);
  return Object.freeze(
    Object.fromEntries(
      [...keys].map(
        (key) =>
          [
            key,
            {
              ...(implementationEvidence[key] === undefined
                ? {}
                : { implementation: implementationEvidence[key] }),
              ...(adjudicationContext[key] === undefined
                ? {}
                : { adjudicationContext: adjudicationContext[key] }),
              knownLimits: knownLimits[key] ?? [],
            },
          ] as const,
      ),
    ),
  );
}

export const ENGINE_PROCEDURE_COVERAGE = materializeEngineProcedureCoverage(
  UNBOUND_ENGINE_PROCEDURE_COVERAGE,
  {
    procedureKeys: Object.entries(RULE_DISPOSITIONS)
      .filter(([, disposition]) => disposition.class === 'engine-procedure')
      .map(([key]) => key),
  },
);

type RuntimeRuleDeterministicCapabilityContract =
  RuleDeterministicCapabilityContract;

/**
 * Contract revisions this rule-disposition REPORT has been reviewed against.
 * `src/rules/deterministicCapabilityLedger.ts` is the one runtime owner of
 * `RULE_DETERMINISTIC_CAPABILITY_CONTRACTS`, and it is free to register
 * additional contracts for ledger lookup and context-packet presentation —
 * most recently the magic-item readiness contract
 * (`derived-magic-item-clauses-v1`, eshyra-o9bd.19.1.4 W13) — without that
 * growth silently becoming a new claim THIS report makes. Deciding the
 * report's membership belongs to eshyra-o9bd.19.5.12, not this file
 * (eshyra-o9bd.19.1.4 F5); until that bead acts, the report keeps emitting
 * exactly the three contracts it was last reviewed against. Absence here is
 * a statement about this report's reviewed scope, never a claim that the
 * runtime ledger doesn't know the capability — see
 * `RULE_DETERMINISTIC_CAPABILITY_CONTRACTS['derived-magic-item-clauses-v1']`.
 *
 * Each entry names a key already present in
 * `RULE_DETERMINISTIC_CAPABILITY_CONTRACTS`, so the report reuses the
 * runtime's own row objects rather than a second copy of them — a second
 * copy is the exact defect eshyra-o9bd.19.1.4 review round 1 (finding X1)
 * found and fixed.
 */
const RULE_DISPOSITION_REPORT_CONTRACT_REVISIONS: readonly string[] =
  Object.freeze([
    'resolve-check-v1',
    'resolve-concentration-v1',
    'resolve-spell-upcast-v1',
  ]);

/**
 * Filters the runtime capability-contract registry down to this report's
 * reviewed scope, failing closed rather than silently reporting fewer
 * contracts than the report claims to cover: a scope entry with no runtime
 * counterpart is a bug in this file, not a member the report can quietly
 * drop.
 */
function ruleDispositionReportCapabilityContracts(
  contracts: Readonly<Record<string, RuleDeterministicCapabilityContract>>,
): Readonly<Record<string, RuleDeterministicCapabilityContract>> {
  const scoped: Record<string, RuleDeterministicCapabilityContract> = {};
  for (const revision of RULE_DISPOSITION_REPORT_CONTRACT_REVISIONS) {
    const contract = contracts[revision];
    if (contract === undefined)
      throw new Error(
        `${revision}: rule-disposition report scope names a capability the runtime ledger no longer defines`,
      );
    scoped[revision] = contract;
  }
  return scoped;
}

export function validateRuleDeterministicCapabilityInput(
  capability: string,
  input: unknown,
): string | undefined {
  const contract = requireRuleDeterministicCapabilityContract(capability);
  const tool = DEFAULT_TOOLS.find(
    ({ name }) => name === contract.inputSchemaOperation,
  );
  if (tool === undefined) throw new Error(`${capability}: missing tool schema`);
  return validateToolInput(tool.inputSchema, input);
}

export function validateRuleDeterministicCapabilityContracts(
  coverage: Readonly<Record<string, { readonly implementation?: object }>>,
  contracts: Readonly<Record<string, RuleDeterministicCapabilityContract>>,
  bindings = RULE_DETERMINISTIC_CAPABILITY_BINDINGS,
  dispositions = RULE_DETERMINISTIC_CAPABILITY_DISPOSITIONS,
): readonly string[] {
  const errors = [
    ...validateLedgerCapabilityContracts(
      coverage,
      contracts,
      bindings,
      dispositions,
    ),
  ];
  for (const [capability, contract] of Object.entries(contracts)) {
    const tool = DEFAULT_TOOLS.find(
      ({ name }) => name === contract.inputSchemaOperation,
    );
    if (tool === undefined || tool.name !== contract.operationId)
      errors.push(
        `${capability}: capability operation is not a registered tool`,
      );
    if (tool !== undefined) {
      const declared = new Set(contract.requiredInputs);
      for (const input of tool.inputSchema.required ?? [])
        if (!declared.has(input))
          errors.push(
            `${capability}: required schema input '${input}' is missing from the contract`,
          );
      for (const input of contract.requiredInputs)
        if (!(tool.inputSchema.required ?? []).includes(input))
          errors.push(
            `${capability}: '${input}' is not required by ${tool.name}`,
          );
    }
  }
  return errors;
}

/**
 * Identity-pinned classification of the reviewed `rule:*`/`action:*` corpus.
 * This hash covers every sorted `key:class` pair, so an equal-size
 * reclassification is still drift. It intentionally makes no claim beyond
 * `rule:*` and `action:*` records. eshyra-t8gw.1 moved ten rows from
 * `rule:*` to `action:*` keys (their `class` unchanged), which changes this
 * hash purely because the key text moved — see that bead's notes for the
 * sorted (suffix, class) multiset proof that nothing else changed.
 */
const EXPECTED_RULE_DISPOSITION_IDENTITY_FINGERPRINT =
  'de97edb00e05374282ba4afcb00481db87acbefadfffde37da6329e024423e32';

function ruleDispositionIdentityFingerprint(
  dispositions: Readonly<Record<string, RuleDisposition>>,
): string {
  return createHash('sha256')
    .update(
      Object.entries(dispositions)
        .map(([key, disposition]) => `${key}:${disposition.class}`)
        .sort()
        .join('\n'),
    )
    .digest('hex');
}

export function validateRuleDispositionIdentity(
  dispositions: Readonly<Record<string, RuleDisposition>>,
): readonly string[] {
  const actual = ruleDispositionIdentityFingerprint(dispositions);
  return actual === EXPECTED_RULE_DISPOSITION_IDENTITY_FINGERPRINT
    ? []
    : [
        `rule disposition identity drift: expected ${EXPECTED_RULE_DISPOSITION_IDENTITY_FINGERPRINT}, got ${actual} — review every rule:* key/class identity in a deliberate diff`,
      ];
}

/**
 * Pinned execution-boundary coverage census. Seeded from the 2026-07-06
 * execution-boundary classification artifact (final revision, §3:
 * 0/97/47/21/10); updated by reviewed implementation diffs since —
 * eshyra-2n1t.8 (F6 death/dying/temp-HP machine) moved death-saving-throws,
 * falling-unconscious, instant-death and temporary-hit-points from
 * unimplemented and healing from partial to implemented, and
 * stabilizing-a-creature from unimplemented to implemented (durable seeded
 * 1d4 h recovery deadline + clock resolution → eshyra-2n1t.8.1); eshyra-2n1t.4 (F2
 * action-economy turn budget) moved your-turn, bonus-action, bonus-actions,
 * reactions and other-activity-on-your-turn from unimplemented to
 * implemented (surprise and two-weapon-fighting keep partial for their F9
 * clauses; their F2 clauses landed); eshyra-2n1t.3 + eshyra-2n1t.11
 * (F1 dice grammar + F9 resolution/derived-math — dice.ts keep/drop,
 * resolution.ts, calc.ts, resolve_check/resolve_contest/resolve_damage/
 * calc tools) moved advantage-and-disadvantage from unimplemented and 15
 * F9-clause rows whose deterministic procedure is now fully tool-owned
 * (abilities, ability-checks, attack-rolls, saving-throws, contests,
 * modifiers-to-the-roll, damage-rolls,
 * damage-resistance-and-vulnerability, critical-hits, proficiency-bonus,
 * passive-checks, group-checks, grapple-rules-for-monsters, surprise,
 * using-inspiration) from partial to implemented, and 9 rows from partial
 * to model-adjudicated-supported: cover, hiding and two-weapon-fighting
 * (their arithmetic is owned once by the generic F9 rows) plus falling,
 * food, speed, variant-encumbrance, jumping and lifting-and-carrying,
 * whose calc formulas own only the rule's arithmetic clause while the
 * state/timing/application portions (prone on landing, deprivation
 * clocks, travel pace, load classification and penalty application,
 * movement costs) remain — as originally classified — model-adjudicated
 * over the primitives. casting-a-spell-at-a-higher-level is implemented: F4
 * owns slot legality/expenditure and F9 owns the source-bound typed upcast
 * transform. F10 exposed the wallet, mutation invariants, persistence, and
 * audit trail, but deterministic resale and downtime-cost transforms remain
 * partial until registered calculation primitives own those numbers. F3,
 * eshyra-2n1t.5, moved concentration from unimplemented to implemented. The
 * Equipment payload closure keeps special-weapon and generic weapon-property
 * execution partial pending scenario evidence; the coverage registry has no
 * hand-maintained count target.
 */

const DEFAULT_TOOL_NAMES: ReadonlySet<string> = new Set(
  DEFAULT_TOOLS.map((tool) => tool.name),
);

/** Shape of a real bead ID, e.g. `eshyra-o9bd.18.7.6` or `eshyra-b69j.13`. */
const BEAD_ID_PATTERN = /^eshyra-[a-z0-9]+(\.[0-9]+)*$/;

/**
 * Registry-integrity check (design §3) over an arbitrary
 * (dispositions, coverage) pair: class invariants, coverage completeness,
 * channel invariants, and optional fixture census. Pack-independent and pure,
 * so tests can exercise each failure mode against small fixtures without the
 * production identity pin getting in the way. `assertRuleDispositions` is the
 * production entry point, applied to the real registries plus the
 * pack-key-diff check. Does NOT check runtimeOwner/evidence path existence
 * — that runs in tests (design §6) to keep the bundle build hermetic.
 */
export function validateRuleRegistries(
  dispositions: Readonly<Record<string, RuleDisposition>>,
  coverage: Readonly<Record<string, RuleProcedureCoverage>>,
  expectedSemanticCensus?: Readonly<Record<RuleDispositionClass, number>>,
  expectedCoverageCensus?: Readonly<Record<RuleCoverageChannel, number>>,
): readonly string[] {
  const errors: string[] = [];

  const censusByClass: Record<string, number> = {};
  for (const [key, disposition] of Object.entries(dispositions)) {
    censusByClass[disposition.class] =
      (censusByClass[disposition.class] ?? 0) + 1;

    if (disposition.class === 'engine-procedure' && !disposition.family) {
      errors.push(`${key}: engine-procedure row is missing family`);
    }
    if (disposition.class === 'duplicate') {
      if (!disposition.canonicalOwner) {
        errors.push(`${key}: duplicate row is missing canonicalOwner`);
      } else if (!disposition.canonicalOwner.startsWith('record-data:')) {
        const owner = dispositions[disposition.canonicalOwner];
        if (!owner) {
          errors.push(
            `${key}: canonicalOwner '${disposition.canonicalOwner}' does not resolve to a rule key`,
          );
        } else if (owner.class === 'duplicate') {
          errors.push(
            `${key}: canonicalOwner '${disposition.canonicalOwner}' is itself a duplicate`,
          );
        }
      }
    }
    if (
      disposition.deterministicOwner &&
      !disposition.deterministicOwner.startsWith('record-data:')
    ) {
      const owner = dispositions[disposition.deterministicOwner];
      if (!owner) {
        errors.push(
          `${key}: deterministicOwner '${disposition.deterministicOwner}' does not resolve to a rule key`,
        );
      } else if (
        owner.class !== 'engine-procedure' &&
        owner.class !== 'table-backed'
      ) {
        errors.push(
          `${key}: deterministicOwner '${disposition.deterministicOwner}' must be engine-procedure or table-backed, is '${owner.class}'`,
        );
      }
    }
  }
  if (expectedSemanticCensus !== undefined) {
    for (const [dispositionClass, expected] of Object.entries(
      expectedSemanticCensus,
    )) {
      const actual = censusByClass[dispositionClass] ?? 0;
      if (actual !== expected) {
        errors.push(
          `semantic fixture census drift: ${dispositionClass} is ${actual}, expected ${expected}`,
        );
      }
    }
  }

  const procedureKeys = Object.entries(dispositions)
    .filter(([, d]) => d.class === 'engine-procedure')
    .map(([key]) => key);
  const procedureKeySet = new Set(procedureKeys);
  const coverageKeys = new Set(Object.keys(coverage));
  for (const key of procedureKeys) {
    if (!coverageKeys.has(key)) {
      errors.push(
        `${key}: engine-procedure row has no ENGINE_PROCEDURE_COVERAGE entry`,
      );
    }
  }
  for (const key of coverageKeys) {
    if (!procedureKeySet.has(key)) {
      errors.push(
        `${key}: ENGINE_PROCEDURE_COVERAGE entry is not an engine-procedure disposition (orphan)`,
      );
    }
  }

  const censusByChannel: Record<string, number> = {};
  const count = (channel: RuleCoverageChannel) => {
    censusByChannel[channel] = (censusByChannel[channel] ?? 0) + 1;
  };
  for (const [key, coverageRow] of Object.entries(coverage)) {
    const implementation = coverageRow.implementation;
    const context = coverageRow.adjudicationContext;
    const limits = coverageRow.knownLimits;
    if (implementation !== undefined) {
      count('implementation');
      if (!implementation.runtimeOwner?.length)
        errors.push(`${key}: implementation is missing runtimeOwner`);
      if (!implementation.evidence?.length)
        errors.push(`${key}: implementation is missing evidence`);
    }
    if (context !== undefined) {
      count('adjudicationContext');
      if (!context.tools?.length)
        errors.push(`${key}: adjudication context is missing tools`);
      for (const tool of context.tools ?? [])
        if (!DEFAULT_TOOL_NAMES.has(tool))
          errors.push(
            `${key}: tool '${tool}' is not a registered DEFAULT_TOOLS name`,
          );
      if (!context.dmContext)
        errors.push(`${key}: adjudication context is missing dmContext`);
    }
    if (!Array.isArray(limits)) {
      errors.push(`${key}: knownLimits must be an array`);
      continue;
    }
    if (
      implementation === undefined &&
      context === undefined &&
      limits.length === 0
    )
      count('noRuntimeStatement');
    for (const limit of limits) {
      count('knownLimit');
      if (!limit.statement)
        errors.push(`${key}: ${limit.limit} known limit is missing statement`);
      if (findingByCanonicalId(limit.findingId) === undefined)
        errors.push(
          `${key}: unknown canonical finding ID ${JSON.stringify(limit.findingId)}`,
        );
      if (limit.limit === 'deferred') {
        if (!limit.designOwner)
          errors.push(`${key}: deferred known limit is missing designOwner`);
        else if (!BEAD_ID_PATTERN.test(limit.designOwner))
          errors.push(
            `${key}: designOwner '${limit.designOwner}' is not a real bead-id shape`,
          );
      }
      for (const { clause, bead, findingId } of limit.externalClauses ?? []) {
        if (!clause)
          errors.push(`${key}: externalClauses entry is missing 'clause'`);
        if (!BEAD_ID_PATTERN.test(bead))
          errors.push(
            `${key}: externalClauses bead '${bead}' is not a real bead-id shape`,
          );
        if (findingByCanonicalId(findingId) === undefined)
          errors.push(
            `${key}: externalClauses findingId ${JSON.stringify(findingId)} is not a canonical finding ID`,
          );
      }
    }
  }
  for (const [channel, expected] of Object.entries(
    expectedCoverageCensus ?? {},
  )) {
    const actual = censusByChannel[channel] ?? 0;
    if (actual !== expected)
      errors.push(
        `coverage census drift: ${channel} is ${actual}, expected ${expected} (caller-supplied census)`,
      );
  }

  return errors;
}

/**
 * Fail-closed registry-integrity check (design §3) for the audit-bundle
 * build: new/stale `rule:*`/`action:*` pack keys against `RULE_DISPOSITIONS`,
 * plus the full `validateRuleRegistries` check over the real registries.
 *
 * `action:*` joined this gate in eshyra-t8gw.1: the ten SRD 5.1 "Actions in
 * Combat" standard-action headings used to be double-emitted as both
 * `rule:*` and `action:*` records; the `rule:*` copy retired and its
 * disposition row moved to the `action:*` key it duplicated. Every emitted
 * `action:*` record must have a disposition, and no disposition may name a
 * missing `action:*` key, exactly like the pre-existing `rule:*` half of this
 * check.
 */
function hasNonEmptyTableRefs(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false;
  const tableRefs = (data as Record<string, unknown>).tableRefs;
  return Array.isArray(tableRefs) && tableRefs.length > 0;
}

export function assertRuleDispositions(pack: RulesPack): readonly string[] {
  const errors: string[] = [];
  const ruleRecords = pack.records.filter(
    (record) => record.kind === 'rule' || record.kind === 'action',
  );
  const packKeys = new Set(ruleRecords.map((record) => record.key));
  const dispositionKeys = new Set(Object.keys(RULE_DISPOSITIONS));

  for (const key of packKeys) {
    if (!dispositionKeys.has(key)) {
      errors.push(`${key}: unreviewed rule record — add to RULE_DISPOSITIONS`);
    }
  }
  for (const key of dispositionKeys) {
    if (!packKeys.has(key)) {
      errors.push(`${key}: stale disposition — remove from RULE_DISPOSITIONS`);
    }
  }

  // Class invariant (design §3.3): 'table-backed' rows and 'tableEvidence'
  // engine-procedure rows must have a pack record that actually carries
  // non-empty tableRefs — a structured table can never be assumed.
  const recordsByKey = new Map(
    ruleRecords.map((record) => [record.key, record]),
  );
  for (const [key, disposition] of Object.entries(RULE_DISPOSITIONS)) {
    if (disposition.class !== 'table-backed' && !disposition.tableEvidence) {
      continue;
    }
    const record = recordsByKey.get(key);
    if (record && !hasNonEmptyTableRefs(record.data)) {
      errors.push(
        `${key}: disposition claims table evidence but the pack record has no non-empty tableRefs`,
      );
    }
  }

  errors.push(
    ...validateRuleRegistries(RULE_DISPOSITIONS, ENGINE_PROCEDURE_COVERAGE),
    ...validateRuleDeterministicCapabilityContracts(
      ENGINE_PROCEDURE_COVERAGE,
      ruleDispositionReportCapabilityContracts(
        RULE_DETERMINISTIC_CAPABILITY_CONTRACTS,
      ),
    ),
    ...validateRuleDispositionIdentity(RULE_DISPOSITIONS),
    ...validateRuleAdjudicationContext(
      new Set(DEFAULT_TOOLS.map((tool) => tool.name)),
    ),
    ...validateRuleKnownLimits(),
  );

  return errors;
}

export interface RuleDispositionReport {
  /**
   * Exact `rule:*`/`action:*` classification only; never corpus-wide
   * ownership.
   */
  readonly scope: 'rule-record-classification-only';
  readonly referencesProse: number;
  readonly definitions: number;
  readonly tableBacked: number;
  readonly duplicates: number;
  readonly engineProcedure: {
    readonly implementation: number;
    readonly adjudicationContext: number;
    readonly noRuntimeStatement: number;
    readonly knownLimits: Readonly<
      Record<
        RuleKnownLimit['limit'],
        readonly {
          readonly key: string;
          readonly statement: string;
          readonly findingId: string;
          readonly designOwner?: string;
        }[]
      >
    >;
    /** Flattened key + clause + bead (design §4) — a row with multiple
     *  externally owned clauses (e.g. armor-guidance) contributes one entry
     *  per clause. */
    readonly externalClauses: readonly {
      readonly key: string;
      readonly clause: string;
      readonly bead: string;
      readonly findingId: string;
    }[];
  };
  /** Context that must be retrievable when a procedure is model-adjudicated. */
  readonly adjudicationContextInventory: readonly {
    readonly key: string;
    readonly contextRequirement: string;
  }[];
  /**
   * Positive, bounded ADR 0020 §3 contracts, not a capability inventory.
   * Scoped to `RULE_DISPOSITION_REPORT_CONTRACT_REVISIONS` — the runtime
   * ledger may hold additional contracts (e.g. the magic-item readiness
   * contract) that are real but outside this report's reviewed scope; see
   * that constant's doc comment.
   */
  readonly deterministicCapabilities: readonly RuntimeRuleDeterministicCapabilityContract[];
  /** Identity-complete W13 outcome for each historical implemented row. */
  readonly deterministicCapabilitySourceOutcomes: readonly (
    | {
        readonly ruleKey: string;
        readonly outcome: 'bound';
        readonly capabilities: readonly string[];
        readonly coverageRuntimeOwner: readonly string[];
        readonly coverageEvidence: readonly string[];
      }
    | (RuleDeterministicCapabilityDisposition & {
        readonly coverageRuntimeOwner: readonly string[];
        readonly coverageEvidence: readonly string[];
      })
  )[];
  /** Known limits and externally owned clauses. */
  readonly unresolvedWork: readonly {
    readonly key: string;
    readonly kind: 'partial' | 'unimplemented' | 'deferred' | 'external-clause';
    readonly detail: string;
    readonly findingId: string;
    readonly historicalBead?: string;
  }[];
}

/**
 * Readiness-report detail (design §4). Registry-integrity errors
 * (`assertRuleDispositions`) fail every build; these lists are visibility
 * only — partial/unimplemented/deferred limits are truthful, actionable
 * readiness gaps that stay visible without failing day-to-day CI. Detail
 * arrays (not just counts) so a reviewer can see exactly which keys and
 * clauses are outstanding without re-deriving them from the registry.
 */
export function buildRuleDispositionReport(
  coverageRegistry: Readonly<
    Record<string, RuleProcedureCoverage>
  > = ENGINE_PROCEDURE_COVERAGE,
): RuleDispositionReport {
  let referencesProse = 0;
  let definitions = 0;
  let tableBacked = 0;
  let duplicates = 0;
  for (const disposition of Object.values(RULE_DISPOSITIONS)) {
    if (disposition.class === 'reference-prose') referencesProse += 1;
    if (disposition.class === 'definition') definitions += 1;
    if (disposition.class === 'table-backed') tableBacked += 1;
    if (disposition.class === 'duplicate') duplicates += 1;
  }
  let implementation = 0;
  let adjudicationContext = 0;
  let noRuntimeStatement = 0;
  const knownLimits: {
    [K in RuleKnownLimit['limit']]: {
      key: string;
      statement: string;
      findingId: string;
      designOwner?: string;
    }[];
  } = { partial: [], unimplemented: [], deferred: [] };
  const externalClauses: {
    key: string;
    clause: string;
    bead: string;
    findingId: string;
  }[] = [];
  const adjudicationContextInventory: {
    key: string;
    contextRequirement: string;
  }[] = [];
  const unresolvedWork: RuleDispositionReport['unresolvedWork'][number][] = [];
  for (const [key, coverage] of Object.entries(coverageRegistry)) {
    if (coverage.implementation !== undefined) implementation += 1;
    if (coverage.adjudicationContext !== undefined) {
      adjudicationContext += 1;
      adjudicationContextInventory.push({
        key,
        contextRequirement: coverage.adjudicationContext.dmContext,
      });
    }
    if (
      coverage.implementation === undefined &&
      coverage.adjudicationContext === undefined &&
      coverage.knownLimits.length === 0
    )
      noRuntimeStatement += 1;
    for (const limit of coverage.knownLimits) {
      knownLimits[limit.limit].push({
        key,
        statement: limit.statement,
        findingId: limit.findingId,
        ...(limit.designOwner === undefined
          ? {}
          : { designOwner: limit.designOwner }),
      });
      unresolvedWork.push({
        key,
        kind: limit.limit,
        detail: limit.statement,
        findingId: limit.findingId,
        ...(limit.designOwner === undefined
          ? {}
          : { historicalBead: limit.designOwner }),
      });
      for (const { clause, bead, findingId } of limit.externalClauses ?? []) {
        externalClauses.push({ key, clause, bead, findingId });
        unresolvedWork.push({
          key,
          kind: 'external-clause',
          detail: clause,
          findingId,
          historicalBead: bead,
        });
      }
    }
  }

  const byKey = <T extends { key: string }>(a: T, b: T) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  const deterministicCapabilitySourceOutcomes: RuleDispositionReport['deterministicCapabilitySourceOutcomes'][number][] =
    [];
  for (const [ruleKey, coverage] of Object.entries(coverageRegistry)) {
    if (coverage.implementation === undefined) continue;
    const capabilities = RULE_DETERMINISTIC_CAPABILITY_BINDINGS.filter(
      (binding) => binding.ruleKey === ruleKey,
    ).map(({ capability }) => capability);
    if (capabilities.length > 0) {
      deterministicCapabilitySourceOutcomes.push({
        ruleKey,
        outcome: 'bound',
        capabilities,
        coverageRuntimeOwner: coverage.implementation.runtimeOwner,
        coverageEvidence: coverage.implementation.evidence,
      });
      continue;
    }
    const disposition = RULE_DETERMINISTIC_CAPABILITY_DISPOSITIONS[ruleKey];
    if (disposition !== undefined)
      deterministicCapabilitySourceOutcomes.push({
        ...disposition,
        coverageRuntimeOwner: coverage.implementation.runtimeOwner,
        coverageEvidence: coverage.implementation.evidence,
      });
  }
  return {
    scope: 'rule-record-classification-only',
    referencesProse,
    definitions,
    tableBacked,
    duplicates,
    engineProcedure: {
      implementation,
      adjudicationContext,
      noRuntimeStatement,
      knownLimits: {
        partial: knownLimits.partial.sort(byKey),
        unimplemented: knownLimits.unimplemented.sort(byKey),
        deferred: knownLimits.deferred.sort(byKey),
      },
      externalClauses: externalClauses.sort(
        (a, b) => byKey(a, b) || (a.clause < b.clause ? -1 : 1),
      ),
    },
    adjudicationContextInventory: adjudicationContextInventory.sort(byKey),
    deterministicCapabilities: Object.values(
      ruleDispositionReportCapabilityContracts(
        RULE_DETERMINISTIC_CAPABILITY_CONTRACTS,
      ),
    ).sort((a, b) => a.revision.localeCompare(b.revision)),
    deterministicCapabilitySourceOutcomes:
      deterministicCapabilitySourceOutcomes.sort((a, b) =>
        a.ruleKey.localeCompare(b.ruleKey),
      ),
    unresolvedWork: unresolvedWork.sort(byKey),
  };
}
