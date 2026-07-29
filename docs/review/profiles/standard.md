# Review profile: `standard`

Identifier: **`standard-v1`** · Strictness: lowest ·
Protocol: [`eshyra-review-v2`](../eshyra-development-and-review-protocol.md)

For ordinary code, UI, website, CLI behavior, docs, maintenance, tooling, and
localized fixes. This is the default and it is the right answer for most work.
Do not reach for a stricter profile out of caution — over-classification is
permitted, but it costs a reviewer real time.

## Contract sections

A `standard` contract needs the common sections only:

- Review classification
- Objective and scope
- Authority and inputs
- Behavior and representation
- Consumers and blast radius
- Failure, recovery, and residuals
- Verification and closure

Exact field names are enforced by `packages/core/scripts/review/contract.ts`;
`npm run review:preflight` names anything missing.

## What the evidence must establish

- **Objective and scope** — the intended outcome, what is in and out of scope,
  and the exact surfaces touched.
- **Behavior and acceptance criteria** — what the change makes true, stated so
  that a reviewer can disagree with it.
- **Callers and consumers** — who calls the changed code today.
- **Blast radius** — what else observes the behavior, including indirectly.
- **Error and negative behavior** — what the change makes *fail*, and how.
  Silent success on bad input is a defect, not a simplification.
- **Compatibility** — whether any caller must change, and whether old data,
  flags, or output remain valid.
- **Tests and regression evidence** — the tests that would fail if this change
  regressed. Permanent, not one-off manual checks.
- **Approved residuals** — what is knowingly left undone, and why that is
  acceptable.

## Authorization

Pre-implementation authorization is **optional**, unless:

- the contract sets `Authorization required before implementation: yes`;
- the minimum-profile policy escalates the effective profile; or
- a material discovery mid-flight raises the profile.

Implementation review is **required for merge readiness**, on every profile.

## Workflow

```bash
npm run review:classify  -- --bead <bead-id>
# implement
npm run review:handoff   -- --bead <bead-id> --pr <n> --kind implementation-review
npm run review:preflight -- --bead <bead-id> --pr <n>
```

The implementation handoff must match the current head. Any new commit
invalidates implementation approval, so publish the handoff when the branch is
actually ready — not mid-push.

## Escalation

If review uncovers that the change alters a public schema or protocol,
persisted state, generated data, replay or rollback, a migration, an
authorization boundary, or source-backed rule behavior, **stop and raise the
declared profile**. Add the characteristic to the contract, re-run
`review:classify`, republish the handoff, and obtain authorization if the new
profile requires it. Continuing under `standard` after such a discovery is
silent downgrade and the tooling rejects it.

## What does not count as evidence

Passing CI, an exported symbol existing, a bead existing, or the PR description
asserting correctness. Each proves its own existence and nothing more.
