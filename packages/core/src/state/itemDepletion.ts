import { rollDice } from '../orchestrator/dice.js';
import type { Rng } from '../orchestrator/rng.js';

type Obj = Record<string, unknown>;

export type ItemDepletionStatus =
  | 'destroyed'
  | 'inert'
  | 'nonmagical'
  | { readonly itemRef: string };

export interface ItemDepletionRoll {
  readonly purpose: 'depletion' | 'regain';
  readonly notation: string;
  readonly rolls: readonly number[];
  readonly total: number;
}

export interface ItemDepletionResolution {
  readonly economyId: string;
  readonly rolls: readonly ItemDepletionRoll[];
  readonly regain?: number;
  readonly loseProperty: boolean;
  readonly becomes?: ItemDepletionStatus;
}

export class ItemDepletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ItemDepletionError';
  }
}

function object(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ItemDepletionError(`${path} must be an object`);
  }
  return value as Obj;
}

function draw(
  notation: string,
  purpose: ItemDepletionRoll['purpose'],
  rng: Rng | undefined,
): ItemDepletionRoll {
  if (rng === undefined) {
    throw new ItemDepletionError(
      `${purpose} requires seeded RNG for source dice '${notation}'`,
    );
  }
  const result = rollDice(notation, rng);
  return {
    purpose,
    notation,
    rolls: result.rolls,
    total: result.total,
  };
}

/**
 * Resolves the source-declared terminal behavior for one economy that has just
 * reached zero. This is deliberately pure: the inventory boundary decides
 * whether destruction happens immediately or is deferred while an activated
 * state-machine lifecycle (for example a Bead of Force sphere) still exists.
 */
export function resolveItemDepletion(
  economyId: string,
  rawEconomy: unknown,
  rng?: Rng,
): ItemDepletionResolution | undefined {
  const economy = object(rawEconomy, `economy '${economyId}'`);
  if (economy.onDepleted === undefined) return undefined;
  const declaration = object(
    economy.onDepleted,
    `economy '${economyId}'.onDepleted`,
  );
  const rolls: ItemDepletionRoll[] = [];
  const depletionRoll =
    typeof declaration.roll === 'string'
      ? draw(declaration.roll, 'depletion', rng)
      : undefined;
  if (depletionRoll !== undefined) rolls.push(depletionRoll);

  let regain: number | undefined;
  if (
    depletionRoll !== undefined &&
    typeof declaration.regainOn === 'number' &&
    depletionRoll.total === declaration.regainOn
  ) {
    if (typeof declaration.regainAmount === 'number') {
      regain = declaration.regainAmount;
    } else if (typeof declaration.regainAmount === 'string') {
      const regainRoll = draw(declaration.regainAmount, 'regain', rng);
      rolls.push(regainRoll);
      regain = regainRoll.total;
    }
  }

  const loseProperty =
    declaration.loseProperty === true ||
    (depletionRoll !== undefined &&
      typeof declaration.losePropertyOn === 'number' &&
      depletionRoll.total === declaration.losePropertyOn);
  const threshold = declaration.destroyedOn;
  const becomesApplies =
    declaration.becomes !== undefined &&
    (threshold === undefined ||
      (depletionRoll !== undefined && depletionRoll.total === threshold));
  return {
    economyId,
    rolls,
    ...(regain === undefined ? {} : { regain }),
    loseProperty,
    ...(becomesApplies
      ? { becomes: declaration.becomes as ItemDepletionStatus }
      : {}),
  };
}
