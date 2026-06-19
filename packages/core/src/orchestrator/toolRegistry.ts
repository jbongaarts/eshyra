/**
 * Core tool contract types, shared helpers, and the ToolRegistry class.
 * Individual tools live in their own modules; this module is the provider-neutral seam.
 */

import type {
  ModelToolDefinition,
  ToolInputSchema,
} from '../model/toolSchema.js';
import { validateToolInput } from '../model/toolSchemaValidation.js';
import {
  CharacterResolutionError,
  resolveCharacterRef,
} from '../state/activeCharacter.js';

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; code: string; message: string };

export interface ToolContext {
  db: import('../persistence/db.js').Db;
  rng: import('./rng.js').Rng;
  campaignId: string;
  sessionId: string;
  turnId: string;
  /** ISO timestamp stamped on every write this turn. */
  at: string;
  /**
   * The party member acting on this turn. Character-scoped tools target this
   * PC by default; when undefined they fall back to the active character
   * (`meta.active_character_id`). An explicit per-call `character` argument
   * (where a tool supports one) overrides both.
   */
  actingCharacterId?: string;
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  /**
   * Whether this tool writes campaign/session/character canon (eshyra-dwkm).
   * `true` for any tool that mutates persisted state; `false` for a pure
   * read/query/dice tool that only inspects state or computes a value. This is
   * a REQUIRED, explicit classification — not an inference — so the orchestrator
   * can reason about which of a candidate turn's tool effects must be discarded
   * if the turn auditor rejects the candidate or a retry fails. The per-turn
   * SAVEPOINT already wraps *all* tool writes (read-only tools write nothing, so
   * wrapping them is harmless); this flag exists so a turn's committed-vs-rolled
   * -back tool effects are explicit in traces/debug rather than guessed at.
   */
  readonly mutates: boolean;
  /**
   * Whether this tool requires explicit player action intent to call (eshyra-4ia4).
   * When `true`, the model must only call this tool when the player is explicitly
   * doing something — receiving, granting, or removing items, etc. — NOT merely
   * in response to a question about current state. The system prompt uses this
   * classification to draw a bright line around these tools; future auditor or
   * gating logic can also consult it without requiring tool-definition changes.
   */
  readonly requiresExplicitAction?: boolean;
  /**
   * Provider-neutral input schema (eshyra-0jq.10). Lifted straight into
   * {@link ToolRegistry.definitions} so adapters can render native tool calls;
   * {@link ToolRegistry.invoke} enforces it before `run`. Tool authors remain
   * responsible for semantic/runtime validation that the schema cannot express.
   */
  readonly inputSchema: ToolInputSchema;
  run(args: unknown, ctx: ToolContext): ToolResult;
}

export function ok(data: unknown): ToolResult {
  return { ok: true, data };
}

export function err(code: string, message: string): ToolResult {
  return { ok: false, code, message };
}

export function asRecord(args: unknown): Record<string, unknown> | undefined {
  return typeof args === 'object' && args !== null && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : undefined;
}

/** Shared JSON-schema fragment for the optional `character` targeting arg. */
export const CHARACTER_TARGET_SCHEMA = {
  type: 'string',
  description:
    'Party member to target by id or name. Defaults to the acting character.',
  minLength: 1,
} as const;

/**
 * Resolve an optional `character` tool argument to a target character id.
 * Returns `{ id }` (where `id` is undefined to mean "the acting/active PC")
 * on success, or an error `ToolResult` when the ref is malformed, unknown, or
 * ambiguous so the tool can hand the correction back to the model.
 */
export function resolveTargetCharacterId(
  character: unknown,
  ctx: ToolContext,
): { id: string | undefined } | ToolResult {
  if (character === undefined || character === null) {
    return { id: ctx.actingCharacterId };
  }
  if (typeof character !== 'string' || character.length === 0) {
    return err(
      'invalid_args',
      'character must be a non-empty string id or name',
    );
  }
  try {
    return { id: resolveCharacterRef(ctx.db, character) };
  } catch (e) {
    if (e instanceof CharacterResolutionError) {
      return err('invalid_target', e.message);
    }
    throw e;
  }
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): string[] {
    return [...this.tools.keys()];
  }

  /**
   * Names of tools that require explicit player action intent (eshyra-4ia4).
   * These tools must only be called when the player is explicitly doing something,
   * not merely in response to a question about current state.
   */
  listRequiresExplicitAction(): string[] {
    return [...this.tools.values()]
      .filter((t) => t.requiresExplicitAction)
      .map((t) => t.name);
  }

  /**
   * Whether the named tool writes canon (eshyra-dwkm). An unknown tool is
   * treated as mutating: a call the registry cannot classify must be assumed to
   * have side effects so callers never under-stage a candidate's effects. A
   * tool that never executed (parse/validation error) has no effect regardless;
   * callers that record dispositions should consult the actual tool result, not
   * just this classification.
   */
  isMutating(name: string): boolean {
    return this.tools.get(name)?.mutates ?? true;
  }

  /**
   * Provider-neutral tool definitions in registration order. Each entry has the
   * (name, description, inputSchema) triple a ModelClient adapter needs to
   * render native tool calls — no provider-specific keys leak through.
   */
  definitions(): readonly ModelToolDefinition[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  invoke(name: string, args: unknown, ctx: ToolContext): ToolResult {
    const tool = this.tools.get(name);
    if (tool === undefined) {
      return err('unknown_tool', `unknown tool: ${name}`);
    }
    const schemaError = validateToolInput(tool.inputSchema, args);
    if (schemaError) {
      return err(
        'invalid_args',
        `${name} arguments failed schema validation: ${schemaError}`,
      );
    }
    try {
      return tool.run(args, ctx);
    } catch (e) {
      return err('tool_error', e instanceof Error ? e.message : String(e));
    }
  }
}
