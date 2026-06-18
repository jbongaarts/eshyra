import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import {
  jsonSchemaToZod,
  toolInputSchemaToZodShape,
} from '../src/model/jsonSchemaToZod.js';
import type { ToolInputSchema } from '../src/model/toolSchema.js';

/**
 * Unit coverage for the Eshyra JSON-Schema-subset → Zod shape conversion that
 * feeds the Agent SDK `tool()` helper (eshyra-eznk). The conversion is what gives
 * the model accurate parameter hints, so it must faithfully reflect required vs.
 * optional fields, primitive types, enums, arrays, nesting, and composition.
 */
describe('toolInputSchemaToZodShape', () => {
  it('marks required properties required and others optional', () => {
    const schema: ToolInputSchema = {
      type: 'object',
      properties: {
        dice: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['dice'],
      additionalProperties: false,
    };
    const obj = z.object(toolInputSchemaToZodShape(schema));

    expect(obj.safeParse({ dice: '1d20' }).success).toBe(true);
    expect(obj.safeParse({ reason: 'no dice' }).success).toBe(false);
    expect(obj.safeParse({ dice: '1d20', reason: 'attack' }).success).toBe(
      true,
    );
  });

  it('rejects a wrong primitive type for a converted property', () => {
    const obj = z.object(
      toolInputSchemaToZodShape({
        type: 'object',
        properties: { amount: { type: 'integer' } },
        required: ['amount'],
        additionalProperties: false,
      }),
    );
    expect(obj.safeParse({ amount: 3 }).success).toBe(true);
    expect(obj.safeParse({ amount: 3.5 }).success).toBe(false);
    expect(obj.safeParse({ amount: 'three' }).success).toBe(false);
  });
});

describe('jsonSchemaToZod', () => {
  it('converts a string enum to a closed set of values', () => {
    const zt = jsonSchemaToZod({ type: 'string', enum: ['open', 'close'] });
    expect(zt.safeParse('open').success).toBe(true);
    expect(zt.safeParse('halt').success).toBe(false);
  });

  it('honors numeric bounds', () => {
    const zt = jsonSchemaToZod({ type: 'number', minimum: 1, maximum: 6 });
    expect(zt.safeParse(4).success).toBe(true);
    expect(zt.safeParse(0).success).toBe(false);
    expect(zt.safeParse(7).success).toBe(false);
  });

  it('converts arrays with item schemas', () => {
    const zt = jsonSchemaToZod({ type: 'array', items: { type: 'string' } });
    expect(zt.safeParse(['a', 'b']).success).toBe(true);
    expect(zt.safeParse(['a', 2]).success).toBe(false);
  });

  it('converts nested object schemas with their own required fields', () => {
    const zt = jsonSchemaToZod({
      type: 'object',
      properties: {
        id: { type: 'string' },
        qty: { type: 'integer' },
      },
      required: ['id'],
    });
    expect(zt.safeParse({ id: 'sword' }).success).toBe(true);
    expect(zt.safeParse({ qty: 1 }).success).toBe(false);
  });

  it('converts oneOf/anyOf composition to a union', () => {
    const zt = jsonSchemaToZod({
      oneOf: [{ type: 'string' }, { type: 'number' }],
    });
    expect(zt.safeParse('x').success).toBe(true);
    expect(zt.safeParse(3).success).toBe(true);
    expect(zt.safeParse(true).success).toBe(false);
  });

  it('treats a type array as a union of those types', () => {
    const zt = jsonSchemaToZod({ type: ['string', 'null'] });
    expect(zt.safeParse('x').success).toBe(true);
    expect(zt.safeParse(null).success).toBe(true);
    expect(zt.safeParse(3).success).toBe(false);
  });

  it('falls back to an accept-anything schema with neither type nor composition', () => {
    const zt = jsonSchemaToZod({ description: 'freeform' });
    expect(zt.safeParse({ anything: true }).success).toBe(true);
    expect(zt.safeParse('also fine').success).toBe(true);
  });
});
