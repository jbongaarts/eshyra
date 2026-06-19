import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { diagnosticsDir } from './dataRoot.js';
import {
  ModelUsageStore,
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
 *   --since <date>     restrict to records on or after YYYY-MM-DD
 */
export function runUsageCommand(argv: string[], deps: UsageDeps): number {
  const filters = parseFilters(argv);
  if (filters === null) {
    deps.log(
      'Usage: eshyra usage [--campaign <id>] [--session <id>] [--since YYYY-MM-DD]',
    );
    return 1;
  }

  const dbPath = join(diagnosticsDir(deps.dataRoot), USAGE_DB);
  if (!existsSync(dbPath)) {
    deps.log('No usage data found. Play a session first.');
    return 0;
  }

  const store = new ModelUsageStore(dbPath);
  try {
    const summary = store.query(filters);
    deps.log(formatSummary(summary, dbPath, filters));
    return 0;
  } finally {
    store.close();
  }
}

function parseFilters(argv: string[]): UsageQueryFilters | null {
  const filters: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (
      (arg === '--campaign' || arg === '--session' || arg === '--since') &&
      argv[i + 1]
    ) {
      filters[arg.slice(2)] = argv[i + 1];
      i++;
    } else if (arg.startsWith('--')) {
      return null;
    }
  }
  return {
    ...(filters.campaign !== undefined ? { campaignId: filters.campaign } : {}),
    ...(filters.session !== undefined ? { sessionId: filters.session } : {}),
    ...(filters.since !== undefined ? { since: filters.since } : {}),
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

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtMs(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}
