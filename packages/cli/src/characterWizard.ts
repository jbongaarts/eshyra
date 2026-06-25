/**
 * Guided character-creation wizard shell (eshyra-b69j.10) and the concept-first
 * flow that runs in it (eshyra-b69j.8).
 *
 * The shell is a UI-only layer over the pure core engine
 * (`getDnd5eCharacterCreationEngine`) and the generated-rules-pack resolver: it
 * never computes rules itself. It walks the recipe's step order for the chosen
 * mode and, at every step, accepts both a step answer and a shared command set:
 *
 *   ?/help · list · search <term> · back · review · set <field> <value> ·
 *   save · quit
 *
 * Answers and corrections go through the engine's setters, so prior answers are
 * preserved and validation/derived values recompute on every change. Class,
 * ancestry, background, and spell choices resolve through the resolver by
 * display name, canonical key, case-insensitive text, or a safe unambiguous
 * prefix; failures return actionable suggestions instead of failing the draft.
 * Drafts can be saved and resumed via the injected {@link CharacterDraftStore}.
 *
 * Finalizing a completed draft into a playable character record is deliberately
 * out of scope here (eshyra-b69j.14); the wizard ends at a saved, reviewable
 * draft. Skill/tool/equipment *selection* persistence is likewise future work
 * (eshyra-b69j.13) — those steps surface the required choices but only spells
 * (which the engine models) are collected today.
 */

import {
  ABILITY_FULL_NAMES,
  ABILITY_SCORE_NAMES,
  type AbilityScoreMethod,
  type AbilityScoreName,
  type CharacterCreationDiagnostic,
  type CharacterCreationEngine,
  type CharacterDraft,
  DND5E_SRD_CHARACTER_RECIPE,
  enumerateLevel1RequiredChoices,
  parseAbilityScoreCommand,
  type RulesPackCharacterResolver,
  summarizePointBuy,
  summarizeStandardArray,
} from '@eshyra/core/internal';
import type { CharacterDraftStore } from './characterDraftStore.js';
import type { CliIO } from './playTypes.js';

/** Collaborators the wizard drives; all injectable for tests. */
export interface CharacterWizardDeps {
  readonly io: CliIO;
  readonly engine: CharacterCreationEngine;
  readonly resolver: RulesPackCharacterResolver;
  readonly store: CharacterDraftStore;
}

/** What to create or resume. */
export interface CharacterWizardOptions {
  readonly mode: string;
  readonly draftId: string;
  /** A previously-saved draft to resume; a fresh draft is created when absent. */
  readonly resume?: CharacterDraft;
}

/** How the wizard ended. */
export interface CharacterWizardResult {
  readonly draft: CharacterDraft;
  readonly outcome: 'completed' | 'quit';
  readonly saved: boolean;
}

const MAX_SUGGESTIONS = 8;

/** Run the interactive wizard to completion, a quit, or end-of-input. */
export async function runCharacterWizard(
  deps: CharacterWizardDeps,
  options: CharacterWizardOptions,
): Promise<CharacterWizardResult> {
  const wizard = new Wizard(deps, options);
  return wizard.run();
}

type Nav = 'advance' | 'back' | 'stay' | 'quit' | 'eof';

/** Per-step configuration for an enumerable, resolver-backed choice. */
interface ChoiceConfig {
  readonly noun: string;
  set(draft: CharacterDraft, value: string): CharacterDraft;
  /** Canonical display name when `value` resolves cleanly, else undefined. */
  resolveName(value: string): string | undefined;
  options(draft: CharacterDraft): readonly ChoiceOption[];
}

interface ChoiceOption {
  readonly name: string;
  readonly detail?: string;
}

class Wizard {
  private draft: CharacterDraft;
  private dirty: boolean;
  private readonly steps: readonly { id: string; label: string }[];

  constructor(
    private readonly deps: CharacterWizardDeps,
    private readonly options: CharacterWizardOptions,
  ) {
    this.draft =
      options.resume ??
      deps.engine.createDraft({ id: options.draftId, mode: options.mode });
    // A resumed draft is in sync with disk; a fresh one has nothing to lose yet.
    this.dirty = false;
    this.steps = DND5E_SRD_CHARACTER_RECIPE.getStepOrder(options.mode);
  }

  async run(): Promise<CharacterWizardResult> {
    this.intro();
    let index = 0;
    while (index < this.steps.length) {
      const nav = await this.runStep(
        this.steps[index] as (typeof this.steps)[number],
      );
      if (nav === 'quit') {
        return { draft: this.draft, outcome: 'quit', saved: !this.dirty };
      }
      if (nav === 'eof') {
        // End-of-input: persist unsaved work rather than silently dropping it.
        if (this.dirty) {
          this.deps.store.save(this.draft);
          this.dirty = false;
        }
        return { draft: this.draft, outcome: 'quit', saved: true };
      }
      if (nav === 'back') {
        index = Math.max(0, index - 1);
        continue;
      }
      index += 1;
    }
    // Walked off the end of the (review) step → completed.
    if (this.dirty) {
      this.deps.store.save(this.draft);
      this.dirty = false;
    }
    return { draft: this.draft, outcome: 'completed', saved: true };
  }

  private intro(): void {
    const mode = DND5E_SRD_CHARACTER_RECIPE.getModes().find(
      (m) => m.id === this.options.mode,
    );
    this.write(`Character creation — ${mode?.label ?? this.options.mode}`);
    this.write('Type ? at any step for commands. Press Enter to continue.');
  }

  private async runStep(step: { id: string; label: string }): Promise<Nav> {
    if (step.id === 'ability-scores') {
      return this.runAbilityScores();
    }
    this.write('');
    this.write(`== ${step.label} ==`);
    this.write(this.stepIntro(step.id));
    for (;;) {
      const input = await this.deps.io.prompt(`${step.label}> `);
      if (input === undefined) {
        return 'eof';
      }
      const command = parseCommand(input);
      const global = await this.handleGlobalCommand(step, command);
      if (global !== 'not-global') {
        if (global === 'handled') {
          continue;
        }
        return global;
      }
      const nav = this.applyStepAnswer(step.id, input.trim());
      if (nav !== 'stay') {
        return nav;
      }
    }
  }

  // --- Global commands -------------------------------------------------------

  private async handleGlobalCommand(
    step: { id: string; label: string },
    command: ParsedCommand,
  ): Promise<'handled' | 'not-global' | Nav> {
    switch (command.name) {
      case '?':
      case 'help':
        this.printHelp(step.id);
        return 'handled';
      case 'list':
        this.printOptions(step.id, undefined);
        return 'handled';
      case 'search':
        this.printOptions(step.id, command.rest);
        return 'handled';
      case 'review':
        this.printReview();
        return 'handled';
      case 'save':
        this.deps.store.save(this.draft);
        this.dirty = false;
        this.write('Draft saved.');
        return 'handled';
      case 'set':
        this.applySet(command.rest);
        return 'handled';
      case 'back':
        return 'back';
      case 'quit':
      case 'exit':
        return this.confirmQuit();
      default:
        return 'not-global';
    }
  }

  private async confirmQuit(): Promise<Nav> {
    if (!this.dirty) {
      return 'quit';
    }
    const answer = await this.deps.io.prompt(
      'You have unsaved changes. Save before quitting? (y/n) ',
    );
    if (answer === undefined) {
      // EOF during the prompt — save to be safe.
      this.deps.store.save(this.draft);
      this.dirty = false;
      return 'quit';
    }
    if (/^y(es)?$/i.test(answer.trim())) {
      this.deps.store.save(this.draft);
      this.dirty = false;
      this.write('Draft saved.');
    }
    return 'quit';
  }

  // --- Step answers ----------------------------------------------------------

  private applyStepAnswer(stepId: string, value: string): Nav {
    switch (stepId) {
      case 'identity':
        return this.applyIdentity(value);
      case 'class':
      case 'ancestry':
      case 'background':
        return this.applyChoiceStep(stepId, value);
      case 'spells-equipment':
        return this.applySpells(value);
      case 'class-choices':
        // No engine-modelled selections yet (eshyra-b69j.13); Enter advances.
        if (value.length > 0) {
          this.write(
            'Class choices (skills, tools, equipment) are collected in a later step (eshyra-b69j.13). Press Enter to continue.',
          );
          return 'stay';
        }
        return 'advance';
      case 'review':
        return this.applyReview(value);
      default:
        // Unknown/ability-first-only step: nothing to apply, Enter advances.
        return value.length === 0 ? 'advance' : 'stay';
    }
  }

  private applyIdentity(value: string): Nav {
    if (value.length === 0) {
      if (this.draft.identity.name && this.draft.identity.name.length > 0) {
        return 'advance';
      }
      this.write(
        'Enter a character name (or `set concept <text>` to add a concept).',
      );
      return 'stay';
    }
    this.draft = this.deps.engine.setIdentity(this.draft, { name: value });
    this.dirty = true;
    this.write(`Name set to "${value}".`);
    return 'advance';
  }

  private applyChoiceStep(stepId: string, value: string): Nav {
    const config = this.choiceConfig(stepId);
    if (value.length === 0) {
      // Empty input keeps an already-made choice and advances (so resume / back
      // can step through settled answers). Background is always optional.
      if (stepId === 'background' || this.choiceAlreadySet(stepId)) {
        return 'advance';
      }
      this.write(
        `Choose a ${config.noun} (try \`list\` or \`search <term>\`).`,
      );
      return 'stay';
    }
    const result = applyChoice(config, this.draft, value);
    if (!result.ok) {
      this.write(result.message);
      this.printSuggestions(result.suggestions);
      return 'stay';
    }
    this.draft = result.draft;
    this.dirty = true;
    if (result.message) {
      this.write(result.message);
    }
    return 'advance';
  }

  /** Whether the choice for a class/ancestry/background step resolves cleanly. */
  private choiceAlreadySet(stepId: string): boolean {
    const selections = this.draft.selections;
    const current =
      stepId === 'class'
        ? selections.className
        : stepId === 'ancestry'
          ? selections.ancestry
          : selections.background;
    if (current === undefined) {
      return false;
    }
    return this.choiceConfig(stepId).resolveName(current) !== undefined;
  }

  private applySpells(value: string): Nav {
    if (value.length === 0) {
      return 'advance'; // spells are optional for a finalizable draft
    }
    const spells = value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    this.draft = this.deps.engine.setSpells(this.draft, spells);
    this.dirty = true;
    const errors = this.draft.diagnostics.filter(
      (d) => d.field === 'spells' && d.severity === 'error',
    );
    if (errors.length > 0) {
      for (const error of errors) {
        this.write(`  ✗ ${error.message}`);
      }
      this.write('Fix the spell selection or `set spells <names>` to retry.');
      return 'stay';
    }
    this.write(`Selected ${spells.length} spell(s).`);
    return 'advance';
  }

  private applyReview(value: string): Nav {
    if (value.length === 0 || /^(done|finish)$/i.test(value)) {
      this.printReview();
      return 'advance';
    }
    this.write(
      'At review: press Enter (or `done`) to finish, or `set <field> <value>` to correct.',
    );
    return 'stay';
  }

  // --- `set <field> <value>` -------------------------------------------------

  private applySet(rest: string): void {
    const command = parseCommand(rest);
    const field = command.name.toLowerCase();
    const value = command.rest;
    if (field.length === 0) {
      this.write('Usage: set <field> <value> (e.g. `set class Wizard`).');
      return;
    }
    const ability = abilityFromToken(field);
    if (ability !== undefined) {
      this.setAbilityScore(ability, value);
      return;
    }
    switch (field) {
      case 'name':
        this.draft = this.deps.engine.setIdentity(this.draft, { name: value });
        break;
      case 'concept':
        this.draft = this.deps.engine.setIdentity(this.draft, {
          concept: value,
        });
        break;
      case 'class':
      case 'ancestry':
      case 'background': {
        const result = applyChoice(this.choiceConfig(field), this.draft, value);
        if (!result.ok) {
          this.write(result.message);
          this.printSuggestions(result.suggestions);
          return;
        }
        this.draft = result.draft;
        break;
      }
      case 'spells':
        this.draft = this.deps.engine.setSpells(
          this.draft,
          value
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
        );
        break;
      default:
        this.write(`Unknown field: "${field}".`);
        return;
    }
    this.dirty = true;
    this.write(`Updated ${field}.`);
  }

  private setAbilityScore(ability: AbilityScoreName, raw: string): void {
    if (!/^[+-]?\d+$/.test(raw.trim())) {
      this.write(`${ABILITY_FULL_NAMES[ability]} must be a whole number.`);
      return;
    }
    this.draft = this.deps.engine.setAbilityScore(
      this.draft,
      ability,
      Number.parseInt(raw.trim(), 10),
    );
    this.dirty = true;
    this.write(`Set ${ABILITY_FULL_NAMES[ability]} to ${raw.trim()}.`);
  }

  // --- Ability-scores step ---------------------------------------------------

  private async runAbilityScores(): Promise<Nav> {
    this.write('');
    this.write('== Ability scores ==');
    if (this.draft.selections.abilityScoreMethod === undefined) {
      const nav = await this.chooseAbilityMethod();
      if (nav !== 'stay') {
        return nav;
      }
    }
    this.write(
      'Enter scores like `str 15`. Commands: done, reset, review, save, back, quit.',
    );
    for (;;) {
      this.write(this.abilitySummary());
      const input = await this.deps.io.prompt('Ability scores> ');
      if (input === undefined) {
        return 'eof';
      }
      const command = parseCommand(input);
      if (command.name === 'review') {
        this.printReview();
        continue;
      }
      if (command.name === 'save') {
        this.deps.store.save(this.draft);
        this.dirty = false;
        this.write('Draft saved.');
        continue;
      }
      if (command.name === '?' || command.name === 'help') {
        this.printHelp('ability-scores');
        continue;
      }
      if (command.name === 'back') {
        return 'back';
      }
      if (command.name === 'quit' || command.name === 'exit') {
        return this.confirmQuit();
      }
      const parsed = parseAbilityScoreCommand(input);
      if (parsed.kind === 'error') {
        this.write(parsed.message);
        continue;
      }
      if (parsed.kind === 'reset') {
        this.draft = this.deps.engine.setAbilityScores(this.draft, {});
        this.dirty = true;
        continue;
      }
      if (parsed.kind === 'set') {
        this.draft = this.deps.engine.setAbilityScore(
          this.draft,
          parsed.ability,
          parsed.value,
        );
        this.dirty = true;
        continue;
      }
      // done
      const errors = this.draft.diagnostics.filter(
        (d) =>
          (d.field === 'abilityScores' ||
            d.field.startsWith('abilityScores.')) &&
          d.severity === 'error',
      );
      const allSet = ABILITY_SCORE_NAMES.every(
        (name) => this.draft.selections.baseAbilityScores?.[name] !== undefined,
      );
      if (!allSet) {
        this.write('Set all six ability scores before continuing.');
        continue;
      }
      if (errors.length > 0) {
        for (const error of errors) {
          this.write(`  ✗ ${error.message}`);
        }
        continue;
      }
      return 'advance';
    }
  }

  private async chooseAbilityMethod(): Promise<Nav> {
    this.write(
      'Choose a method: point_buy, standard_array, manual, or rolled.',
    );
    for (;;) {
      const input = await this.deps.io.prompt('Method> ');
      if (input === undefined) {
        return 'eof';
      }
      const command = parseCommand(input);
      if (command.name === 'back') {
        return 'back';
      }
      if (command.name === 'quit' || command.name === 'exit') {
        return this.confirmQuit();
      }
      const method = parseAbilityMethod(input.trim());
      if (method === undefined) {
        this.write(
          'Unknown method. Choose point_buy, standard_array, manual, or rolled.',
        );
        continue;
      }
      this.draft = this.deps.engine.setAbilityScoreMethod(this.draft, method);
      this.dirty = true;
      this.write(`Method set to ${method}.`);
      return 'stay';
    }
  }

  private abilitySummary(): string {
    const method = this.draft.selections.abilityScoreMethod;
    const scores = this.draft.selections.baseAbilityScores ?? {};
    const cells = ABILITY_SCORE_NAMES.map((name) => {
      const value = scores[name];
      return `${name.slice(0, 3).toUpperCase()} ${value ?? '--'}`;
    }).join('  ');
    if (method === 'point_buy') {
      const summary = summarizePointBuy(scores);
      return `${cells}   [points remaining: ${summary.remaining}]`;
    }
    if (method === 'standard_array') {
      const summary = summarizeStandardArray(scores);
      return `${cells}   [unplaced: ${summary.remainingValues.join(', ') || 'none'}]`;
    }
    return cells;
  }

  // --- Rendering -------------------------------------------------------------

  private choiceConfig(stepId: string): ChoiceConfig {
    const { engine, resolver } = this.deps;
    if (stepId === 'class') {
      return {
        noun: 'class',
        set: (draft, value) => engine.setClass(draft, value),
        resolveName: (value) => {
          const r = resolver.resolveClass(value);
          return r.ok ? r.record.name : undefined;
        },
        options: () =>
          resolver
            .listClasses()
            .map((c) => ({ name: c.name, detail: `d${c.hitDie}` })),
      };
    }
    if (stepId === 'ancestry') {
      return {
        noun: 'ancestry',
        set: (draft, value) => engine.setAncestry(draft, value),
        resolveName: (value) => {
          const r = resolver.resolveAncestry(value);
          return r.ok ? r.record.name : undefined;
        },
        options: () => resolver.listAncestries().map((a) => ({ name: a.name })),
      };
    }
    return {
      noun: 'background',
      set: (draft, value) => engine.setBackground(draft, value),
      resolveName: (value) => {
        const r = resolver.resolveBackground(value);
        return r.ok ? r.record.name : undefined;
      },
      options: () => resolver.listBackgrounds().map((b) => ({ name: b.name })),
    };
  }

  private stepIntro(stepId: string): string {
    switch (stepId) {
      case 'identity':
        return 'Enter your character name.';
      case 'class':
        return 'Choose a class by name or unambiguous prefix.';
      case 'ancestry':
        return 'Choose an ancestry by name or unambiguous prefix.';
      case 'background':
        return 'Choose a background, or press Enter to skip.';
      case 'class-choices':
        return 'Review the level-1 choices your class grants.';
      case 'spells-equipment':
        return 'Enter level-1 spells (comma-separated), or press Enter to skip.';
      case 'review':
        return 'Review your draft. Press Enter to finish, or `set <field> <value>` to correct.';
      default:
        return '';
    }
  }

  private printHelp(stepId: string): void {
    this.write(
      'Commands: ? · list · search <term> · back · review · set <field> <value> · save · quit',
    );
    const intro = this.stepIntro(stepId);
    if (intro.length > 0) {
      this.write(intro);
    }
    if (stepId === 'class-choices') {
      this.printRequiredChoices();
    }
  }

  private printOptions(stepId: string, term: string | undefined): void {
    if (
      stepId !== 'class' &&
      stepId !== 'ancestry' &&
      stepId !== 'background' &&
      stepId !== 'spells-equipment'
    ) {
      this.write('Nothing to list for this step.');
      return;
    }
    const options =
      stepId === 'spells-equipment'
        ? this.spellOptions()
        : this.choiceConfig(stepId).options(this.draft);
    const filtered =
      term && term.length > 0
        ? options.filter((o) =>
            o.name.toLowerCase().includes(term.toLowerCase()),
          )
        : options;
    if (filtered.length === 0) {
      this.write(term ? `No matches for "${term}".` : 'No options available.');
      return;
    }
    for (const option of filtered.slice(0, 50)) {
      this.write(
        `  - ${option.name}${option.detail ? ` (${option.detail})` : ''}`,
      );
    }
    if (filtered.length > 50) {
      this.write(`  …and ${filtered.length - 50} more (use \`search\`).`);
    }
  }

  private spellOptions(): readonly ChoiceOption[] {
    const className = this.resolvedClassName();
    if (className === undefined) {
      this.write('Choose a class first to see its spell list.');
      return [];
    }
    return this.deps.resolver
      .listSpells()
      .filter((s) => s.level <= 1 && s.classes.includes(className))
      .map((s) => ({
        name: s.name,
        detail: s.level === 0 ? 'cantrip' : `level ${s.level}`,
      }));
  }

  private resolvedClassName(): string | undefined {
    const selected = this.draft.selections.className;
    if (selected === undefined) {
      return undefined;
    }
    const result = this.deps.resolver.resolveClass(selected);
    return result.ok ? result.record.name : undefined;
  }

  private printRequiredChoices(): void {
    const className = this.draft.selections.className;
    if (className === undefined) {
      this.write('Choose a class first.');
      return;
    }
    const classResult = this.deps.resolver.resolveClass(className);
    if (!classResult.ok) {
      return;
    }
    const ancestry = this.draft.selections.ancestry
      ? optionalRecord(
          this.deps.resolver.resolveAncestry(this.draft.selections.ancestry),
        )
      : undefined;
    const background = this.draft.selections.background
      ? optionalRecord(
          this.deps.resolver.resolveBackground(
            this.draft.selections.background,
          ),
        )
      : undefined;
    const choices = enumerateLevel1RequiredChoices({
      classData: classResult.record,
      ancestry,
      background,
      abilityModifiers: this.draft.derived.abilityModifiers,
    });
    if (choices.length === 0) {
      this.write('No additional level-1 choices.');
      return;
    }
    for (const choice of choices) {
      const tag = choice.status === 'structured' ? '' : ' (collected later)';
      this.write(`  - ${choice.label}${tag}`);
    }
  }

  private printReview(): void {
    const { engine } = this.deps;
    const d = this.draft;
    this.write('');
    this.write('--- Draft review ---');
    this.write(`Name:      ${d.identity.name ?? '(unset)'}`);
    if (d.identity.concept) {
      this.write(`Concept:   ${d.identity.concept}`);
    }
    this.write(`Class:     ${d.selections.className ?? '(unset)'}`);
    this.write(`Ancestry:  ${d.selections.ancestry ?? '(unset)'}`);
    this.write(
      `Background:${d.selections.background ? ` ${d.selections.background}` : ' (none)'}`,
    );
    this.write(`Scores:    ${this.abilityLine()}`);
    if (d.derived.maxHitPoints !== undefined) {
      this.write(`Max HP:    ${d.derived.maxHitPoints}`);
    }
    if (d.derived.spellSaveDc !== undefined) {
      this.write(
        `Spell DC:  ${d.derived.spellSaveDc} (attack +${d.derived.spellAttackModifier})`,
      );
    }
    if (d.selections.spells && d.selections.spells.length > 0) {
      this.write(`Spells:    ${d.selections.spells.join(', ')}`);
    }
    const errors = d.diagnostics.filter((x) => x.severity === 'error');
    if (errors.length > 0) {
      this.write('Errors:');
      for (const error of errors) {
        this.write(`  ✗ ${describe(error)}`);
      }
    }
    const missing = engine.missingRequiredChoices(d);
    if (missing.length > 0) {
      this.write('Still needed:');
      for (const choice of missing) {
        this.write(`  • ${choice.label}`);
      }
    }
    this.write(
      engine.isFinalizable(d)
        ? 'Draft is complete and ready to finalize (eshyra-b69j.14).'
        : 'Draft is not finalizable yet — resolve the items above.',
    );
  }

  private abilityLine(): string {
    const scores = this.draft.derived.finalAbilityScores;
    const cells = ABILITY_SCORE_NAMES.map((name) => {
      const value = scores[name];
      return `${name.slice(0, 3).toUpperCase()} ${value ?? '--'}`;
    });
    return cells.join('  ');
  }

  private printSuggestions(suggestions: readonly string[] | undefined): void {
    if (suggestions && suggestions.length > 0) {
      this.write(`Did you mean: ${suggestions.join(', ')}?`);
    }
  }

  private write(line: string): void {
    this.deps.io.write(line);
  }
}

// --- Pure helpers ------------------------------------------------------------

interface ParsedCommand {
  readonly name: string;
  readonly rest: string;
}

function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();
  const space = trimmed.indexOf(' ');
  if (space === -1) {
    return { name: trimmed.toLowerCase(), rest: '' };
  }
  return {
    name: trimmed.slice(0, space).toLowerCase(),
    rest: trimmed.slice(space + 1).trim(),
  };
}

type ChoiceResult =
  | {
      readonly ok: true;
      readonly draft: CharacterDraft;
      readonly message?: string;
    }
  | {
      readonly ok: false;
      readonly message: string;
      readonly suggestions?: readonly string[];
    };

/**
 * Resolve a choice answer to a canonical option and apply it. Tries an exact
 * resolver lookup (display name / canonical key / case-insensitive) first, then
 * a single unambiguous name prefix; otherwise returns substring suggestions.
 */
function applyChoice(
  config: ChoiceConfig,
  draft: CharacterDraft,
  value: string,
): ChoiceResult {
  const direct = config.resolveName(value);
  if (direct !== undefined) {
    return { ok: true, draft: config.set(draft, direct) };
  }
  const options = config.options(draft);
  const lowered = value.toLowerCase();
  const prefixed = options.filter((o) =>
    o.name.toLowerCase().startsWith(lowered),
  );
  if (prefixed.length === 1) {
    const match = (prefixed[0] as ChoiceOption).name;
    return {
      ok: true,
      draft: config.set(draft, match),
      message: `Matched "${match}".`,
    };
  }
  if (prefixed.length > 1) {
    return {
      ok: false,
      message: `"${value}" is an ambiguous ${config.noun}.`,
      suggestions: prefixed.map((o) => o.name).slice(0, MAX_SUGGESTIONS),
    };
  }
  const substring = options
    .filter((o) => o.name.toLowerCase().includes(lowered))
    .map((o) => o.name);
  return {
    ok: false,
    message: `No ${config.noun} matches "${value}".`,
    suggestions: substring.slice(0, MAX_SUGGESTIONS),
  };
}

function parseAbilityMethod(input: string): AbilityScoreMethod | undefined {
  const normalized = input.toLowerCase().replace(/[\s-]+/g, '_');
  switch (normalized) {
    case 'point_buy':
    case 'pointbuy':
    case 'point':
      return 'point_buy';
    case 'standard_array':
    case 'standard':
    case 'array':
      return 'standard_array';
    case 'manual':
      return 'manual';
    case 'rolled':
    case 'roll':
      return 'rolled';
    default:
      return undefined;
  }
}

const ABILITY_TOKENS: ReadonlyMap<string, AbilityScoreName> = new Map(
  ABILITY_SCORE_NAMES.flatMap((name) => [
    [name, name] as const,
    [name.slice(0, 3), name] as const,
  ]),
);

function abilityFromToken(token: string): AbilityScoreName | undefined {
  return ABILITY_TOKENS.get(token.toLowerCase());
}

function describe(diagnostic: CharacterCreationDiagnostic): string {
  return `${diagnostic.field}: ${diagnostic.message}`;
}

function optionalRecord<T>(result: {
  readonly ok: boolean;
  readonly record?: T;
}): T | undefined {
  return result.ok ? (result.record as T) : undefined;
}
