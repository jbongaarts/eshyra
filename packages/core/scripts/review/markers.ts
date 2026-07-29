/**
 * Canonical PR-comment markers and the shared machinery for reading them.
 *
 * A marker identifies a comment as machine-readable review state. Everything
 * else on a PR — the body, the template, review threads, prose comments — is
 * explanatory only and is never parsed as evidence.
 *
 * Marker versions are part of the protocol identity. Encountering a marker
 * version this implementation does not understand is an ERROR, not a skip:
 * silently ignoring future state is how a stale tool approves work it cannot
 * read.
 */

export const CONTRACT_MARKER = '<!-- eshyra-review-contract:v2 -->';
export const CHECKPOINT_MARKER = '<!-- eshyra-review-checkpoint:v2 -->';
export const INVALIDATION_MARKER = '<!-- eshyra-design-invalidated:v1 -->';

const MARKER_FAMILY_RE =
  /<!--\s*(eshyra-review-contract|eshyra-review-checkpoint|eshyra-design-invalidated):v(\d+)\s*-->/;

export type MarkerFamily =
  | 'eshyra-review-contract'
  | 'eshyra-review-checkpoint'
  | 'eshyra-design-invalidated';

const SUPPORTED_VERSIONS: Readonly<Record<MarkerFamily, number>> = {
  'eshyra-review-contract': 2,
  'eshyra-review-checkpoint': 2,
  'eshyra-design-invalidated': 1,
};

export interface MarkerMatch {
  readonly family: MarkerFamily;
  readonly version: number;
  readonly supported: boolean;
}

export function detectMarker(body: string): MarkerMatch | undefined {
  const match = MARKER_FAMILY_RE.exec(body);
  if (!match) {
    return undefined;
  }
  const family = match[1] as MarkerFamily;
  const version = Number.parseInt(match[2], 10);
  return {
    family,
    version,
    supported: version === SUPPORTED_VERSIONS[family],
  };
}

export function hasMarker(body: string, marker: string): boolean {
  return body.includes(marker);
}

/**
 * Extract a fenced JSON payload labelled `json` from a comment body. The
 * payload is the machine surface; the surrounding table is for humans and is
 * never parsed.
 */
export function extractJsonPayload(body: string): unknown {
  const match = /```json\s*\n([\s\S]*?)\n```/.exec(body);
  if (!match) {
    throw new Error(
      'Comment carries a review marker but no ```json payload block.',
    );
  }
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    throw new Error(
      `Comment JSON payload is malformed: ${(error as Error).message}`,
    );
  }
}

export function fenceJson(value: unknown): string {
  return ['```json', JSON.stringify(value, null, 2), '```'].join('\n');
}
