import { describe, expect, it } from 'vitest';
import { resolveJsonPointer } from '../src/rules/jsonPointer.js';

// Strict RFC 6901 semantics shared by validate.ts and the SRD importer's
// locator-completeness gate (eshyra-o9bd.19.2.2.3).
describe('resolveJsonPointer', () => {
  const data = JSON.parse(
    '{"a":{"b":[10,20,{"c":"x"}]},"s/t":1,"m~n":2,"":3,"z":null}',
  );

  it.each([
    ['', data],
    ['/a/b/0', 10],
    ['/a/b/1', 20],
    ['/a/b/2/c', 'x'],
    ['/s~1t', 1],
    ['/m~0n', 2],
    ['/', 3],
    ['/z', null],
  ])('resolves %j', (pointer, value) => {
    expect(resolveJsonPointer(data, pointer)).toEqual({ found: true, value });
  });

  it.each([
    // inherited, not own, properties
    '/toString',
    '/constructor',
    '/__proto__',
    '/a/hasOwnProperty',
    '/a/b/length',
    // non-canonical or out-of-range array index tokens
    '/a/b/01',
    '/a/b/00',
    '/a/b/-',
    '/a/b/1.0',
    '/a/b/+1',
    '/a/b/ 1',
    '/a/b/3',
    // invalid escapes, missing leading slash, descent through a scalar
    '/m~2n',
    '/s~t',
    'a',
    '/a/b/0/x',
    '/z/x',
  ])('does not resolve %j', (pointer) => {
    expect(resolveJsonPointer(data, pointer)).toEqual({ found: false });
  });
});
