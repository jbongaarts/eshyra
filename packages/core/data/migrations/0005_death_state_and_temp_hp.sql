-- Migration 0005: death/dying/stable state machine + temporary-HP buffer
-- (eshyra-2n1t.8, engine family F6; source: docs/audits/dnd5e-srd-5.1-final/
-- 2026-07-06-o9bd-18-7-8-execution-boundary-classification.md §4).
--
-- Durable state for the HP write path's death machine. `life_state` is the
-- code-owned dying/stable/dead status that `adjust_hp` maintains as an
-- invariant (falling-unconscious, instant-death, healing dead-gate);
-- `death_save_successes`/`death_save_failures` are the counters the
-- death-saving-throw procedure and damage-at-0 escalation mutate; `hp_temp`
-- is the temporary-hit-point buffer consumed before `hp_current` and expired
-- by the long rest (F7 calls the reset hook).
--
-- Backfill policy: existing rows default to alive with no buffer, EXCEPT a
-- character persisted at 0 HP on an initialized sheet (hp_max > 0), which
-- pre-0005 play could legitimately produce via adjust_hp clamping. Leaving
-- such a row 'alive' would strand it outside the state machine (death saves
-- apply only to a dying character). Their true pre-migration narrative state
-- (dying vs stable) is unknowable, so they are reconciled to 'stable' — the
-- conservative mechanically-valid non-alive state: unconscious at 0 HP, no
-- death-save pressure, woken by any healing, knocked back to dying by damage.
-- Uninitialized 0/0 bootstrap sheets stay 'alive' (same exception the runtime
-- death machine applies).
--
-- Conventions (ADR 0015): plain ALTER TABLE, never IF NOT EXISTS.

ALTER TABLE character
  ADD COLUMN hp_temp INTEGER NOT NULL DEFAULT 0 CHECK (hp_temp >= 0);

ALTER TABLE character
  ADD COLUMN life_state TEXT NOT NULL DEFAULT 'alive'
    CHECK (life_state IN ('alive', 'dying', 'stable', 'dead'));

ALTER TABLE character
  ADD COLUMN death_save_successes INTEGER NOT NULL DEFAULT 0
    CHECK (death_save_successes BETWEEN 0 AND 3);

ALTER TABLE character
  ADD COLUMN death_save_failures INTEGER NOT NULL DEFAULT 0
    CHECK (death_save_failures BETWEEN 0 AND 3);

UPDATE character
  SET life_state = 'stable'
  WHERE hp_max > 0 AND hp_current = 0;
