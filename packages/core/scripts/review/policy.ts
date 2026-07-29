/**
 * The minimum-profile policy: the single place that decides how strict a
 * change must be reviewed.
 *
 * The effective profile is the STRICTER of the declared profile and the
 * minimum profile. The minimum comes from two independent sources, and a
 * characteristic can only escalate the path-derived result, never weaken it:
 *
 *   changed paths          -> path-derived minimum
 *   declared characteristics -> characteristic-derived minimum
 *
 * Path matching alone is insufficient: a change confined to
 * `packages/core/src/state` looks like ordinary persisted-state work until the
 * author declares `pack-driven-runtime-semantics`, at which point it is
 * rules-clause-complete work regardless of where the file lives.
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { hashCanonicalJson, type JsonValue } from './hashing.js';
import {
  isReviewProfile,
  POLICY_PATH,
  PROTOCOL_ID,
  profileRank,
  type ReviewProfile,
  strictestProfile,
} from './profiles.js';

export interface PathRule {
  readonly id: string;
  readonly profile: ReviewProfile;
  readonly reason: string;
  readonly patterns: readonly string[];
}

export interface CharacteristicRule {
  readonly characteristic: string;
  readonly profile: ReviewProfile;
  readonly reason: string;
}

export interface MinimumProfilePolicy {
  readonly policyId: string;
  readonly policyVersion: string;
  readonly protocol: string;
  readonly defaultProfile: ReviewProfile;
  readonly pathRules: readonly PathRule[];
  readonly characteristicRules: readonly CharacteristicRule[];
}

export interface LoadedPolicy {
  readonly policy: MinimumProfilePolicy;
  readonly policyHash: string;
}

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyError';
  }
}

export function parseMinimumProfilePolicy(raw: string): LoadedPolicy {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new PolicyError(
      `Minimum-profile policy is not valid JSON: ${(error as Error).message}`,
    );
  }
  const policy = validatePolicy(parsed);
  return {
    policy,
    policyHash: hashCanonicalJson(parsed as JsonValue),
  };
}

export function loadMinimumProfilePolicy(repoRoot: string): LoadedPolicy {
  const path = isAbsolute(POLICY_PATH)
    ? POLICY_PATH
    : join(repoRoot, POLICY_PATH);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new PolicyError(
      `Cannot read minimum-profile policy at ${path}: ${(error as Error).message}`,
    );
  }
  return parseMinimumProfilePolicy(raw);
}

function validatePolicy(value: unknown): MinimumProfilePolicy {
  if (typeof value !== 'object' || value === null) {
    throw new PolicyError('Minimum-profile policy must be a JSON object.');
  }
  const raw = value as Record<string, unknown>;
  const defaultProfile = raw.defaultProfile;
  if (!isReviewProfile(defaultProfile)) {
    throw new PolicyError(
      `Policy defaultProfile ${JSON.stringify(defaultProfile)} is not a review profile.`,
    );
  }
  if (raw.protocol !== PROTOCOL_ID) {
    throw new PolicyError(
      `Policy targets protocol ${JSON.stringify(raw.protocol)}; this implementation understands ${PROTOCOL_ID}.`,
    );
  }
  if (
    !Array.isArray(raw.pathRules) ||
    !Array.isArray(raw.characteristicRules)
  ) {
    throw new PolicyError(
      'Policy must define pathRules and characteristicRules arrays.',
    );
  }

  const pathRules = raw.pathRules.map((entry, index) => {
    const rule = entry as Record<string, unknown>;
    if (!isReviewProfile(rule.profile)) {
      throw new PolicyError(
        `pathRules[${index}] has invalid profile ${JSON.stringify(rule.profile)}.`,
      );
    }
    if (
      typeof rule.id !== 'string' ||
      typeof rule.reason !== 'string' ||
      !Array.isArray(rule.patterns) ||
      rule.patterns.length === 0 ||
      rule.patterns.some((pattern) => typeof pattern !== 'string')
    ) {
      throw new PolicyError(
        `pathRules[${index}] must have id, reason, and a non-empty patterns array of strings.`,
      );
    }
    return {
      id: rule.id,
      profile: rule.profile,
      reason: rule.reason,
      patterns: rule.patterns as readonly string[],
    } satisfies PathRule;
  });

  const characteristicRules = raw.characteristicRules.map((entry, index) => {
    const rule = entry as Record<string, unknown>;
    if (!isReviewProfile(rule.profile)) {
      throw new PolicyError(
        `characteristicRules[${index}] has invalid profile ${JSON.stringify(rule.profile)}.`,
      );
    }
    if (
      typeof rule.characteristic !== 'string' ||
      rule.characteristic.trim() === '' ||
      typeof rule.reason !== 'string'
    ) {
      throw new PolicyError(
        `characteristicRules[${index}] must have characteristic and reason strings.`,
      );
    }
    return {
      characteristic: rule.characteristic.toLowerCase(),
      profile: rule.profile,
      reason: rule.reason,
    } satisfies CharacteristicRule;
  });

  const duplicates = characteristicRules
    .map((rule) => rule.characteristic)
    .filter((name, index, all) => all.indexOf(name) !== index);
  if (duplicates.length > 0) {
    throw new PolicyError(
      `Duplicate characteristic rules: ${[...new Set(duplicates)].join(', ')}.`,
    );
  }

  return {
    policyId: String(raw.policyId ?? ''),
    policyVersion: String(raw.policyVersion ?? ''),
    protocol: PROTOCOL_ID,
    defaultProfile,
    pathRules,
    characteristicRules,
  };
}

/* -------------------------------------------------------------------------
 * Glob matching
 * ---------------------------------------------------------------------- */

/**
 * Deterministic, dependency-free glob matching over `/`-separated repo paths.
 *
 * Supported: `**` (zero or more whole segments), `*` (zero or more characters
 * within one segment), `?` (one character within one segment). Nothing else is
 * special. An unsupported construct would silently under-match, so the grammar
 * stays small enough to hold in the head.
 */
export function matchesGlob(pattern: string, path: string): boolean {
  return globToRegExp(pattern).test(path);
}

const globCache = new Map<string, RegExp>();

function globToRegExp(pattern: string): RegExp {
  const cached = globCache.get(pattern);
  if (cached) {
    return cached;
  }
  const segments = pattern.split('/');
  let source = '^';
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const isLast = index === segments.length - 1;
    if (segment === '**') {
      // Non-final `**` consumes whole segments including their separator, so
      // `a/**/b` matches both `a/b` and `a/x/y/b`. Final `**` consumes the
      // rest of the path.
      source += isLast ? '[^/]*(?:/[^/]*)*' : '(?:[^/]+/)*';
      continue;
    }
    source += segment
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]');
    if (!isLast) {
      source += '/';
    }
  }
  const regexp = new RegExp(`${source}$`);
  globCache.set(pattern, regexp);
  return regexp;
}

/* -------------------------------------------------------------------------
 * Classification
 * ---------------------------------------------------------------------- */

export interface EscalationReason {
  readonly source: 'path' | 'characteristic';
  readonly ruleId: string;
  readonly profile: ReviewProfile;
  readonly reason: string;
  /** Matched paths (path rules) or the characteristic name. */
  readonly evidence: readonly string[];
}

export interface Classification {
  readonly declaredProfile: ReviewProfile;
  readonly pathMinimum: ReviewProfile;
  readonly characteristicMinimum: ReviewProfile;
  readonly minimumProfile: ReviewProfile;
  readonly effectiveProfile: ReviewProfile;
  readonly escalations: readonly EscalationReason[];
  readonly unknownCharacteristics: readonly string[];
  readonly underClassified: boolean;
  readonly overClassified: boolean;
  readonly policyHash: string;
}

export interface ClassifyInput {
  readonly declaredProfile: ReviewProfile;
  readonly changedPaths: readonly string[];
  readonly characteristics: readonly string[];
}

export function classifyChange(
  loaded: LoadedPolicy,
  input: ClassifyInput,
): Classification {
  const { policy } = loaded;
  const escalations: EscalationReason[] = [];

  let pathMinimum = policy.defaultProfile;
  for (const rule of policy.pathRules) {
    const matched = input.changedPaths.filter((path) =>
      rule.patterns.some((pattern) => matchesGlob(pattern, path)),
    );
    if (matched.length === 0) {
      continue;
    }
    pathMinimum = strictestProfile(pathMinimum, rule.profile);
    escalations.push({
      source: 'path',
      ruleId: rule.id,
      profile: rule.profile,
      reason: rule.reason,
      evidence: matched.slice(0, 8),
    });
  }

  let characteristicMinimum = policy.defaultProfile;
  const unknownCharacteristics: string[] = [];
  for (const declared of input.characteristics) {
    const name = declared.trim().toLowerCase();
    if (name === '' || name === 'none') {
      continue;
    }
    const rule = policy.characteristicRules.find(
      (entry) => entry.characteristic === name,
    );
    if (!rule) {
      unknownCharacteristics.push(name);
      continue;
    }
    characteristicMinimum = strictestProfile(
      characteristicMinimum,
      rule.profile,
    );
    escalations.push({
      source: 'characteristic',
      ruleId: rule.characteristic,
      profile: rule.profile,
      reason: rule.reason,
      evidence: [name],
    });
  }

  const minimumProfile = strictestProfile(pathMinimum, characteristicMinimum);
  const effectiveProfile = strictestProfile(
    input.declaredProfile,
    minimumProfile,
  );

  return {
    declaredProfile: input.declaredProfile,
    pathMinimum,
    characteristicMinimum,
    minimumProfile,
    effectiveProfile,
    escalations: escalations.filter(
      // Rules that land on the default profile raise nothing; reporting them
      // as "escalations" would inflate compact output with non-events.
      (entry) =>
        profileRank(entry.profile) > profileRank(policy.defaultProfile),
    ),
    unknownCharacteristics,
    underClassified: effectiveProfile !== input.declaredProfile,
    overClassified:
      input.declaredProfile !== minimumProfile &&
      effectiveProfile === input.declaredProfile,
    policyHash: loaded.policyHash,
  };
}

/**
 * Known characteristic names, for error messages and documentation. The policy
 * file is the authority; this is a projection of it.
 */
export function knownCharacteristics(loaded: LoadedPolicy): readonly string[] {
  return loaded.policy.characteristicRules.map((rule) => rule.characteristic);
}
