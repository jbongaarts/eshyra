import {
  adjustCharacterCurrency,
  type CharacterWalletEventKind,
  type CurrencyDenomination,
  convertCharacterCurrency,
  type Db,
  DND5E_CURRENCY_DENOMINATIONS,
  getCharacterWallet,
  listCharacterWalletEvents,
} from '@eshyra/core';
import type { CliIO, PlayDeps } from './playTypes.js';

const RECENT_WALLET_EVENT_LIMIT = 5;

export function showWallet(io: CliIO, db: Db): void {
  let wallet: ReturnType<typeof getCharacterWallet>;
  let recent: ReturnType<typeof listCharacterWalletEvents>;
  try {
    wallet = getCharacterWallet(db);
    recent = listCharacterWalletEvents(db).slice(-RECENT_WALLET_EVENT_LIMIT);
  } catch (error) {
    io.write(`Wallet unavailable: ${(error as Error).message}`);
    return;
  }
  io.write(`Wallet: ${formatWallet(wallet)}.`);
  if (recent.length === 0) {
    io.write('Recent wallet events: none.');
    return;
  }
  io.write('Recent wallet events:');
  for (const event of recent) {
    io.write(
      `  - ${event.kind}: ${formatWalletDelta(event.amounts, event.kind)} -> ${formatWallet(event.resultingWallet)} (${event.occurredAt})`,
    );
  }
}

export function runMoneyCommand(
  deps: Pick<PlayDeps, 'io' | 'now'>,
  db: Db,
  sessionId: string,
  arg: string,
): void {
  const parts = arg.split(/\s+/).filter((part) => part.length > 0);
  const action = parts[0]?.toLowerCase();
  try {
    if (action === 'gain' || action === 'spend') {
      const parsed = parseAmount(parts.slice(1));
      const result = adjustCharacterCurrency(
        db,
        { kind: action, amounts: { [parsed.denomination]: parsed.amount } },
        {
          source: 'play-command',
          provenance: `cli:/money ${action}`,
          sessionId,
          at: deps.now(),
        },
      );
      deps.io.write(`Wallet: ${formatWallet(result.wallet)}.`);
      return;
    }
    if (action === 'convert') {
      const parsed = parseConvert(parts.slice(1));
      const result = convertCharacterCurrency(db, parsed, {
        source: 'play-command',
        provenance: 'cli:/money convert',
        sessionId,
        at: deps.now(),
      });
      deps.io.write(`Wallet: ${formatWallet(result.wallet)}.`);
      return;
    }
  } catch (error) {
    deps.io.write(`Money command failed: ${(error as Error).message}`);
    return;
  }

  deps.io.write(
    'Usage: /money gain <denomination> <amount> | /money spend <denomination> <amount> | /money convert <amount> <from> <to>',
  );
}

function parseAmount(parts: readonly string[]): {
  readonly denomination: CurrencyDenomination;
  readonly amount: number;
} {
  if (parts.length !== 2) {
    throw new Error('expected <denomination> <amount>');
  }
  const denomination = parseDenomination(parts[0]);
  const amount = parsePositiveInteger(parts[1]);
  return { denomination, amount };
}

function parseConvert(parts: readonly string[]): {
  readonly amount: number;
  readonly from: CurrencyDenomination;
  readonly to: CurrencyDenomination;
} {
  if (parts.length !== 3) {
    throw new Error('expected <amount> <from> <to>');
  }
  return {
    amount: parsePositiveInteger(parts[0]),
    from: parseDenomination(parts[1]),
    to: parseDenomination(parts[2]),
  };
}

function parseDenomination(value: string | undefined): CurrencyDenomination {
  const normalized = value?.toLowerCase();
  if (
    normalized !== undefined &&
    DND5E_CURRENCY_DENOMINATIONS.includes(normalized as CurrencyDenomination)
  ) {
    return normalized as CurrencyDenomination;
  }
  throw new Error(
    `expected denomination: ${DND5E_CURRENCY_DENOMINATIONS.join(', ')}`,
  );
}

function parsePositiveInteger(value: string | undefined): number {
  const amount = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(amount) || amount <= 0 || String(amount) !== value) {
    throw new Error('amount must be a positive integer');
  }
  return amount;
}

function formatWallet(wallet: {
  readonly cp?: number;
  readonly sp?: number;
  readonly ep?: number;
  readonly gp?: number;
  readonly pp?: number;
}): string {
  return DND5E_CURRENCY_DENOMINATIONS.map(
    (denomination) => `${wallet[denomination] ?? 0} ${denomination}`,
  ).join(', ');
}

function formatWalletDelta(
  amounts: {
    readonly cp?: number;
    readonly sp?: number;
    readonly ep?: number;
    readonly gp?: number;
    readonly pp?: number;
  },
  kind: CharacterWalletEventKind,
): string {
  return DND5E_CURRENCY_DENOMINATIONS.filter(
    (denomination) => (amounts[denomination] ?? 0) !== 0,
  )
    .map((denomination) => {
      const raw = amounts[denomination] ?? 0;
      const amount = kind === 'spend' ? -raw : raw;
      return `${amount > 0 ? '+' : ''}${amount} ${denomination}`;
    })
    .join(', ');
}
