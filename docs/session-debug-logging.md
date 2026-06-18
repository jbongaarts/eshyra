# Session Debug Logging

Opt-in diagnostics for live gameplay failures (eshyra-iu18). When a turn goes
wrong — a meta response claiming DM tools are unavailable, blank narration,
runaway context — session debug logging records enough **sanitized, structural**
information to reconstruct what each model call actually sent, without leaking
provider credentials.

It is **off by default**. The adapter emits nothing unless you opt in, so there
is zero overhead and no artifact in normal play.

## Enabling it

Set `ESHYRA_DEBUG_SESSION` before running `eshyra play` / `eshyra demo`:

| Value | Mode | What is written |
| --- | --- | --- |
| unset / `0` / `off` / `false` | disabled | nothing |
| `1` / `on` / `true` / `structural` | structural | sizes, section names, counts, ids, labels — **no prompt content** |
| `full` | full capture | structural **plus** a separate, clearly-marked file with the sanitized full prompt/message/tool text |

```bash
# Structural diagnostics (safe to share; no narrative content, no secrets):
ESHYRA_DEBUG_SESSION=1 eshyra play

# Full capture — also writes sanitized prompt content (campaign-private):
ESHYRA_DEBUG_SESSION=full eshyra play
```

The CLI prints a one-line notice when logging is active, and a stronger,
"share with care" notice in `full` mode.

## Where the artifacts go

Under `<data-root>/debug/` (the data root is `~/.eshyra` on macOS/Linux,
`%LOCALAPPDATA%\Eshyra` on Windows, or wherever `ESHYRA_HOME` points):

- `<session-id>.jsonl` — one JSON line per model call (structural; default).
- `<session-id>.sensitive.jsonl` — full sanitized prompt content. Written
  **only** in `full` mode. Treat this as campaign-private.

Each structural line records, per model call:

- campaign / session / turn ids, the loop `purpose` (e.g. `turn_model_loop`),
  and the 1-based model `round`;
- the resolved `model`, `profile`, `tier`, and `authMode` label
  (`api-key` / `oauth-token` — never the credential);
- the `toolProtocolMode` (`fenced-text`), the tool names the core **provided**
  to the client, and the tool names actually **forwarded** to the Agent SDK
  (currently empty — the SDK drives tools through its own harness and the
  fenced-text protocol in the system prompt; the gap between provided and
  forwarded is itself a key diagnostic);
- the system-prompt size and its `## section` breakdown;
- the assembled context's `## section` breakdown (so context growth and
  recap/scene sizing are visible at a glance);
- per-message role/size/structure, total size, and an approximate token count;
- the call outcome (success size + stop reason, or a redacted error).

## Redaction

The structural log contains only sizes, names, counts, ids, and labels — there
is no free text for a secret to hide in. The `full`-mode content file is still
run through the shared secret redactor
(`redactSecrets`, `packages/core/src/memory/turnFailureDiagnostic.ts`), which
strips bearer tokens, `api_key=`/`token:` assignments, `sk-...` keys, and
JWT-shaped triples before anything is written.

Logging is best-effort: a filesystem failure is reported once and then silenced
so debug logging can never destabilize a live turn.

## Packaging logs for a bug report

A session's logs are self-contained files. To attach the structural log for a
failing session:

```bash
# macOS / Linux (adjust the data root if you set ESHYRA_HOME):
cd ~/.eshyra/debug
tar -czf eshyra-debug-<session-id>.tar.gz <session-id>.jsonl

# Or share the single file directly — it is plain JSONL.
```

Prefer the structural `<session-id>.jsonl` for bug reports: it is safe to share
and usually enough to diagnose prompt/tool-protocol mismatches and context
growth. Only attach `<session-id>.sensitive.jsonl` if a maintainer needs the
exact prompt text, and remember it contains your campaign's narrative content.

## Implementation

- Core (provider-neutral structure + redaction):
  `packages/core/src/debug/sessionDebug.ts` builds the structural event and
  optional sanitized content; the `AgentSdkModelClient`
  (`packages/core/src/model/agentSdkClient.ts`) emits one event per
  `complete()` call, on both the success and failure paths.
- CLI (persistence): `packages/cli/src/sessionDebug.ts` turns
  `ESHYRA_DEBUG_SESSION` into a file-backed sink under `<data-root>/debug`.
