# Eshyra development and review protocol

Protocol identifier: **`eshyra-review-v2`**

One review lifecycle for the whole repository. What changes between kinds of
work is not the lifecycle but the **evidence required**, selected by a *review
profile*. Ordinary Eshyra work is not rules-pack work; do not apply a
rules-source standard to a CLI flag or a docs fix.

This document is the universal part. Profile-specific evidence lives in
`docs/review/profiles/`, and you read **only the profile `review:preflight`
reports as effective**. Machine details — required fields, checkpoint schemas,
hash inputs, placeholder detection, state-transition legality — live in
`packages/core/scripts/review/` and are authoritative there. Prose explains
intent; validators decide.

## Profiles

| Profile | Identifier | For |
| --- | --- | --- |
| `standard` | `standard-v1` | ordinary code, UI, website, CLI behavior, docs, maintenance, tooling, localized fixes |
| `semantic-system` | `semantic-system-v1` | durable semantic and trust-boundary work |
| `rules-clause-complete` | `rules-clause-complete-v1` | rules sources, importers, generated packs, deterministic rules engines |

Strictness is total and cumulative:
`standard < semantic-system < rules-clause-complete`. A stricter profile
requires everything a weaker one does, plus its own sections.

## Selecting a profile

Every bead contract **declares** a profile. The repository independently
computes a **minimum** from (1) changed paths and (2) declared change
characteristics, using `docs/review/minimum-profile-policy.json`. A
characteristic can only escalate the path-derived result, never weaken it.

The **effective profile is the stricter of declared and minimum.**
Under-classification is rejected. Voluntary over-classification is permitted —
declaring a stricter profile than required is always allowed and never argued
with.

Path matching alone is insufficient, which is why characteristics exist: a
change confined to `packages/core/src/state` looks like ordinary persisted
state until the author declares `pack-driven-runtime-semantics`.

```bash
npm run review:classify  -- --bead <bead-id> [--pr <number>]
npm run review:preflight -- --bead <bead-id> [--pr <number>]
```

Both take `--verbose` and `--json`. Default output is compact by design.

## The contract lives in the bead

**Beads are the authoritative location for change-specific review contracts.**
A bead carries exactly one normative `## REVIEW CONTRACT` block, in its
description or acceptance criteria. PR bodies, PR templates, commit messages,
branch names, and chronological bead notes are **explanatory only** and are
never parsed as normative. There is no committed per-bead contract file.

The contract is normalized deterministically — Markdown to a canonical
structure, then RFC 8785 JCS, then SHA-256 — so wrapping, list markers,
indentation, and blank lines cannot move the hash while key and value text can.
Required sections per profile, and the rejection rules (missing sections,
duplicate contracts, placeholder-only fields, profile-inconsistent sections,
under-classification, contradictory authorization settings) are enforced by
`packages/core/scripts/review/contract.ts`.

Four digests identify a review: the protocol document, the selected profile
document, the minimum-profile policy, and the normalized contract. Full 64-hex
digests are authoritative; abbreviations are display-only.

## Authorization, then implementation review

These are two different questions and are never conflated:

- **Contract authorization** — *may this contract be implemented?* Required
  before substantive implementation for `semantic-system` and
  `rules-clause-complete`. Optional for `standard` unless the contract requests
  it or policy escalates the profile.
- **Implementation review** — *does this head implement it correctly?*
  Required for merge readiness on every profile.

The workflow for profiles that require authorization:

1. Finalize the bead review contract.
2. Open a **draft authorization PR** before substantive implementation. Do not
   create a committed contract file just to have something to push; open the PR
   from the branch as it stands (an empty commit, `git commit --allow-empty`,
   is acceptable when the branch has nothing on it yet).
3. `npm run review:handoff -- --bead <id> --pr <n> --kind contract-authorization`
4. Obtain a contract-authorization checkpoint from a reviewer.
5. Begin substantive implementation only once implementation permission is
   granted.

The publication head recorded in an authorization is **context, not an approval
of the code at that commit**.

`standard` work skips steps 2–4 unless authorization is required; the contract
must still be valid, the implementation handoff must match the current head,
and implementation approval is still required before merge.

## Freshness

- **Later implementation commits do NOT invalidate contract authorization**
  while the contract, profile, and policy hashes are unchanged. Re-authorizing
  on every push would make authorization meaningless.
- **Any new commit DOES invalidate implementation approval.** Approval binds to
  a reviewed head SHA.
- A checkpoint is **stale** when any published hash, or the effective profile,
  disagrees with current computed state.
- Ordinary in-progress pushes do not require an implementation checkpoint. The
  distinguishable states are: authorization pending; authorized and in
  progress; ready for implementation review; changes requested; implementation
  approved; design invalidated.

## Material contract change

A change is **material** — and re-authorization is required — when the
normalized contract hash, the selected profile, the effective profile, or the
profile-policy hash changes. Editing a contract after authorization silently
re-scopes what was approved, so the hash comparison is the gate, not judgment.

A matching hash constant proves only that **bytes are unchanged**. It is not
evidence that a review occurred; only a published checkpoint is.

## Finding generalization

When a review finds a defect, ask whether it is an instance of a class. Fix the
class where the class is real, and record the class in the contract's negative
behavior. Do not weaken a test or an audit expectation to match current output.

## `DESIGN_INVALIDATED`

Terminal and absorbing. It records that the **design**, not the diff, failed:
repeated rounds produced new defect classes after material contract changes and
fresh full reviews.

Once published for a PR (`<!-- eshyra-design-invalidated:v1 -->`):

- no further substantive commits on that branch;
- the PR must not be merged, and is not rescued by a green build;
- every readiness, authorization, and approval command fails permanently;
- the branch is retained as evidence and is not deleted;
- recovery is a successor bead and a new PR — never a fix forward.

`npm run review:invalidate` publishes the record and **mutates nothing else**.
Closing the PR and updating beads are explicit, separate acts.

PRs #475, #476, and #477 are design-invalidated. They are used only as
regression fixtures and protocol examples; they are never reopened, modified,
or given new handoffs.

## Comment markers

| Marker | Carries |
| --- | --- |
| `<!-- eshyra-review-contract:v2 -->` | one active handoff per PR, with the full normalized contract |
| `<!-- eshyra-review-checkpoint:v2 -->` | append-only reviewer verdicts, compact |
| `<!-- eshyra-design-invalidated:v1 -->` | terminal stop-work record |

An unrecognized marker version is an **error, not a skip**. Checkpoint comments
never restate the protocol or the contract.

## Transition and bootstrap

Introducing this protocol could not depend on itself. A single bootstrap
exception is bounded to the exact owning bead, to a PR whose head branch is
that bead, and to the window in which the base branch lacks this document. It
waives only the pre-existing authorization checkpoint, is printed in CI output,
authorizes and approves nothing, and becomes structurally inapplicable once
this document exists on `main`. There is deliberately **no path-based exemption
for review-system files**.

## Profile escalation

Any material discovery may escalate the profile mid-flight — a `standard`
change that turns out to alter persisted state becomes `semantic-system`. Raise
the declared profile in the bead, re-run `review:classify`, republish the
handoff, and obtain authorization if the new profile requires it. Silent
downgrade is prohibited; the tooling rejects it.

## Evidence that proves less than it appears to

Never treat any of the following as stronger evidence than it is: PR prose;
passing tests; the presence of an exported symbol; the presence of an engine
hook; the existence of a bead; a readiness string; the presence of a generated
record. Each proves its own existence and nothing about semantic behavior.

## Changelog

| Version | Change |
| --- | --- |
| `eshyra-review-v2` | Initial durable protocol: profile selection, bead-authoritative contracts, deterministic hashing, separated contract authorization and implementation review, terminal `DESIGN_INVALIDATED`, one-time bootstrap exception. Supersedes the ad-hoc per-PR review conventions used through PRs #475–#477, which had no contract identity, no authorization step, and no staleness rule. |
