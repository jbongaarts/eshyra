import { z } from 'zod/v4';
import type {
  JsonSchema,
  JsonSchemaType,
  ToolInputSchema,
} from './toolSchema.js';

/**
 * Convert the Eshyra provider-neutral tool-input schema (a deliberate JSON
 * Schema subset, see {@link import('./toolSchema.js').JsonSchema}) into the Zod
 * shape the Claude Agent SDK's `tool()` helper requires (eshyra-eznk).
 *
 * The Agent SDK in-process MCP path declares custom tools with `tool(name,
 * description, inputSchema, handler)` where `inputSchema` is a Zod *raw shape*
 * (a `{ [property]: ZodType }` record), not JSON Schema. The SDK turns that shape
 * back into JSON Schema when it advertises the tool to the model, so a faithful
 * conversion here is what gives the model accurate parameter hints.
 *
 * Only the subset `toolSchema.ts` documents is handled; keywords outside it
 * (`$ref`, `if`/`then`/`else`, ...) are intentionally not emitted because no
 * bundled tool uses them. Deterministic argument validation still happens in
 * `ToolRegistry.invoke` against the original JSON Schema — this conversion exists
 * for model-facing schema fidelity, not as the authoritative validator.
 */

type ZodType = z.ZodTypeAny;

/** Build the top-level Zod raw shape `tool()` expects from an object schema. */
export function toolInputSchemaToZodShape(
  schema: ToolInputSchema,
): z.ZodRawShape {
  const required = new Set(schema.required ?? []);
  const shape: Record<string, ZodType> = {};
  for (const [key, propSchema] of Object.entries(schema.properties)) {
    const zodType = jsonSchemaToZod(propSchema);
    shape[key] = required.has(key) ? zodType : zodType.optional();
  }
  return shape;
}

/** Convert a single {@link JsonSchema} fragment to a Zod type. */
export function jsonSchemaToZod(schema: JsonSchema): ZodType {
  return describe(buildBase(schema), schema.description);
}

function describe(zodType: ZodType, description?: string): ZodType {
  return description === undefined ? zodType : zodType.describe(description);
}

function buildBase(schema: JsonSchema): ZodType {
  // Composition keywords take precedence: a branch list maps to a union.
  if (schema.oneOf && schema.oneOf.length > 0) {
    return unionOf(schema.oneOf.map(jsonSchemaToZod));
  }
  if (schema.anyOf && schema.anyOf.length > 0) {
    return unionOf(schema.anyOf.map(jsonSchemaToZod));
  }
  // A bare `enum` (no `type`) is a closed set of literal values.
  if (schema.enum && schema.enum.length > 0 && schema.type === undefined) {
    return enumOf(schema.enum);
  }
  // A `type` array (e.g. `['string', 'null']`) is a union of per-type schemas.
  // `Array.isArray` does not narrow a `readonly` array, so branch on a local.
  const type = schema.type;
  if (Array.isArray(type)) {
    return unionOf(type.map((t) => buildForType(t, schema)));
  }
  if (type !== undefined) {
    return buildForType(type as JsonSchemaType, schema);
  }
  // No type and no composition: accept anything (the registry still validates).
  return z.unknown();
}

function buildForType(type: JsonSchemaType, schema: JsonSchema): ZodType {
  switch (type) {
    case 'string':
      return stringSchema(schema);
    case 'number':
      return numberSchema(z.number(), schema);
    case 'integer':
      return numberSchema(z.number().int(), schema);
    case 'boolean':
      return z.boolean();
    case 'null':
      return z.null();
    case 'array':
      return arraySchema(schema);
    case 'object':
      return objectSchema(schema);
    default:
      return z.unknown();
  }
}

function stringSchema(schema: JsonSchema): ZodType {
  if (schema.enum && schema.enum.length > 0) {
    return enumOf(schema.enum);
  }
  let s = z.string();
  if (schema.minLength !== undefined) s = s.min(schema.minLength);
  if (schema.maxLength !== undefined) s = s.max(schema.maxLength);
  if (schema.pattern !== undefined) s = s.regex(new RegExp(schema.pattern));
  return s;
}

function numberSchema(base: z.ZodNumber, schema: JsonSchema): ZodType {
  let n = base;
  if (schema.minimum !== undefined) n = n.min(schema.minimum);
  if (schema.maximum !== undefined) n = n.max(schema.maximum);
  return n;
}

function arraySchema(schema: JsonSchema): ZodType {
  const items = schema.items ? jsonSchemaToZod(schema.items) : z.unknown();
  let a = z.array(items);
  if (schema.minItems !== undefined) a = a.min(schema.minItems);
  if (schema.maxItems !== undefined) a = a.max(schema.maxItems);
  return a;
}

function objectSchema(schema: JsonSchema): ZodType {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const shape: Record<string, ZodType> = {};
  for (const [key, propSchema] of Object.entries(properties)) {
    const zodType = jsonSchemaToZod(propSchema);
    shape[key] = required.has(key) ? zodType : zodType.optional();
  }
  // `additionalProperties: false` closes the object; anything else stays open so
  // a tool that accepts extra keys is not over-constrained for the model.
  return schema.additionalProperties === false
    ? z.strictObject(shape)
    : z.object(shape);
}

function enumOf(
  values: readonly (string | number | boolean | null)[],
): ZodType {
  return unionOf(values.map((v) => (v === null ? z.null() : z.literal(v))));
}

/**
 * A Zod union needs at least two members; collapse a single-member list to that
 * member so a one-branch `oneOf` or single-value `enum` is still valid.
 */
function unionOf(members: readonly ZodType[]): ZodType {
  if (members.length === 0) return z.unknown();
  if (members.length === 1) return members[0];
  return z.union(members as [ZodType, ZodType, ...ZodType[]]);
}
