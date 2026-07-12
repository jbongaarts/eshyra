import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { jsonColumn } from '../persistence/jsonColumn.js';
import {
  DND5E_SRD_PACK_ID,
  DND5E_SRD_SYSTEM_ID,
} from '../rules/bundledSrdPack.js';
import { resolveCharacterId } from '../state/activeCharacter.js';
import { MutateStateError } from '../state/mutateState.js';
import {
  type CharacterSheetStore,
  createSqliteCharacterSheetStore,
} from './characterSheetStore.js';
import type { CharacterSheet, CharacterWallet } from './finalizeCharacter.js';

export type CurrencyDenomination = keyof CharacterWallet;

export const DND5E_CURRENCY_DENOMINATIONS: readonly CurrencyDenomination[] = [
  'cp',
  'sp',
  'ep',
  'gp',
  'pp',
] as const;

const DND5E_COIN_VALUES_IN_CP: Readonly<Record<CurrencyDenomination, number>> =
  {
    cp: 1,
    sp: 10,
    ep: 50,
    gp: 100,
    pp: 1000,
  };

export const EMPTY_WALLET: CharacterWallet = {
  cp: 0,
  sp: 0,
  ep: 0,
  gp: 0,
  pp: 0,
};

export type CharacterWalletEventKind = 'gain' | 'spend' | 'convert';

export interface CharacterWalletEventRecord {
  readonly id: string;
  readonly characterId: string;
  readonly kind: CharacterWalletEventKind;
  readonly amounts: Partial<CharacterWallet>;
  readonly resultingWallet: CharacterWallet;
  readonly source: string;
  readonly occurredAt: string;
  readonly provenance: string;
  readonly sessionId: string;
}

export interface CurrencyMutationContext {
  readonly source: string;
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
  readonly characterId?: string;
  readonly store?: CharacterSheetStore;
}

export interface AdjustCurrencyInput {
  readonly kind: Extract<CharacterWalletEventKind, 'gain' | 'spend'>;
  readonly amounts: Partial<CharacterWallet>;
}

export interface ConvertCurrencyInput {
  readonly from: CurrencyDenomination;
  readonly to: CurrencyDenomination;
  readonly amount: number;
}

export interface CharacterWalletMutationResult {
  readonly previousWallet: CharacterWallet;
  readonly wallet: CharacterWallet;
  readonly event: CharacterWalletEventRecord;
}

interface CharacterWalletEventRow {
  readonly id: string;
  readonly character_id: string;
  readonly kind: CharacterWalletEventKind;
  readonly amounts_json: string;
  readonly resulting_wallet_json: string;
  readonly source: string;
  readonly occurred_at: string;
  readonly provenance: string;
  readonly session_id: string;
}

const walletColumn = jsonColumn<CharacterWallet>(
  'character_wallet_event.resulting_wallet_json',
);
const amountsColumn = jsonColumn<Partial<CharacterWallet>>(
  'character_wallet_event.amounts_json',
);

export function getCharacterWallet(
  db: Db,
  characterId?: string,
  store: CharacterSheetStore = createSqliteCharacterSheetStore(db),
): CharacterWallet {
  const charId = resolveCharacterId(db, characterId);
  const sheet = store.load(charId);
  if (sheet === undefined) {
    throw new MutateStateError(`no character sheet stored for '${charId}'`);
  }
  assertDnd5eWalletSheet(sheet);
  return normalizeWallet(sheet.wallet);
}

export function adjustCharacterCurrency(
  db: Db,
  input: AdjustCurrencyInput,
  ctx: CurrencyMutationContext,
): CharacterWalletMutationResult {
  const amounts = normalizeAmount(input.amounts);
  if (walletTotal(amounts) === 0) {
    throw new MutateStateError(
      'currency amount must include at least one coin',
    );
  }
  return withTransaction(db, (txnDb) => {
    const store = ctx.store ?? createSqliteCharacterSheetStore(txnDb);
    const charId = resolveCharacterId(txnDb, ctx.characterId);
    const sheet = loadWalletSheet(store, charId);
    const previousWallet = normalizeWallet(sheet.wallet);
    const wallet =
      input.kind === 'gain'
        ? addWallets(previousWallet, amounts)
        : subtractWallets(previousWallet, amounts);
    saveWalletSheet(store, charId, sheet, wallet);
    const event = recordCharacterWalletEvent(txnDb, {
      characterId: charId,
      kind: input.kind,
      amounts,
      resultingWallet: wallet,
      source: ctx.source,
      occurredAt: ctx.at,
      provenance: ctx.provenance,
      sessionId: ctx.sessionId,
    });
    return { previousWallet, wallet, event };
  });
}

export function convertCharacterCurrency(
  db: Db,
  input: ConvertCurrencyInput,
  ctx: CurrencyMutationContext,
): CharacterWalletMutationResult {
  requireDenomination(input.from);
  requireDenomination(input.to);
  if (input.from === input.to) {
    throw new MutateStateError(
      'currency conversion requires two denominations',
    );
  }
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new MutateStateError('currency conversion amount must be positive');
  }

  return withTransaction(db, (txnDb) => {
    const store = ctx.store ?? createSqliteCharacterSheetStore(txnDb);
    const charId = resolveCharacterId(txnDb, ctx.characterId);
    const sheet = loadWalletSheet(store, charId);
    const previousWallet = normalizeWallet(sheet.wallet);
    if (previousWallet[input.from] < input.amount) {
      throw new MutateStateError(
        `not enough ${input.from} to convert ${input.amount} ${input.from}`,
      );
    }

    const sourceValue = input.amount * DND5E_COIN_VALUES_IN_CP[input.from];
    const targetValue = DND5E_COIN_VALUES_IN_CP[input.to];
    if (sourceValue % targetValue !== 0) {
      throw new MutateStateError(
        `${input.amount} ${input.from} cannot convert exactly to ${input.to}`,
      );
    }
    const targetAmount = sourceValue / targetValue;
    const wallet = {
      ...previousWallet,
      [input.from]: previousWallet[input.from] - input.amount,
      [input.to]: previousWallet[input.to] + targetAmount,
    };
    const amounts = {
      [input.from]: -input.amount,
      [input.to]: targetAmount,
    } as Partial<CharacterWallet>;

    saveWalletSheet(store, charId, sheet, wallet);
    const event = recordCharacterWalletEvent(txnDb, {
      characterId: charId,
      kind: 'convert',
      amounts,
      resultingWallet: wallet,
      source: ctx.source,
      occurredAt: ctx.at,
      provenance: ctx.provenance,
      sessionId: ctx.sessionId,
    });
    return { previousWallet, wallet, event };
  });
}

export function listCharacterWalletEvents(
  db: Db,
  characterId?: string,
): readonly CharacterWalletEventRecord[] {
  const charId = resolveCharacterId(db, characterId);
  const rows = db
    .prepare(
      `SELECT id, character_id, kind, amounts_json, resulting_wallet_json,
              source, occurred_at, provenance, session_id
         FROM character_wallet_event
        WHERE character_id = ?
        ORDER BY occurred_at, rowid`,
    )
    .all(charId) as CharacterWalletEventRow[];
  return rows.map(rowToWalletEvent);
}

function loadWalletSheet(
  store: CharacterSheetStore,
  characterId: string,
): CharacterSheet {
  const sheet = store.load(characterId);
  if (sheet === undefined) {
    throw new MutateStateError(
      `no character sheet stored for '${characterId}'`,
    );
  }
  assertDnd5eWalletSheet(sheet);
  return sheet;
}

function assertDnd5eWalletSheet(sheet: CharacterSheet): void {
  if (
    sheet.system !== DND5E_SRD_SYSTEM_ID ||
    sheet.rulesPackId !== DND5E_SRD_PACK_ID
  ) {
    throw new MutateStateError(
      `currency wallet is not implemented for ${sheet.system}/${sheet.rulesPackId}`,
    );
  }
}

function saveWalletSheet(
  store: CharacterSheetStore,
  characterId: string,
  sheet: CharacterSheet,
  wallet: CharacterWallet,
): void {
  store.save(characterId, { ...sheet, wallet });
}

function normalizeWallet(
  wallet: Partial<CharacterWallet> | undefined,
): CharacterWallet {
  return normalizeAmount(wallet ?? EMPTY_WALLET);
}

function normalizeAmount(amounts: Partial<CharacterWallet>): CharacterWallet {
  const wallet = { ...EMPTY_WALLET };
  for (const denomination of DND5E_CURRENCY_DENOMINATIONS) {
    const value = amounts[denomination] ?? 0;
    if (!Number.isInteger(value)) {
      throw new MutateStateError(
        `currency amount for ${denomination} must be an integer`,
      );
    }
    if (value < 0) {
      throw new MutateStateError(
        `currency amount for ${denomination} must be non-negative`,
      );
    }
    wallet[denomination] = value;
  }
  return wallet;
}

function requireDenomination(
  value: string,
): asserts value is CurrencyDenomination {
  if (!DND5E_CURRENCY_DENOMINATIONS.includes(value as CurrencyDenomination)) {
    throw new MutateStateError(`unsupported currency denomination '${value}'`);
  }
}

function addWallets(
  left: CharacterWallet,
  right: CharacterWallet,
): CharacterWallet {
  return {
    cp: left.cp + right.cp,
    sp: left.sp + right.sp,
    ep: left.ep + right.ep,
    gp: left.gp + right.gp,
    pp: left.pp + right.pp,
  };
}

function subtractWallets(
  left: CharacterWallet,
  right: CharacterWallet,
): CharacterWallet {
  const wallet = {
    cp: left.cp - right.cp,
    sp: left.sp - right.sp,
    ep: left.ep - right.ep,
    gp: left.gp - right.gp,
    pp: left.pp - right.pp,
  };
  for (const denomination of DND5E_CURRENCY_DENOMINATIONS) {
    if (wallet[denomination] < 0) {
      throw new MutateStateError(
        `not enough ${denomination} to spend ${right[denomination]} ${denomination}`,
      );
    }
  }
  return wallet;
}

function walletTotal(wallet: CharacterWallet): number {
  return DND5E_CURRENCY_DENOMINATIONS.reduce(
    (sum, denomination) => sum + wallet[denomination],
    0,
  );
}

interface RecordCharacterWalletEventInput {
  readonly characterId: string;
  readonly kind: CharacterWalletEventKind;
  readonly amounts: Partial<CharacterWallet>;
  readonly resultingWallet: CharacterWallet;
  readonly source: string;
  readonly occurredAt: string;
  readonly provenance: string;
  readonly sessionId: string;
}

function recordCharacterWalletEvent(
  db: Db,
  input: RecordCharacterWalletEventInput,
): CharacterWalletEventRecord {
  const id = nextCharacterWalletEventId(db, input.characterId);
  db.prepare(
    `INSERT INTO character_wallet_event(
       id, character_id, kind, amounts_json, resulting_wallet_json, source,
       occurred_at, provenance, session_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.characterId,
    input.kind,
    amountsColumn.encode(input.amounts),
    walletColumn.encode(input.resultingWallet),
    input.source,
    input.occurredAt,
    input.provenance,
    input.sessionId,
  );
  const row = db
    .prepare(
      `SELECT id, character_id, kind, amounts_json, resulting_wallet_json,
              source, occurred_at, provenance, session_id
         FROM character_wallet_event WHERE id = ?`,
    )
    .get(id) as CharacterWalletEventRow | undefined;
  if (row === undefined) {
    throw new MutateStateError(`wallet event '${id}' was not persisted`);
  }
  return rowToWalletEvent(row);
}

function nextCharacterWalletEventId(db: Db, characterId: string): string {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
         FROM character_wallet_event
        WHERE character_id = ?`,
    )
    .get(characterId) as { count: number } | undefined;
  return `${characterId}:wallet:${(row?.count ?? 0) + 1}`;
}

function rowToWalletEvent(
  row: CharacterWalletEventRow,
): CharacterWalletEventRecord {
  return {
    id: row.id,
    characterId: row.character_id,
    kind: row.kind,
    amounts: amountsColumn.decode(row.amounts_json),
    resultingWallet: walletColumn.decode(row.resulting_wallet_json),
    source: row.source,
    occurredAt: row.occurred_at,
    provenance: row.provenance,
    sessionId: row.session_id,
  };
}
