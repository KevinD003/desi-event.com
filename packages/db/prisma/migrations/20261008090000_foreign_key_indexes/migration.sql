-- Index the four foreign keys into tiers and nights that no index leads with.
--
-- PostgreSQL checks a foreign key from the referenced side too: deleting a
-- ticket type looks for order lines and hold lines that still name it (both
-- ON DELETE RESTRICT), and deleting a night looks for the orders that name it
-- (ON DELETE SET NULL, which also rewrites them) and the holds on it (ON
-- DELETE CASCADE). With no index on the referencing column, each of those
-- looks reads the whole table. So did the tier editor's counts of a tier's
-- order lines and hold lines, and a night's cancellation's search for the
-- orders on the night.
--
-- On a copy of the shared test database (52,017 order lines, 10,160 hold
-- lines, 41,301 orders), deleting one organisation with one event and one
-- ticket type -- the db client test's own cleanup -- read every order line and
-- every hold line once: one sequential scan of each (pg_stat_user_tables),
-- 9.7 ms and 2.5 ms of trigger time warm, and about 12 MB to read cold. With
-- these indexes it scans neither (0.18 ms and 0.24 ms). The cost of every
-- such delete grew with every order ever placed, and on a database whose
-- page cache is cold or whose disk is busy it is the whole tables' worth of
-- reads.
--
-- Each index matches @@index in schema.prisma, by Prisma's default name.
--
-- Rollback:
--   DROP INDEX "OrderItem_ticketTypeId_idx";
--   DROP INDEX "HoldItem_ticketTypeId_idx";
--   DROP INDEX "Order_eventSessionId_idx";
--   DROP INDEX "TicketHold_eventSessionId_idx";

-- CreateIndex
CREATE INDEX "OrderItem_ticketTypeId_idx" ON "OrderItem"("ticketTypeId");

-- CreateIndex
CREATE INDEX "HoldItem_ticketTypeId_idx" ON "HoldItem"("ticketTypeId");

-- CreateIndex
CREATE INDEX "Order_eventSessionId_idx" ON "Order"("eventSessionId");

-- CreateIndex
CREATE INDEX "TicketHold_eventSessionId_idx" ON "TicketHold"("eventSessionId");
