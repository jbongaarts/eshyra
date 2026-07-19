import {
  parseDice,
  resolveParsedDiceRoll,
  rollDice,
} from '../orchestrator/dice.js';
import type { Rng } from '../orchestrator/rng.js';
import type { RulesRecord } from '../rules/types.js';

type Obj = Record<string, unknown>;

export interface ItemInitializationRollEvidence {
  readonly purpose: string;
  readonly notation: string;
  readonly rolls: readonly number[];
  readonly total: number;
}

export interface ItemRandomTableResult {
  readonly roll: number;
  readonly rowIndex: number;
  readonly outcome: readonly string[];
}

export type ItemRandomInitializationState =
  | {
      readonly kind: 'table-pool';
      readonly tableRef: string;
      readonly remainingEntryIds: readonly string[];
      readonly removedEntryIds: readonly string[];
    }
  | {
      readonly kind: 'containment-occupant';
      readonly tableRef: string;
      readonly occupant: ItemRandomTableResult | null;
    }
  | {
      readonly kind: 'table-results';
      readonly tableRef: string;
      readonly results: readonly ItemRandomTableResult[];
    };

export interface DeclaredRandomInitializationResult {
  readonly custom?: Readonly<Record<string, unknown>>;
  readonly randomInitialization?: Readonly<
    Record<string, ItemRandomInitializationState>
  >;
}

export class ItemRandomInitializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ItemRandomInitializationError';
  }
}

function object(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ItemRandomInitializationError(`${path} must be an object`);
  return value as Obj;
}

function requireRng(rng: Rng | undefined, purpose: string): Rng {
  if (rng === undefined)
    throw new ItemRandomInitializationError(
      `${purpose} is random; seeded RNG is required for item initialization`,
    );
  return rng;
}

function recordRoll(
  purpose: string,
  notation: string,
  rng: Rng,
  evidence: ItemInitializationRollEvidence[],
): ItemInitializationRollEvidence {
  const rolled = rollDice(notation, rng);
  const result = {
    purpose,
    notation: rolled.notation,
    rolls: rolled.rolls,
    total: rolled.total,
  };
  evidence.push(result);
  return result;
}

function compatibleEvidence(
  notation: string,
  evidence: readonly ItemInitializationRollEvidence[],
): ItemInitializationRollEvidence | undefined {
  const expected = parseDice(notation);
  const matches = evidence.filter((entry) => {
    const actual = parseDice(entry.notation);
    return actual.count === expected.count && actual.faces === expected.faces;
  });
  if (matches.length !== 1) return undefined;
  const source = matches[0];
  const resolved = resolveParsedDiceRoll(notation, expected, source.rolls);
  return {
    purpose: source.purpose,
    notation,
    rolls: source.rolls,
    total: resolved.total,
  };
}

interface TableData {
  readonly rows: readonly (readonly string[])[];
}

function tableData(
  tableRef: string,
  resolveTable: ((ref: string) => RulesRecord | undefined) | undefined,
): TableData {
  const record = resolveTable?.(tableRef);
  if (record === undefined || record.kind !== 'table')
    throw new ItemRandomInitializationError(
      `initial-state table ${JSON.stringify(tableRef)} does not resolve`,
    );
  const data = object(record.data, `${tableRef}.data`);
  if (!Array.isArray(data.rows) || data.rows.length === 0)
    throw new ItemRandomInitializationError(`${tableRef}.data.rows is empty`);
  const rows = data.rows.map((raw, index) => {
    if (!Array.isArray(raw) || !raw.every((cell) => typeof cell === 'string'))
      throw new ItemRandomInitializationError(
        `${tableRef}.data.rows[${index}] must be a string row`,
      );
    return raw as string[];
  });
  return { rows };
}

function rangeBound(value: string): number {
  const parsed = Number(value);
  return parsed === 0 ? 100 : parsed;
}

function tableResult(
  table: TableData,
  total: number,
  tableRef: string,
): ItemRandomTableResult {
  const rowIndex = table.rows.findIndex((row) => {
    const match = /^(\d+)(?:[–-](\d+))?$/.exec(row[0]);
    if (match === null) return false;
    const low = rangeBound(match[1]);
    const high = rangeBound(match[2] ?? match[1]);
    return total >= low && total <= high;
  });
  if (rowIndex < 0)
    throw new ItemRandomInitializationError(
      `${tableRef} has no row for initialization roll ${total}`,
    );
  return { roll: total, rowIndex, outcome: table.rows[rowIndex].slice(1) };
}

function tableEntryIds(table: TableData): string[] {
  return table.rows.flatMap((row, rowIndex) => {
    const copies = Number(/\((\d+)\)$/.exec(row[0])?.[1] ?? 1);
    return Array.from(
      { length: copies },
      (_, copy) => `row-${rowIndex + 1}-copy-${copy + 1}`,
    );
  });
}

function initializeCardPool(
  procedure: Obj,
  declaration: Obj,
  rng: Rng | undefined,
  evidence: ItemInitializationRollEvidence[],
): Readonly<Record<string, unknown>> {
  const variants = Array.isArray(declaration.variants)
    ? declaration.variants.map((raw, index) =>
        object(raw, `randomProcedure.customState.variants[${index}]`),
      )
    : [];
  if (variants.length === 0)
    throw new ItemRandomInitializationError('card-pool has no variants');
  let selected = variants[0];
  if (variants.length > 1) {
    const risk = object(procedure.risk, 'initial-state.risk');
    if (
      typeof risk.percent !== 'number' ||
      !Number.isInteger(risk.percent) ||
      risk.percent < 0 ||
      risk.percent > 100 ||
      typeof procedure.outcome !== 'string'
    )
      throw new ItemRandomInitializationError(
        'multi-variant card-pool lacks percentage/outcome bindings',
      );
    const outcome = procedure.outcome.toLowerCase();
    const names = (prefix: string, id: string) =>
      [id, id.replaceAll('-', ' ')].some((label) =>
        outcome.includes(`${prefix}${label} variant`),
      );
    const threshold = variants.find(
      ({ id }) =>
        typeof id === 'string' &&
        names(`${risk.percent} percent initializes the `, id),
    );
    const otherwise = variants.find(
      ({ id }) =>
        typeof id === 'string' && names('otherwise initialize the ', id),
    );
    if (
      threshold === undefined ||
      otherwise === undefined ||
      threshold === otherwise
    )
      throw new ItemRandomInitializationError(
        'card-pool outcome does not unambiguously bind variants',
      );
    const roll = recordRoll(
      `randomProcedure:${String(procedure.id)}`,
      '1d100',
      requireRng(rng, `randomProcedure:${String(procedure.id)}`),
      evidence,
    );
    selected = roll.total <= risk.percent ? threshold : otherwise;
  }
  if (
    typeof selected.id !== 'string' ||
    !Array.isArray(selected.initialCardIds)
  )
    throw new ItemRandomInitializationError(
      'card-pool selected variant is malformed',
    );
  return {
    variantId: selected.id,
    remainingCardIds: [...selected.initialCardIds],
    returnedCardIds: [],
  };
}

/** Own every currently reviewed initial-state declaration or fail closed. */
export function initializeDeclaredRandomState(input: {
  readonly mechanics: Obj;
  readonly rng?: Rng;
  readonly evidence: ItemInitializationRollEvidence[];
  readonly resolveTable?: (ref: string) => RulesRecord | undefined;
}): DeclaredRandomInitializationResult {
  if (input.mechanics.randomProcedure === undefined) return {};
  const random = object(input.mechanics.randomProcedure, 'randomProcedure');
  const procedures = Array.isArray(random.procedures)
    ? random.procedures
        .map((raw, index) =>
          object(raw, `randomProcedure.procedures[${index}]`),
        )
        .filter(({ kind }) => kind === 'initial-state')
    : [];
  if (procedures.length === 0) return {};
  const states: Record<string, ItemRandomInitializationState> = {};
  let custom: Readonly<Record<string, unknown>> | undefined;

  for (const procedure of procedures) {
    if (typeof procedure.id !== 'string' || procedure.id.length === 0)
      throw new ItemRandomInitializationError(
        'initial-state procedure lacks an id',
      );
    const purpose = `randomProcedure:${procedure.id}`;
    if (procedure.risk !== undefined && random.customState !== undefined) {
      custom = initializeCardPool(
        procedure,
        object(random.customState, 'randomProcedure.customState'),
        input.rng,
        input.evidence,
      );
      continue;
    }
    if (typeof procedure.roll !== 'string')
      throw new ItemRandomInitializationError(
        `${purpose} has no deterministic initialization owner`,
      );
    const reused = compatibleEvidence(procedure.roll, input.evidence);
    const tableRef =
      typeof procedure.tableRef === 'string' ? procedure.tableRef : undefined;
    if (tableRef === undefined) {
      if (reused === undefined)
        throw new ItemRandomInitializationError(
          `${purpose} is not bound to an initialized economy or spell-store contract`,
        );
      continue;
    }
    const table = tableData(tableRef, input.resolveTable);
    const outcome =
      typeof procedure.outcome === 'string'
        ? procedure.outcome.toLowerCase()
        : '';
    if (outcome.startsWith('remove that many randomly selected')) {
      const count =
        reused ??
        recordRoll(
          purpose,
          procedure.roll,
          requireRng(input.rng, purpose),
          input.evidence,
        );
      const available = tableEntryIds(table);
      const removed: string[] = [];
      const rng = requireRng(input.rng, purpose);
      for (let index = 0; index < count.total; index += 1) {
        if (available.length === 0)
          throw new ItemRandomInitializationError(
            `${purpose} removes more entries than ${tableRef} declares`,
          );
        removed.push(available.splice(rng.nextInt(available.length), 1)[0]);
      }
      states[procedure.id] = {
        kind: 'table-pool',
        tableRef,
        remainingEntryIds: available,
        removedEntryIds: removed,
      };
      continue;
    }
    const containment =
      input.mechanics.containment === undefined
        ? undefined
        : object(input.mechanics.containment, 'mechanics.containment');
    if (
      containment?.tracksOccupancy === true &&
      outcome.includes('rolled creature')
    ) {
      const roll = recordRoll(
        purpose,
        procedure.roll,
        requireRng(input.rng, purpose),
        input.evidence,
      );
      const result = tableResult(table, roll.total, tableRef);
      states[procedure.id] = {
        kind: 'containment-occupant',
        tableRef,
        occupant: result.outcome[0]?.toLowerCase() === 'empty' ? null : result,
      };
      continue;
    }
    if (
      typeof procedure.trigger === 'string' &&
      procedure.trigger.toLowerCase().startsWith('each ') &&
      outcome.startsWith('add the rolled')
    ) {
      const countProcedure = procedures.find(
        (candidate) =>
          candidate !== procedure &&
          typeof candidate.outcome === 'string' &&
          candidate.outcome.toLowerCase().includes('initialize') &&
          typeof candidate.roll === 'string' &&
          compatibleEvidence(candidate.roll, input.evidence) !== undefined,
      );
      const count =
        countProcedure === undefined
          ? undefined
          : compatibleEvidence(countProcedure.roll as string, input.evidence);
      if (count === undefined)
        throw new ItemRandomInitializationError(
          `${purpose} has no initialized source-declared repetition count`,
        );
      const results: ItemRandomTableResult[] = [];
      for (let index = 0; index < count.total; index += 1) {
        const roll = recordRoll(
          `${purpose}:${index + 1}`,
          procedure.roll,
          requireRng(input.rng, purpose),
          input.evidence,
        );
        results.push(tableResult(table, roll.total, tableRef));
      }
      states[procedure.id] = {
        kind: 'table-results',
        tableRef,
        results,
      };
      continue;
    }
    throw new ItemRandomInitializationError(
      `${purpose} has an unowned initial-state table shape`,
    );
  }
  return {
    ...(custom === undefined ? {} : { custom }),
    ...(Object.keys(states).length === 0
      ? {}
      : { randomInitialization: states }),
  };
}

/** Re-check persisted semantic counts and roll/result correspondence. */
export function validateDeclaredRandomState(input: {
  readonly mechanics: Obj;
  readonly state: Readonly<Record<string, ItemRandomInitializationState>>;
  readonly evidence: readonly ItemInitializationRollEvidence[];
  readonly resolveTable?: (ref: string) => RulesRecord | undefined;
}): void {
  const random = object(input.mechanics.randomProcedure, 'randomProcedure');
  const procedures = Array.isArray(random.procedures)
    ? random.procedures
        .map((raw, index) =>
          object(raw, `randomProcedure.procedures[${index}]`),
        )
        .filter(({ kind }) => kind === 'initial-state')
    : [];
  const tableProcedures = new Map(
    procedures
      .filter(
        (procedure) =>
          typeof procedure.id === 'string' &&
          typeof procedure.tableRef === 'string',
      )
      .map((procedure) => [procedure.id as string, procedure] as const),
  );
  for (const [id, procedure] of tableProcedures) {
    const state = input.state[id];
    if (state === undefined || state.tableRef !== procedure.tableRef)
      throw new ItemRandomInitializationError(
        `initial-state procedure '${id}' lacks its declared table state`,
      );
    const purpose = `randomProcedure:${id}`;
    const table = tableData(state.tableRef, input.resolveTable);
    if (state.kind === 'table-pool') {
      const roll = input.evidence.find((entry) => entry.purpose === purpose);
      if (roll === undefined || state.removedEntryIds.length !== roll.total)
        throw new ItemRandomInitializationError(
          `${purpose} removed-entry count does not match its roll`,
        );
      const declared = tableEntryIds(table).sort();
      const persisted = [
        ...state.remainingEntryIds,
        ...state.removedEntryIds,
      ].sort();
      if (JSON.stringify(declared) !== JSON.stringify(persisted))
        throw new ItemRandomInitializationError(
          `${purpose} table-pool entries do not match ${state.tableRef}`,
        );
    } else if (state.kind === 'containment-occupant') {
      const roll = input.evidence.find((entry) => entry.purpose === purpose);
      if (roll === undefined)
        throw new ItemRandomInitializationError(
          `${purpose} occupant does not match its roll`,
        );
      const expected = tableResult(table, roll.total, state.tableRef);
      const expectedOccupant =
        expected.outcome[0]?.toLowerCase() === 'empty' ? null : expected;
      if (JSON.stringify(state.occupant) !== JSON.stringify(expectedOccupant))
        throw new ItemRandomInitializationError(
          `${purpose} occupant does not match ${state.tableRef} roll ${roll.total}`,
        );
    } else {
      const countProcedure = procedures.find(
        (candidate) =>
          candidate !== procedure &&
          typeof candidate.outcome === 'string' &&
          candidate.outcome.toLowerCase().includes('initialize') &&
          typeof candidate.roll === 'string' &&
          compatibleEvidence(candidate.roll, input.evidence) !== undefined,
      );
      const count =
        countProcedure === undefined
          ? undefined
          : compatibleEvidence(countProcedure.roll as string, input.evidence);
      if (count === undefined || state.results.length !== count.total)
        throw new ItemRandomInitializationError(
          `${purpose} result count does not match its source-declared count`,
        );
      state.results.forEach((result, index) => {
        const roll = input.evidence.find(
          (entry) => entry.purpose === `${purpose}:${index + 1}`,
        );
        if (roll === undefined || result.roll !== roll.total)
          throw new ItemRandomInitializationError(
            `${purpose} result ${index + 1} does not match its roll`,
          );
        const expected = tableResult(table, roll.total, state.tableRef);
        if (JSON.stringify(result) !== JSON.stringify(expected))
          throw new ItemRandomInitializationError(
            `${purpose} result ${index + 1} does not match ${state.tableRef}`,
          );
      });
    }
  }
  for (const id of Object.keys(input.state))
    if (!tableProcedures.has(id))
      throw new ItemRandomInitializationError(
        `random initialization state names undeclared procedure '${id}'`,
      );
}
