/**
 * Deterministic normalization and hashing.
 *
 * Two normalizers exist and they are deliberately different:
 *
 * 1. `canonicalJson` — RFC 8785 (JCS) for MACHINE STRUCTURES: the
 *    minimum-profile policy and the parsed contract structure. Property order,
 *    insertion order, and whitespace cannot affect the digest. PR #475 shipped
 *    evidence equality that depended on JSON property insertion order; JCS is
 *    the structural answer to that defect class.
 *
 * 2. `normalizeDocumentText` — for MARKDOWN DOCUMENTS whose bytes are the
 *    thing being versioned (the protocol and profile documents). Line endings,
 *    trailing whitespace, blank-line runs, and a missing final newline are
 *    formatting; everything else is content.
 *
 * Digests are full 64-hex SHA-256. `shortHash` exists only for display.
 */

import { createHash } from 'node:crypto';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * RFC 8785 JSON Canonicalization Scheme.
 *
 * Object members are sorted by the UTF-16 code-unit order of their names,
 * strings use the shortest escape forms, and numbers use the ECMAScript
 * `Number::toString` form (JCS defers to it for the range we use). Non-finite
 * numbers and `undefined` are rejected rather than silently coerced — a
 * canonicalizer that quietly drops data is the fail-open idiom in another
 * costume.
 */
export function canonicalJson(value: JsonValue): string {
  return serialize(value);
}

function serialize(value: JsonValue): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(
        `Cannot canonicalize non-finite number: ${String(value)}`,
      );
    }
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (typeof value === 'string') {
    return serializeString(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => serialize(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort(compareCodeUnits);
  const members = keys.map((key) => {
    const member = value[key];
    if (member === undefined) {
      throw new Error(
        `Cannot canonicalize undefined value at key ${JSON.stringify(key)}`,
      );
    }
    return `${serializeString(key)}:${serialize(member)}`;
  });
  return `{${members.join(',')}}`;
}

/** UTF-16 code-unit ordering, which is what RFC 8785 specifies. */
function compareCodeUnits(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a.charCodeAt(index);
    const right = b.charCodeAt(index);
    if (left !== right) {
      return left - right;
    }
  }
  return a.length - b.length;
}

const SHORT_ESCAPES: Readonly<Record<string, string>> = {
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\f': '\\f',
  '\r': '\\r',
  '"': '\\"',
  '\\': '\\\\',
};

function serializeString(value: string): string {
  let out = '"';
  for (const char of value) {
    const shortEscape = SHORT_ESCAPES[char];
    if (shortEscape !== undefined) {
      out += shortEscape;
      continue;
    }
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
      continue;
    }
    out += char;
  }
  return `${out}"`;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function hashCanonicalJson(value: JsonValue): string {
  return sha256Hex(canonicalJson(value));
}

/**
 * Normalize a Markdown document so that formatting-only edits do not move the
 * digest. Exactly these transformations, in this order:
 *
 *   1. strip a UTF-8 BOM;
 *   2. Unicode NFC normalization;
 *   3. CRLF and CR line endings become LF;
 *   4. trailing whitespace is removed from every line;
 *   5. runs of two or more blank lines collapse to one blank line;
 *   6. leading and trailing blank lines are removed;
 *   7. the result ends with exactly one newline (empty input stays empty).
 *
 * Anything else — including indentation, list markers, and wording — is
 * content and changes the digest.
 */
export function normalizeDocumentText(text: string): string {
  const withoutBom = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const lines = withoutBom
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''));

  const collapsed: string[] = [];
  for (const line of lines) {
    if (line === '' && collapsed.at(-1) === '') {
      continue;
    }
    collapsed.push(line);
  }
  while (collapsed.length > 0 && collapsed[0] === '') {
    collapsed.shift();
  }
  while (collapsed.length > 0 && collapsed.at(-1) === '') {
    collapsed.pop();
  }
  return collapsed.length === 0 ? '' : `${collapsed.join('\n')}\n`;
}

export function hashDocumentText(text: string): string {
  return sha256Hex(normalizeDocumentText(text));
}

/** Display-only abbreviation. Never compare or store abbreviated digests. */
export function shortHash(hash: string): string {
  return hash.slice(0, 12);
}
