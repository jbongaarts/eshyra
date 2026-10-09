-- eshyra-09co.1: Flexible Casting. A spell slot created from sorcery points
-- can exceed the class table's slots_max and can exist at a level the class
-- has no slots for, and it vanishes on a long rest, so it needs its own
-- storage rather than a row in character_spell_slot.
CREATE TABLE character_created_spell_slot (
  character_id TEXT NOT NULL REFERENCES character(id),
  spell_level INTEGER NOT NULL CHECK (spell_level BETWEEN 1 AND 5),
  created INTEGER NOT NULL CHECK (created >= 1),
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0 AND used <= created),
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (character_id, spell_level)
);
