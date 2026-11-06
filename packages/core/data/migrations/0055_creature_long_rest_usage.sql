-- eshyra-o9bd.19.6.7.20: SRD 5.1 limited-usage (p.259) says a monster must
-- finish a long rest to regain expended X/Day uses. Creature usage.perDay and
-- innate per-day spell economies were stored with reset_kind 'dawn'; they now
-- derive 'long_rest'. A combatant's economy is record-derived only (a declared
-- economy is refused for a combatant), so every combatant row with 'dawn' is
-- one of those creature economies. Character and item rows, including the
-- magic-item and legacy charge economies that print "regains ... at dawn", keep
-- their stored reset kind.
UPDATE entity_usage_counter
SET reset_kind = 'long_rest'
WHERE owner_kind = 'combatant' AND reset_kind = 'dawn';
