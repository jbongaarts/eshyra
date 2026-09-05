/**
 * `eshyra rules` — explicit campaign ruling and house-rule management.
 *
 * This is deliberately a prose-only workflow. The core owns identity,
 * chronology, validation, and lifecycle transitions; the CLI only collects
 * player input, resolves the campaign database, and renders the durable
 * record. No model is involved in any command here.
 */

import type { Db } from '@eshyra/core';
import {
  assembleCampaignRulesContext,
  type CampaignPosition,
  type CampaignRule,
  CampaignRuleError,
  type CampaignRuleKind,
  type CampaignRuleProvenance,
  createCampaignRule,
  formatCampaignPosition,
  getCampaign,
  getCampaignRule,
  getCurrentCampaignPosition,
  listActiveCampaignRulesAtPosition,
  listCampaignRules,
  lookupCampaignAmbiguity,
  openDatabase,
  parseCampaignPosition,
  recordAmbiguityRuling,
  resolveStrictCampaignRulesStack,
  revokeCampaignRule,
  supersedeCampaignRule,
} from '@eshyra/core';
import { resolveCampaignDbPath } from './campaigns.js';

const FUTURE_POSITION_ANCHOR = '__future__';
const BOOTSTRAP_POSITION: CampaignPosition = {
  sessionId: 'cli',
  turnId: 'bootstrap',
  ordinal: 0,
};

/** Host seam for the rules commands. */
export interface RulesDeps {
  /** The resolved per-user data root (for registry campaign lookup). */
  root: string;
  /** Environment map — read for the `ESHYRA_DB_PATH` explicit override. */
  env: Record<string, string | undefined>;
  /** Output sink. */
  log: (message: string) => void;
  /** Open a campaign database at a path. Injectable for tests. */
  openDb?: (path: string) => Db;
}

interface ParsedArgs {
  readonly flags: ReadonlyMap<string, string>;
  readonly booleans: ReadonlySet<string>;
  readonly positional: readonly string[];
}

const USAGE =
  'usage: eshyra rules <list|show|history|add|supersede|revoke|ambiguities|resolve> [flags] [campaign-id]';

function parseArgs(
  args: readonly string[],
  valueNames: readonly string[],
  booleanNames: readonly string[] = [],
): ParsedArgs {
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  const valueSet = new Set(valueNames);
  const booleanSet = new Set(booleanNames);
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (booleanSet.has(name)) {
      booleans.add(name);
      continue;
    }
    if (!valueSet.has(name)) {
      throw new CampaignRuleError(`unknown flag --${name}`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new CampaignRuleError(`--${name} requires a value`);
    }
    values.set(name, value);
    index += 1;
  }
  return { flags: values, booleans, positional };
}

function flag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags.get(name)?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function requiredFlag(parsed: ParsedArgs, name: string): string {
  const value = flag(parsed, name);
  if (value === undefined) throw new CampaignRuleError(`--${name} is required`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveDb(
  deps: RulesDeps,
  campaignId: string | undefined,
): { ok: true; dbPath: string } | { ok: false } {
  const resolved = resolveCampaignDbPath(deps.root, {
    explicitDbPath: deps.env.ESHYRA_DB_PATH?.trim() || undefined,
    campaignId,
  });
  if (!resolved.ok) {
    deps.log(resolved.message);
    return { ok: false };
  }
  return { ok: true, dbPath: resolved.dbPath };
}

function withCampaign(
  deps: RulesDeps,
  campaignId: string | undefined,
  run: (db: Db, campaignId: string, current: CampaignPosition) => void,
): boolean {
  const resolved = resolveDb(deps, campaignId);
  if (!resolved.ok) return false;
  const open = deps.openDb ?? openDatabase;
  let db: Db | undefined;
  try {
    db = open(resolved.dbPath);
    const campaign = getCampaign(db);
    if (campaign === undefined) {
      deps.log('that database has no campaign');
      return false;
    }
    const current =
      getCurrentCampaignPosition(db, campaign.campaignId) ?? BOOTSTRAP_POSITION;
    run(db, campaign.campaignId, current);
    return true;
  } catch (error) {
    deps.log(errorMessage(error));
    return false;
  } finally {
    db?.close();
  }
}

function parsePosition(
  value: string,
  current: CampaignPosition,
): CampaignPosition {
  if (/^\d+$/.test(value)) {
    const ordinal = Number(value);
    if (!Number.isSafeInteger(ordinal)) {
      throw new CampaignRuleError(`invalid campaign position ordinal ${value}`);
    }
    return {
      sessionId: FUTURE_POSITION_ANCHOR,
      turnId: FUTURE_POSITION_ANCHOR,
      ordinal,
    };
  }
  // `current` is part of the signature to make this helper's use explicit at
  // every command boundary; formatted positions carry their own anchor.
  void current;
  return parseCampaignPosition(value);
}

function effectivePosition(
  parsed: ParsedArgs,
  current: CampaignPosition,
): CampaignPosition {
  const explicit = flag(parsed, 'effective');
  return explicit === undefined
    ? { ...current, ordinal: current.ordinal + 1 }
    : parsePosition(explicit, current);
}

function recordsFromFlag(value: string): string[] {
  const records = value
    .split(',')
    .map((record) => record.trim())
    .filter((record) => record.length > 0);
  if (records.length === 0)
    throw new CampaignRuleError('--records must contain at least one key');
  return records;
}

/** Deterministic default identity: `<kind>:<slug of first 5 prose words>:<effective ordinal>`. */
function slugIdentity(
  kind: CampaignRuleKind,
  prose: string,
  effective: CampaignPosition,
): string {
  const words = prose.trim().split(/\s+/).slice(0, 5);
  const slug = words
    .map((word) => word.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
    .map((word) => word.replace(/^-+|-+$/g, ''))
    .filter((word) => word.length > 0)
    .join('-');
  return `${kind}:${slug || 'campaign-rule'}:${effective.ordinal}`;
}

function provenanceLabel(provenance: CampaignRuleProvenance): string {
  switch (provenance.kind) {
    case 'ambiguity':
      return `ambiguity ${provenance.ambiguityId}, interpretation ${provenance.selectedInterpretationId}`;
    case 'recurring-question':
      return `recurring question ${provenance.questionId}`;
    case 'house-rule':
      return provenance.rationale === undefined
        ? 'house-rule'
        : `house-rule (${provenance.rationale})`;
  }
}

function validateAmbiguity(
  db: Db,
  campaignId: string,
  current: CampaignPosition,
  ambiguityId: string,
  interpretationId: string,
): Extract<CampaignRuleProvenance, { kind: 'ambiguity' }> {
  const context = assembleCampaignRulesContext(
    db,
    campaignId,
    formatCampaignPosition(current),
    resolveStrictCampaignRulesStack(db),
  );
  const candidate = context.ambiguities.find(
    ({ ambiguity }) => ambiguity.id === ambiguityId,
  );
  if (candidate === undefined) {
    const known = context.ambiguities
      .map(({ ambiguity }) => ambiguity.id)
      .join(', ');
    throw new CampaignRuleError(
      `unknown ambiguity ${ambiguityId}; known ambiguity ids: ${known || '(none)'}`,
    );
  }
  if (
    !candidate.ambiguity.interpretations.some(
      ({ id }) => id === interpretationId,
    )
  ) {
    const known = candidate.ambiguity.interpretations
      .map(({ id }) => id)
      .join(', ');
    throw new CampaignRuleError(
      `interpretation ${interpretationId} is not enumerated by ${ambiguityId}; known interpretation ids: ${known}`,
    );
  }
  return {
    kind: 'ambiguity',
    ambiguityId,
    selectedInterpretationId: interpretationId,
  };
}

function provenanceForAdd(
  parsed: ParsedArgs,
  db: Db,
  campaignId: string,
  current: CampaignPosition,
  kind: CampaignRule['ruleKind'],
): CampaignRuleProvenance {
  const rationale = flag(parsed, 'rationale');
  const ambiguityId = flag(parsed, 'ambiguity');
  const interpretationId = flag(parsed, 'interpretation');
  const questionId = flag(parsed, 'question');
  if (kind === 'house-rule') {
    if (
      ambiguityId !== undefined ||
      interpretationId !== undefined ||
      questionId !== undefined
    ) {
      throw new CampaignRuleError(
        'house-rule provenance requires --rationale only',
      );
    }
    return {
      kind: 'house-rule',
      ...(rationale === undefined ? {} : { rationale }),
    };
  }
  if (rationale !== undefined) {
    throw new CampaignRuleError(
      'ruling provenance requires --ambiguity/--interpretation or --question',
    );
  }
  if (questionId !== undefined) {
    if (ambiguityId !== undefined || interpretationId !== undefined) {
      throw new CampaignRuleError(
        'choose either ambiguity provenance or --question',
      );
    }
    return { kind: 'recurring-question', questionId };
  }
  if (ambiguityId === undefined || interpretationId === undefined) {
    throw new CampaignRuleError(
      'ruling requires --ambiguity and --interpretation, or --question',
    );
  }
  return validateAmbiguity(
    db,
    campaignId,
    current,
    ambiguityId,
    interpretationId,
  );
}

function provenanceForSuccessor(
  parsed: ParsedArgs,
  db: Db,
  campaignId: string,
  current: CampaignPosition,
  prior: CampaignRule,
): CampaignRuleProvenance {
  const hasOverride =
    flag(parsed, 'rationale') !== undefined ||
    flag(parsed, 'ambiguity') !== undefined ||
    flag(parsed, 'interpretation') !== undefined ||
    flag(parsed, 'question') !== undefined;
  if (!hasOverride) return prior.provenance;
  return provenanceForAdd(parsed, db, campaignId, current, prior.ruleKind);
}

function formatNullablePosition(position: CampaignPosition | null): string {
  return position === null ? 'none' : formatCampaignPosition(position);
}

function commandPositionals(
  parsed: ParsedArgs,
  identityRequired: boolean,
): { identity: string | undefined; campaignId: string | undefined } {
  const namedIdentity = flag(parsed, 'identity');
  const [first, second, ...extra] = parsed.positional;
  if (
    extra.length > 0 ||
    (namedIdentity !== undefined && second !== undefined)
  ) {
    throw new CampaignRuleError(USAGE);
  }
  if (identityRequired && namedIdentity === undefined && first === undefined) {
    throw new CampaignRuleError(USAGE);
  }
  return {
    identity: namedIdentity ?? (identityRequired ? first : undefined),
    campaignId:
      namedIdentity === undefined && identityRequired ? second : first,
  };
}

function listCommand(args: readonly string[], deps: RulesDeps): number {
  try {
    const parsed = parseArgs(args, ['at'], ['all']);
    if (parsed.booleans.has('all') && flag(parsed, 'at') !== undefined) {
      deps.log('--all and --at cannot be used together');
      return 1;
    }
    const { campaignId } = commandPositionals(parsed, false);
    const result = withCampaign(deps, campaignId, (db, id, current) => {
      const at =
        flag(parsed, 'at') === undefined
          ? current
          : parsePosition(flag(parsed, 'at') as string, current);
      const rules = parsed.booleans.has('all')
        ? listCampaignRules(db, { campaignId: id })
        : listActiveCampaignRulesAtPosition(db, id, formatCampaignPosition(at));
      deps.log(
        `Campaign rules for ${id} at ${formatCampaignPosition(at)} (${rules.length}):`,
      );
      for (const rule of rules) {
        deps.log(
          `  ${rule.ruleIdentity}  [${rule.ruleKind}/${rule.status}]  effective ${rule.effectivePosition.ordinal}  ${provenanceLabel(rule.provenance)}  — ${rule.prose.slice(0, 80)}`,
        );
      }
    });
    return result ? 0 : 1;
  } catch (error) {
    deps.log(errorMessage(error));
    return 1;
  }
}

function ambiguitiesCommand(args: readonly string[], deps: RulesDeps): number {
  try {
    const parsed = parseArgs(args, []);
    const [campaignId, ...extra] = parsed.positional;
    if (extra.length > 0) throw new CampaignRuleError(USAGE);
    const result = withCampaign(deps, campaignId, (db, id, current) => {
      const context = assembleCampaignRulesContext(
        db,
        id,
        formatCampaignPosition(current),
        resolveStrictCampaignRulesStack(db),
      );
      for (const item of context.ambiguities) {
        const resolution = lookupCampaignAmbiguity(db, {
          campaignId: id,
          ambiguityId: item.ambiguity.id,
          position: current,
        });
        const status =
          resolution.status === 'resolved'
            ? `resolved:${resolution.ruling?.selectedInterpretationId ?? '(unknown)'}`
            : resolution.status;
        deps.log(
          `${item.ambiguity.id}  status: ${status}  interpretations: ${item.ambiguity.interpretations.map(({ id: interpretationId }) => interpretationId).join(', ')}`,
        );
      }
    });
    return result ? 0 : 1;
  } catch (error) {
    deps.log(errorMessage(error));
    return 1;
  }
}

function resolveCommand(args: readonly string[], deps: RulesDeps): number {
  try {
    const parsed = parseArgs(args, ['interpretation', 'prose', 'effective']);
    const [ambiguityId, campaignId, ...extra] = parsed.positional;
    if (ambiguityId === undefined || extra.length > 0)
      throw new CampaignRuleError(USAGE);
    const result = withCampaign(deps, campaignId, (db, id, current) => {
      const interpretationId = requiredFlag(parsed, 'interpretation');
      const effective = flag(parsed, 'effective');
      let effectiveOrdinal: number | undefined;
      if (effective !== undefined) {
        if (!/^\d+$/.test(effective))
          throw new CampaignRuleError(
            '--effective must be a non-negative ordinal',
          );
        effectiveOrdinal = Number(effective);
        if (!Number.isSafeInteger(effectiveOrdinal))
          throw new CampaignRuleError(
            `invalid campaign position ordinal ${effective}`,
          );
      }
      const prose = flag(parsed, 'prose');
      const recorded = recordAmbiguityRuling(db, {
        campaignId: id,
        ambiguityId,
        interpretationId,
        ...(prose === undefined ? {} : { prose }),
        currentPosition: current,
        ...(effectiveOrdinal === undefined ? {} : { effectiveOrdinal }),
      });
      if (!recorded.created) {
        deps.log(
          `already resolved by '${recorded.rule.ruleIdentity}' (takes effect from turn ${recorded.rule.effectivePosition.ordinal}).`,
        );
        return;
      }
      deps.log(
        `Added ${recorded.rule.ruleKind} '${recorded.rule.ruleIdentity}' (status: ${recorded.rule.status}, effective ordinal ${recorded.rule.effectivePosition.ordinal}, provenance: ${provenanceLabel(recorded.rule.provenance)}); takes effect from turn ${recorded.rule.effectivePosition.ordinal}.`,
      );
    });
    return result ? 0 : 1;
  } catch (error) {
    deps.log(errorMessage(error));
    return 1;
  }
}

function showCommand(
  args: readonly string[],
  deps: RulesDeps,
  history: boolean,
): number {
  try {
    const parsed = parseArgs(args, ['identity']);
    const { identity, campaignId } = commandPositionals(parsed, true);
    const result = withCampaign(deps, campaignId, (db, id) => {
      const rules = listCampaignRules(db, { campaignId: id });
      const rule = rules.find(
        (candidate) => candidate.ruleIdentity === identity,
      );
      if (rule === undefined) {
        throw new CampaignRuleError(
          `campaign rule '${identity}' does not exist in campaign '${id}'`,
        );
      }
      if (history) {
        const bySuccessor = new Map(
          rules
            .filter((candidate) => candidate.supersededBy !== null)
            .map((candidate) => [candidate.supersededBy as string, candidate]),
        );
        const chain: CampaignRule[] = [];
        const seen = new Set<string>();
        let prior: CampaignRule | undefined = rule;
        while (prior !== undefined && !seen.has(prior.ruleIdentity)) {
          seen.add(prior.ruleIdentity);
          chain.unshift(prior);
          prior = bySuccessor.get(prior.ruleIdentity);
        }
        seen.clear();
        let next: CampaignRule | undefined = rule;
        while (next !== undefined && !seen.has(next.ruleIdentity)) {
          seen.add(next.ruleIdentity);
          const successorId: string | null = next.supersededBy;
          next =
            successorId === null
              ? undefined
              : rules.find(
                  (candidate) => candidate.ruleIdentity === successorId,
                );
          if (next !== undefined) chain.push(next);
        }
        deps.log(`History for ${identity}:`);
        for (const hop of chain) {
          deps.log(
            `  ${hop.ruleIdentity} [${hop.status}] effective ${formatCampaignPosition(hop.effectivePosition)} revoked ${formatNullablePosition(hop.revokedPosition)} supersededBy ${hop.supersededBy ?? 'none'}`,
          );
        }
        return;
      }
      deps.log(`Rule ${rule.ruleIdentity}`);
      deps.log(`  kind: ${rule.ruleKind}`);
      deps.log(`  status: ${rule.status}`);
      deps.log(`  origin: ${rule.origin}`);
      deps.log(`  provenance: ${provenanceLabel(rule.provenance)}`);
      deps.log(`  scope: ${rule.scope}`);
      deps.log(`  governing records: ${rule.governingRecordKeys.join(', ')}`);
      deps.log(
        `  effective position: ${formatCampaignPosition(rule.effectivePosition)}`,
      );
      deps.log(`  temporal mode: ${rule.temporalMode.mode}`);
      deps.log(`  superseded by: ${rule.supersededBy ?? 'none'}`);
      deps.log(
        `  revoked position: ${formatNullablePosition(rule.revokedPosition)}`,
      );
      deps.log(`  prose: ${rule.prose}`);
    });
    return result ? 0 : 1;
  } catch (error) {
    deps.log(errorMessage(error));
    return 1;
  }
}

function addCommand(args: readonly string[], deps: RulesDeps): number {
  try {
    const parsed = parseArgs(args, [
      'kind',
      'prose',
      'scope',
      'records',
      'identity',
      'effective',
      'origin',
      'rationale',
      'ambiguity',
      'interpretation',
      'question',
    ]);
    const { campaignId } = commandPositionals(parsed, false);
    const result = withCampaign(deps, campaignId, (db, id, current) => {
      const kind = requiredFlag(parsed, 'kind') as CampaignRule['ruleKind'];
      if (kind !== 'ruling' && kind !== 'house-rule') {
        throw new CampaignRuleError('--kind must be ruling or house-rule');
      }
      const origin = flag(parsed, 'origin') ?? 'player-authored';
      if (origin !== 'player-authored' && origin !== 'player-approved') {
        throw new CampaignRuleError(
          '--origin must be player-authored or player-approved',
        );
      }
      const prose = requiredFlag(parsed, 'prose');
      const scope = requiredFlag(parsed, 'scope');
      const records = recordsFromFlag(requiredFlag(parsed, 'records'));
      const effective = effectivePosition(parsed, current);
      const rule: CampaignRule = {
        ruleIdentity:
          flag(parsed, 'identity') ?? slugIdentity(kind, prose, effective),
        campaignId: id,
        ruleKind: kind,
        status: 'active',
        origin,
        provenance: provenanceForAdd(parsed, db, id, current, kind),
        effectivePosition: effective,
        temporalMode: { mode: 'prospective' },
        supersededBy: null,
        revokedPosition: null,
        scope,
        governingRecordKeys: records,
        prose,
      };
      const stored = createCampaignRule(db, rule, {
        currentPosition: current,
        validation:
          rule.provenance.kind === 'ambiguity'
            ? {
                ambiguity: contextAmbiguity(
                  db,
                  id,
                  current,
                  rule.provenance.ambiguityId,
                ),
              }
            : undefined,
      });
      deps.log(
        `Added ${stored.ruleKind} '${stored.ruleIdentity}' (status: ${stored.status}, effective ordinal ${stored.effectivePosition.ordinal}, provenance: ${provenanceLabel(stored.provenance)}); takes effect from turn ${stored.effectivePosition.ordinal}.`,
      );
    });
    return result ? 0 : 1;
  } catch (error) {
    deps.log(errorMessage(error));
    return 1;
  }
}

function contextAmbiguity(
  db: Db,
  campaignId: string,
  current: CampaignPosition,
  ambiguityId: string,
) {
  const context = assembleCampaignRulesContext(
    db,
    campaignId,
    formatCampaignPosition(current),
    resolveStrictCampaignRulesStack(db),
  );
  const found = context.ambiguities.find(
    ({ ambiguity }) => ambiguity.id === ambiguityId,
  );
  if (found === undefined)
    throw new CampaignRuleError(`unknown ambiguity ${ambiguityId}`);
  return found.ambiguity;
}

function supersedeCommand(args: readonly string[], deps: RulesDeps): number {
  try {
    const parsed = parseArgs(args, [
      'prose',
      'scope',
      'records',
      'identity',
      'effective',
      'rationale',
      'ambiguity',
      'interpretation',
      'question',
    ]);
    const [priorIdentity, campaignId, ...extra] = parsed.positional;
    if (priorIdentity === undefined || extra.length > 0)
      throw new CampaignRuleError(USAGE);
    const result = withCampaign(deps, campaignId, (db, id, current) => {
      const prior = getCampaignRule(db, {
        campaignId: id,
        ruleIdentity: priorIdentity,
      });
      if (prior === undefined) {
        throw new CampaignRuleError(
          `campaign rule '${priorIdentity}' does not exist in campaign '${id}'`,
        );
      }
      const prose = requiredFlag(parsed, 'prose');
      const successorEffective = effectivePosition(parsed, current);
      const successor: CampaignRule = {
        ruleIdentity:
          flag(parsed, 'identity') ??
          slugIdentity(prior.ruleKind, prose, successorEffective),
        campaignId: id,
        ruleKind: prior.ruleKind,
        status: 'active',
        origin: prior.origin,
        provenance: provenanceForSuccessor(parsed, db, id, current, prior),
        effectivePosition: successorEffective,
        temporalMode: { mode: 'prospective' },
        supersededBy: null,
        revokedPosition: null,
        scope: flag(parsed, 'scope') ?? prior.scope,
        governingRecordKeys:
          flag(parsed, 'records') === undefined
            ? [...prior.governingRecordKeys]
            : recordsFromFlag(flag(parsed, 'records') as string),
        prose,
      };
      const stored = supersedeCampaignRule(db, {
        campaignId: id,
        ruleIdentity: priorIdentity,
        successor,
        currentPosition: current,
        validation:
          storedAmbiguity(successor, db, id, current) === undefined
            ? undefined
            : { ambiguity: storedAmbiguity(successor, db, id, current) },
      });
      deps.log(
        `Superseded '${prior.ruleIdentity}' -> '${stored.ruleIdentity}' (prior effective ${formatCampaignPosition(prior.effectivePosition)}, successor effective ${formatCampaignPosition(stored.effectivePosition)}, provenance: ${provenanceLabel(stored.provenance)}); takes effect from turn ${stored.effectivePosition.ordinal}.`,
      );
    });
    return result ? 0 : 1;
  } catch (error) {
    deps.log(errorMessage(error));
    return 1;
  }
}

function storedAmbiguity(
  rule: CampaignRule,
  db: Db,
  campaignId: string,
  current: CampaignPosition,
) {
  if (rule.provenance.kind !== 'ambiguity') return undefined;
  return contextAmbiguity(db, campaignId, current, rule.provenance.ambiguityId);
}

function revokeCommand(args: readonly string[], deps: RulesDeps): number {
  try {
    const parsed = parseArgs(args, ['at', 'identity']);
    const { identity, campaignId } = commandPositionals(parsed, true);
    const result = withCampaign(deps, campaignId, (db, id, current) => {
      const revokedPosition =
        flag(parsed, 'at') === undefined
          ? { ...current, ordinal: current.ordinal + 1 }
          : parsePosition(flag(parsed, 'at') as string, current);
      const stored = revokeCampaignRule(db, {
        campaignId: id,
        ruleIdentity: identity as string,
        revokedPosition,
        currentPosition: current,
      });
      deps.log(
        `revoked from turn ${stored.revokedPosition?.ordinal ?? revokedPosition.ordinal} '${stored.ruleIdentity}' (effective ${formatCampaignPosition(stored.effectivePosition)}, provenance: ${provenanceLabel(stored.provenance)}).`,
      );
    });
    return result ? 0 : 1;
  } catch (error) {
    deps.log(errorMessage(error));
    return 1;
  }
}

/** `eshyra rules <list|show|history|add|supersede|revoke> ...`. */
export function runRulesCommand(args: string[], deps: RulesDeps): number {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case 'list':
      return listCommand(rest, deps);
    case 'show':
      return showCommand(rest, deps, false);
    case 'history':
      return showCommand(rest, deps, true);
    case 'add':
      return addCommand(rest, deps);
    case 'supersede':
      return supersedeCommand(rest, deps);
    case 'revoke':
      return revokeCommand(rest, deps);
    case 'ambiguities':
      return ambiguitiesCommand(rest, deps);
    case 'resolve':
      return resolveCommand(rest, deps);
    default:
      deps.log(USAGE);
      return 1;
  }
}
