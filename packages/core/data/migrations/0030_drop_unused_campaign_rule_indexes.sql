-- Migration 0030: drop the two campaign_rule indexes that no read path can use.
--
-- Migration 0025 created three indexes. Only campaign_rule_ambiguity backs a
-- real query; campaign_rule_effective_position and campaign_rule_status_position
-- were speculative. Every effective/revoked/superseded position predicate runs
-- in JavaScript through compareCampaignPositions, because the serialized anchor
-- does not order under BINARY the way the campaign-position domain orders (see
-- the comment above activeRows in src/campaign/campaignRuleStore.ts). No
-- statement filters or orders by effective_position or status, so SQLite never
-- selects either index -- with or without ANALYZE statistics. They cost a write
-- on every rule insert and lifecycle update and buy nothing.
--
-- Evidence and decision: docs/audits/2026-09-07-campaign-rule-index-audit.md
-- (eshyra-jhpt.2.5). Regression coverage: test/campaignRuleIndexes.test.ts.
DROP INDEX campaign_rule_effective_position;
DROP INDEX campaign_rule_status_position;
