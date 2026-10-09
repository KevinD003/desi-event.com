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
-- placed (apps/api/src/routes/orders.js: order and lines) and when its tickets
-- are issued (apps/api/src/lib/checkout.js).
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
-- as 20260929100000_check_in_per_night wrote it.
--
-- Rollback (manual, in order):
--   DROP TRIGGER desi_ticket_venue_payment_sum_on_delete ON "Ticket";
--   DROP TRIGGER desi_ticket_venue_payment_sum ON "Ticket";
--   DROP FUNCTION desi_ticket_venue_payment_sum();
--   DROP TRIGGER desi_venue_payment_sum ON "VenuePayment";
--   DROP FUNCTION desi_venue_payment_sum();
--   DROP TRIGGER desi_venue_payment_append_only ON "VenuePayment";
--   DROP FUNCTION desi_venue_payment_append_only();
--   DROP TRIGGER desi_ticket_venue_payment_guard ON "Ticket";
--   DROP FUNCTION desi_ticket_venue_payment_guard();
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
ALTER TABLE "Order" ADD COLUMN     "venueDueCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "venueDueCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "venueDueCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "venuePaymentId" TEXT;

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
-- 4. A ticket's payment is set once, to a payment of its own order
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

    IF payment_order IS DISTINCT FROM ticket_order OR NEW."venueDueCents" <= 0 THEN
      RAISE EXCEPTION 'ticket % can be paid only by a payment of its own order for an amount it owes (venue_payment_order)',
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
