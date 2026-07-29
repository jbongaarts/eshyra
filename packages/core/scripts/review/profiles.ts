/**
 * Review profiles: the single ordered vocabulary the whole review system
 * agrees on.
 *
 * Strictness is total and monotone:
 *
 *   standard < semantic-system < rules-clause-complete
 *
 * A stricter profile requires everything a weaker one requires, plus more.
 * That is why `rules-clause-complete` also carries the semantic-system
 * sections: rules-source work is durable semantic work with additional
 * source-to-execution obligations layered on top.
 */

export const PROTOCOL_ID = 'eshyra-review-v2';

export const PROTOCOL_DOC_PATH =
  'docs/review/eshyra-development-and-review-protocol.md';

export const POLICY_PATH = 'docs/review/minimum-profile-policy.json';

export const REVIEW_PROFILES = [
  'standard',
  'semantic-system',
  'rules-clause-complete',
] as const;

export type ReviewProfile = (typeof REVIEW_PROFILES)[number];

interface ProfileDescriptor {
  readonly profile: ReviewProfile;
  /** Stable, versioned identifier published in handoffs and checkpoints. */
  readonly profileId: string;
  /** Repo-relative path to the profile document agents are told to read. */
  readonly docPath: string;
  /** Strictness rank; higher is stricter. */
  readonly rank: number;
}

const DESCRIPTORS: Readonly<Record<ReviewProfile, ProfileDescriptor>> = {
  standard: {
    profile: 'standard',
    profileId: 'standard-v1',
    docPath: 'docs/review/profiles/standard.md',
    rank: 0,
  },
  'semantic-system': {
    profile: 'semantic-system',
    profileId: 'semantic-system-v1',
    docPath: 'docs/review/profiles/semantic-system.md',
    rank: 1,
  },
  'rules-clause-complete': {
    profile: 'rules-clause-complete',
    profileId: 'rules-clause-complete-v1',
    docPath: 'docs/review/profiles/rules-clause-complete.md',
    rank: 2,
  },
};

export function isReviewProfile(value: unknown): value is ReviewProfile {
  return (
    typeof value === 'string' &&
    (REVIEW_PROFILES as readonly string[]).includes(value)
  );
}

export function profileDescriptor(profile: ReviewProfile): ProfileDescriptor {
  return DESCRIPTORS[profile];
}

export function profileId(profile: ReviewProfile): string {
  return DESCRIPTORS[profile].profileId;
}

export function profileDocPath(profile: ReviewProfile): string {
  return DESCRIPTORS[profile].docPath;
}

export function profileRank(profile: ReviewProfile): number {
  return DESCRIPTORS[profile].rank;
}

/** The stricter of two profiles. Escalation is the only legal direction. */
export function strictestProfile(
  a: ReviewProfile,
  b: ReviewProfile,
): ReviewProfile {
  return profileRank(a) >= profileRank(b) ? a : b;
}

export function isAtLeast(
  profile: ReviewProfile,
  minimum: ReviewProfile,
): boolean {
  return profileRank(profile) >= profileRank(minimum);
}

/**
 * Pre-implementation contract authorization is mandatory for durable semantic
 * work and above. `standard` may still require it when the contract asks for
 * it, but the profile itself does not compel it.
 */
export function profileRequiresAuthorization(profile: ReviewProfile): boolean {
  return isAtLeast(profile, 'semantic-system');
}

export function parseReviewProfile(value: string): ReviewProfile {
  const normalized = value.trim().toLowerCase();
  if (!isReviewProfile(normalized)) {
    throw new Error(
      `Unknown review profile ${JSON.stringify(value)}. Expected one of: ${REVIEW_PROFILES.join(', ')}.`,
    );
  }
  return normalized;
}
