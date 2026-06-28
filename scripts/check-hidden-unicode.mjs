// Repo-wide guard against hidden / bidirectional Unicode control characters.
//
// GitHub renders a noisy "hidden or bidirectional Unicode text" warning on PR
// diffs that triggers on a broad range of Unicode content, so it is not a
// reliable manual signal. This check instead fails ONLY on the small set of
// genuinely dangerous invisible / directional control code points that can
// hide text or reorder how source is visually interpreted (e.g. the Trojan
// Source class of attacks). Benign visible Unicode punctuation — em dash (—),
// en dash (–), arrows (→), curly quotes (“ ”), degree sign (°), etc. — is
// allowed and never flagged.
//
// It also forbids raw ASCII/C0 control bytes (U+0000..U+001F) and U+007F
// DELETE, with the only exceptions being TAB (U+0009), LINE FEED (U+000A), and
// CARRIAGE RETURN (U+000D). A stray NUL in a source file makes GitHub treat the
// whole file as binary and suppress its diff; an embedded ESC can smuggle a
// terminal escape sequence. Neither is legitimate in tracked text, so both are
// blocked here even though they are outside the Unicode hidden/bidi set.
//
// It scans only git-tracked text files (by extension) so build output,
// node_modules, and other ignored/vendored paths are never considered.
//
// Usage:
//   node scripts/check-hidden-unicode.mjs
// Exits non-zero and prints one diagnostic per finding when any forbidden
// character is present.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Forbidden code point -> Unicode name. Kept narrow on purpose: every entry is
// invisible or a directional/format control, not ordinary visible text.
export const FORBIDDEN_CODE_POINTS = new Map([
  // Bidi embedding / override controls (U+202A..U+202E).
  [0x202a, 'LEFT-TO-RIGHT EMBEDDING'],
  [0x202b, 'RIGHT-TO-LEFT EMBEDDING'],
  [0x202c, 'POP DIRECTIONAL FORMATTING'],
  [0x202d, 'LEFT-TO-RIGHT OVERRIDE'],
  [0x202e, 'RIGHT-TO-LEFT OVERRIDE'],
  // Bidi isolate controls (U+2066..U+2069).
  [0x2066, 'LEFT-TO-RIGHT ISOLATE'],
  [0x2067, 'RIGHT-TO-LEFT ISOLATE'],
  [0x2068, 'FIRST STRONG ISOLATE'],
  [0x2069, 'POP DIRECTIONAL ISOLATE'],
  // Zero-width characters and directional marks (U+200B..U+200F).
  [0x200b, 'ZERO WIDTH SPACE'],
  [0x200c, 'ZERO WIDTH NON-JOINER'],
  [0x200d, 'ZERO WIDTH JOINER'],
  [0x200e, 'LEFT-TO-RIGHT MARK'],
  [0x200f, 'RIGHT-TO-LEFT MARK'],
  // Other directional / invisible format controls.
  [0x061c, 'ARABIC LETTER MARK'],
  [0xfeff, 'ZERO WIDTH NO-BREAK SPACE (BYTE ORDER MARK)'],
  [0x00ad, 'SOFT HYPHEN'],
  [0x034f, 'COMBINING GRAPHEME JOINER'],
]);

// C0 controls (U+0000..U+001F) and U+007F DELETE are forbidden as raw bytes in
// tracked text, EXCEPT the three whitespace controls that legitimately appear in
// source. A NUL flips a file to "binary" in diffs; an embedded ESC can carry a
// terminal escape sequence — neither belongs in tracked text.
export const ALLOWED_CONTROL_CODE_POINTS = new Set([
  0x09, // TAB
  0x0a, // LINE FEED
  0x0d, // CARRIAGE RETURN
]);

// Code point -> name for the C0 controls and DELETE, for clear diagnostics.
export const CONTROL_CODE_POINT_NAMES = new Map([
  [0x00, 'NULL'],
  [0x01, 'START OF HEADING'],
  [0x02, 'START OF TEXT'],
  [0x03, 'END OF TEXT'],
  [0x04, 'END OF TRANSMISSION'],
  [0x05, 'ENQUIRY'],
  [0x06, 'ACKNOWLEDGE'],
  [0x07, 'BELL'],
  [0x08, 'BACKSPACE'],
  [0x0b, 'LINE TABULATION'],
  [0x0c, 'FORM FEED'],
  [0x0e, 'SHIFT OUT'],
  [0x0f, 'SHIFT IN'],
  [0x10, 'DATA LINK ESCAPE'],
  [0x11, 'DEVICE CONTROL ONE'],
  [0x12, 'DEVICE CONTROL TWO'],
  [0x13, 'DEVICE CONTROL THREE'],
  [0x14, 'DEVICE CONTROL FOUR'],
  [0x15, 'NEGATIVE ACKNOWLEDGE'],
  [0x16, 'SYNCHRONOUS IDLE'],
  [0x17, 'END OF TRANSMISSION BLOCK'],
  [0x18, 'CANCEL'],
  [0x19, 'END OF MEDIUM'],
  [0x1a, 'SUBSTITUTE'],
  [0x1b, 'ESCAPE'],
  [0x1c, 'INFORMATION SEPARATOR FOUR'],
  [0x1d, 'INFORMATION SEPARATOR THREE'],
  [0x1e, 'INFORMATION SEPARATOR TWO'],
  [0x1f, 'INFORMATION SEPARATOR ONE'],
  [0x7f, 'DELETE'],
]);

// Name of a forbidden control code point, or undefined when the code point is
// not a forbidden control (i.e. it is ordinary text or an allowed whitespace
// control). Used by both the scanner and the diagnostic formatter.
export function forbiddenControlName(codePoint) {
  if (ALLOWED_CONTROL_CODE_POINTS.has(codePoint)) {
    return undefined;
  }
  if ((codePoint >= 0x00 && codePoint <= 0x1f) || codePoint === 0x7f) {
    return CONTROL_CODE_POINT_NAMES.get(codePoint) ?? 'CONTROL CHARACTER';
  }
  return undefined;
}

// Text file extensions to scan. Anything else (binaries, fonts, PDFs, images)
// is skipped so we never decode non-text content as UTF-8.
export const SCANNED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.jsonc',
  '.md',
  '.ps1',
  '.yml',
  '.yaml',
  '.txt',
  '.sql',
]);

// Path prefixes never scanned even if a stray tracked file matched an
// extension. git ls-files already excludes ignored paths (node_modules, dist,
// local DBs, worktrees), so this is defense-in-depth. The generated SRD
// rules-packs under packages/core/data are intentionally NOT skipped: that is
// the path most likely to carry PDF-extracted SRD text, i.e. the exact class
// of hidden/bidi controls this gate exists to catch, so it is scanned as
// tracked text (Biome excludes it from formatting, but this check must not).
export const SKIPPED_PREFIXES = ['node_modules/', '.git/', 'dist/'];

function lowerExtension(path) {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const base = slash === -1 ? path : path.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

export function shouldScan(path) {
  const normalized = path.replace(/\\/g, '/');
  for (const prefix of SKIPPED_PREFIXES) {
    if (normalized === prefix || normalized.startsWith(prefix)) {
      return false;
    }
    if (normalized.includes(`/${prefix}`)) {
      return false;
    }
  }
  return SCANNED_EXTENSIONS.has(lowerExtension(normalized));
}

export function formatCodePoint(codePoint) {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

// Pure scanner: returns one finding per forbidden code point with 1-based line
// and column (counted in code points, so astral characters count as one).
export function scanContent(content) {
  const findings = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let column = 1;
    for (const ch of lines[i]) {
      const codePoint = ch.codePointAt(0);
      const name =
        FORBIDDEN_CODE_POINTS.get(codePoint) ?? forbiddenControlName(codePoint);
      if (name !== undefined) {
        findings.push({ line: i + 1, column, codePoint, name });
      }
      column += 1;
    }
  }
  return findings;
}

export function formatFinding(path, finding) {
  const label =
    forbiddenControlName(finding.codePoint) !== undefined
      ? 'forbidden control character'
      : 'forbidden hidden/bidi Unicode';
  return `${path}:${finding.line}:${finding.column}: ${label} ${formatCodePoint(
    finding.codePoint,
  )} ${finding.name}`;
}

function listTrackedFiles() {
  const stdout = execFileSync('git', ['ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return stdout.split('\0').filter((entry) => entry !== '');
}

function main() {
  const files = listTrackedFiles().filter(shouldScan);
  const diagnostics = [];
  for (const file of files) {
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      // A tracked path that cannot be read as text (e.g. removed in the work
      // tree) is not our concern; skip it rather than fail the gate.
      continue;
    }
    for (const finding of scanContent(content)) {
      diagnostics.push(formatFinding(file, finding));
    }
  }

  if (diagnostics.length > 0) {
    process.stdout.write(`${diagnostics.join('\n')}\n`);
    process.stderr.write(
      `\nFound ${diagnostics.length} forbidden hidden/bidi Unicode or control character(s) in ${files.length} scanned file(s).\n` +
        'Visible Unicode punctuation (em dash, arrows, curly quotes, degree, etc.) is allowed; invisible/bidirectional Unicode controls and raw C0/DELETE control bytes (except TAB/LF/CR) are blocked.\n',
    );
    process.exit(1);
  }

  process.stdout.write(
    `Scanned ${files.length} tracked text file(s); no forbidden hidden/bidi Unicode characters found.\n`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
