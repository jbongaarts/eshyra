-- Migration 0009: active-effect lifecycle & concentration (eshyra-2n1t.5,
-- engine family F3; source: docs/audits/dnd5e-srd-5.1-final/
-- 2026-07-06-o9bd-18-7-8-execution-boundary-classification.md §4; design:
-- docs/active-effect-lifecycle.md).
--
-- One canonical durable lifecycle for effects that persist across turns:
-- concentration spells, non-concentration timed spells, condition packages,
-- curses, summon control, wards, transformations, and activated item powers.
--
-- `active_effect` is one row per effect instance. `kind` is a semantic
-- license (which sources, links, and concentration semantics the effect may
-- declare — enforced in code, see EFFECT_KIND_PROFILES in
-- state/activeEffects.ts). Timers always record quantity + semantic unit +
-- explicit anchor (PR #428 lesson): `duration_kind` is the discriminant, and
-- a `timed` effect carries amount/unit/anchor_kind plus the stamped anchor
-- facts (ISO time, campaign-clock snapshot, and — for round-unit timers,
-- which require an active combat instance — the anchoring instance and
-- round, which make expiry code-evaluable). `until-trigger` effects name the
-- semantic trigger that ends them (PR #420 lesson: the event, not a state
-- delta). Status is a real machine: active <-> suppressed -> ended
-- (terminal), with `end_reason`/`end_detail` recording exactly why an
-- effect ended; ended rows must carry reason + timestamp and live rows must
-- carry neither (CHECKed).
--
-- Concentration: `requires_concentration` rows must name their owner, and
-- the partial unique index backstops the code-owned invariant that an owner
-- holds at most one live concentration effect (replacement is a deterministic
-- transition, not an error).
--
-- `active_effect_target` is the affected creatures/scopes; targets are
-- individually removable (partial multi-target cleanup) without ending the
-- effect. `active_effect_link` is the durable state the effect OWNS —
-- condition entries projected onto characters/combatants, linked actors
-- (summoned/animated combatants); `zone`/`form` are schema-reserved for the
-- S3 ward / transformation rollout beads and fail closed in code. Each link
-- carries two cleanup policies so ordinary spell end and concentration break
-- can differ (Conjure Elemental: break releases the elemental, ordinary end
-- removes it): `cleanup_on_end` governs every non-break end, and
-- `cleanup_on_break` governs concentration-broken ends.
--
-- `active_effect_event` is the append-only per-effect audit ledger (like
-- progression_event): (effect, seq) identity, typed `detail_json` validated
-- at the write boundary, recording created/refreshed/suppressed/unsuppressed/
-- concentration-check/target-removed/ended evidence for replay and review.
--
-- Backfill policy: no data backfill. No pre-0008 state tracked active
-- effects; rows appear as effects are created during play.
--
-- Conventions (ADR 0015): plain ALTER TABLE / CREATE TABLE, never IF NOT
-- EXISTS.

CREATE TABLE active_effect (
  campaign_id TEXT NOT NULL,
  effect_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'spell-effect',
    'summoning',
    'ward',
    'curse',
    'transformation',
    'item-power',
    'condition-package'
  )),
  display_name TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'spell',
    'magic-item',
    'feature',
    'creature-trait',
    'hazard',
    'ruling'
  )),
  source_ref TEXT,
  source_actor_kind TEXT
    CHECK (source_actor_kind IS NULL
           OR source_actor_kind IN ('character', 'combatant')),
  source_actor_ref TEXT,
  requires_concentration INTEGER NOT NULL DEFAULT 0
    CHECK (requires_concentration IN (0, 1)),
  concentration_owner_kind TEXT
    CHECK (concentration_owner_kind IS NULL
           OR concentration_owner_kind IN ('character', 'combatant')),
  concentration_owner_ref TEXT,
  duration_kind TEXT NOT NULL CHECK (duration_kind IN (
    'timed',
    'until-dismissed',
    'until-removed',
    'until-trigger'
  )),
  duration_amount INTEGER
    CHECK (duration_amount IS NULL OR duration_amount >= 1),
  duration_unit TEXT
    CHECK (duration_unit IS NULL
           OR duration_unit IN ('round', 'minute', 'hour', 'day')),
  anchor_kind TEXT
    CHECK (anchor_kind IS NULL OR anchor_kind IN (
      'spell-cast',
      'effect-created',
      'trigger-occurred',
      'source-turn-start',
      'target-turn-start'
    )),
  anchor_at TEXT,
  anchor_game_time TEXT,
  anchor_combat_instance_id TEXT,
  anchor_round INTEGER
    CHECK (anchor_round IS NULL OR anchor_round >= 1),
  expiry_trigger TEXT,
  dismissible INTEGER NOT NULL DEFAULT 0 CHECK (dismissible IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suppressed', 'ended')),
  end_reason TEXT
    CHECK (end_reason IS NULL OR end_reason IN (
      'expired',
      'dismissed',
      'concentration-broken',
      'dispelled',
      'replaced',
      'source-removed',
      'ruled'
    )),
  end_detail TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, effect_id),
  CHECK (requires_concentration = 0
         OR (concentration_owner_kind IS NOT NULL
             AND concentration_owner_ref IS NOT NULL)),
  CHECK (requires_concentration = 1
         OR (concentration_owner_kind IS NULL
             AND concentration_owner_ref IS NULL)),
  CHECK ((source_actor_kind IS NULL) = (source_actor_ref IS NULL)),
  CHECK (status != 'ended'
         OR (end_reason IS NOT NULL AND ended_at IS NOT NULL)),
  CHECK (status = 'ended'
         OR (end_reason IS NULL AND end_detail IS NULL
             AND ended_at IS NULL)),
  CHECK (duration_kind != 'timed'
         OR (duration_amount IS NOT NULL AND duration_unit IS NOT NULL
             AND anchor_kind IS NOT NULL AND anchor_at IS NOT NULL)),
  CHECK (duration_kind = 'timed'
         OR (duration_amount IS NULL AND duration_unit IS NULL
             AND anchor_kind IS NULL)),
  CHECK ((duration_kind = 'until-trigger') = (expiry_trigger IS NOT NULL)),
  CHECK (duration_kind != 'until-dismissed' OR dismissible = 1),
  CHECK (duration_unit IS NULL OR duration_unit != 'round'
         OR (anchor_combat_instance_id IS NOT NULL
             AND anchor_round IS NOT NULL))
);

-- At most one live concentration effect per owner (SRD concentration).
CREATE UNIQUE INDEX active_effect_one_concentration_per_owner
  ON active_effect(campaign_id, concentration_owner_kind,
                   concentration_owner_ref)
  WHERE requires_concentration = 1 AND status IN ('active', 'suppressed');

CREATE INDEX active_effect_status ON active_effect(campaign_id, status);

CREATE TABLE active_effect_target (
  campaign_id TEXT NOT NULL,
  effect_id TEXT NOT NULL,
  target_kind TEXT NOT NULL
    CHECK (target_kind IN ('character', 'combatant', 'scope')),
  target_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'removed')),
  removed_reason TEXT,
  removed_at TEXT,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, effect_id, target_kind, target_ref),
  CHECK (status != 'removed'
         OR (removed_reason IS NOT NULL AND removed_at IS NOT NULL)),
  CHECK (status = 'removed'
         OR (removed_reason IS NULL AND removed_at IS NULL))
);

CREATE TABLE active_effect_link (
  campaign_id TEXT NOT NULL,
  effect_id TEXT NOT NULL,
  link_kind TEXT NOT NULL
    CHECK (link_kind IN ('condition', 'actor', 'zone', 'form')),
  target_kind TEXT NOT NULL
    CHECK (target_kind IN ('character', 'combatant')),
  target_ref TEXT NOT NULL,
  projection_ref TEXT NOT NULL,
  cleanup_on_end TEXT NOT NULL DEFAULT 'remove'
    CHECK (cleanup_on_end IN ('remove', 'release')),
  cleanup_on_break TEXT NOT NULL DEFAULT 'remove'
    CHECK (cleanup_on_break IN ('remove', 'release')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'removed', 'released')),
  removed_reason TEXT,
  removed_at TEXT,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, effect_id, link_kind, target_kind, target_ref,
               projection_ref),
  CHECK (status = 'active'
         OR (removed_reason IS NOT NULL AND removed_at IS NOT NULL)),
  CHECK (status != 'active'
         OR (removed_reason IS NULL AND removed_at IS NULL))
);

CREATE INDEX active_effect_link_target
  ON active_effect_link(campaign_id, target_kind, target_ref);

CREATE TABLE active_effect_event (
  campaign_id TEXT NOT NULL,
  effect_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  event_kind TEXT NOT NULL CHECK (event_kind IN (
    'created',
    'refreshed',
    'suppressed',
    'unsuppressed',
    'concentration-check',
    'target-removed',
    'combat-closed',
    'ended'
  )),
  detail_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  PRIMARY KEY (campaign_id, effect_id, seq)
);
