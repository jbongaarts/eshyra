-- Phase 2 (ADR 0020 W9) runtime shadow-mode discovery evidence for accepted
-- turns. An additional column on the existing accepted-turn trace authority;
-- shadow mode introduces no store of its own.
ALTER TABLE turn_trace ADD COLUMN discovery_shadow TEXT;
