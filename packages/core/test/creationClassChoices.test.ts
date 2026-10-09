// Level-1 class-feature choices at creation (eshyra-nnj6.1): fighting style,
// favored enemy / natural explorer, rogue expertise, the level-1 subclass and
// its granted choices, plus the structured spellcasting buckets, against the
// real bundled SRD pack. Validation and persistence reuse the level-up helpers,
// so the round-trip cases level the finalized sheets up from level 1.

import { describe, expect, it } from 'vitest';
import {
  applyLevelUp,
  type CharacterDraft,
  type CharacterSheet,
  createSqliteCharacterSheetStore,
  detectLevelUpRequiredChoices,
  finalizeCharacterDraft,
  getBundledDnd5eCharacterResolver,
  getDnd5eCharacterCreationEngine,
  type LevelUpChoiceSelections,
} from '../src/internal.js';
import { bareDb, DEFAULT_TEST_SESSION_ID } from './support/db.js';

const engine = getDnd5eCharacterCreationEngine();
const resolver = getBundledDnd5eCharacterResolver();
const META = { createdAt: '2026-10-09T00:00:00.000Z', source: 'test' } as const;

function baseDraft(className: string, ancestry = 'Human'): CharacterDraft {
  let draft = engine.createDraft({ id: 'hero', mode: 'concept-first' });
  draft = engine.setIdentity(draft, { name: 'Test Hero' });
  draft = engine.setClass(draft, className);
  draft = engine.setAncestry(draft, ancestry);
  draft = engine.setAbilityScoreMethod(draft, 'point_buy');
  return engine.setAbilityScores(draft, {
    strength: 15,
    dexterity: 14,
    constitution: 13,
    intelligence: 12,
    wisdom: 10,
    charisma: 8,
  });
}

const choiceFor = (draft: CharacterDraft, kind: string) =>
  engine.mechanicalChoices(draft).filter((entry) => entry.choice.kind === kind);

/**
 * Satisfy every unsatisfied mechanical choice with its first options (looping,
 * because subclass picks reveal dependent choices), honoring `overrides` by
 * choice id.
 */
function fill(
  start: CharacterDraft,
  overrides: Readonly<Record<string, readonly string[]>> = {},
): CharacterDraft {
  let draft = start;
  for (let guard = 0; guard < 40; guard += 1) {
    const next = engine
      .mechanicalChoices(draft)
      .find(
        (entry) => !entry.satisfied && entry.choice.status === 'structured',
      );
    if (next === undefined) return draft;
    draft = engine.setChoice(
      draft,
      next.choice.id,
      overrides[next.choice.id] ??
        (next.choice.from ?? []).slice(0, next.choice.choose ?? 0),
    );
  }
  throw new Error('fill did not converge');
}

/** First `n` canonical spells of a class at a spell level. */
function spellNames(className: string, level: number, n: number): string[] {
  return resolver
    .listSpells()
    .filter(
      (spell) => spell.level === level && spell.classes.includes(className),
    )
    .slice(0, n)
    .map((spell) => spell.name);
}

function finalize(draft: CharacterDraft): CharacterSheet {
  const result = finalizeCharacterDraft(draft, META);
  if (!result.ok) {
    throw new Error(
      `finalize failed: ${[...result.missing.map((m) => m.label), ...result.errors].join('; ')}`,
    );
  }
  return result.character;
}

describe('ancestry skills at creation', () => {
  it.each([
    { ancestry: 'Elf', grants: ['Perception'] },
    { ancestry: 'High Elf', grants: ['Perception'] },
    { ancestry: 'Half-Orc', grants: ['Intimidation'] },
    { ancestry: 'Half-Elf', grants: ['Arcana', 'Nature'] },
  ])(
    'persists $ancestry skills and makes them eligible for expertise',
    ({ ancestry, grants }) => {
      let draft = baseDraft('Rogue', ancestry);
      draft = engine.setChoice(draft, 'class.skills', [
        'Acrobatics',
        'Deception',
        'Stealth',
        'Sleight of Hand',
      ]);
      if (ancestry === 'Half-Elf') {
        const skills = choiceFor(draft, 'skills').find(
          (entry) => entry.choice.source === 'ancestry',
        );
        expect(skills?.choice).toMatchObject({
          id: 'ancestry.skills',
          choose: 2,
          status: 'structured',
        });
        draft = engine.setChoice(draft, 'ancestry.skills', grants);
      }
      const expertise = choiceFor(draft, 'expertise')[0];
      expect(expertise?.choice.from).toEqual(expect.arrayContaining(grants));
      draft = fill(draft, {
        [expertise?.choice.id as string]: [grants[0], 'Stealth'],
      });
      const sheet = finalize(draft);
      expect(sheet.skillProficiencies).toEqual(expect.arrayContaining(grants));
      expect(sheet.featureChoices).toContainEqual({
        featureRef: 'feature:rogue:expertise',
        choiceId: 'expertise',
        optionIds: [`skill:${grants[0]}`, 'skill:Stealth'],
        level: 1,
      });
      const leveled = levelUpToTwo(sheet);
      expect(leveled.skillProficiencies).toEqual(sheet.skillProficiencies);
      expect(leveled.featureChoices).toEqual(
        expect.arrayContaining(sheet.featureChoices ?? []),
      );
    },
  );

  it.each(['Elf', 'Half-Elf'])(
    'invalidates expertise when %s skill grants are removed',
    (ancestry) => {
      let draft = baseDraft('Rogue', ancestry);
      draft = engine.setChoice(draft, 'class.skills', [
        'Acrobatics',
        'Deception',
        'Stealth',
        'Sleight of Hand',
      ]);
      if (ancestry === 'Half-Elf')
        draft = engine.setChoice(draft, 'ancestry.skills', [
          'Perception',
          'Nature',
        ]);
      const id = choiceFor(draft, 'expertise')[0]?.choice.id as string;
      draft = fill(draft, { [id]: ['Perception', 'Stealth'] });
      expect(choiceFor(draft, 'expertise')[0]?.satisfied).toBe(true);
      draft =
        ancestry === 'Elf'
          ? engine.setAncestry(draft, 'Human')
          : engine.setChoice(draft, 'ancestry.skills', ['Arcana', 'Nature']);
      expect(draft.stale).toContain(id);
      expect(choiceFor(draft, 'expertise')[0]?.satisfied).toBe(false);
      expect(finalizeCharacterDraft(draft, META).ok).toBe(false);
    },
  );

  it('requires and persists replacements for overlapping ancestry, background, and class skills', () => {
    let draft = baseDraft('Rogue', 'Half-Orc');
    draft = engine.setBackground(draft, 'Acolyte');
    draft = engine.setBackgroundCustomization(draft, {
      name: 'Enforcer',
      skillProficiencies: ['Intimidation', 'Religion'],
      toolProficiencies: [],
      languages: ['Elvish', 'Dwarvish'],
      feature: 'background:acolyte#feature:shelter-of-the-faithful',
    });
    draft = engine.setChoice(draft, 'class.skills', [
      'Intimidation',
      'Acrobatics',
      'Deception',
      'Stealth',
    ]);
    const replacements = engine
      .mechanicalChoices(draft)
      .filter((entry) =>
        entry.choice.id.startsWith('proficiency-replacement.skills.'),
      );
    expect(replacements.map((entry) => entry.choice.id)).toEqual([
      'proficiency-replacement.skills.intimidation.1',
      'proficiency-replacement.skills.intimidation.2',
    ]);
    expect(finalizeCharacterDraft(draft, META).ok).toBe(false);
    draft = engine.setChoice(draft, replacements[0].choice.id, ['Arcana']);
    draft = engine.setChoice(draft, replacements[1].choice.id, ['Nature']);
    draft = fill(draft);
    expect(finalize(draft).skillProficiencies).toEqual([
      'Intimidation',
      'Arcana',
      'Religion',
      'Nature',
      'Acrobatics',
      'Deception',
      'Stealth',
    ]);
    draft = engine.setAncestry(draft, 'Human');
    expect(Object.keys(draft.selections.choices ?? {})).not.toContain(
      replacements[1].choice.id,
    );
  });

  it.each(['Dwarf', 'Hill Dwarf', 'Rock Gnome'])(
    'keeps conditional History benefits off the general %s skill list',
    (ancestry) => {
      let draft = baseDraft('Rogue', ancestry);
      draft = engine.setChoice(draft, 'class.skills', [
        'Acrobatics',
        'Deception',
        'Stealth',
        'Sleight of Hand',
      ]);
      expect(choiceFor(draft, 'expertise')[0]?.choice.from).not.toContain(
        'History',
      );
      expect(finalize(fill(draft)).skillProficiencies).not.toContain('History');
    },
  );
});

describe('level-1 class-feature choices: enumeration', () => {
  it('lists the fighting style for a fighter', () => {
    const [style] = choiceFor(baseDraft('Fighter'), 'feature_choice');
    expect(style?.choice).toMatchObject({
      status: 'structured',
      choose: 1,
      from: [
        'Archery',
        'Defense',
        'Dueling',
        'Great Weapon Fighting',
        'Protection',
        'Two-Weapon Fighting',
      ],
    });
  });

  it('lists favored enemy (13 types) and favored terrain for a ranger', () => {
    const entries = choiceFor(baseDraft('Ranger'), 'feature_choice');
    expect(entries.map((entry) => entry.choice.from?.length)).toEqual([13, 7]);
  });

  it("offers rogue expertise only over held skills and thieves' tools", () => {
    let draft = baseDraft('Rogue');
    draft = engine.setChoice(draft, 'class.skills', [
      'Acrobatics',
      'Deception',
      'Stealth',
      'Perception',
    ]);
    const [expertise] = choiceFor(draft, 'expertise');
    expect(expertise?.choice.choose).toBe(2);
    expect([...(expertise?.choice.from ?? [])].sort()).toEqual(
      [
        'Acrobatics',
        'Deception',
        'Perception',
        'Stealth',
        'Thieves’ tools',
      ].sort(),
    );
  });

  it.each(['Cleric', 'Sorcerer', 'Warlock'])(
    'lists the level-1 subclass for %s and none for classes without one',
    (className) => {
      const [subclass] = choiceFor(baseDraft(className), 'subclass');
      expect(subclass?.choice.choose).toBe(1);
      expect(subclass?.choice.from?.length).toBeGreaterThan(0);
    },
  );

  it('does not list a subclass for a class that picks it later', () => {
    expect(choiceFor(baseDraft('Wizard'), 'subclass')).toEqual([]);
    expect(choiceFor(baseDraft('Fighter'), 'subclass')).toEqual([]);
  });

  it('reveals the Dragon Ancestor choice only once Draconic Bloodline is chosen', () => {
    let draft = baseDraft('Sorcerer');
    expect(
      choiceFor(draft, 'feature_choice').map((entry) => entry.choice.id),
    ).toEqual([]);
    draft = engine.setChoice(draft, 'class.subclass', ['Draconic Bloodline']);
    const [ancestor] = choiceFor(draft, 'feature_choice');
    expect(ancestor?.choice.from).toContain('Black');
    expect(ancestor?.choice.from).toHaveLength(10);
  });
});

describe('level-1 class-feature choices: validation and staleness', () => {
  it('rejects a pick outside the option catalog', () => {
    const draft = engine.setChoice(
      baseDraft('Fighter'),
      'class.feature.fighter-fighting-style.fighting-style',
      ['Sniping'],
    );
    const [style] = choiceFor(draft, 'feature_choice');
    expect(style?.satisfied).toBe(false);
    expect(style?.refusal).toMatch(/not a legal option/);
    expect(finalizeCharacterDraft(draft, META).ok).toBe(false);
  });

  it('rejects expertise in an unproficient skill and in a wrong count', () => {
    let draft = baseDraft('Rogue');
    draft = engine.setChoice(draft, 'class.skills', [
      'Acrobatics',
      'Deception',
      'Stealth',
      'Perception',
    ]);
    const id = choiceFor(draft, 'expertise')[0]?.choice.id as string;
    const unproficient = engine.setChoice(draft, id, ['Stealth', 'Arcana']);
    expect(choiceFor(unproficient, 'expertise')[0]).toMatchObject({
      satisfied: false,
    });
    const tooMany = engine.setChoice(draft, id, ['Stealth']);
    expect(choiceFor(tooMany, 'expertise')[0]?.satisfied).toBe(false);
  });

  it('marks expertise stale when the skill it doubled is dropped', () => {
    let draft = baseDraft('Rogue');
    draft = engine.setChoice(draft, 'class.skills', [
      'Acrobatics',
      'Deception',
      'Stealth',
      'Perception',
    ]);
    const id = choiceFor(draft, 'expertise')[0]?.choice.id as string;
    draft = engine.setChoice(draft, id, ['Stealth', 'Thieves’ tools']);
    expect(draft.stale).not.toContain(id);
    expect(choiceFor(draft, 'expertise')[0]?.satisfied).toBe(true);

    draft = engine.setChoice(draft, 'class.skills', [
      'Acrobatics',
      'Deception',
      'Athletics',
      'Perception',
    ]);
    expect(draft.stale).toContain(id);
    expect(choiceFor(draft, 'expertise')[0]?.satisfied).toBe(false);
    // The stale pick still blocks finalization until it is re-chosen.
    const complete = fill(
      engine.setChoice(baseDraft('Rogue'), 'class.skills', [
        'Acrobatics',
        'Deception',
        'Stealth',
        'Perception',
      ]),
      { [id]: ['Stealth', 'Perception'] },
    );
    expect(finalizeCharacterDraft(complete, META).ok).toBe(true);
    const changed = engine.setChoice(complete, 'class.skills', [
      'Acrobatics',
      'Deception',
      'Athletics',
      'Insight',
    ]);
    expect(changed.stale).toContain(id);
    const blocked = finalizeCharacterDraft(changed, META);
    expect(blocked.ok).toBe(false);
    expect(blocked.ok ? [] : blocked.missing.map((m) => m.field)).toContain(id);
  });

  it('drops a subclass-granted pick when the subclass changes', () => {
    let draft = baseDraft('Sorcerer');
    draft = engine.setChoice(draft, 'class.subclass', ['Draconic Bloodline']);
    const id = choiceFor(draft, 'feature_choice')[0]?.choice.id as string;
    draft = engine.setChoice(draft, id, ['Black']);
    expect(draft.selections.choices?.[id]).toEqual(['Black']);
    draft = engine.setChoice(draft, 'class.subclass', undefined);
    expect(draft.selections.choices?.[id]).toBeUndefined();
  });
});

interface Expected {
  readonly className: string;
  readonly overrides?: Readonly<Record<string, readonly string[]>>;
  readonly spells: { cantrips: number; level1: number };
}

/** Finalize, store, and level 1 -> 2 with first-option level-up picks. */
function levelUpToTwo(sheet: CharacterSheet): CharacterSheet {
  const db = bareDb();
  const store = createSqliteCharacterSheetStore(db, () => META.createdAt);
  store.save('pc-1', sheet);
  const reloaded = store.load('pc-1') as CharacterSheet;
  const selections: Record<string, readonly string[]> = {};
  for (let guard = 0; guard < 12; guard += 1) {
    const required = detectLevelUpRequiredChoices(
      reloaded,
      resolver,
      undefined,
      selections,
    );
    const open = required.find(
      (choice) =>
        choice.status === 'supported' &&
        selections[choice.id] === undefined &&
        choice.optional !== true,
    );
    if (open === undefined) break;
    selections[open.id] = (open.from ?? []).slice(0, open.choose ?? 1);
  }
  const result = applyLevelUp(db, {
    store,
    choices: selections as LevelUpChoiceSelections,
    source: 'test',
    provenance: 'engine:level-up',
    sessionId: DEFAULT_TEST_SESSION_ID,
    at: META.createdAt,
  });
  db.close();
  return result.sheet;
}

describe('finalized level-1 characters', () => {
  const cases: readonly Expected[] = [
    { className: 'Fighter', spells: { cantrips: 0, level1: 0 } },
    { className: 'Ranger', spells: { cantrips: 0, level1: 0 } },
    { className: 'Rogue', spells: { cantrips: 0, level1: 0 } },
    {
      className: 'Cleric',
      overrides: { 'class.subclass': ['Life Domain'] },
      spells: { cantrips: 3, level1: 2 },
    },
    {
      className: 'Sorcerer',
      overrides: { 'class.subclass': ['Draconic Bloodline'] },
      spells: { cantrips: 4, level1: 2 },
    },
    {
      className: 'Warlock',
      overrides: { 'class.subclass': ['The Fiend'] },
      spells: { cantrips: 2, level1: 2 },
    },
    { className: 'Wizard', spells: { cantrips: 3, level1: 6 } },
  ];

  it.each(cases)(
    'persists $className choices and structured spells, then levels up without legacy classification',
    ({ className, overrides, spells }) => {
      let draft = fill(baseDraft(className), overrides);
      draft = engine.setSpells(draft, [
        ...spellNames(className, 0, spells.cantrips),
        ...spellNames(className, 1, spells.level1),
      ]);
      const sheet = finalize(draft);

      // Choices persist exactly as level-up persists them.
      for (const entry of engine.mechanicalChoices(draft)) {
        if (entry.application?.kind === 'feature-choice') {
          expect(sheet.featureChoices).toContainEqual(
            entry.application.featureChoice,
          );
          expect(entry.application.featureChoice.level).toBe(1);
        }
      }
      if (overrides?.['class.subclass'] !== undefined) {
        expect(sheet.subclass?.name).toBe(overrides['class.subclass'][0]);
      } else {
        expect(sheet.subclass).toBeUndefined();
      }

      // Structured spellcasting is written for casters, not a legacy flat list.
      if (spells.cantrips + spells.level1 > 0) {
        expect(sheet.spellcasting?.cantrips).toHaveLength(spells.cantrips);
        const bucket =
          className === 'Wizard'
            ? sheet.spellcasting?.spellbook
            : className === 'Cleric'
              ? sheet.spellcasting?.prepared
              : sheet.spellcasting?.known;
        expect(bucket).toHaveLength(spells.level1);
        expect(sheet.spells).toHaveLength(spells.cantrips + spells.level1);
        for (const ref of sheet.spells) expect(ref).toMatch(/^spell:/);
      } else {
        expect(sheet.spellcasting).toBeUndefined();
      }

      const leveled = levelUpToTwo(sheet);
      expect(leveled.level).toBe(2);
      if (sheet.subclass !== undefined) {
        expect(leveled.subclass).toEqual(sheet.subclass);
      }
      // Level-1 picks survive the level-up untouched.
      for (const pick of sheet.featureChoices ?? []) {
        expect(leveled.featureChoices).toContainEqual(pick);
      }
    },
  );

  it('records the exact fighter, ranger, rogue, and sorcerer shapes', () => {
    const fighter = finalize(fill(baseDraft('Fighter')));
    expect(fighter.featureChoices).toEqual([
      {
        featureRef: 'feature:fighter:fighting-style',
        choiceId: 'fighting-style',
        optionIds: ['fighting-style:archery'],
        level: 1,
      },
    ]);

    const ranger = finalize(fill(baseDraft('Ranger')));
    expect(ranger.featureChoices?.map((c) => c.choiceId)).toEqual([
      'favored-enemy',
      'favored-terrain',
    ]);

    const rogue = finalize(fill(baseDraft('Rogue')));
    const expertise = rogue.featureChoices?.find(
      (c) => c.choiceId === 'expertise',
    );
    expect(expertise).toMatchObject({
      featureRef: 'feature:rogue:expertise',
      level: 1,
    });
    expect(expertise?.optionIds).toHaveLength(2);

    const sorcerer = finalize(
      fill(baseDraft('Sorcerer'), {
        'class.subclass': ['Draconic Bloodline'],
      }),
    );
    expect(sorcerer.subclass).toEqual({
      key: 'subclass:draconic-bloodline',
      name: 'Draconic Bloodline',
    });
    expect(sorcerer.featureChoices).toEqual([
      {
        featureRef: 'feature:draconic-bloodline:dragon-ancestor',
        choiceId: 'dragon-ancestor',
        optionIds: ['dragon-ancestor:black'],
        level: 1,
      },
    ]);
  });

  it('refuses to finalize while a class-feature choice is unmade', () => {
    const draft = fill(baseDraft('Fighter'));
    const unmade = engine.setChoice(
      draft,
      'class.feature.fighter-fighting-style.fighting-style',
      undefined,
    );
    const result = finalizeCharacterDraft(unmade, META);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.missing.map((m) => m.field)).toContain(
      'class.feature.fighter-fighting-style.fighting-style',
    );
  });
});
