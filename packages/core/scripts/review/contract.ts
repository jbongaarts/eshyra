/**
 * The normative bead REVIEW CONTRACT: extraction, deterministic
 * normalization, schema validation, and hashing.
 *
 * The bead is the authoritative location for a change-specific review
 * contract. PR bodies, PR templates, commit messages, and chronological bead
 * notes are explanatory only and are never parsed as normative — unless the
 * contract itself names a normalized referenced artifact, which it does
 * through an explicit field rather than by proximity.
 *
 * Normalization goes Markdown -> canonical structure -> RFC 8785 JCS ->
 * SHA-256. Hashing a STRUCTURE rather than the raw text is what makes
 * "formatting-only changes must not alter semantic content" testable: list
 * markers, indentation, wrapping, blank lines, and heading spacing are
 * discarded before the digest is taken, while key and value text is not.
 */

import { hashCanonicalJson, type JsonValue } from './hashing.js';
import {
  isReviewProfile,
  PROTOCOL_ID,
  type ReviewProfile,
} from './profiles.js';

export const CONTRACT_HEADING = '## REVIEW CONTRACT';

export interface ContractField {
  /** Canonical key: lowercased, whitespace-collapsed, colon stripped. */
  readonly key: string;
  /** Key exactly as authored, for human-readable output. */
  readonly displayKey: string;
  /** Whitespace-collapsed inline value; empty when the field only has items. */
  readonly value: string;
  /** Nested bullet items beneath the field, in source order. */
  readonly items: readonly string[];
}

export interface ContractSection {
  readonly title: string;
  /** Canonical title: lowercased and whitespace-collapsed. */
  readonly key: string;
  readonly fields: readonly ContractField[];
}

export interface NormalizedContract {
  readonly protocol: string;
  /** Preamble `Key: value` lines appearing before the first `###` heading. */
  readonly preamble: readonly ContractField[];
  readonly sections: readonly ContractSection[];
}

export interface ContractProblem {
  readonly code: string;
  readonly message: string;
}

export interface ParsedContract {
  readonly beadId: string;
  readonly normalized: NormalizedContract;
  readonly contractHash: string;
  readonly declaredProfile: ReviewProfile;
  readonly authorizationRequestedByContract: boolean;
  readonly declaredCharacteristics: readonly string[];
  readonly owningBead: string;
}

export class ContractError extends Error {
  constructor(
    readonly problems: readonly ContractProblem[],
    message?: string,
  ) {
    super(
      message ??
        `Review contract rejected:\n${problems
          .map((problem) => `  - [${problem.code}] ${problem.message}`)
          .join('\n')}`,
    );
    this.name = 'ContractError';
  }
}

/* -------------------------------------------------------------------------
 * Extraction
 * ---------------------------------------------------------------------- */

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const CONTRACT_HEADING_RE = /^##\s+REVIEW\s+CONTRACT\s*$/i;

/**
 * Locate the single normative contract block. A bead may discuss review
 * contracts in prose; only a level-2 heading whose text is exactly
 * "REVIEW CONTRACT" is normative, and exactly one may exist across the bead's
 * description and acceptance criteria.
 */
export function extractContractBlocks(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let current: string[] | undefined;
  let inFence = false;

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      if (current) {
        current.push(line);
      }
      continue;
    }
    if (!inFence && CONTRACT_HEADING_RE.test(line)) {
      if (current) {
        blocks.push(current.join('\n'));
      }
      current = [line];
      continue;
    }
    if (!current) {
      continue;
    }
    const heading = inFence ? null : HEADING_RE.exec(line);
    if (heading && heading[1].length <= 2) {
      blocks.push(current.join('\n'));
      current = undefined;
      continue;
    }
    current.push(line);
  }
  if (current) {
    blocks.push(current.join('\n'));
  }
  return blocks;
}

/* -------------------------------------------------------------------------
 * Normalization
 * ---------------------------------------------------------------------- */

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function canonicalKey(value: string): string {
  return collapse(value).replace(/:\s*$/, '').toLowerCase();
}

const BULLET_RE = /^(\s*)[-*+]\s+(.*)$/;
const FIELD_RE = /^([^:]{1,120}):\s*(.*)$/;

interface MutableField {
  key: string;
  displayKey: string;
  value: string;
  items: string[];
}

interface MutableSection {
  title: string;
  fields: MutableField[];
}

/**
 * Parse one extracted block into the canonical structure.
 *
 * Recognized shapes, and only these:
 *   `### Section title`            -> section boundary
 *   `- Key: value`                 -> field within the current section
 *   `Key: value` (no bullet, before the first section) -> preamble field
 *   indented `- item`              -> item of the current field
 *   any other non-blank line       -> continuation of the current value/item
 *
 * Continuation folding is what makes the contract immune to hard wrapping:
 * a value split across three lines normalizes identically to the same value
 * on one line.
 */
export function normalizeContractBlock(block: string): NormalizedContract {
  const lines = block.replace(/\r\n?/g, '\n').split('\n');
  const preamble: MutableField[] = [];
  const sections: MutableSection[] = [];
  let section: MutableSection | undefined;
  let field: MutableField | undefined;
  /** Where a continuation line appends: the field value or its last item. */
  let cursor: 'value' | 'item' | 'none' = 'none';
  let fieldIndent = 0;

  const targetFields = (): MutableField[] =>
    section ? section.fields : preamble;

  for (const rawLine of lines) {
    const line = rawLine.replace(/[ \t]+$/g, '');
    if (line.trim() === '') {
      continue;
    }
    if (CONTRACT_HEADING_RE.test(line)) {
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      section = { title: collapse(heading[2]), fields: [] };
      sections.push(section);
      field = undefined;
      cursor = 'none';
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      const indent = bullet[1].length;
      const body = bullet[2];
      const fieldMatch = FIELD_RE.exec(body);
      // A nested bullet under an open field is an item, never a new field.
      if (field && indent > fieldIndent) {
        field.items.push(collapse(body));
        cursor = 'item';
        continue;
      }
      if (fieldMatch) {
        field = {
          key: canonicalKey(fieldMatch[1]),
          displayKey: collapse(fieldMatch[1]),
          value: collapse(fieldMatch[2]),
          items: [],
        };
        fieldIndent = indent;
        targetFields().push(field);
        cursor = 'value';
        continue;
      }
      if (field) {
        field.items.push(collapse(body));
        cursor = 'item';
        continue;
      }
      continue;
    }

    // Unbulleted `Key: value` before any section is a preamble field
    // (this is how `Protocol: eshyra-review-v2` is written).
    if (!section && !field) {
      const fieldMatch = FIELD_RE.exec(line.trim());
      if (fieldMatch) {
        field = {
          key: canonicalKey(fieldMatch[1]),
          displayKey: collapse(fieldMatch[1]),
          value: collapse(fieldMatch[2]),
          items: [],
        };
        fieldIndent = 0;
        preamble.push(field);
        cursor = 'value';
        continue;
      }
      continue;
    }

    if (!field) {
      continue;
    }
    const continuation = collapse(line);
    if (continuation === '') {
      continue;
    }
    if (cursor === 'item' && field.items.length > 0) {
      const last = field.items.length - 1;
      field.items[last] = collapse(`${field.items[last]} ${continuation}`);
      continue;
    }
    field.value = collapse(`${field.value} ${continuation}`);
    cursor = 'value';
  }

  const protocolField = preamble.find((entry) => entry.key === 'protocol');
  return {
    protocol: protocolField?.value ?? '',
    preamble: preamble.map(freezeField),
    sections: sections.map((entry) => ({
      title: entry.title,
      key: entry.title.toLowerCase(),
      fields: entry.fields.map(freezeField),
    })),
  };
}

function freezeField(field: MutableField): ContractField {
  return {
    key: field.key,
    displayKey: field.displayKey,
    value: field.value,
    items: [...field.items],
  };
}

/** The exact structure that is canonicalized and hashed. */
export function contractHashInput(contract: NormalizedContract): JsonValue {
  return {
    protocol: contract.protocol,
    preamble: contract.preamble.map(fieldHashInput),
    sections: contract.sections.map((section) => ({
      key: section.key,
      fields: section.fields.map(fieldHashInput),
    })),
  };
}

function fieldHashInput(field: ContractField): JsonValue {
  return {
    key: field.key,
    value: field.value,
    items: [...field.items],
  };
}

export function hashNormalizedContract(contract: NormalizedContract): string {
  return hashCanonicalJson(contractHashInput(contract));
}

/* -------------------------------------------------------------------------
 * Required structure, by profile
 * ---------------------------------------------------------------------- */

interface SectionSpec {
  readonly title: string;
  readonly fields: readonly string[];
}

const COMMON_SECTIONS: readonly SectionSpec[] = [
  {
    title: 'Review classification',
    fields: [
      'declared profile',
      'authorization required before implementation',
      'classification reason',
      'change characteristics',
      'escalation conditions',
      'owning bead',
    ],
  },
  {
    title: 'Objective and scope',
    fields: [
      'intended outcome',
      'in scope',
      'out of scope',
      'exact affected surfaces',
    ],
  },
  {
    title: 'Authority and inputs',
    fields: [
      'authoritative inputs',
      'derived inputs',
      'untrusted inputs',
      'ownership',
    ],
  },
  {
    title: 'Behavior and representation',
    fields: [
      'required behavior',
      'required distinctions',
      'compatibility requirements',
      'negative behavior',
    ],
  },
  {
    title: 'Consumers and blast radius',
    fields: [
      'direct consumers',
      'indirect consumers',
      'cross-surface checks',
      'migration implications',
    ],
  },
  {
    title: 'Failure, recovery, and residuals',
    fields: [
      'fail-closed requirements',
      'recovery or rollback',
      'approved residuals',
      'explicitly unsupported material',
    ],
  },
  {
    title: 'Verification and closure',
    fields: [
      'required tests',
      'permanent regression evidence',
      'generated or exact membership',
      'closure evidence',
    ],
  },
];

const SEMANTIC_SYSTEM_SECTIONS: readonly SectionSpec[] = [
  {
    title: 'Semantic-system contract',
    fields: [
      'trust boundaries',
      'stable identities and revisions',
      'state transitions and lifecycle',
      'stale-state detection',
      'migration and backward compatibility',
      'adversarial scenarios',
    ],
  },
];

const RULES_CLAUSE_SECTIONS: readonly SectionSpec[] = [
  {
    title: 'Source or authoritative obligations',
    fields: [
      'authority',
      'exact membership or bounded scope',
      'membership derivation',
      'source spans or authoritative inputs',
      'complete obligations',
    ],
  },
  {
    title: 'Pack representation',
    fields: [
      'required semantic distinctions',
      'branches, alternatives, multiplicity, and locality',
      'timing, lifecycle, resources, reset, and termination',
      'provenance',
    ],
  },
  {
    title: 'Cross-kind and cross-surface siblings',
    fields: [
      'applicable record kinds',
      'applicable consumers',
      'generated predicates or reconciliation',
    ],
  },
  {
    title: 'Capability boundary',
    fields: [
      'required engine capabilities',
      'evidence strength',
      'existing owners',
      'known missing capability handling',
    ],
  },
  {
    title: 'Pack-driven reference execution',
    fields: [
      'real generated-record scenarios',
      'negative and fail-closed scenarios',
      'replay, rollback, rng, or determinism requirements',
    ],
  },
  {
    title: 'Rules residuals',
    fields: [
      'source ambiguity',
      'designed adjudication',
      'explicitly unsupported source material',
    ],
  },
];

/**
 * Required sections are cumulative in strictness order. A
 * `rules-clause-complete` contract must satisfy the semantic-system sections
 * too: rules-source work is durable semantic work with source-to-execution
 * obligations layered on top.
 */
export function requiredSections(
  profile: ReviewProfile,
): readonly SectionSpec[] {
  if (profile === 'standard') {
    return COMMON_SECTIONS;
  }
  if (profile === 'semantic-system') {
    return [...COMMON_SECTIONS, ...SEMANTIC_SYSTEM_SECTIONS];
  }
  return [
    ...COMMON_SECTIONS,
    ...SEMANTIC_SYSTEM_SECTIONS,
    ...RULES_CLAUSE_SECTIONS,
  ];
}

/** Sections that exist only at strictness above `profile`. */
function sectionsAboveProfile(profile: ReviewProfile): readonly string[] {
  const allowed = new Set(
    requiredSections(profile).map((section) => section.title.toLowerCase()),
  );
  return requiredSections('rules-clause-complete')
    .map((section) => section.title.toLowerCase())
    .filter((title) => !allowed.has(title));
}

/* -------------------------------------------------------------------------
 * Placeholder detection
 * ---------------------------------------------------------------------- */

/**
 * Values that assert nothing. `none`, `n/a`, and `not applicable` are
 * deliberately NOT placeholders: they are real answers to questions like
 * "approved residuals", and rejecting them would push authors toward
 * mechanically filled free text, which is the second recurring failure idiom
 * recorded on eshyra-o9bd.19.7.
 */
const PLACEHOLDER_VALUES: ReadonlySet<string> = new Set([
  '',
  'tbd',
  'to be determined',
  'todo',
  'to do',
  'tbc',
  'to be confirmed',
  'fixme',
  'xxx',
  'placeholder',
  'pending',
  'unknown',
  'see above',
  'see below',
  'as above',
  'same as above',
  '?',
  '??',
  '???',
  '-',
  '--',
  '...',
  'n/a — tbd',
]);

export function isPlaceholderValue(value: string): boolean {
  const normalized = collapse(value)
    .toLowerCase()
    .replace(/[.!]+$/g, '')
    .trim();
  if (PLACEHOLDER_VALUES.has(normalized)) {
    return true;
  }
  // A value made only of punctuation asserts nothing.
  return /^[^\p{L}\p{N}]*$/u.test(normalized);
}

function fieldIsSatisfied(field: ContractField): boolean {
  if (field.value !== '' && !isPlaceholderValue(field.value)) {
    return true;
  }
  return field.items.some((item) => !isPlaceholderValue(item));
}

/* -------------------------------------------------------------------------
 * Validation
 * ---------------------------------------------------------------------- */

const TRUE_VALUES: ReadonlySet<string> = new Set([
  'yes',
  'true',
  'required',
  'mandatory',
]);
const FALSE_VALUES: ReadonlySet<string> = new Set([
  'no',
  'false',
  'not required',
  'optional',
]);

function findField(
  contract: NormalizedContract,
  sectionKey: string,
  fieldKey: string,
): ContractField | undefined {
  const section = contract.sections.find(
    (entry) => entry.key === sectionKey.toLowerCase(),
  );
  return section?.fields.find((entry) => entry.key === fieldKey);
}

/** Split a field into a list, using either nested items or `;`/`,` runs. */
export function fieldList(field: ContractField | undefined): string[] {
  if (!field) {
    return [];
  }
  if (field.items.length > 0) {
    return field.items.map((item) => collapse(item)).filter((v) => v !== '');
  }
  return field.value
    .split(/[;,]/)
    .map((entry) => collapse(entry))
    .filter((entry) => entry !== '');
}

export interface ParseContractOptions {
  readonly beadId: string;
  /** All bead text that may legally carry the normative contract. */
  readonly sources: readonly {
    readonly label: string;
    readonly text: string;
  }[];
}

/**
 * Validate an already-normalized contract structure.
 *
 * Split out from `parseReviewContract` because CI validates a contract it
 * received through a published handoff rather than by reading the bead: the
 * Beads database lives in Dolt behind `refs/dolt/data` and is not reachable
 * from a GitHub Actions runner. The handoff republishes the exact normalized
 * structure alongside its digest, so CI can re-derive the digest and re-check
 * every structural rule. What CI cannot check — that the published structure
 * still matches the bead — is what `review:preflight` checks locally, where
 * `bd` is available. Neither pretends to do the other's job.
 */
export function validateContractStructure(
  normalized: NormalizedContract,
  beadId: string,
): ParsedContract {
  const problems: ContractProblem[] = [];

  if (normalized.protocol !== PROTOCOL_ID) {
    problems.push({
      code: 'PROTOCOL_MISMATCH',
      message: `Contract declares protocol ${JSON.stringify(normalized.protocol)}; this implementation understands ${PROTOCOL_ID}. An unrecognized protocol is an error, never a skip.`,
    });
  }

  const classification = 'review classification';
  const declaredField = findField(
    normalized,
    classification,
    'declared profile',
  );
  const declaredRaw = declaredField?.value.toLowerCase() ?? '';
  if (!isReviewProfile(declaredRaw)) {
    problems.push({
      code: 'DECLARED_PROFILE_INVALID',
      message: `"Declared profile" is ${JSON.stringify(declaredField?.value ?? '')}; expected standard, semantic-system, or rules-clause-complete.`,
    });
    throw new ContractError(problems);
  }
  const declaredProfile: ReviewProfile = declaredRaw;

  const authField = findField(
    normalized,
    classification,
    'authorization required before implementation',
  );
  const authRaw = (authField?.value ?? '').toLowerCase().replace(/[.]+$/, '');
  let authorizationRequestedByContract = false;
  if (TRUE_VALUES.has(authRaw)) {
    authorizationRequestedByContract = true;
  } else if (FALSE_VALUES.has(authRaw)) {
    authorizationRequestedByContract = false;
  } else {
    problems.push({
      code: 'AUTHORIZATION_FLAG_INVALID',
      message: `"Authorization required before implementation" is ${JSON.stringify(authField?.value ?? '')}; expected yes or no.`,
    });
  }

  for (const spec of requiredSections(declaredProfile)) {
    const section = normalized.sections.find(
      (entry) => entry.key === spec.title.toLowerCase(),
    );
    if (!section) {
      problems.push({
        code: 'SECTION_MISSING',
        message: `Missing required section "### ${spec.title}" for profile ${declaredProfile}.`,
      });
      continue;
    }
    for (const fieldKey of spec.fields) {
      const field = section.fields.find((entry) => entry.key === fieldKey);
      if (!field) {
        problems.push({
          code: 'FIELD_MISSING',
          message: `Section "${spec.title}" is missing required field "${fieldKey}".`,
        });
        continue;
      }
      if (!fieldIsSatisfied(field)) {
        problems.push({
          code: 'FIELD_PLACEHOLDER',
          message: `Field "${spec.title} / ${field.displayKey}" is empty or placeholder-only (${JSON.stringify(field.value)}).`,
        });
      }
    }
  }

  const forbidden = new Set(sectionsAboveProfile(declaredProfile));
  for (const section of normalized.sections) {
    if (forbidden.has(section.key)) {
      problems.push({
        code: 'PROFILE_SECTION_INCONSISTENT',
        message: `Section "### ${section.title}" belongs to a stricter profile than the declared ${declaredProfile}. Declare the stricter profile or remove the section; over-classification is permitted, mixed classification is not.`,
      });
    }
  }

  if (
    !authorizationRequestedByContract &&
    declaredProfile !== 'standard' &&
    !problems.some((problem) => problem.code === 'AUTHORIZATION_FLAG_INVALID')
  ) {
    problems.push({
      code: 'AUTHORIZATION_CONTRADICTORY',
      message: `Profile ${declaredProfile} makes pre-implementation authorization mandatory, but the contract declares it is not required.`,
    });
  }

  const owningBeadField = findField(normalized, classification, 'owning bead');
  const owningBead = owningBeadField?.value.trim() ?? '';
  if (owningBead !== '' && owningBead !== beadId) {
    problems.push({
      code: 'OWNING_BEAD_MISMATCH',
      message: `Contract declares owning bead ${JSON.stringify(owningBead)} but was read from ${beadId}.`,
    });
  }

  const declaredCharacteristics = fieldList(
    findField(normalized, classification, 'change characteristics'),
  ).map((entry) => entry.toLowerCase().replace(/[.]+$/, ''));

  if (problems.length > 0) {
    throw new ContractError(problems);
  }

  return {
    beadId,
    normalized,
    contractHash: hashNormalizedContract(normalized),
    declaredProfile,
    authorizationRequestedByContract,
    declaredCharacteristics,
    owningBead: owningBead === '' ? beadId : owningBead,
  };
}

/**
 * Extract, normalize, and validate a contract from bead text. Throws
 * `ContractError` carrying EVERY problem found rather than the first — a
 * reviewer needs the whole list, and returning a partial result would be the
 * fail-open idiom.
 */
export function parseReviewContract(
  options: ParseContractOptions,
): ParsedContract {
  const found: { label: string; block: string }[] = [];
  for (const source of options.sources) {
    for (const block of extractContractBlocks(source.text)) {
      found.push({ label: source.label, block });
    }
  }

  if (found.length === 0) {
    throw new ContractError([
      {
        code: 'CONTRACT_MISSING',
        message: `Bead ${options.beadId} has no "${CONTRACT_HEADING}" block. The bead is the authoritative location for the review contract; a PR body cannot substitute.`,
      },
    ]);
  }
  if (found.length > 1) {
    throw new ContractError([
      {
        code: 'CONTRACT_DUPLICATE',
        message: `Bead ${options.beadId} has ${found.length} "${CONTRACT_HEADING}" blocks (${found
          .map((entry) => entry.label)
          .join(', ')}). Exactly one normative contract is permitted.`,
      },
    ]);
  }

  return validateContractStructure(
    normalizeContractBlock(found[0].block),
    options.beadId,
  );
}

/** Render the canonical structure back to Markdown, for handoff comments. */
export function renderNormalizedContract(contract: NormalizedContract): string {
  const lines: string[] = [CONTRACT_HEADING, ''];
  for (const field of contract.preamble) {
    lines.push(`${field.displayKey}: ${field.value}`.trimEnd());
    for (const item of field.items) {
      lines.push(`  - ${item}`);
    }
  }
  for (const section of contract.sections) {
    lines.push('', `### ${section.title}`);
    for (const field of section.fields) {
      lines.push(`- ${field.displayKey}: ${field.value}`.trimEnd());
      for (const item of field.items) {
        lines.push(`  - ${item}`);
      }
    }
  }
  return `${lines.join('\n').trim()}\n`;
}
