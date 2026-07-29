# Review checkpoint test fixtures

Fixture checkpoints exist so Foundation 1 and the review system's own tests can
exercise checkpoint consumption without a real reviewer.

They authorize nothing. Every identity string is namespaced `fixture-only`, the
payload sets `"fixtureOnly": true`, and
`packages/core/scripts/review/checkpoints.ts` rejects such a payload in any
production context — unconditionally, with no environment variable, flag, or
path able to relax it. `packages/core/test/review/reviewCheckpoints.test.ts`
proves a fixture checkpoint cannot authorize a real PR, bead, or contract.

Fixtures may live only under this directory. A production-shaped checkpoint
placed here is also rejected, so the namespace cannot be laundered by moving a
file.
