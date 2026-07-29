# Project Instructions for AI Agents

Agent and contributor guidance for this project is consolidated in
**[AGENTS.md](./AGENTS.md)** to keep a single source of truth (DRY). That file
covers the beads issue-tracker workflow, build & test (including the
better-sqlite3 / CI strategy), the architecture overview, conventions, and the
mandatory session-completion protocol.

Claude Code: read it now.

<!-- BEGIN REVIEW PROTOCOL POINTER -->
Review lifecycle: run
`npm run review:preflight -- --bead <bead-id> [--pr <number>]` before starting
work and before asking for review. Read only the profile document it reports as
effective; the bead's `## REVIEW CONTRACT` is normative and the PR body is
explanatory only. Obtain authorization before substantive implementation
whenever preflight says it is required, and stop permanently on
`DESIGN_INVALIDATED`. Details:
`docs/review/eshyra-development-and-review-protocol.md`.
<!-- END REVIEW PROTOCOL POINTER -->

@AGENTS.md
