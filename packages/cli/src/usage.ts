import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { diagnosticsDir } from './dataRoot.js';
import {
  ModelUsageStore,
  type TimelineTurn,
  type UsageQueryFilters,
  type UsageSummary,
  type UsageSummaryByDimension,
} from './modelUsageStore.js';

const USAGE_DB = 'usage.db';

export interface UsageDeps {
  readonly dataRoot: string;
  readonly log: (message: string) => void;
}

/**
 * `eshyra usage` — print a summary of model usage recorded in the local
 * diagnostics store (eshyra-cuxm).
 *
 * Filters:
 *   --campaign <id>    restrict to one campaign
 *   --session <id>     restrict to one session
 *   --arc <id>         restrict to one campaign arc
 *   --since <date>     restrict to records on or after YYYY-MM-DD
 */
export function runUsageCommand(argv: string[], deps: UsageDeps): number {
  const parsed = parseArgs(argv);
  if (parsed === null) {
    deps.log(
      'Usage: eshyra usage [--campaign <id>] [--session <id>] [--arc <id>] [--since YYYY-MM-DD] [--timeline]',
    );
    return 1;
  }
  const { filters, timeline } = parsed;

  const dbPath = join(diagnosticsDir(deps.dataRoot), USAGE_DB);
  if (!existsSync(dbPath)) {
    deps.log('No usage data found. Play a session first.');
    return 0;
  }

  const store = new ModelUsageStore(dbPath);
  try {
    if (timeline) {
      deps.log(formatTimeline(store.timeline(filters), dbPath, filters));
      return 0;
    }
    const summary = store.query(filters);
    deps.log(formatSummary(summary, dbPath, filters));
    return 0;
  } finally {
    store.close();
  }
}

interface ParsedArgs {
  readonly filters: UsageQueryFilters;
  readonly timeline: boolean;
}

function parseArgs(argv: string[]): ParsedArgs | null {
  const filters: Record<string, string> = {};
  let timeline = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--timeline' || arg === '--details') {
      timeline = true;
    } else if (
      (arg === '--campaign' ||
        arg === '--session' ||
        arg === '--arc' ||
        arg === '--since') &&
      argv[i + 1]
    ) {
      filters[arg.slice(2)] = argv[i + 1];
      i++;
    } else if (arg.startsWith('--')) {
      return null;
    }
  }
  return {
    filters: {
      ...(filters.campaign !== undefined
        ? { campaignId: filters.campaign }
        : {}),
      ...(filters.session !== undefined ? { sessionId: filters.session } : {}),
      ...(filters.arc !== undefined ? { arcId: filters.arc } : {}),
      ...(filters.since !== undefined ? { since: filters.since } : {}),
    },
    timeline,
  };
}

function formatSummary(
  summary: UsageSummary,
  dbPath: string,
  filters: UsageQueryFilters,
): string {
  const lines: string[] = [];

  lines.push('Eshyra model usage');
  lines.push(`  data: ${dbPath}`);
  if (filters.campaignId !== undefined) {
    lines.push(`  filter: campaign=${filters.campaignId}`);
  }
  if (filters.sessionId !== undefined) {
    lines.push(`  filter: session=${filters.sessionId}`);
  }
  if (filters.arcId !== undefined) {
    lines.push(`  filter: arc=${filters.arcId}`);
  }
  if (filters.since !== undefined) {
    lines.push(`  filter: since=${filters.since}`);
  }

  if (summary.totalCalls === 0) {
    lines.push('');
    lines.push('  No records match the given filters.');
    return lines.join('\n');
  }

  lines.push('');
  lines.push(`  Total calls:   ${summary.totalCalls}`);
  if (summary.failures > 0) {
    lines.push(`  Failures:      ${summary.failures}`);
  }
  if (summary.inputTokens !== null) {
    lines.push(`  Input tokens:  ${fmt(summary.inputTokens)}`);
  }
  if (summary.outputTokens !== null) {
    lines.push(`  Output tokens: ${fmt(summary.outputTokens)}`);
  }
  if (summary.cacheReadTokens !== null && summary.cacheReadTokens > 0) {
    lines.push(`  Cache reads:   ${fmt(summary.cacheReadTokens)}`);
  }
  if (summary.cacheWriteTokens !== null && summary.cacheWriteTokens > 0) {
    lines.push(`  Cache writes:  ${fmt(summary.cacheWriteTokens)}`);
  }
  lines.push(`  Total time:    ${fmtMs(summary.totalElapsedMs)}`);

  if (summary.byPurpose.length > 0) {
    lines.push('');
    lines.push('By purpose:');
    for (const row of summary.byPurpose) {
      lines.push(fmtDimension(row));
    }
  }

  if (summary.byModel.length > 0) {
    lines.push('');
    lines.push('By model:');
    for (const row of summary.byModel) {
      lines.push(fmtDimension(row));
    }
  }

  return lines.join('\n');
}

function fmtDimension(row: UsageSummaryByDimension): string {
  const parts: string[] = [
    `  ${row.label.padEnd(20)} ${String(row.calls).padStart(4)} call${row.calls === 1 ? ' ' : 's'}`,
  ];
  if (row.inputTokens !== null) {
    parts.push(`${fmt(row.inputTokens).padStart(8)} in`);
  }
  if (row.outputTokens !== null) {
    parts.push(`${fmt(row.outputTokens).padStart(8)} out`);
  }
  parts.push(fmtMs(row.elapsedMs));
  if (row.failures > 0) {
    parts.push(`(${row.failures} failed)`);
  }
  return parts.join('  ');
}

/**
 * Render the detailed per-turn timeline (eshyra-17ng). For each turn, model
 * calls are grouped by attempt and tool calls nested under the attempt they ran
 * in, so a slow turn is decomposable into model / audit / retry / tool time.
 */
function formatTimeline(
  turns: readonly TimelineTurn[],
  dbPath: string,
  filters: UsageQueryFilters,
): string {
  const lines: string[] = [];
  lines.push('Eshyra turn timeline');
  lines.push(`  data: ${dbPath}`);
  if (filters.campaignId !== undefined) {
    lines.push(`  filter: campaign=${filters.campaignId}`);
  }
  if (filters.sessionId !== undefined) {
    lines.push(`  filter: session=${filters.sessionId}`);
  }
  if (filters.arcId !== undefined) {
    lines.push(`  filter: arc=${filters.arcId}`);
  }
  if (filters.since !== undefined) {
    lines.push(`  filter: since=${filters.since}`);
  }

  if (turns.length === 0) {
    lines.push('');
    lines.push('  No per-turn timing recorded for the given filters.');
    return lines.join('\n');
  }

  for (const turn of turns) {
    lines.push('');
    const head = [`turn ${turn.turnId}`];
    if (turn.sessionId !== null) {
      head.push(`session ${turn.sessionId}`);
    }
    if (turn.outcome !== null) {
      head.push(`outcome=${turn.outcome}`);
    }
    if (turn.attempts !== null) {
      head.push(`attempts=${turn.attempts}`);
    }
    if (turn.primaryDmRetryCount !== null && turn.primaryDmRetryCount > 0) {
      head.push(`dm_retries=${turn.primaryDmRetryCount}`);
    }
    if (turn.auditorCallCount !== null && turn.auditorCallCount > 0) {
      head.push(`audits=${turn.auditorCallCount}`);
    }
    if (turn.retryCauses.length > 0) {
      head.push(`retry_causes=${turn.retryCauses.join(',')}`);
    }
    if (turn.totalElapsedMs !== null) {
      head.push(`total=${fmtMs(turn.totalElapsedMs)}`);
    }
    lines.push(head.join('  '));

    // One line per model call, with the tools that ran in that exact
    // (attempt, round) nested beneath it. Gameplay rounds carry a round number;
    // the audit call carries none and so nests no tools.
    for (const call of turn.modelCalls) {
      const status = call.success
        ? 'ok'
        : `failed${call.failureKind !== null ? ` ${call.failureKind}` : ''}`;
      const attemptLabel =
        call.attempt !== null ? `attempt ${call.attempt} ` : '';
      lines.push(
        `  ${attemptLabel}${call.purpose} ${call.model}: ${fmtMs(call.elapsedMs)} ${status}`,
      );
      const tools = turn.toolCalls.filter(
        (t) => t.attempt === call.attempt && t.round === call.round,
      );
      for (const tool of tools) {
        const mut = tool.mutates ? 'mutating' : 'read-only';
        const ok = tool.ok ? 'ok' : 'failed';
        lines.push(
          `    tool ${tool.tool}: ${fmtMs(tool.elapsedMs)} ${mut} ${ok}`,
        );
      }
      const audits =
        call.purpose === 'turn_audit'
          ? turn.auditCalls.filter((audit) => audit.attempt === call.attempt)
          : [];
      for (const audit of audits) {
        const parts = [
          `audit ${audit.verdict}`,
          `action=${audit.action}`,
          audit.retryCause === null ? null : `cause=${audit.retryCause}`,
          audit.auditorModel === null ? null : `model=${audit.auditorModel}`,
        ].filter((part): part is string => part !== null);
        lines.push(`    ${parts.join(' ')}`);
      }
    }
  }

  return lines.join('\n');
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtMs(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}
