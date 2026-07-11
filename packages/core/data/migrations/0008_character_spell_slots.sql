-- Migration 0008: durable single-class spell-slot pools (eshyra-2n1t.6).
--
-- A row is one currently available spell-slot level for one character. The
-- capacity is never model-declared: state/spellSlots.ts derives and reconciles
-- it from the canonical character sheet's sole class progression after the
-- ADR 0018 single-class guard succeeds. `spellcasting` is the ordinary class
-- pool; `pact_magic` is deliberately separate, with its own short-rest
-- recharge. Multiclass pool composition is outside schema-v1's supported
-- domain and is rejected by that shared guard before this table is touched.

CREATE TABLE character_spell_slot (
  character_id TEXT NOT NULL REFERENCES character(id),
  pool_kind TEXT NOT NULL CHECK (pool_kind IN ('spellcasting', 'pact_magic')),
  spell_level INTEGER NOT NULL CHECK (spell_level BETWEEN 1 AND 9),
  slots_max INTEGER NOT NULL CHECK (slots_max >= 1),
  slots_used INTEGER NOT NULL DEFAULT 0
    CHECK (slots_used >= 0 AND slots_used <= slots_max),
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (character_id, pool_kind, spell_level)
);

CREATE INDEX character_spell_slot_character
  ON character_spell_slot(character_id, pool_kind, spell_level);
