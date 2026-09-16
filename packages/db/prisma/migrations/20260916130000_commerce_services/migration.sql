-- ---------------------------------------------------------------------------
-- The columns, constraints and triggers the commerce services stand on.
--
-- Three groups, in dependency order:
--
--   1. Columns. A hold item learns which order line will pay for it; the
--      outbox learns what a lease is; a refund learns when it was submitted; a
--      payout exists before the provider names it; a reconciliation task learns
--      who it belongs to.
--   2. CHECK constraints for things one row can decide about itself.
--   3. Triggers for invariants that span two tables, which a CHECK cannot see.
--
-- Everything in group 3 is here rather than in application code for the reason
-- ADR 0004 gives: these are rules that must hold even when the application is
-- wrong, and the application is the thing most likely to be wrong.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

-- Which order line pays for this seat, and what it cost when the order was
-- priced. Settlement previously matched a held seat to a line by ticket type,
-- which cannot tell two lines of one tier apart — and a selection spanning two
-- price zones is exactly two lines of one tier.
ALTER TABLE "HoldItem" ADD COLUMN "orderItemId" TEXT;
ALTER TABLE "HoldItem" ADD COLUMN "unitPriceCents" INTEGER;

ALTER TABLE "HoldItem"
  ADD CONSTRAINT "HoldItem_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "HoldItem_orderItemId_idx" ON "HoldItem"("orderItemId");

-- The outbox gains a lease, a failure classification, and the dimensions its
-- dedupe key is built from.
ALTER TABLE "NotificationOutbox" ADD COLUMN "businessEvent" TEXT;
ALTER TABLE "NotificationOutbox" ADD COLUMN "templateVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "NotificationOutbox" ADD COLUMN "leaseOwner" TEXT;
ALTER TABLE "NotificationOutbox" ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);
ALTER TABLE "NotificationOutbox" ADD COLUMN "lastAttemptAt" TIMESTAMP(3);
ALTER TABLE "NotificationOutbox" ADD COLUMN "failureCategory" TEXT;
ALTER TABLE "NotificationOutbox" ADD COLUMN "providerMessageId" TEXT;
ALTER TABLE "NotificationOutbox" ADD COLUMN "organizationId" TEXT;

CREATE INDEX "NotificationOutbox_status_leaseExpiresAt_idx"
  ON "NotificationOutbox"("status", "leaseExpiresAt");
CREATE INDEX "NotificationOutbox_organizationId_status_idx"
  ON "NotificationOutbox"("organizationId", "status");

ALTER TABLE "Refund" ADD COLUMN "submittedAt" TIMESTAMP(3);
ALTER TABLE "Refund" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

-- A payout is decided here and identified there, so it has a life before the
-- provider has heard of it.
ALTER TABLE "Payout" ALTER COLUMN "providerPayoutId" DROP NOT NULL;
ALTER TABLE "Payout" ALTER COLUMN "status" SET DEFAULT 'SCHEDULED';
ALTER TABLE "Payout" ADD COLUMN "reversedCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Payout" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "Payout" ADD COLUMN "holdReason" TEXT;

CREATE UNIQUE INDEX "Payout_idempotencyKey_key" ON "Payout"("idempotencyKey");

ALTER TABLE "ReconciliationTask" ADD COLUMN "resolvedById" TEXT;
ALTER TABLE "ReconciliationTask" ADD COLUMN "escalatedAt" TIMESTAMP(3);
ALTER TABLE "ReconciliationTask" ADD COLUMN "escalationReason" TEXT;
ALTER TABLE "ReconciliationTask" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "ReconciliationTask" ADD COLUMN "notes" JSONB;
ALTER TABLE "ReconciliationTask" ADD COLUMN "transferId" TEXT;
ALTER TABLE "ReconciliationTask" ADD COLUMN "payoutId" TEXT;
ALTER TABLE "ReconciliationTask" ADD COLUMN "disputeId" TEXT;

CREATE INDEX "ReconciliationTask_organizationId_state_idx"
  ON "ReconciliationTask"("organizationId", "state");
CREATE INDEX "ReconciliationTask_refundId_idx" ON "ReconciliationTask"("refundId");

-- ---------------------------------------------------------------------------
-- 2. CHECK constraints
-- ---------------------------------------------------------------------------

-- A claim without a lease is indistinguishable from the SENDING state this
-- replaces: two workers both believing they own the row, neither able to prove
-- it. The lease is not optional decoration on CLAIMED; it is what CLAIMED means.
ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "notification_claim_has_lease"
  CHECK ("status" <> 'CLAIMED' OR ("leaseOwner" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL));

-- A retry that is not scheduled for a time is not scheduled.
ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "notification_retry_has_time"
  CHECK ("status" <> 'RETRY_SCHEDULED' OR "scheduledFor" IS NOT NULL);

ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "notification_failure_category_known"
  CHECK ("failureCategory" IS NULL OR "failureCategory" IN ('PERMANENT', 'TRANSIENT'));

-- A payout cannot be clawed back for more than it sent, and a paid one has to
-- say who paid it.
ALTER TABLE "Payout"
  ADD CONSTRAINT "payout_reversal_within_amount"
  CHECK ("reversedCents" >= 0 AND "reversedCents" <= "amountCents");

ALTER TABLE "Payout"
  ADD CONSTRAINT "payout_paid_has_provider_reference"
  CHECK ("status" NOT IN ('PAID', 'REVERSED') OR "providerPayoutId" IS NOT NULL);

-- A seat's frozen price is a price.
ALTER TABLE "HoldItem"
  ADD CONSTRAINT "hold_item_price_non_negative"
  CHECK ("unitPriceCents" IS NULL OR "unitPriceCents" >= 0);

-- ---------------------------------------------------------------------------
-- 3. Triggers
-- ---------------------------------------------------------------------------

-- A ticket that has been revoked, refunded, transferred away, voided or
-- cancelled must not admit anybody. The CheckIn table already refuses a second
-- row for one ticket; nothing refused the first row for a dead one, so a
-- revocation was only as good as the code path that read the status before
-- scanning — and a check-in is exactly where a busy gate takes shortcuts.
CREATE OR REPLACE FUNCTION desi_check_in_ticket_admissible() RETURNS trigger AS $$
DECLARE
  ticket_status "TicketStatus";
BEGIN
  SELECT "status" INTO ticket_status FROM "Ticket" WHERE "id" = NEW."ticketId";

  IF ticket_status IS NULL THEN
    RAISE EXCEPTION 'check-in refused: ticket % does not exist', NEW."ticketId";
  END IF;

  IF ticket_status NOT IN ('VALID', 'TRANSFER_PENDING') THEN
    RAISE EXCEPTION 'check-in refused: ticket % is %, which does not admit',
      NEW."ticketId", ticket_status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER desi_check_in_ticket_admissible
  BEFORE INSERT ON "CheckIn"
  FOR EACH ROW EXECUTE FUNCTION desi_check_in_ticket_admissible();

-- A ticket that has been through the door cannot then be transferred, revoked
-- into someone else's hands, or quietly made valid again. The transitions this
-- allows are the ones the ticket service implements; anything else is a bug
-- somewhere, and the database is the last place that can still say so.
CREATE OR REPLACE FUNCTION desi_ticket_status_transition() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = NEW."status" THEN
    RETURN NEW;
  END IF;

  -- Terminal states. Once a ticket is one of these it is finished, and the only
  -- honest way to give somebody admission is to issue a new ticket.
  IF OLD."status" IN ('TRANSFERRED', 'SUPERSEDED', 'REVOKED', 'REFUNDED', 'VOID') THEN
    RAISE EXCEPTION 'ticket % is %, which is terminal; it cannot become %',
      OLD."id", OLD."status", NEW."status";
  END IF;

  -- A ticket that has been used can still be marked refunded or cancelled —
  -- money and the event are separate questions from attendance — but it cannot
  -- go back to being unused, and it cannot be handed on.
  IF OLD."status" = 'CHECKED_IN'
     AND NEW."status" NOT IN ('REFUNDED', 'CANCELLED') THEN
    RAISE EXCEPTION 'ticket % has been checked in; it cannot become %',
      OLD."id", NEW."status";
  END IF;

  IF NEW."status" = 'VALID' AND OLD."status" <> 'TRANSFER_PENDING' THEN
    RAISE EXCEPTION 'ticket % cannot return to VALID from %', OLD."id", OLD."status";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER desi_ticket_status_transition
  BEFORE UPDATE ON "Ticket"
  FOR EACH ROW EXECUTE FUNCTION desi_ticket_status_transition();

-- A hold item's order line must belong to the same order as its hold, and must
-- be for the same ticket type. Without this, settlement could be pointed at a
-- line on somebody else's order and would sell the seat against it.
CREATE OR REPLACE FUNCTION desi_hold_item_line_matches() RETURNS trigger AS $$
DECLARE
  hold_order TEXT;
  line_order TEXT;
  line_type  TEXT;
BEGIN
  IF NEW."orderItemId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "orderId" INTO hold_order FROM "TicketHold" WHERE "id" = NEW."holdId";
  SELECT "orderId", "ticketTypeId" INTO line_order, line_type
    FROM "OrderItem" WHERE "id" = NEW."orderItemId";

  IF line_order IS NULL THEN
    RAISE EXCEPTION 'hold item % names order line %, which does not exist',
      NEW."id", NEW."orderItemId";
  END IF;

  IF hold_order IS DISTINCT FROM line_order THEN
    RAISE EXCEPTION 'hold item % is on order %, but its line belongs to order %',
      NEW."id", COALESCE(hold_order, '(none)'), line_order;
  END IF;

  IF line_type IS DISTINCT FROM NEW."ticketTypeId" THEN
    RAISE EXCEPTION 'hold item % is for ticket type %, but its line sells %',
      NEW."id", NEW."ticketTypeId", line_type;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER desi_hold_item_line_matches
  BEFORE INSERT OR UPDATE ON "HoldItem"
  FOR EACH ROW EXECUTE FUNCTION desi_hold_item_line_matches();

-- A refund cannot be settled for more than its order has left to give. The
-- Order CHECK already caps `refundedCents + refundPendingCents` at the total,
-- but only if the application remembers to move those counters. This makes the
-- refund itself answerable for it: a SUCCEEDED refund whose order does not
-- record the money is refused, so the counters cannot drift away from the
-- refunds that justify them.
CREATE OR REPLACE FUNCTION desi_refund_within_order_total() RETURNS trigger AS $$
DECLARE
  settled INTEGER;
  order_total INTEGER;
  order_currency TEXT;
BEGIN
  SELECT "totalCents", "currency" INTO order_total, order_currency
    FROM "Order" WHERE "id" = NEW."orderId";

  IF order_total IS NULL THEN
    RAISE EXCEPTION 'refund % names order %, which does not exist', NEW."id", NEW."orderId";
  END IF;

  IF NEW."currency" <> order_currency THEN
    RAISE EXCEPTION 'refund % is in %, but order % was paid in %',
      NEW."id", NEW."currency", NEW."orderId", order_currency;
  END IF;

  IF NEW."status" <> 'SUCCEEDED' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM("amountCents"), 0) INTO settled
    FROM "Refund"
    WHERE "orderId" = NEW."orderId" AND "status" = 'SUCCEEDED' AND "id" <> NEW."id";

  IF settled + NEW."amountCents" > order_total THEN
    RAISE EXCEPTION
      'refund % would take % from order %, which has already given back % of %',
      NEW."id", NEW."amountCents", NEW."orderId", settled, order_total;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER desi_refund_within_order_total
  BEFORE INSERT OR UPDATE ON "Refund"
  FOR EACH ROW EXECUTE FUNCTION desi_refund_within_order_total();

-- A transfer or payout moves money out. It cannot be marked paid in a currency
-- the organisation was never credited in, and a reversal cannot exceed it —
-- the amount CHECKs cover the arithmetic, and this covers the currency, which
-- no single-row CHECK can see because the credit lives on the ledger.
CREATE OR REPLACE FUNCTION desi_payout_currency_matches() RETURNS trigger AS $$
DECLARE
  account_currency TEXT;
BEGIN
  IF NEW."connectedAccountId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "payoutCurrency" INTO account_currency
    FROM "ConnectedAccount" WHERE "id" = NEW."connectedAccountId";

  IF account_currency IS NOT NULL AND account_currency <> NEW."currency" THEN
    RAISE EXCEPTION 'payout % is in %, but the connected account is paid in %',
      NEW."id", NEW."currency", account_currency;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER desi_payout_currency_matches
  BEFORE INSERT OR UPDATE ON "Payout"
  FOR EACH ROW EXECUTE FUNCTION desi_payout_currency_matches();
