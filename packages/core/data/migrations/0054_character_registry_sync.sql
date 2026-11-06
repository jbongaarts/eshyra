-- eshyra-o9bd.19.6.7.8 (A2-F3): the registry revision this campaign database
-- last synchronized a registry-linked character with (ADR 0012). It lives in
-- the campaign database so a checkpoint restore or a fork carries the OLDER
-- value with it, which is what lets custody tell a restored/forked copy (behind
-- the registry head) from a legitimate crash/resume of the original database
-- (synced at head, with unsynced progress kept). Written after every committed
-- sync-back, every checkout/catch-up, and every resume acquire. Absent for a
-- legacy campaign, which keeps the pre-existing behaviour until it is stamped.
CREATE TABLE character_registry_sync (
  character_id TEXT PRIMARY KEY,
  global_character_id TEXT NOT NULL,
  synced_revision INTEGER NOT NULL CHECK (synced_revision >= 1)
);
