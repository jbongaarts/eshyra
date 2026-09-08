# `campaign_rule` index audit (eshyra-jhpt.2.5)

Assessment of the three indexes migration 0025 created on `campaign_rule`, with
query-plan evidence and the resulting decision. Recorded 2026-09-07.

## Question

`eshyra-jhpt.rev7` (round-4 review of PR #524) observed that the active-rule read
paths fetch every row for a campaign and evaluate effective/revoked/superseded
positions in JavaScript, so `campaign_rule_effective_position` and
`campaign_rule_status_position` appeared unused. The bead deliberately left
merged migration 0025 alone and deferred the decision to measurement.

## Every statement that touches `campaign_rule`

`packages/core/src/campaign/campaignRuleStore.ts` holds all of them:

| Site | Predicate |
| --- | --- |
| `assertNoOverlappingAmbiguityRuling` (:179) | `campaign_id = ? AND provenance_kind = 'ambiguity' AND ambiguity_id = ?` |
| `getCampaignRule` (:464) | `campaign_id = ? AND rule_identity = ?` |
| `listCampaignRules` (:474) | `campaign_id = ?` |
| scheduled-successor lookup (:515) | `campaign_id = ? AND superseded_by = ?` |
| `revokeCampaignRule` UPDATE (:537) | `campaign_id = ? AND rule_identity = ?` |
| `supersedeCampaignRule` UPDATE (:622) | `campaign_id = ? AND rule_identity = ?` |
| `activeRows` (:651) | `campaign_id = ?` |

No statement filters, joins, or orders by `effective_position` or `status`.
There is no `ORDER BY` anywhere: `listCampaignRules` and `activeRows` sort in
memory through `orderCampaignRules`.

## Query-plan evidence

Measured against a fresh in-memory database with the full migration set applied,
SQLite 3.53.2 (the `better-sqlite3` 12.x build this repo pins).

**A — as shipped.** No migration or runtime path runs `ANALYZE`, so there is no
`sqlite_stat1` and the planner uses its default heuristics.

```
listCampaignRules / activeRows (:474, :651)
    SEARCH campaign_rule USING INDEX sqlite_autoindex_campaign_rule_1 (campaign_id=?)
getCampaignRule (:464)
    SEARCH campaign_rule USING INDEX sqlite_autoindex_campaign_rule_1 (campaign_id=? AND rule_identity=?)
assertNoOverlappingAmbiguityRuling (:179)
    SEARCH campaign_rule USING INDEX campaign_rule_ambiguity (campaign_id=? AND provenance_kind=? AND ambiguity_id=?)
scheduled-successor lookup (:515)
    SEARCH campaign_rule USING INDEX sqlite_autoindex_campaign_rule_1 (campaign_id=?)
revokeCampaignRule UPDATE (:537)
    SEARCH campaign_rule USING INDEX sqlite_autoindex_campaign_rule_1 (campaign_id=? AND rule_identity=?)
supersedeCampaignRule UPDATE (:622)
    SEARCH campaign_rule USING INDEX sqlite_autoindex_campaign_rule_1 (campaign_id=? AND rule_identity=?)
```

**B — 2000 rows plus `ANALYZE`.** An upper bound on what statistics could
justify, well past any realistic campaign rule count.

```
listCampaignRules / activeRows (:474, :651)
    SEARCH campaign_rule USING INDEX campaign_rule_ambiguity (campaign_id=?)
getCampaignRule (:464)
    SEARCH campaign_rule USING INDEX sqlite_autoindex_campaign_rule_1 (campaign_id=? AND rule_identity=?)
assertNoOverlappingAmbiguityRuling (:179)
    SEARCH campaign_rule USING INDEX campaign_rule_ambiguity (campaign_id=? AND provenance_kind=? AND ambiguity_id=?)
scheduled-successor lookup (:515)
    SEARCH campaign_rule USING INDEX campaign_rule_ambiguity (campaign_id=?)
revokeCampaignRule UPDATE (:537)
    SEARCH campaign_rule USING INDEX sqlite_autoindex_campaign_rule_1 (campaign_id=? AND rule_identity=?)
supersedeCampaignRule UPDATE (:622)
    SEARCH campaign_rule USING INDEX sqlite_autoindex_campaign_rule_1 (campaign_id=? AND rule_identity=?)
```

Neither `campaign_rule_effective_position` nor `campaign_rule_status_position`
is selected in either pass. `campaign_rule_ambiguity` is selected and earns its
place; the primary key's implicit index covers everything keyed by
`(campaign_id, rule_identity)` and the `campaign_id`-only scans.

## Why the two indexes cannot become useful as written

The domain does not order positions the way SQL would. `compareCampaignPositions`
parses the `cp1~<ordinal>~<session>~<turn>` anchor and compares decoded fields,
with the `__future__` anchor forced ahead of real anchors at an equal ordinal and
the session/turn ids compared by code point rather than by their percent-encoded
bytes. A `BINARY` range scan over `effective_position` therefore does not agree
with the comparator that every consumer uses — which is exactly why the read
paths evaluate positions in JavaScript, as the comment above `activeRows`
records. Pushing a position predicate into SQL is a semantics change, not an
index change; any future index for it would have to be designed against whatever
encoding that change adopts.

`campaign_rule_status_position` has the same problem plus a low-cardinality
leading column (`status` has three values under a `CHECK`).

## Decision

**Remove both.** Migration `0030_drop_unused_campaign_rule_indexes.sql` drops
`campaign_rule_effective_position` and `campaign_rule_status_position`, and
keeps `campaign_rule_ambiguity`. They cost a b-tree write on every rule insert
and on every revoke/supersede update while serving no read.

Replacement was rejected: there is no query to serve, and a replacement would
have to encode a position ordering the domain has deliberately not committed to
SQL.

### Checkpoint and restore implications

None that require handling. `serializeCampaign` captures each relation's index
and trigger DDL from `sqlite_master`, and `materializeSnapshot` recreates a
restored database from the snapshot's own DDL — so a checkpoint taken before
this migration restores with the old indexes present and its captured
`schema_migrations` ledger lacking 0030. Reopening that restored database
applies 0030 and drops them, converging on the current schema. The reverse
direction is unreachable: a checkpoint taken after this migration cannot be
restored into a database that then expects the indexes back.

Nothing queries `sqlite_master` for these names. `schemaFingerprint` compares a
legacy-adopted database against a fresh migrated one, and both take the same
migration path, so the two stay identical.

## Coverage

`packages/core/test/campaignRuleIndexes.test.ts` asserts the surviving index
set, that `campaign_rule_ambiguity` is still the plan for the ambiguity read,
and that the `campaign_id`-keyed reads did not regress into a full table scan.
`schemaSnapshot.test.ts` keeps `data/schema.snapshot.sql` honest.
