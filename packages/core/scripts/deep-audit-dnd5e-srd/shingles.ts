/**
 * Token-shingle primitives for the deep pre-freeze SRD audit
 * (eshyra-o9bd.18.9.1).
 *
 * Ports the core of the 2026-07-01 independent audit harness
 * (~/src/dnd5e-srd-audit-harness-070126, Python) into durable repo tooling.
 * The idea: normalize both the extracted PDF text and the generated pack's
 * record strings into hyphen/apostrophe-free lowercase token streams, then
 * verify each side against the other with fixed-size token n-grams
 * ("shingles"). A run of tokens on a page that no record reproduces — or a
 * run in a record that its cited pages don't print — survives any amount of
 * reflowing, dehyphenation, or column-order noise that plain substring
 * comparison would trip on.
 *
 * Everything here is pure and deterministic; the orchestration (PDF
 * extraction, pack loading, report writing) lives in `cli.ts`.
 */

export const GRAM_SIZE = 6;
/** Report uncovered token runs at least this long (page/record checks). */
export const MIN_RUN = 4;

const HYPHEN_RUN = /[\u00AD‐‑−–—-]+/g;

/**
 * Normalize text so record strings and PDF-extracted text compare equal:
 * curly quotes/ellipsis/fraction glyphs to ASCII, hyphen-family runs to a
 * single '-', whitespace collapsed, lowercased.
 */
export function normalizeForShingles(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/½/g, ' 1/2 ')
    .replace(HYPHEN_RUN, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Shingle tokens: hyphens and apostrophes removed entirely so line-break
 * hyphenation, compound-word, and possessive-glyph differences vanish on
 * both sides; the rest split on `[a-z0-9/]+` runs.
 */
export function shingleTokens(text: string): readonly string[] {
  const normalized = normalizeForShingles(text)
    .replace(/-/g, '')
    .replace(/'/g, '');
  return normalized.match(/[a-z0-9/]+/g) ?? [];
}

/**
 * Page-side token stream with the pdfjs small-caps repair: the extractor
 * sometimes splits a small-caps final letter into its own item ("Sense s"),
 * so a stray standalone "s" merges into the preceding word — but only when
 * the fused word actually exists in the pack vocabulary, so real one-letter
 * tokens survive.
 */
export function pageTokens(
  text: string,
  vocabulary: ReadonlySet<string>,
): readonly string[] {
  const raw = shingleTokens(text);
  const merged: string[] = [];
  for (const token of raw) {
    const previous = merged[merged.length - 1];
    if (
      token === 's' &&
      previous !== undefined &&
      previous.length >= 3 &&
      /^[a-z]+$/.test(previous) &&
      vocabulary.has(`${previous}s`)
    ) {
      merged[merged.length - 1] = `${previous}s`;
    } else {
      merged.push(token);
    }
  }
  return merged;
}

const GRAM_JOIN = '\u001F';

export function gramKey(tokens: readonly string[]): string {
  return tokens.join(GRAM_JOIN);
}

/**
 * Add every `GRAM_SIZE`-gram of `tokens` to `grams`; a string shorter than
 * one gram contributes its whole token tuple instead (the "short string"
 * form, matched wholesale by `coverTokens`' short-run rescue).
 */
export function addGrams(
  tokens: readonly string[],
  grams: Set<string>,
  shortStrings: Set<string>,
): void {
  if (tokens.length === 0) return;
  if (tokens.length < GRAM_SIZE) {
    shortStrings.add(gramKey(tokens));
    return;
  }
  for (let i = 0; i + GRAM_SIZE <= tokens.length; i++) {
    grams.add(gramKey(tokens.slice(i, i + GRAM_SIZE)));
  }
}

export interface UncoveredRun {
  /** Tokens in the run. */
  readonly tokens: readonly string[];
  /** Run start index in the input token stream. */
  readonly start: number;
}

/**
 * Mark every token covered by a `GRAM_SIZE`-gram present in `grams`, then
 * return the uncovered runs of at least `minRun` tokens. A short input
 * (fewer than `GRAM_SIZE` tokens) is covered when its whole tuple is a
 * known short string.
 */
export function uncoveredRuns(
  tokens: readonly string[],
  grams: ReadonlySet<string>,
  shortStrings: ReadonlySet<string>,
  minRun: number = MIN_RUN,
): readonly UncoveredRun[] {
  if (tokens.length === 0) return [];
  if (tokens.length < GRAM_SIZE) {
    return shortStrings.has(gramKey(tokens)) ? [] : [{ tokens, start: 0 }];
  }
  const covered = new Array<boolean>(tokens.length).fill(false);
  for (let i = 0; i + GRAM_SIZE <= tokens.length; i++) {
    if (grams.has(gramKey(tokens.slice(i, i + GRAM_SIZE)))) {
      for (let j = i; j < i + GRAM_SIZE; j++) covered[j] = true;
    }
  }
  const runs: UncoveredRun[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (covered[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < tokens.length && !covered[j]) j++;
    if (j - i >= minRun) {
      runs.push({ tokens: tokens.slice(i, j), start: i });
    }
    i = j;
  }
  return runs;
}

/**
 * Merge PDF-extracted lines, undoing end-of-line hyphenation: a line ending
 * in a hyphen glues directly (hyphen dropped) onto the next line, everything
 * else joins with a space. Token-level hyphen removal in `shingleTokens`
 * already absorbs most hyphenation; this catches the page side where the
 * split halves would otherwise tokenize separately.
 */
export function joinDehyphenated(lines: readonly string[]): string {
  let out = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (out.endsWith('-')) {
      out = out.slice(0, -1) + trimmed;
    } else {
      out = out.length === 0 ? trimmed : `${out} ${trimmed}`;
    }
  }
  return out;
}

/** The SRD page footer ("System Reference Document 5.1 <n>"), dropped from
 * page streams so it never reports as uncovered content. */
export function isPageFooter(line: string): boolean {
  return /^system reference document\s+5\.1\s+\d+$/i.test(
    normalizeForShingles(line),
  );
}

const DICE_PATTERN = /^(\d+)d(\d+)(?:\s*([+−-])\s*(\d+))?$/;

/** Floored mean of a printed dice expression ("18d10 + 36"), or null when
 * the text is not a plain dice expression. 5e rounds down. */
export function diceFormulaAverage(formula: string): number | null {
  const match = DICE_PATTERN.exec(formula.replace(/−/g, '-').trim());
  if (match === null) return null;
  const count = Number(match[1]);
  const sides = Number(match[2]);
  let average = (count * (sides + 1)) / 2;
  if (match[3] !== undefined && match[4] !== undefined) {
    const modifier = Number(match[4]);
    average += match[3] === '+' ? modifier : -modifier;
  }
  return Math.floor(average);
}

/** All page numbers named by a provenance locator ("p. 261", "pp. 93, 94"). */
export function locatorPages(locator: string): readonly number[] {
  return (locator.match(/\d+/g) ?? []).map(Number);
}

/** Walk every string leaf of a record's data, with dotted paths. */
export function walkStrings(
  value: unknown,
  path: string,
  out: Array<{ readonly path: string; readonly text: string }>,
): void {
  if (typeof value === 'string') {
    out.push({ path, text: value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walkStrings(item, `${path}[${index}]`, out);
    });
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      walkStrings(child, path.length === 0 ? key : `${path}.${key}`, out);
    }
  }
}
