# Design Authorization and Pull Request Review Policy

This document is Eshyra's canonical, provider-neutral methodology for design
authorization and pull request review. `AGENTS.md` establishes the obligation
to follow it. Accepted architecture and design decisions, the owning Bead, and
the exact implementation remain the authority for the work itself.

This policy adds no separate review framework. In particular, it does not
require review contracts, hashes, authorization comments, checkpoints,
certifications, mirrored GitHub comments, or `review:*` commands. Such an
artifact is required only when current accepted authority specifically requires
it for the work at hand. The `eshyra-review-v2` machinery proposed on PR #481
closed unmerged and is not repository authority.

## Authority and required context

Design authors, implementers, and reviewers use the same authority. Before
authorizing a design or reviewing an implementation, read the applicable:

- repository instructions, beginning with `AGENTS.md`;
- accepted ADRs and integrated design documents;
- owning Bead, including its scope, acceptance criteria, dependencies,
  blockers, exclusions, and required next state;
- current dependencies, blockers, accepted findings, and invalidation markers;
- exact implementation at the head under review; and
- real producers, consumers, discovery paths, state transitions, execution
  paths, and external artifacts on which the change relies.

Where repository task tracking applies, the owning Bead is the specification
boundary. It carries ownership, scope, acceptance criteria, dependencies,
constraints, exclusions, and the required next state. It needs no specially
formatted review contract or other review artifact unless current accepted
authority explicitly requires one, and the absence of an unrequired artifact
is never grounds to reject a PR.

When Bead ownership, dependencies, blockers, scope, acceptance criteria, or
status matter, resolve the current `refs/beads/state` projection and inspect the
relevant records. The projection is disposable and read-only. Never use it to
reconstruct or write Beads state. Beads/Dolt remains authoritative, so reconcile
projection age or conflicts against live Beads before acting.

PR prose, agent reports, tests, readiness labels, generated artifacts, and
prior conclusions are claims or evidence mechanisms to inspect. None replaces
authority or direct implementation evidence. Required authority that is
missing, stale, malformed, inaccessible, contradictory, or unresolved blocks
authorization or approval.

Repository authority applies equally to every model, provider, harness, agent
role, and Captain seat. Generated boilerplate, advisory seat or private state,
seat charters, and predecessor handoffs never outrank it. An explicit assignment
or a session-injected policy that deliberately narrows `AGENTS.md` for a
specific operating role may refine this policy and take precedence within the
scope it states, exactly as `AGENTS.md` permits. Keep such authorized, scoped
refinements distinct from advisory or private state, and do not strand general
repository rules in a role-specific instruction layer.

A process transition may omit the process it replaces. A superseded, abandoned,
or not-yet-created process is not a prerequisite for changing that process.

## Design authorization

Design work is proportionate to the decision. Ordinary local changes can be
authorized by a clear owning Bead and existing repository authority. Changes to
semantic boundaries, durable state, protocols, schemas, identity, migrations,
security, discovery or audit architecture, adjudication boundaries, lifecycle,
or rules execution require the relevant design decisions and trust boundaries
to be explicit before implementation generalizes them.

The design must identify the authorized scope, controlling authority, important
producer-consumer boundaries, invariants, exclusions, evidence needed, and the
state that follows success or failure. Record these in the owning Bead, an
accepted ADR or design document, or an explicit assignment as appropriate. No
special format is implied.

When a semantic concept or proof assumption is unsettled, prove it vertically
on a small set of real, source-backed cases before generalizing it across a
large corpus or subsystem. The proof must exercise the actual trust boundary,
including independent authority for the claim being tested and real consumers
where applicable. Synthetic fixtures and schemas can support that proof; they
cannot establish real binding by themselves.

## Review profiles

The profile order is:

`standard < semantic-system < rules-clause-complete`

Use the stricter of the profile declared for the work and the repository
minimum implied by its actual boundaries. Profiles select review depth, never
ceremony. A stricter profile broadens the invariants, sibling search, consumers,
and permanent evidence that must be examined; it does not create a contract,
hash, checkpoint, or authorization artifact.

### `standard`

Use for ordinary code, documentation, tooling, and local fixes that do not cross
a higher-risk boundary. Review the complete authorized scope, affected callers,
failure behavior, and proportionate permanent evidence.

### `semantic-system`

Use for durable state, protocols, schemas, identity, migrations, security,
discovery or audit architecture, adjudication boundaries, lifecycle, and other
changes whose meaning spans components or persists over time. Review producers,
consumers, transitions, compatibility, failure modes, and proof mechanisms as
one system.

### `rules-clause-complete`

Use for rules sources, importers, generated packs, provenance, discovery,
capabilities, readiness, and pack-driven mechanics. This profile includes the
`semantic-system` obligations and independently examines the relevant portions
of these flows:

1. source -> capture -> identity/provenance -> pack;
2. signal -> candidates -> relationship expansion -> retained context;
3. context -> DM ruling -> state application; and
4. bounded operation -> source semantics -> real binding -> provider-neutral
   execution -> state effect.

These are review paths through a bounded scope. They are not universal
completeness claims.

## Rules architecture under review

For rules work,
[ADR 0020](adr/0020-rules-pack-as-rule-awareness-infrastructure-with-bounded-deterministic-capabilities.md)
controls. The rules pack is primarily provenance-backed rule-awareness
infrastructure for the DM and runtime auditor.
It surfaces potentially governing sources, exceptions, relationships,
ambiguities, campaign rulings, and bounded deterministic capabilities before
adjudication. The DM model remains the default interpreter of meaning,
applicability, interaction, and ambiguity.

Deterministic systems continue to own dice, arithmetic, atomic mutation,
resource accounting, identity and ownership, persistence, replay, rollback,
migration, visibility and authorization, and positively selected bounded
procedures. A deterministic capability is a narrow positive commitment with a
defined operation, inputs, exclusions, identity or revision, and residual
interpretation.

Absence, an unbound or unclassified state, an unknown value, or an empty
retrieval result never proves safety, completeness, satisfaction, irrelevance,
or the absence of mechanics. Recognizing nothing is not a green result. Eshyra
does not require global deterministic closure, universal retrieval
completeness, zero engine-pending clauses, or any other corpus-wide negative.

Keep these concerns analytically separate because each has different owners,
evidence, and failure modes:

1. source fidelity;
2. discovery;
3. adjudication;
4. deterministic capability; and
5. state integrity.

Paths, clauses, scenarios, record kinds, relationships, and capabilities are
many-to-many. Scenarios are bounded composition evidence, not completeness
units. Schemas, registries, hooks, Beads, readiness labels, generated artifacts,
and synthetic fixtures do not independently prove support. Distinguish genuine
source ambiguity from adjudication deliberately owned by the model.

## Existing defects and contracts

Architecture changes do not erase existing defects. Reconcile every prior
finding as fixed, reshaped, split, reclassified, retained, or retired.
Retirement must identify the responsibility that replaces the old claim and
must not hide a source-fidelity, discovery, capability, adjudication, or
state-integrity defect.

Existing runtime contracts remain operative until accepted authority explicitly
replaces or narrows them. A target architecture does not silently change current
producer-consumer behavior.

## Review the mechanism

Review the full authorized scope independently from the author's narrative.
Bind every conclusion to the exact PR head SHA. Inspect the implementation's
real producers and consumers, its discovery and execution paths, its state
transitions, and every external artifact used to support the claimed behavior.

Generalize an observed problem into its violated invariant and defect class.
Require permanent regression evidence that distinguishes the bad state from the
good state. Continue through the full authorized scope and batch all blockers
reasonably discoverable in that pass; finding enough blockers to reject the PR
does not end the review.

Before publishing a defect:

1. identify the violated invariant and defect class;
2. search the authorized blast radius for siblings; and
3. vary relevant state dimensions.

Relevant dimensions include missing, stale, and malformed state; ordering;
duplication; identity; lifecycle transitions; environment and test overrides;
aliasing and re-indexing; and interacting inputs. Report the generalized closure
condition, not only the example that exposed the defect.

## Repair review and churn control

A bounded re-review examines the repaired mechanism. It does not merely replay
the previous example or the author's supplied test. Construct new adversarial
siblings, check that the unsound assumption was not moved to another layer, and
finish every open defect class in the authorized blast radius before publishing
the result.

Bounded fix verification is reserved for a known defect class whose repair is
demonstrably non-material. A material repair requires a fresh full review. A
newly discovered defect class requires review of its affected blast radius
under the applicable lifecycle. If a defect class survives one repair because
only its example was fixed, the next review must explicitly attack that class's
state space. **If it survives two repair cycles, a third narrow dispatch on that
class is not permitted: perform a fresh full review of the affected subsystem
instead.** This is a hard stop, not a judgment call — a class that has outlived
two repairs is evidence that the repairs are addressing examples rather than the
class, and further narrow patches compound that error.

Approval binds to an exact head SHA. Any substantive commit after approval
invalidates that approval and requires review of the new head.

## Proof mechanisms are implementation

Review checkers, probes, stamps, hashes, baselines, fixtures, generated
artifacts, and observations as implementation and proof mechanisms in their own
right. Determine whether their inputs can drift, alias, reorder, re-index, be
modified together, or remain unchanged while the claimed property changes.

A green proof mechanism is evidence only when it can distinguish the relevant
bad state from the good state. Inspect the producer of the evidence, its real
input and admission path, the identity to which an observation binds, and the
conditions that invalidate it. Static text, a digest, a schema-valid record, or
an observed execution proves only the property it actually measures.

## From observation to finding

A technically correct observation is not a finding. **A defect exists only where
an observation materially violates an applicable requirement.** This section
runs before **Findings discipline**, which governs findings once they exist.

Before publishing a defect, establish:

1. the governing invariant or contract;
2. the authority for that invariant;
3. the relevant ownership and consumer boundary;
4. applicability or reachability where material;
5. the actual consequence of violation;
6. the proportionate closure condition; and
7. the proportionate permanent evidence.

**An observation that cannot name an operative invariant and the authority for
it is dispositioned as "no requirement", in one line, and is not a finding.**
That disposition is complete at one line and requires no further justification.
Recording it costs no more than accepting the observation would have, and this
symmetry is deliberate: where rejecting an observation costs more than accepting
it, acceptance becomes the default, and every acceptance enlarges the
implementation, the permanent evidence, and the surface the next review must
examine.

"We could make this more defensive" is not "the system requires this defense."
Theoretical robustness is not required correctness.

**The admission test is authority, not present reachability.** Producers,
consumers, and reachability are weighed at steps 3 to 5 above — where material —
and they shape severity, closure condition, and proof burden. They are not a
precondition for a requirement existing. An accepted ADR, design document, or
owning Bead can require an implementation before the consumer that will use it
is integrated, and staged work of that kind is normal here; such a requirement
does not lapse for want of a current caller.

**Reachability is therefore a severity axis, not an admission gate.** A defect
on a path no producer or consumer currently reaches is dispositioned at its real
severity, not at the severity it would carry on a live path. An unreached path
is not thereby safe, absent, or exempt — it is lower-consequence, which is a
different claim, and `AGENTS.md` continues to govern when unexercised
scaffolding must be retained, demoted, or retired.

A published finding must state whether its permanent evidence is a
**generalized invariant** or an **exact reproducer**, and why that choice is
proportionate to the consequence of failure. Prefer one generalized invariant
over many near-identical reproducers, except where the exact case carries a
claim the invariant would not preserve — as a source-fidelity regression
against a vendored source artifact does until the replacement demonstrably
preserves or strengthens that same source-backed protection. Consolidating such
a case is a change to source-fidelity evidence and belongs to
`docs/importer-fix-protocol.md`. The permanent-evidence rules in `AGENTS.md`
("Permanent Test Evidence") govern what survives the PR.

None of this narrows the search that finds defects. Sibling search, state-
dimension variation, and proof-mechanism review are unchanged and remain
required. This section governs only what happens between an observation and its
publication as a finding.

## Findings discipline

If a defect is worth fixing ever, it is worth fixing now. Every valid finding
blocks approval and is repaired in the current PR regardless of its size or
impact. Labels such as nonblocking, minor, optional, follow-up, and nice-to-have
must never defer an accepted finding or make it ignorable.

Disposition every proposed finding explicitly. Either accept it and repair it
before approval, or permanently reject it with recorded reasoning that explains
why the governing invariant and authority require no change. Permanent rejection
is not deferred work. Do not avoid this rule by declining to publish a valid
defect, and do not create a follow-up Bead for work that belongs to the current
PR.

A finding identifies, where applicable:

- the violated invariant and effective review profile;
- the affected boundary and exact or query-defined membership;
- sibling and state-dimension analysis;
- the responsible owner;
- permanent evidence;
- whether the required repair is material; and
- the required next state.

For a discovery defect, identify the failed stage when possible: capture,
signal extraction, relationship expansion, ranking, context retention,
capability presentation, DM use, or adjudication.

Before publishing `APPROVED` or `CHANGES REQUESTED`, complete the full authorized
scope, sibling search, applicable adversarial review of repaired mechanisms,
proof-mechanism review, and batching of presently known blockers. These are
review duties, not new checkpoint artifacts.

## Invalidation and normal PR lifecycle

`DESIGN_INVALIDATED` is terminal for the PR. Stop substantive implementation
and review on that PR and keep it draft. Preserve its branch and findings as
evidence, establish successor ownership, and only then close it unmerged.
Substantive continuation requires a successor PR. Patching an invalidated PR
cannot make it approvable.

Do not create a second PR or Bead lifecycle. The normal branch, worktree,
verification, commit, push, PR handoff, merge, dispatched-child, and Bead-status
lifecycle is owned by the **Git & PR Workflow** and **Session Completion**
sections of `AGENTS.md`; follow those sections directly.
