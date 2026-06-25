import {
  ROLL_CATEGORIES,
  type RollCategory,
  type RollVisibility,
} from './toolRoll.js';
import type { ExecutedToolCall } from './turnLoop.js';

export interface PlayerVisibleRollEntry {
  readonly label: string;
  readonly reason: string;
  readonly dice: string;
  readonly rolls: readonly number[];
  readonly modifier: number;
  readonly total: number;
  readonly visibility: RollVisibility;
  readonly category: RollCategory;
}

interface RollToolData {
  readonly dice: string;
  readonly reason: string;
  readonly visibility?: RollVisibility;
  readonly category?: RollCategory;
  readonly rolls: readonly number[];
  readonly modifier: number;
  readonly total: number;
}

const LEDGER_HEADING = 'Rolls:';

const CATEGORY_LABELS: Record<RollCategory, string> = {
  attack: 'Attack',
  damage: 'Damage',
  initiative: 'Initiative',
  saving_throw: 'Saving throw',
  death_save: 'Death save',
  ability_check: 'Ability check',
  other: 'Other',
};

function isRollVisibility(value: unknown): value is RollVisibility {
  return value === 'player_visible' || value === 'dm_only';
}

function isRollCategory(value: unknown): value is RollCategory {
  return (
    typeof value === 'string' && ROLL_CATEGORIES.includes(value as RollCategory)
  );
}

function readRollToolData(value: unknown): RollToolData | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.dice !== 'string' ||
    typeof record.reason !== 'string' ||
    !Array.isArray(record.rolls) ||
    !record.rolls.every((roll) => Number.isInteger(roll)) ||
    typeof record.modifier !== 'number' ||
    !Number.isInteger(record.modifier) ||
    typeof record.total !== 'number' ||
    !Number.isInteger(record.total)
  ) {
    return undefined;
  }
  return {
    dice: record.dice,
    reason: record.reason,
    ...(isRollVisibility(record.visibility)
      ? { visibility: record.visibility }
      : {}),
    ...(isRollCategory(record.category) ? { category: record.category } : {}),
    rolls: record.rolls as number[],
    modifier: record.modifier,
    total: record.total,
  };
}

function formatRollMath(entry: PlayerVisibleRollEntry): string {
  const rolled = entry.rolls.join(' + ');
  if (entry.modifier === 0) {
    return rolled;
  }
  const sign = entry.modifier > 0 ? '+' : '-';
  return `${rolled} ${sign} ${Math.abs(entry.modifier)}`;
}

function stripTrailingModelRollLedger(narration: string): string {
  return narration.replace(/(?:\n{2,}|\n)?Rolls:\s*\n[\s\S]*$/i, '').trimEnd();
}

export function playerVisibleRollEntries(
  calls: readonly ExecutedToolCall[],
): PlayerVisibleRollEntry[] {
  const entries: PlayerVisibleRollEntry[] = [];
  for (const call of calls) {
    if (call.tool !== 'roll' || !call.result.ok) {
      continue;
    }
    const data = readRollToolData(call.result.data);
    if (data === undefined) {
      continue;
    }
    if (data.visibility !== 'player_visible') {
      continue;
    }
    const category = data.category ?? 'other';
    entries.push({
      label: CATEGORY_LABELS[category],
      reason: data.reason,
      dice: data.dice,
      rolls: data.rolls,
      modifier: data.modifier,
      total: data.total,
      visibility: data.visibility,
      category,
    });
  }
  return entries;
}

export function renderPlayerVisibleRollLedger(
  entries: readonly PlayerVisibleRollEntry[],
): string {
  if (entries.length === 0) {
    return '';
  }
  const lines = entries.map(
    (entry) =>
      `- ${entry.label} (${entry.reason}): ${entry.dice} = ${entry.total} (${formatRollMath(entry)})`,
  );
  return [LEDGER_HEADING, ...lines].join('\n');
}

export function appendPlayerVisibleRollLedger(
  narration: string,
  calls: readonly ExecutedToolCall[],
): string {
  const baseNarration = stripTrailingModelRollLedger(narration);
  const ledger = renderPlayerVisibleRollLedger(playerVisibleRollEntries(calls));
  if (ledger.length === 0) {
    return baseNarration;
  }
  return `${baseNarration}\n\n${ledger}`;
}
