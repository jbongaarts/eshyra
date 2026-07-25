/**
 * Tests for the p78 skill-to-ability mapping on `rule:skills` (eshyra-erf5.1).
 *
 * The SRD prints "Strength" / "Dexterity" / ... captions under a "Skills"
 * subsection, each followed by a bulleted skill list. The importer excludes
 * those captions from becoming their own prose `rule` records (they collide
 * by name with the real per-ability "Using Each Ability" subsections), so
 * `rule:skills` — which promises the list in its own prose — must carry the
 * mapping as structured data instead of silently dropping it.
 */

import { describe, expect, it } from 'vitest';
import {
  getBundledDnd5eSrdPack,
  SRD_5_1_SKILL_ABILITIES,
  SRD_5_1_SKILLS,
} from '../src/internal.js';

const pack = getBundledDnd5eSrdPack();
const rulesSkills = pack.records.find((r) => r.key === 'rule:skills');

describe('rule:skills — skillsByAbility', () => {
  it('exists on the committed pack', () => {
    expect(rulesSkills).toBeDefined();
  });

  it('lists every canonical ability exactly once, Constitution empty', () => {
    const data = rulesSkills?.data as {
      skillsByAbility?: Record<string, readonly string[]>;
    };
    expect(data.skillsByAbility).toBeDefined();
    const byAbility = data.skillsByAbility as Record<string, readonly string[]>;
    expect(Object.keys(byAbility).sort()).toEqual([
      'charisma',
      'constitution',
      'dexterity',
      'intelligence',
      'strength',
      'wisdom',
    ]);
    expect(byAbility.constitution).toEqual([]);
  });

  it('matches the canonical SRD_5_1_SKILL_ABILITIES source of truth', () => {
    const data = rulesSkills?.data as {
      skillsByAbility?: Record<string, readonly string[]>;
    };
    expect(data.skillsByAbility).toEqual(SRD_5_1_SKILL_ABILITIES);
  });

  it('resolves every one of the 18 canonical SRD skills to exactly one ability', () => {
    const byAbility = (
      rulesSkills?.data as { skillsByAbility: Record<string, string[]> }
    )?.skillsByAbility;
    const owners = new Map<string, string>();
    for (const [ability, skills] of Object.entries(byAbility)) {
      for (const skill of skills) {
        expect(owners.has(skill), skill).toBe(false);
        owners.set(skill, ability);
      }
    }
    for (const skill of SRD_5_1_SKILLS) {
      expect(owners.has(skill), skill).toBe(true);
    }
    expect(owners.size).toBe(SRD_5_1_SKILLS.length);
  });

  it('carries the p. 78 skill-proficiency prose that resumes after the embedded list (eshyra-o9bd.18.1)', () => {
    // The SRD's operative statement of what skill proficiency does, printed
    // after the final Charisma bullet: it must survive the excluded bullet
    // captions and land back in rule:skills.
    const text = String((rulesSkills?.data as { text?: unknown })?.text);
    expect(text).toContain(
      'proficiency in a skill means an individual can add his or her proficiency bonus to ability checks that involve that skill',
    );
    expect(text).toContain(
      'Without proficiency in the skill, the individual makes a normal ability check',
    );
    expect(text).toContain(
      'if a character attempts to climb up a dangerous cliff',
    );
    // The prose still ends before the following "Variant:" rule.
    expect(text).not.toContain('Skills with Different Abilities');
  });
});
