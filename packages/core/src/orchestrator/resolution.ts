import type { DiceRoll } from './dice.js';
import { DiceError, parseDice, rollParsedDice } from './dice.js';
import type { Rng } from './rng.js';

/**
 * F9 deterministic d20/damage resolution primitives (eshyra-2n1t.11).
 *
 * The Hybrid Contract reserves all math for tools; this module is where the
 * previously model-computed arithmetic becomes code-owned: modifier
 * composition with identity/provenance, advantage/disadvantage cancellation,
 * proficiency-multiplier apply-once, vs-DC/AC resolution with nat-1/20
 * overrides (attacks only), opposed contests (tie = status quo), and damage
 * composition (crit dice-doubling, never-negative, roll-once-multi-target,
 * immunity/resistance/vulnerability after modifiers).
 *
 * Everything here is pure over an injected RNG and consumes the canonical F1
 * `DiceRoll` representation from `dice.ts` directly — rolled facts (every
 * die), code-owned selection, and natural-vs-modified totals are preserved
 * end to end for the ledger, turn trace, and deterministic replay.
 * Input *selection* (which modifiers, which resistances, what DC) stays a DM
 * ruling; see docs/dice-and-resolution.md.
 */

export class ResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResolutionError';
  }
}

/** A model-declared modifier: engine-owned arithmetic, declared provenance. */
export interface DeclaredModifier {
  readonly label: string;
  readonly value: number;
  readonly source?: string;
}

const MAX_MODIFIERS = 20;
const MAX_MODIFIER_ABS = 100;
const MAX_LABEL_LEN = 80;

export function validateModifiers(
  raw: unknown,
  where: string,
): DeclaredModifier[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new ResolutionError(`${where}: modifiers must be an array`);
  }
  if (raw.length > MAX_MODIFIERS) {
    throw new ResolutionError(
      `${where}: at most ${MAX_MODIFIERS} modifiers (got ${raw.length})`,
    );
  }
  return raw.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new ResolutionError(`${where}: modifiers[${i}] must be an object`);
    }
    const record = entry as Record<string, unknown>;
    const { label, value, source } = record;
    if (
      typeof label !== 'string' ||
      label.length === 0 ||
      label.length > MAX_LABEL_LEN
    ) {
      throw new ResolutionError(
        `${where}: modifiers[${i}].label must be a non-empty string (max ${MAX_LABEL_LEN} chars)`,
      );
    }
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      Math.abs(value) > MAX_MODIFIER_ABS
    ) {
      throw new ResolutionError(
        `${where}: modifiers[${i}].value must be an integer in [-${MAX_MODIFIER_ABS}, ${MAX_MODIFIER_ABS}]`,
      );
    }
    if (
      source !== undefined &&
      (typeof source !== 'string' ||
        source.length === 0 ||
        source.length > MAX_LABEL_LEN)
    ) {
      throw new ResolutionError(
        `${where}: modifiers[${i}].source must be a non-empty string when present`,
      );
    }
    return {
      label,
      value,
      ...(source === undefined ? {} : { source }),
    };
  });
}

export function sumModifiers(modifiers: readonly DeclaredModifier[]): number {
  return modifiers.reduce((sum, m) => sum + m.value, 0);
}

/** Proficiency-bonus multipliers (SRD proficiency-bonus: apply once). */
export const PROFICIENCY_MULTIPLIERS = [
  'none',
  'half',
  'normal',
  'double',
] as const;
export type ProficiencyMultiplier = (typeof PROFICIENCY_MULTIPLIERS)[number];

export interface ProficiencyInput {
  readonly bonus: number;
  readonly multiplier: ProficiencyMultiplier;
}

export interface ProficiencyApplied extends ProficiencyInput {
  /** floor(bonus × {0, ½, 1, 2}) — halving rounds down (SRD division rule). */
  readonly applied: number;
}

const MAX_PROFICIENCY_BONUS = 20;

export function validateProficiency(
  raw: unknown,
  where: string,
): ProficiencyApplied | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ResolutionError(`${where}: proficiency must be an object`);
  }
  const record = raw as Record<string, unknown>;
  const { bonus, multiplier } = record;
  if (
    typeof bonus !== 'number' ||
    !Number.isInteger(bonus) ||
    bonus < 0 ||
    bonus > MAX_PROFICIENCY_BONUS
  ) {
    throw new ResolutionError(
      `${where}: proficiency.bonus must be an integer in [0, ${MAX_PROFICIENCY_BONUS}]`,
    );
  }
  if (
    typeof multiplier !== 'string' ||
    !PROFICIENCY_MULTIPLIERS.includes(multiplier as ProficiencyMultiplier)
  ) {
    throw new ResolutionError(
      `${where}: proficiency.multiplier must be one of ${PROFICIENCY_MULTIPLIERS.join(', ')}`,
    );
  }
  const m = multiplier as ProficiencyMultiplier;
  const applied =
    m === 'none'
      ? 0
      : m === 'half'
        ? Math.floor(bonus / 2)
        : m === 'double'
          ? bonus * 2
          : bonus;
  return { bonus, multiplier: m, applied };
}

/** Effective advantage state after pairwise cancellation (never stacks). */
export type AdvantageState = 'advantage' | 'disadvantage' | 'none';

export function effectiveAdvantageState(
  advantage: boolean,
  disadvantage: boolean,
): AdvantageState {
  if (advantage === disadvantage) {
    return 'none';
  }
  return advantage ? 'advantage' : 'disadvantage';
}

export const D20_KINDS = ['ability_check', 'saving_throw', 'attack'] as const;
export type D20Kind = (typeof D20_KINDS)[number];

export interface D20ResolutionInput {
  readonly kind: D20Kind;
  readonly advantage?: boolean;
  readonly disadvantage?: boolean;
  readonly modifiers?: readonly DeclaredModifier[];
  readonly proficiency?: ProficiencyApplied;
  /** DC (checks/saves) or AC (attacks). Omitted → composed total only. */
  readonly vs?: number;
}

export type D20Outcome = 'success' | 'failure' | 'hit' | 'miss';

export interface D20Resolution {
  readonly kind: D20Kind;
  /** Flags as declared by the model, before cancellation. */
  readonly declaredAdvantage: boolean;
  readonly declaredDisadvantage: boolean;
  /** Engine-computed state actually rolled (both flags cancel to 'none'). */
  readonly advantageState: AdvantageState;
  /** Expression the engine rolled: 1d20, 2d20kh1, or 2d20kl1. */
  readonly dice: string;
  /** Every d20 generated (both dice under advantage/disadvantage). */
  readonly rolls: readonly number[];
  /** The kept die — the natural result, never mutated by modifiers. */
  readonly natural: number;
  readonly modifiers: readonly DeclaredModifier[];
  readonly proficiency?: ProficiencyApplied;
  /** Σ modifiers + proficiency.applied. */
  readonly modifierTotal: number;
  /** natural + modifierTotal. */
  readonly total: number;
  readonly vs?: number;
  readonly outcome?: D20Outcome;
  /** Attacks only: natural 20 (auto hit + critical). */
  readonly critical?: boolean;
  /** Attacks only: natural 1 (auto miss regardless of modifiers). */
  readonly fumble?: boolean;
}

export const MAX_VS = 99;

export function validateVs(raw: unknown, where: string): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (
    typeof raw !== 'number' ||
    !Number.isInteger(raw) ||
    raw < 1 ||
    raw > MAX_VS
  ) {
    throw new ResolutionError(
      `${where}: vs must be an integer in [1, ${MAX_VS}]`,
    );
  }
  return raw;
}

export function resolveD20(input: D20ResolutionInput, rng: Rng): D20Resolution {
  const declaredAdvantage = input.advantage === true;
  const declaredDisadvantage = input.disadvantage === true;
  const advantageState = effectiveAdvantageState(
    declaredAdvantage,
    declaredDisadvantage,
  );
  const dice =
    advantageState === 'advantage'
      ? '2d20kh1'
      : advantageState === 'disadvantage'
        ? '2d20kl1'
        : '1d20';
  const roll = rollParsedDice(dice, parseDice(dice), rng);

  const modifiers = input.modifiers ?? [];
  const modifierTotal =
    sumModifiers(modifiers) + (input.proficiency?.applied ?? 0);
  const total = roll.natural + modifierTotal;

  let outcome: D20Outcome | undefined;
  let critical: boolean | undefined;
  let fumble: boolean | undefined;
  if (input.kind === 'attack') {
    critical = roll.natural === 20;
    fumble = roll.natural === 1;
    if (input.vs !== undefined) {
      // SRD rolling-1-or-20: nat 20 hits and nat 1 misses regardless of AC.
      outcome = critical
        ? 'hit'
        : fumble
          ? 'miss'
          : total >= input.vs
            ? 'hit'
            : 'miss';
    }
  } else if (input.vs !== undefined) {
    // Checks and saves have no natural auto success/failure in the SRD.
    outcome = total >= input.vs ? 'success' : 'failure';
  }

  return {
    kind: input.kind,
    declaredAdvantage,
    declaredDisadvantage,
    advantageState,
    dice,
    rolls: roll.rolls,
    natural: roll.natural,
    modifiers,
    ...(input.proficiency === undefined
      ? {}
      : { proficiency: input.proficiency }),
    modifierTotal,
    total,
    ...(input.vs === undefined ? {} : { vs: input.vs }),
    ...(outcome === undefined ? {} : { outcome }),
    ...(critical === undefined ? {} : { critical }),
    ...(fumble === undefined ? {} : { fumble }),
  };
}

export interface ContestSideInput {
  readonly label: string;
  readonly advantage?: boolean;
  readonly disadvantage?: boolean;
  readonly modifiers?: readonly DeclaredModifier[];
  readonly proficiency?: ProficiencyApplied;
}

export interface ContestResolution {
  /** Side A rolls first, then side B — fixed order for exact replay. */
  readonly a: D20Resolution & { readonly label: string };
  readonly b: D20Resolution & { readonly label: string };
  /** Higher total wins; tie = the situation stays as it was (SRD contests). */
  readonly outcome: 'a' | 'b' | 'tie';
  readonly winner?: string;
}

export function resolveContest(
  a: ContestSideInput,
  b: ContestSideInput,
  rng: Rng,
): ContestResolution {
  const sideInput = (side: ContestSideInput): D20ResolutionInput => ({
    kind: 'ability_check',
    ...(side.advantage === undefined ? {} : { advantage: side.advantage }),
    ...(side.disadvantage === undefined
      ? {}
      : { disadvantage: side.disadvantage }),
    ...(side.modifiers === undefined ? {} : { modifiers: side.modifiers }),
    ...(side.proficiency === undefined
      ? {}
      : { proficiency: side.proficiency }),
  });
  const resolvedA = { ...resolveD20(sideInput(a), rng), label: a.label };
  const resolvedB = { ...resolveD20(sideInput(b), rng), label: b.label };
  const outcome =
    resolvedA.total > resolvedB.total
      ? 'a'
      : resolvedB.total > resolvedA.total
        ? 'b'
        : 'tie';
  return {
    a: resolvedA,
    b: resolvedB,
    outcome,
    ...(outcome === 'tie'
      ? {}
      : { winner: outcome === 'a' ? resolvedA.label : resolvedB.label }),
  };
}

/** SRD damage types plus 'untyped' for typeless effects. */
export const DAMAGE_TYPES = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
  'untyped',
] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

export interface DamagePacketInput {
  /** Plain `NdM[±K]` — keep/drop is rejected (no SRD damage roll keeps/drops). */
  readonly dice: string;
  readonly type: DamageType;
  /** e.g. "longsword", "sneak attack". */
  readonly label?: string;
  readonly modifiers?: readonly DeclaredModifier[];
}

export interface DamageTargetInput {
  readonly label: string;
  readonly resistances?: readonly DamageType[];
  readonly vulnerabilities?: readonly DamageType[];
  readonly immunities?: readonly DamageType[];
}

export interface DamagePacketResult {
  readonly label?: string;
  readonly type: DamageType;
  /** Expression actually rolled — dice count doubled under critical. */
  readonly dice: string;
  /** As declared by the model, before any crit transform. */
  readonly declaredDice: string;
  readonly rolls: readonly number[];
  readonly natural: number;
  readonly modifiers: readonly DeclaredModifier[];
  /** max(0, natural + Σ modifiers) — damage is never negative. */
  readonly subtotal: number;
}

export interface DamageTargetResult {
  readonly label: string;
  readonly resistances: readonly DamageType[];
  readonly vulnerabilities: readonly DamageType[];
  readonly immunities: readonly DamageType[];
  /** Per-packet post-immunity/resistance/vulnerability amounts, in order. */
  readonly packetDamage: readonly number[];
  readonly total: number;
}

export interface DamageResolution {
  readonly critical: boolean;
  readonly packets: readonly DamagePacketResult[];
  /** Σ packet subtotals — the damage before per-target adjustments. */
  readonly total: number;
  readonly targets?: readonly DamageTargetResult[];
}

const MAX_PACKETS = 10;
const MAX_TARGETS = 20;

export interface DamageInput {
  readonly packets: readonly DamagePacketInput[];
  readonly critical?: boolean;
  readonly targets?: readonly DamageTargetInput[];
}

function validateDamageTypeList(
  raw: unknown,
  where: string,
): readonly DamageType[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new ResolutionError(`${where} must be an array of damage types`);
  }
  const seen = new Set<DamageType>();
  for (const entry of raw) {
    if (
      typeof entry !== 'string' ||
      !DAMAGE_TYPES.includes(entry as DamageType)
    ) {
      throw new ResolutionError(
        `${where}: unknown damage type ${JSON.stringify(entry)}; expected one of ${DAMAGE_TYPES.join(', ')}`,
      );
    }
    if (seen.has(entry as DamageType)) {
      // Multiple instances count once (SRD); a duplicate declaration is a
      // malformed call, not a stacking request.
      throw new ResolutionError(`${where}: duplicate damage type '${entry}'`);
    }
    seen.add(entry as DamageType);
  }
  return [...seen];
}

export function validateDamageTarget(
  raw: unknown,
  where: string,
): DamageTargetInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ResolutionError(`${where} must be an object`);
  }
  const record = raw as Record<string, unknown>;
  if (
    typeof record.label !== 'string' ||
    record.label.length === 0 ||
    record.label.length > MAX_LABEL_LEN
  ) {
    throw new ResolutionError(`${where}.label must be a non-empty string`);
  }
  return {
    label: record.label,
    resistances: validateDamageTypeList(
      record.resistances,
      `${where}.resistances`,
    ),
    vulnerabilities: validateDamageTypeList(
      record.vulnerabilities,
      `${where}.vulnerabilities`,
    ),
    immunities: validateDamageTypeList(
      record.immunities,
      `${where}.immunities`,
    ),
  };
}

export function resolveDamage(input: DamageInput, rng: Rng): DamageResolution {
  if (input.packets.length === 0 || input.packets.length > MAX_PACKETS) {
    throw new ResolutionError(
      `damage requires 1-${MAX_PACKETS} packets (got ${input.packets.length})`,
    );
  }
  const targets = input.targets ?? [];
  if (targets.length > MAX_TARGETS) {
    throw new ResolutionError(
      `damage supports at most ${MAX_TARGETS} targets (got ${targets.length})`,
    );
  }
  const critical = input.critical === true;

  const packets = input.packets.map((packet): DamagePacketResult => {
    let parsed: ReturnType<typeof parseDice>;
    try {
      parsed = parseDice(packet.dice);
    } catch (e) {
      if (e instanceof DiceError) {
        throw new ResolutionError(`damage packet '${packet.dice}': ${e.message}`);
      }
      throw e;
    }
    if (parsed.keep !== undefined) {
      throw new ResolutionError(
        `damage packet '${packet.dice}': keep/drop notation is not valid for damage dice`,
      );
    }
    // SRD critical-hits: roll all of the attack's damage dice twice, then add
    // modifiers as normal. The engine doubles the dice count — the model never
    // rewrites the expression.
    const count = critical ? parsed.count * 2 : parsed.count;
    const modifierPart =
      parsed.modifier === 0
        ? ''
        : parsed.modifier > 0
          ? `+${parsed.modifier}`
          : `${parsed.modifier}`;
    const rolledNotation = `${count}d${parsed.faces}${modifierPart}`;
    const roll: DiceRoll = rollParsedDice(
      rolledNotation,
      { ...parsed, count },
      rng,
    );
    const modifiers = packet.modifiers ?? [];
    // Never negative (SRD damage-rolls), clamped per packet so one penalized
    // packet cannot eat another packet's damage.
    const subtotal = Math.max(0, roll.natural + sumModifiers(modifiers));
    return {
      ...(packet.label === undefined ? {} : { label: packet.label }),
      type: packet.type,
      dice: rolledNotation,
      declaredDice: packet.dice,
      rolls: roll.rolls,
      natural: roll.natural,
      modifiers,
      subtotal,
    };
  });

  const total = packets.reduce((sum, p) => sum + p.subtotal, 0);

  const targetResults = targets.map((target): DamageTargetResult => {
    const resistances = new Set(target.resistances ?? []);
    const vulnerabilities = new Set(target.vulnerabilities ?? []);
    const immunities = new Set(target.immunities ?? []);
    const packetDamage = packets.map((packet) => {
      if (immunities.has(packet.type)) {
        return 0;
      }
      let amount = packet.subtotal;
      // SRD: resistance and then vulnerability, after all other modifiers;
      // halving rounds down.
      if (resistances.has(packet.type)) {
        amount = Math.floor(amount / 2);
      }
      if (vulnerabilities.has(packet.type)) {
        amount *= 2;
      }
      return amount;
    });
    return {
      label: target.label,
      resistances: [...resistances],
      vulnerabilities: [...vulnerabilities],
      immunities: [...immunities],
      packetDamage,
      total: packetDamage.reduce((sum, v) => sum + v, 0),
    };
  });

  return {
    critical,
    packets,
    total,
    ...(targets.length === 0 ? {} : { targets: targetResults }),
  };
}
