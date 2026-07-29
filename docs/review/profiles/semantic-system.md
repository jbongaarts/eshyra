# Review profile: `semantic-system`

Identifier: **`semantic-system-v1`** · Strictness: middle ·
Protocol: [`eshyra-review-v2`](../eshyra-development-and-review-protocol.md)

For durable semantic and trust-boundary work — anything whose output outlives
the code that produced it, or that decides what later work is permitted to
claim. Includes: persisted state; replay, rollback, and checkpoints;
provider-neutral protocols; orchestrator and tool contracts; adventure-module
schemas; identity and version models; evidence systems; authorization;
migration; security and permissions; and review-governance infrastructure.

Includes everything `standard` requires. **Pre-implementation contract
authorization is mandatory.**

## Additional contract section

```markdown
### Semantic-system contract
- Trust boundaries:
- Stable identities and revisions:
- State transitions and lifecycle:
- Stale-state detection:
- Migration and backward compatibility:
- Adversarial scenarios:
```

## What the evidence must establish

**Authoritative inputs.** Which input is the authority, and which are derived
from it. The recurring failure this exists to prevent: *the artifact under
repair used as evidence about itself.* A producer may never define the standard
its own output is judged by.

**Trust boundaries.** Where trusted data becomes untrusted and vice versa; what
each side is trusted *for*. "Trusted for nothing" is almost always a false
claim — name the exact thing.

**Stable identity and semantic revisions.** What identifies a thing durably, and
what separately identifies its *current semantic content*. Downstream caches
and assertions bind to the pair; durable cross-reference binds to the identity
alone. A stale pair must be detectable, not merely unlikely.

**Producer/consumer compatibility.** Every consumer that reads the changed
shape, and whether it can be revised in the same change. If it cannot, the
change is versioned, not edited.

**State transitions and lifecycle.** The legal transitions, enumerated. Illegal
transitions must be rejected by code, not by convention.

**Fail-open versus fail-closed.** State which, for each path, and why.
*An evaluation path that cannot resolve its input must fail.* Returning an
empty failure list on an unresolved lookup makes "no failures" indistinguishable
from "all checks passed" — this idiom appeared five times across PRs #475–#477
and is the single most expensive defect class in this repository's history.

**Migration and backward compatibility.** How existing persisted data is read
after the change, and what happens to data written by the old code. Silent
migration is prohibited; an unreadable version is an error, not a skip.

**Stale-state detection.** How a consumer notices that what it cached is no
longer what the producer means.

**Recovery and rollback.** How to get back to a good state, and whether
rollback loses information.

**Adversarial verification.** Concrete scenarios in which the mechanism is
attacked or misused, each with the specific defense. Not a promise of care — a
named scenario and the structural reason it fails.

## Structural requirements, not disciplinary ones

Three failure idioms recur and must be designed out, not remembered:

1. **Empty failure list on unresolved input.** Return a result type that
   distinguishes "evaluated, no failures" from "could not evaluate".
2. **A free-text field as the thing a validator checks.** No gate may read a
   human-facing string. Structure the data instead.
3. **Count-pinned tests.** Asserting the *size* of a set passes for any set of
   that size. Assert identities.

## Workflow

```bash
npm run review:classify  -- --bead <bead-id>
# open a DRAFT authorization PR before substantive implementation
npm run review:handoff   -- --bead <bead-id> --pr <n> --kind contract-authorization
# reviewer publishes a contract-authorization checkpoint
npm run review:preflight -- --bead <bead-id> --pr <n>
# implement only after implementation permission is granted
npm run review:handoff   -- --bead <bead-id> --pr <n> --kind implementation-review
```

Later implementation commits do not invalidate the authorization while the
contract, profile, and policy hashes are unchanged. Editing the contract does —
that is a material change and requires re-authorization.

## Escalation

If the work begins asserting source-backed rule behavior, deterministic engine
capability, pack-driven runtime semantics, or generated-data production, it is
`rules-clause-complete` work. Raise the declared profile and re-authorize; the
capability claim is exactly what that profile exists to check.
