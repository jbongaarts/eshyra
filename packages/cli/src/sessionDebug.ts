import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ModelCallDebugEvent,
  SessionDebugSink,
  TurnAuditDebugEvent,
} from '@eshyra/core/internal';
import { debugDir } from './dataRoot.js';

/**
 * Opt-in session debug logging — CLI persistence layer (eshyra-iu18).
 *
 * The core emits structural {@link ModelCallDebugEvent}s; this module turns
 * `ESHYRA_DEBUG_SESSION` into a file-backed {@link SessionDebugSink} that writes
 * per-session JSONL artifacts under `<data-root>/debug`. Modes:
 *
 *  - unset / `0` / `off` / `false` — disabled; no sink is built and the adapter
 *    stays silent (the zero-overhead default).
 *  - `1` / `on` / `structural` — structural logs only: prompt section names and
 *    sizes, message structure, tool protocol, tool names, and model/profile/auth
 *    labels. No prompt content, so nothing to leak.
 *  - `full` — structural logs PLUS a separate, clearly-marked `*.sensitive.jsonl`
 *    file containing the sanitized full prompt/message/tool text. Secrets are
 *    redacted first, but this still captures campaign-private narrative content,
 *    so it is gated behind its own mode and written apart from the default log.
 */
export type SessionDebugMode = 'off' | 'structural' | 'full';

/** Parse `ESHYRA_DEBUG_SESSION` into a {@link SessionDebugMode}. */
export function resolveSessionDebugMode(
  env: Record<string, string | undefined> = process.env,
): SessionDebugMode {
  const raw = env.ESHYRA_DEBUG_SESSION?.trim().toLowerCase();
  if (!raw || raw === '0' || raw === 'off' || raw === 'false') {
    return 'off';
  }
  if (raw === 'full') {
    return 'full';
  }
  // `1`, `on`, `true`, `structural`, or any other truthy value.
  return 'structural';
}

/** Replace anything outside a safe filename charset so ids can't escape `dir`. */
function safeName(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned.length > 0 ? cleaned : 'unknown-session';
}

export interface CreateSessionDebugSinkOptions {
  /** Directory to write per-session JSONL into (e.g. `<data-root>/debug`). */
  readonly dir: string;
  /** When true, also write the sanitized full-content `*.sensitive.jsonl`. */
  readonly captureContent: boolean;
  /** ISO timestamp source; injectable for deterministic tests. */
  readonly now?: () => string;
  /** Sink-failure reporter; defaults to `console.error`. Called at most once. */
  readonly warn?: (message: string) => void;
}

/**
 * Build a file-backed {@link SessionDebugSink}. Writes are append-only and
 * best-effort: a filesystem failure is reported once and then silenced so debug
 * logging can never destabilize a live turn.
 */
export function createFileSessionDebugSink(
  options: CreateSessionDebugSinkOptions,
): SessionDebugSink {
  const now = options.now ?? (() => new Date().toISOString());
  let dirReady = false;
  let warned = false;
  const warn = (message: string): void => {
    if (warned) {
      return;
    }
    warned = true;
    (options.warn ?? ((m: string) => console.error(m)))(message);
  };

  const appendStructural = (
    sessionId: string | undefined,
    line: unknown,
  ): void => {
    if (!dirReady) {
      mkdirSync(options.dir, { recursive: true });
      dirReady = true;
    }
    const session = safeName(sessionId ?? 'unknown-session');
    appendFileSync(
      join(options.dir, `${session}.jsonl`),
      `${JSON.stringify({ at: now(), ...(line as object) })}\n`,
    );
  };

  return {
    captureContent: options.captureContent,
    record(event: ModelCallDebugEvent): void {
      try {
        // Structural log: strip any captured content so the default artifact is
        // never sensitive.
        const { content, ...structural } = event;
        appendStructural(event.trace.sessionId, structural);
        if (options.captureContent && content !== undefined) {
          if (!dirReady) {
            mkdirSync(options.dir, { recursive: true });
            dirReady = true;
          }
          appendFileSync(
            join(
              options.dir,
              `${safeName(event.trace.sessionId ?? 'unknown-session')}.sensitive.jsonl`,
            ),
            `${JSON.stringify({ at: now(), ...event })}\n`,
          );
        }
      } catch (err) {
        warn(
          `session debug logging failed (continuing without it): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    },
    // Mechanics-audit verdicts (eshyra-oobh) are structural by construction —
    // names, counts, and labels only — so they go straight into the default log.
    recordAudit(event: TurnAuditDebugEvent): void {
      try {
        appendStructural(event.trace.sessionId, event);
      } catch (err) {
        warn(
          `session debug logging failed (continuing without it): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    },
  };
}

export interface ResolvedSessionDebug {
  readonly mode: SessionDebugMode;
  readonly sink?: SessionDebugSink;
  /** A one-line notice to print when a mode is active (sensitive for `full`). */
  readonly notice?: string;
}

/**
 * Resolve the debug mode from the environment and, when enabled, build a sink
 * rooted at `<dataRoot>/debug`. Returns the mode plus an optional sink and a
 * human notice the caller can print so the player knows logging is on (and, for
 * `full`, that sensitive content is being captured).
 */
export function resolveSessionDebug(
  dataRoot: string,
  env: Record<string, string | undefined> = process.env,
): ResolvedSessionDebug {
  const mode = resolveSessionDebugMode(env);
  if (mode === 'off') {
    return { mode };
  }
  const dir = debugDir(dataRoot);
  const sink = createFileSessionDebugSink({
    dir,
    captureContent: mode === 'full',
  });
  const notice =
    mode === 'full'
      ? `Session debug logging: FULL capture enabled — sanitized prompt content is written to ${dir}/<session>.sensitive.jsonl (campaign-private; share with care).`
      : `Session debug logging: structural diagnostics written to ${dir}/<session>.jsonl.`;
  return { mode, sink, notice };
}
