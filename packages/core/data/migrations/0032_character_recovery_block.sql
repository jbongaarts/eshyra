-- Explicit recovery prohibition attached to a character lifecycle state.
ALTER TABLE character ADD COLUMN recovery_block TEXT
  CHECK (recovery_block IS NULL OR recovery_block = 'suffocating');
