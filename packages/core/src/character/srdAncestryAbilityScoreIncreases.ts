/**
 * Source-backed ancestry ability-score-increase overlay (eshyra-b69j.12.1).
 *
 * Each D&D 5e SRD ancestry grants ability-score increases, but in the frozen
 * generated pack (`rules:dnd5e-srd-5.1`) those bonuses live only in the prose of
 * the ancestry's "Ability Score Increase" trait (e.g. ancestry:elf carries the
 * sentence "Your Dexterity score increases by 2."). Character creation must not
 * parse that prose to discover a core mechanical choice
 * (`docs/design/character-creation-cli.md`), and `deriveLevel1Values` left final
 * ability scores equal to base scores for exactly this reason (eshyra-b69j.6).
 *
 * The pack is a frozen, hash-pinned, signed-off artifact
 * (`docs/audits/dnd5e-srd-5.1-final/`; guard via
 * `npm run verify:dnd5e-srd-freeze`), so the gap is NOT filled by re-running the
 * importer or regenerating the pack. Instead this module is the sanctioned
 * deterministic, consumer-side metadata overlay described in
 * `docs/design/character-creation-level1-metadata-inventory.md`: an authored,
 * SRD-cited table keyed by the frozen ancestry record keys. It mutates nothing
 * in the pack; it is ordinary character-creation code (not importer-fix-protocol
 * work). Every entry's `sourceText` is the verbatim SRD ability-increase prose
 * it was authored from, kept for provenance against the frozen trait.
 */

import { ABILITY_SCORE_NAMES } from './abilities.js';
import type { AbilityScoreName } from './creation.js';

/** A fixed ability-score increase an ancestry applies automatically. */
export interface AbilityScoreIncrease {
  readonly ability: AbilityScoreName;
  readonly bonus: number;
}

/**
 * A player-chosen ability-score increase (only the Half-Elf's "two other
 * ability scores of your choice increase by 1" in the SRD). `from` lists the
 * abilities eligible to receive the bonus — the SRD's "other" excludes the
 * abilities the ancestry already raises with a fixed increase.
 */
export interface AbilityScoreIncreaseChoice {
  /** How many distinct abilities the player picks. */
  readonly choose: number;
  /** The bonus applied to each chosen ability. */
  readonly bonus: number;
  /** Abilities eligible to be chosen. */
  readonly from: readonly AbilityScoreName[];
}

/** The structured ability-score-increase overlay for one ancestry. */
export interface AncestryAbilityScoreIncrease {
  /** Increases applied automatically, with no player input. */
  readonly fixed: readonly AbilityScoreIncrease[];
  /** The player choice, present only when the ancestry grants one. */
  readonly choice?: AbilityScoreIncreaseChoice;
  /** Verbatim SRD ability-increase prose this overlay was authored from. */
  readonly sourceText: string;
}

/** Every ability except those passed — the SRD's "two *other* ... of your choice". */
function abilitiesExcept(
  ...excluded: readonly AbilityScoreName[]
): readonly AbilityScoreName[] {
  const omit = new Set(excluded);
  return ABILITY_SCORE_NAMES.filter((name) => !omit.has(name));
}

/**
 * Structured ability-score increases per ancestry, keyed by the frozen pack's
 * canonical `ancestry:<slug>` record key. Source: D&D 5e SRD 5.1, each
 * ancestry's "Ability Score Increase" trait (the same prose carried verbatim in
 * `sourceText`).
 */
const ANCESTRY_ABILITY_SCORE_INCREASES: Readonly<
  Record<string, AncestryAbilityScoreIncrease>
> = {
  'ancestry:dragonborn': {
    fixed: [
      { ability: 'strength', bonus: 2 },
      { ability: 'charisma', bonus: 1 },
    ],
    sourceText:
      'Your Strength score increases by 2, and your Charisma score increases by 1.',
  },
  'ancestry:dwarf': {
    fixed: [{ ability: 'constitution', bonus: 2 }],
    sourceText: 'Your Constitution score increases by 2.',
  },
  'ancestry:elf': {
    fixed: [{ ability: 'dexterity', bonus: 2 }],
    sourceText: 'Your Dexterity score increases by 2.',
  },
  'ancestry:gnome': {
    fixed: [{ ability: 'intelligence', bonus: 2 }],
    sourceText: 'Your Intelligence score increases by 2.',
  },
  'ancestry:half-elf': {
    fixed: [{ ability: 'charisma', bonus: 2 }],
    choice: { choose: 2, bonus: 1, from: abilitiesExcept('charisma') },
    sourceText:
      'Your Charisma score increases by 2, and two other ability scores of your choice increase by 1.',
  },
  'ancestry:half-orc': {
    fixed: [
      { ability: 'strength', bonus: 2 },
      { ability: 'constitution', bonus: 1 },
    ],
    sourceText:
      'Your Strength score increases by 2, and your Constitution score increases by 1.',
  },
  'ancestry:halfling': {
    fixed: [{ ability: 'dexterity', bonus: 2 }],
    sourceText: 'Your Dexterity score increases by 2.',
  },
  'ancestry:high-elf': {
    fixed: [
      { ability: 'dexterity', bonus: 2 },
      { ability: 'intelligence', bonus: 1 },
    ],
    sourceText:
      'Your Dexterity score increases by 2. Your Intelligence score increases by 1.',
  },
  'ancestry:hill-dwarf': {
    fixed: [
      { ability: 'constitution', bonus: 2 },
      { ability: 'wisdom', bonus: 1 },
    ],
    sourceText:
      'Your Constitution score increases by 2. Your Wisdom score increases by 1.',
  },
  'ancestry:human': {
    fixed: ABILITY_SCORE_NAMES.map((ability) => ({ ability, bonus: 1 })),
    sourceText: 'Your ability scores each increase by 1.',
  },
  'ancestry:lightfoot-halfling': {
    fixed: [
      { ability: 'dexterity', bonus: 2 },
      { ability: 'charisma', bonus: 1 },
    ],
    sourceText:
      'Your Dexterity score increases by 2. Your Charisma score increases by 1.',
  },
  'ancestry:rock-gnome': {
    fixed: [
      { ability: 'intelligence', bonus: 2 },
      { ability: 'constitution', bonus: 1 },
    ],
    sourceText:
      'Your Intelligence score increases by 2. Your Constitution score increases by 1.',
  },
  'ancestry:tiefling': {
    fixed: [
      { ability: 'intelligence', bonus: 1 },
      { ability: 'charisma', bonus: 2 },
    ],
    sourceText:
      'Your Intelligence score increases by 1, and your Charisma score increases by 2.',
  },
};

/**
 * The structured ability-score increases for an ancestry, looked up by its
 * frozen canonical record key (e.g. `ancestry:half-elf`), or `undefined` when no
 * overlay is authored for that key. The overlay is keyed only by canonical key
 * so it stays pinned to the frozen records and never matches on mutable prose.
 */
export function getAncestryAbilityScoreIncrease(
  ancestryKey: string,
): AncestryAbilityScoreIncrease | undefined {
  return ANCESTRY_ABILITY_SCORE_INCREASES[ancestryKey];
}
