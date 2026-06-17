# Contributing

## External code contributions are not accepted yet

Eshyra is source-available under the PolyForm Noncommercial License 1.0.0
(see [LICENSE](LICENSE)). Commercial rights are reserved; see
[COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md) and
[docs/licensing.md](docs/licensing.md).

There is no contributor agreement or inbound license arrangement in place, so
**the project cannot accept external code contributions at this time.** Pull
requests that add or modify source code from outside contributors will not be
merged until a contribution licensing arrangement is defined. This will be
revisited alongside the distribution channel decision (`eshyra-bo2`).

You are welcome to read the code, open issues to report bugs, and discuss ideas.
Non-code feedback does not require a contribution license.

## Internal / agent workflow

Operational guidance for maintainers and AI agents working **inside** this
repository lives in [AGENTS.md](AGENTS.md) (`CLAUDE.md` simply imports it). In
summary:

- Issue tracking uses **bd (beads)**, not GitHub issues or markdown TODO lists.
  Run `bd ready` to find available work and `bd prime` for the full workflow.
- Dependency updates follow the conservative policy in
  [docs/dependencies.md](docs/dependencies.md), including special handling for
  the Node runtime and `better-sqlite3` compatibility.
- Bundled or publicly shared campaign/rules content must be open-licensed,
  public domain, original, or publisher-licensed; fair use is not the permission
  model.
