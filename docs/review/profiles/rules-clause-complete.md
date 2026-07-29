# Review profile: `rules-clause-complete`

Identifier: **`rules-clause-complete-v1`** · Strictness: highest ·
Protocol: [`eshyra-review-v2`](../eshyra-development-and-review-protocol.md)

For rules sources, importers and the rules-pack compiler, generated packs,
semantic clauses, source coverage, finding membership, readiness classification,
deterministic rules engines, and pack-driven runtime mechanics.

Includes everything `standard` and `semantic-system` require. **Pre-implementation
contract authorization is mandatory.** Also follow
[`docs/importer-fix-protocol.md`](../../importer-fix-protocol.md) and
[`docs/rules-pack-compiler.md`](../../rules-pack-compiler.md).

## The chain

This profile exists to make one chain reviewable end to end:

**source obligation → pack representation → engine capability →
provider-neutral pack-driven reference execution**

A change that establishes any link must say what the other links currently are.
A link that is missing is *missing*, not "green".

## Additional contract sections

```markdown
### Source or authoritative obligations
- Authority:
- Exact membership or bounded scope:
- Membership derivation:
- Source spans or authoritative inputs:
- Complete obligations:

### Pack representation
- Required semantic distinctions:
- Branches, alternatives, multiplicity, and locality:
- Timing, lifecycle, resources, reset, and termination:
- Provenance:

### Cross-kind and cross-surface siblings
- Applicable record kinds:
- Applicable consumers:
- Generated predicates or reconciliation:

### Capability boundary
- Required engine capabilities:
- Evidence strength:
- Existing owners:
- Known missing capability handling:

### Pack-driven reference execution
- Real generated-record scenarios:
- Negative and fail-closed scenarios:
- Replay, rollback, RNG, or determinism requirements:

### Rules residuals
- Source ambiguity:
- Designed adjudication:
- Explicitly unsupported source material:
```

## What the evidence must establish

**Independently established obligations.** The obligation that a source imposes
must be established *independently of the projector whose output is judged by
it*. A pack under repair may not define its own membership; a hand-written
alias table is not an authority; a clause roster derived from the record it
describes is an internal-consistency check, structurally incapable of detecting
an omission.

**Exact bounded or generated membership.** Membership is either an exact
identity set or a bounded scope with a stated derivation and a residual that
must be empty. Never a count. Never "everything relevant". If membership cannot
be derived, the honest state is **underived**, not "absent" — recognising
nothing is not evidence of absence.

**Complete obligations.** For each obligation in scope: branches, alternatives,
multiplicity, locality, timing, lifecycle, resources, reset, and termination.
Multiplicity means one projected atom cannot discharge two distinct source
obligations. Locality means option-local mechanics may not be hoisted to their
parent. Alternatives require the *whole* exclusion structure — one member of a
partition proves nothing about the partition.

**Cross-kind and cross-surface siblings.** The same defect usually exists in
sibling record kinds and sibling consumers. Name the kinds and consumers you
checked, and the ones you did not.

**Source ambiguity versus designed adjudication.** Distinguish *the source is
unclear* (resolvable by campaign ruling) from *this boundary is deliberately
adjudicated by the model*. They fail closed in opposite directions: a designed
adjudication must be declared explicitly and must forbid a deterministic atom
covering the same span; a deterministic obligation must not be discharged by an
adjudication declaration.

**Fail-closed unsupported state.** Structured material the system does not
recognize must be reported as unsupported, never treated as absent or valid.
`RulesRecord.data` is typed `unknown`; there is no closed schema to enumerate
against, so "I recognized nothing" is not a coverage claim.

**Real generated pack records.** Reference execution runs against the real
generated records, not fabricated fixtures. Do not hand-edit generated output;
change compiler inputs and regenerate, and confirm committed output matches
regenerated output.

**Provider-neutral reference execution.** Execution must not depend on record
keys, names, provenance, or any correlation token. Hardcoding must be
*unrepresentable*, not merely avoided: rekey and rename must produce identical
traces, and a synthetic same-shape record must behave the same.

**Permanent source-to-execution regressions.** Tests assert obligation
identities, atom identities, and failure codes. Never lengths.

## Evidence that proves less than it appears to

Each of these was used across PRs #475–#477 as if it proved semantic
implementation. None does:

| Observation | What it actually proves |
| --- | --- |
| an exported symbol exists | a symbol exists |
| a record carries any engine hook | a field is populated |
| an alias appears in a hard-coded universe | someone wrote it down |
| a readiness clause exists | a string was authored |
| a generated record exists | the compiler emitted something |
| the audit reports no findings | the audit recognized nothing |

## Workflow

Same as `semantic-system` — draft authorization PR, contract-authorization
handoff, reviewer checkpoint, implementation only after permission — with the
additional requirement that the source-to-execution chain is stated in the
contract before authorization, not discovered during implementation.

## Scope discipline

Do not generalize across the corpus before the trust boundary is proven on a
small number of concrete source-to-execution examples. That inversion is the
recorded root cause of the three invalidated designs
(`eshyra-o9bd.19.7`). Prove the boundary, then generalize.
