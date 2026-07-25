# Finding registry v1

`finding-registry.json` is the single source of truth. It records one canonical
invariant per row and every qualified alias used by the four July 2026 reviews.

To add a finding, add its fully qualified review alias to exactly one row, use an
existing owning bead, and choose a named generated membership query implemented
by `findingRegistry.ts`. Do not add a copied count: query results are snapshots
of the committed pack and must be recomputed at runtime.

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
stable contract. The validator also checks aliases, query names, hard-coded
totals, schema shape, and bead references (the latter is skipped when `bd` is
not installed).
