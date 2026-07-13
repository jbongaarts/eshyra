# Thaw Note — F8 starting-wealth table

## Reason for thaw

F8 requires player-facing starting wealth to resolve from committed typed pack
data. The importer now emits the source-backed `table:starting-wealth-by-class`
projection from the SRD p. 38 Starting Wealth by Class table; runtime resolves
that record through the active rules stack and fails closed on malformed rows.

## Generated delta

The only generated addition is `table:starting-wealth-by-class` with twelve
class rows. The existing typed Acolyte currency fact remains unchanged. No
other record payloads, source artifacts, or record kinds changed.

## Verification

`npm run verify:dnd5e-srd-pack` proves importer output matches the committed
pack exactly. The refreshed records hash after rebasing onto current `main` is
`ba970289ffbb820919a6fb586d795a0465dad2b0fbe4451e8d18c476646f8bb9`.
