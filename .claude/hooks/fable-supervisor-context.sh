#!/usr/bin/env bash
# SessionStart hook: inject the Codex-subagent supervisor workflow, but only
# into a main-agent Claude Code session running a Fable-class model.
#
# Scoping this relies on:
#   - Codex never executes Claude Code hooks, so Codex-driven sessions can't
#     reach this script at all.
#   - SessionStart fires only for the main session (subagents get the separate
#     SubagentStart event, which is not registered) — the agent_id check below
#     is belt-and-braces.
#   - The hook input's optional "model" field gates on Fable. If the field is
#     absent (older CLI), the doc is injected with a self-gate preamble rather
#     than silently dropped.
set -euo pipefail

input=$(cat)
agent_id=$(jq -r '.agent_id // empty' <<<"$input")
model=$(jq -r '.model // empty' <<<"$input")

# Inside a subagent: never inject.
[[ -n "$agent_id" ]] && exit 0

# Main agent on a known non-Fable model: stay silent.
if [[ -n "$model" && "$model" != *fable* ]]; then
  exit 0
fi

if [[ -z "$model" ]]; then
  echo "(The following supervisor workflow applies only if you are a Fable-class model; otherwise ignore this entire section.)"
  echo
fi

dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cat "$dir/codex-subagent-workflow.md"
