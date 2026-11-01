/**
 * Bounded candidate gates for the SRD audit bundle (eshyra-o9bd.19.6.3.1).
 *
 * Authority: ADR 0020 and section 5.9 / 13.3 / R4 of
 * docs/audits/rules-awareness-transition/2026-07-30-integrated-transition-design.md.
 *
 * Every gate states what it observes, what it does NOT observe, and the
 * bounded denominator it ran over. A gate whose denominator is 0 recognized
 * nothing: it has FAILED TO RUN, it has not passed. Passing every gate
 * authorizes independent audit (eshyra-o9bd.16); it is not a re-freeze and
 * claims no universal clause, mechanic, deterministic, or discovery
 * completeness.
 *
 * Everything here is pure (file existence is injected) so the gate model can
 * be unit-tested without running the bundle.
 */

import {
  aliasIndex,
  type FindingRow,
  validateFindingRegistry,
} from '../../src/internal.js';
import { VERIFIED_PACK_ARTIFACTS } from '../verify-dnd5e-srd-pack/verifiedArtifacts.js';

export type GateResult = 'pass' | 'fail' | 'failed-to-run';

export interface CandidateGate {
  id: string;
  observes: string;
  doesNotObserve: string[];
  denominator: { description: string; count: number };
  result: GateResult;
  details: string[];
}

export const CANDIDATE_RECORD_PATH =
  'docs/audits/dnd5e-srd-5.1-final/2026-11-01-o9bd-19-6-1-candidate-pack.md';

export const EXPLICIT_NON_CLAIMS: readonly string[] = [
  'No universal clause completeness: no gate claims every source clause is represented or typed.',
  'No universal mechanic completeness: no gate claims every mechanic in the source is implemented or bound.',
  'No deterministic completeness: the absence of a capability binding is not a result, and the unselected magic-item backlog is not covered.',
  'No discovery completeness: nothing here claims the DM can reach every relevant record (see eshyra-o9bd.19.3.5 below).',
  'Passing every gate authorizes independent audit (eshyra-o9bd.16). It is not a re-freeze and is not proof that no defect remains.',
];

/**
 * Builds a gate. Result is derived, never asserted: a zero denominator is
 * 'failed-to-run' (a gate that recognized nothing has not passed), any failure
 * is 'fail', and only a non-empty denominator with no failures is 'pass'.
 * `forceFailedToRun` is for an input the gate could not obtain at all.
 */
export function buildGate(spec: {
  id: string;
  observes: string;
  doesNotObserve: string[];
  denominator: { description: string; count: number };
  failures: string[];
  details?: string[];
  forceFailedToRun?: string;
}): CandidateGate {
  let result: GateResult;
  const details = [...(spec.details ?? [])];
  if (spec.forceFailedToRun !== undefined) {
    result = 'failed-to-run';
    details.push(`FAILED TO RUN: ${spec.forceFailedToRun}`);
  } else if (spec.denominator.count === 0) {
    result = 'failed-to-run';
    details.push(
      'FAILED TO RUN: the denominator is 0, so the gate recognized nothing.',
    );
  } else if (spec.failures.length > 0) {
    result = 'fail';
  } else {
    result = 'pass';
  }
  for (const failure of spec.failures) details.push(`FAIL: ${failure}`);
  return {
    id: spec.id,
    observes: spec.observes,
    doesNotObserve: spec.doesNotObserve,
    denominator: spec.denominator,
    result,
    details,
  };
}

/** The bundle passes only when there is at least one gate and all pass. */
export function overallGateResult(
  gates: readonly CandidateGate[],
): 'pass' | 'fail' {
  return gates.length > 0 && gates.every((g) => g.result === 'pass')
    ? 'pass'
    : 'fail';
}

// ---------------------------------------------------------------------------
// G-repro
// ---------------------------------------------------------------------------

export function gateRepro(input: {
  verifyExitCode: number | undefined;
  artifacts: readonly string[];
}): CandidateGate {
  const failures: string[] = [];
  if (input.verifyExitCode !== undefined && input.verifyExitCode !== 0) {
    failures.push(
      `verify:dnd5e-srd-pack exited ${input.verifyExitCode} (1 = drift against importer output, 2 = could not verify).`,
    );
  }
  return buildGate({
    id: 'G-repro',
    observes:
      'The captured verify:dnd5e-srd-pack exit code is 0: the importer, run on the vendored PDF, reproduces the committed pack artifacts exactly.',
    doesNotObserve: [
      'Whether the importer output is correct against the source; it observes reproducibility only.',
      'Any artifact the verifier does not compare.',
    ],
    denominator: {
      description:
        'Pack artifacts the verifier compares (read from verify-dnd5e-srd-pack/verifiedArtifacts.ts, which the verifier itself iterates)',
      count: input.artifacts.length,
    },
    failures,
    details: [
      `exit code: ${input.verifyExitCode ?? '(command not run)'}`,
      `artifacts: ${input.artifacts.join(', ')}`,
    ],
    ...(input.verifyExitCode === undefined
      ? { forceFailedToRun: 'verify:dnd5e-srd-pack was not captured.' }
      : {}),
  });
}

// ---------------------------------------------------------------------------
// G-source-hash
// ---------------------------------------------------------------------------

export function gateSourceHash(input: {
  pdfSha256: string;
  sourceManifestSha256: string | undefined;
  packManifestSha256: string | undefined;
}): CandidateGate {
  const failures: string[] = [];
  const recorded: Array<[string, string | undefined]> = [
    ['sources/dnd5e-srd-5.1/manifest.json', input.sourceManifestSha256],
    ['pack manifest source.sourceHash', input.packManifestSha256],
  ];
  let count = 0;
  for (const [label, hash] of recorded) {
    if (hash === undefined || hash === '') {
      failures.push(`${label} records no source hash.`);
      continue;
    }
    count += 1;
    if (hash !== input.pdfSha256) {
      failures.push(
        `${label} records ${hash}; the vendored PDF hashes to ${input.pdfSha256}.`,
      );
    }
  }
  return buildGate({
    id: 'G-source-hash',
    observes:
      'The vendored SRD PDF sha256 equals the hash recorded in the source manifest and in the pack manifest.',
    doesNotObserve: [
      'That the vendored PDF is the authentic upstream SRD; it observes internal agreement of the recorded hashes only.',
      'Page-level or content-level fidelity of the extracted text.',
    ],
    denominator: {
      description: 'Recorded source hashes present and compared to the PDF',
      count,
    },
    failures,
    details: [`vendored PDF sha256: ${input.pdfSha256}`],
  });
}

// ---------------------------------------------------------------------------
// G-suite
// ---------------------------------------------------------------------------

export function gateSuite(input: {
  exitCodes: Readonly<Record<string, number | undefined>>;
}): CandidateGate {
  const failures: string[] = [];
  const details: string[] = [];
  let count = 0;
  for (const name of ['check', 'typecheck', 'test']) {
    const code = input.exitCodes[name];
    details.push(`npm run ${name}: exit ${code ?? '(not captured)'}`);
    if (code === undefined) {
      failures.push(`npm run ${name} was not captured.`);
      continue;
    }
    count += 1;
    if (code !== 0) failures.push(`npm run ${name} exited ${code}.`);
  }
  return buildGate({
    id: 'G-suite',
    observes:
      'The captured check, typecheck and test commands each exited 0 at the candidate commit.',
    doesNotObserve: [
      'Skipped tests: the documented live-API and Dolt-gated skips exit 0 and are not enumerated here.',
      'Whether any test discriminates a given defect.',
    ],
    denominator: {
      description: 'Captured suite commands (check, typecheck, test)',
      count,
    },
    failures,
    details,
  });
}

// ---------------------------------------------------------------------------
// Test-inclusion helpers (G-finding-evidence, G-capabilities, G-replay)
// ---------------------------------------------------------------------------

const TEST_FILE_RE = /\.test\.[cm]?[jt]sx?$/;

export function isTestFilePath(path: string): boolean {
  return TEST_FILE_RE.test(path);
}

/**
 * Parses Vitest's JSON reporter output from the SAME run that G-suite judges
 * into the EXECUTED-EVIDENCE set: repo-relative test files with at least one
 * assertion whose status is 'passed' and none that is 'failed'. A file that was
 * discovered but wholly skipped, filtered or todo is not in the set. Returns
 * null when the text does not parse or holds no test results, so every
 * dependent gate is failed-to-run rather than guessing.
 */
export function parseVitestResults(
  text: string,
  repoRoot: string,
): Set<string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const results = (parsed as { testResults?: unknown } | null)?.testResults;
  if (!Array.isArray(results) || results.length === 0) return null;
  const root = `${repoRoot.replaceAll('\\', '/').replace(/\/+$/, '')}/`;
  const out = new Set<string>();
  for (const result of results) {
    const r = result as { name?: unknown; assertionResults?: unknown } | null;
    if (typeof r?.name !== 'string' || !Array.isArray(r.assertionResults))
      return null;
    const statuses = r.assertionResults.map(
      (a) => (a as { status?: unknown } | null)?.status,
    );
    if (statuses.includes('failed') || !statuses.includes('passed')) continue;
    const norm = r.name.replaceAll('\\', '/');
    out.add(norm.startsWith(root) ? norm.slice(root.length) : norm);
  }
  return out;
}

export interface PathCheckContext {
  exists: (repoRelativePath: string) => boolean;
  /** Git-tracked repo-relative paths (git ls-files); citation resolution domain. */
  trackedFiles: readonly string[];
  /**
   * Test files executed in the captured G-suite run (see
   * {@link parseVitestResults}), or null when the results were unavailable.
   */
  executed: ReadonlySet<string> | null;
}

const MEMBERSHIP_UNAVAILABLE =
  'The captured suite run produced no parseable, non-empty Vitest JSON results (reports/vitest-results.json), so execution of evidence tests cannot be established.';

const PARTIAL_SKIP_NON_CLAIM =
  'A partially skipped file is credited at file granularity: an individual skipped assertion inside an executed file is not detected.';

function checkPath(
  path: string,
  ctx: PathCheckContext,
  label: string,
  failures: string[],
): void {
  if (!ctx.exists(path)) {
    failures.push(`${label}: ${path} does not exist.`);
    return;
  }
  if (isTestFilePath(path) && !ctx.executed?.has(path)) {
    failures.push(
      `${label}: ${path} was not executed in the captured suite run.`,
    );
  }
}

// ---------------------------------------------------------------------------
// G-registry (re-freeze bar #5)
// ---------------------------------------------------------------------------

export function gateRegistry(input: { registry: unknown }): CandidateGate {
  const failures: string[] = [];
  const details: string[] = [];
  const rawRows =
    typeof input.registry === 'object' &&
    input.registry !== null &&
    Array.isArray((input.registry as { rows?: unknown }).rows)
      ? ((input.registry as { rows: unknown[] }).rows as unknown[])
      : [];
  let rowCount = rawRows.length;
  try {
    // validateFindingRegistry is the contract: every row has a valid status,
    // every non-accepted row has statusReasoning, aliases are unique and the
    // canonical id/alias sets are exactly the roster.
    const registry = validateFindingRegistry(input.registry);
    rowCount = registry.rows.length;
    const index = aliasIndex(registry);
    for (const row of registry.rows) {
      for (const alias of row.aliases) {
        if (index.get(alias)?.canonicalId !== row.canonicalId) {
          failures.push(
            `alias ${alias} does not resolve to ${row.canonicalId}.`,
          );
        }
      }
    }
    const byStatus: Record<string, number> = {};
    for (const row of registry.rows) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    }
    details.push(
      `rows by status: ${Object.entries(byStatus)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')}`,
    );
  } catch (cause) {
    failures.push(`registry contract violated: ${(cause as Error).message}`);
  }
  return buildGate({
    id: 'G-registry',
    observes:
      'Re-freeze bar #5: the finding registry loads through the findingRegistry contract; every row has a valid status, every non-accepted row has statusReasoning, and every alias resolves to its row.',
    doesNotObserve: [
      'Whether the pack currently violates any registry row (registry non-claim): a dispositioned row is not evidence the pack satisfies it.',
      'Live bead state: owningBead values are checked for shape only, not for open/closed status.',
    ],
    denominator: { description: 'Finding-registry rows', count: rowCount },
    failures,
    details,
  });
}

// ---------------------------------------------------------------------------
// G-finding-evidence (AC3)
// ---------------------------------------------------------------------------

const BARE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'mts',
  'cts',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'json',
  'jsonl',
  'md',
  'txt',
  'pdf',
  'yml',
  'yaml',
  'map',
  'csv',
  'html',
  'sh',
  'sql',
  'toml',
]);

const PACK_DIR = 'packages/core/data/rules-packs/rules__dnd5e-srd-5.1';
const ROOT_ANCHORS = [
  'packages/',
  'docs/',
  'scripts/',
  '.github/',
  'sources/',
  'reports/',
];

/**
 * Every file-shaped token, matched whole and greedily (so x.test.ts.map is one
 * token). A token is either (i) any token containing '/' whose final segment
 * has an extension, or (ii) a bare token ending in a known extension. Trailing
 * sentence punctuation is trimmed; brackets and quotes are not token chars.
 */
export function extractFileTokens(reasoning: string): string[] {
  const out = new Set<string>();
  for (const m of reasoning.matchAll(/[\w@./-]+/g)) {
    const token = m[0].replace(/[.-]+$/, '');
    const last = token.split('/').pop() ?? '';
    const ext = /\.([A-Za-z0-9]+)$/.exec(last)?.[1];
    if (ext === undefined || last.length === ext.length + 1) continue;
    if (token.includes('/') || BARE_EXTENSIONS.has(ext.toLowerCase()))
      out.add(token);
  }
  return [...out];
}

export type CitationResolution =
  | { token: string; status: 'resolved'; path: string }
  | { token: string; status: 'unresolved' | 'ambiguous'; reason: string };

/**
 * Resolves one file-shaped token against the tracked files. Anchoring is
 * terminal: a root-anchored token (packages/, docs/, scripts/, .github/,
 * sources/, reports/) resolves only to that exact path, and a test/... token
 * only to packages/core/test/...; a miss fails with no fallback. Only
 * otherwise unanchored tokens use (d) a committed pack-artifact basename (the
 * verifier list, plus manifest.json when the reasoning says pack or records)
 * under the pack directory, or (c) the unique tracked file ending /<token>.
 * Zero or several matches fail.
 */
export function resolveCitation(
  token: string,
  trackedFiles: readonly string[],
  reasoning: string,
): CitationResolution {
  const tracked = new Set(trackedFiles);
  if (ROOT_ANCHORS.some((a) => token.startsWith(a))) {
    return tracked.has(token)
      ? { token, status: 'resolved', path: token }
      : {
          token,
          status: 'unresolved',
          reason: 'root-anchored path is not tracked (no fallback).',
        };
  }
  if (token.startsWith('test/')) {
    const p = `packages/core/${token}`;
    return tracked.has(p)
      ? { token, status: 'resolved', path: p }
      : {
          token,
          status: 'unresolved',
          reason: `${p} is not tracked (test/ is anchored to packages/core; no fallback).`,
        };
  }
  if (tracked.has(token)) return { token, status: 'resolved', path: token };
  const packArtifact =
    VERIFIED_PACK_ARTIFACTS.includes(token) ||
    (token === 'manifest.json' && /\b(pack|records)\b/i.test(reasoning));
  if (packArtifact) {
    const p = `${PACK_DIR}/${token}`;
    if (tracked.has(p)) return { token, status: 'resolved', path: p };
    return {
      token,
      status: 'unresolved',
      reason: `pack artifact ${p} is not tracked.`,
    };
  }
  const matches = trackedFiles.filter((f) => f.endsWith(`/${token}`));
  if (matches.length === 1 && matches[0] !== undefined)
    return { token, status: 'resolved', path: matches[0] };
  if (matches.length === 0)
    return { token, status: 'unresolved', reason: 'matches no tracked file.' };
  return {
    token,
    status: 'ambiguous',
    reason: `matches ${matches.length} tracked files: ${matches.join(', ')}.`,
  };
}

export function gateFindingEvidence(input: {
  rows: ReadonlyArray<{ canonicalId: string; statusReasoning?: string }>;
  ctx: PathCheckContext;
}): CandidateGate {
  const failures: string[] = [];
  const details: string[] = [];
  const resolved = new Map<string, string[]>();
  const unresolved = new Map<string, string[]>();
  const noPointer: string[] = [];
  for (const row of input.rows) {
    const reasoning = row.statusReasoning ?? '';
    const tokens = extractFileTokens(reasoning);
    if (tokens.length === 0) noPointer.push(row.canonicalId);
    for (const token of tokens) {
      const r = resolveCitation(token, input.ctx.trackedFiles, reasoning);
      if (r.status === 'resolved') {
        resolved.set(r.path, [
          ...(resolved.get(r.path) ?? []),
          row.canonicalId,
        ]);
      } else {
        const key = `${token} (${r.status}: ${r.reason})`;
        unresolved.set(key, [...(unresolved.get(key) ?? []), row.canonicalId]);
      }
    }
  }
  for (const [key, rowIds] of unresolved) {
    failures.push(`cited by ${rowIds.join(', ')}: ${key}`);
  }
  for (const [path, rowIds] of resolved) {
    checkPath(path, input.ctx, `cited by ${rowIds.join(', ')}`, failures);
  }
  for (const id of noPointer) {
    details.push(`${id}: no committed evidence pointer`);
  }
  details.push(
    `${noPointer.length} of ${input.rows.length} rows cite no file-shaped token (not a failure).`,
    `resolved citations: ${[...resolved.keys()].join(', ') || '(none)'}`,
    `unresolved citations: ${[...unresolved.keys()].join(', ') || '(none)'}`,
  );
  return buildGate({
    id: 'G-finding-evidence',
    observes:
      'AC3: every file-shaped token (path or basename with a file extension) in a registry statusReasoning resolves deterministically against git ls-files (root-anchored path as is; test/... under packages/core; a pack-artifact basename from the verifier list, plus manifest.json when the reasoning says pack or records, under the committed pack directory as the explicit rule for ambiguous pack-artifact basenames; otherwise the unique tracked file ending /<token>); unresolved or ambiguous tokens fail; every resolved test file was executed (at least one passed assertion, none failed) in the captured G-suite run, read from its Vitest JSON results; a wholly skipped, filtered or absent file fails.',
    doesNotObserve: [
      'Whether each pointer discriminates the defect (eshyra-o9bd.19.1.8 owns that).',
      'Rows whose reasoning has no file-shaped token; they are listed as "no committed evidence pointer" and are not failures.',
      PARTIAL_SKIP_NON_CLAIM,
    ],
    denominator: {
      description:
        'Distinct resolved citations plus unresolved or ambiguous citations',
      count: resolved.size + unresolved.size,
    },
    failures,
    details,
    ...(input.ctx.executed === null
      ? { forceFailedToRun: MEMBERSHIP_UNAVAILABLE }
      : {}),
  });
}

// ---------------------------------------------------------------------------
// G-capabilities (AC4) and G-replay
// ---------------------------------------------------------------------------

export interface CapabilityLike {
  revision: string;
  operation: string;
  requiredInputs: readonly string[];
  exclusions: readonly string[];
  residualDmInterpretation: readonly string[];
  runtimeOwner: readonly string[];
  evidence: readonly string[];
}

export function gateCapabilities(input: {
  inventory: readonly CapabilityLike[];
  contracts: readonly CapabilityLike[];
  ctx: PathCheckContext;
}): CandidateGate {
  const failures: string[] = [];
  const groups: Array<[string, readonly CapabilityLike[]]> = [
    ['DETERMINISTIC_CAPABILITY_INVENTORY', input.inventory],
    ['RULE_DETERMINISTIC_CAPABILITY_CONTRACTS', input.contracts],
  ];
  for (const [group, entries] of groups) {
    for (const entry of entries) {
      const label = `${group}/${entry.revision}`;
      if (entry.runtimeOwner.length === 0)
        failures.push(`${label}: no runtimeOwner.`);
      if (entry.evidence.length === 0) failures.push(`${label}: no evidence.`);
      for (const p of entry.runtimeOwner) {
        if (!input.ctx.exists(p))
          failures.push(`${label}: runtimeOwner ${p} does not exist.`);
      }
      for (const p of entry.evidence) {
        checkPath(p, input.ctx, `${label} evidence`, failures);
      }
    }
  }
  return buildGate({
    id: 'G-capabilities',
    observes:
      'AC4: every deterministic-capability inventory entry and every rule-bound capability contract names at least one runtimeOwner and one evidence path, all of which exist, and every evidence test file is executed in the captured G-suite run (read from its Vitest JSON results).',
    doesNotObserve: [
      'Completeness: the absence of a binding is not a completeness result.',
      'The unselected magic-item backlog; it is not covered.',
      'Semantic correctness of each capability beyond its tests passing in G-suite.',
      PARTIAL_SKIP_NON_CLAIM,
    ],
    denominator: {
      description:
        'Inventory entries plus rule-bound contract entries (a ledger-quoted contract is counted in both)',
      count: input.inventory.length + input.contracts.length,
    },
    failures,
    details: [
      `inventory entries: ${input.inventory.length}; contract entries: ${input.contracts.length}`,
    ],
    ...(input.ctx.executed === null
      ? { forceFailedToRun: MEMBERSHIP_UNAVAILABLE }
      : {}),
  });
}

const SEED_RE = /\bseed(?:ed)?\b/i;

/** Inventory entries whose contract or operation text declares seeded dice. */
export function seededEntries(
  inventory: readonly CapabilityLike[],
): CapabilityLike[] {
  return inventory.filter((e) =>
    SEED_RE.test(
      [
        e.operation,
        ...e.requiredInputs,
        ...e.exclusions,
        ...e.residualDmInterpretation,
      ].join('\n'),
    ),
  );
}

export function gateReplay(input: {
  inventory: readonly CapabilityLike[];
  ctx: PathCheckContext;
}): CandidateGate {
  const matched = seededEntries(input.inventory);
  const failures: string[] = [];
  const details: string[] = [
    'Pack replay is G-repro.',
    `matched entries: ${matched.map((e) => e.revision).join(', ') || '(none)'}`,
  ];
  for (const entry of matched) {
    const tests = entry.evidence.filter(isTestFilePath);
    if (tests.length === 0) {
      failures.push(`${entry.revision}: cites no evidence test.`);
      continue;
    }
    for (const p of tests) {
      checkPath(p, input.ctx, `${entry.revision} evidence`, failures);
    }
  }
  return buildGate({
    id: 'G-replay',
    observes:
      'Replay/deterministic equivalence for capabilities: every inventory entry whose operation, input, exclusion or residual text declares seeded dice cites at least one existing evidence test executed in the captured G-suite run. Pack replay is observed by G-repro, not here.',
    doesNotObserve: [
      'That the cited tests assert same-seed-same-result equivalence; only that a test is cited and runs in G-suite.',
      'Capabilities that are deterministic but do not mention a seed in their contract text.',
      PARTIAL_SKIP_NON_CLAIM,
    ],
    denominator: {
      description:
        'Inventory entries whose contract or operation text matches /\\bseed(ed)?\\b/i',
      count: matched.length,
    },
    failures,
    details,
    ...(input.ctx.executed === null
      ? { forceFailedToRun: MEMBERSHIP_UNAVAILABLE }
      : {}),
  });
}

// ---------------------------------------------------------------------------
// G-candidate-record
// ---------------------------------------------------------------------------

export function gateCandidateRecord(input: {
  exists: (repoRelativePath: string) => boolean;
}): CandidateGate {
  const present = input.exists(CANDIDATE_RECORD_PATH);
  return buildGate({
    id: 'G-candidate-record',
    observes: `The candidate-pack record ${CANDIDATE_RECORD_PATH}, which the README points to for unresolved limits, exists at bundle time.`,
    doesNotObserve: [
      'The content of the record, or that its disclosures are complete.',
    ],
    denominator: { description: 'Required candidate record files', count: 1 },
    failures: present ? [] : [`${CANDIDATE_RECORD_PATH} is absent.`],
  });
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

export function formatGatesText(gates: readonly CandidateGate[]): string {
  const lines: string[] = [
    `Overall: ${overallGateResult(gates).toUpperCase()}`,
    'A gate with denominator 0 has FAILED TO RUN; it has not passed.',
    '',
  ];
  for (const g of gates) {
    lines.push(
      `== ${g.id}: ${g.result.toUpperCase()}`,
      `Observes: ${g.observes}`,
      `Denominator: ${g.denominator.count} (${g.denominator.description})`,
      'Does not observe:',
      ...g.doesNotObserve.map((d) => `  - ${d}`),
      'Details:',
      ...g.details.map((d) => `  - ${d}`),
      '',
    );
  }
  return lines.join('\n');
}

export function formatGateSummaryTable(
  gates: readonly CandidateGate[],
): string[] {
  return [
    '| Gate | Result | Denominator |',
    '| --- | --- | --- |',
    ...gates.map(
      (g) =>
        `| ${g.id} | ${g.result} | ${g.denominator.count} (${g.denominator.description.replaceAll('|', '/')}) |`,
    ),
  ];
}

export type { FindingRow };
