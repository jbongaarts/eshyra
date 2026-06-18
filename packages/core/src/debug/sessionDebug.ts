import { redactSecrets } from '../memory/turnFailureDiagnostic.js';
import type { ModelMessage } from '../model/client.js';
import type { ModelToolDefinition } from '../model/toolSchema.js';

/**
 * Opt-in session debug logging (eshyra-iu18).
 *
 * A deliberately small diagnostic layer — not a logging framework. Its job is
 * to make a live gameplay turn reconstructable after the fact: for every model
 * call, what prompt structure and how much of it was sent, which tool protocol
 * was in force, which tools the core handed the client versus which the adapter
 * actually forwarded to the provider, and which model / profile / auth label and
 * campaign / session / turn ids were in play.
 *
 * Two safety rules are baked into the shapes here:
 *
 *  1. **Structural by default.** A {@link ModelCallDebugEvent} carries only
 *     sizes, names, counts, ids, and labels — never prompt or message *content*.
 *     A structural record cannot leak a secret because it contains no free text
 *     to leak one in.
 *  2. **Content capture is separately gated and sanitized.** Full prompt / message
 *     / tool-schema text is attached only when a sink explicitly opts in via
 *     {@link SessionDebugSink.captureContent}, is run through {@link redactSecrets}
 *     first, and is marked sensitive so callers persist it apart from the default
 *     structural log.
 *
 * The core never decides *where* records go — a {@link SessionDebugSink} (the CLI
 * provides a file-backed one under the data root) owns persistence and timestamps.
 */

/** Rough token estimate from a character count (~4 chars/token). Diagnostic-only. */
export function approxTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

/** Name + approximate size of one markdown `## section` of a prompt. */
export interface MarkdownSectionSize {
  /**
   * A *sanitized* section label: either a known Eshyra template heading (e.g.
   * `## Game State`), `(preamble)` for content before the first header, or the
   * generic `## (content)` placeholder for any heading that is not a recognized
   * template label. Arbitrary prompt-derived heading text (player input,
   * persisted narrative, a forged `## secret` line) is NEVER reflected here —
   * only the size is. See {@link sanitizePromptSectionName}.
   */
  readonly name: string;
  readonly chars: number;
  readonly approxTokens: number;
}

/** Placeholder for any heading that is not a recognized template label. */
const UNRECOGNIZED_SECTION = '## (content)';

/**
 * The fixed set of `## ` headings emitted by the DM system prompt
 * (`buildSystemPrompt`) and the assembled-context renderer
 * (`renderContextMessage`). These are code-owned constant strings, so echoing
 * them back in a structural log reveals nothing about campaign content. Any
 * heading outside this set is treated as untrusted prompt-derived text.
 */
const KNOWN_PROMPT_SECTION_LABELS: ReadonlySet<string> = new Set([
  // System prompt:
  '## The Hybrid Contract',
  '## Available Tools',
  '## Tool-Call Protocol',
  // Assembled context:
  '## Campaign Bible',
  '## Arc Summaries',
  '## Recent Sessions',
  '## Party',
  '## Game State',
  '## Current Scene',
  '## Player Input',
]);

/**
 * Map a raw `## ` heading to a label that is safe to persist in a structural
 * debug log. Recognized template headings pass through unchanged; the dynamic
 * `## Current Scene: <title>` heading is collapsed to `## Current Scene` so the
 * (campaign-authored) scene title never leaks; everything else — including a
 * player- or narrative-supplied `## ...` line — becomes the generic
 * {@link UNRECOGNIZED_SECTION} placeholder. The section's size is reported
 * regardless; only the *name* is sanitized.
 */
export function sanitizePromptSectionName(rawName: string): string {
  if (rawName === '(preamble)') {
    return rawName;
  }
  // `## Current Scene: <title>` → `## Current Scene` (drop the title).
  if (rawName.startsWith('## Current Scene:')) {
    return '## Current Scene';
  }
  return KNOWN_PROMPT_SECTION_LABELS.has(rawName)
    ? rawName
    : UNRECOGNIZED_SECTION;
}

/**
 * Split a prompt into its `## ` sections and report each one's *sanitized* label
 * and size. The Eshyra context assembler and DM system prompt both delimit
 * sections with `## ` headers, so this recovers the section breakdown
 * structurally without the assembler having to emit it. Content before the first
 * header (e.g. the DM persona) is reported as `(preamble)`.
 *
 * Crucially, the emitted label is always run through
 * {@link sanitizePromptSectionName}: a heading that is not a recognized template
 * label — which is the only way untrusted player/narrative text could reach a
 * heading — is replaced by a generic placeholder, so a structural log never
 * contains arbitrary prompt-derived heading text. Sizes are still attributed.
 */
export function splitPromptSections(text: string): MarkdownSectionSize[] {
  const sections: MarkdownSectionSize[] = [];
  const lines = text.split('\n');
  let name = '(preamble)';
  let buf: string[] = [];
  const flush = (): void => {
    if (buf.length === 0 && name === '(preamble)' && sections.length > 0) {
      return;
    }
    const chars = buf.join('\n').length;
    // Skip an empty leading preamble, but keep genuine (even empty) named sections.
    if (name === '(preamble)' && chars === 0 && sections.length === 0) {
      return;
    }
    sections.push({
      name: sanitizePromptSectionName(name),
      chars,
      approxTokens: approxTokens(chars),
    });
  };
  for (const line of lines) {
    // Detect a heading with a literal `## ` prefix check — no quantifier-based
    // regex — so a line of all-whitespace can't trigger polynomial backtracking
    // (CodeQL js/polynomial-redos). The heading text is only used to match
    // against the known-label allowlist; it is never persisted verbatim.
    if (line.startsWith('## ')) {
      flush();
      name = `## ${line.slice(3).trim()}`;
      buf = [];
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

/** Size + structure of one conversation message (no content). */
export interface MessageShape {
  readonly index: number;
  readonly role: ModelMessage['role'];
  readonly chars: number;
  readonly approxTokens: number;
  /** Count of native structured tool calls attached to this message. */
  readonly nativeToolCalls: number;
  /** Count of native structured tool results attached to this message. */
  readonly nativeToolResults: number;
  readonly stopReason?: string;
}

function messageShape(message: ModelMessage, index: number): MessageShape {
  return {
    index,
    role: message.role,
    chars: message.content.length,
    approxTokens: approxTokens(message.content.length),
    nativeToolCalls: message.toolCalls?.length ?? 0,
    nativeToolResults: message.toolResults?.length ?? 0,
    ...(message.stopReason ? { stopReason: message.stopReason } : {}),
  };
}

/** Trace identity for a model call, mirrored from `ModelTraceMetadata`. */
export interface ModelCallTrace {
  readonly campaignId?: string;
  readonly sessionId?: string;
  readonly turnId?: string;
  /** Why this call happened, e.g. `turn_model_loop` or `arc_summary`. */
  readonly purpose?: string;
  /** 1-based model round within a turn's tool loop, when applicable. */
  readonly round?: string;
}

/** Outcome of a model call, with any error text already redacted. */
export type ModelCallOutcome =
  | {
      readonly ok: true;
      readonly resultChars: number;
      readonly resultApproxTokens: number;
      readonly stopReason?: string;
    }
  | { readonly ok: false; readonly error: string };

/**
 * Sensitive, fully-captured call content. Present only when a sink opted into
 * content capture (full mode).
 *
 * The prompt-derived strings ({@link system} and each {@link messages} entry)
 * have been passed through {@link redactSecrets}. {@link providedTools} is the
 * verbatim set of code-owned tool definitions handed to the client — static,
 * developer-authored schema (names, descriptions, JSON Schema), not user input
 * or credentials — so it is intentionally NOT redacted and is included as-is for
 * diagnostic fidelity.
 */
export interface ModelCallContent {
  /** Full system prompt, redacted. */
  readonly system?: string;
  /** Full conversation, each message's content redacted. */
  readonly messages: ReadonlyArray<{
    readonly role: ModelMessage['role'];
    readonly content: string;
  }>;
  /** Code-owned tool definitions, verbatim (static schema, not redacted). */
  readonly providedTools: readonly ModelToolDefinition[];
}

/** One model call's structural debug record. Contains no prompt content. */
export interface ModelCallDebugEvent {
  readonly kind: 'model_call';
  readonly trace: ModelCallTrace;
  /** Provider model id the call targeted. */
  readonly model: string;
  /** Resolved profile name, when known to the caller. */
  readonly profile?: string;
  /** Quality tier label, when known. */
  readonly tier?: string;
  /** Auth mode label (`api-key` / `oauth-token`) — never the credential itself. */
  readonly authMode?: string;
  /**
   * Tool protocol in force, e.g. `fenced-text` (the model is instructed to emit
   * fenced `tool_call` blocks) versus a native provider tool channel.
   */
  readonly toolProtocolMode: string;
  /** Tool names the core handed the model client via `ModelCompleteInput.tools`. */
  readonly providedToolNames: readonly string[];
  /**
   * Tool names the adapter actually forwarded to the provider's native tool
   * channel. For the Agent SDK adapter this is empty: it drives tools through
   * its own internal harness and relies on the fenced-text protocol described in
   * the system prompt, so the provider receives no Eshyra tool definitions. The
   * gap between this and {@link providedToolNames} is itself a key diagnostic.
   */
  readonly forwardedToolNames: readonly string[];
  /** System prompt size + section breakdown, or null when no system prompt. */
  readonly system: {
    readonly chars: number;
    readonly approxTokens: number;
    readonly sections: readonly MarkdownSectionSize[];
  } | null;
  /** Per-message size/structure of the conversation handed to the model. */
  readonly messages: readonly MessageShape[];
  /**
   * Section breakdown of the first user message — the assembled bounded context
   * — so context growth and recap/scene sizing are visible at a glance.
   */
  readonly contextSections: readonly MarkdownSectionSize[];
  readonly totalChars: number;
  readonly totalApproxTokens: number;
  readonly outcome: ModelCallOutcome;
  /** Sensitive full content; present only under explicit content capture. */
  readonly content?: ModelCallContent;
}

/** Inputs a model-call site collects to build a {@link ModelCallDebugEvent}. */
export interface BuildModelCallEventInput {
  readonly trace?: ModelCallTrace;
  readonly model: string;
  readonly profile?: string;
  readonly tier?: string;
  readonly authMode?: string;
  readonly toolProtocolMode: string;
  readonly system?: string;
  readonly messages: readonly ModelMessage[];
  readonly providedTools?: readonly ModelToolDefinition[];
  readonly forwardedToolNames?: readonly string[];
  readonly outcome: ModelCallOutcome;
  /** When true, attach sanitized full content (sink opted into capture). */
  readonly captureContent: boolean;
}

/**
 * Build the structural model-call event (plus optional sanitized content) from
 * the raw call inputs. Pure: the same inputs always yield the same record, and
 * it never reads a clock or the environment.
 */
export function buildModelCallEvent(
  input: BuildModelCallEventInput,
): ModelCallDebugEvent {
  const messages = input.messages.map((m, i) => messageShape(m, i));
  const systemChars = input.system?.length ?? 0;
  const totalChars =
    systemChars + input.messages.reduce((sum, m) => sum + m.content.length, 0);
  const firstUser = input.messages.find((m) => m.role === 'user');
  const providedTools = input.providedTools ?? [];
  return {
    kind: 'model_call',
    trace: input.trace ?? {},
    model: input.model,
    ...(input.profile ? { profile: input.profile } : {}),
    ...(input.tier ? { tier: input.tier } : {}),
    ...(input.authMode ? { authMode: input.authMode } : {}),
    toolProtocolMode: input.toolProtocolMode,
    providedToolNames: providedTools.map((t) => t.name),
    forwardedToolNames: input.forwardedToolNames ?? [],
    system:
      input.system === undefined
        ? null
        : {
            chars: systemChars,
            approxTokens: approxTokens(systemChars),
            sections: splitPromptSections(input.system),
          },
    messages,
    contextSections:
      firstUser === undefined ? [] : splitPromptSections(firstUser.content),
    totalChars,
    totalApproxTokens: approxTokens(totalChars),
    outcome: input.outcome,
    ...(input.captureContent
      ? {
          content: {
            ...(input.system !== undefined
              ? { system: redactSecrets(input.system) }
              : {}),
            messages: input.messages.map((m) => ({
              role: m.role,
              content: redactSecrets(m.content),
            })),
            providedTools,
          },
        }
      : {}),
  };
}

/**
 * Destination for session debug events. The core emits events; an implementation
 * (the CLI's file-backed sink) stamps a timestamp and persists them under the
 * data root. A sink that wants full prompt/message capture sets
 * {@link captureContent} to `true`, which both flips event construction to attach
 * sanitized content and signals the sink to route that content to a separate,
 * clearly-sensitive artifact.
 */
export interface SessionDebugSink {
  /**
   * Whether this sink wants sanitized full content attached to events. Callers
   * read it to decide what to pass as `captureContent` to
   * {@link buildModelCallEvent}.
   */
  readonly captureContent: boolean;
  /** Persist one debug event. Implementations must never throw into the turn. */
  record(event: ModelCallDebugEvent): void;
}
