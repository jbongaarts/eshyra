import type { Rng } from './rng.js';

/**
 * Dice-notation parsing and resolution (E5, extended by F1 eshyra-2n1t.3).
 * The `roll` tool and the F9 resolution primitives (`resolution.ts`) delegate
 * here so all dice math is code-owned and deterministic under a seeded RNG.
 *
 * Grammar: `[N]d<M>[kh<X>|kl<X>|dh<X>|dl<X>][+K|-K]`. The keep/drop clause is
 * the F1 extension: `2d20kh1` (advantage), `2d20kl1` (disadvantage), `4d6dl1`
 * (ability-score generation). The result keeps rolled facts and code-owned
 * selection separate — every generated die stays visible in `rolls`, the
 * selection lives in `kept`/`dropped` (+ indices), and `natural` is the sum of
 * kept dice before the flat modifier. See docs/dice-and-resolution.md.
 */

export class DiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiceError';
  }
}

export type KeepDropMode = 'kh' | 'kl' | 'dh' | 'dl';

export interface KeepDropClause {
  readonly mode: KeepDropMode;
  readonly count: number;
}

export interface DiceNotation {
  count: number;
  faces: number;
  modifier: number;
  /** Present only when the notation carries a keep/drop clause. */
  keep?: KeepDropClause;
}

export interface DiceRoll {
  notation: string;
  count: number;
  faces: number;
  /** Every die generated, in RNG draw order — including dropped dice. */
  rolls: number[];
  /** Kept dice values, in roll order. Equals `rolls` without a keep clause. */
  kept: number[];
  /** Indices into `rolls` of the kept dice, ascending. */
  keptIndices: number[];
  /** Dropped dice values, in roll order. Empty without a keep clause. */
  dropped: number[];
  /** Indices into `rolls` of the dropped dice, ascending. */
  droppedIndices: number[];
  /** The keep/drop clause applied, when present in the notation. */
  keep?: KeepDropClause;
  /** Sum of kept dice before the flat modifier (the "natural" result). */
  natural: number;
  modifier: number;
  /** Always `natural + modifier`. */
  total: number;
}

const DICE_RE = /^(\d*)d(\d+)(?:(kh|kl|dh|dl)(\d+))?(?:([+-])(\d+))?$/i;
const MAX_COUNT = 100;
const MAX_FACES = 1000;
const MAX_NOTATION_LEN = 32;

export function parseDice(notation: string): DiceNotation {
  if (notation.length > MAX_NOTATION_LEN) {
    throw new DiceError(`invalid dice notation: '${notation}'`);
  }
  const match = DICE_RE.exec(notation.replace(/\s+/g, ''));
  if (match === null) {
    throw new DiceError(`invalid dice notation: '${notation}'`);
  }
  const count = match[1] === '' ? 1 : Number(match[1]);
  const faces = Number(match[2]);
  const modifier =
    match[5] === undefined
      ? 0
      : match[5] === '-'
        ? -Number(match[6])
        : Number(match[6]);

  if (count < 1 || count > MAX_COUNT) {
    throw new DiceError(`dice count out of range (1-${MAX_COUNT}): ${count}`);
  }
  if (faces < 2 || faces > MAX_FACES) {
    throw new DiceError(`dice faces out of range (2-${MAX_FACES}): ${faces}`);
  }

  if (match[3] === undefined) {
    return { count, faces, modifier };
  }

  const mode = match[3].toLowerCase() as KeepDropMode;
  const keepCount = Number(match[4]);
  if (count < 2) {
    throw new DiceError(
      `keep/drop needs at least 2 dice: '${notation}' rolls ${count}`,
    );
  }
  // Fail closed on meaningless clauses: keeping every die is an identity
  // (model confusion, e.g. 2d20kh2 as "advantage") and dropping every die
  // leaves nothing to sum.
  if (keepCount < 1 || keepCount >= count) {
    throw new DiceError(
      `keep/drop count out of range (1-${count - 1} of ${count} dice): '${notation}'`,
    );
  }
  return { count, faces, modifier, keep: { mode, count: keepCount } };
}

/**
 * Indices (ascending) of the dice to keep. `dhX`/`dlX` normalize to keeping
 * the complementary lowest/highest dice. Ties are deterministic: among equal
 * values the earlier-rolled die is selected first, so a fixed seed replays to
 * the identical selection.
 */
function selectKeptIndices(
  rolls: readonly number[],
  keep: KeepDropClause,
): number[] {
  const keepHighest = keep.mode === 'kh' || keep.mode === 'dl';
  const keepCount =
    keep.mode === 'kh' || keep.mode === 'kl'
      ? keep.count
      : rolls.length - keep.count;
  const ranked = rolls
    .map((value, index) => ({ value, index }))
    .sort((a, b) =>
      keepHighest
        ? b.value - a.value || a.index - b.index
        : a.value - b.value || a.index - b.index,
    );
  return ranked
    .slice(0, keepCount)
    .map((entry) => entry.index)
    .sort((a, b) => a - b);
}

export function rollDice(notation: string, rng: Rng): DiceRoll {
  const parsed = parseDice(notation);
  return rollParsedDice(notation, parsed, rng);
}

/**
 * Roll an already-parsed notation. The F9 resolution layer uses this to roll
 * engine-constructed expressions (e.g. crit-doubled damage dice) without
 * round-tripping through strings it just built.
 */
export function rollParsedDice(
  notation: string,
  parsed: DiceNotation,
  rng: Rng,
): DiceRoll {
  const { count, faces, modifier, keep } = parsed;
  const rolls: number[] = [];
  for (let i = 0; i < count; i += 1) {
    rolls.push(rng.nextInt(faces) + 1);
  }

  const keptIndices =
    keep === undefined
      ? rolls.map((_, index) => index)
      : selectKeptIndices(rolls, keep);
  const keptIndexSet = new Set(keptIndices);
  const kept = keptIndices.map((index) => rolls[index]);
  const droppedIndices = rolls
    .map((_, index) => index)
    .filter((index) => !keptIndexSet.has(index));
  const dropped = droppedIndices.map((index) => rolls[index]);

  const natural = kept.reduce((sum, r) => sum + r, 0);
  return {
    notation,
    count,
    faces,
    rolls,
    kept,
    keptIndices,
    dropped,
    droppedIndices,
    ...(keep === undefined ? {} : { keep }),
    natural,
    modifier,
    total: natural + modifier,
  };
}
