/**
 * Runtime smoke tests: character creation + level-up to 20 (eshyra-o9bd.12,
 * re-freeze bar #10).
 *
 * The executable proof of the *playable* bar: the committed D&D 5e SRD 5.1 pack
 * can drive character creation and the full 1->20 advancement model using ONLY
 * generated pack data. Everything here flows through the pack-driven character
 * resolver (`getBundledDnd5eCharacterResolver`) and the pure derivation
 * (`deriveLevel1Values`) / level-up (`computeLevelUpChangeSet`) engines — no
 * consumer-side hardcoded SRD knowledge, no character-creation overlays.
 *
 * Scope is deterministic, not combinatorial (per the bead): every legal
 * class x ancestry x background TUPLE is created at level 1 with fixed
 * representative choices, and the progression model is asserted resolvable and
 * typed for every class at every level 1..20. Targeted choice-coverage cases
 * follow.
 */

import { describe, expect, it } from 'vitest';
import {
  type AbilityScoreIncrease,
  type AbilityScoreName,
  computeLevelUpChangeSet,
  deriveLevel1Values,
  getBundledDnd5eCharacterResolver,
  getBundledDnd5eSrdPack,
  type ResolvedAncestryData,
} from '../src/internal.js';

const resolver = getBundledDnd5eCharacterResolver();
const pack = getBundledDnd5eSrdPack();

// Raw feature records (for the eshyra-o9bd.9 `choices` data the resolver does
// not surface). Still pack data — the committed generated pack.
const featureByKey = new Map(
  pack.records.filter((r) => r.kind === 'feature').map((r) => [r.key, r]),
);

const ABILITY_FULL_TO_SHORT: Readonly<Record<string, AbilityScoreName>> = {
  Strength: 'strength',
  Dexterity: 'dexterity',
  Constitution: 'constitution',
  Intelligence: 'intelligence',
  Wisdom: 'wisdom',
  Charisma: 'charisma',
};

// A fixed, class-agnostic representative ability array (a deterministic
// "first-legal" assignment). Modifiers: STR+2 DEX+2 CON+1 INT+1 WIS+0 CHA-1.
const REPRESENTATIVE_SCORES: Readonly<Record<AbilityScoreName, number>> = {
  strength: 15,
  dexterity: 14,
  constitution: 13,
  intelligence: 12,
  wisdom: 10,
  charisma: 8,
};

function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Flatten a resolved ancestry's ability-score increases into concrete
 * `{ability, bonus}` grants, taking the FIRST-legal options for any choice
 * (deterministic representative choice). */
function representativeAncestryIncreases(
  ancestry: ResolvedAncestryData,
): AbilityScoreIncrease[] {
  const out: AbilityScoreIncrease[] = [];
  for (const entry of ancestry.abilityScoreIncreases ?? []) {
    for (const fixed of entry.fixed) {
      out.push({ ability: fixed.ability, bonus: fixed.bonus });
    }
    if (entry.choice !== undefined) {
      for (const ability of entry.choice.from.slice(0, entry.choice.choose)) {
        out.push({ ability, bonus: entry.choice.bonus });
      }
    }
  }
  return out;
}

/** Total bonus per ability from a flattened increase list. */
function bonusByAbility(
  increases: readonly AbilityScoreIncrease[],
): Partial<Record<AbilityScoreName, number>> {
  const totals: Partial<Record<AbilityScoreName, number>> = {};
  for (const { ability, bonus } of increases) {
    totals[ability] = (totals[ability] ?? 0) + bonus;
  }
  return totals;
}

const classes = resolver.listClasses();
const ancestries = resolver.listAncestries();
const backgrounds = resolver.listBackgrounds();

// ---------------------------------------------------------------------------
// Level-1 creation across every legal class x ancestry x background tuple
// ---------------------------------------------------------------------------

describe('level-1 character creation drives off pack data for every legal tuple', () => {
  it('has the full legal SRD roster (12 classes, 13 ancestries, >=1 background)', () => {
    expect(classes).toHaveLength(12);
    expect(ancestries).toHaveLength(13);
    expect(backgrounds.length).toBeGreaterThanOrEqual(1);
  });

  for (const cls of classes) {
    // A class casts at level 1 iff its level-1 progression row carries a
    // spellcasting block — read from the pack, not a hardcoded caster list.
    const level1 = resolver.resolveClassLevel(cls.key, 1);
    const castsAtLevel1 = level1.ok && level1.record.spellcasting !== undefined;
    const spellAbility =
      castsAtLevel1 && cls.spellcastingAbility !== undefined
        ? cls.spellcastingAbility
        : undefined;

    for (const ancestry of ancestries) {
      for (const background of backgrounds) {
        it(`creates a level-1 ${cls.name} / ${ancestry.name} / ${background.name} from pack data`, () => {
          const increases = representativeAncestryIncreases(ancestry);
          const derived = deriveLevel1Values({
            validAbilityScores: REPRESENTATIVE_SCORES,
            classRecord: {
              hitDie: cls.hitDie,
              savingThrowProficiencies: cls.savingThrowProficiencies,
            },
            abilityScoreIncreases: increases,
            spellcastingAbility: spellAbility,
          });

          // Proficiency bonus is +2 at level 1 for every class.
          expect(derived.proficiencyBonus).toBe(2);

          // Max HP = hit die + final-Constitution modifier (pack hit die +
          // ancestry-adjusted CON).
          const finalCon =
            REPRESENTATIVE_SCORES.constitution +
            (bonusByAbility(increases).constitution ?? 0);
          expect(derived.maxHitPoints).toBe(cls.hitDie + abilityMod(finalCon));

          // The class's two saving-throw proficiencies (from the pack) are
          // reflected as proficient in the derived saves.
          for (const save of cls.savingThrowProficiencies) {
            const short = ABILITY_FULL_TO_SHORT[save];
            expect(short).toBeDefined();
            expect(derived.savingThrows[short]?.proficient).toBe(true);
          }

          // A level-1 caster has a spell save DC = 8 + prof + ability mod.
          if (spellAbility !== undefined) {
            const finalSpellScore =
              REPRESENTATIVE_SCORES[spellAbility] +
              (bonusByAbility(increases)[spellAbility] ?? 0);
            expect(derived.spellSaveDc).toBe(
              8 + 2 + abilityMod(finalSpellScore),
            );
            expect(derived.spellAttackModifier).toBe(
              2 + abilityMod(finalSpellScore),
            );
          } else {
            expect(derived.spellSaveDc).toBeUndefined();
          }

          // Creation inputs the pack must supply (no overlay): skill choices,
          // starting equipment, ancestry languages, background skills.
          expect(cls.skillChoices?.length ?? 0).toBeGreaterThan(0);
          expect(cls.startingEquipment).toBeDefined();
          expect(ancestry.languages?.length ?? 0).toBeGreaterThan(0);
          expect(background.skillProficiencies.length).toBeGreaterThan(0);
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Full 1->20 progression model is resolvable and typed from the pack
// ---------------------------------------------------------------------------

function expectedProficiencyBonus(level: number): number {
  return 2 + Math.floor((level - 1) / 4);
}

describe('the pack drives the full 1->20 advancement model for every class', () => {
  for (const cls of classes) {
    it(`${cls.name}: every level 1..20 resolves with typed, reachable advancement`, () => {
      let sawSubclassSlot = false;
      let sawAsi = false;
      let previousTotalSlots = 0;
      const castsAtLevel1 =
        resolver.resolveClassLevel(cls.key, 1).ok &&
        resolver.resolveClassLevel(cls.key, 1).record.spellcasting !==
          undefined;

      for (let level = 1; level <= 20; level += 1) {
        const result = resolver.resolveClassLevel(cls.key, level);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const row = result.record;

        expect(row.proficiencyBonus).toBe(expectedProficiencyBonus(level));

        // Every granted feature ref resolves to a feature record in the pack.
        for (const ref of row.featureRefs) {
          expect(featureByKey.has(ref)).toBe(true);
        }
        // Improvement targets resolve too.
        for (const improvement of row.featureImprovements) {
          for (const ref of improvement.targetRefs) {
            expect(featureByKey.has(ref)).toBe(true);
          }
        }

        if (row.subclassFeatureSlots.length > 0) sawSubclassSlot = true;
        if (
          row.featureRefs.some((r) => r.endsWith(':ability-score-improvement'))
        )
          sawAsi = true;

        // Spell slots never regress as a caster advances. Warlock Pact Magic
        // uses `pactSlots` (count at a single level) instead of the `slots` map.
        if (row.spellcasting !== undefined) {
          const standard = Object.values(row.spellcasting.slots ?? {}).reduce(
            (a, b) => a + b,
            0,
          );
          const pact = row.spellcasting.pactSlots?.count ?? 0;
          const total = standard + pact;
          if (total > 0 || previousTotalSlots > 0) {
            expect(total).toBeGreaterThanOrEqual(previousTotalSlots);
            previousTotalSlots = total;
          }
        }
      }

      // Every SRD class has subclasses and an Ability Score Improvement track.
      expect(sawSubclassSlot).toBe(true);
      expect(sawAsi).toBe(true);
      // Spellcasting classes actually progressed their slots.
      if (castsAtLevel1) expect(previousTotalSlots).toBeGreaterThan(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Targeted choice-coverage cases (the playable-bar punch list)
// ---------------------------------------------------------------------------

describe('targeted creation/level-up choice cases (eshyra-o9bd.12)', () => {
  it('Half-Elf ASI: fixed +2 Charisma plus two chosen +1, applied to final scores', () => {
    const halfElf = resolver.resolveAncestry('ancestry:half-elf');
    expect(halfElf.ok).toBe(true);
    if (!halfElf.ok) return;
    const asi = halfElf.record.abilityScoreIncreases?.[0];
    expect(asi?.fixed).toEqual([{ ability: 'charisma', bonus: 2 }]);
    expect(asi?.choice).toMatchObject({ choose: 2, bonus: 1 });

    const increases = representativeAncestryIncreases(halfElf.record);
    const derived = deriveLevel1Values({
      validAbilityScores: REPRESENTATIVE_SCORES,
      classRecord: { hitDie: 8, savingThrowProficiencies: [] },
      abilityScoreIncreases: increases,
    });
    // CHA 8 + 2 = 10; first two choice abilities (str, dex) each +1.
    expect(derived.finalAbilityScores.charisma).toBe(10);
    expect(derived.finalAbilityScores.strength).toBe(16);
    expect(derived.finalAbilityScores.dexterity).toBe(15);
  });

  it('Wizard: spellbook + cantrip selection are pack choices; Int spellcasting', () => {
    const wizard = resolver.resolveClass('class:wizard');
    expect(wizard.ok && wizard.record.spellcastingAbility).toBe('intelligence');
    // eshyra-vk23.2: cantrips + formula-driven daily preparation hang off the
    // Spellcasting feature; the 6-spell starting spellbook (and its growth)
    // moved to the Spellbook feature where the SRD prose lives.
    const castingChoices =
      (
        featureByKey.get('feature:wizard:spellcasting')?.data as {
          choices?: { id: string; category: string; choose?: number }[];
        }
      )?.choices ?? [];
    const castingById = new Map(castingChoices.map((c) => [c.id, c]));
    expect(castingById.get('cantrips')?.choose).toBe(3); // 3 starting cantrips
    expect(castingById.get('prepared-spells')?.category).toBe('spell');
    expect(castingById.get('prepared-spells')?.choose).toBeUndefined();

    const spellbookChoices =
      (
        featureByKey.get('feature:wizard:spellbook')?.data as {
          choices?: { id: string; choose?: number }[];
        }
      )?.choices ?? [];
    const spellbookById = new Map(spellbookChoices.map((c) => [c.id, c]));
    expect(spellbookById.get('spellbook-initial')?.choose).toBe(6); // 6-spell start
    expect(spellbookById.get('spellbook-growth')?.choose).toBe(2); // +2 per level
  });

  it('Cleric/Druid are prepared casters: cantrips known, no fixed spells-known', () => {
    for (const key of ['class:cleric', 'class:druid']) {
      const row = resolver.resolveClassLevel(key, 1);
      expect(row.ok).toBe(true);
      if (!row.ok) continue;
      expect(row.record.spellcasting?.cantripsKnown).toBeGreaterThan(0);
      // Prepared casters prepare from the full list — no fixed spells-known count.
      expect(row.record.spellcasting?.spellsKnown).toBeUndefined();
    }
  });

  it('Bard is a known caster: both cantrips and a fixed spells-known count', () => {
    const row = resolver.resolveClassLevel('class:bard', 1);
    expect(row.ok).toBe(true);
    if (!row.ok) return;
    expect(row.record.spellcasting?.cantripsKnown).toBe(2);
    expect(row.record.spellcasting?.spellsKnown).toBe(4);
  });

  it('Fighter and Cleric starting equipment carry structured choice options', () => {
    for (const key of ['class:fighter', 'class:cleric']) {
      const cls = resolver.resolveClass(key);
      expect(cls.ok).toBe(true);
      if (!cls.ok) continue;
      const entries = cls.record.startingEquipment?.entries ?? [];
      const choiceEntries = entries.filter((e) => e.kind === 'choice');
      expect(choiceEntries.length).toBeGreaterThan(0);
      for (const entry of choiceEntries) {
        if (entry.kind === 'choice') {
          expect(entry.options.length).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it('subclass-dependent level-up: the chosen subclass supplies the slot feature', () => {
    // Fighter grants a Martial Archetype feature slot at level 7; the chosen
    // subclass (Champion) supplies a concrete feature for it.
    const slotRow = resolver.resolveClassLevel('class:fighter', 7);
    expect(slotRow.ok).toBe(true);
    if (!slotRow.ok) return;
    expect(slotRow.record.subclassFeatureSlots.length).toBeGreaterThan(0);

    const champion = resolver
      .listSubclasses()
      .find((s) => s.key === 'subclass:champion');
    expect(champion?.parentClass).toBe('class:fighter');
    expect(champion?.features.length ?? 0).toBeGreaterThan(0);
    for (const ref of champion?.features ?? []) {
      expect(featureByKey.has(ref)).toBe(true);
    }
  });

  it('ASI-vs-feat row: the level-4 ability-score-improvement feature is a pack choice', () => {
    const asiFeature = featureByKey.get(
      'feature:fighter:ability-score-improvement',
    );
    expect(asiFeature?.data).toBeDefined();
    const choices = (asiFeature?.data as { choices?: { category: string }[] })
      ?.choices;
    expect(choices?.some((c) => c.category === 'asiOrFeat')).toBe(true);
    // The pack grants it at level 4.
    const level4 = resolver.resolveClassLevel('class:fighter', 4);
    expect(
      level4.ok &&
        level4.record.featureRefs.includes(
          'feature:fighter:ability-score-improvement',
        ),
    ).toBe(true);
  });

  it('feature-improvement row: Druid Wild Shape improves at level 4', () => {
    const level4 = resolver.resolveClassLevel('class:druid', 4);
    expect(level4.ok).toBe(true);
    if (!level4.ok) return;
    const improvement = level4.record.featureImprovements.find((i) =>
      i.targetRefs.includes('feature:druid:wild-shape'),
    );
    expect(improvement).toBeDefined();
    expect(featureByKey.has('feature:druid:wild-shape')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Level-up engine consumes the pack (integration over the pure change-set)
// ---------------------------------------------------------------------------

describe('the level-up engine advances a sheet off pack progression data', () => {
  function level1FighterSheet() {
    const abilities = {
      strength: { base: 15, final: 15, modifier: 2 },
      dexterity: { base: 14, final: 14, modifier: 2 },
      constitution: { base: 13, final: 13, modifier: 1 },
      intelligence: { base: 12, final: 12, modifier: 1 },
      wisdom: { base: 10, final: 10, modifier: 0 },
      charisma: { base: 8, final: 8, modifier: -1 },
    } as const;
    return {
      schemaVersion: 1 as const,
      system: 'dnd5e-srd',
      rulesPackId: 'rules:dnd5e-srd-5.1',
      recipeId: 'dnd5e-srd-character',
      creationMode: 'test',
      level: 1,
      identity: { name: 'Smoke Fighter' },
      class: { key: 'class:fighter', name: 'Fighter' },
      ancestry: { key: 'ancestry:human', name: 'Human' },
      abilityScores: abilities,
      proficiencyBonus: 2,
      maxHitPoints: 11,
      savingThrows: {
        strength: { modifier: 4, proficient: true },
        dexterity: { modifier: 2, proficient: false },
        constitution: { modifier: 3, proficient: true },
        intelligence: { modifier: 1, proficient: false },
        wisdom: { modifier: 0, proficient: false },
        charisma: { modifier: -1, proficient: false },
      },
      skillProficiencies: [],
      toolProficiencies: [],
      armorProficiencies: [],
      weaponProficiencies: [],
      equipment: [],
      languages: [],
      spells: [],
      metadata: { createdAt: '2026-06-29T00:00:00.000Z' },
    };
  }

  it('computes the level-1 -> 2 Fighter change set entirely from pack data', () => {
    const changeSet = computeLevelUpChangeSet(level1FighterSheet(), resolver);
    expect(changeSet.level).toEqual({ from: 1, to: 2 });
    expect(changeSet.proficiencyBonus).toEqual({ from: 2, to: 2 });
    // Fighter gains Action Surge at level 2 (from pack progression).
    expect(changeSet.featuresGained).toContain('feature:fighter:action-surge');
    // HP advances by the fixed average (d10 -> 6) + CON modifier (1) = 7.
    expect(changeSet.hitPoints.maxHitPoints).toEqual({ from: 11, to: 18 });
  });
});
