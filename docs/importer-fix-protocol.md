# Importer Fix Protocol

This protocol applies to deterministic rules-pack importer work, including extractor changes, parser changes, audit/oracle changes, importer tests, and generated rules-pack updates.

The goal is to prevent importer fixes from becoming local, symptom-driven patches that make one record look better while weakening regression coverage or breaking another part of the generated pack.

> **Architecture context.** The "importer" is the source-grounded **rules-pack
> compiler** with an executable-curation stage — see `docs/rules-pack-compiler.md`
> and [ADR 0017](adr/0017-rules-pack-compiler-and-executable-curation-architecture.md)
> (which refines [ADR 0007](adr/0007-rules-pack-ingestion-policy.md)). This
> protocol governs the *mechanics* of a regression-sensitive change; the guide
> governs *which technique* to reach for (parser vs. declarative curated spec
> vs. exceptional procedural code vs. engine hook) and the evidence each needs.
> A source-grounded **curated semantic specification** is a legitimate compiler
> input, not a hand-edit of output — the two rules below (generated records are
> outputs; curated specs are inputs) are distinct and both hold.

## Core rule

Regression tests and audit expectations are contracts.

Do not weaken, delete, or rewrite a failing regression expectation merely to make tests pass. A test or audit expectation may only be changed when the SRD source text, schema intent, or an existing documented design decision proves the expectation itself is wrong. Explain that evidence in the PR summary.

## Required workflow for importer bug fixes

1. Identify the failure class before changing parser behavior.
   - List affected generated record IDs when known.
   - Include at least one concrete before/after example.
   - Distinguish parser bugs from generated-data churn.

2. Add or confirm audit/test coverage first.
   - Prefer an audit invariant that represents the failure class.
   - Add focused regression tests for representative records.
   - Do not rely only on one hand-picked example if the problem is structural.

3. Change importer, extractor, or parser behavior.
   - Keep the change localized to the relevant failure class.
   - Avoid broad refactors unless they are required and explained.
   - Do not hand-edit generated records.

4. Regenerate generated rules-pack records through the importer.
   - Generated records must come from the importer workflow.
   - The committed generated pack must match regenerated output exactly.

5. Review the generated diff.
   - Explain every generated record added, removed, or changed.
   - Generated-pack churn outside the intended failure class is suspect.
   - Stop and investigate unexpected churn before broadening the change.

6. Run verification.
   - Run focused parser/audit tests.
   - Run pack regeneration and verification.
   - Run typecheck.
   - Run the repository's standard check command.
   - Run the full test suite when practical for importer PRs.

## Required PR summary for importer changes

Importer PRs must report:

- affected record IDs before the fix;
- audit/test failure count before and after, when applicable;
- generated records added, removed, and changed;
- why each generated diff is expected;
- exact commands run and results;
- any follow-up bead created or updated for intentionally deferred scope.

## Test changes

Changing a test is allowed only when the test is wrong, incomplete, or too narrow for the intended behavior.

Bad reasons to change a test:

- the implementation currently fails it;
- the generated output currently disagrees with it;
- changing the assertion is easier than fixing the parser;
- the test blocks a preferred implementation.

Good reasons to change a test:

- the SRD source text proves the expected value is wrong;
- the schema intent changed and is documented;
- a narrow assertion is replaced by a stronger invariant;
- a local example test is replaced by broader audit coverage without losing the original regression intent.

When changing importer tests, state whether the change preserves, strengthens, or intentionally replaces the original regression contract.

## Generated records

Do not hand-edit generated rules-pack records.

Generated records must be changed by updating the importer, extractor, parser, source manifest, or a **source-grounded curated semantic specification** (a deterministic, schema-validated, source-tied compiler input — see `docs/rules-pack-compiler.md` §3) and then rerunning the generation workflow. Editing a curated spec and regenerating is allowed; editing `records.json` by hand is not. The verification command must show that committed output matches importer output.

If generated records change outside the targeted failure class, explain why. If there is no clear explanation, treat the diff as suspicious.

## Scope control and incidental fixes

Scope control is meant to prevent uncontrolled exploration and unrelated implementation work. It must not be used to justify preserving known-bad generated output or adding extra parser complexity solely to avoid an incidental improvement.

When a minimal, principled fix for the current bead naturally improves an adjacent record or exposes a previously swallowed or missing record, do not add gates, special cases, or suppression logic just to keep the generated diff inside the originally expected record list.

Instead:

1. Verify the incidental change against the source text and schema intent.
2. Confirm it is a direct consequence of the same minimal fix, not a new root-cause investigation.
3. Add or update focused regression coverage when the incidental change is meaningful and stable.
4. Explain the additional generated diff in the PR summary.
5. Update or create a follow-up bead only for remaining work that still requires a separate design decision or additional parser behavior.

A generated diff is acceptable when it is:

- source-confirmed;
- produced by the same minimal fix;
- an improvement over previously corrupted, swallowed, or missing output;
- covered by tests or audit expectations where practical;
- explicitly explained in the PR summary.

A generated diff should trigger a stop-and-report when it:

- requires a new parser or extractor strategy beyond the current root cause;
- introduces unrelated kind or count churn;
- changes records that cannot be source-confirmed quickly;
- creates ambiguity with an existing documented design decision;
- requires weakening tests or audit expectations.

Do not suppress a correct incidental fix merely because it was previously tracked as follow-up. If the current minimal fix naturally resolves part of that follow-up, document that the follow-up scope was reduced and leave any remaining design-sensitive work tracked.

Use this hard-stop wording in importer bead prompts:

> If the failure map reveals a new root cause, requires a new parser or extractor strategy, or creates generated churn outside the direct consequences of the current minimal fix, stop and report instead of broadening the implementation.
>
> Do not add complexity solely to suppress source-confirmed incidental improvements caused by the correct fix. If the minimal fix naturally improves adjacent records, verify them, test or audit them when practical, explain them in the PR summary, and update any follow-up bead scope as needed.

## Follow-up scope

If a fix reveals a larger boundary, coverage, or schema problem, either:

1. include the complete fix with audit coverage in the same PR, or
2. create/update a follow-up bead with:
   - observed examples;
   - affected record IDs;
   - expected behavior;
   - likely files involved;
   - suggested tests or audit rules.

Do not silently leave known importer corruption untracked.
