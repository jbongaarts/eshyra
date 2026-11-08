-- eshyra-ffoo: a grant that prints an UPPER BOUND on how many creatures one use
-- calls (`maxCountPerCost`: Pipes of the Sewers, "expend 1 to 3 charges,
-- calling forth one swarm of rats with each expended charge") is bound against
-- the use's bind credit, and the bound is the units of the credit's economy
-- that use spent. use_item records that spend on the credit in the same
-- transaction that issues it, so start_effect enforces the engine's own record
-- and never a caller-supplied number. NULL: every credit issued before this
-- migration (its spend was not recorded, so a bounded grant refuses it).
ALTER TABLE item_grant_bind_credit ADD COLUMN spent_amount INTEGER;
