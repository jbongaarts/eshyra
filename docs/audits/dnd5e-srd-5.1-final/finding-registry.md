# Finding registry v1

`finding-registry.json` is the single source of truth. It records one canonical
invariant per row and every qualified alias used by the four July 2026 reviews.

To add a finding, add its fully qualified review alias to exactly one row, use an
existing owning bead, and give the row its own generated membership query named
`finding:<canonicalId>`, implemented by `findingRegistry.ts`. The query must
enumerate that row's exact record membership using record keys and, where
relevant, `record.data.executionReadiness` and its clauses. Do not add a copied
count: query results are snapshots of the committed pack and must be recomputed
at runtime.

Aliases from the same review may share a row only when they name the same defect;
such a row must carry `clusterJustification`. Query names may not be shared
unless every row sharing the name carries `sharedQueryJustification`. The
validator enforces both rules, so a broad thematic category is not membership
evidence.

Statuses mean:

- `accepted`: the finding is a valid invariant for the repair program.
- `rejected`: the review conclusion is not supported by the source or pack.
- `narrowed`: only the source-supported portion is actionable.
- `ambiguous`: evidence does not select one interpretation.
- `disclosed-dependency`: the pack finding is real, but closure depends on an
  explicitly named engine or policy boundary.

The alias prefixes are deliberately qualified: `engine:F1`–`engine:F10` are
pack capability families; `fable:F1`–`fable:F8` are Fable findings;
`opus:F-01`–`opus:F-35` are Opus findings; `sol:CAP-001`–`sol:CAP-014` are
GPT-5.6-Sol findings; and `indep:001`–`indep:012` are the independent review.
Bare `F1`, `CAP-001`, and `SOL-001` aliases are invalid.

Membership queries replace totals because the pack changes as repairs land and
because conflicting review counts are evidence that a stored number is not a
stable contract. The validator also checks aliases, same-review clustering,
query uniqueness, required status reasoning, hard-coded totals, schema shape,
and bead references (the latter is skipped when `bd` is not installed).

`indep:011` has its own ambiguous row owned by
`eshyra-o9bd.19.3.1`: the language universe is a campaign-ruling/adjudication
question, not a source-authority or projection defect. `sol:CAP-009` is owned by
`eshyra-o9bd.19.2.1` because the plan routes the Animal Friendship correction
through source authority (with spell and provenance coordination).
