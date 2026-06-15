import { classifyTier, type SourceTier } from './sourceInventory.js';

/**
 * One heading-only Monsters taxonomy label and its reviewed source boundary.
 *
 * `endCreature` is the last consecutive stat block governed by the heading.
 * The SRD prints no closing marker before the next standalone creature, so
 * these boundaries are source-reviewed rather than inferred from names/types.
 */
export interface CreatureTaxonomySpec {
  readonly heading: string;
  readonly tier: Extract<SourceTier, 'subsection' | 'leaf'>;
  readonly familyPath: readonly string[];
  readonly endCreature?: string;
}

const oneLevel = (
  heading: string,
  endCreature: string,
): CreatureTaxonomySpec => ({
  heading,
  tier: 'subsection',
  familyPath: [heading],
  endCreature,
});

const dragonColor = (
  heading: string,
  category: 'Chromatic' | 'Metallic',
): CreatureTaxonomySpec => {
  const color = heading.replace(/ Dragon$/, '');
  return {
    heading,
    tier: 'leaf',
    familyPath: ['Dragons', `${category} Dragons`, `${color} Dragons`],
    endCreature: `${heading} Wyrmling`,
  };
};

/**
 * Exact heading-only taxonomy map for the vendored SRD 5.1 Monsters chapter.
 *
 * The two dragon category headings establish parent paths; their color
 * headings refine those paths and carry the stat-block end boundary.
 */
export const CREATURE_TAXONOMY_SPECS: readonly CreatureTaxonomySpec[] = [
  oneLevel('Angels', 'Solar'),
  oneLevel('Animated Objects', 'Rug of Smothering'),
  oneLevel('Demons', 'Vrock'),
  oneLevel('Devils', 'Pit Fiend'),
  oneLevel('Dinosaurs', 'Tyrannosaurus Rex'),
  {
    heading: 'Dragons, Chromatic',
    tier: 'subsection',
    familyPath: ['Dragons', 'Chromatic Dragons'],
  },
  dragonColor('Black Dragon', 'Chromatic'),
  dragonColor('Blue Dragon', 'Chromatic'),
  dragonColor('Green Dragon', 'Chromatic'),
  dragonColor('Red Dragon', 'Chromatic'),
  dragonColor('White Dragon', 'Chromatic'),
  {
    heading: 'Dragons, Metallic',
    tier: 'subsection',
    familyPath: ['Dragons', 'Metallic Dragons'],
  },
  dragonColor('Brass Dragon', 'Metallic'),
  dragonColor('Bronze Dragon', 'Metallic'),
  dragonColor('Copper Dragon', 'Metallic'),
  dragonColor('Gold Dragon', 'Metallic'),
  dragonColor('Silver Dragon', 'Metallic'),
  oneLevel('Elementals', 'Water Elemental'),
  oneLevel('Fungi', 'Violet Fungus'),
  oneLevel('Genies', 'Efreeti'),
  oneLevel('Ghouls', 'Ghoul'),
  oneLevel('Giants', 'Storm Giant'),
  oneLevel('Golems', 'Stone Golem'),
  oneLevel('Hags', 'Sea Hag'),
  oneLevel('Lycanthropes', 'Werewolf'),
  oneLevel('Mephits', 'Steam Mephit'),
  oneLevel('Mummies', 'Mummy Lord'),
  oneLevel('Nagas', 'Spirit Naga'),
  oneLevel('Oozes', 'Ochre Jelly'),
  oneLevel('Skeletons', 'Warhorse Skeleton'),
  oneLevel('Sphinxes', 'Gynosphinx'),
  oneLevel('Vampires', 'Vampire Spawn'),
  oneLevel('Zombies', 'Ogre Zombie'),
];

const SPEC_BY_HEADING = new Map(
  CREATURE_TAXONOMY_SPECS.map((spec) => [spec.heading, spec]),
);

/** Match only a reviewed taxonomy heading at its source typography tier. */
export function creatureTaxonomySpecForLine(
  line: string,
  height: number | undefined,
): CreatureTaxonomySpec | undefined {
  const spec = SPEC_BY_HEADING.get(line.trim());
  return spec !== undefined && classifyTier(height) === spec.tier
    ? spec
    : undefined;
}
