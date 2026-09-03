import { describe, expect, it } from 'vitest';
import {
  replaceParentheticals,
  stripTrailingParenthetical,
  trimEdgeChar,
} from '../src/internal.js';

const fixtures = [
  'Fire Breath (Recharge 5-6)',
  'Cone of Cold (3/Day)',
  'a (x) b (y)',
  'a (x) y)',
  '(x)',
  'unclosed ( paren',
  'no parens',
  '',
  '  (trailing)   ',
  'nested (a (b) c)',
  '(a)(b)',
];

describe('parenthetical name scans', () => {
  it('preserve the original regex behavior', () => {
    for (const input of fixtures) {
      expect(replaceParentheticals(input, ' ')).toBe(
        input.replace(/\([^)]*\)/g, ' '),
      );
      expect(stripTrailingParenthetical(input)).toBe(
        input.replace(/\s*\([^)]*\)\s*$/, ''),
      );
    }
  });

  it('replaceParentheticals handles a long unclosed input linearly', () => {
    const input = '('.repeat(200_000);
    const started = Date.now();
    expect(replaceParentheticals(input, ' ')).toBe(input);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('stripTrailingParenthetical handles a long whitespace run linearly', () => {
    const input = `${' '.repeat(200_000)}(x`;
    const started = Date.now();
    expect(stripTrailingParenthetical(input)).toBe(input);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('trimEdgeChar preserves the original regex behavior', () => {
    const edgeFixtures = [
      '',
      '-',
      '--',
      '-a-',
      '---abc---',
      'a-b',
      'abc',
      '-'.repeat(9),
    ];
    for (const input of edgeFixtures) {
      expect(trimEdgeChar(input, '-')).toBe(input.replace(/^-+|-+$/g, ''));
    }
  });

  it('trimEdgeChar handles a long edge run linearly', () => {
    const input = '-'.repeat(200_000);
    const started = Date.now();
    expect(trimEdgeChar(input, '-')).toBe('');
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
