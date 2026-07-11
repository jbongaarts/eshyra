import type {
  ContestResolution,
  D20Resolution,
  DamageResolution,
  DeclaredModifier,
} from './resolution.js';
import {
  ROLL_CATEGORIES,
  type RollCategory,
  type RollVisibility,
} from './toolRoll.js';
import type { ExecutedToolCall } from './turnLoop.js';

/**
 * Engine-rendered, mathematically authoritative "Rolls:" ledger appended to
 * player-visible narration. Reads successful `roll`, `resolve_check`,
 * `resolve_contest`, and `resolve_damage` tool results (F1/F9: rolled dice,
 * kept/dropped selection, natural results, declared modifiers, and outcomes
 * all come from tool data — never from model prose).
 */

export interface PlayerVisibleRollEntry {
  readonly label: string;
  readonly reason: string;
  readonly visibility: RollVisibility;
  readonly category: RollCategory;
  /** Fully rendered ledger math for this entry (after the label/reason). */
  readonly detail: string;
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

const CONTEST_LABEL = 'Contest';

function isRollVisibility(value: unknown): value is RollVisibility {
  return value === 'player_visible' || value === 'dm_only';
}

function isRollCategory(value: unknown): value is RollCategory {
  return (
    typeof value === 'string' && ROLL_CATEGORIES.includes(value as RollCategory)
  );
}

function asDataRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isIntArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((n) => Number.isInteger(n));
}

function formatModifierBreakdown(
  modifiers: readonly DeclaredModifier[],
  proficiencyApplied: number | undefined,
): string {
  const parts = modifiers.map(
    (m) => `${m.value >= 0 ? '+' : '-'} ${Math.abs(m.value)} (${m.label})`,
  );
  if (proficiencyApplied !== undefined && proficiencyApplied !== 0) {
    parts.push(
      `${proficiencyApplied >= 0 ? '+' : '-'} ${Math.abs(proficiencyApplied)} (proficiency)`,
    );
  }
  return parts.join(' ');
}

/** e.g. `2d20kh1 [17 | 5 dropped] nat 17 + 4 (DEX modifier) = 21 vs AC 15 → hit (adv)`. */
function formatD20Detail(resolution: D20Resolution): string {
  // Mark dropped dice by index so the selection is unambiguous even when
  // both d20s tie.
  const droppedIndexSet = new Set(resolution.droppedIndices ?? []);
  const diceShown =
    resolution.rolls.length > 1
      ? `${resolution.dice} [${resolution.rolls
          .map((die, index) =>
            droppedIndexSet.has(index) ? `${die} dropped` : `${die}`,
          )
          .join(' | ')}]`
      : resolution.dice;
  const breakdown = formatModifierBreakdown(
    resolution.modifiers,
    resolution.proficiency?.applied,
  );
  const stateSuffix =
    resolution.advantageState === 'advantage'
      ? ' (adv)'
      : resolution.advantageState === 'disadvantage'
        ? ' (dis)'
        : '';
  const vsPart =
    resolution.vs === undefined
      ? ''
      : ` vs ${resolution.kind === 'attack' ? 'AC' : 'DC'} ${resolution.vs}`;
  const outcomePart =
    resolution.outcome === undefined
      ? ''
      : ` → ${resolution.outcome}${resolution.critical === true ? ' (critical)' : ''}`;
  return `${diceShown} nat ${resolution.natural}${breakdown.length > 0 ? ` ${breakdown}` : ''} = ${resolution.total}${vsPart}${outcomePart}${stateSuffix}`;
}

function readRollEntry(
  data: Record<string, unknown>,
): PlayerVisibleRollEntry | undefined {
  if (
    typeof data.dice !== 'string' ||
    typeof data.reason !== 'string' ||
    !isIntArray(data.rolls) ||
    !Number.isInteger(data.modifier) ||
    !Number.isInteger(data.total)
  ) {
    return undefined;
  }
  if (data.visibility !== 'player_visible') {
    return undefined;
  }
  const category = isRollCategory(data.category) ? data.category : 'other';
  const modifier = data.modifier as number;
  const dropped = isIntArray(data.dropped) ? data.dropped : [];
  const kept = isIntArray(data.kept) ? data.kept : data.rolls;
  const shownDice = dropped.length > 0 ? kept : data.rolls;
  const modifierPart =
    modifier === 0 ? '' : ` ${modifier > 0 ? '+' : '-'} ${Math.abs(modifier)}`;
  const droppedPart =
    dropped.length > 0 ? `, dropped ${dropped.join(', ')}` : '';
  const detail = `${data.dice} = ${data.total} (${shownDice.join(' + ')}${modifierPart}${droppedPart})`;
  return {
    label: CATEGORY_LABELS[category],
    reason: data.reason,
    visibility: data.visibility,
    category,
    detail,
  };
}

function readResolveCheckEntry(
  data: Record<string, unknown>,
): PlayerVisibleRollEntry | undefined {
  if (data.visibility !== 'player_visible') {
    return undefined;
  }
  if (
    typeof data.reason !== 'string' ||
    typeof data.dice !== 'string' ||
    !isIntArray(data.rolls) ||
    !Number.isInteger(data.natural) ||
    !Number.isInteger(data.total) ||
    !isRollCategory(data.category)
  ) {
    return undefined;
  }
  const resolution = data as unknown as D20Resolution & {
    reason: string;
    actor?: string;
    category: RollCategory;
    visibility: RollVisibility;
  };
  const reason =
    typeof data.actor === 'string'
      ? `${data.actor}: ${resolution.reason}`
      : resolution.reason;
  return {
    label: CATEGORY_LABELS[resolution.category],
    reason,
    visibility: 'player_visible',
    category: resolution.category,
    detail: formatD20Detail(resolution),
  };
}

function readResolveContestEntry(
  data: Record<string, unknown>,
): PlayerVisibleRollEntry | undefined {
  if (data.visibility !== 'player_visible') {
    return undefined;
  }
  const a = asDataRecord(data.a);
  const b = asDataRecord(data.b);
  if (
    typeof data.reason !== 'string' ||
    a === undefined ||
    b === undefined ||
    typeof a.label !== 'string' ||
    typeof b.label !== 'string' ||
    (data.outcome !== 'a' && data.outcome !== 'b' && data.outcome !== 'tie')
  ) {
    return undefined;
  }
  const contest = data as unknown as ContestResolution & { reason: string };
  const sideText = (side: ContestResolution['a']): string =>
    `${side.label} ${formatD20Detail(side)}`;
  const outcomeText =
    contest.outcome === 'tie'
      ? 'tie — situation unchanged'
      : `${contest.winner} wins`;
  return {
    label: CONTEST_LABEL,
    reason: contest.reason,
    visibility: 'player_visible',
    category: 'ability_check',
    detail: `${sideText(contest.a)} vs ${sideText(contest.b)} → ${outcomeText}`,
  };
}

function readResolveDamageEntry(
  data: Record<string, unknown>,
): PlayerVisibleRollEntry | undefined {
  if (data.visibility !== 'player_visible') {
    return undefined;
  }
  if (
    typeof data.reason !== 'string' ||
    !Array.isArray(data.packets) ||
    !Number.isInteger(data.total)
  ) {
    return undefined;
  }
  const damage = data as unknown as DamageResolution & { reason: string };
  const packetTexts = damage.packets.map((packet) => {
    const modifierSum = packet.modifiers.reduce((sum, m) => sum + m.value, 0);
    const modifierPart =
      modifierSum === 0
        ? ''
        : ` ${modifierSum > 0 ? '+' : '-'} ${Math.abs(modifierSum)}`;
    const labelPart = packet.label === undefined ? '' : `${packet.label} `;
    return `${labelPart}${packet.dice} [${packet.rolls.join(' + ')}]${modifierPart} = ${packet.contribution} ${packet.type}`;
  });
  // Rules math happens on the per-type aggregates; show them so a negative
  // packet visibly offsets same-type damage before the min-0 clamp.
  const typeTexts = (damage.byType ?? []).map(
    (entry) => `${entry.subtotal} ${entry.type}`,
  );
  const targetTexts = (damage.targets ?? []).map(
    (target) => `${target.label} takes ${target.total}`,
  );
  const critPart = damage.critical ? ' (critical: dice doubled)' : '';
  const detail = `${packetTexts.join('; ')}${critPart} → ${typeTexts.join(' + ')} = total ${damage.total}${targetTexts.length > 0 ? `; ${targetTexts.join('; ')}` : ''}`;
  return {
    label: CATEGORY_LABELS.damage,
    reason: damage.reason,
    visibility: 'player_visible',
    category: 'damage',
    detail,
  };
}

const ENTRY_READERS: Record<
  string,
  (data: Record<string, unknown>) => PlayerVisibleRollEntry | undefined
> = {
  roll: readRollEntry,
  resolve_check: readResolveCheckEntry,
  resolve_contest: readResolveContestEntry,
  resolve_damage: readResolveDamageEntry,
};

function stripTrailingModelRollLedger(narration: string): string {
  return narration.replace(/(?:\n{2,}|\n)?Rolls:\s*\n[\s\S]*$/i, '').trimEnd();
}

export function playerVisibleRollEntries(
  calls: readonly ExecutedToolCall[],
): PlayerVisibleRollEntry[] {
  const entries: PlayerVisibleRollEntry[] = [];
  for (const call of calls) {
    const reader = ENTRY_READERS[call.tool];
    if (reader === undefined || !call.result.ok) {
      continue;
    }
    const data = asDataRecord(call.result.data);
    if (data === undefined || !isRollVisibility(data.visibility)) {
      continue;
    }
    const entry = reader(data);
    if (entry !== undefined) {
      entries.push(entry);
    }
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
    (entry) => `- ${entry.label} (${entry.reason}): ${entry.detail}`,
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
