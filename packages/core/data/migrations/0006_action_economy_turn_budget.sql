-- Migration 0006: action-economy turn budget (eshyra-2n1t.4, engine family
-- F2; source: docs/audits/dnd5e-srd-5.1-final/
-- 2026-07-06-o9bd-18-7-8-execution-boundary-classification.md §4).
--
-- Durable per-participant per-turn budget state for structured combat. The
-- combat instance gains a round counter and the active-turn participant; the
-- new `combat_turn_budget` table holds exactly one row per participant per
-- combat instance, reset in place when that participant's turn begins. A
-- participant is either a party character ('character', ref = character id)
-- or a live encounter combatant ('combatant', ref = combatant id) — the two
-- id spaces the rest of the engine already uses for the same split.
--
-- Budget semantics (SRD 5.1: your-turn, bonus-actions, reactions,
-- other-activity-on-your-turn, bonus-action, surprise, two-weapon-fighting):
-- one action, one bonus action, and one free object interaction per turn;
-- `movement_note` is deliberately narrative, not a numeric budget.
-- Reactions are an allowance, not a boolean: `reactions_used` counts spends
-- against `reaction_allowance` (default 1), and `reaction_refresh` says when
-- the count resets — 'own_turn' is the SRD default (regained at the start of
-- the participant's own turn); 'every_turn' models typed extraReactions
-- perTurn mechanics (e.g. the marilith's Reactive). Formula-based
-- extraReactions (e.g. the hydra's Reactive Heads, one per head beyond one)
-- raise `reaction_allowance` through a validated runtime grant.
-- `bonus_action_spell_cast` / `other_spell_cast` carry the
-- bonus-action-spell timing invariant (the only other spell on such a turn
-- is a cantrip with a casting time of 1 action), derived from resolved spell
-- records. `surprised` denies all spends until the participant's first turn
-- ends.
--
-- Backfill policy: nothing to reconcile. Pre-0006 combat instances never had
-- structured turns, so they keep round_number 0 / no active participant —
-- exactly the "no structured turn open" state — and budgets appear lazily
-- the first time begin_turn runs.
--
-- Conventions (ADR 0015): plain ALTER TABLE / CREATE TABLE, never IF NOT
-- EXISTS.

ALTER TABLE combat_instance
  ADD COLUMN round_number INTEGER NOT NULL DEFAULT 0
    CHECK (round_number >= 0);

ALTER TABLE combat_instance
  ADD COLUMN active_participant_kind TEXT
    CHECK (
      active_participant_kind IS NULL
      OR active_participant_kind IN ('character', 'combatant')
    );

ALTER TABLE combat_instance
  ADD COLUMN active_participant_ref TEXT;

CREATE TABLE combat_turn_budget (
  campaign_id TEXT NOT NULL,
  combat_instance_id TEXT NOT NULL,
  participant_kind TEXT NOT NULL
    CHECK (participant_kind IN ('character', 'combatant')),
  participant_ref TEXT NOT NULL,
  surprised INTEGER NOT NULL DEFAULT 0 CHECK (surprised IN (0, 1)),
  turns_taken INTEGER NOT NULL DEFAULT 0 CHECK (turns_taken >= 0),
  action_used INTEGER NOT NULL DEFAULT 0 CHECK (action_used IN (0, 1)),
  action_activity TEXT,
  bonus_action_used INTEGER NOT NULL DEFAULT 0
    CHECK (bonus_action_used IN (0, 1)),
  bonus_action_activity TEXT,
  reactions_used INTEGER NOT NULL DEFAULT 0 CHECK (reactions_used >= 0),
  reaction_allowance INTEGER NOT NULL DEFAULT 1
    CHECK (reaction_allowance >= 1),
  reaction_refresh TEXT NOT NULL DEFAULT 'own_turn'
    CHECK (reaction_refresh IN ('own_turn', 'every_turn')),
  reaction_activity TEXT,
  free_interaction_used INTEGER NOT NULL DEFAULT 0
    CHECK (free_interaction_used IN (0, 1)),
  free_interaction_activity TEXT,
  movement_note TEXT,
  bonus_action_spell_cast INTEGER NOT NULL DEFAULT 0
    CHECK (bonus_action_spell_cast IN (0, 1)),
  other_spell_cast TEXT NOT NULL DEFAULT 'none'
    CHECK (other_spell_cast IN ('none', 'action-cantrip', 'other')),
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (
    campaign_id, combat_instance_id, participant_kind, participant_ref
  )
);

CREATE INDEX combat_turn_budget_instance
  ON combat_turn_budget(campaign_id, combat_instance_id);
