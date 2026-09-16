-- Hold ownership, two-phase payment records and denominated fixed-amount promos.
--
-- PostgreSQL will not let a new enum value be used in the same transaction
-- that adds it, so the enum additions are committed before anything reads them.


-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentStatus" ADD VALUE 'PENDING';
ALTER TYPE "PaymentStatus" ADD VALUE 'TIMEOUT';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "idempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "attemptNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "rawProviderStatus" TEXT,
ADD COLUMN     "reconciliationRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "settledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PromoCode" ADD COLUMN     "currency" TEXT;

-- AlterTable
ALTER TABLE "TicketHold" ADD COLUMN     "guestTokenHash" TEXT,
ADD COLUMN     "releaseReason" TEXT,
ADD COLUMN     "releasedAt" TIMESTAMP(3),
ADD COLUMN     "releasedBy" TEXT,
ADD COLUMN     "userId" TEXT;

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "orderId" TEXT,
    "paymentId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookEvent_processedAt_idx" ON "WebhookEvent"("processedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_orderId_idx" ON "WebhookEvent"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_providerEventId_key" ON "WebhookEvent"("provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_reconciliationRequired_idx" ON "Payment"("reconciliationRequired");

-- CreateIndex
CREATE INDEX "TicketHold_userId_status_idx" ON "TicketHold"("userId", "status");

-- CreateIndex
CREATE INDEX "TicketHold_guestTokenHash_idx" ON "TicketHold"("guestTokenHash");

-- AddForeignKey
ALTER TABLE "TicketHold" ADD CONSTRAINT "TicketHold_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Backfill before constraining.
-- ---------------------------------------------------------------------------

-- Holds that predate the ownership model have no owner of either kind. Give
-- them an unguessable guest hash rather than a null: the single-owner check
-- below must hold for every row, and a random digest means no caller can claim
-- these holds. They lapse on their own expiry or need an audited admin
-- override, which is the safe direction for rows whose owner is unknowable.
UPDATE "TicketHold"
SET "guestTokenHash" = encode(sha256((gen_random_uuid()::text || id)::bytea), 'hex')
WHERE "userId" IS NULL AND "guestTokenHash" IS NULL;

-- A flat discount is denominated. Existing rows take their organisation's
-- payout currency, which is the currency those campaigns were created against.
UPDATE "PromoCode" p
SET "currency" = o."payoutCurrency"
FROM "Organization" o
WHERE p."organizationId" = o.id
  AND p."type" = 'FIXED_AMOUNT'
  AND p."currency" IS NULL;

-- ---------------------------------------------------------------------------
-- Invariants the application must not be able to violate.
-- ---------------------------------------------------------------------------

-- Exactly one ownership path per hold. Enforced here and not only in
-- application code: a hold with neither owner can be released by nobody, and a
-- hold with both has two authorization paths where the schema promises one.
ALTER TABLE "TicketHold"
  ADD CONSTRAINT "ticket_hold_single_owner"
  CHECK (("userId" IS NOT NULL) <> ("guestTokenHash" IS NOT NULL));

-- A FIXED_AMOUNT promo without a currency would be applied at face value to
-- any currency, discounting CA$500 off an order for a ₹500 campaign.
ALTER TABLE "PromoCode"
  ADD CONSTRAINT "promo_code_fixed_amount_currency"
  CHECK ("type" <> 'FIXED_AMOUNT' OR "currency" IS NOT NULL);
