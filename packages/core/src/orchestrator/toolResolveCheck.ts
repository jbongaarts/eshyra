import { ABILITY_SCORE_NAMES } from '../character/abilities.js';
import { createSqliteCharacterSheetStore } from '../character/characterSheetStore.js';
import type { AbilityScoreName } from '../character/creation.js';
import type { CharacterSheet } from '../character/finalizeCharacter.js';
import {
  deriveSkillBonuses,
  halfProficiencyFeature,
} from '../character/skillBonuses.js';
import { SRD_5_1_SKILLS } from '../character/srdCreationChoices.js';
import {
  CharacterResolutionError,
  resolveCharacterRef,
} from '../state/activeCharacter.js';
import type {
  D20Kind,
  DeclaredModifier,
  ProficiencyApplied,
} from './resolution.js';
import { D20_KINDS, ResolutionError, resolveD20 } from './resolution.js';
import type { Tool, ToolContext, ToolResult } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';
import {
  ADVANTAGE_SCHEMA,
  DISADVANTAGE_SCHEMA,
  MODIFIERS_SCHEMA,
  PROFICIENCY_SCHEMA,
  parseCheckSide,
  parseVisibility,
  parseVs,
  VISIBILITY_SCHEMA,
} from './toolResolutionShared.js';
import type { RollCategory } from './toolRoll.js';

/** Ledger/trace category per d20 kind. */
export const CHECK_KIND_CATEGORIES: Readonly<Record<D20Kind, RollCategory>> = {
  ability_check: 'ability_check',
  saving_throw: 'saving_throw',
  attack: 'attack',
};

const ABILITY_ABBREVIATIONS: Readonly<Record<AbilityScoreName, string>> = {
  strength: 'str',
  dexterity: 'dex',
  constitution: 'con',
  intelligence: 'int',
  wisdom: 'wis',
  charisma: 'cha',
};

const normName = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** True when text names the ability (full name or 3-letter abbreviation). */
function namesAbility(text: string, ability: AbilityScoreName): boolean {
  const tokens = text.toLowerCase().split(/[^a-z]+/);
  return (
    tokens.includes(ability) || tokens.includes(ABILITY_ABBREVIATIONS[ability])
  );
}

interface SheetDerivation {
  readonly characterId: string;
  readonly ability: AbilityScoreName;
  readonly skill?: string;
  readonly modifiers: DeclaredModifier[];
  readonly proficiency?: ProficiencyApplied;
}

/**
 * Derive the governing ability modifier and proficiency term from the actor's
 * stored sheet (eshyra-r8en.1). Returns an error result when the request cannot
 * be honoured; the caller must then declare modifiers itself.
 */
function deriveFromSheet(
  kind: D20Kind,
  a: Record<string, unknown>,
  ctx: ToolContext,
): SheetDerivation | ToolResult {
  if (kind === 'attack') {
    return err(
      'invalid_args',
      'resolve_check skill/ability derivation is not supported for attack rolls; declare modifiers instead',
    );
  }
  if (a.skill !== undefined && kind !== 'ability_check') {
    return err(
      'invalid_args',
      'resolve_check skill is only valid for ability_check',
    );
  }
  if (a.proficiency !== undefined) {
    return err(
      'invalid_args',
      'resolve_check: proficiency cannot be combined with skill/ability; the engine derives the proficiency term from the character sheet (omit proficiency)',
    );
  }
  let skill: string | undefined;
  if (a.skill !== undefined) {
    skill =
      typeof a.skill === 'string'
        ? SRD_5_1_SKILLS.find(
            (s) => normName(s) === normName(a.skill as string),
          )
        : undefined;
    if (skill === undefined) {
      return err(
        'invalid_args',
        `resolve_check skill must be one of: ${SRD_5_1_SKILLS.join(', ')}`,
      );
    }
  }
  const abilityInput = a.ability;
  let explicitAbility: AbilityScoreName | undefined;
  if (abilityInput !== undefined) {
    const n =
      typeof abilityInput === 'string' ? abilityInput.toLowerCase() : '';
    explicitAbility = ABILITY_SCORE_NAMES.find(
      (name) => name === n || ABILITY_ABBREVIATIONS[name] === n,
    );
    if (explicitAbility === undefined) {
      return err(
        'invalid_args',
        `resolve_check ability must be one of: ${ABILITY_SCORE_NAMES.join(', ')}`,
      );
    }
  }
  if (kind === 'saving_throw' && explicitAbility === undefined) {
    return err(
      'invalid_args',
      'resolve_check saving_throw with skill/ability requires ability',
    );
  }

  const refusal = (why: string) =>
    err(
      'invalid_args',
      `resolve_check cannot derive modifiers: ${why}; declare modifiers (and proficiency) yourself instead of skill/ability`,
    );
  let characterId: string | undefined;
  if (typeof a.actor === 'string') {
    try {
      characterId = resolveCharacterRef(ctx.db, a.actor);
    } catch (e) {
      if (e instanceof CharacterResolutionError) {
        return refusal(`actor '${a.actor}' is not a stored character`);
      }
      throw e;
    }
  } else {
    characterId = ctx.actingCharacterId;
  }
  const sheet: CharacterSheet | undefined =
    characterId === undefined
      ? undefined
      : createSqliteCharacterSheetStore(ctx.db).load(characterId);
  if (characterId === undefined || sheet === undefined) {
    return refusal('the actor has no stored character sheet');
  }

  const source = `sheet:${characterId}`;
  const modifiers: DeclaredModifier[] = [];
  let proficiency: ProficiencyApplied | undefined;
  let ability: AbilityScoreName;
  const pb = sheet.proficiencyBonus;
  const abilityMod = (ab: AbilityScoreName): number =>
    sheet.abilityScores[ab].modifier;
  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

  if (skill !== undefined) {
    const derived = deriveSkillBonuses(sheet).skills.find(
      (s) => s.skill === skill,
    );
    if (derived === undefined) {
      return refusal(`unknown skill ${skill}`);
    }
    if (explicitAbility !== undefined && explicitAbility !== derived.ability) {
      return err(
        'invalid_args',
        `resolve_check: ${skill} is governed by ${derived.ability}; omit ability or pass ${derived.ability}`,
      );
    }
    ability = derived.ability;
    modifiers.push({
      label: `${cap(ability)} modifier`,
      value: abilityMod(ability),
      source,
    });
    if (derived.proficiency !== 'none') {
      proficiency = {
        bonus: pb,
        multiplier: derived.proficiency === 'expertise' ? 'double' : 'normal',
        applied: pb * (derived.proficiency === 'expertise' ? 2 : 1),
      };
    }
    if (derived.featureBonus !== undefined) {
      const feature = halfProficiencyFeature(sheet, ability);
      if (feature !== undefined) {
        modifiers.push({ label: feature.name, value: feature.value, source });
      }
    }
  } else {
    ability = explicitAbility as AbilityScoreName;
    modifiers.push({
      label: `${cap(ability)} modifier`,
      value: abilityMod(ability),
      source,
    });
    if (kind === 'saving_throw') {
      if (sheet.savingThrows[ability]?.proficient === true) {
        proficiency = { bonus: pb, multiplier: 'normal', applied: pb };
      }
    } else {
      const feature = halfProficiencyFeature(sheet, ability);
      if (feature !== undefined) {
        modifiers.push({ label: feature.name, value: feature.value, source });
      }
    }
  }

  const caller = parseCallerModifiers(a);
  for (const m of caller) {
    // The source says where a bonus comes from; only a source naming the
    // governing ability duplicates the sheet-derived modifier. A descriptive
    // label ('Dexterity saving throw bonus from half cover') is legitimate.
    if (m.source !== undefined && namesAbility(m.source, ability)) {
      return err(
        'invalid_args',
        `resolve_check: modifier '${m.label}' names ${ability}, which the engine already derives from the sheet; remove it (declare only situational extras)`,
      );
    }
  }
  return {
    characterId,
    ability,
    ...(skill === undefined ? {} : { skill }),
    modifiers: [...modifiers, ...caller],
    ...(proficiency === undefined ? {} : { proficiency }),
  };
}

function parseCallerModifiers(a: Record<string, unknown>): DeclaredModifier[] {
  return parseCheckSide(a, 'resolve_check').modifiers;
}

export const resolveCheckTool: Tool = {
  name: 'resolve_check',
  // Pure deterministic d20 resolution from the seeded RNG; writes no canon.
  mutates: false,
  description:
    'Resolve an ability check, saving throw, or attack roll with code-owned ' +
    'math: the engine rolls the d20 (2d20kh1/kl1 under advantage/' +
    'disadvantage — declaring both cancels; never roll two d20s yourself), ' +
    'sums your declared modifiers, applies proficiency at most once ' +
    '(multiplier handles expertise/half/none), and resolves vs the DC/AC ' +
    'including natural 1/20 auto-miss/hit on attacks. Choosing WHICH ' +
    'modifiers apply and setting the DC stay your rulings; the arithmetic is ' +
    'engine-owned. ' +
    "vs is the target's unmodified DC or AC from 1 to 99, and a total equal to vs succeeds. Modifiers apply only to the roller and are summed by the engine. When the source adds a term to the target's AC or to a DC, pass the base number as vs and declare the term as an equal negative modifier on the roll: for example a cover bonus to AC, or the Charisma modifier in a DC of 12 + a Charisma modifier. Declare a bonus to the roller's own save as a positive modifier. " +
    'For a character with a stored sheet, PREFER skill (ability_check; one of the 18 skills) or ability (ability_check or saving_throw): the engine then derives the governing ability modifier and the proficiency term itself (expertise, Jack of All Trades, Remarkable Athlete, save proficiency) and records them as labelled components. With skill/ability, do NOT pass proficiency or any modifier whose source is that ability (refused as a double count); pass only situational extras (Guidance, cover, ...) as modifiers. Attack rolls always declare modifiers/proficiency (no skill/ability). For monsters/combatants or characters without a sheet, omit skill/ability and declare modifiers/proficiency yourself. ' +
    'args: { kind, reason, actor?, skill?, ability?, advantage?, disadvantage?, modifiers?, proficiency?, vs?, visibility? }.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: D20_KINDS,
        description: 'What kind of d20 test this is.',
      },
      reason: {
        type: 'string',
        description:
          'Short justification, e.g. "Kira Stealth vs guard". Recorded in the turn trace and roll ledger.',
        minLength: 1,
      },
      actor: {
        type: 'string',
        description: 'Who is rolling, e.g. "Kira" or "goblin 2".',
        minLength: 1,
        maxLength: 80,
      },
      skill: {
        type: 'string',
        enum: [...SRD_5_1_SKILLS],
        description:
          "ability_check only: a skill. The engine derives ability modifier + proficiency/expertise/half-proficiency from the actor's character sheet.",
      },
      ability: {
        type: 'string',
        enum: [...ABILITY_SCORE_NAMES],
        description:
          "ability_check (raw ability check) or saving_throw: the governing ability. The engine derives the modifier and proficiency from the actor's character sheet.",
      },
      advantage: ADVANTAGE_SCHEMA,
      disadvantage: DISADVANTAGE_SCHEMA,
      modifiers: MODIFIERS_SCHEMA,
      proficiency: PROFICIENCY_SCHEMA,
      vs: {
        type: 'integer',
        description:
          'The DC (checks/saves) or AC (attacks) to resolve against. Omit when the outcome will be adjudicated later.',
        minimum: 1,
        maximum: 99,
      },
      visibility: VISIBILITY_SCHEMA,
    },
    required: ['kind', 'reason'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.kind !== 'string' ||
      !D20_KINDS.includes(a.kind as D20Kind) ||
      typeof a.reason !== 'string' ||
      a.reason.length === 0
    ) {
      return err(
        'invalid_args',
        `resolve_check requires { kind: ${D20_KINDS.join('|')}, reason: string }`,
      );
    }
    if (
      a.actor !== undefined &&
      (typeof a.actor !== 'string' || a.actor.length === 0)
    ) {
      return err(
        'invalid_args',
        'resolve_check actor must be a non-empty string',
      );
    }
    const kind = a.kind as D20Kind;
    try {
      const side = parseCheckSide(a, 'resolve_check');
      const vs = parseVs(a, 'resolve_check');
      let modifiers = side.modifiers;
      let proficiency = side.proficiency;
      let derivedFrom: Record<string, string> | undefined;
      if (a.skill !== undefined || a.ability !== undefined) {
        const derived = deriveFromSheet(kind, a, ctx);
        if ('ok' in derived) {
          return derived;
        }
        modifiers = derived.modifiers;
        proficiency = derived.proficiency;
        derivedFrom = {
          characterId: derived.characterId,
          ability: derived.ability,
          ...(derived.skill === undefined ? {} : { skill: derived.skill }),
        };
      }
      const resolution = resolveD20(
        {
          kind,
          advantage: side.advantage,
          disadvantage: side.disadvantage,
          modifiers,
          ...(proficiency === undefined ? {} : { proficiency }),
          ...(vs === undefined ? {} : { vs }),
        },
        ctx.rng,
      );
      const visibility = parseVisibility(a.visibility);
      return ok({
        reason: a.reason,
        ...(typeof a.actor === 'string' ? { actor: a.actor } : {}),
        ...(visibility === undefined ? {} : { visibility }),
        category: CHECK_KIND_CATEGORIES[kind],
        ...(derivedFrom === undefined ? {} : { derivedFromSheet: derivedFrom }),
        ...resolution,
      });
    } catch (e) {
      if (e instanceof ResolutionError) {
        return err('invalid_resolution', e.message);
      }
      throw e;
    }
  },
};
