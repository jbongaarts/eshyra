import {
  type CharacterDraft,
  createCharacterCreationEngine,
  createRulesPackCharacterResolver,
  createSeededRng,
  getBundledDnd5eCharacterResolver,
  getBundledDnd5eSrdPack,
  type RulesPack,
  type RulesPackCharacterResolver,
  type RulesPackLicense,
  resolveRulesStack,
} from '@eshyra/core/internal';
import { describe, expect, it } from 'vitest';
import type { CharacterDraftStore } from '../src/characterDraftStore.js';
import {
  type CharacterWizardDeps,
  runCharacterWizard,
} from '../src/characterWizard.js';
import type { CliIO } from '../src/playTypes.js';

function scriptedIO(answers: ReadonlyArray<string>): {
  io: CliIO;
  lines: string[];
} {
  const lines: string[] = [];
  let next = 0;
  return {
    lines,
    io: {
      write: (l) => lines.push(l),
      prompt: async () => (next < answers.length ? answers[next++] : undefined),
    },
  };
}

function memoryStore(): CharacterDraftStore & {
  readonly saved: Map<string, CharacterDraft>;
} {
  const saved = new Map<string, CharacterDraft>();
  return {
    saved,
    save: (draft) => {
      saved.set(draft.id, draft);
    },
    load: (id) => saved.get(id),
    list: () => [...saved.keys()].sort(),
  };
}

function deps(
  answers: ReadonlyArray<string>,
  /**
   * Override the rules stack. Defaults to the bundled SRD pack, which provides
   * no starting-wealth table (ADR 0020 B4, eshyra-o9bd.19.2.1.1); the
   * starting-wealth cases pass a synthetic supplement instead.
   */
  resolver: RulesPackCharacterResolver = getBundledDnd5eCharacterResolver(),
): {
  deps: CharacterWizardDeps;
  lines: string[];
  store: ReturnType<typeof memoryStore>;
} {
  const { io, lines } = scriptedIO(answers);
  const store = memoryStore();
  return {
    lines,
    store,
    deps: {
      io,
      engine: createCharacterCreationEngine(resolver),
      resolver,
      store,
      rng: createSeededRng(42),
    },
  };
}

/**
 * A synthetic add-on supplying a starting-wealth table.
 *
 * The bundled SRD 5.1 pack provides none — SRD 5.1 has no starting-wealth text,
 * so the table the importer used to emit was compiler-authored content wearing
 * an SRD source line (ADR 0020 blocker B4, eshyra-o9bd.19.2.1.1). Every value
 * below is invented and deliberately unlike the PHB table; it exists only to
 * prove the wizard's wealth path still works where a licensed pack supplies it.
 *
 * Defined here rather than imported: `packages/core/test/support` is not part
 * of core's published surface and the CLI package cannot reach into it.
 */
const SYNTHETIC_LICENSE: RulesPackLicense = {
  licenseClass: 'open',
  licenseName: 'Synthetic test license',
  attributionText: 'Test-only invented data. Not derived from any source.',
  requiresAttribution: false,
  commercialUseAllowed: true,
  hostedUseAllowed: true,
  redistributionAllowed: true,
  publicSharingAllowed: true,
  derivativeAllowed: true,
  containsUserSuppliedText: false,
  containsTrademarkedSettingMaterial: false,
  sourceMaterialDescription: 'Invented test values; no external rules text.',
  provenancePolicy:
    'Every record names the synthetic fixture that authored it.',
  outputRestrictions: 'Test fixture; not for redistribution as game content.',
};

const STARTING_WEALTH_SUPPLEMENT: RulesPack = {
  meta: {
    packId: 'rules:test-starting-wealth-supplement',
    title: 'Synthetic starting-wealth supplement',
    description:
      'Test-only add-on supplying an invented starting-wealth table.',
    role: 'addon',
    systemId: 'dnd5e-srd',
    version: '1.0.0',
    order: 1,
    compatibleBaseSystems: [{ systemId: 'dnd5e-srd', versions: ['5.1'] }],
    license: SYNTHETIC_LICENSE,
    source: {
      sourceTitle: 'Synthetic test supplement',
      sourceVersion: '1.0.0',
      sourceIdentity: 'synthetic:starting-wealth-supplement',
      recordProvenancePolicy:
        'Every record names the synthetic fixture that authored it.',
    },
  },
  records: [
    {
      systemId: 'dnd5e-srd',
      kind: 'table',
      key: 'table:starting-wealth-by-class',
      name: 'Starting Wealth by Class',
      data: {
        columns: ['Class', 'Starting Wealth'],
        rows: [
          ['Fighter', '2d2 \u00d7 3 gp'],
          ['Wizard', '2d2 \u00d7 3 gp'],
        ],
      },
      source: 'Synthetic test supplement',
      license: SYNTHETIC_LICENSE,
      provenance: {
        sourceRef: 'synthetic:starting-wealth-supplement',
        note: 'Invented test values; not extracted from any published source.',
      },
    },
  ],
};

function supplementedResolver(): RulesPackCharacterResolver {
  return createRulesPackCharacterResolver(
    resolveRulesStack({
      base: getBundledDnd5eSrdPack(),
      addons: [STARTING_WEALTH_SUPPLEMENT],
    }),
  );
}

const text = (lines: readonly string[]): string => lines.join('\n');

describe('character wizard — concept-first happy path', () => {
  it('walks identity → class → ancestry → background → scores → review to completion', async () => {
    // Step order: identity, class, ancestry, background, ability-scores,
    // class-choices, spells-equipment, review.
    const {
      deps: d,
      lines,
      store,
    } = deps([
      'Mira', // identity name
      'Wizard', // class
      'High Elf', // ancestry
      '', // background (skip)
      'point_buy', // ability method
      // A valid 27-point build: 0+7+7+9+2+2 = 27.
      'str 8',
      'dex 14',
      'con 14',
      'int 15',
      'wis 10',
      'cha 10',
      'done', // ability scores complete
      '', // keep package acquisition mode
      // class-choices: Wizard skills (choose 2) + three equipment groups.
      'Arcana',
      'Investigation',
      '1', // equipment.0 → a quarterstaff
      '2', // equipment.1 → an arcane focus
      'scholar', // equipment.2 → a scholar's pack (prefix)
      'Fire Bolt, Magic Missile', // spells
      '', // review: Enter to finish
    ]);

    const result = await runCharacterWizard(d, {
      mode: 'concept-first',
      draftId: 'mira',
    });

    expect(result.outcome).toBe('completed');
    expect(result.draft.identity.name).toBe('Mira');
    expect(result.draft.selections.className).toBe('Wizard');
    expect(result.draft.selections.ancestry).toBe('High Elf');
    // Mechanical choices were captured on the draft.
    expect(result.draft.selections.choices?.['class.skills']).toEqual([
      'Arcana',
      'Investigation',
    ]);
    expect(result.draft.selections.choices?.['class.equipment.0']).toEqual([
      'a quarterstaff',
    ]);
    expect(result.draft.selections.spells).toEqual([
      'Fire Bolt',
      'Magic Missile',
    ]);
    // High Elf +1 INT pushes base 15 → 16; spell DC = 8 + 2 + 3 = 13.
    expect(result.draft.derived.spellSaveDc).toBe(13);
    // Completion persists the draft.
    expect(result.saved).toBe(true);
    expect(store.saved.has('mira')).toBe(true);
    // The exact mode label is shown.
    expect(text(lines)).toContain('Concept-first — I know what I want to play');
  });
});

const SCORE_ANSWERS = [
  'str 15',
  'dex 14',
  'con 13',
  'int 12',
  'wis 10',
  'cha 8',
  'done',
];

describe('character wizard — starting acquisition mode', () => {
  it('does not offer wealth when no active pack provides the table', async () => {
    // Bundled SRD stack: the mode must not be advertised, and asking for it
    // anyway must report the truthful reason instead of setting an unusable
    // mode (ADR 0020 B4, eshyra-o9bd.19.2.1.1).
    const { deps: d, lines } = deps([
      'Mira',
      'Fighter',
      'Human',
      '',
      'point_buy',
      ...SCORE_ANSWERS,
      '2',
      'quit',
      'n',
    ]);
    const result = await runCharacterWizard(d, {
      mode: 'concept-first',
      draftId: 'wealth-unavailable',
    });
    const output = text(lines);
    expect(output).toContain(
      'no active rules pack provides a starting-wealth table',
    );
    expect(output).not.toContain('2/wealth');
    expect(result.draft.selections.startingEquipmentMode).not.toBe(
      'starting-wealth',
    );
  });

  it('reaches starting wealth, rolls once, and skips only equipment choices', async () => {
    // Supplement-backed: proves the wizard path was disabled by data, not
    // deleted. Values come from the synthetic pack, never the PHB table.
    const { deps: d, lines } = deps(
      [
        'Mira',
        'Fighter',
        'Human',
        '',
        'point_buy',
        ...SCORE_ANSWERS,
        '2',
        'Athletics',
        'Perception',
        'Dwarvish',
        '',
        '',
        '',
        '',
      ],
      supplementedResolver(),
    );
    const result = await runCharacterWizard(d, {
      mode: 'concept-first',
      draftId: 'wealth',
    });
    expect(result.outcome).toBe('completed');
    expect(result.draft.selections.startingEquipmentMode).toBe(
      'starting-wealth',
    );
    expect(result.draft.selections.startingWealth?.roll.rolls).toHaveLength(2);
    expect(
      result.draft.selections.choices?.['class.equipment.0'],
    ).toBeUndefined();
    expect(text(lines)).toContain('Starting wealth: 2d2');
    expect(text(lines)).toContain('Acquisition: starting-wealth');
  });
});

describe('character wizard — resolver-backed choices', () => {
  it('accepts an unambiguous class prefix', async () => {
    const { deps: d } = deps(['Hero', 'wiz', 'Elf', '', 'point_buy', 'quit']);
    const result = await runCharacterWizard(d, {
      mode: 'concept-first',
      draftId: 'p',
    });
    expect(result.draft.selections.className).toBe('Wizard');
  });

  it('rejects an unknown class with actionable suggestions, no draft failure', async () => {
    const { deps: d, lines } = deps([
      'Hero',
      'Wizrd', // typo → no exact, no unique prefix
      'Wizard', // recover
      'Elf',
      '',
      'point_buy',
      'quit',
    ]);
    const result = await runCharacterWizard(d, {
      mode: 'concept-first',
      draftId: 'p',
    });
    expect(text(lines)).toMatch(/No class matches "Wizrd"|Did you mean/);
    // Despite the bad entry the draft recovered and recorded the valid class.
    expect(result.draft.selections.className).toBe('Wizard');
  });

  it('lists and searches options for a step', async () => {
    const { deps: d, lines } = deps([
      'list', // identity step has nothing to list
      'Hero',
      'list', // class list
      'search rog', // class search
      'Rogue',
      'quit',
    ]);
    await runCharacterWizard(d, { mode: 'concept-first', draftId: 'p' });
    const out = text(lines);
    expect(out).toContain('Wizard');
    expect(out).toContain('Rogue');
  });
});

describe('character wizard — navigation and corrections', () => {
  it('preserves prior answers across back and set', async () => {
    const { deps: d } = deps([
      'Mira', // identity
      'Fighter', // class
      'back', // → identity
      '', // keep existing name, advance
      'set class Wizard', // correct class via set (global command)
      '', // class step: Enter to advance (class already set)
      'Elf', // ancestry
      'quit',
    ]);
    const result = await runCharacterWizard(d, {
      mode: 'concept-first',
      draftId: 'p',
    });
    // Name survived the back navigation; class correction took effect.
    expect(result.draft.identity.name).toBe('Mira');
    expect(result.draft.selections.className).toBe('Wizard');
    expect(result.draft.selections.ancestry).toBe('Elf');
  });

  it('review shows completed fields, derived values, and what is missing', async () => {
    const { deps: d, lines } = deps([
      'Mira',
      'Fighter',
      'review', // mid-flow review (global)
      'quit',
    ]);
    await runCharacterWizard(d, { mode: 'concept-first', draftId: 'p' });
    const out = text(lines);
    expect(out).toContain('Draft review');
    expect(out).toContain('Mira');
    expect(out).toContain('Fighter');
    // Not finalizable yet (scores missing).
    expect(out).toMatch(/not finalizable yet|Still needed/);
  });
});

describe('character wizard — save, quit, and resume', () => {
  it('saves on explicit save and reports it', async () => {
    const { deps: d, lines, store } = deps(['Mira', 'save', 'quit']);
    await runCharacterWizard(d, { mode: 'concept-first', draftId: 'keep' });
    expect(store.saved.has('keep')).toBe(true);
    expect(text(lines)).toContain('Draft saved.');
  });

  it('offers to save on quit when there are unsaved changes', async () => {
    // The "unsaved changes? (y/n)" text is the prompt question (not a written
    // line), so assert on the persisted result and the post-save confirmation.
    const {
      deps: d,
      lines,
      store,
    } = deps([
      'Mira', // unsaved change
      'quit', // triggers save prompt
      'y', // yes, save
    ]);
    const result = await runCharacterWizard(d, {
      mode: 'concept-first',
      draftId: 'q',
    });
    expect(result.outcome).toBe('quit');
    expect(store.saved.has('q')).toBe(true);
    expect(text(lines)).toContain('Draft saved.');
  });

  it('does not prompt to save on quit when nothing changed', async () => {
    const { deps: d, lines } = deps(['quit']);
    const result = await runCharacterWizard(d, {
      mode: 'concept-first',
      draftId: 'q',
    });
    expect(result.outcome).toBe('quit');
    expect(text(lines)).not.toMatch(/unsaved changes/i);
  });

  it('resumes a saved draft without losing state', async () => {
    // First session: set a name and class, then save+quit.
    const first = deps(['Mira', 'Wizard', 'save', 'quit']);
    await runCharacterWizard(first.deps, {
      mode: 'concept-first',
      draftId: 'resume-me',
    });
    const stored = first.store.saved.get('resume-me');
    expect(stored?.selections.className).toBe('Wizard');

    // Second session: resume from the stored draft. The wizard restarts at the
    // first step with all prior state preserved — Enter steps past the settled
    // name and class, then we set ancestry and quit.
    const second = deps(['', '', 'Elf', 'quit']);
    const result = await runCharacterWizard(second.deps, {
      mode: stored?.creationMode ?? 'concept-first',
      draftId: 'resume-me',
      resume: stored,
    });
    expect(result.draft.identity.name).toBe('Mira');
    expect(result.draft.selections.className).toBe('Wizard');
    expect(result.draft.selections.ancestry).toBe('Elf');
  });

  it('persists unsaved work on end-of-input', async () => {
    // No quit; input simply runs out after a change.
    const { deps: d, store } = deps(['Mira']);
    const result = await runCharacterWizard(d, {
      mode: 'concept-first',
      draftId: 'eof',
    });
    expect(result.saved).toBe(true);
    expect(store.saved.get('eof')?.identity.name).toBe('Mira');
  });
});

describe('character wizard — ability-first flow', () => {
  it('collects method and scores before class, then suggests fitting classes', async () => {
    // Ability-first step order: identity, ability-method, ability-scores,
    // class-recommendations, class, ancestry, background, class-choices,
    // spells-equipment, review.
    const {
      deps: d,
      lines,
      store,
    } = deps([
      'Thalia', // identity
      'point_buy', // ability-method step
      // Wizard-leaning build (high INT): 0+7+7+9+2+2 = 27.
      'str 8',
      'dex 14',
      'con 14',
      'int 15',
      'wis 10',
      'cha 10',
      'done', // scores complete
      '', // class-recommendations: Enter to continue
      'Wizard', // class
      'High Elf', // ancestry
      '', // background skip
      // class-choices: skills (choose 2) + three equipment groups.
      '', // keep package acquisition mode
      'Arcana',
      'Investigation',
      '1', // a quarterstaff
      '1', // a component pouch
      '1', // a scholar's pack
      '', // spells skip
      '', // review finish
    ]);

    const result = await runCharacterWizard(d, {
      mode: 'ability-first',
      draftId: 'thalia',
    });

    expect(result.outcome).toBe('completed');
    expect(result.draft.selections.className).toBe('Wizard');
    expect(result.draft.selections.ancestry).toBe('High Elf');
    const out = text(lines);
    // Exact ability-first mode label.
    expect(out).toContain('Ability-first — let the dice inspire me');
    // Deterministic class-fit panel appears before class selection; the
    // INT-heavy build surfaces Wizard as a suggestion.
    expect(out).toContain('Classes that fit your scores');
    expect(out).toMatch(/Wizard \(fit \+/);
    expect(store.saved.has('thalia')).toBe(true);
  });

  it('rolls 4d6-drop-lowest deterministically under a seeded RNG', async () => {
    // `roll` only offered for the rolled method; values come from the seeded RNG.
    const { deps: d, lines } = deps([
      'Dice', // identity
      'rolled', // ability-method
      'roll', // roll a pool
      'quit', // stop (don't need to finish assignment)
    ]);
    await runCharacterWizard(d, { mode: 'ability-first', draftId: 'r' });
    const rolledLine = lines.find((l) => l.startsWith('Rolled pool: '));
    expect(rolledLine).toBeDefined();
    expect(
      lines.some((line) =>
        /^ {2}4d6dl1: \[.*\] → kept \[.*\], dropped die #\d \[\d\] → \d+$/.test(
          line,
        ),
      ),
    ).toBe(true);
    // Six totals, each a valid 4d6-drop-lowest result (3–18), sorted desc.
    const totals = (rolledLine as string)
      .slice('Rolled pool: '.length)
      .split(', ')
      .map((n) => Number.parseInt(n, 10));
    expect(totals).toHaveLength(6);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
    for (const t of totals) {
      expect(t).toBeGreaterThanOrEqual(3);
      expect(t).toBeLessThanOrEqual(18);
    }
  });

  it('does not advance rolled scores without canonical roll evidence', async () => {
    const { deps: d, lines } = deps([
      'Dice',
      'rolled',
      'str 12',
      'dex 12',
      'con 12',
      'int 12',
      'wis 12',
      'cha 12',
      'done',
      'quit',
    ]);
    const result = await runCharacterWizard(d, {
      mode: 'ability-first',
      draftId: 'missing-rolls',
    });

    expect(result.outcome).toBe('quit');
    expect(lines).toContain(
      '  ✗ roll six ability scores before assigning them',
    );
    expect(text(lines)).not.toContain('Classes that fit your scores');
  });

  it('lets the player choose a poor-fit class after seeing suggestions', async () => {
    // A brawny build is shown Barbarian/Fighter etc., but the player insists on
    // Wizard — the flow must allow it (suggestions are advisory).
    const { deps: d } = deps([
      'Brawn',
      'point_buy',
      'str 15',
      'dex 14',
      'con 14',
      'int 8',
      'wis 10',
      'cha 10',
      'done',
      '', // recommendations
      'Wizard', // deliberate poor fit
      'quit',
    ]);
    const result = await runCharacterWizard(d, {
      mode: 'ability-first',
      draftId: 'pf',
    });
    expect(result.draft.selections.className).toBe('Wizard');
  });
});

describe('character wizard — equipment & proficiency choices (eshyra-b69j.13)', () => {
  // Reach the Class choices step quickly: a Fighter with valid scores, no
  // background. Fighter's mechanical choices are a skill group (choose 2) and
  // four equipment choose-one groups.
  const TO_CLASS_CHOICES = [
    'Grok', // identity
    'Fighter', // class
    'Human', // ancestry (Human grants one free language choice too)
    '', // background skip
    'point_buy',
    'str 15',
    'dex 14',
    'con 13',
    'int 12',
    'wis 10',
    'cha 8',
    'done',
    '', // keep package acquisition mode
  ] as const;

  it('collects a skill choice group and an equipment choice group', async () => {
    const { deps: d } = deps([
      ...TO_CLASS_CHOICES,
      // Human language choice (one of your choice) comes first among ancestry
      // choices? Order is class skills, class equipment, then ancestry. So:
      'Athletics', // skills 1
      'Perception', // skills 2
      '1', // equipment.0
      '1', // equipment.1
      '1', // equipment.2
      '1', // equipment.3
      'Dwarvish', // Human ancestry language (choose 1)
      'quit',
    ]);
    const result = await runCharacterWizard(d, {
      mode: 'concept-first',
      draftId: 'grok',
    });
    expect(result.draft.selections.choices?.['class.skills']).toEqual([
      'Athletics',
      'Perception',
    ]);
    expect(result.draft.selections.choices?.['class.equipment.0']).toHaveLength(
      1,
    );
    expect(result.draft.selections.choices?.['ancestry.languages']).toEqual([
      'Dwarvish',
    ]);
  });

  it('rejects an invalid pick without resetting prior valid picks', async () => {
    const { deps: d, lines } = deps([
      ...TO_CLASS_CHOICES,
      'Athletics', // valid skill 1
      'Underwater Basketweaving', // invalid — must not reset
      'Perception', // valid skill 2
      'quit',
    ]);
    const result = await runCharacterWizard(d, {
      mode: 'concept-first',
      draftId: 'grok',
    });
    expect(text(lines)).toMatch(/is not an option here/);
    // Athletics survived the invalid entry; both valid picks are recorded.
    expect(result.draft.selections.choices?.['class.skills']).toEqual([
      'Athletics',
      'Perception',
    ]);
  });

  it('shows the remaining count and rejects a duplicate pick', async () => {
    const { deps: d, lines } = deps([
      ...TO_CLASS_CHOICES,
      'Athletics',
      'Athletics', // duplicate — rejected
      'Perception',
      'quit',
    ]);
    await runCharacterWizard(d, { mode: 'concept-first', draftId: 'grok' });
    const out = text(lines);
    expect(out).toMatch(/Choose 2 — 2 remaining/);
    expect(out).toMatch(/already selected/);
  });

  it('blocks finishing at review while choices are pending, then completes once made', async () => {
    // Walk to review WITHOUT making the class choices: review must refuse to
    // finish and point back to the Class choices step.
    const blocked = deps([
      ...TO_CLASS_CHOICES,
      // class-choices step is interactive; `back` out of the first group to land
      // before it, then jump to review is not possible — instead quit to inspect.
      'quit',
    ]);
    const blockedResult = await runCharacterWizard(blocked.deps, {
      mode: 'concept-first',
      draftId: 'grok',
    });
    // Quitting before completing leaves the draft non-finalizable with pending
    // mechanical choices recorded as none.
    expect(blockedResult.outcome).toBe('quit');
    expect(
      blocked.deps.engine
        .mechanicalChoices(blockedResult.draft)
        .some((m) => !m.satisfied),
    ).toBe(true);

    // Now a full run that makes every choice reaches completion.
    const done = deps([
      ...TO_CLASS_CHOICES,
      'Athletics',
      'Perception',
      '1',
      '1',
      '1',
      '1',
      'Dwarvish',
      '', // spells skip
      '', // review → all satisfied → finish
    ]);
    const doneResult = await runCharacterWizard(done.deps, {
      mode: 'concept-first',
      draftId: 'grok2',
    });
    expect(doneResult.outcome).toBe('completed');
    expect(
      done.deps.engine
        .mechanicalChoices(doneResult.draft)
        .every((m) => m.satisfied),
    ).toBe(true);
  });

  it('corrects a valid-but-wrong equipment pick on re-entry (clear + re-pick)', async () => {
    // First pass picks equipment.0 option (b); the player wants (a). Re-enter
    // the Class choices step (via review's jump) and fix it.
    const { deps: d } = deps([
      ...TO_CLASS_CHOICES,
      'Athletics',
      'Perception',
      '2', // equipment.0 → leather armor, longbow, and 20 arrows (the WRONG pick)
      '1',
      '1',
      '1',
      'Dwarvish',
      '', // spells skip
      // review: all satisfied → finishes. Re-open via a fresh resume below.
      '',
    ]);
    const first = await runCharacterWizard(d, {
      mode: 'concept-first',
      draftId: 'fix',
    });
    expect(first.draft.selections.choices?.['class.equipment.0']).toEqual([
      'leather armor, longbow, and 20 arrows',
    ]);

    // Resume the saved draft: walk to the equipment.0 group (skills + nothing to
    // change → keep with Enter), clear it, pick (a), keep the rest, finish.
    const resumed = deps([
      '', // identity keep
      '', // class keep
      '', // ancestry keep
      '', // background keep
      // ability-scores already complete → done
      'done',
      '', // keep package acquisition mode
      // class choices (all satisfied → edit mode): skills keep, equipment.0 fix
      '', // skills keep
      'clear', // equipment.0 → clear
      '1', // equipment.0 → chain mail (corrected)
      '', // equipment.1 keep
      '', // equipment.2 keep
      '', // equipment.3 keep
      '', // ancestry languages keep
      '', // spells keep
      '', // review finish
    ]);
    const result = await runCharacterWizard(resumed.deps, {
      mode: first.draft.creationMode,
      draftId: 'fix',
      resume: first.draft,
    });
    expect(result.draft.selections.choices?.['class.equipment.0']).toEqual([
      'chain mail',
    ]);
    // The other choices survived the correction.
    expect(result.draft.selections.choices?.['class.skills']).toEqual([
      'Athletics',
      'Perception',
    ]);
  });

  it('supports `clear` mid-group to redo picks before the count is reached', async () => {
    // Skills is choose-2: pick one, clear, then pick the two intended skills.
    const { deps: d } = deps([
      ...TO_CLASS_CHOICES,
      'Athletics', // first (unwanted) pick
      'clear', // start the group over
      'Acrobatics',
      'Insight',
      '1', // equipment.0..3
      '1',
      '1',
      '1',
      'Dwarvish',
      'quit',
    ]);
    const result = await runCharacterWizard(d, {
      mode: 'concept-first',
      draftId: 'clear',
    });
    expect(result.draft.selections.choices?.['class.skills']).toEqual([
      'Acrobatics',
      'Insight',
    ]);
  });
});
