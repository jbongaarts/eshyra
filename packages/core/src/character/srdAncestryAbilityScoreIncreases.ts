/**
 * Source-backed ancestry ability-score-increase oracle (eshyra-b69j.12.1).
 *
 * Character creation now reads generated pack metadata. These authored,
 * SRD-cited constants remain only as regression oracles so tests can assert that
 * importer-generated `abilityScoreIncreases` stay faithful to the source prose.
 * Runtime code must not source ancestry bonuses from this file.
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

/** The structured ability-score-increase oracle for one ancestry. */
export interface AncestryAbilityScoreIncrease {
  /** Increases applied automatically, with no player input. */
  readonly fixed: readonly AbilityScoreIncrease[];
  /** The player choice, present only when the ancestry grants one. */
  readonly choice?: AbilityScoreIncreaseChoice;
  /** Verbatim SRD ability-increase prose this oracle was authored from. */
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
 *
 * Each entry is one printed ability-score-increase sentence, so most ancestries
 * carry a single-entry array. The four SRD 5.1 subraces (High Elf, Hill Dwarf,
 * Lightfoot Halfling, Rock Gnome) print theirs across two separately printed
 * sections — the parent race's shared trait block, then the subrace's own
 * block — so each carries two entries in that document order
 * (eshyra-o9bd.19.2.1.3.1). Composing those two sentences into one joined
 * `sourceText` would fabricate a span the source never prints as a single
 * verbatim block.
 */
const ANCESTRY_ABILITY_SCORE_INCREASES: Readonly<
  Record<string, readonly AncestryAbilityScoreIncrease[]>
> = {
  'ancestry:dragonborn': [
    {
      fixed: [
        { ability: 'strength', bonus: 2 },
        { ability: 'charisma', bonus: 1 },
      ],
      sourceText:
        'Your Strength score increases by 2, and your Charisma score increases by 1.',
    },
  ],
  'ancestry:dwarf': [
    {
      fixed: [{ ability: 'constitution', bonus: 2 }],
      sourceText: 'Your Constitution score increases by 2.',
    },
  ],
  'ancestry:elf': [
    {
      fixed: [{ ability: 'dexterity', bonus: 2 }],
      sourceText: 'Your Dexterity score increases by 2.',
    },
  ],
  'ancestry:gnome': [
    {
      fixed: [{ ability: 'intelligence', bonus: 2 }],
      sourceText: 'Your Intelligence score increases by 2.',
    },
  ],
  'ancestry:half-elf': [
    {
      fixed: [{ ability: 'charisma', bonus: 2 }],
      choice: { choose: 2, bonus: 1, from: abilitiesExcept('charisma') },
      sourceText:
        'Your Charisma score increases by 2, and two other ability scores of your choice increase by 1.',
    },
  ],
  'ancestry:half-orc': [
    {
      fixed: [
        { ability: 'strength', bonus: 2 },
        { ability: 'constitution', bonus: 1 },
      ],
      sourceText:
        'Your Strength score increases by 2, and your Constitution score increases by 1.',
    },
  ],
  'ancestry:halfling': [
    {
      fixed: [{ ability: 'dexterity', bonus: 2 }],
      sourceText: 'Your Dexterity score increases by 2.',
    },
  ],
  'ancestry:high-elf': [
    {
      fixed: [{ ability: 'dexterity', bonus: 2 }],
      sourceText: 'Your Dexterity score increases by 2.',
    },
    {
      fixed: [{ ability: 'intelligence', bonus: 1 }],
      sourceText: 'Your Intelligence score increases by 1.',
    },
  ],
  'ancestry:hill-dwarf': [
    {
      fixed: [{ ability: 'constitution', bonus: 2 }],
      sourceText: 'Your Constitution score increases by 2.',
    },
    {
      fixed: [{ ability: 'wisdom', bonus: 1 }],
      sourceText: 'Your Wisdom score increases by 1.',
    },
  ],
  'ancestry:human': [
    {
      fixed: ABILITY_SCORE_NAMES.map((ability) => ({ ability, bonus: 1 })),
      sourceText: 'Your ability scores each increase by 1.',
    },
  ],
  'ancestry:lightfoot-halfling': [
    {
      fixed: [{ ability: 'dexterity', bonus: 2 }],
      sourceText: 'Your Dexterity score increases by 2.',
    },
    {
      fixed: [{ ability: 'charisma', bonus: 1 }],
      sourceText: 'Your Charisma score increases by 1.',
    },
  ],
  'ancestry:rock-gnome': [
    {
      fixed: [{ ability: 'intelligence', bonus: 2 }],
      sourceText: 'Your Intelligence score increases by 2.',
    },
    {
      fixed: [{ ability: 'constitution', bonus: 1 }],
      sourceText: 'Your Constitution score increases by 1.',
    },
  ],
  'ancestry:tiefling': [
    {
      fixed: [
        { ability: 'intelligence', bonus: 1 },
        { ability: 'charisma', bonus: 2 },
      ],
      sourceText:
        'Your Intelligence score increases by 1, and your Charisma score increases by 2.',
    },
  ],
};

/**
 * The structured ability-score-increase oracle for an ancestry, looked up by
 * its frozen canonical record key (e.g. `ancestry:half-elf`), or `undefined`
 * when no oracle is authored for that key. Keyed only by canonical key so it
 * stays pinned to the frozen records and never matches on mutable prose.
 *
 * Returns one entry per printed ability-score-increase sentence (see the
 * constant's doc comment); most ancestries resolve to a single-entry array.
 */
export function getAncestryAbilityScoreIncreases(
  ancestryKey: string,
): readonly AncestryAbilityScoreIncrease[] | undefined {
  return ANCESTRY_ABILITY_SCORE_INCREASES[ancestryKey];
}
