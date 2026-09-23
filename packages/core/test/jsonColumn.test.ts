import { describe, expect, it } from 'vitest';
import { JsonColumnError, jsonColumn } from '../src/persistence/jsonColumn.js';

describe('jsonColumn codec', () => {
  it('round-trips a typed value through encode and decode', () => {
    const codec = jsonColumn<{ a: number; tags: string[] }>('demo.col');
    const encoded = codec.encode({ a: 1, tags: ['x', 'y'] });
    expect(typeof encoded).toBe('string');
    expect(codec.decode(encoded)).toEqual({ a: 1, tags: ['x', 'y'] });
  });

  it('rejects a value that is not JSON-serializable', () => {
    const codec = jsonColumn<unknown>('demo.col');
    expect(() => codec.encode(1n)).toThrow(JsonColumnError); // BigInt throws
    expect(() => codec.encode(undefined)).toThrow(JsonColumnError); // -> no output
    expect(() => codec.encode(() => 0)).toThrow(JsonColumnError); // -> no output
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => codec.encode(circular)).toThrow(JsonColumnError); // circular
  });

  it('rejects invalid JSON on decode', () => {
    const codec = jsonColumn<unknown>('demo.col');
    expect(() => codec.decode('{ not json')).toThrow(JsonColumnError);
  });
});
