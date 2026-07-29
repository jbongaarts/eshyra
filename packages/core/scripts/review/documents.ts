/**
 * Protocol and profile documents: loading, hashing, and size discipline.
 *
 * The documents are versioned artifacts, so their digests are published in
 * every handoff and checkpoint. A reviewer who approved against one wording of
 * the protocol has not approved against another.
 *
 * Size ceilings are enforced here rather than described in prose, because
 * recurring agent-context cost is an acceptance criterion for this system: a
 * profile document that grows without bound is a tax on every future task that
 * loads it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashDocumentText } from './hashing.js';
import {
  PROTOCOL_DOC_PATH,
  PROTOCOL_ID,
  profileDocPath,
  profileId,
  type ReviewProfile,
} from './profiles.js';

export interface ReviewDocument {
  readonly id: string;
  readonly path: string;
  readonly text: string;
  readonly hash: string;
  readonly characterCount: number;
}

/**
 * Maximum characters per document. Ceilings, not targets. Raising one is a
 * protocol change and needs a changelog entry.
 */
export const DOCUMENT_SIZE_LIMITS: Readonly<Record<string, number>> = {
  [PROTOCOL_DOC_PATH]: 12000,
  'docs/review/profiles/standard.md': 4000,
  'docs/review/profiles/semantic-system.md': 6000,
  'docs/review/profiles/rules-clause-complete.md': 8000,
};

/**
 * Maximum characters of review-process guidance permitted in an
 * automatically-loaded agent instruction file. These files are loaded on every
 * session; they carry pointers, never the protocol.
 */
export const ENTRY_POINT_GUIDANCE_LIMIT = 1200;

export class DocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentError';
  }
}

function loadDocument(
  repoRoot: string,
  path: string,
  id: string,
): ReviewDocument {
  let text: string;
  try {
    text = readFileSync(join(repoRoot, path), 'utf8');
  } catch (error) {
    throw new DocumentError(
      `Cannot read review document ${path}: ${(error as Error).message}`,
    );
  }
  return {
    id,
    path,
    text,
    hash: hashDocumentText(text),
    characterCount: text.length,
  };
}

export function loadProtocolDocument(repoRoot: string): ReviewDocument {
  return loadDocument(repoRoot, PROTOCOL_DOC_PATH, PROTOCOL_ID);
}

export function loadProfileDocument(
  repoRoot: string,
  profile: ReviewProfile,
): ReviewDocument {
  return loadDocument(repoRoot, profileDocPath(profile), profileId(profile));
}

/** Returns the paths whose size exceeds their ceiling, with the overage. */
export function documentSizeViolations(
  repoRoot: string,
): { path: string; limit: number; actual: number }[] {
  const violations: { path: string; limit: number; actual: number }[] = [];
  for (const [path, limit] of Object.entries(DOCUMENT_SIZE_LIMITS)) {
    const text = readFileSync(join(repoRoot, path), 'utf8');
    if (text.length > limit) {
      violations.push({ path, limit, actual: text.length });
    }
  }
  return violations;
}
