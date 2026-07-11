-- Migration 0007: usage/recharge counters, attunement slots, inspiration
-- (eshyra-2n1t.7, engine family F5; source: docs/audits/dnd5e-srd-5.1-final/
-- 2026-07-06-o9bd-18-7-8-execution-boundary-classification.md §4).
--
-- Durable per-entity resource state. `entity_usage_counter` holds one row per
-- limited-use economy an owner has actually drawn on (X/Day, Recharge X-Y,
-- recharge-after-rest, per-day innate spells, item charges): `uses_used`
-- counts spends against `uses_max`, `reset_kind` names the event that
-- restores it (turn-start recharge roll, short/long rest, dawn), and
-- `recharge_formula` marks partial dawn recharges ("regains 1d6 + 1 charges
-- daily at dawn") that need a rolled amount instead of a full reset.
-- `source` records whether the economy came from the creature's rules record
-- ('record') or a validated DM declaration ('declared', for character
-- abilities and item charges the pack does not structure yet).
-- Item charges are owned by the ITEM (`owner_kind` 'item', ref = inventory
-- id), never by the holder: charge state follows the wand when it changes
-- hands, and possession is checked separately at spend/restore time.
-- `last_recharge_attempt` is the once-per-turn token for recharge rolls:
-- the die may be rolled at most once at the start of each of the owner's
-- own turns, so the token records the (instance, round, turns_taken) window
-- of the last attempt and a repeat inside the same window is refused.
--
-- `attunement` is the magic-item attunement slot machine: at most three rows
-- per character, no two rows sharing an `item_key` (no duplicate copies), and
-- one creature per item — all enforced in code, with rows removed on the
-- SRD ending conditions (voluntary, 100 ft/24 h separation, death).
--
-- `character.inspiration` is the inspiration boolean resource: you have it or
-- you do not, it cannot be stockpiled.
--
-- `combat_turn_budget` gains the legendary-action per-round economy:
-- `legendary_action_allowance` is seeded from the creature record when the
-- budget row is created (0 = not a legendary creature), spends on other
-- creatures' turns accumulate in `legendary_actions_used`, and the counter
-- resets when the creature's own turn begins. Only one legendary option may
-- be used at the end of any single other creature's turn, so
-- `legendary_last_spend_token` records the turn window (round + active
-- participant + its turns_taken) of the last spend and a second option in
-- the same window is refused.
--
-- Backfill policy: no data backfill. No pre-0007 state tracked usage,
-- attunement, or inspiration; counters and attunements appear lazily on
-- first use, and existing characters start uninspired. Budget rows that
-- exist in a mid-combat pre-0007 database get `legendary_action_allowance`
-- 0 from the column default; the runtime lazily reconciles a 0 allowance
-- against the creature record on the next budget touch (ensureBudgetRow in
-- state/actionEconomy.ts), so an already-running legendary combat gains its
-- allowance without a data migration.
--
-- Conventions (ADR 0015): plain ALTER TABLE / CREATE TABLE, never IF NOT
-- EXISTS.

CREATE TABLE entity_usage_counter (
  campaign_id TEXT NOT NULL,
  owner_kind TEXT NOT NULL
    CHECK (owner_kind IN ('character', 'combatant', 'item')),
  owner_ref TEXT NOT NULL,
  counter_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  uses_max INTEGER NOT NULL CHECK (uses_max >= 1),
  uses_used INTEGER NOT NULL DEFAULT 0
    CHECK (uses_used >= 0 AND uses_used <= uses_max),
  reset_kind TEXT NOT NULL CHECK (reset_kind IN (
    'recharge_roll',
    'short_rest',
    'short_or_long_rest',
    'long_rest',
    'dawn'
  )),
  recharge_roll TEXT,
  recharge_minimum INTEGER
    CHECK (recharge_minimum IS NULL OR recharge_minimum >= 1),
  recharge_formula TEXT,
  last_recharge_attempt TEXT,
  source TEXT NOT NULL CHECK (source IN ('record', 'declared')),
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, owner_kind, owner_ref, counter_key)
);

CREATE INDEX entity_usage_counter_owner
  ON entity_usage_counter(campaign_id, owner_kind, owner_ref);

CREATE TABLE attunement (
  campaign_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  attuned_at TEXT NOT NULL,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, character_id, item_id)
);

CREATE INDEX attunement_item ON attunement(campaign_id, item_id);

ALTER TABLE character
  ADD COLUMN inspiration INTEGER NOT NULL DEFAULT 0
    CHECK (inspiration IN (0, 1));

ALTER TABLE combat_turn_budget
  ADD COLUMN legendary_action_allowance INTEGER NOT NULL DEFAULT 0
    CHECK (legendary_action_allowance >= 0);

ALTER TABLE combat_turn_budget
  ADD COLUMN legendary_actions_used INTEGER NOT NULL DEFAULT 0
    CHECK (legendary_actions_used >= 0);

ALTER TABLE combat_turn_budget
  ADD COLUMN legendary_action_activity TEXT;

ALTER TABLE combat_turn_budget
  ADD COLUMN legendary_last_spend_token TEXT;
