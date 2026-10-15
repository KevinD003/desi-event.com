-- Paying at the venue (SPEC3 §5.3, ADR 0017).
--
-- A pay-at-the-venue order pays its booking fee (and any tax on it) online and
-- the ticket price at the door. Each ticket carries its share of the door price
-- ("venueDueCents", never changes) and, once paid, the payment that paid it
-- ("venuePaymentId", set once). A payment is recorded only in the transaction
-- that lets its tickets in. Money taken at the door is not platform money:
-- nothing here is posted to the ledger.
--
-- Only apps/api/src/lib/venue-payments.js writes "VenuePayment" and
-- "Ticket"."venuePaymentId"; "venueDueCents" is written when the order is
-- placed (apps/api/src/routes/orders.js: order and lines), when its tickets
-- are issued (apps/api/src/lib/checkout.js) and, copied, when a ticket is
-- handed on (apps/api/src/lib/tickets.js).
--
-- No BEGIN/COMMIT inside: Prisma wraps the file in one transaction. Every
-- trigger raising 23514 also writes its constraint name into the message,
-- because the driver adapter passes on the SQLSTATE and the message but not
-- the constraint field. No backfill: every existing row is a card order with
-- nothing due at the door.
--
-- A ticket that owes a payment at the door can be handed on like any other
-- ticket, and its new holder pays at the door (the owner's answer to open
-- question 7): nothing here refuses it, and the ticket status trigger is left
-- as 20260929100000_check_in_per_night wrote it. What is due stays with the
-- ticket: a successor owes what its predecessor owed, and no ticket's due ever
-- changes (§7).
--
-- Unpaid tickets can be cancelled by an organiser or the Desi-Event team (the
-- owner's answer to open question 2, SPEC3-XI XU): each such ticket is REVOKED
-- and names the "VenueBookingCancellation" that cancelled it; its place is
-- freed (its tier's "quantitySold" falls, CHECK ticket_type_sold_not_negative);
-- the order records the door price no longer owed and the booking fee
-- Desi-Event kept, which no refund may reach (CHECK
-- order_venue_kept_within_total). Only the fee is ever kept: there is no kept
-- tax column. Only apps/api/src/lib/venue-bookings.js writes the cancellation,
-- "Ticket"."venueCancellationId", "OrderItem"."venueCancelledQuantity",
-- "Order"."venueCancelledBasisCents" and "Order"."venueFeeKeptCents" (§8-§10).
--
-- Rollback (manual, in order):
--   DROP TRIGGER desi_ticket_venue_cancellation_sum_on_delete ON "Ticket";
--   DROP TRIGGER desi_ticket_venue_cancellation_sum ON "Ticket";
--   DROP FUNCTION desi_ticket_venue_cancellation_sum();
--   DROP TRIGGER desi_venue_booking_cancellation_sum ON "VenueBookingCancellation";
--   DROP FUNCTION desi_venue_booking_cancellation_sum();
--   DROP TRIGGER desi_venue_booking_cancellation_append_only ON "VenueBookingCancellation";
--   DROP FUNCTION desi_venue_booking_cancellation_append_only();
--   DROP TRIGGER desi_ticket_venue_cancellation_guard ON "Ticket";
--   DROP FUNCTION desi_ticket_venue_cancellation_guard();
--   DROP TRIGGER desi_ticket_venue_due_guard ON "Ticket";
--   DROP FUNCTION desi_ticket_venue_due_guard();
--   ALTER TABLE "TicketType" DROP CONSTRAINT "ticket_type_sold_not_negative";
--   ALTER TABLE "OrderItem" DROP CONSTRAINT "order_item_venue_cancelled_within_line",
--     DROP COLUMN "venueCancelledQuantity";
--   ALTER TABLE "Order" DROP CONSTRAINT "order_venue_kept_within_total",
--     DROP CONSTRAINT "order_venue_cancel_shape",
--     DROP COLUMN "venueCancelledBasisCents", DROP COLUMN "venueFeeKeptCents";
--   ALTER TABLE "Ticket" DROP CONSTRAINT "ticket_venue_cancellation_shape",
--     DROP CONSTRAINT "Ticket_venueCancellationId_fkey";
--   DROP INDEX "Ticket_venueCancellationId_idx";
--   ALTER TABLE "Ticket" DROP COLUMN "venueCancellationId";
--   DROP TABLE "VenueBookingCancellation";
--   DROP TRIGGER desi_ticket_venue_payment_sum_on_delete ON "Ticket";
--   DROP TRIGGER desi_ticket_venue_payment_sum ON "Ticket";
--   DROP FUNCTION desi_ticket_venue_payment_sum();
--   DROP TRIGGER desi_venue_payment_sum ON "VenuePayment";
--   DROP FUNCTION desi_venue_payment_sum();
--   DROP TRIGGER desi_venue_payment_append_only ON "VenuePayment";
--   DROP FUNCTION desi_venue_payment_append_only();
--   DROP TRIGGER desi_ticket_venue_payment_guard ON "Ticket";
--   DROP FUNCTION desi_ticket_venue_payment_guard();
--     (A partial rollback of SPEC3-XI alone restores the guard's body without
--     its "venueCancellationId" clause instead.)
--   Restore desi_check_in_ticket_admissible() to its body in
--     20260929100000_check_in_per_night.
--   ALTER TABLE "Ticket" DROP CONSTRAINT "ticket_venue_due_shape",
--     DROP CONSTRAINT "Ticket_venuePaymentId_fkey";
--   DROP INDEX "Ticket_venuePaymentId_idx";
--   ALTER TABLE "Ticket" DROP COLUMN "venueDueCents", DROP COLUMN "venuePaymentId";
--   DROP TABLE "VenuePayment";
--   ALTER TABLE "OrderItem" DROP CONSTRAINT "order_item_venue_due_shape",
--     DROP COLUMN "venueDueCents";
--   ALTER TABLE "Order" DROP CONSTRAINT "order_venue_payment_shape",
--     DROP COLUMN "venueDueCents";
--   DROP TYPE "VenuePaymentVia";

-- ============================================================================
-- 1. Enum, columns and table
-- ============================================================================

-- CreateEnum
CREATE TYPE "VenuePaymentVia" AS ENUM ('DOOR_TICKET', 'DOOR_GROUP');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "venueDueCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "venueCancelledBasisCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "venueFeeKeptCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "venueDueCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "venueCancelledQuantity" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "venueDueCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "venuePaymentId" TEXT,
ADD COLUMN     "venueCancellationId" TEXT;

-- CreateTable
CREATE TABLE "VenuePayment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventSessionId" TEXT,
    "organizationId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "ticketCount" INTEGER NOT NULL,
    "via" "VenuePaymentVia" NOT NULL,
    "authority" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "recordedById" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gate" TEXT,

    CONSTRAINT "VenuePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueBookingCancellation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketCount" INTEGER NOT NULL,
    "basisCents" INTEGER NOT NULL,
    "feeKeptCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "cancelledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenueBookingCancellation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VenuePayment_eventId_recordedAt_idx" ON "VenuePayment"("eventId", "recordedAt");

-- CreateIndex
CREATE INDEX "VenuePayment_orderId_idx" ON "VenuePayment"("orderId");

-- CreateIndex
CREATE INDEX "VenuePayment_recordedById_idx" ON "VenuePayment"("recordedById");

-- CreateIndex
CREATE INDEX "VenuePayment_eventSessionId_idx" ON "VenuePayment"("eventSessionId");

-- CreateIndex
CREATE INDEX "Ticket_venuePaymentId_idx" ON "Ticket"("venuePaymentId");

-- CreateIndex
CREATE INDEX "VenueBookingCancellation_eventId_createdAt_idx" ON "VenueBookingCancellation"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "VenueBookingCancellation_orderId_idx" ON "VenueBookingCancellation"("orderId");

-- CreateIndex
CREATE INDEX "VenueBookingCancellation_cancelledById_idx" ON "VenueBookingCancellation"("cancelledById");

-- CreateIndex
CREATE INDEX "Ticket_venueCancellationId_idx" ON "Ticket"("venueCancellationId");

-- AddForeignKey
ALTER TABLE "VenuePayment" ADD CONSTRAINT "VenuePayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenuePayment" ADD CONSTRAINT "VenuePayment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenuePayment" ADD CONSTRAINT "VenuePayment_eventSessionId_fkey" FOREIGN KEY ("eventSessionId") REFERENCES "EventSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenuePayment" ADD CONSTRAINT "VenuePayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_venuePaymentId_fkey" FOREIGN KEY ("venuePaymentId") REFERENCES "VenuePayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueBookingCancellation" ADD CONSTRAINT "VenueBookingCancellation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueBookingCancellation" ADD CONSTRAINT "VenueBookingCancellation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueBookingCancellation" ADD CONSTRAINT "VenueBookingCancellation_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_venueCancellationId_fkey" FOREIGN KEY ("venueCancellationId") REFERENCES "VenueBookingCancellation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 2. CHECK constraints
-- ============================================================================

-- A card order owes nothing at the door. A pay-at-the-venue order owes the
-- ticket price after the promo there, and pays online only the booking fee and
-- any tax on it — never the ticket price. Whether tax is charged on that fee is
-- open question 9 and needs no migration either way.
ALTER TABLE "Order" ADD CONSTRAINT "order_venue_payment_shape" CHECK (
  ("paymentMethod" = 'CARD' AND "venueDueCents" = 0)
  OR ("paymentMethod" = 'AT_VENUE' AND "venueDueCents" > 0
      AND "venueDueCents" = "subtotalCents" - "discountCents"
      AND "taxCents" >= 0 AND "totalCents" = "feesCents" + "taxCents")
);

ALTER TABLE "OrderItem" ADD CONSTRAINT "order_item_venue_due_shape" CHECK (
  "venueDueCents" >= 0 AND "venueDueCents" <= "subtotalCents"
);

-- A ticket is paid at the door only if it owes something there.
ALTER TABLE "Ticket" ADD CONSTRAINT "ticket_venue_due_shape" CHECK (
  "venueDueCents" >= 0 AND ("venuePaymentId" IS NULL OR "venueDueCents" > 0)
);

-- The door authority is the admission's (packages/permissions/src/admission.js),
-- with the role it recorded.
ALTER TABLE "VenuePayment" ADD CONSTRAINT "venue_payment_shape" CHECK (
  "amountCents" > 0 AND "ticketCount" BETWEEN 1 AND 100 AND "currency" ~ '^[A-Z]{3}$'
  AND "authority" IN ('ORGANIZATION_ROLE', 'EVENT_SCOPE', 'PLATFORM_ROLE')
  AND char_length("role") BETWEEN 1 AND 40
  AND ("gate" IS NULL OR char_length("gate") BETWEEN 1 AND 60)
);

-- A cancellation of unpaid tickets (SPEC3-XI XU): 1-100 tickets owing
-- something, the fee kept 0 or more, decided by an organisation role holding
-- order:refund or by a platform role holding venue_booking:cancel (never a
-- door scope), with a reason of 10-500 characters shown to the buyer.
ALTER TABLE "VenueBookingCancellation" ADD CONSTRAINT "venue_booking_cancellation_shape" CHECK (
  "ticketCount" BETWEEN 1 AND 100 AND "basisCents" > 0 AND "feeKeptCents" >= 0
  AND "currency" ~ '^[A-Z]{3}$'
  AND "authority" IN ('ORGANIZATION_ROLE', 'PLATFORM_ROLE')
  AND char_length("role") BETWEEN 1 AND 40
  AND char_length(btrim("reason")) BETWEEN 10 AND 500
);

-- Only a withdrawn ticket that owed something and was never paid is cancelled
-- unpaid.
ALTER TABLE "Ticket" ADD CONSTRAINT "ticket_venue_cancellation_shape" CHECK (
  "venueCancellationId" IS NULL
  OR ("status" = 'REVOKED' AND "venuePaymentId" IS NULL AND "venueDueCents" > 0)
);

-- What a cancellation leaves on its order: the door price no longer owed is
-- part of what was owed, the fee kept is part of the fee charged, and a card
-- order has neither.
ALTER TABLE "Order" ADD CONSTRAINT "order_venue_cancel_shape" CHECK (
  "venueCancelledBasisCents" >= 0 AND "venueFeeKeptCents" >= 0
  AND "venueCancelledBasisCents" <= "venueDueCents"
  AND "venueFeeKeptCents" <= "feesCents"
  AND ("paymentMethod" = 'AT_VENUE'
       OR ("venueCancelledBasisCents" = 0 AND "venueFeeKeptCents" = 0))
);

-- A kept fee is never refunded (SPEC3-XI standing rule 8): whatever is refunded,
-- being refunded and kept together never exceeds what was paid online. Beside
-- order_refund_within_total, which stays.
ALTER TABLE "Order" ADD CONSTRAINT "order_venue_kept_within_total" CHECK (
  "refundedCents" + "refundPendingCents" + "venueFeeKeptCents" <= "totalCents"
);

-- A line's refunded and cancelled tickets together are never more than it sold.
ALTER TABLE "OrderItem" ADD CONSTRAINT "order_item_venue_cancelled_within_line" CHECK (
  "venueCancelledQuantity" >= 0
  AND "refundedQuantity" + "venueCancelledQuantity" <= "quantity"
);

-- A tier's sold count falls only when unpaid tickets are cancelled, by exactly
-- the tickets cancelled, so it never goes below 0. Every existing row has 0 or
-- more (settlement only ever added), so it is added validated; the upgrade
-- verifier proves it.
ALTER TABLE "TicketType" ADD CONSTRAINT "ticket_type_sold_not_negative" CHECK (
  "quantitySold" >= 0
);

-- ============================================================================
-- 3. A ticket that owes a payment at the door is not let in until it is paid
-- ============================================================================
--
-- The body of 20260929100000_check_in_per_night §2, unchanged but for the two
-- columns read in the same locked SELECT and the check after the status check.

CREATE OR REPLACE FUNCTION desi_check_in_ticket_admissible() RETURNS trigger AS $$
DECLARE
  ticket_status "TicketStatus";
  ticket_due INTEGER;
  ticket_payment TEXT;
  ticket_night TEXT;
  ticket_event TEXT;
  nights INTEGER;
  every_night BOOLEAN;
BEGIN
  -- The ticket's row first, locked: every admission of one ticket waits here
  -- for the one before it to commit or roll back, so the checks below see
  -- each other's rows rather than racing past them. The application locks the
  -- same row before it writes, so for it this lock is already held.
  SELECT t."status", t."venueDueCents", t."venuePaymentId"
    INTO ticket_status, ticket_due, ticket_payment
    FROM "Ticket" t WHERE t."id" = NEW."ticketId"
    FOR UPDATE;

  IF ticket_status IS NULL THEN
    RAISE EXCEPTION 'check-in refused: ticket % does not exist', NEW."ticketId";
  END IF;

  IF ticket_status NOT IN ('VALID', 'TRANSFER_PENDING') THEN
    RAISE EXCEPTION 'check-in refused: ticket % is %, which does not admit',
      NEW."ticketId", ticket_status;
  END IF;

  -- A ticket booked to pay at the venue is let in only with its payment
  -- recorded, which the door does in the same transaction.
  IF ticket_due > 0 AND ticket_payment IS NULL THEN
    RAISE EXCEPTION 'check-in refused: ticket % is paid at the venue and its payment is not recorded (check_in_payment_due)',
      NEW."ticketId"
      USING ERRCODE = '23514', CONSTRAINT = 'check_in_payment_due';
  END IF;

  -- The ticket's own night: its seat's, else its tier's. Null for a ticket
  -- whose tier names no night.
  SELECT COALESCE(es."eventSessionId", tt."eventSessionId"), o."eventId"
    INTO ticket_night, ticket_event
    FROM "Ticket" t
    JOIN "OrderItem" oi ON oi."id" = t."orderItemId"
    JOIN "Order" o ON o."id" = oi."orderId"
    LEFT JOIN "TicketType" tt ON tt."id" = oi."ticketTypeId"
    LEFT JOIN "EventSeat" es ON es."id" = t."eventSeatId"
    WHERE t."id" = NEW."ticketId";

  SELECT count(*) INTO nights FROM "EventSession" WHERE "eventId" = ticket_event;

  every_night := ticket_night IS NULL AND nights > 1;

  IF NEW."eventSessionId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "EventSession"
      WHERE "id" = NEW."eventSessionId" AND "eventId" = ticket_event
    ) THEN
      RAISE EXCEPTION 'check-in refused: night % is not a night of ticket %''s event',
        NEW."eventSessionId", NEW."ticketId";
    END IF;

    IF ticket_night IS NOT NULL AND NEW."eventSessionId" <> ticket_night THEN
      RAISE EXCEPTION 'check-in refused: ticket % is for another night', NEW."ticketId";
    END IF;
  ELSIF every_night THEN
    RAISE EXCEPTION 'check-in refused: ticket % is good for every night, so its admission names the night',
      NEW."ticketId";
  END IF;

  -- A ticket that admits once has one admission. The same night again is left
  -- to the unique index (a duplicate, as it always was); any other key is
  -- refused here.
  IF NOT every_night AND EXISTS (
    SELECT 1 FROM "CheckIn" c
    WHERE c."ticketId" = NEW."ticketId"
      AND c."eventSessionId" IS DISTINCT FROM NEW."eventSessionId"
  ) THEN
    RAISE EXCEPTION 'check-in refused: ticket % admits once and was already admitted',
      NEW."ticketId";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. A ticket's payment is set once, to a payment of its own order, and never
--    to a ticket cancelled unpaid
-- ============================================================================

CREATE OR REPLACE FUNCTION desi_ticket_venue_payment_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  payment_order TEXT;
  ticket_order TEXT;
BEGIN
  IF OLD."venuePaymentId" IS NOT NULL
     AND NEW."venuePaymentId" IS DISTINCT FROM OLD."venuePaymentId" THEN
    RAISE EXCEPTION 'ticket % was paid at the door; its payment never changes (ticket_venue_payment_fixed)',
      OLD."id"
      USING ERRCODE = '23514', CONSTRAINT = 'ticket_venue_payment_fixed';
  END IF;

  IF OLD."venuePaymentId" IS NULL AND NEW."venuePaymentId" IS NOT NULL THEN
    SELECT vp."orderId" INTO payment_order
      FROM "VenuePayment" vp WHERE vp."id" = NEW."venuePaymentId";
    SELECT oi."orderId" INTO ticket_order
      FROM "OrderItem" oi WHERE oi."id" = NEW."orderItemId";

    -- A ticket cancelled unpaid is never paid (SPEC3-XI XU12).
    IF payment_order IS DISTINCT FROM ticket_order OR NEW."venueDueCents" <= 0
       OR NEW."venueCancellationId" IS NOT NULL THEN
      RAISE EXCEPTION 'ticket % can be paid only by a payment of its own order for an amount it owes, and never once cancelled unpaid (venue_payment_order)',
        OLD."id"
        USING ERRCODE = '23514', CONSTRAINT = 'venue_payment_order';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER desi_ticket_venue_payment_guard
  BEFORE UPDATE OF "venuePaymentId" ON "Ticket"
  FOR EACH ROW EXECUTE FUNCTION desi_ticket_venue_payment_guard();

-- ============================================================================
-- 5. A payment taken at the door is never edited
-- ============================================================================
--
-- An UPDATE may only clear "recordedById" (the account was deleted) or
-- "eventSessionId" (the night was deleted): both foreign keys' SET NULL.

CREATE OR REPLACE FUNCTION desi_venue_payment_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment % taken at the door is a record and is never deleted (venue_payment_append_only)',
      OLD."id"
      USING ERRCODE = '23514', CONSTRAINT = 'venue_payment_append_only';
  END IF;

  IF (NEW."id", NEW."orderId", NEW."eventId", NEW."organizationId", NEW."amountCents",
      NEW."currency", NEW."ticketCount", NEW."via", NEW."authority", NEW."role",
      NEW."recordedAt", NEW."gate")
     IS DISTINCT FROM
     (OLD."id", OLD."orderId", OLD."eventId", OLD."organizationId", OLD."amountCents",
      OLD."currency", OLD."ticketCount", OLD."via", OLD."authority", OLD."role",
      OLD."recordedAt", OLD."gate")
     OR (NEW."recordedById" IS DISTINCT FROM OLD."recordedById" AND NEW."recordedById" IS NOT NULL)
     OR (NEW."eventSessionId" IS DISTINCT FROM OLD."eventSessionId" AND NEW."eventSessionId" IS NOT NULL) THEN
    RAISE EXCEPTION 'payment % taken at the door is a record and is never edited (venue_payment_append_only)',
      OLD."id"
      USING ERRCODE = '23514', CONSTRAINT = 'venue_payment_append_only';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER desi_venue_payment_append_only
  BEFORE UPDATE OR DELETE ON "VenuePayment"
  FOR EACH ROW EXECUTE FUNCTION desi_venue_payment_append_only();

-- ============================================================================
-- 6. A payment equals the tickets it paid for
-- ============================================================================
--
-- Checked at commit, after the tickets have been pointed at it: once for the
-- payment when it is recorded, and again for it whenever a ticket joins it,
-- changes what it owes or is removed, in that transaction or any later one.
-- With §4, §5 and the two ticket triggers below, every payment's amount
-- equals the dues of the tickets it paid for, for ever: a ticket's payment
-- never changes once set (§4), the payment itself is never edited (§5), and no
-- ticket joins it, changes its due or is removed without the sum being
-- checked again at commit.

CREATE OR REPLACE FUNCTION desi_venue_payment_sum() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  paid_tickets INTEGER;
  paid_cents INTEGER;
BEGIN
  SELECT count(*), COALESCE(sum("venueDueCents"), 0)
    INTO paid_tickets, paid_cents
    FROM "Ticket" WHERE "venuePaymentId" = NEW."id";

  IF paid_tickets <> NEW."ticketCount" OR paid_cents <> NEW."amountCents" THEN
    RAISE EXCEPTION 'payment % taken at the door is for % tickets owing %, but % tickets owing % point at it (venue_payment_sum)',
      NEW."id", NEW."ticketCount", NEW."amountCents", paid_tickets, paid_cents
      USING ERRCODE = '23514', CONSTRAINT = 'venue_payment_sum';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER desi_venue_payment_sum
  AFTER INSERT ON "VenuePayment"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION desi_venue_payment_sum();

-- The same sum, checked again at commit for the payment a ticket names
-- whenever that ticket is written with one: pointed at a payment after the
-- payment's own transaction committed, inserted already pointing at one, or
-- its due changed once paid. And for the payment a deleted ticket named.
-- Without these, a second unpaid ticket could later be pointed at a payment
-- recorded for one, and be let in with nothing recorded for it.
CREATE OR REPLACE FUNCTION desi_ticket_venue_payment_sum() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  payment_id TEXT;
  want_tickets INTEGER;
  want_cents INTEGER;
  paid_tickets INTEGER;
  paid_cents INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    payment_id := OLD."venuePaymentId";
  ELSE
    payment_id := NEW."venuePaymentId";
  END IF;

  SELECT "ticketCount", "amountCents" INTO want_tickets, want_cents
    FROM "VenuePayment" WHERE "id" = payment_id;

  SELECT count(*), COALESCE(sum("venueDueCents"), 0)
    INTO paid_tickets, paid_cents
    FROM "Ticket" WHERE "venuePaymentId" = payment_id;

  IF paid_tickets IS DISTINCT FROM want_tickets OR paid_cents IS DISTINCT FROM want_cents THEN
    RAISE EXCEPTION 'payment % taken at the door is for % tickets owing %, but % tickets owing % point at it (venue_payment_sum)',
      payment_id, want_tickets, want_cents, paid_tickets, paid_cents
      USING ERRCODE = '23514', CONSTRAINT = 'venue_payment_sum';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER desi_ticket_venue_payment_sum
  AFTER INSERT OR UPDATE OF "venuePaymentId", "venueDueCents" ON "Ticket"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW."venuePaymentId" IS NOT NULL)
  EXECUTE FUNCTION desi_ticket_venue_payment_sum();

CREATE CONSTRAINT TRIGGER desi_ticket_venue_payment_sum_on_delete
  AFTER DELETE ON "Ticket"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD."venuePaymentId" IS NOT NULL)
  EXECUTE FUNCTION desi_ticket_venue_payment_sum();

-- ============================================================================
-- 7. What is due stays with the ticket (open question 7)
-- ============================================================================
--
-- A ticket owing a payment at the door can be handed on; its successor owes
-- exactly what it owed, and nobody ever changes a ticket's due. A ticket is
-- inserted unpaid and not cancelled: payments and cancellations are recorded
-- against tickets that exist. The only ticket writers are settlement
-- (apps/api/src/lib/checkout.js), transfer acceptance (apps/api/src/lib/tickets.js)
-- and the worker, which refuses pay-at-the-venue orders.

CREATE OR REPLACE FUNCTION desi_ticket_venue_due_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  predecessor_due INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."venueDueCents" IS DISTINCT FROM OLD."venueDueCents" THEN
      RAISE EXCEPTION 'ticket % owes % at the door and that never changes (ticket_venue_due_fixed)',
        OLD."id", OLD."venueDueCents"
        USING ERRCODE = '23514', CONSTRAINT = 'ticket_venue_due_fixed';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW."venuePaymentId" IS NOT NULL OR NEW."venueCancellationId" IS NOT NULL THEN
    RAISE EXCEPTION 'ticket % is issued unpaid and not cancelled; a payment or a cancellation is recorded afterwards (ticket_venue_insert_unpaid)',
      NEW."id"
      USING ERRCODE = '23514', CONSTRAINT = 'ticket_venue_insert_unpaid';
  END IF;

  IF NEW."supersedesTicketId" IS NOT NULL THEN
    SELECT t."venueDueCents" INTO predecessor_due
      FROM "Ticket" t WHERE t."id" = NEW."supersedesTicketId";

    -- A missing predecessor is the foreign key's refusal, not this one's.
    IF FOUND AND predecessor_due IS DISTINCT FROM NEW."venueDueCents" THEN
      RAISE EXCEPTION 'ticket % replaces ticket % and owes what it owed, %, at the door (ticket_venue_due_successor)',
        NEW."id", NEW."supersedesTicketId", predecessor_due
        USING ERRCODE = '23514', CONSTRAINT = 'ticket_venue_due_successor';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER desi_ticket_venue_due_guard
  BEFORE INSERT OR UPDATE OF "venueDueCents" ON "Ticket"
  FOR EACH ROW EXECUTE FUNCTION desi_ticket_venue_due_guard();

-- ============================================================================
-- 8. A ticket is cancelled unpaid once, by a cancellation of its own order
-- ============================================================================
--
-- In the same UPDATE that withdraws it: from VALID or TRANSFER_PENDING to
-- REVOKED, owing something, never paid, never let in. Once set, never changed.

CREATE OR REPLACE FUNCTION desi_ticket_venue_cancellation_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cancellation_order TEXT;
  ticket_order TEXT;
BEGIN
  IF OLD."venueCancellationId" IS NOT NULL
     AND NEW."venueCancellationId" IS DISTINCT FROM OLD."venueCancellationId" THEN
    RAISE EXCEPTION 'ticket % was cancelled unpaid; its cancellation never changes (ticket_venue_cancellation_fixed)',
      OLD."id"
      USING ERRCODE = '23514', CONSTRAINT = 'ticket_venue_cancellation_fixed';
  END IF;

  IF OLD."venueCancellationId" IS NULL AND NEW."venueCancellationId" IS NOT NULL THEN
    SELECT c."orderId" INTO cancellation_order
      FROM "VenueBookingCancellation" c WHERE c."id" = NEW."venueCancellationId";
    SELECT oi."orderId" INTO ticket_order
      FROM "OrderItem" oi WHERE oi."id" = NEW."orderItemId";

    IF cancellation_order IS DISTINCT FROM ticket_order
       OR NEW."venueDueCents" <= 0
       OR NEW."venuePaymentId" IS NOT NULL
       OR OLD."status" NOT IN ('VALID', 'TRANSFER_PENDING')
       OR NEW."status" <> 'REVOKED'
       OR EXISTS (SELECT 1 FROM "CheckIn" ci WHERE ci."ticketId" = OLD."id") THEN
      RAISE EXCEPTION 'ticket % can be cancelled unpaid only by a cancellation of its own order, while it owes something, is unpaid, was never let in and is withdrawn from VALID or TRANSFER_PENDING in the same change (venue_cancellation_ticket)',
        OLD."id"
        USING ERRCODE = '23514', CONSTRAINT = 'venue_cancellation_ticket';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER desi_ticket_venue_cancellation_guard
  BEFORE UPDATE OF "venueCancellationId" ON "Ticket"
  FOR EACH ROW EXECUTE FUNCTION desi_ticket_venue_cancellation_guard();

-- ============================================================================
-- 9. A cancellation of unpaid tickets is never edited
-- ============================================================================
--
-- An UPDATE may only clear "cancelledById" (the foreign key's SET NULL when the
-- account is deleted). No DELETE: the order and the event it names are
-- RESTRICT, so no cascade removes it either.

CREATE OR REPLACE FUNCTION desi_venue_booking_cancellation_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'cancellation % of unpaid tickets is a record and is never deleted (venue_booking_cancellation_append_only)',
      OLD."id"
      USING ERRCODE = '23514', CONSTRAINT = 'venue_booking_cancellation_append_only';
  END IF;

  IF (NEW."id", NEW."orderId", NEW."eventId", NEW."organizationId", NEW."ticketCount",
      NEW."basisCents", NEW."feeKeptCents", NEW."currency", NEW."authority", NEW."role",
      NEW."reason", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."orderId", OLD."eventId", OLD."organizationId", OLD."ticketCount",
      OLD."basisCents", OLD."feeKeptCents", OLD."currency", OLD."authority", OLD."role",
      OLD."reason", OLD."createdAt")
     OR (NEW."cancelledById" IS DISTINCT FROM OLD."cancelledById" AND NEW."cancelledById" IS NOT NULL) THEN
    RAISE EXCEPTION 'cancellation % of unpaid tickets is a record and is never edited (venue_booking_cancellation_append_only)',
      OLD."id"
      USING ERRCODE = '23514', CONSTRAINT = 'venue_booking_cancellation_append_only';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER desi_venue_booking_cancellation_append_only
  BEFORE UPDATE OR DELETE ON "VenueBookingCancellation"
  FOR EACH ROW EXECUTE FUNCTION desi_venue_booking_cancellation_append_only();

-- ============================================================================
-- 10. A cancellation equals the tickets it cancelled
-- ============================================================================
--
-- Checked at commit, as §6 checks a door payment: once for the cancellation
-- when it is recorded, and again whenever a ticket joins it or is removed, in
-- that transaction or any later one. With §7, §8 and §9, a cancellation's
-- basis is the dues of exactly its tickets, for ever: no ticket's due changes
-- (§7), a ticket's cancellation is set once (§8), the cancellation itself is
-- never edited (§9), and no ticket joins it or leaves without the sum being
-- checked again at commit.

CREATE OR REPLACE FUNCTION desi_venue_booking_cancellation_sum() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cancelled_tickets INTEGER;
  cancelled_cents INTEGER;
BEGIN
  SELECT count(*), COALESCE(sum("venueDueCents"), 0)
    INTO cancelled_tickets, cancelled_cents
    FROM "Ticket" WHERE "venueCancellationId" = NEW."id";

  IF cancelled_tickets <> NEW."ticketCount" OR cancelled_cents <> NEW."basisCents" THEN
    RAISE EXCEPTION 'cancellation % is for % tickets owing %, but % tickets owing % point at it (venue_booking_cancellation_sum)',
      NEW."id", NEW."ticketCount", NEW."basisCents", cancelled_tickets, cancelled_cents
      USING ERRCODE = '23514', CONSTRAINT = 'venue_booking_cancellation_sum';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER desi_venue_booking_cancellation_sum
  AFTER INSERT ON "VenueBookingCancellation"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION desi_venue_booking_cancellation_sum();

-- The same sum, checked again at commit for the cancellation a ticket names
-- whenever that ticket is written with one, and for the cancellation a deleted
-- ticket named. Without these, a ticket of the same order withdrawn in a later
-- transaction could be pointed at a cancellation already committed.
CREATE OR REPLACE FUNCTION desi_ticket_venue_cancellation_sum() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cancellation_id TEXT;
  want_tickets INTEGER;
  want_cents INTEGER;
  cancelled_tickets INTEGER;
  cancelled_cents INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    cancellation_id := OLD."venueCancellationId";
  ELSE
    cancellation_id := NEW."venueCancellationId";
  END IF;

  SELECT "ticketCount", "basisCents" INTO want_tickets, want_cents
    FROM "VenueBookingCancellation" WHERE "id" = cancellation_id;

  SELECT count(*), COALESCE(sum("venueDueCents"), 0)
    INTO cancelled_tickets, cancelled_cents
    FROM "Ticket" WHERE "venueCancellationId" = cancellation_id;

  IF cancelled_tickets IS DISTINCT FROM want_tickets OR cancelled_cents IS DISTINCT FROM want_cents THEN
    RAISE EXCEPTION 'cancellation % is for % tickets owing %, but % tickets owing % point at it (venue_booking_cancellation_sum)',
      cancellation_id, want_tickets, want_cents, cancelled_tickets, cancelled_cents
      USING ERRCODE = '23514', CONSTRAINT = 'venue_booking_cancellation_sum';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER desi_ticket_venue_cancellation_sum
  AFTER INSERT OR UPDATE OF "venueCancellationId", "venueDueCents" ON "Ticket"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW."venueCancellationId" IS NOT NULL)
  EXECUTE FUNCTION desi_ticket_venue_cancellation_sum();

CREATE CONSTRAINT TRIGGER desi_ticket_venue_cancellation_sum_on_delete
  AFTER DELETE ON "Ticket"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD."venueCancellationId" IS NOT NULL)
  EXECUTE FUNCTION desi_ticket_venue_cancellation_sum();
