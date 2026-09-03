/**
 * Replace parenthetical spans without the polynomial backtracking reported by
 * CodeQL's js/polynomial-redos rule. This is exactly equivalent to
 * `text.replace(/\([^)]*\)/g, replacement)`: each opening parenthesis pairs
 * with the first following closing parenthesis, and an unclosed span is kept.
 */
export function replaceParentheticals(
  text: string,
  replacement: string,
): string {
  let out = '';
  let from = 0;
  for (;;) {
    const open = text.indexOf('(', from);
    if (open === -1) break;
    const close = text.indexOf(')', open + 1);
    if (close === -1) break;
    out += text.slice(from, open) + replacement;
    from = close + 1;
  }
  return out + text.slice(from);
}

/**
 * Strip a trailing parenthetical without the polynomial backtracking reported
 * by CodeQL's js/polynomial-redos rule. This is exactly equivalent to
 * `text.replace(/\s*\([^)]*\)\s*$/, '')`; trimEnd uses the same whitespace set
 * as the regex's `\s*`. When the text ends in `)`, the opening parenthesis is
 * the leftmost `(` after the last interior `)`.
 */
export function stripTrailingParenthetical(text: string): string {
  const end = text.trimEnd().length;
  if (end === 0 || text[end - 1] !== ')') return text;
  const lastClose = end >= 2 ? text.lastIndexOf(')', end - 2) : -1;
  const open = text.indexOf('(', lastClose + 1);
  if (open === -1 || open >= end - 1) return text;
  return text.slice(0, open).trimEnd();
}

/**
 * Trim leading and trailing runs of `ch` without the polynomial backtracking
 * reported by CodeQL's js/polynomial-redos rule. Exactly equivalent to
 * `text.replace(/^<ch>+|<ch>+$/g, '')` for a single non-special character.
 */
export function trimEdgeChar(text: string, ch: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === ch) start += 1;
  while (end > start && text[end - 1] === ch) end -= 1;
  return text.slice(start, end);
}
