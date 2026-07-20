-- Migration 0022: deterministically adopt legacy stable-at-0-HP characters.
--
-- Migration 0020 introduced durable recovery deadlines but could not recover
-- the original 1d4 result or stabilization time for rows that predated it.
-- Adopt those rows at the latest possible 1d4 outcome (4 hours), anchored at
-- migration time, so adoption never wakes a character earlier than the lost
-- roll could have. The temporary table makes a missing or NULL singleton clock
-- fail via NOT NULL instead of writing a NULL/garbage schedule.
CREATE TEMP TABLE stable_recovery_adoption_clock (
  elapsed_minutes INTEGER NOT NULL CHECK (elapsed_minutes >= 0)
);
INSERT INTO stable_recovery_adoption_clock(elapsed_minutes)
VALUES ((SELECT elapsed_minutes FROM clock WHERE id = 1));

-- A partially populated schedule is corruption. Preserve its surviving
-- evidence and abort the migration rather than rewriting it as an adoption.
CREATE TEMP TABLE stable_recovery_adoption_guard (
  violation_count INTEGER NOT NULL CHECK (violation_count = 0)
);
INSERT INTO stable_recovery_adoption_guard(violation_count)
SELECT COUNT(*)
FROM character
WHERE life_state = 'stable'
  AND hp_current = 0
  AND (
    (stable_recovery_roll IS NULL)
    + (stable_recovery_anchor_elapsed_minutes IS NULL)
    + (stable_recovery_deadline_elapsed_minutes IS NULL)
  ) BETWEEN 1 AND 2;

UPDATE character
SET stable_recovery_roll = 4,
    stable_recovery_anchor_elapsed_minutes =
      (SELECT elapsed_minutes FROM stable_recovery_adoption_clock),
    stable_recovery_deadline_elapsed_minutes =
      (SELECT elapsed_minutes + 240 FROM stable_recovery_adoption_clock)
WHERE life_state = 'stable'
  AND hp_current = 0
  AND (
    stable_recovery_roll IS NULL
    AND stable_recovery_anchor_elapsed_minutes IS NULL
    AND stable_recovery_deadline_elapsed_minutes IS NULL
  );

DROP TABLE stable_recovery_adoption_guard;
DROP TABLE stable_recovery_adoption_clock;
