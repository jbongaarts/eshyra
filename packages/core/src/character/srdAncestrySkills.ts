/**
 * Fixed, unconditional ancestry skill grants from SRD 5.1 pp. 4 and 7.
 * Consumer-side metadata for traits whose mechanics carry prose `grant` values.
 * High Elf inherits Keen Senses. Conditional proficiency (e.g. Stonecunning)
 * is not a general skill grant. Skill Versatility uses creation choices instead.
 */
export function getFixedAncestrySkills(ancestryKey: string): readonly string[] {
  switch (ancestryKey) {
    case 'ancestry:elf':
    case 'ancestry:high-elf':
      // Keen Senses: "You have proficiency in the Perception skill." (p. 4)
      return ['Perception'];
    case 'ancestry:half-orc':
      // Menacing: "You gain proficiency in the Intimidation skill." (p. 7)
      return ['Intimidation'];
    default:
      return [];
  }
}
