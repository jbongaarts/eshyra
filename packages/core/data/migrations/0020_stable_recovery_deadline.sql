-- Migration 0020: durable SRD stable-at-0-HP recovery deadline (F6).
ALTER TABLE character
  ADD COLUMN stable_recovery_roll INTEGER CHECK (stable_recovery_roll BETWEEN 1 AND 4);
ALTER TABLE character
  ADD COLUMN stable_recovery_anchor_elapsed_minutes INTEGER CHECK (stable_recovery_anchor_elapsed_minutes >= 0);
ALTER TABLE character
  ADD COLUMN stable_recovery_deadline_elapsed_minutes INTEGER CHECK (stable_recovery_deadline_elapsed_minutes >= 0);
