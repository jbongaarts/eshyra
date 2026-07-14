-- Migration 0011: durable F3 timer anchor evidence (eshyra-2n1t.5.1).
-- The columns are additive so existing effects retain their original anchors.
ALTER TABLE active_effect ADD COLUMN anchor_participant_kind TEXT
  CHECK (
    (anchor_kind IN ('source-turn-start', 'target-turn-start')
      AND anchor_participant_kind IN ('character', 'combatant'))
    OR (anchor_kind NOT IN ('source-turn-start', 'target-turn-start')
      AND anchor_participant_kind IS NULL)
  );

ALTER TABLE active_effect ADD COLUMN anchor_participant_ref TEXT
  CHECK (
    (anchor_kind IN ('source-turn-start', 'target-turn-start')
      AND anchor_participant_ref IS NOT NULL)
    OR (anchor_kind NOT IN ('source-turn-start', 'target-turn-start')
      AND anchor_participant_ref IS NULL)
  );

ALTER TABLE active_effect ADD COLUMN anchor_participant_turn_ordinal INTEGER
  CHECK (
    (anchor_kind IN ('source-turn-start', 'target-turn-start')
      AND anchor_participant_turn_ordinal >= 0)
    OR (anchor_kind NOT IN ('source-turn-start', 'target-turn-start')
      AND anchor_participant_turn_ordinal IS NULL)
  );

ALTER TABLE active_effect ADD COLUMN anchor_trigger TEXT
  CHECK (
    (anchor_kind = 'trigger-occurred' AND length(trim(anchor_trigger)) > 0)
    OR (anchor_kind <> 'trigger-occurred' AND anchor_trigger IS NULL)
  );
