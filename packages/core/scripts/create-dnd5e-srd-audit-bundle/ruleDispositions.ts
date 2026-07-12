/**
 * Rule-record disposition & engine-procedure coverage layer
 * (eshyra-o9bd.18.7.8.1).
 *
 * Mirrors the enforcement style of `GAMEPLAY_READINESS_DISPOSITIONS` in
 * `cli.ts`: a fail-closed, exact-membership registry over every `rule:*`
 * pack record. Kept in a sibling module (not inline in cli.ts) purely for
 * file-size reasons — it is wired into the same audit-bundle build path via
 * `assertRuleDispositions`.
 *
 * Two independent registries, deliberately not nested (design doc §2,
 * docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-8-1-rule-disposition-layer-design.md):
 *
 * - `RULE_DISPOSITIONS` — *what is this rule?* Exactly one of
 *   reference-prose / definition / engine-procedure / table-backed /
 *   duplicate per the 2026-07-06 rule-classification artifact (335 rows).
 * - `ENGINE_PROCEDURE_COVERAGE` — *is its deterministic behavior actually
 *   covered?* Exactly one of implemented / model-adjudicated-supported /
 *   partial / unimplemented / design-blocked per every `engine-procedure`
 *   key (175 rows), seeded from the 2026-07-06 execution-boundary
 *   classification artifact. A row's disposition class never implies its
 *   coverage status — `engine-procedure` is never blanket-green.
 *
 * Both registries are transcribed mechanically from their source artifacts
 * (docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-8-rule-classification.md
 * and .../2026-07-06-o9bd-18-7-8-execution-boundary-classification.md) —
 * regenerate via the same parse when either artifact changes, don't
 * hand-edit around a stale key set.
 */

import { DEFAULT_TOOLS } from '../../src/orchestrator/tools.js';
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
    'rule:attack': {
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
    'rule:cast-a-spell': {
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
      note: "spellcasting: spell assumes the slot's level; scaling applies per structured per-spell `scaling` (promoted from DEF: deterministic upcasting procedure)",
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
    'rule:dash': {
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
    'rule:disengage': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'action: no opportunity attacks this turn',
    },
    'rule:dodge': {
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
    'rule:help': {
      class: 'engine-procedure',
      family: 'combat-core',
      note: 'action: advantage grant, 5-ft attack aid',
    },
    'rule:hide': {
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
    'rule:ready': {
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
    'rule:search': {
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
    'rule:use-an-object': {
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

export type RuleCoverageStatus =
  | 'implemented'
  | 'model-adjudicated-supported'
  | 'partial'
  | 'unimplemented'
  | 'design-blocked';

export interface RuleProcedureCoverage {
  readonly status: RuleCoverageStatus;
  /** Repo-relative code path(s). Required for 'implemented'; present for a
   *  'partial' row when code owns part of the behavior. */
  readonly runtimeOwner?: readonly string[];
  /** Test file(s) exercising the behavior. Required for 'implemented'. */
  readonly evidence?: readonly string[];
  /** Registered tool names the row's model-adjudication relies on;
   *  required for 'model-adjudicated-supported', each checked against
   *  DEFAULT_TOOLS. */
  readonly primitives?: readonly string[];
  /** What must be retrievable/structured at play time; required for
   *  'model-adjudicated-supported'. */
  readonly contextRequirement?: string;
  /** Optional forward-reference, e.g. "F3's active-effect registry will
   *  improve visibility". */
  readonly dependencyNote?: string;
  /** Exact missing semantics; required for 'partial' and carried for
   *  'unimplemented' rows for readability. May name a shared primitive
   *  family (F1-F10) or design decision (D1/D2). */
  readonly missing?: string;
  /** Bead owning the design decision; required for 'design-blocked'. */
  readonly designOwner?: string;
  /** Clause-level external ownership: the row's primary status stands and
   *  bead closure alone never auto-upgrades it — closing requires new
   *  runtime/pack evidence in a reviewed diff. */
  readonly externalClauses?: readonly { clause: string; bead: string }[];
}

export const ENGINE_PROCEDURE_COVERAGE: Readonly<
  Record<string, RuleProcedureCoverage>
> = Object.freeze({
  'rule:a-clear-path-to-the-target': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement:
      'targeting/obstruction ruling; no grid; rule text retrievable',
  },
  'rule:abilities': {
    status: 'implemented',
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
    status: 'implemented',
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
    status: 'partial',
    missing: 'generic 1-30 range validation on non-PC ability writes → F8',
    runtimeOwner: [
      'packages/core/src/character/abilities.ts',
      'packages/core/src/character/derivedValues.ts',
    ],
  },
  'rule:activating-an-item': {
    status: 'model-adjudicated-supported',
    primitives: [
      'close_combat_instance',
      'lookup_rules',
      'roll',
      'start_encounter',
      'update_combatant',
    ],
    contextRequirement:
      'activation-vs-Use-an-Object distinction is a per-turn ruling',
  },
  'rule:advantage-and-disadvantage': {
    status: 'implemented',
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
  'rule:ammunition': {
    status: 'model-adjudicated-supported',
    primitives: ['give_item', 'lookup_rules', 'remove_item', 'roll'],
    contextRequirement: 'statblock convention; inventory + ledger suffice',
  },
  'rule:areas-of-effect': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'narrative geometry; shape rows retrievable',
  },
  'rule:armor-guidance': {
    status: 'partial',
    missing:
      'per-armor stats structured; penalty application per roll stays a ruling; missing: AC derivation from equipped armor (base + Dex, medium cap 2, heavy flat, shield +2) — `derivedValues.ts` defers AC/attack bonuses to eshyra-b69j.13 (externally owned clause); per-record payload completeness clause → eshyra-o9bd.18.7.6',
    externalClauses: [
      {
        clause: 'AC derivation from equipped armor',
        bead: 'eshyra-b69j.13',
      },
      {
        clause: 'per-record armor payload completeness',
        bead: 'eshyra-o9bd.18.7.6',
      },
    ],
  },
  'rule:armor-weapon-and-tool-proficiencies': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'default statblock assumption; no state',
  },
  'rule:attack': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'resolve_check', 'spend_turn_resource'],
    contextRequirement:
      'one-attack grant adjudicated; the action spend itself is checkable via the F2 turn budget (spend_turn_resource); attack counting stays adjudicated (Extra Attack/Multiattack feature-dependent); the attack roll itself resolves via resolve_check',
  },
  'rule:attack-rolls': {
    status: 'implemented',
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
    status: 'implemented',
    runtimeOwner: [
      'packages/core/src/state/attunement.ts',
      'packages/core/src/orchestrator/toolAttuneItem.ts',
      'packages/core/src/orchestrator/toolEndAttunement.ts',
    ],
    evidence: ['packages/core/test/attunement.test.ts'],
  },
  'rule:backgrounds-equipment': {
    status: 'partial',
    missing:
      'coin-purchase alternative + package-XOR-coin gate in the code-owned creation flow → F8',
    runtimeOwner: [
      'packages/core/src/character/srdStartingEquipmentGrants.ts',
      'packages/core/src/character/srdEquipmentPacks.ts',
    ],
  },
  'rule:backgrounds-proficiencies': {
    status: 'unimplemented',
    missing:
      'F8: duplicate-proficiency replacement is a creation-engine validator; creation is a code-owned flow, so the gap is engine work (small)',
  },
  'rule:being-prone': {
    status: 'model-adjudicated-supported',
    primitives: ['add_condition', 'lookup_rules', 'remove_condition', 'roll'],
    contextRequirement: 'prone condition + movement-cost ruling',
  },
  'rule:beyond-1st-level': {
    status: 'partial',
    missing:
      'rolled-HP via seeded dice, ASI-cap-20 enforcement at improvement time → F8',
    runtimeOwner: ['packages/core/src/character/levelUpEngine.ts'],
  },
  'rule:blindsight': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'per-creature radii structured; detection ruling',
  },
  'rule:bonus-action': {
    status: 'implemented',
    runtimeOwner: [
      'packages/core/src/state/actionEconomy.ts',
      'packages/core/src/orchestrator/toolSpendTurnResource.ts',
    ],
    evidence: ['packages/core/test/actionEconomy.test.ts'],
  },
  'rule:bonus-actions': {
    status: 'implemented',
    runtimeOwner: [
      'packages/core/src/state/actionEconomy.ts',
      'packages/core/src/orchestrator/toolSpendTurnResource.ts',
    ],
    evidence: ['packages/core/test/actionEconomy.test.ts'],
  },
  'rule:breaking-up-your-move': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'narrative movement',
  },
  'rule:burrow': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'movement-mode ruling; speeds structured',
  },
  'rule:casting-a-spell-at-a-higher-level': {
    status: 'partial',
    missing:
      'choosing to upcast is a ruling; missing: upcast scaling transform (extra dice/targets per slot level above base, from structured `scaling`) → F9',
  },
  'rule:casting-a-spell-attack-rolls': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement:
      'spellAttackModifier code-owned for PCs; monster values structured; within-5-ft clause is a per-roll ruling',
  },
  'rule:casting-a-spell-range': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'narrative range/targeting validation',
  },
  'rule:casting-a-spell-saving-throws': {
    status: 'partial',
    missing:
      'special-modifier application in derivation; item-bonus data clause → eshyra-o9bd.18.7.7.2; application hook → F8',
    runtimeOwner: ['packages/core/src/character/derivedValues.ts'],
    externalClauses: [
      {
        clause: 'item-bonus special-modifier data',
        bead: 'eshyra-o9bd.18.7.7.2',
      },
    ],
  },
  'rule:casting-in-armor': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement:
      'armor-proficiency data structured; gate is per-cast check',
  },
  'rule:channel-divinity': {
    status: 'design-blocked',
    designOwner: 'eshyra-2n1t.1',
  },
  'rule:charges': {
    status: 'partial',
    missing:
      'identify-reveal clause MODEL; pack-side charge data clause → eshyra-o9bd.18.7.7.1 (until it lands, the DM declares an item economy on first spend from lookup_rules); live expenditure/recharge state landed with F5 (spend_usage/restore_usage/reset_usage)',
    runtimeOwner: [
      'packages/core/src/state/usageCounters.ts',
      'packages/core/src/orchestrator/toolSpendUsage.ts',
    ],
    externalClauses: [
      {
        clause: 'pack-side charge data',
        bead: 'eshyra-o9bd.18.7.7.1',
      },
    ],
  },
  'rule:class-features': {
    status: 'design-blocked',
    designOwner: 'eshyra-2n1t.1',
  },
  'rule:climb': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'cost-exemption ruling; speeds structured',
  },
  'rule:climbing-swimming-and-crawling': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'movement-cost ruling',
  },
  'rule:coinage': {
    status: 'model-adjudicated-supported',
    primitives: [
      'convert_currency',
      'gain_currency',
      'lookup_rules',
      'spend_currency',
    ],
    contextRequirement:
      'acting wallet snapshot; transaction intent and coin-weight ruling',
  },
  'rule:combat-step-by-step': {
    status: 'model-adjudicated-supported',
    primitives: [
      'close_combat_instance',
      'lookup_rules',
      'roll',
      'start_encounter',
      'update_combatant',
    ],
    contextRequirement:
      "encounter lifecycle state code-owned; the 5-step narration procedure is the DM's job",
  },
  'rule:combining-magical-effects': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement:
      "same-effect non-stacking ruling; F3's active-effect registry will improve visibility (dependency note, not a blocker)",
  },
  'rule:command-word': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'silence/sound gating ruling',
  },
  'rule:complex-traps': {
    status: 'model-adjudicated-supported',
    primitives: [
      'close_combat_instance',
      'lookup_rules',
      'roll',
      'start_encounter',
      'update_combatant',
    ],
    contextRequirement:
      'trap initiative/actions procedure; encounter tools suffice',
  },
  'rule:concentration': {
    status: 'unimplemented',
    missing:
      'F3: durable concentration marker, auto Con save DC max(10, ⌊dmg/2⌋) on every damage instance, single-instance invariant, break conditions — high-frequency cross-turn state machine',
  },
  'rule:cone': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'geometry ruling',
  },
  'rule:conflict': {
    status: 'partial',
    missing:
      "contest procedure model-adjudicated over seeded dice; the 1/dawn control-attempt limit is hostable as a declared F5 usage counter (maxUses 1, reset dawn); missing: durable charmed 1d12 h duration and repeat-on-damage save trigger → F3's active-effect lifecycle",
  },
  'rule:constitution-hit-points': {
    status: 'partial',
    missing: 'retroactive hp_max recalc on Con-mod change → F8',
    runtimeOwner: ['packages/core/src/character/levelUpEngine.ts'],
  },
  'rule:consumables': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'remove_item', 'roll'],
    contextRequirement:
      'one-shot consumption = `remove_item` mutation; supported today',
  },
  'rule:contests': {
    status: 'implemented',
    runtimeOwner: [
      'packages/core/src/orchestrator/resolution.ts',
      'packages/core/src/orchestrator/toolResolveContest.ts',
    ],
    evidence: [
      'packages/core/test/resolution.test.ts',
      'packages/core/test/resolutionTools.test.ts',
    ],
  },
  'rule:controlling-a-mount': {
    status: 'model-adjudicated-supported',
    primitives: [
      'close_combat_instance',
      'lookup_rules',
      'roll',
      'start_encounter',
      'update_combatant',
    ],
    contextRequirement:
      'controlled/independent ruling; initiative sync narratable',
  },
  'rule:cover': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'resolve_check'],
    contextRequirement:
      'degree-of-cover selection is the classic ruling; the ±2/±5 AC and Dex-save bonuses ride resolve_check declared modifiers (composition owned by rule:modifiers-to-the-roll)',
  },
  'rule:crafting': {
    status: 'partial',
    missing:
      'deterministic crafting cost/progress arithmetic is not exposed as a registered calculation primitive',
  },
  'rule:critical-hits': {
    status: 'implemented',
    runtimeOwner: [
      'packages/core/src/orchestrator/resolution.ts',
      'packages/core/src/orchestrator/toolResolveDamage.ts',
    ],
    evidence: [
      'packages/core/test/resolution.test.ts',
      'packages/core/test/resolutionTools.test.ts',
    ],
  },
  'rule:cube': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'geometry ruling',
  },
  'rule:customizing-a-background': {
    status: 'design-blocked',
    designOwner: 'eshyra-2n1t.2',
  },
  'rule:cylinder': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'geometry ruling',
  },
  'rule:damage-resistance-and-vulnerability': {
    status: 'implemented',
    runtimeOwner: [
      'packages/core/src/orchestrator/resolution.ts',
      'packages/core/src/orchestrator/toolResolveDamage.ts',
    ],
    evidence: ['packages/core/test/resolution.test.ts'],
  },
  'rule:damage-rolls': {
    status: 'implemented',
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
  'rule:darkvision': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'lighting-substitution ruling; radii structured',
  },
  'rule:dash': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'extra-movement grant; narrative movement',
  },
  'rule:death-saving-throws': {
    status: 'implemented',
    runtimeOwner: [
      'packages/core/src/state/hpLifecycle.ts',
      'packages/core/src/orchestrator/toolRecordDeathSave.ts',
    ],
    evidence: ['packages/core/test/hpLifecycle.test.ts'],
  },
  'rule:detecting-and-disabling-a-trap': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement:
      'check-based procedure; seeded rolls + trap DCs retrievable',
  },
  'rule:dexterity-attack-rolls-and-damage': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'which-ability ruling; finesse tags structured',
  },
  'rule:dexterity-initiative': {
    status: 'model-adjudicated-supported',
    primitives: [
      'close_combat_instance',
      'lookup_rules',
      'roll',
      'start_encounter',
      'update_combatant',
    ],
    contextRequirement:
      'initiative rolls + combatant state code-owned; ordering visible',
  },
  'rule:disengage': {
    status: 'model-adjudicated-supported',
    primitives: [
      'add_condition',
      'close_combat_instance',
      'lookup_rules',
      'remove_condition',
      'roll',
      'start_encounter',
      'update_combatant',
    ],
    contextRequirement:
      'until-end-of-turn effect; condition entry representable',
  },
  'rule:dodge': {
    status: 'model-adjudicated-supported',
    primitives: [
      'add_condition',
      'close_combat_instance',
      'lookup_rules',
      'remove_condition',
      'roll',
      'start_encounter',
      'update_combatant',
    ],
    contextRequirement:
      'until-next-turn effect representable as combatant condition; per-roll adv/dis application',
  },
  'rule:downtime-activities': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll', 'update_clock'],
    contextRequirement: '8 h/day scheduling ruling; clock owned',
  },
  'rule:equipment': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'component default assumption',
  },
  'rule:expenses-lifestyle-expenses': {
    status: 'partial',
    missing:
      'deterministic per-day lifestyle-cost multiplication is not exposed as a registered calculation primitive',
  },
  'rule:experience-points': {
    status: 'partial',
    missing: 'multiclass total-level clause → D1',
    runtimeOwner: ['packages/core/src/rules/advancementTable.ts'],
  },
  'rule:extra-attack': {
    status: 'design-blocked',
    designOwner: 'eshyra-2n1t.1',
  },
  'rule:falling': {
    status: 'model-adjudicated-supported',
    primitives: [
      'calc',
      'resolve_damage',
      'adjust_hp',
      'update_combatant',
      'add_condition',
      'lookup_rules',
    ],
    contextRequirement:
      'fall-distance determination and landing narration stay rulings; the dice derivation is code-owned via calc fall_damage_dice (⌊d/10⌋d6 cap 20d6) and the roll via resolve_damage, whose result is applied through adjust_hp (party) / update_combatant (monsters); landing prone via a condition entry',
  },
  'rule:falling-unconscious': {
    status: 'implemented',
    runtimeOwner: [
      'packages/core/src/state/hpLifecycle.ts',
      'packages/core/src/orchestrator/toolAdjustHp.ts',
    ],
    evidence: ['packages/core/test/hpLifecycle.test.ts'],
  },
  'rule:feats': {
    status: 'design-blocked',
    designOwner: 'eshyra-2n1t.2',
  },
  'rule:fly': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'hover/death-fall ruling; flags structured',
  },
  'rule:flying-movement': {
    status: 'model-adjudicated-supported',
    primitives: ['add_condition', 'lookup_rules', 'remove_condition', 'roll'],
    contextRequirement: 'fall-when-prone/speed-0 ruling',
  },
  'rule:food': {
    status: 'model-adjudicated-supported',
    primitives: ['calc', 'add_condition', 'update_clock', 'lookup_rules'],
    contextRequirement:
      'deprivation-day state stays durable character condition entries and the low-frequency clock stays model-adjudicated (as classified); the 3+Con-mod (min 1) day-threshold derivation is code-owned via calc days_without_food_limit',
  },
  'rule:food-and-water': {
    status: 'model-adjudicated-supported',
    primitives: [
      'add_condition',
      'lookup_rules',
      'remove_condition',
      'roll',
      'update_clock',
    ],
    contextRequirement:
      "as `food` (condition-entry state, clock model-adjudicated); no formula of its own — this row is the exhaustion-not-removable-until-fed gate, a rest-time ruling (F7 hook noted); the deprivation-day arithmetic itself is `food`'s clause, not duplicated here",
  },
  'rule:gaining-inspiration': {
    status: 'implemented',
    runtimeOwner: [
      'packages/core/src/state/inspiration.ts',
      'packages/core/src/orchestrator/toolAwardInspiration.ts',
    ],
    evidence: ['packages/core/test/inspiration.test.ts'],
  },
  'rule:grapple-rules-for-monsters': {
    status: 'implemented',
    runtimeOwner: [
      'packages/core/src/orchestrator/calc.ts',
      'packages/core/src/orchestrator/toolCalc.ts',
    ],
    evidence: ['packages/core/test/calc.test.ts'],
  },
  'rule:grappling': {
    status: 'model-adjudicated-supported',
    primitives: ['add_condition', 'lookup_rules', 'remove_condition', 'roll'],
    contextRequirement:
      'contest rolls + grappled condition + half-speed drag ruling',
  },
  'rule:group-checks': {
    status: 'implemented',
    runtimeOwner: [
      'packages/core/src/orchestrator/calc.ts',
      'packages/core/src/orchestrator/resolution.ts',
    ],
    evidence: [
      'packages/core/test/calc.test.ts',
      'packages/core/test/resolutionTools.test.ts',
    ],
  },
  'rule:half-dragon-template': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'GM-time content-creation procedure; tables structured',
  },
  'rule:healing': {
    status: 'implemented',
    runtimeOwner: [
      'packages/core/src/state/hpLifecycle.ts',
      'packages/core/src/orchestrator/toolAdjustHp.ts',
    ],
    evidence: [
      'packages/core/test/hpLifecycle.test.ts',
      'packages/core/test/domainMutations.test.ts',
    ],
  },
  'rule:help': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'advantage grant; per-roll',
  },
  'rule:hide': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'Stealth check per hiding ruling',
  },
  'rule:hiding': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'resolve_contest', 'calc'],
    contextRequirement:
      'Stealth contest and hiding eligibility are rulings; the contest resolves via resolve_contest and passive scores via calc passive_score (owned by rule:passive-checks)',
  },
  'rule:hit-points': {
    status: 'model-adjudicated-supported',
    primitives: ['adjust_hp', 'lookup_rules', 'roll'],
    contextRequirement:
      'per-creature HP/HD structured; the size-die formula is GM-time creature design',
  },
  'rule:hit-points-and-hit-dice': {
    status: 'design-blocked',
    designOwner: 'eshyra-2n1t.1',
  },
  'rule:improvised-weapons': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement:
      '1d4 / proficiency-analogy ruling; per-record payload clause → eshyra-o9bd.18.7.6',
    externalClauses: [
      {
        clause: 'per-record payload completeness',
        bead: 'eshyra-o9bd.18.7.6',
      },
    ],
  },
  'rule:innate-spellcasting': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll', 'spend_usage', 'update_clock'],
    contextRequirement:
      'statblock convention; per-creature entries structured; the X/day usage economies are code-owned once by the F5 usage counters (spend_usage derives per-day innate groups from the record — single-owner factoring)',
  },
  'rule:instant-death': {
    status: 'implemented',
    runtimeOwner: [
      'packages/core/src/state/hpLifecycle.ts',
      'packages/core/src/orchestrator/toolAdjustHp.ts',
    ],
    evidence: ['packages/core/test/hpLifecycle.test.ts'],
  },
  'rule:interacting-with-objects': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'GM-set object stats; auto-fail/immunity rulings',
  },
  'rule:jumping': {
    status: 'model-adjudicated-supported',
    primitives: ['calc', 'resolve_check', 'lookup_rules'],
    contextRequirement:
      'movement-cost accounting and the optional obstacle/landing checks stay rulings; the long/high-jump distance formulas are code-owned via calc jump_distance',
  },
  'rule:knocking-a-creature-out': {
    status: 'model-adjudicated-supported',
    primitives: [
      'add_condition',
      'adjust_hp',
      'lookup_rules',
      'remove_condition',
      'roll',
    ],
    contextRequirement:
      'declared choice at damage time → unconscious+stable conditions (durable once F6 defines stable)',
  },
  'rule:lair-actions': {
    status: 'model-adjudicated-supported',
    primitives: [
      'close_combat_instance',
      'lookup_rules',
      'roll',
      'start_encounter',
      'update_combatant',
    ],
    contextRequirement:
      "initiative-20 scheduling ruling; once-per-round is structural when the lair is entered as an initiative-20 combatant in the code-owned turn order; F5's per-round reset vocabulary can host the no-repeat clause if drift is observed",
  },
  'rule:legendary-actions': {
    status: 'implemented',
    runtimeOwner: [
      'packages/core/src/state/actionEconomy.ts',
      'packages/core/src/orchestrator/toolSpendTurnResource.ts',
    ],
    evidence: ['packages/core/test/actionEconomy.test.ts'],
  },
  'rule:legendary-creatures': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement:
      'form-assumption exclusion gate; ruling over structured data',
  },
  'rule:lifting-and-carrying': {
    status: 'model-adjudicated-supported',
    primitives: ['calc', 'add_condition', 'lookup_rules'],
    contextRequirement:
      'tracking what is carried and applying the over-capacity speed-5 penalty stay adjudicated over inventory + condition entries; the capacity arithmetic (Str×15, push/drag ×2, size doubling) is code-owned via calc carry_capacity',
  },
  'rule:limited-usage': {
    status: 'implemented',
    runtimeOwner: [
      'packages/core/src/state/usageCounters.ts',
      'packages/core/src/orchestrator/toolSpendUsage.ts',
      'packages/core/src/orchestrator/toolRestoreUsage.ts',
      'packages/core/src/orchestrator/toolResetUsage.ts',
    ],
    evidence: ['packages/core/test/usageCounters.test.ts'],
  },
  'rule:line': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'geometry ruling',
  },
  'rule:long-rest': {
    status: 'unimplemented',
    missing:
      'F7: 8 h gate, 1/24 h, ≥1 HP requirement, full HP + half-HD restore, resource reset orchestration (hooks F4/F5)',
  },
  'rule:longer-casting-times': {
    status: 'model-adjudicated-supported',
    primitives: [
      'add_condition',
      'close_combat_instance',
      'lookup_rules',
      'remove_condition',
      'roll',
      'start_encounter',
      'update_combatant',
    ],
    contextRequirement:
      'rare multi-turn casting; in-progress state durably representable as a character condition entry (readable in context); slot-kept-on-break ruling',
  },
  'rule:madness-effects': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll', 'update_clock'],
    contextRequirement: 'table rolls + durations; seeded dice + clock',
  },
  'rule:making-an-attack': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: '3-step narration procedure over code-owned rolls',
  },
  'rule:material-m': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement:
      'focus/pouch substitution + cost-component gating rulings; per-spell components structured',
  },
  'rule:melee-attacks': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'resolve_check', 'resolve_damage'],
    contextRequirement:
      'reach semantics are rulings; unarmed 1 + Str composition rides resolve_damage declared modifiers',
  },
  'rule:modifiers-to-the-roll': {
    status: 'implemented',
    runtimeOwner: [
      'packages/core/src/orchestrator/resolution.ts',
      'packages/core/src/orchestrator/toolResolutionShared.ts',
    ],
    evidence: ['packages/core/test/resolution.test.ts'],
  },
  'rule:mounted-combat': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'eligibility gate ruling (size/anatomy/willing)',
  },
  'rule:mounting-and-dismounting': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'movement-cost + save rulings',
  },
  'rule:mounts-and-vehicles': {
    status: 'model-adjudicated-supported',
    primitives: ['calc', 'give_item', 'lookup_rules', 'spend_currency'],
    contextRequirement:
      'purchase availability and mount selection ruling; acting wallet and carry-capacity context',
    runtimeOwner: ['packages/core/src/orchestrator/calc.ts'],
  },
  'rule:movement-and-position': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'budget-spending narration',
  },
  'rule:movement-and-position-difficult-terrain': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement:
      '+1 ft/ft cost — narrative-magnitude arithmetic; movement costs live only in narration (boundary rule 1)',
  },
  'rule:moving-around-other-creatures': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'pass-through/occupancy ruling',
  },
  'rule:moving-between-attacks': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'narrative movement',
  },
  'rule:multiattack': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement:
      'no-OA restriction ruling; routines structured (18.7.9)',
  },
  'rule:multiclassing': {
    status: 'design-blocked',
    designOwner: 'eshyra-2n1t.1',
  },
  'rule:multiclassing-proficiency-bonus': {
    status: 'design-blocked',
    designOwner: 'eshyra-2n1t.1',
  },
  'rule:objects': {
    status: 'model-adjudicated-supported',
    primitives: ['adjust_hp', 'lookup_rules', 'roll'],
    contextRequirement: 'AC/HP tables structured; threshold/immunity rulings',
  },
  'rule:opportunity-attacks': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll', 'spend_turn_resource'],
    contextRequirement:
      'trigger/exclusion ruling; the reaction spend is code-owned (F2 turn budget)',
  },
  'rule:other-activity-on-your-turn': {
    status: 'implemented',
    runtimeOwner: [
      'packages/core/src/state/actionEconomy.ts',
      'packages/core/src/orchestrator/toolSpendTurnResource.ts',
    ],
    evidence: ['packages/core/test/actionEconomy.test.ts'],
  },
  'rule:paired-items': {
    status: 'model-adjudicated-supported',
    primitives: ['give_item', 'lookup_rules', 'remove_item', 'roll'],
    contextRequirement: 'both-of-pair requirement ruling; inventory visible',
  },
  'rule:passive-checks': {
    status: 'implemented',
    runtimeOwner: [
      'packages/core/src/orchestrator/calc.ts',
      'packages/core/src/orchestrator/toolCalc.ts',
    ],
    evidence: ['packages/core/test/calc.test.ts'],
  },
  'rule:poisons': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement:
      'delivery-type exposure rulings; hazard data structured',
  },
  'rule:practicing-a-profession': {
    status: 'partial',
    missing:
      'deterministic profession-earnings arithmetic is not exposed as a registered calculation primitive',
  },
  'rule:proficiency-bonus': {
    status: 'implemented',
    runtimeOwner: [
      'packages/core/src/orchestrator/resolution.ts',
      'packages/core/src/character/derivedValues.ts',
      'packages/core/src/character/levelUpEngine.ts',
    ],
    evidence: ['packages/core/test/resolution.test.ts'],
  },
  'rule:range': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'normal/long-range disadv ruling; ranges structured',
  },
  'rule:ranged-attacks-in-close-combat': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'within-5-ft disadv ruling',
  },
  'rule:reactions': {
    status: 'implemented',
    runtimeOwner: [
      'packages/core/src/state/actionEconomy.ts',
      'packages/core/src/orchestrator/toolSpendTurnResource.ts',
      'packages/core/src/orchestrator/toolUpdateCombatant.ts',
    ],
    evidence: ['packages/core/test/actionEconomy.test.ts'],
  },
  'rule:ready': {
    status: 'model-adjudicated-supported',
    primitives: [
      'add_condition',
      'lookup_rules',
      'remove_condition',
      'roll',
      'spend_turn_resource',
    ],
    contextRequirement:
      'held trigger + readied-spell concentration representable as condition; the reaction spend is code-owned (F2 turn budget)',
  },
  'rule:recuperating': {
    status: 'model-adjudicated-supported',
    primitives: [
      'add_condition',
      'lookup_rules',
      'remove_condition',
      'roll',
      'update_clock',
    ],
    contextRequirement:
      'fixed DC 15, no derivation (not an arithmetic clause, so the `food`/`speed` correction does not apply); the 3-day counter is durably representable as a character condition entry over the owned clock (low-frequency state-ownership principle, as food/water)',
  },
  'rule:researching': {
    status: 'partial',
    missing:
      'deterministic per-day research-cost multiplication is not exposed as a registered calculation primitive',
  },
  'rule:rituals': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: '+10 min, no-slot casting; ritual flags structured',
  },
  'rule:rolling-1-or-20': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'resolve_check', 'roll'],
    contextRequirement:
      'natural die visible in rolls[]/natural; the F9 spec note landed — resolve_check vs-AC honors nat-20 auto-hit (critical) and nat-1 auto-miss on attacks only, never on checks/saves',
  },
  'rule:saving-throws': {
    status: 'implemented',
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
  'rule:search': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'check-based action',
  },
  'rule:self-sufficiency': {
    status: 'partial',
    missing:
      'deterministic lifestyle-offset arithmetic is not exposed as a registered calculation primitive',
  },
  'rule:selling-treasure': {
    status: 'partial',
    missing:
      'deterministic half/full-price resale transform is not exposed as a registered calculation primitive',
  },
  'rule:short-rest': {
    status: 'unimplemented',
    missing:
      'F7: HD spending needs a durable hit-dice pool (roll + Con each) and reset interaction',
  },
  'rule:shoving-a-creature': {
    status: 'model-adjudicated-supported',
    primitives: ['add_condition', 'lookup_rules', 'remove_condition', 'roll'],
    contextRequirement: 'contest → prone/push ruling',
  },
  'rule:silvered-weapons': {
    status: 'model-adjudicated-supported',
    primitives: ['give_item', 'lookup_rules', 'spend_currency'],
    contextRequirement:
      'silvering availability and item identity ruling; acting wallet snapshot',
  },
  'rule:somatic-s': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'free-hand gating ruling',
  },
  'rule:special-traits-spellcasting': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'statblock convention; entries structured',
  },
  'rule:special-weapons': {
    status: 'partial',
    missing:
      'generic semantics MODEL; missing per-record payloads (net restraint DC/AC, lance rules) — clause externally owned by eshyra-o9bd.18.7.6',
    externalClauses: [
      {
        clause: 'per-record payloads (net restraint DC/AC, lance rules)',
        bead: 'eshyra-o9bd.18.7.6',
      },
    ],
  },
  'rule:speed': {
    status: 'model-adjudicated-supported',
    primitives: ['calc', 'resolve_check', 'add_condition', 'lookup_rules'],
    contextRequirement:
      'travel pace, gallop, and movement rates/costs stay rulings (narrative-magnitude arithmetic; F2 deliberately excludes the movement budget); exhaustion as condition entry; the forced-march DC derivation is code-owned via calc forced_march_dc and the save via resolve_check',
  },
  'rule:speed-difficult-terrain': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'half-pace ruling',
  },
  'rule:spell-slots': {
    status: 'implemented',
    runtimeOwner: [
      'packages/core/src/state/spellSlots.ts',
      'packages/core/src/orchestrator/toolSpendSpellSlot.ts',
    ],
    evidence: ['packages/core/test/spellSlots.test.ts'],
  },
  'rule:spellcasting': {
    status: 'design-blocked',
    designOwner: 'eshyra-2n1t.1',
  },
  'rule:spells': {
    status: 'model-adjudicated-supported',
    primitives: ['give_item', 'lookup_rules', 'remove_item', 'roll'],
    contextRequirement:
      'item-casting procedure ruling; per-item spell data completeness → 18.7.7 corpus work',
    externalClauses: [
      {
        clause: 'per-item spell-data completeness',
        bead: 'eshyra-o9bd.18.7.7',
      },
    ],
  },
  'rule:sphere': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'geometry ruling',
  },
  'rule:squeezing-into-a-smaller-space': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'size/cost/disadv ruling',
  },
  'rule:stabilizing-a-creature': {
    status: 'partial',
    runtimeOwner: [
      'packages/core/src/state/hpLifecycle.ts',
      'packages/core/src/orchestrator/toolStabilizeCharacter.ts',
    ],
    missing:
      'durable 1d4 h → 1 HP stable-recovery deadline (seeded roll recorded at stabilize time + owned clock-resolution hook) → eshyra-2n1t.8.1; the stable flag, counter reset, and the stable → alive transition through adjust_hp are code-owned, but recovery scheduling is still model-prompted and can silently drift',
  },
  'rule:strength-attack-rolls-and-damage': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'which-ability ruling',
  },
  'rule:suffocating': {
    status: 'partial',
    missing:
      'breath duration formula (1+Con min, min 30 s) and the Con-mod round countdown are deterministic cross-turn counters that can silently drift; missing: countdown state — the 0-HP dying transition itself now lands through the adjust_hp death machine (F6)',
    runtimeOwner: ['packages/core/src/state/hpLifecycle.ts'],
  },
  'rule:surprise': {
    status: 'implemented',
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
  'rule:swim': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'cost-exemption ruling',
  },
  'rule:targeting-yourself': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'self-target eligibility ruling',
  },
  'rule:telepathy': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement:
      'communication semantics ruling; per-creature payloads (18.7.9 C3)',
    externalClauses: [
      {
        clause: 'per-creature payload contracts (18.7.9 C3 slice)',
        bead: 'eshyra-o9bd.18.7.9',
      },
    ],
  },
  'rule:temporary-hit-points': {
    status: 'implemented',
    runtimeOwner: [
      'packages/core/src/state/hpLifecycle.ts',
      'packages/core/src/orchestrator/toolGrantTempHp.ts',
    ],
    evidence: ['packages/core/test/hpLifecycle.test.ts'],
    dependencyNote:
      'long-rest expiry is exposed as the expireTemporaryHp reset hook; the rest engine (F7, eshyra-2n1t.9) wires it into the long-rest procedure',
  },
  'rule:the-order-of-combat': {
    status: 'model-adjudicated-supported',
    primitives: [
      'close_combat_instance',
      'lookup_rules',
      'roll',
      'start_encounter',
      'update_combatant',
    ],
    contextRequirement:
      "round/turn state code-owned; cycle narration is the DM's job",
  },
  'rule:the-order-of-combat-initiative': {
    status: 'model-adjudicated-supported',
    primitives: [
      'close_combat_instance',
      'lookup_rules',
      'roll',
      'start_encounter',
      'update_combatant',
    ],
    contextRequirement:
      'rolls + combatant state code-owned; group-roll/tie rulings',
  },
  'rule:training': {
    status: 'partial',
    missing:
      'deterministic 250 days × 1 gp training-cost arithmetic is not exposed as a registered calculation primitive',
  },
  'rule:tremorsense': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'ground-contact detection ruling',
  },
  'rule:truesight': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement:
      'auto-success bundle applied as per-event rulings; radii structured',
  },
  'rule:two-weapon-fighting': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'resolve_damage', 'spend_turn_resource'],
    contextRequirement:
      'light-property/weapon eligibility stays a ruling; omit-positive-ability-mod is an input choice on resolve_damage declared modifiers (composition owned by rule:damage-rolls); the bonus-attack spend landed with the F2 turn budget',
  },
  'rule:unarmored-defense': {
    status: 'design-blocked',
    designOwner: 'eshyra-2n1t.1',
  },
  'rule:underwater-combat': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'melee/ranged/fire-resistance rulings',
  },
  'rule:unseen-attackers-and-targets': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'adv/disadv + wrong-guess auto-miss rulings',
  },
  'rule:use-an-object': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll', 'spend_turn_resource'],
    contextRequirement:
      'action definition; the free-interaction/action budget is code-owned (F2 turn budget)',
  },
  'rule:using-different-speeds': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll', 'calc'],
    contextRequirement:
      "narrative-magnitude arithmetic (boundary rule 1): the movement budget is deliberately not code-owned, so the cross-mode subtraction operates on narrated quantities only; F9's calc primitive (landed) is an available aid, not a gap",
  },
  'rule:using-inspiration': {
    status: 'implemented',
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
  'rule:variant-encumbrance': {
    status: 'model-adjudicated-supported',
    primitives: ['calc', 'resolve_check', 'add_condition', 'lookup_rules'],
    contextRequirement:
      'variant adoption is a table ruling; classifying the current load and applying the speed penalties / Str-Dex-Con disadvantage (declared per roll on resolve_check) stay adjudicated; the 5×/10×/15×Str threshold arithmetic is code-owned via calc encumbrance_thresholds',
  },
  'rule:variant-skills-with-different-abilities': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'optional recombination ruling, play-time',
  },
  'rule:verbal-v': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'gag/silence gating ruling',
  },
  'rule:vision-and-light': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'obscurement/light-level rulings',
  },
  'rule:water': {
    status: 'model-adjudicated-supported',
    primitives: ['add_condition', 'lookup_rules', 'remove_condition', 'roll'],
    contextRequirement:
      'as `food`: condition-entry deprivation state + Con saves',
  },
  'rule:weapon-proficiency': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement: 'PB gating per roll over structured proficiencies',
  },
  'rule:weapon-properties': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'roll'],
    contextRequirement:
      'property semantics applied per roll over structured tags; per-record payload completeness clause → eshyra-o9bd.18.7.6',
    externalClauses: [
      {
        clause: 'per-record payload completeness',
        bead: 'eshyra-o9bd.18.7.6',
      },
    ],
  },
  'rule:wizard-your-spellbook': {
    status: 'partial',
    missing:
      'deterministic spell-copy cost-per-level multiplication is not exposed as a registered calculation primitive',
  },
  'rule:working-together': {
    status: 'model-adjudicated-supported',
    primitives: ['lookup_rules', 'resolve_check'],
    contextRequirement:
      'leader-rolls-with-advantage ruling (advantage via the resolve_check advantage flag)',
  },
  'rule:your-turn': {
    status: 'implemented',
    runtimeOwner: [
      'packages/core/src/state/actionEconomy.ts',
      'packages/core/src/orchestrator/toolBeginTurn.ts',
      'packages/core/src/orchestrator/toolSpendTurnResource.ts',
    ],
    evidence: ['packages/core/test/actionEconomy.test.ts'],
  },
});

/** Pinned semantic census (2026-07-06 rule-classification artifact, §2). */
const EXPECTED_SEMANTIC_CENSUS: Readonly<Record<RuleDispositionClass, number>> =
  Object.freeze({
    'engine-procedure': 175,
    'reference-prose': 96,
    definition: 33,
    'table-backed': 19,
    duplicate: 12,
  });

/**
 * Pinned execution-boundary coverage census. Seeded from the 2026-07-06
 * execution-boundary classification artifact (final revision, §3:
 * 0/97/47/21/10); updated by reviewed implementation diffs since —
 * eshyra-2n1t.8 (F6 death/dying/temp-HP machine) moved death-saving-throws,
 * falling-unconscious, instant-death and temporary-hit-points from
 * unimplemented and healing from partial to implemented, and
 * stabilizing-a-creature from unimplemented to partial (durable 1d4 h
 * recovery deadline outstanding → eshyra-2n1t.8.1); eshyra-2n1t.4 (F2
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
 * over the primitives. casting-a-spell-at-a-higher-level stays partial
 * (upcast scaling needs structured spell `scaling` data, landing with the
 * F4 interplay). F10 exposed the wallet, mutation invariants, persistence, and
 * audit trail, but deterministic resale and downtime-cost transforms remain
 * partial until registered calculation primitives own those numbers. The
 * reviewed census is now 31/109/21/4/10.
 */
const EXPECTED_COVERAGE_CENSUS: Readonly<Record<RuleCoverageStatus, number>> =
  Object.freeze({
    implemented: 31,
    'model-adjudicated-supported': 109,
    partial: 21,
    unimplemented: 4,
    'design-blocked': 10,
  });

const DEFAULT_TOOL_NAMES: ReadonlySet<string> = new Set(
  DEFAULT_TOOLS.map((tool) => tool.name),
);

/** Shape of a real bead ID, e.g. `eshyra-o9bd.18.7.6` or `eshyra-b69j.13`. */
const BEAD_ID_PATTERN = /^eshyra-[a-z0-9]+(\.[0-9]+)*$/;

/**
 * Registry-integrity check (design §3) over an arbitrary
 * (dispositions, coverage) pair: class invariants, coverage completeness,
 * status invariants, and census. Pack-independent and pure, so tests can
 * exercise each failure mode against small fixtures without the pinned
 * 335/175 census getting in the way (pass matching `expectedSemanticCensus`/
 * `expectedCoverageCensus` overrides). `assertRuleDispositions` is the
 * production entry point, applied to the real registries plus the
 * pack-key-diff check. Does NOT check runtimeOwner/evidence path existence
 * — that runs in tests (design §6) to keep the bundle build hermetic.
 */
export function validateRuleRegistries(
  dispositions: Readonly<Record<string, RuleDisposition>>,
  coverage: Readonly<Record<string, RuleProcedureCoverage>>,
  expectedSemanticCensus: Readonly<
    Record<RuleDispositionClass, number>
  > = EXPECTED_SEMANTIC_CENSUS,
  expectedCoverageCensus: Readonly<
    Record<RuleCoverageStatus, number>
  > = EXPECTED_COVERAGE_CENSUS,
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
  for (const [dispositionClass, expected] of Object.entries(
    expectedSemanticCensus,
  )) {
    const actual = censusByClass[dispositionClass] ?? 0;
    if (actual !== expected) {
      errors.push(
        `semantic census drift: ${dispositionClass} is ${actual}, expected ${expected} — update EXPECTED_SEMANTIC_CENSUS in a reviewed diff`,
      );
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

  const censusByStatus: Record<string, number> = {};
  for (const [key, coverageRow] of Object.entries(coverage)) {
    censusByStatus[coverageRow.status] =
      (censusByStatus[coverageRow.status] ?? 0) + 1;
    if (coverageRow.status === 'implemented') {
      if (!coverageRow.runtimeOwner || coverageRow.runtimeOwner.length === 0) {
        errors.push(`${key}: implemented row is missing runtimeOwner`);
      }
      if (!coverageRow.evidence || coverageRow.evidence.length === 0) {
        errors.push(`${key}: implemented row is missing evidence`);
      }
    }
    if (coverageRow.status === 'model-adjudicated-supported') {
      if (!coverageRow.primitives || coverageRow.primitives.length === 0) {
        errors.push(
          `${key}: model-adjudicated-supported row is missing primitives`,
        );
      } else {
        for (const primitive of coverageRow.primitives) {
          if (!DEFAULT_TOOL_NAMES.has(primitive)) {
            errors.push(
              `${key}: primitive '${primitive}' is not a registered DEFAULT_TOOLS name`,
            );
          }
        }
      }
      if (!coverageRow.contextRequirement) {
        errors.push(
          `${key}: model-adjudicated-supported row is missing contextRequirement`,
        );
      }
    }
    if (coverageRow.status === 'partial' && !coverageRow.missing) {
      errors.push(`${key}: partial row is missing 'missing'`);
    }
    if (coverageRow.status === 'design-blocked') {
      if (!coverageRow.designOwner) {
        errors.push(`${key}: design-blocked row is missing designOwner`);
      } else if (!BEAD_ID_PATTERN.test(coverageRow.designOwner)) {
        errors.push(
          `${key}: designOwner '${coverageRow.designOwner}' is not a real bead-id shape`,
        );
      }
    }
    // Clause-level external ownership (design §5 item 3): each clause must
    // name a real bead and a non-empty description — never a placeholder —
    // so a malformed cross-bead pointer can't silently pass review.
    for (const { clause, bead } of coverageRow.externalClauses ?? []) {
      if (!clause) {
        errors.push(`${key}: externalClauses entry is missing 'clause'`);
      }
      if (!BEAD_ID_PATTERN.test(bead)) {
        errors.push(
          `${key}: externalClauses bead '${bead}' is not a real bead-id shape`,
        );
      }
    }
  }
  for (const [status, expected] of Object.entries(expectedCoverageCensus)) {
    const actual = censusByStatus[status] ?? 0;
    if (actual !== expected) {
      errors.push(
        `coverage census drift: ${status} is ${actual}, expected ${expected} — update EXPECTED_COVERAGE_CENSUS in a reviewed diff`,
      );
    }
  }

  return errors;
}

/**
 * Fail-closed registry-integrity check (design §3) for the audit-bundle
 * build: new/stale `rule:*` pack keys against `RULE_DISPOSITIONS`, plus the
 * full `validateRuleRegistries` check over the real registries.
 */
function hasNonEmptyTableRefs(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false;
  const tableRefs = (data as Record<string, unknown>).tableRefs;
  return Array.isArray(tableRefs) && tableRefs.length > 0;
}

export function assertRuleDispositions(pack: RulesPack): readonly string[] {
  const errors: string[] = [];
  const ruleRecords = pack.records.filter((record) => record.kind === 'rule');
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
  );

  return errors;
}

export interface RuleDispositionReport {
  readonly referencesProse: number;
  readonly definitions: number;
  readonly tableBacked: number;
  readonly duplicates: number;
  readonly engineProcedure: {
    readonly implemented: number;
    readonly modelAdjudicatedSupported: number;
    /** Actionable gap list: key + missing semantics (design §4). */
    readonly partial: readonly {
      readonly key: string;
      readonly missing: string;
    }[];
    /** Transitional actionable gap list: key + missing semantics. */
    readonly unimplemented: readonly {
      readonly key: string;
      readonly missing: string;
    }[];
    /** key + design owner (design §4). */
    readonly designBlocked: readonly {
      readonly key: string;
      readonly designOwner: string;
    }[];
    /** Flattened key + clause + bead (design §4) — a row with multiple
     *  externally owned clauses (e.g. armor-guidance) contributes one entry
     *  per clause. */
    readonly externalClauses: readonly {
      readonly key: string;
      readonly clause: string;
      readonly bead: string;
    }[];
  };
}

/**
 * Readiness-report detail (design §4). Registry-integrity errors
 * (`assertRuleDispositions`) fail every build; these lists are visibility
 * only — partial/unimplemented/design-blocked rows are truthful, actionable
 * readiness gaps that stay visible without failing day-to-day CI. Detail
 * arrays (not just counts) so a reviewer can see exactly which keys and
 * clauses are outstanding without re-deriving them from the registry.
 */
export function buildRuleDispositionReport(): RuleDispositionReport {
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
  let implemented = 0;
  let modelAdjudicatedSupported = 0;
  const partial: { key: string; missing: string }[] = [];
  const unimplemented: { key: string; missing: string }[] = [];
  const designBlocked: { key: string; designOwner: string }[] = [];
  const externalClauses: { key: string; clause: string; bead: string }[] = [];
  for (const [key, coverage] of Object.entries(ENGINE_PROCEDURE_COVERAGE)) {
    if (coverage.status === 'implemented') implemented += 1;
    if (coverage.status === 'model-adjudicated-supported') {
      modelAdjudicatedSupported += 1;
    }
    if (coverage.status === 'partial') {
      partial.push({ key, missing: coverage.missing ?? '' });
    }
    if (coverage.status === 'unimplemented') {
      unimplemented.push({ key, missing: coverage.missing ?? '' });
    }
    if (coverage.status === 'design-blocked') {
      designBlocked.push({ key, designOwner: coverage.designOwner ?? '' });
    }
    for (const { clause, bead } of coverage.externalClauses ?? []) {
      externalClauses.push({ key, clause, bead });
    }
  }
  const byKey = <T extends { key: string }>(a: T, b: T) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  return {
    referencesProse,
    definitions,
    tableBacked,
    duplicates,
    engineProcedure: {
      implemented,
      modelAdjudicatedSupported,
      partial: partial.sort(byKey),
      unimplemented: unimplemented.sort(byKey),
      designBlocked: designBlocked.sort(byKey),
      externalClauses: externalClauses.sort(
        (a, b) => byKey(a, b) || (a.clause < b.clause ? -1 : 1),
      ),
    },
  };
}
