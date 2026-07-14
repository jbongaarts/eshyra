-- Migration 0011: durable F3 timer anchor evidence (eshyra-2n1t.5.1).
-- The columns are additive so existing effects retain their original anchors.
ALTER TABLE active_effect ADD COLUMN anchor_participant_kind TEXT
  CHECK (
    CASE
      WHEN anchor_kind IN ('source-turn-start', 'target-turn-start') THEN
        CASE WHEN anchor_participant_kind IS NOT NULL
                  AND anchor_participant_kind IN ('character', 'combatant')
             THEN 1 ELSE 0 END
      ELSE CASE WHEN anchor_participant_kind IS NULL THEN 1 ELSE 0 END
    END
  );

ALTER TABLE active_effect ADD COLUMN anchor_participant_ref TEXT
  CHECK (
    CASE
      WHEN anchor_kind IN ('source-turn-start', 'target-turn-start') THEN
        CASE WHEN anchor_participant_ref IS NOT NULL
                  AND length(trim(anchor_participant_ref)) > 0
             THEN 1 ELSE 0 END
      ELSE CASE WHEN anchor_participant_ref IS NULL THEN 1 ELSE 0 END
    END
  );

ALTER TABLE active_effect ADD COLUMN anchor_participant_turn_ordinal INTEGER
  CHECK (
    CASE
      WHEN anchor_kind IN ('source-turn-start', 'target-turn-start') THEN
        CASE WHEN anchor_participant_turn_ordinal IS NOT NULL
                  AND anchor_participant_turn_ordinal >= 0
             THEN 1 ELSE 0 END
      ELSE CASE WHEN anchor_participant_turn_ordinal IS NULL THEN 1 ELSE 0 END
    END
  );

ALTER TABLE active_effect ADD COLUMN anchor_trigger TEXT
  CHECK (
    CASE
      WHEN anchor_kind = 'trigger-occurred' THEN
        CASE WHEN anchor_trigger IS NOT NULL
                  AND length(trim(anchor_trigger)) > 0
             THEN 1 ELSE 0 END
      ELSE CASE WHEN anchor_trigger IS NULL THEN 1 ELSE 0 END
    END
  );
